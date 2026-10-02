#!/usr/bin/env python3
"""Publish this folder to GitHub, and bring back anything newer from GitHub.

Usage: python3 publish.py                 show what differs, ask, then sync and publish
       python3 publish.py --check         only show what differs; change nothing
       python3 publish.py -m "message"    say what changed (shown on GitHub)
       python3 publish.py --yes           don't ask before going ahead
       python3 publish.py --prefer drive  settle files changed in both places by keeping
                                          this folder's copy (--prefer github takes GitHub's)
       python3 publish.py --keep-older    publish this folder's earlier version of a file
                                          (after undoing a change on purpose)
       python3 publish.py --allow-deletes allow removing files from GitHub, or more than
                                          3 files here

This folder (in Google Drive, shared by both accounts) is where you edit. The
live app is served from GitHub (agsm26/hk-parking). The script keeps its own
Git copy at ~/.hk-parking-publish (never edit there) and compares three
versions of every file: this folder, GitHub now, and both as they were the last
time they matched (the commit named in .publish-base, kept in this folder).

  changed only here       → published to GitHub
  changed only on GitHub  → copied into this folder (pushed from another computer)
  changed in both places  → nothing happens; it lists the files and stops
  an earlier version here → nothing happens until you say which version you want

It first waits until Google Drive has finished downloading this folder, and
before publishing it waits until Drive has uploaded the files it publishes, so
the other account always has a file before the record that it was published.
When files the phones load are published, sw.js and app.js get a new version
stamp (bump.py) so phones update; this folder receives the stamp only once
GitHub has accepted the publish, and a stamp alone never counts as a change.
data/patterns/ is GitHub's own hourly history and is never touched. Anything
replaced or removed here is first copied to ~/.hk-parking-publish-backups.
Checking works without signing in; publishing needs this Mac's SSH key on the
agsm26 GitHub account (DEPLOY.md, "Publishing from another Mac")."""
import argparse, datetime, fcntl, hashlib, json, os, pathlib, re, shlex, shutil, subprocess, sys, time, unicodedata

REPO = "agsm26/hk-parking"
FETCH_URL = f"https://github.com/{REPO}.git"          # public: reading needs no sign-in
PUSH_URL = f"git@github.com:{REPO}.git"               # writing uses this Mac's SSH key
AUTHOR = ("agsm26", "306416957+agsm26@users.noreply.github.com")
HERE = pathlib.Path(__file__).resolve().parent
BASE_FILE = HERE / ".publish-base"
NEEDED = ["index.html", "app.js", "core.js", "sw.js", "manifest.json"]   # without these it is not the app
STAMPED = ("sw.js", "app.js")                                             # bump.py writes a version into these
STAMP_LINE = re.compile(rb'const (?:APP_)?VERSION = "[^"]*";')
NOT_SERVED = re.compile(r"(README|DEPLOY|LICENSE)\.md$|[^/]+\.py$|collect_patterns\.mjs$|tests/|\.github/")
DRIVE_COPY = re.compile(r" \(\d+\)(\.[^/]*)?$")       # "core (1).js": how Google Drive names a clashing copy
MAX_DELETES = 3
SSH_KEYS = ["id_ed25519", "id_ecdsa", "id_rsa"]
NETWORK = ("Could not resolve host", "unable to access", "Failed to connect", "Could not resolve hostname",
           "timed out", "Network is unreachable", "Connection refused", "Connection reset")
NO_SHA = "0" * 40
# What Google Drive reports about a file that is fully in step with the cloud.
SYNCED = {"isDownloaded": True, "isDownloading": False, "isMostRecentVersionDownloaded": True,
          "isUploaded": True, "isUploading": False, "hasUnresolvedConflicts": False}


class Stop(Exception):
    """A reason to stop that the person running this should read."""


def nfc(s):
    return unicodedata.normalize("NFC", s)


def tracked(rel):
    """Paths that take part in publishing (check_deploy.py looks at nearly the same set)."""
    parts, low = rel.split("/"), rel.casefold()
    return not (any(p.startswith(".") and p != ".github" for p in parts) or "__pycache__" in parts
                or rel.endswith(".pyc") or parts[-1] == "Icon\r"
                or low == "data/patterns" or low.startswith("data/patterns/"))


def blob_id(data):
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()   # what Git calls this content


def restamp(data, version):
    """Content with every version stamp set to version ("" blanks it, so a stamp alone is not a change)."""
    return STAMP_LINE.sub(lambda m: m.group(0).split(b"=")[0] + b'= "' + version.encode() + b'";', data)


def version_of(data):
    m = re.search(rb'const VERSION = "([^"]+)";', data)
    return m.group(1).decode() if m else None


def after(v):
    return v[:-1] + chr(ord(v[-1]) + 1) if v[-1].isalpha() and v[-1] < "z" else v + "a"


def short(paths, n=6):
    return ", ".join(paths[:n]) + (f" and {len(paths) - n} more" if len(paths) > n else "")


