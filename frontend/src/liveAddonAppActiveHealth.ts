// BU23IS — ISOLATED CANDIDATE ONLY. No OS background service.
// Low-impact foreground tabs only: never perform this scan from video playback,
// Discover, Sports, Live TV (guide already owns checks), or Add-ons (owns its checks).
// An incomplete/rate-limited inventory NEVER confirms an addon-wide outage.
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { runBU23IOGuideHealthRecheck } from './liveAddonBackgroundHealth';

const INITIAL_DELAY_MS = 60 * 1000;
const RECHECK_MS = 15 * 60 * 1000;

export function isBU23ISQuietTab(pathname: string): boolean {
  const path = String(pathname || '').split('?')[0].split('#')[0].toLowerCase();
  return /^\/(?:\(tabs\)\/)?(?:library|search|profile)\/?$/.test(path);
}

// Hook is unconditionally called from TabsLayout. AppState + route gates
// are rechecked both before launching and before the asynchronous scan publishes.
export function useBU23ISAppActiveHealth(pathname: string): void {
  useEffect(() => {
    if (!isBU23ISQuietTab(pathname)) return;
    let mounted = true;
    let foreground = AppState.currentState === 'active';
    let defer: ReturnType<typeof setTimeout> | null = null;
    const active = () => mounted && foreground && isBU23ISQuietTab(pathname);
    const check = () => {
      if (active()) void runBU23IOGuideHealthRecheck(active);
    };
    const schedule = () => {
      if (defer !== null) { clearTimeout(defer); defer = null; }
      if (active()) defer = setTimeout(() => { defer = null; check(); }, INITIAL_DELAY_MS);
    };
    const listener = AppState.addEventListener('change', (state) => {
      foreground = state === 'active';
      if (foreground) schedule();
      else if (defer !== null) { clearTimeout(defer); defer = null; }
    });
    schedule();
    const interval = setInterval(check, RECHECK_MS);
    return () => {
      mounted = false;
      if (defer !== null) clearTimeout(defer);
      clearInterval(interval);
      listener.remove();
    };
  }, [pathname]);
}
