/**
 * The little pictures each card carries.
 *
 * They are **drawn, not measured**: every one of them exists so a visitor can
 * see the thing the card is talking about, and not one of them invents a number
 * — the figures beside them come from the status frame (Live) or the simulator's
 * own circuit arithmetic (Simulation).
 *
 * Two rules hold across all six:
 *
 * 1. **A picture may not claim hardware the board does not have.**  The windmill
 *    stands still and says so when no turbine is wired; the tank shows one of
 *    the two states its two wires can actually report, never a percentage.
 * 2. **It follows the same value the card does.**  Live and Simulation differ in
 *    where the number comes from, never in what is drawn, so a picture that says
 *    "pumping" is next to a card that says "Pump running".
 *
 * The accessible name is passed in already translated, because this module has
 * no language of its own.
 */

/** A panel and the LED it lights, as bright as the light allows. */
export function SolarPanel({ light, label }: { light: number; label: string }) {
  const level = Math.max(0, Math.min(1, light));
  // The LED starts at its forward voltage: below ~40% light it is dark.
  const glow = Math.max(0, (level - 0.35) / 0.65);
  return (
    <svg
      className="sim-picture sim-picture--solar"
      viewBox="0 0 120 78"
      role="img"
      aria-label={label}
      data-light={level.toFixed(2)}
    >
      {/* the lamp above it, with a halo that pulses — the one thing on this card
          that moves in every state, because the light is always there */}
      <g className="solar-sun">
        <circle cx="60" cy="9" r="12" fill="var(--gold-2)" opacity={0.2 + 0.45 * level} />
      </g>
      <circle cx="60" cy="9" r="6" fill="var(--gold-2)" opacity={0.25 + 0.75 * level} />
      {/* The rays breathe.  The group carries the animation, so each ray keeps
          its own opacity from the light level and the two multiply: a dim panel
          still shimmers less than a bright one. */}
      <g className="solar-rays">
        {[0, 1, 2, 3].map((step) => (
          <line
            key={step}
            x1={60 + Math.cos((Math.PI / 3) * step) * 12}
            y1={9 + Math.sin((Math.PI / 3) * step) * 12}
            x2={60 + Math.cos((Math.PI / 3) * step) * 19}
            y2={9 + Math.sin((Math.PI / 3) * step) * 19}
            stroke="var(--gold-dim)"
            strokeWidth="1.4"
            opacity={0.2 + 0.8 * level}
          />
        ))}
      </g>
      {/* the panel */}
      <g>
        <rect x="24" y="34" width="72" height="34" rx="3" fill="#0d1b2a" stroke="var(--gold-dim)" />
        {[0, 1, 2].map((row) =>
          [0, 1, 2, 3].map((col) => (
            <rect
              key={`${row}-${col}`}
              x={28 + col * 17}
              y={38 + row * 10}
              width="14"
              height="8"
              fill="#1d3f63"
              opacity={0.35 + 0.65 * level}
            />
          )),
        )}
      </g>
      {/* the LED, through its resistor */}
      <line x1="60" y1="68" x2="60" y2="72" stroke="var(--muted)" strokeWidth="1.2" />
      {/* A lit LED has a soft halo that pulses; a dark one has none, because a
          glow around an unlit LED would be a picture claiming current. */}
      {glow > 0.02 && <circle className="solar-led-glow" cx="60" cy="74" r="7.5" fill="#ff5a4d" opacity="0.34" />}
      <circle
        cx="60"
        cy="74"
        r="3.4"
        fill={glow > 0.02 ? '#ff5a4d' : '#3a2020'}
        opacity={0.35 + 0.65 * glow}
        data-testid="solar-led"
      />
    </svg>
  );
}

/**
 * A windmill whose blades turn as fast as the wind.
 *
 * `fitted` is the honest half in Live: this board has no turbine wired, so the
 * picture stands still and says so rather than turning beside the words "Not
 * fitted" (2026-11-17).
 */
