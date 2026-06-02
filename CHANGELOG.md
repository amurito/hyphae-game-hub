# CHANGELOG — hyphae-game-hub

## [2026-06-02] — Telemetría anónima del juego

### Nuevas features

- **`POST /api/telemetry`** — endpoint público de ingesta de runs. CORS `*` (funciona desde itch.io y onrender). Rate-limit 30/min por IP (hash efímero, no persistido). Valida shape del payload. `TELEMETRY_INGEST_KEY` opcional (header `X-Telemetry-Key`). Límite de body subido a 600kb.
- **`GET /api/admin/telemetry`** — resumen agregado (total runs, sesiones distintas, última recibida, conteo por ruta/versión/plataforma). Requiere cookie admin.
- **`GET /api/admin/telemetry/export`** — dump de todos los payloads. NDJSON (default) o `?format=json`. Requiere cookie admin **o** `Authorization: Bearer <TELEMETRY_EXPORT_TOKEN>` (para `fetch_telemetry.py` sin browser).
- **Tabla `telemetry_runs`** en Supabase (`supabase/schema.sql`, idempotente) y SQLite local (modo dev). Columnas: `game_version`, `platform`, `session_id`, `final_route`, `pl_gained`, `run_time`, `trascendencia_count`, `payload` (JSONB completo).
- **Panel admin** — nueva sección "Runs del juego" con 3 métricas (totales, sesiones, última) y 2 gráficos doughnut (rutas y plataformas) via Chart.js. CSS responsive.
- **`render.yaml`** — `TELEMETRY_EXPORT_TOKEN` (generateValue) y `TELEMETRY_INGEST_KEY` (sync: false).
- **`express.json({ limit: "600kb" })`** — límite de body explícito para payloads de runs grandes.

### Privacidad

El endpoint **no guarda IP ni User-Agent** (a diferencia de `/api/visit` y `/api/play`). El `session_id` es un token aleatorio generado en el cliente Godot. La telemetría es opt-in (checkbox en Ajustes del juego).

---

## [2026-05-25] — Setup inicial

- Página pública con juego embebido desde Supabase Storage.
- Panel admin con contadores de visitas/partidas, gráfico de barras (30 días), tabla de jugadores, logs, upload de juego (ZIP o archivos sueltos).
- Modo dual Supabase/SQLite (sin Supabase → SQLite local).
- Cookie admin firmada con HMAC-SHA256, TTL 8hs, rate-limit en login.
- Links de invitación por jugador.
