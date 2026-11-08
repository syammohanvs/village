import { proxyToVillage } from './functions/_proxy.js';

// Cloudflare Worker with static assets.
//
// /api/* and /models/* are proxied to the FastAPI village backend configured
// by VILLAGE_API_ORIGIN. Everything else is served from the built SPA, with
// SPA routing handled by `assets.not_found_handling` in wrangler.jsonc.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (
      url.pathname === '/api' ||
      url.pathname.startsWith('/api/') ||
      url.pathname === '/models' ||
      url.pathname.startsWith('/models/')
    ) {
      return proxyToVillage(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
