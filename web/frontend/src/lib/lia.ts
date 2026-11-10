import type { DeviceStatus } from '../types';

export type LiaLanguage = 'en' | 'ml' | 'hi';

export const LIA_LANGUAGES: { code: LiaLanguage; label: string; short: string }[] = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'ml', label: 'മലയാളം', short: 'ML' },
  { code: 'hi', label: 'हिन्दी', short: 'HI' },
];

export type LiaIconKey =
  | 'dashboard'
  | 'sensor'
  | 'water'
  | 'light'
  | 'waste'
  | 'voice'
  | 'help'
  | 'pump'
  | 'camera'
  | 'bin'
  | 'connection'
  | 'event'
  | 'tank';

export type LiaTopicId = 'around' | 'water' | 'lights' | 'waste' | 'voice' | 'help';

export interface LiaStep {
  title: string;
  text: string;
  icon: LiaIconKey;
  page?: string;
}

export interface LiaTopic {
  id: LiaTopicId;
  icon: LiaIconKey;
  label: string;
  intro: string;
  adult?: boolean;
  adultNote?: string;
  physical?: string;
  steps: LiaStep[];
}

export interface LiaCopy {
  welcome: string;
  role: string;
  homeTitle: string;
  quickModel: string;
  quickVoice: string;
  quickEvents: string;
  startSpeaking: string;
  moreTopics: string;
  childNote: string;
  maybeLater: string;
  readAloud: string;
  helpButton: string;
  back: string;
  next: string;
  previous: string;
  done: string;
  openPage: string;
  adultLabel: string;
  liveTitle: string;
  liveIntro: string;
  refresh: string;
  close: string;
  stepOf: (index: number, total: number) => string;
  speechUnavailable: string;
  voiceMissing: (language: string) => string;
  offlineHint: string;
  lastEventLabel: string;
  noEvents: string;
  viewDiary: string;
  topics: Record<LiaTopicId, LiaTopic>;
}

interface LiveCopy {
  online: string;
  stale: (age: string) => string;
  offline: string;
  demo: string;
  soilDry: (pct: string) => string;
  soilAdequate: (pct: string) => string;
  soilWet: (pct: string) => string;
  soilUncalibrated: string;
  soilUnavailable: string;
  tankAvailable: string;
  tankLow: string;
  tankUncalibrated: string;
  tankUnavailable: string;
  binOk: (bin: string, pct: string) => string;
  binsUnavailable: string;
  lightsOn: string;
  lightsOff: string;
  lightsNoSensor: string;
  pumpOn: string;
  pumpOff: string;
  pumpLocked: string;
  lastEvent: (text: string) => string;
  noEvents: string;
}

const BIN_NAMES: Record<LiaLanguage, Record<string, string>> = {
  en: { organic: 'Organic', plastic: 'Plastic', paper: 'Paper' },
  ml: { organic: 'ഓർഗാനിക്', plastic: 'പ്ലാസ്റ്റിക്', paper: 'പേപ്പർ' },
  hi: { organic: 'जैविक', plastic: 'प्लास्टिक', paper: 'कागज़' },
};

