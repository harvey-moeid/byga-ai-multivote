import { buildICTContext } from "./ict.js";

export const PROMPT_VERSION = "1.14.0";

const cap = {
  current_m5: 32,
  history_m15: 12,
  history_h1: 8,
  history_h4: 6,
  historical_1y: 14
};

const round = (v, digits = 4) => Number.isFinite(Number(v)) ? Number(Number(v).toFixed(digits)) : v;

const ema = (a, n) => {
  if (a.length < n) return undefined;
  let e = a.slice(0, n).reduce((x, c) => x + c.close, 0) / n;
  const k = 2 / (n + 1);
  for (let i = n; i < a.length; i++) e = a[i].close * k + e * (1 - k);
  return e;
};

const stats = c => {
  const closes = c.map(x => x.close);
  const out = { candles: c.length, ema20: round(ema(c, 20), 2), ema50: round(ema(c, 50), 2) };
  if (c.length > 14) {
    const n = 14;
    let gain = 0, loss = 0;
    for (let i = 1; i <= n; i++) { const d = closes[i] - closes[i - 1]; gain += Math.max(d, 0); loss += Math.max(-d, 0); }
    let avgGain = gain / n, avgLoss = loss / n;
    for (let i = n + 1; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; avgGain = (avgGain * (n - 1) + Math.max(d, 0)) / n; avgLoss = (avgLoss * (n - 1) + Math.max(-d, 0)) / n; }
    out.rsi14 = round(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss), 2);
    const tr = [];
    for (let i = 1; i < c.length; i++) { const prev = c[i - 1].close; tr.push(Math.max(c[i].high - c[i].low, Math.abs(c[i].high - prev), Math.abs(c[i].low - prev))); }
    let atr = tr.slice(0, n).reduce((a, x) => a + x, 0) / n;
    for (let i = n; i < tr.length; i++) atr = (atr * (n - 1) + tr[i]) / n;
    out.atr14 = round(atr, 2); out.atr_pct = round(atr / (closes.at(-1) || 1) * 100, 3);
  }
  const hi = Math.max(...c.map(x => x.high));
  const lo = Math.min(...c.map(x => x.low));
  out.range_pos_pct = round((closes.at(-1) - lo) / (hi - lo || 1) * 100, 2);
  for (let i = c.length - 2; i >= 1; i--) {
    if (c[i].high > c[i - 1].high && c[i].high > c[i + 1].high) {
      out.swing_high = [round(c[i].high, 2), c.length - 1 - i];
      break;
    }
  }
  return out;
};

const encode = (c, n, stepMin) => {
  const x = c.slice(-n);
  return {
    candles_fetched: c.length,
    candles_included: x.length,
    step_min: stepMin,
    start: x.length ? new Date(x[0].timestamp).toISOString() : undefined,
    candles: x.map((v, i) => [i, round(v.open, 2), round(v.high, 2), round(v.low, 2), round(v.close, 2), round(v.volume, 2)]),
    indicators: stats(c)
  };
};

function dailyLevels(c) {
  const closed = c.filter(x => x.closed !== false);
  if (!closed.length) return null;
  const today = c.at(-1)?.closed === false ? c.at(-1) : null;
  const prev = closed.at(-1);
  const week = closed.slice(-7), month = closed.slice(-30), year = closed;
  const idxH = year.reduce((a, x, i) => x.high > year[a].high ? i : a, 0);
  const idxL = year.reduce((a, x, i) => x.low < year[a].low ? i : a, 0);
  return {
    ...(today ? { today: { high: round(today.high, 2), low: round(today.low, 2) } } : {}),
    prev_day: { high: round(prev.high, 2), low: round(prev.low, 2), close: round(prev.close, 2) },
    week_7d: { high: round(Math.max(...week.map(x => x.high)), 2), low: round(Math.min(...week.map(x => x.low)), 2) },
    month_30d: { high: round(Math.max(...month.map(x => x.high)), 2), low: round(Math.min(...month.map(x => x.low)), 2) },
    year: { high: round(Math.max(...year.map(x => x.high)), 2), low: round(Math.min(...year.map(x => x.low)), 2), high_days_ago: year.length - 1 - idxH, low_days_ago: year.length - 1 - idxL, days: year.length }
  };
}

export function buildPrompt(snap = {}, record = null) {
  const m5 = snap.candles || [], m15 = snap.history_m15 || [], h1 = snap.history_h1 || [], h4 = snap.history_h4 || [], d1 = snap.history_1d || [];
  const data = {
    exchange: snap.exchange,
    symbol: snap.symbol,
    current_m5: encode(m5, cap.current_m5, 5),
    history_m15: encode(m15, cap.history_m15, 15),
    history_h1: encode(h1, cap.history_h1, 60),
    history_h4: encode(h4, cap.history_h4, 240),
    historical_1y: encode(d1, cap.historical_1y, 1440),
    key_levels: dailyLevels(d1),
    ict: buildICTContext({ m5, m15, h1, h4 }),
    signal_track_record: record || null
  };
  // Derivatives (funding rate / open interest / basis) are no longer part of
  // the prompt â chart_db (now the primary market data source) doesn't carry
  // them, so the field is dropped entirely rather than only when missing.

  const system = "You are an AI market analyst using a deterministic ICT-style multi-timeframe framework. Never infer a trend from a single snapshot. Return only the requested decision format.";
  const user = `NEXT 1-4 HOURS
ICT CONTRACT
Do not invent an FVG, OB, sweep, BOS, CHOCH, or MSS.
MARKET DATA:
${JSON.stringify(data)}
Candle schema: [index, open, high, low, close, volume].
signal_track_record is weak context.
Use NO_TRADE when evidence is insufficient or volatility/context does not support a directional setup.

OUTPUT CONTRACT:
Return exactly two lines and nothing else.
SIGNAL: BUY
REASON: <one concise sentence>
SIGNAL must be exactly BUY, SELL, or NO_TRADE.
No markdown, JSON, code fences, explanations, or text before SIGNAL.`;

  return { system, user };
}