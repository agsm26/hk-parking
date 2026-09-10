// core.js — all the logic of 搵車位 / Car Park HK that does not touch the screen.
//
// This is a port of the Swift ParkingCore package (same rules, same numbers), so
// the behaviour proven by its 86 tests carries over. It runs unchanged in the
// browser (ES module) and under `node --test` (tests/core.test.mjs).
//
// Nothing here fabricates data: a missing height is "not confirmed", a negative
// vacancy is "unknown", a reading older than an hour is "no live data".

// ------------------------------------------------------------------ geo ----

/** Hong Kong: Sha Tau Kok to Po Toi, Soko Islands to Tung Ping Chau, small margin.
 *  North of 22.58 is Shenzhen. One constant drives the map bounds, place search
 *  and every imported record. */
export const HK = { minLat: 22.13, minLng: 113.80, maxLat: 22.58, maxLng: 114.45,
                    centre: { lat: 22.3193, lng: 114.1694 } };

export function inHK(p) {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
    p.lat >= HK.minLat && p.lat <= HK.maxLat && p.lng >= HK.minLng && p.lng <= HK.maxLng;
}

export function clampHK(p) {
  return { lat: Math.min(Math.max(p.lat, HK.minLat), HK.maxLat), lng: Math.min(Math.max(p.lng, HK.minLng), HK.maxLng) };
}

/** Great-circle distance in metres. */
export function distM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function fmtDist(m, lang) {
  if (m < 950) { const r = Math.round(m / 10) * 10; return lang === "en" ? `${r} m` : `${r} 米`; }
  const km = (m / 1000).toFixed(1);
  return lang === "en" ? `${km} km` : `${km} 公里`;
}

// ----------------------------------------------------------------- text ----

export function pick(lang, en, tc) { return lang === "en" ? en : tc; }
/** {en,tc} → string for the language, falling back to the other side. */
export function t(lang, lt) {
  if (!lt) return "";
  if (typeof lt === "string") return lt;
  return lang === "en" ? (lt.en ?? lt.tc ?? "") : (lt.tc ?? lt.en ?? "");
}
export function lt(en, tc) { const o = {}; if (en) o.en = en; if (tc) o.tc = tc; return o; }
export const isEmptyLT = (x) => !x || (!x.en && !x.tc);

