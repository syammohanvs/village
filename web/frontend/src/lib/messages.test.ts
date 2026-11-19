import { describe, expect, it } from 'vitest';
import { LANGS, LANG_ORDER, isLang } from './lang';
import { MESSAGES, type MessageKey } from './messages';
import { fillTemplate, translate } from './translate';

const KEYS = Object.keys(MESSAGES) as MessageKey[];

/** The `{name}` placeholders in one sentence, sorted, as a comparable string. */
function placeholders(text: string): string {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');
}

describe('the message table', () => {
  it('has three non-empty translations for every key', () => {
    const missing: string[] = [];
    for (const key of KEYS) {
      const entry = MESSAGES[key];
      if (entry.length !== 3) {
        missing.push(`${key}: ${entry.length} languages`);
        continue;
      }
      entry.forEach((text, index) => {
        if (!text || !text.trim()) missing.push(`${key}: empty ${LANG_ORDER[index]}`);
      });
    }
    expect(missing).toEqual([]);
  });

  it('uses the same placeholders in all three languages of a key', () => {
    // A sentence may be reworded between languages; a placeholder may not go
    // missing, or a Hindi visitor reads "{percent}" and an English one does not.
    const mismatched: string[] = [];
    for (const key of KEYS) {
      const [en, hi, ml] = MESSAGES[key];
      const wanted = placeholders(en);
      if (placeholders(hi) !== wanted) mismatched.push(`${key}: hi`);
      if (placeholders(ml) !== wanted) mismatched.push(`${key}: ml`);
    }
    expect(mismatched).toEqual([]);
  });

  it('never shows a raw key on screen', () => {
    // Every key resolves in every language to something that is not the key
    // itself — the failure mode a missing translation would otherwise produce.
    const raw: string[] = [];
    for (const { code } of LANGS) {
      for (const key of KEYS) {
        const text = translate(code, key);
        if (!text || text === key || text.includes(key)) raw.push(`${code}: ${key}`);
      }
    }
    expect(raw).toEqual([]);
  });

  it('falls back to English for a language it does not know', () => {
    // `translate` is called with a validated Lang, but the fallback is what
    // makes a half-finished translation safe, so it is pinned directly.
    expect(translate('xx' as never, 'page.talkToSara')).toBe('Talk to Sara');
    expect(translate('hi', 'page.talkToSara')).toBe('सारा से बात करें');
    expect(translate('ml', 'page.talkToSara')).toBe('സാറയോട് സംസാരിക്കുക');
  });

  it('fills placeholders and leaves an unknown one visible', () => {
    expect(fillTemplate('Soil: {state} · {percent}', { state: 'dry', percent: '21%' })).toBe(
      'Soil: dry · 21%',
    );
    // A placeholder with no value stays as written: a visible {x} is a bug
    // report, an empty gap is silently wrong.
    expect(fillTemplate('a {missing} b', {})).toBe('a {missing} b');
    // And a translated template really interpolates.
    expect(translate('ml', 'page.soilWithValue', { state: 'വരണ്ടത്', percent: '21%' })).toBe(
      'മണ്ണ്: വരണ്ടത് · 21%',
    );
  });

  it('keeps the language codes and the pill order in one place', () => {
    expect(LANG_ORDER).toEqual(['en', 'hi', 'ml']);
    // Each language name is written in its own script, in the order a visitor reads.
    expect(LANGS.map((entry) => entry.label)).toEqual(['English', 'हिन्दी', 'മലയാളം']);
    expect(isLang('hi')).toBe(true);
    expect(isLang('ta')).toBe(false);
    expect(isLang(null)).toBe(false);
  });

  it('keeps measurements unchanged in every language', () => {
    // A number and a unit are not words: 330 Ω, 1.8 V and the multiplication
    // sign read the same in all three, and translating them would change what
    // the village says it measured.
    for (const key of ['solar.liveHint', 'sim.solarHint'] as MessageKey[]) {
      for (const text of MESSAGES[key]) {
        expect(text).toContain('330');
        expect(text).toContain('Ω');
      }
    }
    // The measured threshold keeps its figure and its unit in all three.
    for (const text of MESSAGES['solar.liveHint']) expect(text).toContain('1.8 V');
    // And a template's placeholders are the same set in every language.
    expect(placeholders(MESSAGES['sort.spoken'][2])).toBe('action,category,item');
    // The wind card's numbers are the hardware, so every language carries both:
    // the resistor the ADC is across and the LED's measured forward voltage.
    for (const text of MESSAGES['wind.help']) {
      expect(text).toContain('47 Ω');
      expect(text).toContain('2.8 V');
    }
    expect(placeholders(MESSAGES['wind.noTurbine'][0])).toBe('');
  });
});
