"""
patch_backend_v309_share_codes.py

V309 — Short Share Codes (replaces the V308 PRIVA on-device share code with
7-digit numeric codes backed by MongoDB).

What this does:
  1. Adds a MongoDB-backed share-code store:
       collection: addon_share_codes
       shape    : {code: str, url: str, created_at: datetime}
       indexes  : unique(code), index(url)
  2. Rewrites GET /api/addons/resolve-code/{code} so it consults MongoDB
     FIRST and only falls back to the AFTVnews scraper for unknown codes.
  3. Adds new endpoint  POST /api/addons/share-code  body {url}
       returns {code: "1234567"} (deterministic — same URL always returns
       the same 7-digit code; collision-safe via MongoDB unique index).

Run on Hetzner:
    cd /home/choyt/PrivastreamCinema/backend
    python3 patch_backend_v309_share_codes.py
    docker compose restart app

Verify:
    # 1. Generate a code (requires auth — run from the app or use a valid JWT)
    curl -sS -X POST http://5.161.49.99:8001/api/addons/share-code \\
      -H "Authorization: Bearer <TOKEN>" \\
      -H "Content-Type: application/json" \\
      -d '{"url":"https://v3-cinemeta.strem.io/manifest.json"}'
    # → {"code":"1234567","url":"https://v3-cinemeta.strem.io/manifest.json"}

    # 2. Resolve it back (any code returned above will work):
    curl -sS -H "Authorization: Bearer <TOKEN>" \\
      "http://5.161.49.99:8001/api/addons/resolve-code/1234567"
    # → {"url":"https://v3-cinemeta.strem.io/manifest.json","code":"1234567"}

Idempotent — re-running is a no-op once the V309_SHORT_SHARE_CODES guard
is present in server.py.
"""
import sys
from pathlib import Path

SERVER = Path(__file__).resolve().parent / "server.py"
GUARD = "V309_SHORT_SHARE_CODES"

# Replace the entire existing resolve_shortener_code endpoint with a
# MongoDB-aware version + new share-code creation endpoint.
NEEDLE = '''@api_router.get("/addons/resolve-code/{code}")
async def resolve_shortener_code(code: str, current_user: User = Depends(get_current_user)):
    """Resolve an AFTVnews short code to the actual URL"""
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
        async with httpx.AsyncClient(follow_redirects=True, timeout=10.0, headers=headers) as client:
            resp = await client.get(f"https://go.aftvnews.com/{code}")
            if resp.status_code == 200:
                import re
                html = resp.text
                match = re.search(r'Redirecting.*?to:.*?<a href="([^"]+)"', html, re.DOTALL)
                if match:
                    resolved_url = match.group(1)
                    return {"url": resolved_url, "code": code}
            
            raise HTTPException(status_code=400, detail="Could not resolve code. Make sure the code is valid.")
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Failed to resolve code {code}: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to resolve code: {str(e)}")
'''

