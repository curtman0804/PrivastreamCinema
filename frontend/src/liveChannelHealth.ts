// W121ZLIVE178L: isolated Live TV feed health state machine.
// This module does not probe URLs, modify playback or filter the guide by itself.
export type FeedHealth = {
  failures: number;
  hiddenUntilMs: number;
  lastFailureMs: number;
  lastSuccessMs: number;
};
export type FeedHealthRegistry = Record<string, FeedHealth>;
export const HEALTH_HIDE_AFTER = 2;
export const HEALTH_RECHECK_MS = 15 * 60 * 1000;
export const HEALTH_FAILURE_WINDOW_MS = 60 * 60 * 1000;
export function feedKey(addonId: string, channelId: string, feedUrl: string): string {
  // Never join on display title. Do not log the full URL: it can contain tokens.
  return JSON.stringify([addonId.trim(), channelId.trim(), feedUrl.trim()]);
}
export function recordVerifiedSuccess(registry: FeedHealthRegistry, key: string, nowMs: number): FeedHealthRegistry {
  if (!key || !Number.isFinite(nowMs)) return registry;
  return { ...registry, [key]: { failures: 0, hiddenUntilMs: 0, lastFailureMs: 0, lastSuccessMs: nowMs } };
}
export function recordTerminalFailure(registry: FeedHealthRegistry, key: string, nowMs: number): FeedHealthRegistry {
  if (!key || !Number.isFinite(nowMs)) return registry;
  const previous = registry[key];
  const consecutive = previous && nowMs - previous.lastFailureMs <= HEALTH_FAILURE_WINDOW_MS && nowMs >= previous.lastFailureMs
    ? previous.failures + 1 : 1;
  return { ...registry, [key]: {
    failures: Math.min(consecutive, HEALTH_HIDE_AFTER),
    hiddenUntilMs: consecutive >= HEALTH_HIDE_AFTER ? nowMs + HEALTH_RECHECK_MS : 0,
    lastFailureMs: nowMs,
    lastSuccessMs: previous?.lastSuccessMs ?? 0,
  } };
}
export function isTemporarilyHidden(registry: FeedHealthRegistry, key: string, nowMs: number): boolean {
  const value = registry[key];
  return !!value && value.failures >= HEALTH_HIDE_AFTER && nowMs < value.hiddenUntilMs;
}
export function needsRecheck(registry: FeedHealthRegistry, key: string, nowMs: number): boolean {
  const value = registry[key];
  return !!value && value.failures >= HEALTH_HIDE_AFTER && nowMs >= value.hiddenUntilMs;
}
