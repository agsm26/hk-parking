# Putting 搵車位 on your phones, free, permanently

The app is static files. GitHub Pages hosts them for free at an https address,
which is all a Home Screen web app needs. No Apple account, no renewal, and it
works on Android too. Your bus app already lives this way at
`agsm26.github.io/hk-bus-planner`, so this is the same routine.

The repository has to be **public**: free GitHub Pages does not serve private
repos. That is fine here. There is nothing personal in these files; favourites
and vehicles are stored on the phone, never in the code. `LICENSE.md` tells
visitors it is for personal use only, not commercial use; GitHub shows it on the
repository front page next to the README.

## One-time setup (about 10 minutes, in Chrome, logged in as agsm26)

1. Go to https://github.com/new. Repository name `hk-parking`. Public. Tick
   "Add a README file". Create repository.
2. Go to https://github.com/agsm26/hk-parking/upload/main. In Finder open
   `Project: Park App/web` and drag **everything** into the upload box: the
   files (`index.html`, `app.js`, `core.js`, `sw.js`, `manifest.json`,
   `README.md`, `DEPLOY.md`, `LICENSE.md`, `make-icons.py`) and the folders (`data`,
   `icons`, `vendor`, `tests`). Folders upload with their contents. Scroll down
   and click **Commit changes**.
3. Go to https://github.com/agsm26/hk-parking/settings/pages. Under "Build and
   deployment" set Source to **Deploy from a branch**, Branch **main**, folder
   **/ (root)**. Save.
4. Wait a minute, then open https://agsm26.github.io/hk-parking/ in Safari on
   the iPhone. Check that the list loads with live counts.
5. Add to Home Screen: tap the **Share** button, then **Add to Home Screen**,
   then **Add**. On Android Chrome: menu ▸ **Install app**.

Open it from the Home Screen from now on. It runs full screen, remembers your
vehicle and favourites, and keeps working offline with the last data.

## Folders and the web uploader (learned 5 Sep 2026)

Dragging files and folders together made GitHub silently drop the folders.
Upload each folder on its own page instead: `.../upload/main/data`,
`.../upload/main/icons`, `.../upload/main/tests`, `.../upload/main/vendor`,
`.../upload/main/vendor/images` (the path in the URL creates the folder).
Wait until every file name is listed, scroll down, click **Commit changes**,
and wait for the repository page to appear before opening the next upload
page; leaving early loses the commit.

## Updating later

1. In Terminal, in the `web` folder: `python3 bump.py` (stamps a new version
   into `sw.js` and `app.js`; without it phones keep the old copy) and
   `node --test tests/core.test.mjs` (must say fail 0).
2. Upload the changed files at https://github.com/agsm26/hk-parking/upload/main
   (files in a folder go to `.../upload/main/<folder>`). Commit, wait for the
   repository page.
3. `python3 check_deploy.py` — lists anything missing or different on GitHub
   and shows the live version. The tests also run on GitHub automatically
   (Actions tab); a red cross means the upload broke something.
4. On the phone, open the app twice. The first open downloads the update in the
   background and shows "Update ready"; the second uses it.

The `.github/workflows/test.yml` file uploads through
`.../upload/main/.github/workflows`. To refresh the meter snapshot
(`data/meter_zones.json`, do it every few months): download
`https://resource.data.one.gov.hk/td/psiparkingspaces/spaceinfo/parkingspaces.csv`
into the folder as `_meters.csv`, then run
`node -e 'import("./core.js").then(C=>{const fs=require("fs");const m=C.meterZones(fs.readFileSync("_meters.csv","utf8"));fs.writeFileSync("data/meter_zones.json",JSON.stringify({at:Date.now(),zones:m.zones,index:m.index}))})'`
and delete `_meters.csv`.

## If something is wrong on the phone

- Blank page: open Safari, go to the address, reload. If still blank, the
  upload is incomplete; compare the file list on GitHub with the folder.
- "Can't reach the parking feed" with Wi-Fi on: the government feed hiccups
  occasionally. Pull down to refresh, or wait a minute.
- No location: iPhone Settings ▸ Privacy & Security ▸ Location Services ▸
  Safari Websites ▸ While Using. Home Screen web apps use Safari's permission.
