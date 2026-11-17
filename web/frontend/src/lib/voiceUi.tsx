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

export type VoiceLanguage = 'en' | 'ml' | 'hi';

export const VOICE_LANGUAGES: { code: VoiceLanguage; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ml', label: 'മലയാളം' },
  { code: 'hi', label: 'हिन्दी' },
];

const STORAGE_KEY = 'village.voiceLanguage';

function readLanguage(): VoiceLanguage {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'ml' || stored === 'hi') return stored;
    // Before this was one setting, Lia kept its own copy.  Adopt it so a
    // visitor who chose Malayalam there does not silently get English.
    const legacy = window.localStorage.getItem('village.lia.v1');
    if (legacy) {
      const language = (JSON.parse(legacy) as { language?: unknown } | null)?.language;
      if (language === 'en' || language === 'ml' || language === 'hi') return language;
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
