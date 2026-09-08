const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Set it to your PostgreSQL connection string.");
  process.exit(1);
}

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/app.js", (req, res) => res.sendFile(path.join(__dirname, "app.js")));
app.get("/style.css", (req, res) => res.sendFile(path.join(__dirname, "style.css")));

const DAY = 86400000;

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS licenses (
      id BIGSERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      game TEXT NOT NULL,
      duration_days INTEGER NOT NULL,
      max_devices INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      devices JSONB NOT NULL DEFAULT '[]'::jsonb
    );

    CREATE TABLE IF NOT EXISTS events (
      id BIGSERIAL PRIMARY KEY,
      license_id BIGINT,
      action TEXT NOT NULL,
      ip TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT events_license_fk
        FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(key);
    CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
    CREATE INDEX IF NOT EXISTS idx_events_license_id ON events(license_id);
  `);
}

function makeKey(prefix = "YUNA") {
  return `${prefix}-${crypto.randomBytes(3).toString("hex").toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function addDays(date, n) {
  return new Date(date.getTime() + n * DAY);
}

function normalize(row) {
  if (!row) return null;
  return {
    ...row,
    devices: Array.isArray(row.devices) ? row.devices : [],
  };
}

async function log(id, action, req, client = pool) {
  await client.query(
    "INSERT INTO events(license_id, action, ip, created_at) VALUES($1,$2,$3,$4)",
    [id, action, req.ip, new Date()]
  );
}

async function get(id, client = pool) {
  const result = await client.query("SELECT * FROM licenses WHERE id=$1", [id]);
  return result.rows[0] || null;
}

app.get("/api/licenses", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM licenses ORDER BY id DESC");
    res.json(result.rows.map(normalize));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/licenses", async (req, res) => {
  const {
    game = "CUSTOM",
    duration_days = 30,
    max_devices = 1,
    prefix = "YUNA",
    custom_key = "",
  } = req.body;

  const d = Number(duration_days);
  const m = Number(max_devices);
  if (!Number.isInteger(d) || d < 1 || d > 36500 || !Number.isInteger(m) || m < 1 || m > 100) {
    return res.status(400).json({ error: "Invalid duration or device limit" });
  }

  const cleanPrefix = String(prefix).trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12) || "YUNA";
  const suppliedKey = String(custom_key || "").trim();
  const key = (suppliedKey || makeKey(cleanPrefix)).toUpperCase();
  const now = new Date();
  const exp = addDays(now, d);

  try {
    const result = await pool.query(
      `INSERT INTO licenses
        (key, game, duration_days, max_devices, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [key, String(game), d, m, now, exp]
    );

    await log(result.rows[0].id, "CREATED", req);
    res.json(normalize(result.rows[0]));
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Key already exists" });
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/activate", async (req, res) => {
  const key = String(req.body.key || "").toUpperCase().trim();
  const deviceId = String(req.body.device_id || "").trim();
  if (!key || !deviceId) {
    return res.status(400).json({ valid: false, error: "key and device_id required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the row so two simultaneous activations cannot exceed max_devices.
    const result = await client.query("SELECT * FROM licenses WHERE key=$1 FOR UPDATE", [key]);
    const row = result.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return res.status(404).json({ valid: false, error: "Invalid key" });
    }

    if (row.status !== "ACTIVE") {
      await client.query("ROLLBACK");
      return res.status(403).json({ valid: false, error: `Key is ${row.status.toLowerCase()}` });
    }

    if (Date.now() >= new Date(row.expires_at).getTime()) {
      await client.query("UPDATE licenses SET status='EXPIRED' WHERE id=$1", [row.id]);
      await client.query("COMMIT");
      return res.status(403).json({ valid: false, error: "Key expired" });
    }

    const devices = Array.isArray(row.devices) ? row.devices : [];
    let event = "CHECKED";
    if (!devices.includes(deviceId)) {
      if (devices.length >= row.max_devices) {
        await client.query("ROLLBACK");
        return res.status(403).json({ valid: false, error: "Maximum devices reached" });
      }
      devices.push(deviceId);
      await client.query("UPDATE licenses SET devices=$1::jsonb WHERE id=$2", [JSON.stringify(devices), row.id]);
      event = "ACTIVATED";
    }

    await log(row.id, event, req, client);
    await client.query("COMMIT");

    res.json({
      valid: true,
      key: row.key,
      game: row.game,
      expires_at: row.expires_at,
      devices_used: devices.length,
      max_devices: row.max_devices,
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ valid: false, error: "Database error" });
  } finally {
    client.release();
  }
});

app.post("/api/licenses/:id/revoke", async (req, res) => {
  try {
    const row = await get(req.params.id);
    if (!row) return res.sendStatus(404);
    await pool.query("UPDATE licenses SET status='REVOKED' WHERE id=$1", [row.id]);
    await log(row.id, "REVOKED", req);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/licenses/:id/reset-devices", async (req, res) => {
  try {
    const row = await get(req.params.id);
    if (!row) return res.sendStatus(404);
    await pool.query("UPDATE licenses SET devices='[]'::jsonb WHERE id=$1", [row.id]);
    await log(row.id, "DEVICES_RESET", req);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

app.delete("/api/licenses/:id", async (req, res) => {
  try {
    const row = await get(req.params.id);
    if (!row) return res.sendStatus(404);
    // Log before deleting because events use ON DELETE SET NULL.
    await log(row.id, "DELETED", req);
    await pool.query("DELETE FROM licenses WHERE id=$1", [row.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/api/licenses/:id/events", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT action,ip,created_at FROM events WHERE license_id=$1 ORDER BY id DESC",
      [req.params.id]
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

const port = Number(process.env.PORT) || 3000;

initDb()
  .then(() => {
    app.listen(port, () => console.log(`Yuna License Panel running on port ${port}`));
  })
  .catch((err) => {
    console.error("Failed to initialize PostgreSQL:", err);
    process.exit(1);
  });

process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});
