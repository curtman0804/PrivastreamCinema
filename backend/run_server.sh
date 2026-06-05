#!/usr/bin/env bash
# V178A — drop-in replacement for `uvicorn server:app --host 0.0.0.0 --port 8001`.
# Wherever you currently launch uvicorn (Dockerfile CMD, docker-compose
# command:, supervisor program, systemd unit, plain shell) replace the
# uvicorn line with:    bash run_server.sh
# Everything else stays the same — same port, same env vars, same logs.
set -euo pipefail

cd "$(dirname "$0")"

# Activate a venv if one exists at ./venv or ../venv (best-effort).
for vp in ./venv ../venv ./.venv ../.venv; do
  if [[ -f "$vp/bin/activate" ]]; then
    # shellcheck disable=SC1090
    source "$vp/bin/activate"
    break
  fi
done

# Make sure gunicorn is installed.  Idempotent: pip skips if present.
python -m pip install --quiet "gunicorn>=21.2.0" "uvicorn[standard]>=0.27.0" || true

# Launch.  Env-var overrides:
#   BIND=0.0.0.0:8001            (default)
#   GUNICORN_WORKERS=4           (auto-detected by default)
#   LOG_LEVEL=info               (default)
exec gunicorn server:app -c gunicorn_conf.py
