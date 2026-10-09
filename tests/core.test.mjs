// node --test tests/   (Node 18+; no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as C from "../core.js";

const here = dirname(fileURLToPath(import.meta.url));
// Real rows captured from the one-stop feed on 5 Sep 2026, kept beside the tests.
const fixtures = here;
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const infoEN = json(join(fixtures, "fixture_info_en.json")).results;
const infoTC = json(join(fixtures, "fixture_info_tc.json")).results;
const vacancy = json(join(fixtures, "fixture_vacancy.json")).results;
const osmDoc = json(join(here, "..", "data", "osm_carparks.json"));
const entDoc = json(join(here, "..", "data", "osm_entrances.json"));
const curatedDoc = json(join(here, "..", "data", "curated_carparks.json"));
const CAPTURE = C.parseHKTime("2026-09-05 10:08:00");

test("Hong Kong bounds and clamping", () => {
  for (const [lat, lng] of [[22.2820, 114.1580], [22.5450, 114.2200], [22.1660, 114.2600], [22.2540, 113.8630], [22.5400, 114.4290]]) assert.ok(C.inHK({ lat, lng }));
  for (const [lat, lng] of [[22.6390, 113.8110], [23.1290, 113.2640], [22.1987, 113.5439], [51.5074, -0.1278], [0, 0]]) assert.ok(!C.inHK({ lat, lng }));
  const c = C.clampHK({ lat: 22.75, lng: 114.10 }); assert.equal(c.lat, C.HK.maxLat); assert.ok(C.inHK(c));
  assert.ok(C.distM({ lat: 22.28, lng: 114.15 }, { lat: 22.29, lng: 114.15 }) > 1000);
  assert.equal(C.fmtDist(320, "en"), "320 m"); assert.equal(C.fmtDist(1750, "tc"), "1.8 公里");
});

test("Hong Kong time parsing and windows", () => {
  const ms = C.parseHKTime("2026-09-05 10:07:05");
  assert.deepEqual(C.hkClock(ms), { weekday: 6, minutes: 607 });   // Saturday 5 Sep 2026, 10:07 HKT
  assert.equal(C.parseHKTime("not a date"), null);
  const night = C.makeWindow(["MON"], C.clockTime("22:00"), C.clockTime("06:00"));
  const monLate = C.parseHKTime("2026-09-07 23:30:00"), monNoon = C.parseHKTime("2026-09-07 12:00:00");
  assert.ok(C.windowContains(night, monLate)); assert.ok(!C.windowContains(night, monNoon));
  assert.ok(C.windowIsAllDay(C.makeWindow(null, C.clockTime("00:00"), C.clockTime("24:00"))));
});

test("feed parsing and bilingual merge", () => {
  const parks = C.normalizeInfo(infoEN, infoTC);
  assert.equal(parks.length, 40);
  const amoy = parks.find(p => p.id === "12");
  assert.equal(amoy.name.en, "Amoy Plaza"); assert.equal(amoy.name.tc, "淘大商場");
  assert.equal(amoy.address.tc, "九龍九龍灣牛頭角道77號");
  assert.equal(amoy.district, "kwunTong"); assert.ok(amoy.isEnriched && amoy.isMall);
  assert.ok(amoy.facilities.includes("evCharger"));
  assert.equal(amoy.height.metres, 1.9);
  assert.equal(amoy.fees.privateCar.hourly[0].price, 25);
  assert.equal(amoy.fees.privateCar.hourly[0].isEstimate, false);
  const legacy = parks.find(p => p.id === "tdc166p1");
  assert.ok(!legacy.isEnriched); assert.equal(legacy.name.tc, "天晴邨第一期停車場"); assert.equal(legacy.district, "yuenLong");
  assert.ok(legacy.photoURL.startsWith("https://"));
});

test("height, legacy tariff and mall rules", () => {
  assert.equal(C.pickHeight([{ height: 0, remark: "Height Limit: \n" }]).metres, null);
  assert.equal(C.pickHeight([{ height: 1.7, remark: "LGV" }, { height: 2.2, remark: "Private Car" }, { height: 1.9, remark: "私家車" }]).metres, 1.9);
  assert.equal(C.pickHeight([{ height: 2.4 }, { height: 2.0 }]).metres, 2.0);
  assert.equal(C.legacyHourly("每小時 $18"), 18); assert.equal(C.legacyHourly("HK$22 per hour"), 22); assert.equal(C.legacyHourly("$15/hr"), 15); assert.equal(C.legacyHourly("Height Limit: 2m"), null);
  const fee = C.feeSchedule(null, "每小時 $18 (Mon-Fri)");
  assert.equal(fee.hourly[0].isEstimate, true); assert.equal(C.hourlyEquivalent(fee.hourly[0]), 18);
  assert.ok(C.isMallName("Telford Plaza I Carpark", "")); assert.ok(C.isMallName("淘大商場", "")); assert.ok(!C.isMallName("Phase 1 Carpark of Tin Ching Estate", "Yuen Long"));
  // malls the feed names without any mall word
  for (const n of ["Vcity Commerical Carpark", "港鐵青衣城停車場", "MTR Maritime Square Car Park", "Ocean PopWalk", "Mikiki", "Popcorn I Carpark", "愉景新城", "北角匯二至三期 B2/F A 區", "V Walk Carpark", "裕民坊"]) assert.ok(C.isMallName(n, ""), n);
  for (const n of ["Kai Ching Estate Car Park", "Hopewell Centre", "Shek Kip Mei Park Sports Centre", "Wood Park Car Park", "Shap Mun Street"]) assert.ok(!C.isMallName(n, ""), n);
  assert.equal(C.matchDistrict("Kwun Tong District"), "kwunTong"); assert.equal(C.matchDistrict("觀塘區"), "kwunTong"); assert.equal(C.matchDistrict("Central and Western District"), "centralAndWestern"); assert.equal(C.matchDistrict("Atlantis"), null);
});

test("vacancy mapping, freshness and levels", () => {
  const v = C.normalizeVacancy(vacancy);
  const amoy = v["12"].privateCar;
  assert.equal(amoy.kind, "count"); assert.equal(amoy.count, 138); assert.equal(amoy.evCount, 2);
  assert.equal(C.level(amoy, CAPTURE), "unknown");            // 31 Aug reading captured 5 Sep
  assert.equal(C.freshness(amoy.updatedAt, CAPTURE), "stale");
  assert.equal(C.level(amoy, amoy.updatedAt + 120e3), "available");
  const now = Date.now();
  const mk = (type, vac) => C.normalizeVacancyEntry("privateCar", { vacancy_type: type, vacancy: vac, lastupdate: "2026-09-05 10:00:00" });
  assert.equal(C.level({ ...mk("A", -1), updatedAt: now }, now), "unknown");
  assert.equal(C.level({ ...mk("A", 0), updatedAt: now }, now), "full");
  assert.equal(C.level({ ...mk("A", 3), updatedAt: now }, now), "limited");
  assert.equal(C.level({ ...mk("A", 6), updatedAt: now }, now), "available");
  assert.equal(C.level({ ...mk("B", 1), updatedAt: now }, now), "available");
  assert.equal(C.level({ ...mk("B", 0), updatedAt: now }, now), "full");
  assert.equal(mk("C", 5).kind, "unknown");
  assert.equal(C.freshness(now - 60e3, now), "live"); assert.equal(C.freshness(now - 10 * 60e3, now), "recent"); assert.equal(C.freshness(now - 40 * 60e3, now), "delayed"); assert.equal(C.freshness(now - 2 * 3600e3, now), "stale"); assert.equal(C.freshness(null, now), "none");
  assert.equal(C.freshnessText("recent", now - 7 * 60e3, now, "en"), "Updated 7 min ago");
  assert.equal(C.freshnessText("stale", now - 5 * 86400e3, now, "en"), "Last update 5 days ago");
});

const METER_INFO = `2026-09-04
,,,,,,,,,,,,,,,,,,,,,,,
PoleId,ParkingSpaceId,Region,Region_tc,Region_sc,District,District_tc,District_sc,SubDistrict,SubDistrict_tc,SubDistrict_sc,Street,Street_tc,Street_sc,SectionOfStreet,SectionOfStreet_tc,SectionOfStreet_sc,Latitude,Longitude,VehicleType,LPP,OperatingPeriod,TimeUnit,PaymentUnit
1,10006A,KOWLOON,九龍,九龙,YAU TSIM MONG,油尖旺區,油尖旺区,MONG KOK,旺角,旺角,SAI YEUNG CHOI STREET SOUTH,西洋菜南街,西洋菜南街,BUTE STREET,弼街,弼街,22.3210,114.1700,A,120,D,15,4.00
1,10006B,KOWLOON,九龍,九龙,YAU TSIM MONG,油尖旺區,油尖旺区,MONG KOK,旺角,旺角,SAI YEUNG CHOI STREET SOUTH,西洋菜南街,西洋菜南街,BUTE STREET,弼街,弼街,22.3212,114.1702,A,120,D,15,4.00
2,10007A,KOWLOON,九龍,九龙,YAU TSIM MONG,油尖旺區,油尖旺区,MONG KOK,旺角,旺角,SAI YEUNG CHOI STREET SOUTH,西洋菜南街,西洋菜南街,BUTE STREET,弼街,弼街,22.3214,114.1704,A,120,D,15,4.00
3,20001A,KOWLOON,九龍,九龙,YAU TSIM MONG,油尖旺區,油尖旺区,MONG KOK,旺角,旺角,NATHAN ROAD,彌敦道,弥敦道,,,,22.3200,114.1690,C,60,Q,30,2.00
4,30001A,HONG KONG,香港島,香港岛,SOUTHERN,南區,南区,BAYS AREAS,海灣,海湾,"ISLAND ROAD, WEST",香島道,香岛道,BEACH CAR PARK,泳灘停車場,泳滩停车场,22.2459,114.1862,A,30,H,15,4.00
90001,99999A,KOWLOON,九龍,九龙,YAU TSIM MONG,油尖旺區,油尖旺区,MONG KOK,旺角,旺角,TEST STREET,測試街,测试街,,,,22.3200,114.1690,A,120,D,15,4.00
`;
const METER_OCC = `ParkingSpaceId,ParkingMeterStatus,OccupancyStatus,OccupancyDateChanged
10006A,N,V,09/05/2026 10:53:32 AM
10006B,N,O,09/05/2026 11:10:18 AM
10007A,NU,V,09/05/2026 11:10:18 AM
30001A,N,O,09/05/2026 09:00:00 AM
`;

