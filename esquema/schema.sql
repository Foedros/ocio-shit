-- Ocio Shit — Esquema SQLite (fuente canónica del almacenamiento local-first)
-- Fase 2 · 2026-06-23 · schema_version = 2
-- Notación: almacenamiento con punto decimal; la coma europea es capa de UI.
-- v2 (Fase 4): entrada.fecha pasa a NULLABLE (pendientes / centinela / fecha perdida).

PRAGMA foreign_keys = ON;

CREATE TABLE meta (
    clave  TEXT PRIMARY KEY,
    valor  TEXT NOT NULL
);
INSERT INTO meta (clave, valor) VALUES ('schema_version', '2');

CREATE TABLE plataforma (
    id      TEXT PRIMARY KEY,
    nombre  TEXT NOT NULL,
    tipo    TEXT CHECK (tipo IN ('streaming','tienda','dispositivo','sala','otro'))
);

CREATE TABLE persona (
    id      TEXT PRIMARY KEY,
    nombre  TEXT NOT NULL,
    rol     TEXT CHECK (rol IN ('acompanante','creador','ambos')) DEFAULT 'acompanante'
);

CREATE TABLE etapa (
    id            TEXT PRIMARY KEY,
    nombre        TEXT NOT NULL,
    fecha_inicio  DATE NOT NULL,
    fecha_fin     DATE,
    descripcion   TEXT,
    color         TEXT
);

