// W121ZVOICE143B: isolated voiceover cue scheduler. No player imports or native dependencies.
// Not connected to playback until a separate runtime-tested integration is approved.
export type VoiceCue = { start: number; end: number; text: string };
export type VoiceSink = {
  speak: (text: string) => void | Promise<void>;
  stop: () => void | Promise<void>;
};
export type VoiceStatus = {
  enabled: boolean;
  playing: boolean;
  positionMs: number;
  sourceKey: string;
};

const clean = (text: string): string => String(text || '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/\{\\[^}]*\}/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export function createVoiceoverScheduler(sink: VoiceSink) {
  let cues: VoiceCue[] = [];
  let enabled = false;
  let playing = false;
  let lastPosition = -1;
  let lastIndex = -1;
  let sourceKey = '';
  let generation = 0;

  const stop = () => { generation++; void Promise.resolve(sink.stop()).catch(() => {}); };
  const reset = () => { stop(); lastIndex = -1; lastPosition = -1; };
  return {
    setSource(key: string, incoming: VoiceCue[]) {
      reset();
      sourceKey = key;
      cues = incoming.filter(c => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start && clean(c.text))
        .sort((a, b) => a.start - b.start);
    },
    setEnabled(next: boolean) { if (enabled !== next) { enabled = next; reset(); } },
    setPlaying(next: boolean) { if (playing !== next) { playing = next; if (!next) reset(); } },
    updatePosition(positionMs: number) {
      if (!Number.isFinite(positionMs)) return;
      if (lastPosition >= 0 && (positionMs < lastPosition - 700 || positionMs > lastPosition + 3500)) {
        reset(); // seek/discontinuity; never play stale queued speech
      }
      lastPosition = positionMs;
      if (!enabled || !playing || !sourceKey) return;
      const idx = cues.findIndex(c => c.start <= positionMs && positionMs < c.end);
      if (idx < 0 || idx === lastIndex) return;
      stop();
      lastIndex = idx;
      const spoken = clean(cues[idx].text);
      const token = generation;
      if (spoken) {
        // Sink can be async; guard against a later reset cancelling the cue.
        Promise.resolve().then(() => { if (token === generation) return sink.speak(spoken); }).catch(() => {});
      }
    },
    clear() { reset(); cues = []; sourceKey = ''; playing = false; enabled = false; },
    status(): VoiceStatus { return { enabled, playing, positionMs: lastPosition, sourceKey }; },
  };
}
