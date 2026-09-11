#!/usr/bin/env python3
"""After uploading, confirm GitHub has every file with the right size.

Usage: python3 check_deploy.py [owner/repo]   (default agsm26/hk-parking)
Compares this folder with the repository tree on the main branch, then probes
the live Pages address for the service-worker version. Exit code 1 on any gap."""
import json, os, pathlib, sys, urllib.request
repo = next((a for a in sys.argv[1:] if not a.startswith("-")), "agsm26/hk-parking")
here = pathlib.Path(__file__).parent
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "check_deploy", "Cache-Control": "no-cache"}), timeout=30) as r: return r.read()
tree = json.loads(get(f"https://api.github.com/repos/{repo}/git/trees/main?recursive=1"))["tree"]
remote = {t["path"]: t["size"] for t in tree if t["type"] == "blob"}
local = {}
for p in here.rglob("*"):
    if p.is_file() and not any(part.startswith(".") and part != ".github" for part in p.relative_to(here).parts) and "__pycache__" not in p.parts:
        local[p.relative_to(here).as_posix()] = p.stat().st_size
# data/patterns is written hourly by the patterns workflow, so GitHub is
# expected to be ahead of this folder there. Pass --patterns to compare it too.
if "--patterns" not in sys.argv:
    local = {k: v for k, v in local.items() if not k.startswith("data/patterns/")}
    remote = {k: v for k, v in remote.items() if not k.startswith("data/patterns/")}
missing = sorted(k for k in local if k not in remote)
differ = sorted(k for k in local if k in remote and local[k] != remote[k])
extra = sorted(k for k in remote if k not in local)
print(f"local {len(local)} files, GitHub {len(remote)} files")
for k in missing: print("  MISSING on GitHub:", k)
for k in differ: print(f"  SIZE DIFFERS: {k} local {local[k]} GitHub {remote[k]}")
for k in extra: print("  only on GitHub:", k)
owner, name = repo.split("/")
try:
    live = get(f"https://{owner}.github.io/{name}/sw.js").decode()
    import re; print("live sw.js VERSION:", re.search(r'VERSION = "([^"]+)"', live).group(1), "| local:", re.search(r'VERSION = "([^"]+)"', (here / "sw.js").read_text()).group(1))
except Exception as e: print("live site not reachable:", e)
sys.exit(1 if (missing or differ) else 0)