export function Windmill({
  speed,
  fitted = true,
  label,
}: {
  speed: number;
  fitted?: boolean;
  label: string;
}) {
  const level = Math.max(0, Math.min(1, speed));
  // One turn every 6 s at a breeze, every 0.9 s in a gale; still air does not
  // turn at all, and CSS stops the animation entirely for reduced motion.
  const duration = level <= 0.02 ? 0 : 6 - 5 * level;
  return (
    <svg
      className="sim-picture sim-picture--wind"
      viewBox="0 0 120 78"
      role="img"
      aria-label={label}
      data-speed={level.toFixed(2)}
      data-fitted={fitted ? 'true' : 'false'}
    >
      <path d="M60 34 L54 74 L66 74 Z" fill="var(--burgundy-2)" stroke="var(--gold-dim)" />
      <g
        className="windmill-blades"
        style={{ transformOrigin: '60px 30px', animationDuration: `${duration}s` }}
        data-turning={duration > 0 ? 'true' : 'false'}
      >
        {[0, 120, 240].map((angle) => (
          <rect
            key={angle}
            x="59"
            y="8"
            width="2.4"
            height="22"
            rx="1.2"
            fill="var(--gold-2)"
            transform={`rotate(${angle} 60 30)`}
          />
        ))}
        <circle cx="60" cy="30" r="3" fill="var(--gold-2)" />
      </g>
    </svg>
  );
}

/**
 * A potted plant: the soil darkens as it gets wet, the leaves lift, and while
 * the pump runs, water falls.
 *
 * `level` is 0 for dry and 1 for wet (`null` when the probe has said nothing —
 * the plant is then drawn neutral rather than guessed at).  `pumping` is the
 * controller's own state, so the drops are the same fact as the chip.
 */
export function Plant({
  level,
  pumping,
  label,
}: {
  level: number | null;
  pumping: boolean;
  label: string;
}) {
  const wet = level === null ? 0.5 : Math.max(0, Math.min(1, level));
  // Dry soil browns; wet soil goes almost black.  Interpolated, so a calibrated
  // probe at 21% looks like 21%.
  const soil = `rgb(${Math.round(90 - 55 * wet)}, ${Math.round(64 - 40 * wet)}, ${Math.round(46 - 30 * wet)})`;
  const droop = 1 - wet;
  return (
    <svg
      className="sim-picture sim-picture--plant"
      viewBox="0 0 120 78"
      role="img"
      aria-label={label}
      data-moisture={level === null ? 'unknown' : wet.toFixed(2)}
      data-pumping={pumping ? 'true' : 'false'}
    >
      {/* Watering, only while the pump is actually running: a can in the
          corner and a stream falling from its spout onto the pot.  The first
          version drew four dots a little above the leaves with nothing holding
          them, so it read as berries on the plant rather than as water
          (reported 2026-11-18: "watering animation is not visible"). */}
      {pumping && (
        <g className="watering" aria-hidden="true">
          <g className="watering-can">
            <path
              d="M10 9 h20 a3 3 0 0 1 3 3 v5 a3 3 0 0 1 -3 3 h-20 a3 3 0 0 1 -3 -3 v-5 a3 3 0 0 1 3 -3 z"
              fill="#9fc2d0"
              stroke="var(--gold-dim)"
              strokeWidth="1"
            />
            <path
              d="M31 12 L45 5 L48 10 L32 18 Z"
              fill="#9fc2d0"
              stroke="var(--gold-dim)"
              strokeWidth="1"
            />
            <path
              d="M13 9 a6.5 5.5 0 0 1 13 0"
              fill="none"
              stroke="var(--gold-dim)"
              strokeWidth="1.3"
            />
          </g>
          <g className="watering-drops">
            {[
              { x: 50, delay: '0s' },
              { x: 56, delay: '0.42s' },
              { x: 52.5, delay: '0.84s' },
              { x: 58, delay: '1.26s' },
            ].map((drop, index) => (
              <circle
                key={`${drop.x}-${index}`}
                className="watering-drop"
                cx={drop.x}
                cy={11}
                r="2.6"
                fill="#8fd4f0"
                style={{ animationDelay: drop.delay }}
              />
            ))}
          </g>
          {/* Water reaching the soil: a small, faint pool where the stream
              lands, so the picture reads as watering the pot rather than as
              something happening above it. */}
          <ellipse
            className="watering-splash"
            cx="54"
            cy="54"
            rx="8"
            ry="2.2"
            fill="#8fd4f0"
            opacity="0.35"
          />
        </g>
      )}
      {/* the pot, then the soil in it */}
      <path d="M43 57 L49 76 L71 76 L77 57 Z" fill="var(--burgundy-2)" stroke="var(--gold-dim)" strokeWidth="1.2" />
      <rect x="45" y="55" width="30" height="4" rx="2" fill={soil} stroke="var(--gold-dim)" strokeWidth="0.6" />
      {/* stem and leaves; the leaves fall with dryness */}
      <line x1="60" y1="56" x2="60" y2="28" stroke="#6cc596" strokeWidth="2.4" />
      <ellipse
        cx="51"
        cy="38"
        rx="10"
        ry="4"
        fill="#6cc596"
        opacity={0.55 + 0.45 * wet}
        transform={`rotate(${-18 - 26 * droop} 60 44)`}
      />
      <ellipse
        cx="69"
        cy="34"
        rx="10"
        ry="4"
        fill="#6cc596"
        opacity={0.55 + 0.45 * wet}
        transform={`rotate(${18 + 26 * droop} 60 44)`}
      />
      <ellipse
        cx="60"
        cy="26"
        rx="3.4"
        ry="6"
        fill="#7fd3a6"
        opacity={0.6 + 0.4 * wet}
        transform={`rotate(${8 * droop} 60 30)`}
      />
    </svg>
  );
}

