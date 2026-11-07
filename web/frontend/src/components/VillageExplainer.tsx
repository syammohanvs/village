import { Card, EmptyState } from './ui';
import { cx } from '../lib/format';
import { villageExplanations } from '../lib/explain';
import { useVillage } from '../lib/village';

export function VillageExplainer() {
  const { status, live, connected } = useVillage();

  if (!status) {
    return (
      <Card kicker="What is happening" title="What the village is doing and why" className="explainer">
        <EmptyState title="No controller frame yet">
          The panel will explain each actuator as soon as the village controller answers.
        </EmptyState>
      </Card>
    );
  }

  const explanations = villageExplanations(status);

  return (
    <Card
      kicker="What is happening"
      title="What the village is doing and why"
      className={cx('explainer', !live && 'is-inactive')}
      actions={<span className={cx('chip', live ? 'chip--live' : 'chip--warn')}>{live ? 'Live' : 'Not live'}</span>}
    >
      <p className="explain-summary" data-testid="explain-summary">
        {status.irrigation.reason}
      </p>
      <ul className="explain-list">
        {explanations.map((row) => (
          <li className={cx('explain-row', `explain-row--${row.tone}`)} key={row.key}>
            <span className={cx('explain-dot', `tone-${row.tone}`)} aria-hidden="true" />
            <div className="explain-text">
              <p className="explain-label">{row.label}</p>
              <p className="explain-headline">{row.headline}</p>
              <p className="explain-detail">{row.detail}</p>
            </div>
          </li>
        ))}
      </ul>
      {!live && (
        <p className="hint">
          {connected
            ? 'This frame is stale. The reasons above describe the last moment the controller spoke.'
            : 'The controller is offline. These reasons describe the last frame it sent.'}
        </p>
      )}
    </Card>
  );
}
