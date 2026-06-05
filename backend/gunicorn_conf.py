"""V178A — gunicorn production configuration.

Launch via:    gunicorn server:app -c gunicorn_conf.py
Or via:        bash run_server.sh   (same thing, plus venv detection)

Tuned for the FastAPI + Motor + httpx workload in server.py.
Auto-sizes workers to (2 * core_count) + 1 capped at 8 so the same
config runs well on both the current physical box and the future
Hetzner CCX23 (4 cores → 8 workers).
"""
import multiprocessing
import os

# ── Binding ────────────────────────────────────────────────────────────
# Match the existing uvicorn launch contract: 0.0.0.0:8001.  Caddy /
# kubernetes ingress / Cloudflare all sit in front of this port.
bind = os.environ.get("BIND", "0.0.0.0:8001")

# ── Workers ────────────────────────────────────────────────────────────
# UvicornWorker keeps FastAPI's async event loop.  Sync workers would
# serialize the addon fan-out — that defeats the whole architecture.
worker_class = "uvicorn.workers.UvicornWorker"
workers = int(os.environ.get("GUNICORN_WORKERS",
    min(8, (multiprocessing.cpu_count() * 2) + 1)))

# Per-worker request limits — recycle workers after this many requests
# to mitigate slow memory growth from httpx connection pools / motor
# cursor leaks.  Random jitter so they don't all restart at once.
max_requests = 2000
max_requests_jitter = 200

# ── Timeouts ───────────────────────────────────────────────────────────
# Premiumize cache-check + addon fan-out can take 20-25s legitimately.
# Setting timeout too low kills slow scrapes.  Setting too high lets
# misbehaving requests hold a worker hostage.  60s is the sweet spot.
timeout = 60
# Worker startup grace — torrent-server install on first-ever boot can
# take 90s.  Generous startup keeps the LEADER worker alive.
graceful_timeout = 30
keepalive = 5

# ── Logging ────────────────────────────────────────────────────────────
accesslog = "-"   # stdout
errorlog = "-"    # stderr
loglevel = os.environ.get("LOG_LEVEL", "info")
# Apache-style access log so Caddy / Cloudflare logs cross-correlate.
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)sus'

# ── Process naming (helps with `ps aux | grep gunicorn`) ───────────────
proc_name = "privastream-api"

# ── Preload OFF on purpose ─────────────────────────────────────────────
# We rely on the V178A_LEADER_LOCK file lock for singleton work.  Using
# --preload would share FDs across workers which complicates that.
preload_app = False
