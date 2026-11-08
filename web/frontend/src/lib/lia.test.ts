import { beforeEach, describe, expect, it } from 'vitest';
import {
  LIA_COPY,
  LIA_DEFAULT_PREFS,
  LIA_LANGUAGES,
  LIA_STORAGE_KEY,
  LIA_TOPIC_ORDER,
  describeVillage,
  loadLiaPrefs,
  recentVillageMessages,
  saveLiaPrefs,
} from './lia';
import { makeState } from '../test/fixtures';

const status = (options: Parameters<typeof makeState>[0] = {}) => makeState(options).status;

describe('Lia copy', () => {
  it('uses the requested welcome message in English', () => {
    expect(LIA_COPY.en.welcome).toBe(
      'Hello! I’m Lia, your village helper. I can show you how our village saves water, sorts waste and lights its streets. What would you like to do?',
    );
  });

  it('offers all six topics in every language with short, complete steps', () => {
    for (const { code } of LIA_LANGUAGES) {
      const copy = LIA_COPY[code];
      expect(copy.welcome.trim().length).toBeGreaterThan(20);
      expect(copy.maybeLater.trim().length).toBeGreaterThan(0);
      expect(copy.readAloud.trim().length).toBeGreaterThan(0);
      expect(copy.helpButton.trim().length).toBeGreaterThan(0);
      for (const id of LIA_TOPIC_ORDER) {
        const topic = copy.topics[id];
        expect(topic.id).toBe(id);
        expect(topic.label.trim().length).toBeGreaterThan(0);
        expect(topic.intro.trim().length).toBeGreaterThan(0);
        expect(topic.steps.length).toBeGreaterThanOrEqual(3);
        for (const step of topic.steps) {
          expect(step.title.trim().length).toBeGreaterThan(0);
          expect(step.text.trim().length).toBeGreaterThan(0);
        }
        if (topic.adult) expect(topic.adultNote?.trim().length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('translates the topic labels', () => {
    expect(LIA_COPY.ml.topics.water.label).not.toBe(LIA_COPY.en.topics.water.label);
    expect(LIA_COPY.hi.topics.water.label).not.toBe(LIA_COPY.en.topics.water.label);
  });
});

describe('Lia preferences', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips the language, the read-aloud choice and dismissal', () => {
    saveLiaPrefs({ dismissed: true, language: 'ml', readAloud: true });
    expect(loadLiaPrefs()).toEqual({ dismissed: true, language: 'ml', readAloud: true });
    expect(window.localStorage.getItem(LIA_STORAGE_KEY)).toContain('"language":"ml"');
  });

  it('falls back to safe defaults when the stored value is junk', () => {
    window.localStorage.setItem(LIA_STORAGE_KEY, '{"language":"xx","dismissed":"yes"}');
    const prefs = loadLiaPrefs();
    expect(prefs.language).toBe('en');
    expect(prefs.dismissed).toBe(true);

    window.localStorage.setItem(LIA_STORAGE_KEY, 'not json');
    expect(loadLiaPrefs()).toEqual(LIA_DEFAULT_PREFS);
  });
});

describe('Lia live narration', () => {
  it('reads the real soil, tank, bins, lamps and pump', () => {
    const items = describeVillage(
      { status: status(), connected: true, stale: false, ageMs: 300, demo: false },
      'en',
    );
    const text = items.map((item) => item.text).join(' ');
    expect(text).toContain('The soil is dry (28%)');
    expect(text).toContain('There is water at the low level');
    expect(text).toContain('Organic bin is about 46% full');
    expect(text).toContain('The street lights are off');
    expect(text).toContain('The pump is off');
    expect(text).not.toMatch(/litre|liter/i);
  });

  it('never invents a soil or tank reading when they are uncalibrated', () => {
    const items = describeVillage(
      {
        status: status({
          soilState: 'uncalibrated',
          soilCalibrated: false,
          soilPercent: null,
          reservoirState: 'uncalibrated',
        }),
        connected: true,
        stale: false,
        ageMs: 300,
        demo: false,
      },
      'en',
    );
    const soil = items.find((item) => item.icon === 'sensor');
    const tank = items.find((item) => item.icon === 'tank');
    expect(soil?.text).toContain('not calibrated');
    expect(soil?.text).not.toContain('%');
    expect(tank?.text).toContain('not calibrated');
  });

  it('describes an offline link without pretending the sensors answered', () => {
    const items = describeVillage(
      { status: null, connected: false, stale: false, ageMs: null, demo: false },
      'en',
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      icon: 'connection',
      text: 'The village is offline. I cannot see the sensors right now.',
    });
  });

  it('describes a stale link with its age and no live claims', () => {
    const items = describeVillage(
      { status: status(), connected: true, stale: true, ageMs: 7000, demo: false },
      'en',
    );
    expect(items).toHaveLength(1);
    expect(items[0].text).toContain('7 s');
    expect(items[0].text).not.toContain('soil');
  });

  it('marks demo mode as pretend and the pump as locked when not commissioned', () => {
    const items = describeVillage(
      {
        status: status({ pumpCommissioned: false }),
        connected: true,
        stale: false,
        ageMs: 300,
        demo: true,
      },
      'en',
    );
    const text = items.map((item) => item.text).join(' ');
    expect(text).toContain('Demo mode is on');
    expect(text).toContain('pump is still locked');
  });

  it('keeps every language free of volume claims', () => {
    for (const { code } of LIA_LANGUAGES) {
      const text = describeVillage(
        { status: status(), connected: true, stale: false, ageMs: 300, demo: false },
        code,
      )
        .map((item) => item.text)
        .join(' ');
      expect(text).not.toMatch(/litre|liter|ലിറ്റർ|लीटर/i);
    }
  });

  it('repeats the last device messages verbatim', () => {
    const withEvents = status();
    if (withEvents) {
      withEvents.recent_events = [
        { at_uptime_ms: 10, code: 'LIGHTS_ON', text: 'Streetlights switched on manually.' },
        { at_uptime_ms: 20, code: 'IRRIGATION_REQUEST', text: 'Irrigation pulse started.' },
      ];
    }
    const messages = recentVillageMessages(withEvents ?? null, 'en');
    expect(messages[0]).toBe('The last message from the village: Irrigation pulse started.');
    expect(messages[1]).toContain('Streetlights switched on manually.');
  });
});
