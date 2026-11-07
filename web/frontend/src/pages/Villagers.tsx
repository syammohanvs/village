import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useDemo } from '../lib/demo';
import { titleCase } from '../lib/format';
import type { Profile } from '../types';
import { Card, Chip, EmptyState, ErrorBlock, Notice } from '../components/ui';
import { IconVillagers } from '../components/Icons';

const SAMPLES: Profile[] = [
  {
    id: 'sample-1',
    name: 'Aisha Rahman',
    house_no: '12',
    points: 11,
    history: [
      { at: 'Sample history', category: 'organic', points: 3 },
      { at: 'Sample history', category: 'organic', points: 3 },
      { at: 'Sample history', category: 'plastic', points: 2 },
      { at: 'Sample history', category: 'paper', points: 1 },
      { at: 'Sample history', category: 'plastic', points: 2 },
    ],
  },
  {
    id: 'sample-2',
    name: 'Ravi Kumar',
    house_no: '5',
    points: 7,
    history: [
      { at: 'Sample history', category: 'organic', points: 3 },
      { at: 'Sample history', category: 'plastic', points: 2 },
      { at: 'Sample history', category: 'paper', points: 1 },
    ],
  },
  {
    id: 'sample-3',
    name: 'Anu Thomas',
    house_no: '8',
    points: 5,
    history: [
      { at: 'Sample history', category: 'organic', points: 3 },
      { at: 'Sample history', category: 'plastic', points: 2 },
    ],
  },
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function pointsFor(category: string | undefined): number {
  if (category === 'organic') return 3;
  if (category === 'plastic') return 2;
  if (category === 'paper') return 1;
  return 0;
}

export function Villagers() {
  const { demo } = useDemo();
  const profiles = useApi(['profiles'], () => api.profiles(), {});
  const rows = profiles.data?.profiles ?? profiles.data?.items ?? [];
  const usingSamples = rows.length === 0;

  return (
    <div className="page">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Exhibition extra</p>
          <h2 className="page-title">Villagers</h2>
          <p className="page-lede">
            Sample profiles for the exhibition table. These are fictional. They show confirmed
            sorting history and points only — never water, power or savings figures.
          </p>
        </div>
        <Chip tone="warn">Fictional sample data</Chip>
      </div>

      <Notice tone="info" title="Clearly fictional">
        The names, houses and histories on this page are invented for the demonstration. {demo ? 'Demo mode is on. ' : ''}
        No real villager is tracked by this dashboard.
      </Notice>

      {Boolean(profiles.error) && <ErrorBlock error={profiles.error} onRetry={profiles.reload} />}

      {usingSamples && !profiles.error && (
        <p className="hint">
          The backend has no stored profiles yet, so the sample profiles below are shown. They are
          not stored anywhere.
        </p>
      )}

      {rows.length === 0 && profiles.loading ? (
        <Card title="Loading profiles">
          <EmptyState title="Reading profiles…" />
        </Card>
      ) : (
        <div className="villager-grid">
          {(usingSamples ? SAMPLES : rows).map((profile) => {
            const history = profile.history ?? [];
            const total =
              profile.points ??
              history.reduce((sum, entry) => sum + (entry.points ?? pointsFor(entry.category)), 0);
            const confirmed = history.length;
            return (
              <article className="villager-card" key={profile.id ?? profile.name}>
                <div className="villager-head">
                  <span className="avatar" aria-hidden="true">
                    {profile.avatar || initials(profile.name)}
                  </span>
                  <div>
                    <p className="villager-name">{profile.name}</p>
                    <p className="villager-house">House {profile.house_no ?? profile.house ?? '—'}</p>
                  </div>
                  <span className="villager-points">{total}</span>
                </div>

                <div className="villager-stats">
                  <div>
                    <p className="stat-value">{confirmed}</p>
                    <p className="stat-label">Confirmed sorts</p>
                  </div>
                  <div>
                    <p className="stat-value">{total}</p>
                    <p className="stat-label">Points</p>
                  </div>
                  <div>
                    <p className="stat-value">{profile.last_category ? titleCase(profile.last_category) : '—'}</p>
                    <p className="stat-label">Last category</p>
                  </div>
                </div>

                <div className="history-list">
                  <p className="eyebrow">Sorting history</p>
                  {history.length === 0 ? (
                    <p className="hint">No confirmed sorting yet. Points only follow a confirmed deposit.</p>
                  ) : (
                    <ul>
                      {history.slice(-5).reverse().map((entry, index) => (
                        <li key={`${profile.id ?? profile.name}-${index}`}>
                          <span className="history-category">{titleCase(entry.category ?? 'unknown')}</span>
                          <span className="history-date">{entry.at ?? 'sample'}</span>
                          <span className="history-points">+{entry.points ?? pointsFor(entry.category)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <p className="hint">
                  <IconVillagers size={14} /> Fictional profile. A camera recognition alone does not
                  add a point; only a separate deposit confirmation does.
                </p>
              </article>
            );
          })}
        </div>
      )}

      <Card kicker="Points rule" title="How points are awarded">
        <div className="points-rule">
          <div>
            <span className="rule-points">3</span>
            <span>Organic</span>
          </div>
          <div>
            <span className="rule-points">2</span>
            <span>Plastic</span>
          </div>
          <div>
            <span className="rule-points">1</span>
            <span>Paper</span>
          </div>
        </div>
        <p className="hint">
          One point award per confirmed deposit. The sort category comes from the waste camera or a
          manual choice; the deposit must be confirmed separately. These profiles are demonstration
          data, not a real leaderboard.
        </p>
      </Card>

      <p className="hint page-footnote">
        No consumption, generation or savings figure appears on this page. The village dashboard
        never invents them.
      </p>
    </div>
  );
}