def again(*extra):
    """The command to run next: this one (without --check) plus extra, e.g. again("--prefer github")."""
    names, out, skip = {e.split()[0] for e in extra}, [], False
    for a in sys.argv[1:]:
        if skip:
            skip = False
            continue
        name = a.split("=", 1)[0]
        if name == "--check" or name in names:
            skip = name == "--prefer" and "=" not in a
            continue
        out.append(a)
    return f"python3 {shlex.quote(sys.argv[0])} " + " ".join(shlex.quote(w) for w in out + [w for e in extra for w in e.split()])


# Google Drive ---------------------------------------------------------------------------------

def drive_state(rel):
    """What Google Drive reports about a path here (keys of SYNCED), or None when it can't say."""
    fake = os.environ.get("HK_PUBLISH_FAKE_DRIVE")    # tests: JSON {"path": {flag: 0 or 1}, "*": {...}}
    if fake:
        try:
            table = json.loads(pathlib.Path(fake).read_text())
        except (OSError, ValueError):
            return None
        entry = table.get(rel, table.get("*"))
        return None if entry is None else {k: bool(entry.get(k, v)) for k, v in SYNCED.items()}
    try:
        r = subprocess.run(["fileproviderctl", "evaluate", str(HERE / rel)], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    found = {k: re.search(rf"^\s+{k} = ([01]);", r.stdout, re.M) for k in SYNCED}
    if r.returncode or not found["isDownloaded"]:
        return None
    return {k: (m.group(1) == "1") if m else SYNCED[k] for k, m in found.items()}


DRIVE = False                                 # set in main(): is this folder in Google Drive?


def drive_ready(rel):
    """False while Google Drive is bringing in a newer cloud version of this file (or reports a clash):
    writing it then would land on an outdated copy."""
    s = drive_state(rel) if DRIVE else None
    return not (s and (arriving(s) or (s["hasUnresolvedConflicts"] and rel != ".publish-base")))


def arriving(s):
    return not s["isDownloaded"] or s["isDownloading"] or not s["isMostRecentVersionDownloaded"]


def leaving(s):
    return not s["isUploaded"] or s["isUploading"]


def wait_for_drive(paths, still, doing, limit):
    """Wait until Google Drive no longer reports still() for these paths; return those it still does."""
    deadline, said = time.time() + limit, False
    while True:
        paths = [p for p in paths if (lambda s: s is not None and still(s))(drive_state(p))]
        if not paths or time.time() >= deadline:
            return paths
        if not said:
            print(f"Waiting for Google Drive to finish {doing}: {short(paths)}…", flush=True)
            said = True
        time.sleep(2)


def wait_for_downloads(here, args):
    """Google Drive often learns of the other account's saves a minute before it fetches them.
    Comparing in between would take the old copies here for edits, so wait, then read again.
    Returns the folder as read again, and what Drive is still downloading (with --check)."""
    paths = sorted(here) + ([".publish-base"] if BASE_FILE.exists() else [])
    states = {p: drive_state(p) for p in paths}
    # .publish-base is checked against GitHub whenever it is read, so a clash there needs no person.
    clash = [p for p, s in states.items() if s and s["hasUnresolvedConflicts"] and p != ".publish-base"]
    if clash:
        raise Stop(f"Google Drive reports a clash between this Mac's copy and the cloud copy of: {short(clash)}.\n"
                   "Open Google Drive from the menu bar and settle it, then run again. Nothing was changed.")
    pending = [p for p, s in states.items() if s and arriving(s)]
    if not pending:
        return here, []
    pending = wait_for_drive(pending, arriving, "downloading", args.drive_wait)
    if pending and not args.check:
        raise Stop(f"Google Drive is still downloading: {short(pending)}.\nNothing was changed. Run again once "
                   "the Google Drive icon in the menu bar shows everything is up to date.")
    if pending:
        print(f"Note: Google Drive is still downloading {short(pending)}, so this may be out of date.")
    return scan_folder(), pending


def wait_for_uploads(paths, args, doing):
    """Wait until Google Drive has uploaded these files; return any it hasn't."""
    paths = [p for p in paths if (HERE / p).is_file()]
    if not paths:
        return []
    age = time.time() - max((HERE / p).stat().st_mtime for p in paths)
    fresh = args.drive_settle - max(0.0, age)
    if fresh > 0:
        time.sleep(fresh)            # Drive notices a save only after a moment
    return wait_for_drive(paths, leaving, doing, args.drive_wait)


# This folder -----------------------------------------------------------------------------------

def scan_folder():
    """Every tracked file here → (blob id, bytes). Any read error stops the run, so a
    file Google Drive cannot deliver never looks like a deleted one."""
    found = {}
    def walk(d):
        with os.scandir(d) as it:
            entries = sorted(it, key=lambda e: e.name)
        for e in entries:
            # APFS may hand back decomposed accents; Git keeps what it was given, so use one form.
            rel = nfc(pathlib.Path(e.path).relative_to(HERE).as_posix())
            if e.is_symlink():
                if tracked(rel): raise Stop(f"{rel} is a shortcut (symlink); publish.py only handles real files.")
            elif e.is_dir():
                if tracked(rel + "/_"): walk(e.path)
            elif tracked(rel):
                data = pathlib.Path(e.path).read_bytes()
                found[rel] = (blob_id(data), data)
    try:
        walk(HERE)
    except OSError as e:
        raise Stop(f"Could not read {e.filename or 'a file'} from Google Drive ({e.strerror or e}).\n"
                   "Make sure Google Drive is running and this folder is available offline, then run again.")
    missing = [p for p in NEEDED if p not in found]
    if missing:
        raise Stop(f"This folder looks incomplete (no {', '.join(missing)}). Nothing was changed.")
    return found


def current(rel):
    """This folder's file under exactly this name, as it is right now (None if absent).
    APFS ignores upper/lower case, so every part of the name is checked against the real listing."""
    f = HERE
    try:
        for part in rel.split("/"):
            if not f.is_dir() or nfc(part) not in {nfc(n) for n in os.listdir(f)}:
                return None
            f = f / part
        return blob_id(f.read_bytes()) if f.is_file() else None
    except OSError as e:
        raise Stop(f"Could not read {rel} from Google Drive ({e.strerror or e}). Run again.")


def unchanged(rel, expected):
    if current(rel) != expected:
        raise Stop(f"{rel} changed in this folder while publish.py was running (is someone editing?).\n"
                   "Stopped there; run publish.py again.")


def backup(rel, stamp):
    """Copy this folder's file aside before it is replaced. The first copy in a run wins."""
    src, dst = HERE / rel, BACKUPS / stamp / rel
    if src.is_file() and not dst.exists():
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    return dst.exists()


def remove_empty_parents(path):
    for d in path.parents:
        if d == HERE or HERE not in d.parents:
            break
        try:
            d.rmdir()
        except OSError:
            break


def read_base(head):
    """The last commit this folder and GitHub matched, or None if unknown. A publish
    that reached GitHub but was cut off before the record was finished still counts."""
    try:
        lines = [l.split() for l in BASE_FILE.read_text().splitlines() if l.strip() and not l.startswith("#")]
    except OSError:
        return None
    pending = [l[1] for l in lines[1:] if len(l) == 2 and l[0] == "pending"]
    for c in pending + ([lines[0][0]] if lines else []):
        if re.fullmatch(r"[0-9a-f]{40}", c) and git_ok("cat-file", "-e", c + "^{commit}") \
                and git_ok("merge-base", "--is-ancestor", c, head):
            return c
    return None


def write_base(commit, pending=None, strict=True):
    """Record the last match. A newer record that Google Drive is bringing in from the other account
    is never overwritten: then this stops (strict) or just says so."""
    if not drive_ready(".publish-base"):
        if strict:
            raise Stop("Google Drive is bringing in a newer .publish-base from the other account. Run again in a minute.")
        print("Note: Google Drive is bringing in a newer .publish-base, so this run's record was not saved; "
              "the next run sorts it out.")
        return
    text = f"{commit or 'none'}\n" + (f"pending {pending}\n" if pending else "")
    try:
        BASE_FILE.write_text(text + "# Written by publish.py: the GitHub commit this folder last matched. Do not edit.\n")
    except OSError as e:
        raise Stop(f"Could not save .publish-base in Google Drive ({e.strerror or e}). Run again.")


# The hidden Git copy --------------------------------------------------------------------------

def git_env(pinned=True):
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_LITERAL_PATHSPECS="1",
               GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_NOSYSTEM="1",   # no line-ending or ignore surprises
               GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new")
    if pinned:   # never let git wander into an enclosing repository if the hidden copy is damaged
        env.update(GIT_DIR=str(CLONE.resolve() / ".git"), GIT_WORK_TREE=str(CLONE.resolve()))
    return env


def git_run(*args, check=True, binary=False):
    r = subprocess.run(["git", "-C", str(CLONE), *args], capture_output=True, text=not binary, env=git_env())
    if check and r.returncode:
        err = r.stderr.decode(errors="replace") if binary else r.stderr
        raise Stop(f"git {' '.join(args)} failed:\n{err.strip()}")
    return r


def git(*args):
    return git_run(*args).stdout.strip()


def git_ok(*args):
    return git_run(*args, check=False).returncode == 0


def git_bytes(oid):
    return git_run("cat-file", "blob", oid, binary=True).stdout


def offline(err):
    return any(s in err for s in NETWORK)


def damaged_copy(detail):
    return Stop(f"The hidden Git copy at {CLONE} is damaged ({detail.strip()}).\n"
                f"It holds nothing of yours. Delete it and run again; it is downloaded afresh:\n   rm -rf {CLONE}")


def lock():
    """One publish.py at a time on this Mac: a second one would reset the hidden copy under the first."""
    global LOCK
    LOCK = open(CLONE.parent / (CLONE.name + ".lock"), "a")
    try:
        fcntl.flock(LOCK, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise Stop("publish.py is already running on this Mac (another Terminal window?). Nothing was changed.")


def prepare_clone():
    """Bring the hidden Git copy to exactly what GitHub has now; return that commit."""
    if not (CLONE / ".git").is_dir():
        if CLONE.exists():
            raise Stop(f"{CLONE} exists but is not a Git copy. Move it out of the way and run again.")
        print("First run on this Mac: downloading the repository…")
        r = subprocess.run(["git", "clone", "--quiet", FETCH_URL, str(CLONE)], capture_output=True, text=True,
                           env=git_env(pinned=False))
        if r.returncode:
            if offline(r.stderr):
                raise Stop("Could not reach GitHub. Check the internet connection and run again. Nothing was changed.")
            raise Stop(f"Could not download {FETCH_URL}:\n{r.stderr.strip()}")
    if not git_ok("rev-parse", "--git-dir"):
        raise damaged_copy("not a Git repository")
    git_run("remote", "remove", "origin", check=False)
    git("remote", "add", "origin", FETCH_URL)
    git("remote", "set-url", "--push", "origin", PUSH_URL)
    git("config", "user.name", AUTHOR[0])
    git("config", "user.email", AUTHOR[1])
    r = git_run("fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main", check=False)
    if r.returncode:
        if offline(r.stderr):
            raise Stop("Could not reach GitHub. Check the internet connection and run again. Nothing was changed.")
        raise damaged_copy(r.stderr)
    # Anything left by an interrupted run (a lock, a half rebase, staged files) is dropped here.
    (CLONE / ".git" / "index.lock").unlink(missing_ok=True)
    git_run("rebase", "--quit", check=False)
    for args in (("checkout", "--quiet", "-f", "-B", "main", "origin/main"),
                 ("reset", "--quiet", "--hard", "origin/main"), ("clean", "-qffdx")):
        r = git_run(*args, check=False)
        if r.returncode:
            raise damaged_copy(r.stderr)
    return git("rev-parse", "HEAD")


def tree(commit):
    if commit is None:
        return None
    files = {}
    for rec in git_run("ls-tree", "-r", "-z", "--full-tree", commit).stdout.split("\0"):
        if rec:
            meta, path = rec.split("\t", 1)
            _, kind, oid = meta.split()
            if kind == "blob" and tracked(path):
                files[path] = oid
    return files


def published_versions(path, head):
    """Every content this path has had on GitHub, up to head."""
    out = git_run("log", "--full-history", "--no-renames", "--format=", "--raw", "--no-abbrev", "-z",
                  head, "--", path).stdout
    return {tok.split()[3] for tok in out.split("\0") if tok.startswith(":") and len(tok.split()) >= 4} - {NO_SHA}


def compare(here, head_files, base_files, head):
    """Sort every differing path into pull (GitHub → here), push (here → GitHub), conflict
    (changed in both places) or stale (an earlier published version here). sw.js and app.js
    are compared with their version stamps blanked, as long as GitHub's copy has a stamp;
    files that differ only in the stamp are also listed in stamp_only."""
    pull, push, conflict, stale, stamp_only = {}, {}, [], [], []
    content, history = {}, {}
    def data(oid):
        if oid not in content: content[oid] = git_bytes(oid)
        return content[oid]
    for p in sorted(set(here) | set(head_files) | set(base_files or {})):
        h, g = here[p][0] if p in here else None, head_files.get(p)
        if h == g:
            continue
        b = base_files.get(p) if base_files is not None else None
        blind = p in STAMPED and g is not None and STAMP_LINE.search(data(g)) is not None
        key = (lambda oid: None if oid is None else blob_id(restamp(data(oid), ""))) if blind else (lambda oid: oid)
        hn = (blob_id(restamp(here[p][1], "")) if blind else h) if h is not None else None
        gn, bn = key(g), key(b)
        def older():                    # this content was on GitHub at some point
            if p not in history: history[p] = published_versions(p, head)
            return hn is not None and hn in {key(o) for o in history[p]}
        if h is not None and hn == gn:
            pull[p] = g                 # only the version stamp differs: take GitHub's
            stamp_only.append(p)
        elif base_files is None:        # no record yet: settle only what history makes certain
            if older(): pull[p] = g     # an earlier published copy, untouched here
            elif g is None and not published_versions(p, head): push[p] = h   # new here
            elif h is None: pull[p] = g # only on GitHub; copying it here removes nothing
            else: conflict.append(p)
        elif hn == bn:
            pull[p] = g                 # changed only on GitHub (None: removed there)
        elif gn == bn:                  # changed only here (None: removed here) ...
            if older(): stale.append(p) # ... unless it is an earlier published version
            else: push[p] = h
        else:
            conflict.append(p)
    return pull, push, conflict, stale, stamp_only


def case_clashes(paths, pull, push):
    """APFS ignores upper/lower case, Git does not. Two names that differ only in case are
    fine only as a rename (one removed, one added, on the same side)."""
    groups = {}
    for p in paths:
        groups.setdefault(p.casefold(), []).append(p)
    bad = []
    for g in (sorted(v) for v in groups.values() if len(v) > 1):
        rename = len(g) == 2 and any(all(p in side for p in g) and (side[g[0]] is None) != (side[g[1]] is None)
                                     for side in (pull, push))
        if not rename:
            bad.append(g)
    return bad


def shell_files(sw_bytes):
    """The files sw.js pre-caches for offline use; each must exist on GitHub or phones never update."""
    m = re.search(rb"const SHELL_FILES = \[(.*?)\];", sw_bytes, re.S)
    return [] if not m else [nfc(f.decode()) for f in re.findall(rb'"\./([^"]+)"', m.group(1))]


def run_tests():
    """The same checks GitHub runs (.github/workflows/test.yml), if Node is installed here."""
    node = shutil.which("node")
    if not node:
        print("Node is not installed on this Mac, so tests run on GitHub after publishing (Actions tab).")
        return
    for cmd in ([node, "--test", "tests/core.test.mjs"], [node, "--check", "app.js"], [node, "--check", "sw.js"]):
        r = subprocess.run(cmd, cwd=CLONE, capture_output=True, text=True)
        if r.returncode:
            raise Stop("Tests failed, so nothing was published:\n" + (r.stdout + r.stderr)[-3000:])
    print("Tests passed.")


def bump(live):
    """Stamp a version newer than the live one into the hidden copy's sw.js and app.js."""
    for p in STAMPED:                # start from the live stamp, whatever the folder's copy carried
        (CLONE / p).write_bytes(restamp((CLONE / p).read_bytes(), live or ""))
    r = subprocess.run([sys.executable, "bump.py"], cwd=CLONE, capture_output=True, text=True)
    new = version_of((CLONE / "sw.js").read_bytes())
    if r.returncode == 0 and live and new is not None and not new > live:   # this Mac's date is behind
        r = subprocess.run([sys.executable, "bump.py", after(live)], cwd=CLONE, capture_output=True, text=True)
        new = version_of((CLONE / "sw.js").read_bytes())
    app = re.search(rb'const APP_VERSION = "([^"]+)";', (CLONE / "app.js").read_bytes())
    if r.returncode or new in (None, live) or not app or app.group(1).decode() != new:
        raise Stop(f"Could not stamp a new version with bump.py, so nothing was published.\n{(r.stdout + r.stderr).strip()}\n"
                   "sw.js needs a line like  const VERSION = \"2026-10-02a\";  and app.js one like\n"
                   "const APP_VERSION = \"2026-10-02a\";  Put back whichever is missing in this folder and run again.")
    git("add", "--", *STAMPED)
    return new


def ssh_help():
    home = pathlib.Path("~/.ssh").expanduser()
    key = next((k for k in SSH_KEYS if (home / (k + ".pub")).exists()), None)
    make = ("" if key else
            "This Mac has no SSH key yet. Create one:\n"
            "   mkdir -p -m 700 ~/.ssh && ssh-keygen -t ed25519 -N \"\" -f ~/.ssh/id_ed25519\n")
    return Stop("GitHub did not accept this Mac's SSH key, so nothing was published.\n" + make +
                f"Copy the key:   pbcopy < ~/.ssh/{key or 'id_ed25519'}.pub\n"
                "then paste it at https://github.com/settings/ssh/new (signed in as agsm26) and run publish.py again.\n"
                "Test with:   ssh -T git@github.com   (it should greet agsm26)\n"
                "More in DEPLOY.md, \"Publishing from another Mac\".")


def push_with_retry(base):
    """Push; if the hourly history job pushed meanwhile, replay on top of it. Stop if
    anyone else changed a tracked file, since this folder has not seen that change."""
    for attempt in range(3):
        write_base(base, pending=git("rev-parse", "HEAD"))   # counts even if cut off right after the push lands
        r = git_run("push", "--quiet", "origin", "HEAD:main", check=False)
        if r.returncode == 0:
            return
        err = r.stderr
        if any(s in err for s in ("Permission denied", "publickey", "Host key verification")):
            raise ssh_help()
        if offline(err):
            raise Stop("Lost the connection to GitHub while publishing (some Wi-Fi networks block SSH), so it may\n"
                       f"not have gone through. Run publish.py again when online; it checks.\n{err.strip()}")
        reason = "\n".join(l.rstrip() for l in err.splitlines() if l.startswith("remote:")) or err.strip()
        if "rejected" not in err:
            raise Stop(f"Publishing failed, so nothing was published:\n{reason}")
        before = git("rev-parse", "origin/main")
        git("fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main")
        moved = git("rev-parse", "origin/main")
        if before == moved:
            raise Stop(f"GitHub refused this publish, so nothing was published:\n{reason}")
        others = [p for p in git_run("diff", "--name-only", "-z", before, moved).stdout.split("\0") if p and tracked(p)]
        if others:
            raise Stop("Someone published to GitHub at the same moment (" + ", ".join(others) + ").\n"
                       "Nothing of yours was published. Run publish.py again to bring their change in first.")
        if not git_ok("rebase", "--quiet", "origin/main"):
            git_run("rebase", "--abort", check=False)
            raise Stop("Could not combine with GitHub's latest history. Nothing was published; run again.")
    raise Stop("GitHub kept changing while publishing (3 tries). Nothing was published; run again in a minute.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter, allow_abbrev=False)
    ap.add_argument("--check", action="store_true", help="only show what differs")
    ap.add_argument("-m", "--message", help="describe the change")
    ap.add_argument("--yes", action="store_true", help="don't ask")
    ap.add_argument("--prefer", choices=["drive", "github"],
                    help="for files changed in both places: drive = keep this folder's copy, github = take GitHub's")
    ap.add_argument("--keep-older", action="store_true", help="publish this folder's earlier version of a file")
    ap.add_argument("--allow-deletes", action="store_true",
                    help=f"allow removing files from GitHub, or more than {MAX_DELETES} files here")
    # For testing against a scratch repository instead of the real one.
    ap.add_argument("--remote", help=argparse.SUPPRESS)
    ap.add_argument("--clone", help=argparse.SUPPRESS)
    ap.add_argument("--backups", help=argparse.SUPPRESS)
    ap.add_argument("--drive-wait", type=float, default=120, help=argparse.SUPPRESS)
    ap.add_argument("--drive-settle", type=float, default=3, help=argparse.SUPPRESS)
    args = ap.parse_args()

    global CLONE, BACKUPS, FETCH_URL, PUSH_URL
    CLONE = pathlib.Path(args.clone or "~/.hk-parking-publish").expanduser()
    BACKUPS = pathlib.Path(args.backups or "~/.hk-parking-publish-backups").expanduser()
    if args.remote:
        FETCH_URL = PUSH_URL = args.remote
    if HERE == CLONE.resolve() or CLONE.resolve() in HERE.parents:
        raise Stop("This is publish.py's own hidden working copy. Run the publish.py in the Google Drive folder instead.")

    lock()
    global DRIVE
    DRIVE = drive = drive_state(".") is not None     # False outside Google Drive (nothing to wait for)
    if not drive and "/Library/CloudStorage/" in str(HERE):
        raise Stop("Could not ask Google Drive whether this folder is in sync (fileproviderctl gave no answer).\n"
                   "Make sure Google Drive is running, then run again. Nothing was changed.")
    here, syncing = scan_folder(), []
    if drive:
        here, syncing = wait_for_downloads(here, args)
    head = prepare_clone()
    head_files = tree(head)
    base = read_base(head)
    pull, push, conflict, stale, stamp_only = compare(here, head_files, tree(base), head)
    live = version_of((CLONE / "sw.js").read_bytes()) if (CLONE / "sw.js").is_file() else None
    lost = [p for p in NEEDED if p in pull and pull[p] is None]
    for p in lost:
        del pull[p]
        conflict.append(p)

    note = {}
    if args.keep_older:
        for p in stale:
            push[p] = here[p][0]
            note[p] = "earlier version, published on purpose"
        stale = []
    if args.prefer == "github":
        for p in conflict + stale:
            pull[p] = head_files.get(p)
            note[p] = ("changed in both places" if p in conflict else "earlier version here") \
                + ("; taking GitHub's copy" if pull[p] is not None else "")
        conflict, stale = [], []
    elif args.prefer == "drive":
        for p in conflict:
            push[p] = here[p][0] if p in here else None
            note[p] = "changed in both places" + ("; keeping this folder's copy" if push[p] is not None else "")
        conflict = []
    if conflict or stale:
        msg = []
        if conflict:
            msg.append("These files changed both here and on GitHub since they last matched:\n"
                       + "\n".join(f"   {p}" for p in conflict)
                       + ("" if base else "\n(There is no record yet of when this folder last matched GitHub, so a "
                          "file that differs and was never published counts as changed in both places.)")
                       + (f"\n(GitHub no longer has {short(lost)}, which the app needs; keeping this folder's copy "
                          "puts it back.)" if lost else "")
                       + f"\nCompare with https://github.com/{REPO}/commits/main, then either keep this folder's "
                         f"copy:\n   {again('--prefer drive')}\nor take GitHub's:\n   {again('--prefer github')}")
        also = f" (this also takes GitHub's copy of {short(conflict)})" if conflict else ""
        removed = [p for p in stale if head_files.get(p) is None]
        earlier = [p for p in stale if p not in removed]
        if earlier:
            msg.append("This folder has an earlier version of these files than GitHub:\n"
                       + "\n".join(f"   {p}" for p in earlier)
                       + ("\nGoogle Drive reports this folder is fully synced, so this looks like a change that was "
                          "undone (here or on the other account)." if drive and not syncing else
                          "\nEither Google Drive is still delivering the newer copies (then wait a minute and run "
                          "again), or a change was undone.")
                       + f"\nTo publish the earlier version:\n   {again('--keep-older')}"
                       + f"\nTo take GitHub's version back into this folder{also}:\n   {again('--prefer github')}")
        if removed:
            msg.append("GitHub no longer has these files, but this folder still has them:\n"
                       + "\n".join(f"   {p}" for p in removed)
                       + "\nMost likely they were removed on the other account and Google Drive is still delivering "
                         "that; wait a minute and run again."
                       + f"\nTo remove them here now{also}:\n   {again('--prefer github')}"
                       + f"\nTo publish them again instead:\n   {again('--keep-older')}")
        raise Stop("\n\n".join(msg) + "\n\nNothing was changed.")
    clashes = case_clashes(set(here) | set(head_files), pull, push)
    if clashes:
        raise Stop("These names differ only in upper/lower case, which this Mac cannot keep apart:\n"
                   + "\n".join("   " + " / ".join(c) for c in clashes) + "\nRename one of them. Nothing was changed.")
    copies = [p for p, o in push.items() if o is not None and p not in head_files
              and any(DRIVE_COPY.search(part) for part in p.split("/"))]
    if copies:
        raise Stop("These look like copies Google Drive made when two edits clashed:\n" + "\n".join(f"   {p}" for p in copies)
                   + "\nMerge what you need into the real file and delete the copy (or rename it). Nothing was changed.")

    gone_github = [p for p, o in push.items() if o is None]
    gone_here = [p for p, o in pull.items() if o is None]
    if any(p in NEEDED for p in gone_github + gone_here):
        raise Stop("That would remove a file the app needs (" + short([p for p in gone_github + gone_here if p in NEEDED])
                   + "). Nothing was changed.")
    if gone_github and not args.allow_deletes:
        raise Stop("These files are on GitHub but not in this folder:\n" + "\n".join(f"   {p}" for p in gone_github)
                   + "\nUsually Google Drive simply hasn't delivered them yet. Nothing was changed.\n"
                     f"If you removed them on purpose:\n   {again('--allow-deletes')}")
    if len(gone_here) > MAX_DELETES and not args.allow_deletes:
        raise Stop(f"GitHub no longer has these {len(gone_here)} files, so they would be removed here (with backups):\n"
                   + "\n".join(f"   {p}" for p in gone_here)
                   + f"\nNothing was changed. If that is expected:\n   {again('--allow-deletes')}")
    if push:
        final = dict(head_files)
        for p, o in push.items():
            if o is None: final.pop(p, None)
            else: final[p] = o
        over = [p for p in final if any(q.startswith(p + "/") for q in final)]
        if over:
            raise Stop(f"{short(over)} would be a file and a folder at once on GitHub. Rename it here. Nothing was changed.")
        sw_final = here["sw.js"][1] if "sw.js" in push else \
            ((CLONE / "sw.js").read_bytes() if (CLONE / "sw.js").is_file() else b"")
        missing = [f for f in shell_files(sw_final) if tracked(f) and f not in final]
        if missing:
            raise Stop("sw.js lists these files for offline use, but they would not be on GitHub:\n"
                       + "\n".join(f"   {f}" for f in missing)
                       + "\nPhones would then never install the update. Nothing was changed.")

    served = any(not NOT_SERVED.match(p) for p in push)
    if not pull and not push:
        print(f"This folder and GitHub match (live version {live or '(none)'}). Nothing to publish.")
        if not args.check and base != head:
            write_base(head, strict=False)
        return
    def label(p, o, gone):
        why = [w for w in (note.get(p), gone if o is None else None) if w]
        return f"   {p}" + (f"   ({'; '.join(why)})" if why else "")
    newer = {p: o for p, o in pull.items() if p not in stamp_only}
    if newer:
        print("Newer on GitHub, will be copied into this folder:")
        print("\n".join(label(p, o, "removed on GitHub, will be removed here") for p, o in newer.items()))
    if stamp_only:
        print(f"Only the version stamp differs in {', '.join(stamp_only)}; GitHub's stamp is copied here "
              "(each publish stamps a new one).")
    if push:
        print("Newer in this folder, will be published:")
        print("\n".join(label(p, o, "not in this folder, will be removed from GitHub") for p, o in push.items()))
        if served:
            print(f"   + a new version stamp after {live or '(none)'} (sw.js, app.js), so phones pick up the change")
    if args.check:
        return
    if not args.yes:
        if not sys.stdin.isatty():
            raise Stop("Not asking without a terminal; run again with --yes to go ahead.")
        try:
            answer = input("Go ahead? [y/N] ")
        except EOFError:
            answer = ""
        if answer.strip().lower() not in ("y", "yes"):
            print("Nothing was changed.")
            return

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backed_up = False
    try:
        # Removals first, so a rename that only changes upper/lower case survives on APFS.
        for p, oid in sorted(pull.items(), key=lambda kv: kv[1] is not None):
            unchanged(p, here[p][0] if p in here else None)
            if not drive_ready(p):
                raise Stop(f"Google Drive is bringing in a newer version of {p} from the cloud, so it was not "
                           "overwritten. Run again in a minute.")
            dst = HERE / p
            if current(p) is not None:
                backed_up |= backup(p, stamp)
            if oid is None:
                dst.unlink()
                remove_empty_parents(dst)
            else:
                if dst.is_dir():
                    raise Stop(f"{p} is a folder here but a file on GitHub. Move the folder away and run again.")
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_bytes((CLONE / p).read_bytes())
                if current(p) != oid:
                    raise Stop(f"Google Drive did not save {p} correctly. Run again.")
    except OSError as e:
        raise Stop(f"Could not write {e.filename or 'a file'} in Google Drive ({e.strerror or e}). Run again.")
    if pull:
        print(f"Brought in {len(pull)} change(s) from GitHub." + (f" Previous copies saved in {BACKUPS / stamp}" if backed_up else ""))
        # The record says this folder matches GitHub; the other account must get the files before the record.
        waiting = wait_for_uploads([p for p, o in pull.items() if o is not None], args, "uploading them") if drive else []
        if waiting:
            raise Stop(f"Google Drive hasn't finished uploading {short(waiting)}, so nothing else was done.\n"
                       "Run again in a minute.")
        write_base(head)
    if not push:
        print("Done. Nothing needed publishing.")
        return

    try:
        for p, oid in sorted(push.items(), key=lambda kv: kv[1] is not None):
            unchanged(p, oid)
            if oid is None:
                git("rm", "--quiet", "--", p)
                continue
            dst = CLONE / p
            if dst.is_dir():
                shutil.rmtree(dst)
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(here[p][1])
            git("add", "-f", "--", p)
    except OSError as e:
        raise Stop(f"Could not prepare {e.filename or 'a file'} for publishing ({e.strerror or e}). Nothing was published.")
    if served:      # stamp the hidden copy only; this folder gets the stamp once GitHub has the publish
        print(f"Version stamped: {live or '(none)'} → {bump(live)}")
    run_tests()
    if drive:       # the other account gets the files before GitHub and the record say they were published
        waiting = wait_for_uploads([p for p, o in push.items() if o is not None], args,
                                   "saving them to the cloud, so the other account has them first")
        if waiting:
            raise Stop(f"Google Drive hasn't finished uploading {short(waiting)}, so nothing was published.\n"
                       "Check that Google Drive is running and online, then run again.")

    if git("rev-parse", "HEAD") != head:
        raise Stop("The hidden Git copy changed during this run. Nothing was published; run again.")
    names = list(push) + [p for p in STAMPED if served and p not in push]
    message = args.message or "Publish from Drive: " + ", ".join(names[:4]) + (f" and {len(names) - 4} more" if len(names) > 4 else "")
    git("commit", "--quiet", "-m", message)
    push_with_retry(head if pull else base)
    published = git("rev-parse", "HEAD")

    in_step = True
    if served:      # the stamp now goes into this folder too, unless someone edited these meanwhile
        for p in STAMPED:
            expected = pull[p] if p in pull else (here[p][0] if p in here else None)
            try:
                if current(p) != expected:
                    print(f"Note: {p} was edited here during publishing, so the new stamp was not copied into it.")
                    in_step = False
                    continue
                if not drive_ready(p):
                    print(f"Note: Google Drive is bringing in a newer {p}, so the new stamp was not copied into it.")
                    in_step = False
                    continue
                backup(p, stamp)
                (HERE / p).write_bytes((CLONE / p).read_bytes())
            except (OSError, Stop) as e:
                print(f"Note: could not copy the new stamp into {p} ({e}); the next run brings it in.")
                in_step = False
    if in_step:
        write_base(published, strict=False)
    now = version_of((CLONE / "sw.js").read_bytes())
    owner, name = REPO.split("/")
    print(f"Published {published[:7]} (version {now}).\nTest results: https://github.com/{REPO}/actions")
    if served:
        print(f"The live app updates in about a minute: https://{owner}.github.io/{name}/\n"
              "On the phone, open the app twice: the first open fetches the update, the second uses it.")
    else:
        print("Only files the phones never load changed, so the app itself is unchanged.")


if __name__ == "__main__":
    try:
        main()
    except Stop as e:
        print(e, file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nStopped.", file=sys.stderr)
        sys.exit(130)
