import type { Lang } from './lang';

/**
 * The hosted model names an item in **English**, and the app deliberately does
 * not machine-translate at runtime (docs/voice-languages.md).  A visitor who
 * reads only Hindi or Malayalam should not be shown an English noun, so the
 * names the booth actually produces are kept in this small, hand-written table.
 *
 * Three rules, each a way this could be worse than English:
 *
 *  - **A whole name or nothing.**  If any word is missing the function returns
 *    null and the page drops the identification line, rather than printing a
 *    half-Hindi "भूरा paper bag".
 *  - **Words, not sentences.**  A name is a short noun phrase ("onion peel",
 *    "blue plastic bottle"); the table is word-level with a stop list for the
 *    joining words, so a new colour or material does not need a phrase entry.
 *  - **Never a guess.**  A word that is not here is unknown, not transliterated.
 *
 * The **category and the action** are fully translated already (`messages.ts`);
 * this table only improves the "what the camera saw" line.
 */
type Pair = [string, string]; // [hi, ml]

/** Joining words that carry no item meaning.  Dropped, never translated. */
const STOP = new Set([
  'a', 'an', 'the', 'with', 'of', 'and', 'or', 'in', 'on', 'at', 'from', 'to',
  'holding', 'possibly', 'maybe', 'made', 'some', 'its', 'it', 'is', 'this',
  'that', 'appears', 'be', 'piece', 'clipping', 'clippings',
]);

const WORDS: Record<string, Pair> = {
  // food
  onion: ['प्याज़', 'സവാള'],
  peel: ['छिलका', 'തൊലി'],
  potato: ['आलू', 'ഉരുളക്കിഴങ്ങ്'],
  carrot: ['गाजर', 'കാരറ്റ്'],
  tomato: ['टमाटर', 'തക്കാളി'],
  cucumber: ['खीरा', 'വെള്ളരിക്ക'],
  chilli: ['मिर्च', 'മുളക്'],
  chili: ['मिर्च', 'മുളക്'],
  brinjal: ['बैंगन', 'വഴുതന'],
  eggplant: ['बैंगन', 'വഴുതന'],
  cabbage: ['पत्तागोभी', 'കാബേജ്'],
  cauliflower: ['फूलगोभी', 'കോളിഫ്ലവർ'],
  pumpkin: ['कद्दू', 'മത്തങ്ങ'],
  ginger: ['अदरक', 'ഇഞ്ചി'],
  garlic: ['लहसुन', 'വെളുത്തുള്ളി'],
  coconut: ['नारियल', 'തേങ്ങ'],
  mango: ['आम', 'മാങ്ങ'],
  grape: ['अंगूर', 'മുന്തിരി'],
  watermelon: ['तरबूज़', 'തണ്ണിമത്തൻ'],
  pineapple: ['अनानास', 'കൈതച്ചക്ക'],
  apple: ['सेब', 'ആപ്പിൾ'],
  banana: ['केला', 'വാഴപ്പഴം'],
  papaya: ['पपीता', 'പപ്പായ'],
  guava: ['अमरूद', 'പേരയ്ക്ക'],
  pomegranate: ['अनार', 'മാതളനാരങ്ങ'],
  jackfruit: ['कटहल', 'ചക്ക'],
  leaf: ['पत्ता', 'ഇല'],
  hand: ['हाथ', 'കൈ'],
  leftover: ['बचा खाना', 'മിച്ചം'],
  cooked: ['पका हुआ', 'വേവിച്ച'],
  curry: ['करी', 'കറി'],
  roti: ['रोटी', 'റൊട്ടി'],
  egg: ['अंडा', 'മുട്ട'],
  meat: ['मांस', 'മാംസം'],
  fish: ['मछली', 'മത്സ്യം'],
  bone: ['हड्डी', 'അസ്ഥി'],
  grass: ['घास', 'പുല്ല്'],
  twig: ['टहनी', 'ചില്ല'],
  mushroom: ['मशरूम', 'കൂൺ'],
  pea: ['मटर', 'പട്ടാണി'],
  bean: ['फली', 'ബീൻസ്'],
  spinach: ['पालक', 'ചീര'],
  corn: ['मक्का', 'ചോളം'],
  maize: ['मक्का', 'ചോളം'],
  lettuce: ['सलाद पत्ता', 'ലെറ്റ്യൂസ്'],
  broccoli: ['ब्रोकली', 'ബ്രോക്കോളി'],
  cherry: ['चेरी', 'ചെറി'],
  peach: ['आड़ू', 'പീച്ച്'],
  pear: ['नाशपाती', 'പിയർ'],
  plum: ['बेर', 'പ്ലം'],
  strawberry: ['स्ट्रॉबेरी', 'സ്ട്രോബെറി'],
  seed: ['बीज', 'വിത്ത്'],
  shell: ['छिलका', 'തോട്'],
  flower: ['फूल', 'പൂവ്'],
  vegetable: ['सब्ज़ी', 'പച്ചക്കറി'],
  fruit: ['फल', 'പഴം'],
  food: ['भोजन', 'ഭക്ഷണം'],
  bread: ['ब्रेड', 'ബ്രെഡ്'],
  rice: ['चावल', 'അരി'],
  // containers and objects
  bottle: ['बोतल', 'കുപ്പി'],
  bag: ['थैला', 'സഞ്ചി'],
  box: ['डिब्बा', 'പെട്ടി'],
  packet: ['पैकेट', 'പാക്കറ്റ്'],
  wrapper: ['रैपर', 'റാപ്പർ'],
  cap: ['ढक्कन', 'മൂടി'],
  lid: ['ढक्कन', 'മൂടി'],
  container: ['डिब्बा', 'പാത്രം'],
  cup: ['कप', 'കപ്പ്'],
  mug: ['मग', 'മഗ്'],
  glass: ['काँच', 'ഗ്ലാസ്'],
  plate: ['थाली', 'പ്ലേറ്റ്'],
  spoon: ['चम्मच', 'സ്പൂൺ'],
  paper: ['कागज़', 'കടലാസ്'],
  cardboard: ['गत्ता', 'കാർഡ്ബോർഡ്'],
  carton: ['गत्ते का डिब्बा', 'കാർട്ടൺ'],
  newspaper: ['अख़बार', 'പത്രം'],
  book: ['किताब', 'പുസ്തകം'],
  notebook: ['कॉपी', 'നോട്ട്ബുക്ക്'],
  plastic: ['प्लास्टिक', 'പ്ലാസ്റ്റിക്'],
  metal: ['धातु', 'ലോഹം'],
  steel: ['स्टील', 'സ്റ്റീൽ'],
  iron: ['लोहा', 'ഇരുമ്പ്'],
  wood: ['लकड़ी', 'മരം'],
  wooden: ['लकड़ी का', 'മരം കൊണ്ടുള്ള'],
  cloth: ['कपड़ा', 'തുണി'],
  shoe: ['जूता', 'ഷൂ'],
  slipper: ['चप्पल', 'ചെരിപ്പ്'],
  candle: ['मोमबत्ती', 'മെഴുകുതിരി'],
  jar: ['मर्तबान', 'ജാർ'],
  tube: ['नली', 'ട്യൂബ്'],
  ball: ['गेंद', 'പന്ത്'],
  pillow: ['तकिया', 'തലയിണ'],
  remote: ['रिमोट', 'റിമോട്ട്'],
  phone: ['फ़ोन', 'ഫോൺ'],
  pen: ['कलम', 'പേന'],
  pencil: ['पेंसिल', 'പെൻസിൽ'],
  key: ['चाबी', 'താക്കോൽ'],
  watch: ['घड़ी', 'വാച്ച്'],
  wire: ['तार', 'വയർ'],
  toy: ['खिलौना', 'കളിപ്പാട്ടം'],
  block: ['ब्लॉक', 'ബ്ലോക്ക്'],
  brick: ['ईंट', 'ഇഷ്ടിക'],
  brush: ['ब्रश', 'ബ്രഷ്'],
  bulb: ['बल्ब', 'ബൾബ്'],
  battery: ['बैटरी', 'ബാറ്ററി'],
  mask: ['मास्क', 'മാസ്ക്'],
  soap: ['साबुन', 'സോപ്പ്'],
  mirror: ['आईना', 'കണ്ണാടി'],
  // colours
  red: ['लाल', 'ചുവപ്പ്'],
  blue: ['नीला', 'നീല'],
  green: ['हरा', 'പച്ച'],
  yellow: ['पीला', 'മഞ്ഞ'],
  brown: ['भूरा', 'തവിട്ട്'],
  black: ['काला', 'കറുപ്പ്'],
  white: ['सफ़ेद', 'വെളുപ്പ്'],
  grey: ['धूसर', 'ചാര'],
  gray: ['धूसर', 'ചാര'],
  pink: ['गुलाबी', 'പിങ്ക്'],
  purple: ['बैंगनी', 'പർപ്പിൾ'],
  // size and shape
  small: ['छोटा', 'ചെറിയ'],
  large: ['बड़ा', 'വലിയ'],
  big: ['बड़ा', 'വലിയ'],
  round: ['गोल', 'വൃത്താകൃതിയിലുള്ള'],
  flat: ['सपाट', 'പരന്ന'],
  long: ['लंबा', 'നീളമുള്ള'],
  clear: ['साफ़', 'തെളിഞ്ഞ'],
  empty: ['खाली', 'ശൂന്യ'],
  full: ['भरा', 'നിറഞ്ഞ'],
  broken: ['टूटा', 'പൊട്ടിയ'],
  used: ['इस्तेमाल किया', 'ഉപയോഗിച്ച'],
};

