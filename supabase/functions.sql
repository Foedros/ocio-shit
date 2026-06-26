-- ════════════════════════════════════════════════════════════════════════════
-- Ocio Shit — RPCs de escritura atómica (Stage 3) · Supabase/PostgreSQL
-- El cliente del navegador (PostgREST) no hace transacciones multi-paso; estas funciones
-- encapsulan el ALTA y el BORRADO con la MISMA lógica que app/src/lib/db/queries.js
-- (dedup por clave_dedup, num_reconsumo autonumerado, A-07 de duración, cascada de obra
-- huérfana) de forma ATÓMICA.
--
-- SEGURIDAD: SECURITY INVOKER → corren como el usuario autenticado, así que la RLS aplica
-- (owner_id = auth.uid()) y NO son funciones con privilegios elevados (el Advisor NO las marca,
-- a diferencia de SECURITY DEFINER). EXECUTE solo para `authenticated`; revocado de anon/public.
-- search_path fijo (no mutable). Las lecturas van por PostgREST/builder (no aquí).
-- ════════════════════════════════════════════════════════════════════════════

-- ── ALTA: Obra (reusada por clave_dedup o nueva) + Entrada, en una transacción ──────────────
create or replace function ocio_add_entry(p jsonb)
  returns jsonb
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  v_titulo     text    := trim(coalesce(p->'obra'->>'titulo',''));
  v_categoria  text    := p->'obra'->>'categoria';
  v_anio       integer;
  v_estado     text    := coalesce(nullif(p->'entrada'->>'estado',''),'terminado');
  v_valoracion double precision;
  v_fecha      date;
  v_nota       text    := nullif(p->'entrada'->>'nota','');
  v_dur_in     integer;
  v_obra_id    text;
  v_created    boolean := false;
  v_canonica   integer;
  v_dur_entry  integer;
  v_reconsumo  integer;
  v_entrada_id text    := gen_random_uuid()::text;
begin
  if v_titulo = '' then raise exception 'El título es obligatorio.'; end if;
  if v_categoria not in ('pelicula','serie','libro','videojuego','comic','ocio_libre') then
    raise exception 'Categoría inválida: %', v_categoria;
  end if;
  if nullif(p->'obra'->>'anio_obra','') is not null then
    v_anio := trunc((p->'obra'->>'anio_obra')::numeric)::integer;
  end if;
  if v_estado not in ('pendiente','en_curso','terminado','abandonado') then v_estado := 'terminado'; end if;
  if nullif(p->'entrada'->>'valoracion','') is not null then
    v_valoracion := (p->'entrada'->>'valoracion')::double precision;
    if v_valoracion < 0 or v_valoracion > 10 then raise exception 'La valoración debe estar entre 0 y 10.'; end if;
  end if;
  if nullif(p->'entrada'->>'fecha','') is not null then v_fecha := (p->'entrada'->>'fecha')::date; end if;
  if nullif(p->'entrada'->>'duracion_min','') is not null then
    v_dur_in := greatest(0, trunc((p->'entrada'->>'duracion_min')::numeric)::integer);
  end if;

  -- Dedup contra la columna generada clave_dedup (= lower(titulo)|categoria|coalesce(anio::text,'')).
  select id into v_obra_id from obra
   where clave_dedup = lower(v_titulo) || '|' || v_categoria || '|' || coalesce(v_anio::text,'');

  if v_obra_id is null then
    v_obra_id := gen_random_uuid()::text;
    -- A-07: duración fija (pelicula/libro/comic) → canónica = por-entrada; variable → canónica NULL.
    if v_categoria in ('pelicula','libro','comic') then v_canonica := v_dur_in; else v_canonica := null; end if;
    insert into obra (id, titulo, categoria, anio_obra, decada, duracion_canonica_min)
      values (v_obra_id, v_titulo, v_categoria, v_anio,
              case when v_anio is not null then (v_anio/10)*10 else null end, v_canonica);
    v_created := true;
  end if;

  -- A-07: re-consumo de obra fija sin tiempo introducido hereda la canónica.
  v_dur_entry := v_dur_in;
  if v_dur_entry is null and v_categoria in ('pelicula','libro','comic') then
    select duracion_canonica_min into v_dur_entry from obra where id = v_obra_id;
  end if;

  select count(*) into v_reconsumo from entrada where obra_id = v_obra_id;  -- 0 = primera vez
  insert into entrada (id, obra_id, fecha, estado, nota, valoracion, duracion_min, clase_tiempo, num_reconsumo, metadata)
    values (v_entrada_id, v_obra_id, v_fecha, v_estado, v_nota, v_valoracion, v_dur_entry, 'electivo', v_reconsumo,
            jsonb_build_object('origen','sheets','fecha_tipo','fecha_visionado'));

  return jsonb_build_object('obra_id', v_obra_id, 'entrada_id', v_entrada_id,
                            'obra_created', v_created, 'num_reconsumo', v_reconsumo);
end;
$$;

-- ── BORRADO: Entrada; si su Obra queda sin entradas, se borra también (cascada FK) ──────────
create or replace function ocio_delete_entry(p_entrada_id text)
  returns jsonb
  language plpgsql
  security invoker
  set search_path = public
as $$
declare v_obra_id text; v_remaining integer; v_obra_deleted boolean := false;
begin
  select obra_id into v_obra_id from entrada where id = p_entrada_id;
  if v_obra_id is null then return jsonb_build_object('deleted', false, 'obra_deleted', false); end if;
  delete from entrada where id = p_entrada_id;
  select count(*) into v_remaining from entrada where obra_id = v_obra_id;
  if v_remaining = 0 then
    delete from obra where id = v_obra_id;   -- ON DELETE CASCADE limpia obra_creador/etc.
    v_obra_deleted := true;
  end if;
  return jsonb_build_object('deleted', true, 'obra_deleted', v_obra_deleted, 'obra_id', v_obra_id);
end;
$$;

