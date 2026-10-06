/**
 * Public 3D office lives at / and exposes only the deliberately reduced
 * /api/public-status payload. Admin pages and every other API stay behind
 * the signed session cookie.
 */
import { isAuthenticated } from "../src/lib/auth.js";

const PUBLIC_PATHS = new Set([
  "/","/index.html","/office.css","/office.bundle.js","/public.js",
  "/login","/login.html","/login.js","/styles.css",
  "/pwa.js","/sw.js","/manifest.webmanifest","/byga-logo.png",
  "/favicon.ico","/favicon.png","/favicon-16.png","/favicon-32.png",
  "/favicon-64.png","/apple-touch-icon.png",
  "/icons/pwa-192.png","/icons/pwa-512.png",
  "/icons/maskable-192.png","/icons/maskable-512.png",
  "/api/login","/api/ingest","/api/cron","/api/public-status",
  "/robots.txt"
]);

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (PUBLIC_PATHS.has(path)) return next();

  if (!env.APP_PASSWORD || !env.SESSION_SECRET) {
    const message = "Login admin belum dikonfigurasi: set APP_PASSWORD dan SESSION_SECRET.";
    if (path.startsWith("/api/")) return json(500,{error_code:"AUTH_NOT_CONFIGURED",error:message});
    return new Response(message,{status:500,headers:{"content-type":"text/plain; charset=utf-8"}});
  }

  const authed = await isAuthenticated(request, env.SESSION_SECRET);
  if (authed) return next();

  if (path.startsWith("/api/")) {
    return json(401,{error_code:"UNAUTHENTICATED",error:"Silakan login terlebih dahulu."});
  }

  const loginUrl = new URL("/login", url.origin);
  return Response.redirect(loginUrl.toString(),302);
}

function json(status, body) {
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
}
