// W121ZLANG144C — isolated alternate-source language classifier.
// No playback, stream ranking, network calls, or source changes.
export type LanguageEvidence = {
  language: string;
  status: 'reported' | 'unverified';
  evidence: string[];
};
export type DubbedSourceAssessment = {
  audioLanguages: LanguageEvidence[];
  subtitleLanguages: string[];
  multiAudioHint: boolean;
  unspecifiedDubHint: boolean;
  certainty: 'filename-only';
};

const AUDIO_HINTS: Record<string,string> = {
  FRENCH: 'fr', TRUEFRENCH:'fr', VFF:'fr', VFQ:'fr',
  SPANISH:'es', LATINO:'es', CASTELLANO:'es',
  GERMAN:'de', DEUTSCH:'de',
  ITALIAN:'it', ITALIANO:'it', RUSSIAN:'ru',
  PORTUGUESE:'pt', BRAZILIAN:'pt-BR', DUBLADO:'pt-BR',
  HINDI:'hi', TAMIL:'ta', TELUGU:'te', KOREAN:'ko',
  JAPANESE:'ja', CHINESE:'zh', MANDARIN:'zh', CANTONESE:'yue',
  TURKISH:'tr', ARABIC:'ar', POLISH:'pl', DUTCH:'nl',
  CZECH:'cs', THAI:'th', INDONESIAN:'id', VIETNAMESE:'vi',
  SWEDISH:'sv', NORWEGIAN:'no', DANISH:'da',
  FINNISH:'fi', HUNGARIAN:'hu', GREEK:'el', HEBREW:'he',
  ROMANIAN:'ro', UKRAINIAN:'uk', BULGARIAN:'bg',
  ENGLISH:'en'
};
const SUB_ONLY = {VOSTFR:'fr', SUBBED:'und', SUBTITLED:'und', SUBS:'und'};
const FLAGS: Record<string,string> = {
  '🇺🇸':'en','🇬🇧':'en','🇫🇷':'fr','🇪🇸':'es','🇲🇽':'es',
  '🇩🇪':'de','🇮🇹':'it','🇧🇷':'pt-BR','🇵🇹':'pt','🇯🇵':'ja','🇰🇷':'ko'
};
const normalized = (s:string) => s.toUpperCase().replace(/[^A-Z0-9]+/g,' ');
const hasToken = (s:string, token:string) => (' '+s+' ').includes(' '+token+' ');
export function assessDubbedSource(title: string, name = ''): DubbedSourceAssessment {
  const raw = `${title || ''} ${name || ''}`;
  const tokens = normalized(raw);
  const subtitleLanguages = new Set<string>();
  const audio = new Map<string,Set<string>>();
  for (const [word, lang] of Object.entries(SUB_ONLY)) {
    if (hasToken(tokens, word)) subtitleLanguages.add(lang);
  }
  const subtitleOnly = hasToken(tokens,'VOSTFR') || hasToken(tokens,'SUBBED') ||
                       hasToken(tokens,'SUBTITLED') || hasToken(tokens,'SUBS');
  for (const [word,lang] of Object.entries(AUDIO_HINTS)) {
    if (hasToken(tokens, word)) {
      // A subtitled-only French release is not evidence of French audio.
      if (lang==='fr' && hasToken(tokens,'VOSTFR') &&
          !['FRENCH','TRUEFRENCH','VFF','VFQ'].some(w=>hasToken(tokens,w))) continue;
      if (subtitleOnly && word==='ENGLISH' && hasToken(tokens,'ENGLISH SUBS')) continue;
      if (!audio.has(lang)) audio.set(lang,new Set());
      audio.get(lang)!.add(word);
    }
  }
  for (const [flag,lang] of Object.entries(FLAGS)) {
    if (raw.includes(flag)) {
      if (!audio.has(lang)) audio.set(lang,new Set());
      audio.get(lang)!.add(flag);
    }
  }
  return {
    audioLanguages:[...audio].map(([language,evidence])=>({
      language, status:'reported' as const, evidence:[...evidence]
    })),
    subtitleLanguages:[...subtitleLanguages],
    multiAudioHint:hasToken(tokens,'MULTI') || hasToken(tokens,'DUAL AUDIO'),
    unspecifiedDubHint:hasToken(tokens,'DUBBED') || hasToken(tokens,'DUBLADO'),
    certainty:'filename-only'
  };
}
