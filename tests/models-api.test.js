import {describe,it,expect} from 'vitest';
import {onRequestPut} from '../functions/api/models.js';
const fakeDb=()=>({prepare(){return {bind(){return {run:async()=>({})}}}}});
const put=(settings,env)=>onRequestPut({env:{DB:fakeDb(),...env},request:new Request('https://x/api/models',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({settings})})});
describe('legacy provider defaults allow shared providers',()=>{
  it('accepts one configured provider',async()=>{expect((await put({groq:{enabled:true}},{GROQ_API_KEY:'k'})).status).toBe(200);});
  it('rejects when no provider has a key',async()=>{expect((await put({groq:{enabled:true}},{})).status).toBe(400);});
  it('rejects when the only keyed provider is disabled',async()=>{expect((await put({groq:{enabled:false}},{GROQ_API_KEY:'k'})).status).toBe(400);});
});
