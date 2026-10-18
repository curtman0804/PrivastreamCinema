// W121ZTEXT136A_DISPLAY_TEXT_REPAIR
// Repairs UTF-8 text that was accidentally decoded as Windows-1252/Latin-1.
// It decodes only valid UTF-8 byte sequences, so legitimate Unicode elsewhere
// in the same string (for example Beyoncé) is preserved.

const CP1252_REVERSE: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  'ƒ': 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  'ˆ': 0x88,
  '‰': 0x89,
  'Š': 0x8a,
  '‹': 0x8b,
  'Œ': 0x8c,
  'Ž': 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  'š': 0x9a,
  '›': 0x9b,
  'œ': 0x9c,
  'ž': 0x9e,
  'Ÿ': 0x9f,
};

const byteForChar = (ch: string): number | null => {
  const code = ch.charCodeAt(0);
  if (code <= 0xff) return code;
  return CP1252_REVERSE[ch] ?? null;
};

const decodeOneMojibakeLayer = (value: string): string => {
  let output = '';

  for (let i = 0; i < value.length;) {
    const firstByte = byteForChar(value[i]);
    let width = 0;

    if (firstByte !== null) {
      if (firstByte >= 0xc2 && firstByte <= 0xdf) width = 2;
      else if (firstByte >= 0xe0 && firstByte <= 0xef) width = 3;
      else if (firstByte >= 0xf0 && firstByte <= 0xf4) width = 4;
    }

    if (width > 0 && i + width <= value.length) {
      const bytes: number[] = [];
      let valid = true;

      for (let offset = 0; offset < width; offset += 1) {
        const byte = byteForChar(value[i + offset]);
        if (
          byte === null ||
          (offset > 0 && (byte < 0x80 || byte > 0xbf))
        ) {
          valid = false;
          break;
        }
        bytes.push(byte);
      }

      if (valid) {
        try {
          const escaped = bytes
            .map((byte) => `%${byte.toString(16).padStart(2, '0')}`)
            .join('');
          const decoded = decodeURIComponent(escaped);
          output += decoded;
          i += width;
          continue;
        } catch (_) {
          // Keep the original character if this is not valid UTF-8.
        }
      }
    }

    output += value[i];
    i += 1;
  }

  return output;
};

export const repairDisplayText = (value: unknown): string => {
  let current = value == null ? '' : String(value);

  // Up to four passes repairs double/triple encoded text without touching
  // already-correct strings.
  for (let pass = 0; pass < 4; pass += 1) {
    const next = decodeOneMojibakeLayer(current);
    if (next === current) break;
    current = next;
  }

  return current;
};
