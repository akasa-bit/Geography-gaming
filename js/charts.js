/* 雨温図とハイサーグラフをキャンバスに描く */
(function (root) {
  'use strict';
  function setup(cv, w, h) {
    const dpr = Math.min(3, root.devicePixelRatio || 1);
    cv.width = w * dpr; cv.height = h * dpr;
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
    return { c, col: { ink: v('--ink'), ink2: v('--ink-2'), line: v('--line'), temp: v('--temp'), rain: v('--rain'), bg: v('--surface') } };
  }
  function scales(t, p) {
    const tLo = Math.min(-10, Math.floor(Math.min(...t) / 10) * 10), tHi = Math.max(30, Math.ceil(Math.max(...t) / 10) * 10);
    const pHi = Math.max(300, Math.ceil(Math.max(...p) / 100) * 100);
    return { tLo, tHi, pHi };
  }
  const FONT = '11px "DM Mono", ui-monospace, monospace';

  // 雨温図: 折れ線=気温(左軸), 棒=降水量(右軸)
  function climograph(cv, t, p) {
    const Wd = 300, Hd = 250, { c, col } = setup(cv, Wd, Hd), { tLo, tHi, pHi } = scales(t, p);
    const L = 34, R = 36, T = 20, B = 26, pw = Wd - L - R, ph = Hd - T - B;
    const yT = v => T + ph * (1 - (v - tLo) / (tHi - tLo)), yP = v => T + ph * (1 - v / pHi), xM = m => L + pw * (m + 0.5) / 12;
    c.font = FONT; c.textBaseline = 'middle'; c.lineWidth = 1;
    for (let v = tLo; v <= tHi; v += 10) {
      c.strokeStyle = col.line; c.globalAlpha = v === 0 ? 1 : 0.55; c.beginPath(); c.moveTo(L, yT(v)); c.lineTo(L + pw, yT(v)); c.stroke(); c.globalAlpha = 1;
      c.fillStyle = col.temp; c.textAlign = 'right'; c.fillText(v, L - 5, yT(v));
    }
    const pStep = pHi <= 400 ? 100 : 200;
    c.fillStyle = col.rain; c.textAlign = 'left';
    for (let v = 0; v <= pHi; v += pStep) c.fillText(v, L + pw + 5, yP(v));
    c.fillStyle = col.rain;
    for (let m = 0; m < 12; m++) { const bw = pw / 12 * 0.68; c.fillRect(xM(m) - bw / 2, yP(p[m]), bw, T + ph - yP(p[m])); }
    c.strokeStyle = col.ink; c.strokeRect(L + 0.5, T + 0.5, pw, ph);
    c.strokeStyle = col.temp; c.lineWidth = 2; c.lineJoin = 'round'; c.beginPath();
    for (let m = 0; m < 12; m++) m ? c.lineTo(xM(m), yT(t[m])) : c.moveTo(xM(m), yT(t[m]));
    c.stroke();
    c.fillStyle = col.bg; c.lineWidth = 1.5;
    for (let m = 0; m < 12; m++) { c.beginPath(); c.arc(xM(m), yT(t[m]), 2.6, 0, 7); c.fill(); c.stroke(); }
    c.fillStyle = col.ink2; c.textAlign = 'center'; c.textBaseline = 'top';
    for (let m = 0; m < 12; m++) c.fillText(m + 1, xM(m), T + ph + 5);
    c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.fillStyle = col.temp; c.fillText('℃', 6, 12);
    c.textAlign = 'right'; c.fillStyle = col.rain; c.fillText('mm', Wd - 6, 12);
    c.fillStyle = col.ink2; c.textAlign = 'center'; c.fillText('月', L + pw / 2, Hd - 1);
  }

  // ハイサーグラフ: 横軸=月降水量, 縦軸=月平均気温。1月→12月を線で結ぶ
  function hythergraph(cv, t, p) {
    const Wd = 300, Hd = 250, { c, col } = setup(cv, Wd, Hd), { tLo, tHi, pHi } = scales(t, p);
    const L = 34, R = 14, T = 20, B = 34, pw = Wd - L - R, ph = Hd - T - B;
    const y = v => T + ph * (1 - (v - tLo) / (tHi - tLo)), x = v => L + pw * v / pHi;
    c.font = FONT; c.lineWidth = 1;
    c.textBaseline = 'middle'; c.textAlign = 'right';
    for (let v = tLo; v <= tHi; v += 10) {
      c.strokeStyle = col.line; c.globalAlpha = v === 0 ? 1 : 0.55; c.beginPath(); c.moveTo(L, y(v)); c.lineTo(L + pw, y(v)); c.stroke(); c.globalAlpha = 1;
      c.fillStyle = col.ink2; c.fillText(v, L - 5, y(v));
    }
    const pStep = pHi <= 400 ? 100 : 200;
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (let v = 0; v <= pHi; v += pStep) {
      c.strokeStyle = col.line; c.globalAlpha = 0.55; c.beginPath(); c.moveTo(x(v), T); c.lineTo(x(v), T + ph); c.stroke(); c.globalAlpha = 1;
      c.fillStyle = col.ink2; c.fillText(v, x(v), T + ph + 5);
    }
    c.strokeStyle = col.ink; c.strokeRect(L + 0.5, T + 0.5, pw, ph);
    c.strokeStyle = col.ink; c.lineWidth = 1.6; c.lineJoin = 'round'; c.beginPath();
    for (let m = 0; m < 12; m++) m ? c.lineTo(x(p[m]), y(t[m])) : c.moveTo(x(p[m]), y(t[m]));
    c.closePath(); c.stroke();
    let cx = 0, cy = 0; for (let m = 0; m < 12; m++) { cx += x(p[m]) / 12; cy += y(t[m]) / 12; }
    c.textBaseline = 'middle';
    for (let m = 0; m < 12; m++) {
      const px = x(p[m]), py = y(t[m]), hot = t[m] >= 15;
      c.fillStyle = hot ? col.temp : col.rain; c.beginPath(); c.arc(px, py, 3, 0, 7); c.fill();
      let dx = px - cx, dy = py - cy; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      const lx = Math.min(L + pw - 6, Math.max(L + 7, px + dx * 11)), ly = Math.min(T + ph - 6, Math.max(T + 7, py + dy * 11));
      c.fillStyle = col.ink; c.textAlign = 'center'; c.fillText(m + 1, lx, ly);
    }
    c.textBaseline = 'alphabetic'; c.fillStyle = col.ink2; c.textAlign = 'left'; c.fillText('℃', 6, 12);
    c.textAlign = 'center'; c.fillText('月降水量 mm(数字は月)', L + pw / 2, Hd - 3);
  }
  root.Charts = { climograph, hythergraph };
})(window);
