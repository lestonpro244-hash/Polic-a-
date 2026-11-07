/* La configuración sale de config.js:
   - Si la página la sirve el propio bot, config.js lo genera el bot solo.
   - Si la página está en GitHub, config.js es un archivo tuyo con 2 líneas (botUrl y clientId). */
const BOT_URL = (window.TP_CONFIG && window.TP_CONFIG.botUrl) || "";
const DISCORD_CLIENT_ID = (window.TP_CONFIG && window.TP_CONFIG.clientId) || "";

/* Los ciudadanos, multas, arrestos y advertencias viven en el BOT de Discord.
   Aquí solo se recuerda la sesión de Discord de este agente. */
const KEY = "terminal-policial-girona-v3";
const TOKEN_KEY = "terminal-policial-token";
const COLORS = ["#3b8cf0", "#c9863a", "#8a5fc7", "#d1566e", "#3fc48a", "#e0a02f", "#2fb5c4"];
const colorOf = (id) => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
const configurado = () => !!DISCORD_CLIENT_ID;

let DB = { agent: "", agentId: "", cuerpo: "", hideGuide: false, citizens: [], version: "", online: false, loaded: false };
(function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY) || "null"); if (d) DB.hideGuide = !!d.hideGuide; } catch (e) { /* sin almacenamiento */ }
})();
function save() { try { localStorage.setItem(KEY, JSON.stringify({ hideGuide: DB.hideGuide })); } catch (e) { /* ignorar */ } }

/* Sesión de Discord (se guarda solo el token temporal) */
function getToken() {
  try { const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null"); if (t && t.token && t.exp > Date.now()) return t.token; } catch (e) { /* nada */ }
  return "";
}
function setToken(token, segundos) { try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp: Date.now() + (segundos - 300) * 1000 })); } catch (e) { /* nada */ } }
function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* nada */ } }
function leerRetornoDiscord() {
  /* Al volver de Discord, el token llega en la dirección (#access_token=…) */
  const h = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (!h.get("access_token") && !h.get("error")) return null;
  history.replaceState(null, "", location.pathname + location.search);
  let st = ""; try { st = sessionStorage.getItem("tp-state") || ""; sessionStorage.removeItem("tp-state"); } catch (e) { /* nada */ }
  if (h.get("error")) return { error: h.get("error") };
  if (!st || h.get("state") !== st) return { error: "state" };
  setToken(h.get("access_token"), Number(h.get("expires_in")) || 3600);
  return { ok: true };
}
function irADiscord(sinPreguntar) {
  const st = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try { sessionStorage.setItem("tp-state", st); } catch (e) { /* nada */ }
  const u = new URL("https://discord.com/oauth2/authorize");
  u.searchParams.set("client_id", DISCORD_CLIENT_ID);
  u.searchParams.set("response_type", "token");
  u.searchParams.set("scope", "identify");
  u.searchParams.set("redirect_uri", location.origin + location.pathname);
  u.searchParams.set("state", st);
  if (sinPreguntar) u.searchParams.set("prompt", "none");
  location.href = u.toString();
}

/* Comunicación con el bot */
const apiUrl = (p) => BOT_URL.replace(/\/+$/, "") + p;
const apiHeaders = () => ({ "Content-Type": "application/json", "Authorization": "Bearer " + getToken(), "ngrok-skip-browser-warning": "1" });
async function apiGet(p) {
  const r = await fetch(apiUrl(p), { headers: apiHeaders(), signal: AbortSignal.timeout(12000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) { const e = new Error(j.error || `Error ${r.status}`); e.status = r.status; throw e; }
  return j;
}
function setOnline(on) {
  DB.online = on;
  const el = $("#sync"); if (!el) return;
  el.className = "sync " + (on ? "on" : "off");
  el.textContent = on ? "● Sincronizado" : "● Sin conexión";
}
function cerrarSesion(msg) {
  clearToken(); DB.agent = ""; DB.agentId = ""; DB.citizens = []; DB.version = ""; DB.loaded = false; setOnline(false);
  closeModal(); if (!$("#lock")) showLock(msg);
}
let syncing = false;
async function sync(force) {
  if (syncing || !DB.agentId || !getToken()) return;
  syncing = true;
  try {
    const j = await apiGet("/tablet/datos" + (force || !DB.version ? "" : "?v=" + DB.version));
    setOnline(true);
    if (!j.igual) {
      DB.citizens = j.ciudadanos; DB.version = j.version; DB.loaded = true;
      if (!$("#scrim") && !$("#lock")) { const v = $("#view"), top = v.scrollTop; render(); v.scrollTop = top; }
      renderSearch();
    }
  } catch (e) {
    setOnline(false);
    if (e.status === 401 || e.status === 403) cerrarSesion(e.message);
  }
  syncing = false;
}

/* Utilidades */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fdate = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
const eur = (n) => Number(n).toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pad = (n) => String(n).padStart(2, "0");
const plain = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "<");
const getC = (id) => DB.citizens.find((c) => c.id === String(id));
const debt = (c) => c.multas.filter((m) => m.estado === "Pendiente").reduce((a, m) => a + m.imp, 0);
const fullName = (c) => `${c.nombre} ${c.apellidos}`.trim();
const fdateTxt = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? fdate(v) : (v || "—"));