const EN: LiaCopy = {
  welcome: 'Hello! I’m Lia. I can help you explore our village.', 
  role: 'Village helper',
  homeTitle: 'What would you like to do?',
  quickModel: 'Show me the model',
  quickVoice: 'Help me use voice',
  quickEvents: 'Explain what happened',
  startSpeaking: 'Start Speaking',
  moreTopics: 'More help topics',
  childNote: 'Young children: try the physical demonstrations with an adult.',
  maybeLater: 'Maybe later',
  readAloud: 'Read aloud',
  helpButton: 'Help with Lia',
  back: 'Back',
  next: 'Next',
  previous: 'Previous',
  done: 'Back to topics',
  openPage: 'Open this page',
  adultLabel: 'With a grown-up',
  liveTitle: 'What is happening now?',
  liveIntro: 'Here is what the village can see right now.',
  refresh: 'Read it again',
  close: 'Close',
  stepOf: (index, total) => `Step ${index} of ${total}`,
  speechUnavailable: 'This browser cannot read aloud. The words are still shown.',
  voiceMissing: (language) => `This device has no ${language} voice. The words are still shown.`,
  offlineHint: 'If it says Offline, ask a grown-up to check the power and Wi-Fi.',
  lastEventLabel: 'Last message from the village',
  noEvents: 'The village has not recorded a message yet.',
  viewDiary: 'Open the village diary',
  topics: {
    around: {
      id: 'around',
      icon: 'dashboard',
      label: 'Show me the model',
      intro: 'Let me show you the village.',
      steps: [
        { title: 'Our Village', text: 'This page shows what the village is doing now and what you can try.', icon: 'dashboard', page: '/' },
        { title: 'The sensors', text: 'Here are the soil, the water tank and the light sensor.', icon: 'sensor', page: '/setup#sensors' },
        { title: 'Water and lights', text: 'The first three cards water the plants and switch the lights.', icon: 'pump', page: '/' },
        { title: 'Sort Waste', text: 'The camera looks at waste and suggests a bin.', icon: 'camera', page: '/waste' },
        { title: 'What Happened', text: 'This page lists what happened and why.', icon: 'event', page: '/activity' },
      ],
    },
    water: {
      id: 'water',
      icon: 'water',
      label: 'Water the plants',
      intro: 'The village waters plants in short, safe pulses.',
      adult: true,
      adultNote: 'Ask a grown-up to help. The pump stays disconnected until the bench test is done.',
      physical:
        'With a grown-up: put the soil probe in dry soil, add a little water, and watch the number go up.',
      steps: [
        { title: 'Check the soil', text: 'A probe in the soil measures how wet it is.', icon: 'sensor' },
        { title: 'Check the tank', text: 'Two wires tell us if water is at the low level.', icon: 'tank' },
        { title: 'Ask for water', text: 'Press Water Plants on Our Village, or say “water the plants”.', icon: 'pump', page: '/' },
        { title: 'It stops by itself', text: 'The pump runs in short pulses. Stop works at any time.', icon: 'help' },
      ],
    },
    lights: {
      id: 'lights',
      icon: 'light',
      label: 'Use the lights',
      intro: 'The village can switch the street lights by itself.',
      adult: true,
      adultNote: 'Ask a grown-up before changing any wiring.',
      physical:
        'With a grown-up: cover the light sensor with your hand and count to four. The lamps should come on.',
      steps: [
        { title: 'It watches the light', text: 'A light sensor sits near the lamps.', icon: 'sensor' },
        { title: 'Auto mode', text: 'When it gets dark, the lamps switch on. When it is bright, they switch off.', icon: 'light' },
        { title: 'You can help', text: 'Choose On or Off on the Streetlights card.', icon: 'dashboard', page: '/' },
      ],
    },
    waste: {
      id: 'waste',
      icon: 'waste',
      label: 'Sort waste',
      intro: 'The camera helps us put waste in the right bin.',
      adult: true,
      adultNote: 'Ask a grown-up to help. Never touch sharp or dirty waste.',
      physical:
        'With a grown-up: show one clean item of each kind and put it in the matching bin.',
      steps: [
        { title: 'Three bins', text: 'Organic, plastic and paper.', icon: 'bin' },
        { title: 'Show the camera', text: 'Hold one clean item in front of the camera.', icon: 'camera', page: '/waste' },
        { title: 'Read the guess', text: 'The screen suggests a bin. It is not proof of disposal.', icon: 'help' },
      ],
    },
    voice: {
      id: 'voice',
      icon: 'voice',
      label: 'Talk to the village',
      intro: 'You can speak to the village in English, Malayalam or Hindi.',
      adultNote: 'Young children can try this with an adult.',
      steps: [
        { title: 'Open Our Village', text: 'Press Start Speaking in the voice section at the top of Our Village.', icon: 'voice', page: '/' },
        { title: 'Say a short phrase', text: 'For example: “turn on the lights” or “water the plants”.', icon: 'voice' },
        { title: 'The village checks', text: 'It repeats what it heard. If it is not sure, it does nothing.', icon: 'help' },
      ],
    },
    help: {
      id: 'help',
      icon: 'help',
      label: 'Help me with a problem',
      intro: 'Let us check the village together.',
      adultNote: 'If the screen says Offline, ask a grown-up to check the power and Wi-Fi.',
      steps: [
        { title: 'Is it connected?', text: 'Look at the connection status at the top. Green means live.', icon: 'connection' },
        { title: 'Is Simulation on?', text: 'In Simulation the numbers are generated and the board does not respond.', icon: 'dashboard' },
        { title: 'Is the camera model there?', text: 'If the waste page says “Recognition model not installed”, the model files are missing.', icon: 'camera', page: '/waste' },
        { title: 'Still stuck?', text: 'Open What Happened and read the last message.', icon: 'event', page: '/activity' },
      ],
    },
  },
};

