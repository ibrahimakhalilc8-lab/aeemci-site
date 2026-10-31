const API = "/api";
const form = document.querySelector("#registration-form");
const formMessage = document.querySelector("#form-message");
const eventSelect = document.querySelector("#eventId");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const adminPanel = document.querySelector("#admin-panel");
const tableBody = document.querySelector("#registrations-table");
const searchInput = document.querySelector("#search-input");
const eventForm = document.querySelector("#event-form");
const eventMessage = document.querySelector("#event-message");
const newsForm = document.querySelector("#news-form");
const newsMessage = document.querySelector("#news-message");
const dashboardMessage = document.querySelector("#dashboard-message");
let registrations = [];
let sessionToken = "";

document.querySelector("#year").textContent = new Date().getFullYear();

function showMessage(element, message, type = "") {
  element.textContent = message;
  element.className = `form-message ${type}`.trim();
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Une erreur est survenue.");
  return data;
}

async function loadPublicContent() {
  try {
    const [events, news] = await Promise.all([api("/events"), api("/news")]);
    eventSelect.replaceChildren(new Option("Choisir une activité", ""));
    const activeEvents = events.filter(event => event.status === "open");
    if (!activeEvents.length) {
      eventSelect.replaceChildren(new Option("Aucune inscription ouverte", ""));
    }
    activeEvents.forEach(event => eventSelect.add(new Option(`${event.title} — ${event.event_date}`, event.id)));

    const newsList = document.querySelector("#news-list");
    newsList.replaceChildren();
    if (!news.length) newsList.innerHTML = '<article class="news-card"><span class="tag">Information</span><h3>Aucune actualité publiée</h3><p>Les nouvelles annonces apparaîtront ici.</p></article>';
    news.forEach(item => {
      const article = document.createElement("article");
      article.className = "news-card";
      const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = item.category || "Actualité";
      const title = document.createElement("h3"); title.textContent = item.title;
      const body = document.createElement("p"); body.textContent = item.body;
      article.append(tag, title, body); newsList.append(article);
    });

    const eventList = document.querySelector("#event-list");
    eventList.replaceChildren();
    if (!events.length) eventList.innerHTML = '<article class="event-card"><div class="event-date"><span>AEEMCI</span><strong>À annoncer</strong></div><div class="event-body"><h3>Aucune activité publiée</h3><p>Les événements seront affichés ici.</p></div></article>';
    events.forEach(event => {
      const article = document.createElement("article"); article.className = "event-card";
      const date = document.createElement("div"); date.className = "event-date";
      const label = document.createElement("span"); label.textContent = "ACTIVITÉ";
      const dateValue = document.createElement("strong"); dateValue.textContent = event.event_date;
      date.append(label, dateValue);
      const body = document.createElement("div"); body.className = "event-body";
      const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = event.status === "open" ? "Inscriptions ouvertes" : "Inscriptions fermées";
      const title = document.createElement("h3"); title.textContent = event.title;
      const description = document.createElement("p"); description.textContent = event.description || "Consulte les informations auprès des organisateurs.";
      body.append(tag, title, description); article.append(date, body); eventList.append(article);
    });
  } catch (error) {
    eventSelect.replaceChildren(new Option("Serveur indisponible", ""));
    showMessage(formMessage, "Impossible de charger les activités. Vérifie que le serveur est démarré.", "error");
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  showMessage(formMessage, "");
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form).entries());
  data.consent = document.querySelector("#consent").checked;
  try {
    const result = await api("/registrations", { method: "POST", body: JSON.stringify(data) });
    form.reset();
    showMessage(formMessage, `Inscription enregistrée. Référence : ${result.reference}`, "success");
  } catch (error) {
    showMessage(formMessage, error.message, "error");
  }
});

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  showMessage(loginMessage, "");
  try {
    const result = await api("/admin/login", { method: "POST", body: JSON.stringify({
      email: document.querySelector("#adminEmail").value,
      password: document.querySelector("#adminPassword").value
    }) });
    sessionToken = result.token;
    loginForm.hidden = true;
    adminPanel.hidden = false;
    await loadDashboard();
    await loadRegistrations();
  } catch (error) {
    showMessage(loginMessage, error.message, "error");
  }
});

