const crypto = require("crypto");
const fs = require("fs/promises");
const fssync = require("fs");
const path = require("path");

const cookieParser = require("cookie-parser");
const express = require("express");
const multer = require("multer");
const extractZip = require("extract-zip");
const mime = require("mime-types");
const { createClient } = require("@supabase/supabase-js");

require("dotenv").config();

if (typeof WebSocket === "undefined") {
  global.WebSocket = require("ws");
}

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_GAME_BUCKET = process.env.SUPABASE_GAME_BUCKET || "game";
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const adminCookieName = "hg_admin";
const adminSessionTtlMs = 1000 * 60 * 60 * 8;
const loginWindowMs = 1000 * 60 * 15;
const loginMaxAttempts = 10;

const rootDir = __dirname;
const publicDir = path.join(rootDir, "public");
const gameDir = path.join(publicDir, "game");
const dataDir = path.join(rootDir, "data");
const uploadsDir = path.join(rootDir, "uploads");
const dbPath = path.join(dataDir, "site.sqlite");

const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: 250 * 1024 * 1024,
    files: 200
  }
});

let db;
let supabase;
const loginAttempts = new Map();

async function ensureDirectories() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.mkdir(gameDir, { recursive: true });
}

async function initDatabase() {
  if (useSupabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });
    await ensureSupabaseBucket();
    await seedSupabaseCounters();
    return;
  }

  const sqlite3 = require("sqlite3");
  const { open } = require("sqlite");

  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS counters (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      meta TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_stats (
      day TEXT PRIMARY KEY,
      visits INTEGER NOT NULL DEFAULT 0,
      plays INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      visit_counted INTEGER NOT NULL DEFAULT 0,
      play_counted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
  `);

  await db.run("INSERT OR IGNORE INTO counters (key, value) VALUES ('visits', 0), ('plays', 0)");
}

async function ensureSupabaseBucket() {
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    throw listError;
  }

  const exists = buckets.some((bucket) => bucket.name === SUPABASE_GAME_BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(SUPABASE_GAME_BUCKET, {
      public: false
    });
    if (error) {
      throw error;
    }
  }
}

async function seedSupabaseCounters() {
  const { error } = await supabase
    .from("counters")
    .upsert([{ key: "visits", value: 0 }, { key: "plays", value: 0 }], {
      onConflict: "key",
      ignoreDuplicates: true
    });
  if (error) {
    throw error;
  }
}

function isoNow() {
  return new Date().toISOString();
}

function nowMs() {
  return Date.now();
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "";
}

function publicMeta(req) {
  const playerName = typeof req.body?.playerName === "string" ? req.body.playerName.trim().slice(0, 32) : "";
  const playerId = typeof req.body?.playerId === "string" ? req.body.playerId.trim().slice(0, 80) : "";
  return {
    ip: clientIp(req),
    userAgent: req.headers["user-agent"] || "",
    playerName,
    playerId
  };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function verifyPassword(password) {
  if (ADMIN_PASSWORD_HASH) {
    const [scheme, salt, expectedHash] = ADMIN_PASSWORD_HASH.split(":");
    if (scheme !== "scrypt" || !salt || !expectedHash) {
      throw new Error("ADMIN_PASSWORD_HASH debe tener formato scrypt:salt:hash");
    }
    const actualHash = hashPassword(password, salt);
    if (actualHash.length !== expectedHash.length) {
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(actualHash, "hex"), Buffer.from(expectedHash, "hex"));
  }

  return password === ADMIN_PASSWORD;
}

function createAdminToken(expiresAt) {
  const payload = `${expiresAt}`;
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

function verifyAdminToken(token) {
  if (!token || !token.includes(".")) {
    return false;
  }

  const dotIndex = token.indexOf(".");
  const expiresAt = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);
  if (!expiresAt || !signature) {
    return false;
  }

  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(expiresAt).digest("hex");
  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length) {
    return false;
  }
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) {
    return false;
  }

  return Number(expiresAt) > nowMs();
}

function setAdminCookie(res) {
  const expiresAt = nowMs() + adminSessionTtlMs;
  res.cookie(adminCookieName, createAdminToken(expiresAt), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: adminSessionTtlMs
  });
}

function clearAdminCookie(res) {
  res.clearCookie(adminCookieName);
}

function checkLoginRateLimit(req) {
  const key = clientIp(req) || "unknown";
  const attempt = loginAttempts.get(key);
  const now = nowMs();

  if (!attempt || now > attempt.resetAt) {
    loginAttempts.set(key, { count: 0, resetAt: now + loginWindowMs });
    return { limited: false };
  }

  if (attempt.count >= loginMaxAttempts) {
    return {
      limited: true,
      retryAfterSec: Math.ceil((attempt.resetAt - now) / 1000)
    };
  }

  return { limited: false };
}

function registerLoginFailure(req) {
  const key = clientIp(req) || "unknown";
  const now = nowMs();
  const attempt = loginAttempts.get(key);
  if (!attempt || now > attempt.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + loginWindowMs });
    return;
  }
  attempt.count += 1;
}

function clearLoginFailures(req) {
  loginAttempts.delete(clientIp(req) || "unknown");
}

async function ensureVisitorSession(req, res) {
  let visitorId = req.cookies.hg_session;
  if (!visitorId || !/^[a-f0-9]{32}$/.test(visitorId)) {
    visitorId = crypto.randomBytes(16).toString("hex");
    res.cookie("hg_session", visitorId, {
      httpOnly: true,
      sameSite: "lax"
    });
  }

  const now = isoNow();
  if (useSupabase) {
    const { error } = await supabase
      .from("sessions")
      .upsert({ id: visitorId, created_at: now, last_seen_at: now }, { onConflict: "id" });
    if (error) {
      throw error;
    }
    return visitorId;
  }

  await db.run(
    `INSERT INTO sessions (id, created_at, last_seen_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    visitorId,
    now,
    now
  );

  return visitorId;
}

async function incrementMetric(type, req) {
  const counterKey = type === "visit" ? "visits" : "plays";
  const dailyColumn = type === "visit" ? "visits" : "plays";
  const day = todayKey();

  if (useSupabase) {
    const { error } = await supabase.rpc("increment_metric", {
      metric_key: counterKey,
      daily_key: dailyColumn,
      stat_day: day,
      log_type: type,
      log_meta: publicMeta(req)
    });
    if (error) {
      throw error;
    }
    return;
  }

  await db.run("UPDATE counters SET value = value + 1 WHERE key = ?", counterKey);
  await db.run(
    `INSERT INTO daily_stats (day, ${dailyColumn})
     VALUES (?, 1)
     ON CONFLICT(day) DO UPDATE SET ${dailyColumn} = ${dailyColumn} + 1`,
    day
  );
  await db.run(
    "INSERT INTO logs (type, created_at, meta) VALUES (?, ?, ?)",
    type,
    isoNow(),
    JSON.stringify(publicMeta(req))
  );
}

async function currentStats() {
  if (useSupabase) {
    const { data, error } = await supabase.from("counters").select("key,value");
    if (error) {
      throw error;
    }
    const stats = Object.fromEntries(data.map((row) => [row.key, row.value]));
    return {
      visits: stats.visits || 0,
      plays: stats.plays || 0
    };
  }

  const counters = await db.all("SELECT key, value FROM counters");
  const stats = Object.fromEntries(counters.map((row) => [row.key, row.value]));
  return {
    visits: stats.visits || 0,
    plays: stats.plays || 0
  };
}

async function getVisitorFlags(visitorId) {
  if (useSupabase) {
    const { data, error } = await supabase
      .from("sessions")
      .select("visit_counted, play_counted")
      .eq("id", visitorId)
      .single();
    if (error) {
      throw error;
    }
    return data;
  }

  return db.get("SELECT visit_counted, play_counted FROM sessions WHERE id = ?", visitorId);
}

async function setVisitorFlag(visitorId, field) {
  if (useSupabase) {
    const { error } = await supabase.from("sessions").update({ [field]: true }).eq("id", visitorId);
    if (error) {
      throw error;
    }
    return;
  }

  await db.run(`UPDATE sessions SET ${field} = 1 WHERE id = ?`, visitorId);
}

function requireAdmin(req, res, next) {
  if (verifyAdminToken(req.cookies[adminCookieName])) {
    return next();
  }
  return res.status(401).json({ error: "No autenticado" });
}

function requireAdminPage(req, res, next) {
  if (verifyAdminToken(req.cookies[adminCookieName])) {
    return next();
  }
  return res.redirect("/admin/login");
}

async function clearGameDirectory() {
  await fs.rm(gameDir, { recursive: true, force: true });
  await fs.mkdir(gameDir, { recursive: true });
}

function safeUploadPath(filename) {
  const normalized = path.normalize(filename).replace(/^(\.\.(\/|\\|$))+/, "");
  const target = path.join(gameDir, normalized);
  const resolvedGameDir = path.resolve(gameDir);
  const resolvedTarget = path.resolve(target);

  if (!resolvedTarget.startsWith(resolvedGameDir + path.sep) && resolvedTarget !== resolvedGameDir) {
    throw new Error(`Ruta no permitida: ${filename}`);
  }

  return resolvedTarget;
}

async function moveDirectoryContents(sourceDir, targetDir) {
  const entries = await fs.readdir(sourceDir);
  for (const entry of entries) {
    await fs.rename(path.join(sourceDir, entry), path.join(targetDir, entry));
  }
}

async function findIndexHtml(startDir, depth = 0) {
  if (depth > 4) {
    return null;
  }

  const entries = await fs.readdir(startDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase() === "index.html") {
      return startDir;
    }
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = await findIndexHtml(path.join(startDir, entry.name), depth + 1);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

async function normalizeGameRoot() {
  const rootIndex = path.join(gameDir, "index.html");
  if (fssync.existsSync(rootIndex)) {
    return;
  }

  const indexDir = await findIndexHtml(gameDir);
  if (!indexDir || path.resolve(indexDir) === path.resolve(gameDir)) {
    throw new Error("No se encontro index.html en el juego subido.");
  }

  const tempDir = path.join(uploadsDir, `game-root-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  await moveDirectoryContents(indexDir, tempDir);
  await clearGameDirectory();
  await moveDirectoryContents(tempDir, gameDir);
  await fs.rm(tempDir, { recursive: true, force: true });
}

async function validateGameFiles() {
  const indexPath = path.join(gameDir, "index.html");
  const html = await fs.readFile(indexPath, "utf8");
  const referencedFiles = new Set();

  const fileSizesMatch = html.match(/"fileSizes"\s*:\s*\{([^}]+)\}/);
  if (fileSizesMatch) {
    const fileMatches = fileSizesMatch[1].matchAll(/"([^"]+)"/g);
    for (const match of fileMatches) {
      referencedFiles.add(match[1]);
    }
  }

  const executableMatch = html.match(/"executable"\s*:\s*"([^"]+)"/);
  if (executableMatch) {
    referencedFiles.add(`${executableMatch[1]}.js`);
    referencedFiles.add(`${executableMatch[1]}.wasm`);
    referencedFiles.add(`${executableMatch[1]}.pck`);
  }

  const missing = [];
  for (const file of referencedFiles) {
    if (!fssync.existsSync(path.join(gameDir, file))) {
      missing.push(file);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Faltan archivos referenciados por index.html: ${missing.join(", ")}`);
  }
}

async function listLocalFiles(baseDir, currentDir = baseDir) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listLocalFiles(baseDir, absolute));
    } else if (entry.isFile()) {
      files.push(path.relative(baseDir, absolute).replace(/\\/g, "/"));
    }
  }

  return files;
}

