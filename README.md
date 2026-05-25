# Hyphae Game Hub

Sitio propio para alojar un juego HTML5, mostrarlo en una pagina publica y gestionar estadisticas desde un panel privado.

## Funcionalidades

- Pagina publica con juego embebido desde `/game/index.html`.
- Contador persistente de visitas.
- Contador persistente de partidas iniciadas con boton publico o evento del juego.
- Panel admin protegido por clave.
- Rate limit basico para intentos de login.
- Cookie admin firmada para que el login sobreviva reinicios del servidor.
- Subida de un `.zip` completo o archivos sueltos para reemplazar el juego actual.
- Estadisticas en SQLite: totales, visitas por dia y logs recientes.
- Reset de contadores y logs.

## Requisitos

- Node.js 18 o superior.
- npm.

## Instalacion

```bash
npm install
```

Opcional: crea un archivo `.env` tomando como base `.env.example`.

```bash
PORT=3000
ADMIN_PASSWORD=tu-clave-segura
ADMIN_PASSWORD_HASH=
SESSION_SECRET=un-secreto-largo-y-dificil
```

Si no configuras variables de entorno, la clave temporal del admin sera `admin123`.
Si defines `ADMIN_PASSWORD_HASH`, el backend usa esa clave hasheada en lugar de `ADMIN_PASSWORD`.

Para generar un hash scrypt compatible:

```bash
node -e "const crypto=require('crypto'); const password='tu-clave'; const salt=crypto.randomBytes(16).toString('hex'); const hash=crypto.scryptSync(password, salt, 64).toString('hex'); console.log(`scrypt:${salt}:${hash}`)"
```

## Ejecutar

```bash
npm start
```

Luego abre:

- Pagina publica: `http://localhost:3000`
- Panel admin: `http://localhost:3000/admin`

## Deploy gratis recomendado

Para mantenerlo gratis sin perder datos, usa:

- Render Free para ejecutar Node/Express.
- Supabase Free para guardar estadisticas y archivos del juego.

Render Free no conserva archivos subidos ni SQLite local cuando el servicio duerme, reinicia o redeploya. Por eso este proyecto activa un modo Supabase si configuras `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.

### 1. Crear proyecto en Supabase

1. Crea un proyecto gratis en Supabase.
2. Ve a SQL Editor.
3. Pega y ejecuta el contenido de:

```text
supabase/schema.sql
```

El servidor crea automaticamente el bucket `game` si no existe.

### 2. Conseguir variables de Supabase

En Supabase, ve a Project Settings -> API y copia:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Usa la service role key solo en el backend. No la pongas en codigo frontend.

### 3. Subir a GitHub

Sube este proyecto a un repositorio de GitHub.

### 4. Crear Web Service en Render

En Render:

1. New -> Web Service.
2. Conecta el repo de GitHub.
3. Runtime: Node.
4. Plan: Free.
5. Build command:

```bash
npm install
```

6. Start command:

```bash
npm start
```

7. Variables de entorno:

```bash
ADMIN_PASSWORD=tu-clave-segura
ADMIN_PASSWORD_HASH=
SESSION_SECRET=un-secreto-largo
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
SUPABASE_GAME_BUCKET=game
```

Tambien puedes usar el archivo `render.yaml` incluido para crear el servicio desde Blueprint.

### Que queda persistente en modo gratis

- Estadisticas: Supabase Postgres.
- Logs: Supabase Postgres.
- Sesiones contadas: Supabase Postgres.
- Archivos del juego subidos desde admin: Supabase Storage.
- Login admin: cookie firmada persistente.

El disco local del servidor queda solo como carpeta temporal durante una subida.

## Subir tu juego

Entra al panel admin y usa "Subir juego".

Puedes subir:

- Un archivo `.zip` con un `index.html` dentro.
- Varios archivos sueltos, incluyendo un `.html`. Si es un export de Godot, incluye tambien `.pck`, `.wasm`, `.js`, iconos y worklets. Si el HTML no se llama `index.html` y es el unico HTML subido, el servidor lo renombra a `index.html`.

El panel valida los archivos referenciados por `index.html`. Si falta algo como `index.pck`, la subida devuelve un error en vez de quedar aparentemente correcta.

El contenido se reemplaza en:

```text
public/game/
```

El juego publico siempre se carga desde:

```text
/game/index.html
```

## Registrar partidas desde tu juego

La pagina publica ya cuenta una partida cuando el usuario pulsa el boton "Jugar".

Si tu juego quiere avisar directamente que empezo una partida, envia este evento desde el iframe:

```js
window.parent.postMessage({ type: "HY_GAME_PLAY" }, "*");
```

Tambien se acepta:

```js
window.parent.postMessage({ type: "game:play" }, "*");
```

## Datos persistentes

SQLite se guarda en:

```text
data/site.sqlite
```

Esa carpeta esta ignorada por Git para no versionar estadisticas reales.

## Estructura

```text
.
├── server.js
├── package.json
├── public/
│   ├── index.html
│   ├── admin.html
│   ├── admin-login.html
│   ├── css/
│   │   └── styles.css
│   ├── js/
│   │   ├── main.js
│   │   └── admin.js
│   └── game/
│       └── index.html
├── data/
│   └── site.sqlite
└── uploads/
```

## Seguridad basica

Configura siempre estas variables antes de publicar:

```bash
ADMIN_PASSWORD=una-clave-fuerte
ADMIN_PASSWORD_HASH=
SESSION_SECRET=un-secreto-largo
```

Para produccion, pon el servidor detras de HTTPS y un proxy como Nginx o Caddy.
