import { cx } from '../lib/format';
import { openLia } from '../lib/liaUi';
import { LiaAvatar } from './LiaAvatar';

/**
 * "Talk to Sara" — the way into the guide.
 *
 * One component for the two places it is offered: the console's side menu and
 * the exhibit's village page.  A second copy would drift in exactly the parts
 * that matter (the avatar, the label, and which entry of the guide it opens).
 */
export function TalkToLia({
  compact = false,
  className,
}: {
  /** Icon only — for the collapsed menu rail. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cx('talk-lia', compact && 'talk-lia--compact', className)}
      onClick={() => openLia('help')}
      data-testid="talk-to-lia"
      aria-label="Talk to Sara"
      title="Talk to Sara"
    >
      <LiaAvatar size={compact ? 30 : 34} decorative />
      {!compact && <span className="talk-lia-label">Talk to Sara</span>}
    </button>
  );
}