test("on-street meters", () => {
  assert.deepEqual(C.parseCSV('a,b\r\n"x, y","he said ""hi"""\nlast,'), [["a", "b"], ["x, y", 'he said "hi"'], ["last", ""]]);
  const { zones, index } = C.meterZones(METER_INFO);
  assert.equal(zones.length, 2);
  const mk = zones.find(z => z.id === "meter:西洋菜南街|弼街");
  assert.equal(mk.kind, "onStreetMeter"); assert.equal(mk.name.tc, "西洋菜南街（近弼街）"); assert.equal(mk.name.en, "Sai Yeung Choi Street South (near Bute Street)");
  assert.equal(mk.district, "yauTsimMong"); assert.equal(mk.bayCount, 3); assert.equal(index[mk.id].length, 3);
  assert.equal(C.hourlyEquivalent(mk.fees.privateCar.hourly[0]), 16); assert.equal(mk.fees.privateCar.hourly.length, 2);
  assert.equal(zones.find(z => z.id.startsWith("meter:香島道")).kind, "offStreet");
  const now = Date.now();
  const r = C.meterReadings(METER_OCC, index, now);
  assert.equal(r[mk.id].privateCar.count, 1); assert.equal(C.level(r[mk.id].privateCar, now), "limited");
  assert.equal(C.level(r["meter:香島道|泳灘停車場"].privateCar, now), "full");
  assert.equal(C.meterReadings("ParkingSpaceId,ParkingMeterStatus,OccupancyStatus\n10006A,NU,V\n", index, now)[mk.id].privateCar.kind, "unknown");
  assert.equal(C.fit({ heightMetres: 2.4 }, mk).kind, "noRestriction");
});

test("OpenStreetMap layer, aliases, dedup, entrances, curated facts", () => {
  const osm = C.osmCarParks(osmDoc);
  assert.ok(osm.length > 800); assert.ok(osm.every(p => C.isInfoOnly(p) && C.inHK(p)));
  for (const q of ["Harbour City", "Times Square", "IFC", "Pacific Place", "Festival Walk", "Cityplaza", "Langham Place", "K11", "MegaBox", "Olympian City", "Mira Place", "Windsor House", "又一城", "海港城", "时代广场"])
    assert.ok(C.searchCarParks(q, osm, 3).length > 0, `no OSM car park for ${q}`);
  const feed = C.normalizeInfo(infoEN, infoTC);
  const amoy = feed.find(p => p.id === "12");
  // Practically on top of the feed car park, so the same place however it is named.
  const dupPlace = { ...osm[0], id: "osm:dup1", name: C.lt("Some car park"), lat: amoy.lat + 0.0001, lng: amoy.lng, searchAliases: [] };
  const dupName = { ...osm[0], id: "osm:dup2", name: C.lt("Amoy Plaza"), lat: 22.40, lng: 114.10, searchAliases: [] };
  // A different building 33 m away is NOT the same car park — merging these
  // erased MegaBox into Manhattan Place next door, and a whole phase of Tuen
  // Mun Town Plaza.
  const neighbour = { ...osm[0], id: "osm:neighbour", name: C.lt("Kowloon Bay Neighbour Tower Carpark"), lat: amoy.lat + 0.0003, lng: amoy.lng, searchAliases: [] };
  // A nameless record next door is a duplicate: it claims nothing of its own.
  const nameless = { ...osm[0], id: "osm:nameless", name: C.lt("Car park"), lat: amoy.lat + 0.0004, lng: amoy.lng, searchAliases: [] };
  // Spelt differently, same place: one name contains the other.
  const spelt = { ...osm[0], id: "osm:spelt", name: C.lt("Amoy Plaza Carpark"), lat: amoy.lat + 0.0006, lng: amoy.lng, searchAliases: [] };
  const merged = C.dedupe(feed, [dupPlace, dupName, neighbour, nameless, spelt, osm.find(p => p.id === "osm:node/1203030599")]);
  const ids = new Set(merged.map(p => p.id));
  assert.ok(!ids.has("osm:dup1"), "same spot = same car park");
  assert.ok(!ids.has("osm:dup2"), "same name = same car park");
  assert.ok(!ids.has("osm:nameless"), "a nameless record next door is a duplicate");
  assert.ok(!ids.has("osm:spelt"), "one name containing the other = same car park");
  assert.ok(ids.has("osm:neighbour"), "a differently named building 33 m away must survive");
  assert.ok(ids.has("osm:node/1203030599"), "Festival Walk is nowhere near the feed car parks");
  assert.equal(merged.length, feed.length + 2);
  assert.ok(C.namesOverlap({ name: C.lt("Amoy Plaza") }, { name: C.lt("Amoy Plaza Carpark") }));
  // Containment needs six characters: below that "Plaza" would swallow "Grand Plaza".
  assert.ok(!C.namesOverlap({ name: C.lt("Plaza") }, { name: C.lt("Grand Plaza") }));
  assert.ok(!C.namesOverlap({ name: C.lt("Car park") }, { name: C.lt("MegaBox car park") }), "a generic name must not swallow a named car park");
  assert.ok(!C.namesOverlap({ name: C.lt("MegaBox") }, { name: C.lt("Manhattan Place") }));
  const withEnt = C.attachEntrances(merged, entDoc);
  assert.ok(withEnt.some(p => p.entrance?.source === "openStreetMap"));
  assert.ok(withEnt.filter(p => p.kind === "onStreetMeter").every(p => !p.entrance));
  const cur = C.applyCurated(withEnt, curatedDoc);
  const fw = cur.find(p => p.id === "osm:node/1203030599");
  assert.equal(fw.name.tc, "又一城停車場"); assert.ok(fw.fees.privateCar.note.includes("HK$24"));
  assert.equal(fw.factsProvenance.sourceURL, "https://www.festivalwalk.com.hk/en/parking"); assert.ok(fw.sources.includes("curated"));
  assert.equal(fw.height.metres, null);                          // page states no height, none is claimed
  assert.equal(cur.find(p => p.id === "12").fees.privateCar.hourly[0].price, 25);   // feed fees untouched
});