// Simplified → Traditional for characters common in Hong Kong place names.
const S2T_PAIRS = "龙龍 湾灣 华華 东東 头頭 长長 门門 环環 岛島 丽麗 边邊 观觀 广廣 场場 车車 园園 医醫 学學 铁鐵 银銀 号號 楼樓 层層 区區 县縣 镇鎮 马馬 鱼魚 岭嶺 团團 国國 农農 业業 产產 电電 视視 汉漢 阳陽 阴陰 兴興 庆慶 丰豐 会會 关關 张張 陈陳 刘劉 郑鄭 邓鄧 杨楊 齐齊 圣聖 亚亞 义義 礼禮 荣榮 满滿 凤鳳 双雙 图圖 书書 馆館 卫衛 师師 战戰 胜勝 处處 众眾 万萬 亿億 乡鄉 达達 运運 连連 进進 远遠 迁遷 过過 还還 这這 侨僑 荫蔭 兰蘭 苏蘇 沥瀝 坜壢 纪紀 线線 铜銅 锦錦 键鍵 属屬 兽獸 汇匯 尔爾 罗羅 顿頓 时時 结結 经經 纶綸 绿綠 缆纜 网網 凼氹 声聲 财財 贝貝 购購 贸貿 资資 检檢 药藥 术術 应應 变變 树樹 湿濕 葵葵 屯屯 朗朗 围圍 岗崗 钻鑽 蒲蒲 启啟 顺順 联聯 寿壽 龄齡 齿齒 舍捨 谷穀 面麵 后後 发發 复復 干乾 里裡 台臺 只隻 冲沖 松鬆 几幾 蚝蠔 灿燦 迳逕 阁閣 缤繽 纷紛";
const S2T = new Map(S2T_PAIRS.split(" ").filter(p => p.length === 2 && p[0] !== p[1]).map(p => [p[0], p[1]]));
export const toTrad = (s) => Array.from(String(s ?? ""), c => S2T.get(c) ?? c).join("");
const DROP = new Set([" ", ",", "，", "、", "．", ".", "·", "-", "－", "_", "（", "）", "(", ")", "　", "/", "\\", "'", "\""]);
export const normText = (s) => Array.from(toTrad(s).toLowerCase()).filter(c => !DROP.has(c)).join("");
export const words = (s) => toTrad(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// ------------------------------------------------------------ districts ----

export const REGIONS = { hongKongIsland: lt("Hong Kong Island", "香港島"), kowloon: lt("Kowloon", "九龍"), newTerritories: lt("New Territories", "新界") };

export const DISTRICTS = [
  ["centralAndWestern", "hongKongIsland", "Central & Western", "中西區", ["central and western", "central western", "central", "中西", "中環", "西環", "上環"]],
  ["wanChai", "hongKongIsland", "Wan Chai", "灣仔區", ["wanchai", "灣仔", "銅鑼灣", "causeway bay"]],
  ["eastern", "hongKongIsland", "Eastern", "東區", ["east", "太古", "北角", "柴灣", "鰂魚涌"]],
  ["southern", "hongKongIsland", "Southern", "南區", ["south", "香港仔", "黃竹坑"]],
  ["yauTsimMong", "kowloon", "Yau Tsim Mong", "油尖旺區", ["yau tsim mong", "yautsimmong", "油尖旺", "旺角", "尖沙咀", "油麻地", "mong kok", "tsim sha tsui", "yau ma tei"]],
  ["shamShuiPo", "kowloon", "Sham Shui Po", "深水埗區", ["sham shui po", "深水埗", "長沙灣", "cheung sha wan"]],
  ["kowloonCity", "kowloon", "Kowloon City", "九龍城區", ["kowloon city", "九龍城", "紅磡", "hung hom", "土瓜灣", "kai tak", "啟德"]],
  ["wongTaiSin", "kowloon", "Wong Tai Sin", "黃大仙區", ["wong tai sin", "黃大仙", "新蒲崗", "san po kong", "鑽石山"]],
  ["kwunTong", "kowloon", "Kwun Tong", "觀塘區", ["kwun tong", "觀塘", "九龍灣", "kowloon bay", "牛頭角", "藍田", "油塘"]],
  ["kwaiTsing", "newTerritories", "Kwai Tsing", "葵青區", ["kwai tsing", "葵青", "葵涌", "青衣", "kwai chung", "tsing yi"]],
  ["tsuenWan", "newTerritories", "Tsuen Wan", "荃灣區", ["tsuen wan", "荃灣"]],
  ["tuenMun", "newTerritories", "Tuen Mun", "屯門區", ["tuen mun", "屯門"]],
  ["yuenLong", "newTerritories", "Yuen Long", "元朗區", ["yuen long", "元朗", "天水圍", "tin shui wai"]],
  ["north", "newTerritories", "North", "北區", ["north district", "上水", "粉嶺", "sheung shui", "fanling"]],
  ["taiPo", "newTerritories", "Tai Po", "大埔區", ["tai po", "大埔"]],
  ["shaTin", "newTerritories", "Sha Tin", "沙田區", ["sha tin", "shatin", "沙田", "馬鞍山", "ma on shan"]],
  ["saiKung", "newTerritories", "Sai Kung", "西貢區", ["sai kung", "西貢", "將軍澳", "tseung kwan o", "tko"]],
  ["islands", "newTerritories", "Islands", "離島區", ["islands", "離島", "東涌", "tung chung", "lantau", "大嶼山"]],
].map(([id, region, en, tc, aliases]) => ({ id, region, name: lt(en, tc), aliases }));

export function matchDistrict(raw) {
  if (!raw) return null;
  let text = toTrad(String(raw)).trim().toLowerCase();
  for (const suf of [" district", "district", "區"]) if (text.endsWith(suf)) text = text.slice(0, -suf.length).trim();
  if (!text) return null;
  for (const d of DISTRICTS) {
    const en = d.name.en.toLowerCase(), tc = d.name.tc.replace("區", "");
    if (text === en || text === tc || text === en.replace("&", "and")) return d.id;
  }
  for (const d of DISTRICTS) if (d.aliases.some(a => a.toLowerCase() === text)) return d.id;
  for (const d of DISTRICTS) {
    if (text.includes(d.name.en.toLowerCase())) return d.id;
    const tc = d.name.tc.replace("區", ""); if (tc && text.includes(tc)) return d.id;
  }
  return null;
}
export const districtById = (id) => DISTRICTS.find(d => d.id === id) || null;

// ----------------------------------------------------------- time / HK -----

const HK_OFFSET_MS = 8 * 3600 * 1000;
/** "2026-09-05 10:07:05" (Hong Kong local) → epoch ms, or null. */
export function parseHKTime(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) { const d = Date.parse(s); return Number.isFinite(d) ? d : null; }
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) - HK_OFFSET_MS;
}
/** Hong Kong weekday (0 Sun … 6 Sat) and minutes since midnight for an epoch. */
export function hkClock(ms) {
  const d = new Date(ms + HK_OFFSET_MS);
  return { weekday: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
const WD = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
export function clockTime(txt) {
  if (!txt) return null;
  const m = String(txt).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 24 || mi > 59) return null;
  return Math.max(0, Math.min(1440, h * 60 + mi));
}
export function makeWindow(weekdays, start, end, excludesPH = false) {
  const days = new Set((weekdays && weekdays.length ? weekdays : [...WD, "PH"]).map(w => String(w).toUpperCase()));
  return { weekdays: [...days], start, end, excludesPH };
}
export const ALWAYS = makeWindow(null, null, null);
export function windowIsAllDay(w) {
  if (w.start == null || w.end == null) return true;
  if (w.start === w.end) return true;
  return w.start === 0 && w.end >= 1440;
}
export function windowContains(w, ms, isPH = false) {
  const { weekday, minutes } = hkClock(ms);
  const dayOK = w.weekdays.includes(WD[weekday]) || (isPH && w.weekdays.includes("PH"));
  if (isPH && w.excludesPH) return false;
  if (!dayOK) return false;
  if (w.start == null || w.end == null || w.start === w.end) return true;
  const e = w.end === 0 ? 1440 : w.end;
  if (w.start < e) return minutes >= w.start && minutes < e;
  return minutes >= w.start || minutes < e;
}
export function windowText(w, lang) {
  if (windowIsAllDay(w)) return pick(lang, "24 hours", "24 小時");
  const f = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${f(w.start)} – ${f(w.end)}`;
}
export function weekdaysText(w, lang) {
  const set = new Set(w.weekdays);
  if (set.size >= 7) return pick(lang, "Daily", "每日");
  const names = lang === "en" ? { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun", PH: "PH" }
                              : { MON: "一", TUE: "二", WED: "三", THU: "四", FRI: "五", SAT: "六", SUN: "日", PH: "假期" };
  return ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN", "PH"].filter(d => set.has(d)).map(d => names[d]).join(lang === "en" ? " " : "、");
}

// ----------------------------------------------------- availability -------

export const FRESH = { live: 5 * 60e3, recent: 15 * 60e3, stale: 60 * 60e3, limitedAtOrBelow: 5 };

export function freshness(updatedAt, now) {
  if (updatedAt == null) return "none";
  const age = now - updatedAt;
  if (age <= FRESH.live) return "live";
  if (age <= FRESH.recent) return "recent";
  if (age <= FRESH.stale) return "delayed";
  return "stale";
}
export const freshUsable = (f) => f === "live" || f === "recent" || f === "delayed";

/** 'available' | 'limited' | 'full' | 'unknown'. Stale readings are unknown. */
export function level(r, now) {
  if (!r || !freshUsable(freshness(r.updatedAt, now))) return "unknown";
  if (r.kind === "indicator") return r.hasSpace == null ? "unknown" : (r.hasSpace ? "available" : "full");
  if (r.kind === "count") {
    if (r.count == null) return "unknown";
    if (r.count <= 0) return "full";
    if (r.count <= FRESH.limitedAtOrBelow) return "limited";
    return "available";
  }
  return "unknown";
}
export const LEVEL_LABEL = { available: lt("Available", "有位"), limited: lt("Limited", "少量車位"), full: lt("Full", "爆滿"), unknown: lt("No live data", "冇即時資料") };

export function freshnessText(f, updatedAt, now, lang) {
  const en = lang === "en";
  if (f === "live") return en ? "Live" : "即時";
  if (f === "recent" || f === "delayed") {
    const mins = Math.max(1, Math.round((now - updatedAt) / 60e3));
    const base = en ? `Updated ${mins} min ago` : `${mins} 分鐘前更新`;
    return f === "delayed" ? base + (en ? " · may be delayed" : "・或有延遲") : base;
  }
  if (f === "stale" && updatedAt != null) {
    const hours = Math.floor((now - updatedAt) / 3600e3);
    if (hours >= 48) { const d = Math.floor(hours / 24); return en ? `Last update ${d} days ago` : `${d} 日前最後更新`; }
    return en ? `Last update ${Math.max(1, hours)} h ago` : `${Math.max(1, hours)} 小時前最後更新`;
  }
  return en ? "No live vacancy feed" : "冇即時空位資料";
}

// ----------------------------------------------------- one-stop feed ------

export const VEHICLE_TYPES = ["privateCar", "motorCycle", "LGV", "HGV", "coach"];
export const VEHICLE_NAME = {
  privateCar: lt("Private car", "私家車"), motorCycle: lt("Motorcycle", "電單車"),
  LGV: lt("Light goods vehicle", "輕型貨車"), HGV: lt("Heavy goods vehicle", "重型貨車"), coach: lt("Coach", "旅遊巴"),
};
const num = (v) => { if (v == null || v === "") return null; if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/,/g, "").trim(); const d = parseFloat(s); if (Number.isFinite(d)) return d;
  const digits = s.replace(/[^0-9.\-]/g, ""); const e = parseFloat(digits); return Number.isFinite(e) ? e : null; };
const int = (v) => { const d = num(v); return d == null ? null : Math.round(d); };
const str = (v) => { if (v == null) return null; const s = String(v).trim(); return s ? s : null; };
const arr = (v) => v == null ? [] : Array.isArray(v) ? v : [v];
const strArr = (v) => Array.isArray(v) ? v.map(str).filter(Boolean) : (typeof v === "string" ? v.split(",").map(s => s.trim()).filter(Boolean) : []);

const MALL_WORDS = ["商場", "廣場", "購物", "百貨", "名店", "mall", "plaza", "outlet", "shopping", "arcade"];
const MALL_NAMES = ["海港城", "又一城", "時代廣場", "朗豪坊", "圓方", "太古城", "希慎", "apm", "megabox", "d2 place", "v city", "yoho", "東薈城", "新城市", "置地", "ifc", "k11", "the one", "崇光", "sogo", "olympian", "moko", "poplaza", "t town", "airside", "telford", "德福", "amoy", "淘大", "domain", "大本型", "landmark", "harbour city", "festival walk", "times square", "langham place", "elements", "cityplaza", "pacific place", "太古廣場"];
export function isMallName(name, address) {
  const s = ((name || "") + " " + (address || "")).toLowerCase();
  return MALL_WORDS.some(w => s.includes(w)) || MALL_NAMES.some(w => s.includes(w));
}

/** Prefer a row marked for private cars, else the lowest positive height; 0/missing = not confirmed. */
export function pickHeight(rows) {
  const list = arr(rows).map(r => ({ h: num(r?.height), remark: str(r?.remark) }));
  const note = list.map(r => r.remark).find(Boolean) || null;
  const usable = list.filter(r => r.h != null && r.h > 0);
  if (!usable.length) return { metres: null, note };
  const forCars = usable.filter(r => /私家車|private car/i.test(r.remark || ""));
  const pool = forCars.length ? forCars : usable;
  return { metres: Math.min(...pool.map(r => r.h)), note };
}
export function heightText(h, lang) {
  if (h?.metres == null) return pick(lang, "Not confirmed", "未確認");
  let s = h.metres.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return pick(lang, `${s} m clearance`, `限高 ${s} 米`);
}

export function legacyHourly(note) {
  if (!note) return null;
  for (const re of [/每小時\s*(?:HK)?\$?\s*(\d+(?:\.\d+)?)/i, /(?:HK)?\$\s*(\d+(?:\.\d+)?)\s*(?:\/|per)\s*(?:hr|hour|小時)/i, /(\d+(?:\.\d+)?)\s*(?:元|蚊)\s*(?:\/|每)\s*小時/]) {
    const m = note.match(re); if (m) return parseFloat(m[1]);
  }
  return null;
}
const looksLikeTariff = (n) => /\$|每小時|per hour|hourly|收費/i.test(n || "");
function windowFrom(dto) { return makeWindow(strArr(dto?.weekdays), clockTime(dto?.periodStart), clockTime(dto?.periodEnd), !!dto?.excludePublicHoliday); }

export function feeSchedule(v, legacyNote) {
  const hourly = [], flat = [], privileges = [];
  if (v) {
    for (const r of arr(v.hourlyCharges)) { const price = num(r?.price); if (price == null) continue;
      const half = /half/i.test(r?.type || "");
      hourly.push({ window: windowFrom(r), price, unitMinutes: half ? 30 : 60, minimumUnits: int(r?.usageMinimum), covered: str(r?.covered), remark: str(r?.remark), isEstimate: false }); }
    for (const r of arr(v.dayNightParks)) { const price = num(r?.price); if (price == null) continue; const ty = (r?.type || "").toLowerCase();
      flat.push({ kind: ty.includes("night") ? "nightPark" : ty.includes("day") ? "dayPark" : ty.includes("24") ? "twentyFourHours" : "other", window: windowFrom(r), price, remark: str(r?.remark) }); }
    for (const r of arr(v.monthlyCharges)) { const price = num(r?.price); if (price == null) continue; flat.push({ kind: "monthly", window: windowFrom(r), price, remark: str(r?.remark) || str(r?.type) }); }
    for (const r of arr(v.privileges)) { const d = str(r?.description) || str(r?.remark); if (d) privileges.push(d); }
  }
  if (legacyNote && !hourly.length) { const est = legacyHourly(legacyNote); if (est != null) hourly.push({ window: ALWAYS, price: est, unitMinutes: 60, remark: legacyNote, isEstimate: true }); }
  return { hourly, flat, privileges, note: str(legacyNote) };
}
export const feeIsEmpty = (f) => !f || (!f.hourly.length && !f.flat.length && !f.privileges.length && !f.note);
export const hourlyEquivalent = (r) => r.unitMinutes > 0 ? r.price * 60 / r.unitMinutes : r.price;
export function hourlyRateAt(fee, ms) {
  if (!fee || !fee.hourly.length) return null;
  const now = fee.hourly.find(r => windowContains(r.window, ms)); if (now) return now;
  const wd = WD[hkClock(ms).weekday];
  return fee.hourly.find(r => r.window.weekdays.includes(wd)) || fee.hourly[0];
}

export function normalizeInfoRow(r, lang) {
  const lat = num(r?.latitude), lng = num(r?.longitude);
  if (lat == null || lng == null || (lat === 0 && lng === 0) || !inHK({ lat, lng })) return null;
  const id = str(r?.park_Id ?? r?.parkId); if (!id) return null;
  const T = (s) => lang === "en" ? lt(s, null) : lt(null, s);
  const name = str(r?.name) || pick(lang, "Car park", "停車場");
  const a = r?.address || {};
  const composed = [str(a.buildingName), [str(a.buildingNo), str(a.streetName)].filter(Boolean).join(" ") || null, str(a.subDistrict), str(a.dcDistrict)].filter(Boolean).join(", ") || null;
  const address = str(r?.displayAddress) || composed || str(r?.district) || "";
  const districtRaw = str(r?.district) || str(a.dcDistrict);
  const height = pickHeight(r?.heightLimits);
  const vehicles = {}; for (const k of VEHICLE_TYPES) if (r?.[k] && typeof r[k] === "object" && !Array.isArray(r[k])) vehicles[k] = r[k];
  const fees = {}; for (const [k, v] of Object.entries(vehicles)) { const f = feeSchedule(v, null); if (!feeIsEmpty(f)) fees[k] = f; }
  if (!fees.privateCar && height.note && looksLikeTariff(height.note)) fees.privateCar = feeSchedule(null, height.note);
  const capacity = {}; for (const [k, v] of Object.entries(vehicles)) { const c = { total: int(v.space), ev: int(v.spaceEV), disabled: int(v.spaceDIS), unloading: int(v.spaceUNL) }; if (Object.values(c).some(x => x != null)) capacity[k] = c; }
  const enriched = Object.keys(vehicles).length > 0 || !!str(r?.nature) || strArr(r?.facilities).length > 0;
  const sources = ["transportDepartmentOneStop"]; if (enriched) sources.push("kowloonEast");
  const url = (s) => { s = str(s); if (!s) return null; if (/^http:\/\//i.test(s)) s = "https://" + s.slice(7); else if (!/^https:\/\//i.test(s)) s = "https://" + s; return s; };
  const facilities = strArr(r?.facilities).map(f => f.toLowerCase()).filter(f => ["evcharger", "disabilities", "unloading", "washing"].includes(f)).map(f => f === "evcharger" ? "evCharger" : f);
  return {
    id, kind: "offStreet", name: T(name), address: T(address), district: matchDistrict(districtRaw) || matchDistrict(a.dcDistrict),
    districtText: T(districtRaw || ""), lat, lng, entrance: null, height,
    openingStatus: (r?.opening_status || "").toUpperCase() === "OPEN" ? "open" : (r?.opening_status || "").toUpperCase() === "CLOSED" ? "closed" : "unknown",
    openingHours: arr(r?.openingHours).map(windowFrom), fees, facilities, paymentMethods: strArr(r?.paymentMethods).map(p => p.toLowerCase()),
    capacity, nature: str(r?.nature)?.toLowerCase() || null, carParkType: str(r?.carpark_Type)?.toLowerCase() || null,
    contact: str(r?.contactNo), website: url(r?.website), photoURL: url(r?.renditionUrls?.carpark_photo),
    isMall: isMallName(name, address), isEnriched: enriched, sources, modifiedAt: parseHKTime(r?.modifiedDate),
    bayCount: null, infoNote: null, operatorName: null, factsProvenance: null, searchAliases: [],
  };
}

/** Field-wise merge: self wins, other fills gaps (used to fold zh_TW into en_US). */
export function mergeCarPark(a, b) {
  const m = { ...a };
  m.name = { ...b.name, ...a.name }; m.address = { ...b.address, ...a.address }; m.districtText = { ...b.districtText, ...a.districtText };
  m.district = a.district || b.district; m.entrance = a.entrance || b.entrance;
  if (a.height.metres == null) m.height = b.height.metres != null ? b.height : { metres: null, note: a.height.note || b.height.note };
  if (a.openingStatus === "unknown") m.openingStatus = b.openingStatus;
  if (!a.openingHours.length) m.openingHours = b.openingHours;
  if (!Object.keys(a.fees).length) m.fees = b.fees;
  m.facilities = [...new Set([...a.facilities, ...b.facilities])];
  if (!a.paymentMethods.length) m.paymentMethods = b.paymentMethods;
  if (!Object.keys(a.capacity).length) m.capacity = b.capacity;
  for (const k of ["nature", "carParkType", "contact", "website", "photoURL", "modifiedAt", "operatorName", "factsProvenance", "infoNote", "bayCount"]) m[k] = a[k] ?? b[k];
  m.isMall = a.isMall || b.isMall; m.isEnriched = a.isEnriched || b.isEnriched;
  m.sources = [...new Set([...a.sources, ...b.sources])];
  m.searchAliases = [...new Set([...(a.searchAliases || []), ...(b.searchAliases || [])])];
  return m;
}

export function normalizeInfo(rowsEN, rowsTC) {
  const byId = new Map(), order = [];
  for (const r of rowsEN || []) { const cp = normalizeInfoRow(r, "en"); if (!cp) continue; if (!byId.has(cp.id)) order.push(cp.id); byId.set(cp.id, byId.has(cp.id) ? mergeCarPark(byId.get(cp.id), cp) : cp); }
  for (const r of rowsTC || []) { const cp = normalizeInfoRow(r, "tc"); if (!cp) continue; if (byId.has(cp.id)) byId.set(cp.id, mergeCarPark(byId.get(cp.id), cp)); else { order.push(cp.id); byId.set(cp.id, cp); } }
  return order.map(id => byId.get(id));
}

export function normalizeVacancyEntry(type, e, source = "transportDepartmentOneStop") {
  const time = parseHKTime(e?.lastupdate ?? e?.lastUpdate ?? e?.lastupdated);
  const vtype = String(e?.vacancy_type ?? e?.vacancyType ?? "A").toUpperCase();
  const raw = int(e?.vacancy ?? e?.vacancy_A ?? e?.vacancyA ?? e?.space);
  const base = { vehicleType: type, updatedAt: time, category: str(e?.category), source };
  if (raw == null || raw < 0) return { ...base, kind: "unknown", count: null, hasSpace: null, evCount: null, disabledCount: null };
  if (vtype === "A") { const ev = int(e?.vacancyEV), dis = int(e?.vacancyDIS);
    return { ...base, kind: "count", count: raw, hasSpace: raw > 0, evCount: ev != null && ev >= 0 ? ev : null, disabledCount: dis != null && dis >= 0 ? dis : null }; }
  if (vtype === "B") return { ...base, kind: "indicator", count: null, hasSpace: raw >= 1, evCount: null, disabledCount: null };
  return { ...base, kind: "unknown", count: null, hasSpace: null, evCount: null, disabledCount: null };
}
export function normalizeVacancy(rows) {
  const out = {};
  for (const r of rows || []) {
    const id = str(r?.park_Id ?? r?.parkId); if (!id) continue;
    for (const k of VEHICLE_TYPES) { const entries = arr(r?.[k]); if (!entries.length) continue;
      const reading = normalizeVacancyEntry(k, entries[0]);
      const prev = out[id]?.[k];
      if (!prev || (reading.updatedAt ?? -Infinity) >= (prev.updatedAt ?? -Infinity)) (out[id] ||= {})[k] = reading; }
  }
  return out;
}

// -------------------------------------------------------- meters (CSV) ----

export function parseCSV(text) {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); field = ""; rows.push(row); row = []; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const OP_WINDOWS = (code) => {
  const c = String(code || "").toUpperCase().replace(/^\d+/, "");
  const monSat = ["MON", "TUE", "WED", "THU", "FRI", "SAT"], monFri = ["MON", "TUE", "WED", "THU", "FRI"], sunPH = ["SUN", "PH"], daily = [...WD, "PH"];
  const w = (d, s, e) => makeWindow(d, clockTime(s), clockTime(e));
  switch (c) {
    case "A": return [w(monSat, "08:00", "24:00")];
    case "B": case "P": return [w(monSat, "08:00", "20:00")];
    case "D": return [w(monSat, "08:00", "24:00"), w(sunPH, "10:00", "22:00")];
    case "E": return [w(daily, "07:00", "20:00")];
    case "F": return [w(daily, "08:00", "21:00")];
    case "G": return [w(daily, "07:00", "19:00")];
    case "H": return [w(daily, "08:00", "20:00")];
    case "J": return [w(daily, "08:00", "24:00")];
    case "N": return [w(daily, "19:00", "24:00")];
    case "Q": return [w(monSat, "08:00", "20:00"), w(sunPH, "10:00", "22:00")];
    case "S": return [w(monFri, "17:00", "24:00"), w(["SAT"], "08:00", "24:00"), w(sunPH, "10:00", "22:00")];
    case "T": return [w(monFri, "17:30", "24:00"), w(["SAT"], "08:00", "24:00"), w(sunPH, "10:00", "22:00")];
    default: return [w(daily, "08:00", "20:00")];
  }
};
export const OP_TEXT = (code) => {
  const c = String(code || "").toUpperCase().replace(/^\d+/, "");
  return ({
    A: "Mon–Sat 08:00–24:00, free Sun & PH · 星期一至六 08:00–24:00（星期日及公眾假期免費）",
    B: "Mon–Sat 08:00–20:00, free Sun & PH · 星期一至六 08:00–20:00（星期日及公眾假期免費）",
    D: "Mon–Sat 08:00–24:00; Sun & PH 10:00–22:00 · 星期一至六 08:00–24:00；星期日及公眾假期 10:00–22:00",
    E: "Daily 07:00–20:00 · 每日 07:00–20:00", F: "Daily 08:00–21:00 · 每日 08:00–21:00", G: "Daily 07:00–19:00 · 每日 07:00–19:00",
    H: "Daily 08:00–20:00 · 每日 08:00–20:00", J: "Daily 08:00–24:00 · 每日 08:00–24:00", N: "Daily 19:00–24:00 · 每日 19:00–24:00",
    P: "Mon–Sat 08:00–20:00, no parking Sun · 星期一至六 08:00–20:00（星期日唔准泊）",
    Q: "Mon–Sat 08:00–20:00; Sun & PH 10:00–22:00 · 星期一至六 08:00–20:00；星期日及公眾假期 10:00–22:00",
    S: "Mon–Fri 17:00–24:00; Sat 08:00–24:00; Sun & PH 10:00–22:00 · 星期一至五 17:00–24:00；星期六 08:00–24:00；星期日及公眾假期 10:00–22:00",
    T: "Mon–Fri 17:30–24:00; Sat 08:00–24:00; Sun & PH 10:00–22:00 · 星期一至五 17:30–24:00；星期六 08:00–24:00；星期日及公眾假期 10:00–22:00",
  })[c] || "Charging hours shown on the meter · 收費時段見咪錶";
};
const titleCase = (s) => String(s || "").toLowerCase().split(" ").map(w => ["of", "and", "the"].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/** parkingspaces.csv → one car park per street section (private-car bays only). */
export function meterZones(csvText) {
  const rows = parseCSV(csvText);
  const hi = rows.findIndex(r => r.includes("ParkingSpaceId"));
  if (hi < 0) return { zones: [], index: {} };
  const H = Object.fromEntries(rows[hi].map((k, i) => [k.trim(), i]));
  const col = (r, k) => (H[k] != null && H[k] < r.length ? String(r[H[k]]).trim() : "");
  const acc = new Map(), order = [];
  for (const r of rows.slice(hi + 1)) {
    if (r.length < 5 || col(r, "VehicleType").toUpperCase() !== "A") continue;
    const pole = parseInt(col(r, "PoleId"), 10); if (pole > 90000) continue;
    const id = col(r, "ParkingSpaceId"), lat = parseFloat(col(r, "Latitude")), lng = parseFloat(col(r, "Longitude"));
    if (!id || !inHK({ lat, lng })) continue;
    const key = "meter:" + (col(r, "Street_tc") || col(r, "Street")) + "|" + (col(r, "SectionOfStreet_tc") || col(r, "SectionOfStreet"));
    if (!acc.has(key)) { acc.set(key, { first: r, bays: [], latSum: 0, lngSum: 0 }); order.push(key); }
    const a = acc.get(key); a.bays.push(id); a.latSum += lat; a.lngSum += lng;
  }
  const zones = [], index = {};
  for (const key of order) {
    const a = acc.get(key), r = a.first, n = a.bays.length;
    const streetTC = col(r, "Street_tc"), sectionTC = col(r, "SectionOfStreet_tc"), streetEN = titleCase(col(r, "Street")), sectionEN = titleCase(col(r, "SectionOfStreet"));
    const inside = sectionTC.includes("停車場") || sectionEN.toLowerCase().includes("car park");
    const unit = parseFloat(col(r, "TimeUnit")) || 0, pay = parseFloat(col(r, "PaymentUnit")) || 0, lpp = parseInt(col(r, "LPP"), 10) || 0;
    const fees = {};
    if (unit > 0 && pay > 0) {
      const remark = lpp > 0 ? (lpp >= 60 ? `Max stay ${lpp / 60} h · 最多可泊 ${lpp / 60} 小時` : `Max stay ${lpp} min · 最多可泊 ${lpp} 分鐘`) : null;
      fees.privateCar = { hourly: OP_WINDOWS(col(r, "OperatingPeriod")).map(w => ({ window: w, price: pay * 60 / unit, unitMinutes: 60, minimumUnits: null, covered: null, remark, isEstimate: false })), flat: [], privileges: [], note: OP_TEXT(col(r, "OperatingPeriod")) };
    }
    zones.push({
      id: key, kind: inside ? "offStreet" : "onStreetMeter",
      name: lt(sectionEN ? `${streetEN} (near ${sectionEN})` : streetEN, sectionTC ? `${streetTC}（近${sectionTC}）` : streetTC),
      address: lt([col(r, "SubDistrict"), col(r, "District")].map(titleCase).filter(Boolean).join(", "), [col(r, "SubDistrict_tc"), col(r, "District_tc")].filter(Boolean).join(" ")),
      district: matchDistrict(col(r, "District_tc")) || matchDistrict(col(r, "District")), districtText: lt(titleCase(col(r, "District")), col(r, "District_tc")),
      lat: a.latSum / n, lng: a.lngSum / n, entrance: null, height: { metres: null, note: null }, openingStatus: "open", openingHours: [], fees,
      facilities: [], paymentMethods: [], capacity: { privateCar: { total: n, ev: null, disabled: null, unloading: null } }, nature: null, carParkType: null,
      contact: null, website: null, photoURL: null, isMall: false, isEnriched: false, sources: ["transportDepartmentMeters"], modifiedAt: null,
      bayCount: n, infoNote: null, operatorName: null, factsProvenance: null, searchAliases: [],
    });
    index[key] = a.bays;
  }
  return { zones, index };
}

/** occupancystatus.csv → readings per zone. Fetch time is the timestamp (per-bay times are state changes). */
export function meterReadings(csvText, index, now) {
  const rows = parseCSV(csvText);
  const hi = rows.findIndex(r => r.includes("ParkingSpaceId"));
  if (hi < 0) return {};
  const H = Object.fromEntries(rows[hi].map((k, i) => [k.trim(), i]));
  const status = new Map();
  for (const r of rows.slice(hi + 1)) { if (r.length < 3) continue;
    const id = String(r[H.ParkingSpaceId] ?? "").trim(); if (!id) continue;
    status.set(id, { inService: String(r[H.ParkingMeterStatus] ?? "").trim().toUpperCase() === "N", vacant: String(r[H.OccupancyStatus] ?? "").trim().toUpperCase() === "V" }); }
  const out = {};
  for (const [zone, bays] of Object.entries(index)) {
    let known = 0, free = 0;
    for (const b of bays) { const s = status.get(b); if (s?.inService) { known++; if (s.vacant) free++; } }
    out[zone] = { privateCar: known === 0
      ? { vehicleType: "privateCar", kind: "unknown", count: null, hasSpace: null, evCount: null, disabledCount: null, updatedAt: now, category: "METER", source: "transportDepartmentMeters" }
      : { vehicleType: "privateCar", kind: "count", count: free, hasSpace: free > 0, evCount: null, disabledCount: null, updatedAt: now, category: "METER", source: "transportDepartmentMeters" } };
  }
  return out;
}

// -------------------------------------------- OSM, curated, entrances -----

export function osmCarParks(doc) {
  const out = [];
  for (const r of doc?.records || []) {
    if (!inHK({ lat: r.lat, lng: r.lng })) continue;
    const name = lt(r.nameEN, r.nameTC); if (isEmptyLT(name)) continue;
    const fees = {}; const bits = [];
    if (r.fee === "yes") bits.push("Paid parking · 收費停車場"); else if (r.fee === "no") bits.push("Free parking · 免費泊車");
    if (r.feeText) bits.push(r.feeText);
    if (bits.length) fees.privateCar = { hourly: [], flat: [], privileges: [], note: bits.join(" · ") };
    const capacity = {}; if (r.capacity != null || r.capacityDisabled != null) capacity.privateCar = { total: r.capacity ?? null, ev: null, disabled: r.capacityDisabled ?? null, unloading: null };
    const info = []; if (r.openingHours) info.push(`Hours: ${r.openingHours}`); if (r.fromMall) info.push("Location is the mall itself; entrance not mapped · 位置為商場本身，入口未有標示");
    const op = lt(r.operatorEN, r.operatorTC);
    out.push({
      id: r.id, kind: "offStreet", name, address: lt(r.street, r.streetTC), district: null, districtText: {}, lat: r.lat, lng: r.lng, entrance: null,
      height: { metres: r.maxHeightMetres ?? null, note: null }, openingStatus: "unknown", openingHours: [], fees,
      facilities: (r.capacityDisabled ?? 0) > 0 ? ["disabilities"] : [], paymentMethods: [], capacity, nature: null,
      carParkType: r.parkingType ? r.parkingType.replace(/_/g, " ") : null, contact: r.phone ?? null, website: r.website ?? null, photoURL: null,
      isMall: !!r.isMall, isEnriched: false, sources: ["openStreetMap"], modifiedAt: null, bayCount: null,
      infoNote: info.length ? lt(info.join(" · "), info.join(" · ")) : null, operatorName: isEmptyLT(op) ? null : op, factsProvenance: null,
      searchAliases: r.aliases || [],
    });
  }
  return out;
}

export const providesLive = (s) => ["transportDepartmentOneStop", "transportDepartmentMeters", "kowloonEast", "operatorFeed"].includes(s);
export const isInfoOnly = (cp) => !cp.sources.some(providesLive);
export const hasEntrance = (cp) => !!cp.entrance || cp.kind === "onStreetMeter";
export const navPoint = (cp) => cp.entrance ? { lat: cp.entrance.lat, lng: cp.entrance.lng } : { lat: cp.lat, lng: cp.lng };

/** Drop static records within 80 m of, or sharing a name with, a live-feed record. */
export function dedupe(primary, extras, radius = 80) {
  const names = new Set(primary.flatMap(cp => Object.values(cp.name)).map(normText).filter(n => n.length >= 4));
  const grid = new Map(); const cell = (p) => `${Math.floor(p.lat / 0.001)}_${Math.floor(p.lng / 0.001)}`;
  for (const p of primary) { const k = cell(p); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p); }
  const out = [...primary], seen = new Set(primary.map(p => p.id));
  outer: for (const e of extras) {
    if (seen.has(e.id)) continue;
    if (Object.values(e.name).map(normText).some(n => names.has(n))) continue;
    const [cx, cy] = cell(e).split("_").map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
      for (const p of grid.get(`${cx + dx}_${cy + dy}`) || []) if (distM(p, e) <= radius) continue outer;
    out.push(e); seen.add(e.id);
  }
  return out;
}

export function applyCurated(carparks, curatedDoc) {
  const entries = curatedDoc?.entries || []; if (!entries.length) return carparks;
  const byId = new Map(entries.map(e => [e.carParkId, e]));
  const byName = new Map(); for (const e of entries) for (const n of e.matchNames || []) byName.set(normText(n), e);
  return carparks.map(cp => {
    const e = byId.get(cp.id) || Object.values(cp.name).map(normText).map(n => byName.get(n)).find(Boolean);
    if (!e) return cp;
    const m = { ...cp, name: { ...cp.name }, fees: { ...cp.fees }, sources: [...cp.sources] };
    if (!m.name.tc && e.nameTC) m.name.tc = e.nameTC;
    if (!m.operatorName && (e.operatorEN || e.operatorTC)) m.operatorName = lt(e.operatorEN, e.operatorTC);
    if (m.height.metres == null && e.heightMetres) m.height = { metres: e.heightMetres, note: m.height.note };
    if (e.feeEN || e.feeTC) { const ex = m.fees.privateCar; if (!ex || (!ex.hourly.length && !ex.flat.length)) m.fees.privateCar = { hourly: [], flat: [], privileges: ex?.privileges || [], note: [e.feeEN, e.feeTC].filter(Boolean).join(" · ") }; }
    const notes = [];
    if ((e.hoursEN || e.hoursTC) && !m.openingHours.length) notes.push(lt(e.hoursEN ? `Hours: ${e.hoursEN}` : null, e.hoursTC ? `開放時間：${e.hoursTC}` : null));
    if (e.notesEN || e.notesTC) notes.push(lt(e.notesEN, e.notesTC));
    for (const n of notes) m.infoNote = m.infoNote ? lt([m.infoNote.en, n.en].filter(Boolean).join(" · "), [m.infoNote.tc, n.tc].filter(Boolean).join(" · ")) : n;
    if (!m.contact && e.phone) m.contact = e.phone;
    if (!m.website && e.website) m.website = e.website;
    if (e.entranceLatitude != null && e.entranceLongitude != null) m.entrance = { lat: e.entranceLatitude, lng: e.entranceLongitude, note: lt(e.entranceNoteEN, e.entranceNoteTC), source: "curated" };
    m.factsProvenance = { publisher: (e.operatorEN || e.operatorTC) ? lt(e.operatorEN, e.operatorTC) : lt("Operator", "營運商"), sourceURL: e.sourceURL || null, checkedOn: e.checkedOn || null };
    if (!m.sources.includes("curated")) m.sources.push("curated");
    return m;
  });
}

export function attachEntrances(carparks, entrancesDoc, radius = 80) {
  const ents = (entrancesDoc?.entrances || []).filter(e => inHK(e)); if (!ents.length) return carparks;
  const grid = new Map(); const cell = (lat, lng) => `${Math.floor(lat / 0.001)}_${Math.floor(lng / 0.001)}`;
  for (const e of ents) { const k = cell(e.lat, e.lng); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(e); }
  return carparks.map(cp => {
    if (cp.entrance || cp.kind !== "offStreet") return cp;
    const [cx, cy] = cell(cp.lat, cp.lng).split("_").map(Number);
    let best = null, bestD = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
      for (const e of grid.get(`${cx + dx}_${cy + dy}`) || []) { const d = distM(cp, e); if (d <= radius && d < bestD) { best = e; bestD = d; } }
    if (!best) return cp;
    const note = [best.nameEN || best.nameTC, best.level ? `Level ${best.level}` : null].filter(Boolean).join(" · ");
    return { ...cp, entrance: { lat: best.lat, lng: best.lng, note: note ? lt(note, note) : null, source: "openStreetMap" }, sources: cp.sources.includes("openStreetMap") ? cp.sources : [...cp.sources, "openStreetMap"] };
  });
}

export const SOURCE_ATTRIBUTION = {
  transportDepartmentOneStop: lt("Transport Department · DATA.GOV.HK Parking Vacancy Data", "運輸署 · 資料一線通 停車場空置資料"),
  transportDepartmentMeters: lt("Transport Department · on-street parking meters (DATA.GOV.HK)", "運輸署 · 路邊咪錶泊車位（資料一線通）"),
  kowloonEast: lt("Energizing Kowloon East smart parking (via DATA.GOV.HK)", "起動九龍東智能泊車資料（經資料一線通）"),
  operatorFeed: lt("Car park operator feed", "停車場營運商資料"),
  openStreetMap: lt("© OpenStreetMap contributors (ODbL) · location and facts only, no live counts", "© OpenStreetMap 貢獻者（ODbL）· 只有位置及資料，冇即時空位"),
  curated: lt("Operator-published facts (not live)", "營運商公佈資料（非即時）"),
  user: lt("Entered on this device", "本機輸入"),
};

// --------------------------------------------------------------- vehicle ---

export const BAY = { length: 5.0, width: 2.5, tightWidth: 1.95 };
export function fit(vehicle, cp) {
  if (cp.kind === "onStreetMeter") return { kind: "noRestriction", margin: null };
  const h = vehicle?.heightMetres, limit = cp.height?.metres;
  if (!(h > 0) || !(limit > 0)) return { kind: "notConfirmed", margin: null };
  const margin = limit - h;
  if (margin < 0) return { kind: "doesNotFit", margin };
  if (margin < 0.10) return { kind: "tight", margin };
  return { kind: "fits", margin };
}
export function fitText(f, lang) {
  const en = lang === "en", cm = Math.round(Math.abs(f.margin ?? 0) * 100);
  switch (f.kind) {
    case "fits": return en ? `Fits · ${cm} cm to spare` : `入得 · 鬆 ${cm} 厘米`;
    case "tight": return en ? `Tight · only ${cm} cm to spare` : `好貼 · 只鬆 ${cm} 厘米`;
    case "doesNotFit": return en ? `Too tall by ${cm} cm` : `高咗 ${cm} 厘米，入唔到`;
    case "noRestriction": return en ? "On-street · no height limit" : "路邊 · 冇高度限制";
    default: return en ? "Height not confirmed" : "限高未確認";
  }
}
export function sizeAdvice(v, lang) {
  if (!v || (v.lengthMetres == null && v.widthMetres == null)) return null;
  const en = lang === "en"; const bits = []; let levelV = "none";
  const longer = (v.lengthMetres ?? 0) - BAY.length, width = v.widthMetres ?? 0;
  if (longer > 0.30 || width > BAY.width - 0.30) levelV = "warning"; else if (longer > 0 || width > BAY.tightWidth) levelV = "note";
  if (v.lengthMetres > BAY.length) bits.push(en ? `${Math.round(longer * 100)} cm longer than a standard 5.0 m bay` : `比標準 5.0 米車位長 ${Math.round(longer * 100)} 厘米`);
  if (width > BAY.tightWidth) bits.push(en ? `${width.toFixed(2)} m wide against a 2.5 m bay, doors will be tight` : `車闊 ${width.toFixed(2)} 米，對 2.5 米車位嚟講開門會好貼`);
  if (!bits.length) return { level: levelV, text: en ? "Fits a standard 5.0 × 2.5 m bay." : "標準 5.0 × 2.5 米車位入得。" };
  return { level: levelV, text: bits.join(en ? "; " : "；") + "." + (en ? " Car parks do not publish bay sizes; look for end bays or wider spaces." : " 停車場唔會公佈車位尺寸，可揀近牆邊或較闊嘅車位。") };
}
export function dimensionsText(v) {
  const p = [v.lengthMetres, v.widthMetres, v.heightMetres].filter(x => x != null).map(x => x.toFixed(2));
  return p.length ? p.join(" × ") + " m" : null;
}

// --------------------------------------------------------------- ranking ---

export const SORTS = ["bestMatch", "nearest", "mostSpaces", "lowestCost", "highestClearance", "recentlyUpdated"];
export const SORT_LABEL = { bestMatch: lt("Best match", "最合適"), nearest: lt("Nearest", "最近"), mostSpaces: lt("Most spaces", "最多車位"), lowestCost: lt("Lowest estimated cost", "最平"), highestClearance: lt("Highest clearance", "限高最寬鬆"), recentlyUpdated: lt("Recently updated", "最新更新") };

export function isOpenAt(cp, ms) {
  if (cp.openingStatus === "closed") return false;
  if (!cp.openingHours.length) return cp.openingStatus === "open" ? true : null;
  return cp.openingHours.some(w => windowContains(w, ms));
}
export function supportsClass(vehicle, rec) {
  if (rec.vac?.[vehicle.type]) return true;
  const cap = rec.cp.capacity?.[vehicle.type]; if ((cap?.total ?? 0) > 0) return true;
  if (rec.cp.fees?.[vehicle.type] && !feeIsEmpty(rec.cp.fees[vehicle.type])) return true;
  if (rec.cp.isEnriched) return false;
  return vehicle.type === "privateCar" ? true : null;
}

export function evaluate(rec, ctx) {
  const cp = rec.cp, type = ctx.vehicle?.type || "privateCar";
  const reading = rec.vac?.[type] || null;
  const fresh = reading ? freshness(reading.updatedAt, ctx.now) : "none";
  const lv = level(reading, ctx.now);
  const dist = ctx.origin ? distM(ctx.origin, navPoint(cp)) : null;
  const f = fit(ctx.vehicle, cp);
  const open = isOpenAt(cp, ctx.now);
  const fee = cp.fees?.[type] || (type !== "privateCar" ? cp.fees?.privateCar : null);
  const rate = hourlyRateAt(fee, ctx.now);
  const supports = ctx.vehicle ? supportsClass(ctx.vehicle, rec) : null;
  let score = 0, blocked = false; const reasons = [];
  if (lv === "available") { score += 40; reasons.push(["available", reading?.count]); }
  else if (lv === "limited") { score += 25; reasons.push(["limited", reading?.count]); }
  else if (lv === "full") reasons.push(["full"]);
  else { score += 8; reasons.push([fresh === "stale" ? "stale" : "noLiveData"]); }
  // Distance decays over ~800 m (not 2 km): a live meter a kilometre away must not
  // outrank the mall car park you are standing in. Within 300 m counts as "right here".
  if (dist != null) { score += 30 * Math.exp(-dist / 800); if (dist < 300 && lv !== "full") { score += 12; reasons.push(["atLocation"]); } else if (dist < 600) reasons.push(["nearby"]); }
  if (fresh === "live") { score += 10; reasons.push(["live"]); } else if (fresh === "recent") score += 7; else if (fresh === "delayed") { score += 3; reasons.push(["delayed"]); }
  if (f.kind === "fits" || f.kind === "noRestriction") { score += 10; reasons.push(["fits"]); }
  else if (f.kind === "tight") { score += 6; reasons.push(["tight"]); }
  else if (f.kind === "doesNotFit") { blocked = true; reasons.push(["tooTall"]); }
  else { score += 4; if (ctx.vehicle?.heightMetres) reasons.push(["heightUnknown"]); }
  if (open === true) { score += 5; reasons.push(["open"]); } else if (open === false) { blocked = true; reasons.push(["closed"]); } else score += 2;
  if (rate && ctx.vehicle?.maxHourlyRateHKD) { const hr = hourlyEquivalent(rate); if (hr <= ctx.vehicle.maxHourlyRateHKD) { score += 5; reasons.push(["withinBudget", hr]); } else { score -= 10; reasons.push(["overBudget", hr]); } }
  // Somewhere you have parked before is a known quantity: you know the ramp, the
  // bay sizes and the walk. Worth a nudge, never enough to outrank a full car park.
  const visits = ctx.visits?.[cp.id]?.n || 0;
  if (visits >= 3) { score += 8; reasons.push(["parkOften", visits]); }
  else if (visits >= 1) { score += 4; reasons.push(["parkedBefore", visits]); }
  if (ctx.vehicle) {
    if (ctx.vehicle.needsEVCharging) { if (cp.facilities.includes("evCharger") || (reading?.evCount ?? 0) > 0) { score += 4; reasons.push(["evCharging"]); } else score -= 6; }
    if (cp.district && (ctx.vehicle.preferredDistricts || []).includes(cp.district)) { score += 2; reasons.push(["preferredDistrict"]); }
    if (ctx.vehicle.avoidNoLiveData && lv === "unknown") score -= 8;
    if (supports === false) { blocked = true; reasons.push(["classNotSupported"]); }
  }
  return { rec, cp, id: cp.id, dist, reading, level: lv, fresh, fit: f, isOpen: open, estHourly: rate ? hourlyEquivalent(rate) : null, hourlyIsEstimate: !!rate?.isEstimate, supports, score: blocked ? 0 : Math.max(0, score), reasons };
}

export function reasonText(r, lang) {
  const en = lang === "en", [k, v] = r;
  switch (k) {
    case "available": return v != null ? (en ? `${v} spaces` : `${v} 個位`) : (en ? "Spaces available" : "有位");
    case "limited": return v != null ? (en ? `Only ${v} left` : `淨返 ${v} 個`) : (en ? "Limited" : "少量");
    case "full": return en ? "Full" : "爆滿"; case "noLiveData": return en ? "No live data" : "冇即時資料"; case "stale": return en ? "Data is old" : "資料太舊";
    case "nearby": return en ? "Close by" : "好近";
    case "parkOften": return en ? `You park here often (${v}×)` : `你成日泊呢度（${v} 次）`;
    case "parkedBefore": return en ? "You parked here before" : "你泊過呢度"; case "atLocation": return en ? "Right here" : "就喺呢度"; case "live": return en ? "Live" : "即時"; case "delayed": return en ? "May be delayed" : "或有延遲";
    case "fits": return en ? "Height OK" : "高度合適"; case "tight": return en ? "Tight clearance" : "限高好貼"; case "tooTall": return en ? "Too tall" : "入唔到";
    case "heightUnknown": return en ? "Height not confirmed" : "限高未確認"; case "closed": return en ? "Closed now" : "而家閂咗"; case "open": return en ? "Open now" : "開放中";
    case "withinBudget": return en ? `~$${Math.round(v)}/hr` : `約 $${Math.round(v)}/小時`; case "overBudget": return en ? `$${Math.round(v)}/hr, over budget` : `$${Math.round(v)}/小時，超預算`;
    case "evCharging": return en ? "EV charging" : "有充電"; case "preferredDistrict": return en ? "Preferred district" : "常去地區";
    case "classNotSupported": return en ? "No spaces for this vehicle type" : "冇呢類車位"; default: return "";
  }
}

const INF = Infinity;
export function comparator(sort) {
  const d = (x) => x.dist ?? INF;
  switch (sort) {
    case "nearest": return (a, b) => d(a) !== d(b) ? d(a) - d(b) : b.score - a.score;
    case "mostSpaces": { const c = (x) => x.level === "unknown" ? -1 : (x.reading?.count ?? (x.level === "full" ? 0 : 1)); return (a, b) => c(a) !== c(b) ? c(b) - c(a) : d(a) - d(b); }
    case "lowestCost": { const p = (x) => x.estHourly ?? INF; return (a, b) => p(a) !== p(b) ? p(a) - p(b) : d(a) - d(b); }
    case "highestClearance": { const h = (x) => x.cp.height.metres ?? -1; return (a, b) => h(a) !== h(b) ? h(b) - h(a) : d(a) - d(b); }
    case "recentlyUpdated": { const tt = (x) => x.reading?.updatedAt ?? -INF; return (a, b) => tt(a) !== tt(b) ? tt(b) - tt(a) : d(a) - d(b); }
    default: return (a, b) => a.score !== b.score ? b.score - a.score : d(a) - d(b);
  }
}
export function rank(records, ctx, sort = "bestMatch") { return records.map(r => evaluate(r, ctx)).sort(comparator(sort)); }

// --------------------------------------------------------------- filters ---

export const DEFAULT_FILTER = () => ({ vehicleType: "privateCar", availableNow: false, minimumSpaces: null, minimumClearanceMetres: null, onlyConfirmedHeight: false, evCharging: false, motorcycleSpaces: false, accessibleSpaces: false, openNow: false, maxHourlyRateHKD: null, mallOnly: false, districts: [], maxDistanceMetres: null, minDistanceMetres: null, maxFreshness: null, onlyCompatible: false, includeMeters: true });
export function filterActiveCount(f) {
  let n = 0; for (const k of ["availableNow", "onlyConfirmedHeight", "evCharging", "motorcycleSpaces", "accessibleSpaces", "openNow", "mallOnly", "onlyCompatible"]) if (f[k]) n++;
  for (const k of ["minimumSpaces", "minimumClearanceMetres", "maxHourlyRateHKD", "maxFreshness"]) if (f[k] != null) n++;
  if (f.maxDistanceMetres != null || f.minDistanceMetres != null) n++;   // a distance band counts once
  if (f.districts?.length) n++; if (!f.includeMeters) n++; return n;
}
const FRESH_ORDER = { live: 0, recent: 1, delayed: 2, stale: 3, none: 4 };
export function matchesFilter(f, r) {
  const cp = r.cp;
  if (!f.includeMeters && cp.kind === "onStreetMeter") return false;
  if (f.availableNow && !(r.level === "available" || r.level === "limited")) return false;
  if (f.minimumSpaces != null && !(r.reading?.count != null && freshUsable(r.fresh) && r.reading.count >= f.minimumSpaces)) return false;
  if (f.minimumClearanceMetres != null) { if (cp.height.metres != null) { if (cp.height.metres < f.minimumClearanceMetres) return false; } else if (f.onlyConfirmedHeight) return false; }
  else if (f.onlyConfirmedHeight && cp.height.metres == null) return false;
  if (f.evCharging && !(cp.facilities.includes("evCharger") || (r.reading?.evCount ?? 0) > 0 || (cp.capacity?.[f.vehicleType]?.ev ?? 0) > 0)) return false;
  if (f.motorcycleSpaces && !((cp.capacity?.motorCycle?.total ?? 0) > 0 || r.rec.vac?.motorCycle)) return false;
  if (f.accessibleSpaces && !(cp.facilities.includes("disabilities") || (r.reading?.disabledCount ?? 0) > 0 || (cp.capacity?.[f.vehicleType]?.disabled ?? 0) > 0)) return false;
  if (f.openNow && r.isOpen === false) return false;
  if (f.maxHourlyRateHKD != null && r.estHourly != null && r.estHourly > f.maxHourlyRateHKD) return false;
  if (f.mallOnly && !cp.isMall) return false;
  if (f.districts?.length && !(cp.district && f.districts.includes(cp.district))) return false;
  if (f.maxDistanceMetres != null && r.dist != null && r.dist > f.maxDistanceMetres) return false;
  if (f.minDistanceMetres != null && r.dist != null && r.dist < f.minDistanceMetres) return false;
  if (f.maxFreshness != null && FRESH_ORDER[r.fresh] > FRESH_ORDER[f.maxFreshness]) return false;
  if (f.onlyCompatible && (r.fit.kind === "doesNotFit" || r.supports === false)) return false;
  return true;
}
export const applyFilter = (f, ranked) => ranked.filter(r => matchesFilter(f, r));

// Distance bands the user can pick on the Find and Map screens. "all" clears both
// bounds; the others are rings measured straight-line from the origin.
export const DISTANCE_BANDS = [
  { id: "all", min: null, max: null, label: lt("Any distance", "不限距離") },
  { id: "b250", min: null, max: 250, label: lt("≤ 250 m", "≤ 250 米") },
  { id: "b500", min: 250, max: 500, label: lt("250–500 m", "250–500 米") },
  { id: "b1k", min: 500, max: 1000, label: lt("500 m – 1 km", "500 米 – 1 公里") },
  { id: "b2k", min: 1000, max: 2000, label: lt("1 – 2 km", "1 – 2 公里") },
];
export function bandOf(f) { return DISTANCE_BANDS.find(b => (b.min ?? null) === (f.minDistanceMetres ?? null) && (b.max ?? null) === (f.maxDistanceMetres ?? null))?.id || "custom"; }
export function applyBand(f, id) { const b = DISTANCE_BANDS.find(x => x.id === id) || DISTANCE_BANDS[0]; return { ...f, minDistanceMetres: b.min, maxDistanceMetres: b.max }; }

export const CHIPS = [
  { id: "nearMe", label: lt("Near me", "附近"), icon: "◎" }, { id: "cheapest", label: lt("Cheapest", "最平"), icon: "$" },
  { id: "mostSpaces", label: lt("Most spaces", "最多位"), icon: "▦" }, { id: "streetMeters", label: lt("Meters", "咪錶"), icon: "P" },
  { id: "evCharging", label: lt("EV charging", "充電"), icon: "⚡" }, { id: "heightFits", label: lt("Height fits", "啱車高"), icon: "↕" },
  { id: "openNow", label: lt("Open now", "開放中"), icon: "◔" }, { id: "mallParking", label: lt("Mall parking", "商場"), icon: "🛍" },
];
export function chipIsOn(id, f, sort) {
  return ({ nearMe: sort === "nearest", cheapest: sort === "lowestCost", mostSpaces: sort === "mostSpaces", streetMeters: !!f.includeMeters, evCharging: !!f.evCharging, heightFits: !!f.onlyCompatible, openNow: !!f.openNow, mallParking: !!f.mallOnly })[id];
}
export function applyChip(id, f, sort, on) {
  switch (id) {
    case "nearMe": return { f, sort: on ? "nearest" : "bestMatch" };
    case "cheapest": return { f, sort: on ? "lowestCost" : "bestMatch" };
    case "mostSpaces": return { f, sort: on ? "mostSpaces" : "bestMatch" };
    case "streetMeters": return { f: { ...f, includeMeters: on }, sort };
    case "evCharging": return { f: { ...f, evCharging: on }, sort };
    case "heightFits": return { f: { ...f, onlyCompatible: on }, sort };
    case "openNow": return { f: { ...f, openNow: on }, sort };
    case "mallParking": return { f: { ...f, mallOnly: on }, sort };
    default: return { f, sort };
  }
}

// ---------------------------------------------------------------- search ---

export function searchScore(cp, key, qwords) {
  if (!key) return 0;
  let best = 0;
  for (const n of Object.values(cp.name).map(normText)) { if (n === key) best = Math.max(best, 100); else if (n.startsWith(key)) best = Math.max(best, 80); else if (n.includes(key)) best = Math.max(best, 60); }
  if (best < 70) for (const a of (cp.searchAliases || []).map(normText)) { if (!a) continue; if (a === key || a.startsWith(key)) best = Math.max(best, 70); else if (a.includes(key)) best = Math.max(best, 55); }
  if (best < 60 && qwords.length) for (const n of Object.values(cp.name)) { const nw = words(n); if (qwords.every(q => nw.some(w => w.startsWith(q)))) best = Math.max(best, 55); }
  if (best < 40 && Object.values(cp.address || {}).map(normText).some(a => a.includes(key))) best = Math.max(best, 40);
  if (best < 20) { const d = districtById(cp.district); const forms = [...Object.values(cp.districtText || {}), ...(d ? [...Object.values(d.name), ...d.aliases] : [])].map(normText);
    if (forms.some(x => x && (x.includes(key) || key.includes(x)))) best = Math.max(best, 20); }
  return best;
}
export function searchCarParks(query, carparks, limit = 8) {
  const key = normText(query), qw = words(query); if (!key) return [];
  const hits = [];
  for (const cp of carparks) { const s = searchScore(cp, key, qw); if (s > 0) hits.push({ cp, score: s }); }
  hits.sort((a, b) => b.score - a.score || (a.cp.isMall !== b.cp.isMall ? (a.cp.isMall ? -1 : 1) : t("en", a.cp.name).localeCompare(t("en", b.cp.name))));
  return hits.slice(0, limit);
}
export function districtsMatching(query) {
  const key = normText(query); if (!key) return [];
  return DISTRICTS.filter(d => [...Object.values(d.name), ...d.aliases].map(normText).some(x => x.startsWith(key) || (key.startsWith(x) && x.length >= 2)));
}

// ====================================================================
// Backup code, error log, staleness, Address Lookup Service parsing.
// ====================================================================

// Everything a user would be sad to lose, in one copyable code. Feed
// payloads are deliberately excluded: they are re-downloaded.
export const BACKUP_KEYS = ["favs", "vehicles", "activeVehicleId", "places", "searches", "recents", "visits", "filter", "sort", "lang", "navApp", "alerts"];
const BACKUP_PREFIX = "CPHK1.";
const utf8ToB64url = (s) => { const bytes = new TextEncoder().encode(s); let bin = ""; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const b64urlToUtf8 = (s) => { const b = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4); const bin = atob(b); const bytes = Uint8Array.from(bin, c => c.charCodeAt(0)); return new TextDecoder().decode(bytes); };
export function backupEncode(state, now = Date.now()) {
  const data = {}; for (const k of BACKUP_KEYS) if (state[k] !== undefined) data[k] = state[k];
  return BACKUP_PREFIX + utf8ToB64url(JSON.stringify({ app: "carparkhk", v: 1, at: now, data }));
}
export function backupDecode(code) {
  const s = String(code || "").trim().replace(/\s+/g, "");
  if (!s.startsWith(BACKUP_PREFIX)) return { ok: false, error: "notBackup" };
  try {
    const doc = JSON.parse(b64urlToUtf8(s.slice(BACKUP_PREFIX.length)));
    if (doc.app !== "carparkhk" || typeof doc.data !== "object" || !doc.data) return { ok: false, error: "notBackup" };
    const data = {}; for (const k of BACKUP_KEYS) if (doc.data[k] !== undefined) data[k] = doc.data[k];
    return { ok: true, at: doc.at || null, data };
  } catch { return { ok: false, error: "corrupt" }; }
}
export const backupSummary = (data) => ({ favs: (data.favs || []).length, vehicles: (data.vehicles || []).length, places: (data.places || []).length });

// Newest first, capped; kept on the device so a user can read what failed.
export function pushError(log, entry, cap = 10) { return [entry, ...(Array.isArray(log) ? log : [])].slice(0, cap); }

// Operator facts copied by hand go stale. Flag after `days`.
export function factsStale(checkedOn, now = Date.now(), days = 180) {
  const t = Date.parse(checkedOn); return Number.isFinite(t) && now - t > days * 86400e3;
}

// Address Lookup Service (www.als.gov.hk) → places for the search list.
// Returns { title, subtitle, coordinate, kind: "maps" } in the asked language,
// deduplicated by position, Hong Kong only. Never throws on odd shapes.
export function alsPlaces(json, lang = "en") {
  const out = [], seen = new Set();
  for (const s of json?.SuggestedAddress || []) {
    const p = s?.Address?.PremisesAddress; if (!p) continue;
    const g0 = p.GeospatialInformation, g = Array.isArray(g0) ? g0[0] : g0;
    const c = { lat: parseFloat(g?.Latitude), lng: parseFloat(g?.Longitude) };
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng) || !inHK(c)) continue;
    const key = c.lat.toFixed(4) + "," + c.lng.toFixed(4); if (seen.has(key)) continue; seen.add(key);
    const en = p.EngPremisesAddress || {}, tc = p.ChiPremisesAddress || {};
    const enStreet = [en.EngStreet?.BuildingNoFrom, titleCase(en.EngStreet?.StreetName)].filter(Boolean).join(" ");
    const tcStreet = [tc.ChiStreet?.StreetName, tc.ChiStreet?.BuildingNoFrom ? tc.ChiStreet.BuildingNoFrom + "號" : ""].filter(Boolean).join("");
    const enTitle = titleCase(en.BuildingName) || titleCase(en.EngEstate?.EstateName) || enStreet;
    const tcTitle = tc.BuildingName || tc.ChiEstate?.EstateName || tcStreet;
    const enSub = [enStreet && enStreet !== enTitle ? enStreet : null, titleCase(en.EngDistrict?.DcDistrict)].filter(Boolean).join(", ");
    const tcSub = [tcStreet && tcStreet !== tcTitle ? tcStreet : null, tc.ChiDistrict?.DcDistrict].filter(Boolean).join("，");
    const title = lang === "en" ? (enTitle || tcTitle) : (tcTitle || enTitle);
    if (!title) continue;
    out.push({ title, subtitle: lang === "en" ? enSub : tcSub, coordinate: c, kind: "maps", score: s?.ValidationInformation?.Score ?? 0 });
  }
  return out.sort((a, b) => b.score - a.score);   // best match first; ALS itself does not order by score
}
