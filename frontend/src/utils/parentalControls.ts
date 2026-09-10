// V704_PARENTAL_CONTROLS
// User-scoped local parental-control persistence.
// The four-digit PIN itself is NEVER stored. Only a salted SHA-256
// verification value is retained.
//
// This is an application-level parental gate, not a substitute for
// full device encryption or OS-level parental controls.

import * as Crypto from 'expo-crypto';
import AsyncStorage from './mmkvStorage';

const PIN_KEY_PREFIX = '@ps_parental_pin_v1';
const ADULT_KEY_PREFIX = '@ps_adult_content_v1';
const PARENTAL_MODE_KEY_PREFIX = '@ps_parental_mode_v1';

type PinRecord = {
  version: 1;
  salt: string;
  hash: string;
};

async function getUsername(): Promise<string> {
  try {
    const raw = await AsyncStorage.getItem('user');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.username) {
        return String(parsed.username).trim().toLowerCase();
      }
    }
  } catch (_) {}

  return '__anon__';
}

async function scopedKey(prefix: string): Promise<string> {
  return `${prefix}:${await getUsername()}`;
}

function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function digestPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${salt}:${pin}`,
    { encoding: Crypto.CryptoEncoding.HEX }
  );
}

export async function isParentalPinConfigured(): Promise<boolean> {
  try {
    const key = await scopedKey(PIN_KEY_PREFIX);
    const raw = await AsyncStorage.getItem(key);

    if (!raw) return false;

    const parsed = JSON.parse(raw) as PinRecord;

    return (
      parsed?.version === 1 &&
      typeof parsed?.salt === 'string' &&
      parsed.salt.length > 0 &&
      typeof parsed?.hash === 'string' &&
      parsed.hash.length > 0
    );
  } catch (_) {
    return false;
  }
}

export async function setParentalPin(pin: string): Promise<void> {
  if (!isValidPin(pin)) {
    throw new Error('PIN must contain exactly four digits.');
  }

  const random = await Crypto.getRandomBytesAsync(16);
  const salt = bytesToHex(random);
  const hash = await digestPin(pin, salt);

  const record: PinRecord = {
    version: 1,
    salt,
    hash,
  };

  const key = await scopedKey(PIN_KEY_PREFIX);
  await AsyncStorage.setItem(key, JSON.stringify(record));
}

export async function verifyParentalPin(pin: string): Promise<boolean> {
  if (!isValidPin(pin)) return false;

  try {
    const key = await scopedKey(PIN_KEY_PREFIX);
    const raw = await AsyncStorage.getItem(key);

    if (!raw) return false;

    const parsed = JSON.parse(raw) as PinRecord;

    if (
      parsed?.version !== 1 ||
      !parsed?.salt ||
      !parsed?.hash
    ) {
      return false;
    }

    const candidate = await digestPin(pin, parsed.salt);

    return candidate === parsed.hash;
  } catch (_) {
    return false;
  }
}

export async function removeParentalPin(): Promise<void> {
  const key = await scopedKey(PIN_KEY_PREFIX);
  await AsyncStorage.removeItem(key);
}

export async function getAdultContentEnabled(): Promise<boolean> {
  try {
    const key = await scopedKey(ADULT_KEY_PREFIX);
    return (await AsyncStorage.getItem(key)) === '1';
  } catch (_) {
    return false;
  }
}

export async function setAdultContentEnabled(
  enabled: boolean
): Promise<void> {
  const key = await scopedKey(ADULT_KEY_PREFIX);
  await AsyncStorage.setItem(key, enabled ? '1' : '0');
}

// ============================================================
// V706C2B_PARENTAL_MODE_POLICY
//
// New Parental Mode semantics are deliberately independent from
// the legacy Adult Content preference.
//
// No legacy value is migrated or inverted.
//
// Missing new-format state defaults SAFE:
// Parental Mode ON.
// ============================================================

export async function getParentalModeEnabled(): Promise<boolean> {
  try {
    const key = await scopedKey(PARENTAL_MODE_KEY_PREFIX);
    const raw = await AsyncStorage.getItem(key);

    if (raw == null) {
      return true;
    }

    return raw === '1';
  } catch (_) {
    // Storage/read failures fail closed.
    return true;
  }
}

export async function setParentalModeEnabled(
  enabled: boolean
): Promise<void> {
  const key = await scopedKey(PARENTAL_MODE_KEY_PREFIX);
  await AsyncStorage.setItem(key, enabled ? '1' : '0');
}

function normalizeParentalCertification(
  value?: string | null
): string | null {
  const raw = String(value || '').trim().toUpperCase();

  if (!raw) {
    return null;
  }

  const aliases: Record<string, string> = {
    PG13: 'PG-13',
    NC17: 'NC-17',
    'NOT RATED': 'NR',
    'NOT-RATED': 'NR',
    UNRATED: 'NR',
    TVY: 'TV-Y',
    TVY7: 'TV-Y7',
    'TVY7-FV': 'TV-Y7-FV',
    TVG: 'TV-G',
    TVPG: 'TV-PG',
    TV14: 'TV-14',
    TVMA: 'TV-MA',
  };

  return aliases[raw] || raw;
}

export function isCertificationAllowedForParentalMode(
  contentType: string,
  certification?: string | null
): boolean {
  const kind = String(contentType || '')
    .trim()
    .toLowerCase();

  const rating =
    normalizeParentalCertification(certification);

  // Locked policy:
  // unknown / missing / NR / Unrated is blocked.
  if (!rating || rating === 'NR') {
    return false;
  }

  if (kind === 'movie') {
    return [
      'G',
      'PG',
      'PG-13',
    ].includes(rating);
  }

  if (kind === 'series') {
    return [
      'TV-Y',
      'TV-Y7',
      'TV-Y7-FV',
      'TV-G',
      'TV-PG',
      'TV-14',
    ].includes(rating);
  }

  // Movie/series certification policy does not apply to
  // unrelated types such as live-TV channels.
  return true;
}

export function areCertificationsAllowedForParentalMode(
  contentType: string,
  certifications?: string[] | null
): boolean {
  const normalized = Array.isArray(certifications)
    ? certifications
        .map((value) =>
          normalizeParentalCertification(value)
        )
        .filter(
          (value): value is string => !!value
        )
    : [];

  // No usable US certification = unknown = blocked.
  if (normalized.length === 0) {
    return false;
  }

  // If multiple US certifications exist, every one must
  // remain inside the configured ceiling.
  return normalized.every((rating) =>
    isCertificationAllowedForParentalMode(
      contentType,
      rating
    )
  );
}