const ML: LiaCopy = {
  welcome:
    'ഹലോ! ഞാൻ ലിയ, നിങ്ങളുടെ വില്ലേജ് സഹായി. ഞങ്ങളുടെ ഗ്രാമം എങ്ങനെ വെള്ളം ലാഭിക്കുന്നു, മാലിന്യം തരംതിരിക്കുന്നു, തെരുവുവിളക്കുകൾ കത്തിക്കുന്നു എന്ന് ഞാൻ കാണിച്ചുതരാം. നിങ്ങൾക്ക് എന്ത് ചെയ്യണം?',
  role: 'ഗ്രാമ സഹായി',
  homeTitle: 'നിങ്ങൾക്ക് എന്ത് ചെയ്യണം?',
  quickModel: 'മാതൃക കാണിക്കൂ',
  quickVoice: 'ശബ്ദം ഉപയോഗിക്കാൻ സഹായിക്കൂ',
  quickEvents: 'എന്ത് സംഭവിച്ചു എന്ന് പറയൂ',
  startSpeaking: 'സംസാരിക്കാൻ തുടങ്ങുക',
  moreTopics: 'കൂടുതൽ സഹായ വിഷയങ്ങൾ',
  childNote: 'കൊച്ചുകുട്ടികൾ: ശാരീരിക പ്രവർത്തനങ്ങൾ ഒരു മുതിർന്നയാളോടൊപ്പം ചെയ്യുക.',
  maybeLater: 'പിന്നീട്',
  readAloud: 'വായിച്ചു കേൾപ്പിക്കൂ',
  helpButton: 'ലിയയുടെ സഹായം',
  back: 'തിരികെ',
  next: 'അടുത്തത്',
  previous: 'മുൻപത്തേത്',
  done: 'വിഷയങ്ങളിലേക്ക്',
  openPage: 'ഈ പേജ് തുറക്കൂ',
  adultLabel: 'ഒരു മുതിർന്നയാളോടൊപ്പം',
  liveTitle: 'ഇപ്പോൾ ഗ്രാമത്തിൽ എന്ത് നടക്കുന്നു?',
  liveIntro: 'ഗ്രാമത്തിന് ഇപ്പോൾ കാണാൻ കഴിയുന്നത് ഇതാണ്.',
  refresh: 'വീണ്ടും വായിക്കൂ',
  close: 'അടയ്ക്കൂ',
  stepOf: (index, total) => `ഘട്ടം ${index}/${total}`,
  speechUnavailable: 'ഈ ബ്രൗസറിന് വായിച്ചു കേൾപ്പിക്കാൻ കഴിയില്ല. വാക്കുകൾ ഇവിടെ കാണാം.',
  voiceMissing: (language) => `ഈ ഉപകരണത്തിൽ ${language} ശബ്ദം ഇല്ല. വാക്കുകൾ ഇവിടെ കാണാം.`,
  offlineHint: 'ഓഫ്ലൈൻ എന്ന് കാണിച്ചാൽ, പവറും വൈ-ഫൈയും പരിശോധിക്കാൻ ഒരു മുതിർന്നയാളിനോട് പറയുക.',
  lastEventLabel: 'ഗ്രാമത്തിൽ നിന്നുള്ള അവസാന സന്ദേശം',
  noEvents: 'ഗ്രാമം ഇതുവരെ ഒരു സന്ദേശവും രേഖപ്പെടുത്തിയിട്ടില്ല.',
  viewDiary: 'ഗ്രാമ ഡയറി തുറക്കൂ',
  topics: {
    around: {
      id: 'around',
      icon: 'dashboard',
      label: 'ഗ്രാമം കാണിച്ചുതരൂ',
      intro: 'ഗ്രാമത്തിലെ പേജുകൾ ഞാൻ കാണിച്ചുതരാം.',
      steps: [
        { title: 'ഡാഷ്ബോർഡ്', text: 'ഗ്രാമം ഇപ്പോൾ എന്ത് ചെയ്യുന്നു എന്ന് ഈ പേജ് കാണിക്കുന്നു.', icon: 'dashboard', page: '/' },
        { title: 'സെൻസറുകൾ', text: 'മണ്ണ്, വെള്ളം, വെളിച്ചം എന്നിവയുടെ വിവരം ഇവിടെ കാണാം.', icon: 'sensor', page: '/setup#sensors' },
        { title: 'നിയന്ത്രണങ്ങൾ', text: 'ഇവിടെ നിന്ന് ചെടികൾക്ക് വെള്ളം നൽകാം, വിളക്കുകൾ കത്തിക്കാം.', icon: 'pump', page: '/' },
        { title: 'മാലിന്യ ക്യാമറ', text: 'ക്യാമറ മാലിന്യം നോക്കി അതിന്റെ തരം ഊഹിക്കുന്നു.', icon: 'camera', page: '/waste' },
        { title: 'ഗ്രാമ ഡയറി', text: 'എന്തൊക്കെ നടന്നു എന്ന് ആക്ടിവിറ്റി പേജ് കാണിക്കുന്നു.', icon: 'event', page: '/activity' },
      ],
    },
    water: {
      id: 'water',
      icon: 'water',
      label: 'ചെടികൾക്ക് വെള്ളം നൽകൂ',
      intro: 'ഗ്രാമം ചെറിയ സുരക്ഷിതമായ പൾസുകളായി വെള്ളം നൽകുന്നു.',
      adult: true,
      adultNote: 'ഒരു മുതിർന്നയാളുടെ സഹായം തേടുക. ബെഞ്ച് ടെസ്റ്റ് കഴിയുന്നതുവരെ പമ്പ് ബന്ധിപ്പിക്കരുത്.',
      physical:
        'ഒരു മുതിർന്നയാളോടൊപ്പം: മണ്ണിലെ പ്രോബ് ഉണങ്ങിയ മണ്ണിൽ വയ്ക്കുക, അൽപ്പം വെള്ളം ചേർക്കുക, സംഖ്യ ഉയരുന്നത് കാണുക.',
      steps: [
        { title: 'മണ്ണ് നോക്കൂ', text: 'മണ്ണിലെ പ്രോബ് അതിന്റെ ഈർപ്പം അളക്കുന്നു.', icon: 'sensor' },
        { title: 'ടാങ്ക് നോക്കൂ', text: 'വെള്ളം കുറഞ്ഞ നിലയിലുണ്ടോ എന്ന് രണ്ട് കമ്പികൾ പറയുന്നു.', icon: 'tank' },
        { title: 'വെള്ളം ചോദിക്കൂ', text: 'നിയന്ത്രണങ്ങളിൽ ‘ചെടികൾക്ക് വെള്ളം’ അമർത്തുക, അല്ലെങ്കിൽ “water the plants” എന്ന് പറയുക.', icon: 'pump', page: '/' },
        { title: 'തനിയെ നിൽക്കും', text: 'പമ്പ് ചെറിയ പൾസുകളായി ഓടും. എപ്പോൾ വേണമെങ്കിലും നിർത്താം.', icon: 'help' },
      ],
    },
    lights: {
      id: 'lights',
      icon: 'light',
      label: 'വിളക്കുകൾ ഉപയോഗിക്കൂ',
      intro: 'ഗ്രാമത്തിന് തെരുവുവിളക്കുകൾ തനിയെ കത്തിക്കാം.',
      adult: true,
      adultNote: 'വയറിംഗ് മാറ്റുന്നതിന് മുൻപ് ഒരു മുതിർന്നയാളിനോട് ചോദിക്കുക.',
      physical:
        'ഒരു മുതിർന്നയാളോടൊപ്പം: വെളിച്ച സെൻസർ കൈകൊണ്ട് മൂടി നാല് എണ്ണുക. വിളക്കുകൾ കത്തണം.',
      steps: [
        { title: 'വെളിച്ചം നോക്കുന്നു', text: 'വിളക്കുകൾക്ക് സമീപം ഒരു വെളിച്ച സെൻസർ ഉണ്ട്.', icon: 'sensor' },
        { title: 'ഓട്ടോ മോഡ്', text: 'ഇരുട്ടാകുമ്പോൾ വിളക്കുകൾ കത്തും. വെളിച്ചമുള്ളപ്പോൾ അണയും.', icon: 'light' },
        { title: 'നിങ്ങൾക്കും സഹായിക്കാം', text: 'നിയന്ത്രണങ്ങളിൽ ‘വിളക്കുകൾ ഓൺ’ അല്ലെങ്കിൽ ‘ഓഫ്’ അമർത്തുക.', icon: 'dashboard', page: '/' },
      ],
    },
    waste: {
      id: 'waste',
      icon: 'waste',
      label: 'മാലിന്യം തരംതിരിക്കൂ',
      intro: 'ശരിയായ ബിന്നിൽ മാലിന്യം ഇടാൻ ക്യാമറ സഹായിക്കുന്നു.',
      adult: true,
      adultNote: 'ഒരു മുതിർന്നയാളുടെ സഹായം തേടുക. മൂർച്ചയുള്ളതോ അഴുക്കുള്ളതോ ആയ മാലിന്യം തൊടരുത്.',
      physical:
        'ഒരു മുതിർന്നയാളോടൊപ്പം: ഓരോ തരത്തിലും ഒരു വൃത്തിയുള്ള വസ്തു കാണിച്ച് ശരിയായ ബിന്നിൽ ഇടുക.',
      steps: [
        { title: 'മൂന്ന് ബിന്നുകൾ', text: 'ഓർഗാനിക്, പ്ലാസ്റ്റിക്, പേപ്പർ.', icon: 'bin' },
        { title: 'ക്യാമറയ്ക്ക് കാണിക്കൂ', text: 'ഒരു വൃത്തിയുള്ള വസ്തു ക്യാമറയ്ക്ക് മുന്നിൽ പിടിക്കുക.', icon: 'camera', page: '/waste' },
        { title: 'ഊഹം വായിക്കൂ', text: 'സ്ക്രീൻ ഒരു ഊഹം കാണിക്കും. അത് തെളിവല്ല.', icon: 'help' },
      ],
    },
    voice: {
      id: 'voice',
      icon: 'voice',
      label: 'ഗ്രാമത്തോട് സംസാരിക്കൂ',
      intro: 'ഇംഗ്ലീഷ്, മലയാളം, ഹിന്ദി എന്നിവയിൽ ഗ്രാമത്തോട് സംസാരിക്കാം.',
      adultNote: 'കൊച്ചുകുട്ടികൾ ഇത് ഒരു മുതിർന്നയാളോടൊപ്പം ചെയ്യാം.',
      steps: [
        { title: 'മൈക്രോഫോൺ അമർത്തൂ', text: 'Our Village-ന്റെ മുകളിലുള്ള ശബ്ദ വിഭാഗത്തിൽ Start Speaking അമർത്തുക.', icon: 'voice' },
        { title: 'ചെറിയ വാക്യം പറയൂ', text: 'ഉദാഹരണം: “turn on the lights” അല്ലെങ്കിൽ “water the plants”.', icon: 'voice' },
        { title: 'ഗ്രാമം പരിശോധിക്കും', text: 'കേട്ടത് അത് ആവർത്തിക്കും. ഉറപ്പില്ലെങ്കിൽ ഒന്നും ചെയ്യില്ല.', icon: 'help' },
      ],
    },
    help: {
      id: 'help',
      icon: 'help',
      label: 'പ്രശ്നം പരിഹരിക്കാൻ സഹായിക്കൂ',
      intro: 'നമുക്ക് ഒരുമിച്ച് ഗ്രാമം പരിശോധിക്കാം.',
      adultNote: 'ഓഫ്ലൈൻ എന്ന് കണ്ടാൽ, പവറും വൈ-ഫൈയും പരിശോധിക്കാൻ ഒരു മുതിർന്നയാളിനോട് പറയുക.',
      steps: [
        { title: 'കണക്ഷൻ ഉണ്ടോ?', text: 'മുകളിലെ കണക്ഷൻ സ്റ്റാറ്റസ് നോക്കുക. പച്ചയാണെങ്കിൽ ലൈവ് ആണ്.', icon: 'connection' },
        { title: 'ഡെമോ ഓണാണോ?', text: 'ഡെമോ മോഡിൽ സംഖ്യകൾ നടിക്കലാണ്.', icon: 'dashboard' },
        { title: 'ക്യാമറ മോഡൽ ഉണ്ടോ?', text: 'മാലിന്യ പേജിൽ “Recognition model not installed” എന്ന് കണ്ടാൽ മോഡൽ ഫയലുകൾ ഇല്ല.', icon: 'camera', page: '/waste' },
        { title: 'ഇപ്പോഴും പ്രശ്നമുണ്ടോ?', text: 'What Happened തുറന്ന് അവസാന സന്ദേശം വായിക്കുക.', icon: 'event', page: '/activity' },
      ],
    },
  },
};

