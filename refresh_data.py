#!/usr/bin/env python3
"""Refresh every bundled data file, and say which operator facts are going stale.

    python3 refresh_data.py            # meters + OpenStreetMap tags + staleness report
    python3 refresh_data.py --check    # report only, change nothing

Run it every three months. Afterwards: python3 bump.py, upload, python3 check_deploy.py.

What it touches:
  data/meter_zones.json   rebuilt from the Transport Department CSV (4.8 MB download)
  data/osm_carparks.json  height limits, capacity, hours and operator tags re-read
                          from OpenStreetMap (see enrich_osm.py)
  data/curated_carparks.json  never touched — those facts are read by hand from
                          operator pages. This script only tells you which are old.
"""
import datetime, json, pathlib, subprocess, sys, urllib.request

HERE = pathlib.Path(__file__).parent
DATA = HERE / "data"
CSV = "https://resource.data.one.gov.hk/td/psiparkingspaces/spaceinfo/parkingspaces.csv"
STALE_DAYS = 180
check_only = "--check" in sys.argv


def meters():
    print("meter bays: downloading the Transport Department CSV…")
    with urllib.request.urlopen(CSV, timeout=180) as r:
        text = r.read().decode("utf-8", "replace")
    tmp = HERE / "_meters.csv"
    tmp.write_text(text)
    node = ('import("./core.js").then(C=>{const fs=require("fs");'
            'const m=C.meterZones(fs.readFileSync("_meters.csv","utf8"));'
            'if(!m.zones.length){console.error("no zones parsed");process.exit(1)}'
            'fs.writeFileSync("data/meter_zones.json",JSON.stringify({at:Date.now(),'
            'source:"resource.data.one.gov.hk/td/psiparkingspaces",zones:m.zones,index:m.index}));'
            'console.log("  zones:",m.zones.length)})')
    subprocess.run(["node", "-e", node], cwd=HERE, check=True)
    tmp.unlink()


def staleness():
    doc = json.load(open(DATA / "curated_carparks.json"))
    today = datetime.date.today()
    rows = []
    for e in doc["entries"]:
        d = e.get("checkedOn")
        age = (today - datetime.date.fromisoformat(d)).days if d else None
        rows.append((age if age is not None else 9999, e["matchNames"][0], d, e.get("sourceURL")))
    rows.sort(reverse=True)
    stale = [r for r in rows if r[0] > STALE_DAYS]
    print(f"\noperator facts: {len(rows)} entries, oldest checked {rows[0][0]} days ago")
    if stale:
        print(f"  {len(stale)} past {STALE_DAYS} days — re-read these pages and update checkedOn:")
        for age, name, d, url in stale:
            print(f"    {name} (checked {d}) {url}")
    else:
        print(f"  none past {STALE_DAYS} days. The app flags anything older to the user anyway.")


if not check_only:
    meters()
    print("\nOpenStreetMap tags:")
    subprocess.run([sys.executable, "enrich_osm.py"], cwd=HERE, check=True)
staleness()
if not check_only:
    print("\nNext: python3 bump.py  →  upload  →  python3 check_deploy.py")