test("fit, size advice, ranking, filters, chips", () => {
  const cp = (o) => ({ id: "x", kind: "offStreet", name: C.lt("T"), address: {}, district: "kwunTong", districtText: {}, lat: 22.32, lng: 114.21, entrance: null, height: { metres: 2.0, note: null }, openingStatus: "open", openingHours: [], fees: {}, facilities: [], paymentMethods: [], capacity: {}, isMall: false, isEnriched: false, sources: ["transportDepartmentOneStop"], searchAliases: [], ...o });
  const mifa = { nickname: "MIFA 9", type: "privateCar", heightMetres: 1.84, lengthMetres: 5.27, widthMetres: 2.00 };
  assert.equal(C.fit(mifa, cp({ height: { metres: 1.9 } })).kind, "tight"); assert.equal(C.fit(mifa, cp({})).kind, "fits");
  assert.equal(C.fit({ heightMetres: 2.3 }, cp({})).kind, "doesNotFit"); assert.equal(C.fit(mifa, cp({ height: { metres: null } })).kind, "notConfirmed");
  assert.equal(C.dimensionsText(mifa), "5.27 × 2.00 × 1.84 m");
  const adv = C.sizeAdvice(mifa, "en"); assert.equal(adv.level, "note"); assert.ok(adv.text.includes("27 cm longer") && adv.text.includes("doors will be tight"));
  assert.equal(C.sizeAdvice({ lengthMetres: 4.2, widthMetres: 1.8 }, "en").level, "none"); assert.equal(C.sizeAdvice({}, "en"), null);

  const now = Date.now(), origin = { lat: 22.32, lng: 114.21 };
  const rd = (count, age = 60e3, kind = "count") => ({ privateCar: { vehicleType: "privateCar", kind, count, hasSpace: count > 0, updatedAt: now - age } });
  const recs = [
    { cp: cp({ id: "full", lat: 22.3201, lng: 114.2101 }), vac: rd(0) },
    { cp: cp({ id: "far", lat: 22.36, lng: 114.25 }), vac: rd(200) },
    { cp: cp({ id: "near", lat: 22.3205, lng: 114.2105 }), vac: rd(40) },
  ];
  assert.deepEqual(C.rank(recs, { origin, now }).map(r => r.id), ["near", "far", "full"]);
  const stale = C.evaluate({ cp: cp({}), vac: rd(500, 5 * 86400e3) }, { origin, now });
  assert.equal(stale.level, "unknown"); assert.ok(stale.score < C.evaluate({ cp: cp({}), vac: rd(500) }, { origin, now }).score - 40);
  const tooTall = C.evaluate({ cp: cp({ height: { metres: 1.8 } }), vac: rd(50) }, { origin, now, vehicle: { type: "privateCar", heightMetres: 2.1 } });
  assert.equal(tooTall.score, 0); assert.ok(tooTall.reasons.some(r => r[0] === "tooTall"));
  assert.equal(C.evaluate({ cp: cp({ openingStatus: "closed" }), vac: rd(50) }, { origin, now }).score, 0);
  const osmRec = { cp: cp({ id: "osm", sources: ["openStreetMap"] }), vac: {} };
  const ranked = C.rank([osmRec, { cp: cp({ id: "live", lat: 22.323, lng: 114.213 }), vac: rd(20) }], { origin, now });
  assert.deepEqual(ranked.map(r => r.id), ["live", "osm"]); assert.ok(ranked[1].score > 0);

  const f = C.DEFAULT_FILTER();
  const all = C.rank([
    { cp: cp({ id: "mall", height: { metres: 1.9 }, facilities: ["evCharger"], isMall: true, fees: { privateCar: C.feeSchedule({ hourlyCharges: [{ price: 25 }] }) } }), vac: rd(30) },
    { cp: cp({ id: "estate", lat: 22.326, lng: 114.216, height: { metres: null }, fees: { privateCar: C.feeSchedule({ hourlyCharges: [{ price: 8 }] }) } }), vac: rd(2) },
    { cp: cp({ id: "closed", openingStatus: "closed" }), vac: rd(10) },
    { cp: cp({ id: "meter", kind: "onStreetMeter" }), vac: rd(4) },
  ], { origin, now, vehicle: { type: "privateCar", heightMetres: 2.0 } });
  const ids = (ff) => C.applyFilter({ ...f, ...ff }, all).map(r => r.id).sort();
  assert.deepEqual(ids({ availableNow: true }), ["closed", "estate", "mall", "meter"]);
  assert.deepEqual(ids({ minimumSpaces: 10 }), ["closed", "mall"]);
  assert.deepEqual(ids({ evCharging: true }), ["mall"]);
  assert.deepEqual(ids({ openNow: true }), ["estate", "mall", "meter"]);
  assert.deepEqual(ids({ maxHourlyRateHKD: 10 }), ["closed", "estate", "meter"]);
  assert.deepEqual(ids({ mallOnly: true }), ["mall", "meter"], "Malls narrows the car parks; street meters follow their own tile");
  assert.deepEqual(ids({ mallOnly: true, includeMeters: false }), ["mall"]);
  assert.deepEqual(ids({ includeMeters: false }), ["closed", "estate", "mall"]);
  assert.deepEqual(ids({ onlyCompatible: true }), ["closed", "estate", "meter"]);
  assert.equal(C.filterActiveCount({ ...f, availableNow: true, evCharging: true, includeMeters: false }), 3);
  // distance bands: "within X" from the origin (never rings: 500 m must include
  // the mall 110 m away), one filter regardless of bounds
  const far = C.rank([{ cp: cp({ id: "here", lat: origin.lat + 0.001, lng: origin.lng }), vac: rd(3) }, { cp: cp({ id: "mid", lat: origin.lat + 0.0035, lng: origin.lng }), vac: rd(3) }, { cp: cp({ id: "far", lat: origin.lat + 0.007, lng: origin.lng }), vac: rd(3) }], { origin, now });
  const inBand = (id) => C.applyFilter(C.applyBand(C.DEFAULT_FILTER(), id), far).map(r => r.id).sort();
  assert.deepEqual(inBand("all"), ["far", "here", "mid"]); assert.deepEqual(inBand("b250"), ["here"]); assert.deepEqual(inBand("b500"), ["here", "mid"]); assert.deepEqual(inBand("b1k"), ["far", "here", "mid"]); assert.deepEqual(inBand("b2k"), ["far", "here", "mid"]);
  assert.deepEqual(C.applyFilter({ ...C.applyBand(C.DEFAULT_FILTER(), "b500"), mallOnly: true }, C.rank([{ cp: cp({ id: "mallNextDoor", isMall: true, lat: origin.lat + 0.001, lng: origin.lng }), vac: rd(3) }], { origin, now })).map(r => r.id), ["mallNextDoor"]);
  assert.equal(C.bandOf(C.applyBand(C.DEFAULT_FILTER(), "b500")), "b500"); assert.equal(C.bandOf(C.DEFAULT_FILTER()), "all"); assert.equal(C.bandOf({ minDistanceMetres: 10, maxDistanceMetres: 20 }), "custom");
  // a filter saved while bands were rings (250–500 m) comes back as "within 500 m"
  assert.equal(C.bandOf(C.migrateFilter({ ...C.DEFAULT_FILTER(), minDistanceMetres: 250, maxDistanceMetres: 500 })), "b500");
  assert.equal(C.migrateFilter(C.DEFAULT_FILTER()).minDistanceMetres, null);
  assert.equal(C.filterActiveCount(C.applyBand(C.DEFAULT_FILTER(), "b1k")), 1); assert.equal(C.filterActiveCount(C.applyBand(C.DEFAULT_FILTER(), "all")), 0);
  // familiarity: somewhere you park often is nudged up, but never past a full car park
  const visits = { mall: { n: 4 }, estate: { n: 1 } };
  const withV = (id, v) => C.evaluate({ cp: cp({ id, lat: origin.lat + 0.004, lng: origin.lng }), vac: rd(5) }, { origin, now, visits: v });
  assert.ok(withV("mall", visits).score > withV("mall", {}).score);
  assert.ok(withV("mall", visits).reasons.some(r => r[0] === "parkOften" && r[1] === 4));
  assert.ok(withV("estate", visits).reasons.some(r => r[0] === "parkedBefore"));
  assert.equal(withV("other", visits).reasons.some(r => /park/i.test(r[0])), false);
  assert.ok(C.evaluate({ cp: cp({ id: "mall", openingStatus: "closed" }), vac: rd(5) }, { origin, now, visits }).score === 0);
  assert.ok(C.BACKUP_KEYS.includes("visits"));
  // standing at an info-only mall: it must appear near the top, not below meters a kilometre away
  assert.ok(far[0].reasons.some(r => r[0] === "atLocation"));
  const mallHere = C.evaluate({ cp: cp({ id: "mall", lat: origin.lat + 0.0008, lng: origin.lng, sources: ["openStreetMap"] }), vac: {} }, { origin, now });
  const meterFar = C.evaluate({ cp: cp({ id: "meter", kind: "onStreetMeter", lat: origin.lat + 0.009, lng: origin.lng }), vac: rd(6) }, { origin, now });
  assert.ok(mallHere.score > meterFar.score * 0.6, `${mallHere.score} vs ${meterFar.score}`);
  let st = { f: C.DEFAULT_FILTER(), sort: "bestMatch" };
  st = C.applyChip("cheapest", st.f, st.sort, true); assert.equal(st.sort, "lowestCost"); assert.ok(C.chipIsOn("cheapest", st.f, st.sort));
  st = C.applyChip("streetMeters", st.f, st.sort, false); assert.equal(st.f.includeMeters, false);
});

test("search across scripts", () => {
  assert.equal(C.normText("九龙湾"), "九龍灣"); assert.equal(C.normText("Kowloon  Bay"), "kowloonbay");
  const parks = C.normalizeInfo(infoEN, infoTC);
  assert.equal(C.searchCarParks("淘大", parks)[0].cp.id, "12"); assert.equal(C.searchCarParks("amoy", parks)[0].cp.id, "12");
  assert.ok(C.searchCarParks("tel pla", parks)[0].cp.name.en.includes("Telford"));
  assert.ok(C.searchCarParks("牛頭角道", parks).some(h => h.cp.id === "12"));
  assert.deepEqual(C.searchCarParks("zzzz", parks), []);
  assert.ok(C.districtsMatching("tsim").some(d => d.id === "yauTsimMong")); assert.equal(C.districtsMatching("沙田")[0].id, "shaTin");
});

test("backup code, error log, staleness, Address Lookup Service", () => {
  const state = { favs: [{ id: "meter:西洋菜南街|弼街", name: { en: "Sai Yeung Choi", tc: "西洋菜南街" } }], vehicles: [{ id: "v1", nickname: "MIFA 9", heightMetres: 1.84 }], activeVehicleId: "v1", lang: "tc", vac: { huge: 1 }, feed: [1, 2, 3] };
  const code = C.backupEncode(state, 1000);
  assert.ok(code.startsWith("CPHK1.")); assert.ok(!/[+/=]/.test(code));
  const back = C.backupDecode("  " + code.slice(0, 20) + "\n" + code.slice(20) + " ");
  assert.equal(back.ok, true); assert.equal(back.at, 1000);
  assert.deepEqual(back.data.favs, state.favs); assert.equal(back.data.vehicles[0].nickname, "MIFA 9"); assert.equal(back.data.lang, "tc");
  assert.equal(back.data.vac, undefined); assert.equal(back.data.feed, undefined);
  assert.deepEqual(C.backupSummary(back.data), { favs: 1, vehicles: 1, places: 0, visits: 0 });
  assert.equal(C.backupSummary({ visits: { a: { n: 2 }, b: { n: 1 } } }).visits, 2, "a restore that brought visits back must not report zero");
  assert.equal(C.backupDecode("hello").error, "notBackup"); assert.equal(C.backupDecode("CPHK1.!!!").error, "corrupt"); assert.equal(C.backupDecode("").ok, false);

  let log = []; for (let i = 0; i < 12; i++) log = C.pushError(log, { at: i });
  assert.equal(log.length, 10); assert.equal(log[0].at, 11);

  const now = Date.parse("2026-09-06T00:00:00Z");
  assert.equal(C.factsStale("2026-08-30", now), false); assert.equal(C.factsStale("2026-02-01", now), true); assert.equal(C.factsStale(null, now), false); assert.equal(C.factsStale("garbage", now), false);

  const als = { SuggestedAddress: [
    { Address: { PremisesAddress: { EngPremisesAddress: { BuildingName: "AMOY PLAZA", EngEstate: { EstateName: "AMOY GARDENS" }, EngStreet: { StreetName: "NGAU TAU KOK ROAD", BuildingNoFrom: "77" }, EngDistrict: { DcDistrict: "KWUN TONG DISTRICT" }, Region: "KLN" }, ChiPremisesAddress: { Region: "九龍", ChiDistrict: { DcDistrict: "觀塘區" }, ChiStreet: { StreetName: "牛頭角道", BuildingNoFrom: "77" }, BuildingName: "淘大商場" }, GeospatialInformation: { Latitude: "22.32409", Longitude: "114.21643" } } }, ValidationInformation: { Score: 70 } },
    { Address: { PremisesAddress: { EngPremisesAddress: { BuildingName: "AMOY PLAZA" }, GeospatialInformation: [{ Latitude: "22.32411", Longitude: "114.21641" }] } } },
    { Address: { PremisesAddress: { EngPremisesAddress: { EngStreet: { StreetName: "NATHAN ROAD", BuildingNoFrom: "1" } }, GeospatialInformation: { Latitude: "51.5", Longitude: "-0.1" } } } },
    { Address: {} }, null,
  ] };
  const en = C.alsPlaces(als, "en");
  assert.equal(en.length, 1);
  const ordered = C.alsPlaces({ SuggestedAddress: [
    { Address: { PremisesAddress: { EngPremisesAddress: { BuildingName: "WEAK" }, GeospatialInformation: { Latitude: "22.30", Longitude: "114.17" } } }, ValidationInformation: { Score: 30 } },
    { Address: { PremisesAddress: { EngPremisesAddress: { BuildingName: "STRONG" }, GeospatialInformation: { Latitude: "22.31", Longitude: "114.18" } } }, ValidationInformation: { Score: 90 } } ] }, "en").map(x => x.title);
  assert.deepEqual(ordered, ["Strong", "Weak"]); assert.equal(en[0].title, "Amoy Plaza"); assert.equal(en[0].subtitle, "77 Ngau Tau Kok Road, Kwun Tong District"); assert.equal(en[0].kind, "maps");
  assert.ok(Math.abs(en[0].coordinate.lat - 22.32409) < 1e-6);
  const tc = C.alsPlaces(als, "tc");
  assert.equal(tc[0].title, "淘大商場"); assert.equal(tc[0].subtitle, "牛頭角道77號，觀塘區");
  assert.deepEqual(C.alsPlaces({}, "en"), []); assert.deepEqual(C.alsPlaces(null, "en"), []);
});

