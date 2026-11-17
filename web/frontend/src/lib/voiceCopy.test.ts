import { describe, expect, it } from 'vitest';
import { VOICE_COPY, actionWords, type VoiceCopy } from './voiceCopy';
import { VOICE_EXAMPLES } from './voiceExamples';
import { VOICE_LANGUAGES } from './voiceUi';

/**
 * The panel's words are shown to a Class 6 child and to a judge at a distance,
 * so a missing translation is a broken screen rather than a cosmetic gap.  This
 * keeps the three languages complete and, just as importantly, keeps internal
 * command names and the old "a question never sends anything" claim out of
 * visitor-facing text (asked for 2026-11-17).
 */
const STRINGS: (keyof VoiceCopy)[] = [
  'title',
  'intro',
  'start',
  'stop',
  'pttHint',
  'listening',
  'understanding',
  'sending',
  'request',
  'requestEmpty',
  'reply',
  'replyEmpty',
  'typed',
  'typedHelper',
  'send',
  'examples',
  'moreExamples',
  'simulation',
  'privacy',
];

const STATE_KEYS: (keyof VoiceCopy['states'])[] = [
  'ready',
  'simulation',
  'offline',
  'noMic',
  'checking',
  'unchecked',
  'serviceOff',
  'listening',
  'understanding',
  'sending',
  'confirmed',
  'answer',
  'blocked',
  'notConnected',
];

/** The five things the parser can actually send, plus the answer wording. */
const ACTIONS = [
  'LIGHTS_ON',
  'LIGHTS_OFF',
  'LIGHTS_AUTO',
  'IRRIGATION_REQUEST',
  'IRRIGATION_STOP',
  'answer',
];

describe('the voice panel has words in every language', () => {
  for (const { code } of VOICE_LANGUAGES) {
    it(`is complete for ${code}`, () => {
      const copy = VOICE_COPY[code];
      expect(copy).toBeDefined();
      for (const key of STRINGS) {
        expect(typeof copy[key], `${code}.${key}`).toBe('string');
        expect((copy[key] as string).trim(), `${code}.${key}`).not.toBe('');
      }
      for (const key of STATE_KEYS) {
        expect(copy.states[key]?.trim(), `${code}.states.${key}`).toBeTruthy();
      }
      for (const key of ACTIONS) {
        expect(copy.actions[key]?.trim(), `${code}.actions.${key}`).toBeTruthy();
      }
    });
  }

  it('keeps each language distinct, so a missing translation cannot pass as one', () => {
    const english = VOICE_COPY.en;
    expect(VOICE_COPY.ml.title).not.toBe(english.title);
    expect(VOICE_COPY.hi.title).not.toBe(english.title);
    expect(VOICE_COPY.ml.states.confirmed).not.toBe(english.states.confirmed);
    expect(VOICE_COPY.hi.typed).not.toBe(english.typed);
  });
});

describe('nothing internal reaches a visitor', () => {
  it('never names a command id or a parser rule', () => {
    for (const { code } of VOICE_LANGUAGES) {
      const copy = VOICE_COPY[code];
      // The map's KEYS are command ids on purpose — they are a lookup, never
      // drawn.  What a visitor can read is every value.
      const visible = [
        ...STRINGS.map((key) => copy[key] as string),
        ...STATE_KEYS.map((key) => copy.states[key]),
        ...Object.values(copy.actions),
        ...VOICE_EXAMPLES[code].flatMap((example) => [example.phrase, example.explanation]),
      ].join(' | ');
      expect(visible, code).not.toMatch(/LIGHTS_ON|LIGHTS_OFF|LIGHTS_AUTO|IRRIGATION_/);
      expect(visible, code).not.toMatch(/sends /i);
      // The claim that was wrong: a polite question is a command.
      expect(visible, code).not.toMatch(/never sends anything/i);
    }
  });

  it('explains an action in words, and answers an unknown one honestly', () => {
    expect(actionWords(VOICE_COPY.en, 'LIGHTS_ON')).toBe('Turns the streetlights on.');
    expect(actionWords(VOICE_COPY.en, 'IRRIGATION_STOP')).toBe('Stops the pump.');
    // A status intent carries no command at all.
    expect(actionWords(VOICE_COPY.en, null)).toBe('Answers with the current reading.');
    expect(actionWords(VOICE_COPY.en, 'SOMETHING_NEW')).toBe(
      'Answers with the current reading.',
    );
  });
});

describe('the three opening examples', () => {
  for (const { code } of VOICE_LANGUAGES) {
    it(`lists three, each with a phrase and a plain explanation (${code})`, () => {
      const examples = VOICE_EXAMPLES[code];
      expect(examples).toHaveLength(3);
      for (const example of examples) {
        expect(example.phrase.trim()).not.toBe('');
        expect(example.explanation.trim()).not.toBe('');
        expect(example.explanation).not.toMatch(/[A-Z]{2,}_[A-Z]+/);
      }
      // One action and two questions, in that order — what a visitor tries.
      expect(examples.map((example) => example.intent)).toEqual([
        'LIGHTS_ON',
        'WATER_STATUS',
        'SOIL_STATUS',
      ]);
    });
  }
});
