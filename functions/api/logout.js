/**
 * POST /api/logout
 * Clears the session cookie. No server-side session state to invalidate
 * (tokens are stateless signed cookies) - the old cookie simply stops
 * being sent by the browser once this response overwrites it.
 */

import { clearSessionCookieHeader } from "../../src/lib/auth.js";

export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": clearSessionCookieHeader(),
    },
  });
}
