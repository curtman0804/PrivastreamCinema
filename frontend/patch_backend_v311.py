"""
patch_backend_v311_perf_log.py

V311 — Perf Profiler endpoint.  Receives timing marks from the frontend
details page and appends them to /var/log/privastream/perf.log inside the
container (tail-able via `docker compose exec app tail -f /var/log/privastream/perf.log`).

Endpoint: POST /api/debug/perf
Body    : { route: str, session_id?: str, marks: [{label, ts_ms, delta_ms?}], meta?: {...} }
Reply   : {} (always 204-ish — never blocks the client)

Idempotent — re-running the patch is a no-op once the V311_PERF_LOG guard is
present in server.py.

Run on Hetzner:
    cd /home/choyt/PrivastreamCinema/backend
    python3 patch_backend_v311_perf_log.py
    docker compose restart app
"""
import sys
from pathlib import Path

SERVER = Path(__file__).resolve().parent / "server.py"
GUARD = "V311_PERF_LOG"

# Anchor: the existing release-status endpoint declaration.  We append our new
# perf endpoint immediately AFTER the `_V190ReleaseStatusReq` class definition
# is reached.  To stay robust to small whitespace drift, we anchor on the
# `_v190_build_now_playing_set` async helper that lives just below it.
NEEDLE = "async def _v190_build_now_playing_set() -> set:"

INSERT_AFTER_LINE_CONTAINING = NEEDLE  # not strictly used — we use simple .find

NEW_BLOCK = '''
# V311_PERF_LOG — frontend perf profiler endpoint.  The Expo client POSTs
# timing marks here; we append one JSON line per request to a log file
# inside the container.  Best-effort: failures are swallowed so a debug
# endpoint never breaks the user-facing flow.
import os as _v311_os
import json as _v311_json
import logging as _v311_logging
from datetime import datetime as _v311_datetime, timezone as _v311_timezone

_V311_LOG_DIR = "/var/log/privastream"
_V311_LOG_PATH = _v311_os.path.join(_V311_LOG_DIR, "perf.log")
try:
    _v311_os.makedirs(_V311_LOG_DIR, exist_ok=True)
except Exception:
    pass


class _V311PerfMark(BaseModel):
    label: str
    ts_ms: float
    delta_ms: Optional[float] = None


class _V311PerfReq(BaseModel):
    route: str
    session_id: Optional[str] = None
    marks: List[_V311PerfMark] = []
    meta: Optional[Dict[str, Any]] = None


@api_router.post("/debug/perf")
async def v311_record_perf(req: _V311PerfReq):
    """Append a single perf report (JSON line) to the perf log."""
    try:
        line = {
            "ts": _v311_datetime.now(_v311_timezone.utc).isoformat(),
            "route": req.route,
            "session": req.session_id,
            "marks": [m.model_dump() if hasattr(m, "model_dump") else m.dict() for m in (req.marks or [])],
            "meta": req.meta or {},
        }
        encoded = _v311_json.dumps(line, ensure_ascii=False, separators=(",", ":"))
        try:
            with open(_V311_LOG_PATH, "a", encoding="utf-8") as f:
                f.write(encoded + "\\n")
        except Exception as e:
            # Fall back to the regular app logger so the data isn't lost.
            logger.info(f"[v311] perf (no file): {encoded}  ({e})")
        return {}
    except Exception as e:
        logger.warning(f"[v311] perf endpoint error: {e}")
        return {}

'''


def main() -> int:
    if not SERVER.exists():
        print(f"[v311] {SERVER} not found", file=sys.stderr)
        return 1
    src = SERVER.read_text(encoding="utf-8")
    if GUARD in src:
        print(f"[v311] {GUARD} already present — no-op")
        return 0
    idx = src.find(NEEDLE)
    if idx == -1:
        print("[v311] anchor (V190 build_now_playing helper) NOT FOUND", file=sys.stderr)
        print("[v311] aborting — NOTHING WRITTEN", file=sys.stderr)
        return 2

    # Insert NEW_BLOCK immediately BEFORE the anchor line so we don't break
    # the existing function signature.  The new endpoint registers itself
    # via the @api_router decorator regardless of its file position.
    src = src[:idx] + NEW_BLOCK + "\n" + src[idx:]
    SERVER.write_text(src, encoding="utf-8")
    print(f"[v311] patched server.py — guard '{GUARD}' now present")
    print("[v311] restart the API: docker compose restart app")
    return 0


if __name__ == "__main__":
    sys.exit(main())