const HI: LiaCopy = {
  welcome:
    'नमस्ते! मैं लिया हूँ, आपकी गाँव सहायक। मैं आपको दिखाऊँगी कि हमारा गाँव पानी कैसे बचाता है, कचरा कैसे अलग करता है और सड़क की बत्तियाँ कैसे जलाता है। आप क्या करना चाहेंगे?',
  role: 'गाँव सहायक',
  homeTitle: 'आप क्या करना चाहेंगे?',
  quickModel: 'मॉडल दिखाओ',
  quickVoice: 'आवाज़ का उपयोग सिखाओ',
  quickEvents: 'क्या हुआ, बताओ',
  startSpeaking: 'बोलना शुरू करें',
  moreTopics: 'और मदद के विषय',
  childNote: 'छोटे बच्चे: शारीरिक प्रदर्शन किसी बड़े के साथ करें।',
  maybeLater: 'बाद में',
  readAloud: 'पढ़कर सुनाइए',
  helpButton: 'लिया से मदद',
  back: 'पीछे',
  next: 'आगे',
  previous: 'पिछला',
  done: 'विषयों पर वापस',
  openPage: 'यह पेज खोलिए',
  adultLabel: 'किसी बड़े के साथ',
  liveTitle: 'गाँव में अभी क्या हो रहा है?',
  liveIntro: 'गाँव अभी जो देख सकता है, वह यह है।',
  refresh: 'फिर से पढ़िए',
  close: 'बंद कीजिए',
  stepOf: (index, total) => `चरण ${index}/${total}`,
  speechUnavailable: 'यह ब्राउज़र पढ़कर नहीं सुना सकता। शब्द यहाँ दिख रहे हैं।',
  voiceMissing: (language) => `इस डिवाइस में ${language} की आवाज़ नहीं है। शब्द यहाँ दिख रहे हैं।`,
  offlineHint: 'अगर ऑफ़लाइन दिखे, तो किसी बड़े से बिजली और वाई-फ़ाई जाँचने को कहें।',
  lastEventLabel: 'गाँव का आख़िरी संदेश',
  noEvents: 'गाँव ने अभी तक कोई संदेश दर्ज नहीं किया।',
  viewDiary: 'गाँव की डायरी खोलिए',
  topics: {
    around: {
      id: 'around',
      icon: 'dashboard',
      label: 'गाँव दिखाइए',
      intro: 'मैं आपको गाँव के पेज दिखाती हूँ।',
      steps: [
        { title: 'डैशबोर्ड', text: 'यह पेज दिखाता है कि गाँव अभी क्या कर रहा है।', icon: 'dashboard', page: '/' },
        { title: 'सेंसर', text: 'यहाँ मिट्टी, पानी की टंकी और रोशनी के सेंसर दिखते हैं।', icon: 'sensor', page: '/setup#sensors' },
        { title: 'कंट्रोल', text: 'यहाँ से पौधों को पानी दे सकते हैं या बत्तियाँ जला सकते हैं।', icon: 'pump', page: '/' },
        { title: 'कचरा कैमरा', text: 'कैमरा कचरा देखकर उसका प्रकार अनुमान लगाता है।', icon: 'camera', page: '/waste' },
        { title: 'गाँव की डायरी', text: 'एक्टिविटी पेज बताता है कि क्या और कब हुआ।', icon: 'event', page: '/activity' },
      ],
    },
    water: {
      id: 'water',
      icon: 'water',
      label: 'पौधों को पानी दीजिए',
      intro: 'गाँव छोटे-छोटे सुरक्षित स्पंदों में पानी देता है।',
      adult: true,
      adultNote: 'किसी बड़े की मदद लें। बेंच टेस्ट पूरा होने तक पंप न जोड़ें।',
      physical:
        'किसी बड़े के साथ: मिट्टी की प्रोब सूखी मिट्टी में रखें, थोड़ा पानी डालें और संख्या बढ़ते देखें।',
      steps: [
        { title: 'मिट्टी देखिए', text: 'मिट्टी में लगी प्रोब नमी नापती है।', icon: 'sensor' },
        { title: 'टंकी देखिए', text: 'दो तार बताते हैं कि कम स्तर पर पानी है या नहीं।', icon: 'tank' },
        { title: 'पानी माँगिए', text: 'कंट्रोल में ‘पौधों को पानी’ दबाइए, या “water the plants” कहिए।', icon: 'pump', page: '/' },
        { title: 'अपने आप रुकता है', text: 'पंप छोटे स्पंदों में चलता है। कभी भी रोक सकते हैं।', icon: 'help' },
      ],
    },
    lights: {
      id: 'lights',
      icon: 'light',
      label: 'बत्तियाँ चलाइए',
      intro: 'गाँव सड़क की बत्तियाँ अपने आप जला सकता है।',
      adult: true,
      adultNote: 'तार बदलने से पहले किसी बड़े से पूछें।',
      physical:
        'किसी बड़े के साथ: रोशनी सेंसर को हाथ से ढकें और चार तक गिनें। बत्तियाँ जलनी चाहिए।',
      steps: [
        { title: 'रोशनी देखता है', text: 'बत्तियों के पास एक रोशनी सेंसर है।', icon: 'sensor' },
        { title: 'ऑटो मोड', text: 'अंधेरा होने पर बत्तियाँ जलती हैं। रोशनी में बंद हो जाती हैं।', icon: 'light' },
        { title: 'आप भी मदद करें', text: 'कंट्रोल में ‘बत्तियाँ चालू’ या ‘बंद’ दबाइए।', icon: 'dashboard', page: '/' },
      ],
    },
    waste: {
      id: 'waste',
      icon: 'waste',
      label: 'कचरा अलग कीजिए',
      intro: 'कैमरा सही डिब्बे में कचरा डालने में मदद करता है।',
      adult: true,
      adultNote: 'किसी बड़े की मदद लें। तेज़ या गंदा कचरा कभी न छुएँ।',
      physical:
        'किसी बड़े के साथ: हर प्रकार की एक साफ़ चीज़ दिखाइए और सही डिब्बे में डालिए।',
      steps: [
        { title: 'तीन डिब्बे', text: 'जैविक, प्लास्टिक और कागज़।', icon: 'bin' },
        { title: 'कैमरे को दिखाइए', text: 'एक साफ़ चीज़ कैमरे के सामने रखें।', icon: 'camera', page: '/waste' },
        { title: 'अनुमान पढ़िए', text: 'स्क्रीन एक अनुमान दिखाती है। यह सबूत नहीं है।', icon: 'help' },
      ],
    },
    voice: {
      id: 'voice',
      icon: 'voice',
      label: 'गाँव से बात कीजिए',
      intro: 'आप अंग्रेज़ी, मलयालम या हिंदी में गाँव से बात कर सकते हैं।',
      adultNote: 'छोटे बच्चे इसे किसी बड़े के साथ करें।',
      steps: [
        { title: 'माइक्रोफ़ोन दबाइए', text: 'Our Village में सबसे ऊपर आवाज़ वाले हिस्से में Start Speaking दबाइए।', icon: 'voice' },
        { title: 'छोटा वाक्य कहिए', text: 'जैसे: “turn on the lights” या “water the plants”।', icon: 'voice' },
        { title: 'गाँव जाँचता है', text: 'जो सुना, वह दोहराता है। अगर पक्का न हो, तो कुछ नहीं करता।', icon: 'help' },
      ],
    },
    help: {
      id: 'help',
      icon: 'help',
      label: 'समस्या हल करने में मदद',
      intro: 'आइए गाँव को साथ में जाँचें।',
      adultNote: 'अगर ऑफ़लाइन दिखे, तो किसी बड़े से बिजली और वाई-फ़ाई जाँचने को कहें।',
      steps: [
        { title: 'कनेक्शन है?', text: 'ऊपर का कनेक्शन स्टेटस देखिए। हरा मतलब लाइव।', icon: 'connection' },
        { title: 'डेमो चालू है?', text: 'डेमो मोड में संख्याएँ नकली होती हैं।', icon: 'dashboard' },
        { title: 'कैमरा मॉडल है?', text: 'अगर कचरा पेज पर “Recognition model not installed” दिखे, तो मॉडल फ़ाइलें नहीं हैं।', icon: 'camera', page: '/waste' },
        { title: 'फिर भी अटके?', text: 'What Happened खोलकर आख़िरी संदेश पढ़िए।', icon: 'event', page: '/activity' },
      ],
    },
  },
};

