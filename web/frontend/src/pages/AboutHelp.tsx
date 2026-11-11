import { Link } from 'react-router-dom';
import { Card, Chip, Notice } from '../components/ui';
import { api } from '../lib/api';
import { openLia } from '../lib/liaUi';
import { useApi } from '../lib/useApi';
import type { Profile } from '../types';
import { IconArrowRight, IconDroplet, IconLamp, IconMic, IconWaste, IconWifi } from '../components/Icons';

const SAMPLES: Profile[] = [
  {
    id: 'sample-1',
    name: 'Aisha Rahman',
    house_no: '12',
    points: 11,
    history: [
      { at: 'Sample history', category: 'organic', points: 3 },
      { at: 'Sample history', category: 'plastic', points: 2 },
    ],
  },
  {
    id: 'sample-2',
    name: 'Ravi Kumar',
    house_no: '5',
    points: 7,
    history: [{ at: 'Sample history', category: 'paper', points: 1 }],
  },
  {
    id: 'sample-3',
    name: 'Anu Thomas',
    house_no: '8',
    points: 5,
    history: [{ at: 'Sample history', category: 'organic', points: 3 }],
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

export function AboutHelp() {
  const profiles = useApi(['profiles'], () => api.profiles(), {});
  const rows = profiles.data?.profiles ?? profiles.data?.items ?? [];
  const sample = rows.length > 0 ? rows : SAMPLES;

  return (
    <div className="page about-page">
      <section className="about-hero">
        <div>
          <p className="eyebrow">Exhibition project</p>
          <h2 className="about-title">Our AI-Powered Smart Green Village</h2>
          <p className="about-subtheme">Sub-theme: Artificial Intelligence (AI) for Better Life</p>
          <p className="about-lede">
            A small model village that collects rainwater, waters plants, lights its streets and
            sorts waste — with sensors deciding the routine work and AI helping people talk to it
            and show it waste.
          </p>
          <div className="about-actions">
            <button type="button" className="btn btn--gold btn--large" onClick={() => openLia('model')}>
              <IconMic size={17} /> Talk to Lia
            </button>
            <Link to="/" className="btn btn--ghost">
              Open Our Village <IconArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      <div className="about-grid">
        <Card kicker="What it does" title="Four everyday jobs">
          <ul className="about-list">
            <li>
              <IconDroplet size={18} />
              <div>
                <strong>Rainwater collection.</strong> Rain is collected in a tank so it can be
                used later. Two probes in the tank then report one minimum level: water available or
                water low. The app never invents a percentage or litres.
              </div>
            </li>
            <li>
              <IconDroplet size={18} />
              <div>
                <strong>Drip irrigation.</strong> A soil probe measures moisture. When the soil is
                dry and the tank has water, the pump waters in short pulses and stops by itself.
              </div>
            </li>
            <li>
              <IconLamp size={18} />
              <div>
                <strong>Streetlights.</strong> A light sensor switches the lamps on when it gets
                dark. You can also choose Automatic, On or Off by hand.
              </div>
            </li>
            <li>
              <IconWaste size={18} />
              <div>
                <strong>Waste sorting.</strong> A camera recognises organic, plastic or paper waste
                and lights the matching bin LED. Cloth, leather, footwear, glass, metal, thermocol
                and electronic waste are referred to the recycling agent instead. It is a
                suggestion, not proof of disposal.
              </div>
            </li>
          </ul>
        </Card>

        <Card kicker="Under the hood" title="How the parts fit together">
          <ol className="about-steps">
            <li>
              <strong>The ESP32 board</strong> reads the sensors and switches the LEDs and the pump
              driver. It keeps its own safety rules.
            </li>
            <li>
              <strong>The laptop backend</strong> talks to the board on the private network, keeps
              the event log, and serves this dashboard.
            </li>
            <li>
              <strong>This app</strong> shows what is happening and sends your commands. It never
              bypasses the board&apos;s checks.
            </li>
            <li>
              <strong>Speech recognition</strong> runs on the laptop with Whisper. Your voice is not
              sent to a cloud service.
            </li>
            <li>
              <strong>Image recognition</strong> runs inside this browser tab with TensorFlow.js.
              Camera frames are not uploaded.
            </li>
          </ol>
        </Card>
      </div>

      <Card kicker="AI and automatic control" title="What is AI here, and what is not">
        <div className="two-col about-two">
          <div>
            <h3 className="about-h3">AI helps people</h3>
            <ul className="plain-list">
              <li>Speech is turned into text so you can ask the village to do something.</li>
              <li>
                A camera suggests which bin an item belongs in, or says to hand it to the recycling
                agent.
              </li>
            </ul>
            <p className="hint">
              Neither one decides whether the pump may run. That is the board&apos;s job.
            </p>
          </div>
          <div>
            <h3 className="about-h3">Sensors do the routine work</h3>
            <ul className="plain-list">
              <li>Soil moisture decides when watering is allowed.</li>
              <li>The tank probes block watering when water is low.</li>
              <li>The light sensor switches the lamps in Automatic mode.</li>
            </ul>
            <p className="hint">
              These are ordinary rules, not a language model. They are applied by the board itself,
              so they do not depend on this page being open.
            </p>
          </div>
        </div>
      </Card>

      <Card kicker="For visitors" title="Try it in five steps">
        <ol className="steps-list">
          <li>Look at the four cards on <Link to="/">Our Village</Link> and read what each one says.</li>
          <li>
            On <Link to="/">Our Village</Link>, choose <em>Automatic</em> for the streetlights, then
            cover the light sensor with your hand. Watch the streetlight LEDs.
          </li>
          <li>
            Show one clean item to the camera on <Link to="/waste">Sort Waste</Link> and see which
            bin LED lights — or whether it is referred to the recycling agent.
          </li>
          <li>Press <em>Start Speaking</em> on Our Village and say “turn on the lights”.</li>
          <li>Open <Link to="/activity">What Happened</Link> to read why each action happened.</li>
        </ol>
        {rows.length === 0 && (
          <Notice tone="info" title="The board may be disconnected">
            During development the board is often offline. The cards then say Unknown and actions
            are disabled — that is deliberate. Nothing is shown as measured when it is not.
          </Notice>
        )}
      </Card>

      <Card kicker="Display models" title="Solar panels, windmill and buildings">
        <p>
          The solar panels, the windmill and the model buildings are <strong>display pieces</strong>{' '}
          built for the exhibit. They are not wired to the sensors, so this app does not report
          their generation, storage or savings.
        </p>
        <p className="hint">
          The only measured things are soil moisture, the tank&apos;s minimum level, light, the bin
          distance sensors and the command acknowledgements.
        </p>
        <p className="hint">
          <strong>Planned, not fitted:</strong> one working solar panel with an LED load and its own
          voltage and current measurement, and time-of-flight sensors for bin fill. Neither is part
          of this build, so the dashboard reports nothing for them.
        </p>
      </Card>

      <Card
        kicker="Lia"
        title="Your guide, in English, Malayalam and Hindi"
        actions={<Chip tone="gold">Voice + help</Chip>}
      >
        <div className="lia-about">
          <p>
            Lia explains the village, reads the current state aloud and shows you where to press.
            She can open the right page for you, and she never makes up an action.
          </p>
          <div className="about-actions">
            <button type="button" className="btn btn--gold" onClick={() => openLia('help')}>
              <IconMic size={16} /> Talk to Lia
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => openLia('voice')}>
              Help me use voice
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => openLia('events')}>
              Explain what happened
            </button>
          </div>
          <p className="hint">
            <IconWifi size={13} /> Lia reads the same live state as the cards. If the connection
            says Offline at the top, she says so instead of guessing.
          </p>
        </div>
      </Card>

      <section id="sample-village" className="about-sample">
        <div className="section-head">
          <div>
            <p className="eyebrow">Future possibilities</p>
            <h2 className="section-title">Sample Village</h2>
          </div>
          <Chip tone="warn">Fictional sample data</Chip>
        </div>
        <Notice tone="info">
          Every name, house number, history and points total in this section is invented for the
          exhibition. No real villager is tracked, and these are not measured results.
        </Notice>

        <details className="advanced about-sample-more">
          <summary>Show the fictional villagers</summary>
          <div className="advanced-body">
        <div className="villager-grid">
          {sample.map((profile) => {
            const history = profile.history ?? [];
            const total =
              profile.points ??
              history.reduce((sum, entry) => sum + (entry.points ?? 0), 0);
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
                <p className="hint">
                  {history.length} sample {history.length === 1 ? 'deposit' : 'deposits'} · points
                  are a demonstration idea, not a reward scheme in use.
                </p>
              </article>
            );
          })}
        </div>
          </div>
        </details>
        <p className="hint">
          {profiles.error
            ? 'The profile service did not answer, so the built-in samples are shown.'
            : rows.length > 0
              ? 'These profiles came from the local backend. They are still demonstration data.'
              : 'The backend has no profiles, so the built-in samples are shown.'}
        </p>
      </section>

      <p className="hint about-foot">
        Setup, calibration and technical details are on <Link to="/setup">the Setup page</Link>.
        Mode: use <em>Simulation</em> in Setup to practise without the board — it says clearly that
        the physical board will not respond.
      </p>
    </div>
  );
}
