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


def fetch():
    req = urllib.request.Request(ENDPOINT, data=QUERY.encode(),
                                 headers={"User-Agent": "carparkhk-enrich/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())


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

    doc["enrichedAt"] = __import__("datetime").date.today().isoformat()
    doc["attribution"] = "© OpenStreetMap contributors, ODbL"
    SNAPSHOT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    print("records:", len(doc.get("records", [])))
    for k, v in added.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
