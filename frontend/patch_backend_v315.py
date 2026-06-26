"""
patch_backend_v315_cinemeta_featured.py

V315 — Real fix for the stale "New Movies/Series" rows.  V314 was a no-op
because Cinemeta uses a dedicated hardcoded list in server.py, not the
generic catalog loop.

What this changes (lines 3459-3464 of server.py):
    BEFORE:
        cinemeta_fetch = [
            ('movie', 'top', 'Popular Movies'),
            ('series', 'top', 'Popular Series'),
            ('movie', 'year', 'New Movies', 'genre=2025'),
            ('series', 'year', 'New Series', 'genre=2025'),
        ]
    AFTER:
        cinemeta_fetch = [
            ('movie', 'top', 'Popular Movies'),
            ('series', 'top', 'Popular Series'),
            ('movie', 'imdbRating', 'Featured Movies'),
            ('series', 'imdbRating', 'Featured Series'),
        ]

Why this matters:
  - The original `year` catalog requires a `genre` extra (which here was a
    hardcoded LITERAL 'genre=2025') — in 2026 that pins "New" to last year.
  - Cinemeta's `imdbRating` catalog is labeled "Featured" and rotates daily.
  - No more hardcoded year.  Caller-side `Featured Movies`/`Featured Series`
    section names override Cinemeta's default name, so the row labels are
    deterministic regardless of any future Cinemeta manifest tweak.

Idempotent — V315_CINEMETA_FEATURED guard prevents re-application.

Run on Hetzner:
    cd /home/choyt/PrivastreamCinema/backend
    python3 patch_backend_v315_cinemeta_featured.py
    docker compose restart app
    docker compose exec redis redis-cli FLUSHDB   # clear cached discover
"""
import sys
from pathlib import Path

SERVER = Path(__file__).resolve().parent / "server.py"
GUARD = "V315_CINEMETA_FEATURED"

NEEDLE = """    cinemeta_fetch = [
        ('movie', 'top', 'Popular Movies'),
        ('series', 'top', 'Popular Series'),
        ('movie', 'year', 'New Movies', 'genre=2025'),
        ('series', 'year', 'New Series', 'genre=2025'),
    ]"""

REPLACEMENT = """    # V315_CINEMETA_FEATURED — swap Cinemeta's `year` catalog (which
    # required a hardcoded `genre=2025` extra and froze "New" rows on last
    # year's bucket) for the `imdbRating` catalog (Cinemeta's "Featured",
    # no extras required, rotates daily based on IMDb signal).
    cinemeta_fetch = [
        ('movie', 'top', 'Popular Movies'),
        ('series', 'top', 'Popular Series'),
        ('movie', 'imdbRating', 'Featured Movies'),
        ('series', 'imdbRating', 'Featured Series'),
    ]"""


def main() -> int:
    if not SERVER.exists():
        print(f"[v315] {SERVER} not found", file=sys.stderr)
        return 1
    src = SERVER.read_text(encoding="utf-8")
    if GUARD in src:
        print(f"[v315] {GUARD} already present — no-op")
        return 0
    if NEEDLE not in src:
        print("[v315] anchor (cinemeta_fetch list literal) NOT FOUND", file=sys.stderr)
        return 2
    if src.count(NEEDLE) != 1:
        print(f"[v315] anchor not unique (count={src.count(NEEDLE)}) — aborting", file=sys.stderr)
        return 3
    src = src.replace(NEEDLE, REPLACEMENT, 1)
    SERVER.write_text(src, encoding="utf-8")
    print(f"[v315] patched server.py — guard '{GUARD}' now present")
    print("[v315] restart the API: docker compose restart app")
    print("[v315] clear cache:    docker compose exec redis redis-cli FLUSHDB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
