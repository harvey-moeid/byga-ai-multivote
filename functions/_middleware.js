/**
 * Global login gate. Cloudflare Pages runs this middleware in front of
 * every request to the project - static dashboard assets included - so
 * it's the single choke point that protects both the SPA and /api/*.
 *
 * Public (no session required): the login page itself, POST /api/login,
 * and POST /api/ingest (authenticated separately with its own shared
 * secret header instead of a session cookie - see functions/api/ingest.js -
 * since it's called by the GitHub Actions cron in
 * .github/workflows/refresh-live-ticker.yml, which has no browser
 * session). Everything else requires a valid signed session cookie (see
 * src/lib/auth.js); page requests without one are redirected to /login,
 * API requests get a 401 JSON body.
 */

import { isAuthenticated } from "../src/lib/auth.js";

const PUBLIC_PATHS = new Set(["/login", "/login.html", "/login.js", "/api/login", "/api/ingest"]);

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (PUBLIC_PATHS.has(path) || path === "/styles.css") {
    // styles.css is shared by the login page and the app shell, and is
    // not sensitive, so it's allowed through unauthenticated too.
    return next();
  }

  if (!env.APP_PASSWORD || !env.SESSION_SECRET) {
    // Fail closed: without these secrets configured there is no way to
    // verify anyone, so nothing gets through rather than silently
    // falling back to "open". See README "Login" section.
    const message = "Login belum dikonfigurasi di server ini: set APP_PASSWORD dan SESSION_SECRET (lihat README bagian Login).";
    if (path.startsWith("/api/")) {
      return json(500, { error_code: "AUTH_NOT_CONFIGURED", error: message });
    }
    return new Response(message, { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const authed = await isAuthenticated(request, env.SESSION_SECRET);
  if (authed) return next();

  if (path.startsWith("/api/")) {
    return json(401, { error_code: "UNAUTHENTICATED", error: "Silakan login terlebih dahulu." });
  }

  const loginUrl = new URL("/login", url.origin);
  return Response.redirect(loginUrl.toString(), 302);
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
