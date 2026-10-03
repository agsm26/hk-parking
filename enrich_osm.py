#!/usr/bin/env python3
"""Add height limits, capacity, hours and operator tags from OpenStreetMap to
data/osm_carparks.json.

core.js already reads maxHeightMetres / capacity / capacityDisabled /
openingHours / feeText / phone / website / operatorEN / operatorTC — the
snapshot simply never carried them. Re-run this after rebuilding the snapshot,
or every few months to pick up newly mapped car parks:

    python3 enrich_osm.py            # downloads fresh tags from Overpass
    python3 enrich_osm.py dump.json  # or re-use a saved Overpass dump

Data © OpenStreetMap contributors, ODbL. Nothing is invented: a field is only
written when OSM states it.
"""
import json, os, pathlib, re, sys, urllib.request

HERE = pathlib.Path(__file__).parent
SNAPSHOT = HERE / "data" / "osm_carparks.json"
QUERY = ('[out:json][timeout:120];'
         'nwr["amenity"="parking"](22.13,113.80,22.58,114.45);out tags center;')
ENDPOINT = "https://overpass-api.de/api/interpreter"


def fetch(query=QUERY):
    req = urllib.request.Request(ENDPOINT, data=query.encode(),
                                 headers={"User-Agent": "carparkhk-enrich/1.0"})
    with urllib.request.urlopen(req, timeout=240) as r:
        return json.loads(r.read())


# Which of Hong Kong's 18 districts each car park is in, from the district
# boundaries mapped in OpenStreetMap (admin_level 6). The app filters by
# district, and OpenStreetMap car parks carry no district of their own, so
# without this they all vanished whenever a district was chosen. The values
# are the ids core.js uses (DISTRICTS); the query box also catches Shenzhen's
# districts, which match nothing here and are ignored.
DISTRICTS = {"中西區": "centralAndWestern", "灣仔區": "wanChai", "東區": "eastern", "南區": "southern",
             "油尖旺區": "yauTsimMong", "深水埗區": "shamShuiPo", "九龍城區": "kowloonCity",
             "黃大仙區": "wongTaiSin", "觀塘區": "kwunTong", "葵青區": "kwaiTsing", "荃灣區": "tsuenWan",
             "屯門區": "tuenMun", "元朗區": "yuenLong", "北區": "north", "大埔區": "taiPo",
             "沙田區": "shaTin", "西貢區": "saiKung", "離島區": "islands"}
DISTRICT_QUERY = ('[out:json][timeout:180];'
                  'rel["boundary"="administrative"]["admin_level"="6"](22.13,113.80,22.58,114.45);out geom;')


def rings(rel):
    """A boundary relation's member ways joined into rings of (lng, lat)."""
    segs = [[(p["lon"], p["lat"]) for p in m["geometry"]] for m in rel.get("members", [])
            if m.get("type") == "way" and m.get("geometry")]
    out = []
    while segs:
        ring = segs.pop()
        while ring[0] != ring[-1]:
            nxt = next((i for i, s in enumerate(segs) if ring[-1] in (s[0], s[-1])), None)
            if nxt is None:
                break                                # left open; inside() closes it straight
            s = segs.pop(nxt)
            ring += (s if s[0] == ring[-1] else s[::-1])[1:]
        out.append(ring)
    return out


def inside(rings_, x, y):
    """Even-odd test over all rings, so holes (inner rings) count as outside."""
    hit = False
    for ring in rings_:
        for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
            if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                hit = not hit
    return hit


def district_polygons():
    """The 18 districts as (id, rings, bounding box); stops if any is missing."""
    polys = []
    for e in fetch(DISTRICT_QUERY).get("elements", []):
        t = e.get("tags", {})
        names = [t.get(k, "") for k in ("name:zh-Hant", "name:zh-HK", "name:zh", "name")]
        cands = [c for n in names for c in (n, n.split(" ")[0])]        # "中西區 Central and Western" too
        did = next((DISTRICTS[c] for c in cands if c in DISTRICTS), None)
        if not did:
            continue
        rs = rings(e)
        xs, ys = [x for r in rs for x, _ in r], [y for r in rs for _, y in r]
        polys.append((did, rs, (min(xs), min(ys), max(xs), max(ys))))
    missing = sorted(set(DISTRICTS.values()) - {p[0] for p in polys})
    if missing:
        raise SystemExit(f"District boundaries missing from OpenStreetMap: {missing}. Nothing was changed.")
    return polys


def district_at(polys, x, y):
    found = [did for did, rs, (a, b, c, d) in polys if a <= x <= c and b <= y <= d and inside(rs, x, y)]
    if found:
        return found[0]
    # Just outside every boundary (a pier, a reclaimed edge): the nearest boundary
    # point within about 1 km decides; further out (Shenzhen), none.
    best = min(((x - bx) ** 2 + (y - by) ** 2, did) for did, rs, _ in polys for r in rs for bx, by in r)
    return best[1] if best[0] < 0.01 ** 2 else None


