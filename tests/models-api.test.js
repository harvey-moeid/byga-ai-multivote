import { describe, expect, it } from "vitest";
import { onRequestPut } from "../functions/api/models.js";
const fakeDb = () => { const stmt={bind:()=>stmt,run:async()=>({}),first:async()=>null}; return {prepare:()=>stmt}; };
const sixKeys={GEMINI_API_KEY:"k",GROQ_API_KEY:"k",OPENROUTER_API_KEY:"k",MISTRAL_API_KEY:"k",HUGGINGFACE_API_KEY:"k",COHERE_API_KEY:"k"};
const sixSettings={"google-gemini":{enabled:true},groq:{enabled:true},openrouter:{enabled:true},"mistral-ai":{enabled:true},"hugging-face":{enabled:true},cohere:{enabled:true}};
const put=(settings,env)=>onRequestPut({env:{DB:fakeDb(),...env},request:new Request("https://x.test/api/models",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({settings})})});
describe("PUT /api/models: six enabled providers must have API keys",()=>{
 it("rejects when fewer than six usable providers are configured",async()=>{const res=await put({groq:{enabled:true}},{GROQ_API_KEY:"k"});expect(res.status).toBe(400);expect((await res.json()).error_code).toBe("INSUFFICIENT_PROVIDERS");});
 it("rejects when six settings are enabled but only five have keys",async()=>{const env={...sixKeys};delete env.COHERE_API_KEY;const res=await put(sixSettings,env);expect(res.status).toBe(400);expect((await res.json()).configured_providers).toBe(5);});
 it("accepts six enabled providers with keys",async()=>{const res=await put({...sixSettings,groq:{enabled:true,model:"openai/gpt-oss-120b"}},sixKeys);expect(res.status).toBe(200);expect((await res.json()).ok).toBe(true);});
 it("still rejects when a keyed provider is disabled and that leaves fewer than six",async()=>{const res=await put({...sixSettings,groq:{enabled:false}},sixKeys);expect(res.status).toBe(400);});
});