import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ChipTone } from './ui';

// A `ChipTone` is a promise that a chip can be painted in that tone.  `live` was
// declared and used by the dashboard's pills ("Model ready", "Available",
// "Generating") but no rule existed for it, so those pills silently fell back to
// the base grey chip: a colour that says "nothing is happening" under a word that
// says the opposite.  TypeScript cannot see a missing CSS class, so this guard
// reads the stylesheet itself.
//
// The Record makes the check exhaustive: adding a tone to `ChipTone` without a
// line here is a type error, and a line here without a rule fails the test.
// Read from disk rather than `?raw`: the vitest config sets `css: false`, so a
// CSS import is stubbed out and would assert against an empty string -- a guard
// that passes while checking nothing.  Tests always run from `web/frontend`
// (the package's own `npm test`), which is what this path is relative to.
const styles = readFileSync('src/styles.css', 'utf8');

const TONES: Record<ChipTone, true> = {
  live: true,
  warn: true,
  bad: true,
  neutral: true,
  gold: true,
};

describe('chip tones', () => {
  it('has a style for every tone a chip can be given', () => {
    for (const tone of Object.keys(TONES)) {
      expect(styles, `.chip--${tone} has no rule in styles.css`).toContain(`.chip--${tone}`);
    }
  });

  it('paints a live chip in the good colour rather than the muted default', () => {
    const rule = /\.chip--live\s*\{([^}]*)\}/.exec(styles)?.[1] ?? '';
    expect(rule).toContain('var(--success)');
    expect(rule).not.toContain('var(--muted)');
  });
});
