// V311_PERF_PROFILER — drop-in lightweight perf tracker for the details
// page (and any other screen we want to profile later).  Records timing
// marks in-memory and POSTs them to the backend's /api/debug/perf
// endpoint either on demand or after a 10s auto-flush window.
//
// Usage:
//   import { v311Perf } from '../../src/utils/v311_perf';
//   v311Perf.start('details');                  // resets the buffer
//   v311Perf.mark('MOUNT');                     // any number of marks
//   v311Perf.mark('FIRST_RENDER');
//   v311Perf.mark('STREAMS_READY', { count: streams.length });
//   v311Perf.flush({ contentType: 'movie' });   // posts and clears
//
// All calls are no-throw / no-await; safe to use in render bodies and
// effects without affecting business logic.
import axios from 'axios';

const BACKEND_URL =
  (typeof process !== 'undefined' && (process as any)?.env?.EXPO_PUBLIC_BACKEND_URL) ||
  '';

type Mark = { label: string; ts_ms: number; delta_ms: number; meta?: any };

class _V311Perf {
  private marks: Mark[] = [];
  private startMs = 0;
  private lastMs = 0;
  private route = '';
  private sessionId = '';
  private autoFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushed = false;

  start(route: string): void {
    try {
      this.marks = [];
      this.route = route;
      this.startMs = Date.now();
      this.lastMs = this.startMs;
      this.flushed = false;
      this.sessionId = `${this.startMs}_${Math.random().toString(36).slice(2, 8)}`;
      if (this.autoFlushTimer) clearTimeout(this.autoFlushTimer);
      this.autoFlushTimer = setTimeout(() => {
        this.flush({ reason: 'auto_10s' });
      }, 10000);
    } catch (_) { /* swallow */ }
  }

  mark(label: string, meta?: any): void {
    try {
      const now = Date.now();
      const delta = now - this.lastMs;
      const fromStart = now - this.startMs;
      this.marks.push({ label, ts_ms: fromStart, delta_ms: delta, meta });
      this.lastMs = now;
      // V311b — ALWAYS log to console (not gated by __DEV__) so logcat
      // surfaces the marks even in production OTA bundles.  These are
      // tiny strings; cost is negligible compared to the lag we're hunting.
      // eslint-disable-next-line no-console
      console.log(`[V311_PERF] ${this.route}/${label} +${delta}ms (total ${fromStart}ms)`);
    } catch (_) { /* swallow */ }
  }

  async flush(meta?: any): Promise<void> {
    if (this.flushed) return;
    this.flushed = true;
    if (this.autoFlushTimer) {
      clearTimeout(this.autoFlushTimer);
      this.autoFlushTimer = null;
    }
    const payload = {
      route: this.route,
      session_id: this.sessionId,
      marks: this.marks.slice(),
      meta: meta || {},
    };
    try {
      if (!BACKEND_URL) return;
      // Fire-and-forget; we do not block on this.
      await axios.post(`${BACKEND_URL}/api/debug/perf`, payload, {
        timeout: 4000,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (_) {
      // Best effort: drop on the floor.  Backend logs are not user-facing.
    }
  }

  // Snapshot for debug overlays / on-device viewers
  snapshot(): Mark[] {
    return this.marks.slice();
  }
}

export const v311Perf = new _V311Perf();
export default v311Perf;
