# 搵車位 · Car Park HK (web app)

> **Personal use only.** You are welcome to install this on your own phone and
> tinker with it. Commercial use of any kind (selling it, running it as a
> service, using it to promote a business) is not permitted without written
> permission. See [LICENSE.md](LICENSE.md). Data shown comes from third parties
> and may be wrong; always check the signs at the car park.

A Home Screen web app for finding a Hong Kong car park with spaces right now.
Installs on iPhone and Android from the browser, never expires, needs no
account and costs nothing to run: it is static files on GitHub Pages reading
public feeds directly.

It is the web version of the native iOS app in `../LookingForCarPark`. The
logic (`core.js`) is a line-for-line port of that app's tested Swift core, and
its data snapshots (`data/`) are the same files.

```
index.html      shell + styles          app.js   screen logic (fetch, store, draw)
core.js         all decisions, unit-tested with `node --test tests/core.test.mjs`
sw.js           offline shell + data    manifest.json / icons/   Home Screen install
data/           osm_carparks.json, osm_entrances.json, curated_carparks.json
vendor/         Leaflet 1.9.4 (BSD), self-hosted so nothing loads from a CDN
make-icons.py   redraws the icons (pure Python, no dependencies)
```

## Data

| Source | Endpoint | Used for |
|---|---|---|
| Transport Department one-stop feed | `api.data.gov.hk/v1/carpark-info-vacancy` (`data=info` in en_US and zh_TW every 6 h; `data=vacancy` every 60 s while open) | live spaces per vehicle class |
| Transport Department meters | `resource.data.one.gov.hk/td/psiparkingspaces/…` (bays daily, occupancy every 2 min) | on-street meter sections |
| Lands Department basemap (CSDI portal) | `mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/...` and `label/hk/{tc,en}` tiles | the map (free government service; OpenStreetMap tiles as automatic fallback) |
| Address Lookup Service (OGCIO) | `www.als.gov.hk/lookup?q=…` | place search by building, estate or street name, Chinese or English (Nominatim as fallback) |
| OpenStreetMap (ODbL) | bundled `data/osm_carparks.json`, `osm_entrances.json`; Nominatim fallback | every other car park and mall car park, vehicle entrances |
| Transport Department meters, pre-built | bundled `data/meter_zones.json` (1.7 MB, from the 4.8 MB CSV) | first open is fast; the CSV itself is re-read once a week |
| Operator pages | bundled `data/curated_carparks.json` | tariffs, hours, phone with source URL and check date (17 car parks) |
| 1823 holiday calendar | `www.1823.gov.hk/common/ical/en.json`, bundled as `data/holidays.json` | public holidays, for opening hours and rates that differ on them (`refresh_data.py --holidays`) |
| District boundaries (OpenStreetMap) | via `enrich_osm.py`: a district for every OpenStreetMap car park, and `data/district_fixes.json` | the district filter; corrects the few feed car parks filed under the wrong district |

All government endpoints send `Access-Control-Allow-Origin: *`, so the browser
reads them directly. Every request has an 8 s timeout and one retry (60 s for
the meter CSV); failures are kept in a ten-entry log under More ▸ Diagnostics. The last successful payloads are kept in IndexedDB and
shown with their age when offline. A reading older than an hour is "no live
data". Everything is bounded to Hong Kong (`core.js` → `HK`).

Refresh everything with one command, every few months:

```bash
python3 refresh_data.py       # meters + OpenStreetMap tags, then a staleness report
python3 refresh_data.py --check   # report only
```

`refresh_data.py` rebuilds `data/meter_zones.json` from the Transport Department
CSV and re-reads height, capacity, hours and operator tags from OpenStreetMap
(`enrich_osm.py`), then lists the operator facts older than 180 days so you know
which pages to re-read by hand. It never edits `curated_carparks.json`: those
figures are copied from operator pages by a person, with the URL and date.

To rebuild the OpenStreetMap car park list itself (new car parks, not just new
tags), run the native project's `Scripts/build_osm_carparks.py` and copy the
three JSON files into `data/`, then run `refresh_data.py` again.

Phones only pick up a change when `sw.js` and `app.js` carry a new version.
`publish.py` stamps one for you (it runs `bump.py`) whenever it publishes a file
the app loads; run `python3 bump.py` yourself only when uploading by hand.

## Typical availability

Nobody records what the parking feeds say minute to minute, so a count of 14
tells you nothing about whether 14 is normal for a Friday evening.
`.github/workflows/patterns.yml` runs `collect_patterns.mjs` twice an hour: it
samples every place that publishes a private-car reading (about 1,600 — 474 car
parks and 1,112 metered sections) and folds each into one bucket of day type ×
hour of day.

```
data/patterns/index.json     ordered ids + which of the 72 hours exist yet
data/patterns/<0-2>-<hh>.json  three bytes per id, base64: typical free, % tight, samples
```

The layout is positional so one hourly sample rewrites one ~7 KB file rather
than the whole history — about 150–300 KB of repository growth a day. A bucket with
fewer than three readings says nothing, and a car park with no live feed never
gets a pattern at all, so the app stays silent rather than guessing. Buckets are
a rolling average over the last 60 samples, so a car park that changes its
habits is followed rather than frozen.

Each car park's page shows a "Typical day" chart built from these slices:
typical free spaces for every hour of weekdays, Saturdays or Sundays, with
the easiest and hardest hours named. Its 24 slices are fetched when a page
first needs them; hours with fewer than three readings stay empty.

