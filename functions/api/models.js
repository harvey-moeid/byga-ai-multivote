const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" }
});

function deprecated() {
  return json(410, {
    error_code: "DEPRECATED_ENDPOINT",
    error: "/api/models tidak lagi mengontrol pipeline produksi. Gunakan /api/settings untuk provider dan model per karakter.",
    replacement: "/api/settings"
  });
}

export async function onRequestGet() {
  return deprecated();
}

export async function onRequestPut() {
  return deprecated();
}
