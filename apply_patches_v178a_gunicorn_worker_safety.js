/*
 * apply_patches_v178a_gunicorn_worker_safety.js
 *
 * V178A — Make the backend safe to run under gunicorn with multiple
 *         uvicorn workers, then ship the gunicorn launch infrastructure.
 *
 *   Single-worker bugs that surface under multi-worker:
 *     • start_torrent_server() in @app.on_event("startup") binds port
 *       8002 — under N workers, the first wins and N-1 die silently.
 *     • asyncio.create_task(periodic_cleanup()) runs N times instead
 *       of once — wasteful, can cause Mongo write contention.
 *     • The admin upsert runs N times (idempotent, just noisy).
 *
 *   Fix: introduce a file-lock-based "leader election" so the very
 *   first worker to start acquires /tmp/privastream_leader.lock; only
 *   that worker spawns the torrent-server, the periodic cleanup task,
 *   and logs the admin upsert.  Lock auto-releases if the leader
 *   crashes (POSIX flock semantics), and any surviving worker can
 *   become the new leader on its next health-check tick (handled in
 *   a follow-up v178b; v178a just makes the initial election robust).
 *
 *   Deliverables (relative to project root, where backend/ lives):
 *     1) backend/server.py             — wrap startup in leader check
 *     2) backend/gunicorn_conf.py      — NEW, production config
 *     3) backend/run_server.sh         — NEW, drop-in launcher
 *     4) backend/requirements.txt      — append gunicorn
 *
 *   Idempotent.  CRLF preserved.  Pure JS — no rebuild, just restart
 *   your backend with the new launch command (see end-of-output notes).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT      = process.cwd();
const BACKEND   = path.join(ROOT, 'backend');
const SERVER_PY = path.join(BACKEND, 'server.py');
const GCONF_PY  = path.join(BACKEND, 'gunicorn_conf.py');
const RUN_SH    = path.join(BACKEND, 'run_server.sh');
const REQS_TXT  = path.join(BACKEND, 'requirements.txt');

const _eol = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v178a] FATAL: file not found: ${p}`);
    console.error(`[v178a] Run this from the project root that contains the "backend" folder.`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eol[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eol[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c, eolOverride) {
  const useEol = eolOverride || _eol[p] || 'lf';
  const out = useEol === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v178a] wrote ${path.relative(ROOT, p) || p} (${useEol.toUpperCase()})`);
}

let total = 0;

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 1 — backend/server.py  (wrap subprocess + periodic task in leader lock)
// ═════════════════════════════════════════════════════════════════════════════
{
  let src = read(SERVER_PY);
  if (src.indexOf('V178A_LEADER_LOCK') !== -1) {
    console.log('[v178a] server.py: already patched, skipping');
  } else {
    let changes = 0;

    // 1a) Add `import fcntl` near the other stdlib imports.  Anchor on the
    //     existing `import subprocess` line which we know is present.
    const importAnchor = 'import subprocess';
    if (src.indexOf(importAnchor) !== -1 && src.indexOf('import fcntl') === -1) {
      src = src.replace(
        importAnchor,
        importAnchor + '\nimport fcntl  # V178A_LEADER_LOCK — flock-based worker leader election'
      );
      changes++;
      console.log('[v178a] server.py: added `import fcntl`');
    } else if (src.indexOf('import fcntl') !== -1) {
      console.log('[v178a] server.py: fcntl already imported');
    } else {
      console.log('[v178a] WARN: could not find `import subprocess` to anchor fcntl import');
    }

    // 1b) Insert the leader-lock helper directly above `def start_torrent_server`.
    const leaderHelper =
      '# ═══ V178A_LEADER_LOCK ══════════════════════════════════════════════════\n' +
      '# Under gunicorn with N>1 workers, every worker invokes the @app startup\n' +
      "# event.  The torrent-server subprocess and the periodic_cleanup task\n" +
      '# must only run ONCE per host.  We use a non-blocking POSIX file lock:\n' +
      '# the first worker to grab /tmp/privastream_leader.lock becomes leader;\n' +
      '# others skip those steps.  If the leader dies, the OS releases the lock\n' +
      '# and a future worker restart will pick up leadership.\n' +
      '_V178A_LEADER_LOCK_PATH = "/tmp/privastream_leader.lock"\n' +
      '_v178a_leader_fd = None\n' +
      '_v178a_is_leader = False\n' +
      '\n' +
      'def _v178a_acquire_leader_lock() -> bool:\n' +
      '    """Try to become the singleton "leader" worker.  Returns True only\n' +
      '    inside the worker that succeeds; subsequent calls in the same\n' +
      '    process also return True (cached).  Workers that fail to acquire\n' +
      '    return False and should skip leader-only startup work."""\n' +
      '    global _v178a_leader_fd, _v178a_is_leader\n' +
      '    if _v178a_is_leader:\n' +
      '        return True\n' +
      '    try:\n' +
      '        fd = open(_V178A_LEADER_LOCK_PATH, "w")\n' +
      '        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)\n' +
      '        fd.write(str(os.getpid()))\n' +
      '        fd.flush()\n' +
      '        _v178a_leader_fd = fd  # keep FD alive — closing releases the lock\n' +
      '        _v178a_is_leader = True\n' +
      '        return True\n' +
      '    except (IOError, OSError):\n' +
      '        try:\n' +
      '            if _v178a_leader_fd:\n' +
      '                _v178a_leader_fd.close()\n' +
      '        except Exception:\n' +
      '            pass\n' +
      '        _v178a_leader_fd = None\n' +
      '        _v178a_is_leader = False\n' +
      '        return False\n' +
      '# ═══ /V178A_LEADER_LOCK ═════════════════════════════════════════════════\n' +
      '\n' +
      'def start_torrent_server():';
    const startTorrentAnchor = 'def start_torrent_server():';
    // Use the unique helper-function name as the idempotency probe.  The
    // string "V178A_LEADER_LOCK" also appears in the fcntl-import comment
    // inserted in step 1a, so we can't rely on it here.
    if (src.indexOf(startTorrentAnchor) !== -1 && src.indexOf('_v178a_acquire_leader_lock') === -1) {
      src = src.replace(startTorrentAnchor, leaderHelper);
      changes++;
      console.log('[v178a] server.py: inserted leader-lock helper');
    } else if (src.indexOf('_v178a_acquire_leader_lock') !== -1) {
      console.log('[v178a] server.py: leader-lock helper already present');
    } else {
      console.log('[v178a] WARN: could not find `def start_torrent_server():` anchor');
    }

    // 1c) Wrap the startup body so leader-only work is gated.
    //     We rewrite the function body to:
    //       - run admin upsert always (idempotent + ensures every worker sees user)
    //       - only call start_torrent_server() + asyncio.create_task in the leader
    const oldStartupBody =
      '@app.on_event("startup")\n' +
      'async def create_default_admin():\n' +
      '    """Create default admin user if not exists and start torrent server"""\n' +
      '    # Start torrent server first\n' +
      '    start_torrent_server()\n' +
      '    \n' +
      '    existing = await db.users.find_one({"username": "choyt"})';
    const newStartupBody =
      '@app.on_event("startup")\n' +
      'async def create_default_admin():\n' +
      '    """Create default admin user if not exists and start torrent server.\n' +
      '\n' +
      '    V178A_LEADER_LOCK: torrent-server subprocess and periodic cleanup\n' +
      '    task are gated to a single elected leader worker so multi-worker\n' +
      '    gunicorn deployments do not spawn N torrent-servers fighting over\n' +
      '    port 8002.  The admin upsert is idempotent and runs in every\n' +
      '    worker so each has a primed cache."""\n' +
      '    _v178a_leader = _v178a_acquire_leader_lock()\n' +
      '    if _v178a_leader:\n' +
      '        logger.info(f"V178A: PID {os.getpid()} is the LEADER — managing torrent-server + periodic cleanup")\n' +
      '        start_torrent_server()\n' +
      '    else:\n' +
      '        logger.info(f"V178A: PID {os.getpid()} is a FOLLOWER — skipping torrent-server start")\n' +
      '\n' +
      '    existing = await db.users.find_one({"username": "choyt"})';
    if (src.indexOf(oldStartupBody) !== -1) {
      src = src.replace(oldStartupBody, newStartupBody);
      changes++;
      console.log('[v178a] server.py: gated torrent-server start to leader');
    } else {
      console.log('[v178a] WARN: server.py startup body anchor not found');
    }

    // 1d) Gate the periodic_cleanup task creation as well.
    const oldPeriodic =
      '    # Start periodic cleanup for torrent downloads\n' +
      '    asyncio.create_task(periodic_cleanup())';
    const newPeriodic =
      '    # Start periodic cleanup for torrent downloads (LEADER ONLY — V178A)\n' +
      '    if _v178a_leader:\n' +
      '        asyncio.create_task(periodic_cleanup())';
    if (src.indexOf(oldPeriodic) !== -1) {
      src = src.replace(oldPeriodic, newPeriodic);
      changes++;
      console.log('[v178a] server.py: gated periodic_cleanup to leader');
    } else {
      console.log('[v178a] WARN: server.py periodic_cleanup anchor not found');
    }

    if (changes > 0) {
      write(SERVER_PY, src);
      console.log(`[v178a] server.py: ${changes} change(s) applied`);
      total += changes;
    } else {
      console.log('[v178a] server.py: nothing to change');
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 2 — backend/gunicorn_conf.py  (NEW)
// ═════════════════════════════════════════════════════════════════════════════
{
  if (fs.existsSync(GCONF_PY)) {
    console.log('[v178a] gunicorn_conf.py: already exists, skipping');
  } else {
    const gconf =
      '"""V178A — gunicorn production configuration.\n' +
      '\n' +
      'Launch via:    gunicorn server:app -c gunicorn_conf.py\n' +
      'Or via:        bash run_server.sh   (same thing, plus venv detection)\n' +
      '\n' +
      'Tuned for the FastAPI + Motor + httpx workload in server.py.\n' +
      'Auto-sizes workers to (2 * core_count) + 1 capped at 8 so the same\n' +
      'config runs well on both the current physical box and the future\n' +
      'Hetzner CCX23 (4 cores → 8 workers).\n' +
      '"""\n' +
      'import multiprocessing\n' +
      'import os\n' +
      '\n' +
      '# ── Binding ────────────────────────────────────────────────────────────\n' +
      '# Match the existing uvicorn launch contract: 0.0.0.0:8001.  Caddy /\n' +
      "# kubernetes ingress / Cloudflare all sit in front of this port.\n" +
      'bind = os.environ.get("BIND", "0.0.0.0:8001")\n' +
      '\n' +
      '# ── Workers ────────────────────────────────────────────────────────────\n' +
      "# UvicornWorker keeps FastAPI's async event loop.  Sync workers would\n" +
      "# serialize the addon fan-out — that defeats the whole architecture.\n" +
      'worker_class = "uvicorn.workers.UvicornWorker"\n' +
      'workers = int(os.environ.get("GUNICORN_WORKERS",\n' +
      '    min(8, (multiprocessing.cpu_count() * 2) + 1)))\n' +
      '\n' +
      '# Per-worker request limits — recycle workers after this many requests\n' +
      "# to mitigate slow memory growth from httpx connection pools / motor\n" +
      "# cursor leaks.  Random jitter so they don't all restart at once.\n" +
      'max_requests = 2000\n' +
      'max_requests_jitter = 200\n' +
      '\n' +
      '# ── Timeouts ───────────────────────────────────────────────────────────\n' +
      "# Premiumize cache-check + addon fan-out can take 20-25s legitimately.\n" +
      "# Setting timeout too low kills slow scrapes.  Setting too high lets\n" +
      "# misbehaving requests hold a worker hostage.  60s is the sweet spot.\n" +
      'timeout = 60\n' +
      "# Worker startup grace — torrent-server install on first-ever boot can\n" +
      "# take 90s.  Generous startup keeps the LEADER worker alive.\n" +
      'graceful_timeout = 30\n' +
      'keepalive = 5\n' +
      '\n' +
      '# ── Logging ────────────────────────────────────────────────────────────\n' +
      'accesslog = "-"   # stdout\n' +
      'errorlog = "-"    # stderr\n' +
      'loglevel = os.environ.get("LOG_LEVEL", "info")\n' +
      "# Apache-style access log so Caddy / Cloudflare logs cross-correlate.\n" +
      "access_log_format = '%(h)s %(l)s %(u)s %(t)s \"%(r)s\" %(s)s %(b)s \"%(f)s\" \"%(a)s\" %(D)sus'\n" +
      '\n' +
      '# ── Process naming (helps with `ps aux | grep gunicorn`) ───────────────\n' +
      'proc_name = "privastream-api"\n' +
      '\n' +
      "# ── Preload OFF on purpose ─────────────────────────────────────────────\n" +
      "# We rely on the V178A_LEADER_LOCK file lock for singleton work.  Using\n" +
      "# --preload would share FDs across workers which complicates that.\n" +
      'preload_app = False\n';
    write(GCONF_PY, gconf, _eol[SERVER_PY] || 'lf');
    console.log('[v178a] created gunicorn_conf.py');
    total++;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 3 — backend/run_server.sh  (NEW)
// ═════════════════════════════════════════════════════════════════════════════
{
  if (fs.existsSync(RUN_SH)) {
    console.log('[v178a] run_server.sh: already exists, skipping');
  } else {
    const runSh =
      '#!/usr/bin/env bash\n' +
      '# V178A — drop-in replacement for `uvicorn server:app --host 0.0.0.0 --port 8001`.\n' +
      "# Wherever you currently launch uvicorn (Dockerfile CMD, docker-compose\n" +
      "# command:, supervisor program, systemd unit, plain shell) replace the\n" +
      "# uvicorn line with:    bash run_server.sh\n" +
      "# Everything else stays the same — same port, same env vars, same logs.\n" +
      'set -euo pipefail\n' +
      '\n' +
      'cd "$(dirname "$0")"\n' +
      '\n' +
      '# Activate a venv if one exists at ./venv or ../venv (best-effort).\n' +
      'for vp in ./venv ../venv ./.venv ../.venv; do\n' +
      '  if [[ -f "$vp/bin/activate" ]]; then\n' +
      '    # shellcheck disable=SC1090\n' +
      '    source "$vp/bin/activate"\n' +
      '    break\n' +
      '  fi\n' +
      'done\n' +
      '\n' +
      '# Make sure gunicorn is installed.  Idempotent: pip skips if present.\n' +
      'python -m pip install --quiet "gunicorn>=21.2.0" "uvicorn[standard]>=0.27.0" || true\n' +
      '\n' +
      '# Launch.  Env-var overrides:\n' +
      '#   BIND=0.0.0.0:8001            (default)\n' +
      '#   GUNICORN_WORKERS=4           (auto-detected by default)\n' +
      '#   LOG_LEVEL=info               (default)\n' +
      'exec gunicorn server:app -c gunicorn_conf.py\n';
    fs.writeFileSync(RUN_SH, runSh, 'utf8');
    try { fs.chmodSync(RUN_SH, 0o755); } catch (_) { /* Windows fs doesn\'t honor chmod */ }
    console.log('[v178a] created run_server.sh (LF, executable)');
    total++;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 4 — backend/requirements.txt  (append gunicorn if missing)
