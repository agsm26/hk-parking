// app.js — the screen. Everything that decides is in core.js; this file fetches,
// stores and draws. Plain DOM, no framework, so it stays readable and small.
import * as C from "./core.js";

// ---------------------------------------------------------------- config ----
const FEEDS = {
  info: (lang) => `https://api.data.gov.hk/v1/carpark-info-vacancy?data=info&lang=${lang === "en" ? "en_US" : "zh_TW"}`,
  vacancy: "https://api.data.gov.hk/v1/carpark-info-vacancy?data=vacancy",
  meterInfo: "https://resource.data.one.gov.hk/td/psiparkingspaces/spaceinfo/parkingspaces.csv",
  meterOcc: "https://resource.data.one.gov.hk/td/psiparkingspaces/occupancystatus/occupancystatus.csv",
};
const REFRESH = { info: 6 * 3600e3, meters: 24 * 3600e3, metersSnapshot: 7 * 86400e3, vacancy: 60e3, meterVac: 120e3 };
const APP_VERSION = "2026-09-11b";                       // stamped by bump.py together with sw.js
const REPO_URL = "https://github.com/agsm26/hk-parking";  // issue reports go here
const FETCH_TIMEOUT = 8000;
// Map tiles: the Lands Department basemap through the CSDI portal (free, no
// key, Hong Kong only, labels in Chinese or English) with OpenStreetMap as the
// fallback if the government service is down.
const TILES = {
  gov: { base: "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/wgs84/{z}/{x}/{y}.png", label: (lang) => `https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/${lang === "en" ? "en" : "tc"}/wgs84/{z}/{x}/{y}.png`, attribution: '<a href="https://portal.csdi.gov.hk" target="_blank" rel="noopener">© Lands Department 地政總署</a>' },
  osm: { base: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' },
};
let tileProvider = "gov";
const qs = new URLSearchParams(location.search);

// ------------------------------------------------------------- storage ----
const LS = {
  get(k, fb) { try { const v = localStorage.getItem("chk_" + k); return v == null ? fb : JSON.parse(v); } catch { return fb; } },
  set(k, v) { try { localStorage.setItem("chk_" + k, JSON.stringify(v)); } catch {} },
};
// IndexedDB key-value for the big feed payloads (localStorage is too small).
const IDB = (() => {
  let dbp = null;
  const open = () => dbp ||= new Promise((res, rej) => {
    if (!("indexedDB" in self)) return rej(new Error("no idb"));
    const r = indexedDB.open("carparkhk", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return {
    async get(k) { try { const db = await open(); return await new Promise((res, rej) => { const t = db.transaction("kv").objectStore("kv").get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); } catch { return undefined; } },
    async set(k, v) { try { const db = await open(); await new Promise((res, rej) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch {} },
    async clear() { try { const db = await open(); await new Promise((res) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").clear(); t.oncomplete = res; t.onerror = res; }); } catch {} },
  };
})();

// --------------------------------------------------------------- state ----
const S = {
  lang: qs.get("lang") || LS.get("lang", null) || (/^(zh|yue)/i.test(navigator.language) ? "tc" : "en"),
  tab: qs.get("tab") || "find",
  origin: LS.get("origin", { type: "current" }),            // {type:'current'} | {type:'place', place}
  filter: { ...C.DEFAULT_FILTER(), ...LS.get("filter", {}) },
  sort: LS.get("sort", "bestMatch"),
  vehicles: LS.get("vehicles", []), activeVehicleId: LS.get("activeVehicleId", null),
  favs: LS.get("favs", []), recents: LS.get("recents", []), places: LS.get("places", []), searches: LS.get("searches", []),
  session: LS.get("session", null), lastSession: LS.get("lastSession", null), reports: LS.get("reports", []),
  alerts: LS.get("alerts", false), navApp: LS.get("navApp", "apple"),
  static: null,            // {osm, entrances, curated}
  feed: [],                // normalised one-stop car parks
  meters: { zones: [], index: {} },
  carparks: [],            // merged list
  vac: {}, vacAt: null, vacFromCache: false, infoAt: null, metersAt: null,
  ranked: [], all: [], lastError: null, phase: "idle", busy: false,
  geo: { pos: null, status: "unknown", error: null },
  now: Date.now(), fixed: null,
  errors: LS.get("errors", []), online: navigator.onLine !== false, onboarded: LS.get("onboarded", false), metersFromSnapshot: false,
  visits: LS.get("visits", {}),          // {carParkId: {n, lastAt}} — where you actually parked
  heading: LS.get("heading", null),      // {id, name, at} — set on Navigate, used by the arrival check
};
if (qs.get("lat") && qs.get("lng")) S.fixed = { lat: parseFloat(qs.get("lat")), lng: parseFloat(qs.get("lng")) };
const vehicle = () => S.vehicles.find(v => v.id === S.activeVehicleId) || S.vehicles[0] || null;
const L_ = (en, tc) => C.pick(S.lang, en, tc);
const T_ = (lt) => C.t(S.lang, lt);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const save = (k) => { LS.set(k, S[k]); if (!STORAGE_OK && !save.warned) { save.warned = true; toast(L_("Not saved: this browser blocks storage", "未能儲存：瀏覽器封鎖了儲存")); } };
let toastT;
function toast(msg) { const el = $("toast"); el.textContent = msg; el.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("on"), 2200); }
// Saving works only if this browser lets pages store data. Safari's "Block All
// Cookies" and some private modes refuse localStorage; iPhone also keeps
// separate storage for Safari and for the Home Screen app, so saves made in
// one do not appear in the other.
const STORAGE_OK = (() => { try { localStorage.setItem("chk__probe", "1"); const ok = localStorage.getItem("chk__probe") === "1"; localStorage.removeItem("chk__probe"); return ok; } catch { return false; } })();
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const IS_INSTALLED = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
function storageTip() {
  if (!STORAGE_OK) return `<div class="card" style="border-color:var(--warn,#b36b00)"><h2 style="margin:0 0 6px;font-size:16px">⚠️ ${esc(L_("This browser is not saving", "呢個瀏覽器唔會儲存"))}</h2><p class="note">${esc(L_("Favourites and vehicles cannot be kept because storage is blocked. On iPhone: Settings ▸ Apps ▸ Safari ▸ turn off \"Block All Cookies\". Private Browsing also discards saves when the tab closes.", "儲存功能被封鎖，常用同車輛資料無法保留。iPhone：設定 ▸ App ▸ Safari ▸ 關閉「封鎖所有 Cookie」。私密瀏覽亦會喺關閉分頁後清除。"))}</p></div>`;
  if (IS_IOS && !IS_INSTALLED()) return `<p class="note">💡 ${esc(L_("Saving here in Safari and in the Home Screen app are kept separately on iPhone. Add to Home Screen first (Share ▸ Add to Home Screen), then save your car and favourites inside that app so they stay.", "iPhone 會將 Safari 同主畫面 app 嘅儲存分開。請先加到主畫面（分享 ▸ 加入主畫面），再喺該 app 內儲存車輛同常用，資料就會保留。"))}</p>`;
  return "";
}

// ---------------------------------------------------------- origin -------
// ---- in-app dialog (replaces prompt/confirm/alert, which look broken in a
// Home Screen app and cannot be translated or styled) ----
let dlgResolve = null, dlgOpener = null;
function dialog({ title, text = "", fields = [], ok, cancel, okOnly = false, danger = false }) {
  return new Promise(resolve => {
    closeDialog(null);
    const el = $("dlg"); dlgOpener = document.activeElement; dlgResolve = resolve;
    const fld = fields.map(f => { const id = "dlg-" + f.id, lab = `<label for="${id}">${esc(f.label)}</label>`;
      if (f.type === "select") return `<div class="fld">${lab}<select id="${id}">${f.options.map(o => `<option value="${esc(o[0])}"${o[0] === f.value ? " selected" : ""}>${esc(o[1])}</option>`).join("")}</select></div>`;
      if (f.type === "textarea") return `<div class="fld">${lab}<textarea id="${id}" rows="3" placeholder="${esc(f.placeholder || "")}">${esc(f.value || "")}</textarea></div>`;
      return `<div class="fld">${lab}<input id="${id}" type="${f.type || "text"}" placeholder="${esc(f.placeholder || "")}" value="${esc(f.value ?? "")}" autocomplete="off"></div>`; }).join("");
    el.innerHTML = `<div class="dlg-box"><h2 id="dlg-title">${esc(title)}</h2>${text ? `<p class="note">${esc(text)}</p>` : ""}${fld}<div class="row2">${okOnly ? "" : `<button class="secondary" id="dlg-cancel">${esc(cancel || L_("Cancel", "取消"))}</button>`}<button class="primary${danger ? " danger" : ""}" id="dlg-ok">${esc(ok || L_("OK", "確定"))}</button></div></div>`;
    el.hidden = false;
    const values = () => Object.fromEntries(fields.map(f => [f.id, $("dlg-" + f.id).value]));
    $("dlg-ok").onclick = () => closeDialog(fields.length ? values() : true);
    const c = $("dlg-cancel"); if (c) c.onclick = () => closeDialog(null);
    el.onclick = (e) => { if (e.target === el && !okOnly) closeDialog(null); };
    el.onkeydown = (e) => { if (e.key === "Enter" && !["TEXTAREA", "SELECT"].includes(e.target.tagName)) { e.preventDefault(); $("dlg-ok").click(); } };
    setTimeout(() => (el.querySelector("input, select, textarea") || $("dlg-ok")).focus(), 30);
  });
}
function closeDialog(result) {
  const el = $("dlg"); if (el.hidden && !dlgResolve) return;
  el.hidden = true; el.innerHTML = ""; const r = dlgResolve; dlgResolve = null;
  if (dlgOpener && document.contains(dlgOpener)) dlgOpener.focus({ preventScroll: true }); dlgOpener = null;
  if (r) r(result);
}
// Keyboard and switch-control users: keep Tab inside the open layer, and put
// focus back where it came from when the layer closes.
let sheetOpener = null;
function focusSheet() { const sh = $("sheet"); if (!sh.contains(document.activeElement)) sheetOpener = document.activeElement; setTimeout(() => sh.querySelector("[data-close]")?.focus({ preventScroll: true }), 80); }
function trapTab(container, e) {
  const f = [...container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
  if (!f.length) return; const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// ---- backup & restore: the only way data crosses phones, or Safari ↔ Home Screen ----
async function backupCode() {
  const code = C.backupEncode(S), n = C.backupSummary(S);
  const text = L_(`搵車位 backup (${n.favs} favourites, ${n.vehicles} vehicles, ${n.places} places). On the other phone open the app → More → Restore and paste this code:\n\n${code}`, `搵車位 備份（${n.favs} 個常用、${n.vehicles} 架車、${n.places} 個地點）。喺另一部手機開 app → 更多 → 還原，貼上此代碼：\n\n${code}`);
  if (navigator.share) { try { await navigator.share({ text }); } catch {} return; }
  try { await navigator.clipboard.writeText(text); toast(L_("Backup code copied", "已複製備份代碼")); }
  catch { await dialog({ title: L_("Backup code", "備份代碼"), fields: [{ id: "code", label: L_("Copy this text", "複製呢段文字"), type: "textarea", value: code }], okOnly: true }); }
}
async function restoreCode() {
  const v = await dialog({ title: L_("Restore from backup", "由備份還原"), text: L_("Paste the backup code from your other phone or from Safari. Favourites, vehicles and places on this device will be replaced.", "貼上另一部手機或 Safari 嘅備份代碼。呢部機上嘅常用、車輛同地點會被取代。"), fields: [{ id: "code", label: L_("Backup code", "備份代碼"), type: "textarea", placeholder: "CPHK1.…" }], ok: L_("Restore", "還原") });
  if (!v) return;
  const m = String(v.code).match(/CPHK1\.[A-Za-z0-9_\-\s]+/), r = C.backupDecode(m ? m[0] : v.code);
  if (!r.ok) { toast(r.error === "corrupt" ? L_("That code is damaged", "代碼已損壞") : L_("That is not a backup code", "唔係備份代碼")); return; }
  for (const [k, val] of Object.entries(r.data)) { S[k] = val; save(k); }
  S.filter = { ...C.DEFAULT_FILTER(), ...(S.filter || {}) };
  S.visits = S.visits && typeof S.visits === "object" ? S.visits : {};
  document.documentElement.lang = S.lang === "en" ? "en-HK" : "zh-HK";
  const n = C.backupSummary(r.data); rerank(); render();
  toast(L_(`Restored ${n.favs} favourites, ${n.vehicles} vehicles, ${n.places} places`, `已還原 ${n.favs} 個常用、${n.vehicles} 架車、${n.places} 個地點`));
}

// ---- issue reports reach the developer as a prefilled GitHub issue (no server, no e-mail exposed) ----
function sendReport(r) {
  if (!r) return; const cp = S.carparks.find(c => c.id === r.id);
  const title = `[${r.kind}] ${cp ? T_(cp.name) : r.id}`;
  const body = [`Car park: ${cp ? `${cp.name.en || ""} / ${cp.name.tc || ""}` : "(not in current list)"}`, `ID: ${r.id}`, `Issue: ${r.kind}`, `Details: ${r.details || "-"}`, `Reported: ${new Date(r.at).toISOString()}`, `App: ${APP_VERSION} (web)`].join("\n");
  r.sentAt = Date.now(); save("reports");
  window.open(`${REPO_URL}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`, "_blank", "noopener");
}

// ---- base map layers with automatic fallback ----
function addBaseLayers(m) {
  const p = TILES[tileProvider], layers = [L.tileLayer(p.base, { maxZoom: 19, attribution: p.attribution })];
  if (p.label) layers.push(L.tileLayer(p.label(S.lang), { maxZoom: 19 }));
  layers.forEach(l => l.addTo(m));
  let errs = 0, loads = 0;
  layers[0].on("tileload", () => { loads++; });
  layers[0].on("tileerror", () => {
    if (++errs >= 8 && loads === 0 && tileProvider === "gov") {
      tileProvider = "osm"; logError("mapapi.geodata.gov.hk", "tiles failed, switched to OpenStreetMap");
      for (const mm of [map, miniMap]) if (mm) relayer(mm);
      toast(L_("Government map unavailable, using OpenStreetMap", "政府地圖暫時用唔到，改用 OpenStreetMap"));
    }
  });
  return layers;
}
function relayer(m) { m.eachLayer(l => { if (l instanceof L.TileLayer) m.removeLayer(l); }); addBaseLayers(m); }

function originPoint() {
  if (S.origin.type === "place") { const c = S.origin.place?.coordinate; return c && C.inHK(c) ? c : null; }
  const p = S.fixed || S.geo.pos; return p && C.inHK(p) ? p : null;
}
const outsideHK = () => S.origin.type === "current" && !!(S.fixed || S.geo.pos) && !C.inHK(S.fixed || S.geo.pos);
function originLabel() { return S.origin.type === "place" ? S.origin.place.title : L_("Current location", "而家位置"); }

let geoWatch = null;
function startGeo() {
  if (S.fixed || !("geolocation" in navigator) || geoWatch != null) return;
  S.geo.status = "asking";
  geoWatch = navigator.geolocation.watchPosition(p => {
    S.geo.pos = { lat: p.coords.latitude, lng: p.coords.longitude }; S.geo.status = "ok"; S.geo.error = null; rerank(); render(); checkArrival();
  }, e => {
    S.geo.status = e.code === 1 ? "denied" : "error"; S.geo.error = e.message; render();
  }, { enableHighAccuracy: true, maximumAge: 60e3, timeout: 15e3 });
}

// ------------------------------------------------------------ loading ----
function logError(url, msg) { S.errors = C.pushError(S.errors, { at: Date.now(), url: String(url).replace(/^https?:\/\//, "").slice(0, 70), msg: String(msg).slice(0, 120) }); save("errors"); }
// Every network call goes through here: a hard timeout (a hung government
// response used to freeze the refresh silently), one retry, and a local log
// the user can read under More ▸ Diagnostics.
async function fetchRaw(url, opts = {}) {
  const { timeout = FETCH_TIMEOUT, retries = 1, ...init } = opts;
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
    try { const r = await fetch(url, { cache: "no-store", ...init, signal: ctl.signal }); if (!r.ok) throw new Error("HTTP " + r.status); return r; }
    catch (e) {
      const msg = e.name === "AbortError" ? `timeout ${timeout / 1000}s` : (e.message || String(e));
      if (attempt >= retries || !S.online) { logError(url, msg); throw new Error(msg); }
      await new Promise(res => setTimeout(res, 700 * (attempt + 1)));
    } finally { clearTimeout(timer); }
  }
}
async function fetchJSON(url, opts) { return (await fetchRaw(url, opts)).json(); }
async function fetchText(url, opts) { return (await fetchRaw(url, opts)).text(); }

async function loadStatic() {
  if (S.static) return;
  const [osm, entrances, curated] = await Promise.all([fetchJSON("data/osm_carparks.json"), fetchJSON("data/osm_entrances.json"), fetchJSON("data/curated_carparks.json")]);
  S.static = { osm: C.osmCarParks(osm), entrances, curated };
}

function rebuildCarParks() {
  let list = [...S.feed];
  const ids = new Set(list.map(c => c.id));
  for (const z of S.meters.zones) if (!ids.has(z.id)) list.push(z);
  if (S.static) { list = C.dedupe(list, S.static.osm); list = C.applyCurated(list, S.static.curated); list = C.attachEntrances(list, S.static.entrances); }
  S.carparks = list;
}

async function loadInfo(force) {
  const cached = await IDB.get("info");
  if (cached && !S.feed.length) { S.feed = cached.carparks; S.infoAt = cached.at; }
  if (!force && S.infoAt && Date.now() - S.infoAt < REFRESH.info && S.feed.length) return;
  try {
    const [en, tc] = await Promise.all([fetchJSON(FEEDS.info("en")), fetchJSON(FEEDS.info("tc"))]);
    const parks = C.normalizeInfo(en.results || [], tc.results || []);
    if (!parks.length) throw new Error(L_("feed returned no car parks", "資料庫冇停車場"));
    S.feed = parks; S.infoAt = Date.now(); S.lastError = null;
    await IDB.set("info", { carparks: parks, at: S.infoAt });
  } catch (e) { S.lastError = e.message; }
}

async function loadMeters(force) {
  const cached = await IDB.get("meters");
  if (cached && !S.meters.zones.length) { S.meters = { zones: cached.zones, index: cached.index }; S.metersAt = cached.at; S.metersFromSnapshot = !!cached.snapshot; }
  if (!S.meters.zones.length) {
    // Bundled snapshot (1.7 MB, cached by the service worker) instead of the
    // 4.8 MB government CSV on first open. The CSV is fetched once a week.
    try { const snap = await fetchJSON("data/meter_zones.json"); if (snap.zones?.length) { S.meters = { zones: snap.zones, index: snap.index }; S.metersAt = snap.at; S.metersFromSnapshot = true; await IDB.set("meters", { ...S.meters, at: snap.at, snapshot: true }); } } catch {}
  }
  const age = S.metersAt ? Date.now() - S.metersAt : Infinity;
  if (!force && S.meters.zones.length && age < (S.metersFromSnapshot ? REFRESH.metersSnapshot : REFRESH.meters)) return;
  try {
    const text = await fetchText(FEEDS.meterInfo, { timeout: 60e3, retries: 0 });
    const m = C.meterZones(text);
    if (m.zones.length) { S.meters = m; S.metersAt = Date.now(); S.metersFromSnapshot = false; await IDB.set("meters", { ...m, at: S.metersAt }); }
  } catch (e) { /* meters are optional; car parks still work */ }
}

let lastMeterVac = 0;
async function loadVacancy(force) {
  const cached = await IDB.get("vac");
  if (cached && !Object.keys(S.vac).length) { S.vac = cached.vac; S.vacAt = cached.at; S.vacFromCache = true; }
  if (!force && S.vacAt && Date.now() - S.vacAt < REFRESH.vacancy && Object.keys(S.vac).length) return;
  let ok = false; const merged = { ...S.vac };
  try { const j = await fetchJSON(FEEDS.vacancy); Object.assign(merged, C.normalizeVacancy(j.results || [])); ok = true; } catch (e) { S.lastError = e.message; }
  if (Object.keys(S.meters.index).length && (force || Date.now() - lastMeterVac > REFRESH.meterVac)) {
    try { const t = await fetchText(FEEDS.meterOcc); Object.assign(merged, C.meterReadings(t, S.meters.index, Date.now())); lastMeterVac = Date.now(); ok = true; } catch {}
  }
  if (ok) { S.vac = merged; S.vacAt = Date.now(); S.vacFromCache = false; if (!S.lastError || ok) S.lastError = null; await IDB.set("vac", { vac: merged, at: S.vacAt }); }
}

async function refresh(force = false) {
  if (S.busy) return; S.busy = true;
  const all = force === "all";   // "all" re-fetches the big info/meter files too; true = live counts only
  if (!S.online && S.carparks.length) { S.busy = false; S.now = Date.now(); rerank(); render(); return; }
  if (!S.carparks.length) S.phase = "loading";
  render();
  try {
    await loadStatic();
    await loadInfo(all);
    rebuildCarParks(); rerank(); render();
    await loadMeters(all);
    rebuildCarParks();
    await loadVacancy(!!force);
  } finally {
    S.busy = false; S.now = Date.now();
    S.phase = S.carparks.length ? "loaded" : (S.lastError ? "failed" : "loaded");
    rerank(); render(); checkWatches();
  }
}

// ------------------------------------------------------------ ranking ----
function rerank() {
  S.now = Date.now();
  const records = S.carparks.map(cp => ({ cp, vac: S.vac[cp.id] || {} }));
  const ctx = { origin: originPoint(), now: S.now, vehicle: vehicle(), visits: S.visits };
  S.all = C.rank(records, ctx, S.sort);
  S.ranked = ctx.origin ? C.applyFilter(S.filter, S.all) : [];
}
const recommended = () => S.ranked.find(r => r.score > 0 && (r.level === "available" || r.level === "limited")) || S.ranked.find(r => r.score > 0) || null;
const mapItems = () => originPoint() ? S.ranked : C.applyFilter({ ...S.filter, maxDistanceMetres: null }, S.all);
const rec = (id) => S.all.find(r => r.id === id) || null;
function alternatives(id, n = 2) {
  const target = rec(id); if (!target) return [];
  return S.all.filter(r => r.id !== id && (r.level === "available" || r.level === "limited") && r.score > 0)
    .sort((a, b) => C.distM(a.cp, target.cp) - C.distM(b.cp, target.cp)).slice(0, n);
}
function emptyReason() {
  if (S.ranked.length) return null;
  if (!S.carparks.length) return S.lastError ? "offline" : (S.phase === "loading" ? "loading" : "feedEmpty");
  if (outsideHK()) return "outsideHK";
  if (!originPoint() && S.origin.type === "current") return S.geo.status === "denied" ? "denied" : "noLocation";
  if (S.filter.onlyCompatible && C.filterActiveCount(S.filter) === 1) return "noCompatible";
  if (C.bandOf(S.filter) !== "all" && C.applyFilter(C.applyBand(S.filter, "all"), S.all).length) return "outOfBand";
  return "noMatches";
}
function lastUpdatedText() {
  if (!S.vacAt) return L_("No data yet", "未有資料");
  const s = Math.max(0, Math.round((S.now - S.vacAt) / 1000));
  const pre = S.vacFromCache ? L_("Cached data from", "快取資料，") : L_("Live data updated", "即時資料更新於");
  if (s < 60) return `${pre} ${s} ${L_("sec ago", "秒前")}`;
  if (s < 3600) return `${pre} ${Math.floor(s / 60)} ${L_("min ago", "分鐘前")}`;
  return `${pre} ${Math.floor(s / 3600)} ${L_("h ago", "小時前")}`;
}

// ------------------------------------------------------------- render ----
const LEVEL_ICON = { available: "✓", limited: "!", full: "✕", unknown: "?" };
function badge(r, large = false) {
  const lv = r.level, c = r.reading?.count, en = S.lang === "en";
  const head = (lv === "available" || lv === "limited") ? (c != null ? c : L_("Spaces", "有位")) : lv === "full" ? L_("Full", "爆滿") : "—";
  const cap = lv === "available" ? (c == null ? L_("available", "有位") : L_("spaces", "個位")) : lv === "limited" ? L_("left", "剩餘") : lv === "full" ? L_("no spaces", "冇位") : L_("no live data", "冇即時資料");
  return `<div class="badge${large ? " large" : ""} lv-${lv}" aria-label="${esc(T_(C.LEVEL_LABEL[lv]))}"><b><span aria-hidden="true">${LEVEL_ICON[lv]}</span>${esc(head)}</b><small>${esc(cap)}</small></div>`;
}
function freshHTML(r) { return `<span class="fresh ${r.fresh}">${r.fresh === "live" ? "●" : "◔"} ${esc(C.freshnessText(r.fresh, r.reading?.updatedAt, S.now, S.lang))}</span>`; }
function cardHTML(r, extra = "") {
  const cp = r.cp, fav = S.favs.some(f => f.id === cp.id);
  const tags = [];
  if (cp.kind === "onStreetMeter") tags.push(`<span class="tag">P ${esc(L_(`Street meters · ${cp.bayCount} bays`, `路邊咪錶 · ${cp.bayCount} 個位`))}</span>`);
  else if (r.fit.kind !== "notConfirmed" || cp.height.metres != null) tags.push(`<span class="tag ${r.fit.kind === "fits" ? "ok" : r.fit.kind === "tight" ? "warn" : r.fit.kind === "doesNotFit" ? "full" : ""}">↕ ${esc(C.heightText(cp.height, S.lang))}</span>`);
  if (r.estHourly != null) tags.push(`<span class="tag">$ ${esc(fmtHourly(r.estHourly, r.hourlyIsEstimate))}</span>`);
  if (cp.facilities.includes("evCharger")) tags.push(`<span class="tag">⚡ ${esc(L_("EV", "充電"))}</span>`);
  if (cp.isMall) tags.push(`<span class="tag">🛍 ${esc(L_("Mall", "商場"))}</span>`);
  const vc = visitCount(cp.id);
  if (vc) tags.push(`<span class="tag ok">Ⓟ ${esc(vc >= 2 ? L_(`Parked ${vc}×`, `泊過 ${vc} 次`) : L_("Parked before", "泊過"))}</span>`);
  if (C.isInfoOnly(cp)) tags.push(`<span class="tag">📄 ${esc(L_("Info only", "只有資料"))}</span>`);
  if (r.isOpen === false) tags.push(`<span class="tag full">${esc(L_("Closed", "閂咗"))}</span>`);
  if (!C.hasEntrance(cp)) tags.push(`<span class="tag">📍 ${esc(L_("Location approximate", "位置為約略"))}</span>`);
  return `<button class="card ${extra}" data-cp="${esc(cp.id)}">
    <div class="card-top"><div class="card-name"><h2>${fav ? "★ " : ""}${esc(T_(cp.name))}</h2><p>${esc(T_(cp.address))}</p>
      <div class="meta">${r.dist != null ? `<span title="${esc(L_("Straight-line distance", "直線距離"))}">➤ ${esc(C.fmtDist(r.dist, S.lang))}</span>` : ""}${freshHTML(r)}</div></div>${badge(r)}</div>
    <div class="tags">${tags.join("")}</div></button>`;
}
const fmtHourly = (hkd, est) => { const v = Number.isInteger(hkd) ? `$${hkd}` : `$${hkd.toFixed(1)}`; const b = L_(`${v}/hr`, `${v}/小時`); return est ? L_(`${b} est.`, `約 ${b}`) : b; };

function bandsHTML() {
  const cur = C.bandOf(S.filter);
  return `<div class="bands" role="radiogroup" aria-label="${esc(L_("Distance", "距離"))}"><span class="lbl">➤</span>${C.DISTANCE_BANDS.map(b => `<button role="radio" data-band="${b.id}" aria-checked="${cur === b.id}">${esc(T_(b.label))}</button>`).join("")}</div>`;
}
function chipsHTML(ids) {
  return `<div class="chips" role="group">${ids.map(id => { const c = C.CHIPS.find(x => x.id === id); const on = C.chipIsOn(id, S.filter, S.sort);
    return `<button class="chip" data-chip="${id}" aria-pressed="${on}"><span aria-hidden="true">${c.icon}</span>${esc(T_(c.label))}</button>`; }).join("")}</div>`;
}

function renderFind() {
  const el = $("panel-find");
  const o = originPoint(), reason = emptyReason(), r0 = recommended();
  let body = "";
  const offlineBar = !S.online ? `<div class="offline-bar" role="status">📡 ${esc(L_("You're offline. Showing the last data received; counts may be out of date.", "你而家離線。顯示最後收到嘅資料，數字可能已過時。"))}</div>` : "";
  if (reason === "loading") body = `<div class="state"><div class="ic">⏳</div><p>${esc(L_("Loading live car park data…", "載入緊即時車位資料…"))}</p></div>`;
  else if (reason) body = emptyStateHTML(reason);
  else {
    const place = S.origin.type === "place" ? S.origin.place : null;
    const nearest = Math.min(...S.all.map(r => r.dist ?? Infinity));
    if (place && place.kind === "maps" && nearest > 250) body += `<p class="note">ⓘ ${esc(L_(`${place.title} itself does not publish parking data. Nearest listed car parks:`, `${place.title} 本身冇提供泊車資料，以下係最近有資料嘅停車場：`))}</p>`;
    if (r0) body += `<div class="sect"><span class="accent">✦ ${esc(L_("Recommended now", "而家最推薦"))}</span></div>${cardHTML(r0, "rec")}
      <p class="reasons">${esc(r0.reasons.slice(0, 4).map(x => C.reasonText(x, S.lang)).join(" · "))}</p>
      <div class="row2"><button class="primary" data-nav="${esc(r0.id)}">➤ ${esc(L_("Navigate", "導航"))}</button><button class="secondary" data-cp="${esc(r0.id)}">ⓘ ${esc(L_("Details", "詳情"))}</button></div>`;
    const here = S.ranked.filter(r => r.dist != null && r.dist <= 250 && r.id !== r0?.id).sort((a, b) => a.dist - b.dist).slice(0, 3);
    if (here.length) body += `<div class="sect"><span>📍 ${esc(L_("Right here (within 250 m)", "就喺呢度（250 米內）"))}</span></div>${here.map(r => cardHTML(r)).join("")}`;
    const rest = S.ranked.filter(r => r.id !== r0?.id && !here.includes(r));
    body += `<div class="sect"><span>${esc(L_(`Nearby, ranked by ${T_(C.SORT_LABEL[S.sort]).toLowerCase()}`, `附近 · 按${T_(C.SORT_LABEL[S.sort])}排序`))}</span><small>${rest.length}</small></div>`;
    body += rest.slice(0, S.limit || 20).map(r => cardHTML(r)).join("");
    if (rest.length > (S.limit || 20)) body += `<button class="more" id="more">${esc(L_(`Show ${Math.min(20, rest.length - (S.limit || 20))} more`, `睇多 ${Math.min(20, rest.length - (S.limit || 20))} 個`))}</button>`;
  }
  el.innerHTML = `<h1 id="h-find">${esc(L_("Find Parking", "搵車位"))}</h1>
    <button class="searchbox" id="open-search"><span aria-hidden="true">🔍</span>${S.origin.type === "place" ? `<span class="val">${esc(originLabel())}</span><span class="loc" id="use-loc" role="button" aria-label="${esc(L_("Use current location", "用而家位置"))}">➤</span>` : `<span class="ph">${esc(L_("Where are you going?", "你去邊度？"))}</span>`}</button>
    ${chipsHTML(C.CHIPS.map(c => c.id))}
    ${bandsHTML()}
    <button class="primary" id="find-now">Ⓟ ${esc(L_("Find Parking Now", "即刻搵位"))}</button>
    <div class="status"><span aria-live="polite">${S.vacFromCache ? "💾" : "●"} ${esc(lastUpdatedText())}</span><span><button data-sort-menu>⇅ ${esc(T_(C.SORT_LABEL[S.sort]))}</button> · <button data-tab="map">🗺 ${esc(L_("Map", "地圖"))}</button></span></div>
    ${offlineBar}${body}
    <footer class="attr">${esc(L_("Live data: Transport Department via DATA.GOV.HK · Map © Lands Department (CSDI) · Other car parks © OpenStreetMap contributors · Distances are straight-line, not driving distance · Estimates only, verify on site.", "即時資料：運輸署（資料一線通）· 地圖 © 地政總署（空間數據共享平台）· 其他停車場 © OpenStreetMap 貢獻者 · 距離為直線而非行車距離 · 只供參考，以現場為準。"))}</footer>`;
}

function emptyStateHTML(reason) {
  const st = (ic, h, p, btn, act) => `<div class="card"><div class="state"><div class="ic" aria-hidden="true">${ic}</div><h3>${esc(h)}</h3><p>${esc(p)}</p>${btn ? `<button class="primary" data-act="${act}">${esc(btn)}</button>` : ""}</div></div>`;
  switch (reason) {
    case "outsideHK": return st("🌏", L_("You're outside Hong Kong", "你唔喺香港"), L_("This app covers Hong Kong car parks only. Search a Hong Kong destination to plan ahead.", "呢個 app 只涵蓋香港停車場。可以搜尋香港目的地預先計劃。"), L_("Search a destination", "搜尋目的地"), "search");
    case "denied": return st("📍", L_("Location not available", "攞唔到位置"), L_("Location is off for this app. Search a destination, or allow location in your browser settings.", "定位已關閉。可以搜尋目的地，或者喺瀏覽器設定允許定位。"), L_("Search a destination", "搜尋目的地"), "search");
    case "noLocation": return S.onboarded ? st("📍", L_("Where are you?", "你喺邊？"), L_("Allow location to see car parks near you, or search a destination.", "允許定位以顯示附近車位，或者搜尋目的地。"), L_("Allow location", "允許定位"), "locate")
      : `<div class="card"><div class="state"><div class="ic" aria-hidden="true">📍</div><h3>${esc(L_("Find spaces near you", "搵附近車位"))}</h3><p>${esc(L_("The app asks for your location to rank car parks by distance. It is used only while the app is open and never leaves this phone.", "app 會要求定位，用嚟按距離排列停車場。只會喺開啟時使用，唔會離開呢部手機。"))}</p><button class="primary" data-act="locate">${esc(L_("Allow location", "允許定位"))}</button><p style="margin:10px 0 0"><button data-act="search" style="color:var(--accent);font-weight:600;min-height:44px">${esc(L_("Search a destination instead", "改為搜尋目的地"))}</button></p></div></div>`;
    case "offline": return st("📡", L_("Can't reach the parking feed", "連唔到車位資料"), L_("Check your connection and try again. Nothing is cached yet.", "請檢查網絡再試。暫時未有快取資料。"), L_("Try again", "再試一次"), "retry");
    case "feedEmpty": return st("📭", L_("No car parks in the feed", "資料庫暫時冇停車場"), L_("The government feed returned nothing. Try again in a minute.", "政府資料暫時冇內容，請稍後再試。"), L_("Try again", "再試一次"), "retry");
    case "outOfBand": return st("➤", L_("Nothing in this distance band", "呢個距離範圍內冇車位"), L_(`No car park between ${T_(C.DISTANCE_BANDS.find(b => b.id === C.bandOf(S.filter))?.label || C.lt("", ""))} from here. Pick a wider band.`, `由呢度起 ${T_(C.DISTANCE_BANDS.find(b => b.id === C.bandOf(S.filter))?.label || C.lt("", ""))} 範圍內冇停車場，請揀闊一點。`), L_("Any distance", "不限距離"), "clearBand");
    case "noCompatible": return st("🚐", L_("Nothing compatible nearby", "附近冇啱你車嘅車位"), L_("No car park here confirms it fits your vehicle. Show all and check the height yourself?", "附近冇停車場確認啱你架車，可以顯示全部再自己核對限高。"), L_("Show all", "顯示全部"), "resetFilters");
    default: { const n = C.filterActiveCount(S.filter); return st("⚙︎", L_("No car parks match", "冇符合嘅停車場"), n ? L_(`${n} filters are on. Loosen them or widen the distance.`, `開咗 ${n} 個篩選，試下放寬或者加大範圍。`) : L_("Nothing within range. Try a destination.", "範圍內冇車位，試下搜尋目的地。"), n ? L_("Clear filters", "清除篩選") : null, "resetFilters"); }
  }
}

// ------------------------------------------------------------- detail ----
let sheetFor = null, miniMap = null;
function openDetail(id) {
  const r = rec(id); if (!r) return;
  sheetFor = id;
  const cp = r.cp, v = vehicle(), fav = S.favs.some(f => f.id === id);
  const other = (lt) => { const a = S.lang === "en" ? lt.tc : lt.en; return a && a !== T_(lt) ? `<p class="sub">${esc(a)}</p>` : ""; };
  const alts = (r.level === "full" || r.level === "unknown") ? alternatives(id) : [];
  const types = C.VEHICLE_TYPES.filter(k => r.rec.vac?.[k] || (cp.capacity?.[k]?.total ?? 0) > 0);
  const fee = cp.fees?.[v?.type || "privateCar"] || cp.fees?.privateCar;
  const facts = [];
  facts.push([L_("Status", "狀態"), r.isOpen === true ? L_("Open now", "開放中") : r.isOpen === false ? L_("Closed now", "已關閉") : L_("Hours not confirmed", "開放時間未確認")]);
  if (cp.openingHours.length) facts.push([L_("Hours", "開放時間"), cp.openingHours.map(w => C.windowText(w, S.lang)).join("\n")]);
  if (cp.operatorName) facts.push([L_("Operator", "營運商"), T_(cp.operatorName)]);
  facts.push([L_("Height limit", "限高"), cp.kind === "onStreetMeter" ? L_("On-street, no height limit", "路邊，冇高度限制") : C.heightText(cp.height, S.lang) + (cp.height.note ? "\n" + cp.height.note : "")]);
  if (cp.carParkType) facts.push([L_("Type", "類型"), cp.carParkType + (cp.nature ? " · " + cp.nature : "")]);
  if (cp.facilities.length) facts.push([L_("Facilities", "設施"), cp.facilities.map(f => ({ evCharger: L_("EV charging", "電動車充電"), disabilities: L_("Accessible parking", "傷健人士車位"), unloading: L_("Loading / unloading", "上落貨"), washing: L_("Car wash", "洗車") })[f] || f).join(", ")]);
  if (cp.paymentMethods.length) facts.push([L_("Payment", "付款方式"), cp.paymentMethods.join(", ")]);
  if (cp.infoNote && !C.isInfoOnly(cp)) facts.push([L_("Notes", "備註"), T_(cp.infoNote)]);
  const d = C.districtById(cp.district); if (d) facts.push([L_("District", "地區"), T_(d.name) + " · " + T_(C.REGIONS[d.region])]);
  if (cp.contact) facts.push([L_("Phone", "電話"), `<a href="tel:${esc(cp.contact.replace(/[^0-9+]/g, ""))}">${esc(cp.contact)}</a>`, true]);
  if (cp.website) facts.push([L_("Website", "網站"), `<a href="${esc(cp.website)}" target="_blank" rel="noopener">${esc(cp.website.replace(/^https?:\/\//, "").split("/")[0])}</a>`, true]);
  const adv = v ? C.sizeAdvice(v, S.lang) : null;
  const navLabel = cp.kind === "onStreetMeter" ? L_("Navigate to the bays", "導航去咪錶位") : C.hasEntrance(cp) ? L_("Navigate to Entrance", "導航去入口") : L_("Navigate (location approximate)", "導航（位置為約略）");

  $("sheet").innerHTML = `
    <div class="sheet-head"><span class="grab"></span><button class="quiet" data-close>${esc(L_("Close", "關閉"))}</button><h2>${esc(T_(cp.name))}</h2><button class="quiet" data-share="${esc(id)}">⇪</button></div>
    <div class="card-top"><div class="card-name"><h1>${esc(T_(cp.name))}</h1>${other(cp.name)}<p class="sub">${esc(T_(cp.address))}</p>${other(cp.address)}
      <div class="meta">${freshHTML(r)}${r.dist != null ? `<span>➤ ${esc(C.fmtDist(r.dist, S.lang))} · ${esc(L_("straight line", "直線"))}</span>` : ""}</div></div>${badge(r, true)}</div>
    <div style="height:12px"></div>
    <button class="primary" data-nav="${esc(id)}">➤ ${esc(navLabel)}</button>
    <div class="row2" style="margin-top:8px"><button class="secondary" data-fav="${esc(id)}" aria-pressed="${fav}">${fav ? "★ " + esc(L_("Saved", "已儲存")) : "☆ " + esc(L_("Save", "儲存"))}</button><button class="secondary" data-park="${esc(id)}">Ⓟ ${esc(L_("I parked here", "我泊咗喺度"))}</button></div>
    <p style="text-align:center;margin:10px 0 0"><button data-report="${esc(id)}" style="color:var(--accent);font-weight:600;min-height:40px">⚑ ${esc(L_("Report an issue", "報告問題"))}</button></p>
    ${alts.length ? `<div class="sect"><span>${esc(r.level === "full" ? L_("This car park is full. Nearby alternatives:", "呢個停車場爆滿，附近另有：") : L_("No live data here. Nearby with spaces:", "呢度冇即時資料，附近有位嘅："))}</span></div>${alts.map(a => cardHTML(a)).join("")}` : ""}
    <div class="section"><h3>🚗 ${esc(L_("Availability by vehicle", "各類車位空置"))}</h3>
      ${C.isInfoOnly(cp) ? `<p class="note">${esc(L_("This operator does not publish live availability. The location and facts here come from OpenStreetMap and the operator's own page; check signage on arrival.", "呢個營運商冇公開即時空位。位置同資料來自 OpenStreetMap 及營運商網頁，到場請留意指示牌。"))}</p>${cp.infoNote ? `<p class="note">${esc(T_(cp.infoNote))}</p>` : ""}` : ""}
      ${!C.isInfoOnly(cp) && !types.length ? `<p class="note">${esc(L_("No live vacancy feed for this car park.", "呢個停車場冇即時空位資料。"))}</p>` : ""}
      ${cp.kind === "onStreetMeter" ? `<p class="note">${esc(L_(`${cp.bayCount} metered bays along this section. The count is bays whose sensor reports vacant; pay at the meter or by the HKeMeter app.`, `呢段路共 ${cp.bayCount} 個咪錶位。數字係感應器報「吉」嘅泊位數，可喺咪錶或 HKeMeter app 付款。`))}</p>` : ""}
      ${types.map(k => { const rd = r.rec.vac?.[k]; const rr = { level: C.level(rd, S.now), reading: rd }; const cap = cp.capacity?.[k]?.total;
        return `<div class="dl"><div><dt>${esc(T_(C.VEHICLE_NAME[k]))}</dt><dd style="display:flex;justify-content:flex-end;align-items:center;gap:10px">${cap ? `<small style="color:var(--ink-soft)">${esc(L_(`of ${cap}`, `／${cap}`))}</small>` : ""}${badge(rr)}</dd></div></div>`; }).join("")}
    </div>
    <div class="section"><h3>↕ ${esc(L_("Will my vehicle fit?", "我架車入唔入到？"))}</h3>
      ${v ? `<div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(v.nickname)}</b><span style="color:var(--ink-soft)">${esc(C.dimensionsText(v) || "")}</span></div><p class="fit ${r.fit.kind}">${esc(C.fitText(r.fit, S.lang))}</p>
        ${r.fit.kind === "doesNotFit" ? `<p class="note" style="color:var(--full)">${esc(L_("Do not enter. The posted clearance is lower than your vehicle.", "唔好入。標示限高低過你架車。"))}</p>` : ""}
        ${r.fit.kind === "notConfirmed" ? `<p class="note">${esc(v.heightMetres ? L_("The feed does not confirm a height for this car park. Check the sign at the entrance.", "資料未有確認限高，請留意入口標示。") : L_("Add your vehicle height in Vehicle to check.", "喺「車輛」加入車高就可以核對。"))}</p>` : ""}
        ${adv ? `<p class="advice ${adv.level}">📏 ${esc(adv.text)}</p>` : ""}
        ${r.supports === false ? `<p class="note" style="color:var(--warn)">${esc(L_("No spaces listed for this vehicle type.", "未列出呢類車嘅車位。"))}</p>` : ""}`
        : `<p class="note">${esc(L_("Add a vehicle profile to check height and spaces for your vehicle type.", "加入車輛資料就可以核對限高同車位類別。"))}</p><p>${esc(C.heightText(cp.height, S.lang))}</p>`}
    </div>
    <div class="section"><h3>⤵ ${esc(L_("Entrance", "入口"))}</h3><div class="minimap" id="minimap"></div>
      ${cp.kind === "onStreetMeter" ? `<p class="note">${esc(L_("On-street bays. The pin is the middle of the section; bays run along the kerb.", "路邊泊位。圖釘係路段中間，泊位沿路邊分佈。"))}</p>`
        : cp.entrance ? `<p class="note">${cp.entrance.lat.toFixed(5)}, ${cp.entrance.lng.toFixed(5)}${cp.entrance.note && !C.isEmptyLT(cp.entrance.note) ? " · " + esc(T_(cp.entrance.note)) : ""}<br>${esc(L_("Entrance from: ", "入口資料來源："))}${esc(T_(C.SOURCE_ATTRIBUTION[cp.entrance.source]))}</p>`
        : `<p class="note">📍 ${esc(L_("Location approximate. The feed gives the building position, not the vehicle entrance.", "位置為約略。資料只有建築物位置，並非車輛入口。"))}</p>`}
    </div>
    <div class="section"><h3>ⓘ ${esc(L_("Details", "詳細"))}</h3><dl class="dl">${facts.map(([k, val, html]) => `<div><dt>${esc(k)}</dt><dd>${html ? val : esc(val)}</dd></div>`).join("")}</dl>
      ${cp.photoURL ? `<img src="${esc(cp.photoURL)}" alt="" loading="lazy" style="width:100%;height:140px;object-fit:cover;border-radius:10px;margin-top:10px">` : ""}</div>
    <div class="section"><h3>$ ${esc(L_("Fees", "收費"))}</h3>${feesHTML(fee)}<p class="note">${esc(L_("Fees vary and change. Confirm at the entrance before parking.", "收費或有變動，泊車前請以入口標示為準。"))}</p></div>
    <div class="section"><h3>✓ ${esc(L_("Data sources", "資料來源"))}</h3>${cp.sources.map(s => `<p class="note">${C.providesLive(s) ? "●" : "📄"} ${esc(T_(C.SOURCE_ATTRIBUTION[s] || C.lt(s, s)))}</p>`).join("")}
      ${cp.factsProvenance ? `<p class="note">${esc(L_("Height, fees and hours as published by ", "限高、收費及時間由 "))}${esc(T_(cp.factsProvenance.publisher))}${cp.factsProvenance.checkedOn ? esc(L_(`, checked ${cp.factsProvenance.checkedOn}`, `公佈，核對日期 ${cp.factsProvenance.checkedOn}`)) : ""}${C.factsStale(cp.factsProvenance.checkedOn, S.now) ? `<span style="color:var(--warn)"> ⚠ ${esc(L_("checked over 6 months ago, verify on site", "核對已超過六個月，請以現場為準"))}</span>` : ""}${cp.factsProvenance.sourceURL ? ` · <a href="${esc(cp.factsProvenance.sourceURL)}" target="_blank" rel="noopener">${esc(new URL(cp.factsProvenance.sourceURL).hostname)}</a>` : ""}</p>` : ""}
      ${cp.isEnriched ? `<p class="note">${esc(L_("Live availability, fees and facilities are operator-provided through the government feed.", "空位、收費同設施由營運商經政府平台提供。"))}</p>` : ""}</div>`;
  $("sheet").hidden = false; requestAnimationFrame(() => { $("sheet").classList.add("on"); $("scrim").classList.add("on"); }); focusSheet();
  $("sheet").scrollTop = 0;
  setTimeout(() => {
    if (miniMap) { miniMap.remove(); miniMap = null; }
    const p = C.navPoint(cp);
    miniMap = L.map("minimap", { zoomControl: false, attributionControl: true, dragging: false, scrollWheelZoom: false, touchZoom: false, doubleClickZoom: false }).setView([p.lat, p.lng], 17);
    miniMap.attributionControl.setPrefix(false); addBaseLayers(miniMap);
    L.circleMarker([cp.lat, cp.lng], { radius: 7, color: "#fff", weight: 2, fillColor: "#6b7379", fillOpacity: 1 }).addTo(miniMap);
    if (cp.entrance) L.circleMarker([cp.entrance.lat, cp.entrance.lng], { radius: 8, color: "#fff", weight: 2, fillColor: "#1f70eb", fillOpacity: 1 }).addTo(miniMap);
  }, 60);
  location.hash = "#cp/" + encodeURIComponent(id);
}
function feesHTML(fee) {
  if (!fee || C.feeIsEmpty(fee)) return `<p class="note">${esc(L_("No fee information in the feed. Check the sign at the entrance.", "資料未有收費資料，請留意入口標示。"))}</p>`;
  const kind = { dayPark: L_("Day parking", "日泊"), nightPark: L_("Night parking", "夜泊"), twentyFourHours: L_("24-hour", "24 小時"), monthly: L_("Monthly", "月租"), other: L_("Flat rate", "定額") };
  let h = fee.hourly.map(r => `<div class="dl"><div><dt>${esc(C.windowText(r.window, S.lang))}<br><small>${esc(C.weekdaysText(r.window, S.lang))}</small></dt><dd style="text-align:right"><b>$${r.price}${r.unitMinutes === 30 ? L_("/30 min", "/半小時") : L_("/hr", "/小時")}${r.isEstimate ? L_(" est.", "（估計）") : ""}</b>${r.remark ? `<br><small style="color:var(--ink-soft)">${esc(r.remark)}</small>` : ""}</dd></div></div>`).join("");
  h += fee.flat.map(r => `<div class="dl"><div><dt>${esc(kind[r.kind] || r.kind)}${r.window ? `<br><small>${esc(C.windowText(r.window, S.lang))}</small>` : ""}</dt><dd style="text-align:right"><b>$${r.price}</b></dd></div></div>`).join("");
  h += fee.privileges.map(p => `<p class="note">🎁 ${esc(p)}</p>`).join("");
  if (fee.note) h += `<p class="details-text" style="font-size:14px">${esc(fee.note)}</p>`;
  return h;
}
function closeSheet() { $("sheet").classList.remove("on"); $("scrim").classList.remove("on"); setTimeout(() => { $("sheet").hidden = true; if (miniMap) { miniMap.remove(); miniMap = null; } }, 220); sheetFor = null; if (sheetOpener && document.contains(sheetOpener)) sheetOpener.focus({ preventScroll: true }); sheetOpener = null; if (location.hash.startsWith("#cp/")) history.replaceState(null, "", "#" + S.tab); }

// ---------------------------------------------------------- actions ------
function navigateTo(id) {
  const r = rec(id); if (!r) return; const p = C.navPoint(r.cp), name = T_(r.cp.name);
  noteRecent(r.cp); setHeading(id, r.cp.name); arrivalAsked = false;
  const url = S.navApp === "google" ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`
    : S.navApp === "waze" ? `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes`
    : `https://maps.apple.com/?daddr=${p.lat},${p.lng}&dirflg=d&q=${encodeURIComponent(name)}`;
  window.open(url, "_blank", "noopener");
}
function noteVisit(id) { const v = S.visits[id] || { n: 0, lastAt: null }; S.visits[id] = { n: v.n + 1, lastAt: Date.now() }; save("visits"); }
const visitCount = (id) => S.visits[id]?.n || 0;

// When you tap Navigate we remember where you were going. If the phone then
// reaches that car park while the app is open, offer to start the session
// instead of making you find the button. Asked once, then forgotten.
const HEADING_RADIUS_M = 150, HEADING_TTL = 3 * 3600e3;
function setHeading(id, name) { S.heading = { id, name, at: Date.now() }; save("heading"); }
function clearHeading() { if (S.heading) { S.heading = null; save("heading"); } }
async function checkArrival() {
  const h = S.heading; if (!h || S.session || arrivalAsked) return;
  if (Date.now() - h.at > HEADING_TTL) { clearHeading(); return; }
  const me = S.fixed || (S.geo.status === "ok" ? S.geo.pos : null), r = rec(h.id); if (!me || !r) return;
  if (C.distM(me, C.navPoint(r.cp)) > HEADING_RADIUS_M) return;
  arrivalAsked = true; clearHeading();
  const v = await dialog({ title: L_("Did you park here?", "泊咗喺度？"), text: T_(r.cp.name),
    fields: [{ id: "floor", label: L_("Floor / zone / spot (optional)", "樓層／區域／車位（可選）"), placeholder: L_("e.g. P2 · B12", "例如 P2 · B12") },
      { id: "hrs", label: L_("Remind me before paid time ends", "收費時間完結前提醒"), type: "select", value: "0", options: [["0", L_("No reminder", "唔提醒")], ["1", L_("After 1 hour", "1 小時後")], ["2", L_("After 2 hours", "2 小時後")], ["3", L_("After 3 hours", "3 小時後")], ["4", L_("After 4 hours", "4 小時後")], ["8", L_("After 8 hours", "8 小時後")]] }],
    ok: L_("Yes, start timer", "係，開始計時"), cancel: L_("Not here", "唔喺度") });
  if (!v) return;
  startSession(h.id, v.floor.trim(), parseFloat(v.hrs) || 0); setTab("saved");
}
let arrivalAsked = false;
function noteRecent(cp) { S.recents = [{ id: cp.id, name: cp.name, at: Date.now() }, ...S.recents.filter(x => x.id !== cp.id)].slice(0, 20); save("recents"); }
function toggleFav(id) { const r = rec(id); if (!r) return; if (S.favs.some(f => f.id === id)) { S.favs = S.favs.filter(f => f.id !== id); toast(L_("Removed from saved", "已由常用移除")); } else { S.favs.push({ id, name: r.cp.name, pinned: false, watch: false, at: Date.now() }); toast(L_("Saved", "已加入常用")); } save("favs"); }
async function shareCP(id) { const r = rec(id); if (!r) return; const p = C.navPoint(r.cp); const text = `${T_(r.cp.name)}\n${T_(r.cp.address)}\nhttps://maps.apple.com/?daddr=${p.lat},${p.lng}&dirflg=d`;
  if (navigator.share) { try { await navigator.share({ title: T_(r.cp.name), text }); } catch {} } else { try { await navigator.clipboard.writeText(text); toast(L_("Copied", "已複製")); } catch {} } }
let reminderTimer = null;
function startSession(id, floor, reminderHours) {
  const r = rec(id); if (!r) return;
  S.session = { id, name: r.cp.name, lat: r.cp.lat, lng: r.cp.lng, startedAt: Date.now(), floor: floor || null, reminderAt: reminderHours > 0 ? Date.now() + reminderHours * 3600e3 - 600e3 : null };
  save("session"); noteRecent(r.cp); noteVisit(id); clearHeading(); scheduleReminder(); toast(L_("Parking session started", "已開始泊車紀錄"));
}
function endSession() { if (S.session) { S.lastSession = { ...S.session, endedAt: Date.now() }; save("lastSession"); } S.session = null; save("session"); clearTimeout(reminderTimer); }
function scheduleReminder() {
  clearTimeout(reminderTimer); if (!S.session?.reminderAt) return;
  const fire = () => { const n = T_(S.session.name); toast(L_(`Parking at ${n} ends soon`, `${n} 嘅泊車時段快完`)); if ("Notification" in window && Notification.permission === "granted") new Notification(L_("Parking time is nearly up", "泊車時間快到"), { body: n }); };
  const delay = S.session.reminderAt - Date.now(); if (delay <= 0) return; reminderTimer = setTimeout(fire, Math.min(delay, 2 ** 31 - 1));
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
}
function checkWatches() {
  if (!S.alerts || !("Notification" in window) || Notification.permission !== "granted") return;
  for (const f of S.favs.filter(f => f.watch)) { const r = rec(f.id); if (r?.level === "available" && (!f.lastNotified || Date.now() - f.lastNotified > 30 * 60e3)) { f.lastNotified = Date.now(); new Notification(L_("Spaces available", "有位喇"), { body: `${T_(r.cp.name)}: ${r.reading?.count ?? ""}` }); } }
  save("favs");
}

// ------------------------------------------------------------ search -----
let searchMode = null; // 'dest' | {pick: fn}
let suggestT = null, mapsResults = [];
function openSearch(mode = "dest") {
  searchMode = mode; mapsResults = [];
  const el = $("search"); el.classList.add("on");
  el.innerHTML = `<div class="bar"><input id="q" type="search" placeholder="${esc(L_("Place, mall, district or car park", "地點、商場、地區或停車場"))}" autocomplete="off" enterkeyhint="search" aria-label="${esc(L_("Search", "搜尋"))}"><button class="quiet" id="q-cancel">${esc(L_("Cancel", "取消"))}</button></div><div class="list" id="q-list"></div>`;
  renderSearchList(""); setTimeout(() => $("q").focus(), 50);
  $("q").addEventListener("input", e => { const q = e.target.value; renderSearchList(q); clearTimeout(suggestT); if (q.trim().length >= 3) suggestT = setTimeout(() => placeSearch(q), 350); });
  $("q").addEventListener("keydown", e => { if (e.key === "Enter") { const first = $("q-list").querySelector("[data-pick]"); if (first) first.click(); } });
  $("q-cancel").onclick = closeSearch;
}
function closeSearch() { $("search").classList.remove("on"); searchMode = null; }
function renderSearchList(q) {
  const list = $("q-list"); if (!list) return; const opt = (ic, title, sub, data) => `<button class="opt" ${data}><span class="ic">${ic}</span><span class="txt">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ""}</span></button>`;
  let h = "";
  if (!q.trim()) {
    h += opt("➤", L_("Current location", "而家位置"), "", `data-pick="current"`);
    for (const p of S.places) h += opt(p.role === "home" ? "🏠" : p.role === "work" ? "💼" : "★", p.label, "", `data-pick="place:${esc(p.id)}"`);
    if (S.searches.length) { h += `<div class="sect"><span>${esc(L_("Recent", "最近"))}</span></div>`; for (const s of S.searches) h += opt("⟲", s.title, s.subtitle, `data-pick="search:${esc(s.key)}"`); }
    h += `<div class="sect"><span>${esc(L_("Browse by district", "按地區瀏覽"))}</span></div>`;
    for (const [rid, rn] of Object.entries(C.REGIONS)) h += `<details><summary style="min-height:44px;display:flex;align-items:center;font-weight:600">${esc(T_(rn))}</summary>${C.DISTRICTS.filter(d => d.region === rid).map(d => opt("▢", T_(d.name), "", `data-pick="district:${d.id}"`)).join("")}</details>`;
  } else {
    const ds = C.districtsMatching(q); if (ds.length) { h += `<div class="sect"><span>${esc(L_("Districts", "地區"))}</span></div>`; for (const d of ds) h += opt("▢", T_(d.name), T_(C.REGIONS[d.region]), `data-pick="district:${d.id}"`); }
    const cps = C.searchCarParks(q, S.carparks, 6); if (cps.length) { h += `<div class="sect"><span>${esc(L_("Car parks", "停車場"))}</span></div>`; for (const x of cps) h += opt("Ⓟ", T_(x.cp.name), T_(x.cp.address), `data-pick="cp:${esc(x.cp.id)}"`); }
    if (mapsResults.length) { h += `<div class="sect"><span>${esc(L_("Places", "地點"))}</span></div>`; mapsResults.forEach((m, i) => { h += opt("📍", m.title, m.subtitle, `data-pick="maps:${i}"`); }); }
    if (!ds.length && !cps.length && !mapsResults.length && q.length >= 2) h += `<p class="note">${esc(L_("No matches yet. Try a street, mall or district name.", "未有結果，試下街名、商場或者地區。"))}</p>`;
  }
  list.innerHTML = h;
}
async function nominatim(q) {
  const tries = [q, C.toTrad(q) + " 香港", q + " Hong Kong"];
  for (const t of [...new Set(tries)]) {
    try {
      const j = await fetchJSON(`https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=hk&accept-language=${S.lang === "en" ? "en" : "zh-TW"}&q=${encodeURIComponent(t)}`, { headers: { Accept: "application/json" }, timeout: 6000, retries: 0 });
      const res = (j || []).map(x => ({ title: (x.display_name || q).split(",")[0], subtitle: (x.display_name || "").split(",").slice(1, 3).join(",").trim(), coordinate: { lat: +x.lat, lng: +x.lon }, kind: "maps" })).filter(x => C.inHK(x.coordinate));
      if (res.length) return res;
    } catch {}
  }
  return [];
}
// Government Address Lookup Service first: free, Hong Kong only, knows every
// building and estate by its Chinese and English name. OpenStreetMap's
// Nominatim (a volunteer service with a strict rate limit) only as fallback.
async function placeSearch(q) {
  let res = [];
  try { const j = await fetchJSON(`https://www.als.gov.hk/lookup?q=${encodeURIComponent(q)}&n=6`, { headers: { Accept: "application/json" }, timeout: 6000, retries: 0 }); res = C.alsPlaces(j, S.lang); } catch {}
  if (!res.length) res = await nominatim(q);
  if ($("q")?.value === q) { mapsResults = res; renderSearchList(q); }
}
function pickSearch(v) {
  const done = (place) => {
    if (!place.coordinate || !C.inHK(place.coordinate)) { dialog({ title: L_("Outside Hong Kong", "唔喺香港"), text: L_(`${place.title} is not in Hong Kong. This app covers Hong Kong car parks only.`, `${place.title}唔喺香港。呢個 app 只涵蓋香港停車場。`), okOnly: true }); return; }
    if (searchMode && searchMode.pick) { searchMode.pick(place); closeSearch(); return; }
    S.origin = { type: "place", place }; save("origin");
    if (place.kind !== "district") { const key = place.title + "|" + (place.subtitle || ""); S.searches = [{ key, title: place.title, subtitle: place.subtitle || "", coordinate: place.coordinate, kind: place.kind }, ...S.searches.filter(s => s.key !== key)].slice(0, 8); save("searches"); }
    closeSearch(); rerank(); render(); if (S.tab === "map") mapCentreOn(place.coordinate);
  };
  if (v === "current") { S.origin = { type: "current" }; save("origin"); S.onboarded = true; save("onboarded"); startGeo(); closeSearch(); rerank(); render(); return; }
  const [kind, rest] = [v.slice(0, v.indexOf(":")), v.slice(v.indexOf(":") + 1)];
  if (kind === "cp") { const cp = S.carparks.find(c => c.id === rest); if (cp) done({ title: T_(cp.name), subtitle: T_(cp.address), coordinate: { lat: cp.lat, lng: cp.lng }, kind: "carPark", id: cp.id }); }
  else if (kind === "district") { const d = C.districtById(rest); const pts = S.carparks.filter(c => c.district === rest); const c = pts.length ? { lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lng: pts.reduce((a, p) => a + p.lng, 0) / pts.length } : C.HK.centre;
    if (!(searchMode && searchMode.pick)) { S.filter = { ...S.filter, districts: [rest], maxDistanceMetres: null }; save("filter"); } done({ title: T_(d.name), subtitle: T_(C.REGIONS[d.region]), coordinate: c, kind: "district" }); }
  else if (kind === "place") { const p = S.places.find(x => x.id === rest); if (p) done({ title: p.label, subtitle: "", coordinate: p.coordinate, kind: "saved" }); }
  else if (kind === "search") { const s = S.searches.find(x => x.key === rest); if (s) done({ title: s.title, subtitle: s.subtitle, coordinate: s.coordinate, kind: s.kind || "recent" }); }
  else if (kind === "maps") { const m = mapsResults[+rest]; if (m) done(m); }
}

// --------------------------------------------------------------- map -----
let map = null, markerLayer = null, meLayer = null, mapSpan = 0.03, mapCentred = false;
function ensureMap() {
  if (map) return;
  const b = L.latLngBounds([C.HK.minLat, C.HK.minLng], [C.HK.maxLat, C.HK.maxLng]);
  map = L.map("map", { preferCanvas: true, zoomControl: false, maxBounds: b, maxBoundsViscosity: 1.0, minZoom: 10, maxZoom: 19 }).setView([C.HK.centre.lat, C.HK.centre.lng], 11);
  addBaseLayers(map);
  markerLayer = L.layerGroup().addTo(map); meLayer = L.layerGroup().addTo(map);
  let t; map.on("moveend zoomend", () => { clearTimeout(t); t = setTimeout(paintMarkers, 150); });
}
function mapCentreOn(p, zoom = 16) { if (!map) return; map.setView([p.lat, p.lng], zoom); mapCentred = true; }
function paintMarkers() {
  if (!map || S.tab !== "map") return;
  const bounds = map.getBounds(), span = bounds.getNorth() - bounds.getSouth();
  const items = mapItems().filter(r => bounds.contains([r.cp.lat, r.cp.lng]));
  markerLayer.clearLayers();
  const clusters = clusterize(items, span);
  for (const c of clusters) {
    if (c.items.length === 1) { const r = c.items[0]; const label = (r.level === "available" || r.level === "limited") ? (r.reading?.count ?? "P") : r.level === "full" ? "0" : "?";
      const icon = L.divIcon({ className: "", html: `<div class="pin ${r.level}"><div class="b"><span>${LEVEL_ICON[r.level]}</span><span>${esc(label)}</span></div><div class="t"></div></div>`, iconSize: [40, 30], iconAnchor: [20, 30] });
      L.marker([r.cp.lat, r.cp.lng], { icon, title: T_(r.cp.name) }).on("click", () => openDetail(r.id)).addTo(markerLayer); }
    else { const free = c.items.filter(r => r.level === "available" || r.level === "limited").length;
      const icon = L.divIcon({ className: "", html: `<div class="cluster ${c.level}"><b>${c.items.length}</b><small>${free}✓</small></div>`, iconSize: [40, 40], iconAnchor: [20, 20] });
      L.marker([c.lat, c.lng], { icon }).on("click", () => map.setView([c.lat, c.lng], Math.min(19, map.getZoom() + 2))).addTo(markerLayer); }
  }
  meLayer.clearLayers(); const o = originPoint();
  if (o) { L.circleMarker([o.lat, o.lng], { radius: 7, color: "#fff", weight: 2, fillColor: "#1f70eb", fillOpacity: 1 }).addTo(meLayer); }
  const mt = $("map-top"); if (mt) { const cnt = mt.querySelector("[data-count]"); if (cnt) cnt.textContent = L_(`${items.length} in view`, `畫面內 ${items.length} 個`); }
}
function clusterize(items, span) {
  if (span <= 0.015) return items.map(r => ({ lat: r.cp.lat, lng: r.cp.lng, items: [r], level: r.level }));
  const cell = span / 7, buckets = new Map();
  for (const r of items) { const k = `${Math.floor(r.cp.lat / cell)}_${Math.floor(r.cp.lng / cell)}`; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(r); }
  return [...buckets.values()].map(g => ({ lat: g.reduce((a, r) => a + r.cp.lat, 0) / g.length, lng: g.reduce((a, r) => a + r.cp.lng, 0) / g.length, items: g,
    level: g.some(r => r.level === "available") ? "available" : g.some(r => r.level === "limited") ? "limited" : g.some(r => r.level === "full") ? "full" : "unknown" }));
}
function renderMap() {
  ensureMap();
  $("map-top").innerHTML = `<button class="searchbox" id="map-search"><span aria-hidden="true">🔍</span><span class="${S.origin.type === "place" ? "val" : "ph"}">${esc(S.origin.type === "place" ? originLabel() : L_("Search destination", "搜尋目的地"))}</span><span class="loc" data-tab="find" role="button" aria-label="${esc(L_("Show list", "顯示清單"))}">☰</span></button>
    ${chipsHTML(["nearMe", "mostSpaces", "streetMeters", "evCharging", "heightFits", "openNow"])}
    ${bandsHTML()}
    <div class="status"><span>${esc(lastUpdatedText())}</span><span data-count></span></div>`;
  $("map-here").textContent = L_("Search this area", "喺呢區搵位");
  setTimeout(() => { map.invalidateSize(); const o = originPoint(); if (o && !mapCentred) mapCentreOn(o, 16); paintMarkers(); }, 50);
}

// ------------------------------------------------------------- saved -----
let tick = null;
function renderSaved() {
  const el = $("panel-saved"); let h = `<h1>${esc(L_("Saved", "已儲存"))}</h1>`;
  if (S.session) { const s = S.session, el2 = Date.now() - s.startedAt;
    h += `<div class="card"><div class="sect" style="margin-top:0"><span class="accent">Ⓟ ${esc(L_("Parked now", "而家泊咗"))}</span></div><h2 style="margin:0 0 4px">${esc(T_(s.name))}</h2>
      <div class="timer" id="timer">${fmtDur(el2)}</div><p class="note">${esc(L_("Since", "由"))} ${new Date(s.startedAt).toLocaleTimeString(S.lang === "en" ? "en-HK" : "zh-HK", { hour: "2-digit", minute: "2-digit" })}${s.floor ? " · " + esc(L_("Floor", "樓層")) + " " + esc(s.floor) : ""}${s.reminderAt ? " · 🔔 " + new Date(s.reminderAt).toLocaleTimeString(S.lang === "en" ? "en-HK" : "zh-HK", { hour: "2-digit", minute: "2-digit" }) : ""}</p>
      <div class="row2"><a class="primary" href="https://maps.apple.com/?daddr=${s.lat},${s.lng}&dirflg=w" target="_blank" rel="noopener">🚶 ${esc(L_("Take me back to my car", "帶我返去架車度"))}</a><button class="secondary" data-act="endSession">■ ${esc(L_("End", "結束"))}</button></div>
      <p style="margin:8px 0 0"><button data-cp="${esc(s.id)}" style="color:var(--accent);font-weight:600;min-height:40px">${esc(L_("Car park details", "停車場詳情"))}</button></p></div>`;
    clearInterval(tick); tick = setInterval(() => { const t = $("timer"); if (t && S.session) t.textContent = fmtDur(Date.now() - S.session.startedAt); else clearInterval(tick); }, 1000);
  } else if (S.lastSession) h += `<div class="sect"><span>${esc(L_("Last parked", "上次泊車"))}</span></div><button class="list-item" data-cp="${esc(S.lastSession.id)}"><span>Ⓟ</span><span class="txt">${esc(T_(S.lastSession.name))}<small>${new Date(S.lastSession.startedAt).toLocaleString(S.lang === "en" ? "en-HK" : "zh-HK")}</small></span></button>`;
  h += storageTip();
  const often = Object.entries(S.visits).map(([id, v]) => ({ id, ...v })).sort((a, b) => (b.n - a.n) || (b.lastAt - a.lastAt)).slice(0, 5);
  if (often.length) {
    h += `<div class="sect"><span>Ⓟ ${esc(L_("Where you park", "你常泊嘅地方"))}</span></div>`;
    for (const o of often) { const r = rec(o.id), nm = r ? T_(r.cp.name) : (S.recents.find(x => x.id === o.id) ? T_(S.recents.find(x => x.id === o.id).name) : o.id);
      h += `<button class="list-item" data-cp="${esc(o.id)}"><span>Ⓟ</span><span class="txt">${esc(nm)}<small>${esc(L_(`${o.n} time${o.n > 1 ? "s" : ""}`, `${o.n} 次`))}${o.lastAt ? " · " + esc(L_("last", "上次")) + " " + new Date(o.lastAt).toLocaleDateString(S.lang === "en" ? "en-HK" : "zh-HK") : ""}</small></span>${r ? badge(r) : ""}</button>`; }
  }
  h += `<div class="sect"><span>★ ${esc(L_("Favourite car parks", "常用停車場"))}</span></div>`;
  const favs = [...S.favs].sort((a, b) => (b.pinned - a.pinned) || (b.at - a.at));
  if (!favs.length) h += `<p class="note">${esc(L_("Tap the star on any car park to keep it here.", "喺任何停車場撳星星就會存喺度。"))}</p>`;
  for (const f of favs) { const r = rec(f.id);
    h += `<div class="list-item"><button class="txt" data-cp="${esc(f.id)}" style="text-align:left">${f.pinned ? "📌 " : ""}${esc(T_(f.name))}<small>${r ? esc((r.dist != null ? C.fmtDist(r.dist, S.lang) + " · " : "") + C.freshnessText(r.fresh, r.reading?.updatedAt, S.now, S.lang)) : esc(L_("Not in the current feed", "目前資料未有此停車場"))}${f.watch ? " · 🔔" : ""}</small></button>${r ? badge(r) : ""}
      <div class="act"><button data-pin="${esc(f.id)}" aria-label="${esc(L_("Pin", "置頂"))}" aria-pressed="${f.pinned}">📌</button><button data-watch="${esc(f.id)}" aria-label="${esc(L_("Alert when spaces free up", "有位時提醒"))}" aria-pressed="${f.watch}">🔔</button><button data-unfav="${esc(f.id)}" aria-label="${esc(L_("Remove", "移除"))}">✕</button></div></div>`; }
  h += `<div class="sect"><span>⟲ ${esc(L_("Recent car parks", "最近去過"))}</span></div>`;
  if (!S.recents.length) h += `<p class="note">${esc(L_("Car parks you navigate to appear here.", "你導航過嘅停車場會顯示喺度。"))}</p>`;
  for (const x of S.recents.slice(0, 10)) h += `<button class="list-item" data-cp="${esc(x.id)}"><span>⟲</span><span class="txt">${esc(T_(x.name))}<small>${new Date(x.at).toLocaleString(S.lang === "en" ? "en-HK" : "zh-HK")}</small></span></button>`;
  h += `<div class="sect"><span>📍 ${esc(L_("Saved places", "已儲存地點"))}</span></div>`;
  for (const role of ["home", "work"]) { const p = S.places.find(x => x.role === role);
    h += p ? `<div class="list-item"><button class="txt" data-goplace="${esc(p.id)}" style="text-align:left">${role === "home" ? "🏠" : "💼"} ${esc(p.label)}</button><div class="act"><button data-delplace="${esc(p.id)}" aria-label="${esc(L_("Delete", "刪除"))}">✕</button></div></div>`
             : `<button class="list-item" data-addplace="${role}"><span>＋</span><span class="txt">${esc(role === "home" ? L_("Add Home", "加入屋企") : L_("Add Work", "加入公司"))}</span></button>`; }
  for (const p of S.places.filter(x => x.role === "custom")) h += `<div class="list-item"><button class="txt" data-goplace="${esc(p.id)}" style="text-align:left">★ ${esc(p.label)}</button><div class="act"><button data-delplace="${esc(p.id)}" aria-label="${esc(L_("Delete", "刪除"))}">✕</button></div></div>`;
  h += `<button class="list-item" data-addplace="custom"><span>＋</span><span class="txt">${esc(L_("Add another place", "加入其他地點"))}</span></button>`;
  if (S.searches.length) { h += `<div class="sect"><span>🔍 ${esc(L_("Recent searches", "最近搜尋"))}</span><small><button data-act="clearSearches" style="color:var(--accent)">${esc(L_("Clear", "清除"))}</button></small></div>`; for (const s of S.searches) h += `<button class="list-item" data-gosearch="${esc(s.key)}"><span>🔍</span><span class="txt">${esc(s.title)}<small>${esc(s.subtitle)}</small></span></button>`; }
  el.innerHTML = h;
}
const fmtDur = (ms) => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

// ----------------------------------------------------------- vehicle -----
function renderVehicle() {
  const el = $("panel-vehicle"); let h = `<h1>${esc(L_("Vehicle", "車輛"))}</h1>` + storageTip();
  if (!S.vehicles.length) h += `<div class="card"><h2 style="margin:0 0 6px;font-size:17px">${esc(L_("Add your vehicle", "加入你架車"))}</h2><p class="note">${esc(L_("Height and type are used to warn about low clearances and hide car parks with no spaces for your vehicle. Stored on this device only.", "車高同車種用嚟提醒限高，同隱藏冇你車種車位嘅停車場。只會存喺呢部機。"))}</p><button class="primary" data-act="addVehicle">＋ ${esc(L_("Add vehicle", "加入車輛"))}</button></div>`;
  for (const v of S.vehicles) { const active = v.id === (vehicle()?.id);
    h += `<div class="list-item"><button class="txt" data-editveh="${esc(v.id)}" style="text-align:left"><b>${esc(v.nickname)}</b>${active ? ` <span style="color:var(--accent);font-size:12px;font-weight:600">${esc(L_("Active", "使用中"))}</span>` : ""}<small>${esc([T_(C.VEHICLE_NAME[v.type]), C.dimensionsText(v), v.needsEVCharging ? L_("EV", "電動車") : null, v.maxHourlyRateHKD ? L_(`≤ $${v.maxHourlyRateHKD}/hr`, `≤ $${v.maxHourlyRateHKD}/小時`) : null].filter(Boolean).join(" · "))}</small></button>
      <div class="act">${active ? "" : `<button data-useveh="${esc(v.id)}">${esc(L_("Use", "使用"))}</button>`}<button data-delveh="${esc(v.id)}" aria-label="${esc(L_("Delete", "刪除"))}">✕</button></div></div>`; }
  if (S.vehicles.length) h += `<button class="list-item" data-act="addVehicle"><span>＋</span><span class="txt">${esc(L_("Add another vehicle", "加入另一架車"))}</span></button>`;
  h += `<p class="note">${esc(L_("Car parks with missing height or fee data are never hidden automatically. They show as \"Not confirmed\" so you can decide. Length and width are compared with the standard Hong Kong bay (5.0 × 2.5 m).", "限高或收費資料缺失嘅停車場唔會自動隱藏，會顯示「未確認」由你決定。車長車闊會同香港標準車位（5.0 × 2.5 米）比較。"))}</p>`;
  el.innerHTML = h;
}
function openVehicleEditor(v) {
  const isNew = !v; v = v || { id: "v" + Date.now(), nickname: L_("My car", "我架車"), type: "privateCar", heightMetres: null, lengthMetres: null, widthMetres: null, needsEVCharging: false, prefersAccessible: false, maxHourlyRateHKD: null, avoidNoLiveData: false, preferredDistricts: [] };
  const sw = (k, label) => `<div class="field"><label>${esc(label)}</label><button class="switch" role="switch" aria-checked="${!!v[k]}" data-sw="${k}"></button></div>`;
  $("sheet").innerHTML = `<div class="sheet-head"><span class="grab"></span><button class="quiet" data-close>${esc(L_("Cancel", "取消"))}</button><h2>${esc(isNew ? L_("New vehicle", "新車輛") : L_("Edit vehicle", "編輯車輛"))}</h2><button class="quiet" id="veh-save" style="color:var(--accent)">${esc(L_("Save", "儲存"))}</button></div>
    <form class="form" id="veh-form" onsubmit="return false">
      <div class="section"><div class="field"><label for="v-name">${esc(L_("Nickname", "暱稱"))}</label><input id="v-name" type="text" value="${esc(v.nickname)}" placeholder="MIFA 9"></div>
        <div class="field"><label for="v-type">${esc(L_("Type", "車種"))}</label><select id="v-type">${C.VEHICLE_TYPES.map(k => `<option value="${k}" ${v.type === k ? "selected" : ""}>${esc(T_(C.VEHICLE_NAME[k]))}</option>`).join("")}</select></div>
        <div class="field"><label for="v-h">${esc(L_("Height (m)", "車高（米）"))}</label><input id="v-h" type="number" step="0.01" inputmode="decimal" placeholder="1.84" value="${v.heightMetres ?? ""}"></div>
        <div class="field"><label for="v-l">${esc(L_("Length (m)", "車長（米）"))}</label><input id="v-l" type="number" step="0.01" inputmode="decimal" placeholder="5.27" value="${v.lengthMetres ?? ""}"></div>
        <div class="field"><label for="v-w">${esc(L_("Width (m)", "車闊（米）"))}</label><input id="v-w" type="number" step="0.01" inputmode="decimal" placeholder="2.00" value="${v.widthMetres ?? ""}"></div>
        <p class="note">${esc(L_("Overall height including roof box or antenna. Leave blank if unsure. Length and width give a bay-size note only; height is the hard limit.", "包括車頂箱或天線嘅總高度，唔肯定可留空。車長車闊只作車位尺寸提示，限高係硬性限制。"))}</p></div>
      <div class="section">${sw("needsEVCharging", L_("Needs EV charging", "需要電動車充電"))}${sw("prefersAccessible", L_("Prefer accessible parking", "優先傷健車位"))}
        <div class="field"><label for="v-rate">${esc(L_("Max hourly rate (HK$)", "每小時上限（港元）"))}</label><input id="v-rate" type="number" inputmode="numeric" placeholder="${esc(L_("Any", "不限"))}" value="${v.maxHourlyRateHKD ?? ""}"></div>
        ${sw("avoidNoLiveData", L_("Rank car parks without live data lower", "冇即時資料嘅停車場排後啲"))}</div>
      <div class="section"><h3>${esc(L_("Frequent districts", "常去地區"))}</h3>${Object.entries(C.REGIONS).map(([rid, rn]) => `<details><summary style="min-height:40px;display:flex;align-items:center">${esc(T_(rn))}</summary>${C.DISTRICTS.filter(d => d.region === rid).map(d => `<div class="field"><label>${esc(T_(d.name))}</label><button class="switch" role="switch" aria-checked="${v.preferredDistricts.includes(d.id)}" data-dist="${d.id}"></button></div>`).join("")}</details>`).join("")}</div>
    </form>`;
  $("sheet").hidden = false; requestAnimationFrame(() => { $("sheet").classList.add("on"); $("scrim").classList.add("on"); }); focusSheet();
  $("veh-save").onclick = () => {
    const n = (id, lo, hi) => { const x = parseFloat($(id).value.replace(",", ".")); return Number.isFinite(x) && x >= lo && x <= hi ? x : null; };
    const nv = { ...v, nickname: $("v-name").value.trim() || v.nickname, type: $("v-type").value, heightMetres: n("v-h", 0.5, 6), lengthMetres: n("v-l", 1, 20), widthMetres: n("v-w", 0.5, 4), maxHourlyRateHKD: n("v-rate", 1, 999) };
    for (const b of $("veh-form").querySelectorAll("[data-sw]")) nv[b.dataset.sw] = b.getAttribute("aria-checked") === "true";
    nv.preferredDistricts = [...$("veh-form").querySelectorAll("[data-dist][aria-checked='true']")].map(b => b.dataset.dist);
    const i = S.vehicles.findIndex(x => x.id === nv.id); if (i >= 0) S.vehicles[i] = nv; else S.vehicles.push(nv);
    if (isNew || !S.activeVehicleId) S.activeVehicleId = nv.id; save("vehicles"); save("activeVehicleId");
    S.filter.vehicleType = vehicle()?.type || "privateCar"; save("filter");
    closeSheet(); rerank(); render(); toast(L_("Vehicle saved", "已儲存車輛"));
  };
}

// -------------------------------------------------------------- more -----
function renderMore() {
  const el = $("panel-more"); const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  el.innerHTML = `<h1>${esc(L_("More", "更多"))}</h1>
    ${installed ? "" : `<div class="card"><h2 style="margin:0 0 6px;font-size:17px">📲 ${esc(L_("Add to your Home Screen", "加到主畫面"))}</h2><p class="note">${esc(/iPhone|iPad/.test(navigator.userAgent) ? L_("In Safari tap the Share button, then \"Add to Home Screen\". The app then opens full screen and works offline.", "喺 Safari 撳分享按鈕，再揀「加入主畫面」。之後會全屏開啟，離線亦可用。") : L_("In Chrome tap the menu, then \"Install app\" or \"Add to Home screen\".", "喺 Chrome 撳選單，再揀「安裝應用程式」或「加到主畫面」。"))}</p></div>`}
    <div class="section form"><div class="field"><label>${esc(L_("Language", "語言"))}</label><select id="m-lang"><option value="en" ${S.lang === "en" ? "selected" : ""}>English</option><option value="tc" ${S.lang === "tc" ? "selected" : ""}>繁體中文</option></select></div>
      <div class="field"><label>${esc(L_("Navigate with", "導航 app"))}</label><select id="m-nav"><option value="apple" ${S.navApp === "apple" ? "selected" : ""}>Apple Maps</option><option value="google" ${S.navApp === "google" ? "selected" : ""}>Google Maps</option><option value="waze" ${S.navApp === "waze" ? "selected" : ""}>Waze</option></select></div>
      <div class="field"><label>${esc(L_("Alert when a watched car park has spaces (while open)", "常用停車場有位時提醒（開啟時）"))}</label><button class="switch" role="switch" aria-checked="${S.alerts}" id="m-alerts"></button></div></div>
    <div class="section"><h3>${esc(L_("About the data", "關於資料"))}</h3>
      <p class="note"><b>${esc(T_(C.SOURCE_ATTRIBUTION.transportDepartmentOneStop))}</b><br>${esc(L_("Live spaces for participating car parks. Coverage depends on operators; counts may be delayed or inconsistent, and a reading older than an hour is shown as no live data.", "參與停車場嘅即時空位。覆蓋範圍視乎營運商；數字或有延遲或不一致，超過一小時嘅讀數顯示為冇即時資料。"))}</p>
      <p class="note"><b>${esc(T_(C.SOURCE_ATTRIBUTION.transportDepartmentMeters))}</b><br>${esc(L_("Every private-car meter bay, grouped by street section; the count is bays whose sensor reports vacant.", "所有私家車咪錶位，按路段分組；數字係感應器報「吉」嘅泊位數。"))}</p>
      <p class="note"><b>${esc(T_(C.SOURCE_ATTRIBUTION.openStreetMap))}</b> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">openstreetmap.org/copyright</a><br>${esc(L_("Car parks and mall car parks no feed covers (Harbour City, Times Square, IFC, Pacific Place, Festival Walk and hundreds more), plus mapped vehicle entrances and the map itself.", "所有資料來源未涵蓋嘅停車場及商場停車場（海港城、時代廣場、國金、太古廣場、又一城等數百個），以及入口點同地圖本身。"))}</p>
      <p class="note"><b>${esc(L_("Operator-published facts", "營運商公佈資料"))}</b><br>${esc(L_("Tariffs, hours and phone numbers read from operators' own parking pages, stored with the page address and the date checked, shown on each detail.", "收費、時間及電話由營運商官方泊車網頁抄錄，記錄網址同核對日期，詳情頁會顯示。"))}</p>
      <p class="note"><b>${esc(L_("Map", "地圖"))}</b><br>${esc(L_("Basemap and labels © Lands Department, through the Common Spatial Data Infrastructure portal (free government map service). Falls back to OpenStreetMap tiles if unavailable.", "底圖及標注 © 地政總署，經空間數據共享平台提供（免費政府地圖服務）。如無法連接則改用 OpenStreetMap 地圖。"))}</p>
      <p class="note"><b>${esc(L_("Address search", "地址搜尋"))}</b><br>${esc(L_("Government Address Lookup Service (als.gov.hk), with OpenStreetMap Nominatim as fallback. Only Hong Kong results are accepted.", "政府地址查詢服務（als.gov.hk），OpenStreetMap Nominatim 作後備。只接受香港結果。"))}</p></div>
    <div class="section"><h3>${esc(L_("Privacy", "私隱"))}</h3><p class="note">${esc(L_("Location is used only while the app is open, only to show nearby car parks and distances, and is never uploaded. Favourites, vehicles, parking sessions and reports stay in this browser. The app talks to DATA.GOV.HK, OpenStreetMap tiles and Nominatim. No account, no analytics, no ads.", "定位只會喺 app 開啟時使用，用嚟顯示附近停車場同距離，唔會上傳。常用、車輛、泊車紀錄同報告只存喺呢個瀏覽器。本 app 只連接資料一線通、OpenStreetMap 地圖及 Nominatim。唔使登入、冇分析追蹤、冇廣告。"))}</p></div>
    <div class="section"><h3>${esc(L_("Known limitations", "已知限制"))}</h3><p class="note">${esc(L_("Live counts exist only where the operator publishes. Swire, Wharf and Hongkong Land malls do not; they are information only. Fees change; verify on site. Distances are straight-line. The parking reminder fires only while the app is open. Length and width warnings use the standard 5.0 × 2.5 m bay because no car park publishes bay sizes.", "即時空位只限有向平台提供資料嘅營運商；太古、九倉、置地商場冇提供，只作參考。收費會變，請以現場為準。距離為直線。泊車提醒只會喺 app 開啟時發出。車長車闊提示以標準 5.0 × 2.5 米車位為準。"))}</p></div>
    <div class="section"><h3>💾 ${esc(L_("Backup & restore", "備份與還原"))}</h3><p class="note">${esc(L_("Favourites, vehicles and places live on this phone only. Copy a backup code to move them to another phone, or from Safari into the Home Screen app.", "常用、車輛同地點只存喺呢部手機。複製備份代碼可以搬去另一部手機，或者由 Safari 搬入主畫面 app。"))}</p>
      <div class="row2"><button class="secondary" data-act="backup">⇪ ${esc(L_("Copy backup code", "複製備份代碼"))}</button><button class="secondary" data-act="restore">⤓ ${esc(L_("Restore", "還原"))}</button></div></div>
    <div class="section"><h3>🩺 ${esc(L_("Diagnostics", "診斷"))}</h3>${S.errors.length ? S.errors.map(e => `<p class="err">${new Date(e.at).toLocaleString(S.lang === "en" ? "en-HK" : "zh-HK")} · ${esc(e.url)}<br>${esc(e.msg)}</p>`).join("") + `<button class="secondary" data-act="clearErrors" style="margin-top:8px">${esc(L_("Clear log", "清除記錄"))}</button>` : `<p class="note">${esc(L_("No feed errors recorded. The last ten failures appear here so you can tell what went wrong.", "未有資料錯誤記錄。最近十次失敗會顯示喺呢度，方便你了解出咗咩問題。"))}</p>`}</div>
    <div class="section"><h3>${esc(L_("My issue reports", "我嘅問題報告"))}</h3>${S.reports.length ? S.reports.map((r, i) => `<p class="note"><b>${esc(r.kind)}</b> · ${esc(r.id)} · ${new Date(r.at).toLocaleString()}<br>${esc(r.details)}${r.sentAt ? ` · ✓ ${esc(L_("sent", "已傳送"))}` : ` · <button data-sendreport="${i}" style="color:var(--accent);font-weight:600;min-height:32px">${esc(L_("Send to developer", "傳送給開發者"))}</button>`}</p>`).join("") : `<p class="note">${esc(L_("None yet. Reports are saved here and can be sent to the developer as a GitHub issue.", "未有。報告會存喺呢度，並可以透過 GitHub issue 傳送給開發者。"))}</p>`}
      ${S.reports.length ? `<button class="secondary" data-act="shareReports">⇪ ${esc(L_("Share reports", "分享報告"))}</button>` : ""}</div>
    <div class="section"><h3>${esc(L_("Licence", "使用條款"))}</h3><p class="note">${esc(L_("Free for personal, non-commercial use. Selling this app, running it as a service or using it to promote a business is not permitted without written permission. Provided as is; always check the signs at the car park.", "只限個人非商業用途。未經書面許可，不得出售本 app、作為服務營運或用於推廣業務。按現狀提供；請以停車場現場標示為準。"))} <a href="https://github.com/agsm26/hk-parking/blob/main/LICENSE.md" target="_blank" rel="noopener">LICENSE.md</a></p></div>
    <div class="section"><button class="secondary" data-act="clearCache">${esc(L_("Clear cached feed data", "清除快取資料"))}</button></div>
    <p class="note" style="text-align:center">搵車位 · Car Park HK · ${esc(APP_VERSION)} · ${esc(L_("Data snapshots 6 Sep 2026", "資料快照 2026-09-06"))}</p>`;
  $("m-lang").onchange = e => { S.lang = e.target.value; save("lang"); document.documentElement.lang = S.lang === "en" ? "en-HK" : "zh-HK"; render(); if (map) relayer(map); };
  $("m-nav").onchange = e => { S.navApp = e.target.value; save("navApp"); };
  $("m-alerts").onclick = async () => { S.alerts = !S.alerts; if (S.alerts && "Notification" in window && Notification.permission === "default") await Notification.requestPermission().catch(() => {}); save("alerts"); renderMore(); };
}

// ------------------------------------------------------------- shell -----
const TABS = [["find", "Ⓟ", ["Find Parking", "搵車位"]], ["map", "🗺", ["Map", "地圖"]], ["saved", "★", ["Saved", "已儲存"]], ["vehicle", "🚗", ["車輛", "車輛"]], ["more", "⋯", ["More", "更多"]]];
function renderTabs() {
  $("tabs").innerHTML = TABS.map(([id, ic, [en, tc]]) => `<button data-tab="${id}" aria-current="${S.tab === id ? "page" : "false"}"><span class="ic" aria-hidden="true">${ic}</span>${esc(id === "vehicle" ? L_("Vehicle", "車輛") : L_(en, tc))}</button>`).join("");
}
function setTab(id) { S.tab = id; for (const p of document.querySelectorAll(".panel")) p.classList.toggle("on", p.id === "panel-" + id); history.replaceState(null, "", "#" + id); render(); if (id === "map") setTimeout(() => { map && map.invalidateSize(); paintMarkers(); }, 60); }
function render() {
  renderTabs();
  if (S.tab === "find") renderFind(); else if (S.tab === "map") renderMap(); else if (S.tab === "saved") renderSaved(); else if (S.tab === "vehicle") renderVehicle(); else renderMore();
  if (sheetFor && !$("sheet").hidden && rec(sheetFor)) { /* keep the sheet; badges refresh on next open */ }
}

// ------------------------------------------------------------ events -----
document.addEventListener("click", async (e) => {
  const b = (sel) => e.target.closest(sel);
  let x;
  if ((x = b("[data-tab]"))) { e.preventDefault(); setTab(x.dataset.tab); return; }
  if ((x = b("[data-band]"))) { S.filter = C.applyBand(S.filter, x.dataset.band); save("filter"); rerank(); render(); return; }
  if ((x = b("[data-chip]"))) { const on = !C.chipIsOn(x.dataset.chip, S.filter, S.sort); const r = C.applyChip(x.dataset.chip, S.filter, S.sort, on); S.filter = r.f; S.sort = r.sort; save("filter"); save("sort"); rerank(); render(); return; }
  if ((x = b("[data-sort-menu]"))) { const i = C.SORTS.indexOf(S.sort); S.sort = C.SORTS[(i + 1) % C.SORTS.length]; save("sort"); rerank(); render(); toast(T_(C.SORT_LABEL[S.sort])); return; }
  if ((x = b("#use-loc"))) { e.stopPropagation(); S.origin = { type: "current" }; save("origin"); startGeo(); rerank(); render(); return; }
  if ((x = b("#open-search, #map-search"))) { openSearch("dest"); return; }
  if ((x = b("#find-now"))) { S.onboarded = true; save("onboarded"); if (S.origin.type === "current" && S.geo.status !== "ok" && !S.fixed) startGeo(); refresh(true).then(() => { const r0 = recommended(); if (r0) openDetail(r0.id); }); return; }
  if ((x = b("#more"))) { S.limit = (S.limit || 20) + 20; render(); return; }
  if ((x = b("[data-nav]"))) { navigateTo(x.dataset.nav); return; }
  if ((x = b("[data-fav]"))) { toggleFav(x.dataset.fav); const id = x.dataset.fav; openDetail(id); return; }
  if ((x = b("[data-share]"))) { shareCP(x.dataset.share); return; }
  if ((x = b("[data-park]"))) {
    const v = await dialog({ title: L_("I parked here", "我泊咗喺度"), text: L_("The reminder fires 10 minutes early and only while the app is open.", "提醒會早 10 分鐘發出，只限 app 開啟時。"),
      fields: [{ id: "floor", label: L_("Floor / zone / spot (optional)", "樓層／區域／車位（可選）"), placeholder: L_("e.g. P2 · B12", "例如 P2 · B12") },
        { id: "hrs", label: L_("Remind me before paid time ends", "收費時間完結前提醒"), type: "select", value: "0", options: [["0", L_("No reminder", "唔提醒")], ["1", L_("After 1 hour", "1 小時後")], ["2", L_("After 2 hours", "2 小時後")], ["3", L_("After 3 hours", "3 小時後")], ["4", L_("After 4 hours", "4 小時後")], ["8", L_("After 8 hours", "8 小時後")]] }], ok: L_("Start", "開始") });
    if (!v) return; startSession(x.dataset.park, v.floor.trim(), parseFloat(v.hrs) || 0); closeSheet(); setTab("saved"); return; }
  if ((x = b("[data-report]"))) {
    const id = x.dataset.report;
    const v = await dialog({ title: L_("Report an issue", "報告問題"), fields: [
      { id: "kind", label: L_("What is wrong?", "有咩問題？"), type: "select", value: "availability", options: [["availability", L_("Availability count wrong", "空位數目唔準")], ["entrance", L_("Entrance in the wrong place", "入口位置錯")], ["price", L_("Fee wrong or outdated", "收費錯或過時")], ["height", L_("Height limit wrong", "限高錯")], ["closed", L_("Car park closed or gone", "停車場已關閉／唔存在")], ["other", L_("Other", "其他")]] },
      { id: "details", label: L_("Details (optional)", "詳情（可選）"), type: "textarea", placeholder: L_("What did you see on site?", "現場見到啲咩？") }], ok: L_("Save", "儲存") });
    if (!v) return;
    const rep = { id, kind: v.kind, details: v.details.trim(), at: Date.now() }; S.reports.unshift(rep); save("reports");
    const send = await dialog({ title: L_("Saved on this device", "已存喺本機"), text: L_("Send it to the developer too? This opens GitHub with the report filled in; posting needs a free GitHub account.", "同時傳送給開發者？會開啟 GitHub 並填好報告，發佈需要免費 GitHub 帳戶。"), ok: L_("Send", "傳送"), cancel: L_("Not now", "暫時唔要") });
    if (send) sendReport(rep); return; }
  if ((x = b("[data-sendreport]"))) { sendReport(S.reports[+x.dataset.sendreport]); return; }
  if ((x = b("[data-close]"))) { closeSheet(); return; }
  if ((x = b("[data-cp]"))) { openDetail(x.dataset.cp); return; }
  if ((x = b("[data-pick]"))) { pickSearch(x.dataset.pick); return; }
  if ((x = b("[data-act]"))) { const a = x.dataset.act;
    if (a === "search") openSearch("dest"); else if (a === "locate") { S.onboarded = true; save("onboarded"); startGeo(); } else if (a === "retry") refresh("all");
    else if (a === "clearBand") { S.filter = C.applyBand(S.filter, "all"); save("filter"); rerank(); render(); }
    else if (a === "backup") backupCode(); else if (a === "restore") restoreCode(); else if (a === "clearErrors") { S.errors = []; save("errors"); render(); }
    else if (a === "resetFilters") { S.filter = { ...C.DEFAULT_FILTER(), vehicleType: S.filter.vehicleType }; S.sort = "bestMatch"; save("filter"); save("sort"); rerank(); render(); }
    else if (a === "endSession") { if (await dialog({ title: L_("End parking session?", "結束泊車紀錄？"), ok: L_("End", "結束"), danger: true })) { endSession(); render(); } }
    else if (a === "clearSearches") { S.searches = []; save("searches"); render(); }
    else if (a === "addVehicle") openVehicleEditor(null);
    else if (a === "clearCache") { IDB.clear().then(() => { toast(L_("Cache cleared", "已清除快取")); }); }
    else if (a === "shareReports") { const text = S.reports.map(r => `${r.kind} · ${r.id} · ${new Date(r.at).toISOString()}\n${r.details}`).join("\n\n"); if (navigator.share) navigator.share({ text }).catch(() => {}); else navigator.clipboard?.writeText(text).then(() => toast(L_("Copied", "已複製"))); }
    return; }
  if ((x = b("[data-pin]"))) { const f = S.favs.find(f => f.id === x.dataset.pin); if (f) { f.pinned = !f.pinned; save("favs"); render(); } return; }
  if ((x = b("[data-watch]"))) { const f = S.favs.find(f => f.id === x.dataset.watch); if (f) { f.watch = !f.watch; if (f.watch && !S.alerts) { S.alerts = true; save("alerts"); if ("Notification" in window) Notification.requestPermission().catch(() => {}); } save("favs"); render(); } return; }
  if ((x = b("[data-unfav]"))) { S.favs = S.favs.filter(f => f.id !== x.dataset.unfav); save("favs"); render(); return; }
  if ((x = b("[data-goplace]"))) { const p = S.places.find(y => y.id === x.dataset.goplace); if (p) { S.origin = { type: "place", place: { title: p.label, subtitle: "", coordinate: p.coordinate, kind: "saved" } }; save("origin"); rerank(); setTab("find"); } return; }
  if ((x = b("[data-delplace]"))) { S.places = S.places.filter(p => p.id !== x.dataset.delplace); save("places"); render(); return; }
  if ((x = b("[data-addplace]"))) { const role = x.dataset.addplace; openSearch({ pick: (place) => { const label = role === "home" ? L_("Home", "屋企") : role === "work" ? L_("Work", "公司") : place.title; S.places = S.places.filter(p => role === "custom" || p.role !== role); S.places.push({ id: "p" + Date.now(), label, role, coordinate: place.coordinate }); save("places"); render(); } }); return; }
  if ((x = b("[data-gosearch]"))) { pickSearch("search:" + x.dataset.gosearch); return; }
  if ((x = b("[data-editveh]"))) { openVehicleEditor(S.vehicles.find(v => v.id === x.dataset.editveh)); return; }
  if ((x = b("[data-useveh]"))) { S.activeVehicleId = x.dataset.useveh; save("activeVehicleId"); S.filter.vehicleType = vehicle().type; save("filter"); rerank(); render(); return; }
  if ((x = b("[data-delveh]"))) { const dv = S.vehicles.find(v => v.id === x.dataset.delveh); if (!(await dialog({ title: L_("Delete this vehicle?", "刪除呢架車？"), text: dv?.nickname || "", ok: L_("Delete", "刪除"), danger: true }))) return; S.vehicles = S.vehicles.filter(v => v.id !== x.dataset.delveh); if (S.activeVehicleId === x.dataset.delveh) S.activeVehicleId = S.vehicles[0]?.id || null; save("vehicles"); save("activeVehicleId"); rerank(); render(); return; }
  if ((x = b(".switch"))) { x.setAttribute("aria-checked", x.getAttribute("aria-checked") !== "true"); return; }
  if ((x = b("#scrim"))) { closeSheet(); return; }
  if ((x = b("#map-here"))) { if (map) { const c = map.getCenter(); S.origin = { type: "place", place: { title: L_("Map area", "地圖呢一區"), subtitle: "", coordinate: C.clampHK({ lat: c.lat, lng: c.lng }), kind: "mapArea" } }; save("origin"); rerank(); render(); toast(L_("Using the map centre as start", "已經用地圖中心做起點")); } return; }
  if ((x = b("#map-locate"))) { const o = originPoint(); if (o && map) mapCentreOn(o, 16); else startGeo(); return; }
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { if (!$("dlg").hidden) closeDialog(null); else if ($("search").classList.contains("on")) closeSearch(); else if (!$("sheet").hidden) closeSheet(); return; }
  if (e.key === "Tab") { if (!$("dlg").hidden) trapTab($("dlg"), e); else if (!$("sheet").hidden) trapTab($("sheet"), e); }
});
window.addEventListener("online", () => { S.online = true; toast(L_("Back online", "已重新連線")); refresh(true); });
window.addEventListener("offline", () => { S.online = false; render(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) { S.now = Date.now(); refresh(false); } });
window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (h.startsWith("cp/")) openDetail(decodeURIComponent(h.slice(3))); else if (TABS.some(t => t[0] === h) && h !== S.tab) setTab(h); });

// -------------------------------------------------------------- boot -----
(async function init() {
  document.documentElement.lang = S.lang === "en" ? "en-HK" : "zh-HK";
  const h = location.hash.slice(1);
  if (TABS.some(t => t[0] === h)) S.tab = h;
  for (const p of document.querySelectorAll(".panel")) p.classList.toggle("on", p.id === "panel-" + S.tab);
  render();
  if (S.origin.type === "current" && !S.fixed && S.onboarded) startGeo();   // first run explains before the permission prompt
  if (S.session) scheduleReminder();
  await refresh(false);
  checkArrival();   // reopening the app inside the car park you drove to counts as arriving
  if (h.startsWith("cp/")) openDetail(decodeURIComponent(h.slice(3)));
  else if (qs.get("cp")) openDetail(qs.get("cp"));
  setInterval(() => { if (!document.hidden) refresh(false); }, REFRESH.vacancy);
  setInterval(() => { if (!document.hidden && S.tab === "find" && $("sheet").hidden) { S.now = Date.now(); rerank(); render(); } }, 30e3);
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").then(reg => {
      reg.addEventListener("updatefound", () => { const w = reg.installing; w && w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) { toast(L_("Update ready. Reopen the app to use it.", "有更新，重開 app 即可使用。")); } }); });
    }).catch(() => {});
  }
})();
