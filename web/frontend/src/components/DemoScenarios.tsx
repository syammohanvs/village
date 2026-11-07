import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useVillage } from '../lib/village';
import { Card, Notice } from './ui';
import { IconRefresh } from './Icons';

const SCENARIOS: { id: string; label: string; payload: Record<string, unknown> }[] = [
  { id: 'dry', label: 'Dry soil', payload: { soil_pct: 18 } },
  { id: 'wet', label: 'Wet soil', payload: { soil_pct: 62 } },
  { id: 'low-water', label: 'Low water', payload: { reservoir: 'low' } },
  { id: 'night', label: 'Night', payload: { light: 'dark' } },
  { id: 'day', label: 'Day', payload: { light: 'bright' } },
  { id: 'fill-organic', label: 'Fill organic bin', payload: { bins: { organic: 96 } } },
  { id: 'sensor-fault', label: 'Sensor fault', payload: { sensor_fault: 'soil' } },
];

export function DemoScenarios() {
  const { reload } = useVillage();
  const [pending, setPending] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const apply = async (id: string, payload: Record<string, unknown>) => {
    setPending(id);
    setError('');
    setNote('');
    try {
      await api.demoScenario(payload);
      setNote(`Applied “${SCENARIOS.find((row) => row.id === id)?.label ?? id}”.`);
      reload();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(null);
    }
  };

  const reset = async () => {
    setPending('reset');
    setError('');
    setNote('');
    try {
      await api.demoReset();
      setNote('Simulator reset to its starting scenario.');
      reload();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(null);
    }
  };

  return (
    <Card kicker="Demo only" title="Demo scenarios" className="demo-card">
      <p className="hint">
        These change the simulator, never real hardware. They are posted to{' '}
        <code>/api/v1/demo/scenario</code>.
      </p>
      <div className="scenario-grid">
        {SCENARIOS.map((scenario) => (
          <button
            key={scenario.id}
            type="button"
            className="btn btn--ghost btn--small"
            data-testid={`scenario-${scenario.id}`}
            disabled={pending !== null}
            onClick={() => void apply(scenario.id, scenario.payload)}
          >
            {scenario.label}
          </button>
        ))}
        <button
          type="button"
          className="btn btn--gold btn--small"
          data-testid="scenario-reset"
          disabled={pending !== null}
          onClick={() => void reset()}
        >
          <IconRefresh size={14} /> Reset
        </button>
      </div>
      {pending && <p className="hint">Applying {pending}…</p>}
      {note && <p className="ok-text">{note}</p>}
      {error && <Notice tone="bad">{error}</Notice>}
    </Card>
  );
}
