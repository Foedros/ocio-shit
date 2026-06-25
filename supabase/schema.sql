-- ════════════════════════════════════════════════════════════════════════════
-- Ocio Shit — Esquema PostgreSQL (Supabase) · Sprint A
-- Traslado de DIALECTO de esquema/schema.sql v2 (SQLite) → PostgreSQL.
-- Fuente del MODELO: docs/modelo-datos.md §6 (Fase 2). NINGUNA decisión del modelo
-- cambia aquí; solo el dialecto (tecnico.md §3.3). schema_version = 2.
--
-- Cambios mecánicos de dialecto (tecnico.md §3.3):
--   · metadata TEXT(JSON)         → jsonb (indexable; origen/fecha_tipo consultables con ->>)
--   · clave_dedup GENERATED STORED → coalesce(anio_obra::text,'')  (cast ::text explícito)
--   · es_reconsumo GENERATED VIRTUAL → STORED (Postgres no tiene virtuales; coste nulo)
--   · TIMESTAMP DEFAULT CURRENT_TIMESTAMP → timestamptz DEFAULT now() (+ trigger en UPDATE)
--   · REAL → double precision (CHECK 0–10 igual)
--   · índices, UNIQUE, CHECK/enums, tabla meta y perfil_usuario: idénticos
--
-- AÑADIDO para RLS (aditivo, tecnico.md §3.2.sec): owner_id uuid NOT NULL DEFAULT auth.uid()
-- en TODAS las tablas. App autenticada → el DEFAULT pone el uid del usuario; la carga inicial
-- (clave secret, local) fija owner_id EXPLÍCITO. La SEGURIDAD (ENABLE RLS + políticas) va en
-- supabase/rls.sql, que DEBE ejecutarse después de este fichero.
--
-- Gotcha de dialecto NO documentado, resuelto aquí: SQLite admite NULL en columnas de PK
-- compuesta; PostgreSQL NO. obra_creador.rol_credito (parte de la PK) pasa a
-- NOT NULL DEFAULT '' (los datos reales ya traen 'director'; 0 nulos — es blindaje).
-- ════════════════════════════════════════════════════════════════════════════

-- Trigger compartido: actualizado_en = now() en cada UPDATE (LWW, tecnico.md §3.5).
-- search_path fijo ('') — el Security Advisor marca funciones con search_path mutable; now()
-- vive en pg_catalog (siempre implícito) así que la función sigue resolviendo.
create or replace function set_actualizado_en() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

-- ── meta (versión de esquema) ───────────────────────────────────────────────
create table meta (
  clave     text primary key,
  valor     text not null,
  owner_id  uuid not null default auth.uid()
);

-- ── plataforma ──────────────────────────────────────────────────────────────
create table plataforma (
  id        text primary key,
  nombre    text not null,
  tipo      text check (tipo in ('streaming','tienda','dispositivo','sala','otro')),
  owner_id  uuid not null default auth.uid()
);

-- ── persona ─────────────────────────────────────────────────────────────────
create table persona (
  id        text primary key,
  nombre    text not null,
  rol       text check (rol in ('acompanante','creador','ambos')) default 'acompanante',
  owner_id  uuid not null default auth.uid()
);

-- ── etapa ───────────────────────────────────────────────────────────────────
create table etapa (
  id            text primary key,
  nombre        text not null,
  fecha_inicio  date not null,
  fecha_fin     date,
  descripcion   text,
  color         text,
  owner_id      uuid not null default auth.uid()
);

