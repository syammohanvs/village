import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A filled button promises a colour.  `.btn:hover:not(:disabled)` is a class and
// two pseudo-classes, so it used to beat `.btn--gold` outright and replace the
// gold fill with `rgba(255, 255, 255, 0.07)` — a near-transparent wash over the
// dark card, under the dark-brown label.  The sign-in button read as turning
// black on hover (reported 2026-11-17).
//
// TypeScript cannot see the cascade, so this reads the stylesheet from disk.
// (`?raw` would assert against an empty string: the vitest config sets
// `css: false`.)
const styles = readFileSync('src/styles.css', 'utf8');

const FILLED = ['btn--gold', 'btn--primary', 'btn--danger'];

describe('a filled button keeps its fill on hover', () => {
  for (const variant of FILLED) {
    it(`has its own hover rule for .${variant}`, () => {
      const rule = new RegExp(`\\.${variant}:hover[^{]*\\{([^}]*)\\}`).exec(styles)?.[1] ?? '';
      expect(rule, `.${variant} has no hover rule`).toContain('linear-gradient');
      // The neutral hover wash is what made the label unreadable.
      expect(rule).not.toContain('rgba(255, 255, 255');
    });
  }

  it('leaves the neutral button with its quiet hover', () => {
    const rule = /\.btn:hover:not\(:disabled\)\s*\{([^}]*)\}/.exec(styles)?.[1] ?? '';
    expect(rule).toContain('rgba(255, 255, 255');
  });
});
