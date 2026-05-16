"""patch_backend_v55b.py — Fix the slice block that V55 missed.

V55 set the function signature and cache key correctly but couldn't find the
exact addons.find() block (probably whitespace differs). This finds the
addons.find line via regex and inserts the slice/hasMore logic right after.

Run inside the container:
    docker exec privastream-app python /app/patch_backend_v55b.py
    docker restart privastream-app
"""
import os
import re
import time
import sys

SRC = "/app/backend/server.py"
MARKER = "PATCH_V55_SLICE"

if not os.path.exists(SRC):
    print(f"ERROR: {SRC} not found.")
    sys.exit(1)

with open(SRC, "r", encoding="utf-8") as f:
    text = f.read()

if MARKER in text:
    print("[OK] V55b slice already applied.")
    sys.exit(0)

bak = f"{SRC}.bak.v55b.{int(time.time())}"
with open(bak, "w", encoding="utf-8") as f:
    f.write(text)
print(f"[info] backup → {bak}")

# Find the addons = await db.addons.find(...).to_list(100) line inside get_discover.
# We know get_discover begins at "async def get_discover(".
disc_idx = text.find("async def get_discover(")
if disc_idx < 0:
    print("[FAIL] get_discover function not found")
    sys.exit(1)

# Find the addons assignment after it (regex matches whitespace + various forms).
pattern = re.compile(
    r'(    addons\s*=\s*await\s+db\.addons\.find\([^\n]+\)\.sort\([^\n]+\)\.to_list\(\d+\))',
    re.MULTILINE
)
match = pattern.search(text, pos=disc_idx)
if not match:
    print("[FAIL] could not regex-match the addons.find line")
    print("       Showing next 30 lines after get_discover for inspection:")
    sample = text[disc_idx:disc_idx + 2000].splitlines()[:30]
    for i, line in enumerate(sample, 1):
        print(f"  L+{i}: {line}")
    sys.exit(1)

orig_line = match.group(1)
end_pos = match.end()
print(f"[info] matched line: {orig_line.strip()[:80]}...")

# Insert: replace `    addons = await ...` with our paginated version,
# and inject result hasMore/skip/limit fields immediately after the existing
# `result = {` block (which we'll detect by looking ahead).
new_block = (
    "    addons_all = " + orig_line.strip().split("=", 1)[1].strip()
    + "  # PATCH_V55_SLICE\n"
    "    total_addons = len(addons_all)\n"
    "    addons = addons_all[skip:skip + limit] if limit < 999 else addons_all[skip:]"
)

text_new = text[:match.start()] + new_block + text[end_pos:]

# Now find the result = { ... } block right after and inject extra fields.
result_pattern = re.compile(
    r'(    result\s*=\s*\{\s*\n\s*"continueWatching"\s*:\s*\[\s*\]\s*,\s*\n\s*"services"\s*:\s*\{\s*\}\s*\n\s*\})',
    re.MULTILINE
)
rmatch = result_pattern.search(text_new, pos=match.start())
if not rmatch:
    # Try more lenient
    result_pattern2 = re.compile(
        r'(    result\s*=\s*\{[^}]*"services"\s*:\s*\{\s*\}[^}]*\})',
        re.MULTILINE
    )
    rmatch = result_pattern2.search(text_new, pos=match.start())

if not rmatch:
    print("[FAIL] could not match the result = {...} block")
    sys.exit(1)

old_result = rmatch.group(1)
new_result = (
    '    result = {\n'
    '        "continueWatching": [],\n'
    '        "services": {},\n'
    '        "hasMore": (skip + len(addons)) < total_addons,  # PATCH_V55_SLICE\n'
    '        "skip": skip,\n'
    '        "limit": limit,\n'
    '        "total": total_addons,\n'
    '    }'
)
text_new = text_new[:rmatch.start()] + new_result + text_new[rmatch.end():]

# Save
with open(SRC, "w", encoding="utf-8") as f:
    f.write(text_new)

print("[OK]   addons list paginated")
print("[OK]   result block extended with hasMore/skip/limit/total")
print()
print("Now restart the container:")
print("  docker restart privastream-app")
print()
print("Verify:")
print("  sleep 12 && curl -s 'http://localhost:8001/api/discover?limit=5' | head -c 400")
print("  → should return JSON with hasMore:true and ~5 services")
