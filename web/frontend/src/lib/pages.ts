export interface PageMeta {
  path: string;
  title: string;
  navLabel: string;
  kicker: string;
}

// The four things a visitor needs. Everything else lives in Setup.
export const PAGES: PageMeta[] = [
  {
    path: '/',
    title: 'Our Village',
    navLabel: 'Our Village',
    kicker: 'What the village is doing, and what you can try',
  },
  {
    path: '/waste',
    title: 'Sort Waste',
    navLabel: 'Sort Waste',
    kicker: 'Show one item to the camera and read the suggested bin',
  },
  {
    path: '/activity',
    title: 'What Happened',
    navLabel: 'What Happened',
    kicker: 'A simple timeline of what the village did and why',
  },
  {
    path: '/about',
    title: 'About & Help',
    navLabel: 'About & Help',
    kicker: 'The project, how it works, and how to demonstrate it',
  },
];

export const SETUP_PAGE: PageMeta = {
  path: '/setup',
  title: 'Setup',
  navLabel: 'Setup',
  kicker: 'Connections, calibration, voice, camera and advanced options',
};

export const ALL_PAGES: PageMeta[] = [...PAGES, SETUP_PAGE];

export function pageMeta(pathname: string): PageMeta {
  const normalised = pathname.replace(/\/+$/, '') || '/';
  return ALL_PAGES.find((page) => page.path === normalised) ?? PAGES[0];
}
