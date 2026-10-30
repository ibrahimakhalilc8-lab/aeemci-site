// create-admin.js
// Crée un compte administrateur directement dans la base SQLite locale.
// Utilisation (depuis le dossier du projet) : node create-admin.js

const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const readline = require("readline");

// Même emplacement de base que server.js
const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "aeemci.sqlite"));

// Même table que dans server.js (ne fait rien si elle existe déjà)
db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);
`);

// --- Lecture du clavier -------------------------------------------------
// Une seule interface de lecture pour tout le script ; les lignes tapées sont
// mises en file d'attente et lues l'une après l'autre.
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: Boolean(process.stdin.isTTY)
});
let muted = false; // true = ce qui est tapé n'est pas affiché (mot de passe)
const normalWrite = rl._writeToOutput;
rl._writeToOutput = function (text) {
  if (muted) return;
  normalWrite.call(rl, text);
};
const lines = [];
const waiters = [];
let closed = false;
rl.on("line", line => {
  const waiter = waiters.shift();
  if (waiter) waiter(line);
  else lines.push(line);
});
rl.on("close", () => {
  closed = true;
  while (waiters.length) waiters.shift()("");
});

// Pose une question dans le terminal. Si hidden = true, la saisie reste invisible.
function ask(question, hidden = false) {
  process.stdout.write(question);
  muted = hidden;
  return new Promise(resolve => {
    const done = line => {
      muted = false;
      if (hidden && process.stdin.isTTY) process.stdout.write("\n");
      resolve(line);
    };
    if (lines.length) done(lines.shift());
    else if (closed) done("");
    else waiters.push(done);
  });
}

async function main() {
  console.log("=== Création d'un administrateur AEEMCI Universitaire ===\n");

  const email = (await ask("Adresse e-mail de l'administrateur : ")).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.log("\nErreur : adresse e-mail invalide. Relance la commande.");
    rl.close();
    process.exit(1);
  }

  const password = await ask("Mot de passe (12 caractères minimum, rien ne s'affiche) : ", true);
  if (password.length < 12) {
    console.log("\nErreur : mot de passe trop court (12 caractères minimum). Relance la commande.");
    rl.close();
    process.exit(1);
  }

  const confirmation = await ask("Retape le mot de passe : ", true);
  if (confirmation !== password) {
    console.log("\nErreur : les deux mots de passe sont différents. Relance la commande.");
    rl.close();
    process.exit(1);
  }

  const exists = db.prepare("SELECT id FROM admins WHERE email = ?").get(email);
  if (exists) {
    console.log("\nErreur : un administrateur avec cet e-mail existe déjà.");
    rl.close();
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  db.prepare("INSERT INTO admins (email, password_hash) VALUES (?, ?)").run(email, hash);
  console.log(`\nSuccès : administrateur créé pour ${email}.`);
  console.log("Tu peux maintenant démarrer le serveur et te connecter dans « Espace organisateur ».");
  rl.close();
}

main().catch(error => {
  console.log("\nUne erreur est survenue :", error.message);
  rl.close();
    process.exit(1);
});
