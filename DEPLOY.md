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

## One-time setup (done in September 2026; kept for reference)

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

Edit the files in this Google Drive folder (`Project: Park App/web`), from
either account. Then, in Terminal, in the `web` folder (on the hangylab Mac
that is `cd ~/Biefu_LAB/"Project: Park App"/web`):

```bash
python3 publish.py
```

It first waits until Google Drive has finished downloading this folder (the
other account's saves often take a minute to arrive), compares the folder with
GitHub, lists what it is about to do, and asks before doing it:

- **Changed here:** published to GitHub. If the app's own files changed, it
  stamps a new version so phones update (it runs `bump.py`, so you no longer
  have to).
- **Changed on GitHub** (pushed from another computer, or by Claude): copied
  into this folder first. The old copy is saved in `~/.hk-parking-publish-backups`.
- **Changed in both places:** it stops and changes nothing. Look at
  https://github.com/agsm26/hk-parking/commits/main, decide which copy wins,
  and run again with `--prefer drive` (keep this folder's) or `--prefer github`.
- **An earlier version here** of a file that has since changed on GitHub (for
  example after undoing a change): it stops and asks which one you want. It
  prints the exact command for each choice: `--keep-older` publishes the earlier
  version, `--prefer github` brings GitHub's version back into this folder.

Before publishing, it also waits until Google Drive has uploaded the files it is
about to publish, so the other account already has them when GitHub does.

Then on the phone, open the app twice. The first open downloads the update in
the background and shows "Update ready"; the second uses it. The tests run on
GitHub after every publish (Actions tab); a red cross means the change broke
something.

`python3 publish.py --check` only shows what differs and changes nothing.
`-m "what changed"` puts your own description on GitHub. Every few months run
`python3 refresh_data.py` first: it rebuilds the meter and OpenStreetMap data
and lists the operator facts that need re-reading (`enrich_osm.py` can also be
run on its own if you already have an Overpass dump).

`publish.py` keeps its own Git copy of the repository at `~/.hk-parking-publish`.
Never edit there; it is reset to match GitHub on every run. The hidden
`.publish-base` file next to `publish.py` records the GitHub version this folder
last matched; leave it alone. Only one `publish.py` runs at a time on a Mac.

## Publishing from another Mac (once per Mac)

1. Google Drive for desktop must be running and signed in to an account that
   has this folder. In its Settings, turn on starting at login. In Finder,
   right-click `Project: Park App` and make it available offline, so the files
   are on the Mac rather than fetched on demand.
2. Create an SSH key and give GitHub its public half (in the browser, signed in
   as agsm26):

   ```bash
   [ -f ~/.ssh/id_ed25519.pub ] || { mkdir -p -m 700 ~/.ssh && ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519; }
   pbcopy < ~/.ssh/id_ed25519.pub
   ```

   (The first line creates a key only if the Mac has none yet.) Open
   https://github.com/settings/ssh/new, title it with the Mac's name,
   paste into **Key**, click **Add SSH key**. `ssh -T git@github.com` should
   then answer "Hi agsm26!". The key lets that Mac publish to
   every agsm26 repository; delete it on https://github.com/settings/keys if
   the Mac is lost or sold.
3. `python3 publish.py --check` (the first run downloads the repository), then
   `python3 publish.py` as above.

## If publish.py stops

- "Could not read … from Google Drive": Google Drive is not running or has not
  downloaded the folder. Open Google Drive from Applications, wait for it to
  sync, run again.
- "GitHub did not accept this Mac's SSH key": do step 2 of the section above.
- "changed both here and on GitHub": see **Changed in both places** above.
- "an earlier version of these files": see **An earlier version here** above.
- "Google Drive is still downloading", "bringing in a newer version" or "hasn't
  finished uploading": Drive is behind (offline, paused, or busy). Check its
  menu-bar icon, wait until it says it is up to date, then run again.
- "Could not ask Google Drive whether this folder is in sync": Google Drive is
  not running (or still starting). Open it from Applications and run again.
- "GitHub no longer has these files, but this folder still has them": usually
  the other account removed them and Drive hasn't removed them here yet. Wait
  a minute; the message also prints the command for removing them now.
- "Google Drive reports a clash": both accounts changed the same file before
  Drive could sync them. Open Google Drive from the menu bar, keep the right
  version, then run again.
- "already running on this Mac": another Terminal window is running it; let
  that one finish.
- "copies Google Drive made": a file like `core (1).js` appeared because two
  edits clashed. Keep what you need in the real file and delete the copy.
- "on GitHub but not in this folder": usually Google Drive has not finished
  syncing. Wait a minute and run again. Use `--allow-deletes` only if you
  really removed those files.
- "Someone published to GitHub at the same moment": run it again; it brings
  their change in first, then publishes yours.
- "hidden Git copy … is damaged": run the `rm -rf ~/.hk-parking-publish` it
  shows. That folder is only a working copy; nothing of yours is in it.

## The web uploader (fallback only)

If `publish.py` cannot be used, the old routine still works: `python3 bump.py`,
then upload the changed files at https://github.com/agsm26/hk-parking/upload/main
(files in a folder go to `.../upload/main/<folder>`; `.github/workflows` files
through `.../upload/main/.github/workflows`), commit, wait for the repository
page, then `python3 check_deploy.py`. Upload only the files you changed, and
**never** `data/patterns/`: GitHub's copy is newer than this folder's, and
uploading it would overwrite the hourly history.

Learned 5 Sep 2026: dragging files and folders together made GitHub silently
drop the folders. Upload each folder on its own page instead:
`.../upload/main/data`, `.../upload/main/icons`, `.../upload/main/tests`,
`.../upload/main/vendor`, `.../upload/main/vendor/images` (the path in the URL
creates the folder). Wait until every file name is listed, scroll down, click
**Commit changes**, and wait for the repository page to appear before opening
the next upload page; leaving early loses the commit.

## The hourly history job

`.github/workflows/patterns.yml` commits to `data/patterns/` every hour by
itself. Two things follow from that:

- **Never delete `data/patterns/`** on GitHub. `publish.py` and
  `check_deploy.py` leave that folder alone on purpose, because GitHub is meant
  to be ahead of your copy there; run `python3 check_deploy.py --patterns` if
  you ever want to compare it.
- If you have not touched the repository for two months, GitHub emails you to
  say scheduled workflows are about to pause. Open
  https://github.com/agsm26/hk-parking/actions/workflows/patterns.yml and click
  **Run workflow**, or just publish any change, and it carries on.

To check it is alive: that same page should show a green run within the last
hour, and `data/patterns/index.json` should list a growing number of hours (72
once a full week has been seen).

## If something is wrong on the phone

- Blank page: open Safari, go to the address, reload. If still blank, run
  `python3 check_deploy.py`, which lists anything missing on GitHub.
- "Can't reach the parking feed" with Wi-Fi on: the government feed hiccups
  occasionally. Pull down to refresh, or wait a minute.
- No location: iPhone Settings ▸ Privacy & Security ▸ Location Services ▸
  Safari Websites ▸ While Using. Home Screen web apps use Safari's permission.