test("typical availability patterns", () => {
  // Hong Kong time buckets: Mon-Fri share a shape, Saturday and Sunday do not.
  const at = (iso) => Date.parse(iso);
  assert.equal(C.dayType(at("2026-09-11T03:00:00Z")), 0);            // Friday 11:00 HK
  assert.equal(C.hourOf(at("2026-09-11T03:00:00Z")), 11);
  assert.equal(C.dayType(at("2026-09-12T04:00:00Z")), 1);            // Saturday
  assert.equal(C.dayType(at("2026-09-13T04:00:00Z")), 2);            // Sunday
  assert.equal(C.hourOf(at("2026-09-11T16:30:00Z")), 0);             // 00:30 HK next day
  assert.equal(C.dayType(at("2026-09-11T16:30:00Z")), 1);            // ...which is Saturday
  assert.equal(C.sliceFor(at("2026-09-11T03:00:00Z")), "0-11");
  assert.equal(C.sliceName(2, 7), "2-07");

  // Folding: first sample lands whole, later ones average in.
  let p = C.foldSample(null, 10, true);
  assert.deepEqual(p, { typ: 10, tight: 0, n: 1 });
  p = C.foldSample(p, 0, false);
  assert.equal(p.n, 2); assert.equal(p.typ, 5); assert.equal(p.tight, 50);
  // A feed that only says yes/no never invents a count.
  let q = C.foldSample(null, null, false);
  assert.equal(q.typ, C.PATTERN.unknown); assert.equal(q.tight, 100);
  q = C.foldSample(q, null, true); assert.equal(q.typ, C.PATTERN.unknown); assert.equal(q.tight, 50);
  // A sample with nothing in it changes nothing.
  assert.deepEqual(C.foldSample(p, null, null), p);
  // Counts stay inside a byte, and the bucket keeps following recent behaviour.
  let big = C.foldSample(null, 999, true); assert.equal(big.typ, 254);
  let many = null; for (let i = 0; i < 400; i++) many = C.foldSample(many, 40, true);
  assert.equal(many.n, 255); assert.equal(many.typ, 40);
  for (let i = 0; i < 200; i++) many = C.foldSample(many, 0, false);
  assert.equal(many.typ, 0, "a bucket must follow the new normal, never freeze on the old one");
  assert.equal(many.tight, 100);
  // and back up again, so the decay is not one-way
  for (let i = 0; i < 300; i++) many = C.foldSample(many, 50, true);
  assert.equal(many.typ, 50); assert.equal(many.tight, 0);

  // Positional encoding: ids give the order, three bytes each.
  const ids = ["cp1", "cp2", "cp3", "meter:x|y"];
  const map = { cp1: { typ: 12, tight: 0, n: 9 }, cp3: { typ: 255, tight: 100, n: 4 }, "meter:x|y": { typ: 0, tight: 100, n: 255 } };
  const enc = C.encodeSlice(ids, map);
  assert.equal(C.base64ToBytes(enc).length, ids.length * 3);
  const dec = C.decodeSlice(ids, enc);
  assert.deepEqual(dec.cp1, map.cp1); assert.deepEqual(dec.cp3, map.cp3); assert.deepEqual(dec["meter:x|y"], map["meter:x|y"]);
  assert.equal(dec.cp2, undefined, "a place with no samples must not appear");
  // Appending an id must not disturb the ones already stored.
  const grown = C.decodeSlice([...ids, "cp4"], enc + "AAAA");
  assert.deepEqual(grown.cp1, map.cp1); assert.equal(grown.cp4, undefined);
  for (const s of ["", "!!!!", null]) assert.deepEqual(C.decodeSlice(ids, s), {});

  // Silence until there is enough evidence.
  assert.equal(C.patternText({ typ: 3, tight: 90, n: 2 }, "en"), null);
  assert.equal(C.patternVerdict({ typ: 3, tight: 90, n: 2 }), null);
  assert.equal(C.patternText(null, "en"), null);
  const tightV = C.patternVerdict({ typ: 3, tight: 90, n: 12 });
  assert.equal(tightV.kind, "usuallyTight"); assert.equal(tightV.confident, true);
  assert.equal(C.patternVerdict({ typ: 40, tight: 50, n: 5 }).kind, "mixed");
  assert.equal(C.patternVerdict({ typ: 40, tight: 5, n: 5 }).kind, "usuallyFree");
  assert.equal(C.patternVerdict({ typ: 40, tight: 255, n: 5 }).kind, "unknown");
  assert.match(C.patternText({ typ: 3, tight: 90, n: 12 }, "en"), /Usually tight .*about 3 free/);
  assert.match(C.patternText({ typ: 255, tight: 90, n: 12 }, "en"), /Usually full/);
  assert.match(C.patternText({ typ: 30, tight: 5, n: 12 }, "tc"), /通常有位/);
  assert.equal(C.patternTag({ typ: 3, tight: 90, n: 12 }, "en"), "Usually tight now");
  assert.equal(C.patternTag({ typ: 40, tight: 255, n: 9 }, "en"), null);

  // "Better later" only speaks when now is bad, later is good, and both are known.
  const busy = { typ: 2, tight: 95, n: 20 }, calm = { typ: 40, tight: 5, n: 20 };
  assert.match(C.betterLater(busy, [{ inHours: 1, p: busy }, { inHours: 2, p: calm }], "en"), /easier in 2 h/);
  assert.equal(C.betterLater(calm, [{ inHours: 1, p: calm }], "en"), null, "no advice when now is already fine");
  assert.equal(C.betterLater(busy, [{ inHours: 1, p: { typ: 40, tight: 5, n: 1 } }], "en"), null, "later bucket needs evidence too");
  assert.equal(C.betterLater(busy, [{ inHours: 1, p: null }], "en"), null);
});

test("OpenStreetMap car parks have a district and are recognised as malls (Festival Walk)", () => {
  // From the real snapshot: before, every OSM car park had no district, so a
  // district filter hid all 946, and Festival Walk's record carried no mall flag.
  const fw = C.osmCarParks(osmDoc).find(c => c.id === "osm:node/1203030599");
  assert.ok(fw, "Festival Walk is in the snapshot");
  assert.equal(fw.district, "shamShuiPo");
  assert.equal(fw.districtText.tc, "深水埗區");
  assert.equal(fw.isMall, true, "its name ('…Walk') and alias 又一城 make it a mall");
  // The filters on the phone when it went missing: open now, malls, Sham Shui Po, no meters.
  const f = { ...C.DEFAULT_FILTER(), openNow: true, mallOnly: true, districts: ["shamShuiPo"], includeMeters: false };
  const r = { cp: fw, level: "unknown", reading: null, fresh: "none", isOpen: null, estHourly: null, dist: 1500, fit: { kind: "unknown" }, supports: null, rec: {} };
  assert.equal(C.matchesFilter(f, r), true);
  assert.equal(C.matchesFilter({ ...f, districts: ["kowloonCity"] }, r), false, "and only in its own district");
  // Districts stored as ids or as names both work; anything else is no district.
  const two = C.osmCarParks({ records: [
    { id: "osm:node/1", nameEN: "A Car Park", lat: 22.33, lng: 114.17, district: "kowloonCity" },
    { id: "osm:node/2", nameEN: "B Car Park", lat: 22.33, lng: 114.17, district: "深水埗區" },
    { id: "osm:node/3", nameEN: "C Car Park", lat: 22.33, lng: 114.17, district: "nowhere" },
  ] });
  assert.deepEqual(two.map(c => c.district), ["kowloonCity", "shamShuiPo", null]);
  assert.deepEqual(two.map(c => c.isMall), [false, false, false], "a plain car park is not a mall");
  const share = C.osmCarParks(osmDoc).filter(c => c.district).length / osmDoc.records.length;
  assert.ok(share > 0.9, `most snapshot car parks have a district (${Math.round(share * 100)}%)`);
});

