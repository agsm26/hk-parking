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
  const dupPlace = { ...osm[0], id: "osm:dup1", name: C.lt("Some car park"), lat: amoy.lat + 0.0003, lng: amoy.lng, searchAliases: [] };
  const dupName = { ...osm[0], id: "osm:dup2", name: C.lt("Amoy Plaza"), lat: 22.40, lng: 114.10, searchAliases: [] };
  const merged = C.dedupe(feed, [dupPlace, dupName, osm.find(p => p.id === "osm:node/1203030599")]);
  assert.equal(merged.length, feed.length + 1);
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
  assert.deepEqual(ids({ mallOnly: true }), ["mall"]);
  assert.deepEqual(ids({ includeMeters: false }), ["closed", "estate", "mall"]);
  assert.deepEqual(ids({ onlyCompatible: true }), ["closed", "estate", "meter"]);
  assert.equal(C.filterActiveCount({ ...f, availableNow: true, evCharging: true, includeMeters: false }), 3);
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
