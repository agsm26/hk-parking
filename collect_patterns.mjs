// Sample the live feeds once and fold the readings into one hourly bucket.
//
// Run by .github/workflows/patterns.yml every hour. It imports core.js, so the
// ids it writes are exactly the ids the app uses — no second implementation to
// drift. One run rewrites a single ~7 KB slice file, which is why the history
// can live in the repository without it swelling.
//
//   node collect_patterns.mjs [--dry]
//
import * as C from "./core.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const DIR = "data/patterns", DRY = process.argv.includes("--dry");
const now = Date.now(), slice = C.sliceFor(now);
const readJSON = (p, fb) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fb; } };

async function get(url, asText = false, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 90e3);
      const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "carparkhk-patterns" } });
      clearTimeout(t);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return asText ? r.text() : r.json();
    } catch (e) { if (i >= tries) throw e; await new Promise(r => setTimeout(r, 2000 * i)); }
  }
}

// ---- one sample of every place that publishes a private-car reading --------
const sample = {};
let carParks = 0, meters = 0;
try {
  const vac = await get("https://api.data.gov.hk/v1/carpark-info-vacancy?data=vacancy");
  for (const [id, byType] of Object.entries(C.normalizeVacancy(vac.results || []))) {
    const r = byType.privateCar; if (!r) continue;
    if (r.kind === "count" && r.count != null) { sample[id] = { count: r.count, hasSpace: r.count > 0 }; carParks++; }
    else if (r.kind === "indicator" && r.hasSpace != null) { sample[id] = { count: null, hasSpace: r.hasSpace }; carParks++; }
  }
} catch (e) { console.error("vacancy feed failed:", e.message); }

try {
  const zones = readJSON("data/meter_zones.json", null);
  if (zones?.index) {
    const csv = await get("https://resource.data.one.gov.hk/td/psiparkingspaces/occupancystatus/occupancystatus.csv", true);
    for (const [id, byType] of Object.entries(C.meterReadings(csv, zones.index, now))) {
      const r = byType.privateCar;
      if (r?.kind === "count" && r.count != null) { sample[id] = { count: r.count, hasSpace: r.count > 0 }; meters++; }
    }
  }
} catch (e) { console.error("meter occupancy failed:", e.message); }

const seen = Object.keys(sample).length;
console.log(`${new Date(now).toISOString()} slice ${slice}: ${carParks} car parks, ${meters} meter sections, ${seen} readings`);
// A run that saw nothing must not overwrite a good slice with silence.
if (seen === 0) { console.error("no readings; leaving the history untouched"); process.exit(0); }

// ---- fold into the slice ---------------------------------------------------
mkdirSync(DIR, { recursive: true });
const idxPath = `${DIR}/index.json`;
const index = readJSON(idxPath, { version: 1, ids: [], slices: [] });
const ids = index.ids.slice(), known = new Set(ids);
for (const id of Object.keys(sample).sort()) if (!known.has(id)) { ids.push(id); known.add(id); }  // append only: positions are the format
const added = ids.length - index.ids.length;
// The index also lists which hours have been recorded, so the app never asks
// for a slice that does not exist yet — the history fills in over the first day.
const slices = Array.isArray(index.slices) ? index.slices.slice() : [];
const newSlice = !slices.includes(slice); if (newSlice) { slices.push(slice); slices.sort(); }

const path = `${DIR}/${slice}.json`;
const prev = readJSON(path, null);
const old = prev ? C.decodeSlice(index.ids, prev.d) : {};
const next = {};
for (const id of ids) {
  const s = sample[id];
  next[id] = s ? C.foldSample(old[id], s.count, s.hasSpace) : old[id];
}
const folded = Object.values(next).filter(Boolean).length;

if (DRY) { console.log(`dry run: would fold ${seen} readings into ${slice} (${folded} places, ${added} new ids)`); process.exit(0); }

if (added || newSlice) writeJSON(idxPath, { version: 1, updatedAt: new Date(now).toISOString(), count: ids.length, slices, ids });
writeJSON(path, { version: 1, at: new Date(now).toISOString(), slice, places: folded, d: C.encodeSlice(ids, next) });
console.log(`folded into ${path} (${folded} places${added ? `, ${added} new ids` : ""}${newSlice ? ", new hour" : ""}); ${slices.length}/72 hours recorded`);

function writeJSON(p, obj) { writeFileSync(p, JSON.stringify(obj) + "\n"); }
