import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import type { MessageKey } from '../lib/messages';
import { ROUTES } from '../lib/wasteGuide';
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
  /** The item's name, as a translation key — never a hard-coded English word. */
  itemKey: MessageKey;
  /** A bin, or one of the two non-bin answers. */
  kind: 'organic' | 'plastic' | 'paper' | 'separate' | 'support';
}

export const WASTE_SAMPLES: Sample[] = [
  { id: 'banana', itemKey: 'sample.banana', kind: 'organic' },
  { id: 'bottle', itemKey: 'sample.bottle', kind: 'plastic' },
  { id: 'newspaper', itemKey: 'sample.newspaper', kind: 'paper' },
  { id: 'glass', itemKey: 'sample.glass', kind: 'separate' },
  { id: 'battery', itemKey: 'sample.battery', kind: 'support' },
];

interface Guidance {
  titleKey: MessageKey;
  reasonKey: MessageKey;
  keepOutKey?: MessageKey;
  tone: 'ok' | 'warn' | 'danger';
}

/**
 * What this project already says about that kind of item — as keys, so the same
 * sentence is written once and translated in the visitor's language.
 */
export function guidanceFor(kind: Sample['kind']): Guidance {
  if (kind === 'separate') {
    // No collection route is configured for glass here, and the wording says so
    // rather than implying a bin exists.
    return {
      titleKey: 'waste.title.keepSeparate',
      reasonKey: ROUTES.glass ? 'waste.word.glassRoute' : 'waste.word.separateUnconfigured',
      tone: 'warn',
    };
  }
  if (kind === 'support') {
    return { titleKey: 'waste.title.askSahayak', reasonKey: 'waste.word.outside', tone: 'danger' };
  }
  if (kind === 'organic') {
    return {
      titleKey: 'waste.bin.organic.title',
      reasonKey: 'waste.bin.organic.prepare',
      keepOutKey: 'waste.bin.organic.keepOut',
      tone: 'ok',
    };
  }
  if (kind === 'plastic') {
    return {
      titleKey: 'waste.bin.plastic.title',
      reasonKey: 'waste.bin.plastic.prepare',
      keepOutKey: 'waste.bin.plastic.keepOut',
      tone: 'ok',
    };
  }
  return {
    titleKey: 'waste.bin.paper.title',
    reasonKey: 'waste.bin.paper.prepare',
    keepOutKey: 'waste.bin.paper.keepOut',
    tone: 'ok',
  };
}

/**
 * The sample list, as a dialog over the village page.
 *
 * It is deliberately a dialog rather than a separate page: the exhibit is one
 * screen, and a visitor who walked away from it might not find their way back.
 */
export function WasteSamples({ onClose }: { onClose: () => void }) {
  const t = useT();
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
            <p className="brand-eyebrow">{t('samples.eyebrow')}</p>
            <h2 id="waste-samples-title">{t('samples.title')}</h2>
            <p className="hint">{t('samples.intro')}</p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={t('samples.close')}
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
                <span>{t(sample.itemKey)}</span>
                <span className="waste-sample-go" aria-hidden="true">
                  →
                </span>
              </button>
            </li>
          ))}
        </ul>

        {open && guidance && (
          <div className="waste-sample-result" data-testid="waste-sample-result">
            <p className="eyebrow">{t('samples.guidanceEyebrow')}</p>
            <h3 className="waste-sample-title">{t(open.itemKey)}</h3>
            <p className={`waste-sample-where is-${guidance.tone}`}>{t(guidance.titleKey)}</p>
            <p className="waste-sample-reason">{t(guidance.reasonKey)}</p>
            {guidance.keepOutKey && (
              <p className="hint">
                <strong>{t('samples.keepOut')}</strong> {t(guidance.keepOutKey)}
              </p>
            )}
            <p className="hint">{t('samples.noLed')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
