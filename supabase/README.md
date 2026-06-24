# Supabase — capa de datos (Sprint A)

Traslado del almacenamiento de OPFS/local a **Supabase (PostgreSQL en la nube)** para el flujo
PC + móvil. La PWA, el modelo, el compilador, los sistemas, las pantallas y el dato **se
conservan**; cambia dónde viven los datos. Decisión: `docs/tecnico.md` Rev. 2 + §3.2.sec.

> **Privacidad:** este `supabase/` (shell, SQL, scripts) es público; **ningún dato personal**
> vive aquí. El archivo se carga desde `data/` (gitignored) y vive en tu proyecto Supabase
> protegido por RLS. La `secret`/DB URL solo en `.env` local.

## Ficheros

| Fichero | Qué es |
|---|---|
| `schema.sql` | Esquema PostgreSQL = traslado de dialecto de `esquema/schema.sql` v2 (jsonb, generadas STORED, `clave_dedup` con `::text`, `timestamptz`+trigger, `owner_id`). **No cambia ninguna decisión de Fase 2.** |
| `rls.sql` | **GATE de seguridad**: `ENABLE ROW LEVEL SECURITY` + 4 políticas `owner_id = auth.uid()` por tabla (19 tablas). Ejecutar **después** de `schema.sql`. |
| `../app/scripts/supabase-*.mjs` | Harness local: `setup` (DDL + usuario Auth), `load` (carga + verificación re-consultada), `security-check` (gate anónimo), `compiler-check` (compilador→Postgres), `export` (round-trip portable). |

## Puesta en marcha (una vez)

**1. Crea el proyecto** en [supabase.com](https://supabase.com) (plan gratuito; 1 proyecto, 1 usuario).
   - Anota la **Project URL** y el **Project Ref**.
   - **API Keys** (Project Settings → API Keys): copia `sb_publishable_…` y `sb_secret_…`
     (las claves *nuevas*, rotables; no las legacy anon/service_role).
   - **Database** (Project Settings → Database → Connection string → **URI**): copia la cadena
     (lleva la contraseña de la BD).

**2. Rellena `.env`** en la raíz (copia de `.env.example`): `SUPABASE_URL`,
   `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL`, `OCIO_AUTH_EMAIL`,
   `OCIO_AUTH_PASSWORD`. (`.env` está gitignored.)

**3. Ejecuta el harness** desde `app/`:

```bash
npm install                       # instala pg + @supabase/supabase-js
npm run supabase:setup            # aplica schema.sql + rls.sql, crea el usuario Auth
npm run supabase:load             # carga export.json (4.242/3.809) + verifica re-consultando
npm run supabase:security         # GATE: anónimo no lee ni escribe; el propietario sí
npm run supabase:compiler         # el compilador conservado evalúa contra Postgres
npm run supabase:export           # export portable + round-trip a SQLite (anti-lock-in)
```

`supabase:setup --reset` recrea las tablas desde cero (re-ejecutable).

**4. Security Advisor** (Dashboard → Advisors → Security): debe salir **sin hallazgos** de
   "RLS disabled"/"policy exists but RLS off". Adjunta el resultado: junto al `supabase:security`
   verde, es el criterio de aceptación del gate.

## Verificación previa (offline, ya en verde)

Sin tocar la nube, ya están probados contra el archivo real:
- `npm run test:pg-dialect` — el compilador (SQLite) traduce a Postgres válido (`?`→`$n`, `strftime`→`to_char`).
- `npm run test:load-prep` — la transformación de carga (4.242/3.809, generadas excluidas, `metadata` a objeto jsonb, `owner_id` sellado, orden FK).
