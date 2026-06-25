"""
patch_backend_v307_streaming_aware_release_status.py

V307 — Stop the IN CINEMA badge from showing on titles that have already
landed on a US streaming service (Netflix / HBO Max / Disney+ / etc.).

Symptom (user-reported):
  - "Voicemails for Isabella" (Netflix release 2026-06-19) was painting
    an IN CINEMA badge because TMDB's `release_date` was within the last
    90 days, even though the title is exclusively on Netflix.

Root cause:
  The existing /api/movie/release_status endpoint (v188) decides
  in_cinemas purely from TMDB `release_date < 90 days`.  It never asks
  TMDB whether the title is already available on a streaming service.

Fix:
  Replace the `_lookup` coroutine inside `v188_movie_release_status` with
  a streaming-aware version that ALSO calls TMDB's `/movie/{tmdb_id}/
  watch/providers` endpoint.  If `results.US.flatrate` (subscription
  streaming) is non-empty, downgrade the verdict to "none" — the user
  can watch it on Netflix/HBO/etc., so the "in cinemas" call-to-action
  is misleading.  Free with ads (`free`, `ads`) and rental (`rent`,
  `buy`) DO NOT downgrade — those don't mean it's "on streaming" in the
  way the badge implies.

Run-once on the Hetzner server (or scp + ssh):
    python3 patch_backend_v307_streaming_aware_release_status.py
    sudo systemctl restart privastream-api    # (or whatever the unit is)

The script is idempotent — re-running it after a successful patch is a no-op.
"""
import re
import sys
from pathlib import Path

SERVER = Path(__file__).resolve().parent / "server.py"

NEEDLE = '''    async def _lookup(client: httpx.AsyncClient, imdb_id: str) -> tuple[str, str]:
        try:
            r = await client.get(
                f"https://api.themoviedb.org/3/find/{imdb_id}",
                params={"api_key": tmdb_key, "external_source": "imdb_id"},
                timeout=4.0,
            )
            if r.status_code != 200:
                return imdb_id, "none"
            data = r.json() or {}
            mr = data.get("movie_results") or []
            if not mr:
                return imdb_id, "none"
            rel = (mr[0] or {}).get("release_date") or ""
            if not rel or len(rel) < 10:
                return imdb_id, "none"
            try:
                rd = datetime.fromisoformat(rel).date()
            except Exception:
                return imdb_id, "none"
            days = (today - rd).days
            return imdb_id, ("in_cinemas" if 0 <= days <= win_days else "none")
        except Exception:
            return imdb_id, "none"'''

REPLACEMENT = '''    async def _lookup(client: httpx.AsyncClient, imdb_id: str) -> tuple[str, str]:
        # V307_STREAMING_AWARE_RELEASE_STATUS — only return "in_cinemas" if
        # the title is BOTH within the cinema window AND not available on a
        # US subscription streaming service.  See patch_backend_v307_...py.
        try:
            r = await client.get(
                f"https://api.themoviedb.org/3/find/{imdb_id}",
                params={"api_key": tmdb_key, "external_source": "imdb_id"},
                timeout=4.0,
            )
            if r.status_code != 200:
                return imdb_id, "none"
            data = r.json() or {}
            mr = data.get("movie_results") or []
            if not mr:
                return imdb_id, "none"
            movie = mr[0] or {}
            rel = movie.get("release_date") or ""
            tmdb_id = movie.get("id")
            if not rel or len(rel) < 10:
                return imdb_id, "none"
            try:
                rd = datetime.fromisoformat(rel).date()
            except Exception:
                return imdb_id, "none"
            days = (today - rd).days
            if not (0 <= days <= win_days):
                return imdb_id, "none"
            # In the cinema window — now check US streaming availability.
            # If a US subscription provider has the title, downgrade to "none".
            if not tmdb_id:
                return imdb_id, "in_cinemas"
            try:
                wr = await client.get(
                    f"https://api.themoviedb.org/3/movie/{tmdb_id}/watch/providers",
                    params={"api_key": tmdb_key},
                    timeout=3.0,
                )
                if wr.status_code == 200:
                    wd = wr.json() or {}
                    us = ((wd.get("results") or {}).get("US") or {})
                    flatrate = us.get("flatrate") or []
                    if isinstance(flatrate, list) and len(flatrate) > 0:
                        # On a US subscription service — "IN CINEMA" is misleading.
                        return imdb_id, "none"
            except Exception:
                pass  # be permissive — if TMDB streaming check fails, keep in_cinemas
            return imdb_id, "in_cinemas"
        except Exception:
            return imdb_id, "none"'''

GUARD = "V307_STREAMING_AWARE_RELEASE_STATUS"


def main() -> int:
    if not SERVER.exists():
        print(f"[v307] {SERVER} not found", file=sys.stderr)
        return 1
    src = SERVER.read_text(encoding="utf-8")
    if GUARD in src:
        print(f"[v307] {GUARD} already present in server.py — no-op")
        return 0
    if NEEDLE not in src:
        print("[v307] could not find the exact _lookup block — has v188 been modified?", file=sys.stderr)
        print("[v307] NOTHING WRITTEN.  Manual inspection needed.", file=sys.stderr)
        return 2
    new_src = src.replace(NEEDLE, REPLACEMENT, 1)
    SERVER.write_text(new_src, encoding="utf-8")
    print(f"[v307] patched server.py — {len(src)} -> {len(new_src)} bytes")
    print(f"[v307] guard string '{GUARD}' is now present")
    print("[v307] restart the API service to pick up the change")
    return 0


if __name__ == "__main__":
    sys.exit(main())
