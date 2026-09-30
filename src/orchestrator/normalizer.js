export function parseSignal(input){
  const text=String(input??"").replace(/<think>[\s\S]*?<\/think>/gi,"").trim();
  if(!text)return{signal:"ERROR",reason:""};

  const m=text.match(/^\s*SIGNAL\s*:\s*(BUY|SELL|NO_TRADE)\s*$/im);
  if(m){
    const r=text.match(/^\s*REASON\s*:\s*(.+?)(?:\n\s*\n|$)/ims);
    return{signal:m[1].toUpperCase(),reason:r?.[1]?.trim()||""};
  }

  const loose=text.match(/^\s*(BUY|SELL|NO_TRADE)\b/i);
  return loose
    ? {signal:loose[1].toUpperCase(),reason:""}
    : {signal:"ERROR",reason:""};
}
