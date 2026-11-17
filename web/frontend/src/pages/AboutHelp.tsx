import { Link } from 'react-router-dom';
import { Card, Chip, Notice } from '../components/ui';
import { api } from '../lib/api';
import { openLia } from '../lib/liaUi';
import { useApi } from '../lib/useApi';
import type { Profile } from '../types';
import {
  IconArrowRight,
  IconDroplet,
  IconLamp,
  IconMic,
  IconSun,
  IconWaste,
  IconWifi,
} from '../components/Icons';

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
              <IconMic size={17} /> Talk to Sara
            </button>
            <Link to="/" className="btn btn--ghost">
              Open Our Village <IconArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      <div className="about-grid">
        <Card kicker="What it does" title="Everyday jobs">
          <ul className="about-list">
            <li>
              <IconDroplet size={18} />
              <div>
                <strong>Rainwater collection.</strong> Rain is collected in the
                <strong>rain water tank</strong> so it can be used later. Two probes in the tank
                then report one minimum level: water available or water low. The app never invents
                a percentage or litres.
              </div>
            </li>
            <li>
              <IconDroplet size={18} />
              <div>
                <strong>Drip irrigation.</strong> A soil probe measures moisture. The Watering card
                carries the pump&apos;s own three choices, the same as the streetlights&apos;:
                <em>Auto</em> waters in short pulses while the soil is dry and stops by itself,
                <em>On</em> holds the pump running and <em>Off</em> holds it stopped, whatever the
                soil says. There are no separate start and stop buttons — the switch says both.
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
            <li>
              <IconSun size={18} />
              <div>
                <strong>Energy.</strong> A real solar panel is measured — volts, milliamps and
                milliwatts — and the wind generator has its own card. It says “Not fitted” until
                the turbine is wired to GPIO 33, and then it reports volts only: one analogue input
                cannot also measure current, so the card never invents a power figure.
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
              <strong>Image recognition</strong> runs on this laptop, in the backend: the camera
              sends the one square the model will judge, and a trained model answers. Nothing goes
              to the internet — but the picture does leave the browser tab, which this page used to
              say it did not. That changed when the model moved off in-browser TensorFlow.js onto
              the backend.
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
              <li>Soil moisture decides when watering is allowed on Auto.</li>
              <li>
                The tank stops the pump when the water is <em>known</em> to be low — and only then:
                a probe that is missing or not calibrated cannot refuse the operator&apos;s own
                switch. The Rain Water Tank card always says which of those it is.
              </li>
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
          <li>
            Look at the cards on <Link to="/">Our Village</Link> — watering, rain water tank,
            lights, waste, solar and wind. Every card is one row: its name and state on the left,
            then its reading, then its control where it has one — the pump&apos;s
            <em>Auto / On / Off</em>, the lamps&apos;, or <em>Open camera</em>.
          </li>
          <li>
            On <Link to="/">Our Village</Link>, choose <em>Automatic</em> for the streetlights, then
            cover the light sensor with your hand. Watch the streetlight LEDs.
          </li>
          <li>
            Our model knows <strong>three everyday bins</strong>: <strong>organic / food
            waste</strong>, <strong>plastic</strong> and <strong>paper &amp; cardboard</strong>.
            Show one item to the camera on <Link to="/waste">Sort Waste</Link>, hold it inside the
            square and press <em>Check the item</em>. It reads a few frames in a row — two by
            default — because one frame is what used to change its mind, and a flip becomes “not
            sure” instead of a guess. A bin needs <strong>70%</strong> for those frames (handing
            something to the agent needs 50%), so a bottle that reads 60% plastic is not decided:
            the page says which bar it missed rather than guessing. The
            card then says what the AI thinks it is, where it should go, and one reason — with
            <em>Scan another item</em> and <em>Contact Gram Sahayak</em> underneath.
            <br />
            <br />
            It suggests; it does not sort. Some things are never put in these three bins: sanitary
            waste (wrap it and keep it separate), sharps and medical items (do not handle them,
            ask an adult or the Gram Sahayak), batteries, chemicals and electronics (each needs its
            own authorised collection), and glass or metal (only when a collection route is set up
            here). An opaque bag you cannot see into is “Mixed bag / several items” — show one safe
            item at a time. Confidence is not proof: a confident answer can still be wrong.
            <br />
            <br />
            <span className="hint">
              For the exhibition, our model demonstrates three selected categories. Real waste
              systems also handle sanitary and special-care waste separately, and India’s Solid
              Waste Management Rules keep wet waste, dry waste, sanitary waste and special-care
              waste apart — plastic and paper are both dry waste.
            </span>
          </li>
          <li>Press the microphone at the top of <Link to="/">Our Village</Link> and say “turn on the
            lights”. The language buttons sit directly under it.</li>
          <li>Open <Link to="/activity">What Happened</Link> to read why each action happened.</li>
        </ol>
        {rows.length === 0 && (
          <Notice tone="info" title="The board may be disconnected">
            During development the board is often offline. The cards then say Unknown and actions
            are disabled — that is deliberate. Nothing is shown as measured when it is not.
          </Notice>
        )}
      </Card>

      <Card kicker="Display models" title="Solar panel, windmill and buildings">
        <p>
          The windmill and the model buildings are <strong>display pieces</strong>. They are not
          wired to the sensors, so this app reports nothing about them.
        </p>
        <p>
          <strong>One solar panel is real.</strong> It lights a red LED through a 330 Ω resistor,
          and two taps measure the panel voltage and the current that flows, so the Solar Panel
          card reports volts, milliamps and milliwatts. A panel in dim light honestly reads zero: a
          red LED needs about 1.8 V before any current flows at all.
        </p>
        <p className="hint">
          The only measured things are soil moisture, the tank&apos;s minimum level, light, the
          solar panel and the command acknowledgements. The bins have <strong>indicator LEDs
          only</strong> — nothing here measures how full a bin is, and nothing claims to.
        </p>
      </Card>

      <Card
        kicker="Sara"
        title="Your guide, in English, Malayalam and Hindi"
        actions={<Chip tone="gold">Voice + help</Chip>}
      >
        <div className="lia-about">
          <p>
            Sara explains the village, reads the current state aloud and shows you where to press.
            She can open the right page for you, and she never makes up an action. She speaks the
            language chosen in Setup — English, Malayalam or Hindi — on every screen, including the
            answer she gives after a waste item.
          </p>
          <div className="about-actions">
            <button type="button" className="btn btn--gold" onClick={() => openLia('help')}>
              <IconMic size={16} /> Talk to Sara
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => openLia('voice')}>
              Help me use voice
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => openLia('events')}>
              Explain what happened
            </button>
          </div>
          <p className="hint">
            <IconWifi size={13} /> Sara reads the same live state as the cards. If the connection
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