-- ── EDICIÓN de una Entrada existente (valoracion / nota / fecha / duracion_min) ─────────────
-- Reemplazo total de los 4 campos editables (la UI precarga y reenvía todos; fecha NULL permitido).
-- fecha_tipo vive en metadata y NO se toca. Tras editar, re-deriva num_reconsumo de la obra
-- (cronológico, idempotente; es_reconsumo es columna generada → se recalcula sola). Devuelve qué
-- cambió para que el cliente rematerialice colecciones si procede. SECURITY INVOKER (RLS), no DEFINER.
create or replace function ocio_update_entry(
  p_entrada_id   text,
  p_valoracion   double precision default null,
  p_nota         text default null,
  p_fecha        date default null,
  p_duracion_min integer default null
) returns jsonb language plpgsql security invoker set search_path = public
as $$
declare v_obra text; v_old_fecha date; v_old_dur integer; v_old_val double precision;
begin
  select obra_id, fecha, duracion_min, valoracion into v_obra, v_old_fecha, v_old_dur, v_old_val
    from entrada where id = p_entrada_id;             -- RLS: solo ve/edita lo del dueño
  if v_obra is null then return jsonb_build_object('updated', false); end if;
  if p_valoracion is not null and (p_valoracion < 0 or p_valoracion > 10) then
    raise exception 'La valoración debe estar entre 0 y 10.';
  end if;
  update entrada set valoracion = p_valoracion, nota = p_nota, fecha = p_fecha, duracion_min = p_duracion_min
    where id = p_entrada_id;
  -- re-derivar num_reconsumo de la obra (0 = primera vez, 1, 2, … por fecha)
  with r as (
    select id, row_number() over (partition by obra_id order by (fecha is null), fecha, creado_en, id) - 1 as rn
    from entrada where obra_id = v_obra
  )
  update entrada e set num_reconsumo = r.rn from r where r.id = e.id and e.num_reconsumo <> r.rn;
  return jsonb_build_object(
    'updated', true, 'obra_id', v_obra,
    'fecha_changed',     (v_old_fecha is distinct from p_fecha),
    'duracion_changed',  (v_old_dur   is distinct from p_duracion_min),
    'valoracion_changed',(v_old_val   is distinct from p_valoracion)
  );
end;
$$;

-- ── Lecturas agregadas que PostgREST no hace cómodo (DISTINCT, counts) ──────────────────────
-- SECURITY INVOKER (RLS aplica) + STABLE. Solo lectura.
create or replace function ocio_counts()
  returns jsonb language sql security invoker stable set search_path = public
as $$
  select jsonb_build_object(
    'obra',         (select count(*) from obra),
    'entrada',      (select count(*) from entrada),
    'persona',      (select count(*) from persona),
    'obra_creador', (select count(*) from obra_creador));
$$;

create or replace function ocio_filter_options()
  returns jsonb language sql security invoker stable set search_path = public
as $$
  select jsonb_build_object(
    'categorias',  (select coalesce(jsonb_agg(distinct categoria order by categoria), '[]'::jsonb)
                      from obra where categoria is not null),
    'origenes',    (select coalesce(jsonb_agg(distinct (metadata->>'origen') order by (metadata->>'origen')), '[]'::jsonb)
                      from entrada where metadata->>'origen' is not null),
    'fecha_tipos', (select coalesce(jsonb_agg(distinct (metadata->>'fecha_tipo') order by (metadata->>'fecha_tipo')), '[]'::jsonb)
                      from entrada where metadata->>'fecha_tipo' is not null));
$$;

-- ── Colecciones (escritura) — crear / materializar (compilador en runtime) / R1 ─────────────
-- Materializar ejecuta el SQL que produce el COMPILADOR conservado (compileCollectionRule). Como
-- PostgREST no corre SQL crudo, llega aquí. Defensas: SECURITY INVOKER (RLS aplica, no DEFINER →
-- el Advisor no lo marca); se valida que el SQL sea EXACTAMENTE el SELECT del compilador, una sola
-- sentencia, sin DML; y los parámetros se sustituyen como literales SEGUROS (números tal cual,
-- textos con quote_literal) — nunca hay datos de usuario sin escapar en el SQL.
create or replace function ocio_create_collection(p jsonb)
  returns jsonb language plpgsql security invoker set search_path = public
as $$
declare v_id text := gen_random_uuid()::text; v_nombre text := trim(coalesce(p->>'nombre','')); v_tipo text := p->>'tipo';
begin
  if v_nombre = '' then raise exception 'La colección necesita un nombre.'; end if;
  if v_tipo not in ('manual','inteligente','ia') then raise exception 'tipo inválido: %', v_tipo; end if;
  insert into coleccion (id, nombre, descripcion, tipo, regla_json)
    values (v_id, v_nombre, nullif(p->>'descripcion',''), v_tipo,
            case when p ? 'regla_json' and jsonb_typeof(p->'regla_json') <> 'null'
                 then (p->'regla_json')::text else null end);
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function ocio_materialize_collection(p_coleccion_id text, p_sql text, p_params jsonb default '[]'::jsonb)
  returns integer language plpgsql security invoker set search_path = public
