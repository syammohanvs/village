import { readFileSync } from 'node:fs';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Plant, RainTank, SolarPanel, StreetLamp, WasteBins } from './SimPictures';

// The drawings are SVG, so jsdom can see their structure but not their pixels.
// What it *can* pin is the half that matters for honesty: which parts exist for
// a given reading (an unlit LED has no halo, a tank with no probe has no water),
// and that every animated part is switched off for a reader who asked for less
// motion.  The motion itself is a stylesheet rule, so the stylesheet is read
// from disk (`?raw` asserts nothing here — the vitest config sets `css: false`).
const styles = readFileSync('src/styles.css', 'utf8');

function query(selector: string) {
  return document.querySelector(selector);
}

describe('the card pictures follow their reading', () => {
  it('shimmers the sun and haloes the LED only when it is lit', () => {
    render(<SolarPanel light={0.05} label="Solar" />);
    // A dark panel still has rays — they are simply faint — but no halo, because
    // a glow around an unlit LED would be a picture claiming current.
    expect(query('.solar-rays')).not.toBeNull();
    expect(query('.solar-led-glow')).toBeNull();
    expect(query('[data-testid="solar-led"]')?.getAttribute('fill')).toBe('#3a2020');
  });
});

describe('a lit lamp breathes, a dark one is still', () => {
  it('draws the glow group only while the lamp is on', () => {
    const { unmount } = render(<StreetLamp on={false} label="Streetlight" />);
    expect(query('.sim-picture--lamp')?.getAttribute('data-on')).toBe('false');
    expect(query('.lamp-glow')).toBeNull();
    unmount();

    render(<StreetLamp on label="Streetlight" />);
    expect(query('.sim-picture--lamp')?.getAttribute('data-on')).toBe('true');
    expect(query('.lamp-glow')).not.toBeNull();
  });
});

describe('the waste picture shows the camera and the bins it sorts', () => {
  it('draws a camera, and pulses only the bin that was named', () => {
    const { unmount } = render(<WasteBins active="plastic" label="Bins" />);
    expect(query('[data-testid="waste-camera"]')).not.toBeNull();
    expect(query('.sim-picture--bins')?.getAttribute('data-active')).toBe('plastic');
    // One halo, and it belongs to the chosen bin.
    expect(document.querySelectorAll('.bin-glow')).toHaveLength(1);
    unmount();

    render(<WasteBins active={null} label="Bins" />);
    expect(query('.sim-picture--bins')?.getAttribute('data-active')).toBe('none');
    expect(document.querySelectorAll('.bin-glow')).toHaveLength(0);
    // The camera is still there: it is the card, not the recognition.
    expect(query('[data-testid="waste-camera"]')).not.toBeNull();
  });
});

describe('the plant waters only while the pump runs', () => {
  it('draws falling water with the pump, and none without it', () => {
    const { unmount } = render(<Plant level={0.2} pumping={false} label="Plant" />);
    expect(query('.watering-drops')).toBeNull();
    unmount();

    render(<Plant level={0.2} pumping label="Plant" />);
    expect(query('.watering-drops')).not.toBeNull();
  });
});

describe('the tank shows one of its two levels, or nothing', () => {
  it('fills only for a state the two wires can report', () => {
    const { unmount } = render(<RainTank state="low" label="Tank" />);
    expect(query('.sim-picture--tank')?.getAttribute('data-state')).toBe('low');
    expect(document.querySelectorAll('rect[fill="#2f6f9f"]')).toHaveLength(1);
    unmount();

    render(<RainTank state="unknown" label="Tank" />);
    // No water at all: an unreadable tank is drawn empty and dashed rather than
    // half full, which would be a measurement nobody took.
    expect(document.querySelectorAll('rect[fill="#2f6f9f"]')).toHaveLength(0);
  });
});

describe('the motion is gentle and can be turned off', () => {
  it('breathes the animated parts through one keyframe', () => {
    for (const selector of ['.solar-rays', '.solar-led-glow', '.lamp-glow', '.bin-glow']) {
      const rule = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(styles)?.[1] ?? '';
      expect(rule, selector).toMatch(/animation:\s*sim-breathe/);
    }
    expect(styles).toMatch(/@keyframes sim-breathe\s*\{/);
  });

  it('stops every drawing for a reader who asked for less motion', () => {
    // The sheet has more than one of these blocks (the connection dot has one),
    // so this finds the one the drawings are in rather than the first.
    const blocks = [...styles.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)]
      .map((match) => match[1]);
    const drawings = blocks.find((block) => block.includes('.windmill-blades')) ?? '';
    expect(drawings, 'a reduced-motion block covering the drawings').not.toBe('');
    for (const selector of ['.solar-rays', '.solar-led-glow', '.lamp-glow', '.bin-glow']) {
      expect(drawings, selector).toContain(selector);
    }
    expect(drawings).toMatch(/animation:\s*none !important/);
  });

  it('keeps the windmill as the only full rotation', () => {
    // Everything else breathes in place; a spinning solar panel would be a
    // picture of a machine that does not exist.
    const spins = styles.match(/animation-name:\s*spin/g) ?? [];
    expect(spins).toHaveLength(1);
    const windmill = /\.windmill-blades\s*\{([^}]*)\}/.exec(styles)?.[1] ?? '';
    expect(windmill).toMatch(/animation-name:\s*spin/);
  });
});
