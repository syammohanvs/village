import type { VoiceLanguage } from './voiceUi';

/**
 * The voice panel's own words, in all three languages.
 *
 * Kept out of the component for two reasons: the panel renders in the language
 * chosen on the page, and every string here is checked by a test that fails
 * when a language is missing one.  Section headings are spoken to a visitor who
 * may not read English, so an untranslated heading is a broken screen rather
 * than a cosmetic gap.
 *
 * Deliberately NOT here: the replies themselves.  Those come from the parser
 * (`shared/intents.json`) or from the live frame, so the answer Sara gives and
 * the language on the buttons cannot disagree.
 */
export interface VoiceCopy {
  /** Panel title. */
  title: string;
  /** One sentence under the title. */
  intro: string;
  start: string;
  stop: string;
  /** What the microphone does if it is left alone. */
  pttHint: string;
  /** Said while the microphone is open. */
  listening: string;
  understanding: string;
  sending: string;
  /** Section heading over the sentence the visitor said or typed. */
  request: string;
  requestEmpty: string;
  /** Section heading over Sara's answer. */
  reply: string;
  replyEmpty: string;
  typed: string;
  typedHelper: string;
  send: string;
  examples: string;
  moreExamples: string;
  /** The same control once the list is open — "More examples" would be a lie. */
  fewerExamples: string;
  /** Shown in Simulation, above the control. */
  simulation: string;
  /** Where the speech is recognised.  A privacy fact, not a technical one. */
  privacy: string;
  /** The short state words beside the readiness dot and the reply. */
  states: {
    ready: string;
    simulation: string;
    offline: string;
    noMic: string;
    checking: string;
    unchecked: string;
    serviceOff: string;
    listening: string;
    understanding: string;
    sending: string;
    confirmed: string;
    answer: string;
    blocked: string;
    notConnected: string;
  };
  /** Plain words for what an example does — never a command id. */
  actions: Record<string, string>;
}

const EN: VoiceCopy = {
  title: 'Talk to Sara',
  intro: 'Ask Sara to control the village or check its status.',
  start: 'Start speaking',
  stop: 'Stop speaking',
  pttHint: 'Up to 10 seconds, then it stops by itself.',
  listening: 'Listening — speak now.',
  understanding: 'Understanding your words…',
  sending: 'Sending to the village…',
  request: 'Your request',
  requestEmpty: 'Your words will appear here.',
  reply: 'Sara’s reply',
  replyEmpty: 'Sara’s answer will appear here.',
  typed: 'Or type your request',
  typedHelper: 'You can type your request instead of speaking.',
  send: 'Send',
  examples: 'Try saying…',
  moreExamples: 'More commands',
  fewerExamples: 'Show fewer',
  simulation: 'Simulation — physical model is not controlled.',
  privacy: 'Speech is recognised on this laptop; nothing leaves it. The last few recordings are kept here so Sara can learn to hear you better.',
  states: {
    ready: 'Speech ready',
    simulation: 'Simulation',
    offline: 'Board offline',
    noMic: 'No microphone',
    checking: 'Checking speech…',
    unchecked: 'Speech not checked',
    serviceOff: 'Speech service unavailable',
    listening: 'Listening',
    understanding: 'Understanding…',
    sending: 'Sending…',
    confirmed: 'Confirmed',
    answer: 'Answer',
    blocked: 'Blocked',
    notConnected: 'Not connected',
  },
  actions: {
    LIGHTS_ON: 'Turns the streetlights on.',
    LIGHTS_OFF: 'Turns the streetlights off.',
    LIGHTS_AUTO: 'Lets the light sensor decide.',
    PUMP_AUTO: 'Hands the pump back to the readings.',
    IRRIGATION_REQUEST: 'Starts a short watering pulse.',
    IRRIGATION_STOP: 'Stops the pump.',
    // Ids, not only commands: HELP has no command, and "answers with the
    // current reading" was the wrong sentence for it.
    HELP: 'Lists everything you can say.',
    answer: 'Answers with the current reading.',
  },
};

