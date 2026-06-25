"""
patch_backend_v307b_streaming_aware_release_status.py

V307b — IN CINEMA badge fix, take 2.

Targets the CURRENT release_status endpoint (V190 + V256 era, NOT the old
V188 baseline that V307a was written against).  The endpoint already
downgrades to "none" when TMDB has a past Digital release date (type=4),
but many Netflix-exclusive titles never get a type-4 entry on TMDB
(e.g. "Voicemails for Isabella" — Netflix-direct, no Digital release
recorded), so they slip through and the IN CINEMA badge stays painted.

Fix:
  Extend `_fetch_release_dates` to ALSO fetch TMDB
  `/movie/{tmdb_id}/watch/providers` and record `has_us_flatrate` (any
  US subscription provider: Netflix, Max, Disney+, Apple TV+, Hulu,
  Paramount+, Peacock, Prime Video subscription).  Add it to the cached
  triple.  Then in the final classification, treat `has_us_flatrate`
  the same as `has_past_digital` — both downgrade to "none".

Run on Hetzner:
    cd /home/choyt/PrivastreamCinema/backend
    python3 patch_backend_v307b_streaming_aware_release_status.py
    docker compose restart   # service name from `docker compose ps`

Idempotent — re-running after success is a no-op.

Verify (from anywhere):
    curl -X POST http://5.161.49.99:8001/api/movie/release_status \\
      -H "Content-Type: application/json" \\
      -d '{"imdb_ids":["tt27905291"]}'
    # Should return {"tt27905291":"none"} after V307b
    # (was {"tt27905291":"in_cinemas"} before)

Cache invalidation: V307b uses cache key prefix `v307:rs:` instead of
`v256:rs:` so old wrong verdicts are not reused.  Old keys expire on
their own 6-h TTL.
"""
import sys
from pathlib import Path

SERVER = Path(__file__).resolve().parent / "server.py"
GUARD = "V307B_WATCH_PROVIDERS_OVERRIDE"

# Anchor 1: the existing _fetch_release_dates function signature line
NEEDLE_FN = '''    async def _fetch_release_dates(client, imdb_id: str):
        """Returns dict {has_past_digital: bool, has_active_theatrical: bool}."""'''

REPLACE_FN = '''    async def _fetch_release_dates(client, imdb_id: str):
        """V307B_WATCH_PROVIDERS_OVERRIDE — also reports has_us_flatrate so
        Netflix-exclusive titles that lack a TMDB Digital release date
        still downgrade out of the IN CINEMA badge.
        Returns dict {has_past_digital, has_active_theatrical, has_us_flatrate}."""'''

# Anchor 2: the inner return value building
NEEDLE_INNER_RET = '''            return imdb_id, {
                "has_past_digital": has_past_digital,
                "has_active_theatrical": has_active_theatrical,
            }
        except Exception:
            return imdb_id, {"has_past_digital": False, "has_active_theatrical": False}'''

REPLACE_INNER_RET = '''            # V307B — extra watch/providers call for has_us_flatrate
            has_us_flatrate = False
            try:
                rp = await client.get(
                    f"https://api.themoviedb.org/3/movie/{tmdb_id}/watch/providers",
                    params={"api_key": tmdb_key},
                )
                if rp.status_code == 200:
                    wp = rp.json() or {}
                    us = ((wp.get("results") or {}).get("US") or {})
                    fl = us.get("flatrate") or []
                    if isinstance(fl, list) and len(fl) > 0:
                        has_us_flatrate = True
            except Exception:
                pass
            return imdb_id, {
                "has_past_digital": has_past_digital,
                "has_active_theatrical": has_active_theatrical,
                "has_us_flatrate": has_us_flatrate,
            }
        except Exception:
            return imdb_id, {"has_past_digital": False, "has_active_theatrical": False, "has_us_flatrate": False}'''

# Anchor 3: cache namespace bump so stale v256 entries don't poison V307b
NEEDLE_CACHE_GET = 'c = await cache_get(f"v256:rs:{i}")'
REPLACE_CACHE_GET = 'c = await cache_get(f"v307:rs:{i}")'

NEEDLE_CACHE_HAS = 'if isinstance(c, dict) and "has_past_digital" in c:'
REPLACE_CACHE_HAS = 'if isinstance(c, dict) and "has_us_flatrate" in c:'  # require new key

NEEDLE_CACHE_SET = 'await cache_set(f"v256:rs:{imdb_id}", rd, 21600)  # 6 h'
REPLACE_CACHE_SET = 'await cache_set(f"v307:rs:{imdb_id}", rd, 21600)  # 6 h (V307b)'

# Anchor 4: final classification — has_us_flatrate also downgrades
NEEDLE_CLASSIFY = '''        rd = fetched_rd.get(i) or cached_rd.get(i) or {}
        has_past_digital = bool(rd.get("has_past_digital"))
        has_active_theatrical = bool(rd.get("has_active_theatrical"))
        if has_past_digital:
            out[i] = "none"
        elif (i in np_set) or has_active_theatrical:
            out[i] = "in_cinemas"
        else:
            out[i] = "none"'''

REPLACE_CLASSIFY = '''        rd = fetched_rd.get(i) or cached_rd.get(i) or {}
        has_past_digital = bool(rd.get("has_past_digital"))
        has_active_theatrical = bool(rd.get("has_active_theatrical"))
        has_us_flatrate = bool(rd.get("has_us_flatrate"))  # V307B
        if has_past_digital or has_us_flatrate:
            out[i] = "none"
        elif (i in np_set) or has_active_theatrical:
            out[i] = "in_cinemas"
        else:
            out[i] = "none"'''


def patch_once(src: str, needle: str, replacement: str, label: str) -> tuple[str, bool]:
    if needle not in src:
        print(f"[v307b] anchor '{label}' NOT FOUND", file=sys.stderr)
        return src, False
    if src.count(needle) != 1:
        print(f"[v307b] anchor '{label}' is not unique (count={src.count(needle)})", file=sys.stderr)
        return src, False
    return src.replace(needle, replacement, 1), True


def main() -> int:
    if not SERVER.exists():
        print(f"[v307b] {SERVER} not found", file=sys.stderr)
        return 1
    src = SERVER.read_text(encoding="utf-8")
    if GUARD in src:
        print(f"[v307b] {GUARD} already present — no-op")
        return 0

    edits = [
        (NEEDLE_FN, REPLACE_FN, "_fetch_release_dates docstring"),
        (NEEDLE_INNER_RET, REPLACE_INNER_RET, "_fetch_release_dates return blocks"),
        (NEEDLE_CACHE_GET, REPLACE_CACHE_GET, "cache_get key v256→v307"),
        (NEEDLE_CACHE_HAS, REPLACE_CACHE_HAS, "cache shape check"),
        (NEEDLE_CACHE_SET, REPLACE_CACHE_SET, "cache_set key v256→v307"),
        (NEEDLE_CLASSIFY, REPLACE_CLASSIFY, "classification block"),
    ]
    for needle, replacement, label in edits:
        src, ok = patch_once(src, needle, replacement, label)
        if not ok:
            print("[v307b] aborting — NOTHING WRITTEN", file=sys.stderr)
            return 2

    SERVER.write_text(src, encoding="utf-8")
    print(f"[v307b] patched server.py — guard '{GUARD}' now present")
    print("[v307b] restart the API service to pick up the change")
    return 0


if __name__ == "__main__":
    sys.exit(main())
