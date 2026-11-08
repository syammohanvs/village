import { Link } from 'react-router-dom';
import { AiServicesCard } from '../components/AiServicesCard';
import { BinCard } from '../components/BinCard';
import { ConnectionCard } from '../components/ConnectionCard';
import { DemoScenarios } from '../components/DemoScenarios';
import { RecentActivity } from '../components/RecentActivity';
import { KpiCard } from '../components/KpiCard';
import { Card, ErrorBlock, Notice } from '../components/ui';
import { VillageControls } from '../components/VillageControls';
import { VillageExplainer } from '../components/VillageExplainer';
import {
  IconDroplet,
  IconInfo,
  IconLamp,
  IconPump,
  IconSensors,
} from '../components/Icons';
import { useDemo } from '../lib/demo';
import {
  binLabel,
  lightModeLabel,
  reservoirLabel,
  soilLabel,
  statusSentence,
} from '../lib/explain';
import { cx, formatAge, formatMv, formatPercent, titleCase } from '../lib/format';
import { useVillage } from '../lib/village';
import type { BinReading } from '../types';

const BIN_ORDER = ['organic', 'plastic', 'paper'] as const;

function placeholderBins(): BinReading[] {
  return BIN_ORDER.map((id) => ({
    id,
    installed: true,
    valid: false,
    distance_cm: null,
    fill_pct_estimate: null,
    state: 'unavailable',
    age_ms: null,
    fault: null,
    near_blind_zone: false,
  }));
}

function toneForSoil(state: string | undefined) {
  if (state === 'adequate' || state === 'wet') return 'live' as const;
  if (state === 'dry') return 'warn' as const;
  if (state === 'uncalibrated') return 'warn' as const;
  return 'neutral' as const;
}

