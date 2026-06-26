"""
patch_backend_v314_skip_cinemeta_year.py

V314 — Skip Cinemeta's `year` catalog (labeled "New") in discover row
generation.  Cinemeta's `year` catalog requires a year/genre extra and
returns essentially static content (TMDB doesn't refresh by-year fast),
which is why "New Movies/Series" rows have stale posters for weeks.

Cinemeta's `imdbRating` catalog (labeled "Featured") rotates daily based
on real IMDb signals — that becomes the new "Featured Movies/Series" row
automatically once `year` is dropped.

Idempotent — re-runs are no-ops once V314_DROP_CINEMETA_YEAR guard is
present in server.py.
"""
import sys
from pathlib import Path

SERVER = Path(__file__).resolve().parent / "server.py"
GUARD = "V314_DROP_CINEMETA_YEAR"

# We anchor on the early-skip check inside the addon-catalog iteration
# loop.  This line is unique in the file.
NEEDLE = "                if not catalog_type or not catalog_id:"

INJECTION = '''                # V314_DROP_CINEMETA_YEAR — Cinemeta's `year` catalog is labeled
                # "New" but returns mostly static content (requires genre/year
                # extras and TMDB doesn't churn by-year fast).  Cinemeta's
                # `imdbRating` catalog is labeled "Featured" and rotates daily —
                # dropping `year` makes "Featured" the new row automatically.
                try:
                    _v314_manifest_url = (addon.get('manifestUrl') or addon.get('url') or '').lower()
                except Exception:
                    _v314_manifest_url = ''
                if 'cinemeta' in _v314_manifest_url and catalog_id == 'year':
                    continue
                if not catalog_type or not catalog_id:'''


def main() -> int:
    if not SERVER.exists():
        print(f"[v314] {SERVER} not found", file=sys.stderr)
        return 1
    src = SERVER.read_text(encoding="utf-8")
    if GUARD in src:
        print(f"[v314] {GUARD} already present — no-op")
        return 0
    if NEEDLE not in src:
        print("[v314] anchor 'if not catalog_type or not catalog_id:' NOT FOUND", file=sys.stderr)
        return 2
    n = src.count(NEEDLE)
    if n != 1:
        print(f"[v314] anchor not unique (count={n}) — aborting", file=sys.stderr)
        return 3
    src = src.replace(NEEDLE, INJECTION, 1)
    SERVER.write_text(src, encoding="utf-8")
    print(f"[v314] patched server.py — guard '{GUARD}' now present")
    print("[v314] restart the API: docker compose restart app")
    return 0


if __name__ == "__main__":
    sys.exit(main())
