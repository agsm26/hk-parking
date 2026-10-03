#!/usr/bin/env python3
"""Refresh every bundled data file, and say which operator facts are going stale.

    python3 refresh_data.py            # holidays + meters + OpenStreetMap tags + staleness report
    python3 refresh_data.py --holidays # the public holiday list only (no Node needed)
    python3 refresh_data.py --check    # report only, change nothing

Run it every three months (meters need Node). Afterwards: python3 publish.py.

What it touches:
  data/holidays.json      Hong Kong general holidays from the government's 1823 calendar
  data/meter_zones.json   rebuilt from the Transport Department CSV (4.8 MB download)
  data/osm_carparks.json  height limits, capacity, hours and operator tags re-read
                          from OpenStreetMap, and each car park's district from the
                          district boundaries (see enrich_osm.py)
  data/district_fixes.json  the government feed's car parks whose district label
                          disagrees with the boundaries (also enrich_osm.py)
  data/curated_carparks.json  never touched — those facts are read by hand from
                          operator pages. This script only tells you which are old.
"""
import datetime, json, pathlib, subprocess, sys, urllib.request

HERE = pathlib.Path(__file__).parent
DATA = HERE / "data"
CSV = "https://resource.data.one.gov.hk/td/psiparkingspaces/spaceinfo/parkingspaces.csv"
HOLIDAYS = "https://www.1823.gov.hk/common/ical/en.json"
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


def holidays():
    """Opening hours and rates often differ on public holidays; the app reads the dates here."""
    with urllib.request.urlopen(HOLIDAYS, timeout=60) as r:
        doc = json.loads(r.read().decode("utf-8-sig"))
    dates = sorted({f"{d[:4]}-{d[4:6]}-{d[6:8]}" for e in doc["vcalendar"][0]["vevent"] for d in e["dtstart"][:1]})
    if not dates:
        raise SystemExit("no holidays found at " + HOLIDAYS + "; data/holidays.json left as it was")
    (DATA / "holidays.json").write_text(json.dumps({"source": HOLIDAYS, "fetched": datetime.date.today().isoformat(), "dates": dates}))
    left = (datetime.date.fromisoformat(dates[-1]) - datetime.date.today()).days
    print(f"public holidays: {len(dates)}, {dates[0]} to {dates[-1]}"
          + (f"  (runs out in {left} days: the government adds next year's around mid-year)" if left < 180 else ""))


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


if "--holidays" in sys.argv:
    holidays()
    sys.exit()
if not check_only:
    holidays()
    meters()
    print("\nOpenStreetMap tags:")
    subprocess.run([sys.executable, "enrich_osm.py"], cwd=HERE, check=True)
staleness()
if not check_only:
    print("\nNext: python3 publish.py")