Run it by hand with `node collect_patterns.mjs --dry` (reports, writes nothing).
GitHub disables a scheduled workflow after 60 days without any commit to the
repository. The job's own commits count, so it only stops if it stops
committing; its last step turns the run red (and GitHub emails agsm26) after 3
days without a commit, long before that. If it is ever disabled: Actions tab ▸
patterns ▸ **Enable workflow**.

## Cost for your stay

Sorting by Cheapest asks how long you'll stay (1, 2, 3, 4 or 8 hours) and
ranks by what that stay costs from now; each car park's page shows the same
for every length. `stayCost` in `core.js` charges each started unit at the rate
in force when it starts (time of day, weekday or public holiday, and how long
you've been parked, for "first two hours $11 per half hour, then $16.5"), adds
any minimum charge, and takes a day, night or 24-hour flat rate instead when
the whole stay fits inside one. Meters charge per 15 minutes, are free outside
their hours, and a stay longer than the meter allows is shown as such and
sorted last.

Only 27 feed car parks publish structured prices; for the others `readTariff`
reads the operator's price text (the Transport Department, LCSD and estate
templates, in English or Chinese). It reads only private-car prices, leaves out
monthly, valet and EV-concession rates, and gives up rather than guess when a
car price can't be placed. Where a text lists several prices for the same
hours (one text for several car parks) it takes the dearest, so totals err
high. Totals read from text show as "about"; mixtures such as a day park and
then hours after it aren't tried. In October 2026 this covered 254 text
tariffs; 4 had no private-car price and 165 OpenStreetMap car parks say only
"paid parking".

## Assistant (💬)

The chat button on every tab (and More ▸ Ask or report) opens an assistant
that answers plain questions about a car park and takes error reports. There
is no model and no server behind it: `chatIntents` in `core.js` reads the
message for what is asked (fees, height limit, hours, EV charging, spaces now,
typical hour, nearest spaces, or one of twenty questions about the app) in
English or Cantonese, `chatPickCarPark` finds the car park named (one clear
winner, or a short list to choose from, never a guess), and `chatFacts`
composes the answer from the record already on the phone, so it works offline.
A question without a name is taken to be about the car park last discussed or
the one open on screen. An error report walks through which car park, what is
wrong, details and confirm, then is saved under More ▸ My issue reports and,
if the user chooses, opened as the usual prefilled GitHub issue (label `bug`;
unanswered questions go the same way with label `question`). The detail
sheet's Report button starts the same flow with the car park filled in.

## Test locally

```bash
node --test tests/core.test.mjs          # logic (also runs on GitHub after every publish, .github/workflows)
python3 -m http.server 8766              # then open http://localhost:8766/
python3 publish.py --check               # what differs between this folder and GitHub (changes nothing)
python3 check_deploy.py                  # every file on GitHub, live version
node collect_patterns.mjs --dry          # what the hourly history job would record
```

Query parameters for QA: `?lat=22.3193&lng=114.1694` fixes the position (skips
GPS; London `?lat=51.5&lng=-0.13` shows the outside-Hong-Kong state),
`?lang=en|tc`, `?tab=map|saved|vehicle|more`, `?cp=<id>` opens a detail.
Geolocation needs https or localhost.

## Publish (free, GitHub Pages)

See DEPLOY.md. Short version: public repo `agsm26/hk-parking`, Pages from
`main`, `https://agsm26.github.io/hk-parking/` on the phone, Share ▸ Add to Home
Screen. This Google Drive folder is where both accounts edit; `python3
publish.py` publishes it to GitHub and brings back anything pushed to GitHub
from elsewhere, so the two never drift apart.

## Licence

Personal, non-commercial use only; see [LICENSE.md](LICENSE.md). OpenStreetMap
files stay under ODbL, Leaflet is BSD, government data follows DATA.GOV.HK terms.

## Limits

- Live counts exist only where the operator publishes; Swire, Wharf and
  Hongkong Land malls are information only.
- The feed's open/closed flag is fixed, not "right now": in October 2026 it
  said CLOSED for 212 of 581 car parks all day (Airport Car Park 1, apm, MOKO)
  while their counts kept moving. The app reads CLOSED as "hours not
  confirmed"; only OPEN and published opening hours decide open or shut.
- Filters never hide parking silently: Malls narrows the car parks but leaves
  street meters to the Meters tile, a district chosen in search lasts only for
  that search, and when filters hide spaces much nearer than anything shown
  (over 500 m away) the Find screen says which filters and offers to show them.
- Distances are straight-line; there is no routing engine in the browser. The
  list footer and each detail say so.
- The parking reminder fires only while the app is open (iOS gives web apps no
  background timers). Real push reminders would need a small server.
- Where you park is remembered on the device (a small count per car park) and
  nudges the ranking; it is recorded only when you start a parking session.
- After you tap Navigate, the app offers to start the session if the phone
  reaches that car park while the app is open. It asks once, then forgets.
- Favourites and vehicles live in one browser on one phone. More ▸ Backup
  produces a code that Restore reads on another device, or in the Home Screen
  app after saving in Safari.
- Issue reports and questions are saved on the phone and can be sent as a
  prefilled GitHub issue on the repository; nothing is sent automatically. The
  assistant answers only from the data on the phone; it is not a language model.
