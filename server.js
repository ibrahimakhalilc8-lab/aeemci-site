require("dotenv").config();

const express = require("express");
const { neon } = require("@neondatabase/serverless");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL est absente. Configure cette variable dans Render.");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(express.json({ limit: "30kb" }));
app.use(express.static(path.join(__dirname, "public")));

function query(text, params = []) {
  return sql.query(text, params);
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function clean(value, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

const sessions = new Map();

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) {
    sessions.delete(token);
    return res.status(401).json({ error: "Session expirée ou non autorisée. Reconnecte-toi." });
  }
  next();
}

async function initializeDatabase() {
  await query("CREATE TABLE IF NOT EXISTS events (id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', event_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await query("CREATE TABLE IF NOT EXISTS news (id SERIAL PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Actualité', published BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await query("CREATE TABLE IF NOT EXISTS registrations (id SERIAL PRIMARY KEY, reference TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, institution TEXT NOT NULL, level TEXT NOT NULL, event_id INTEGER NOT NULL REFERENCES events(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await query("CREATE TABLE IF NOT EXISTS admins (id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL)");
  await query("CREATE UNIQUE INDEX IF NOT EXISTS registrations_event_email_unique ON registrations (event_id, LOWER(email))");

  const eventCount = await query("SELECT COUNT(*)::int AS count FROM events");
  if (eventCount[0].count === 0) {
    await query(
      "INSERT INTO events (title, description, event_date, status) VALUES ($1, $2, $3, $4)",
      ["Activité de lancement", "Événement de démonstration à remplacer par une activité officielle.", "À préciser", "closed"]
    );
  }

  const newsCount = await query("SELECT COUNT(*)::int AS count FROM news");
  if (newsCount[0].count === 0) {
    await query(
      "INSERT INTO news (title, body, category) VALUES ($1, $2, $3)",
      ["Bienvenue sur la plateforme", "Les annonces officielles de l'AEEMCI Universitaire seront publiées ici.", "Information"]
    );
  }
}

app.get("/health", asyncRoute(async (req, res) => {
  await query("SELECT 1");
  res.status(200).json({ status: "ok", database: "connected" });
}));

app.get("/api/events", asyncRoute(async (req, res) => {
  const rows = await query("SELECT id, title, description, event_date, status FROM events ORDER BY id DESC");
  res.json(rows);
}));

app.get("/api/news", asyncRoute(async (req, res) => {
  const rows = await query("SELECT id, title, body, category, created_at FROM news WHERE published = TRUE ORDER BY id DESC LIMIT 30");
  res.json(rows);
}));

app.post("/api/registrations", asyncRoute(async (req, res) => {
  const fullName = clean(req.body.fullName, 120);
  const email = clean(req.body.email, 160).toLowerCase();
  const phone = clean(req.body.phone, 25);
  const institution = clean(req.body.institution, 160);
  const level = clean(req.body.level, 50);
  const eventId = Number(req.body.eventId);

  if (!fullName || fullName.length < 3 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      phone.length < 8 || !institution || !level ||
      !Number.isInteger(eventId) || req.body.consent !== true) {
    return res.status(400).json({ error: "Vérifie les champs obligatoires et confirme ton consentement." });
  }

  const selectedEvent = await query("SELECT id, title, status FROM events WHERE id = $1 LIMIT 1", [eventId]);
  if (!selectedEvent.length || selectedEvent[0].status !== "open") {
    return res.status(400).json({ error: "Cette activité n'accepte pas actuellement d'inscriptions." });
  }

  const reference = "AU-" + crypto.randomBytes(4).toString("hex").toUpperCase();
  try {
    await query(
      "INSERT INTO registrations (reference, full_name, email, phone, institution, level, event_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [reference, fullName, email, phone, institution, level, eventId]
    );
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Cette adresse e-mail est déjà inscrite à cette activité." });
    }
    throw error;
  }

  res.status(201).json({ message: "Inscription enregistrée.", reference });
}));

app.post("/api/admin/setup", asyncRoute(async (req, res) => {
  const existing = await query("SELECT COUNT(*)::int AS count FROM admins");
  const setupKey = process.env.ADMIN_SETUP_KEY;

  if (existing[0].count > 0) {
    return res.status(403).json({ error: "Un administrateur existe déjà." });
  }
  if (!setupKey || req.body.setupKey !== setupKey) {
    return res.status(403).json({ error: "Clé de configuration incorrecte." });
  }

  const email = clean(req.body.email, 160).toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) {
    return res.status(400).json({ error: "E-mail invalide ou mot de passe trop court (12 caractères minimum)." });
  }

  const hash = await bcrypt.hash(password, 12);
  try {
    await query("INSERT INTO admins (email, password_hash) VALUES ($1, $2)", [email, hash]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Cet administrateur existe déjà." });
    }
    throw error;
  }

  res.status(201).json({ message: "Administrateur créé. Tu peux maintenant te connecter." });
}));

app.post("/api/admin/login", asyncRoute(async (req, res) => {
  const email = clean(req.body.email, 160).toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const rows = await query("SELECT id, email, password_hash FROM admins WHERE email = $1 LIMIT 1", [email]);
  const admin = rows[0];

  if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
    return res.status(401).json({ error: "Identifiants incorrects." });
  }

  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { adminId: admin.id, expires: Date.now() + 8 * 60 * 60 * 1000 });
  res.json({ token });
}));

app.get("/api/admin/registrations", requireAdmin, asyncRoute(async (req, res) => {
  const rows = await query(
    "SELECT r.reference, r.full_name, r.email, r.phone, r.institution, r.level, e.title AS event_title, r.created_at FROM registrations r JOIN events e ON e.id = r.event_id ORDER BY r.created_at DESC"
  );
  res.json(rows);
}));

app.post("/api/admin/events", requireAdmin, asyncRoute(async (req, res) => {
  const title = clean(req.body.title, 160);
  const description = clean(req.body.description, 2000);
  const eventDate = clean(req.body.event_date, 40);
  const status = req.body.status === "closed" ? "closed" : "open";

  if (!title || !eventDate) {
    return res.status(400).json({ error: "Titre et date obligatoires." });
  }

  const result = await query(
    "INSERT INTO events (title, description, event_date, status) VALUES ($1, $2, $3, $4) RETURNING id",
    [title, description, eventDate, status]
  );
  res.status(201).json({ id: result[0].id });
}));

app.post("/api/admin/news", requireAdmin, asyncRoute(async (req, res) => {
  const title = clean(req.body.title, 160);
  const body = clean(req.body.body, 4000);
  const category = clean(req.body.category, 60) || "Actualité";

  if (!title || !body) {
    return res.status(400).json({ error: "Titre et contenu obligatoires." });
  }

  const result = await query(
    "INSERT INTO news (title, body, category) VALUES ($1, $2, $3) RETURNING id",
    [title, body, category]
  );
  res.status(201).json({ id: result[0].id });
}));

app.use((err, req, res, next) => {
  console.error("Erreur serveur :", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Une erreur interne est survenue. Réessaie plus tard." });
});

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log("AEEMCI Universitaire lancé sur le port " + PORT);
      console.log("Base de données PostgreSQL Neon connectée.");
    });
  })
  .catch(error => {
    console.error("Échec de l'initialisation de PostgreSQL :", error);
    process.exit(1);
  });
