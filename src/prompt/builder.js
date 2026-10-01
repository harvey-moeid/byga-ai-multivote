import { buildICTContext } from "./ict.js";

export const PROMPT_VERSION = "1.15.0";

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
    for (let i = 1; i <= n; i++) {
      const d = closes[i] - closes[i - 1];
      gain += Math.max(d, 0); loss += Math.max(-d, 0);
    }
    let avgGain = gain / n, avgLoss = loss / n;
    for (let i = n + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      avgGain = (avgGain * (n - 1) + Math.max(d, 0)) / n;
      avgLoss = (avgLoss * (n - 1) + Math.max(-d, 0)) / n;
    }
    out.rsi14 = round(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss), 2);
    const tr = [];
    for (let i = 1; i < c.length; i++) {
      const prev = c[i - 1].close;
      tr.push(Math.max(c[i].high - c[i].low, Math.abs(c[i].high - prev), Math.abs(c[i].low - prev)));
    }
    let atr = tr.slice(0, n).reduce((a, x) => a + x, 0) / n;
    for (let i = n; i < tr.length; i++) atr = (atr * (n - 1) + tr[i]) / n;
    out.atr14 = round(atr, 2);
    out.atr_pct = round(atr / (closes.at(-1) || 1) * 100, 3);
  }
  if (!c.length) return out;
  const hi = Math.max(...c.map(x => x.high)), lo = Math.min(...c.map(x => x.low));
  out.range_pos_pct = round((closes.at(-1) - lo) / (hi - lo || 1) * 100, 2);
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
  return {
    ...(today ? { today: { high: round(today.high, 2), low: round(today.low, 2) } } : {}),
    prev_day: { high: round(prev.high, 2), low: round(prev.low, 2), close: round(prev.close, 2) },
    week_7d: { high: round(Math.max(...week.map(x => x.high)), 2), low: round(Math.min(...week.map(x => x.low)), 2) },
    month_30d: { high: round(Math.max(...month.map(x => x.high)), 2), low: round(Math.min(...month.map(x => x.low)), 2) },
    year: { high: round(Math.max(...year.map(x => x.high)), 2), low: round(Math.min(...year.map(x => x.low)), 2), days: year.length }
  };
}

function buildConfluence(snapshot, ict) {
  const m5 = ict?.timeframes?.m5 || {};
  const m15 = ict?.timeframes?.m15 || {};
  const h1 = ict?.timeframes?.h1 || {};
  const h4 = ict?.timeframes?.h4 || {};
  return {
    source: snapshot.market_data_source || "chart_db",
    exchange_source: snapshot.exchange || "chart_db",
    price: round(snapshot.last_price, 2),
    hierarchy: ict?.hierarchy?.alignment || "mixed",
    bias: { m5: m5.bias || null, m15: m15.bias || null, h1: h1.bias || null, h4: h4.bias || null },
    structure: {
      m5: m5.structure?.recent_events || [],
      m15: m15.structure?.recent_events || [],
      h1: h1.structure?.recent_events || [],
      h4: h4.structure?.recent_events || []
    },
    liquidity: {
      m5: m5.liquidity?.recent_sweeps || [],
      m15: m15.liquidity?.recent_sweeps || []
    },
    fvg: {
      m5: m5.fvg?.recent || [],
      m15: m15.fvg?.recent || [],
      h1: h1.fvg?.recent || [],
      h4: h4.fvg?.recent || []
    }
  };
}

export function buildPrompt(snap = {}, record = null, { role = "AI_A", voteIndex = 1 } = {}) {
  const m5 = snap.candles || [], m15 = snap.history_m15 || [], h1 = snap.history_h1 || [], h4 = snap.history_h4 || [], d1 = snap.history_1d || [];
  const ict = buildICTContext({ m5, m15, h1, h4 });
  const data = {
    data_source: snap.market_data_source || "chart_db",
    exchange: snap.exchange,
    symbol: snap.symbol,
    current_m5: encode(m5, cap.current_m5, 5),
    history_m15: encode(m15, cap.history_m15, 12),
    history_h1: encode(h1, cap.history_h1, 60),
    history_h4: encode(h4, cap.history_h4, 240),
    historical_1y: encode(d1, cap.historical_1y, 1440),
    key_levels: dailyLevels(d1),
    confluence: buildConfluence(snap, ict),
    signal_track_record: record || null
  };

  const system = `You are ${role}, one of exactly two independent AI analysts. All market data and ICT confluence come from chart_db. Evaluate the supplied multi-timeframe confluence independently. Never invent an FVG, OB, sweep, BOS, CHOCH, or MSS.`;
  const user = `NEXT 1-4 HOURS
VOTE SLOT: ${role} / VOTE ${voteIndex}
DATA SOURCE: chart_db
Use the chart_db confluence block as the primary confluence summary, then verify it against the candle data.

MARKET DATA:
${JSON.stringify(data)}

Use NO_TRADE when evidence is insufficient or conflicting.
This is an independent vote. Do not assume another AI agrees with you and do not copy another vote.

OUTPUT CONTRACT:
Return exactly two lines and nothing else.
SIGNAL: BUY
REASON: <one concise sentence>
SIGNAL must be exactly BUY, SELL, or NO_TRADE.
No markdown, JSON, code fences, explanations, or text before SIGNAL.`;

  return { system, user };
}
