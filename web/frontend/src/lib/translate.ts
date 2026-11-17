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