as $$
declare v_sql text := p_sql; v_i int; v_el jsonb; v_lit text; v_ids text[];
begin
  -- whitelist ESTRUCTURAL (sobre p_sql, que solo trae $n + SQL del compilador, sin literales)
  if v_sql !~* '^\s*SELECT DISTINCT o\.id FROM obra o' then raise exception 'consulta no permitida'; end if;
  if position(';' in v_sql) > 0 then raise exception 'multi-statement no permitido'; end if;
  if v_sql ~* '\m(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|merge|call|do)\M' then
    raise exception 'palabra no permitida en la consulta';
  end if;
  -- sustituir $1..$n por literales seguros (reverso: $10 antes que $1)
  if jsonb_typeof(p_params) = 'array' then
    for v_i in reverse jsonb_array_length(p_params) - 1 .. 0 loop
      v_el := p_params -> v_i;
      if v_el is null or jsonb_typeof(v_el) = 'null' then v_lit := 'NULL';
      elsif jsonb_typeof(v_el) in ('number','boolean') then v_lit := (v_el #>> '{}');
      else v_lit := quote_literal(v_el #>> '{}'); end if;
      v_sql := replace(v_sql, '$' || (v_i + 1)::text, v_lit);
    end loop;
  end if;
  execute 'select coalesce(array_agg(t.id), ''{}''::text[]) from (' || v_sql || ') t' into v_ids;
  delete from obra_coleccion where coleccion_id = p_coleccion_id;
  if array_length(v_ids, 1) > 0 then
    insert into obra_coleccion (obra_id, coleccion_id)
      select unnest(v_ids), p_coleccion_id on conflict do nothing;
  end if;
  return coalesce(array_length(v_ids, 1), 0);
end;
$$;

-- R1 (etiquetas.js): deriva decada-*/idioma-*/pais-* de columnas de Obra y vincula. Idempotente.
create or replace function ocio_apply_r1()
  returns jsonb language plpgsql security invoker set search_path = public
as $$
declare v_tags int := 0; v_links int := 0; r record; v_id text; v_nombre text; v_before int; v_after int;
begin
  for r in select distinct decada from obra where decada is not null loop
    v_nombre := 'decada-' || r.decada::text || 's';
    select id into v_id from etiqueta where nombre = v_nombre;
    if v_id is null then v_id := gen_random_uuid()::text;
      insert into etiqueta (id, nombre, taxonomia, origen) values (v_id, v_nombre, 'meta', 'ia'); v_tags := v_tags + 1; end if;
    select count(*) into v_before from obra_etiqueta where etiqueta_id = v_id;
    insert into obra_etiqueta (obra_id, etiqueta_id) select id, v_id from obra where decada = r.decada on conflict do nothing;
    select count(*) into v_after from obra_etiqueta where etiqueta_id = v_id;
    v_links := v_links + (v_after - v_before);
  end loop;
  for r in select distinct idioma_original as v from obra where idioma_original is not null loop
    v_nombre := 'idioma-' || lower(regexp_replace(r.v, '[^a-zA-Z0-9]+', '-', 'g'));
    select id into v_id from etiqueta where nombre = v_nombre;
    if v_id is null then v_id := gen_random_uuid()::text;
      insert into etiqueta (id, nombre, taxonomia, origen) values (v_id, v_nombre, 'meta', 'ia'); v_tags := v_tags + 1; end if;
    select count(*) into v_before from obra_etiqueta where etiqueta_id = v_id;
    insert into obra_etiqueta (obra_id, etiqueta_id) select id, v_id from obra where idioma_original = r.v on conflict do nothing;
    select count(*) into v_after from obra_etiqueta where etiqueta_id = v_id;
    v_links := v_links + (v_after - v_before);
  end loop;
  return jsonb_build_object('tags', v_tags, 'links', v_links, 'rule', 'R1');
end;
$$;

-- ── ESTADÍSTICAS (pantalla 06): agregados server-side en UNA llamada ────────────────────────
-- Calcula TODO lo de la pantalla de Estadísticas en el servidor (rápido, un round-trip) sobre los
-- 4.079 entradas / 4.241 obras. Reusa la MISMA entropía de Shannon normalizada verificada en el
-- re-diagnóstico (D = 100·H/ln k, n = obras distintas por categoría de la dimensión). Índice =
-- 3 dimensiones reales (década·género·creador); país/idioma FUERA por decisión D-MET-03. Solo
-- lectura. SECURITY INVOKER + STABLE → la RLS aplica y el Advisor NO la marca (no es DEFINER).
create or replace function ocio_stats()
  returns jsonb language plpgsql security invoker stable set search_path = public
as $$
declare v_dec numeric; v_gen numeric; v_cre numeric;
begin
  with d as (select count(*)::numeric n from obra where decada is not null group by decada),
       t as (select sum(n) nn, count(*)::numeric k from d)
  select case when t.k>1 then 100*(-sum((d.n/t.nn)*ln(d.n/t.nn)))/ln(t.k) else 0 end
    into v_dec from d cross join t group by t.k, t.nn;
  with d as (select count(distinct oe.obra_id)::numeric n from obra_etiqueta oe
               join etiqueta et on et.id=oe.etiqueta_id where et.taxonomia='genero' group by oe.etiqueta_id),
       t as (select sum(n) nn, count(*)::numeric k from d)
  select case when t.k>1 then 100*(-sum((d.n/t.nn)*ln(d.n/t.nn)))/ln(t.k) else 0 end
    into v_gen from d cross join t group by t.k, t.nn;
  with d as (select count(distinct obra_id)::numeric n from obra_creador group by persona_id),
       t as (select sum(n) nn, count(*)::numeric k from d)
  select case when t.k>1 then 100*(-sum((d.n/t.nn)*ln(d.n/t.nn)))/ln(t.k) else 0 end
    into v_cre from d cross join t group by t.k, t.nn;

  return jsonb_build_object(
    'corpus', jsonb_build_object(
      'obras',     (select count(*) from obra),
      'entradas',  (select count(*) from entrada),
      'horas',     (select round(coalesce(sum(duracion_min),0)/60.0, 1) from entrada),
      'creadores', (select count(distinct persona_id) from obra_creador),
      'con_genero',(select count(distinct oe.obra_id) from obra_etiqueta oe join etiqueta et on et.id=oe.etiqueta_id where et.taxonomia='genero')),
    'diversidad', jsonb_build_object(
      'indice',    round((coalesce(v_dec,0)+coalesce(v_gen,0)+coalesce(v_cre,0))/3, 2),
      'd_decada',  round(coalesce(v_dec,0), 2),
      'd_genero',  round(coalesce(v_gen,0), 2),
      'd_creador', round(coalesce(v_cre,0), 2)),
    'tiempo', (select coalesce(jsonb_agg(jsonb_build_object('categoria',categoria,'obras',obras,'horas',horas,'entradas',entradas) order by horas desc),'[]'::jsonb)
      from (select o.categoria, count(distinct o.id)::int obras,
                   round(coalesce(sum(e.duracion_min),0)/60.0,1) horas, count(e.id)::int entradas
            from obra o left join entrada e on e.obra_id=o.id group by o.categoria) tc),
    'generos', (select coalesce(jsonb_agg(jsonb_build_object('nombre',nombre,'n',n,'origen',origen) order by n desc),'[]'::jsonb)
      from (select et.nombre, et.origen, count(distinct oe.obra_id)::int n
            from obra_etiqueta oe join etiqueta et on et.id=oe.etiqueta_id where et.taxonomia='genero'
            group by et.nombre, et.origen) g),
    'decadas', (select coalesce(jsonb_agg(jsonb_build_object('decada',decada,'n',n,'cine',cine,'vj',vj) order by decada),'[]'::jsonb)
      from (select decada, count(*)::int n, count(*) filter (where categoria in ('pelicula','serie'))::int cine,
                   count(*) filter (where categoria='videojuego')::int vj
            from obra where decada is not null group by decada) dd),
    'creadores_top', (select coalesce(jsonb_agg(jsonb_build_object('nombre',nombre,'n',n) order by n desc),'[]'::jsonb)
      from (select p.nombre, count(distinct oc.obra_id)::int n from obra_creador oc join persona p on p.id=oc.persona_id
            group by p.nombre order by count(distinct oc.obra_id) desc, p.nombre limit 15) ct),
    'valoraciones', jsonb_build_object(
      'media',     (select round(avg(valoracion)::numeric,2) from entrada where valoracion is not null),
      'puntuadas', (select count(*) from entrada where valoracion is not null),
      'total',     (select count(*) from entrada),
      'sin_nota',  (select count(*) from entrada where valoracion is null),
      'sin_nota_vj',(select count(*) from entrada e join obra o on o.id=e.obra_id where e.valoracion is null and o.categoria='videojuego'),
      'histograma',(select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket,'n',n) order by bucket),'[]'::jsonb)
        from (select floor(valoracion)::int bucket, count(*)::int n from entrada where valoracion is not null group by 1) vh)));
end;
$$;

