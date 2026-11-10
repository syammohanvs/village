import type { VoiceLanguage } from './voiceUi';

export interface VoiceExample {
  label: string;
  phrase: string;
}

/**
 * One source for the offline example list.  The phrases are copied from
 * `shared/intents.json`, which is the catalogue the parser is built from, so
 * the words shown under a Malayalam or Hindi heading are words the parser
 * really accepts — not English shown under a translated title.
 *
 * They are deliberately available with the backend down: the home page
 * invitation and the voice panel both read this list, so a visitor can still
 * be shown what to say when the local service is not running.
 */
export const VOICE_EXAMPLES: Record<VoiceLanguage, VoiceExample[]> = {
  en: [
    { label: 'Lights on', phrase: 'lights on' },
    { label: 'Lights off', phrase: 'lights off' },
    { label: 'Water the plants', phrase: 'start irrigation' },
    { label: 'Stop watering', phrase: 'stop irrigation' },
  ],
  ml: [
    { label: 'വിളക്കുകൾ കത്തിക്കുക', phrase: 'വിളക്കുകൾ കത്തിക്കുക' },
    { label: 'വിളക്കുകൾ അണയ്ക്കുക', phrase: 'വിളക്കുകൾ അണയ്ക്കുക' },
    { label: 'നനയ്ക്കാൻ തുടങ്ങുക', phrase: 'നനയ്ക്കാൻ തുടങ്ങുക' },
    { label: 'നനയ്ക്കുന്നത് നിർത്തുക', phrase: 'നനയ്ക്കുന്നത് നിർത്തുക' },
  ],
  hi: [
    { label: 'लाइट चालू करें', phrase: 'लाइट चालू करो' },
    { label: 'लाइट बंद करें', phrase: 'लाइट बंद करो' },
    { label: 'पानी देना शुरू करें', phrase: 'पानी देना शुरू करो' },
    { label: 'पानी देना बंद करें', phrase: 'पानी देना बंद करो' },
  ],
};

export const VOICE_LANGUAGE_NAMES: Record<VoiceLanguage, string> = {
  en: 'English',
  ml: 'Malayalam',
  hi: 'Hindi',
};
