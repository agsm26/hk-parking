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

const MALL_WORDS = ["商場", "廣場", "購物", "百貨", "名店", "mall", "plaza", "outlet", "shopping", "arcade", "square", "galleria", "walk"];
// Malls whose names carry none of the words above (the feed calls Maritime
// Square "港鐵青衣城停車場", D·PARK "愉景新城", and so on).
const MALL_NAMES = ["海港城", "又一城", "時代廣場", "朗豪坊", "圓方", "太古城", "希慎", "apm", "megabox", "d2 place", "v city", "yoho", "東薈城", "新城市", "置地", "ifc", "k11", "the one", "崇光", "sogo", "olympian", "moko", "poplaza", "t town", "airside", "telford", "德福", "amoy", "淘大", "domain", "大本型", "landmark", "harbour city", "times square", "langham place", "elements", "cityplaza", "pacific place", "太古廣場",
  "青衣城", "popcorn", "mikiki", "lohas", "康城", "北角匯", "harbour north", "愉景新城", "d.park", "南昌薈", "nam cheong place", "裕民坊", "翩滙坊", "海天晉滙", "利園", "lee garden", "lok fu place", "新都城", "metro city", "東港城", "east point city", "荃新天地", "奧海城", "grand century place"];
// A name with a space also matches written without it ("V City" = "Vcity"),
// but single words never match across a word gap.
const MALL_KEYS = [...MALL_WORDS, ...MALL_NAMES].map(w => ({ plain: w.toLowerCase(), packed: w.includes(" ") ? normText(w) : null }));
export function isMallName(name, address) {
  const s = ((name || "") + " " + (address || "")).toLowerCase(), packed = normText(s);
  return MALL_KEYS.some(k => s.includes(k.plain) || (k.packed && packed.includes(k.packed)));
}

