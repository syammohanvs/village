import { useCallback } from 'react';
import type { Lang } from './lang';
import type { MessageKey } from './messages';
import { translate, type Vars } from './translate';
import { useVoiceUi } from './voiceUi';

export { fillTemplate, translate } from './translate';
export type { Vars } from './translate';

/**
 * The translation function for the language the visitor chose.
 *
 * It reads the same shared state the selector writes, so switching language
 * re-renders every sentence in place — no reload, no re-mount and, deliberately,
 * no side effect on the village: nothing in this path can send a command.
 */
export function useT() {
  const { language } = useVoiceUi();
  return useCallback(
    (key: MessageKey, vars?: Vars) => translate(language, key, vars),
    [language],
  );
}

/** The chosen language, for the places that need a code rather than a sentence. */
export function useLang(): Lang {
  return useVoiceUi().language;
}