const ML: VoiceCopy = {
  title: 'സാറയോട് സംസാരിക്കുക',
  intro: 'ഗ്രാമം നിയന്ത്രിക്കാനോ അതിന്റെ അവസ്ഥ അറിയാനോ സാറയോട് പറയുക.',
  start: 'സംസാരിക്കാൻ തുടങ്ങുക',
  stop: 'സംസാരിക്കുന്നത് നിർത്തുക',
  pttHint: 'പരമാവധി 10 സെക്കൻഡ്; പിന്നെ തനിയെ നിൽക്കും.',
  listening: 'കേൾക്കുന്നു — ഇപ്പോൾ സംസാരിക്കുക.',
  understanding: 'നിങ്ങളുടെ വാക്കുകൾ മനസ്സിലാക്കുന്നു…',
  sending: 'ഗ്രാമത്തിലേക്ക് അയയ്ക്കുന്നു…',
  request: 'നിങ്ങളുടെ അഭ്യർത്ഥന',
  requestEmpty: 'നിങ്ങളുടെ വാക്കുകൾ ഇവിടെ വരും.',
  reply: 'സാറയുടെ മറുപടി',
  replyEmpty: 'സാറയുടെ മറുപടി ഇവിടെ വരും.',
  typed: 'അല്ലെങ്കിൽ അഭ്യർത്ഥന ടൈപ്പ് ചെയ്യുക',
  typedHelper: 'സംസാരിക്കാതെ നിങ്ങൾക്ക് ടൈപ്പ് ചെയ്യാം.',
  send: 'അയയ്ക്കുക',
  examples: 'ഇത് പറഞ്ഞു നോക്കൂ…',
  moreExamples: 'കൂടുതൽ നിർദ്ദേശങ്ങൾ',
  fewerExamples: 'ചുരുക്കുക',
  simulation: 'സിമുലേഷൻ — യഥാർത്ഥ മാതൃക നിയന്ത്രിക്കപ്പെടുന്നില്ല.',
  privacy: 'സംസാരം ഈ ലാപ്ടോപ്പിൽ തന്നെ തിരിച്ചറിയുന്നു; പുറത്തേക്ക് ഒന്നും പോകുന്നില്ല. കേൾവി മെച്ചപ്പെടുത്താൻ അവസാനത്തെ കുറച്ച് റെക്കോർഡിംഗുകൾ ഇവിടെ സൂക്ഷിക്കുന്നു.',
  states: {
    ready: 'സംസാരം തയ്യാർ',
    simulation: 'സിമുലേഷൻ',
    offline: 'ബോർഡ് ഓഫ്ലൈൻ',
    noMic: 'മൈക്രോഫോൺ ഇല്ല',
    checking: 'സംസാരം പരിശോധിക്കുന്നു…',
    unchecked: 'സംസാരം പരിശോധിച്ചിട്ടില്ല',
    serviceOff: 'സംസാര സേവനം ലഭ്യമല്ല',
    listening: 'കേൾക്കുന്നു',
    understanding: 'മനസ്സിലാക്കുന്നു…',
    sending: 'അയയ്ക്കുന്നു…',
    confirmed: 'സ്ഥിരീകരിച്ചു',
    answer: 'മറുപടി',
    blocked: 'നിരസിച്ചു',
    notConnected: 'ബന്ധമില്ല',
  },
  actions: {
    LIGHTS_ON: 'തെരുവുവിളക്കുകൾ കത്തിക്കുന്നു.',
    LIGHTS_OFF: 'തെരുവുവിളക്കുകൾ അണയ്ക്കുന്നു.',
    LIGHTS_AUTO: 'വെളിച്ച സെൻസറിന് വിടുന്നു.',
    PUMP_AUTO: 'പമ്പിനെ വീണ്ടും വായനകൾക്ക് വിടുന്നു.',
    IRRIGATION_REQUEST: 'ചെറിയ നനയ്ക്കൽ തുടങ്ങുന്നു.',
    IRRIGATION_STOP: 'പമ്പ് നിർത്തുന്നു.',
    HELP: 'നിങ്ങൾക്ക് പറയാവുന്നതെല്ലാം കാണിക്കുന്നു.',
    answer: 'ഇപ്പോഴത്തെ അളവ് പറയുന്നു.',
  },
};

