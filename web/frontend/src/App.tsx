import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { VoicePanel } from './components/VoicePanel';
import { CommandsProvider } from './lib/commands';
import { DemoProvider } from './lib/demo';
import { VillageProvider } from './lib/village';
import { VoiceUiProvider } from './lib/voiceUi';
import { Activity } from './pages/Activity';
import { Controls } from './pages/Controls';
import { Dashboard } from './pages/Dashboard';
import { Sensors } from './pages/Sensors';
import { Settings } from './pages/Settings';
import { Villagers } from './pages/Villagers';
import { Waste } from './pages/Waste';

export default function App() {
  return (
    <DemoProvider>
      <VillageProvider>
        <CommandsProvider>
          <VoiceUiProvider>
            <BrowserRouter>
              <Routes>
                <Route element={<Layout />}>
                  <Route index element={<Dashboard />} />
                  <Route path="sensors" element={<Sensors />} />
                  <Route path="controls" element={<Controls />} />
                  <Route path="waste" element={<Waste />} />
                  <Route path="activity" element={<Activity />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="villagers" element={<Villagers />} />
                  <Route path="*" element={<Dashboard />} />
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
