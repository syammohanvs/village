// Shared reverse proxy for Cloudflare Pages Functions.
//
// The dashboard is a static SPA, but it needs the FastAPI village backend for
// /api/v1/* and for the waste model files under /models/*. Proxying through
// Pages keeps the browser on one origin, so no CORS configuration is needed
// and the backend can live behind a Cloudflare Tunnel.
//
// Set VILLAGE_API_ORIGIN in the Pages project (Settings -> Environment
// variables), for example: https://village-api.example.com
// It may include a path prefix; trailing slashes are ignored.

export async function proxyToVillage(request, env) {
  const configured = String(env.VILLAGE_API_ORIGIN ?? '').trim();
  if (!configured) {
    return json(503, {
      error: {
        code: 'API_ORIGIN_MISSING',
        message:
          'VILLAGE_API_ORIGIN is not set for this deployment. The dashboard is static; the village backend must be reachable.',
      },
    });
  }

  let base;
  try {
    base = new URL(configured);
  } catch {
    return json(503, {
      error: {
        code: 'API_ORIGIN_INVALID',
        message: 'VILLAGE_API_ORIGIN must be an absolute URL, for example https://village-api.example.com',
      },
    });
  }

  const incoming = new URL(request.url);
  const prefix = base.pathname.replace(/\/+$/, '');
  const target = new URL(`${prefix}${incoming.pathname}${incoming.search}`, base.origin);

  const headers = new Headers(request.headers);
  headers.set('host', target.host);
  headers.delete('cf-connecting-ip');
  headers.delete('cf-ray');
  headers.delete('cf-visitor');

  const init = { method: request.method, headers, redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }

  let response;
  try {
    response = await fetch(target, init);
  } catch (error) {
    return json(502, {
      error: {
        code: 'UPSTREAM_UNREACHABLE',
        message: `The village backend at ${base.origin} did not answer: ${error instanceof Error ? error.message : String(error)}`,
      },
    });
  }

  const out = new Headers(response.headers);
  out.set('cache-control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: out,
  });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
