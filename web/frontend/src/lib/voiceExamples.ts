import type { VoiceLanguage } from './voiceUi';

export interface VoiceExample {
  /** Short name, for the heading of the row. */
  label: string;
  /** Exactly what to say. */
  phrase: string;
  /** Plain words for what it does — never a command id. */
  explanation: string;
  /** The intent the parser reaches, so the full list can skip a repeat. */
  intent: string;
}

/**
 * The three examples the panel opens with.
 *
 * Chosen because they are the three things a visitor actually asks at an
 * exhibition — switch something, ask about water, ask about the soil — and
 * because **each one was run through the parser before it was written here**.
 * The two status questions used to be the phrasings the parser *could* read
 * rather than the ones a visitor would say ("मिट्टी की स्थिति", "മണ്ണ്
 * നനവുണ്ടോ?"); the parser now reads the natural forms, so those are shown
 * (2026-11-18).
 * `VoicePanel.test.tsx` sends every phrase in this file to the real parser, so
 * an example that stops being understood fails a test instead of quietly
 * teaching a visitor a sentence that does nothing.
 *
 * They are available with the backend down on purpose: the panel is the one
 * place a visitor is told what to say, and an empty help box during a startup
 * hiccup reads as "voice does not work".
 */
export const VOICE_EXAMPLES: Record<VoiceLanguage, VoiceExample[]> = {
  en: [
    {
      label: 'Streetlights on',
      phrase: 'Please turn on the lights.',
      explanation: 'Turns the streetlights on.',
      intent: 'LIGHTS_ON',
    },
    {
      label: 'Water in the tank',
      phrase: 'Is water available?',
      explanation: 'Tells you whether the tank has water.',
      intent: 'WATER_STATUS',
    },
    {
      label: 'Soil moisture',
      phrase: 'What is the soil moisture?',
      explanation: 'Reads how wet the soil is.',
      intent: 'SOIL_STATUS',
    },
  ],
  ml: [
    {
      label: 'വിളക്കുകൾ കത്തിക്കുക',
      phrase: 'ദയവായി വിളക്കുകൾ കത്തിക്കുക',
      explanation: 'തെരുവുവിളക്കുകൾ കത്തിക്കുന്നു.',
      intent: 'LIGHTS_ON',
    },
    {
      label: 'ടാങ്കിൽ വെള്ളം',
      phrase: 'ടാങ്കിൽ വെള്ളമുണ്ടോ?',
      explanation: 'ടാങ്കിൽ വെള്ളമുണ്ടോ എന്ന് പറയുന്നു.',
      intent: 'WATER_STATUS',
    },
    {
      label: 'മണ്ണിന്റെ ഈർപ്പം',
      phrase: 'മണ്ണിൽ എത്ര ഈർപ്പമുണ്ട്?',
      explanation: 'മണ്ണ് എത്ര നനവുണ്ടെന്ന് പറയുന്നു.',
      intent: 'SOIL_STATUS',
    },
  ],
  hi: [
    {
      label: 'लाइट चालू',
      phrase: 'कृपया लाइट चालू करें',
      explanation: 'सड़क की बत्तियाँ चालू करता है।',
      intent: 'LIGHTS_ON',
    },
    {
      label: 'टंकी में पानी',
      phrase: 'टंकी में पानी है?',
      explanation: 'बताता है कि टंकी में पानी है या नहीं।',
      intent: 'WATER_STATUS',
    },
    {
      label: 'मिट्टी की नमी',
      phrase: 'मिट्टी में कितनी नमी है?',
      explanation: 'मिट्टी कितनी गीली है, बताता है।',
      intent: 'SOIL_STATUS',
    },
  ],
};

export const VOICE_LANGUAGE_NAMES: Record<VoiceLanguage, string> = {
  en: 'English',
  ml: 'Malayalam',
  hi: 'Hindi',
};