async function clearSupabaseGameFiles() {
  async function removeFrom(prefix = "") {
    const { data, error } = await supabase.storage.from(SUPABASE_GAME_BUCKET).list(prefix, {
      limit: 1000
    });
    if (error) {
      throw error;
    }

    const files = [];
    for (const item of data) {
      const key = prefix ? `${prefix}/${item.name}` : item.name;
      if (!prefix && key.startsWith("__")) {
        continue;
      }
      if (item.id === null) {
        await removeFrom(key);
      } else {
        files.push(key);
      }
    }

    if (files.length > 0) {
      const { error: removeError } = await supabase.storage.from(SUPABASE_GAME_BUCKET).remove(files);
      if (removeError) {
        throw removeError;
      }
    }
  }

  await removeFrom("");
}

async function uploadGameToSupabase() {
  await clearSupabaseGameFiles();
  const files = await listLocalFiles(gameDir);

  for (const relativePath of files) {
    const absolutePath = path.join(gameDir, relativePath);
    const contentType = mime.lookup(relativePath) || "application/octet-stream";
    const body = await fs.readFile(absolutePath);
    const { error } = await supabase.storage.from(SUPABASE_GAME_BUCKET).upload(relativePath, body, {
      contentType,
      upsert: true
    });
    if (error) {
      throw error;
    }
  }
}