CREATE TABLE obra (
    id                     TEXT PRIMARY KEY,
    titulo                 TEXT NOT NULL,
    categoria              TEXT NOT NULL CHECK (categoria IN
                              ('pelicula','serie','libro','videojuego','comic','ocio_libre')),
    subtipo                TEXT CHECK (subtipo IN
                              ('concierto','museo','viaje','evento','otro')),
    anio_obra              INTEGER,
    decada                 INTEGER,
    duracion_canonica_min  INTEGER,
    idioma_original        TEXT,
    pais_origen            TEXT,
    creador                TEXT,
    saga                   TEXT,
    -- "en curso": serie que aún veo a trozos, nota PROVISIONAL. SOLO series; ortogonal a métricas.
    en_curso               INTEGER NOT NULL DEFAULT 0 CHECK (en_curso IN (0,1)),
    formato_habitual       TEXT CHECK (formato_habitual IN
                              ('cine','streaming','fisico','papel','ebook','audiolibro',
                               'consola','pc','movil','otro')),
    portada_uri            TEXT,
    fuente_externa         TEXT,
    metadata               TEXT,
    clave_dedup            TEXT GENERATED ALWAYS AS (
                              lower(titulo) || '|' || categoria || '|' || coalesce(anio_obra, '')
                           ) STORED,
    creado_en              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizado_en         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uq_obra_clave_dedup ON obra(clave_dedup);

CREATE TABLE entrada (
    id                  TEXT PRIMARY KEY,
    obra_id             TEXT NOT NULL REFERENCES obra(id) ON DELETE CASCADE,
    fecha               DATE,  -- NULLABLE (v2): pendiente / centinela pre-2023 / fecha perdida
    estado              TEXT NOT NULL DEFAULT 'terminado' CHECK (estado IN
                          ('pendiente','en_curso','terminado','abandonado')),
    duracion_min        INTEGER,
    clase_tiempo        TEXT NOT NULL DEFAULT 'electivo' CHECK (clase_tiempo IN
                          ('electivo','habito')),
    num_reconsumo       INTEGER NOT NULL DEFAULT 0,
    es_reconsumo        INTEGER GENERATED ALWAYS AS (
                          CASE WHEN num_reconsumo > 0 THEN 1 ELSE 0 END
                        ) VIRTUAL,
    valoracion          REAL CHECK (valoracion >= 0 AND valoracion <= 10),
    impacto_emocional   REAL CHECK (impacto_emocional >= 0 AND impacto_emocional <= 10),
    nota                TEXT,
    plataforma_id       TEXT REFERENCES plataforma(id) ON DELETE SET NULL,
    ubicacion           TEXT,
    estado_animo        TEXT,
    etapa_id            TEXT REFERENCES etapa(id) ON DELETE SET NULL,
    metadata            TEXT,
    creado_en           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizado_en      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE etiqueta (
    id         TEXT PRIMARY KEY,
    nombre     TEXT NOT NULL UNIQUE,
    taxonomia  TEXT CHECK (taxonomia IN ('genero','tema','tono','tecnica','meta')),
    origen     TEXT NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual','ia')),
    color      TEXT
);

CREATE TABLE coleccion (
    id           TEXT PRIMARY KEY,
    nombre       TEXT NOT NULL,
    descripcion  TEXT,
    tipo         TEXT NOT NULL CHECK (tipo IN ('manual','inteligente','ia')),
    regla_json   TEXT,
    portada_uri  TEXT
);

CREATE TABLE logro (
    id             TEXT PRIMARY KEY,
    nombre         TEXT NOT NULL,
    descripcion    TEXT,
    clase          TEXT,
    rareza         TEXT CHECK (rareza IN ('comun','raro','epico','legendario')),
    exp            INTEGER NOT NULL DEFAULT 0,
    condicion_json TEXT
);

CREATE TABLE logro_desbloqueado (
    id                 TEXT PRIMARY KEY,
    logro_id           TEXT NOT NULL REFERENCES logro(id) ON DELETE CASCADE,
    fecha              DATE NOT NULL,
    entrada_origen_id  TEXT REFERENCES entrada(id) ON DELETE SET NULL
);

CREATE TABLE momento_canon (
    id              TEXT PRIMARY KEY,
    entrada_id      TEXT NOT NULL REFERENCES entrada(id) ON DELETE CASCADE,
    titulo          TEXT NOT NULL,
    por_que_importa TEXT,
    fecha           DATE,
    destacado       INTEGER NOT NULL DEFAULT 0 CHECK (destacado IN (0,1))
);

CREATE TABLE titulo (
    id             TEXT PRIMARY KEY,
    nombre         TEXT NOT NULL,
    descripcion    TEXT,
    rareza         TEXT CHECK (rareza IN ('comun','raro','epico','legendario')),
    condicion_json TEXT
);

CREATE TABLE titulo_desbloqueado (
    id        TEXT PRIMARY KEY,
    titulo_id TEXT NOT NULL REFERENCES titulo(id) ON DELETE CASCADE,
    fecha     DATE NOT NULL
);

CREATE TABLE perfil_usuario (
    id               INTEGER PRIMARY KEY CHECK (id = 1),
    exp_total        INTEGER NOT NULL DEFAULT 0,
    nivel            INTEGER NOT NULL DEFAULT 1,
    titulo_activo_id TEXT REFERENCES titulo(id) ON DELETE SET NULL,
    racha_dias       INTEGER NOT NULL DEFAULT 0
);
INSERT INTO perfil_usuario (id) VALUES (1);

CREATE TABLE obra_etiqueta (
    obra_id     TEXT NOT NULL REFERENCES obra(id) ON DELETE CASCADE,
    etiqueta_id TEXT NOT NULL REFERENCES etiqueta(id) ON DELETE CASCADE,
    PRIMARY KEY (obra_id, etiqueta_id)
);

CREATE TABLE entrada_etiqueta (
    entrada_id  TEXT NOT NULL REFERENCES entrada(id) ON DELETE CASCADE,
    etiqueta_id TEXT NOT NULL REFERENCES etiqueta(id) ON DELETE CASCADE,
    PRIMARY KEY (entrada_id, etiqueta_id)
);

CREATE TABLE obra_coleccion (
    obra_id      TEXT NOT NULL REFERENCES obra(id) ON DELETE CASCADE,
    coleccion_id TEXT NOT NULL REFERENCES coleccion(id) ON DELETE CASCADE,
    PRIMARY KEY (obra_id, coleccion_id)
);

CREATE TABLE entrada_acompanante (
    entrada_id TEXT NOT NULL REFERENCES entrada(id) ON DELETE CASCADE,
    persona_id TEXT NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
    PRIMARY KEY (entrada_id, persona_id)
);

CREATE TABLE obra_creador (
    obra_id    TEXT NOT NULL REFERENCES obra(id) ON DELETE CASCADE,
    persona_id TEXT NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
    rol_credito TEXT,
    PRIMARY KEY (obra_id, persona_id, rol_credito)
);

CREATE INDEX idx_entrada_fecha    ON entrada(fecha);
CREATE INDEX idx_entrada_obra     ON entrada(obra_id);
CREATE INDEX idx_entrada_estado   ON entrada(estado);
CREATE INDEX idx_entrada_clase    ON entrada(clase_tiempo);
CREATE INDEX idx_entrada_etapa    ON entrada(etapa_id);
CREATE INDEX idx_obra_categoria   ON obra(categoria);
CREATE INDEX idx_obra_decada      ON obra(decada);
