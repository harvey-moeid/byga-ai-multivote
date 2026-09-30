const enc=new TextEncoder();

const b64=(u)=>{
  let s="";
  for(const x of new Uint8Array(u)) s+=String.fromCharCode(x);
  return btoa(s).replaceAll("=","").replaceAll("+","-").replaceAll("/","_");
};

const unb64=(s)=>{
  s=s.replaceAll("-","+").replaceAll("_","/");
  s+="=".repeat((4-s.length%4)%4);
  return Uint8Array.from(atob(s),c=>c.charCodeAt(0));
};

async function key(secret){
  return crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
}

export function timingSafeEqual(a,b){
  a=a??""; b=b??"";
  if(a.length!==b.length)return false;
  let x=0;
  for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);
  return x===0;
}

export async function createSessionToken(secret,{hours=24}={}){
  const exp=Date.now()+hours*3600000;
  const payload=b64(enc.encode(JSON.stringify({exp})));
  const sig=b64(await crypto.subtle.sign("HMAC",await key(secret),enc.encode(payload)));
  return payload+"."+sig;
}

export async function verifySessionToken(secret,token){
  try{
    if(!secret||!token)return false;
    const [p,s]=String(token).split(".");
    if(!p||!s)return false;
    const expected=b64(await crypto.subtle.sign("HMAC",await key(secret),enc.encode(p)));
    if(!timingSafeEqual(expected,s))return false;
    return JSON.parse(new TextDecoder().decode(unb64(p))).exp>Date.now();
  }catch{return false}
}

export function sessionCookieHeader(token){
  return `session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}
export function clearSessionCookieHeader(){
  return "session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}
export function parseCookies(request){
  const out={};
  for(const part of (request.headers.get("cookie")||"").split(";")){
    const i=part.indexOf("=");
    if(i>0)out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}
export async function isAuthenticated(request,secret){
  return verifySessionToken(secret,parseCookies(request).session);
}