const HI: VoiceCopy = {
  title: 'सारा से बात करें',
  intro: 'गाँव को नियंत्रित करने या उसकी स्थिति जानने के लिए सारा से कहें।',
  start: 'बोलना शुरू करें',
  stop: 'बोलना बंद करें',
  pttHint: 'कुल 10 सेकंड, फिर अपने आप रुक जाएगा।',
  listening: 'सुन रहे हैं — अब बोलिए।',
  understanding: 'आपके शब्द समझ रहे हैं…',
  sending: 'गाँव को भेज रहे हैं…',
  request: 'आपका अनुरोध',
  requestEmpty: 'आपके शब्द यहाँ दिखाई देंगे।',
  reply: 'सारा का उत्तर',
  replyEmpty: 'सारा का उत्तर यहाँ दिखाई देगा।',
  typed: 'या अपना अनुरोध लिखें',
  typedHelper: 'बोलने के बजाय आप अपना अनुरोध लिख सकते हैं।',
  send: 'भेजें',
  examples: 'यह कहकर देखें…',
  moreExamples: 'और निर्देश',
  fewerExamples: 'कम दिखाएँ',
  simulation: 'सिमुलेशन — असली मॉडल नियंत्रित नहीं हो रहा।',
  privacy: 'आवाज़ इसी लैपटॉप पर पहचानी जाती है; बाहर कुछ नहीं जाता। सुनने की क्षमता सुधारने के लिए पिछली कुछ रिकॉर्डिंग यहीं रखी जाती हैं।',
  states: {
    ready: 'आवाज़ तैयार',
    simulation: 'सिमुलेशन',
    offline: 'बोर्ड ऑफ़लाइन',
    noMic: 'माइक्रोफ़ोन नहीं',
    checking: 'आवाज़ जाँच रहे हैं…',
    unchecked: 'आवाज़ की जाँच नहीं हुई',
    serviceOff: 'आवाज़ सेवा उपलब्ध नहीं',
    listening: 'सुन रहे हैं',
    understanding: 'समझ रहे हैं…',
    sending: 'भेज रहे हैं…',
    confirmed: 'पुष्टि हुई',
    answer: 'उत्तर',
    blocked: 'अस्वीकार',
    notConnected: 'कनेक्शन नहीं',
  },
  actions: {
    LIGHTS_ON: 'सड़क की बत्तियाँ चालू करता है।',
    LIGHTS_OFF: 'सड़क की बत्तियाँ बंद करता है।',
    LIGHTS_AUTO: 'रोशनी सेंसर पर छोड़ देता है।',
    PUMP_AUTO: 'पंप को फिर से रीडिंग पर छोड़ देता है।',
    IRRIGATION_REQUEST: 'छोटी सिंचाई शुरू करता है।',
    IRRIGATION_STOP: 'पंप बंद करता है।',
    HELP: 'आप जो कह सकते हैं, वह सब बताता है।',
    answer: 'इस समय की रीडिंग बताता है।',
  },
};

export const VOICE_COPY: Record<VoiceLanguage, VoiceCopy> = {
  en: EN,
  ml: ML,
  hi: HI,
};

/** Plain words for a parsed intent, never its command id. */
export function actionWords(copy: VoiceCopy, command: string | null | undefined): string {
  if (!command) return copy.actions.answer;
  return copy.actions[command] ?? copy.actions.answer;
}
