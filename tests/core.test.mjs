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
  assert.deepEqual(ids({ mallOnly: true }), ["mall"]);
  assert.deepEqual(ids({ includeMeters: false }), ["closed", "estate", "mall"]);
  assert.deepEqual(ids({ onlyCompatible: true }), ["closed", "estate", "meter"]);
  assert.equal(C.filterActiveCount({ ...f, availableNow: true, evCharging: true, includeMeters: false }), 3);
  // distance bands: rings from the origin, one filter regardless of bounds
  const far = C.rank([{ cp: cp({ id: "here", lat: origin.lat + 0.001, lng: origin.lng }), vac: rd(3) }, { cp: cp({ id: "mid", lat: origin.lat + 0.0035, lng: origin.lng }), vac: rd(3) }, { cp: cp({ id: "far", lat: origin.lat + 0.007, lng: origin.lng }), vac: rd(3) }], { origin, now });
  const inBand = (id) => C.applyFilter(C.applyBand(C.DEFAULT_FILTER(), id), far).map(r => r.id).sort();
  assert.deepEqual(inBand("all"), ["far", "here", "mid"]); assert.deepEqual(inBand("b250"), ["here"]); assert.deepEqual(inBand("b500"), ["mid"]); assert.deepEqual(inBand("b1k"), ["far"]); assert.deepEqual(inBand("b2k"), []);
  assert.equal(C.bandOf(C.applyBand(C.DEFAULT_FILTER(), "b500")), "b500"); assert.equal(C.bandOf(C.DEFAULT_FILTER()), "all"); assert.equal(C.bandOf({ minDistanceMetres: 10, maxDistanceMetres: 20 }), "custom");
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
