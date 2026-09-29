/**
 * GET /api/history?limit=&offset=&signal=
 * Lists past analyses for the History screen (PRD Section 29).
 */

import { listAnalyses } from "../../src/lib/storage.js";

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const signal = url.searchParams.get("signal"); // BUY | SELL | NO_TRADE | null

  try {
    const rows = await listAnalyses(env.DB, { limit, offset, signal });
    return json(200, { items: rows, limit, offset });
  } catch (err) {
    console.error(err);
    return json(500, { error_code: "UNKNOWN_ERROR", error: err.message });
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
