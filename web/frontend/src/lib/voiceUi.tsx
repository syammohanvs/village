import { LANGS, isLang, type Lang } from './lang';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

// One language for the page, for Sara's panel and for her voice.  The type and
// the pill labels live in `lib/lang.ts`, so the selector, the message table and
// the speech pipeline cannot disagree about which languages exist.
export type VoiceLanguage = Lang;

export const VOICE_LANGUAGES: { code: VoiceLanguage; label: string }[] = LANGS;

const STORAGE_KEY = 'village.voiceLanguage';

function readLanguage(): VoiceLanguage {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) return stored;
    // Before this was one setting, Lia kept its own copy.  Adopt it so a
    // visitor who chose Malayalam there does not silently get English.
    const legacy = window.localStorage.getItem('village.lia.v1');
    if (legacy) {
      const language = (JSON.parse(legacy) as { language?: unknown } | null)?.language;
      if (isLang(language)) return language;
    }
  } catch {
    /* storage can be unavailable in private modes */
  }
  return 'en';
}

/**
 * The spoken language is one setting for the whole app: the panel, the home
 * page invitation and every example list read it, so a visitor cannot end up
 * with two different languages selected in two places.
 */
export interface VoiceUiContextValue {
  open: boolean;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  language: VoiceLanguage;
  setLanguage: (language: VoiceLanguage) => void;
}

const VoiceUiContext = createContext<VoiceUiContextValue | null>(null);

export function VoiceUiProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [language, setLanguageState] = useState<VoiceLanguage>(() => readLanguage());

  const openPanel = useCallback(() => setOpen(true), []);
  const closePanel = useCallback(() => setOpen(false), []);
  const togglePanel = useCallback(() => setOpen((value) => !value), []);
  const setLanguage = useCallback((next: VoiceLanguage) => {
    setLanguageState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore storage failures */
    }
  }, []);

  // `<html lang>` is what a screen reader, the browser's spell checker and the
  // font fallback read.  It is a render-side effect only — changing it cannot
  // touch the village, and no command is involved.
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = language;
  }, [language]);

  // A new browser (or a cleared profile) starts with the village's saved
  // English voice, not with a default.  It is fetched once, and a choice made
  // after this point is never overwritten by a late answer.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    void import('./api')
      .then(({ api }) =>
        api.settings().then((settings) => {
          const saved = settings.english_voice;
          if (saved === 'sara' || saved === 'device-india') {
            void import('./speech').then(({ saveEnglishVoiceChoice }) =>
              saveEnglishVoiceChoice(saved),
            );
          }
        }),
      )
      .catch(() => undefined);
  }, []);

  const value = useMemo<VoiceUiContextValue>(
    () => ({ open, openPanel, closePanel, togglePanel, language, setLanguage }),
    [open, openPanel, closePanel, togglePanel, language, setLanguage],
  );
  return <VoiceUiContext.Provider value={value}>{children}</VoiceUiContext.Provider>;
}

export function useVoiceUi(): VoiceUiContextValue {
  const value = useContext(VoiceUiContext);
  if (!value) throw new Error('useVoiceUi must be used inside VoiceUiProvider');
  return value;
}