-- ── HALL OF FAME (03) + HALL OF SHAME (09): el panteón y su reverso, en UNA RPC ─────────────
-- Pareja: Fame usa el top por nota, Shame el bottom. Decisiones (documentadas, mismas en ambas):
--  1. nota_obra = round(avg(valoraciones NO nulas de la obra), 1). Una obra entra si tiene ≥1 nota.
--  2. Banner % valoradas = entradas con valoracion / TOTAL de entradas (denominador = TODAS las
--     categorías, no solo las 5 rankeables) → coincide con el 4.079 del diseño.
--  3. Cumbre/Sima absolutas (sobre las 5 categorías rankeables); empate → nota más extrema y, de
--     desempate, ENTRADA más reciente (ult desc), luego id. empate_top/empate_bot = obras a esa nota.
--  4. Videojuego en Shame = "pending" mientras los juegos valorados no sean representativos (el
--     cliente decide con vj.rated/vj.total); NO se inventa un fondo con pocos juegos puntuados.
--  5. Todo cuenta EN VIVO (se mueve al puntuar). SECURITY INVOKER + STABLE, solo lectura.
create or replace function ocio_hall()
  returns jsonb language sql security invoker stable set search_path = public
as $$
with notas as (
  select o.id, o.titulo, o.categoria, o.anio_obra,
         round(avg(e.valoracion)::numeric, 1) as nota,
         max(e.fecha) as ult,
         max(extract(year from e.fecha))::int as vista,
         (array_agg(nullif(btrim(e.nota), '') order by e.fecha desc nulls last)
            filter (where nullif(btrim(e.nota), '') is not null))[1] as quote
  from obra o
  join entrada e on e.obra_id = o.id
  where e.valoracion is not null
    and o.categoria in ('pelicula','serie','libro','videojuego','comic')
  group by o.id, o.titulo, o.categoria, o.anio_obra
),
rt as (
  select n.*, row_number() over (partition by categoria order by nota desc, ult desc nulls last, id) rk,
         count(*) filter (where nota >= 9) over (partition by categoria) cat9
  from notas n
),
rb as (
  select n.*, row_number() over (partition by categoria order by nota asc, ult desc nulls last, id) rk,
         count(*) filter (where nota < 4) over (partition by categoria) catlow
  from notas n
)
select jsonb_build_object(
  'banner', jsonb_build_object(
     'total',     (select count(*) from entrada),
     'valoradas', (select count(*) from entrada where valoracion is not null)),
  'vj', jsonb_build_object(
     'total',       (select count(*) from entrada e join obra o on o.id=e.obra_id where o.categoria='videojuego'),
     'rated',       (select count(*) from entrada e join obra o on o.id=e.obra_id where o.categoria='videojuego' and e.valoracion is not null),
     'sin_valorar', (select count(*) from entrada e join obra o on o.id=e.obra_id where o.categoria='videojuego' and e.valoracion is null)),
  'cumbre', (select jsonb_build_object('titulo',titulo,'categoria',categoria,'nota',nota,'anio',anio_obra,
               'vista',vista,'inicial',upper(left(titulo,1)),'quote',quote)
             from notas order by nota desc, ult desc nulls last, id limit 1),
  'sima', (select jsonb_build_object('titulo',titulo,'categoria',categoria,'nota',nota,'anio',anio_obra,
               'vista',vista,'inicial',upper(left(titulo,1)),'quote',quote)
             from notas order by nota asc, ult desc nulls last, id limit 1),
  'fame', jsonb_build_object(
     'obras_de_10', (select count(*) from notas where nota >= 10),
     'obras_9plus', (select count(*) from notas where nota >= 9),
     'media_top',   (select round(avg(nota), 1) from notas where nota >= 9),
     'empate_top',  (select count(*) from notas where nota = (select max(nota) from notas))),
  'shame', jsonb_build_object(
     'obras_bajo_3', (select count(*) from notas where nota < 3),
     'obras_bajo_4', (select count(*) from notas where nota < 4),
     'media_fondo',  (select round(avg(nota), 1) from notas where nota < 4),
     'empate_bot',   (select count(*) from notas where nota = (select min(nota) from notas))),
  'top_rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'categoria',categoria,'titulo',titulo,'nota',nota,'anio',anio_obra,'vista',vista,
        'inicial',upper(left(titulo,1)),'quote',quote,'rk',rk,'tail',cat9) order by categoria, rk), '[]'::jsonb)
     from rt where rk <= 3),
  'bottom_rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'categoria',categoria,'titulo',titulo,'nota',nota,'anio',anio_obra,'vista',vista,
        'inicial',upper(left(titulo,1)),'quote',quote,'rk',rk,'tail',catlow) order by categoria, rk), '[]'::jsonb)
     from rb where rk <= 3));
$$;

-- ── PROGRESIÓN RPG (EXP/Nivel/Clase/Antigüedad/Racha/Momentos-canon) para el Perfil ─────────
-- TODO se deriva de datos que YA existen (entradas, obras, categorías, fechas, valoraciones,
-- logros). Nada estimado. EXP=100/entrada + Σ logro.exp desbloqueados. Nivel: req(L)=round(50·L^1.5)
-- (la MISMA curva que MET_NIVEL del compilador). Clase: doble lente por OBRA (medida principal) y
-- por HORAS. Racha: máx. días consecutivos (imprecisa por fechas FA → la UI lo advierte). Momentos
-- canon AUTO: obras redondas (1.000/2.000/…), día cumbre, primera de cada categoría, primer 10.
-- SECURITY INVOKER + STABLE, solo lectura.
create or replace function ocio_progresion()
  returns jsonb language plpgsql security invoker stable set search_path = public
as $$
declare
  v_ent int; v_logro_exp int; v_exp bigint;
  v_nivel int; v_e_nivel numeric; v_e_next numeric; v_prog numeric;
  v_obra jsonb; v_horas jsonb; v_auto jsonb;
  v_min date; v_span int; v_racha int; v_canon int; v_dest int;
