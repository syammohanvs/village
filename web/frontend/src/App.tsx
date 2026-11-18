import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { KioskLayout } from './components/KioskLayout';
import { Layout } from './components/Layout';
import { WasteDialog } from './components/WasteDialog';
import { Gate } from './components/Gate';
import { VoicePanel } from './components/VoicePanel';
import { CommandsProvider } from './lib/commands';
import { DemoProvider, useDemo } from './lib/demo';
import { SessionProvider, useSession } from './lib/session';
import { VillageProvider } from './lib/village';
import { VoiceUiProvider } from './lib/voiceUi';
import { AboutHelp } from './pages/AboutHelp';
import { OurVillage } from './pages/OurVillage';
import { Setup } from './pages/Setup';
import { SortWaste } from './pages/SortWaste';
import { WhatHappened } from './pages/WhatHappened';

/**
 * Which shell the build draws.
 *
 * `kiosk` (the default) is the exhibit: one page, a centred mark, the
 * three-stop mode knob and no side menu.  `sidebar` is the operator console the
 * exhibit grew out of — kept in the tree so going back is a build flag rather
 * than a revert, and tagged `exhibit-sidebar-2026-11-17` as well.
 *
 *   VITE_LAYOUT=sidebar npm run build
 */
const LAYOUT = ((import.meta.env as Record<string, string | undefined>).VITE_LAYOUT ?? 'kiosk')
  .trim()
  .toLowerCase();
const KIOSK = LAYOUT !== 'sidebar';

/**
 * The waste sorter, over the village page in the kiosk and as its own screen on
 * the console.  One address either way, so old links keep working.
 */
function WasteScreen() {
  return KIOSK ? (
    <>
      <OurVillage />
      <WasteDialog />
    </>
  ) : (
    <SortWaste />
  );
}

/**
 * A visit through the share link is Simulation-only.
 *
 * The mode switch already disables Live and Test, and the backend refuses a
 * live command from that cookie; this closes the last door - a guest whose
 * browser had `live` remembered would otherwise *open* in Live.  It is a
 * component rather than a line in `DemoProvider` so that provider stays usable
 * without a session (the console shell's own tests do exactly that).
 */
function GuestUsesSimulation() {
  const { guest } = useSession();
  const { mode, setMode } = useDemo();
  useEffect(() => {
    if (guest && mode !== 'demo') setMode('demo');
  }, [guest, mode, setMode]);
  return null;
}

export default function App() {
  return (
    <SessionProvider>
      <Gate>
    <DemoProvider>
      <GuestUsesSimulation />
      <VillageProvider>
        <CommandsProvider>
          <VoiceUiProvider>
            <BrowserRouter>
              <Routes>
                <Route element={KIOSK ? <KioskLayout /> : <Layout />}>
                  <Route index element={<OurVillage />} />
                  <Route path="waste" element={<WasteScreen />} />
                  <Route path="activity" element={<WhatHappened />} />
                  <Route path="about" element={<AboutHelp />} />
                  <Route path="setup" element={<Setup />} />
                  {/* Old addresses stay usable, so existing links and the
                      printed exhibition notes do not break. */}
                  <Route path="sensors" element={<Navigate to="/setup#sensors" replace />} />
                  <Route path="settings" element={<Navigate to="/setup" replace />} />
                  <Route path="controls" element={<Navigate to="/" replace />} />
                  <Route path="villagers" element={<Navigate to="/about#sample-village" replace />} />
                  <Route path="dashboard" element={<Navigate to="/" replace />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
              <VoicePanel />
            </BrowserRouter>
          </VoiceUiProvider>
        </CommandsProvider>
      </VillageProvider>
    </DemoProvider>
      </Gate>
    </SessionProvider>
  );
}