/**
 * The rain water tank, at one of the **two** levels its two wires can report.
 *
 * There is deliberately no percentage: the real detector only knows "water at the
 * low wire" or "not".  A tank the controller cannot read is drawn empty and
 * dashed rather than half full.
 */
export function RainTank({
  state,
  label,
}: {
  state: 'available' | 'low' | 'uncalibrated' | 'unknown';
  label: string;
}) {
  const known = state === 'available' || state === 'low';
  const fill = state === 'available' ? 32 : state === 'low' ? 11 : 0;
  return (
    <svg
      className="sim-picture sim-picture--tank"
      viewBox="0 0 120 78"
      role="img"
      aria-label={label}
      data-state={state}
    >
      {/* the tank, then what is in it, then the rain falling into it */}
      <rect
        x="40"
        y="16"
        width="40"
        height="56"
        rx="5"
        fill="#0d1b2a"
        stroke="var(--gold-dim)"
        strokeWidth="1.4"
        strokeDasharray={known ? undefined : '4 3'}
      />
      {/* the rim, so the shape reads as an open tank rather than a battery */}
      <ellipse cx="60" cy="16" rx="20" ry="3.4" fill="#0b1622" stroke="var(--gold-dim)" strokeWidth="1.2" />
      {/* the water: two levels, never a measurement */}
      {fill > 0 && (
        <rect x="42" y={70 - fill} width="36" height={fill} rx="3" fill="#2f6f9f" opacity="0.85" />
      )}
      {/* rain, while there is water to collect — drawn after the tank so it falls
          through the opening instead of behind it */}
      {state === 'available' && (
        <g className="tank-drops" aria-hidden="true">
          {[
            { x: 50, delay: '0s' },
            { x: 60, delay: '0.5s' },
            { x: 70, delay: '1s' },
          ].map((drop) => (
            <line
              key={drop.x}
              x1={drop.x}
              y1="2"
              x2={drop.x}
              y2="10"
              stroke="#7fc7e8"
              strokeWidth="2"
              strokeLinecap="round"
              style={{ animationDelay: drop.delay }}
            />
          ))}
        </g>
      )}
      {/* the low wire, drawn so "low" is visibly about a wire and not a gauge */}
      <line
        x1="40"
        y1="59"
        x2="80"
        y2="59"
        stroke="var(--gold-dim)"
        strokeWidth="1"
        strokeDasharray="3 3"
        opacity={known ? 0.9 : 0.5}
      />
    </svg>
  );
}

/** A streetlight: lit, or dark. */
export function StreetLamp({ on, label }: { on: boolean; label: string }) {
  const lit = Boolean(on);
  return (
    <svg
      className="sim-picture sim-picture--lamp"
      viewBox="0 0 120 78"
      role="img"
      aria-label={label}
      data-on={lit ? 'true' : 'false'}
    >
      {/* the pool of light on the ground */}
      {lit && <polygon points="42,74 78,74 68,30 52,30" fill="var(--gold-2)" opacity="0.13" />}
      {/* post, arm, lamp head */}
      <rect x="64" y="30" width="3.4" height="44" fill="var(--gold-dim)" />
      <rect x="56" y="72" width="19" height="3" rx="1.5" fill="var(--gold-dim)" />
      <path d="M65.5 30 Q65.5 20 56 20" fill="none" stroke="var(--gold-dim)" strokeWidth="3.4" />
      <ellipse cx="54" cy="20" rx="7" ry="3.4" fill={lit ? 'var(--gold-2)' : '#4a4034'} />
      {lit && (
        <g className="lamp-glow">
          <circle cx="54" cy="20" r="19" fill="var(--gold-2)" opacity="0.12" />
          <circle cx="54" cy="20" r="11" fill="var(--gold-2)" opacity="0.3" />
        </g>
      )}
    </svg>
  );
}

