export interface PageMeta {
  path: string;
  title: string;
  navLabel: string;
  kicker: string;
}

export const PAGES: PageMeta[] = [
  {
    path: '/',
    title: 'Village Dashboard',
    navLabel: 'Dashboard',
    kicker: 'Overview · what the village is doing and why',
  },
  {
    path: '/sensors',
    title: 'Sensors & calibration',
    navLabel: 'Sensors',
    kicker: 'Live raw readings and two-point calibration',
  },
  {
    path: '/controls',
    title: 'Controls',
    navLabel: 'Controls',
    kicker: 'Manual commands, safety gates and the command log',
  },
  {
    path: '/waste',
    title: 'Waste camera',
    navLabel: 'Waste camera',
    kicker: 'Local recognition — an indication, never proof of disposal',
  },
  {
    path: '/activity',
    title: 'Activity',
    navLabel: 'Activity',
    kicker: 'Commands, recognitions, alerts and connection changes',
  },
  {
    path: '/settings',
    title: 'Settings',
    navLabel: 'Settings',
    kicker: 'Connection, voice, camera and first-run checks',
  },
  {
    path: '/villagers',
    title: 'Villagers',
    navLabel: 'Villagers',
    kicker: 'Fictional sample profiles for the exhibition',
  },
];

export function pageMeta(pathname: string): PageMeta {
  const normalised = pathname.replace(/\/+$/, '') || '/';
  return PAGES.find((page) => page.path === normalised) ?? PAGES[0];
}