REPLACEMENT = '''@api_router.get("/addons/resolve-code/{code}")
async def resolve_shortener_code(code: str, current_user: User = Depends(get_current_user)):
    """V309_SHORT_SHARE_CODES — resolve a share/short code to a manifest URL.

    Order of resolution:
      1. The 4 legacy hardcoded codes (Cinemeta/Netflix/Torrentio/TPB) keep
         working out of historical politeness — handled in the frontend.
      2. MongoDB-backed PrivaStream share codes (created by POST /addons/share-code).
      3. Fall back to scraping go.aftvnews.com for codes that originate
         from AFTVnews Downloader.
    """
    code_s = (code or "").strip()
    if not code_s:
        raise HTTPException(status_code=400, detail="Empty code")

    # 1. PrivaStream MongoDB share codes
    try:
        coll = await _v309_share_codes_collection()
        doc = await coll.find_one({"code": code_s})
        if doc and doc.get("url"):
            return {"url": doc["url"], "code": code_s}
    except Exception as _e:
        # DB blip — fall through to AFTVnews scraper rather than 500 the user
        logger.warning(f"[v309] mongo lookup failed for code={code_s}: {_e}")

    # 2. AFTVnews scraper (legacy)
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
        async with httpx.AsyncClient(follow_redirects=True, timeout=10.0, headers=headers) as client:
            resp = await client.get(f"https://go.aftvnews.com/{code_s}")
            if resp.status_code == 200:
                import re
                html = resp.text
                match = re.search(r'Redirecting.*?to:.*?<a href="([^"]+)"', html, re.DOTALL)
                if match:
                    resolved_url = match.group(1)
                    return {"url": resolved_url, "code": code_s}

            raise HTTPException(status_code=400, detail="Could not resolve code. Make sure the code is valid.")
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Failed to resolve code {code_s}: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to resolve code: {str(e)}")


# V309_SHORT_SHARE_CODES — MongoDB-backed share-code generation & lookup.
# Same URL ALWAYS returns the same 7-digit code (deterministic, idempotent).

class _V309ShareCodeReq(BaseModel):
    url: str


_v309_share_codes_coll_cache = None


async def _v309_share_codes_collection():
    """Return the addon_share_codes collection, creating indexes on first use."""
    global _v309_share_codes_coll_cache
    if _v309_share_codes_coll_cache is not None:
        return _v309_share_codes_coll_cache

    # Try to grab the existing app-level mongo db; fall back to a fresh client
    # if the surrounding server.py doesn't expose one under a name we know.
    coll = None
    try:
        # Common names used in this codebase
        for _name in ("db", "mongo_db", "database"):
            _db = globals().get(_name)
            if _db is not None and hasattr(_db, "addon_share_codes"):
                coll = _db.addon_share_codes
                break
    except Exception:
        coll = None

    if coll is None:
        import os
        from motor.motor_asyncio import AsyncIOMotorClient
        mongo_url = os.getenv("MONGO_URL", "mongodb://mongodb:27017")
        db_name = os.getenv("DB_NAME", "privastream")
        _client = AsyncIOMotorClient(mongo_url)
        coll = _client[db_name].addon_share_codes

    # Ensure indexes (idempotent — create_index is a no-op if it already exists)
    try:
        await coll.create_index("code", unique=True)
        await coll.create_index("url")
    except Exception as _e:
        logger.warning(f"[v309] index create failed (non-fatal): {_e}")

    _v309_share_codes_coll_cache = coll
    return coll


def _v309_normalize_url(url: str) -> str:
    """Normalize URL for deterministic codes: strip whitespace, lowercase
    scheme/host, drop trailing slash from path (but keep query)."""
    if not url:
        return ""
    s = url.strip()
    # Lowercase scheme + host only, keep path/query case intact
    try:
        from urllib.parse import urlsplit, urlunsplit
        p = urlsplit(s)
        scheme = (p.scheme or "").lower()
        netloc = (p.netloc or "").lower()
        path = (p.path or "").rstrip("/") or "/"
        s = urlunsplit((scheme, netloc, path, p.query, ""))
    except Exception:
        pass
    return s


def _v309_url_to_seed_code(url: str) -> str:
    """Deterministic 7-digit code derived from URL hash."""
    import hashlib
    norm = _v309_normalize_url(url).encode("utf-8")
    h = hashlib.sha256(norm).hexdigest()
    n = int(h, 16) % 10_000_000  # 7-digit space
    return f"{n:07d}"


@api_router.post("/addons/share-code")
async def v309_create_share_code(
    req: _V309ShareCodeReq,
    current_user: User = Depends(get_current_user),
):
    """V309_SHORT_SHARE_CODES — create (or fetch) a 7-digit share code for
    a manifest URL.  Same URL always yields the same code; collisions on
    the seed code (extremely rare given 10M space) are handled by linear
    probe until a free slot is found.
    """
    url = (req.url or "").strip()
    if not url or not url.lower().startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="A valid http(s) URL is required")

    norm = _v309_normalize_url(url)
    coll = await _v309_share_codes_collection()

    # Fast path: this exact URL already has a code → return it (idempotent).
    existing = await coll.find_one({"url": norm})
    if existing and existing.get("code"):
        return {"code": existing["code"], "url": norm}

    # Generate deterministic seed code, linear-probe on collision (different URL → same hash).
    from datetime import datetime, timezone
    seed = _v309_url_to_seed_code(norm)
    seed_n = int(seed)
    for offset in range(0, 64):  # up to 64 probes is more than enough
        candidate = f"{(seed_n + offset) % 10_000_000:07d}"
        try:
            await coll.insert_one({
                "code": candidate,
                "url": norm,
                "created_at": datetime.now(timezone.utc),
                "owner_user_id": getattr(current_user, "id", None) or getattr(current_user, "username", None),
            })
            return {"code": candidate, "url": norm}
        except Exception:
            # Likely unique-index collision on `code` — try next slot.
            clash = await coll.find_one({"code": candidate})
            if clash and clash.get("url") == norm:
                return {"code": candidate, "url": norm}
            continue

    raise HTTPException(status_code=503, detail="Could not allocate a share code; please try again")
'''


def main() -> int:
    if not SERVER.exists():
        print(f"[v309] {SERVER} not found", file=sys.stderr)
        return 1
    src = SERVER.read_text(encoding="utf-8")
    if GUARD in src:
        print(f"[v309] {GUARD} already present — no-op")
        return 0
    if NEEDLE not in src:
        print("[v309] anchor (existing resolve-code endpoint) NOT FOUND", file=sys.stderr)
        print("[v309] aborting — NOTHING WRITTEN", file=sys.stderr)
        return 2
    if src.count(NEEDLE) != 1:
        print(f"[v309] anchor not unique (count={src.count(NEEDLE)})", file=sys.stderr)
        return 3
    src = src.replace(NEEDLE, REPLACEMENT, 1)
    SERVER.write_text(src, encoding="utf-8")
    print(f"[v309] patched server.py — guard '{GUARD}' now present")
    print("[v309] restart the API: docker compose restart app")
    return 0


if __name__ == "__main__":
    sys.exit(main())
