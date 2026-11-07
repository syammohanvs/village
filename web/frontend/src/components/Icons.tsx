import type { ReactNode } from 'react';

export interface IconProps {
  size?: number;
  className?: string;
  title?: string;
}

function Svg({
  size = 20,
  className,
  title,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const IconDashboard = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 10.5 12 3.5l8.5 7" />
    <path d="M5.5 9.5V20h13V9.5" />
    <path d="M9.8 20v-5.2h4.4V20" />
  </Svg>
);

export const IconSensors = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.2c3.2 3.7 5.3 6.3 5.3 8.9a5.3 5.3 0 0 1-10.6 0c0-2.6 2.1-5.2 5.3-8.9Z" />
    <path d="M9.4 12.6c.3 1.4 1.2 2.2 2.6 2.2" />
  </Svg>
);

export const IconControls = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2.1" />
    <circle cx="9" cy="17" r="2.1" />
  </Svg>
);

export const IconWaste = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 8.5h3l1-2h6l1 2h3" />
    <rect x="5" y="8.5" width="14" height="11" rx="2.2" />
    <circle cx="12" cy="14" r="3" />
    <path d="m10.6 14 1 1 1.9-2" />
  </Svg>
);

export const IconActivity = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h10M4 12h16M4 18h12" />
    <circle cx="18" cy="6" r="1.4" />
    <circle cx="19" cy="18" r="1.4" />
  </Svg>
);

export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M12 3.2v2.1M12 18.7v2.1M4.8 7.8l1.8 1.1M17.4 15.1l1.8 1.1M4.8 16.2l1.8-1.1M17.4 8.9l1.8-1.1" />
  </Svg>
);

export const IconVillagers = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.6 20c.4-3.1 2.4-5 5.4-5s5 1.9 5.4 5" />
    <path d="M16 5.2a3 3 0 0 1 0 5.6M17.2 15.3c2 .5 3.1 2.2 3.4 4.7" />
  </Svg>
);

export const IconMic = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="2.8" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" />
  </Svg>
);

export const IconSpeaker = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9.5h3l4.5-3.7v12.4L7 14.5H4z" />
    <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </Svg>
);

export const IconSun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.6v2M12 19.4v2M4.4 4.4l1.4 1.4M18.2 18.2l1.4 1.4M2.6 12h2M19.4 12h2M4.4 19.6l1.4-1.4M18.2 5.8l1.4-1.4" />
  </Svg>
);

export const IconMoon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.6A8.2 8.2 0 0 1 9.4 4a8.4 8.4 0 1 0 10.6 10.6Z" />
  </Svg>
);

export const IconDroplet = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.2c3.4 4 5.4 6.7 5.4 9.4a5.4 5.4 0 1 1-10.8 0c0-2.7 2-5.4 5.4-9.4Z" />
  </Svg>
);

export const IconLeaf = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 19c0-7 5-12 14-13-1 9-6 14-13 14" />
    <path d="M4.5 20c2.2-4.4 5.1-7.3 9.5-9" />
  </Svg>
);

export const IconPump = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="10" width="9" height="8" rx="2" />
    <path d="M13 12h3.2a2.8 2.8 0 0 1 2.8 2.8V18M8.5 10V7.4M8.5 7.4h5.2a2 2 0 0 1 2 2v.6" />
    <path d="M6 18v2M11 18v2" />
  </Svg>
);

export const IconLamp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.2 15.2a5.4 5.4 0 1 1 7.6 0c-.9.9-1.3 1.7-1.3 2.8H9.5c0-1.1-.4-1.9-1.3-2.8Z" />
    <path d="M9.8 20.5h4.4M12 2.5v1.6M4.8 5.7l1.1 1.1M19.2 5.7l-1.1 1.1" />
  </Svg>
);

export const IconBin = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 8h13l-1.2 12H6.7Z" />
    <path d="M4 8h16M9.5 5h5M10 11.5v5M14 11.5v5" />
  </Svg>
);

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.4 21 19.6H3Z" />
    <path d="M12 9.2v4.4M12 16.7v.4" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4.8 12.4 4.6 4.4L19.4 6.6" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5" />
  </Svg>
);

export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 11.5A8 8 0 1 1 17.4 5.9" />
    <path d="M20.4 3.6v5.2h-5.2" />
  </Svg>
);

export const IconMenu = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6.5h16M4 12h16M4 17.5h16" />
  </Svg>
);

export const IconPlay = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.5 4.8 19 12 7.5 19.2Z" />
  </Svg>
);

export const IconStop = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </Svg>
);

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5v11M7.8 10.6 12 14.8l4.2-4.2" />
    <path d="M4.5 19.5h15" />
  </Svg>
);

export const IconInfo = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 10.6v5.2M12 7.6v.4" />
  </Svg>
);

export const IconCamera = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 8.2h3.2l1.2-2h7.2l1.2 2h3.2v10.3h-16Z" />
    <circle cx="12" cy="13" r="3.2" />
  </Svg>
);

export const IconPlug = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.5 3.5v4M15.5 3.5v4" />
    <path d="M6.5 7.5h11v2.6a5.5 5.5 0 0 1-11 0Z" />
    <path d="M12 15.6v4.9" />
  </Svg>
);

export const IconWifi = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 9.2a12.4 12.4 0 0 1 17 0M6.5 12.5a8 8 0 0 1 11 0M9.4 15.8a3.8 3.8 0 0 1 5.2 0" />
    <path d="M12 19.2v.4" />
  </Svg>
);

export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 12h14M13.5 7l5 5-5 5" />
  </Svg>
);

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="10.2" width="14" height="10" rx="2.2" />
    <path d="M8.2 10.2V7.8a3.8 3.8 0 0 1 7.6 0v2.4" />
  </Svg>
);

export const IconSparkle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.2 13.7 9l5.8 1.7-5.8 1.7L12 18.2 10.3 12.4 4.5 10.7 10.3 9Z" />
    <path d="M18.6 16.4l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7Z" />
  </Svg>
);
