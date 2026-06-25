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

-- ── Permisos: solo el usuario autenticado; nunca anon/public ────────────────────────────────
revoke all on function ocio_add_entry(jsonb)        from public, anon;
revoke all on function ocio_delete_entry(text)      from public, anon;
revoke all on function ocio_update_entry(text, double precision, text, date, integer) from public, anon;
revoke all on function ocio_counts()                from public, anon;
revoke all on function ocio_filter_options()        from public, anon;
revoke all on function ocio_create_collection(jsonb) from public, anon;
revoke all on function ocio_materialize_collection(text, text, jsonb) from public, anon;
revoke all on function ocio_apply_r1()              from public, anon;
revoke all on function ocio_stats()                 from public, anon;
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
grant  execute on function ocio_timeline_macro()    to authenticated;
grant  execute on function ocio_timeline_year(integer) to authenticated;
