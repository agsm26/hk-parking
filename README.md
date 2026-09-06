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
| Operator pages | bundled `data/curated_carparks.json` | tariffs, hours, phone with source URL and check date |

All government endpoints send `Access-Control-Allow-Origin: *`, so the browser
reads them directly. Every request has an 8 s timeout and one retry (60 s for
the meter CSV); failures are kept in a ten-entry log under More ▸ Diagnostics. The last successful payloads are kept in IndexedDB and
shown with their age when offline. A reading older than an hour is "no live
data". Everything is bounded to Hong Kong (`core.js` → `HK`).

Refresh the OpenStreetMap snapshot with the native project's
`Scripts/build_osm_carparks.py` and copy the three JSON files into `data/`.
Rebuild `data/meter_zones.json` with `core.js` → `meterZones()` on a fresh CSV
(see DEPLOY.md). Run `python3 bump.py` before every upload: it stamps `sw.js`
and `app.js` with a new version so phones pick up the change.

## Test locally

```bash
node --test tests/core.test.mjs          # logic (also runs on GitHub on every upload, .github/workflows)
python3 -m http.server 8766              # then open http://localhost:8766/
python3 check_deploy.py                  # after uploading: every file on GitHub, live version
```

Query parameters for QA: `?lat=22.3193&lng=114.1694` fixes the position (skips
GPS; London `?lat=51.5&lng=-0.13` shows the outside-Hong-Kong state),
`?lang=en|tc`, `?tab=map|saved|vehicle|more`, `?cp=<id>` opens a detail.
Geolocation needs https or localhost.

## Publish (free, GitHub Pages)

See DEPLOY.md. Short version: public repo `agsm26/hk-parking`, upload these
files with the GitHub web uploader, enable Pages from `main`, open
`https://agsm26.github.io/hk-parking/` on the phone, Share ▸ Add to Home Screen.

## Licence

Personal, non-commercial use only; see [LICENSE.md](LICENSE.md). OpenStreetMap
files stay under ODbL, Leaflet is BSD, government data follows DATA.GOV.HK terms.

## Limits

- Live counts exist only where the operator publishes; Swire, Wharf and
  Hongkong Land malls are information only.
- Distances are straight-line; there is no routing engine in the browser. The
  list footer and each detail say so.
- The parking reminder fires only while the app is open (iOS gives web apps no
  background timers). Real push reminders would need a small server.
- Favourites and vehicles live in one browser on one phone. More ▸ Backup
  produces a code that Restore reads on another device, or in the Home Screen
  app after saving in Safari.
- Issue reports are saved on the phone and can be sent as a prefilled GitHub
  issue on the repository; nothing is sent automatically.