async function loadDashboard() {
  try {
    const stats = await api("/admin/overview");
    document.querySelector("#stat-registrations").textContent = stats.registrations;
    document.querySelector("#stat-events").textContent = stats.events;
    document.querySelector("#stat-open-events").textContent = stats.openEvents;
    document.querySelector("#stat-news").textContent = stats.news;
    showMessage(dashboardMessage, "");
  } catch (error) {
    showMessage(dashboardMessage, "Impossible de charger les statistiques : " + error.message, "error");
  }
}

async function loadRegistrations() {
  try {
    registrations = await api("/admin/registrations");
    renderRegistrations();
  } catch (error) {
    showMessage(loginMessage, error.message, "error");
    if (error.message.toLowerCase().includes("session") || error.message.toLowerCase().includes("token")) logout();
  }
}

function renderRegistrations() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = registrations.filter(item =>
    [item.full_name, item.email, item.phone, item.institution, item.event_title]
      .some(value => String(value || "").toLowerCase().includes(query))
  );
  tableBody.replaceChildren();
  filtered.forEach(item => {
    const row = document.createElement("tr");
    [item.full_name, `${item.email} · ${item.phone}`, item.institution, item.event_title, item.created_at].forEach(value => {
      const cell = document.createElement("td"); cell.textContent = value; row.append(cell);
    });
    tableBody.append(row);
  });
  document.querySelector("#admin-summary").textContent = `${filtered.length} inscription(s) affichée(s) sur ${registrations.length}.`;
}
searchInput.addEventListener("input", renderRegistrations);

document.querySelector("#export-button").addEventListener("click", () => {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = registrations.filter(item =>
    [item.full_name, item.email, item.phone, item.institution, item.event_title]
      .some(value => String(value || "").toLowerCase().includes(query))
  );
  const columns = ["Nom et prénoms", "E-mail", "Téléphone", "Établissement", "Niveau", "Activité", "Date d'inscription"];
  const rows = filtered.map(item => [item.full_name, item.email, item.phone, item.institution, item.level, item.event_title, item.created_at]);
  const csvCell = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = "\uFEFF" + [columns, ...rows].map(row => row.map(csvCell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a"); link.href = url; link.download = "inscriptions_aeemci.csv"; link.click();
  URL.revokeObjectURL(url);
});

document.querySelector("#logout-button").addEventListener("click", logout);
function logout() {
  sessionToken = ""; registrations = [];
  adminPanel.hidden = true; loginForm.hidden = false; loginForm.reset();
  tableBody.replaceChildren(); eventForm.reset(); showMessage(eventMessage, ""); newsForm.reset(); showMessage(newsMessage, ""); showMessage(loginMessage, "Déconnexion effectuée.");
}
eventForm.addEventListener("submit", async event => {
  event.preventDefault();
  showMessage(eventMessage, "");
  try {
    await api("/admin/events", { method: "POST", body: JSON.stringify({
      title: document.querySelector("#eventTitle").value,
      event_date: document.querySelector("#eventDate").value,
      description: document.querySelector("#eventDescription").value,
      status: document.querySelector("#eventStatus").value
    }) });
    eventForm.reset();
    showMessage(eventMessage, "Activité publiée. Elle apparaît maintenant sur le site.", "success");
    await loadPublicContent();
  } catch (error) {
    showMessage(eventMessage, error.message, "error");
  }
});

newsForm.addEventListener("submit", async event => {
  event.preventDefault();
  showMessage(newsMessage, "");
  try {
    await api("/admin/news", { method: "POST", body: JSON.stringify({
      title: document.querySelector("#newsTitle").value,
      category: document.querySelector("#newsCategory").value,
      body: document.querySelector("#newsBody").value
    }) });
    newsForm.reset();
    showMessage(newsMessage, "Actualité publiée. Elle apparaît maintenant sur le site.", "success");
    await loadPublicContent();
  } catch (error) {
    showMessage(newsMessage, error.message, "error");
  }
});

loadPublicContent();