/** Prefer a row marked for private cars, else the lowest positive height; 0/missing = not confirmed. */
// The feed's height remark is free text, and operators put whatever they like in
// it: the height ("Height limit:1.7(M)"), the tariff ("Private Car/Van<br>$21 per
// hour"), a bare vehicle label ("Private Car"), the days a price applies to ("Mon
// to Fri (Except Public Holidays):"), opening hours, or several at once. Split it:
// the height lines stay as the height note and give the number when the
// structured height is missing (0); the tariff lines, with the vehicle and day
// headings above them, become `tariff`, for the fees; anything else (opening
// hours, "booking only", chargers) is `other`, for the car park's notes.
const TARIFF_LINE = /\$|港幣|per hour|hourly|half[- ]hour|\/\s*hrs?\b|day park|night park|monthly|quarterly|first (?:two|\d+) hours?|thereafter|minutes?\s*:?\s*free|每小時|半小時|\/\s*小時|時租|日泊|夜泊|月租|季租|收費|首\s*[一二兩\d]+\s*個?小時|免費/i;
const HEIGHT_NUMBER = /(?:^|[^\d.])(\d(?:\.\d{1,2})?)\s*\(?\s*(?:m|metres?|meters?|米)(?![a-z])/gi;   // not "2.5" out of "12.5"
const HEIGHT_LINE = /(?:^|[^\d.])\d(?:\.\d{1,2})?\s*\(?\s*(?:m|metres?|meters?|米)(?![a-z])|height|clearance|headroom|限高|高度|淨高|^\(?\s*(?:applicable|適用)|^\(?\s*\d(?:\.\d{1,2})?\s*\)?\s*\(?\s*(?:m|米)?\s*\)?$/i;
const VEHICLE_WORDS = /private cars?|cars?|vans?|light goods? vehicles?|goods? vehicles?|vehicles?|lgv|hgv|lorr(?:y|ies)|coach(?:es)?|light bus(?:es)?|mini ?bus(?:es)?|bus(?:es)?|motor ?cycles?|taxis?|medium|heavy|light|container|私家車|客貨車|輕型貨車|重型貨車|中重型貨車|中型|貨櫃車|貨車|旅遊巴士?|小型巴士|小巴|巴士|電單車|的士|車輛/gi;
const isVehicleLabel = (s) => !s.replace(VEHICLE_WORDS, "").replace(/\b(?:and|or)\b|[\s\/&,、及和()（）*.:：-]/gi, "");
const DAY_WORDS = /mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|public holidays?|holidays?|\bph\b|weekdays?|weekends?|daily|every ?day|except|excluding|excl\.?|including|incl\.?|\band\b|\bto\b|from|星期[一二三四五六日]?|[一二三四五六日]|至|及|公眾假期|假期|假日|除外|不包括|包括|每日|平日|週末|由/gi;
const isDayLabel = (s) => !s.replace(/\d{1,2}:?\d{2}\s*:?|\d{1,2}\s*(?:am|pm)/gi, "").replace(DAY_WORDS, "").replace(/[\s\-–—~,，、\/&()（）:：;；.。]/g, "");
export function pickHeight(rows) {
  const list = arr(rows).map(r => ({ h: num(r?.height), remark: str(r?.remark) }));
  const heightLines = [], tariffLines = [], otherLines = [];
  for (const r of list) {
    if (!r.remark) continue;
    const lines = r.remark.replace(/<\/?br\s*\/?>/gi, "\n").replace(/<\/?[a-z][^>]*>/gi, "").split(/\n+/)
      .map(s => s.replace(/^\s*(?:(?:height\s*limits?|限高|高度限制)\s*[:：]?\s*)+/i, "").replace(/^[*•\s]+/, "").trim()).filter(Boolean);   // "Height Limit: Height limit:1.7(M)"
    const hasTariff = lines.some(s => TARIFF_LINE.test(s));
    for (const s of lines) {
      if (/^\(?\s*(?:m|米)\s*\)?$/i.test(s)) continue;     // a unit left on its own line
      if (TARIFF_LINE.test(s)) tariffLines.push(s);
      else if (isVehicleLabel(s) || (isDayLabel(s) && hasTariff)) { if (hasTariff) tariffLines.push(s); }   // headings belong to the tariff below them
      else if (HEIGHT_LINE.test(s)) { if (!heightLines.includes(s)) heightLines.push(s); }
      else if (!otherLines.includes(s)) otherLines.push(s);
    }
  }
  const note = heightLines.join("\n") || null, tariff = tariffLines.join("\n") || null, other = otherLines.join("\n") || null;
  const usable = list.filter(r => r.h != null && r.h > 0);
  if (usable.length) {
    const forCars = usable.filter(r => /私家車|private car/i.test(r.remark || ""));
    return { metres: Math.min(...(forCars.length ? forCars : usable).map(r => r.h)), note, tariff, other };
  }
  // No structured height: read the text. A line for the entrance decides (what gets
  // you in; the floors are in the note), then lines for private cars, else the
  // lowest stated, the safe side when it lists one per floor.
  const nums = (lines) => lines.flatMap(s => [...s.matchAll(HEIGHT_NUMBER)].map(m => +m[1])).filter(h => h >= 1 && h <= 6);
  const pickFrom = [heightLines.filter(s => /entrance|入口/i.test(s)), heightLines.filter(s => /private car|私家車/i.test(s)), heightLines]
    .map(nums).find(n => n.length) || [];
  return { metres: pickFrom.length ? Math.min(...pickFrom) : null, note, tariff, other };
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
function windowFrom(dto) { return makeWindow(strArr(dto?.weekdays), clockTime(dto?.periodStart), clockTime(dto?.periodEnd), !!dto?.excludePublicHoliday); }

export function feeSchedule(v, legacyNote) {
  const hourly = [], flat = [], privileges = [];
  if (v) {
    for (const r of arr(v.hourlyCharges)) { const price = num(r?.price); if (price == null) continue;
      const half = /half/i.test(r?.type || "");
      const tiers = arr(r?.usageThresholds).map(t => ({ hours: num(t?.hours), price: num(t?.price) })).filter(t => t.hours > 0 && t.price > 0);   // "first 2 hours $12"
      hourly.push({ window: windowFrom(r), price, unitMinutes: half ? 30 : 60, minimumUnits: int(r?.usageMinimum), minimumMinutes: (num(r?.usageMinimum) || 0) * 60, tiers, covered: str(r?.covered), remark: str(r?.remark), isEstimate: false }); }
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
export function hourlyRateAt(fee, ms, isPH = false) {
  if (!fee || !fee.hourly.length) return null;
  // On a public holiday a rate that names PH beats the weekday rate for the same day.
  const now = (isPH && fee.hourly.find(r => r.window.weekdays.includes("PH") && windowContains(r.window, ms, true)))
    || fee.hourly.find(r => windowContains(r.window, ms, isPH)); if (now) return now;
  const wd = WD[hkClock(ms).weekday];
  return fee.hourly.find(r => r.window.weekdays.includes(wd)) || fee.hourly[0];
}

// ------------------------------------------------------------ stay cost ---
// What a private car pays to stay N minutes from a given time: each started unit
// at the rate in force when it starts (time of day, weekday or holiday, and time
// already parked, for "first two hours $11 per half hour, then $16.5"), at least
// any minimum charge; or a day, night or 24-hour flat rate when the whole stay
// fits inside one, whichever is less. Mixtures (a day park, then hours after it)
// aren't tried, so a total can only err high. A rule is { window, unit, price,
// from, to } (minutes; from/to count time parked), a flat { window, price, kind }.

// Operators' price texts, in the house styles the feed carries: Transport
// Department ("Hourly / 07:00 - 23:00 $20 per hour (private car) / Day Park /
// 07:00 - 19:00 $135 (private car)"), LCSD venues ("Mon to Fri (Except Public
// Holidays): 07:00-23:00, First Two Hours: $12/half hour (Thereafter: $18/half
// hour); 23:00-07:00: $12/half hour"), estates ("$21 per hour"), the airport
// ("First hour: $35 / Each hour thereafter: $50"), in English or Chinese. The
// text is read as a stream of tokens; days, hours, vehicle and section carry
// forward from the headings that set them, and only private-car prices count. A
// private-car price the reader can't place makes it give up (null): no total
// beats a wrong one.
const DAYSETS = { "MON-FRI": ["MON", "TUE", "WED", "THU", "FRI"], "MON-SAT": ["MON", "TUE", "WED", "THU", "FRI", "SAT"], "MON-THU": ["MON", "TUE", "WED", "THU"], ALL: [...WD, "PH"], "SAT-SUN": ["SAT", "SUN"], "SAT-SUN+PH": ["SAT", "SUN", "PH"], "SUN+PH": ["SUN", "PH"], "FRI-SUN": ["FRI", "SAT", "SUN"], "FRI-SUN+PH": ["FRI", "SAT", "SUN", "PH"], ...Object.fromEntries(WD.map(d => [d, [d]])) };
const DAY_CODES = Object.keys(DAYSETS);
const XPH = "\\s*,?\\s*[(]?\\s*(?:except|excluding|excl\\.?|exclusive of|not including)\\s*(?:public holidays?|ph)\\s*[)]?";
const WITHPH = "\\s*(?:[(]?\\s*(?:including|incl\\.?)\\s*(?:(?:public )?holidays?|ph)\\s*[)]?|(?:,|&|and)\\s*(?:(?:public )?holidays?|ph))";
const DAY_PHRASES = [
  [new RegExp("mon(?:day)?\\s*(?:to|-)\\s*fri(?:day)?" + XPH, "gi"), "MON-FRI!"], [/mon(?:day)?\s*(?:to|-)\s*fri(?:day)?/gi, "MON-FRI"],
  [new RegExp("mon(?:day)?\\s*(?:to|-)\\s*sat(?:urday)?" + XPH, "gi"), "MON-SAT!"], [/mon(?:day)?\s*(?:to|-)\s*sat(?:urday)?/gi, "MON-SAT"],
  [new RegExp("mon(?:day)?\\s*(?:to|-)\\s*thu(?:r(?:s(?:day)?)?)?" + XPH, "gi"), "MON-THU!"], [/mon(?:day)?\s*(?:to|-)\s*thu(?:r(?:s(?:day)?)?)?/gi, "MON-THU"],
  [new RegExp("mon(?:day)?\\s*(?:to|-)\\s*sun(?:day)?(?:" + WITHPH + ")?|\\bdaily\\b|every ?day", "gi"), "ALL"],
  [new RegExp("fri(?:day)?\\s*(?:to|-)\\s*sun(?:day)?" + WITHPH, "gi"), "FRI-SUN+PH"], [/fri(?:day)?\s*(?:to|-)\s*sun(?:day)?/gi, "FRI-SUN"],
  [new RegExp("sat(?:urday)?\\s*(?:,|&|and|to|-|/)?\\s*sun(?:day)?" + WITHPH, "gi"), "SAT-SUN+PH"], [/sat(?:urday)?\s*(?:,|&|and|to|-|\/)?\s*sun(?:day)?/gi, "SAT-SUN"],
  [/sun(?:day)?\s*(?:&|and|,|to)\s*(?:public holidays?|ph)/gi, "SUN+PH"],
  [/\bmo\s*-\s*fr\b/gi, "MON-FRI"], [/\bmo\s*-\s*sa\b/gi, "MON-SAT"], [/\bmo\s*-\s*su\b/gi, "ALL"], [/\bsa\s*-\s*su(?:\s*,\s*ph)?\b/gi, "SAT-SUN+PH"],
  [/星期一\s*至\s*(?:星期)?五\s*[(]?\s*(?:公眾假期除外|不包括公眾假期)\s*[)]?/g, "MON-FRI!"], [/星期一\s*至\s*(?:星期)?五/g, "MON-FRI"],
  [/星期一\s*至\s*(?:星期)?六\s*[(]?\s*(?:公眾假期除外|不包括公眾假期)\s*[)]?/g, "MON-SAT!"], [/星期一\s*至\s*(?:星期)?六/g, "MON-SAT"],
  [/星期一\s*至\s*(?:星期)?日(?:\s*[(]?\s*(?:及|包括)?\s*公眾假期\s*[)]?)?|每日/g, "ALL"],
  [/(?:星期六\s*(?:及|、|\/|至)?\s*(?:星期)?日|星期六日|六日)\s*[(]?\s*(?:及|包括|、|\/)?\s*公眾假期\s*[)]?|假日及公眾假期(?:\s*[(][^)]*[)])?/g, "SAT-SUN+PH"],
  [/星期六\s*(?:及|、|\/|至)?\s*(?:星期)?日|星期六日/g, "SAT-SUN"], [/星期日及公眾假期/g, "SUN+PH"],
  [/星期一\s*至\s*(?:星期)?四\s*[(]?\s*(?:公眾假期除外|不包括公眾假期)\s*[)]?/g, "MON-THU!"], [/星期一\s*至\s*(?:星期)?四/g, "MON-THU"],
  [/星期五\s*至\s*(?:星期)?日\s*(?:及|、)?\s*公眾假期/g, "FRI-SUN+PH"], [/星期五\s*至\s*(?:星期)?日/g, "FRI-SUN"],
  ...[["MON", "mon(?:day)?"], ["TUE", "tue(?:s(?:day)?)?"], ["WED", "wed(?:nesday)?"], ["THU", "thu(?:r(?:s(?:day)?)?)?"], ["FRI", "fri(?:day)?"], ["SAT", "sat(?:urday)?"], ["SUN", "sun(?:day)?"]]
    .flatMap(([d, w]) => [[new RegExp("\\b" + w + "\\b" + XPH, "gi"), d + "!"], [new RegExp("\\b" + w + "\\b", "gi"), d]]),
];
const CAR_WORDS = /private\s*cars?|私家車|\bcars?\b|客貨車|\bvans?\b|\bpc\b|\bp(?=\s*:)/i;
const OTHER_VEHICLE = /motor\s*cycles?|\bmc\b|\b[ml](?=\s*:)|電單車|coach(?:es)?|旅遊巴|goods? vehicles?|貨車|lorr(?:y|ies)|trucks?|\bbus(?:es)?\b|巴士|小巴|taxis?|的士|\blgv\b|\bhgv\b|container/i;
function tidyTariff(text) {
  let s = String(text).replace(/<\/?br\s*\/?>/gi, "\n").replace(/(\d)\s*HKD\b/gi, "$1").replace(/[(]?\s*from (?:the time of )?(?:entry|admission) (?:to|until) (?:24:00|23:59|midnight)(?: that night)?\s*[)]?/gi, " day max ").replace(/：/g, ":").replace(/，/g, ",").replace(/；/g, ";").replace(/（/g, "(").replace(/）/g, ")").replace(/[–—~～]/g, "-").replace(/　/g, " ")
    .replace(/HKD?\s*\$?(?=\s*\d)/gi, "$").replace(/\$\s*\$/g, "$")
    .replace(/(\d+(?:\.\d+)?)\s*港幣/g, "$$$1")                                  // "21 港幣/小時"
    .replace(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/gi, (m, a, am, p, b, bm, q) => `${(+a % 12) + (/pm/i.test(p) ? 12 : 0)}:${am || "00"}-${(+b % 12) + (/pm/i.test(q) ? 12 : 0)}:${bm || "00"}`)
    .replace(/(\d{1,2}):?(\d{2})\s*:?\s*(?:-|to|至)\s*(\d{1,2}):?(\d{2})/gi, (m, a, b, c, d) => `${a.padStart(2, "0")}:${b}-${c.padStart(2, "0")}:${d}`)
    .replace(/首\s*[一1]\s*個?小時/g, "首1小時").replace(/首\s*[兩二2]\s*個?小時/g, "首2小時")
    .replace(/(^|[^\d$.])(\d+(?:\.\d+)?)(\s*\/\s*每?(?:半小時|小時))/g, "$1$$$2$3");     // "2/半小時" lacks its "$"
  for (const [re, set] of DAY_PHRASES) s = s.replace(re, ` «D${DAY_CODES.indexOf(set.replace("!", ""))}${set.endsWith("!") ? "!" : ""}» `);   // numbered, so no later phrase matches inside a marker
  return s;
}
const TARIFF_TOKENS = [
  ["days", /«D(\d+)(!?)»/g],
  ["range", /(\d{2}):(\d{2})-(\d{2}):(\d{2})/g],
  ["stop", /[.](?=\s|$)|。/g],
  ["first", /first\s+(two|one|\d+)?\s*(?:hours?|hrs?)\b|1st\s*-\s*2nd hours?|1st and 2nd 30 minutes|首半及第二個半小時|首(\d+)小時|[(]\s*1st\s+(\d+)\s+hours?\s*[)]/gi],
  ["after", /thereafter|after (?:the )?(?:first|1st)\s+(?:two|\d+)\s+hours?|第\s*\d+\s*小時後|其後|第三個半小時及以後/gi],
  ["hourly", /\bhourly\b|時租/gi],
  ["flat", /\d+\s*hours?\s*parking(?:\s*[(][^)]*[)])?|all day park(?:\s*[(]\s*any 24 hours\s*[)])?|(?:every|any|each)\s*24\s*hours?[^$]*?up to|24[- ]hours?\s*pass|day pass|night pass|day\s*park|night\s*park(?:ing)?|overnight|24\s*hours?\s*park|24小時(?:全日)?泊|日泊|夜泊|全日泊|通宵|day max|per session/gi],
  ["ignore", /quarterly|monthly|long[- ]term|concession(?:ary)?|valet|季租|月租|每季|每月|代客泊車|優惠/gi],
  ["minimum", /mini(?:mu|u)?m\s*charge\s*:?\s*(\d+)\s*hours?|最少\s*(?:收費)?\s*(\d+)\s*小時/gi],
  ["vehicle", new RegExp(CAR_WORDS.source + "|" + OTHER_VEHICLE.source, "gi")],
  ["price", /(?:(每半小時|每小時|per half[- ]?hour|per hour|each hour)\s*:?\s*)?\$\s*(\d+(?:\.\d+)?)(?:\s*(?:\/\s*(?:per\s+|每)?|per\s+|每)\s*(half\s*(?:an\s*)?(?:hours?)?|30\s*min(?:ute)?s?|15\s*min(?:ute)?s?|\d+\s*hours?|hours?|hrs?|小時|半小時|day|日|session|month|月|kwh|quarter))?/gi],
];
function tariffTokens(s) {
  const out = []; let i = 0;
  for (;;) {
    let best = null;
    for (const [kind, re] of TARIFF_TOKENS) { re.lastIndex = i; const m = re.exec(s); if (m && (!best || m.index < best.m.index)) best = { kind, m }; }
    if (!best) return out;
    out.push(best); i = best.m.index + Math.max(1, best.m[0].length);
  }
}
// "07:01-22:59" means 07:00-23:00: no minute-long gaps between one rate and the next.
const rangeOf = (m) => [clockTime(`${m[1]}:${m[2]}`), clockTime(`${m[3]}:${m[4]}`)].map(x => x % 60 === 1 ? x - 1 : x % 60 === 59 ? x + 1 : x);
export function readTariff(text) {
  if (!text) return null;
  const rules = [], flats = [];
  let days = DAYSETS.ALL, exPH = false, win = null, sectionWin = null, car = true, flatKw = null, sectionFlat = null, hourly = false, section = false, skipNext = false, tier = null, lastFirst = null, minimum = 0;
  for (const line of tidyTariff(text).split(/\n+/)) {
    const toks = tariffTokens(line), priced = toks.some(t => t.kind === "price"); flatKw = null;
    // A heading line ("Quarterly", "Day Park", "Hourly") sets the section for the lines below it.
    if (toks.length && !priced) {
      const f = toks.find(t => t.kind === "flat" || t.kind === "hourly"), r = toks.find(t => t.kind === "range");
      if (toks.some(t => t.kind === "ignore")) { section = true; sectionFlat = null; hourly = false; }
      else if (f) { section = false; sectionFlat = f.kind === "flat" ? flatKind(f.m[0]) : null; if (f.kind === "hourly") hourly = true; }
      if (r) sectionWin = rangeOf(r.m); else if (f) sectionWin = null;    // "Day Park (07:00-23:00)" heads the day lines below it
    }
    for (let k = 0; k < toks.length; k++) {
      const { kind, m } = toks[k]; if (toks[k].used) continue;
      const nextPrice = toks.slice(k + 1).find(t => t.kind === "price");
      if (kind === "days") {
        const set = DAYSETS[DAY_CODES[+m[1]]], joined = toks[k - 1]?.kind === "days" && /^[\s,&\/、及-]*$/.test(line.slice(toks[k - 1].m.index + toks[k - 1].m[0].length, m.index));
        days = joined ? [...new Set([...days, ...set])] : set; exPH = m[2] === "!"; win = sectionWin; tier = null;    // "Fri-Sat, Sun & PH": one set
      }
      else if (kind === "stop") { days = DAYSETS.ALL; exPH = false; win = null; }   // a sentence's days end with it: "Overnight $90 for 21:00-10:00."
      else if (kind === "range") win = rangeOf(m);
      else if (kind === "first") { const w = (m[1] || "").toLowerCase(); tier = { from: 0, to: /30 minutes|半小時/.test(m[0]) ? 60 : /2nd/.test(m[0]) ? 120 : 60 * (w === "two" ? 2 : w === "one" || !w && !m[2] && !m[3] ? 1 : +(w || m[2] || m[3])) }; lastFirst = tier.to; }
      else if (kind === "after") tier = { from: lastFirst ?? 60, to: null };
      else if (kind === "hourly") { hourly = true; flatKw = null; if (priced) sectionFlat = null; }
      else if (kind === "flat") flatKw = flatKind(m[0]);
      else if (kind === "ignore") skipNext = true;
      else if (kind === "minimum") minimum = +(m[1] || m[2]) * 60;
      else if (kind === "vehicle") {
        // "Private Car:", "Motorcycles & Private Car $8": the run of vehicle words up to the next price decides; a tag after a price is that price's own.
        if (toks[k - 1]?.kind === "vehicle" || (toks[k - 1]?.kind === "price" && /^\s*[(]\s*$/.test(line.slice(toks[k - 1].m.index + toks[k - 1].m[0].length, m.index)))) continue;
        car = CAR_WORDS.test(line.slice(m.index, nextPrice ? nextPrice.m.index : line.length));
      }
      else if (kind === "price") {
        const price = +m[2], unitTxt = (m[3] || "").toLowerCase(), before = (m[1] || "").toLowerCase();
        const rest = line.slice(m.index + m[0].length, nextPrice ? nextPrice.m.index : line.length);
        const tag = /^\s*[(]([^)]*)[)]/.exec(rest), tagged = tag && (CAR_WORDS.test(tag[1]) || OTHER_VEHICLE.test(tag[1]));
        const forCar = tagged ? CAR_WORDS.test(tag[1]) : car;
        const next = toks[k + 1];     // "(1st 2 hours)" or "(after the 1st 2 hours)" after the price is its tier
        if (next?.kind === "first" && /1st/.test(next.m[0])) { tier = { from: 0, to: +next.m[3] * 60 }; lastFirst = tier.to; next.used = true; }
        else if (next?.kind === "after" && /1st/.test(next.m[0])) { tier = { from: lastFirst ?? 60, to: null }; next.used = true; }
        const t = tier; tier = null;
        // Days written after the price and closing the sentence qualify that price.
        const j = toks.findIndex((x, i) => i > k && (x.kind === "days" || x.kind === "price"));
        const trailing = j > 0 && toks[j].kind === "days" && /^\s*[)]?\s*(?:[.;]|$|·)/.test(line.slice(toks[j].m.index + toks[j].m[0].length)) ? toks[j] : null;
        if (trailing) trailing.used = true;
        const daysHere = trailing ? DAYSETS[DAY_CODES[+trailing.m[1]]] : days, exHere = trailing ? trailing.m[2] === "!" : exPH;
        const windowHere = (w) => makeWindow(daysHere, w ? w[0] : null, w ? w[1] : null, exHere);
        if (section || skipNext || !forCar || !(price > 0) || /month|月|kwh|quarter/.test(unitTxt)) { skipNext = false; continue; }
        const unit = /half|30|半小時/.test(unitTxt) || /half|半/.test(before) ? 30 : /15/.test(unitTxt) ? 15 : /hour|hr|小時/.test(unitTxt) || before ? 60 : null;
        const flatKw2 = flatKw || sectionFlat, perDay = /^(?:day|日)$/.test(unitTxt);
        // Hours written just after the price are its own: always for a flat ("Day Park $120(0800 to
        // 1800)"), for a rate only when they end the clause ("$32 per hour, 07:01-23:00;"). Hours
        // followed by ":" open the next item ("Day Park:$50, 2200-0800: $13/hour").
        const tail = next?.kind === "range" ? line.slice(next.m.index + next.m[0].length) : null, afterNext = toks[k + 2];
        const bracketed = tail != null && /^\s*[(]\s*$/.test(line.slice(m.index + m[0].length, next.m.index)) && /^\s*[)]/.test(tail);
        const opensNext = tail != null && (/^\s*:/.test(tail) || (/^\s*,/.test(tail) && afterNext?.kind === "price"));
        const ownHours = tail != null && (bracketed || !opensNext) ? rangeOf(next.m) : null, closing = bracketed || (tail != null && !opensNext && /^\s*[)]?\s*(?:[.;,]|$)/.test(tail));
        const block = /^(\d+)\s*hours?$/.exec(unitTxt) || (unit == null && /^hours:(\d+)$/.exec(flatKw2 || ""));
        if (block) flats.push({ window: windowHere(null), price, kind: "hours", room: +block[1] * 60 });
        else if (perDay && !bracketed && !/^(?:day|night|dayMax)$/.test(flatKw2 || "")) flats.push({ window: windowHere(null), price, kind: "daily" });
        else if (unitTxt === "session" || ((unit == null || perDay) && flatKw2) || (perDay && bracketed)) {
          const kindOf = unitTxt === "session" ? "session" : flatKw2 || "day";     // "$180/day (08:00-18:00)" is a day park
          const w = kindOf === "24h" ? null : flatKw2 === "dayMax" ? [0, 1440] : ownHours || win;
          if (ownHours && w === ownHours) next.used = true;
          if (w || kindOf === "24h") flats.push({ window: windowHere(w), price, kind: kindOf });     // a day or night rate with no hours can't be placed: left out
        }
        else if (unit != null || t || price <= 60) {
          const w = ownHours && closing ? ownHours : win; if (ownHours && w === ownHours) next.used = true;
          rules.push({ window: windowHere(w), unit: unit ?? (t && t.to ? t.to - t.from : 60), price, from: t ? t.from : 0, to: t ? t.to : null, guessed: unit == null && !hourly && !t });
        }
        else return null;    // a car price this reader can't place
      }
    }
  }
  if (minimum) for (const r of rules) r.minimum = minimum;
  // The same days, hours and tier priced more than once (one text for several car
  // parks: "OC1 $22, OC2 $20, OC3 $23 per hour") keep the dearest, so totals err high.
  const keep = new Map();
  for (const r of rules) { const k = [r.window.weekdays.join(), r.window.start, r.window.end, r.window.excludesPH, r.from, r.to].join("|"), o = keep.get(k); if (!o || r.price / r.unit > o.price / o.unit) keep.set(k, r); }
  const keepFlat = new Map();
  for (const f of flats) { const k = [f.kind, f.room, f.window.weekdays.join(), f.window.start, f.window.end, f.window.excludesPH].join("|"), o = keepFlat.get(k); if (!o || f.price > o.price) keepFlat.set(k, f); }
  return keep.size || keepFlat.size ? { rules: [...keep.values()], flats: [...keepFlat.values()] } : null;
}
const flatKind = (s) => /night|overnight|夜泊|通宵/i.test(s) ? "night" : /^\s*(?!24\b)\d+\s*hours?\s*parking/i.test(s) ? "hours:" + parseInt(s, 10) : /24|all day/i.test(s) ? "24h" : /session/i.test(s) ? "session" : /max/i.test(s) ? "dayMax" : "day";

const TARIFFS = new WeakMap();
// The rules for a car park's private cars, worked out once per record.
export function tariffOf(cp) {
  if (!cp || typeof cp !== "object") return null;
  if (!TARIFFS.has(cp)) TARIFFS.set(cp, buildTariff(cp));
  return TARIFFS.get(cp);
}
function buildTariff(cp) {
  const fee = cp.fees?.privateCar; if (!fee) return null;
  if (cp.sources?.includes("transportDepartmentMeters") && fee.hourly.length) {   // meters: 15-minute units, free outside their hours, with a longest stay
    const m = /max stay (\d+(?:\.\d+)?)\s*(h|min)/i.exec(fee.hourly[0].remark || "");
    return { rules: fee.hourly.map(h => ({ window: h.window, unit: 15, price: h.price / 4, from: 0, to: null })), flats: [], freeOutside: true, maxStay: m ? +m[1] * (m[2].toLowerCase() === "h" ? 60 : 1) : null, estimate: false };
  }
  const exact = fee.hourly.filter(h => !h.isEstimate);
  if (exact.length || fee.flat.some(f => f.kind !== "monthly")) {
    const rules = exact.flatMap(h => {
      const t = h.tiers?.[0], base = { window: h.window, unit: h.unitMinutes || 60, minimum: h.minimumMinutes || 0 };
      return t && t.price !== h.price ? [{ ...base, price: t.price, from: 0, to: t.hours * 60 }, { ...base, price: h.price, from: t.hours * 60, to: null }] : [{ ...base, price: h.price, from: 0, to: null }];
    });
    const flats = fee.flat.filter(f => f.kind !== "monthly" && f.price > 0).map(f => ({ window: f.window, price: f.price, kind: f.kind === "nightPark" ? "night" : f.kind === "twentyFourHours" ? "24h" : "day" }));
    return { rules, flats, freeOutside: false, maxStay: null, estimate: false };
  }
  const read = readTariff(fee.note);
  if (read) return { ...read, freeOutside: false, maxStay: null, estimate: true };
  if (fee.hourly.length) return { rules: fee.hourly.map(h => ({ window: h.window, unit: h.unitMinutes || 60, price: h.price, from: 0, to: null })), flats: [], freeOutside: false, maxStay: null, estimate: true };
  return null;
}
function ruleAt(rules, ms, isPH, parked) {
  const ok = rules.filter(r => parked >= r.from && (r.to == null || parked < r.to) && windowContains(r.window, ms, isPH));
  return (isPH && ok.find(r => r.window.weekdays.includes("PH"))) || ok[0] || null;
}
// The minutes left in a flat's window from `ms`, or null when it isn't on then.
function flatRoom(f, ms, isPH) {
  if (f.kind === "daily") return Infinity;
  if (!windowContains(f.window, ms, isPH)) return null;
  if (f.room) return f.room;                         // "$95 for 12 hours"
  const w = f.window; if (w.start == null || w.end == null || w.start === w.end) return 1440;   // no hours given: a day from entry
  const m0 = hkClock(ms).minutes, e = w.end === 0 ? 1440 : w.end;
  return w.start < e ? e - m0 : m0 >= w.start ? 1440 - m0 + e : e - m0;
}
export function stayCost(cp, startMs, minutes, holidays) {
  const t = tariffOf(cp); if (!t || !(minutes > 0)) return null;
  const ph = (ms) => isPublicHoliday(ms, holidays);
  let total = 0, parked = 0, charged = 0, estimate = t.estimate || t.rules.some(r => r.guessed), first = null;
  if (t.rules.length) {
    const perMin = (r) => r.price / r.unit;
    while (parked < minutes) {
      const ms = startMs + parked * 60e3, hol = ph(ms);
      let r = ruleAt(t.rules, ms, hol, parked);
      if (!r && t.freeOutside) { parked += 15; continue; }      // a meter outside its hours costs nothing
      if (!r) { r = t.rules.reduce((a, b) => perMin(b) > perMin(a) ? b : a); estimate = true; }   // a gap in the rates: assume the dearest
      first = first || r; total += r.price; parked += r.unit; charged += r.unit;
    }
    if (first?.minimum > charged) total += Math.ceil((first.minimum - charged) / first.unit) * first.price;
  } else total = Infinity;
  // A flat cheaper than the first hour at the hourly rate is a mislabelled rate ("day-park $2" for $2 per half hour at night), not a deal.
  const firstHour = t.rules.length ? stayCostRules(t, startMs, 60, ph) : 0;
  let best = total, flat = null;
  for (const f of t.flats) {
    const room = flatRoom(f, startMs, ph(startMs)); if (room == null || f.price < firstHour) continue;
    const cost = f.kind === "daily" ? Math.ceil(minutes / 1440) * f.price : f.kind === "dayMax" ? calendarDays(startMs, minutes) * f.price : minutes <= room ? f.price : null;
    if (cost != null && cost < best) { best = cost; flat = f.kind; }
  }
  if (!isFinite(best)) return null;
  return { total: Math.round(best * 10) / 10, estimate, flat, tooLong: t.maxStay != null && charged > t.maxStay, maxStay: t.maxStay };
}
// A "day max" lasts until midnight, then starts again: one charge per calendar day touched.
const calendarDays = (startMs, minutes) => Math.round((Date.parse(hkDate(startMs + minutes * 60e3 - 1)) - Date.parse(hkDate(startMs))) / 86400e3) + 1;
function stayCostRules(t, startMs, minutes, ph) {
  let total = 0, parked = 0;
  const dearest = t.rules.reduce((a, b) => b.price / b.unit > a.price / a.unit ? b : a);
  while (parked < minutes) {
    const ms = startMs + parked * 60e3; let r = ruleAt(t.rules, ms, ph(ms), parked);
    if (!r) { if (t.freeOutside) { parked += 15; continue; } r = dearest; }
    total += r.price; parked += r.unit;
  }
  return total;
}
export const FLAT_NAME = { day: lt("day park", "日泊"), night: lt("night park", "夜泊"), "24h": lt("24-hour", "24 小時泊"), session: lt("session", "時段收費"), daily: lt("daily rate", "日租"), hours: lt("flat rate", "套票"), dayMax: lt("day max", "全日上限") };
export function stayText(c, minutes, lang) {
  const h = minutes / 60, d = pick(lang, `${h} h`, `${h} 小時`);
  if (!c) return null;
  if (c.tooLong) return pick(lang, `${d}: max ${c.maxStay >= 60 ? c.maxStay / 60 + " h" : c.maxStay + " min"} here`, `${d}：最多泊 ${c.maxStay >= 60 ? c.maxStay / 60 + " 小時" : c.maxStay + " 分鐘"}`);
  const v = Number.isInteger(c.total) ? `$${c.total}` : `$${c.total.toFixed(1)}`;
  const kind = c.flat && FLAT_NAME[c.flat] ? " " + t(lang, FLAT_NAME[c.flat]) : "";
  return pick(lang, `${d} ${c.estimate ? "about " : ""}${v}${kind}`, `${d} ${c.estimate ? "約 " : ""}${v}${kind}`);
}

// Links come from third parties: the government feed, OpenStreetMap (anyone can
// edit it) and hand-copied operator pages. esc() keeps a value inside its
// attribute but does nothing about the scheme, so "javascript:…" would run on
// tap. A bare host is treated as a missing https://; anything carrying its own
// scheme that is not http(s) is refused outright.
export function safeURL(s) {
  s = String(s ?? "").trim();
  if (!s) return null;
  if (/^https:\/\//i.test(s)) return s;
  if (/^http:\/\//i.test(s)) return "https://" + s.slice(7);
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null;
  return "https://" + s;
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
  const { tariff, other, ...height } = pickHeight(r?.heightLimits);
  const vehicles = {}; for (const k of VEHICLE_TYPES) if (r?.[k] && typeof r[k] === "object" && !Array.isArray(r[k])) vehicles[k] = r[k];
  const fees = {}; for (const [k, v] of Object.entries(vehicles)) { const f = feeSchedule(v, null); if (!feeIsEmpty(f)) fees[k] = f; }
  if (!fees.privateCar && tariff) fees.privateCar = feeSchedule(null, tariff);   // the tariff typed into the height remark
  const capacity = {}; for (const [k, v] of Object.entries(vehicles)) { const c = { total: int(v.space), ev: int(v.spaceEV), disabled: int(v.spaceDIS), unloading: int(v.spaceUNL) }; if (Object.values(c).some(x => x != null)) capacity[k] = c; }
  const enriched = Object.keys(vehicles).length > 0 || !!str(r?.nature) || strArr(r?.facilities).length > 0;
  const sources = ["transportDepartmentOneStop"]; if (enriched) sources.push("kowloonEast");
  const url = safeURL;
  const facilities = strArr(r?.facilities).map(f => f.toLowerCase()).filter(f => ["evcharger", "disabilities", "unloading", "washing"].includes(f)).map(f => f === "evcharger" ? "evCharger" : f);
  return {
    id, kind: "offStreet", name: T(name), address: T(address), district: matchDistrict(districtRaw) || matchDistrict(a.dcDistrict),
    districtText: T(districtRaw || ""), lat, lng, entrance: null, height,
    // opening_status is a fixed flag, not "open right now": on 3 Oct 2026 it said
    // CLOSED for 212 of 581 car parks all afternoon and evening (Airport Car Park 1,
    // apm, MOKO, D·PARK among them) while 131 of those filled and emptied live.
    // So CLOSED means "not known", never shut; OPEN and opening hours still count.
    openingStatus: (r?.opening_status || "").toUpperCase() === "OPEN" ? "open" : "unknown",
    openingHours: arr(r?.openingHours).map(windowFrom), fees, facilities, paymentMethods: strArr(r?.paymentMethods).map(p => p.toLowerCase()),
    capacity, nature: str(r?.nature)?.toLowerCase() || null, carParkType: str(r?.carpark_Type)?.toLowerCase() || null,
    contact: str(r?.contactNo), website: url(r?.website), photoURL: url(r?.renditionUrls?.carpark_photo),
    isMall: isMallName(name, address), isEnriched: enriched, sources, modifiedAt: parseHKTime(r?.modifiedDate),
    bayCount: null, infoNote: other ? T(other) : null, operatorName: null, factsProvenance: null, searchAliases: [],
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
  for (const k of ["nature", "carParkType", "contact", "website", "photoURL", "modifiedAt", "operatorName", "factsProvenance", "bayCount"]) m[k] = a[k] ?? b[k];
  m.infoNote = a.infoNote || b.infoNote ? { ...b.infoNote, ...a.infoNote } : null;
  m.isMall = a.isMall || b.isMall; m.isEnriched = a.isEnriched || b.isEnriched;
  m.sources = [...new Set([...a.sources, ...b.sources])];
  m.searchAliases = [...new Set([...(a.searchAliases || []), ...(b.searchAliases || [])])];
  return m;
}

// Phones keep the feed as read (IndexedDB "info"). Bump this whenever what
// normalizeInfo produces changes, so a copy read by an older version is shown
// at once but fetched again instead of being kept for its six hours.
export const FEED_FORMAT = 4;   // 2: heights read from remarks, tariffs moved to fees, twins merged; 3: CLOSED no longer means shut; 4: day headings stay with the tariff, other lines become notes, tiered rates kept

export function normalizeInfo(rowsEN, rowsTC) {
  const byId = new Map(), order = [];
  for (const r of rowsEN || []) { const cp = normalizeInfoRow(r, "en"); if (!cp) continue; if (!byId.has(cp.id)) order.push(cp.id); byId.set(cp.id, byId.has(cp.id) ? mergeCarPark(byId.get(cp.id), cp) : cp); }
  for (const r of rowsTC || []) { const cp = normalizeInfoRow(r, "tc"); if (!cp) continue; if (byId.has(cp.id)) byId.set(cp.id, mergeCarPark(byId.get(cp.id), cp)); else { order.push(cp.id); byId.set(cp.id, cp); } }
  return mergeSameCarPark(order.map(id => byId.get(id)));
}

// The feed lists a few car parks twice: once from the Kowloon East smart-parking
// data (numeric ids, spaces per vehicle type) and once from the Transport
// Department's own list ("tdc…" ids). Same name, same address, metres apart, and
// both live. Keep one, the richer record, and remember the other id in altIds so
// its live count is still read (vacancyFor). Running it twice changes nothing.
export function mergeSameCarPark(list) {
  const richness = (cp) => (cp.isEnriched ? 10 : 0) + Object.keys(cp.capacity || {}).length + Object.keys(cp.fees || {}).length;
  const out = [], byName = new Map();
  for (const cp of list) {
    const key = Object.values(cp.name).every(isGenericName) ? "" : normText(cp.name.en || cp.name.tc || "");
    const twin = key ? (byName.get(key) || []).find(o => distM(o, cp) <= 80) : null;
    if (!twin) { out.push(cp); if (key) byName.set(key, [...(byName.get(key) || []), cp]); continue; }
    const [keep, drop] = richness(cp) > richness(twin) ? [cp, twin] : [twin, cp];
    const merged = { ...mergeCarPark(keep, drop), altIds: [...new Set([...(keep.altIds || []), drop.id, ...(drop.altIds || [])])] };
    out[out.indexOf(twin)] = merged;
    byName.set(key, byName.get(key).map(o => o === twin ? merged : o));
  }
  return out;
}

// One car park's live readings, by vehicle type. A car park the feed lists twice
// has two: take the freshest usable reading, and when both were taken within five
// minutes and disagree, the lower count — two feeds that disagree should not
// promise spaces that may not be there.
export function vacancyFor(vac, cp) {
  const own = vac?.[cp.id] || {};
  if (!cp.altIds?.length) return own;
  const usable = (r) => !!r && r.kind !== "unknown" && r.updatedAt != null;
  const better = (a, b) => {
    if (!usable(a)) return usable(b) ? b : (a || b);
    if (!usable(b)) return a;
    if (Math.abs(a.updatedAt - b.updatedAt) <= 5 * 60e3) {
      if (a.kind === "count" && b.kind === "count") return a.count <= b.count ? a : b;
      if (a.kind === "count" || b.kind === "count") return a.kind === "count" ? a : b;
    }
    return a.updatedAt >= b.updatedAt ? a : b;
  };
  const out = { ...own };
  for (const alt of cp.altIds) for (const [type, r] of Object.entries(vac?.[alt] || {})) out[type] = better(out[type], r);
  return out;
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

// The common OpenStreetMap opening_hours forms: "24/7", and day ranges with one
// time span each ("Mo-Su 07:00-23:00", "Mo-Fr 08:00-20:00; Sa,Su,PH 09:00-18:00").
// Anything else returns null and stays as text.
export function osmHours(text) {
  const s = String(text || "").trim(); if (!s) return null;
  if (/^24\s*\/\s*7$/.test(s)) return [ALWAYS];
  const order = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"], code = { Mo: "MON", Tu: "TUE", We: "WED", Th: "THU", Fr: "FRI", Sa: "SAT", Su: "SUN", PH: "PH" };
  const out = [];
  for (const part of s.split(/\s*;\s*/).filter(Boolean)) {
    const m = part.match(/^([A-Za-z,\s-]+?)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/); if (!m) return null;
    const days = [];
    for (const piece of m[1].split(/\s*,\s*/)) {
      const [a, b] = piece.split(/\s*-\s*/);
      if (!code[a] || (b && (!order.includes(a) || !order.includes(b)))) return null;
      if (!b) { days.push(code[a]); continue; }
      for (let i = order.indexOf(a); ; i = (i + 1) % 7) { days.push(code[order[i]]); if (order[i] === b) break; }
    }
    const start = clockTime(m[2]), end = clockTime(m[3]); if (start == null || end == null) return null;
    out.push(makeWindow(days, start, end));
  }
  return out.length ? out : null;
}

export function osmCarParks(doc) {
  const out = [];
  for (const r of doc?.records || []) {
    if (!inHK({ lat: r.lat, lng: r.lng })) continue;
    // The box above reaches into Shenzhen. A snapshot that has been through the
    // district boundaries knows better: no Hong Kong district, not in Hong Kong.
    if (doc.districtsAt && !r.district) continue;
    const name = lt(r.nameEN, r.nameTC); if (isEmptyLT(name)) continue;
    const fees = {}; const bits = [];
    if (r.fee === "yes") bits.push("Paid parking · 收費停車場"); else if (r.fee === "no") bits.push("Free parking · 免費泊車");
    if (r.feeText) bits.push(r.feeText);
    if (bits.length) fees.privateCar = { hourly: [], flat: [], privileges: [], note: bits.join(" · ") };
    const capacity = {}; if (r.capacity != null || r.capacityDisabled != null) capacity.privateCar = { total: r.capacity ?? null, ev: null, disabled: r.capacityDisabled ?? null, unloading: null };
    const hours = osmHours(r.openingHours);
    const info = []; if (r.openingHours && !hours) info.push(`Hours: ${r.openingHours}`); if (r.fromMall) info.push("Location is the mall itself; entrance not mapped · 位置為商場本身，入口未有標示");
    const op = lt(r.operatorEN, r.operatorTC);
    // enrich_osm.py places each car park inside the official district boundaries;
    // without a district every one of these vanished under a district filter.
    const district = districtById(r.district) ? r.district : matchDistrict(r.district);
    out.push({
      id: r.id, kind: "offStreet", name, address: lt(r.street, r.streetTC), district, districtText: district ? districtById(district).name : {},
      lat: r.lat, lng: r.lng, entrance: null,
      height: { metres: r.maxHeightMetres ?? null, note: null }, openingStatus: "unknown", openingHours: hours || [], fees,
      facilities: (r.capacityDisabled ?? 0) > 0 ? ["disabilities"] : [], paymentMethods: [], capacity, nature: null,
      carParkType: r.parkingType ? r.parkingType.replace(/_/g, " ") : null, contact: r.phone ?? null, website: safeURL(r.website), photoURL: null,
      // The same name rule the feed's car parks get. Aliases count: the snapshot puts
      // the mall a car park serves there (Festival Walk's is 又一城, Elements' 圓方).
      isMall: !!r.isMall || isMallName([r.nameEN, r.nameTC, ...(r.aliases || [])].filter(Boolean).join(" "), ""),
      isEnriched: false, sources: ["openStreetMap"], modifiedAt: null, bayCount: null,
      infoNote: info.length ? lt(info.join(" · "), info.join(" · ")) : null, operatorName: isEmptyLT(op) ? null : op, factsProvenance: null,
      searchAliases: r.aliases || [],
    });
  }
  return out;
}

// The feed's district is typed in by operators, and a few are wrong (Choi Ying
// Estate filed under Sham Shui Po, the Science Park under Sha Tin). enrich_osm.py
// checks each one's position against the district boundaries and lists the ones
// that disagree in data/district_fixes.json: { fixes: { id: districtId } }.
export function applyDistrictFixes(list, doc) {
  const fixes = doc?.fixes || {};
  return list.map(cp => {
    const d = [cp.id, ...(cp.altIds || [])].map(id => fixes[id]).find(id => districtById(id));
    return d && d !== cp.district ? { ...cp, district: d, districtText: districtById(d).name } : cp;
  });
}

export const providesLive = (s) => ["transportDepartmentOneStop", "transportDepartmentMeters", "kowloonEast", "operatorFeed"].includes(s);
export const isInfoOnly = (cp) => !cp.sources.some(providesLive);
export const hasEntrance = (cp) => !!cp.entrance || cp.kind === "onStreetMeter";
export const navPoint = (cp) => cp.entrance ? { lat: cp.entrance.lat, lng: cp.entrance.lng } : { lat: cp.lat, lng: cp.lng };

/** Drop static records within 80 m of, or sharing a name with, a live-feed record. */
// "Car park", "停車場" and friends say nothing about which car park this is.
const GENERIC_NAME = /^(car ?parks?|parking|carpark ?\d*|停車場|停车場|停车场|地下停車場|多層停車場)$/i;
const isGenericName = (n) => !n || GENERIC_NAME.test(String(n).trim());
// Two records describe the same car park if a name matches outright, or if one
// name contains the other ("V City" inside "Vcity Commerical Carpark"). Short
// or generic names are excluded, or "Car park" would swallow everything.
export function namesOverlap(a, b) {
  const A = Object.values(a.name || {}).filter(n => !isGenericName(n)).map(normText).filter(n => n.length >= 4);
  const B = Object.values(b.name || {}).filter(n => !isGenericName(n)).map(normText).filter(n => n.length >= 4);
  for (const x of A) for (const y of B) {
    if (x === y) return true;
    const [short, long] = x.length <= y.length ? [x, y] : [y, x];
    if (short.length >= 6 && long.includes(short)) return true;
  }
  return false;
}

export function dedupe(primary, extras, radius = 80, tightRadius = 25) {
  // Only real car parks can stand in for one another. A metered street section
  // is a different thing entirely, and its centroid sits within 80 m of plenty
  // of off-street car parks — letting meters suppress them erased 119 car parks,
  // Three Pacific Place and KOLOUR Yuen Long among them.
  const rivals = primary.filter(cp => cp.kind !== "onStreetMeter");
  const byName = new Map();
  for (const cp of rivals) for (const n of Object.values(cp.name).map(normText)) if (n.length >= 4 && !byName.has(n)) byName.set(n, cp);
  const grid = new Map(); const cell = (p) => `${Math.floor(p.lat / 0.001)}_${Math.floor(p.lng / 0.001)}`;
  for (const p of rivals) { const k = cell(p); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p); }
  const out = [...primary], seen = new Set(primary.map(p => p.id));
  // When a record is dropped as a duplicate, the one that stands in for it keeps
  // its "mall" flag: the feed calls Hopewell Centre's car park "合和中心", which
  // no name rule recognises, but OpenStreetMap knows it serves the mall.
  const mallIds = new Set();
  const absorb = (keeper, e) => { if (e.isMall && !keeper.isMall) mallIds.add(keeper.id); };
  // OpenStreetMap sometimes holds the same car park twice (Cityplaza is a node
  // and a relation 6 m apart). Collapse those, but only when the name matches
  // too: in a dense city two different car parks can sit 80 m apart.
  const kept = new Map();
  outer: for (const e of extras) {
    if (seen.has(e.id)) continue;
    const namesake = Object.values(e.name).map(normText).map(n => byName.get(n)).find(Boolean);
    if (namesake) { absorb(namesake, e); continue; }
    const [cx, cy] = cell(e).split("_").map(Number);
    const eGeneric = Object.values(e.name).every(isGenericName);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      // A car park whose name matches, or which has no real name of its own, is
      // the same place. One with a different name is only the same if it is
      // practically on top of it — otherwise MegaBox disappears into Manhattan
      // Place next door, and Tuen Mun Town Plaza loses a whole phase.
      for (const p of grid.get(`${cx + dx}_${cy + dy}`) || []) {
        const d = distM(p, e); if (d > radius) continue;
        if (eGeneric || namesOverlap(p, e) || d <= tightRadius) { absorb(p, e); continue outer; }
      }
      for (const k of kept.get(`${cx + dx}_${cy + dy}`) || [])
        if (distM(k, e) <= radius && namesOverlap(k, e)) { absorb(k, e); continue outer; }
    }
    out.push(e); seen.add(e.id);
    const k = cell(e); if (!kept.has(k)) kept.set(k, []); kept.get(k).push(e);
  }
  return mallIds.size ? out.map(cp => mallIds.has(cp.id) ? { ...cp, isMall: true } : cp) : out;
}

export const curatedIds = (e) => [e?.carParkId, ...(e?.carParkIds || [])].filter(Boolean);
export function applyCurated(carparks, curatedDoc) {
  const entries = curatedDoc?.entries || []; if (!entries.length) return carparks;
  const byId = new Map(); for (const e of entries) for (const id of curatedIds(e)) byId.set(id, e);
  // Matching by name is ONLY a fallback for an entry that names no car park id.
  // An entry that does name one must never also attach by name: "時代廣場停車場"
  // also names a car park 30 km from Causeway Bay, which would have worn
  // Causeway Bay's tariff. An entry may add `near` to fence its name matching.
  const byName = new Map();
  for (const e of entries) if (!curatedIds(e).length) for (const n of e.matchNames || []) byName.set(normText(n), e);
  const nameMatch = (cp) => {
    for (const n of Object.values(cp.name).map(normText)) {
      const e = byName.get(n); if (!e) continue;
      if (e.near && distM(cp, e.near) > (e.near.radiusMetres ?? 1500)) continue;
      return e;
    }
    return null;
  };
  return carparks.map(cp => {
    const e = byId.get(cp.id) || nameMatch(cp);
    if (!e) return cp;
    const m = { ...cp, name: { ...cp.name }, fees: { ...cp.fees }, sources: [...cp.sources] };
    if (!m.name.tc && e.nameTC) m.name.tc = e.nameTC;
    if (!m.operatorName && (e.operatorEN || e.operatorTC)) m.operatorName = lt(e.operatorEN, e.operatorTC);
    let supplied = false;   // did this entry actually contribute a height, fee or hours?
    if (m.height.metres == null && e.heightMetres) { m.height = { metres: e.heightMetres, note: m.height.note }; supplied = true; }
    if (e.feeEN || e.feeTC) { const ex = m.fees.privateCar; if (!ex || (!ex.hourly.length && !ex.flat.length)) { supplied = true; m.fees.privateCar = { hourly: [], flat: [], privileges: ex?.privileges || [], note: [e.feeEN, e.feeTC].filter(Boolean).join(" · ") }; } }
    const notes = [];
    if ((e.hoursEN || e.hoursTC) && !m.openingHours.length) { supplied = true; notes.push(lt(e.hoursEN ? `Hours: ${e.hoursEN}` : null, e.hoursTC ? `開放時間：${e.hoursTC}` : null)); }
    if (e.notesEN || e.notesTC) notes.push(lt(e.notesEN, e.notesTC));
    for (const n of notes) m.infoNote = m.infoNote ? lt([m.infoNote.en, n.en].filter(Boolean).join(" · "), [m.infoNote.tc, n.tc].filter(Boolean).join(" · ")) : n;
    if (!m.contact && e.phone) m.contact = e.phone;
    if (!m.website && e.website) m.website = safeURL(e.website);
    if (e.entranceLatitude != null && e.entranceLongitude != null) m.entrance = { lat: e.entranceLatitude, lng: e.entranceLongitude, note: lt(e.entranceNoteEN, e.entranceNoteTC), source: "curated" };
    // Only claim the operator published these facts when the entry really did
    // supply them. Where the government feed already carries the fees, saying
    // "fees as published by X" would put the operator's name on someone else's
    // figures.
    if (supplied) m.factsProvenance = { publisher: (e.operatorEN || e.operatorTC) ? lt(e.operatorEN, e.operatorTC) : lt("Operator", "營運商"), sourceURL: e.sourceURL || null, checkedOn: e.checkedOn || null };
    if (!m.sources.includes("curated")) m.sources.push("curated");
    // The mall's own name is how people search, not the car park's: nobody
    // looks for "Ocean Terminal" when they mean Harbour City.
    m.searchAliases = [...new Set([...(cp.searchAliases || []), ...(e.matchNames || [])])];
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

export function isOpenAt(cp, ms, isPH = false) {
  if (cp.openingStatus === "closed") return false;
  if (!cp.openingHours.length) return cp.openingStatus === "open" ? true : null;
  return cp.openingHours.some(w => windowContains(w, ms, isPH));
}
// Hong Kong general holidays: data/holidays.json, from the government's 1823
// calendar, as a Set of "YYYY-MM-DD". Sundays are not in it; "SUN" covers them.
export const hkDate = (ms) => new Date(ms + HK_OFFSET_MS).toISOString().slice(0, 10);
export const isPublicHoliday = (ms, holidays) => !!holidays && holidays.has(hkDate(ms));
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
  const open = isOpenAt(cp, ctx.now, ctx.isPH);
  const fee = cp.fees?.[type] || (type !== "privateCar" ? cp.fees?.privateCar : null);
  const rate = hourlyRateAt(fee, ctx.now, ctx.isPH);
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
  // The whole stay, when the screen asks for one (the Cheapest sort): undefined = not asked, null = no fees to go on.
  const stay = ctx.stayMinutes ? stayCost(cp, ctx.now, ctx.stayMinutes, ctx.holidays) : undefined;
  return { rec, cp, id: cp.id, dist, reading, level: lv, fresh, fit: f, isOpen: open, estHourly: rate ? hourlyEquivalent(rate) : null, hourlyIsEstimate: !!rate?.isEstimate, stay, supports, score: blocked ? 0 : Math.max(0, score), reasons };
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
    // By the whole stay when one is set (a meter that can't be kept that long goes last), else by the hourly rate.
    case "lowestCost": { const p = (x) => x.stay === undefined ? x.estHourly ?? INF : x.stay ? x.stay.total + (x.stay.tooLong ? 1e6 : 0) : INF; return (a, b) => p(a) !== p(b) ? p(a) - p(b) : d(a) - d(b); }
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
  // Malls narrows the car parks, not the street: meters have their own tile, so
  // with Meters and Malls both lit the meters outside stay listed. (Malls used to
  // hide every meter while the Meters tile still showed as on, and a mall 1.4 km
  // away was recommended over free bays 66 m from the user.)
  if (f.mallOnly && !cp.isMall && cp.kind !== "onStreetMeter") return false;
  if (f.districts?.length && !(cp.district && f.districts.includes(cp.district))) return false;
  if (f.maxDistanceMetres != null && r.dist != null && r.dist > f.maxDistanceMetres) return false;
  if (f.minDistanceMetres != null && r.dist != null && r.dist < f.minDistanceMetres) return false;
  if (f.maxFreshness != null && FRESH_ORDER[r.fresh] > FRESH_ORDER[f.maxFreshness]) return false;
  if (f.onlyCompatible && (r.fit.kind === "doesNotFit" || r.supports === false)) return false;
  return true;
}
export const applyFilter = (f, ranked) => ranked.filter(r => matchesFilter(f, r));

// Places with spaces that the filters hide although they are much nearer than
// anything with spaces on screen, and which filters hide them, so the Find
// screen can say so (and switch off just those) rather than quietly recommend a
// car park across town. Only when the nearest space shown is over 500 m away:
// closer than that the filters cost little, and a filter chosen on purpose
// shouldn't nag. The distance band is the user's own limit and stays; nothing
// the vehicle can't use counts (its score is 0).
const FILTER_KEYS = ["availableNow", "minimumSpaces", "minimumClearanceMetres", "onlyConfirmedHeight", "evCharging", "motorcycleSpaces", "accessibleSpaces", "openNow", "maxHourlyRateHKD", "mallOnly", "districts", "maxFreshness", "onlyCompatible", "includeMeters"];
export const FILTER_NAME = { mallOnly: lt("Malls", "商場"), openNow: lt("Open now", "開放中"), evCharging: lt("EV", "充電"), includeMeters: lt("Meters off", "咪錶已關"), districts: lt("District", "地區"), onlyCompatible: lt("Height OK", "啱車高") };
export function hiddenNearer(f, all, shown) {
  const hasSpace = (r) => r.score > 0 && r.dist != null && (r.level === "available" || r.level === "limited");
  const nearestShown = Math.min(...shown.filter(hasSpace).map(r => r.dist));     // Infinity when none
  if (!(nearestShown > 500)) return null;
  const base = { ...DEFAULT_FILTER(), vehicleType: f.vehicleType, minDistanceMetres: f.minDistanceMetres ?? null, maxDistanceMetres: f.maxDistanceMetres ?? null };
  const hidden = all.filter(r => hasSpace(r) && r.dist < nearestShown / 2 && matchesFilter(base, r) && !matchesFilter(f, r));
  if (!hidden.length) return null;
  const keys = FILTER_KEYS.filter(k => k in f && hidden.some(r => !matchesFilter({ ...base, [k]: f[k] }, r)));
  return { count: hidden.length, nearest: Math.min(...hidden.map(r => r.dist)), keys };
}

// Distance bands the user can pick on the Find and Map screens, measured
// straight-line from the origin. Each one means "within": 500 m includes the
// car park 100 m away. (They used to be rings, and "250–500 m" hid the mall
// next door.)
export const DISTANCE_BANDS = [
  { id: "all", min: null, max: null, label: lt("Any distance", "不限距離"), short: lt("Any", "不限") },
  { id: "b250", min: null, max: 250, label: lt("Within 250 m", "250 米內"), short: lt("250 m", "250米內") },
  { id: "b500", min: null, max: 500, label: lt("Within 500 m", "500 米內"), short: lt("500 m", "500米內") },
  { id: "b1k", min: null, max: 1000, label: lt("Within 1 km", "1 公里內"), short: lt("1 km", "1公里內") },
  { id: "b2k", min: null, max: 2000, label: lt("Within 2 km", "2 公里內"), short: lt("2 km", "2公里內") },
];
export function bandOf(f) { return DISTANCE_BANDS.find(b => (b.min ?? null) === (f.minDistanceMetres ?? null) && (b.max ?? null) === (f.maxDistanceMetres ?? null))?.id || "custom"; }
export function applyBand(f, id) { const b = DISTANCE_BANDS.find(x => x.id === id) || DISTANCE_BANDS[0]; return { ...f, minDistanceMetres: b.min, maxDistanceMetres: b.max }; }
// A filter saved while bands were rings still carries an inner bound that
// nothing on screen can clear. Drop it; the outer bound stays as chosen.
export function migrateFilter(f) { return f && f.minDistanceMetres != null ? { ...f, minDistanceMetres: null } : f; }

export const CHIPS = [
  { id: "nearMe", label: lt("Near me", "附近"), icon: "◎" }, { id: "cheapest", label: lt("Cheapest", "最平"), icon: "$" },
  { id: "mostSpaces", label: lt("Most spaces", "最多位"), icon: "▦" }, { id: "streetMeters", label: lt("Meters", "咪錶"), short: lt("Meters", "咪錶"), icon: "P" },
  { id: "evCharging", label: lt("EV charging", "充電"), short: lt("EV", "充電"), icon: "⚡" }, { id: "heightFits", label: lt("Height fits", "啱車高"), short: lt("Height OK", "啱車高"), icon: "↕" },
  { id: "openNow", label: lt("Open now", "開放中"), short: lt("Open now", "開放中"), icon: "◔" }, { id: "mallParking", label: lt("Mall parking", "商場"), short: lt("Malls", "商場"), icon: "🛍" },
];
// The Find and Map screens show every option at once, no sideways scrolling:
// one row to sort, one row of on/off filters, one row of distances.
export const SORT_CHOICES = [
  { id: "bestMatch", label: lt("Best", "最合適") }, { id: "nearest", label: lt("Nearest", "最近") },
  { id: "lowestCost", label: lt("Cheapest", "最平") }, { id: "mostSpaces", label: lt("Most spaces", "最多位") },
];
export const FILTER_TILES = ["streetMeters", "evCharging", "heightFits", "openNow", "mallParking"];
// How long you'll stay, for the Cheapest sort and the fees on a car park's page (minutes).
export const STAY_CHOICES = [60, 120, 180, 240, 480];
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
    // Shapes matter: restore writes straight into state AND into storage, so a
    // string where an array belongs makes every later render throw, and the bad
    // value survives a reload.
    const ARRAYS = ["favs", "vehicles", "places", "searches", "recents"], OBJECTS = ["visits", "filter"];
    const data = {};
    for (const k of BACKUP_KEYS) {
      const v = doc.data[k]; if (v === undefined) continue;
      if (ARRAYS.includes(k) && !Array.isArray(v)) return { ok: false, error: "corrupt" };
      if (OBJECTS.includes(k) && (typeof v !== "object" || v === null || Array.isArray(v))) return { ok: false, error: "corrupt" };
      data[k] = v;
    }
    return { ok: true, at: doc.at || null, data };
  } catch { return { ok: false, error: "corrupt" }; }
}
export const backupSummary = (data) => ({ favs: (data.favs || []).length, vehicles: (data.vehicles || []).length, places: (data.places || []).length, visits: Object.keys(data?.visits || {}).length });

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

// ====================================================================
// Typical availability ("patterns").
//
// Nobody records what the government feed says minute to minute, so the app
// can tell you there are 14 spaces now but not whether 14 is normal for a
// Friday evening. A scheduled job (collect_patterns.mjs) samples the feed once
// an hour and folds each reading into a bucket: day type × hour of day.
//
// Storage is positional and tiny. data/patterns/index.json holds the ordered
// list of car park ids; each data/patterns/<dayType>-<hour>.json holds three
// bytes per id, base64-encoded, so one hourly sample rewrites one ~7 KB file
// instead of the whole history:
//   byte 0  typ    typical free spaces, 0-254 (255 = never a count, e.g. a
//                  feed that only says yes/no)
//   byte 1  tight  % of samples at this hour with 5 or fewer spaces, 0-100
//                  (255 = unknown)
//   byte 2  n      samples folded in, capped at 255
// A bucket with fewer than MIN_SAMPLES observations says nothing at all: an
// estimate from two Fridays is a guess, and guesses are what this app refuses
// to make.
// ====================================================================

export const PATTERN = { dayTypes: 3, hours: 24, bytes: 3, unknown: 255, minSamples: 3, confident: 8, tightAtOrBelow: 5, memory: 60 };

// Mon-Fri share a shape; Saturday and Sunday each have their own.
export function dayType(ms) { const w = hkClock(ms).weekday; return w === 0 ? 2 : w === 6 ? 1 : 0; }
export function hourOf(ms) { return Math.floor(hkClock(ms).minutes / 60); }
export const sliceName = (dt, hour) => `${dt}-${String(hour).padStart(2, "0")}`;
export const sliceFor = (ms) => sliceName(dayType(ms), hourOf(ms));

// One sample folded into one bucket. Early samples count fully; after `memory`
// the bucket becomes a rolling average, so a car park that changes its habits
// is followed rather than anchored to its first month.
// Rounding toward the new sample, never to nearest: a plain round freezes the
// average (30 blended with 0 at weight 1/60 rounds back to 30, for ever), so a
// car park that changed its habits would keep reporting its old figure.
function blend(old, sample, w) {
  if (sample === old) return old;                       // exact, and dodges float drift
  const v = old + (sample - old) * w;
  return sample > old ? Math.ceil(v) : Math.floor(v);
}
export function foldSample(prev, count, hasSpace) {
  const p = prev || { typ: PATTERN.unknown, tight: PATTERN.unknown, n: 0 };
  if (count == null && hasSpace == null) return p;
  const n = Math.min(p.n + 1, 255), w = 1 / Math.min(n, PATTERN.memory);
  const isTight = count != null ? count <= PATTERN.tightAtOrBelow : !hasSpace, tightNow = isTight ? 100 : 0;
  const tight = p.tight === PATTERN.unknown ? tightNow : blend(p.tight, tightNow, w);
  let typ = p.typ;
  if (count != null) { const c = Math.min(254, count); typ = p.typ === PATTERN.unknown ? c : Math.min(254, blend(p.typ, c, w)); }
  return { typ, tight: Math.max(0, Math.min(100, tight)), n };
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function bytesToBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? "==" : B64[((b & 15) << 2) | ((c ?? 0) >> 6)] + (c === undefined ? "=" : B64[c & 63]);
  }
  return out;
}
export function base64ToBytes(s) {
  const clean = String(s || "").replace(/[^A-Za-z0-9+/]/g, ""); const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((clean[i + 2] ? B64.indexOf(clean[i + 2]) : 0) << 6) | (clean[i + 3] ? B64.indexOf(clean[i + 3]) : 0);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (clean[i + 2] && o < out.length) out[o++] = (n >> 8) & 255;
    if (clean[i + 3] && o < out.length) out[o++] = n & 255;
  }
  return out;
}

export function encodeSlice(ids, map) {
  const b = new Uint8Array(ids.length * PATTERN.bytes);
  ids.forEach((id, i) => { const p = map[id] || { typ: PATTERN.unknown, tight: PATTERN.unknown, n: 0 };
    b[i * 3] = p.typ; b[i * 3 + 1] = p.tight; b[i * 3 + 2] = p.n; });
  return bytesToBase64(b);
}
export function decodeSlice(ids, b64) {
  const b = base64ToBytes(b64), out = {};
  ids.forEach((id, i) => { const n = b[i * 3 + 2] ?? 0; if (n > 0) out[id] = { typ: b[i * 3], tight: b[i * 3 + 1], n }; });
  return out;
}

export const patternUsable = (p) => !!p && p.n >= PATTERN.minSamples;
// What the pattern says, in the app's own vocabulary, or null when it has
// nothing worth saying.
export function patternVerdict(p) {
  if (!patternUsable(p)) return null;
  const typ = p.typ === PATTERN.unknown ? null : p.typ, tight = p.tight === PATTERN.unknown ? null : p.tight;
  const kind = tight == null ? "unknown" : tight >= 70 ? "usuallyTight" : tight >= 35 ? "mixed" : "usuallyFree";
  return { kind, typical: typ, tightPct: tight, samples: p.n, confident: p.n >= PATTERN.confident };
}
export function patternText(p, lang) {
  const v = patternVerdict(p); if (!v) return null;
  const en = lang === "en";
  if (v.kind === "usuallyTight") return v.typical != null && v.typical > 0
    ? (en ? `Usually tight at this hour (about ${v.typical} free)` : `呢個時段通常好緊張（約 ${v.typical} 個位）`)
    : (en ? "Usually full at this hour" : "呢個時段通常爆滿");
  if (v.kind === "mixed") return v.typical != null
    ? (en ? `Hit and miss at this hour (about ${v.typical} free)` : `呢個時段時有時冇（約 ${v.typical} 個位）`)
    : (en ? "Hit and miss at this hour" : "呢個時段時有時冇");
  if (v.kind === "usuallyFree") return v.typical != null
    ? (en ? `Usually has spaces at this hour (about ${v.typical})` : `呢個時段通常有位（約 ${v.typical} 個）`)
    : (en ? "Usually has spaces at this hour" : "呢個時段通常有位");
  return null;
}
// Short form for a list card.
export function patternTag(p, lang) {
  const v = patternVerdict(p); if (!v || v.kind === "unknown") return null;
  const en = lang === "en";
  return { usuallyTight: en ? "Usually tight now" : "呢陣通常好緊", mixed: en ? "Hit and miss now" : "呢陣時有時冇", usuallyFree: en ? "Usually free now" : "呢陣通常有位" }[v.kind];
}
// "Better in an hour" — the earliest of the next few hours that looks clearly
// easier than now. Only speaks when both buckets are trustworthy.
export function betterLater(nowP, laterPs, lang) {
  const now = patternVerdict(nowP); if (!now || now.kind === "usuallyFree" || now.kind === "unknown") return null;
  for (const { inHours, p } of laterPs) {
    const v = patternVerdict(p); if (!v || v.kind === "unknown") continue;
    const better = (now.tightPct ?? 0) - (v.tightPct ?? 0);
    if (v.kind === "usuallyFree" && better >= 25) {
      const en = lang === "en";
      return en ? `Usually easier in ${inHours} h` : `通常 ${inHours} 小時後鬆啲`;
    }
  }
  return null;
}

// A whole day at one car park, for the "best time to go" chart. maps24[h] is
// the decoded slice for hour h of one day type (null when that hour has not
// been recorded). Each hour gets an ease from 0 (usually full) to 1 (the
// easiest hour of the day): typical free spaces relative to the day's highest,
// or, for feeds that only say yes/no, the share of readings with a space.
// Hours with too few readings have no verdict and stay empty.
export function dayProfile(maps24, id) {
  const hours = Array.from({ length: PATTERN.hours }, (_, h) => {
    const p = maps24?.[h]?.[id] || null, v = patternVerdict(p);
    return { hour: h, p, verdict: v && v.kind !== "unknown" ? v : null, ease: null };
  });
  const counts = hours.filter(x => x.verdict && x.verdict.typical != null).map(x => x.verdict.typical);
  const top = counts.length ? Math.max(1, ...counts) : null;
  for (const x of hours) {
    if (!x.verdict) continue;
    const t = x.verdict.typical;
    x.ease = top != null && t != null ? t / top : (100 - x.verdict.tightPct) / 100;
  }
  return { hours, recorded: hours.filter(x => x.verdict).length, byCount: top != null };
}

// "Usually easiest 14:00–17:00 · hardest 19:00", from a dayProfile. Says
// nothing until a fair part of the day is recorded, and says "about the same"
// rather than inventing a best time when the hours hardly differ.
export function daySummary(profile, lang) {
  const en = lang === "en", known = profile.hours.filter(x => x.verdict);
  if (known.length < 6) return null;
  const eases = known.map(x => x.ease), lo = Math.min(...eases), hi = Math.max(...eases);
  if (hi - lo < 0.25) return en ? "Usually about the same all day" : "通常成日都差唔多";
  const span = (pick) => hourRanges(known.filter(pick).map(x => x.hour));
  const easy = span(x => x.ease >= hi - 0.1), hard = span(x => x.ease <= lo + 0.1);
  return en ? `Usually easiest ${easy} · hardest ${hard}` : `通常 ${easy} 最易泊 · ${hard} 最難泊`;
}
// [14, 15, 16, 19] → "14:00–17:00, 19:00" (at most two runs, longest first).
function hourRanges(hours) {
  const runs = [];
  for (const h of [...hours].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && h === last[1] + 1) last[1] = h; else runs.push([h, h]);
  }
  const hh = (h) => `${String(h).padStart(2, "0")}:00`;          // a run to midnight ends at 24:00
  return runs.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]) || a[0] - b[0]).slice(0, 2).sort((a, b) => a[0] - b[0])
    .map(([s, e]) => s === e ? hh(s) : `${hh(s)}–${hh(e + 1)}`).join(", ");
}

