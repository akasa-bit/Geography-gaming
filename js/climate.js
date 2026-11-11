/* 観測データから気候の表示用データを組み立てる。ケッペンの気候区分は観測の気温・降水量から判定する。 */
(function (root) {
  'use strict';
  const Core = (typeof module !== 'undefined' && module.exports) ? require('./core.js') : root.Core;
  const { W, H, N, latOf } = Core;

  /* ---- ケッペンの気候区分(日本の高校地理で使う判定法) ---- */
  const HIGHLAND_M = 2000;
  function koppen(t, p, lat, elev) {
    const tMax = Math.max(...t), tMin = Math.min(...t);
    const tAvg = t.reduce((a, b) => a + b, 0) / 12, R = p.reduce((a, b) => a + b, 0);
    const north = lat >= 0;
    const sumIdx = north ? [3, 4, 5, 6, 7, 8] : [9, 10, 11, 0, 1, 2];
    const winIdx = north ? [9, 10, 11, 0, 1, 2] : [3, 4, 5, 6, 7, 8];
    const pS = sumIdx.map(i => p[i]), pW = winIdx.map(i => p[i]);
    const sumS = pS.reduce((a, b) => a + b, 0), sumW = pW.reduce((a, b) => a + b, 0);
    const sDry = Math.min(...pS), sWet = Math.max(...pS), wDry = Math.min(...pW), wWet = Math.max(...pW);
    const pMin = Math.min(...p);
    // 乾燥限界 r(mm) = 20(t + x)
    let rainType, x;
    if (sWet >= 10 * wDry && sumS >= 0.6 * R) { rainType = 'w'; x = 14; }
    else if (wWet >= 3 * sDry && sumW >= 0.6 * R) { rainType = 's'; x = 0; }
    else { rainType = 'f'; x = 7; }
    const r = Math.max(0, 20 * (tAvg + x));
    const warmMonths = t.filter(v => v >= 10).length;
    let code, steps = [];
    const res = { tMax, tMin, tAvg, R, r, rainType, x, pMin, sDry, sWet, wDry, wWet, warmMonths, north, elev, range: tMax - tMin };
    if (tMax < 10) {
      code = tMax < 0 ? 'EF' : 'ET';
    } else if (R < r) {
      code = R < r / 2 ? 'BW' : 'BS';
    } else if (tMin >= 18) {
      code = pMin >= 60 ? 'Af' : (pMin >= 100 - R / 25 ? 'Am' : 'Aw');
    } else {
      const g = tMin >= -3 ? 'C' : 'D';
      const sflag = sDry < 30 && wWet >= 3 * sDry;
      const wflag = sWet >= 10 * wDry;
      if (g === 'C') {
        if (sflag && sumW > sumS) code = 'Cs';
        else if (wflag) code = 'Cw';
        else code = tMax >= 22 ? 'Cfa' : 'Cfb';
      } else code = wflag ? 'Dw' : 'Df';
    }
    res.base = code;
    if (elev >= HIGHLAND_M && code !== 'EF') code = 'H';
    res.code = code;
    return res;
  }

  /* ---- 観測データ → 表示・出題用のデータ ---- */
  function build(world, E) {
    const land = new Uint8Array(N); for (let i = 0; i < N; i++) land[i] = world.elev[i] > 0 ? 1 : 0;
    const D = { land, T: [], P: [], wu: [], wv: [], tAnn: new Float32Array(N), pAnn: new Float32Array(N), kop: new Array(N), veg: E.veg, veg2: E.veg2,
      cu: new Float32Array(N), cv: new Float32Array(N), sstA: new Float32Array(N), ckind: new Int8Array(N), coastD: Core.distField(land.map(v => 1 - v)),
      crop: [], stock: [], cropAll: new Float32Array(N), cropNames: E.cropNames, stockNames: E.stockNames };
    for (let m = 0; m < 12; m++) {
      const t = new Float32Array(N), p = new Float32Array(N), u = new Float32Array(N), v = new Float32Array(N);
      for (let i = 0; i < N; i++) { t[i] = E.T[m * N + i] / 10; p[i] = E.P[m * N + i]; u[i] = E.wu[m * N + i] / 10; v[i] = E.wv[m * N + i] / 10; } // ℃, mm, m/s
      D.T.push(t); D.P.push(p); D.wu.push(u); D.wv.push(v);
    }
    E.cropNames.forEach((_, k) => { const f = new Float32Array(N); for (let i = 0; i < N; i++) { const v = E.crop[k * N + i] / 255; f[i] = v * v; D.cropAll[i] += f[i]; } D.crop.push(f); }); // セル面積に対する収穫面積の割合
    E.stockNames.forEach((_, k) => { const f = new Float32Array(N); for (let i = 0; i < N; i++) { const v = E.stock[k * N + i] / 8; f[i] = v * v; } D.stock.push(f); }); // 頭/km²
    for (let i = 0; i < N; i++) {
      const lat = latOf((i / W) | 0), t = [], p = [];
      for (let m = 0; m < 12; m++) { t.push(D.T[m][i]); p.push(D.P[m][i]); }
      const k = koppen(t, p, lat, world.elev[i]);
      D.tAnn[i] = k.tAvg; D.pAnn[i] = k.R; D.kop[i] = land[i] ? k.code : null;
      D.cu[i] = E.cu[i] / 200; D.cv[i] = E.cv[i] / 200; D.sstA[i] = E.sstA[i] / 10; // m/s, ℃
      // 暖流=同緯度の海より暖かく高緯度へ向かう流れ、寒流=冷たく低緯度へ向かう流れ
      const pole = D.cv[i] * (lat >= 0 ? 1 : -1), mg = Math.hypot(D.cu[i], D.cv[i]);
      D.ckind[i] = land[i] || Math.abs(lat) > 72 || mg < 0.024 ? 0 : (E.sstA[i] > 12 && pole > 0.15 * mg) ? 1 : (E.sstA[i] < -12 && pole < -0.15 * mg) ? -1 : 0;
    }
    return D;
  }

  const API = { koppen, build, HIGHLAND_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Climate = API;
})(typeof window !== 'undefined' ? window : globalThis);