test("height remarks: the height read from the text, the tariff moved to the fees", () => {
  const h1 = C.pickHeight([{ height: 0, remark: "Height limit:1.7(M)\n*Private Car / Van<br>$20 per hour" }]);
  assert.equal(h1.metres, 1.7); assert.equal(h1.note, "1.7(M)"); assert.equal(h1.tariff, "Private Car / Van\n$20 per hour");
  const h2 = C.pickHeight([{ height: 0, remark: "Height Limit: \nHourly<br>  07:00 - 23:00 $20 per hour (private car)<br><br>  Day Park<br>  08:00 - 23:00 $32 (motorcycles)" }]);
  assert.equal(h2.metres, null); assert.equal(h2.note, null, "a price list is not a height note"); assert.match(h2.tariff, /\$20 per hour/);
  const h3 = C.pickHeight([{ height: 0, remark: "Height Limit:<br>3.9m (Applicable to G/F)<br>2.2m (Applicable to 1-2/F)<br><br>" }]);
  assert.equal(h3.metres, 2.2, "the lowest stated: the safe side"); assert.equal(h3.tariff, null);
  assert.equal(C.pickHeight([{ height: 0, remark: "Height Limit:<br>1.9m (Applicable to Entrance)<br>1.8m (Applicable to 1/F)<br>1.7m (Applicable to 2/F)" }]).metres, 1.9, "the entrance decides");
  assert.equal(C.pickHeight([{ height: 0, remark: "1.8m (Applicable to Private Cars/Vans)\n3m (Applicable to Container Vehicles)" }]).metres, 1.8);
  assert.equal(C.pickHeight([{ height: 0, remark: "1.9m (B2-B4 Private Cars)<br>Private Cars：<br>$32/Hour" }]).note, "1.9m (B2-B4 Private Cars)", "a label with a full-width colon is not part of the note");
  assert.deepEqual(C.pickHeight([{ height: 2.1, remark: "Private Car" }]), { metres: 2.1, note: null, tariff: null, other: null }, "a bare vehicle label is not a note");
  assert.equal(C.pickHeight([{ height: 0, remark: "限高 2.0米" }]).metres, 2);
  assert.equal(C.pickHeight([{ height: 0, remark: "Opens 30 min before the mall" }]).metres, null, "minutes are not metres");
  assert.equal(C.pickHeight([{ height: 0, remark: "Ramp 12.5m long" }]).metres, null, "not 2.5 out of 12.5");
  const cp = C.normalizeInfoRow({ park_Id: "x1", name: "Test", latitude: 22.3, longitude: 114.17,
    heightLimits: [{ height: 0, remark: "Height limit:1.8(M)\nPrivate Car<br>$22 per hour" }] }, "en");
  assert.equal(cp.height.metres, 1.8); assert.equal(cp.height.note, "1.8(M)"); assert.equal("tariff" in cp.height, false);
  assert.match(cp.fees.privateCar.note, /\$22 per hour/, "the tariff reaches the fees");
});

test("the feed's twin listings fold into one, and both live counts are read", () => {
  const mk = (id, name, lat, lng, extra = {}) => C.normalizeInfoRow({ park_Id: id, name, latitude: lat, longitude: lng, ...extra }, "en");
  const a = mk("100", "Prosperity Place Car Park", 22.3125, 114.2238, { privateCar: { space: 96 } });
  const b = mk("tdc50p8", "Prosperity Place Car Park", 22.31252, 114.22381);
  const far = mk("tdc9", "Prosperity Place Car Park", 22.33, 114.22);           // same name 2 km away: not a twin
  const out = C.mergeSameCarPark([b, a, far]);
  assert.equal(out.length, 2);
  const m = out.find(x => x.altIds);
  assert.equal(m.id, "100", "the richer record is kept"); assert.deepEqual(m.altIds, ["tdc50p8"]);
  assert.equal(C.mergeSameCarPark(out).length, 2, "running it again changes nothing");
  const t = Date.UTC(2026, 9, 3, 9, 0);
  const r = (count, mins) => ({ kind: count < 0 ? "unknown" : "count", count: count < 0 ? null : count, hasSpace: count > 0, updatedAt: t + mins * 60e3 });
  assert.equal(C.vacancyFor({ 100: { privateCar: r(13, 0) }, tdc50p8: { privateCar: r(1, 0.2) } }, m).privateCar.count, 1, "close in time: the lower count");
  assert.equal(C.vacancyFor({ 100: { privateCar: r(13, 30) }, tdc50p8: { privateCar: r(1, 0) } }, m).privateCar.count, 13, "much fresher wins");
  assert.equal(C.vacancyFor({ 100: { privateCar: r(-1, 0) }, tdc50p8: { privateCar: r(68, 0) } }, m).privateCar.count, 68, "an unknown reading never wins");
  assert.equal(C.vacancyFor({ tdc9: { privateCar: r(5, 0) } }, far).privateCar.count, 5);
});

test("public holidays: closed-on-holiday hours and holiday rates apply", () => {
  const hol = new Set(["2026-10-01"]), thuPH = Date.UTC(2026, 9, 1, 4, 0);      // Thu 1 Oct 2026, noon in Hong Kong
  assert.equal(C.isPublicHoliday(thuPH, hol), true);
  assert.equal(C.isPublicHoliday(thuPH + 24 * 3600e3, hol), false);
  assert.equal(C.isPublicHoliday(thuPH, null), false);
  const weekdaysOnly = { openingStatus: "unknown", openingHours: [C.makeWindow(["MON", "TUE", "WED", "THU", "FRI"], 480, 1200, true)] };
  assert.equal(C.isOpenAt(weekdaysOnly, thuPH), true, "without the holiday it looks open");
  assert.equal(C.isOpenAt(weekdaysOnly, thuPH, true), false, "closed on public holidays");
  const fee = { hourly: [
    { window: C.makeWindow(["MON", "TUE", "WED", "THU", "FRI"], 0, 1440), price: 20, unitMinutes: 60 },
    { window: C.makeWindow(["SAT", "SUN", "PH"], 0, 1440), price: 30, unitMinutes: 60 }] };
  assert.equal(C.hourlyRateAt(fee, thuPH).price, 20);
  assert.equal(C.hourlyRateAt(fee, thuPH, true).price, 30, "the holiday rate");
});

test("OpenStreetMap hours, Shenzhen records and the feed's district fixes", () => {
  assert.equal(C.osmHours("24/7")[0], C.ALWAYS);
  const w = C.osmHours("Mo-Fr 08:00-20:00; Sa,Su,PH 09:00-18:00");
  assert.equal(w.length, 2); assert.deepEqual(w[0].weekdays, ["MON", "TUE", "WED", "THU", "FRI"]); assert.equal(w[1].start, 540);
  assert.ok(C.osmHours("Mo-Su,PH 00:00-24:00")[0].weekdays.includes("PH"));
  assert.deepEqual(C.osmHours("Fr-Mo 10:00-12:00")[0].weekdays, ["FRI", "SAT", "SUN", "MON"]);
  for (const odd of ["sunrise-sunset", "Mo-Fr 08:00-12:00,13:00-18:00", "closed", "", null]) assert.equal(C.osmHours(odd), null, String(odd));
  const osm = C.osmCarParks({ districtsAt: "2026-10-03", records: [
    { id: "osm:node/1", nameEN: "Kornhill Plaza", lat: 22.2855, lng: 114.2158, district: "eastern", openingHours: "24/7" },
    { id: "osm:node/2", nameEN: "瑞湾荟停車場", lat: 22.5541, lng: 113.8766 },
  ] });
  assert.deepEqual(osm.map(c => c.id), ["osm:node/1"], "the Shenzhen car park is gone");
  assert.equal(C.isOpenAt(osm[0], Date.now()), true);
  assert.equal(osm[0].infoNote, null, "parsed hours are not repeated as text");
  const fixed = C.applyDistrictFixes([{ id: "tdc129p3", district: "shamShuiPo", districtText: {} }, { id: "x", altIds: ["104"], district: "wongTaiSin" }, { id: "y", district: "eastern" }],
    { fixes: { tdc129p3: "kwunTong", 104: "kowloonCity", z: "nowhere" } });
  assert.deepEqual(fixed.map(c => c.district), ["kwunTong", "kowloonCity", "eastern"]);
  assert.equal(fixed[0].districtText.tc, "觀塘區");
});

test("a day profile ranks the hours, and the summary names the easiest and hardest", () => {
  const day = Array.from({ length: 24 }, () => ({}));
  const put = (h, typ, tight, n = 20) => { day[h].cp = { typ, tight, n }; };
  for (let h = 8; h <= 20; h++) put(h, 40, 10);                    // a quiet daytime
  put(14, 80, 0); put(15, 78, 0); put(16, 80, 2);                    // easiest mid-afternoon
  put(19, 2, 95);                                                    // hardest at 19:00
  put(3, 60, 0, 1);                                                  // one reading: says nothing
  const prof = C.dayProfile(day, "cp");
  assert.equal(prof.recorded, 13);
  assert.equal(prof.byCount, true);
  assert.equal(prof.hours[14].ease, 1);
  assert.equal(prof.hours[19].ease, 2 / 80);
  assert.equal(prof.hours[3].verdict, null, "too few readings stay empty");
  assert.equal(prof.hours[22].ease, null, "unrecorded hours stay empty");
  assert.equal(C.daySummary(prof, "en"), "Usually easiest 14:00–17:00 · hardest 19:00");
  assert.match(C.daySummary(prof, "tc"), /14:00–17:00 最易泊/);

  // Yes/no feeds have no counts: the share of readings with a space is the ease.
  const yesNo = Array.from({ length: 24 }, (_, h) => ({ cp: { typ: C.PATTERN.unknown, tight: h < 12 ? 20 : 80, n: 10 } }));
  const p2 = C.dayProfile(yesNo, "cp");
  assert.equal(p2.byCount, false);
  assert.equal(p2.hours[0].ease, 0.8);
  assert.equal(C.daySummary(p2, "en"), "Usually easiest 00:00–12:00 · hardest 12:00–24:00");

  // Too little of the day, or hours that hardly differ: no invented best time.
  assert.equal(C.daySummary(C.dayProfile(day.map((m, h) => h < 10 ? m : {}), "cp"), "en"), null);
  const flat = Array.from({ length: 24 }, () => ({ cp: { typ: 50, tight: 0, n: 9 } }));
  assert.equal(C.daySummary(C.dayProfile(flat, "cp"), "en"), "Usually about the same all day");
  assert.equal(C.dayProfile(null, "cp").recorded, 0);
});


