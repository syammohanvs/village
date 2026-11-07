import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { Card, Chip } from './ui';
import { IconAlert, IconArrowRight, IconCamera, IconMic } from './Icons';

export function AiServicesCard() {
  const readiness = useApi(['voice-readiness'], () => api.voiceReadiness(), { intervalMs: 30000 });
  const model = useApi(['waste-model'], () => api.wasteModelStatus(), { intervalMs: 30000 });

  const voiceReady = Boolean(
    readiness.data?.ready ?? readiness.data?.whisper?.ready ??
      (readiness.data?.whisper?.installed === true),
  );
  const modelInstalled = Boolean(
    model.data?.installed ?? model.data?.available ?? (model.data as { present?: boolean })?.present,
  );
  const unavailable = readiness.data?.unavailable_languages ?? [];

  return (
    <Card kicker="On this laptop" title="AI services" className="ai-card">
      <div className="service-row">
        <span className="service-icon" aria-hidden="true">
          <IconMic size={18} />
        </span>
        <div className="service-text">
          <p className="service-name">Voice</p>
          {readiness.error ? (
            <p className="hint">Readiness could not be read: try again from Settings.</p>
          ) : readiness.loading && !readiness.data ? (
            <p className="hint">Checking the local speech model…</p>
          ) : (
            <>
              <div className="service-line">
                <Chip tone={voiceReady ? 'live' : 'warn'}>
                  {voiceReady ? 'Speech-to-text ready' : 'Speech-to-text not ready'}
                </Chip>
                {unavailable.map((code) => (
                  <Chip key={code} tone="neutral">
                    {code} text only
                  </Chip>
                ))}
              </div>
              <p className="hint">
                {readiness.data?.whisper?.model
                  ? `Local model: ${readiness.data.whisper.model}`
                  : readiness.data?.whisper?.message ??
                    'Recognition runs on the laptop; no audio is sent to a cloud service.'}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="service-row">
        <span className="service-icon" aria-hidden="true">
          <IconCamera size={18} />
        </span>
        <div className="service-text">
          <p className="service-name">Waste camera</p>
          {model.error ? (
            <p className="hint">Model status could not be read.</p>
          ) : model.loading && !model.data ? (
            <p className="hint">Checking the Teachable Machine model…</p>
          ) : (
            <>
              <div className="service-line">
                <Chip tone={modelInstalled ? 'live' : 'warn'}>
                  {modelInstalled ? 'Recognition model installed' : 'Recognition model not installed'}
                </Chip>
              </div>
              <p className="hint">
                {modelInstalled
                  ? 'Recognition suggests a bin category. It does not prove that anything was deposited.'
                  : 'Copy the exported model files into models/waste/ and reload. No predictions are invented.'}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="service-links">
        <Link to="/settings" className="link-inline">
          Service settings <IconArrowRight size={14} />
        </Link>
        <Link to="/waste" className="link-inline">
          Open waste camera <IconArrowRight size={14} />
        </Link>
      </div>

      {!voiceReady && !readiness.error && !readiness.loading && (
        <p className="notice notice--warn">
          <IconAlert size={15} /> Voice commands need the local whisper model. Ask an adult to run
          the model download step before the exhibition.
        </p>
      )}
    </Card>
  );
}
