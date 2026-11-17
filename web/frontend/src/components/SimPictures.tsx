/**
 * The two little pictures the simulation adds: a solar panel under a lamp and a
 * windmill.  Both are drawn, not measured — they exist so a visitor can see the
 * control they moved, and neither invents a number (the numbers come from the
 * status frame, which is the simulator's own circuit arithmetic).
 */

/** A panel and the LED it lights, as bright as the simulated light allows. */
export function SolarPanel({ light }: { light: number }) {
  const level = Math.max(0, Math.min(1, light));
  // The LED starts at its forward voltage: below ~40% light it is dark.
  const glow = Math.max(0, (level - 0.35) / 0.65);
  return (
    <svg
      className="sim-picture sim-picture--solar"
      viewBox="0 0 120 78"
      role="img"
      aria-label={`Solar panel in ${level > 0.66 ? 'strong' : level > 0.2 ? 'some' : 'low'} light`}
      data-light={level.toFixed(2)}
    >
      {/* the lamp above it */}
      <circle cx="60" cy="9" r="6" fill="var(--gold-2)" opacity={0.25 + 0.75 * level} />
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
export function Windmill({ speed, fitted = true }: { speed: number; fitted?: boolean }) {
  const level = Math.max(0, Math.min(1, speed));
  // One turn every 6 s at a breeze, every 0.9 s in a gale; still air does not
  // turn at all, and CSS stops the animation entirely for reduced motion.
  const duration = level <= 0.02 ? 0 : 6 - 5 * level;
  return (
    <svg
      className="sim-picture sim-picture--wind"
      viewBox="0 0 120 78"
      role="img"
      aria-label={
        fitted
          ? `Windmill turning ${level > 0.66 ? 'fast' : level > 0.1 ? 'slowly' : 'not at all'}`
          : 'Windmill not fitted'
      }
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
