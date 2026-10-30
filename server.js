const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const DATABASE_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, "aeemci.sqlite");
fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
const db = new Database(DATABASE_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Actualité',
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  institution TEXT NOT NULL,
  level TEXT NOT NULL,
  event_id INTEGER NOT NULL REFERENCES events(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);
`);

const count = db.prepare("SELECT COUNT(*) AS count FROM events").get().count;
if (count === 0) {
  db.prepare("INSERT INTO events (title,description,event_date,status) VALUES (?,?,?,?)")
    .run("Activité de lancement", "Événement de démonstration à remplacer par une activité officielle.", "À préciser", "closed");
}
const newsCount = db.prepare("SELECT COUNT(*) AS count FROM news").get().count;
if (newsCount === 0) {
  db.prepare("INSERT INTO news (title,body,category) VALUES (?,?,?)")
    .run("Bienvenue sur la plateforme", "Les annonces officielles de l'AEEMCI Universitaire seront publiées ici.", "Information");
}

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

app.get("/health", (req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.status(200).json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "error" });
  }
});

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
function clean(value, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

app.get("/api/events", (req, res) => {
  res.json(db.prepare("SELECT id,title,description,event_date,status FROM events ORDER BY id DESC").all());
});
app.get("/api/news", (req, res) => {
  res.json(db.prepare("SELECT id,title,body,category,created_at FROM news WHERE published=1 ORDER BY id DESC LIMIT 30").all());
});

app.post("/api/registrations", (req, res) => {
  const fullName = clean(req.body.fullName, 120);
  const email = clean(req.body.email, 160).toLowerCase();
  const phone = clean(req.body.phone, 25);
  const institution = clean(req.body.institution, 160);
  const level = clean(req.body.level, 50);
  const eventId = Number(req.body.eventId);
  if (!fullName || fullName.length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      phone.length < 8 || !institution || !level || !Number.isInteger(eventId) || req.body.consent !== true) {
    return res.status(400).json({ error: "Vérifie les champs obligatoires et confirme ton consentement." });
  }
  const selectedEvent = db.prepare("SELECT id,title,status FROM events WHERE id=?").get(eventId);
  if (!selectedEvent || selectedEvent.status !== "open") {
    return res.status(400).json({ error: "Cette activité n'accepte pas actuellement d'inscriptions." });
  }
  const duplicate = db.prepare("SELECT id FROM registrations WHERE event_id=? AND lower(email)=lower(?)").get(eventId, email);
  if (duplicate) return res.status(409).json({ error: "Cette adresse e-mail est déjà inscrite à cette activité." });

  const reference = "AU-" + crypto.randomBytes(4).toString("hex").toUpperCase();
  db.prepare(`INSERT INTO registrations (reference,full_name,email,phone,institution,level,event_id)
    VALUES (?,?,?,?,?,?,?)`).run(reference, fullName, email, phone, institution, level, eventId);
  res.status(201).json({ message: "Inscription enregistrée.", reference });
});

// Create the first administrator once using environment variables.
app.post("/api/admin/setup", async (req, res) => {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM admins").get().count;
  const setupKey = process.env.ADMIN_SETUP_KEY;
  if (existing > 0) return res.status(403).json({ error: "Un administrateur existe déjà." });
  if (!setupKey || req.body.setupKey !== setupKey) return res.status(403).json({ error: "Clé de configuration incorrecte." });
  const email = clean(req.body.email, 160).toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) {
    return res.status(400).json({ error: "E-mail invalide ou mot de passe trop court (12 caractères minimum)." });
  }
  const hash = await bcrypt.hash(password, 12);
  db.prepare("INSERT INTO admins (email,password_hash) VALUES (?,?)").run(email, hash);
  res.status(201).json({ message: "Administrateur créé. Tu peux maintenant te connecter." });
});

app.post("/api/admin/login", async (req, res) => {
  const email = clean(req.body.email, 160).toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const admin = db.prepare("SELECT * FROM admins WHERE email=?").get(email);
  if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
    return res.status(401).json({ error: "Identifiants incorrects." });
  }
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { adminId: admin.id, expires: Date.now() + 8 * 60 * 60 * 1000 });
  res.json({ token });
});

app.get("/api/admin/registrations", requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT r.reference,r.full_name,r.email,r.phone,r.institution,r.level,
    e.title AS event_title,r.created_at FROM registrations r JOIN events e ON e.id=r.event_id
    ORDER BY r.created_at DESC`).all();
  res.json(rows);
});

// Management endpoints: admin-only; can be called by a future management UI or API client.
app.post("/api/admin/events", requireAdmin, (req, res) => {
  const title = clean(req.body.title, 160);
  const description = clean(req.body.description, 2000);
  const eventDate = clean(req.body.event_date, 40);
  const status = req.body.status === "closed" ? "closed" : "open";
  if (!title || !eventDate) return res.status(400).json({ error: "Titre et date obligatoires." });
  const result = db.prepare("INSERT INTO events (title,description,event_date,status) VALUES (?,?,?,?)")
    .run(title, description, eventDate, status);
  res.status(201).json({ id: result.lastInsertRowid });
});
app.post("/api/admin/news", requireAdmin, (req, res) => {
  const title = clean(req.body.title, 160);
  const body = clean(req.body.body, 4000);
  const category = clean(req.body.category, 60) || "Actualité";
  if (!title || !body) return res.status(400).json({ error: "Titre et contenu obligatoires." });
  const result = db.prepare("INSERT INTO news (title,body,category) VALUES (?,?,?)").run(title, body, category);
  res.status(201).json({ id: result.lastInsertRowid });
});

app.listen(PORT, () => {
  console.log(`AEEMCI Universitaire lancé sur http://localhost:${PORT}`);
  console.log(`Base de données : ${DATABASE_PATH}`);
  console.log("Configure le premier administrateur avec la procédure du README.");
});
