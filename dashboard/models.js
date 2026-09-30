(function () {
  if (window.__modelsUi) return;
  window.__modelsUi = true;

  const h = (tag, props, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'value') el.value = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  };

  const style = document.createElement('style');
  style.textContent = `
.mdl-card{max-width:720px;width:calc(100% - 24px)}
.mdl-body{max-height:70vh;overflow:auto;padding-right:4px}
.mdl-hint{margin:0 0 6px;opacity:.65;font-size:13px}
.mdl-row{display:grid;grid-template-columns:1fr auto;gap:6px 12px;align-items:center;padding:12px 0;border-top:1px solid rgba(255,255,255,.08)}
.mdl-toggle{display:flex;align-items:center;gap:10px;cursor:pointer}
.mdl-key{font-size:10px;letter-spacing:.08em;font-family:'DM Mono',monospace}
.mdl-key.ok{color:#3ddc97}.mdl-key.no{color:#ff6b6b}
.mdl-input{grid-column:1/-1;width:100%;box-sizing:border-box;padding:9px 11px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:inherit;font:13px 'DM Mono',monospace}
.mdl-input:focus{outline:none;border-color:#6ea8ff}
.mdl-def{grid-column:1/-1;opacity:.5;font-size:11px;font-family:'DM Mono',monospace}
.mdl-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding-top:14px;border-top:1px solid rgba(255,255,255,.08)}
.mdl-msg{margin-right:auto;font-size:12px;opacity:.8}
.mdl-msg.ok{color:#3ddc97;opacity:1}.mdl-msg.err{color:#ff6b6b;opacity:1}
.mdl-btn{padding:9px 16px;border-radius:8px;border:1px solid rgba(255,255,255,.16);background:transparent;color:inherit;font-weight:600;font-size:13px;font-family:inherit;cursor:pointer}
.mdl-btn.primary{background:#6ea8ff;border-color:#6ea8ff;color:#08101f}
.mdl-btn:disabled{opacity:.5;cursor:default}
.top-actions #models-btn{margin-right:8px}
.mdl-float{position:fixed;right:12px;bottom:12px;z-index:50}
`;
  document.head.append(style);

  function render(body, items) {
    const rows = items.map(it => {
      const cb = h('input', { type: 'checkbox', checked: it.enabled });
      const input = h('input', { class: 'mdl-input', type: 'text', value: it.model, placeholder: it.default_model, spellcheck: 'false', autocomplete: 'off' });
      const row = h('div', { class: 'mdl-row' },
        h('label', { class: 'mdl-toggle' }, cb, h('b', { text: it.label })),
        h('span', { class: 'mdl-key ' + (it.key_configured ? 'ok' : 'no'), text: it.key_configured ? 'API KEY OK' : 'API KEY BELUM ADA' }),
        input,
        h('small', { class: 'mdl-def', text: 'Default: ' + it.default_model }));
      return { it, cb, input, row };
    });
    const msg = h('span', { class: 'mdl-msg' });
    const save = h('button', { class: 'mdl-btn primary', type: 'button', text: 'Simpan' });
    const reset = h('button', { class: 'mdl-btn', type: 'button', text: 'Reset ke default' });

    reset.addEventListener('click', () => {
      rows.forEach(r => { r.input.value = r.it.default_model; r.cb.checked = true; });
      msg.className = 'mdl-msg';
      msg.textContent = 'Belum disimpan.';
    });

    save.addEventListener('click', async () => {
      // Mirrors the server rule in functions/api/models.js: at least one enabled
      // provider must have an API key, otherwise every analysis run would fail.
      // The server still enforces it; this check only gives instant feedback.
      if (!rows.some(r => r.cb.checked && r.it.key_configured)) {
        msg.className = 'mdl-msg err';
        msg.textContent = 'Minimal satu model aktif yang sudah punya API key.';
        return;
      }
      const settings = {};
      for (const r of rows) {
        const model = r.input.value.trim();
        settings[r.it.provider] = { model: model && model !== r.it.default_model ? model : '', enabled: r.cb.checked };
      }
      save.disabled = true;
      msg.className = 'mdl-msg';
      msg.textContent = 'Menyimpan...';
      try {
        const res = await fetch('/api/models', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings }) });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'HTTP ' + res.status);
        msg.className = 'mdl-msg ok';
        msg.textContent = 'Tersimpan. Berlaku di analisis berikutnya.';
      } catch (e) {
        msg.className = 'mdl-msg err';
        msg.textContent = e.message || 'Gagal menyimpan.';
      } finally {
        save.disabled = false;
      }
    });

    body.replaceChildren(
      h('p', { class: 'mdl-hint', text: 'Ganti nama model tiap provider atau nonaktifkan. Perubahan berlaku mulai analisis berikutnya.' }),
      ...rows.map(r => r.row),
      h('div', { class: 'mdl-actions' }, msg, reset, save)
    );
  }

  async function openModal() {
    const body = h('div', { class: 'mdl-body' }, 'Memuat...');
    const closeBtn = h('button', { class: 'detail-close', type: 'button', text: 'Close' });
    const wrap = h('div', { class: 'detail-modal' },
      h('section', { class: 'detail-card mdl-card' },
        h('div', { class: 'detail-head' }, h('h2', { text: 'Model AI' }), closeBtn),
        body));
    closeBtn.addEventListener('click', () => wrap.remove());
    wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });
    document.body.append(wrap);
    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
      render(body, data.items || []);
    } catch (e) {
      body.textContent = 'Gagal memuat: ' + (e.message || e);
    }
  }

  const btn = h('button', { id: 'models-btn', class: 'logout-btn', type: 'button', 'aria-label': 'Model AI', text: 'Models' });
  btn.addEventListener('click', openModal);
  const actions = document.querySelector('.top-actions');
  const logout = document.getElementById('logout-btn');
  if (actions) actions.insertBefore(btn, logout && logout.parentNode === actions ? logout : null);
  else { btn.classList.add('mdl-float'); document.body.append(btn); }
})();
