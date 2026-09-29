/**
 * GET /api/analysis/:id
 * Full detail for one analysis: market snapshot, exchange, prompt version,
 * all six AI results (incl. raw answers), voting, error info (PRD Section 29).
 */

import { getAnalysisDetail } from "../../../src/lib/storage.js";

export async function onRequestGet(context) {
  const { env, params } = context;
  const id = params.id;

  try {
    const detail = await getAnalysisDetail(env.DB, id);
    if (!detail) {
      return json(404, { error_code: "NOT_FOUND", error: `Analysis ${id} not found.` });
    }
    return json(200, detail);
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