export function Dashboard() {
  const { status, envelope, loading, error, reload, live, connected, stale, ageMs } =
    useVillage();
  const { demo } = useDemo();

  if (!envelope && loading) {
    return (
      <div className="page">
        <div className="card loading-card">
          <p className="eyebrow">Connecting</p>
          <p>Waiting for the first frame from the village controller…</p>
        </div>
      </div>
    );
  }

  if (!envelope && error) {
    return (
      <div className="page">
        <Card kicker="Connection" title="The village service is not answering">
          <ErrorBlock error={error} onRetry={reload} />
          <p className="hint">
            The dashboard never invents readings. Start the local backend on this laptop, then try
            again.
          </p>
        </Card>
      </div>
    );
  }

  const sensors = status?.sensors;
  const soil = sensors?.soil;
  const reservoir = sensors?.reservoir;
  const light = sensors?.light;
  // A floating ADC pin reads noise; without an installed LDR there is no
  // brightness observation to show.
  const lightWired = light?.installed !== false;
  const lightLabel = lightWired ? titleCase(light?.brightness ?? 'unknown') : 'Not installed';
  const pump = status?.actuators?.pump;
  const lights = status?.actuators?.streetlights;
  const irrigation = status?.irrigation;
  const inactive = !live;

  const bins = placeholderBins().map((placeholder) => {
    const found = sensors?.bins?.find((bin) => bin.id === placeholder.id);
    return found ?? placeholder;
  });

  const sentence = !status
    ? 'Waiting for the first frame from the village controller.'
    : !connected
      ? `No live data. Last seen ${formatAge(ageMs)}. ${statusSentence(status)}`
      : stale
        ? `This reading is ${formatAge(ageMs)} old and is not live. ${statusSentence(status)}`
        : statusSentence(status);

  const soilValue =
    soil && soil.calibrated && soil.percent !== null ? formatPercent(soil.percent, 0) : soilLabel(soil?.state);

  return (
    <div className="page">
      <section className={cx('hero', inactive && 'is-inactive')} data-testid="village-hero">
        <div className="hero-copy">
          <p className="eyebrow">
            Smart Green Village · {envelope?.source?.label ?? 'local controller'}
          </p>
          <h2 className="hero-sentence" data-testid="status-sentence">
            {sentence}
          </h2>
          <p className="hero-meta">
            <span className={cx('dot', live ? 'dot--green' : stale ? 'dot--amber' : 'dot--red')} />
            {live
              ? `Live · last frame ${formatAge(ageMs)}`
              : stale
                ? `Stale · last frame ${formatAge(ageMs)}`
                : `Offline · last seen ${formatAge(ageMs)}`}
            {status && (
              <span className="hero-facts">
                sample #{status.sample_seq} · config revision {status.config_revision} · boot{' '}
                {status.boot_id}
              </span>
            )}
          </p>
        </div>
        <div className="hero-aside">
          <span className={cx('chip', live ? 'chip--live' : stale ? 'chip--warn' : 'chip--bad')}>
            {live ? 'Live data' : stale ? 'Stale data' : 'Not live'}
          </span>
          {pump && !pump.commissioned && (
            <span className="chip chip--warn">Pump not commissioned</span>
          )}
          {demo && <span className="chip chip--warn">Demo</span>}
          <Link to="/controls" className="link-inline">
            All controls
          </Link>
        </div>
      </section>

      <div className="kpi-grid">
        <KpiCard
          icon={<IconSensors size={21} />}
          label="Soil moisture"
          value={soilValue}
          sub={
            soil
              ? soil.calibrated
                ? 'Calibrated relative reading · not a laboratory measurement'
                : `Not calibrated${soil.raw !== null ? ` · raw ${soil.raw}` : ''}`
              : 'No soil reading'
          }
          chip={{ text: soilLabel(soil?.state), tone: toneForSoil(soil?.state) }}
          inactive={inactive}
          footer={
            soil && (
              <span>
                {soil.raw !== null ? `raw ${soil.raw}` : 'no raw value'} · {formatAge(soil.age_ms)}
              </span>
            )
          }
        />

        <KpiCard
          icon={<IconDroplet size={21} />}
          label="Reservoir"
          value={reservoirLabel(reservoir?.state)}
          sub="Two probes · one minimum level only"
          chip={{
            text: reservoir?.state === 'available' ? 'Water present' : reservoirLabel(reservoir?.state),
            tone:
              reservoir?.state === 'available'
                ? 'live'
                : reservoir?.state === 'low'
                  ? 'warn'
                  : 'neutral',
          }}
          inactive={inactive}
          footer={
            reservoir && (
              <span>
                {formatMv(reservoir.millivolts)} · {formatAge(reservoir.age_ms)}
              </span>
            )
          }
        />

        <KpiCard
          icon={<IconPump size={21} />}
          label="Pump"
          value={pump?.commanded ? 'On' : 'Off'}
          sub={`${titleCase(irrigation?.state ?? 'unknown')} · ${
            pump?.commissioned ? 'commissioning gate open' : 'commissioning gate closed'
          }`}
          chip={{
            text: pump?.commissioned ? 'Gate open' : 'Gate closed',
            tone: pump?.commissioned ? 'gold' : 'warn',
          }}
          inactive={inactive}
          footer={irrigation?.reason && <span className="kpi-reason">{irrigation.reason}</span>}
        />

        <KpiCard
          icon={<IconLamp size={21} />}
          label="Streetlights"
          value={lightModeLabel(lights?.mode)}
          sub={`${lightLabel} light · ${
            lights?.commanded ? 'commanded on' : 'commanded off'
          }`}
          chip={{
            text: lightLabel,
            tone: !lightWired
              ? 'neutral'
              : light?.brightness === 'dark'
                ? 'warn'
                : light?.brightness === 'bright'
                  ? 'gold'
                  : 'neutral',
          }}
          inactive={inactive}
          footer={
            lightWired && light ? (
              <span>
                {light.raw !== null ? `LDR raw ${light.raw}` : 'no LDR value'} ·{' '}
                {formatAge(light.age_ms)}
              </span>
            ) : (
              <span>No LDR wired · reporting nothing</span>
            )
          }
        />
      </div>

      <div className="split-grid">
        <VillageExplainer />
        <Card kicker="Manual" title="Village controls" className="controls-card">
          <VillageControls />
        </Card>
      </div>

      <section className="bins-section">
        <div className="section-head">
          <div>
            <p className="eyebrow">Waste bins</p>
            <h2 className="section-title">Estimated fill, never measured waste weight</h2>
          </div>
          <Link to="/waste" className="link-inline">
            Waste camera
          </Link>
        </div>
        <div className="bins-grid">
          {bins.map((bin) => (
            <BinCard key={bin.id} bin={bin} inactive={inactive} />
          ))}
        </div>
        {bins.some((bin) => bin.state === 'unavailable') && (
          <Notice tone="info">
            An unavailable bin is shown as unavailable. A missing echo is never turned into an empty
            bin or a zero.
          </Notice>
        )}
      </section>

      <div className="tri-grid">
        <ConnectionCard />
        <AiServicesCard />
        <RecentActivity />
      </div>

      {demo && <DemoScenarios />}

      <p className="static-note">
        <IconInfo size={16} />
        <span>
          <strong>Static display — not instrumented.</strong> The solar panels, the windmill and the
          model buildings are set dressing. This dashboard does not invent generation, storage or
          savings figures for them.
        </span>
      </p>

      <p className="hint page-footnote">
        Bin fill is an estimated height from an ultrasonic distance. Soil moisture is a calibrated
        relative reading. Reservoir state is “available” or “low” only.{' '}
        {status ? `Bin states: ${bins.map((bin) => `${bin.id} ${binLabel(bin.state).toLowerCase()}`).join(' · ')}.` : ''}
      </p>
    </div>
  );
}