// ====================================================================
// Assistant (💬): plain questions and error reports. No model and no
// server: keyword intents in English and Cantonese over the data already on
// the phone. app.js draws the conversation; everything that decides is here.
// ====================================================================

// English entries match whole words in the lower-cased text; Chinese entries
// match anywhere in the traditional form. Order is priority when a message
// hits several intents (a report beats a question about the same fact).
export const CHAT_INTENTS = [
  { id: "report", words: ["report", "wrong", "wrongly", "incorrect", "error", "errors", "bug", "bugs", "broken", "not working", "doesn't work", "doesnt work", "mistake", "outdated", "out of date", "no longer", "doesn't exist", "doesnt exist", "closed down", "demolished", "complain", "complaint", "報告", "舉報", "有問題", "出錯", "錯誤", "錯咗", "錯左", "唔啱", "唔準", "不準", "不對", "唔對", "壞咗", "壞左", "冇用", "用唔到", "過時", "唔存在", "不存在", "執笠", "已關閉", "已經關", "投訴"] },
  { id: "nearest", words: ["nearest", "near me", "nearby", "closest", "around me", "around here", "close by", "where can i park", "where to park", "附近", "最近", "就近", "邊度有位", "邊度可以泊", "邊度泊", "哪裡有", "哪裏有", "周圍"] },
  { id: "ev", words: ["ev", "evs", "charger", "chargers", "charging", "electric", "tesla", "充電", "電動車", "叉電", "充電樁"] },
  { id: "height", words: ["height", "heights", "clearance", "headroom", "tall", "high", "fit", "fits", "限高", "高度", "淨高", "入唔入到", "入得", "車高", "幾高", "多高", "入到"] },
  { id: "hours", words: ["hours", "open", "opens", "opening", "close", "closes", "closing", "closed", "24 hours", "24h", "overnight", "開放時間", "營業時間", "幾點", "開門", "關門", "開到", "幾時開", "幾時關", "閂門", "閂咗", "開放", "營業", "通宵"] },
  { id: "fee", words: ["fee", "fees", "price", "prices", "cost", "costs", "rate", "rates", "charge", "charges", "how much", "tariff", "tariffs", "expensive", "cheap", "cheaper", "hourly", "per hour", "day park", "night park", "monthly", "free parking", "for free", "is it free", "收費", "幾錢", "幾多錢", "多少錢", "價錢", "價格", "費用", "貴唔貴", "泊車費", "停車費", "時租", "日泊", "夜泊", "月租", "每小時", "一個鐘", "一小時", "幾蚊", "免費"] },
  { id: "pattern", words: ["usually", "typical", "typically", "best time", "busy", "busiest", "quiet", "quietest", "easier", "pattern", "通常", "平時", "幾時去", "最好時間", "繁忙", "最旺", "最靜", "鬆啲", "易泊", "難泊"] },
  { id: "spaces", words: ["space", "spaces", "vacancy", "vacancies", "available", "availability", "full", "empty", "free spaces", "free space", "any spaces", "how many", "spots", "slots", "空位", "有冇位", "有沒有位", "幾多個位", "多少個位", "爆滿", "滿咗", "有位", "吉位", "得唔得", "車位"] },
  { id: "navigate", words: ["navigate", "directions", "how do i get", "how to get", "take me", "route", "drive to", "導航", "點去", "帶我去", "怎麼去", "路線"] },
  // About the app itself. `faq` is the answer.
  { id: "install", words: ["install", "installed", "home screen", "homescreen", "add to home", "app store", "download", "安裝", "主畫面", "加到", "加入主畫面", "下載"],
    faq: lt("Open the app in Safari (iPhone) or Chrome (Android), then Share ▸ Add to Home Screen (Chrome: menu ▸ Install app). It then opens full screen and works offline. It is not in an app store: it is a web app, with no account and nothing to pay.", "用 Safari（iPhone）或 Chrome（Android）開 app，然後 分享 ▸ 加入主畫面（Chrome：選單 ▸ 安裝應用程式）。之後會全屏開啟，離線亦可用。App Store 冇得搵：佢係網頁 app，唔使登入、唔使錢。") },
  { id: "backup", words: ["backup", "back up", "restore", "transfer", "another phone", "new phone", "other phone", "move my", "sync", "備份", "還原", "轉去", "另一部", "新手機", "搬去", "同步"],
    faq: lt("More ▸ Backup & restore. \"Copy backup code\" makes a code holding your favourites, vehicles, places and parking history; \"Restore\" on the other phone reads it. On iPhone, Safari and the Home Screen app keep separate storage, so back up in one and restore in the other.", "更多 ▸ 備份與還原。「複製備份代碼」會產生一段代碼，包含常用、車輛、地點同泊車紀錄；喺另一部機撳「還原」貼上就得。iPhone 嘅 Safari 同主畫面 app 係分開儲存嘅，所以要喺一邊備份、另一邊還原。") },
  { id: "privacy", words: ["privacy", "private", "tracking", "track me", "my data", "upload", "collect", "collects", "私隱", "追蹤", "個人資料", "上傳", "收集"],
    faq: lt("Your location is used only while the app is open, only to rank car parks by distance, and never leaves the phone. Favourites, vehicles, parking sessions and reports stay in this browser. No account, no analytics, no ads.", "定位只會喺 app 開啟時使用，用嚟按距離排列停車場，唔會離開呢部手機。常用、車輛、泊車紀錄同報告只存喺呢個瀏覽器。唔使登入、冇分析追蹤、冇廣告。") },
  { id: "data", words: ["where does the data", "data come", "data from", "source", "sources", "accurate", "accuracy", "reliable", "trust", "資料來源", "邊度嚟", "準唔準", "可靠", "資料嚟自", "數據"],
    faq: lt("Live counts come from the Transport Department through DATA.GOV.HK (car parks every 60 s, street meters every 2 min). Other car parks and vehicle entrances come from OpenStreetMap. Tariffs for the big malls were copied from the operators' own pages, with the date checked. Counts can lag, and a reading older than an hour shows as \"no live data\". Always check the signs on site.", "即時空位來自運輸署（經資料一線通）：停車場每 60 秒、路邊咪錶每 2 分鐘更新。其他停車場同入口來自 OpenStreetMap。大型商場嘅收費係由營運商網頁抄錄，並記錄核對日期。數字可能有延遲，超過一小時嘅讀數會顯示為「冇即時資料」。請以現場標示為準。") },
  { id: "refresh", words: ["refresh", "how often", "update", "updates", "updated", "updating", "stale", "old data", "frozen", "更新", "幾耐", "刷新", "太舊", "唔更新", "冇更新"],
    faq: lt("Live counts refresh every 60 s while the app is open (street meters every 2 min); the car park list itself every 6 hours. \"Find Parking Now\" refreshes at once. If counts look frozen, More ▸ Diagnostics lists the last feed errors.", "App 開啟時，即時空位每 60 秒更新（路邊咪錶每 2 分鐘），停車場名單每 6 小時更新。撳「即刻搵位」會即時更新。如果數字似乎停咗，更多 ▸ 診斷 會列出最近嘅資料錯誤。") },
  { id: "meters", words: ["meter", "meters", "on-street", "on street", "street parking", "hkemeter", "咪錶", "路邊", "泊車錶", "街邊"],
    faq: lt("Street meters are grouped by street section; the count is bays whose sensor reports vacant, refreshed every 2 minutes. Pay at the meter or with the HKeMeter app. The Meters tile under Show hides or shows them.", "路邊咪錶按路段分組；數字係感應器報「吉」嘅泊位數，每 2 分鐘更新。可喺咪錶或 HKeMeter app 付款。「篩選」列嘅「咪錶」方格可以隱藏或顯示佢哋。") },
  { id: "reminder", words: ["reminder", "reminders", "remind", "alert", "alerts", "notify", "notification", "notifications", "push", "提醒", "通知", "推送"],
    faq: lt("Open a car park, tap \"I parked here\" and choose when to be reminded. The reminder fires only while the app is open: iPhone gives web apps no background timers. \"Alert when a watched car park has spaces\" (More) works the same way, for saved car parks with the bell switched on.", "打開停車場，撳「我泊咗喺度」再揀幾時提醒。提醒只會喺 app 開啟時發出：iPhone 唔俾網頁 app 喺背景計時。「常用停車場有位時提醒」（更多）都係一樣，適用於開咗鈴鐺嘅常用停車場。") },
  { id: "vehicle", words: ["vehicle", "vehicles", "my car", "car height", "add a car", "van", "motorcycle", "車輛", "我架車", "加車", "客貨車", "電單車"],
    faq: lt("Vehicle tab ▸ Add vehicle: type, height, length and width. The app then warns about low clearances, hides car parks with no spaces for your type, and can keep to an hourly budget.", "「車輛」分頁 ▸ 加入車輛：車種、車高、車長、車闊。之後 app 會提醒限高、隱藏冇你車種車位嘅停車場，仲可以設定每小時預算。") },
  { id: "favourites", words: ["favourite", "favourites", "favorite", "favorites", "saved", "star", "pin", "pinned", "常用", "儲存", "星星", "置頂", "收藏"],
    faq: lt("Tap the star on any car park. Saved car parks live in the Saved tab; pin one to keep it on top, or tap the bell to be alerted when it has spaces (while the app is open).", "喺任何停車場撳星星。常用停車場喺「已儲存」分頁；撳圖釘可以置頂，撳鈴鐺就會喺有位時提醒（app 開啟時）。") },
  { id: "session", words: ["parked", "where did i park", "find my car", "my parking", "session", "timer", "泊咗", "搵返架車", "泊車紀錄", "計時", "我架車喺邊"],
    faq: lt("Open the car park and tap \"I parked here\" (floor and reminder optional). The Saved tab then shows a timer and \"Take me back to my car\". Where you park is remembered on this phone and nudges the ranking next time.", "打開停車場撳「我泊咗喺度」（樓層同提醒可選）。「已儲存」分頁會顯示計時器同「帶我返去架車度」。你泊過嘅地方會記喺呢部機，下次排名會優先啲。") },
  { id: "offline", words: ["offline", "no internet", "no signal", "no connection", "離線", "冇網絡", "冇訊號", "冇網", "無網絡"],
    faq: lt("Offline, the app shows the last data it received, with its age; counts may be out of date. The map needs a connection.", "離線時 app 會顯示最後收到嘅資料同埋幾耐前收到，數字可能已過時。地圖需要網絡。") },
  { id: "language", words: ["language", "english", "chinese", "cantonese", "語言", "中文", "英文", "廣東話"],
    faq: lt("More ▸ Language switches between English and 繁體中文 at once.", "更多 ▸ 語言 可以即時轉換 English 同繁體中文。") },
  { id: "licence", words: ["licence", "license", "commercial", "copyright", "open source", "使用條款", "版權", "商業", "開源"],
    faq: lt("Free for personal, non-commercial use. The source is public on GitHub (agsm26/hk-parking) under LICENSE.md; OpenStreetMap data stays ODbL.", "只限個人非商業用途。原始碼公開喺 GitHub（agsm26/hk-parking），條款見 LICENSE.md；OpenStreetMap 資料維持 ODbL。") },
  { id: "contact", words: ["contact", "developer", "email", "e-mail", "feedback", "suggest", "suggestion", "feature", "request", "github", "聯絡", "開發者", "意見", "建議", "電郵", "新功能"],
    faq: lt("There is no e-mail address or account behind the app. Reports and questions reach the developer as a GitHub issue: say \"report an error\" here, or type a question and tap \"Send to developer\" when I cannot answer it. Posting needs a free GitHub account.", "App 背後冇電郵地址或帳戶。報告同問題會以 GitHub issue 傳送給開發者：喺度講「報告錯誤」，或者打你嘅問題，我答唔到時撳「傳送給開發者」。發佈需要免費 GitHub 帳戶。") },
  { id: "filters", words: ["filter", "filters", "hide", "hidden", "malls", "district", "districts", "distance", "sort", "sorting", "篩選", "隱藏", "商場", "地區", "距離", "排序"],
    faq: lt("The Find tab has three rows: Sort, Show (Meters, EV, Height OK, Open now, Malls) and Within (distance). A district chosen in search lasts for that search only. When filters hide spaces much nearer than anything shown, the list says so with a \"Show them\" button.", "「搵車位」有三行：排序、篩選（咪錶、充電、啱車高、開放中、商場）同距離。搜尋時揀嘅地區只限該次搜尋。如果篩選隱藏咗比顯示結果近得多嘅車位，清單會話你知，並有「顯示」按鈕。") },
  { id: "stay", words: ["cheapest", "cost for", "whole stay", "total cost", "最平", "全程", "總共幾錢"],
    faq: lt("Sort by Cheapest and pick how long you'll stay (1–8 h). Each car park's page shows what that stay costs from now; \"about\" means it was read from the operator's price text.", "揀「最平」排序再揀停泊幾耐（1–8 小時）。每個停車場嘅詳情會顯示而家泊要幾錢；「約」表示係由營運商嘅收費文字讀出嚟。") },
  { id: "navapp", words: ["waze", "google maps", "apple maps", "navigation app", "導航 app", "地圖 app"],
    faq: lt("More ▸ Navigate with: Apple Maps, Google Maps or Waze. Navigate opens the mapped vehicle entrance when one is known.", "更多 ▸ 導航 app：Apple Maps、Google Maps 或 Waze。有入口資料嘅話，導航會直接去車輛入口。") },
  { id: "greeting", words: ["hi", "hello", "hey", "hihi", "yo", "你好", "哈囉", "早晨", "午安", "晚安"] },
  { id: "thanks", words: ["thanks", "thank you", "thx", "cheers", "唔該", "多謝", "謝謝", "感謝"] },
  { id: "help", words: ["help", "what can you do", "how do i use", "how to use", "幫手", "幫幫", "可以做咩", "點用", "怎麼用", "教我", "功能"] },
];
export const CHAT_FACT_INTENTS = ["spaces", "fee", "height", "hours", "ev", "pattern", "navigate"];
const chatFaqOf = (id) => CHAT_INTENTS.find(i => i.id === id)?.faq || null;
export const chatFAQ = (id, lang) => { const f = chatFaqOf(id); return f ? t(lang, f) : null; };

