function clean(input) {
  return String(input ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/`{3}(?:json|text)?/gi, "")
    .replace(/`{3}/g, "")
    .trim();
}

function confidenceValue(value) {
  const n=typeof value==='string'?Number.parseFloat(value):Number(value);
  if(!Number.isFinite(n))return null;
  return Math.max(0,Math.min(100,n<=1?n*100:n));
}

function fromJson(text) {
  const candidates = [text];
  const block = text.match(/\{[\s\S]*?\}/);
  if (block) candidates.push(block[0]);

  for (const candidate of candidates) {
    try {
      const obj = JSON.parse(candidate);
      const signal = String(obj?.signal ?? obj?.SIGNAL ?? "").trim().toUpperCase();
      if (["BUY","SELL"].includes(signal)) {
        return {
          signal,
          reason: String(obj?.reason ?? obj?.REASON ?? "").trim(),
          confidence: confidenceValue(obj?.confidence ?? obj?.CONFIDENCE)
        };
      }
    } catch {}
  }

  return null;
}

export function parseSignal(input) {
  const text = clean(input);
  if (!text) return { signal: "ERROR", reason: "", confidence:null };

  const json = fromJson(text);
  if (json) return json;

  const labeled = text.match(
    /(?:^|[\n\r*#>\s])SIGNAL\s*(?::|=|-)?\s*(BUY|SELL|NO[_ -]?TRADE)\b/i
  );

  if (labeled) {
    const signal = labeled[1].toUpperCase().replace(/[ -]/g, "_");
    const reason = text.match(
      /(?:^|[\n\r*#>\s])REASON\s*(?::|=|-)?\s*([^\n]+)/i
    )?.[1]?.trim() || "";
    const confidence = confidenceValue(text.match(
      /(?:^|[\n\r*#>\s])CONFIDENCE\s*(?::|=|-)?\s*([0-9]+(?:\.[0-9]+)?)/i
    )?.[1]);

    return { signal, reason, confidence };
  }

  const leading = text.match(/^(?:[\s*#>_-]*)(BUY|SELL|NO[_ -]?TRADE)\b/i);
  if (leading) {
    return {
      signal: leading[1].toUpperCase().replace(/[ -]/g, "_"),
      reason: "",
      confidence:null
    };
  }

  return { signal: "ERROR", reason: "", confidence:null };
}


const ANALYST_EVIDENCE_METRICS = {
  smc_ict: new Set(['structure','sweep','fvg','orderBlock','displacement','bias']),
  indicators: new Set(['ema','rsi','macd','bollinger','adx']),
  volume: new Set(['cmf','obv','flow','candleDirection']),
  derivatives: new Set(['openInterest','funding','longShort','liquidation'])
};

function evidenceDirection(group, frame, metric, parameters={}) {
  if(!frame)return null;
  if(group==='smc_ict'&&metric==='bias')return frame.measurements?.bias||null;
  if(group==='volume') {
    const m=frame.measurements||{};
    if(metric==='cmf')return Number(m.cmf)>=Number(parameters.cmfMin)?'BUY':Number(m.cmf)<=-Number(parameters.cmfMin)?'SELL':'NEUTRAL';
    if(metric==='obv')return Number(m.obvChange)>0?'BUY':Number(m.obvChange)<0?'SELL':'NEUTRAL';
    return m[metric]||null;
  }
  return frame.votes?.[metric]||null;
}

export function parseAnalystDecision(input,{group,frames,parameters}={}) {
  const text=clean(input);
  let obj;
  try { obj=JSON.parse(text); }
  catch {
    throw Object.assign(new Error('Respons analis harus JSON valid tanpa teks tambahan.'),{code:'SEMANTIC_INVALID_AI_RESPONSE'});
  }
  const signal=String(obj?.signal||'').trim().toUpperCase();
  const confidence=Number(obj?.confidence);
  const reason=String(obj?.reason||'').trim();
  if(!['BUY','SELL'].includes(signal)||!Number.isFinite(confidence)||confidence<0||confidence>100||!reason||reason.length>600) {
    throw Object.assign(new Error('Signal, confidence, atau reason analis tidak memenuhi kontrak.'),{code:'SEMANTIC_INVALID_AI_RESPONSE'});
  }
  const allowed=ANALYST_EVIDENCE_METRICS[group];
  const evidence=Array.isArray(obj?.directional_evidence)?obj.directional_evidence:[];
  if(!allowed||evidence.length<2||evidence.length>6) {
    throw Object.assign(new Error('Directional evidence analis tidak memenuhi kontrak.'),{code:'SEMANTIC_INVALID_AI_RESPONSE'});
  }
  const seen=new Set(),verified=[];
  for(const item of evidence) {
    const timeframe=String(item?.timeframe||'').trim().toUpperCase();
    const metric=String(item?.metric||'').trim();
    const supports=String(item?.supports||'').trim().toUpperCase();
    const key=group==='derivatives'&&metric==='funding'?'GLOBAL:funding':timeframe+':'+metric;
    if(!frames?.[timeframe]||!allowed.has(metric)||supports!==signal||seen.has(key)) {
      throw Object.assign(new Error('Directional evidence analis tidak dapat diverifikasi.'),{code:'SEMANTIC_INVALID_AI_RESPONSE'});
    }
    if(evidenceDirection(group,frames[timeframe],metric,parameters)!==signal) {
      throw Object.assign(new Error('Directional evidence tidak didukung snapshot deterministik.'),{code:'SEMANTIC_INVALID_AI_RESPONSE'});
    }
    seen.add(key);verified.push({timeframe,metric,supports});
  }
  return {signal,confidence,reason,directional_evidence:verified};
}
