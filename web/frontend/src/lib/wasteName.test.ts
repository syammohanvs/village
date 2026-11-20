import { describe, expect, it } from 'vitest';
import { translateItemName } from './wasteName';

describe('the item name in the visitor language', () => {
  it('says a known item in Hindi and Malayalam', () => {
    expect(translateItemName('Onion', 'hi')).toBe('प्याज़');
    expect(translateItemName('Onion', 'ml')).toBe('സവാള');
    expect(translateItemName('onion peel', 'hi')).toBe('प्याज़ छिलका');
  });

  it('keeps the words in the order the model used, and drops joining words', () => {
    expect(translateItemName('Blue plastic bottle', 'hi')).toBe('नीला प्लास्टिक बोतल');
    expect(translateItemName('brown paper bag', 'ml')).toBe('തവിട്ട് കടലാസ് സഞ്ചി');
    expect(translateItemName('a clear plastic bag', 'hi')).toBe('साफ़ प्लास्टिक थैला');
    expect(translateItemName('hand holding a leaf', 'hi')).toBe('हाथ पत्ता');
  });

  it('answers with the name unchanged in English', () => {
    expect(translateItemName('Large, yellowish cantaloupe', 'en')).toBe(
      'Large, yellowish cantaloupe',
    );
  });

  it('refuses a name it cannot say completely, rather than mixing two languages', () => {
    // "cantaloupe" and "yellowish" are not in the table.  A half-Hindi
    // "पीला cantaloupe" on a Hindi page is worse than leaving the line out.
    expect(translateItemName('Large, yellowish cantaloupe', 'hi')).toBeNull();
    expect(translateItemName('purple widget', 'ml')).toBeNull();
  });

  it('has nothing to say about an empty or unconfigured name', () => {
    expect(translateItemName(null, 'hi')).toBeNull();
    expect(translateItemName('   ', 'hi')).toBeNull();
    expect(translateItemName('', 'ml')).toBeNull();
  });

  it('keeps a number the name carries', () => {
    expect(translateItemName('2 plastic bottles', 'hi')).toBe('2 प्लास्टिक बोतल');
  });
});

describe('food waste names', () => {
  it('says the kitchen words too', () => {
    expect(translateItemName('Banana peel', 'hi')).toBe('केला छिलका');
    expect(translateItemName('Leftover rice', 'hi')).toBe('बचा खाना चावल');
    expect(translateItemName('Fish bone', 'ml')).toBe('മത്സ്യം അസ്ഥി');
    expect(translateItemName('Egg shell', 'ml')).toBe('മുട്ട തോട്');
    expect(translateItemName('Grass clippings', 'hi')).toBe('घास');
  });
});