export const LIA_COPY: Record<LiaLanguage, LiaCopy> = { en: EN, ml: ML, hi: HI };

// 'around' is deliberately absent: it is the first quick choice, and a second
// entry called "Show me the model" in the long list was a duplicate.
export const LIA_TOPIC_ORDER: LiaTopicId[] = ['water', 'lights', 'waste', 'voice', 'help'];

const LIVE: Record<LiaLanguage, LiveCopy> = {
  en: {
    online: 'The village is connected and sending fresh readings.',
    stale: (age) => `The village stopped sending new readings. The last one was ${age} ago.`,
    offline: 'The village is offline. I cannot see the sensors right now.',
    demo: 'Demo mode is on. These numbers are pretend.',
    soilDry: (pct) => `The soil is dry (${pct}%).`,
    soilAdequate: (pct) => `The soil has enough water (${pct}%).`,
    soilWet: (pct) => `The soil is very wet (${pct}%).`,
    soilUncalibrated: 'The soil probe is not calibrated yet. I cannot tell how wet the soil is.',
    soilUnavailable: 'The soil probe is not answering.',
    tankAvailable: 'There is water at the low level in the tank.',
    tankLow: 'The tank is low. The probes do not feel water.',
    tankUncalibrated: 'The tank probes are not calibrated yet.',
    tankUnavailable: 'The tank probes are not answering.',
    binOk: (bin, pct) => `The ${bin} bin is about ${pct}% full.`,
    binsUnavailable: 'The bin sensors are not answering.',
    lightsOn: 'The street lights are on.',
    lightsOff: 'The street lights are off.',
    lightsNoSensor: 'The light sensor is not fitted, so the lamps wait for your command.',
    pumpOn: 'The pump is running.',
    pumpOff: 'The pump is off.',
    pumpLocked: 'The pump is still locked for safety.',
    lastEvent: (text) => `The last message from the village: ${text}`,
    noEvents: 'The village has not recorded a message yet.',
  },
  ml: {
    online: 'ഗ്രാമം ബന്ധിപ്പിച്ചിരിക്കുന്നു, പുതിയ വിവരങ്ങൾ അയക്കുന്നു.',
    stale: (age) => `ഗ്രാമം പുതിയ വിവരങ്ങൾ അയക്കുന്നത് നിർത്തി. അവസാന വിവരം ${age} മുൻപ് ആയിരുന്നു.`,
    offline: 'ഗ്രാമം ഓഫ്ലൈൻ ആണ്. ഇപ്പോൾ സെൻസറുകൾ കാണാൻ കഴിയില്ല.',
    demo: 'ഡെമോ മോഡ് ഓണാണ്. ഈ സംഖ്യകൾ നടിക്കലാണ്.',
    soilDry: (pct) => `മണ്ണ് ഉണങ്ങിയിരിക്കുന്നു (${pct}%).`,
    soilAdequate: (pct) => `മണ്ണിൽ ആവശ്യത്തിന് വെള്ളമുണ്ട് (${pct}%).`,
    soilWet: (pct) => `മണ്ണ് വളരെ നനവുള്ളതാണ് (${pct}%).`,
    soilUncalibrated: 'മണ്ണിലെ പ്രോബ് ഇപ്പോഴും കാലിബ്രേറ്റ് ചെയ്തിട്ടില്ല. മണ്ണിന്റെ ഈർപ്പം എനിക്ക് അറിയാൻ കഴിയില്ല.',
    soilUnavailable: 'മണ്ണിലെ പ്രോബ് മറുപടി നൽകുന്നില്ല.',
    tankAvailable: 'ടാങ്കിൽ കുറഞ്ഞ നിലയിൽ വെള്ളമുണ്ട്.',
    tankLow: 'ടാങ്കിൽ വെള്ളം കുറവാണ്. പ്രോബുകൾക്ക് വെള്ളം തൊടാൻ കഴിയുന്നില്ല.',
    tankUncalibrated: 'ടാങ്ക് പ്രോബുകൾ ഇപ്പോഴും കാലിബ്രേറ്റ് ചെയ്തിട്ടില്ല.',
    tankUnavailable: 'ടാങ്ക് പ്രോബുകൾ മറുപടി നൽകുന്നില്ല.',
    binOk: (bin, pct) => `${bin} ബിൻ ഏകദേശം ${pct}% നിറഞ്ഞിരിക്കുന്നു.`,
    binsUnavailable: 'ബിൻ സെൻസറുകൾ മറുപടി നൽകുന്നില്ല.',
    lightsOn: 'തെരുവുവിളക്കുകൾ കത്തുന്നു.',
    lightsOff: 'തെരുവുവിളക്കുകൾ അണഞ്ഞിരിക്കുന്നു.',
    lightsNoSensor: 'വെളിച്ച സെൻസർ ഘടിപ്പിച്ചിട്ടില്ല, അതിനാൽ വിളക്കുകൾ നിങ്ങളുടെ നിർദ്ദേശത്തിനായി കാത്തിരിക്കുന്നു.',
    pumpOn: 'പമ്പ് ഓടുന്നു.',
    pumpOff: 'പമ്പ് ഓഫാണ്.',
    pumpLocked: 'സുരക്ഷയ്ക്കായി പമ്പ് ഇപ്പോഴും പൂട്ടിയിരിക്കുന്നു.',
    lastEvent: (text) => `ഗ്രാമത്തിൽ നിന്നുള്ള അവസാന സന്ദേശം: ${text}`,
    noEvents: 'ഗ്രാമം ഇതുവരെ ഒരു സന്ദേശവും രേഖപ്പെടുത്തിയിട്ടില്ല.',
  },
  hi: {
    online: 'गाँव जुड़ा हुआ है और नई जानकारी भेज रहा है।',
    stale: (age) => `गाँव नई जानकारी भेजना बंद कर चुका है। आख़िरी जानकारी ${age} पहले थी।`,
    offline: 'गाँव ऑफ़लाइन है। मैं अभी सेंसर नहीं देख सकती।',
    demo: 'डेमो मोड चालू है। ये संख्याएँ नकली हैं।',
    soilDry: (pct) => `मिट्टी सूखी है (${pct}%).`,
    soilAdequate: (pct) => `मिट्टी में पर्याप्त पानी है (${pct}%).`,
    soilWet: (pct) => `मिट्टी बहुत गीली है (${pct}%).`,
    soilUncalibrated: 'मिट्टी की प्रोब अभी कैलिब्रेट नहीं हुई है। मैं नहीं बता सकती कि मिट्टी कितनी गीली है।',
    soilUnavailable: 'मिट्टी की प्रोब जवाब नहीं दे रही।',
    tankAvailable: 'टंकी में कम स्तर पर पानी है।',
    tankLow: 'टंकी में पानी कम है। प्रोब को पानी नहीं मिल रहा।',
    tankUncalibrated: 'टंकी की प्रोब अभी कैलिब्रेट नहीं हुई है।',
    tankUnavailable: 'टंकी की प्रोब जवाब नहीं दे रही।',
    binOk: (bin, pct) => `${bin} डिब्बा लगभग ${pct}% भरा है।`,
    binsUnavailable: 'डिब्बों के सेंसर जवाब नहीं दे रहे।',
    lightsOn: 'सड़क की बत्तियाँ जल रही हैं।',
    lightsOff: 'सड़क की बत्तियाँ बंद हैं।',
    lightsNoSensor: 'रोशनी सेंसर नहीं लगा है, इसलिए बत्तियाँ आपके निर्देश का इंतज़ार करती हैं।',
    pumpOn: 'पंप चल रहा है।',
    pumpOff: 'पंप बंद है।',
    pumpLocked: 'सुरक्षा के लिए पंप अभी भी बंद है।',
    lastEvent: (text) => `गाँव का आख़िरी संदेश: ${text}`,
    noEvents: 'गाँव ने अभी तक कोई संदेश दर्ज नहीं किया।',
  },
};

