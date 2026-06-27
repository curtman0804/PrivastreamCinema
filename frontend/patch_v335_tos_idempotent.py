"""
patch_v335_tos_idempotent.py
============================
Run on Hetzner inside the backend dir (where server.py lives, e.g.
/home/choyt/PrivastreamCinema/backend).  Two changes:

  1. Make POST /api/legal/tos-accept IDEMPOTENT — if the username already
     exists in tos_acceptances, return the existing accepted_at without
     inserting a duplicate AND without sending another email.
  2. Add GET /api/legal/tos-status?username=<x> — returns
     { accepted: bool, accepted_at: str|None } so the app can check
     before showing the ToS modal.

Deploy:
  scp patch_v335_tos_idempotent.py choyt@5.161.49.99:~/PrivastreamCinema/backend/
  ssh choyt@5.161.49.99
  cd ~/PrivastreamCinema/backend
  python3 patch_v335_tos_idempotent.py
  docker restart privastream-app    # or sudo systemctl restart privastream-backend
"""
import pathlib, sys

F = pathlib.Path('server.py')
if not F.exists():
    print('[v335] ERROR: run from the dir containing server.py'); sys.exit(1)

s = F.read_text()
if 'V335_TOS_IDEMPOTENT' in s:
    print('[v335] already patched, skipping'); sys.exit(0)

# Find the START of the tos_accept handler body. We inject an early-return
# block that checks the DB for an existing record by username.
anchor = '@app.post("/api/legal/tos-accept")\nasync def v326_tos_accept(payload: _V326ToSAcceptRequest, request: _V326Request):'
if anchor not in s:
    print('[v335] ERROR: V326 tos-accept handler not found - is V326 applied?'); sys.exit(2)

# Build the new handler intro: same signature, but with an idempotency
# short-circuit BEFORE doing the insert + email.
new_intro = anchor + '''
    # V335_TOS_IDEMPOTENT - if this username has already accepted, return
    # the existing record without inserting a duplicate and without firing
    # another audit email.
    try:
        _existing = await db.tos_acceptances.find_one({"username": payload.username})
    except Exception:
        _existing = None
    if _existing:
        _at = _existing.get("accepted_at")
        if hasattr(_at, "isoformat"):
            _at_iso = _at.isoformat()
        else:
            _at_iso = str(_at) if _at else None
        return {"ok": True, "recorded_at": _at_iso, "email_status": "skipped_already_accepted"}
'''
s = s.replace(anchor, new_intro, 1)

# Now append the GET status endpoint right after the POST endpoint's
# closing — we'll just append to end of file for safety.
status_endpoint = '''

# V335_TOS_IDEMPOTENT - GET /api/legal/tos-status?username=<x>
@app.get("/api/legal/tos-status")
async def v335_tos_status(username: str):
    try:
        rec = await db.tos_acceptances.find_one({"username": username})
    except Exception as exc:
        return {"accepted": False, "error": str(exc)}
    if not rec:
        return {"accepted": False, "accepted_at": None}
    _at = rec.get("accepted_at")
    if hasattr(_at, "isoformat"):
        _at_iso = _at.isoformat()
    else:
        _at_iso = str(_at) if _at else None
    return {"accepted": True, "accepted_at": _at_iso, "tos_version": rec.get("tos_version", "v1")}
'''

if 'v335_tos_status' not in s:
    s = s.rstrip() + '\n' + status_endpoint + '\n'

F.write_text(s)
print('[v335] patched. POST is idempotent; GET /api/legal/tos-status added.')
print('[v335] Restart:  docker restart privastream-app  (or your usual systemctl call)')
