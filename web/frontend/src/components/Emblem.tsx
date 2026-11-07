export function Emblem({ size = 64 }: { size?: number }) {
  return (
    <svg
      className="emblem"
      width={size}
      height={size}
      viewBox="0 0 96 96"
      role="img"
      aria-label="Smart Green Village emblem"
    >
      <defs>
        <linearGradient id="emblem-disc" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8c1626" />
          <stop offset="0.55" stopColor="#5d0f1a" />
          <stop offset="1" stopColor="#2c080d" />
        </linearGradient>
        <linearGradient id="emblem-leaf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2d9a4" />
          <stop offset="1" stopColor="#c39a52" />
        </linearGradient>
      </defs>
      <circle cx="48" cy="48" r="45" fill="url(#emblem-disc)" stroke="#c9a45f" strokeWidth="1.2" />
      <circle cx="48" cy="48" r="39" fill="none" stroke="#e6c37a" strokeOpacity="0.4" strokeWidth="0.7" />
      <circle cx="48" cy="48" r="33" fill="none" stroke="#e6c37a" strokeOpacity="0.18" strokeWidth="0.5" />
      <path
        d="M48 68c0-13 4.6-23 15-29-1.4 14.3-6 23-15 29Z"
        fill="url(#emblem-leaf)"
      />
      <path
        d="M48 68c0-13-4.6-23-15-29 1.4 14.3 6 23 15 29Z"
        fill="url(#emblem-leaf)"
        opacity="0.72"
      />
      <path d="M48 69V42" stroke="#e6c37a" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="48" cy="33" r="5" fill="none" stroke="#f2d9a4" strokeWidth="1.6" />
      <path d="M48 25v-2.5M56.5 33H59M37 33h2.5M54 27l1.8-1.8M42 27l-1.8-1.8" stroke="#f2d9a4" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M27 72h42" stroke="#c9a45f" strokeOpacity="0.5" strokeWidth="0.8" />
    </svg>
  );
}