test("curated facts attach to the right car park, and duplicates collapse", () => {
  const mk = (id, en, tc, lat, lng) => ({ id, name: { en, tc }, address: {}, lat, lng, kind: "offStreet", sources: ["openStreetMap"],
    height: { metres: null, note: null }, fees: {}, facilities: [], paymentMethods: [], openingHours: [], capacity: {}, district: null, entrance: null });

  // An entry that names an id must never also attach by name. The real case:
  // "時代廣場停車場" also names a car park 30 km from Causeway Bay.
  const causeway = mk("osm:way/26469269", "Times Square car park", "時代廣場停車場", 22.2783, 114.1822);
  const faraway = mk("osm:way/1424632143", "时代广场停車場", "時代廣場停車場", 22.5213, 114.0604);
  const doc = { entries: [{ carParkId: "osm:way/26469269", matchNames: ["Times Square car park", "時代廣場停車場"], feeEN: "HK$19 per 30 min", sourceURL: "https://x", checkedOn: "2026-09-11" }] };
  const out = C.applyCurated([causeway, faraway], doc);
  assert.ok(out[0].factsProvenance, "the named car park keeps its facts");
  assert.equal(out[1].factsProvenance, undefined, "a same-named car park 30 km away must get nothing");

  // Several ids for one entry (Elements has a north and a south car park).
  const north = mk("osm:node/1", "North Carpark", "", 22.3045, 114.1615), south = mk("osm:node/2", "South Carpark", "", 22.3040, 114.1620);
  const two = C.applyCurated([north, south], { entries: [{ carParkIds: ["osm:node/1", "osm:node/2"], matchNames: ["Elements", "圓方"], feeEN: "HK$28/hour", checkedOn: "2026-09-11" }] });
  assert.ok(two[0].factsProvenance && two[1].factsProvenance);
  assert.deepEqual(C.curatedIds({ carParkId: "a", carParkIds: ["b", "c"] }), ["a", "b", "c"]);

  // The mall's name becomes searchable on its car parks: nobody looks for
  // "Ocean Terminal" when they mean Harbour City.
  assert.ok(two[0].searchAliases.includes("Elements"));
  assert.ok(C.searchCarParks("圓方", two).some(h => h.cp.id === "osm:node/1"));
  assert.ok(C.searchCarParks("Elements", two).length >= 1);

  // An entry with no id may be fenced to a place, so a namesake elsewhere is safe.
  const here = mk("osm:node/3", "MOKO", "新世紀廣場", 22.3175, 114.1715), namesake = mk("osm:node/4", "MOKO", "新世紀廣場", 22.45, 114.00);
  const fenced = C.applyCurated([here, namesake], { entries: [{ matchNames: ["MOKO"], near: { lat: 22.3175, lng: 114.1715, radiusMetres: 1500 }, feeEN: "x", checkedOn: "2026-09-11" }] });
  assert.ok(fenced[0].factsProvenance); assert.equal(fenced[1].factsProvenance, undefined);

  // OpenStreetMap holds Cityplaza twice, 6 m apart; two different car parks can
  // legitimately sit as close, so only a matching name collapses them.
  const a = mk("osm:node/1161336799", "Cityplaza Carpark", "太古城中心停車場", 22.2865, 114.2160);
  const b = mk("osm:relation/10347751", "Cityplaza Carpark", "太古城中心停車場", 22.28655, 114.21603);
  const c = mk("osm:node/999", "Somewhere Else Carpark", "另一個停車場", 22.28652, 114.21601);
  // A metered street section must never suppress an off-street car park: its
  // centroid lands within 80 m of many of them.
  const meter = { ...mk("meter:x|y", "Some Street (near Star Street)", "", 22.28651, 114.21602), kind: "onStreetMeter" };
  const withMeter = C.dedupe([meter], [a]);
  assert.ok(withMeter.some(x => x.id === a.id), "a meter section must not erase a car park 1 m away");
  const realRival = C.dedupe([{ ...mk("feed:1", "Cityplaza", "太古城中心", 22.28651, 114.21602), kind: "offStreet" }], [a]);
  assert.ok(!realRival.some(x => x.id === a.id), "but a real car park at the same spot still wins");

  // the feed's "合和中心" swallows OpenStreetMap's "合和商場停車場" 24 m away; the
  // mall flag must survive, or the 商場 filter loses Hopewell
  const hopewellFeed = { ...mk("feed:hw", "Hopewell Centre", "合和中心", 22.27470, 114.17200), kind: "offStreet", isMall: false };
  const hopewellOSM = { ...mk("osm:node/hw", "", "合和商場停車場", 22.27480, 114.17190), isMall: true };
  const hw = C.dedupe([hopewellFeed], [hopewellOSM]);
  assert.equal(hw.length, 1); assert.equal(hw[0].id, "feed:hw"); assert.equal(hw[0].isMall, true);
  assert.equal(hopewellFeed.isMall, false, "the input record is not mutated");
  assert.equal(C.dedupe([hopewellFeed], [{ ...hopewellOSM, isMall: false }])[0].isMall, false, "no flag to carry, none invented");
  const merged = C.dedupe([], [a, b, c]);
  assert.deepEqual(merged.map(x => x.id).sort(), ["osm:node/1161336799", "osm:node/999"], "same name + close = one; different name = both");
  assert.equal(C.dedupe([], [a]).length, 1);
});

