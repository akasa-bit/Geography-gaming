/* 画面の制御: 地図描画・地形エディタ・気候の観察・クイズ */
(function () {
  'use strict';
  const { W, H, N, latOf, lonOf, idx, clamp } = Core;
  const G = Geo;
  const $ = id => document.getElementById(id);
  const el = (tag, attrs, html) => { const e = document.createElement(tag); if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; };
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できなくても続行 */ } }
  };

  /* ---------- 状態 ---------- */
  const S = {
    world: null, sim: null, mode: 'terrain', layer: 'terrain', month: -1,
    tool: 'land', brush: 3, activePlate: 0, undo: [],
    inspect: -1, quiz: null, stats: store.get('geo-quiz-stats') || { n: 0, sum: 0, by: {} }
  };
  const cv = $('map'), ctx = cv.getContext('2d');
  const SC = 3, BW = W * SC, BH = H * SC; // 下絵は1セル3px、表示はその2倍
  const base = document.createElement('canvas'); base.width = BW; base.height = BH;
  const bctx = base.getContext('2d'), img = bctx.createImageData(BW, BH);
  const PX = cv.width / W;

  /* ---------- 色 ---------- */
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  function ramp(stops) { // [[値, '#色'], ...]
    const s = stops.map(([v, c]) => [v, hex(c)]);
    return v => {
      if (v <= s[0][0]) return s[0][1];
      for (let i = 1; i < s.length; i++) if (v <= s[i][0]) {
        const t = (v - s[i - 1][0]) / (s[i][0] - s[i - 1][0]), a = s[i - 1][1], b = s[i][1];
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      }
      return s[s.length - 1][1];
    };
  }
  const R_LAND = [[0, '#6aa35c'], [200, '#9cc072'], [600, '#d9d28c'], [1200, '#cfa869'], [2200, '#a9764c'], [3500, '#8c7269'], [5000, '#d9d5d2'], [6500, '#ffffff']];
  const R_SEA = [[-7000, '#0b2f5c'], [-4500, '#14508a'], [-2500, '#2f7fb6'], [-800, '#6cb2d8'], [-150, '#a9d5ea'], [0, '#cfe8f3']];
  const R_TEMP = [[-40, '#3a1d6e'], [-25, '#3554a8'], [-10, '#62a6d9'], [0, '#c9e6ef'], [10, '#f5f0b3'], [20, '#f6b860'], [28, '#e0603a'], [36, '#8c1d24']];
  const R_PANN = [[0, '#f3e6c4'], [250, '#e6cf8a'], [500, '#c9d989'], [1000, '#7fc48a'], [2000, '#3d9fb0'], [3000, '#2b62a8'], [4500, '#3a2a7d']];
  const R_PMON = R_PANN.map(([v, c]) => [v / 9, c]);
  const cLand = ramp(R_LAND), cSea = ramp(R_SEA), cTemp = ramp(R_TEMP), cPann = ramp(R_PANN), cPmon = ramp(R_PMON);
  const KCOL = {}, VCOL = {};
  for (const k in G.KOPPEN) KCOL[k] = hex(G.KOPPEN[k].color);
  for (const k in G.VEG) VCOL[k] = hex(G.VEG[k].color);
  const B_COL = { 1: '#e02d2d', 2: '#1d6fe0', 3: '#e0a81d' };
  const R_MANTLE = [[-1, '#1f4fa8'], [-0.35, '#8fb3e0'], [0, '#e9e4dc'], [0.35, '#f0a078'], [1, '#c2281c']];
  const cMantle = ramp(R_MANTLE);
  const LF = { 0: ['安定陸塊', '#e3d6a4'], 1: ['新期造山帯', '#c9503a'], 2: ['古期造山帯', '#6f9a58'] };
  const LFC = [hex(LF[0][1]), hex(LF[1][1]), hex(LF[2][1])];
  const BASIC = ['terrain', 'landform', 'plates', 'mantle'];
  let mantleCache = null;
  const mantleOf = w => w.mantle || (mantleCache = mantleCache || Core.mantleFromPlates(w));

  /* ---------- 地図の描画 ---------- */
  let bounds = null;
  function renderBase() {
    const w = S.world, e = w.elev, sim = S.sim, layer = S.layer, d = img.data, m = S.month;
    const fieldT = sim && (m < 0 ? sim.tAnn : sim.T[m]), fieldP = sim && (m < 0 ? sim.pAnn : sim.P[m]);
    const pc = w.plates.map(p => hex(p.color));
    const landPx = new Uint8Array(BW * BH), phi = layer === 'mantle' ? mantleOf(w) : null;
    for (let Y = 0; Y < BH; Y++) {
      const fy = clamp((Y + 0.5) / SC - 0.5, 0, H - 1), y0 = Math.floor(fy), y1 = Math.min(H - 1, y0 + 1), ty = fy - y0;
      for (let X = 0; X < BW; X++) {
        const fx = (X + 0.5) / SC - 0.5, xf = Math.floor(fx), tx = fx - xf;
        const i00 = idx(xf, y0), i10 = idx(xf + 1, y0), i01 = idx(xf, y1), i11 = idx(xf + 1, y1);
        const bil = f => (f[i00] * (1 - tx) + f[i10] * tx) * (1 - ty) + (f[i01] * (1 - tx) + f[i11] * tx) * ty;
        const ev = bil(e), land = ev > 0;
        const near = (tx < 0.5 ? (ty < 0.5 ? i00 : i01) : (ty < 0.5 ? i10 : i11));
        landPx[Y * BW + X] = land ? 1 : 0;
        // 陰影(北西から光)
        const sh = land ? clamp(1 + ((e[i00] + e[i01]) - (e[i10] + e[i11]) + (e[i00] + e[i10]) - (e[i01] + e[i11])) / 6000, 0.72, 1.22) : 1;
        let c;
        if (layer === 'terrain' || !sim && !BASIC.includes(layer)) {
          c = land ? cLand(ev) : cSea(ev); c = [c[0] * sh, c[1] * sh, c[2] * sh];
        } else if (layer === 'plates') {
          const g = land ? 205 * sh : 150 + clamp(ev / 7000, -1, 0) * 50, p = pc[w.plate[near]] || [128, 128, 128];
          c = [g * 0.45 + p[0] * 0.55, g * 0.45 + p[1] * 0.55, g * 0.45 + p[2] * 0.55];
        } else if (layer === 'mantle') {
          c = cMantle(bil(phi)); const k = land ? 0.82 * sh : 1; c = [c[0] * k, c[1] * k, c[2] * k];
        } else if (layer === 'landform') {
          if (!land) c = cSea(ev); else { c = LFC[w.oro[near] || 0]; const s2 = 0.92 + (sh - 1) * 0.9; c = [c[0] * s2, c[1] * s2, c[2] * s2]; }
        } else if (layer === 'temp') {
          c = cTemp(bil(fieldT)); if (!land) c = [c[0] * 0.8 + 40, c[1] * 0.8 + 44, c[2] * 0.8 + 50];
        } else if (layer === 'precip') {
          c = (m < 0 ? cPann : cPmon)(bil(fieldP)); if (!land) c = [c[0] * 0.55 + 100, c[1] * 0.55 + 108, c[2] * 0.55 + 116];
        } else { // koppen / veg
          if (!land) c = [214, 232, 240];
          else {
            const arr = layer === 'koppen' ? sim.kop : sim.veg, col = layer === 'koppen' ? KCOL : VCOL;
            let k = arr[near]; if (!k) k = arr[i00] || arr[i10] || arr[i01] || arr[i11];
            c = k ? col[k] : [200, 200, 200]; const s2 = 0.9 + (sh - 1) * 0.5; c = [c[0] * s2, c[1] * s2, c[2] * s2];
          }
        }
        const o = (Y * BW + X) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
      }
    }
    for (let Y = 0; Y < BH - 1; Y++) for (let X = 0; X < BW; X++) { // 海岸線
      const p = Y * BW + X, a = landPx[p];
      if (a !== landPx[Y * BW + (X + 1) % BW] || a !== landPx[p + BW]) { const o = p * 4; d[o] *= 0.45; d[o + 1] *= 0.45; d[o + 2] *= 0.5; }
    }
    bctx.putImageData(img, 0, 0);
  }

  function arrow(x, y, dx, dy, color, lw) {
    const len = Math.hypot(dx, dy); if (len < 2) return;
    const ux = dx / len, uy = dy / len, hx = x + dx, hy = y + dy, hs = Math.min(5, len * 0.45);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hx - ux * hs * 0.6, hy - uy * hs * 0.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - ux * hs - uy * hs * 0.6, hy - uy * hs + ux * hs * 0.6); ctx.lineTo(hx - ux * hs + uy * hs * 0.6, hy - uy * hs - ux * hs * 0.6); ctx.closePath(); ctx.fill();
  }
  const cx = x => (x + 0.5) * PX, cy = y => (y + 0.5) * PX, yLat = la => (89 - la) / 2 * PX + PX / 2;

  function draw() {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(base, 0, 0, cv.width, cv.height);
    const w = S.world, sim = S.sim;
    if ($('ovGrid').checked) {
      ctx.font = '11px "DM Mono", monospace'; ctx.textBaseline = 'bottom';
      for (const [la, name, dash] of [[0, '赤道', []], [23.4, '北回帰線', [5, 5]], [-23.4, '南回帰線', [5, 5]], [66.6, '', [2, 6]], [-66.6, '', [2, 6]], [30, '30°', [1, 5]], [-30, '30°', [1, 5]], [60, '60°', [1, 5]], [-60, '60°', [1, 5]]]) {
        ctx.strokeStyle = 'rgba(10,20,30,0.5)'; ctx.lineWidth = la === 0 ? 1.2 : 0.8; ctx.setLineDash(dash);
        ctx.beginPath(); ctx.moveTo(0, yLat(la)); ctx.lineTo(cv.width, yLat(la)); ctx.stroke();
        if (name) { ctx.fillStyle = 'rgba(255,255,255,0.75)'; const tw = ctx.measureText(name).width; ctx.fillRect(3, yLat(la) - 14, tw + 6, 13); ctx.fillStyle = '#15242b'; ctx.fillText(name, 6, yLat(la) - 1); }
      }
      ctx.setLineDash([]);
    }
    if (S.layer === 'mantle') { // マントル表層の流れ(上昇流→下降流)
      const phi = mantleOf(w);
      for (let y = 2; y < H - 1; y += 4) for (let x = 1 + (y % 8 ? 2 : 0); x < W; x += 5) {
        const f = Core.mantleFlow(phi, y * W + x), mg = Math.hypot(f[0], f[1]); if (mg < 0.004) continue;
        const s = Math.min(17, 6 + mg * 420) / mg;
        arrow(cx(x) - f[0] * s / 2, cy(y) + f[1] * s / 2, f[0] * s, -f[1] * s, 'rgba(20,20,30,0.85)', 1.5);
      }
    }
    if (S.layer === 'plates' || S.layer === 'mantle' || S.layer === 'landform') {
      const thin = S.layer !== 'plates';
      bounds = bounds || Core.boundaries(w); ctx.lineWidth = thin ? 1.6 : 2.5;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, t = bounds.type[i]; if (!t) continue;
        ctx.strokeStyle = B_COL[t]; ctx.beginPath();
        if (w.plate[idx(x + 1, y)] !== w.plate[i]) { ctx.moveTo((x + 1) * PX, y * PX); ctx.lineTo((x + 1) * PX, (y + 1) * PX); }
        if (y < H - 1 && w.plate[i + W] !== w.plate[i]) { ctx.moveTo(x * PX, (y + 1) * PX); ctx.lineTo((x + 1) * PX, (y + 1) * PX); }
        ctx.stroke();
      }
      // プレートの移動方向
      if (!thin) w.plates.forEach((p, pi) => {
        let sx = 0, cxs = 0, sy = 0, n = 0;
        for (let i = 0; i < N; i++) if (w.plate[i] === pi) { const a = (i % W) / W * 2 * Math.PI; sx += Math.sin(a); cxs += Math.cos(a); sy += (i / W) | 0; n++; }
        if (!n) return;
        const mx = ((Math.atan2(sx, cxs) / (2 * Math.PI) * W) + W) % W, my = sy / n;
        let bi = -1, bd = 1e9;
        for (let i = 0; i < N; i++) if (w.plate[i] === pi) { let dx = Math.abs(i % W - mx); dx = Math.min(dx, W - dx); const dd = dx * dx + Math.pow(((i / W) | 0) - my, 2); if (dd < bd) { bd = dd; bi = i; } }
        const px = cx(bi % W), py = cy((bi / W) | 0), a = p.dir * Math.PI / 180, L = 10 + p.speed * 4;
        if (p.speed > 0) { arrow(px, py, Math.sin(a) * L, -Math.cos(a) * L, '#ffffff', 5); arrow(px, py, Math.sin(a) * L, -Math.cos(a) * L, '#15242b', 2.2); }
        ctx.font = '700 12px "Zen Kaku Gothic New", sans-serif'; ctx.textBaseline = 'top'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.fillStyle = '#15242b';
        const tx = clamp(px - ctx.measureText(p.name).width / 2, 4, cv.width - ctx.measureText(p.name).width - 4);
        ctx.strokeText(p.name, tx, py + 8); ctx.fillText(p.name, tx, py + 8);
      });
    }
    if (sim && $('ovCurrent').checked) {
      for (let y = 2; y < H - 2; y += 3) for (let x = (y % 2) * 2; x < W; x += 4) {
        const i = y * W + x; if (sim.land[i]) continue;
        const u = sim.cu[i], v = sim.cv[i], mg = Math.hypot(u, v); if (mg < 0.3) continue;
        const k = sim.ckind[i], col = k > 0 ? '#d9281e' : k < 0 ? '#1846c9' : 'rgba(255,255,255,0.75)';
        const s = 13 / Math.max(mg, 0.7);
        arrow(cx(x) - u * s / 2, cy(y) + v * s / 2, u * s, -v * s, col, k ? 2.2 : 1.3);
      }
    }
    if (sim && $('ovWind').checked) {
      const m = S.month < 0 ? 6 : S.month;
      for (let y = 2; y < H - 1; y += 4) for (let x = 1 + (y % 8 ? 2 : 0); x < W; x += 5) {
        const i = y * W + x, u = sim.wu[m][i], v = sim.wv[m][i], mg = Math.hypot(u, v); if (mg < 0.12) continue;
        const s = 15 * Math.min(1.3, mg) / mg;
        arrow(cx(x) - u * s / 2, cy(y) + v * s / 2, u * s, -v * s, 'rgba(20,20,30,0.82)', 1.4);
      }
    }
    const mark = S.mode === 'quiz' ? (S.quiz && (S.quiz.done || $('showLoc').checked) ? S.quiz.i : -1) : S.mode === 'climate' ? S.inspect : -1;
    if (mark >= 0) {
      const px = cx(mark % W), py = cy((mark / W) | 0);
      ctx.lineWidth = 5; ctx.strokeStyle = '#ffffff'; ctx.beginPath(); ctx.arc(px, py, 9, 0, 7); ctx.stroke();
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#d2122e'; ctx.beginPath(); ctx.arc(px, py, 9, 0, 7); ctx.stroke();
      ctx.fillStyle = '#d2122e'; ctx.beginPath(); ctx.arc(px, py, 2.5, 0, 7); ctx.fill();
    }
  }
  function refresh() { renderBase(); draw(); legend(); }

  /* ---------- 凡例 ---------- */
  function legend() {
    const L = $('legend'); L.innerHTML = '';
    const sw = (c, t) => `<span class="item"><span class="sw" style="background:${c}"></span>${t}</span>`;
    const rampH = (st, unit, fmt) => `<span class="ramp">${fmt(st[0][0])}<i style="background:linear-gradient(90deg,${st.map(s => s[1]).join(',')})"></i>${fmt(st[st.length - 1][0])} ${unit}</span>`;
    let h = '';
    const lay = S.sim || BASIC.includes(S.layer) ? S.layer : 'terrain';
    const bl = `<span class="item"><span class="ln" style="border-color:${B_COL[1]}"></span>狭まる境界</span><span class="item"><span class="ln" style="border-color:${B_COL[2]}"></span>広がる境界</span><span class="item"><span class="ln" style="border-color:${B_COL[3]}"></span>ずれる境界</span>`;
    if (lay === 'terrain') h = `<span class="ramp">深海<i style="background:linear-gradient(90deg,${R_SEA.map(s => s[1]).join(',')},${R_LAND.map(s => s[1]).join(',')})"></i>高山(標高)</span>`;
    else if (lay === 'plates') h = `<span class="item"><span class="ln" style="border-color:${B_COL[1]}"></span>狭まる境界(山脈・海溝)</span><span class="item"><span class="ln" style="border-color:${B_COL[2]}"></span>広がる境界(海嶺・地溝)</span><span class="item"><span class="ln" style="border-color:${B_COL[3]}"></span>ずれる境界</span>`;
    else if (lay === 'mantle') h = `<span class="ramp">下降流<i style="background:linear-gradient(90deg,${R_MANTLE.map(s => s[1]).join(',')})"></i>上昇流</span><span class="item">矢印: マントル表層の流れ</span>` + bl;
    else if (lay === 'landform') h = [0, 1, 2].map(k => sw(LF[k][1], LF[k][0])).join('') + bl;
    else if (lay === 'temp') h = rampH(R_TEMP, '℃', v => v);
    else if (lay === 'precip') h = rampH(S.month < 0 ? R_PANN : R_PMON, S.month < 0 ? 'mm/年' : 'mm/月', v => Math.round(v));
    else if (lay === 'koppen') h = G.KOPPEN_ORDER.map(k => sw(G.KOPPEN[k].color, k)).join('');
    else if (lay === 'veg') h = G.VEG_ORDER.map(k => sw(G.VEG[k].color, G.VEG[k].name)).join('');
    if (S.sim && $('ovCurrent').checked) h += `<span class="item"><span class="ln" style="border-color:#d9281e"></span>暖流</span><span class="item"><span class="ln" style="border-color:#1846c9"></span>寒流</span>`;
    if (S.sim && $('ovWind').checked) h += `<span class="item">風: ${(S.month < 0 ? 7 : S.month + 1)}月の卓越風</span>`;
    L.innerHTML = h;
  }

  /* ---------- 地図の種類 ---------- */
  const LAYERS = [['terrain', '地形'], ['landform', '大地形'], ['plates', 'プレート'], ['mantle', 'マントル'], ['temp', '気温'], ['precip', '降水量'], ['koppen', 'ケッペン'], ['veg', '植生']];
  function layerAllowed(k) {
    if (BASIC.includes(k)) return true;
    if (!S.sim) return false;
    return !(S.mode === 'quiz' && S.quiz && !S.quiz.done); // 出題中は答えが見える地図を隠す
  }
  function buildLayerChips() {
    const box = $('layerChips'); box.innerHTML = '';
    for (const [k, name] of LAYERS) {
      const b = el('button', { type: 'button', class: 'chip', 'aria-pressed': S.layer === k }, name);
      b.disabled = !layerAllowed(k);
      b.onclick = () => { S.layer = k; buildLayerChips(); refresh(); };
      box.appendChild(b);
    }
    $('ovCurrent').disabled = $('ovWind').disabled = !S.sim;
  }

  /* ---------- モード切り替え ---------- */
  function setMode(mode) {
    if (mode !== 'terrain' && !S.sim) runSim();
    S.mode = mode;
    for (const b of document.querySelectorAll('.step')) b.setAttribute('aria-current', b.dataset.mode === mode ? 'step' : 'false');
    $('panelTerrain').hidden = mode !== 'terrain'; $('panelClimate').hidden = mode !== 'climate'; $('panelQuiz').hidden = mode !== 'quiz';
    cv.classList.toggle('paint', mode === 'terrain');
    if (mode === 'terrain' && !layerAllowed(S.layer)) S.layer = 'terrain';
    if (mode === 'climate') { if (BASIC.includes(S.layer)) S.layer = 'koppen'; if (S.inspect < 0) S.inspect = pickDefaultPoint(); renderInspect(); }
    if (mode === 'quiz') { if (!S.quiz) newQuestion(); else renderQuiz(); if (!layerAllowed(S.layer)) S.layer = 'terrain'; }
    buildLayerChips(); refresh();
  }
  function runSim() { S.sim = Climate.simulate(S.world); S.quiz = null; S.inspect = -1; }
  function worldChanged(keepSim) {
    bounds = null; mantleCache = null; if (!keepSim) { S.sim = null; S.quiz = null; S.inspect = -1; }
    $('worldName').textContent = S.world.name || '自作の惑星';
    saveWorld();
  }
  function pickDefaultPoint() {
    let best = -1, bd = 1e9; // 北緯36°付近の大陸東岸っぽい陸地
    for (let i = 0; i < N; i++) if (S.sim.land[i]) { const d = Math.abs(latOf((i / W) | 0) - 36) * 3 + Math.abs(lonOf(i % W) - 139); if (d < bd) { bd = d; best = i; } }
    return best;
  }

  /* ---------- 保存 ---------- */
  let saveTimer = 0;
  function saveWorld() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const w = S.world, e = new Int16Array(N); for (let i = 0; i < N; i++) e[i] = Math.round(w.elev[i]);
      const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); };
      store.set('geo-world', { name: w.name, plates: w.plates, e: b64(new Uint8Array(e.buffer)), p: b64(w.plate), o: b64(w.oro) });
    }, 600);
  }
  function loadWorld() {
    const d = store.get('geo-world'); if (!d || !d.e) return null;
    try {
      const u8 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0)), w = Core.newWorld();
      const e = new Int16Array(u8(d.e).buffer), p = u8(d.p); if (e.length !== N || p.length !== N) return null;
      for (let i = 0; i < N; i++) { w.elev[i] = e[i]; w.plate[i] = p[i]; }
      if (d.o) { const o = u8(d.o); if (o.length === N) w.oro.set(o); }
      w.plates = d.plates; w.name = d.name; return w;
    } catch (e) { return null; }
  }

  /* ---------- 地形エディタ ---------- */
  const TOOLS = [['land', '陸地を描く'], ['mountain', '山を盛る'], ['sea', '海にする'], ['smooth', 'ならす'], ['plate', 'プレートを塗る']];
  function buildToolChips() {
    const box = $('toolChips'); box.innerHTML = '';
    for (const [k, name] of TOOLS) {
      const b = el('button', { type: 'button', class: 'chip', 'aria-pressed': S.tool === k }, name);
      b.onclick = () => { S.tool = k; if (k === 'plate') S.layer = 'plates'; else if (S.layer !== 'terrain') S.layer = 'terrain'; buildToolChips(); buildLayerChips(); refresh(); };
      box.appendChild(b);
    }
  }
  const DIRS = [[0, '↑ 北'], [45, '↗ 北東'], [90, '→ 東'], [135, '↘ 南東'], [180, '↓ 南'], [225, '↙ 南西'], [270, '← 西'], [315, '↖ 北西']];
  function buildPlates() {
    const box = $('plateList'); box.innerHTML = '';
    S.world.plates.forEach((p, i) => {
      const row = el('div', { class: 'plate', 'aria-selected': S.activePlate === i });
      const pick = el('button', { type: 'button', class: 'pick', style: `background:${p.color}`, 'aria-label': p.name + 'を塗る', title: 'このプレートを塗る' });
      pick.onclick = () => { S.activePlate = i; S.tool = 'plate'; S.layer = 'plates'; buildPlates(); buildToolChips(); buildLayerChips(); refresh(); };
      const name = el('span', { class: 'pname' }, p.name);
      const dir = el('select', { id: 'pdir' + i, 'aria-label': p.name + 'の向き' });
      for (const [d, t] of DIRS) { const o = el('option', { value: d }, t); if (d === p.dir) o.selected = true; dir.appendChild(o); }
      dir.onchange = () => { p.dir = +dir.value; S.world.mantle = null; worldChanged(true); S.layer = 'plates'; buildLayerChips(); refresh(); };
      const sp = el('select', { id: 'pspd' + i, 'aria-label': p.name + 'の速さ' });
      for (const v of [0, 1, 2, 3, 5, 7, 9]) { const o = el('option', { value: v }, v ? v + ' cm/年' : '動かない'); if (v === p.speed) o.selected = true; sp.appendChild(o); }
      if (![0, 1, 2, 3, 5, 7, 9].includes(p.speed)) { const o = el('option', { value: p.speed }, p.speed + ' cm/年'); o.selected = true; sp.appendChild(o); }
      sp.onchange = () => { p.speed = +sp.value; S.world.mantle = null; worldChanged(true); S.layer = 'plates'; buildLayerChips(); refresh(); };
      row.append(pick, name, dir, sp); box.appendChild(row);
    });
    $('addPlate').disabled = S.world.plates.length >= 10;
  }
  function pushUndo() {
    S.undo.push({ e: Float32Array.from(S.world.elev), p: Uint8Array.from(S.world.plate), o: Uint8Array.from(S.world.oro), ps: JSON.stringify(S.world.plates), m: S.world.mantle });
    if (S.undo.length > 12) S.undo.shift();
  }
  function paint(gx, gy) {
    const w = S.world, r = S.brush, e = w.elev;
    for (let dy = -r; dy <= r; dy++) {
      const y = gy + dy; if (y < 0 || y >= H) continue;
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dy); if (d > r + 0.3) continue;
        const i = idx(gx + dx, y), f = Math.cos(Math.min(1, d / (r + 0.5)) * Math.PI / 2);
        const n = Core.fbm(i % W, y, 0.3, 2, 7);
        if (S.tool === 'land') { const t = 60 + 380 * f * (0.5 + n); if (e[i] < t) e[i] += (t - e[i]) * 0.6; }
        else if (S.tool === 'mountain') { if (e[i] > 0) e[i] = Math.min(8000, e[i] + 260 * f * (0.5 + n)); else e[i] += 900 * f; }
        else if (S.tool === 'sea') { const t = -200 - 3600 * f; if (e[i] > t) e[i] += (t - e[i]) * 0.5; if (e[i] <= 0) w.oro[i] = 0; }
        else if (S.tool === 'plate') { w.plate[i] = S.activePlate; w.mantle = null; }
      }
    }
    if (S.tool === 'smooth') {
      const o = Float32Array.from(e);
      for (let dy = -r; dy <= r; dy++) { const y = gy + dy; if (y < 1 || y >= H - 1) continue; for (let dx = -r; dx <= r; dx++) { if (Math.hypot(dx, dy) > r) continue; const i = idx(gx + dx, y); e[i] = o[i] * 0.5 + (o[idx(gx + dx + 1, y)] + o[idx(gx + dx - 1, y)] + o[i - W] + o[i + W]) / 8; } }
    }
  }
  function cellAt(ev) {
    const r = cv.getBoundingClientRect();
    return [clamp(Math.floor((ev.clientX - r.left) / r.width * W), 0, W - 1), clamp(Math.floor((ev.clientY - r.top) / r.height * H), 0, H - 1)];
  }
  let painting = false, lastCell = null, raf = 0;
  cv.addEventListener('pointerdown', ev => {
    const [gx, gy] = cellAt(ev);
    if (S.mode === 'terrain') {
      painting = true; cv.setPointerCapture(ev.pointerId); pushUndo(); S.world.name = '自作の惑星'; lastCell = [gx, gy]; paint(gx, gy); schedule(); ev.preventDefault();
    } else if (S.mode === 'climate') {
      let i = gy * W + gx;
      if (!S.sim.land[i]) { let bd = 9, b = -1; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = gy + dy; if (yy < 0 || yy >= H) continue; const j = idx(gx + dx, yy), d = Math.hypot(dx, dy); if (S.sim.land[j] && d < bd) { bd = d; b = j; } } if (b >= 0) i = b; }
      S.inspect = i; renderInspect(); draw();
    }
  });
  cv.addEventListener('pointermove', ev => {
    const [gx, gy] = cellAt(ev);
    if (painting) {
      const [lx, ly] = lastCell, steps = Math.max(Math.abs(gx - lx), Math.abs(gy - ly), 1);
      if (Math.abs(gx - lx) < W / 2) for (let s = 1; s <= steps; s++) paint(Math.round(lx + (gx - lx) * s / steps), Math.round(ly + (gy - ly) * s / steps));
      lastCell = [gx, gy]; schedule();
    }
    readout(gx, gy);
  });
  const endPaint = () => { if (!painting) return; painting = false; worldChanged(false); buildLayerChips(); refresh(); };
  cv.addEventListener('pointerup', endPaint); cv.addEventListener('pointercancel', endPaint);
  function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; bounds = null; renderBase(); draw(); }); }

  function readout(gx, gy) {
    const i = gy * W + gx, w = S.world, la = latOf(gy), lo = lonOf(gx);
    let t = `${Math.abs(la)}°${la >= 0 ? 'N' : 'S'} ${Math.abs(lo)}°${lo >= 0 ? 'E' : 'W'} ・ ${w.elev[i] > 0 ? '標高' : '水深'} ${Math.abs(Math.round(w.elev[i] / 10) * 10)} m ・ ${w.plates[w.plate[i]] ? w.plates[w.plate[i]].name : ''}${w.elev[i] > 0 ? ' ・ ' + LF[w.oro[i] || 0][0] : ''}`;
    const sim = S.sim;
    if (sim && layerAllowed('koppen')) {
      const m = S.month;
      t += ` ・ ${m < 0 ? '年平均' : (m + 1) + '月'} ${(m < 0 ? sim.tAnn[i] : sim.T[m][i]).toFixed(1)}℃ / ${Math.round(m < 0 ? sim.pAnn[i] : sim.P[m][i])} mm`;
      if (sim.kop[i]) t += ` ・ ${sim.kop[i]} ${G.KOPPEN[sim.kop[i]].name} ・ ${G.VEG[sim.veg[i]].name}`;
      else if (sim.ckind[i]) t += sim.ckind[i] > 0 ? ' ・ 暖流' : ' ・ 寒流';
    }
    $('readout').textContent = t;
  }

  /* ---------- 地点データ ---------- */
  function pointData(i) {
    const sim = S.sim, t = [], p = [];
    for (let m = 0; m < 12; m++) { t.push(sim.T[m][i]); p.push(sim.P[m][i]); }
    const y = (i / W) | 0, lat = latOf(y), k = Climate.koppen(t, p, lat, S.world.elev[i]);
    return { i, t, p, lat, lon: lonOf(i % W), elev: S.world.elev[i], k, veg: sim.veg[i] };
  }
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
  function chartsHTML(showTable, pd) {
    let h = `<div class="charts"><div class="chart"><h4>雨温図</h4><canvas id="cvClimo" width="300" height="250" aria-label="雨温図"></canvas></div><div class="chart"><h4>ハイサーグラフ</h4><canvas id="cvHyther" width="300" height="250" aria-label="ハイサーグラフ"></canvas></div></div>`;
    if (showTable) h += `<div class="tablewrap"><table class="months"><tr><th>月</th>${pd.t.map((_, m) => `<th>${m + 1}</th>`).join('')}</tr><tr><td>気温 ℃</td>${pd.t.map(v => `<td>${f1(v)}</td>`).join('')}</tr><tr><td>降水 mm</td>${pd.p.map(v => `<td>${Math.round(v)}</td>`).join('')}</tr></table></div>`;
    return h;
  }
  let lastCharts = null;
  function drawCharts(pd) { lastCharts = pd; if ($('cvClimo')) { Charts.climograph($('cvClimo'), pd.t, pd.p); Charts.hythergraph($('cvHyther'), pd.t, pd.p); } }
  function factsHTML(pd, withLoc) {
    const k = pd.k, items = [];
    if (withLoc) items.push(['位置', `${Math.abs(pd.lat)}°${pd.lat >= 0 ? 'N' : 'S'} ${Math.abs(pd.lon)}°${pd.lon >= 0 ? 'E' : 'W'}`]);
    items.push(['標高', Math.round(pd.elev / 10) * 10 + ' m'], ['年平均気温', f1(k.tAvg) + ' ℃'], ['年降水量', Math.round(k.R) + ' mm'], ['最暖月 / 最寒月', `${f1(k.tMax)} / ${f1(k.tMin)} ℃`], ['年較差', f1(k.range) + ' ℃']);
    return `<dl class="facts">${items.map(([a, b]) => `<div class="fact"><dt>${a}</dt><dd>${b}</dd></div>`).join('')}</dl>`;
  }
  // ケッペンの判定手順を文章にする
  function koppenSteps(pd) {
    const k = pd.k, s = [], r0 = Math.round(k.r), R = Math.round(k.R);
    const rt = { w: '夏に雨が集中(冬乾燥型) → x=14', s: '冬に雨が集中(夏乾燥型) → x=0', f: '年中平均して降る → x=7' }[k.rainType];
    s.push(`最暖月は <b>${f1(k.tMax)}℃</b>。${k.tMax < 10 ? '10℃未満なので樹木が育たない<b>寒帯(E)</b>。' + (k.tMax < 0 ? '0℃未満なので <b>EF</b>。' : '0℃以上なので <b>ET</b>。') : '10℃以上なので寒帯(E)ではない。'}`);
    if (k.tMax >= 10) {
      s.push(`乾燥限界 r=20(t+x)。降水は${rt}。r = 20×(${f1(k.tAvg)}+${k.x}) = <b>${r0}mm</b>。年降水量 <b>${R}mm</b> は ${R < r0 ? (R < r0 / 2 ? `r の1/2(${Math.round(r0 / 2)}mm)未満なので <b>砂漠 BW</b>。` : `r 未満・r/2(${Math.round(r0 / 2)}mm)以上なので <b>ステップ BS</b>。`) : 'r 以上なので乾燥帯(B)ではない。'}`);
      if (R >= r0) {
        if (k.tMin >= 18) s.push(`最寒月 <b>${f1(k.tMin)}℃</b> は18℃以上 → <b>熱帯(A)</b>。最少雨月は <b>${Math.round(k.pMin)}mm</b>。${k.pMin >= 60 ? '60mm以上なので <b>Af</b>。' : (k.base === 'Am' ? `60mm未満だが年降水量が多く(100−R/25=${Math.round(100 - k.R / 25)}mm 以上)、<b>Am</b>。` : '60mm未満で乾季が明瞭 → <b>Aw</b>。')}`);
        else {
          s.push(`最寒月 <b>${f1(k.tMin)}℃</b> は ${k.tMin >= -3 ? '-3℃以上18℃未満 → <b>温帯(C)</b>。' : '-3℃未満 → <b>亜寒帯(D)</b>。'}`);
          const b = k.base;
          if (b === 'Cs') s.push(`夏の最少雨月(${Math.round(k.sDry)}mm)が30mm未満で、冬の最多雨月(${Math.round(k.wWet)}mm)の1/3以下 → 夏に乾燥する <b>Cs</b>。`);
          else if (b === 'Cw' || b === 'Dw') s.push(`夏の最多雨月(${Math.round(k.sWet)}mm)が冬の最少雨月(${Math.round(k.wDry)}mm)の10倍以上 → 冬に乾燥する <b>${b}</b>。`);
          else if (b === 'Df') s.push(`明瞭な乾季がない → <b>Df</b>。`);
          else s.push(`明瞭な乾季がない(f)。最暖月が ${k.tMax >= 22 ? '22℃以上 → <b>Cfa</b>。' : '22℃未満 → <b>Cfb</b>。'}`);
        }
      }
    }
    if (k.code === 'H') s.push(`ただし標高が <b>${Math.round(pd.elev)}m</b> と高いので、ここでは<b>高山気候(H)</b>として扱う(ケッペン本来の区分では ${k.base})。`);
    return `<ol class="steps-list">${s.map(x => `<li>${x}</li>`).join('')}</ol>`;
  }
  // その地点の気候因子を文章にする
  function factorNotes(pd) {
    const sim = S.sim, i = pd.i, a = Math.abs(pd.lat), n = [], sgn = pd.lat >= 0 ? 1 : -1;
    const sumM = sgn > 0 ? 6 : 0, winM = sgn > 0 ? 0 : 6;
    let itcz = 0, sub = 0, west = 0;
    for (let m = 0; m < 12; m++) { const p = Math.abs(sim.phiS[m][i]); if (p < 11) itcz++; else if (p >= 18 && p < 35) sub++; else if (p >= 38 && p < 68) west++; }
    if (itcz >= 10) n.push('<b>緯度</b>: 一年中、熱帯収束帯(赤道低圧帯)の下にあり、上昇気流で雨が多い。');
    else if (itcz >= 3 && sub >= 2) n.push(`<b>緯度</b>: 夏は熱帯収束帯が近づいて雨季、冬は亜熱帯高圧帯に入って乾季になる(気圧帯の季節移動)。`);
    else if (sub >= 9) n.push('<b>緯度</b>: ほぼ一年中、亜熱帯高圧帯(下降気流)の下にあり、雨が降りにくい。');
    else if (sub >= 3 && west >= 3) n.push('<b>緯度</b>: 夏は亜熱帯高圧帯に覆われ、冬は偏西風帯(前線・温帯低気圧)に入る。');
    else if (west >= 9) n.push('<b>緯度</b>: 一年中、偏西風帯にあり、前線や温帯低気圧が雨をもたらす。');
    else if (a >= 62) n.push('<b>緯度</b>: 高緯度で太陽高度が低く、受け取る熱が少ない。');
    else n.push(`<b>緯度</b>: 緯度${Math.round(a)}°。季節により気圧帯の影響が入れ替わる。`);
    const c = sim.cont[i];
    if (c > 0.7) n.push('<b>隔海度</b>: 風上の海から遠い内陸で、気温の年較差が大きく(大陸性気候)、水蒸気が届きにくい。');
    else if (c < 0.25) n.push('<b>隔海度</b>: 海の影響を強く受け、気温の年較差が小さい(海洋性気候)。');
    let sa = 0; for (let m = 0; m < 12; m++) sa += sim.srcA[m][i] * Math.exp(-sim.landSteps[m][i] / 8) / 12;
    if (sa > 1) n.push('<b>海流</b>: 風上の海を暖流が流れ、暖かく湿った空気が運ばれる。');
    else if (sa < -1) n.push('<b>海流</b>: 沖合を寒流が流れ、大気が安定して(下層が冷やされ上昇気流が起きにくい)雨が降りにくい。');
    const mo = sim.mons[sumM][i], mw = sim.mons[winM][i];
    if (mo > 0.55 && sim.landXL[i] > 0.3) n.push(`<b>季節風</b>: 夏は海から大陸へ湿った季節風が吹いて雨が多く${mw < -0.55 ? '、冬は大陸から乾いた寒い季節風が吹く' : ''}。`);
    if (pd.elev >= 1000) n.push(`<b>標高</b>: ${Math.round(pd.elev / 100) * 100}m。気温の逓減(100mで約0.65℃)により、同緯度の低地より約${Math.round(pd.elev * 0.0065)}℃低い。`);
    let dryShadow = 0, oro = 0; for (let m = 0; m < 12; m++) { if (sim.landSteps[m][i] < 12 && sim.Msrc[m][i] < 0.25 && sim.landSteps[m][i] < 40) dryShadow++; if (sim.oro[m][i] > 0.15) oro++; }
    if (oro >= 4) n.push('<b>地形</b>: 湿った風が山地にぶつかる風上側で、地形性降雨が多い。');
    else if (dryShadow >= 6 && pd.k.R < 800 && pd.elev < 2500) n.push('<b>地形</b>: 風上側に山地があり、その風下(雨陰)にあたるため乾燥しやすい。');
    return n.map(x => `<p class="note">${x}</p>`).join('');
  }
  function answerNotes(code) {
    return `<p class="note"><b>農業</b>: ${G.AGRI_NOTE[code]}</p><p class="note"><b>土壌</b>: ${G.SOIL_NOTE[code]}</p>`;
  }

  /* ---------- 2. 気候を読む ---------- */
  function renderInspect() {
    const box = $('inspect'); if (S.inspect < 0 || !S.sim.land[S.inspect]) { box.innerHTML = '<p class="hint">地図の陸地をタップしてください。</p>'; return; }
    const pd = pointData(S.inspect), k = pd.k, K = G.KOPPEN[k.code];
    box.innerHTML = `<div class="block">
      <div class="verdict"><span class="code">${k.code}</span><span class="kname">${K.name}</span><span class="hint">植生: ${G.VEG[pd.veg].name}(${G.VEG[pd.veg].sub})</span></div>
      ${chartsHTML(true, pd)}${factsHTML(pd, true)}
      <h3>判定の手順</h3>${koppenSteps(pd)}
      <h3>なぜこの気候になるか</h3>${factorNotes(pd)}<p class="note">${K.note}</p>
      <h3>くらしと産業</h3>${answerNotes(k.code)}</div>`;
    drawCharts(pd);
  }

  /* ---------- 3. クイズ ---------- */
  const PTS = { kop: 40, veg: 20, soil: 10, agri: 15, crops: 15 };
  function newQuestion() {
    const sim = S.sim, by = {};
    for (let i = 0; i < N; i++) if (sim.kop[i] && Math.abs(latOf((i / W) | 0)) <= 82) (by[sim.kop[i]] = by[sim.kop[i]] || []).push(i);
    const types = Object.keys(by).filter(k => by[k].length >= 3);
    if (!types.length) { S.quiz = null; $('quizBody').innerHTML = '<p class="note">陸地がありません。「地形・プレート」に戻って大陸を描いてください。</p>'; return; }
    // 苦手な区分を少し出やすくする
    const wts = types.map(k => { const st = S.stats.by[k]; return st && st.n ? 1.6 - st.ok / st.n : 1.2; });
    let r = Math.random() * wts.reduce((a, b) => a + b, 0), t = types[0];
    for (let j = 0; j < types.length; j++) { r -= wts[j]; if (r <= 0) { t = types[j]; break; } }
    const cells = by[t], i = cells[Math.floor(Math.random() * cells.length)];
    S.quiz = { i, pd: pointData(i), ans: { kop: null, veg: null, soil: null, agri: null, crops: [] }, done: false };
    if (!layerAllowed(S.layer)) S.layer = 'terrain';
    renderQuiz(); buildLayerChips(); refresh();
  }
  function chipGroup(id, items, sel, multi, onPick) {
    const box = el('div', { class: 'chips', id, role: 'group' });
    for (const [k, html] of items) {
      const on = multi ? sel.includes(k) : sel === k;
      const b = el('button', { type: 'button', class: 'chip', 'aria-pressed': on, 'data-k': k }, html);
      b.onclick = () => onPick(k); box.appendChild(b);
    }
    return box;
  }
  function renderScore() {
    const st = S.stats;
    $('scoreLine').textContent = st.n ? `${st.n}問 ・ 平均 ${Math.round(st.sum / st.n)}点` : 'まだ解いていません';
  }
  function renderQuiz() {
    renderScore();
    const q = S.quiz, body = $('quizBody'); if (!q) return;
    if (q.done) return renderResult();
    const pd = q.pd, showLoc = $('showLoc').checked;
    body.innerHTML = '';
    const head = el('div', { class: 'block' }, `<p class="lead">赤い印の地点${showLoc ? '' : '(地図には非表示)'}の気候です。グラフを読み取り、気候区分・植生・土壌・農業を答えましょう。</p>${chartsHTML(true, pd)}${factsHTML(pd, showLoc)}`);
    body.appendChild(head);
    const mk = (title, pts, node, hint) => { const d = el('div', { class: 'q' }, `<h3>${title}<span>${pts}点</span></h3>${hint ? `<p class="hint">${hint}</p>` : ''}`); d.appendChild(node); body.appendChild(d); };
    const rerender = () => { const y = window.scrollY; renderQuiz(); window.scrollTo(0, y); };
    mk('気候区分', PTS.kop, chipGroup('qKop', G.KOPPEN_ORDER.map(k => [k, `<span class="code">${k}</span>${G.KOPPEN[k].name.replace(/\(.*\)/, '')}`]), q.ans.kop, false, k => { q.ans.kop = k; rerender(); }));
    mk('植生', PTS.veg, chipGroup('qVeg', G.VEG_ORDER.map(k => [k, G.VEG[k].name]), q.ans.veg, false, k => { q.ans.veg = k; rerender(); }));
    mk('土壌', PTS.soil, chipGroup('qSoil', G.SOIL_ORDER.map(k => [k, G.SOIL[k]]), q.ans.soil, false, k => { q.ans.soil = k; rerender(); }));
    mk('農業形態', PTS.agri, chipGroup('qAgri', G.AGRI_ORDER.map(k => [k, G.AGRI[k]]), q.ans.agri, false, k => { q.ans.agri = k; rerender(); }), 'この気候で代表的なものを1つ。');
    mk('作物・家畜', PTS.crops, chipGroup('qCrops', G.CROP_ORDER.map(k => [k, G.CROPS[k]]), q.ans.crops, true, k => {
      const c = q.ans.crops, j = c.indexOf(k); if (j >= 0) c.splice(j, 1); else { if (c.length >= 3) c.shift(); c.push(k); } rerender();
    }), 'この気候で代表的なものを1〜3つ。');
    const row = el('div', { class: 'row' });
    const sub = el('button', { type: 'button', class: 'btn primary', id: 'submitQuiz' }, '採点する'); sub.disabled = !q.ans.kop;
    sub.onclick = grade;
    const skip = el('button', { type: 'button', class: 'btn ghost', id: 'skipQuiz' }, '別の地点にする'); skip.onclick = newQuestion;
    row.append(sub, skip); body.appendChild(row);
    if (!q.ans.kop) body.appendChild(el('p', { class: 'hint' }, '気候区分を選ぶと採点できます。ほかは未回答でも採点できます(0点)。'));
    drawCharts(pd);
  }
  function judge(sel, full, part) { return sel == null ? 0 : full.includes(sel) ? 1 : part.includes(sel) ? 0.5 : 0; }
  function grade() {
    const q = S.quiz, pd = q.pd, code = pd.k.code, M = G.MATCH[code], a = q.ans, res = {};
    res.kop = a.kop === code ? 1 : (code === 'H' && a.kop === pd.k.base) ? 0.5 : (a.kop && a.kop[0] === code[0] && code !== 'H') ? 0.4 : 0;
    const vegFull = [pd.veg], vegPart = M.veg[0].concat(M.veg[1]).filter(v => v !== pd.veg);
    res.veg = judge(a.veg, vegFull, vegPart);
    res.soil = judge(a.soil, M.soil[0], M.soil[1]);
    res.agri = judge(a.agri, M.agri[0], M.agri[1]);
    res.crops = a.crops.length ? a.crops.reduce((s, c) => s + judge(c, M.crops[0], M.crops[1]), 0) / a.crops.length : 0;
    let total = 0; for (const k in PTS) total += PTS[k] * res[k];
    q.res = res; q.total = Math.round(total); q.vegFull = vegFull; q.vegPart = vegPart; q.done = true;
    const st = S.stats; st.n++; st.sum += q.total; const b = st.by[code] = st.by[code] || { n: 0, ok: 0 }; b.n++; b.ok += res.kop === 1 ? 1 : 0;
    store.set('geo-quiz-stats', st);
    S.layer = 'koppen'; buildLayerChips(); refresh(); renderQuiz();
    $('panelQuiz').scrollIntoView({ block: 'start', behavior: 'auto' });
  }
  function renderResult() {
    const q = S.quiz, pd = q.pd, code = pd.k.code, K = G.KOPPEN[code], M = G.MATCH[code], a = q.ans, r = q.res, body = $('quizBody');
    const mark = v => v >= 1 ? '<span class="mark ok">○</span>' : v > 0 ? '<span class="mark part">△</span>' : '<span class="mark ng">×</span>';
    const line = (title, key, yours, correct) => `<div class="result">${mark(r[key])}<span><b>${title}</b>: ${yours || '未回答'}</span><span class="rp">${Math.round(PTS[key] * r[key])}/${PTS[key]}</span><span class="ans">正解: <b>${correct}</b></span></div>`;
    const names = (arr, dict) => arr.map(k => typeof dict[k] === 'string' ? dict[k] : dict[k].name).join('、');
    const stats = G.KOPPEN_ORDER.filter(k => S.stats.by[k]).map(k => { const b = S.stats.by[k], pct = Math.round(b.ok / b.n * 100); return `<span class="${b.n >= 2 && pct < 50 ? 'weak' : ''}">${k} ${b.ok}/${b.n}</span>`; }).join('');
    body.innerHTML = `<div class="block">
      <div class="total"><span class="pts">${q.total}</span><span class="max">/ 100点</span><span class="hint">${q.total >= 85 ? 'よく読めています。' : q.total >= 60 ? 'あと一歩。解説で根拠を確かめましょう。' : '判定の手順を1つずつ追ってみましょう。'}</span></div>
      <div class="verdict"><span class="code">${code}</span><span class="kname">${K.name}</span></div>
      ${line('気候区分', 'kop', a.kop ? `${a.kop} ${G.KOPPEN[a.kop].name}` : '', `${code} ${K.name}`)}
      ${line('植生', 'veg', a.veg ? G.VEG[a.veg].name : '', `${G.VEG[pd.veg].name}(${G.VEG[pd.veg].sub})`)}
      ${line('土壌', 'soil', a.soil ? G.SOIL[a.soil] : '', names(M.soil[0], G.SOIL))}
      ${line('農業形態', 'agri', a.agri ? G.AGRI[a.agri] : '', names(M.agri[0], G.AGRI))}
      ${line('作物・家畜', 'crops', names(a.crops, G.CROPS), names(M.crops[0], G.CROPS))}
      ${chartsHTML(false, pd)}${factsHTML(pd, true)}
      <h3>判定の手順</h3>${koppenSteps(pd)}
      <h3>なぜこの気候になるか</h3>${factorNotes(pd)}<p class="note">${K.note}</p>
      <h3>くらしと産業</h3>${answerNotes(code)}
      <div class="row"><button type="button" class="btn primary" id="nextQuiz">次の問題</button></div>
      <h3>気候区分ごとの正答数</h3><div class="stats">${stats}</div></div>`;
    $('nextQuiz').onclick = () => { newQuestion(); $('panelQuiz').scrollIntoView({ block: 'start', behavior: 'auto' }); };
    drawCharts(pd);
  }

  /* ---------- 操作の結線 ---------- */
  function setWorld(w) { S.world = w; S.undo = []; S.activePlate = 0; worldChanged(false); buildPlates(); S.layer = 'terrain'; buildLayerChips(); refresh(); }
  $('preEarth').onclick = () => setWorld(Core.earthWorld());
  $('preRandom').onclick = () => setWorld(Core.randomWorld(1 + Math.floor(Math.random() * 9999)));
  $('preBlank').onclick = () => { const w = Core.newWorld(); w.name = '海だけの惑星'; setWorld(w); };
  $('brushSize').oninput = e => { S.brush = +e.target.value; $('brushSizeOut').textContent = S.brush; };
  $('undoBtn').onclick = () => { const u = S.undo.pop(); if (!u) return; S.world.elev.set(u.e); S.world.plate.set(u.p); S.world.oro.set(u.o); S.world.plates = JSON.parse(u.ps); S.world.mantle = u.m; S.activePlate = 0; buildPlates(); worldChanged(false); buildLayerChips(); refresh(); };
  $('addPlate').onclick = () => {
    const ps = S.world.plates; if (ps.length >= 10) return;
    ps.push(Core.mkPlate(ps.length, 'プレート' + 'ABCDEFGHIJ'[ps.length], 90, 3)); S.activePlate = ps.length - 1; S.tool = 'plate'; S.layer = 'plates';
    worldChanged(true); buildPlates(); buildToolChips(); buildLayerChips(); refresh();
  };
  $('autoPlates').onclick = () => {
    pushUndo(); Core.autoPlates(S.world, 1 + Math.floor(Math.random() * 99999)); S.activePlate = 0; S.layer = 'mantle';
    worldChanged(false); buildPlates(); buildLayerChips(); refresh();
  };
  $('orogenyBtn').onclick = () => { pushUndo(); Core.orogeny(S.world, 1 + Math.floor(Math.random() * 999)); S.world.name = S.world.name || '自作の惑星'; worldChanged(false); buildLayerChips(); refresh(); };
  $('runClimate').onclick = () => { runSim(); setMode('climate'); window.scrollTo(0, 0); };
  $('toQuiz').onclick = () => { setMode('quiz'); window.scrollTo(0, 0); };
  for (const b of document.querySelectorAll('.step')) b.onclick = () => setMode(b.dataset.mode);
  $('month').onchange = e => { S.month = +e.target.value; refresh(); };
  for (const id of ['ovCurrent', 'ovWind', 'ovGrid']) $(id).onchange = () => { draw(); legend(); };
  $('showLoc').onchange = () => { if (S.quiz && !S.quiz.done) renderQuiz(); draw(); };
  cv.addEventListener('pointerleave', () => { if (!painting) $('readout').textContent = S.mode === 'terrain' ? 'ドラッグで地形を描けます。' : '地図にカーソルを合わせると、その地点の情報が出ます。'; });
  // テーマが変わったらグラフを描き直す
  const redrawCharts = () => { if (lastCharts) drawCharts(lastCharts); };
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawCharts);
  window.addEventListener('resize', redrawCharts);
  new MutationObserver(redrawCharts).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { draw(); redrawCharts(); });

  /* ---------- 起動 ---------- */
  S.world = loadWorld() || Core.earthWorld();
  $('worldName').textContent = S.world.name || '自作の惑星';
  buildToolChips(); buildPlates(); buildLayerChips();
  setMode('terrain');
  window.__geo = S;
})();
