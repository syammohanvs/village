// Replaced at build time by vite.config.ts. It is the moment the bundle was
// produced, shown in Setup so a stale tab is obvious.
declare const __BUILD_TIME__: string;

export const BUILD_TIME: string = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';

export function buildLabel(): string {
  if (!BUILD_TIME) return 'development';
  const at = new Date(BUILD_TIME);
  return Number.isNaN(at.getTime()) ? BUILD_TIME : at.toLocaleString();
}