export interface LiaLiveItem {
  icon: LiaIconKey;
  text: string;
}

export interface VillageSnapshot {
  status: DeviceStatus | null;
  connected: boolean;
  stale: boolean;
  ageMs: number | null;
  demo: boolean;
}

function formatLiaAge(ageMs: number | null, language: LiaLanguage): string {
  if (ageMs === null || !Number.isFinite(ageMs)) return language === 'ml' ? 'കുറച്ച്' : language === 'hi' ? 'कुछ' : 'a moment';
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 2) return language === 'ml' ? 'ഒരു നിമിഷം' : language === 'hi' ? 'एक पल' : 'a moment';
  if (seconds < 60) {
    if (language === 'ml') return `${seconds} സെക്കൻഡ്`;
    if (language === 'hi') return `${seconds} सेकंड`;
    return `${seconds} s`;
  }
  const minutes = Math.round(seconds / 60);
  if (language === 'ml') return `${minutes} മിനിറ്റ്`;
  if (language === 'hi') return `${minutes} मिनट`;
  return `${minutes} min`;
}

function percentText(value: number): string {
  return String(Math.round(value));
}

/**
 * Turn the live envelope into short, honest sentences. Values that are not
 * available (uncalibrated, stale, missing) are described as unavailable — they
 * are never replaced with a plausible number.
 */