begin
  select count(*) into v_ent from entrada;
  select coalesce(sum(l.exp), 0) into v_logro_exp from logro l join logro_desbloqueado ld on ld.logro_id = l.id;
  v_exp := 100::bigint * v_ent + v_logro_exp;

  with recursive lv(l, e) as (
      select 1, 0.0 union all select l + 1, e + round(50 * power(l, 1.5)) from lv where l < 300),
  pick as (select l, e, lead(e) over (order by l) e_next from lv)
  select l, e, e_next into v_nivel, v_e_nivel, v_e_next from pick where e <= v_exp order by l desc limit 1;
  v_prog := case when v_e_next > v_e_nivel then round((v_exp - v_e_nivel) / (v_e_next - v_e_nivel), 3) else 0 end;

  select jsonb_agg(jsonb_build_object('categoria', categoria, 'arquetipo', arq, 'n', n, 'pct', pct) order by n desc)
    into v_obra from (
      select categoria, count(*)::int n, round(100.0 * count(*) / sum(count(*)) over (), 1) pct,
        case categoria when 'pelicula' then 'Cinéfilo' when 'videojuego' then 'Jugador' when 'serie' then 'Seriéfilo'
          when 'libro' then 'Lector' when 'comic' then 'Viñetista' when 'ocio_libre' then 'Explorador' else categoria end arq
      from obra group by categoria) zo;
  select jsonb_agg(jsonb_build_object('categoria', categoria, 'arquetipo', arq, 'horas', horas, 'pct', pct) order by horas desc)
    into v_horas from (
      select o.categoria, round(coalesce(sum(e.duracion_min), 0) / 60.0)::int horas,
        round(100.0 * coalesce(sum(e.duracion_min), 0) / nullif(sum(sum(e.duracion_min)) over (), 0), 1) pct,
        case o.categoria when 'pelicula' then 'Cinéfilo' when 'videojuego' then 'Jugador' when 'serie' then 'Seriéfilo'
          when 'libro' then 'Lector' when 'comic' then 'Viñetista' when 'ocio_libre' then 'Explorador' else o.categoria end arq
      from obra o join entrada e on e.obra_id = o.id group by o.categoria
      having coalesce(sum(e.duracion_min), 0) > 0) zh;

  select min(fecha), (extract(year from max(fecha)) - extract(year from min(fecha)) + 1)::int
    into v_min, v_span from entrada where fecha is not null;

  select coalesce(max(c), 0) into v_racha from (
    select count(*) c from (
      select dn - row_number() over (order by dn) grp from (
        select distinct (fecha::date - date '2000-01-01') dn from entrada where fecha is not null) d) g group by grp) r;

  select count(*), count(*) filter (where destacado = 1) into v_canon, v_dest from momento_canon;

  with obra_first as (select obra_id, min(fecha) f from entrada where fecha is not null group by obra_id),
       ranked as (select o.titulo, o.categoria, ofr.f, row_number() over (order by ofr.f, o.id) rn
                  from obra_first ofr join obra o on o.id = ofr.obra_id)
  select
    coalesce((select jsonb_agg(jsonb_build_object('tipo','obra_redonda','n',rn,'titulo',titulo,'fecha',f) order by rn)
              from ranked where rn in (1000,2000,3000,4000)), '[]'::jsonb)
    || coalesce((select jsonb_build_array(jsonb_build_object('tipo','dia_cumbre','fecha',fecha,'n',c))
                 from (select fecha, count(*) c from entrada where fecha is not null group by fecha order by c desc, fecha limit 1) zd), '[]'::jsonb)
    || coalesce((select jsonb_agg(jsonb_build_object('tipo','primera_categoria','categoria',categoria,'titulo',titulo,'fecha',f) order by f)
                 from (select distinct on (categoria) categoria, titulo, f from ranked order by categoria, f, rn) zp), '[]'::jsonb)
    || coalesce((select jsonb_build_array(jsonb_build_object('tipo','primer_diez','titulo',o.titulo,'fecha',e.fecha))
                 from entrada e join obra o on o.id = e.obra_id where e.valoracion = 10 and e.fecha is not null order by e.fecha, e.id limit 1), '[]'::jsonb)
    into v_auto;

  return jsonb_build_object(
    'exp', jsonb_build_object('total', v_exp, 'base', 100::bigint * v_ent, 'logros', v_logro_exp, 'por_entrada', 100),
    'nivel', jsonb_build_object('nivel', v_nivel, 'e_nivel', v_e_nivel, 'e_siguiente', v_e_next, 'progreso', v_prog),
    'clase', jsonb_build_object('por_obra', coalesce(v_obra, '[]'::jsonb), 'por_horas', coalesce(v_horas, '[]'::jsonb)),
    'antiguedad', jsonb_build_object('desde', v_min, 'anios', v_span),
    'racha', jsonb_build_object('maxima', v_racha),
    'canon', jsonb_build_object('manual', v_canon, 'destacados', v_dest, 'auto', coalesce(v_auto, '[]'::jsonb)));
end;
$$;

-- Marca/desmarca una entrada como MOMENTO CANON (curación manual). Idempotente. La marca se persiste
-- (a diferencia de los auto-detectados, que se derivan al vuelo). SECURITY INVOKER (RLS por owner_id,
-- no DEFINER), authenticated-only.
create or replace function ocio_set_canon(p_entrada_id text, p_on boolean, p_titulo text default null, p_por_que text default null)
  returns jsonb language plpgsql security invoker set search_path = public
as $$
declare v_obra text; v_existing text; v_tit text;
begin
  select obra_id into v_obra from entrada where id = p_entrada_id;     -- RLS: solo lo del dueño
  if v_obra is null then return jsonb_build_object('ok', false); end if;
  select id into v_existing from momento_canon where entrada_id = p_entrada_id;
  if p_on then
    v_tit := coalesce(nullif(btrim(p_titulo), ''), (select titulo from obra where id = v_obra));
    if v_existing is null then
      insert into momento_canon (id, entrada_id, titulo, por_que_importa, destacado)
        values (gen_random_uuid()::text, p_entrada_id, v_tit, nullif(btrim(p_por_que), ''), 1);
    else
      update momento_canon set titulo = v_tit, por_que_importa = nullif(btrim(p_por_que), ''), destacado = 1 where id = v_existing;
    end if;
  else
    delete from momento_canon where entrada_id = p_entrada_id;
  end if;
  return jsonb_build_object('ok', true, 'canon', p_on);
end;
$$;

-- ── HOME / DASHBOARD (01): el aterrizaje, en UNA RPC ────────────────────────────────────────
-- Síntesis + puertas. REUTILIZA las RPCs existentes (no recalcula): llama por dentro a
-- ocio_progresion()/ocio_hall()/ocio_stats() y extrae SOLO los slivers (nivel/clase, cumbre,
-- diversidad/obras) → los números de Home son LITERALMENTE los mismos que Perfil/Hall/Estadísticas
-- (coherencia garantizada, no pueden divergir) + 2 consultas ligeras (recién desbloqueado del
-- ledger CON fecha real, últimas entradas por fecha de REGISTRO creado_en). 1 round-trip. Como
-- INVOKER, las RPCs internas también corren como el usuario (RLS). Solo lectura.
create or replace function ocio_home()
  returns jsonb language plpgsql security invoker stable set search_path = public
