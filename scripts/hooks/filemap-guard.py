#!/usr/bin/env python3
# AiOS r3 - logika straznika File Map. Wolany przez filemap-guard.sh.
# stdin: JSON hooka PreToolUse; argv[1]: sciezka pliku File Map; argv[2]: ROOT drzewa roli.
# exit 0 = przepusc; exit 2 = blokada (stderr wraca do agenta jako powod).
import sys, json, fnmatch, os, subprocess

map_path = sys.argv[1]
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)

agent = d.get("agent_type") or ""
if not agent:
    sys.exit(0)  # sesja glowna (Arbiter) - poza jurysdykcja straznika

ti = d.get("tool_input") or {}
path = ti.get("file_path") or ti.get("path") or ""
if not path:
    sys.exit(0)

# ── kotwiczenie: na jakim drzewie roboczym w ogole lezy "path" ───────────────
# work_root to ROOT drzewa roli (argv[2], przekazywany przez filemap-guard.sh
# PRZED jego wlasnym `cd`), a przy braku argumentu — cwd (wywolanie rowne).
work_root = os.path.realpath(sys.argv[2]) if len(sys.argv) > 2 else os.path.realpath(os.getcwd())
p = path if os.path.isabs(path) else os.path.join(work_root, path)
p = os.path.realpath(p)


def _git(cwd, *args):
    try:
        out = subprocess.run(["git", "-C", cwd, "rev-parse", *args],
                              capture_output=True, text=True, check=True)
        return out.stdout.strip()
    except Exception:
        return None


anchor = None
if p == work_root or p.startswith(work_root + os.sep):
    anchor = work_root
else:
    dname = os.path.dirname(p)
    top = _git(dname, "--show-toplevel")
    if top:
        cd_d = _git(dname, "--git-common-dir")
        cd_w = _git(work_root, "--git-common-dir")
        if cd_d is not None and cd_w is not None and \
           os.path.realpath(os.path.join(dname, cd_d)) == os.path.realpath(os.path.join(work_root, cd_w)):
            anchor = os.path.realpath(top)

if anchor is None:
    sys.stderr.write(
        "[AiOS powloka] BLOKADA File Map: sciezka '%s' lezy poza drzewem roboczym repozytorium.\n"
        "Rola '%s' pracuje wylacznie w plikach repozytorium; pliki tymczasowe tworz Bashem\n"
        "(hook obejmuje wylacznie Edit|Write|MultiEdit).\n"
        % (path, agent)
    )
    sys.exit(2)

rel = os.path.relpath(p, anchor)

rules = []
for line in open(map_path, encoding="utf-8"):
    line = line.strip()
    if not line or line.startswith("#") or ":" not in line:
        continue
    role, pat = line.split(":", 1)
    rules.append((role.strip(), pat.strip()))

mine = [p for r, p in rules if r == agent]
if not mine:
    sys.exit(0)  # rola bez wpisow w mapie - nie egzekwujemy

def match(p, pat):
    if fnmatch.fnmatch(p, pat):
        return True
    if pat.endswith("/**"):
        base = pat[:-3].rstrip("/")
        return p == base or p.startswith(base + "/")
    return False

if any(match(rel, pt) for pt in mine):
    sys.exit(0)

sys.stderr.write(
    "[AiOS powloka] BLOKADA File Map: rola '%s' nie ma przydzialu do '%s'.\n"
    "Twoje wzorce: %s\nPracuj wylacznie w swoich plikach; zmiany cudzych zglos Arbitrowi.\n"
    % (agent, rel, ", ".join(mine))
)
sys.exit(2)