export function describeVillage(
  snapshot: VillageSnapshot,
  language: LiaLanguage,
): LiaLiveItem[] {
  const copy = LIVE[language];
  const { status, connected, stale, ageMs, demo } = snapshot;
  const items: LiaLiveItem[] = [];

  if (!connected) {
    items.push({ icon: 'connection', text: copy.offline });
    return items;
  }
  if (stale) {
    items.push({ icon: 'connection', text: copy.stale(formatLiaAge(ageMs, language)) });
    return items;
  }
  items.push({ icon: 'connection', text: copy.online });
  if (demo) items.push({ icon: 'event', text: copy.demo });

  const sensors = status?.sensors;
  if (sensors) {
    const soil = sensors.soil;
    if (soil) {
      if (soil.state === 'uncalibrated' || !soil.calibrated) {
        items.push({ icon: 'sensor', text: copy.soilUncalibrated });
      } else if (!soil.valid || soil.state === 'unavailable') {
        items.push({ icon: 'sensor', text: copy.soilUnavailable });
      } else if (typeof soil.percent === 'number') {
        const pct = percentText(soil.percent);
        if (soil.state === 'dry') items.push({ icon: 'sensor', text: copy.soilDry(pct) });
        else if (soil.state === 'wet') items.push({ icon: 'sensor', text: copy.soilWet(pct) });
        else items.push({ icon: 'sensor', text: copy.soilAdequate(pct) });
      }
    }

    const tank = sensors.reservoir;
    if (tank) {
      if (tank.state === 'uncalibrated' || !tank.calibrated) {
        items.push({ icon: 'tank', text: copy.tankUncalibrated });
      } else if (tank.state === 'available') {
        items.push({ icon: 'tank', text: copy.tankAvailable });
      } else if (tank.state === 'low') {
        items.push({ icon: 'tank', text: copy.tankLow });
      } else {
        items.push({ icon: 'tank', text: copy.tankUnavailable });
      }
    }

    const bins = sensors.bins ?? [];
    const usable = bins.filter(
      (bin) => bin.valid && bin.state !== 'unavailable' && typeof bin.fill_pct_estimate === 'number',
    );
    if (usable.length === 0) {
      items.push({ icon: 'bin', text: copy.binsUnavailable });
    } else {
      for (const bin of usable) {
        const name = BIN_NAMES[language][bin.id] ?? bin.id;
        items.push({
          icon: 'bin',
          text: copy.binOk(name, percentText(bin.fill_pct_estimate as number)),
        });
      }
    }

    const light = sensors.light;
    const lamps = status?.actuators?.streetlights;
    if (light && light.installed === false) {
      items.push({ icon: 'light', text: copy.lightsNoSensor });
    } else if (lamps) {
      items.push({ icon: 'light', text: lamps.commanded ? copy.lightsOn : copy.lightsOff });
    }
  }

  const pump = status?.actuators?.pump;
  if (pump) {
    items.push({ icon: 'pump', text: pump.commanded ? copy.pumpOn : copy.pumpOff });
    if (!pump.commissioned) items.push({ icon: 'help', text: copy.pumpLocked });
  }

  return items;
}

