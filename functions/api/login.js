/**
 * POST /api/login
 * Verifies the shared app password (env.APP_PASSWORD) and, on success,
 * sets a signed session cookie (see src/lib/auth.js). This app is
 * single-user (personal use, PRD non-goal: "layanan multi-user publik"),
 * so there's no account system - just one password gate in front of the
 * dashboard and every /api/* route (enforced in functions/_middleware.js).
 */

import { createSessionToken, timingSafeEqual, sessionCookieHeader } from "../../src/lib/auth.js";
import { checkLockout, recordFailure, recordSuccess } from "../../src/lib/loginAttempts.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.APP_PASSWORD || !env.SESSION_SECRET) {
    return json(500, {
      error_code: "AUTH_NOT_CONFIGURED",
      error: "APP_PASSWORD / SESSION_SECRET belum di-set di server ini. Lihat README bagian Login.",
    });
  }

  const ip = request.headers.get("cf-connecting-ip") || "unknown";

  const lockout = await checkLockout(env.DB, ip);
  if (lockout.locked) {
    return json(429, {
      error_code: "LOCKED_OUT",
      error: "Terlalu banyak percobaan gagal. Coba lagi nanti.",
      locked_until: lockout.lockedUntil,
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error_code: "BAD_REQUEST", error: "Body harus JSON." });
  }

  const password = typeof body?.password === "string" ? body.password : "";
  const valid = password.length > 0 && timingSafeEqual(password, env.APP_PASSWORD);

  if (!valid) {
    const { attempts, maxAttempts } = await recordFailure(env.DB, ip);
    return json(401, {
      error_code: "INVALID_PASSWORD",
      error: "Password salah.",
      attempts_remaining: Math.max(0, maxAttempts - attempts),
    });
  }

  await recordSuccess(env.DB, ip);
  const token = await createSessionToken(env.SESSION_SECRET);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": sessionCookieHeader(token),
    },
  });
}

export async function onRequestGet() {
  return json(405, { error: "Use POST to login." });
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
