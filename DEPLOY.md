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

## Updating later

1. Copy the changed files from `Project: Park App/web` into the upload page
   (same URL as step 2). Commit.
2. Check https://github.com/agsm26/hk-parking/commits/main shows the new
   commit; a previous project once had uploads silently fail to land.
3. On the phone, open the app twice. The first open downloads the update in the
   background and shows "Update ready"; the second uses it.

Remember to bump `VERSION` in `sw.js` when you change any file, or phones keep
the old copy.

## If something is wrong on the phone

- Blank page: open Safari, go to the address, reload. If still blank, the
  upload is incomplete; compare the file list on GitHub with the folder.
- "Can't reach the parking feed" with Wi-Fi on: the government feed hiccups
  occasionally. Pull down to refresh, or wait a minute.
- No location: iPhone Settings ▸ Privacy & Security ▸ Location Services ▸
  Safari Websites ▸ While Using. Home Screen web apps use Safari's permission.