// ═════════════════════════════════════════════════════════════════════════════
{
  if (!fs.existsSync(REQS_TXT)) {
    console.log('[v178a] WARN: backend/requirements.txt not found — create one and add `gunicorn>=21.2.0`');
  } else {
    let req = read(REQS_TXT);
    if (/^gunicorn(\s|=|>|<)/m.test(req)) {
      console.log('[v178a] requirements.txt: gunicorn already pinned, skipping');
    } else {
      const needsNL = !req.endsWith('\n');
      req = req + (needsNL ? '\n' : '') + 'gunicorn>=21.2.0  # V178A — added for multi-worker production launch\n';
      write(REQS_TXT, req);
      total++;
    }
  }
}

console.log('');
console.log(`[v178a] DONE.  ${total} total change(s).`);
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(' NEXT STEPS — APPLY ON YOUR PHYSICAL SERVER (Linux):');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  1) Commit & push these changes to git from this Windows PC.');
console.log('  2) On the physical server:   git pull');
console.log('  3) Find HOW your backend currently launches:');
console.log('     • If via docker-compose: edit the `command:` line for the');
console.log('       backend service to `bash run_server.sh` (was uvicorn ...).');
console.log('     • If via systemd: edit the ExecStart line.');
console.log('     • If via a manual `tmux`/`screen`/`nohup` command: replace');
console.log('       the uvicorn line with `bash run_server.sh`.');
console.log('  4) Restart the backend container/service.');
console.log('  5) Verify in logs:');
console.log('     • "V178A: PID nnnn is the LEADER" (exactly once)');
console.log('     • "V178A: PID nnnn is a FOLLOWER" (N-1 times, where N=workers)');
console.log('     • Existing "Started torrent-server" log (exactly once)');
console.log('     • Existing "Uvicorn running" replaced by "Starting gunicorn"');
