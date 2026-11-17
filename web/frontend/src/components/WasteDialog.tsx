import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../lib/i18n';
import { SortWaste } from '../pages/SortWaste';

/**
 * The waste sorter, as a full-screen panel over the village page.
 *
 * The exhibit has one page now, so the sorter cannot be a route in the menu —
 * and a visitor who walked into a separate screen had no obvious way back.  As
 * a dialog there is exactly one exit (this Done, Esc, or the browser's Back,
 * because the panel lives at `/waste`), and the village readings behind it are
 * never unmounted.
 *
 * Full-screen on purpose: the guide square is what the classifier reads, so
 * shrinking the camera into a card would shrink the thing that decides the
 * answer by more than it saves.
 */
export function WasteDialog() {
  const t = useT();
  const navigate = useNavigate();
  const doneRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    navigate('/', { replace: false });
  }, [navigate]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    doneRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  return (
    <div className="overlay-over" role="presentation" data-testid="waste-dialog">
      <div className="waste-dialog" role="dialog" aria-modal="true" aria-label={t('wasteDialog.aria')}>
        <header className="waste-dialog-head">
          <div>
            <p className="brand-eyebrow">{t('wasteDialog.eyebrow')}</p>
            <h2 className="waste-dialog-title">{t('wasteDialog.title')}</h2>
          </div>
          <button
            type="button"
            className="btn btn--gold"
            onClick={close}
            ref={doneRef}
            data-testid="waste-done"
          >
            {t('wasteDialog.done')}
          </button>
        </header>
        <div className="waste-dialog-body">
          <SortWaste />
        </div>
      </div>
    </div>
  );
}
