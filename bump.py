#!/usr/bin/env python3
"""Stamp a new version before uploading: sw.js VERSION and app.js APP_VERSION.

Usage: python3 bump.py            → today's date + next letter (2026-09-06c)
       python3 bump.py 2026-09-07a → exactly this
Phones only pick up an update when the service-worker VERSION changes, so run
this after every edit to any file in this folder."""
import datetime, pathlib, re, sys
here = pathlib.Path(__file__).parent
sw, app = here / "sw.js", here / "app.js"
cur = re.search(r'const VERSION = "([^"]+)";', sw.read_text()).group(1)
if len(sys.argv) > 1:
    new = sys.argv[1]
else:
    today = datetime.date.today().isoformat()
    letter = chr(ord(cur[-1]) + 1) if cur.startswith(today) and cur[-1].isalpha() else "a"
    new = today + letter
sw.write_text(re.sub(r'const VERSION = "[^"]+";', f'const VERSION = "{new}";', sw.read_text()))
app.write_text(re.sub(r'const APP_VERSION = "[^"]+";', f'const APP_VERSION = "{new}";', app.read_text()))
print(f"{cur} → {new}  (sw.js, app.js)")