-- ── obra ────────────────────────────────────────────────────────────────────
create table obra (
  id                     text primary key,
  titulo                 text not null,
  categoria              text not null check (categoria in
                            ('pelicula','serie','libro','videojuego','comic','ocio_libre')),
  subtipo                text check (subtipo in
                            ('concierto','museo','viaje','evento','otro')),
  anio_obra              integer,
  decada                 integer,
  duracion_canonica_min  integer,
  idioma_original        text,
  pais_origen            text,
  creador                text,
  saga                   text,
  formato_habitual       text check (formato_habitual in
                            ('cine','streaming','fisico','papel','ebook','audiolibro',
                             'consola','pc','movil','otro')),
  portada_uri            text,
  fuente_externa         text,
  metadata               jsonb,
  clave_dedup            text generated always as (
                            lower(titulo) || '|' || categoria || '|' || coalesce(anio_obra::text, '')
                         ) stored,
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now(),
  owner_id               uuid not null default auth.uid()
);
create unique index uq_obra_clave_dedup on obra(clave_dedup);

-- ── entrada ─────────────────────────────────────────────────────────────────
create table entrada (
  id                  text primary key,
  obra_id             text not null references obra(id) on delete cascade,
  fecha               date,
  estado              text not null default 'terminado' check (estado in
                        ('pendiente','en_curso','terminado','abandonado')),
  duracion_min        integer,
  clase_tiempo        text not null default 'electivo' check (clase_tiempo in
                        ('electivo','habito')),
  num_reconsumo       integer not null default 0,
  es_reconsumo        integer generated always as (
                        case when num_reconsumo > 0 then 1 else 0 end
                      ) stored,
  valoracion          double precision check (valoracion >= 0 and valoracion <= 10),
  impacto_emocional   double precision check (impacto_emocional >= 0 and impacto_emocional <= 10),
  nota                text,
  plataforma_id       text references plataforma(id) on delete set null,
  ubicacion           text,
  estado_animo        text,
  etapa_id            text references etapa(id) on delete set null,
  metadata            jsonb,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),
  owner_id            uuid not null default auth.uid()
);

-- ── etiqueta ────────────────────────────────────────────────────────────────
create table etiqueta (
  id         text primary key,
  nombre     text not null unique,
  taxonomia  text check (taxonomia in ('genero','tema','tono','tecnica','meta')),
  -- 'steam'/'tmdb' = etiqueta de género de dato ESTRUCTURADO de la fuente (campo genres),
  -- no generada por IA. Aditivo (2026-06-25, enriquecimiento de metadatos videojuegos/cine).
  -- Taxonomía de géneros unificada en español (TMDB); los géneros de Steam se traducen a ella.
  origen     text not null default 'manual' check (origen in ('manual','ia','steam','tmdb')),
  color      text,
  owner_id   uuid not null default auth.uid()
);

-- ── coleccion ───────────────────────────────────────────────────────────────
create table coleccion (
  id           text primary key,
  nombre       text not null,
  descripcion  text,
  tipo         text not null check (tipo in ('manual','inteligente','ia')),
  regla_json   text,   -- JSON como TEXT (la app hace JSON.parse; no jsonb para no tocar la lógica)
  portada_uri  text,
  owner_id     uuid not null default auth.uid()
);

-- ── logro ───────────────────────────────────────────────────────────────────
create table logro (
  id             text primary key,
  nombre         text not null,
  descripcion    text,
  clase          text,
  rareza         text check (rareza in ('comun','raro','epico','legendario')),
  exp            integer not null default 0,
  condicion_json text,
  owner_id       uuid not null default auth.uid()
);

-- ── logro_desbloqueado ──────────────────────────────────────────────────────
-- fecha NULLABLE (2026-06-26): registra que un logro está desbloqueado + CUÁNDO, o NULL si el
-- momento no es reconstruible sin inventar (índice de entropía / ratio no monótonos; dimensiones
-- retro-enriquecidas). Decisión "datar solo lo reconstruible" (sistema de logros, §11.13).
create table logro_desbloqueado (
  id                 text primary key,
  logro_id           text not null references logro(id) on delete cascade,
  fecha              date,
  entrada_origen_id  text references entrada(id) on delete set null,
  owner_id           uuid not null default auth.uid()
);

