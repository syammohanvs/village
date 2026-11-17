import { LANG_ORDER, type Lang } from './lang';
import { MESSAGES, type MessageKey } from './messages';

export type Vars = Record<string, string | number>;

/**
 * Fill `{placeholders}` in one translated sentence.
 *
 * A placeholder with no value is left as written rather than printed as
 * "undefined": a visible `{percent}` is a bug report, an empty gap is silently
 * wrong. `messages.test.ts` also fails the build when the three languages of a
 * key disagree about which placeholders they take.
 */
export function fillTemplate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/**
 * Is this string a key the table holds?
 *
 * The controller's refusals arrive as codes (`IRRIGATION_BLOCKED_SOIL_WET`),
 * and most of them have a translated sentence while some do not.  A lookup that
 * cannot say "I do not know this one" would print the key on screen, so the
 * caller asks first and falls back to a general sentence.
 */
export function hasMessage(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(MESSAGES, key);
}

/**
 * One key, one language, **English as the fallback**.
 *
 * The fallback is why a missing translation is never a blank screen or a raw
 * key: an untranslated sentence shows in English, which a visitor can still act
 * on. `messages.test.ts` catches the gap before it ships, so this branch only
 * guards a half-finished edit.
 */
export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  const entry: readonly string[] | undefined = MESSAGES[key];
  if (!entry) return String(key);
  const index = LANG_ORDER.indexOf(lang);
  const text = entry[index] || entry[0];
  return fillTemplate(text ?? entry[0], vars);
}