async function writeDeploymentManifest() {
  const files = await listLocalFiles(gameDir);
  const manifest = {
    deployedAt: isoNow(),
    fileCount: files.length,
    files
  };

  if (useSupabase) {
    const body = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
    const latest = await supabase.storage.from(SUPABASE_GAME_BUCKET).upload("__meta/latest.json", body, {
      contentType: "application/json",
      upsert: true
    });
    if (latest.error) {
      throw latest.error;
    }

    const version = await supabase.storage
      .from(SUPABASE_GAME_BUCKET)
      .upload(`__versions/${manifest.deployedAt.replace(/[:.]/g, "-")}.json`, body, {
        contentType: "application/json",
        upsert: true
      });
    if (version.error) {
      throw version.error;
    }
    return manifest;
  }

  await fs.mkdir(path.join(dataDir, "versions"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "latest-deploy.json"), JSON.stringify(manifest, null, 2), "utf8");
  await fs.writeFile(
    path.join(dataDir, "versions", `${manifest.deployedAt.replace(/[:.]/g, "-")}.json`),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );
  return manifest;
}

async function getDeploymentManifest() {
  if (useSupabase) {
    const { data, error } = await supabase.storage.from(SUPABASE_GAME_BUCKET).download("__meta/latest.json");
    if (error || !data) {
      return null;
    }
    return JSON.parse(Buffer.from(await data.arrayBuffer()).toString("utf8"));
  }

  const target = path.join(dataDir, "latest-deploy.json");
  if (!fssync.existsSync(target)) {
    return null;
  }
  return JSON.parse(await fs.readFile(target, "utf8"));
}