/**
 * Candidate singulars for a plural, tried in order.
 *
 * A single rule cannot do this: "bottles" is bottle+s, but a blanket `es` strip
 * turns it into "bottl", and "leaves" is leaf+ves.  The caller takes the first
 * candidate the table knows, and an unknown plural is unknown.
 */
function singulars(word: string): string[] {
  const out = [word];
  if (word.length > 3 && word.endsWith('ies')) out.push(`${word.slice(0, -3)}y`);
  if (word.length > 3 && word.endsWith('ves')) out.push(`${word.slice(0, -3)}f`, `${word.slice(0, -3)}fe`);
  if (word.length > 2 && word.endsWith('s')) out.push(word.slice(0, -1));
  if (word.length > 3 && word.endsWith('es')) out.push(word.slice(0, -2));
  return out;
}

/**
 * The item name in the visitor's language, or null when it cannot be said
 * honestly in that language (unknown word) — the caller then leaves the line
 * out rather than showing English on a Hindi or Malayalam page.
 */
export function translateItemName(
  name: string | null | undefined,
  language: Lang,
): string | null {
  const clean = (name ?? '').trim();
  if (!clean) return null;
  if (language === 'en') return clean;

  const index = language === 'hi' ? 0 : 1;
  const tokens = clean.toLowerCase().match(/[a-z]+|\d+/g) ?? [];
  if (!tokens.length) return null;

  const words: string[] = [];
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      words.push(token);
      continue;
    }
    const candidates = singulars(token);
    if (candidates.some((candidate) => STOP.has(candidate))) continue;
    const pair = candidates.map((candidate) => WORDS[candidate]).find(Boolean);
    if (!pair) return null;
    words.push(pair[index]);
  }
  return words.length ? words.join(' ') : null;
}
