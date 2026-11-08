import { useId } from 'react';
import { cx } from '../lib/format';

export function LiaAvatar({
  size = 96,
  className,
  label = 'Lia, the village helper',
  decorative = false,
}: {
  size?: number;
  className?: string;
  label?: string;
  decorative?: boolean;
}) {
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  const disc = `lia-disc-${uid}`;
  const scarf = `lia-scarf-${uid}`;
  const robe = `lia-robe-${uid}`;

  return (
    <svg
      className={cx('lia-avatar', className)}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role={decorative ? 'presentation' : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
    >
      <defs>
        <radialGradient id={disc} cx="35%" cy="28%" r="80%">
          <stop offset="0" stopColor="#2a1d1d" />
          <stop offset="0.62" stopColor="#181010" />
          <stop offset="1" stopColor="#0e0b0b" />
        </radialGradient>
        <linearGradient id={scarf} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b7354a" />
          <stop offset="0.55" stopColor="#7c202c" />
          <stop offset="1" stopColor="#4a1019" />
        </linearGradient>
        <linearGradient id={robe} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8f2433" />
          <stop offset="1" stopColor="#3b1016" />
        </linearGradient>
      </defs>

      <circle cx="60" cy="60" r="57" fill={`url(#${disc})`} stroke="#d9b45b" strokeWidth="1.6" />
      <circle cx="60" cy="60" r="51" fill="none" stroke="#f1d690" strokeOpacity="0.26" strokeWidth="0.8" />
      <circle cx="60" cy="60" r="45" fill="none" stroke="#f1d690" strokeOpacity="0.12" strokeWidth="0.6" />

      {/* shoulders */}
      <path
        d="M20 116c2-20 17-30 40-30s38 10 40 30Z"
        fill={`url(#${robe})`}
        stroke="#c9a45f"
        strokeOpacity="0.65"
        strokeWidth="0.9"
      />
      <path
        d="M47 90c4 5 9 8 13 8s9-3 13-8"
        fill="none"
        stroke="#f1d690"
        strokeOpacity="0.55"
        strokeWidth="1.1"
      />

      {/* neck */}
      <rect x="52" y="74" width="16" height="14" rx="7" fill="#e2ad83" />

      {/* headscarf */}
      <path
        d="M30 54c0-22 13-35 30-35s30 13 30 35c0 11-2 20-6 27l-8-7c3-8 4-14 4-20 0-15-9-24-20-24s-20 9-20 24c0 6 1 12 4 20l-8 7c-4-7-6-16-6-27Z"
        fill={`url(#${scarf})`}
        stroke="#c9a45f"
        strokeOpacity="0.55"
        strokeWidth="0.8"
      />

      {/* face */}
      <circle cx="60" cy="55" r="23" fill="#f0c39b" />

      {/* fringe */}
      <path
        d="M38 48c2-13 10-20 22-20s20 7 22 20c-6-8-13-11-22-11s-16 3-22 11Z"
        fill="#2b1712"
      />

      {/* brows */}
      <path d="M46 49c2-2 5-2 7 0" stroke="#2b1712" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M67 49c2-2 5-2 7 0" stroke="#2b1712" strokeWidth="1.6" strokeLinecap="round" fill="none" />

      {/* eyes */}
      <ellipse cx="51" cy="56" rx="2.7" ry="3.5" fill="#241310" />
      <ellipse cx="69" cy="56" rx="2.7" ry="3.5" fill="#241310" />
      <circle cx="52" cy="54.8" r="0.9" fill="#fff7ea" />
      <circle cx="70" cy="54.8" r="0.9" fill="#fff7ea" />

      {/* cheeks + smile + nose */}
      <circle cx="44" cy="62" r="4" fill="#d97b6b" opacity="0.32" />
      <circle cx="76" cy="62" r="4" fill="#d97b6b" opacity="0.32" />
      <path d="M55 62c1.5 1.6 3 1.6 4.5 0" stroke="#c98b62" strokeWidth="1.1" strokeLinecap="round" fill="none" />
      <path d="M53 66c2.4 2.8 4.7 4.2 7 4.2s4.6-1.4 7-4.2" stroke="#7c202c" strokeWidth="1.7" strokeLinecap="round" fill="none" />

      {/* earrings */}
      <circle cx="34" cy="59" r="2" fill="#f1d690" />
      <circle cx="86" cy="59" r="2" fill="#f1d690" />

      {/* leaf badge */}
      <path
        d="M40 99c0-6 2.4-10.5 7-13-.4 6.5-2.6 10.6-7 13Z"
        fill="#6cc596"
        stroke="#f1d690"
        strokeOpacity="0.4"
        strokeWidth="0.5"
      />
      <path d="M40 100v-9" stroke="#f1d690" strokeOpacity="0.65" strokeWidth="0.8" strokeLinecap="round" />

      {/* sparkles */}
      <path d="M93 30l1.4 3.4L98 35l-3.6 1.6L93 40l-1.4-3.4L88 35l3.6-1.6Z" fill="#f1d690" opacity="0.8" />
      <circle cx="26" cy="36" r="1.3" fill="#f1d690" opacity="0.65" />
    </svg>
  );
}