def assign_districts(doc, polys):
    """Write each record's district id; return (count per district, ids left without one)."""
    counts, unplaced = {}, []
    for rec in doc.get("records", []):
        did = district_at(polys, rec["lng"], rec["lat"])
        if did:
            rec["district"] = did
            counts[did] = counts.get(did, 0) + 1
        else:
            rec.pop("district", None)
            unplaced.append(rec["id"])
    doc["districtsAt"] = __import__("datetime").date.today().isoformat()
    return counts, unplaced


FEED = "https://api.data.gov.hk/v1/carpark-info-vacancy?data=info&lang=zh_TW"
FIXES = HERE / "data" / "district_fixes.json"


def feed_district_fixes(polys):
    """The government feed's district labels are typed in by operators; check each
    car park's position against the boundaries and list the ones that disagree
    (or have none) in data/district_fixes.json. The app applies them."""
    req = urllib.request.Request(FEED, headers={"User-Agent": "carparkhk-enrich/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        rows = json.loads(r.read()).get("results", [])
    fixes = {}
    for row in rows:
        try:
            x, y = float(row["longitude"]), float(row["latitude"])
        except (KeyError, TypeError, ValueError):
            continue
        label = (row.get("district") or "").strip()
        said = DISTRICTS.get(label) or DISTRICTS.get(label + "區")
        found = district_at(polys, x, y)
        if found and found != said:
            fixes[str(row["park_Id"])] = found
    FIXES.write_text(json.dumps({"source": "district boundaries, OpenStreetMap (ODbL)",
                                 "checkedAt": __import__("datetime").date.today().isoformat(),
                                 "fixes": dict(sorted(fixes.items()))}, ensure_ascii=False, indent=1) + "\n")
    return fixes


def height_metres(tags):
    """OSM maxheight, in metres. 'yes'/'default' mean 'restricted, value unknown'."""
    for key in ("maxheight", "maxheight:physical"):
        raw = str(tags.get(key, "")).strip().lower()
        if not raw or raw in ("yes", "no", "default", "none", "unsigned"):
            continue
        feet = re.match(r"^(\d+)'\s*(\d+)?\"?$", raw)          # 7'6"
        if feet:
            m = (int(feet.group(1)) * 12 + int(feet.group(2) or 0)) * 0.0254
            return round(m, 2)
        num = re.match(r"^(\d+(?:\.\d+)?)\s*(m|metres?|meters?)?$", raw)
        if num:
            m = float(num.group(1))
            if 1.0 <= m <= 6.0:                                 # sanity: a car park, not a typo
                return m
    return None


def as_int(v):
    try:
        n = int(str(v).strip())
        return n if 0 < n <= 20000 else None
    except (TypeError, ValueError):
        return None


def main():
    if "--districts-only" in sys.argv:
        doc = json.load(open(SNAPSHOT))
        polys = district_polygons()
        counts, unplaced = assign_districts(doc, polys)
        fixes = feed_district_fixes(polys)
        SNAPSHOT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
        print("districts:", sum(counts.values()), "placed,", len(unplaced), "outside Hong Kong;",
              len(fixes), "feed district labels corrected", fixes)
        return
    dump = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else fetch()
    tags_by_id = {}
    for e in dump.get("elements", []):
        tags_by_id[f"osm:{e['type']}/{e['id']}"] = e.get("tags", {})

    doc = json.load(open(SNAPSHOT))
    added = {k: 0 for k in ("maxHeightMetres", "capacity", "capacityDisabled",
                            "openingHours", "feeText", "phone", "website", "operator")}
    for rec in doc.get("records", []):
        t = tags_by_id.get(rec["id"])
        if not t:
            continue
        h = height_metres(t)
        if h is not None:
            rec["maxHeightMetres"] = h; added["maxHeightMetres"] += 1
        for field, key, conv in (("capacity", "capacity", as_int),
                                 ("capacityDisabled", "capacity:disabled", as_int),
                                 ("openingHours", "opening_hours", str),
                                 ("feeText", "charge", str),
                                 ("phone", "phone", str),
                                 ("website", "website", str)):
            v = t.get(key)
            if v in (None, ""):
                continue
            v = conv(v)
            if v is None:
                continue
            rec[field] = v; added[field] += 1
        en, tc = t.get("operator:en") or t.get("operator"), t.get("operator:zh") or t.get("operator:zh-Hant")
        if en or tc:
            if en: rec["operatorEN"] = en
            if tc: rec["operatorTC"] = tc
            added["operator"] += 1

    polys = district_polygons()
    counts, unplaced = assign_districts(doc, polys)
    fixes = feed_district_fixes(polys)
    doc["enrichedAt"] = __import__("datetime").date.today().isoformat()
    doc["attribution"] = "© OpenStreetMap contributors, ODbL"
    SNAPSHOT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    print("records:", len(doc.get("records", [])))
    for k, v in added.items():
        print(f"  {k}: {v}")
    print(f"  district: {sum(counts.values())} (outside Hong Kong: {len(unplaced)}); feed labels corrected: {len(fixes)}")


if __name__ == "__main__":
    main()
