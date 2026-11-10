import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { VoicePanel } from './components/VoicePanel';
import { CommandsProvider } from './lib/commands';
import { DemoProvider } from './lib/demo';
import { VillageProvider } from './lib/village';
import { VoiceUiProvider } from './lib/voiceUi';
import { AboutHelp } from './pages/AboutHelp';
import { OurVillage } from './pages/OurVillage';
import { Setup } from './pages/Setup';
import { SortWaste } from './pages/SortWaste';
import { WhatHappened } from './pages/WhatHappened';

export default function App() {
  return (
    <DemoProvider>
      <VillageProvider>
        <CommandsProvider>
          <VoiceUiProvider>
            <BrowserRouter>
              <Routes>
                <Route element={<Layout />}>
                  <Route index element={<OurVillage />} />
                  <Route path="waste" element={<SortWaste />} />
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
  );
}