-- ── momento_canon ───────────────────────────────────────────────────────────
create table momento_canon (
  id              text primary key,
  entrada_id      text not null references entrada(id) on delete cascade,
  titulo          text not null,
  por_que_importa text,
  fecha           date,
  destacado       integer not null default 0 check (destacado in (0,1)),
  owner_id        uuid not null default auth.uid()
);

-- ── titulo ──────────────────────────────────────────────────────────────────
create table titulo (
  id             text primary key,
  nombre         text not null,
  descripcion    text,
  rareza         text check (rareza in ('comun','raro','epico','legendario')),
  condicion_json text,
  owner_id       uuid not null default auth.uid()
);

-- ── titulo_desbloqueado ─────────────────────────────────────────────────────
-- fecha NULLABLE (2026-06-26): igual que logro_desbloqueado (§11.13). NULL = desbloqueado sin
-- fecha reconstruible.
create table titulo_desbloqueado (
  id        text primary key,
  titulo_id text not null references titulo(id) on delete cascade,
  fecha     date,
  owner_id  uuid not null default auth.uid()
);

-- ── perfil_usuario (fila única) ─────────────────────────────────────────────
create table perfil_usuario (
  id               integer primary key check (id = 1),
  exp_total        integer not null default 0,
  nivel            integer not null default 1,
  titulo_activo_id text references titulo(id) on delete set null,
  racha_dias       integer not null default 0,
  owner_id         uuid not null default auth.uid()
);

-- ── relaciones N:M (todas con owner_id + RLS) ───────────────────────────────
create table obra_etiqueta (
  obra_id     text not null references obra(id) on delete cascade,
  etiqueta_id text not null references etiqueta(id) on delete cascade,
  owner_id    uuid not null default auth.uid(),
  primary key (obra_id, etiqueta_id)
);

create table entrada_etiqueta (
  entrada_id  text not null references entrada(id) on delete cascade,
  etiqueta_id text not null references etiqueta(id) on delete cascade,
  owner_id    uuid not null default auth.uid(),
  primary key (entrada_id, etiqueta_id)
);

create table obra_coleccion (
  obra_id      text not null references obra(id) on delete cascade,
  coleccion_id text not null references coleccion(id) on delete cascade,
  owner_id     uuid not null default auth.uid(),
  primary key (obra_id, coleccion_id)
);

create table entrada_acompanante (
  entrada_id text not null references entrada(id) on delete cascade,
  persona_id text not null references persona(id) on delete cascade,
  owner_id   uuid not null default auth.uid(),
  primary key (entrada_id, persona_id)
);

create table obra_creador (
  obra_id     text not null references obra(id) on delete cascade,
  persona_id  text not null references persona(id) on delete cascade,
  rol_credito text not null default '',   -- PG prohíbe NULL en columnas de PK (SQLite sí lo permitía)
  owner_id    uuid not null default auth.uid(),
  primary key (obra_id, persona_id, rol_credito)
);

-- ── índices (idénticos a v2) ────────────────────────────────────────────────
create index idx_entrada_fecha  on entrada(fecha);
create index idx_entrada_obra   on entrada(obra_id);
create index idx_entrada_estado on entrada(estado);
create index idx_entrada_clase  on entrada(clase_tiempo);
create index idx_entrada_etapa  on entrada(etapa_id);
create index idx_obra_categoria on obra(categoria);
create index idx_obra_decada    on obra(decada);
-- jsonb: GIN sobre metadata para consultar origen/fecha_tipo con eficiencia (mejora de dialecto)
create index idx_entrada_metadata on entrada using gin (metadata);
create index idx_obra_metadata    on obra using gin (metadata);

-- ── triggers de actualizado_en (solo obra y entrada llevan ese campo) ───────
create trigger trg_obra_actualizado    before update on obra
  for each row execute function set_actualizado_en();
create trigger trg_entrada_actualizado before update on entrada
  for each row execute function set_actualizado_en();
