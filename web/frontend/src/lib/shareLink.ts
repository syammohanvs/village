/**
 * The link a student opens when the page is served from somewhere else.
 *
 * The share link the backend prints points at *itself*: opening it sets a
 * cookie on the backend's origin and lands on the copy of the app that origin
 * serves.  That is the right link for the exhibit.
 *
 * A page hosted on Cloudflare Pages is a different origin, though.  There the
 * browser will not keep the backend's cookie (a third-party cookie), and the
 * link has to say two things at once: where the backend is (`api=`) and which
 * visit it is (`share=`).  The page then exchanges the key for a token — see
 * `api.shareLogin`.
 *
 * Deliberately DOM-free, so the composition can be tested without a browser.
 */
export function shareLinkFor(origin: string, apiBase: string, key: string): string | null {
  if (!origin || !apiBase || !key) return null;
  const base = origin.replace(/\/$/, '');
  const api = apiBase.replace(/\/$/, '');
  return `${base}/?api=${encodeURIComponent(api)}&share=${encodeURIComponent(key)}`;
}
