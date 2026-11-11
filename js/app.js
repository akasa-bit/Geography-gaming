/* 画面の制御: 地図描画・地点の読み取り・クイズ。表示する値はすべて実在の地球のデータ */
(function () {
  'use strict';
  const { W, H, N, K, DEG, latOf, lonOf, idx, clamp } = Core;
  const G = Geo;
  const $ = id => document.getElementById(id);
  const el = (tag, attrs, html) => { const e = document.createElement(tag); if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; };
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できなくても続行 */ } }
  };
  const STATS_KEY = 'geo-quiz-stats-v2';

  /* ---------- 状態 ---------- */
  const S = { world: null, sim: null, mode: 'terrain', layer: 'terrain', month: -1, agri: 'whit', inspect: -1, quiz: null, review: null, bags: {}, lastType: null, qtype: store.get('geo-quiz-type') === 'map' ? 'map' : 'graph', stats: store.get(STATS_KEY) || { n: 0, sum: 0, by: {} } };
  const cv = $('map'), ctx = cv.getContext('2d');
  const SC = 3, BW = W * SC, BH = H * SC; // 下絵は1セル(1°)=3px
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
  const R_FRAC = [[0, '#f4efe2'], [0.01, '#ece4b4'], [0.05, '#cfdc8a'], [0.15, '#86c06c'], [0.35, '#2f9a78'], [0.6, '#1f5f8a'], [1, '#27306e']];
  const R_DENS = [[0, '#f4efe2'], [3, '#f2e2ae'], [15, '#eeb866'], [50, '#de6a3c'], [150, '#96202a'], [400, '#4a0f2e']];
  const cLand = ramp(R_LAND), cSea = ramp(R_SEA), cTemp = ramp(R_TEMP), cPann = ramp(R_PANN), cPmon = ramp(R_PMON), cFrac = ramp(R_FRAC), cDens = ramp(R_DENS);
  const KCOL = {}, VCOL = {};
  for (const k in G.KOPPEN) KCOL[k] = hex(G.KOPPEN[k].color);
  for (const k in G.VEG) VCOL[k] = hex(G.VEG[k].color);
  const FCOL = {}; for (const k in G.FARM) FCOL[k] = hex(G.FARM[k].color);
  const ACOL = {}; for (const k in G.AGRI) ACOL[k] = hex(G.AGRI[k].color);
  const B_COL = { 1: '#e02d2d', 2: '#1d6fe0', 3: '#e0a81d' };
  const LF = { 0: ['安定陸塊', '#e3d6a4'], 1: ['新期造山帯', '#c9503a'], 2: ['古期造山帯', '#6f9a58'] };
  const LFC = [hex(LF[0][1]), hex(LF[1][1]), hex(LF[2][1])];
  const BASIC = ['terrain', 'landform', 'plates', 'blank'];
  const mapQuizOpen = () => S.mode === 'quiz' && S.quiz && !S.quiz.done && S.quiz.type === 'map'; // 白地図クイズの出題中
  const agriField = () => { const d = S.sim, k = d.cropNames.indexOf(S.agri), j = d.stockNames.indexOf(S.agri); return k >= 0 ? [d.crop[k], false, 4] : j >= 0 ? [d.stock[j], true, 1] : [d.cropAll, false, 1]; }; // 作物1種は割合が小さいので色を4倍に強調

  /* ---------- 地図の描画 ---------- */
  let bounds = null;
  function renderBase() {
    const w = S.world, e = w.elev, sim = S.sim, layer = S.layer, d = img.data, m = S.month;
    const fieldT = m < 0 ? sim.tAnn : sim.T[m], fieldP = m < 0 ? sim.pAnn : sim.P[m];
    const [fieldA, isDens, gain] = agriField();
    const pc = w.plates.map(p => hex(p.color));
    const landPx = new Uint8Array(BW * BH);
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
        const flat = 0.9 + (sh - 1) * 0.5;
        let c;
        if (layer === 'blank') c = land ? [251, 250, 245] : [205, 225, 236]; // 白地図
        else if (layer === 'terrain') { c = land ? cLand(ev) : cSea(ev); c = [c[0] * sh, c[1] * sh, c[2] * sh]; }
        else if (layer === 'plates') {
          const g = land ? 205 * sh : 150 + clamp(ev / 7000, -1, 0) * 50, p = pc[w.plate[near]] || [128, 128, 128];
          c = [g * 0.45 + p[0] * 0.55, g * 0.45 + p[1] * 0.55, g * 0.45 + p[2] * 0.55];
        } else if (layer === 'landform') {
          if (!land) c = cSea(ev); else { c = LFC[w.oro[near] || 0]; const s2 = 0.92 + (sh - 1) * 0.9; c = [c[0] * s2, c[1] * s2, c[2] * s2]; }
        } else if (layer === 'temp') {
          c = cTemp(bil(fieldT)); if (!land) c = [c[0] * 0.8 + 40, c[1] * 0.8 + 44, c[2] * 0.8 + 50];
        } else if (layer === 'precip') {
          c = (m < 0 ? cPann : cPmon)(bil(fieldP)); if (!land) c = [c[0] * 0.55 + 100, c[1] * 0.55 + 108, c[2] * 0.55 + 116];
        } else if (!land) c = [214, 232, 240];
        else if (layer === 'agri' && (S.agri === 'farm' || S.agri === 'whit')) { const A = S.agri === 'whit' ? sim.whit : sim.farm, v = A[near] || A[i00] || A[i10] || A[i01] || A[i11]; c = v ? FCOL[v] : [205, 208, 212]; c = [c[0] * flat, c[1] * flat, c[2] * flat]; }
        else if (layer === 'agri' && S.agri === 'lps') { const v = sim.agri[near] || sim.agri[i00] || sim.agri[i10] || sim.agri[i01] || sim.agri[i11]; c = v ? ACOL[v] : [205, 208, 212]; c = [c[0] * flat, c[1] * flat, c[2] * flat]; }
        else if (layer === 'agri') { c = (isDens ? cDens : cFrac)(bil(fieldA) * gain); c = [c[0] * flat, c[1] * flat, c[2] * flat]; }
        else if (layer === 'koppen') {
          const k = sim.kop[near] || sim.kop[i00] || sim.kop[i10] || sim.kop[i01] || sim.kop[i11];
          c = k ? KCOL[k] : [200, 200, 200]; c = [c[0] * flat, c[1] * flat, c[2] * flat];
        } else { // 植生
          const v = sim.veg[near] || sim.veg[i00] || sim.veg[i10] || sim.veg[i01] || sim.veg[i11];
          c = v ? VCOL[v] : [205, 208, 212]; c = [c[0] * flat, c[1] * flat, c[2] * flat];
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
  // 地図アプリ風のピン。先端が (x, y) を指す
  function pin(x, y) {
    const r = 15, cyp = y - 38, a = 0.62; // a: 円から先端へ移る角度
    ctx.fillStyle = 'rgba(234,67,53,0.28)'; ctx.beginPath(); ctx.arc(x, y, 17, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(234,67,53,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 17, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(x, y, 7, 3, 0, 0, 7); ctx.fill();
    const body = () => { ctx.beginPath(); ctx.arc(x, cyp, r, Math.PI - a, a, false); ctx.quadraticCurveTo(x + 5, y - 12, x, y); ctx.quadraticCurveTo(x - 5, y - 12, x + Math.cos(Math.PI - a) * r, cyp + Math.sin(Math.PI - a) * r); ctx.closePath(); };
    ctx.lineJoin = 'round';
    body(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5; ctx.stroke();
    body(); ctx.fillStyle = '#ea4335'; ctx.fill(); ctx.strokeStyle = '#b31412'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#7f0f0a'; ctx.beginPath(); ctx.arc(x, cyp, 5.5, 0, 7); ctx.fill();
  }
  const cx = x => (x + 0.5) * PX, cy = y => (y + 0.5) * PX, yLat = la => (90 - la) / DEG * PX;

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
    if (S.layer === 'plates' || S.layer === 'landform') {
      const thin = S.layer !== 'plates';
      bounds = bounds || Core.boundaries(w); ctx.lineWidth = thin ? 1.6 : 2.5;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, t = bounds.type[i]; if (!t) continue;
        ctx.strokeStyle = B_COL[t]; ctx.beginPath();
        if (w.plate[idx(x + 1, y)] !== w.plate[i]) { ctx.moveTo((x + 1) * PX, y * PX); ctx.lineTo((x + 1) * PX, (y + 1) * PX); }
        if (y < H - 1 && w.plate[i + W] !== w.plate[i]) { ctx.moveTo(x * PX, (y + 1) * PX); ctx.lineTo((x + 1) * PX, (y + 1) * PX); }
        ctx.stroke();
      }
      if (!thin) w.plates.forEach((p, pi) => { // プレートの移動方向
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
    if ($('ovCurrent').checked) {
      for (let y = 2 * K; y < H - 2 * K; y += 3 * K) for (let x = ((y / (3 * K)) & 1) * 2 * K; x < W; x += 4 * K) {
        const i = y * W + x; if (sim.land[i]) continue;
        const u = sim.cu[i] / 0.12, v = sim.cv[i] / 0.12, mg = Math.hypot(u, v); if (mg < 0.3) continue; // 12 cm/s を基準の長さに
        const k = sim.ckind[i], col = k > 0 ? '#d9281e' : k < 0 ? '#1846c9' : 'rgba(255,255,255,0.75)';
        const s = 13 / Math.max(mg, 0.7);
        arrow(cx(x) - u * s / 2, cy(y) + v * s / 2, u * s, -v * s, col, k ? 2.2 : 1.3);
      }
    }
    if ($('ovWind').checked) {
      const m = S.month < 0 ? 6 : S.month;
      for (let y = 2 * K; y < H - K; y += 4 * K) for (let x = K + (y % (8 * K) ? 2 * K : 0); x < W; x += 5 * K) {
        const i = y * W + x, u = sim.wu[m][i] / 6, v = sim.wv[m][i] / 6, mg = Math.hypot(u, v); if (mg < 0.12) continue; // 6 m/s を基準の長さに
        const s = 15 * Math.min(1.3, mg) / mg;
        arrow(cx(x) - u * s / 2, cy(y) + v * s / 2, u * s, -v * s, 'rgba(20,20,30,0.82)', 1.4);
      }
    }
    const mark = S.mode === 'quiz' ? (S.quiz && (S.quiz.done || S.quiz.type === 'map' || $('showLoc').checked) ? S.quiz.i : -1) : S.mode === 'climate' ? S.inspect : -1;
    if (mark >= 0) pin(cx(mark % W), cy((mark / W) | 0));
  }
  function refresh() { renderBase(); draw(); legend(); }

  /* ---------- 凡例 ---------- */
  function legend() {
    const sw = (c, t) => `<span class="item"><span class="sw" style="background:${c}"></span>${t}</span>`;
    const rampH = (st, unit, fmt) => `<span class="ramp">${fmt(st[0][0])}<i style="background:linear-gradient(90deg,${st.map(s => s[1]).join(',')})"></i>${fmt(st[st.length - 1][0])} ${unit}</span>`;
    const bl = `<span class="item"><span class="ln" style="border-color:${B_COL[1]}"></span>狭まる境界</span><span class="item"><span class="ln" style="border-color:${B_COL[2]}"></span>広がる境界</span><span class="item"><span class="ln" style="border-color:${B_COL[3]}"></span>ずれる境界</span>`;
    const lay = S.layer; let h = '';
    if (lay === 'terrain') h = `<span class="ramp">深海<i style="background:linear-gradient(90deg,${R_SEA.map(s => s[1]).join(',')},${R_LAND.map(s => s[1]).join(',')})"></i>高山(標高)</span>`;
    else if (lay === 'blank') h = '<span class="item">白地図(海岸線と緯線のみ)</span>';
    else if (lay === 'plates') h = bl;
    else if (lay === 'landform') h = [0, 1, 2].map(k => sw(LF[k][1], LF[k][0])).join('') + bl;
    else if (lay === 'temp') h = rampH(R_TEMP, '℃', v => v);
    else if (lay === 'precip') h = rampH(S.month < 0 ? R_PANN : R_PMON, S.month < 0 ? 'mm/年' : 'mm/月', v => Math.round(v));
    else if (lay === 'koppen') h = G.KOPPEN_ORDER.map(k => sw(G.KOPPEN[k].color, k)).join('');
    else if (lay === 'veg') h = G.VEG_ORDER.map(k => sw(G.VEG[k].color, G.VEG[k].name)).join('') + sw('#cdd0d4', 'データなし');
    else if (lay === 'agri' && S.agri === 'whit') h = G.WHIT_ORDER.map(k => sw(G.FARM[k].color, G.FARM[k].name)).join('') + sw('#cdd0d4', 'データなし') + '<span class="item">※ホイットルセー(1936)の区分図から読み取り</span>';
    else if (lay === 'agri' && S.agri === 'farm') h = G.FARM_ORDER.map(k => sw(G.FARM[k].color, G.FARM[k].name)).join('') + '<span class="item">※データに規則をあてはめた自作の区分</span>';
    else if (lay === 'agri' && S.agri === 'lps') h = G.AGRI_ORDER.map(k => sw(G.AGRI[k].color, G.AGRI[k].name)).join('') + sw('#cdd0d4', 'データなし');
    else if (lay === 'agri') h = agriField()[1] ? rampH(R_DENS, '頭/km²', v => v) : rampH(R_FRAC, '%(土地に占める収穫面積)', v => Math.round(v * 100 / agriField()[2]));
    if ($('ovCurrent').checked) h += `<span class="item"><span class="ln" style="border-color:#d9281e"></span>暖流</span><span class="item"><span class="ln" style="border-color:#1846c9"></span>寒流</span>`;
    if ($('ovWind').checked) h += `<span class="item">風: ${(S.month < 0 ? 7 : S.month + 1)}月の平均</span>`;
    $('legend').innerHTML = h;
  }

  /* ---------- 地図の種類 ---------- */
  const LAYERS = [['blank', '白地図'], ['terrain', '地形'], ['landform', '大地形'], ['plates', 'プレート'], ['temp', '気温'], ['precip', '降水量'], ['koppen', 'ケッペン'], ['veg', '植生'], ['agri', '農業']];
  // 出題中は答えが見える地図を隠す。白地図クイズでは白地図だけ
  const layerAllowed = k => mapQuizOpen() ? k === 'blank' : BASIC.includes(k) || !(S.mode === 'quiz' && S.quiz && !S.quiz.done);
  function buildLayerChips() {
    const box = $('layerChips'); box.innerHTML = '';
    for (const [k, name] of LAYERS) {
      const b = el('button', { type: 'button', class: 'chip', 'aria-pressed': S.layer === k }, name);
      b.disabled = !layerAllowed(k);
      b.onclick = () => { S.layer = k; buildLayerChips(); refresh(); };
      box.appendChild(b);
    }
    $('agriWrap').hidden = S.layer !== 'agri';
    $('ovCurrent').disabled = $('ovWind').disabled = mapQuizOpen();
    if (mapQuizOpen()) $('ovCurrent').checked = $('ovWind').checked = false;
  }

  /* ---------- モード切り替え ---------- */
  function setMode(mode) {
    S.mode = mode;
    for (const b of document.querySelectorAll('.step')) b.setAttribute('aria-current', b.dataset.mode === mode ? 'step' : 'false');
    $('panelTerrain').hidden = mode !== 'terrain'; $('panelClimate').hidden = mode !== 'climate'; $('panelQuiz').hidden = mode !== 'quiz';
    if (mode === 'terrain' && !BASIC.includes(S.layer)) S.layer = 'terrain';
    if (mode === 'climate') { if (BASIC.includes(S.layer)) S.layer = 'koppen'; if (S.inspect < 0) S.inspect = pickDefaultPoint(); renderInspect(); }
    if (mode === 'quiz') { if (!S.quiz) newQuestion(); else renderQuiz(); if (!layerAllowed(S.layer)) S.layer = mapQuizOpen() ? 'blank' : 'terrain'; }
    buildLayerChips(); refresh();
  }
  function pickDefaultPoint() {
    let best = -1, bd = 1e9; // 東京付近
    for (let i = 0; i < N; i++) if (S.sim.land[i]) { const d = Math.abs(latOf((i / W) | 0) - 35.5) * 3 + Math.abs(lonOf(i % W) - 139.5); if (d < bd) { bd = d; best = i; } }
    return best;
  }

  /* ---------- プレートの一覧 ---------- */
  const DIRS = { 0: '↑ 北', 45: '↗ 北東', 90: '→ 東', 135: '↘ 南東', 180: '↓ 南', 225: '↙ 南西', 270: '← 西', 315: '↖ 北西' };
  function buildPlates() {
    $('plateList').innerHTML = S.world.plates.map(p => `<div class="plate"><span class="pick" style="background:${p.color}"></span><span class="pname">${p.name}</span><span class="pdir">${DIRS[p.dir] || ''}</span><span class="pdir">${p.speed.toFixed(1)} cm/年</span></div>`).join('');
  }
  function cellAt(ev) {
    const r = cv.getBoundingClientRect();
    return [clamp(Math.floor((ev.clientX - r.left) / r.width * W), 0, W - 1), clamp(Math.floor((ev.clientY - r.top) / r.height * H), 0, H - 1)];
  }
  cv.addEventListener('pointerdown', ev => {
    const [gx, gy] = cellAt(ev);
    if (S.mode !== 'climate') return;
    let i = gy * W + gx;
    if (!S.sim.land[i]) { let bd = 9, b = -1; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = gy + dy; if (yy < 0 || yy >= H) continue; const j = idx(gx + dx, yy), d = Math.hypot(dx, dy); if (S.sim.land[j] && d < bd) { bd = d; b = j; } } if (b >= 0) i = b; }
    S.inspect = i; renderInspect(); draw();
  });
  cv.addEventListener('pointermove', ev => { const [gx, gy] = cellAt(ev); readout(gx, gy); });
  const posText = (la, lo) => `${Math.abs(la)}°${la >= 0 ? 'N' : 'S'} ${Math.abs(lo)}°${lo >= 0 ? 'E' : 'W'}`;
  function readout(gx, gy) {
    const i = gy * W + gx, w = S.world, sim = S.sim;
    if (mapQuizOpen()) { $('readout').textContent = posText(latOf(gy), lonOf(gx)); return; } // 標高などは答えになるので出さない
    let t = `${posText(latOf(gy), lonOf(gx))} ・ ${w.elev[i] > 0 ? '標高' : '水深'} ${Math.abs(Math.round(w.elev[i] / 10) * 10)} m ・ ${w.plates[w.plate[i]] ? w.plates[w.plate[i]].name : ''}${w.elev[i] > 0 ? ' ・ ' + LF[w.oro[i] || 0][0] : ''}`;
    if (layerAllowed('koppen')) {
      const m = S.month;
      t += ` ・ ${m < 0 ? '年平均' : (m + 1) + '月'} ${(m < 0 ? sim.tAnn[i] : sim.T[m][i]).toFixed(1)}℃ / ${Math.round(m < 0 ? sim.pAnn[i] : sim.P[m][i])} mm`;
      if (sim.kop[i]) t += ` ・ ${sim.kop[i]} ${G.KOPPEN[sim.kop[i]].name}${sim.veg[i] ? ' ・ ' + G.VEG[sim.veg[i]].name : ''} ・ 収穫面積 ${(sim.cropAll[i] * 100).toFixed(sim.cropAll[i] < 0.1 ? 1 : 0)}%`;
      else if (sim.ckind[i]) t += sim.ckind[i] > 0 ? ' ・ 暖流' : ' ・ 寒流';
    }
    $('readout').textContent = t;
  }

  /* ---------- 地点データ ---------- */
  function pointData(i) {
    const sim = S.sim, t = [], p = [];
    for (let m = 0; m < 12; m++) { t.push(sim.T[m][i]); p.push(sim.P[m][i]); }
    const y = (i / W) | 0, lat = latOf(y), k = Climate.koppen(t, p, lat, S.world.elev[i]);
    const crops = sim.cropNames.map((n, j) => ({ key: n, v: sim.crop[j][i] })).filter(c => c.v >= 0.002).sort((a, b) => b.v - a.v);
    const stock = sim.stockNames.map((n, j) => ({ key: n, v: sim.stock[j][i] }));
    return { i, t, p, lat, lon: lonOf(i % W), elev: S.world.elev[i], band: G.elevClass(S.world.elev[i]), k, veg: sim.veg[i], veg2: sim.veg2[i], agri: sim.agri[i], agri2: sim.agri2[i], whit: sim.whit[i], farm: sim.farm[i] || 'none', irr: sim.irr[i] / 255, oro: S.world.oro[i] || 0, cropAll: sim.cropAll[i], land: G.landClass(sim.cropAll[i]), crops, stock };
  }
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
  const pc1 = v => (v * 100).toFixed(v < 0.1 ? 1 : 0) + '%';
  function chartsHTML(pd) {
    return `<div class="charts"><div class="chart"><h4>雨温図</h4><canvas id="cvClimo" width="300" height="250" aria-label="雨温図"></canvas></div><div class="chart"><h4>ハイサーグラフ</h4><canvas id="cvHyther" width="300" height="250" aria-label="ハイサーグラフ"></canvas></div></div>
      <div class="tablewrap"><table class="months"><tr><th>月</th>${pd.t.map((_, m) => `<th>${m + 1}</th>`).join('')}</tr><tr><td>気温 ℃</td>${pd.t.map(v => `<td>${f1(v)}</td>`).join('')}</tr><tr><td>降水 mm</td>${pd.p.map(v => `<td>${Math.round(v)}</td>`).join('')}</tr></table></div>`;
  }
  let lastCharts = null;
  function drawCharts(pd) { lastCharts = pd; if ($('cvClimo')) { Charts.climograph($('cvClimo'), pd.t, pd.p); Charts.hythergraph($('cvHyther'), pd.t, pd.p); } }
  function factsHTML(pd, withLoc) {
    const k = pd.k, items = [];
    if (withLoc) items.push(['位置', posText(pd.lat, pd.lon)]);
    items.push(['標高', Math.round(pd.elev / 10) * 10 + ' m'], ['年平均気温', f1(k.tAvg) + ' ℃'], ['年降水量', Math.round(k.R) + ' mm'], ['最暖月 / 最寒月', `${f1(k.tMax)} / ${f1(k.tMin)} ℃`], ['年較差', f1(k.range) + ' ℃']);
    return `<dl class="facts">${items.map(([a, b]) => `<div class="fact"><dt>${a}</dt><dd>${b}</dd></div>`).join('')}</dl>`;
  }
  const vegText = pd => pd.veg ? `${G.VEG[pd.veg].name}(${G.VEG[pd.veg].sub})${pd.veg2 ? '、一部 ' + G.VEG[pd.veg2].name : ''}` : 'データなし';
  const agriText = pd => pd.agri ? `${G.AGRI[pd.agri].name}(${G.AGRI[pd.agri].sub})${pd.agri2 ? '、一部 ' + G.AGRI[pd.agri2].name : ''}` : 'データなし';
  const cropText = pd => pd.crops.length ? pd.crops.slice(0, 5).map(c => `${G.CROPS[c.key]} ${pc1(c.v)}`).join('、') : '作物の収穫面積はほぼなし(0.2%未満)';
  const stockText = pd => pd.stock.map(s => `${G.STOCK[s.key]} ${s.v < 10 ? s.v.toFixed(1) : Math.round(s.v)}`).join('、') + ' 頭/km²';
  function landDataHTML(pd) {
    return `<dl class="datalist"><dt>植生(潜在自然植生)</dt><dd>${vegText(pd)}</dd><dt>大地形</dt><dd>${LF[pd.oro][0]}</dd><dt>農業地域区分(ホイットルセー)</dt><dd>${pd.whit ? G.FARM[pd.whit].name : 'データなし'}</dd><dt>現在のデータから規則で判定した区分</dt><dd>${G.FARM[pd.farm].name}</dd><dt>家畜生産システム(FAO/ILRI)</dt><dd>${agriText(pd)}</dd><dt>灌漑の割合(収穫面積)</dt><dd>${pc1(pd.irr)}</dd><dt>耕地の広がり</dt><dd>${G.LAND[pd.land]} — 収穫面積の合計 ${pc1(pd.cropAll)}</dd><dt>主な作物(土地に占める収穫面積)</dt><dd>${cropText(pd)}</dd><dt>家畜の密度</dt><dd>${stockText(pd)}</dd></dl>`;
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
  // 観測データから読み取れる気候因子(緯度・標高・海からの距離・近くの海流・風向)
  const COMPASS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
  const windFrom = (u, v) => COMPASS[Math.round(((Math.atan2(-u, -v) * 180 / Math.PI) + 360) % 360 / 45) % 8];
  function factorNotes(pd) {
    const sim = S.sim, i = pd.i, a = Math.abs(pd.lat), n = [], x0 = i % W, y0 = (i / W) | 0;
    n.push(`<b>緯度</b>: ${f1(a)}°${pd.lat >= 0 ? 'N' : 'S'}。${a < 10 ? '赤道付近で、一年中太陽高度が高い。' : a < 23.4 ? '回帰線より低緯度側で、太陽が年2回真上を通る。' : a < 35 ? '回帰線〜緯度35°の亜熱帯。' : a < 60 ? '中緯度。' : '高緯度で太陽高度が低い。'}`);
    const km = Math.round(sim.coastD[i] * 2 * 111 / 50) * 50;
    n.push(`<b>隔海度</b>: 海まで約${km < 100 ? '100km以内' : km + 'km'}。気温の年較差は ${f1(pd.k.range)}℃${pd.k.range >= 30 ? '(大陸性の強い気候)' : pd.k.range <= 12 && a > 25 ? '(海洋性の気候)' : ''}。`);
    if (sim.coastD[i] <= 2) { // 沖合(4°以内)の海流
      let warm = 0, cold = 0;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const yy = y0 + dy; if (yy < 0 || yy >= H) continue; const k = sim.ckind[idx(x0 + dx, yy)]; if (k > 0) warm++; else if (k < 0) cold++; }
      if (warm >= 3 && warm > cold) n.push('<b>海流</b>: 沖合を暖流が流れている(同緯度の海より水温が高い)。');
      else if (cold >= 3 && cold > warm) n.push('<b>海流</b>: 沖合を寒流が流れている(同緯度の海より水温が低い)。');
    }
    const u1 = sim.wu[0][i], v1 = sim.wv[0][i], u7 = sim.wu[6][i], v7 = sim.wv[6][i], s1 = Math.hypot(u1, v1), s7 = Math.hypot(u7, v7);
    const rev = s1 > 1.2 && s7 > 1.2 && (u1 * u7 + v1 * v7) / (s1 * s7) < -0.4;
    n.push(`<b>風</b>: 1月は${windFrom(u1, v1)}寄り(${f1(s1)}m/s)、7月は${windFrom(u7, v7)}寄り(${f1(s7)}m/s)の風。${rev ? '夏と冬で風向がほぼ逆になる(季節風)。' : ''}`);
    if (pd.elev >= 500) n.push(`<b>標高</b>: ${Math.round(pd.elev / 100) * 100}m。気温は100mにつき約0.65℃下がるので、同緯度の低地より約${Math.round(pd.elev * 0.0065)}℃低い計算になる。`);
    return n.map(x => `<p class="note">${x}</p>`).join('');
  }
  const textbook = code => `<p class="note">${G.KOPPEN[code].note}</p><p class="note"><b>農業</b>: ${G.AGRI_NOTE[code]}</p><p class="note"><b>土壌</b>: ${G.SOIL_NOTE[code]}</p>`;

  /* ---------- 2. 気候を読む ---------- */
  function renderInspect() {
    const box = $('inspect'); if (S.inspect < 0 || !S.sim.land[S.inspect]) { box.innerHTML = '<p class="hint">地図の陸地をタップしてください。</p>'; return; }
    const pd = pointData(S.inspect), k = pd.k, Kp = G.KOPPEN[k.code];
    box.innerHTML = `<div class="block">
      <div class="verdict"><span class="code">${k.code}</span><span class="kname">${Kp.name}</span></div>
      ${chartsHTML(pd)}${factsHTML(pd, true)}
      <h3>この地点のデータ</h3>${landDataHTML(pd)}
      <h3>判定の手順</h3>${koppenSteps(pd)}
      <h3>観測値から読み取れる気候因子</h3>${factorNotes(pd)}
      <h3>教科書の知識(${k.code} の一般論)</h3>${textbook(k.code)}</div>`;
    drawCharts(pd);
  }

  /* ---------- 3. クイズ ---------- */
  const PTS_ALL = { graph: { kop: 40, veg: 20, agri: 15, crops: 25 }, map: { elev: 15, kop: 35, veg: 20, agri: 10, crops: 20 } };
  let PTS = PTS_ALL.graph;
  const CROP_OPTS = Object.keys(G.CROPS).concat(Object.keys(G.STOCK), ['none']);
  const cropName = k => k === 'none' ? '該当なし' : G.CROPS[k] || G.STOCK[k];
  function newQuestion() {
    const sim = S.sim, by = {};
    for (let i = 0; i < N; i++) if (sim.kop[i] && sim.veg[i] && sim.whit[i] && Math.abs(latOf((i / W) | 0)) <= 82) (by[sim.kop[i]] = by[sim.kop[i]] || []).push(i);
    const types = Object.keys(by).filter(k => by[k].length >= 3);
    // 気候区分をバランスよく: 全区分を1回ずつ並べた「袋」から順に引き、空になったら混ぜ直す(形式ごとに別の袋)
    const bag = S.bags[S.qtype] = (S.bags[S.qtype] || []).filter(k => types.includes(k));
    if (!bag.length) { for (const k of types) bag.splice(Math.floor(Math.random() * (bag.length + 1)), 0, k); if (bag.length > 1 && bag[bag.length - 1] === S.lastType) bag.reverse(); }
    const t = S.lastType = bag.pop();
    // その区分の中では面積に比例して選ぶ(緯度が高いほどセルが小さいので cos で重みづけ)
    const cells = by[t], cum = []; let tot = 0;
    for (const j of cells) { tot += Math.cos(latOf((j / W) | 0) * Math.PI / 180); cum.push(tot); }
    const u = Math.random() * tot; let lo = 0, hi = cells.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < u) lo = m + 1; else hi = m; }
    const i = cells[lo];
    PTS = PTS_ALL[S.qtype];
    S.quiz = { i, type: S.qtype, pd: pointData(i), ans: { elev: null, kop: null, veg: null, agri: null, crops: [] }, done: false };
    S.layer = S.qtype === 'map' ? 'blank' : layerAllowed(S.layer) ? S.layer : 'terrain';
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
  function renderScore() { const st = S.stats; $('scoreLine').textContent = st.n ? `${st.n}問 ・ 平均 ${Math.round(st.sum / st.n)}点` : 'まだ解いていません'; }
  function renderQuiz() {
    renderScore();
    const q = S.quiz, body = $('quizBody');
    $('reviewBtn').textContent = S.review ? 'クイズに戻る' : '記録・分析';
    for (const b of document.querySelectorAll('#qtypeChips .chip')) b.setAttribute('aria-pressed', b.dataset.t === S.qtype);
    $('showLocWrap').hidden = S.qtype === 'map';
    if (S.review) return renderReview();
    if (!q) return;
    if (q.done) return renderResult();
    const pd = q.pd, showLoc = $('showLoc').checked, isMap = q.type === 'map';
    PTS = PTS_ALL[q.type];
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'block' }, isMap
      ? '<p class="lead">白地図のピンの地点(実在の地球、1°四方の平均)について、標高・気候区分・植生・農業形態・作物を答えましょう。手がかりは位置だけです。</p>'
      : `<p class="lead">実在の地球の、ある地点(1°四方の平均)の観測値です${showLoc ? '。地図のピンがその場所' : ''}。グラフを読み取り、気候区分・植生・農業形態・作物を答えましょう。</p>${chartsHTML(pd)}${factsHTML(pd, showLoc)}`));
    const mk = (title, pts, node, hint) => { const d = el('div', { class: 'q' }, `<h3>${title}<span>${pts}点</span></h3>${hint ? `<p class="hint">${hint}</p>` : ''}`); d.appendChild(node); body.appendChild(d); };
    const toggle = (c, k) => { const j = c.indexOf(k); if (j >= 0) c.splice(j, 1); else { if (c.length >= 3) c.shift(); c.push(k); } };
    const rerender = () => { const y = window.scrollY; renderQuiz(); window.scrollTo(0, y); };
    if (isMap) mk('標高', PTS.elev, chipGroup('qElev', G.ELEV.map((n, k) => [k, n]), q.ans.elev, false, k => { q.ans.elev = k; rerender(); }), '1°四方の平均標高。');
    mk('気候区分', PTS.kop, chipGroup('qKop', G.KOPPEN_ORDER.map(k => [k, `<span class="code">${k}</span>${G.KOPPEN[k].name.replace(/\(.*\)/, '')}`]), q.ans.kop, false, k => { q.ans.kop = k; rerender(); }));
    mk('植生', PTS.veg, chipGroup('qVeg', G.VEG_ORDER.map(k => [k, G.VEG[k].name]), q.ans.veg, false, k => { q.ans.veg = k; rerender(); }), '人の手が入る前の植生(潜在自然植生)で最も広いもの。');
    mk('農業形態', PTS.agri, chipGroup('qAgri', G.WHIT_ORDER.map(k => [k, G.FARM[k].name]), q.ans.agri, false, k => { q.ans.agri = k; rerender(); }), 'ホイットルセーの農業地域区分。');
    mk('作物・家畜', PTS.crops, chipGroup('qCrops', CROP_OPTS.map(k => [k, cropName(k)]), q.ans.crops, true, k => { toggle(q.ans.crops, k); rerender(); }), 'この地点で収穫面積の広い作物、または密度の高い家畜を1〜3つ。選んだものの平均で採点します。');
    const row = el('div', { class: 'row' });
    const sub = el('button', { type: 'button', class: 'btn primary', id: 'submitQuiz' }, '採点する'); sub.disabled = !q.ans.kop; sub.onclick = grade;
    const skip = el('button', { type: 'button', class: 'btn ghost', id: 'skipQuiz' }, '別の地点にする'); skip.onclick = newQuestion;
    row.append(sub, skip); body.appendChild(row);
    if (!q.ans.kop) body.appendChild(el('p', { class: 'hint' }, '気候区分を選ぶと採点できます。ほかは未回答でも採点できます(0点)。'));
    if (!isMap) drawCharts(pd);
  }
  function renderReview() {
    const body = $('quizBody');
    Review.render(body, S.review, v => { S.review = v; renderReview(); });
    const row = el('div', { class: 'row' });
    const back = el('button', { type: 'button', class: 'btn primary', id: 'reviewBack' }, S.quiz && S.quiz.done ? '次の問題へ' : 'クイズに戻る');
    back.onclick = () => { S.review = null; if (S.quiz && S.quiz.done) newQuestion(); else renderQuiz(); $('panelQuiz').scrollIntoView({ block: 'start', behavior: 'auto' }); };
    const del = el('button', { type: 'button', class: 'btn ghost', id: 'reviewReset' }, '記録を消す');
    del.onclick = () => {
      if (del.dataset.armed) { Review.reset(); S.stats = { n: 0, sum: 0, by: {} }; store.set(STATS_KEY, S.stats); renderScore(); renderReview(); }
      else { del.dataset.armed = '1'; del.textContent = '本当に消す(元に戻せません)'; }
    };
    row.append(back, del); body.appendChild(row);
  }
  // 作物・家畜の正解: 収穫面積の上位3つ(0.5%以上)と、密度が基準以上の家畜
  function cropTruth(pd) {
    const big = pd.crops.filter(c => c.v >= 0.005), full = big.slice(0, 3).map(c => c.key), part = big.slice(3, 6).map(c => c.key);
    for (const c of big.slice(6)) if (c.v >= 0.02) part.push(c.key);
    for (const s of pd.stock) { const m = G.STOCK_MIN[s.key]; if (s.v >= m) full.push(s.key); else if (s.v >= m / 3) part.push(s.key); }
    if (!full.length) full.push('none'); else if (full.length <= 1 && !big.length) part.push('none');
    return { full, part };
  }
  function grade() {
    const q = S.quiz, pd = q.pd, code = pd.k.code, a = q.ans, res = {};
    PTS = PTS_ALL[q.type];
    if (q.type === 'map') res.elev = a.elev == null ? 0 : a.elev === pd.band ? 1 : Math.abs(a.elev - pd.band) === 1 ? 0.5 : 0;
    res.kop = a.kop === code ? 1 : (code === 'H' && a.kop === pd.k.base) ? 0.5 : (a.kop && a.kop[0] === code[0] && code !== 'H') ? 0.4 : 0;
    res.veg = a.veg == null ? 0 : a.veg === pd.veg ? 1 : a.veg === pd.veg2 ? 0.5 : 0;
    const nf = nearFarm(pd.whit);
    res.agri = a.agri == null ? 0 : a.agri === pd.whit ? 1 : nf.includes(a.agri) ? 0.5 : 0;
    const ct = q.truth = cropTruth(pd);
    res.crops = a.crops.length ? a.crops.reduce((s, c) => s + (ct.full.includes(c) ? 1 : ct.part.includes(c) ? 0.5 : 0), 0) / a.crops.length : 0;
    let total = 0; for (const k in PTS) total += PTS[k] * res[k];
    q.res = res; q.total = Math.round(total); q.done = true;
    const st = S.stats; st.n++; st.sum += q.total; const b = st.by[code] = st.by[code] || { n: 0, ok: 0 }; b.n++; b.ok += res.kop === 1 ? 1 : 0;
    store.set(STATS_KEY, st);
    const count = Review.add({
      t: Date.now(), type: q.type, code, base: pd.k.base, lat: pd.lat, lon: pd.lon, elev: Math.round(pd.elev), tMax: +pd.k.tMax.toFixed(1), tMin: +pd.k.tMin.toFixed(1), R: Math.round(pd.k.R), rt: pd.k.rainType,
      loc: q.type === 'map' || $('showLoc').checked, a: { elev: a.elev, kop: a.kop, veg: a.veg, agri: a.agri, crops: a.crops.slice() }, r: res, total: q.total,
      ok: { elev: [pd.band], veg: [pd.veg, pd.veg2].filter(Boolean), agri: [pd.whit].concat(nf), crops: ct.full.concat(ct.part) },
      c: { elev: G.ELEV[pd.band], veg: G.VEG[pd.veg].name, agri: G.FARM[pd.whit].name, crops: ct.full.map(cropName).join('・') }
    });
    q.milestone = count % Review.BLOCK === 0 ? count / Review.BLOCK : 0;
    S.layer = 'koppen'; buildLayerChips(); refresh(); renderQuiz();
    $('panelQuiz').scrollIntoView({ block: 'start', behavior: 'auto' });
  }
  const nearFarm = w => G.FARM_NEAR.filter(p => p.includes(w)).map(p => p[0] === w ? p[1] : p[0]);
  function renderResult() {
    const q = S.quiz, pd = q.pd, code = pd.k.code, Kp = G.KOPPEN[code], a = q.ans, r = q.res, body = $('quizBody');
    PTS = PTS_ALL[q.type];
    const mark = v => v >= 1 ? '<span class="mark ok">○</span>' : v > 0 ? '<span class="mark part">△</span>' : '<span class="mark ng">×</span>';
    const line = (title, key, yours, correct) => `<div class="result">${mark(r[key])}<span><b>${title}</b>: ${yours || '未回答'}</span><span class="rp">${Math.round(PTS[key] * r[key])}/${PTS[key]}</span><span class="ans">正解: <b>${correct}</b></span></div>`;
    const stats = G.KOPPEN_ORDER.filter(k => S.stats.by[k]).map(k => { const b = S.stats.by[k], pct = Math.round(b.ok / b.n * 100); return `<span class="${b.n >= 2 && pct < 50 ? 'weak' : ''}">${k} ${b.ok}/${b.n}</span>`; }).join('');
    const ms = q.milestone ? `<div class="milestone"><b>${q.milestone * Review.BLOCK}問に到達。</b>第${q.milestone}回の傾向分析ができました。<div class="row"><button type="button" class="btn primary" id="openMilestone">傾向分析を見る</button></div></div>` : '';
    body.innerHTML = `<div class="block">${ms}
      <div class="total"><span class="pts">${q.total}</span><span class="max">/ 100点</span><span class="hint">${q.total >= 85 ? 'よく読めています。' : q.total >= 60 ? 'あと一歩。解説で根拠を確かめましょう。' : '判定の手順を1つずつ追ってみましょう。'}</span></div>
      <div class="verdict"><span class="code">${code}</span><span class="kname">${Kp.name}</span></div>
      ${q.type === 'map' ? line('標高', 'elev', a.elev != null ? G.ELEV[a.elev] : '', `${G.ELEV[pd.band]} — 平均 ${Math.round(pd.elev / 10) * 10} m`) : ''}
      ${line('気候区分', 'kop', a.kop ? `${a.kop} ${G.KOPPEN[a.kop].name}` : '', `${code} ${Kp.name}`)}
      ${line('植生', 'veg', a.veg != null ? G.VEG[a.veg].name : '', vegText(pd))}
      ${line('農業形態', 'agri', a.agri != null ? G.FARM[a.agri].name : '', G.FARM[pd.whit].name + (nearFarm(pd.whit).length ? `</b>(部分点: ${nearFarm(pd.whit).map(k => G.FARM[k].name).join('、')})<b>` : ''))}
      ${line('作物・家畜', 'crops', a.crops.map(cropName).join('、'), q.truth.full.map(cropName).join('、') + (q.truth.part.length ? `</b>(部分点: ${q.truth.part.map(cropName).join('、')})<b>` : ''))}
      ${chartsHTML(pd)}${factsHTML(pd, true)}
      <h3>この地点のデータ</h3>${landDataHTML(pd)}
      <h3>判定の手順</h3>${koppenSteps(pd)}
      <h3>観測値から読み取れる気候因子</h3>${factorNotes(pd)}
      <h3>教科書の知識(${code} の一般論)</h3>${textbook(code)}
      <div class="row"><button type="button" class="btn primary" id="nextQuiz">次の問題</button></div>
      <h3>気候区分ごとの正答数</h3><div class="stats">${stats}</div></div>`;
    if (q.milestone) $('openMilestone').onclick = () => { S.review = String(q.milestone); renderQuiz(); $('panelQuiz').scrollIntoView({ block: 'start', behavior: 'auto' }); };
    $('nextQuiz').onclick = () => { newQuestion(); $('panelQuiz').scrollIntoView({ block: 'start', behavior: 'auto' }); };
    drawCharts(pd);
  }

  /* ---------- 操作の結線 ---------- */
  $('runClimate').onclick = () => { setMode('climate'); window.scrollTo(0, 0); };
  $('toQuiz').onclick = () => { setMode('quiz'); window.scrollTo(0, 0); };
  for (const b of document.querySelectorAll('.step')) b.onclick = () => setMode(b.dataset.mode);
  $('month').onchange = e => { S.month = +e.target.value; refresh(); };
  $('agriSel').onchange = e => { S.agri = e.target.value; refresh(); };
  for (const id of ['ovCurrent', 'ovWind', 'ovGrid']) $(id).onchange = () => { draw(); legend(); };
  $('reviewBtn').onclick = () => { S.review = S.review ? null : 'now'; renderQuiz(); };
  for (const b of document.querySelectorAll('#qtypeChips .chip')) b.onclick = () => { if (S.qtype === b.dataset.t) return; S.qtype = b.dataset.t; store.set('geo-quiz-type', S.qtype); S.review = null; newQuestion(); };
  $('showLoc').onchange = () => { if (S.quiz && !S.quiz.done) renderQuiz(); draw(); };
  cv.addEventListener('pointerleave', () => { $('readout').textContent = '地図にカーソルを合わせると、その地点の情報が出ます。'; });
  // テーマや画面幅が変わったらグラフを描き直す
  const redrawCharts = () => { if (lastCharts) drawCharts(lastCharts); };
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawCharts);
  window.addEventListener('resize', redrawCharts);
  new MutationObserver(redrawCharts).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (S.sim) draw(); redrawCharts(); });

  /* ---------- 起動 ---------- */
  function boot() {
    if (!window.EARTH) { $('readout').textContent = '地球のデータを読み込めませんでした。新しいブラウザ(gzip展開に対応したもの)で開いてください。'; return; }
    S.world = Core.realEarthWorld(window.EARTH);
    S.sim = Climate.build(S.world, window.EARTH);
    $('agriSel').innerHTML = `<option value="whit">農業地域区分(ホイットルセー)</option><option value="farm">現在のデータから規則で判定した区分</option><option value="lps">家畜生産システム(FAO/ILRI)</option><option value="all">作物の収穫面積の合計</option>` + S.sim.cropNames.map(k => `<option value="${k}">${G.CROPS[k]}</option>`).join('') + S.sim.stockNames.map(k => `<option value="${k}">${G.STOCK[k]}(頭/km²)</option>`).join('');
    buildPlates(); buildLayerChips();
    setMode('terrain');
  }
  Core.loadEarth(window.EARTH_DATA).then(E => { window.EARTH = E; }, () => { window.EARTH = null; }).then(boot);
  window.__geo = S;
})();