as $$
declare v_prog jsonb; v_hall jsonb; v_stats jsonb; v_tit jsonb; v_tit_id text; v_tit_nom text; v_rec jsonb; v_ult jsonb;
begin
  v_prog := ocio_progresion();
  v_hall := ocio_hall();
  v_stats := ocio_stats();
  select titulo_activo_id into v_tit_id from perfil_usuario where id = 1;
  if v_tit_id is not null then
    select nombre into v_tit_nom from titulo where id = v_tit_id;
    v_tit := jsonb_build_object('id', v_tit_id, 'nombre', v_tit_nom);
  end if;
  -- logro/título más reciente CON fecha real (el ledger; los retro-enriquecidos sin fecha no cuentan)
  select to_jsonb(r) into v_rec from (
    select tipo, nombre, rareza, fecha from (
      select 'logro' tipo, l.nombre, l.rareza, ld.fecha from logro_desbloqueado ld join logro l on l.id = ld.logro_id where ld.fecha is not null
      union all
      select 'titulo' tipo, t.nombre, t.rareza, td.fecha from titulo_desbloqueado td join titulo t on t.id = td.titulo_id where td.fecha is not null
    ) z order by fecha desc, nombre limit 1
  ) r;
  -- últimas entradas por fecha de REGISTRO (creado_en), con nombre/categoría/nota/fecha de consumo
  select coalesce(jsonb_agg(to_jsonb(u) order by u.creado_en desc), '[]'::jsonb) into v_ult from (
    select e.id, o.id obra_id, o.titulo, o.categoria, e.valoracion, e.fecha, e.estado, e.creado_en
    from entrada e join obra o on o.id = e.obra_id
    order by e.creado_en desc, e.id limit 5
  ) u;
  return jsonb_build_object(
    'progresion', v_prog,
    'cumbre', v_hall->'cumbre',
    'cumbre_empate', v_hall->'fame'->'empate_top',
    'diversidad', v_stats->'diversidad'->'indice',
    'obras', v_stats->'corpus'->'obras',
    'titulo', v_tit,
    'reciente', v_rec,
    'ultimas', v_ult);
end;
$$;

-- ── WRAPPED (05): el anuario que se SELLA. Eje = FECHA DE ENTRADA (como el Timeline) ────────
-- MECÁNICA DE SELLADO (derivada de la fecha, no hardcodeada): un año está SELLADO cuando ya
-- terminó (anio < extract(year from now())); el año natural actual está en ANTESALA. Un sellado
-- es FIJO en el sentido de que no cambia por el paso del tiempo (el año se acabó), pero se
-- RECALCULA de los datos actuales → refleja TODO lo que haya con fecha de entrada en ese año
-- (si añades una entrada retroactiva a un año cerrado, aparece). No es un snapshot congelado.
-- HONESTIDAD: el archivo mezcla consumo en vivo con votos FA retroactivos → "año de ACTIVIDAD
-- (registro + consumo)", nunca "esto viviste". Solo lectura. SECURITY INVOKER + STABLE.

-- Lista de años (antesala + sellados) para el Archivo + el teaser del año en curso.
create or replace function ocio_wrapped_years()
  returns jsonb language plpgsql security invoker stable set search_path = public
as $$
declare v_actual int := extract(year from now())::int; v_years jsonb; v_antesala jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('anio', y, 'obras', obras, 'entradas', ents,
           'sellado', y < v_actual) order by y desc), '[]'::jsonb) into v_years
    from (select extract(year from fecha)::int y, count(distinct obra_id)::int obras, count(*)::int ents
          from entrada where fecha is not null group by 1) z;
  v_antesala := jsonb_build_object(
    'anio', v_actual,
    'obras', (select count(distinct obra_id) from entrada where extract(year from fecha) = v_actual),
    'dias_para_sellar', greatest(0, make_date(v_actual, 12, 31) - current_date),
    'mezcla', (select coalesce(jsonb_agg(jsonb_build_object('categoria', categoria, 'obras', n) order by n desc), '[]'::jsonb)
               from (select o.categoria, count(distinct o.id)::int n from obra o join entrada e on e.obra_id = o.id
                     where extract(year from e.fecha) = v_actual group by o.categoria) m));
  return jsonb_build_object('actual', v_actual, 'years', v_years, 'antesala', v_antesala);
end;
$$;

-- El anuario completo de UN año (las 7 stories). Reusa la lógica de nota_obra de ocio_hall
-- (avg de valoraciones de la obra) y de creador/género de ocio_stats, FILTRADA por año de entrada.
create or replace function ocio_wrapped(p_year integer)
  returns jsonb language plpgsql security invoker stable set search_path = public
as $$
declare v_vol jsonb; v_cumbre jsonb; v_max numeric; v_emp int; v_gen jsonb; v_gendist int;
        v_pers jsonb; v_histo jsonb; v_mesc jsonb; v_tot int; v_meses int;
begin
  select coalesce(jsonb_agg(jsonb_build_object('categoria', categoria, 'obras', n) order by n desc), '[]'::jsonb),
         coalesce(sum(n), 0)::int into v_vol, v_tot
    from (select o.categoria, count(distinct o.id)::int n from obra o join entrada e on e.obra_id = o.id
          where extract(year from e.fecha) = p_year group by o.categoria) z;
  select count(distinct extract(month from fecha))::int into v_meses from entrada where extract(year from fecha) = p_year;

  -- cumbre del año: mejor nota_obra (avg, como ocio_hall) entre obras con ENTRADA en el año.
  with wn as (
    select o.id, o.titulo, o.categoria, round(avg(e.valoracion)::numeric, 1) nota, max(e.fecha) ult
    from obra o join entrada e on e.obra_id = o.id
    where o.id in (select distinct obra_id from entrada where extract(year from fecha) = p_year)
      and e.valoracion is not null group by o.id)
  select jsonb_build_object('titulo', titulo, 'categoria', categoria, 'inicial', upper(left(titulo, 1)), 'nota', nota), nota
    into v_cumbre, v_max from wn order by nota desc nulls last, ult desc nulls last, id limit 1;
  with wn as (
    select o.id, round(avg(e.valoracion)::numeric, 1) nota from obra o join entrada e on e.obra_id = o.id
    where o.id in (select distinct obra_id from entrada where extract(year from fecha) = p_year)
      and e.valoracion is not null group by o.id)
  select count(*)::int into v_emp from wn where nota = v_max;

  select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'n', n) order by n desc), '[]'::jsonb) into v_gen from (
    select et.nombre, count(distinct oe.obra_id)::int n from obra_etiqueta oe join etiqueta et on et.id = oe.etiqueta_id
    where et.taxonomia = 'genero' and oe.obra_id in (select distinct obra_id from entrada where extract(year from fecha) = p_year)
    group by et.nombre order by n desc limit 6) z;
  select count(distinct et.id)::int into v_gendist from obra_etiqueta oe join etiqueta et on et.id = oe.etiqueta_id
    where et.taxonomia = 'genero' and oe.obra_id in (select distinct obra_id from entrada where extract(year from fecha) = p_year);

  select jsonb_build_object('nombre', nombre, 'inicial', upper(left(nombre, 1)), 'n', n) into v_pers from (
    select p.nombre, count(distinct oc.obra_id)::int n from obra_creador oc join persona p on p.id = oc.persona_id
    where oc.obra_id in (select distinct obra_id from entrada where extract(year from fecha) = p_year)
    group by p.nombre order by n desc, p.nombre limit 1) z;

  select coalesce(jsonb_agg(jsonb_build_object('mes', m, 'n', n) order by m), '[]'::jsonb) into v_histo from (
    select g.m, coalesce(c.c, 0)::int n from generate_series(1, 12) g(m)
    left join (select extract(month from fecha)::int mm, count(*) c from entrada where extract(year from fecha) = p_year group by 1) c on c.mm = g.m) z;
  select jsonb_build_object('mes', mm, 'n', c) into v_mesc from (
    select extract(month from fecha)::int mm, count(*)::int c from entrada where extract(year from fecha) = p_year group by 1 order by c desc, mm limit 1) z;

  return jsonb_build_object(
    'anio', p_year, 'total_obras', v_tot, 'meses_activos', v_meses,
    'volumen', v_vol, 'cumbre', v_cumbre, 'empate', v_emp, 'nota_max', v_max,
    'generos', v_gen, 'generos_distintos', v_gendist, 'personaje', v_pers,
    'mes_cumbre', v_mesc, 'histograma', v_histo, 'sellado_el', make_date(p_year, 12, 31));
