import type { CommandLogEntry, CommandStatus } from '../lib/commands';
import { cx } from '../lib/format';
import { Chip, type ChipTone } from './ui';

export const COMMAND_TONE: Record<CommandStatus, ChipTone> = {
  confirmed: 'live',
  rejected: 'bad',
  duplicate: 'warn',
  unconfirmed: 'bad',
  pending: 'neutral',
};

export const COMMAND_LABEL: Record<CommandStatus, string> = {
  confirmed: 'Confirmed by controller',
  rejected: 'Refused by controller',
  duplicate: 'Already processed',
  unconfirmed: 'Not confirmed',
  pending: 'Sending…',
};

export function CommandResult({ entry }: { entry: CommandLogEntry }) {
  return (
    <div className={cx('command-result', `command-result--${entry.status}`)}>
      <Chip tone={COMMAND_TONE[entry.status]}>{COMMAND_LABEL[entry.status]}</Chip>
      <span className="command-type">{entry.type}</span>
      {entry.reasonCode && <span className="command-code">{entry.reasonCode}</span>}
      {entry.reason && <p className="command-reason">{entry.reason}</p>}
      {entry.status === 'unconfirmed' && (
        <p className="command-reason">
          The controller did not acknowledge this command. Do not assume anything physical happened.
        </p>
      )}
    </div>
  );
}
