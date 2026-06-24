# Ocio Shit — Sprint 1: la columna de durabilidad

Archivo cultural personal **de por vida**, local-first. Sprint 1 construye **solo** la
columna de durabilidad: el motor SQLite, la carga del archivo migrado y la garantía de que
**el dato no se pierde nunca**. Sin pantallas de contenido (eso es Sprint 2+).

> La app vive en [`app/`](app/). Los documentos de diseño (`docs/`, `CLAUDE.md`) se
> mantienen **privados/locales** — no se publican en este repo porque contienen
> estadísticas personales.

---

## El modelo de durabilidad (por qué esto es lo primero)

Tres capas, de más durable a más volátil (`tecnico.md` §3.2):

1. **Verdad durable — `export.json` en una carpeta REAL de tu disco** (File System Access
   API). Es la única capa que sobrevive a un borrado del navegador. Escritura **atómica**
   (temp + `rename`), nunca sobre el fichero vivo. Rota una copia anterior (`.prev.json`).
2. **Caché de trabajo — SQLite-WASM (OO1) sobre OPFS-SAH-pool** en un Web Worker. Rápido,
   con SQL e índices, pero **volátil y desechable**. Journal `TRUNCATE` (WAL no existe en el
   VFS de OPFS).
3. **Memoria — la app en ejecución.**

**Pérdida de OPFS = escenario esperado, no excepción.** Al arrancar, si OPFS está
ausente/vacío o falla `PRAGMA integrity_check`, la app **reconstruye la BD desde el
`export.json` durable**. No se pierde nada porque la verdad nunca estuvo en OPFS.

### Alcance de navegador (decidido)

- **Chromium (Chrome/Edge/Brave/…):** durabilidad **automática plena** (File System Access
  API + directory handles persistidos).
- **Safari / Firefox:** sin File System Access API completa → la app **degrada a export
  manual** (descarga) y **lo avisa** en el indicador permanente. MVP es **Chromium-only**
  para durabilidad automática.

### Privacidad (decisión de Sprint 1)

El repositorio (y GitHub Pages) lleva **solo el código de la app**. Tu archivo personal
**nunca se publica**: se carga localmente desde tu carpeta durable. Por eso `data/` y
`*.xlsx` están en `.gitignore`.

---

## Desarrollo

```bash
cd app
npm install          # también genera schema-sql.js y copia el wasm (prepare-assets)
npm run dev          # http://localhost:5173
```

## Build (estático, para GitHub Pages)

```bash
cd app
npm run build        # -> app/build  (BASE_PATH='' en local; CI usa /<repo>)
npm run preview      # sirve el build en http://localhost:4173
```

---

## Tests de durabilidad (el entregable más importante)

Tres capas de prueba, todas en `app/`:

| Comando | Qué prueba |
|---|---|
| `npm run test:roundtrip` | **Round-trip** en Node (`node:sqlite`): import → *pérdida* → reconstruye → re-export es **idéntico** (sin pérdida). |
| `npm run test:fsa` | Escritura atómica de la capa durable contra un mock de File System Access (rotación `.prev` + cadena de lectura de respaldo). |
| `npm run test:e2e` | Chromium real. Incluye: **(a)** siembra → **borra TODO OPFS → recarga → reconstruye** (`integrity_check: ok`, conteos idénticos); y **(b)** `FsaDurableStore` contra **handles reales** (OPFS) en ambos caminos (`rename` y `copy`): tras N escrituras el disco queda **exactamente `export.json` + `.prev`, cero `.tmp`**. |
| `npm test` | Todas. |

Por defecto usan un **fixture sintético** (`app/tests/fixtures/sample.export.json`) para que
CI sea autónomo sin datos personales. Para probar con tu **archivo real** (4.242/3.809):

```bash
cd app
# Round-trip Node con datos reales:
OCIO_EXPORT="../data/ocioshit.export.json" npm run test:roundtrip
# E2E en navegador con datos reales:
OCIO_EXPORT="../data/ocioshit.export.json" npm run test:e2e
```

### Causa raíz del bug de escritura durable (corregido 2026-06-24)

La escritura atómica promovía el temporal al definitivo con `FileSystemFileHandle.move()`
(rename). **`move()` funciona en OPFS pero NO es fiable en el sistema de ficheros local de
Chromium (Windows):** ambos `move()` lanzaban, los `catch` los tragaban y la carpeta quedaba
con un `.tmp` huérfano y sin rotación `.prev`. Como OPFS y el mock sí honran `move()`, todos
los tests automáticos pasaban mientras el disco real fallaba. **Arreglo:** la rotación `.prev`
se hace por **copia**; el definitivo se escribe con `createWritable()` (que hace su propio
temp `.crswap` + rename atómico interno); `move()` queda como vía rápida con **fallback a
copia** y memo `_moveBroken`; y el `.tmp` se borra **siempre** en un `finally`. Cobertura nueva:
`tests/fsa-real.e2e.spec.js` ejercita la API **real** (handles OPFS) en ambos caminos.

### Verificación manual (camino real de disco, no automatizable)

El selector de carpeta no se automatiza; confírmalo a mano en **Chromium** (abre DevTools →
Console para ver el método usado):

1. `npm run preview` y abre la URL (o el sitio desplegado).
2. **Elegir carpeta durable…** → una carpeta real **vacía y no sincronizada**. Concede permiso.
3. **Cargar export.json…** → tu `data/ocioshit.export.json`. Verás 4.242/3.809 y, en la
   carpeta, **solo** `ocioshit.export.json`. El log dirá el método: *“temp+rename atómico”* o
   *“escritura atómica directa (copia)”* — si dice **copia**, tu FS tiene el `move()` no fiable
   (la causa raíz) y la app usó el fallback robusto.
4. **Backup ahora** → en la carpeta: **`ocioshit.export.json` + `ocioshit.export.prev.json`**,
   **cero `.tmp`**.
5. **Backup ahora** otra vez → siguen siendo exactamente esos dos ficheros, cero `.tmp`.
6. **Simular pérdida de OPFS → reconstruir** → reconstruye desde el `.json` del disco a
   4.242/3.809, `integrity_check: ok`. (Más fuerte: cierra y reabre la pestaña → Reautorizar →
   reconstruye al recargar.)
7. **Estado final esperado en la carpeta: exactamente `ocioshit.export.json` +
   `ocioshit.export.prev.json`, cero `.tmp`.** El indicador “Último backup durable: hace X”
   refleja el estado real.

---

## Despliegue — ✅ EN PRODUCCIÓN

- **App en vivo:** **https://foedros.github.io/ocio-shit/**
- **Repo (público, solo el shell):** https://github.com/Foedros/ocio-shit
- **CI** (`.github/workflows/deploy.yml`): en cada push a `main`,
  `test` (round-trip + atómico + E2E OPFS-loss→reconstruir) → `build` (con
  `BASE_PATH=/ocio-shit`) → `deploy` a Pages. **Pages ya habilitado** (Source: GitHub Actions).

**Primer uso** (en Chromium): la app te pedirá **elegir tu carpeta durable** y **cargar tu
`export.json`** (desde tu disco — no se publica). A partir de ahí, durabilidad automática.

**Redeploy:** `git push` a `main`. El shell se publica; tus datos personales nunca
(ver `.gitignore`: `data/`, `*.xlsx`, `docs/`, `CLAUDE.md` quedan locales).