// What a report can be about, shown as choices. A fact intent in the same
// message picks the kind ("wrong fee at IFC" → price).
export const REPORT_KINDS = [
  ["availability", lt("Availability count wrong", "空位數目唔準")],
  ["entrance", lt("Entrance in the wrong place", "入口位置錯")],
  ["price", lt("Fee wrong or outdated", "收費錯或過時")],
  ["height", lt("Height limit wrong", "限高錯")],
  ["hours", lt("Opening hours wrong", "開放時間錯")],
  ["closed", lt("Car park closed or gone", "停車場已關閉／唔存在")],
  ["app", lt("App not working properly", "App 唔正常")],
  ["other", lt("Other", "其他")],
];
export const reportKindFor = (ids) => ({ spaces: "availability", fee: "price", height: "height", hours: "hours", ev: "other", navigate: "entrance" })[ids.find(i => i !== "report" && CHAT_FACT_INTENTS.includes(i))] || null;

const CHAT_STOP_EN = ["a", "an", "the", "is", "are", "was", "were", "be", "it", "its", "it's", "at", "in", "on", "of", "for", "to", "from", "and", "or", "do", "does", "did", "have", "has", "there", "this", "that", "what", "whats", "what's", "which", "where", "when", "how", "can", "could", "i", "me", "my", "we", "you", "your", "please", "pls", "now", "today", "tonight", "tomorrow", "car", "park", "parks", "carpark", "carparks", "parking", "garage", "tell", "about", "know", "want", "need", "find", "show", "get", "go", "going", "with", "any", "some", "much", "many", "still", "right", "just", "also", "so", "ok", "okay", "question", "ask", "info", "information", "details", "detail", "near", "here", "will", "would", "should", "isn't", "isnt", "yes", "no", "not", "there's", "theres", "by", "up", "into", "inside", "again", "between", "than", "if", "but", "later", "tonight", "am", "pm"];
const CHAT_STOP_TC = ["請問", "我想知道", "我想知", "想知道", "想知", "可唔可以", "可以嗎", "係咪", "是不是", "是否", "點樣", "點解", "為什麼", "怎麼", "怎樣", "告訴我", "話我知", "幫我搵", "幫我", "搵下", "搵一下", "查下", "查一下", "一下", "唔該", "多謝", "謝謝", "而家", "現在", "今日", "今天", "今晚", "聽日", "明天", "嗰個", "呢個", "這個", "那個", "泊車", "停車場", "停車", "車場", "車位", "泊位", "有冇", "有沒有", "幾多", "多少", "可以", "地方", "邊度", "哪裡", "哪裏", "嘅", "喺", "係", "呀", "啊", "嗎", "呢", "啦", "吖", "咩", "咗", "噃", "喎", "囉", "嘛", "哦", "吓", "個", "去", "到", "我", "你", "佢", "的", "了", "呀"];
const esc_ = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ASCII_WORD = /^[a-z0-9' -]+$/;
const hitsWord = (lower, trad, w) => ASCII_WORD.test(w) ? new RegExp(`(^|[^a-z0-9])${esc_(w)}(?![a-z0-9])`).test(lower) : trad.includes(w);

/** What a message asks for: the matched intent ids in priority order, and what
 *  is left once intent words and filler are removed (the car park's name, if any). */
export function chatIntents(text) {
  const raw = String(text || "").replace(/[’‘]/g, "'").trim();
  const lower = raw.toLowerCase(), trad = toTrad(raw);
  const ids = CHAT_INTENTS.filter(i => i.words.some(w => hitsWord(lower, trad, w))).map(i => i.id);
  // Strip every intent word (not only the matched ones: they are all generic),
  // then the filler, leaving what could be a name.
  let q = trad.toLowerCase();
  const phrases = [...CHAT_INTENTS.flatMap(i => i.words), ...CHAT_STOP_TC].sort((a, b) => b.length - a.length);
  for (const w of phrases) q = ASCII_WORD.test(w) ? q.replace(new RegExp(`(^|[^a-z0-9])${esc_(w)}(?![a-z0-9])`, "g"), "$1") : q.split(w).join(" ");
  q = q.replace(/[?？!！。，,.;；:：、"“”'()（）]+/g, " ");
  q = q.split(/\s+/).filter(w => w && !CHAT_STOP_EN.includes(w)).join(" ").trim();
  return { ids, query: q };
}

/** The car park a message names: one clear winner, or a short list to choose from. */
export function chatPickCarPark(query, carparks) {
  if (!query || normText(query).length < 2) return { best: null, hits: [] };
  const hits = searchCarParks(query, carparks, 5).filter(h => h.score >= 55);
  const best = hits.length && hits[0].score >= 70 && (hits.length === 1 || hits[0].score > hits[1].score) ? hits[0].cp : null;
  return { best, hits: hits.slice(0, 4).map(h => h.cp) };
}

// ---- answers about one car park, from an evaluated record (rank/evaluate) ----
const money = (v) => Number.isInteger(v) ? `$${v}` : `$${Number(v).toFixed(1)}`;
function chatSpaces(r, ctx, lang) {
  const en = lang === "en", c = r.reading?.count, cap = r.cp.capacity?.privateCar?.total;
  const fresh = freshnessText(r.fresh, r.reading?.updatedAt, ctx.now, lang);
  const of = cap ? (en ? ` of ${cap}` : `／${cap}`) : "";
  if (r.level === "available") return c != null ? (en ? `✓ ${c} space${c === 1 ? "" : "s"} now${of} (${fresh})` : `✓ 而家有 ${c} 個位${of}（${fresh}）`) : (en ? `✓ Spaces available now (${fresh})` : `✓ 而家有位（${fresh}）`);
  if (r.level === "limited") return en ? `! Only ${c} left${of} (${fresh})` : `! 淨返 ${c} 個位${of}（${fresh}）`;
  if (r.level === "full") return en ? `✕ Full right now (${fresh})` : `✕ 而家爆滿（${fresh}）`;
  if (isInfoOnly(r.cp)) return en ? "ⓘ No live counts: this operator does not publish them. Location and facts only." : "ⓘ 冇即時空位：呢個營運商冇公開數字，只有位置同資料。";
  return en ? `? No live data right now (${fresh})` : `? 而家冇即時資料（${fresh}）`;
}
function chatFee(r, ctx, lang) {
  const en = lang === "en", cp = r.cp, type = ctx.vehicle?.type || "privateCar";
  const fee = cp.fees?.[type] || cp.fees?.privateCar, out = [];
  if (!fee || feeIsEmpty(fee)) return [en ? "$ No fee information. Check the sign at the entrance." : "$ 未有收費資料，請留意入口標示。"];
  const unit = (x) => x.unitMinutes === 30 ? (en ? "/30 min" : "/半小時") : (en ? "/hr" : "/小時");
  const when = (w) => windowIsAllDay(w) && w.weekdays.length >= 7 ? "" : ` (${weekdaysText(w, lang)} ${windowText(w, lang)})`;
  const now = hourlyRateAt(fee, ctx.now, ctx.isPH);
  if (now) out.push(`$ ${en ? "Now" : "而家"} ${now.isEstimate ? (en ? "about " : "約 ") : ""}${money(now.price)}${unit(now)}${when(now.window)}${now.remark ? " · " + now.remark : ""}`);
  for (const x of fee.hourly.filter(x => x !== now).slice(0, 3)) out.push(`· ${money(x.price)}${unit(x)}${when(x.window)}`);
  const kind = { dayPark: en ? "day park" : "日泊", nightPark: en ? "night park" : "夜泊", twentyFourHours: en ? "24-hour" : "24 小時", monthly: en ? "monthly" : "月租", other: en ? "flat rate" : "定額" };
  for (const x of fee.flat.slice(0, 3)) out.push(`· ${kind[x.kind] || x.kind} ${money(x.price)}${x.window ? when(x.window) : ""}`);
  if (!fee.hourly.length && !fee.flat.length && fee.note) { const n = fee.note.replace(/\s+/g, " "); out.push("$ " + (n.length > 220 ? n.slice(0, 219).trimEnd() + "…" : n)); }
  if (type === "privateCar" && ctx.holidays !== undefined) {
    const stays = [60, 120, 180].map(m => stayText(stayCost(cp, ctx.now, m, ctx.holidays), m, lang)).filter(Boolean);
    if (stays.length) out.push((en ? "If you park now: " : "如果而家泊：") + stays.join(" · "));
  }
  if (fee.privileges.length) out.push("🎁 " + fee.privileges[0]);
  return out;
}
function chatHeight(r, ctx, lang) {
  const en = lang === "en", cp = r.cp;
  if (cp.kind === "onStreetMeter") return en ? "↕ On-street bays, no height limit." : "↕ 路邊泊位，冇高度限制。";
  if (cp.height?.metres == null) return en ? "↕ Height limit not confirmed by any source. Check the sign at the entrance." : "↕ 冇資料確認限高，請留意入口標示。";
  let s = "↕ " + heightText(cp.height, lang) + (cp.height.note ? ` (${cp.height.note})` : "");
  if (ctx.vehicle?.heightMetres) s += ` · ${ctx.vehicle.nickname || (en ? "your vehicle" : "你架車")}: ${fitText(fit(ctx.vehicle, cp), lang)}`;
  return s;
}
function chatHours(r, lang) {
  const en = lang === "en", cp = r.cp;
  const status = r.isOpen === true ? (en ? " · open now" : "・開放中") : r.isOpen === false ? (en ? " · closed now" : "・而家閂咗") : "";
  if (cp.openingHours.length) return "🕒 " + cp.openingHours.map(w => `${weekdaysText(w, lang)} ${windowText(w, lang)}`).join("; ") + status;
  if (cp.kind === "onStreetMeter" && cp.fees?.privateCar?.note) return "🕒 " + (en ? "Charging hours: " : "收費時段：") + cp.fees.privateCar.note;
  const note = cp.infoNote ? t(lang, cp.infoNote) : "";
  const m = note.match(/(?:Hours|開放時間)[:：]\s*([^·]+)/); if (m) return "🕒 " + m[1].trim() + status;
  return en ? "🕒 Opening hours not published for this car park." + status : "🕒 呢個停車場未有公佈開放時間。" + status;
}
function chatEV(r, lang) {
  const en = lang === "en", cp = r.cp, bays = cp.capacity?.privateCar?.ev, free = r.reading?.evCount;
  if (cp.facilities.includes("evCharger") || bays > 0 || free > 0) {
    const bits = []; if (bays > 0) bits.push(en ? `${bays} EV bays` : `${bays} 個充電位`); if (free != null) bits.push(en ? `${free} free now` : `而家 ${free} 個空置`);
    return `⚡ ${en ? "EV charging: yes" : "有電動車充電"}${bits.length ? ` (${bits.join(", ")})` : ""}`;
  }
  return en ? `⚡ No EV charging listed${cp.sources.includes("openStreetMap") && isInfoOnly(cp) ? " (OpenStreetMap may simply not record it)" : ""}.` : `⚡ 未列出充電設施${cp.sources.includes("openStreetMap") && isInfoOnly(cp) ? "（OpenStreetMap 可能只係未記錄）" : ""}。`;
}
/** Lines answering the asked facts about one car park; every fact when none is asked. */
export function chatFacts(ids, r, ctx, lang) {
  const en = lang === "en", want = ids.filter(i => CHAT_FACT_INTENTS.includes(i) && i !== "navigate"), all = !want.length;
  const has = (k) => all || want.includes(k), lines = [];
  if (has("spaces")) lines.push(chatSpaces(r, ctx, lang));
  if (has("pattern")) { const pt = patternText(ctx.pattern, lang); if (pt) lines.push("📈 " + pt); const later = pt ? betterLater(ctx.pattern, ctx.later || [], lang) : null; if (later) lines.push("↻ " + later); else if (!pt && want.includes("pattern")) lines.push(en ? "📈 No typical-hour history for this car park yet." : "📈 呢個停車場暫時未有時段參考。"); }
  if (has("fee")) lines.push(...chatFee(r, ctx, lang));
  if (has("height")) lines.push(chatHeight(r, ctx, lang));
  if (has("hours")) lines.push(chatHours(r, lang));
  if (has("ev")) lines.push(chatEV(r, lang));
  if (all && r.dist != null) lines.push(`➤ ${fmtDist(r.dist, lang)}${en ? " away (straight line)" : "（直線距離）"}`);
  return lines.filter(Boolean);
}
/** The nearest places with spaces right now, nearest first. */
export function chatNearest(all, lang, n = 3) {
  const en = lang === "en";
  return all.filter(r => r.dist != null && (r.level === "available" || r.level === "limited") && r.score > 0).sort((a, b) => a.dist - b.dist).slice(0, n)
    .map(r => ({ id: r.id, text: `${t(lang, r.cp.name)} · ${fmtDist(r.dist, lang)} · ${r.reading?.count != null ? (en ? `${r.reading.count} space${r.reading.count === 1 ? "" : "s"}` : `${r.reading.count} 個位`) : (en ? "spaces" : "有位")}` }));
}
