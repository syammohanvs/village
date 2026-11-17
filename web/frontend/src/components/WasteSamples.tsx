import { useEffect, useRef, useState } from 'react';
import { BINS, ROUTES, SUPPORT, SUPPORT_ROLE, WORDS } from '../lib/wasteGuide';
import { IconClose } from './Icons';

/**
 * Five demonstration items, with the guidance this project already gives.
 *
 * The waste page reads a real photograph with the real classifier.  That is the
 * honest path and it stays the only path that claims to be AI.  But at an
 * exhibition the camera occasionally has nothing to look at, and a visitor still
 * wants to see what the village *says* about an item — so these five presets
 * show the routing rules without pretending a model ran (asked for 2026-11-17).
 *
 * Every sentence below comes from `lib/wasteGuide.ts`, the same file the camera
 * result reads, so a preset and a recognition cannot disagree about where a
 * bottle goes.  Nothing here lights a bin LED.
 */
interface Sample {
  id: string;
  item: string;
  /** A bin, or one of the two non-bin answers. */
  kind: 'organic' | 'plastic' | 'paper' | 'separate' | 'support';
}

export const WASTE_SAMPLES: Sample[] = [
  { id: 'banana', item: 'Banana peel', kind: 'organic' },
  { id: 'bottle', item: 'Empty plastic bottle', kind: 'plastic' },
  { id: 'newspaper', item: 'Newspaper', kind: 'paper' },
  { id: 'glass', item: 'Glass bottle', kind: 'separate' },
  { id: 'battery', item: 'Used battery', kind: 'support' },
];

interface Guidance {
  title: string;
  reason: string;
  keepOut?: string;
  tone: 'ok' | 'warn' | 'danger';
}

/** What this project already says about that kind of item. */
export function guidanceFor(kind: Sample['kind']): Guidance {
  if (kind === 'separate') {
    return {
      title: ROUTES.glass ? 'Keep separate' : 'Keep separate',
      reason: WORDS.separateUnconfigured,
      tone: 'warn',
    };
  }
  if (kind === 'support') {
    return {
      title: `Ask the ${SUPPORT_ROLE}`,
      reason: `${WORDS.outside} ${SUPPORT.desk}`,
      tone: 'danger',
    };
  }
  const bin = BINS[kind];
  return { title: bin.title, reason: bin.prepare, keepOut: bin.keepOut, tone: 'ok' };
}

/**
 * The sample list, as a dialog over the village page.
 *
 * It is deliberately a dialog rather than a separate page: the exhibit is one
 * screen, and a visitor who walked away from it might not find their way back.
 */
export function WasteSamples({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState<Sample | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const firstRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);

  const guidance = open ? guidanceFor(open.kind) : null;

  return (
    <div className="overlay-over" role="presentation" data-testid="waste-samples">
      <div
        className="waste-samples"
        role="dialog"
        aria-modal="true"
        aria-labelledby="waste-samples-title"
        ref={panelRef}
        tabIndex={-1}
      >
        <header className="waste-samples-head">
          <div>
            <p className="brand-eyebrow">Sample demonstration</p>
            <h2 id="waste-samples-title">Try a sample</h2>
            <p className="hint">
              These five are preset examples of what the village tells you. They are{' '}
              <strong>not</strong> a camera result — the camera on <em>Identify waste</em> is the
              real classifier.
            </p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close the samples"
            ref={firstRef}
          >
            <IconClose size={18} />
          </button>
        </header>

        <ul className="waste-sample-list">
          {WASTE_SAMPLES.map((sample) => (
            <li key={sample.id}>
              <button
                type="button"
                className="waste-sample"
                data-testid={`waste-sample-${sample.id}`}
                aria-pressed={open?.id === sample.id}
                onClick={() => setOpen(sample)}
              >
                <span>{sample.item}</span>
                <span className="waste-sample-go" aria-hidden="true">
                  →
                </span>
              </button>
            </li>
          ))}
        </ul>

        {open && guidance && (
          <div className="waste-sample-result" data-testid="waste-sample-result">
            <p className="eyebrow">Preset guidance — not a camera result</p>
            <h3 className="waste-sample-title">{open.item}</h3>
            <p className={`waste-sample-where is-${guidance.tone}`}>{guidance.title}</p>
            <p className="waste-sample-reason">{guidance.reason}</p>
            {guidance.keepOut && (
              <p className="hint">
                <strong>Keep out:</strong> {guidance.keepOut}
              </p>
            )}
            <p className="hint">No bin LED is lit for a sample: nothing was classified.</p>
          </div>
        )}
      </div>
    </div>
  );
}
