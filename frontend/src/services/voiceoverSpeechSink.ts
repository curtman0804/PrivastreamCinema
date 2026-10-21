// W121ZVOICE143C - speech adapter, dependency injected; no player imports.
// Android's expo-speech does not support pause/resume. Stop and reschedule cues.
export type SpeechEngine = {
  speak(text: string, options?: { language?: string; rate?: number; pitch?: number; onError?: (error: unknown) => void }): void;
  stop(): Promise<void> | void;
  getAvailableVoicesAsync?: () => Promise<Array<{identifier: string; language: string; name: string}>>;
};
export function createVoiceoverSpeechSink(engine: SpeechEngine) {
  let active = true;
  let epoch = 0;
  const stop = async () => {
    epoch += 1;
    try { await engine.stop(); } catch (_) { /* normal audio unaffected */ }
  };
  return {
    async speak(text: string) {
      if (!active) return;
      const cleaned = String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!cleaned) return;
      const token = ++epoch;
      try {
        await engine.stop();
        if (!active || token !== epoch) return;
        engine.speak(cleaned.slice(0, 1000), { language: 'en-US', rate: 1.0, pitch: 1.0 });
      } catch (_) { /* fail silent, never interrupt existing media playback */ }
    },
    stop,
    async dispose() { active = false; await stop(); },
    async voices() {
      try { return await engine.getAvailableVoicesAsync?.() || []; } catch (_) { return []; }
    },
  };
}