export function recentVillageMessages(
  status: DeviceStatus | null,
  language: LiaLanguage,
  limit = 2,
): string[] {
  const events = status?.recent_events ?? [];
  return events
    .filter((event) => typeof event.text === 'string' && event.text.trim().length > 0)
    .slice(-limit)
    .reverse()
    .map((event) => LIVE[language].lastEvent(event.text.trim()));
}

export const LIA_STORAGE_KEY = 'village.lia.v1';

export interface LiaPrefs {
  dismissed: boolean;
  /** Kept for stored copies written before the language became one setting. */
  language: LiaLanguage;
  readAloud: boolean;
  /**
   * Read the page aloud as soon as Lia opens, and again when the topic
   * changes.  On by default: at the exhibition a visitor presses "Talk to
   * Lia" and should hear her, not have to find a second button.
   */
  autoRead: boolean;
}

export const LIA_DEFAULT_PREFS: LiaPrefs = {
  dismissed: false,
  language: 'en',
  readAloud: false,
  autoRead: true,
};

function isLanguage(value: unknown): value is LiaLanguage {
  return value === 'en' || value === 'ml' || value === 'hi';
}

export function loadLiaPrefs(): LiaPrefs {
  if (typeof window === 'undefined') return { ...LIA_DEFAULT_PREFS };
  try {
    const raw = window.localStorage.getItem(LIA_STORAGE_KEY);
    if (!raw) return { ...LIA_DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<LiaPrefs> | null;
    return {
      dismissed: Boolean(parsed?.dismissed),
      language: isLanguage(parsed?.language) ? parsed.language : 'en',
      readAloud: Boolean(parsed?.readAloud),
      // A stored copy from before this preference existed reads as "on", which
      // is the behaviour being asked for.
      autoRead: parsed?.autoRead === undefined ? true : Boolean(parsed?.autoRead),
    };
  } catch {
    return { ...LIA_DEFAULT_PREFS };
  }
}

export function saveLiaPrefs(prefs: LiaPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LIA_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage may be unavailable; the guide still works for this visit */
  }
}
