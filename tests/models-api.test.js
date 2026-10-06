import {describe,it,expect} from 'vitest';
import {onRequestGet,onRequestPut} from '../functions/api/models.js';

describe('legacy /api/models endpoint',()=>{
  it('fails closed instead of pretending to update production settings',async()=>{
    const request=new Request('https://x/api/models',{
      method:'PUT',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({settings:{groq:{enabled:true,model:'example/model'}}})
    });
    const response=await onRequestPut({request,env:{}});
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      error_code:'DEPRECATED_ENDPOINT',
      replacement:'/api/settings'
    });
  });

  it('directs legacy readers to /api/settings',async()=>{
    const response=await onRequestGet({env:{}});
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      error_code:'DEPRECATED_ENDPOINT',
      replacement:'/api/settings'
    });
  });
});