end;
$$;

-- ── TIMELINE (pantalla 04): macro por AÑO DE ENTRADA + detalle por año bajo demanda ─────────
-- CRÍTICO: el eje es la FECHA DE LA ENTRADA (cuándo se vivió), NO anio_obra (año de estreno).
-- Una peli de 1958 vista en 2010 cae en 2010. Macro = volumen+mezcla por año (rápido); el
-- detalle de un año se pide al seleccionarlo. Solo lectura. SECURITY INVOKER + STABLE.
create or replace function ocio_timeline_macro()
  returns jsonb language sql security invoker stable set search_path = public
as $$
  select jsonb_build_object(
    'total',     (select count(*) from entrada),
    'sin_fecha', (select count(*) from entrada where fecha is null),
    'rango', (select jsonb_build_object('min', extract(year from min(fecha))::int,
                                        'max', extract(year from max(fecha))::int)
              from entrada where fecha is not null),
    'anios', (select coalesce(jsonb_agg(jsonb_build_object(
        'anio', y, 'total', tot, 'cine', cine, 'serie', serie, 'vj', vj,
        'libro', libro, 'comic', comic, 'ocio', ocio) order by y), '[]'::jsonb)
      from (
        select extract(year from e.fecha)::int y, count(*)::int tot,
               count(*) filter (where o.categoria='pelicula')::int cine,
               count(*) filter (where o.categoria='serie')::int serie,
               count(*) filter (where o.categoria='videojuego')::int vj,
               count(*) filter (where o.categoria='libro')::int libro,
               count(*) filter (where o.categoria='comic')::int comic,
               count(*) filter (where o.categoria='ocio_libre')::int ocio
        from entrada e join obra o on o.id=e.obra_id
        where e.fecha is not null group by 1) yy));
$$;

-- Detalle de un año: sus entradas (por fecha de entrada), con obra+categoría+anio_obra+fecha_tipo.
-- El cliente agrupa por mes y agrupa los 'fecha_voto' (votaciones masivas de FA) en clúster.
create or replace function ocio_timeline_year(p_year integer)
  returns jsonb language sql security invoker stable set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'fecha', e.fecha, 'mes', extract(month from e.fecha)::int,
      'valoracion', e.valoracion, 'fecha_tipo', e.metadata->>'fecha_tipo',
      'titulo', o.titulo, 'categoria', o.categoria, 'anio_obra', o.anio_obra) order by e.fecha desc, e.id), '[]'::jsonb)
  from entrada e join obra o on o.id=e.obra_id
  where e.fecha >= make_date(p_year,1,1) and e.fecha < make_date(p_year+1,1,1);
$$;

-- ── LOGROS (sistema RPG): evaluación EN VIVO con el COMPILADOR conservado ────────────────────
-- Mismo patrón que ocio_materialize_collection: el COMPILADOR corre en el navegador (compileCondition
-- → booleano, compileMeasure → escalar de progreso), su SQL llega aquí y se ejecuta server-side. NO
-- hay segunda forma de evaluar. Defensas idénticas: SECURITY INVOKER (RLS aplica, no DEFINER → el
-- Advisor no lo marca), una sola sentencia, sin DML, forma EXACTA esperada, y los $n se sustituyen
-- como literales SEGUROS (números/bool tal cual, texto con quote_literal). SOLO LECTURA.
create or replace function ocio_eval_sql(p_sql text, p_params jsonb, p_kind text)
  returns numeric language plpgsql security invoker stable set search_path = public