/**
 * The three bins, the camera that sorts them, and the one it last chose lit.
 *
 * It is an **indicator**, not a measurement: nothing here knows how full a bin
 * is, because nothing measures that (2026-11-15).  The camera is drawn because
 * that is the thing doing the classifying — the bins only say which answer it
 * gave, and the colours match the LEDs on the board (D21/D22/D23).
 */
export function WasteBins({ active, label }: { active: string | null; label: string }) {
  const lit = (active ?? '').trim().toLowerCase();
  const bins = [
    { id: 'organic', colour: '#6cc596', x: 54 },
    { id: 'plastic', colour: '#e05b67', x: 72 },
    { id: 'paper', colour: '#e3b04b', x: 90 },
  ];
  return (
    <svg
      className="sim-picture sim-picture--bins"
      viewBox="0 0 120 78"
      role="img"
      aria-label={label}
      data-active={lit || 'none'}
    >
      {/* the camera, and what it is looking at */}
      <g data-testid="waste-camera">
        <rect x="8" y="26" width="24" height="15" rx="3.5" fill="#141010" stroke="var(--gold-dim)" strokeWidth="1.4" />
        <rect x="14" y="21" width="9" height="5.5" rx="1.6" fill="#141010" stroke="var(--gold-dim)" strokeWidth="1.2" />
        <circle cx="33" cy="33.5" r="5" fill="#0b1622" stroke="var(--gold-2)" strokeWidth="1.4" />
        <circle cx="33" cy="33.5" r="2" fill="var(--gold-2)" opacity="0.9" />
      </g>
      {/* the line of sight: dashed, because it is a field of view and not a beam */}
      <polygon points="38,30 50,21 50,46" fill="var(--gold-2)" opacity="0.08" />
      <line
        className="sight-line"
        x1="38"
        y1="33.5"
        x2="50"
        y2="33.5"
        stroke="var(--gold-2)"
        strokeWidth="1.6"
        strokeDasharray="4 4"
        opacity="0.7"
      />
      {/* the flash: a star at the lens that fires every few seconds.  It is the
          camera's own motion — the bins still only light when one is named. */}
      <g className="camera-flash" aria-hidden="true">
        <circle cx="33" cy="33.5" r="4.6" fill="#fff6d8" opacity="0.95" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <line
            key={angle}
            x1={33 + Math.cos((angle * Math.PI) / 180) * 6}
            y1={33.5 + Math.sin((angle * Math.PI) / 180) * 6}
            x2={33 + Math.cos((angle * Math.PI) / 180) * 10}
            y2={33.5 + Math.sin((angle * Math.PI) / 180) * 10}
            stroke="#fff6d8"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        ))}
      </g>
      {bins.map((bin) => {
        const on = lit === bin.id;
        return (
          <g key={bin.id} opacity={on ? 1 : lit ? 0.5 : 0.75}>
            {on && (
              <g className="bin-glow">
                <circle cx={bin.x + 8} cy="34" r="19" fill={bin.colour} opacity="0.3" />
              </g>
            )}
            {/* lid and its handle, so three rectangles read as three bins */}
            <rect x={bin.x + 3} y="36" width="10" height="2.4" rx="1.2" fill={bin.colour} />
            <rect x={bin.x + 1} y="40" width="14" height="3.4" rx="1.7" fill={bin.colour} />
            <rect x={bin.x + 2} y="44" width="12" height="24" rx="2" fill="#141010" stroke={bin.colour} strokeWidth="1.4" />
            {on && <rect x={bin.x + 2} y="44" width="12" height="24" rx="2" fill={bin.colour} opacity="0.3" />}
          </g>
        );
      })}
    </svg>
  );
}