const IC = {
  home: '<path d="M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.4 3-5 6-5s5.4 1.6 6 5"/><circle cx="17" cy="9" r="2.4"/><path d="M16.5 14c2.6.1 4.1 1.5 4.5 4"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  fine: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  warn: '<path d="M5 4v17M5 5h12l-2.5 4L17 13H5"/>',
  cuffs: '<circle cx="8" cy="15" r="4.5"/><circle cx="17" cy="9" r="4.5"/><path d="M11.3 12h2.4"/>',
  adduser: '<circle cx="10" cy="8" r="3.4"/><path d="M3.5 20c.7-4 3.4-6 6.5-6s5.8 2 6.5 6M19 8v6M16 11h6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>'
};
const icon = (n, s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;

function photo(id, cls) {
  const color = colorOf(id);
  return `<svg class="${cls}" viewBox="0 0 84 106" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
    <rect width="84" height="106" fill="${color}" opacity=".3"/><rect width="84" height="106" fill="#0a1017" opacity=".4"/>
    <circle cx="42" cy="42" r="17" fill="${color}"/><path d="M8 106c2-24 16-34 34-34s32 10 34 34z" fill="${color}"/></svg>`;
}

/* Estado de la interfaz */
const S = { view: "home", cid: null, tab: "docs", pf: "all", rf: "all", q: "" };
const TITLES = { home: "Inicio", people: "Ciudadanos", citizen: "Ficha", records: "Registros", wanted: "Buscados" };
const NAV = [["home", "Inicio", "home"], ["people", "Ciudadanos", "users"], ["records", "Registros", "list"], ["wanted", "Buscados", "alert"]];

function feed() {
  const out = [];
  DB.citizens.forEach((c) => {
    c.adv.forEach((r) => out.push({ t: "adv", c, r }));
    c.multas.forEach((r) => out.push({ t: "multa", c, r }));
    c.arrestos.forEach((r) => out.push({ t: "arresto", c, r }));
  });
  out.sort((a, b) => b.r.f.localeCompare(a.r.f) || b.r.uid - a.r.uid);
  return out;
}

const arrestClass = (e) => (/busca/i.test(e) ? "bad solid" : e === "Cumplido" ? "info" : /Detenido|prisión/i.test(e) ? "bad" : "warn");

function recRow(it, showWho) {
  const { t, c, r } = it;
  let title = "", sub = "", side = "";
  if (t === "adv") { title = r.motivo; sub = `Agente: ${esc(r.agente)}`; side = `<span class="pill warn">Advertencia</span>`; }
  if (t === "multa") {
    title = r.infraccion; sub = `${esc(r.id)} · ${esc(r.agente)}`;
    side = `<span class="amount">${eur(r.imp)}</span><span class="pill ${r.estado === "Pagada" ? "ok" : "bad"}">${esc(r.estado)}</span>`;
  }
  if (t === "arresto") { title = r.cargos; sub = `${esc(r.condena)} · ${esc(r.agente)}`; side = `<span class="pill ${arrestClass(r.estado)}">${esc(r.estado)}</span>`; }
  const who = showWho ? `<button type="button" class="link" data-act="open" data-id="${c.id}">${esc(fullName(c))}</button> · ` : "";
  return `<div class="record"><time>${fdate(r.f)}</time>
    <div><h4>${esc(title)}</h4><p>${who}${sub}</p></div>
    <div class="side">${side}</div></div>`;
}

/* Vistas */
function skyline() {
  const cols = ["#e8b23a", "#d9693a", "#c9483f", "#e6c27a", "#b8523f", "#6f9bc8", "#e09a4a", "#d98c7a"];
  let seed = 11;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  let stars = "";
  for (let i = 0; i < 26; i++) stars += `<circle cx="${Math.floor(rnd() * 1200)}" cy="${Math.floor(rnd() * 80)}" r="${(0.7 + rnd()).toFixed(1)}" fill="#fff" opacity="${(0.35 + rnd() * 0.5).toFixed(2)}"/>`;
  let houses = "";
  for (let x = 8; x < 940;) {
    const w = 42 + Math.floor(rnd() * 26), h = 52 + Math.floor(rnd() * 44), top = 150 - h, col = cols[Math.floor(rnd() * cols.length)];
    houses += `<rect x="${x}" y="${top}" width="${w}" height="${h}" fill="${col}"/><path d="M${x - 2} ${top} L${x + w / 2} ${top - 11} L${x + w + 2} ${top}Z" fill="#6e2f26"/>`;
    for (let wy = top + 10; wy < 134; wy += 20) for (let wx = x + 8; wx < x + w - 10; wx += 15) houses += `<rect x="${wx}" y="${wy}" width="7" height="11" fill="${rnd() > 0.65 ? "#ffd978" : "#17213a"}" opacity=".85"/>`;
    x += w + 3;
  }
  const cath = `<g transform="translate(1010,0)"><path d="M0 150V124H10V130H20V136H30V142H40V150Z" fill="#a8946b"/><rect x="40" y="96" width="104" height="54" fill="#c9b58a"/><rect x="108" y="30" width="30" height="66" fill="#d6c496"/><path d="M106 30 123 6 140 30Z" fill="#8c7a56"/><rect x="119" y="44" width="8" height="16" rx="4" fill="#3a3226"/><circle cx="76" cy="116" r="10" fill="#9a8760"/></g>`;
  const scene = houses + cath;
  return `<svg viewBox="0 0 1200 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${stars}<circle cx="700" cy="26" r="10" fill="#f4e7b8"/>${scene}<rect y="150" width="1200" height="50" fill="#14305a"/><g transform="translate(0,300) scale(1,-1)" opacity=".22">${scene}</g></svg>`;
}

function guideHTML() {
  const step = (n, t, d) => `<li><span class="num">${n}</span><div><b>${t}</b><p>${d}</p></div></li>`;
  return `<section class="guide"><div class="guide-head"><h3 class="sec">¿Cómo funciona?</h3><button type="button" class="mini-btn" data-act="hide-guide">Ocultar</button></div>
    <ol>${step(1, "Busca", "Escribe el nombre o DNI en la barra de arriba.")}${step(2, "Consulta", "Mira su DNI, su carnet y si tiene multas o arrestos.")}${step(3, "Registra", "Multa, Advertencia o Arresto: se publica solo en Discord.")}</ol></section>`;
}

function statusBanner(c) {
  const pend = debt(c), nPend = c.multas.filter((m) => m.estado === "Pendiente").length;
  const arrestado = c.arrestos.some((a) => a.estado === "Detenido");
  const notes = [];
  if (arrestado) notes.push("actualmente detenido");
  if (pend) notes.push(`${nPend} multa${nPend > 1 ? "s" : ""} sin pagar (${eur(pend)})`);
  if (!c.dni) notes.push("sin DNI registrado");
  if (!c.carnet) notes.push("sin carnet de conducir");
  if (c.arrestos.length) notes.push(`${c.arrestos.length} arresto${c.arrestos.length > 1 ? "s" : ""} en su historial`);
  let tone = "ok", head = "Sin incidencias activas", ic = "check";
  if (c.buscado) { tone = "bad"; head = "Buscado · orden de busca y captura"; ic = "alert"; notes.unshift("actúa con precaución y avisa a central"); }
  else if (arrestado) { tone = "bad"; head = "Detenido ahora mismo"; ic = "alert"; }
  else if (pend || !c.dni) { tone = "warn"; head = "Tiene asuntos pendientes"; ic = "alert"; }
  return `<div class="banner ${tone}"><span class="bico">${icon(ic, 26)}</span><div><b>${head}</b><p>${notes.length ? notes.map(esc).join(" · ") : "Documentación en regla, sin multas ni antecedentes."}</p></div></div>`;
}

function openHelp() {
  openModal({
    title: "Cómo se usa", submit: "Entendido",
    body: `<div class="fld full help">
      <h4>Menú de la izquierda</h4>
      <ul><li><b>Inicio:</b> accesos rápidos y últimas actividades.</li><li><b>Ciudadanos:</b> todas las fichas (las mismas que en Discord).</li><li><b>Registros:</b> todas las multas, advertencias y arrestos juntos.</li><li><b>Buscados:</b> personas con orden de busca y captura.</li></ul>
      <h4>La ficha de un ciudadano</h4>
      <p>Arriba ves su estado de un vistazo. Con los botones Multa, Advertencia y Arresto, el mensaje se publica solo en Discord y queda guardado en su ficha. <b>Documentación → Discord</b> publica su ficha completa.</p>
      <h4>Colores</h4>
      <p><span class="pill ok">Verde</span> todo en regla · <span class="pill warn">Amarillo</span> pendiente · <span class="pill bad">Rojo</span> problema.</p>
      <h4>Sincronización</h4>
      <p>Todas las tablets y Discord comparten los mismos datos y se actualizan solos cada pocos segundos. Los DNI y carnets se crean en Discord con <b>/crear-dni</b> y <b>/crear-carnet</b>.</p>
      <button type="button" class="btn small" data-act="show-guide" style="margin-top:8px">Mostrar la guía en Inicio</button>
    </div>`,
    onSubmit() {}
  });
}

function showLock(aviso) {
  const l = document.createElement("div");
  l.className = "lock"; l.id = "lock";
  l.innerHTML = `<img src="logo.png" alt="Spanish Girona Roleplay" width="170" height="170">
    <div class="lock-time" id="lockclock"></div><div class="lock-date" id="lockdate"></div>
    <form class="lock-form" id="lockform" autocomplete="off">
      <label class="label" for="lpass">Contraseña</label>
      <input id="lpass" type="password" value="*******" readonly tabindex="-1" aria-hidden="true" style="text-align:center;letter-spacing:.3em;pointer-events:none">
      <div id="lockmsg" class="label" style="min-height:18px;color:var(--red)"></div>
      <button type="submit" class="btn primary" id="lockgo">Unirse</button>
    </form>
    <div class="lock-sky">${skyline()}</div>`;
  $("#screen").appendChild(l);
  const app = $(".app"); app.inert = true;
  tick();
  const msg = $("#lockmsg"), btn = $("#lockgo");
  if (aviso) msg.textContent = aviso;

  async function unirse() {
    if (!configurado()) { msg.textContent = "Falta el clientId (en config.js o en el .env del bot)."; return; }
    if (!getToken()) { try { localStorage.setItem("tp-joined", "1"); } catch (e) { /* nada */ } irADiscord(!!localStorage.getItem("tp-joined-ok")); return; }
    btn.disabled = true; btn.textContent = "Entrando…"; msg.textContent = "";
    try {
      const j = await apiGet("/tablet/yo");
      DB.agentId = j.agente.id; DB.agent = j.agente.nombre; DB.cuerpo = j.agente.cuerpo;
      try { localStorage.setItem("tp-joined-ok", "1"); } catch (e) { /* nada */ }
      app.inert = false; l.remove(); await sync(true); setOnline(true); render(); toast(`Turno iniciado · ${DB.agent}`);
    } catch (e) {
      btn.disabled = false; btn.textContent = "Unirse";
      if (e.status === 401) { clearToken(); msg.textContent = "Sesión caducada. Pulsa Unirse otra vez."; }
      else if (e.status === 403) msg.textContent = e.message;
      else msg.textContent = "No se pudo conectar con el bot. Inténtalo de nuevo en un momento.";
    }
  }
  $("#lockform").addEventListener("submit", (e) => { e.preventDefault(); unirse(); });

  /* ¿Volvemos de Discord? Entra solo, sin pulsar nada más. */
  const ret = window.__retornoDiscord;
  if (ret && ret.error) {
    if (ret.error === "interaction_required" || ret.error === "login_required" || ret.error === "consent_required") { try { localStorage.removeItem("tp-joined-ok"); } catch (e) { /* nada */ } irADiscord(false); return; }
    msg.textContent = ret.error === "access_denied" ? "Has cancelado el acceso con Discord." : "No se pudo iniciar sesión con Discord.";
  } else if (ret && ret.ok) unirse();
  window.__retornoDiscord = null;
}

function viewHome() {
  const wanted = DB.citizens.filter((c) => c.buscado);
  const all = feed();
  const pend = DB.citizens.reduce((a, c) => a + debt(c), 0);
  const nArr = DB.citizens.reduce((a, c) => a + c.arrestos.length, 0);
  const h = new Date().getHours();
  const greet = h < 7 || h >= 21 ? "Buenas noches" : h < 14 ? "Buenos días" : "Buenas tardes";
  const DESC = { "focus-q": "Busca por nombre o DNI", "add-fine": "Sanción con importe", "add-adv": "Aviso sin multa", "add-arrest": "Detención y condena" };
  const tile = (act, cls, ic, label) => `<button type="button" class="tile ${cls}" data-act="${act}"><span class="ico">${icon(ic)}</span><b>${label}</b><small>${DESC[act]}</small></button>`;
  return `
    <div class="hero"><div class="hero-sky">${skyline()}</div><div class="hello hero-text"><div class="label">Servicio activo · ${new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}</div><h2>${greet}, ${esc(DB.agent)}</h2></div></div>
    ${DB.hideGuide ? "" : guideHTML()}
    <div class="tiles" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      ${tile("focus-q", "t-line", "search", "Consultar ciudadano")}
      ${tile("add-fine", "t-yellow", "fine", "Poner multa")}
      ${tile("add-adv", "t-line", "warn", "Advertencia")}
      ${tile("add-arrest", "t-red", "cuffs", "Registrar arresto")}
    </div>
    <div class="kpis">
      <div class="kpi k-blue"><span class="label">Ciudadanos</span><b>${DB.citizens.length}</b></div>
      <div class="kpi k-yellow"><span class="label">Multas pendientes</span><b>${eur(pend)}</b></div>
      <div class="kpi k-red"><span class="label">Buscados</span><b>${wanted.length}</b></div>
      <div class="kpi"><span class="label">Arrestos</span><b>${nArr}</b></div>
    </div>
    <div class="cols">
      <section><h3 class="sec">Actividad reciente <button type="button" class="mini-btn" data-act="nav" data-view="records">Ver todo</button></h3>
        ${all.length ? `<div class="records">${all.slice(0, 6).map((i) => recRow(i, true)).join("")}</div>` : `<div class="empty">${DB.loaded ? "Aún no hay registros" : "Cargando datos del bot…"}</div>`}</section>
      <section><h3 class="sec">Buscados</h3>
        ${wanted.length ? `<div class="people" style="grid-template-columns:1fr">${wanted.map(personCard).join("")}</div>` : `<div class="empty">Nadie con orden activa</div>`}</section>
    </div>`;
}

function personCard(c) {
  const nombre = c.apellidos ? `${esc(c.apellidos)}, ${esc(c.nombre)}` : esc(c.nombre);
  return `<button type="button" class="person" data-act="open" data-id="${c.id}">
    ${photo(c.id, "photo")}
    <span class="info"><b>${nombre}</b><small>${esc(c.dni || "Sin DNI")}${c.slot === 2 ? " · PJ 2" : ""}</small>
    <span class="pills">${c.buscado ? '<span class="pill solid">Buscado</span>' : ""}${c.arrestos.some((a) => a.estado === "Detenido") ? '<span class="pill bad">Detenido</span>' : ""}${debt(c) ? `<span class="pill warn">${eur(debt(c))}</span>` : ""}${!c.carnet ? '<span class="pill info">Sin carnet</span>' : ""}</span></span></button>`;
}

function viewPeople() {
  const f = S.pf;
  const list = DB.citizens.filter((c) => f === "all" || (f === "wanted" && c.buscado) || (f === "debt" && debt(c) > 0));
  const chip = (id, label) => `<button type="button" class="chip" data-act="pf" data-f="${id}" aria-pressed="${f === id}">${label}</button>`;
  return `<div class="actions" style="justify-content:space-between">
      <div class="chips">${chip("all", "Todos")}${chip("wanted", "Buscados")}${chip("debt", "Con deuda")}</div>
      <span class="label">Los DNI se crean en Discord con /crear-dni</span></div>
    ${list.length ? `<div class="people">${list.map(personCard).join("")}</div>` : `<div class="empty">${DB.loaded ? "Ningún ciudadano con este filtro" : "Cargando datos del bot…"}</div>`}`;
}

function viewRecords() {
  const f = S.rf;
  const list = feed().filter((i) => f === "all" || i.t === f);
  const chip = (id, label) => `<button type="button" class="chip" data-act="rf" data-f="${id}" aria-pressed="${f === id}">${label}</button>`;
  return `<div class="chips">${chip("all", "Todo")}${chip("multa", "Multas")}${chip("adv", "Advertencias")}${chip("arresto", "Arrestos")}</div>
    ${list.length ? `<div class="records">${list.map((i) => recRow(i, true)).join("")}</div>` : `<div class="empty">Sin registros</div>`}`;
}

function viewWanted() {
  const w = DB.citizens.filter((c) => c.buscado);
  return w.length
    ? `<div class="people">${w.map(personCard).join("")}</div>`
    : `<div class="empty">Nadie con orden de busca y captura</div>`;
}

/* Reproduce el mensaje del DNI/carnet tal como se ve en Discord */
function mdTexto(t) {
  return esc(String(t || "").replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1").replace(/<@!?\d+>/g, "@usuario").replace(/<#\d+>/g, "#canal").replace(/<t:\d+(?::\w)?>/g, ""))
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/__(.+?)__/g, "<u>$1</u>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\n/g, "<br>");
}
function embedCard(d, vacio) {
  if (!d) return `<article class="embed embed-vacio"><h4>${esc(vacio)}</h4></article>`;
  const campos = (d.campos || []).map((f) => `<div class="ef"><b>${mdTexto(f.n)}</b><span>${mdTexto(f.v)}</span></div>`).join("");
  return `<article class="embed" style="--c:${/^#[0-9a-f]{6}$/i.test(d.color) ? d.color : "#1565c0"}">
    ${d.miniatura ? `<img class="emb-thumb" src="${esc(d.miniatura)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}
    ${d.titulo ? `<h4>${mdTexto(d.titulo)}</h4>` : ""}
    ${d.descripcion ? `<p>${mdTexto(d.descripcion)}</p>` : ""}
    ${campos ? `<div class="efs">${campos}</div>` : ""}
    ${d.imagen ? `<img class="emb-img" src="${esc(d.imagen)}" alt="Documento" loading="lazy" referrerpolicy="no-referrer">` : ""}
  </article>`;
}
function docId(c) {
  const l1 = `IDROL${(c.dni || "SINDNI")}<<<<<<<<<<<<<<<<`.slice(0, 30);
  const l2 = `${plain(c.apellidos)}<<${plain(c.nombre)}<<<<<<<<<<<<<<<<<<`.slice(0, 30);
  return `<article class="doc doc-id" aria-label="Documento nacional de identidad">
    <header><h3>DNI</h3><span>Documento Nacional<br>de Identidad</span></header>
    <div class="doc-grid">${photo(c.id, "photo")}
      <dl class="fields">
        <div class="wide"><dt>Apellidos</dt><dd>${esc(c.apellidos || "—")}</dd></div>
        <div class="wide"><dt>Nombre</dt><dd>${esc(c.nombre)}</dd></div>
        <div><dt>Nacionalidad</dt><dd>${esc(c.nacionalidad || "—")}</dd></div>
        <div><dt>Nacimiento</dt><dd>${esc(fdateTxt(c.nac))}</dd></div>
        <div class="wide"><dt>Nº documento</dt><dd>${esc(c.dni || "Sin DNI")}</dd></div>
        <div class="wide"><dt>Discord</dt><dd>${esc(c.discord)}</dd></div>
      </dl></div>
    <pre class="mrz" aria-hidden="true">${esc(l1)}\n${esc(l2)}</pre>
  </article>`;
}

function docLic(c) {
  const k = c.carnet;
  if (!k) return `<article class="doc doc-lic" aria-label="Permiso de conducción"><header><h3>PERMISO DE CONDUCIR</h3><span>Estado de Rol<br>Tráfico</span></header><span class="state bad">Sin carnet</span><div class="empty" style="margin:18px">Este ciudadano no tiene carnet de conducir.</div></article>`;
  return `<article class="doc doc-lic" aria-label="Permiso de conducción">
    <header><h3>PERMISO DE CONDUCIR</h3><span>Estado de Rol<br>Tráfico</span></header>
    <span class="state ok">Vigente</span>
    <div class="doc-grid">${photo(c.id, "photo")}
      <dl class="fields">
        <div class="wide"><dt>Titular</dt><dd>${esc(k.titular || fullName(c))}</dd></div>
        <div><dt>Nº permiso</dt><dd>${esc(k.num)}</dd></div>
        <div><dt>Expedición</dt><dd>${fdateTxt(k.exp)}</dd></div>
        <div class="wide"><dt>Categoría</dt><dd><span class="cats"><span>${esc(k.tipo || "B")}</span></span></dd></div>
      </dl></div>
  </article>`;
}

function viewCitizen() {
  const c = getC(S.cid);
  if (!c) { S.view = "people"; return viewPeople(); }
  const pend = debt(c);
  const tabs = [["docs", "Documentos", null], ["adv", "Advertencias", c.adv.length], ["multas", "Multas", c.multas.length], ["arrestos", "Arrestos", c.arrestos.length]];
  const rows = (t, arr) => arr.length
    ? `<div class="records">${arr.slice().sort((a, b) => b.f.localeCompare(a.f) || b.uid - a.uid).map((r) => recRow({ t, c, r }, false)).join("")}</div>`
    : `<div class="empty">${t === "adv" ? "Sin advertencias" : t === "multa" ? "Sin multas" : "Sin arrestos ni antecedentes"}</div>`;
  let panel = "";
  if (S.tab === "docs") panel = `<div class="docs">${c.docDni ? embedCard(c.docDni) : c.dni && c.nombre ? docId(c) : embedCard(null, "Sin DNI")}${c.docCarnet ? embedCard(c.docCarnet) : c.carnet ? docLic(c) : embedCard(null, "Sin carnet de conducir")}</div>`;
  if (S.tab === "adv") panel = rows("adv", c.adv);
  if (S.tab === "multas") panel = rows("multa", c.multas);
  if (S.tab === "arrestos") panel = rows("arresto", c.arrestos);
  return `
    <button type="button" class="btn ghost small back" data-act="nav" data-view="people">${icon("back", 18)} Ciudadanos</button>
    ${statusBanner(c)}
    <div class="subject">${photo(c.id, "photo")}
      <div class="subject-info">
        <div><div class="label">Ficha del ciudadano${c.slot === 2 ? " · Personaje 2" : ""}</div><h2>${esc(fullName(c))}</h2><div class="meta">${esc(c.dni || "Sin DNI")} · ${esc(fdateTxt(c.nac))} · Discord: ${esc(c.discord)}</div></div>
        <div class="pills">
          ${c.buscado ? '<span class="pill solid">Buscado</span>' : '<span class="pill ok">Sin orden activa</span>'}
          <span class="pill ${c.carnet ? "ok" : "info"}">${c.carnet ? "Carnet" + (c.carnet.tipo ? " " + esc(c.carnet.tipo) : "") : "Sin carnet"}</span>
          ${pend ? `<span class="pill warn">Deuda ${eur(pend)}</span>` : ""}
        </div>
        <div class="actions">
          <button type="button" class="btn primary small" data-act="add-fine" data-id="${c.id}">${icon("fine", 18)} Multa</button>
          <button type="button" class="btn small" data-act="add-adv" data-id="${c.id}">${icon("warn", 18)} Advertencia</button>
          <button type="button" class="btn danger small" data-act="add-arrest" data-id="${c.id}">${icon("cuffs", 18)} Arresto</button>
          <button type="button" class="btn small" data-act="send-docs" data-id="${c.id}">${icon("list", 18)} Documentación → Discord</button>
          <button type="button" class="btn ghost small" data-act="toggle-wanted" data-id="${c.id}">${c.buscado ? "Quitar búsqueda" : "Marcar como buscado"}</button>
        </div>
      </div></div>
    <div class="kpis">
      <div class="kpi k-yellow"><span class="label">Advertencias</span><b>${c.adv.length}</b></div>
      <div class="kpi ${pend ? "k-red" : ""}"><span class="label">Multas pendientes</span><b>${eur(pend)}</b></div>
      <div class="kpi ${c.arrestos.length ? "k-red" : ""}"><span class="label">Arrestos</span><b>${c.arrestos.length}</b></div>
      <div class="kpi k-blue"><span class="label">Multas totales</span><b>${c.multas.length}</b></div>
    </div>
    <div class="tabs" role="tablist" aria-label="Secciones de la ficha">
      ${tabs.map(([id, name, n]) => `<button type="button" role="tab" data-act="tab" data-tab="${id}" aria-selected="${S.tab === id}">${name}${n === null ? "" : `<span class="count">${n}</span>`}</button>`).join("")}
    </div>
    <div role="tabpanel">${panel}</div>`;
}

function render() {
  $("#title").textContent = TITLES[S.view];
  const nw = DB.citizens.filter((c) => c.buscado).length;
  $("#navbtns").innerHTML = NAV.map(([id, name, ic]) => {
    const cur = S.view === id || (S.view === "citizen" && id === "people");
    return `<button type="button" class="nav-btn" data-act="nav" data-view="${id}" ${cur ? 'aria-current="page"' : ""}>${icon(ic)}<span class="t">${name}</span>${id === "wanted" && nw ? `<span class="badge">${nw}</span>` : ""}</button>`;
  }).join("");
  $("#agentname").textContent = DB.agent;
  const v = { home: viewHome, people: viewPeople, citizen: viewCitizen, records: viewRecords, wanted: viewWanted }[S.view];
  const box = $("#view");
  box.innerHTML = v();
}

/* Buscador */
function renderSearch() {
  const sr = $("#sr"), q = S.q.trim().toLowerCase();
  if (!q) { sr.hidden = true; return; }
  const list = DB.citizens.filter((c) => `${c.nombre} ${c.apellidos} ${c.dni} ${c.discord}`.toLowerCase().includes(q)).slice(0, 6);
  sr.hidden = false;
  sr.innerHTML = list.length
    ? list.map((c) => `<button type="button" data-act="open" data-id="${c.id}">${photo(c.id, "photo").replace('class="photo"', 'width="30" height="38" style="border-radius:6px;flex:none"')}<span><b>${esc(fullName(c))}</b><br><small style="font-family:var(--font-mono);color:var(--dim)">${esc(c.dni || "Sin DNI")}</small></span>${c.buscado ? '<span class="pill solid" style="margin-left:auto">Buscado</span>' : ""}</button>`).join("")
    : `<div class="none">Sin resultados. Puedes crearlo con “Nuevo ciudadano”.</div>`;
}

/* Ventanas y avisos */
function toast(msg, ms = 2600) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function closeModal() { const m = $("#scrim"); if (m) m.remove(); }
function openModal({ title, tone = "", body, submit = "Guardar", onSubmit, onOpen, extraFoot = "" }) {
  closeModal();
  const m = document.createElement("div");
  m.className = "scrim"; m.id = "scrim";
  m.innerHTML = `<form class="sheet ${tone}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="sheet-head"><h3>${esc(title)}</h3><button type="button" class="icon-btn" data-close aria-label="Cerrar">${icon("close", 18)}</button></div>
    <div class="sheet-body">${body}</div>
    <div class="sheet-foot">${extraFoot}<button type="button" class="btn ghost" data-close>Cancelar</button><button type="submit" class="btn ${tone === "red" ? "danger" : tone === "blue" ? "blue" : "primary"}">${esc(submit)}</button></div></form>`;
  m.addEventListener("mousedown", (e) => { if (e.target === m) closeModal(); });
  m.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeModal(); });
  const form = $("form", m);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    if (btn.disabled) return;
    const r = onSubmit(new FormData(form), form);
    if (r && typeof r.then === "function") {
      const label = btn.textContent;
      btn.disabled = true; btn.textContent = "Enviando a Discord…";
      const v = await r;
      if (!form.isConnected) return;
      btn.disabled = false; btn.textContent = label;
      if (v !== false) closeModal();
    } else if (r !== false) closeModal();
  });
  $("#screen").appendChild(m);
  if (onOpen) onOpen(form);
  const first = form.querySelector("input:not([type=hidden]), select, textarea");
  if (first) first.focus();
}
const fld = (id, label, inner, cls = "") => `<div class="fld ${cls}"><label for="${id}">${label}</label>${inner}</div>`;
const inp = (id, val = "", attrs = "") => `<input id="${id}" name="${id}" value="${esc(val)}" ${attrs}>`;
function citizenSelect(cid) {
  return fld("cid", "Ciudadano", `<select id="cid" name="cid" required>${cid ? "" : '<option value="">Elige un ciudadano…</option>'}${DB.citizens.map((c) => `<option value="${c.id}" ${c.id === cid ? "selected" : ""}>${esc(fullName(c))} · ${esc(c.dni)}</option>`).join("")}</select>`, "full");
}
async function afterAdd(c, tab, msg) {
  S.view = "citizen"; S.cid = c.id; S.tab = tab;
  await sync(true); render(); toast(msg);
}

const PRESETS = [
  ["Exceso de velocidad leve", 100], ["Exceso de velocidad grave", 300], ["Estacionamiento indebido", 90],
  ["No llevar el cinturón de seguridad", 200], ["Uso del móvil al volante", 200], ["Saltarse un semáforo en rojo", 200],
  ["Conducir sin permiso", 500], ["Conducción temeraria", 1000], ["Alcoholemia positiva", 500]
];

/* Envío al bot de Discord: el bot publica el mensaje igual que el comando /... */
async function discord(cmd, c, datos) {
  if (!getToken() || !DB.agentId) { cerrarSesion("Pulsa Unirse para continuar."); return false; }
  try {
    const r = await fetch(apiUrl("/tablet/" + cmd), {
      method: "POST", headers: apiHeaders(),
      body: JSON.stringify({ usuario: c.discordId, ...datos }),
      signal: AbortSignal.timeout(20000)
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) { cerrarSesion(j.error); return false; }
    if (!r.ok || !j.ok) { toast("Discord: " + (j.error || `error ${r.status}`), 6000); return false; }
    return true;
  } catch (e) {
    toast("No se pudo conectar con el bot. Inténtalo de nuevo.", 6000);
    return false;
  }
}

function openFine(cid) {
  openModal({
    title: "Poner multa", tone: "", submit: "Registrar multa",
    body: citizenSelect(cid)
      + fld("preset", "Paso 1 · Elige una infracción habitual (rellena el resto)", `<select id="preset" name="preset"><option value="">Otra (escribir abajo)</option>${PRESETS.map((p, i) => `<option value="${i}">${esc(p[0])} · ${p[1]} €</option>`).join("")}</select>`, "full")
      + fld("inf", "Paso 2 · Motivo de la multa (puedes cambiarlo)", inp("inf", "", "required"), "full")
      + fld("imp", "Importe (€)", inp("imp", "100", 'type="number" min="1" step="1" required')),
    onOpen(f) {
      f.preset.addEventListener("change", () => {
        const p = PRESETS[f.preset.value];
        if (p) { f.inf.value = p[0]; f.imp.value = p[1]; }
      });
    },
    async onSubmit(f) {
      const c = getC(f.get("cid")); if (!c) return false;
      const imp = Math.round(Number(f.get("imp"))) || 0;
      if (imp < 1) { toast("El importe debe ser al menos 1 €"); return false; }
      if (!(await discord("multar", c, { motivo: f.get("inf").trim(), importe: imp }))) return false;
      await afterAdd(c, "multas", `Multa de ${eur(imp)} publicada en Discord`);
    }
  });
}
function openAdv(cid) {
  openModal({
    title: "Advertencia", submit: "Registrar advertencia",
    body: citizenSelect(cid) + fld("motivo", "Qué ha pasado", `<textarea id="motivo" name="motivo" required></textarea>`, "full"),
    async onSubmit(f) {
      const c = getC(f.get("cid")); if (!c) return false;
      if (!(await discord("advertencia", c, { motivo: f.get("motivo").trim() }))) return false;
      await afterAdd(c, "adv", "Advertencia publicada en Discord");
    }
  });
}
function openArrest(cid) {
  openModal({
    title: "Registrar arresto", tone: "red", submit: "Registrar arresto",
    body: citizenSelect(cid) + fld("cargos", "Motivo de la detención", `<textarea id="cargos" name="cargos" required></textarea>`, "full")
      + fld("cant", "Condena (número)", inp("cant", "30", 'type="number" min="1" step="1" required'))
      + fld("unidad", "Unidad", `<select id="unidad" name="unidad"><option value="minutos">Minutos (máx. 110)</option><option value="segundos">Segundos</option></select>`),
    async onSubmit(f) {
      const c = getC(f.get("cid")); if (!c) return false;
      if (!(await discord("arrestar", c, { motivo: f.get("cargos").trim(), cantidad: parseInt(f.get("cant"), 10), unidad: f.get("unidad") }))) return false;
      await afterAdd(c, "arrestos", "Arresto publicado en Discord");
    }
  });
}

function openAgent() {
  openModal({
    title: "Agente en servicio", submit: "Cerrar sesión",
    body: `<div class="fld full help"><p>Agente: <b>${esc(DB.agent)}</b> · ${esc(DB.cuerpo)}</p><p>Estado: <b>${DB.online ? "sincronizado con Discord" : "sin conexión"}</b></p></div>`,
    onSubmit() { setTimeout(() => cerrarSesion(), 0); }
  });
}

/* Eventos */
function go(view) { S.view = view; render(); $("#view").scrollTop = 0; }
function openCit(id) { S.view = "citizen"; S.cid = String(id); S.tab = "docs"; S.q = ""; $("#q").value = ""; renderSearch(); render(); $("#view").scrollTop = 0; }

let armTimer = null;
$("#screen").addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!e.target.closest("#searchbox")) $("#sr").hidden = true;
  if (!b) return;
  const d = b.dataset;
  switch (d.act) {
    case "nav": go(d.view); break;
    case "open": openCit(d.id); break;
    case "tab": S.tab = d.tab; render(); break;
    case "pf": S.pf = d.f; render(); break;
    case "rf": S.rf = d.f; render(); break;
    case "focus-q": $("#q").focus(); break;
    case "add-fine": openFine(d.id || (S.view === "citizen" ? S.cid : null)); break;
    case "add-adv": openAdv(d.id || (S.view === "citizen" ? S.cid : null)); break;
    case "add-arrest": openArrest(d.id || (S.view === "citizen" ? S.cid : null)); break;
    case "send-docs": {
      const c = getC(d.id); if (!c || b.disabled) break;
      b.disabled = true;
      discord("documentacion-antecedentes", c, {}).then((ok) => { b.disabled = false; if (ok) toast("Documentación enviada a Discord"); });
      break;
    }
    case "agent": openAgent(); break;
    case "help": openHelp(); break;
    case "hide-guide": DB.hideGuide = true; save(); render(); break;
    case "show-guide": DB.hideGuide = false; save(); closeModal(); go("home"); break;
    case "toggle-wanted": {
      const c = getC(d.id); if (!c || b.disabled) break;
      b.disabled = true;
      fetch(apiUrl("/tablet/buscado"), { method: "POST", headers: apiHeaders(), body: JSON.stringify({ usuario: c.discordId, buscado: !c.buscado }), signal: AbortSignal.timeout(15000) })
        .then((r) => r.json().then((j) => ({ r, j })))
        .then(async ({ r, j }) => { if (!r.ok || !j.ok) throw new Error(j.error || r.status); await sync(true); render(); toast(getC(d.id).buscado ? "Marcado como buscado" : "Búsqueda retirada"); })
        .catch((e) => { b.disabled = false; toast("No se pudo actualizar: " + e.message, 5000); });
      break;
    }
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeModal(); $("#sr").hidden = true; } });
$("#q").addEventListener("input", (e) => { S.q = e.target.value; renderSearch(); });
$("#q").addEventListener("focus", renderSearch);
$("#q").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { const first = $("#sr button[data-id]"); if (first) openCit(first.dataset.id); }
});

function tick() {
  const d = new Date(), t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  $("#clock").textContent = t;
  const lc = $("#lockclock");
  if (lc) { lc.textContent = t; $("#lockdate").textContent = d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }); }
}
window.__retornoDiscord = leerRetornoDiscord();
tick(); setInterval(tick, 15000); showLock();
render();
setInterval(() => { if (!document.hidden) sync(false); }, 8000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) sync(false); });