test("links from third-party data cannot carry a script scheme", () => {
  assert.equal(C.safeURL("https://www.elementshk.com/x"), "https://www.elementshk.com/x");
  assert.equal(C.safeURL("http://www.kolour-yuenlong.com.hk/"), "https://www.kolour-yuenlong.com.hk/");
  assert.equal(C.safeURL("www.example.com"), "https://www.example.com", "a bare host is just a missing scheme");
  assert.equal(C.safeURL("  https://x.hk  "), "https://x.hk");
  for (const bad of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<script>x</script>", "vbscript:msgbox", "file:///etc/passwd"])
    assert.equal(C.safeURL(bad), null, `${bad} must be refused, not patched into a link`);
  for (const empty of ["", null, undefined, "   "]) assert.equal(C.safeURL(empty), null);

  // OpenStreetMap is world-editable and its snapshot is re-ingested automatically.
  const osm = C.osmCarParks({ records: [
    { id: "osm:node/1", nameEN: "Evil Car Park", lat: 22.32, lng: 114.17, website: "javascript:alert(document.cookie)" },
    { id: "osm:node/2", nameEN: "Fine Car Park", lat: 22.33, lng: 114.18, website: "http://example.hk" },
  ] });
  assert.equal(osm.find(c => c.id === "osm:node/1").website, null);
  assert.equal(osm.find(c => c.id === "osm:node/2").website, "https://example.hk");

  const cur = C.applyCurated([{ ...osm[0], website: null }], { entries: [{ carParkId: "osm:node/1", website: "javascript:alert(1)", feeEN: "x", checkedOn: "2026-09-11" }] });
  assert.equal(cur[0].website, null, "a hand-copied entry gets the same treatment");
});

test("a backup code with the wrong shapes is refused, not restored", () => {
  // restoreCode writes straight into state and into storage, so a bad shape
  // would throw on every later render and survive a reload.
  const good = C.backupEncode({ favs: [{ id: "a" }], vehicles: [], places: [], visits: { a: { n: 1 } }, lang: "en" });
  assert.equal(C.backupDecode(good).ok, true);
  for (const hostile of [
    { favs: "not-an-array" }, { vehicles: { nope: 1 } }, { places: 5 },
    { searches: "x" }, { recents: 0 }, { visits: "x" }, { visits: [] }, { filter: [] }, { filter: "x" },
  ]) {
    const r = C.backupDecode(C.backupEncode(hostile));
    assert.equal(r.ok, false, `${JSON.stringify(hostile)} must be refused`);
    assert.equal(r.error, "corrupt");
  }
  // absent keys are fine; only present-and-wrong is refused
  assert.equal(C.backupDecode(C.backupEncode({ lang: "tc" })).ok, true);
});

test("Malls never hides the street meters beside you, and hidden nearer spaces are reported (Kowloon Tong)", () => {
  // On the phone: Meters and Malls both lit, sorted by nearest, standing among
  // Kowloon Tong's metered streets. Malls hid every meter, so the top pick was
  // Lok Fu, a mall car park 1.4 km away, over free bays 66 m away.
  const now = Date.now(), origin = { lat: 22.332, lng: 114.174 };
  const base = { kind: "offStreet", name: C.lt("T"), address: {}, district: "kowloonCity", districtText: {}, entrance: null, height: { metres: 2.0, note: null }, openingStatus: "open", openingHours: [], fees: {}, facilities: [], paymentMethods: [], capacity: {}, isMall: false, isEnriched: false, sources: [], searchAliases: [] };
  const at = (id, dLat, o = {}) => ({ ...base, id, lat: origin.lat + dLat, lng: origin.lng, ...o });   // 0.001° of latitude ≈ 111 m
  const rd = (count) => ({ privateCar: { vehicleType: "privateCar", kind: "count", count, hasSpace: count > 0, updatedAt: now - 60e3 } });
  const recs = [
    { cp: at("meter", 0.0006, { kind: "onStreetMeter" }), vac: rd(2) },                       // ~66 m
    { cp: at("estate", 0.003), vac: rd(40) },                                                   // ~330 m, not a mall
    { cp: at("lokfu", 0.0126, { isMall: true, district: "wongTaiSin" }), vac: rd(30) },         // ~1.4 km
  ];
  const all = C.rank(recs, { origin, now }, "nearest");
  const f = { ...C.DEFAULT_FILTER(), mallOnly: true };
  const shown = C.applyFilter(f, all);
  assert.deepEqual(shown.map(r => r.id), ["meter", "lokfu"], "the meter outside stays; the plain car park goes");
  assert.equal(C.hiddenNearer(f, all, shown), null, "spaces 66 m away are on screen: nothing to report");
  // Meters off too: say how many nearer places with spaces are hidden, and by what.
  const f2 = { ...f, includeMeters: false }, shown2 = C.applyFilter(f2, all);
  assert.deepEqual(shown2.map(r => r.id), ["lokfu"]);
  const h = C.hiddenNearer(f2, all, shown2);
  assert.equal(h.count, 2); assert.ok(h.nearest > 50 && h.nearest < 80, `${h.nearest}`);
  assert.deepEqual(h.keys, ["mallOnly", "includeMeters"]);
  assert.deepEqual(h.keys.map(k => C.FILTER_NAME[k].tc), ["商場", "咪錶已關"]);
  // "Show them" resets just those filters: everything back, nearest first.
  const d = C.DEFAULT_FILTER(), f3 = { ...f2, ...Object.fromEntries(h.keys.map(k => [k, d[k]])) };
  assert.deepEqual(C.applyFilter(f3, all).map(r => r.id), ["meter", "estate", "lokfu"]);
  // A district left on is named the same way.
  const fd = { ...C.DEFAULT_FILTER(), districts: ["wongTaiSin"] };
  assert.deepEqual(C.hiddenNearer(fd, all, C.applyFilter(fd, all)).keys, ["districts"]);
  // The distance band is the user's own limit: what lies beyond it is never counted, and the band is never switched off.
  const fb = C.applyBand(f2, "b500"), hb = C.hiddenNearer(fb, all, C.applyFilter(fb, all));
  assert.equal(hb.count, 2); assert.deepEqual(hb.keys, ["mallOnly", "includeMeters"]);
  // Spaces a short walk away on screen: a filter chosen on purpose doesn't nag.
  const fm = { ...C.DEFAULT_FILTER(), includeMeters: false };
  assert.equal(C.hiddenNearer(fm, all, C.applyFilter(fm, all)), null, "the car park 330 m away is close enough");
  // Places the vehicle can't get into never count.
  const tall = C.rank(recs, { origin, now, vehicle: { type: "privateCar", heightMetres: 2.3 } }, "nearest");
  assert.equal(C.hiddenNearer(f2, tall, C.applyFilter(f2, tall)).count, 1, "only the meter: the 2.0 m car park is too low");
  // No filters, nothing hidden.
  assert.equal(C.hiddenNearer(C.DEFAULT_FILTER(), all, all), null);
});

test("the feed's CLOSED flag is not read as shut: it marks busy car parks closed all day", () => {
  // 3 Oct 2026: 212 of 581 car parks said CLOSED from afternoon to night, and 131
  // of them filled and emptied live (Airport Car Park 1 156 → 131, apm 48 → 99).
  const row = (status) => C.normalizeInfoRow({ park_Id: "tdc368p1", name: "MOKO Car Park", latitude: 22.3236, longitude: 114.1726, opening_status: status }, "en");
  assert.equal(row("CLOSED").openingStatus, "unknown");
  assert.equal(row("OPEN").openingStatus, "open");
  assert.equal(row(undefined).openingStatus, "unknown");
  const now = Date.now(), live = { privateCar: { vehicleType: "privateCar", kind: "count", count: 99, hasSpace: true, updatedAt: now - 60e3 } };
  const r = C.evaluate({ cp: row("CLOSED"), vac: live }, { origin: { lat: 22.3291, lng: 114.1726 }, now });
  assert.ok(r.score > 0, "it can be recommended"); assert.equal(r.isOpen, null, "shown as hours not confirmed, not as closed");
  assert.equal(C.matchesFilter({ ...C.DEFAULT_FILTER(), openNow: true }, r), true, "Open now keeps it");
  // Opening hours, where the feed gives them, still decide.
  const shut = { ...row("CLOSED"), openingHours: [C.makeWindow(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"], 480, 600)] };
  assert.equal(C.isOpenAt(shut, C.parseHKTime("2026-10-03 22:30:00")), false);
});

test("height remarks: day headings stay with their prices, other lines become the car park's notes", () => {
  // Shek Kip Mei Park: the day lines used to show under "Height limit", and the
  // fees listed two price blocks without saying which days each was for.
  const skm = "Height limit:2.45(M)\nMon to Fri (Except Public Holidays) 07:00-23:00:\nPrivate Car,\nFirst Two Hours: $11/half hour (Thereafter: $16.5/half hour);\n23:00-07:00 $2/half hour.\nSat, Sun & Public Holidays 0700:-23:00:\nPrivate Car,\nFirst Two Hours: $13/half hour (Thereafter: $19.5/half hour);\n23:00-07:00 $2/half hour.";
  const h = C.pickHeight([{ height: 2.45, remark: skm }]);
  assert.equal(h.note, "2.45(M)");
  assert.match(h.tariff, /^Mon to Fri \(Except Public Holidays\) 07:00-23:00:/); assert.match(h.tariff, /Sat, Sun & Public Holidays/);
  assert.equal(h.other, null);
  // Opening hours and the like are neither height nor price: they go to the notes.
  assert.equal(C.pickHeight([{ height: 1.7, remark: "Height Limit: Height limit:1.7(M)" }]).note, "1.7(M)", "the feed's doubled prefix goes too");
  const row = { park_Id: "x", name: "T", latitude: 22.3, longitude: 114.17, heightLimits: [{ height: 3.8, remark: "Height limit:3.8(M)\nOperating HoursMon - Sun & PH: 0000 - 2400" }] };
  assert.equal(C.pickHeight(row.heightLimits).note, "3.8(M)");
  assert.equal(C.normalizeInfoRow(row, "en").infoNote.en, "Operating HoursMon - Sun & PH: 0000 - 2400");
  const both = C.mergeCarPark(C.normalizeInfoRow(row, "en"), C.normalizeInfoRow({ ...row, heightLimits: [{ height: 3.8, remark: "高度限制3.8米\n開放時間星期一至日及公眾假期: 0000 - 2400" }] }, "tc"));
  assert.deepEqual(both.infoNote, { tc: "開放時間星期一至日及公眾假期: 0000 - 2400", en: "Operating HoursMon - Sun & PH: 0000 - 2400" }, "both languages kept");
  // "</br>" breaks lines too; "23:00-07:00：2/半小時" is a price even without its "$".
  assert.equal(C.pickHeight([{ height: 2, remark: "Monthly - PC $1900 </br>MC $480 </br></br> Hourly - PC $16" }]).tariff, "Monthly - PC $1900\nMC $480\nHourly - PC $16");
  assert.equal(C.pickHeight([{ height: 2, remark: "限高2米\n23:00-07:00：2/半小時" }]).tariff, "23:00-07:00：2/半小時");
});

test("cost for a stay: operators' price texts read into rates, first-hours prices, day parks and caps", () => {
  const hol = new Set(json(join(here, "..", "data", "holidays.json")).dates);
  const at = (s) => C.parseHKTime(s), cost = (cp, t, h) => C.stayCost(cp, t, h * 60, hol);
  const sat14 = at("2026-10-03 14:00:00"), mon10 = at("2026-10-05 10:00:00"), mon22 = at("2026-10-05 22:00:00"), ph12 = at("2026-10-01 12:00:00");
  const park = (note) => ({ id: "t", kind: "offStreet", sources: ["transportDepartmentOneStop"], fees: { privateCar: C.feeSchedule(null, note) } });
  // LCSD: a cheaper rate for the first two hours, then dearer; $2 at night; weekends and holidays dearer.
  const skm = park("Mon to Fri (Except Public Holidays) 07:00-23:00:\nPrivate Car,\nFirst Two Hours: $11/half hour (Thereafter: $16.5/half hour);\n23:00-07:00 $2/half hour.\nSat, Sun & Public Holidays 0700:-23:00:\nPrivate Car,\nFirst Two Hours: $13/half hour (Thereafter: $19.5/half hour);\n23:00-07:00 $2/half hour.");
  assert.equal(cost(skm, sat14, 3).total, 91, "4 × $13, then 2 × $19.5");
  assert.equal(cost(skm, mon10, 3).total, 77, "4 × $11, then 2 × $16.5");
  assert.equal(cost(skm, mon22, 3).total, 30, "2 × $11 to 23:00, then 4 × $2");
  assert.equal(cost(skm, ph12, 1).total, 26, "1 Oct is a public holiday: the weekend rate");
  assert.equal(cost(skm, sat14, 3).estimate, true, "read from text, so shown as about");
  // Transport Department: hourly by time band; the day park when the whole stay fits; motorcycles and quarterly left out.
  const tinHau = park("Hourly\n07:00 - 23:00 $24 per hour (private car)\n23:00 - 07:00 $19 per hour (private car)\nDay Park\n07:00 - 19:00 $135 (private car)\n08:00 - 23:00 $32 (motorcycles)\nNight Park\n23:00 - 08:00 $14 (motorcycles)\nQuarterly\nQuarterly $10050 (private car)");
  assert.equal(cost(tinHau, mon10, 3).total, 72);
  assert.deepEqual([cost(tinHau, mon10, 8).total, cost(tinHau, mon10, 8).flat], [135, "day"], "10:00-18:00 fits the 07:00-19:00 day park");
  assert.equal(cost(tinHau, sat14, 8).total, 24 * 8, "14:00-22:00 doesn't");
  assert.match(C.stayText(cost(tinHau, mon10, 8), 480, "tc"), /^8 小時 約 \$135 日泊$/);
  // The airport: the first hour, then each hour after.
  assert.equal(cost(park("Hourly\nFirst hour : $35\nEach hour thereafter : $50"), mon10, 3).total, 135);
  // A day max until midnight is charged again the next day.
  const tsingChin = park("Monthly : Motorcycle $500/Month, Car $2500/Month; Day max : $10/Day (Calculated from the time of admission to 23:59 that night);");
  assert.equal(cost(tsingChin, mon10, 8).total, 10); assert.equal(cost(tsingChin, mon22, 3).total, 20);
  // "(From entry to 24:00) $110" caps the day.
  const hilton = park("Private Cars：\nMonday to Friday (Except Public Holidays) $20/Hour\nSaturday to Sunday and Public Holidays $27/Hour\nMonday to Friday (Except Public Holidays) (From entry to 24:00) $110\nSaturday to Sunday and Public Holidays (From entry to 24:00) $140");
  assert.equal(cost(hilton, mon10, 8).total, 110); assert.equal(cost(hilton, sat14, 3).total, 81);
  // Days written after a price qualify it; hours after a price, before the clause ends, are its own.
  const k11 = park("Monday to Thursday (except public holidays) HK$30 per hour; Friday to Sunday and public holidays HK$41 per hour. Overnight HK$90 for 21:00–10:00. Day park HK$150 for 08:00–19:00, Monday to Friday.");
  assert.equal(cost(k11, mon10, 8).total, 150); assert.equal(cost(k11, sat14, 3).total, 123); assert.equal(cost(k11, mon22, 8).total, 90, "overnight every night");
  // One text for several car parks ("OC1 $22, OC2 $20"): the dearest, so totals err high.
  assert.equal(cost(park("Monday to Friday: OC1 HK$22, OC2 HK$20, OC3 HK$23 per hour."), mon10, 1).total, 23);
  // A car price the reader can't place gives no total from the text.
  assert.equal(C.readTariff("Private car $500"), null);
  assert.equal(C.readTariff("Coach: $16 per half hour"), null, "no private-car price at all");
});

test("cost for a stay: meters, the feed's structured charges, and the Cheapest sort", () => {
  const hol = new Set(json(join(here, "..", "data", "holidays.json")).dates);
  const at = (s) => C.parseHKTime(s), mon10 = at("2026-10-05 10:00:00");
  // A meter: $16 an hour 08:00-20:00 Mon-Sat, at most 2 hours, free after hours.
  const meterFee = { hourly: [{ window: C.makeWindow(["MON", "TUE", "WED", "THU", "FRI", "SAT"], 480, 1200), price: 16, unitMinutes: 60, remark: "Max stay 2 h · 最多可泊 2 小時", isEstimate: false }], flat: [], privileges: [], note: null };
  const meter = { id: "meter:x", kind: "onStreetMeter", sources: ["transportDepartmentMeters"], fees: { privateCar: meterFee } };
  assert.deepEqual(C.stayCost(meter, mon10, 120, hol), { total: 32, estimate: false, flat: null, tooLong: false, maxStay: 120 });
  assert.equal(C.stayCost(meter, mon10, 180, hol).tooLong, true, "a 2-hour meter can't be kept 3 hours");
  assert.deepEqual([C.stayCost(meter, at("2026-10-05 19:00:00"), 180, hol).total, C.stayCost(meter, at("2026-10-05 19:00:00"), 180, hol).tooLong], [16, false], "only 19:00-20:00 is charged");
  assert.equal(C.stayCost(meter, at("2026-10-05 19:45:00"), 120, hol).total, 4, "meters charge by the quarter hour: $4 to 20:00, then free");
  // Structured: "first 2 hours $12" thresholds; a "day park" of $2 at night is a mislabelled half-hour rate, ignored.
  const hongNing = { id: "93", kind: "offStreet", sources: ["transportDepartmentOneStop"], fees: { privateCar: C.feeSchedule({
    hourlyCharges: [{ type: "hourly", price: 18, weekdays: ["MON", "TUE", "WED", "THU", "FRI"], periodStart: "00:00", periodEnd: "00:00", usageThresholds: [{ hours: 2, price: 12 }] }],
    dayNightParks: [{ type: "day-park", price: 2, weekdays: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN", "PH"], periodStart: "23:00", periodEnd: "07:00" }] }) } };
  assert.deepEqual([C.stayCost(hongNing, mon10, 180, hol).total, C.stayCost(hongNing, mon10, 180, hol).estimate], [42, false], "2 × $12 + $18, exact");
  assert.equal(C.stayCost(hongNing, at("2026-10-05 23:30:00"), 120, hol).total, 24, "not $2");
  // Cheapest ranks by the whole stay: a meter that can't be kept that long, then car parks with no fees, go last.
  const base = { name: C.lt("T"), address: {}, district: "kowloonCity", districtText: {}, entrance: null, height: { metres: 2.0, note: null }, openingStatus: "open", openingHours: [], facilities: [], paymentMethods: [], capacity: {}, isMall: false, isEnriched: false, searchAliases: [], lat: 22.33, lng: 114.17 };
  const feeOf = (note) => ({ privateCar: C.feeSchedule(null, note) });
  const recs = [
    { cp: { ...base, id: "dear", kind: "offStreet", sources: ["transportDepartmentOneStop"], fees: feeOf("$30 per hour") }, vac: {} },
    { cp: { ...base, ...meter, id: "meter" }, vac: {} },
    { cp: { ...base, id: "none", kind: "offStreet", sources: ["openStreetMap"], fees: {} }, vac: {} },
    { cp: { ...base, id: "cheap", kind: "offStreet", sources: ["transportDepartmentOneStop"], fees: feeOf("First 2 hours $9/Half hour\nAfter the First 2 Hours $15/Half hour") }, vac: {} },
  ];
  const ranked = C.rank(recs, { origin: { lat: 22.33, lng: 114.17 }, now: mon10, stayMinutes: 180, holidays: hol }, "lowestCost");
  assert.deepEqual(ranked.map(r => r.id), ["cheap", "dear", "meter", "none"]);
  assert.deepEqual(ranked.map(r => r.stay?.total ?? null), [66, 90, 48, null], "4 × $9 + 2 × $15; 3 × $30; the meter's 3 hours aren't allowed");
  assert.equal(ranked[2].stay.tooLong, true);
  assert.equal(C.rank(recs, { origin: { lat: 22.33, lng: 114.17 }, now: mon10 }, "lowestCost")[0].stay, undefined, "no stay asked: not worked out");
});

test("assistant: intents in English and Cantonese, and the name left over", () => {
  const i = (q) => C.chatIntents(q);
  assert.deepEqual(i("How much is parking at Festival Walk?"), { ids: ["fee"], query: "festival walk" });
  assert.deepEqual(i("又一城收費幾錢"), { ids: ["fee"], query: "又一城" });
  assert.deepEqual(i("report wrong fee at IFC").ids, ["report", "fee"]);
  assert.equal(i("report wrong fee at IFC").query, "ifc");
  assert.deepEqual(i("附近邊度有位").ids, ["nearest", "spaces"]);
  assert.deepEqual(i("Is Harbour City open now?"), { ids: ["hours"], query: "harbour city" });   // punctuation never glues to a filler word
  assert.equal(i("海港城有冇充電").ids[0], "ev");
  assert.ok(i("any free spaces at amoy plaza").ids.includes("spaces") && !i("any free spaces at amoy plaza").ids.includes("fee"));
  assert.ok(i("is it free at amoy plaza").ids.includes("fee"));
  assert.equal(i("the car park closed down").ids[0], "report");
  assert.deepEqual(i("how do I back up?").ids, ["backup"]);
  assert.deepEqual(i("點樣備份").ids, ["backup"]);
  assert.deepEqual(i("hi"), { ids: ["greeting"], query: "" });
  assert.deepEqual(i("will my van fit in times square").ids.slice(0, 1), ["height"]);
  assert.equal(i("will my van fit in times square").query, "times square");
  assert.equal(i("停車場限高幾多 太古廣場").query, "太古廣場");
  assert.equal(i("太古广场限高").query, "太古廣場");   // simplified input reads as traditional
  assert.deepEqual(i("   "), { ids: [], query: "" });
  assert.equal(C.reportKindFor(["report", "fee"]), "price"); assert.equal(C.reportKindFor(["report"]), null);
  assert.ok(C.chatFAQ("backup", "tc").includes("備份")); assert.equal(C.chatFAQ("fee", "en"), null);
  assert.ok(C.REPORT_KINDS.some(([k]) => k === "app"));
});

test("assistant: picks one car park, or offers a short list, never a guess", () => {
  const parks = C.normalizeInfo(infoEN, infoTC);
  assert.equal(C.chatPickCarPark("淘大", parks).best?.id, "12");
  assert.equal(C.chatPickCarPark("amoy", parks).best?.id, "12");
  assert.deepEqual(C.chatPickCarPark("zzzz", parks), { best: null, hits: [] });
  assert.deepEqual(C.chatPickCarPark("", parks), { best: null, hits: [] });
  // Harbour City has four car parks wearing the same alias: ask, don't guess.
  const osm = C.applyCurated(C.osmCarParks(osmDoc), curatedDoc);
  const hc = C.chatPickCarPark("harbour city", osm);
  assert.equal(hc.best, null); assert.ok(hc.hits.length >= 2 && hc.hits.length <= 4);
});

test("assistant: facts about one car park and the nearest spaces, both languages", () => {
  const parks = C.normalizeInfo(infoEN, infoTC), vac = C.normalizeVacancy(vacancy);
  const records = parks.map(cp => ({ cp, vac: C.vacancyFor(vac, cp) }));
  const ctx = { origin: { lat: 22.3245, lng: 114.2135 }, now: CAPTURE, vehicle: null, visits: {}, isPH: false, holidays: null };
  const ranked = C.rank(records, ctx);
  const r = ranked.find(x => x.id === "12");
  const fee = C.chatFacts(["fee"], r, ctx, "en"); assert.ok(fee.length >= 1 && fee[0].startsWith("$"), fee.join(" | "));
  const h = C.chatFacts(["height"], r, ctx, "tc"); assert.equal(h.length, 1); assert.ok(/限高|未確認|路邊/.test(h[0]), h[0]);
  const sp = C.chatFacts(["spaces"], r, ctx, "en"); assert.equal(sp.length, 1); assert.ok(/^[✓!✕?ⓘ]/.test(sp[0]), sp[0]);
  const all = C.chatFacts([], r, ctx, "en"); assert.ok(all.length >= 5, all.join(" | ")); assert.ok(all.some(l => l.startsWith("➤")));
  const withVan = C.chatFacts(["height"], r, { ...ctx, vehicle: { type: "privateCar", nickname: "Van", heightMetres: 2.6 } }, "en");
  assert.ok(/Van/.test(withVan[0]) && /spare|Too tall|not confirmed/i.test(withVan[0]), withVan[0]);
  assert.ok(C.chatFacts(["hours"], r, ctx, "tc")[0].startsWith("🕒"));
  assert.ok(C.chatFacts(["ev"], r, ctx, "en")[0].startsWith("⚡"));
  assert.ok(C.chatFacts(["pattern"], r, ctx, "en")[0].includes("No typical-hour history"));
  const near = C.chatNearest(ranked, "en", 3);
  assert.ok(near.length >= 1 && near.length <= 3);
  for (let k = 1; k < near.length; k++) assert.ok(ranked.find(x => x.id === near[k - 1].id).dist <= ranked.find(x => x.id === near[k].id).dist);
  assert.ok(near.every(x => x.text.includes(" · ")));
  assert.deepEqual(C.chatNearest(ranked.map(x => ({ ...x, dist: null })), "en"), []);
});
