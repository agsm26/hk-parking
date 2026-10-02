#!/usr/bin/env python3
"""Stamp a new version: sw.js VERSION and app.js APP_VERSION.

Usage: python3 bump.py            → today's date + next letter (2026-09-06c; after z: za, zb…)
       python3 bump.py 2026-09-07a → exactly this
Phones only pick up an update when the service-worker VERSION changes.
publish.py runs this for you when it publishes; run it yourself only when
uploading by hand with the GitHub web uploader."""
import datetime, pathlib, re, sys
here = pathlib.Path(__file__).parent
sw, app = here / "sw.js", here / "app.js"
m = re.search(r'const VERSION = "([^"]*)";', sw.read_text())
if not m:
    sys.exit('sw.js has no line like const VERSION = "…"; nothing changed')
cur = m.group(1)
if len(sys.argv) > 1:
    new = sys.argv[1]
else:
    today = datetime.date.today().isoformat()
    suffix = cur[len(today):] if cur.startswith(today) and re.fullmatch(r"[a-z]+", cur[len(today):]) else ""
    new = today + (suffix[:-1] + chr(ord(suffix[-1]) + 1) if suffix and suffix[-1] < "z" else suffix + "a")
out = {}
for f, name in ((sw, "VERSION"), (app, "APP_VERSION")):
    text, n = re.subn(rf'const {name} = "[^"]*";', f'const {name} = "{new}";', f.read_text())
    if n != 1:
        sys.exit(f"{f.name}: expected one {name} line, found {n}; nothing changed")
    out[f] = text
for f, text in out.items():
    f.write_text(text)
print(f"{cur} → {new}  (sw.js, app.js)")
