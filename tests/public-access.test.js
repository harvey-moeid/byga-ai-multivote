import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {onRequest as middleware} from '../functions/_middleware.js';
import {onRequestGet as publicStatus} from '../functions/api/public-status.js';

describe('public UI and PWA access contract',()=>{
  it('serves every public shell asset without requiring admin auth',async()=>{
    const paths=[
      '/','/index.html','/office.css','/office.bundle.js','/public.js',
      '/login','/login.html','/login.js','/styles.css',
      '/pwa.js','/sw.js','/manifest.webmanifest','/byga-logo.png?v=2',
      '/favicon.png','/favicon-16.png','/favicon-32.png','/favicon-64.png',
      '/apple-touch-icon.png','/icons/pwa-192.png','/icons/pwa-512.png',
      '/icons/maskable-192.png','/icons/maskable-512.png','/api/public-status'
    ];
    for(const path of paths){
      const next=vi.fn(async()=>new Response(null,{status:204}));
      const response=await middleware({
        request:new Request('https://example.com'+path),
        env:{},
        next
      });
      expect(response.status,path).toBe(204);
      expect(next,path).toHaveBeenCalledTimes(1);
    }
  });

  it('keeps admin HTML and admin bundle protected',async()=>{
    for(const path of ['/admin','/admin.html','/app.bundle.js']){
      const next=vi.fn();
      const response=await middleware({
        request:new Request('https://example.com'+path),
        env:{APP_PASSWORD:'configured',SESSION_SECRET:'test-secret'},
        next
      });
      expect(response.status,path).toBe(302);
      expect(response.headers.get('location'),path).toBe('https://example.com/login');
      expect(next,path).not.toHaveBeenCalled();
    }
  });

  it('pre-caches only public/login shell files and rejects redirected cache entries',()=>{
    const source=readFileSync(new URL('../dashboard/sw.js',import.meta.url),'utf8');
    expect(source).toContain("const VERSION = 'byga-pwa-v7'");
    expect(source).not.toContain("'/admin.html'");
    expect(source).not.toContain("'/app.bundle.js'");
    expect(source).toContain("response.ok && !response.redirected");
  });
});

describe('/api/public-status contract',()=>{
  const db=(row)=>({
    prepare(sql){
      expect(sql).toContain("json_extract(result,'$.status')='approved'");
      return {first:async()=>row};
    }
  });

  it('returns the latest approved BUY/SELL signal only',async()=>{
    const approved={
      id:'AUTO-1',
      status:'approved',
      symbol:'BTCUSDT.P',
      timeframe:'H1/M15/M5',
      majority_signal:'SELL',
      created_at:'2026-10-06T12:00:00.000Z'
    };
    const response=await publicStatus({env:{DB:db({
      result:JSON.stringify(approved),
      created_at:approved.created_at,
      updated_at:approved.created_at
    })}});
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      symbol:'BTCUSDT.P',
      timeframe:'H1/M15/M5',
      signal:'SELL',
      updated_at:approved.created_at
    });
  });

  it('never publishes manual_review or other non-approved outcomes',async()=>{
    const manual={
      id:'MANUAL-1',
      status:'manual_review',
      symbol:'BTCUSDT.P',
      timeframe:'H1/M15/M5',
      majority_signal:'BUY',
      created_at:'2026-10-06T12:05:00.000Z'
    };
    const response=await publicStatus({env:{DB:db({
      result:JSON.stringify(manual),
      created_at:manual.created_at,
      updated_at:manual.created_at
    })}});
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      symbol:'BTCUSDT.P',
      timeframe:'H1/M15/M5',
      signal:null,
      updated_at:null
    });
  });

  it('returns an empty public signal when no approved run exists',async()=>{
    const response=await publicStatus({env:{DB:db(null)}});
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({signal:null,updated_at:null});
  });
});
