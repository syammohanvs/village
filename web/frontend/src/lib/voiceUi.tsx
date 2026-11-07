import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface VoiceUiContextValue {
  open: boolean;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
}

const VoiceUiContext = createContext<VoiceUiContextValue | null>(null);

export function VoiceUiProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openPanel = useCallback(() => setOpen(true), []);
  const closePanel = useCallback(() => setOpen(false), []);
  const togglePanel = useCallback(() => setOpen((value) => !value), []);
  const value = useMemo<VoiceUiContextValue>(
    () => ({ open, openPanel, closePanel, togglePanel }),
    [open, openPanel, closePanel, togglePanel],
  );
  return <VoiceUiContext.Provider value={value}>{children}</VoiceUiContext.Provider>;
}

export function useVoiceUi(): VoiceUiContextValue {
  const value = useContext(VoiceUiContext);
  if (!value) throw new Error('useVoiceUi must be used inside VoiceUiProvider');
  return value;
}
