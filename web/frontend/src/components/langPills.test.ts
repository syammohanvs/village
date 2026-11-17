import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The language selector is three pills, not three browser-default buttons.  Its
// rules once disappeared when a large block of `styles.css` was rewritten in one
// go — every rule inside the replaced range went with it, silently, and the
// selector fell back to grey rectangles that no test could see (found
// 2026-11-17, after the voice panel was re-laid out).
//
// Read from disk rather than `?raw`: the vitest config sets `css: false`, so an
// imported stylesheet is stubbed and this would assert against an empty string.
const styles = readFileSync('src/styles.css', 'utf8');

describe('the language selector is styled', () => {
  it('keeps the pill rules the page and the panel share', () => {
    for (const rule of ['.lang-picker', '.lang-pill', '.lang-pill-label', '.lang-pill-note']) {
      expect(styles, `${rule} has no rule in styles.css`).toContain(`${rule} `);
    }
  });

  it('marks the chosen language in gold rather than leaving it grey', () => {
    const rule = /\.lang-pill\.is-on\s*\{([^}]*)\}/.exec(styles)?.[1] ?? '';
    expect(rule).toContain('var(--gold-2)');
    expect(rule).toContain('var(--gold)');
    expect(rule).not.toContain('var(--muted)');
  });
});