async function serveSupabaseGameFile(req, res, next) {
  try {
    const requestedPath = req.params[0] || "index.html";
    const safePath = path.posix.normalize(requestedPath).replace(/^(\.\.(\/|$))+/, "");
    const { data, error } = await supabase.storage.from(SUPABASE_GAME_BUCKET).download(safePath);

    if (error || !data) {
      return res.status(404).send("Archivo del juego no encontrado.");
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    res.setHeader("Content-Type", mime.lookup(safePath) || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.send(buffer);
  } catch (error) {
    next(error);
  }
}

async function installUploadedGame(files) {
  if (!files || files.length === 0) {
    throw new Error("No se recibieron archivos.");
  }

  const zipFiles = files.filter((file) => file.originalname.toLowerCase().endsWith(".zip"));
  if (zipFiles.length > 0) {
    if (files.length !== 1 || zipFiles.length !== 1) {
      throw new Error("Sube un unico .zip o varios archivos sueltos, pero no ambos.");
    }

    await clearGameDirectory();
    await extractZip(zipFiles[0].path, { dir: gameDir });
    await normalizeGameRoot();
    await validateGameFiles();
    if (useSupabase) {
      await uploadGameToSupabase();
    }
    await writeDeploymentManifest();
    return;
  }

  await clearGameDirectory();
  let htmlFiles = 0;

  for (const file of files) {
    const relativeName = file.originalname || file.filename;
    if (relativeName.toLowerCase().endsWith(".html")) {
      htmlFiles += 1;
    }

    const destination = safeUploadPath(relativeName);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.rename(file.path, destination);
  }

  if (!fssync.existsSync(path.join(gameDir, "index.html"))) {
    if (htmlFiles === 1) {
      const entries = await fs.readdir(gameDir);
      const htmlFile = entries.find((entry) => entry.toLowerCase().endsWith(".html"));
      if (htmlFile) {
        await fs.rename(path.join(gameDir, htmlFile), path.join(gameDir, "index.html"));
      }
    }
  }

  await normalizeGameRoot();
  await validateGameFiles();
  if (useSupabase) {
    await uploadGameToSupabase();
  }
  await writeDeploymentManifest();
}

async function cleanupUploads(files) {
  await Promise.all(
    (files || []).map((file) => fs.rm(file.path, { force: true }).catch(() => {}))
  );
}

app.disable("x-powered-by");
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get("/admin/login", (req, res) => {
  res.sendFile(path.join(publicDir, "admin-login.html"));
});

app.get("/admin", requireAdminPage, (req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"));
});

app.post("/api/admin/login", async (req, res) => {
  const limit = checkLoginRateLimit(req);
  if (limit.limited) {
    return res.status(429).json({ error: `Demasiados intentos. Reintenta en ${limit.retryAfterSec}s.` });
  }

  const { password } = req.body;
  if (!verifyPassword(password || "")) {
    registerLoginFailure(req);
    return res.status(401).json({ error: "Clave incorrecta" });
  }

  clearLoginFailures(req);
  setAdminCookie(res);
  return res.json({ ok: true });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  clearAdminCookie(res);
  res.json({ ok: true });
});

app.post("/api/visit", async (req, res, next) => {
  try {
    const visitorId = await ensureVisitorSession(req, res);
    const row = await getVisitorFlags(visitorId);
    let counted = false;

    if (!row || !row.visit_counted) {
      counted = true;
      await incrementMetric("visit", req);
      await setVisitorFlag(visitorId, "visit_counted");
    }

    res.json({ counted, stats: await currentStats() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/play", async (req, res, next) => {
  try {
    const visitorId = await ensureVisitorSession(req, res);
    const row = await getVisitorFlags(visitorId);
    let counted = false;

    if (!row || !row.play_counted) {
      counted = true;
      await incrementMetric("play", req);
      await setVisitorFlag(visitorId, "play_counted");
    }

    res.json({ counted, stats: await currentStats() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/stats", async (req, res, next) => {
  try {
    res.json({ stats: await currentStats() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/stats", requireAdmin, async (req, res, next) => {
  try {
    let days;
    let logs;
    const stats = await currentStats();
    const deployment = await getDeploymentManifest();

    if (useSupabase) {
      const [daysResult, logsResult] = await Promise.all([
        supabase.from("daily_stats").select("day,visits,plays").order("day", { ascending: false }).limit(30),
        supabase.from("logs").select("id,type,created_at,meta").order("id", { ascending: false }).limit(100)
      ]);
      if (daysResult.error) {
        throw daysResult.error;
      }
      if (logsResult.error) {
        throw logsResult.error;
      }
      days = daysResult.data;
      logs = logsResult.data;
    } else {
      [days, logs] = await Promise.all([
        db.all("SELECT day, visits, plays FROM daily_stats ORDER BY day DESC LIMIT 30"),
        db.all("SELECT id, type, created_at, meta FROM logs ORDER BY id DESC LIMIT 100")
      ]);
    }

    res.json({
      stats,
      days: days.reverse(),
      deployment,
      logs: logs.map((log) => ({
        ...log,
        meta: typeof log.meta === "string" && log.meta ? JSON.parse(log.meta) : log.meta || {}
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/reset", requireAdmin, async (req, res, next) => {
  try {
    if (useSupabase) {
      const { error } = await supabase.rpc("reset_metrics");
      if (error) {
        throw error;
      }
    } else {
      await db.exec(`
        UPDATE counters SET value = 0;
        DELETE FROM logs;
        DELETE FROM daily_stats;
        UPDATE sessions SET visit_counted = 0, play_counted = 0;
      `);
    }
    res.json({ ok: true, stats: await currentStats() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/upload", requireAdmin, upload.array("gameFiles", 200), async (req, res, next) => {
  try {
    await installUploadedGame(req.files);
    await cleanupUploads(req.files);
    res.json({ ok: true, message: "Juego actualizado correctamente." });
  } catch (error) {
    await cleanupUploads(req.files);
    next(error);
  }
});

if (useSupabase) {
  app.get("/game/*", serveSupabaseGameFile);
  app.get("/game", serveSupabaseGameFile);
}

app.use(express.static(publicDir, {
  extensions: ["html"],
  setHeaders(res) {
    res.setHeader("Cache-Control", "no-store");
  }
}));

app.use((req, res) => {
  res.status(404).json({ error: "No encontrado" });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({
    error: error.message || "Error interno del servidor"
  });
});

async function start() {
  await ensureDirectories();
  await initDatabase();
  if (!await getDeploymentManifest()) {
    await writeDeploymentManifest();
  }
  app.listen(PORT, () => {
    console.log(`Servidor listo en http://localhost:${PORT}`);
    console.log(`Admin: http://localhost:${PORT}/admin`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
