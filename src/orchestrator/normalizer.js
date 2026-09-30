function clean(input) {
  return String(input ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json|text)?/gi, "")
    .replace(/```/g, "")
    .trim();
}

function fromJson(text) {
  const candidates = [text];
  const block = text.match(/\{[\s\S]*?\}/);
  if (block) candidates.push(block[0]);
  for (const candidate of candidates) {
    try {
      const obj = JSON.parse(candidate);
      const signal = String(obj?.signal ?? obj?.SIGNAL ?? "").trim().toUpperCase();
      if (["BUY", "SELL", "NO_TRADE"].includes(signal)) return { signal, reason: String(obj?.reason ?? obj?.REASON ?? "").trim() };
    } catch {}
  }
  return null;
}

export function parseSignal(input) {
  const text = clean(input);
  if (!text) return { signal: "ERROR", reason: "" };
  const json = fromJson(text);
  if (json) return json;
  const labeled = text.match(/(?:^|[\n\r*#>\s])SIGNAL\s*(?::|=|-)?\s*(BUY|SELL|NO[_ -]?TRADE)\b/i);
  if (labeled) {
    const signal = labeled[1].toUpperCase().replace(/[ -]/g, "_");
    const reason = text.match(/(?:^|[\n\r*#>\s])REASON\s*(?::|=|-)?\s*([^\n]+)/i)?.[1]?.trim() || "";
    return { signal, reason };
  }
  const loose = text.match(/\b(BUY|SELL|NO[_ -]?TRADE)\b/i);
  return loose ? { signal: loose[1].toUpperCase().replace(/[ -]/g, "_"), reason: "" } : { signal: "ERROR", reason: "" };
}