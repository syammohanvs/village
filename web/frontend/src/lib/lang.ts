/**
 * The three languages the exhibit speaks and shows.
 *
 * One list, in the order a visitor reads the pills, and each name is written in
 * its own script — "English", "हिन्दी", "മലയാളം".  A visitor who cannot read
 * English must still recognise their own language on the selector.
 *
 * This file deliberately has **no** React and no strings: `voiceUi` (the shared
 * language state), `messages` (the translation table) and the components all
 * import from here, so the order and the codes cannot drift apart.
 */
export type Lang = 'en' | 'hi' | 'ml';

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ml', label: 'മലയാളം' },
];

/** Every code, in the same order as `LANGS`; the message table indexes by this. */
export const LANG_ORDER: Lang[] = LANGS.map((entry) => entry.code);

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'hi' || value === 'ml';
}

/** A language name for a sentence ("No Malayalam voice on this computer"). */
export const LANG_NAMES: Record<Lang, string> = {
  en: 'English',
  hi: 'Hindi',
  ml: 'Malayalam',
};
