import { useCallback, useEffect, useRef, useState } from 'react';
import { LIA_COPY } from '../lib/lia';
import { speakText, speechSupported, stopSpeaking } from '../lib/speech';
import { useVoiceUi } from '../lib/voiceUi';
import { LiaAvatar } from './LiaAvatar';

type Spoken = 'pending' | 'ok' | 'silent';

/**
 * Lia's spoken greeting on the Sort Waste page.
 *
 * Two kinds of visitor arrive here.  One already knows which bin the item
 * belongs in and should be able to drop it and leave; the other does not and
 * needs to know what the camera is for.  One short line serves both — "know the
 * bin? go ahead. not sure? show the item" — and it is said in the language the
 * app is set to, not in English.
 *
 * The words are shown as well as spoken.  A device with no voice, a browser
 * that refuses to play audio before the first tap, and a visitor who cannot
 * hear all get the same sentence in writing, with a button to hear it again
 * once there *is* a tap to unlock playback.
 */
export function WasteWelcome() {
  const { language } = useVoiceUi();
  const copy = LIA_COPY[language];
  const line = copy.wasteWelcome;

  const [dismissed, setDismissed] = useState(false);
  const [spoken, setSpoken] = useState<Spoken>('pending');
  // Whether the last attempt produced sound.  Kept in a ref so unmounting after
  // a *silent* attempt does not cancel somebody else's playback.
  const heardRef = useRef(false);

  useEffect(() => {
    if (dismissed) return;
    let cancelled = false;
    heardRef.current = false;
    setSpoken('pending');
    void (async () => {
      const ok = await speakText(line, language, 0.95);
      if (cancelled) return;
      heardRef.current = ok;
      setSpoken(ok ? 'ok' : 'silent');
    })();
    return () => {
      cancelled = true;
    };
    // A new line or a newly chosen language is a fresh greeting; `dismissed`
    // only decides whether there is still a card to speak from.
  }, [line, language, dismissed]);

  // Leaving the page must not leave Lia talking to an empty room.
  useEffect(
    () => () => {
      if (heardRef.current) stopSpeaking();
    },
    [],
  );

  const replay = useCallback(() => {
    setSpoken('pending');
    void speakText(line, language, 0.95).then((ok) => {
      heardRef.current = ok;
      setSpoken(ok ? 'ok' : 'silent');
    });
  }, [line, language]);

  const dismiss = useCallback(() => {
    stopSpeaking();
    heardRef.current = false;
    setDismissed(true);
  }, []);

  if (dismissed) return null;

  return (
    <section className="lia-welcome" data-testid="waste-welcome" aria-label="Lia">
      <LiaAvatar size={46} decorative />
      <p className="lia-welcome-line" data-testid="waste-welcome-line">
        {line}
      </p>
      <div className="lia-welcome-actions">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={replay}
          data-testid="waste-welcome-replay"
        >
          {copy.hearAgain}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={dismiss}
          data-testid="waste-welcome-dismiss"
        >
          {copy.close}
        </button>
      </div>
      {spoken === 'silent' && (
        <p className="hint lia-welcome-note" data-testid="waste-welcome-note">
          {speechSupported()
            ? 'Press “Hear it again” to listen.'
            : copy.speechUnavailable}
        </p>
      )}
    </section>
  );
}