as $$
declare v_sql text := p_sql; v_i int; v_el jsonb; v_lit text; v_res numeric;
begin
  -- forma permitida por tipo: lo ÚNICO que el evaluador ejecuta (lo que emite el compilador).
  if p_kind = 'bool' then
    if v_sql !~ '^\s*SELECT \(CASE WHEN .* THEN 1 ELSE 0 END\) AS ok\s*$' then raise exception 'forma bool no permitida'; end if;
  elsif p_kind = 'scalar' then
    if v_sql !~ '^\s*SELECT .* AS v\s*$' then raise exception 'forma scalar no permitida'; end if;
  else
    raise exception 'kind no permitido: %', p_kind;
  end if;
  if position(';' in v_sql) > 0 then raise exception 'multi-statement no permitido'; end if;
  if v_sql ~* '\m(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|merge|call|do)\M' then
    raise exception 'palabra no permitida en la consulta';
  end if;
  if jsonb_typeof(p_params) = 'array' then       -- sustituir $1..$n (reverso: $10 antes que $1)
    for v_i in reverse jsonb_array_length(p_params) - 1 .. 0 loop
      v_el := p_params -> v_i;
      if v_el is null or jsonb_typeof(v_el) = 'null' then v_lit := 'NULL';
      elsif jsonb_typeof(v_el) in ('number','boolean') then v_lit := (v_el #>> '{}');
      else v_lit := quote_literal(v_el #>> '{}'); end if;
      v_sql := replace(v_sql, '$' || (v_i + 1)::text, v_lit);
    end loop;
  end if;
  execute v_sql into v_res;       -- read-only: la whitelist de forma + sin-DML lo garantiza
  return v_res;
end;
$$;

-- Evalúa un LOTE de logros/títulos en una llamada (dinámico, un round-trip). Por ítem: el booleano
-- (desbloqueado 0/1) + las medidas de progreso (valores escalares). El cliente combina valor/umbral.
create or replace function ocio_evaluate_logros(p_items jsonb)
  returns jsonb language plpgsql security invoker stable set search_path = public
as $$
declare v_out jsonb := '[]'::jsonb; it jsonb; m jsonb; v_ok numeric; v_vals jsonb; v_v numeric;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception 'p_items debe ser un array'; end if;
  for it in select value from jsonb_array_elements(p_items) loop
    v_ok := ocio_eval_sql(it->'bool'->>'sql', it->'bool'->'params', 'bool');
    v_vals := '[]'::jsonb;
    if jsonb_typeof(it->'measures') = 'array' then
      for m in select value from jsonb_array_elements(it->'measures') loop
        v_v := ocio_eval_sql(m->>'sql', m->'params', 'scalar');
        v_vals := v_vals || to_jsonb(v_v);
      end loop;
    end if;
    v_out := v_out || jsonb_build_object('id', it->>'id', 'ok', coalesce(v_ok, 0)::int, 'valores', v_vals);
  end loop;
  return v_out;
end;
$$;

-- Registrar el DESBLOQUEO de un logro/título (going-forward). Idempotente (uno por definición):
-- si ya hay registro no hace nada. p_fecha = el día real del desbloqueo (HOY cuando ocurre durante
-- el uso; el momento es genuino), o NULL si no se conoce. El BASELINE histórico (los ya cumplidos
-- al construir el sistema) lo siembra el script admin con las fechas RECONSTRUIBLES; esto cubre los
-- nuevos. SECURITY INVOKER (RLS, no DEFINER), authenticated-only.
create or replace function ocio_record_unlock(p_kind text, p_def_id text, p_fecha date default null)
  returns jsonb language plpgsql security invoker set search_path = public
as $$
declare v_new boolean := false;
begin
  if p_kind = 'logro' then
    if not exists (select 1 from logro_desbloqueado where logro_id = p_def_id) then
      insert into logro_desbloqueado (id, logro_id, fecha) values (gen_random_uuid()::text, p_def_id, p_fecha);
      v_new := true;
    end if;
  elsif p_kind = 'titulo' then
    if not exists (select 1 from titulo_desbloqueado where titulo_id = p_def_id) then
      insert into titulo_desbloqueado (id, titulo_id, fecha) values (gen_random_uuid()::text, p_def_id, p_fecha);
      v_new := true;
    end if;
  else
    raise exception 'kind no permitido: %', p_kind;
  end if;
  return jsonb_build_object('recorded', v_new, 'kind', p_kind, 'id', p_def_id);
end;
$$;

-- Equipar el TÍTULO ACTIVO del perfil (pantalla Perfil). Valida que esté DESBLOQUEADO (o NULL para
-- quitarlo). Upsert de perfil_usuario (fila única id=1). SECURITY INVOKER (RLS por owner_id, no
-- DEFINER), authenticated-only. Único punto de escritura del Perfil.
create or replace function ocio_set_titulo_activo(p_titulo_id text)
  returns jsonb language plpgsql security invoker set search_path = public
as $$
begin
  if p_titulo_id is not null and not exists (select 1 from titulo_desbloqueado where titulo_id = p_titulo_id) then
    raise exception 'El título no está desbloqueado: %', p_titulo_id;
  end if;
  update perfil_usuario set titulo_activo_id = p_titulo_id where id = 1;
  if not found then
    insert into perfil_usuario (id, titulo_activo_id) values (1, p_titulo_id);
  end if;
  return jsonb_build_object('titulo_activo_id', p_titulo_id);
end;
$$;

-- ── Permisos: solo el usuario autenticado; nunca anon/public ────────────────────────────────
revoke all on function ocio_set_titulo_activo(text) from public, anon;
grant  execute on function ocio_set_titulo_activo(text) to authenticated;
revoke all on function ocio_record_unlock(text, text, date) from public, anon;
grant  execute on function ocio_record_unlock(text, text, date) to authenticated;
revoke all on function ocio_eval_sql(text, jsonb, text)  from public, anon;
revoke all on function ocio_evaluate_logros(jsonb)       from public, anon;
grant  execute on function ocio_eval_sql(text, jsonb, text) to authenticated;
grant  execute on function ocio_evaluate_logros(jsonb)      to authenticated;
revoke all on function ocio_add_entry(jsonb)        from public, anon;
revoke all on function ocio_delete_entry(text)      from public, anon;
revoke all on function ocio_update_entry(text, double precision, text, date, integer) from public, anon;
revoke all on function ocio_counts()                from public, anon;
revoke all on function ocio_filter_options()        from public, anon;
revoke all on function ocio_create_collection(jsonb) from public, anon;
revoke all on function ocio_materialize_collection(text, text, jsonb) from public, anon;
revoke all on function ocio_apply_r1()              from public, anon;
revoke all on function ocio_stats()                 from public, anon;
revoke all on function ocio_hall()                  from public, anon;
revoke all on function ocio_home()                  from public, anon;
revoke all on function ocio_wrapped_years()         from public, anon;
revoke all on function ocio_wrapped(integer)        from public, anon;
revoke all on function ocio_progresion()            from public, anon;
revoke all on function ocio_set_canon(text, boolean, text, text) from public, anon;
revoke all on function ocio_timeline_macro()        from public, anon;
revoke all on function ocio_timeline_year(integer)  from public, anon;
grant  execute on function ocio_add_entry(jsonb)    to authenticated;
grant  execute on function ocio_delete_entry(text)  to authenticated;
grant  execute on function ocio_update_entry(text, double precision, text, date, integer) to authenticated;
grant  execute on function ocio_counts()            to authenticated;
grant  execute on function ocio_filter_options()    to authenticated;
grant  execute on function ocio_create_collection(jsonb) to authenticated;
grant  execute on function ocio_materialize_collection(text, text, jsonb) to authenticated;
grant  execute on function ocio_apply_r1()          to authenticated;
grant  execute on function ocio_stats()             to authenticated;
grant  execute on function ocio_hall()              to authenticated;
grant  execute on function ocio_home()              to authenticated;
grant  execute on function ocio_wrapped_years()     to authenticated;
grant  execute on function ocio_wrapped(integer)    to authenticated;
grant  execute on function ocio_progresion()        to authenticated;
grant  execute on function ocio_set_canon(text, boolean, text, text) to authenticated;
grant  execute on function ocio_timeline_macro()    to authenticated;
grant  execute on function ocio_timeline_year(integer) to authenticated;
