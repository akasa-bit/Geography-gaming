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

  /* ---- 農業区分(自作): 作物・家畜・灌漑・気候のデータに規則をあてはめ、教科書の農業地域区分に近い型を決める ----
   * 経営の性格(自給的か企業的か)を表すデータはないので、新大陸か旧大陸か・アジアかどうかで代用している。 */
  function farmType(c) { // c: {kop, lat, lon, total, crop(名前→割合), cattle, sheep, goats, pigs, irr, lps}
    const k = c.kop, g = k[0], f = n => c.crop[n] || 0, T = c.total, st = c.cattle + c.sheep + c.goats;
    const newWorld = c.lon < -30 || (c.lon > 110 && c.lat < -10) || (c.lat < -17 && c.lon > 10 && c.lon < 42); // 南北アメリカ・オセアニア・南部アフリカ
    const asia = c.lon >= 60 && c.lon <= 150 && c.lat >= -11 && c.lat <= 54 && !(c.lon < 90 && c.lat > 40);       // 南・東南・東アジア(モンスーンアジア)
    const steppeBelt = c.lat >= 43 && c.lat <= 57 && c.lon >= 22 && c.lon <= 92;                                 // ウクライナ〜カザフスタンの黒土地帯
    const plant = f('Coffee') + f('Cocoa') + f('Tea') + f('Rubber') + f('Oilpalm') + f('Sugarcane') + f('Banana') + f('Coconut');
    const grain = f('Wheat') + f('Barley') + f('Othercereals') + f('Rapeseed') + f('Sunflower');
    const garden = f('Vegetables') + f('Temperatefruit') + f('Citrus') + f('Tropicalfruit');
    const medit = f('Olives') + f('Temperatefruit') + f('Citrus');
    const herd = () => st < 1 ? 'none' : newWorld ? 'ranch' : 'nomad';
    if (k === 'EF' || c.lps === 5) return 'none';
    if (T < 0.01 && st < 1 && !(g === 'A' && T >= 0.0005)) return 'none';
    if (k === 'ET') return T < 0.02 ? (st >= 1 ? herd() : 'none') : 'mixed';
    if (k === 'H') return T >= 0.03 ? 'shifting' : herd();                       // 高地: 自給的な畑作(粗放的定住農業) / 放牧
    if (g === 'B') {
      if (c.irr >= 0.5 && T >= 0.03) return 'oasis';                             // 乾燥地の灌漑農業
      if (T < 0.05) return herd();
      if (asia) return f('Rice') >= 0.3 * T ? 'rice' : 'upland';
      if (grain >= 0.5 * T && (newWorld || steppeBelt)) return 'grain';
      if (newWorld) return c.cattle >= 10 && T < 0.15 ? 'ranch' : 'grain';
      return k === 'BS' && c.lat > 30 && c.lon < 60 && medit + f('Wheat') >= 0.4 * T ? 'medit' : 'shifting';
    }
    if (g === 'A') {
      if (plant >= 0.35 * T && plant >= 0.02) return 'plantation';
      if (asia) return T < 0.02 ? 'shifting' : f('Rice') >= 0.25 * T ? 'rice' : 'upland';
      if (newWorld && T < 0.06 && c.cattle >= 8) return 'ranch';                 // カンポ・リャノなど
      if (newWorld && T >= 0.15 && f('Soybean') + f('Maize') + f('Wheat') >= 0.5 * T) return 'grain';
      if (T < 0.0005 && c.lps !== 4) return st >= 3 ? herd() : 'none';
      return 'shifting';                                                        // 熱帯林・サバナの自給的農業(焼畑・粗放的定住農業)
    }
    // 温帯・亜寒帯
    if (k === 'Cs' && T >= 0.02) return 'medit';
    if (asia) return T < 0.01 ? (st >= 3 ? 'nomad' : 'none') : f('Rice') >= 0.25 * T ? 'rice' : 'upland';
    if (plant >= 0.4 * T && plant >= 0.03 && Math.abs(c.lat) < 32) return 'plantation';
    if (T < 0.03) return st >= 3 ? (newWorld ? 'ranch' : (c.cattle >= 4 ? 'dairy' : 'nomad')) : 'none';
    if (grain >= 0.6 * T && (newWorld || steppeBelt) && c.cattle + c.pigs < 30) return 'grain';
    if (newWorld && T < 0.1 && st >= 10 && f('Fodder') < 0.3 * T) return 'ranch';
    if (garden >= 0.35 * T) return 'horti';
    if ((f('Fodder') >= 0.4 * T || (c.cattle >= 25 && T < 0.25)) && (k === 'Cfb' || g === 'D')) return 'dairy';
    return 'mixed';
  }

  /* ---- 観測データ → 表示・出題用のデータ ---- */
  function build(world, E) {
    const land = new Uint8Array(N); for (let i = 0; i < N; i++) land[i] = world.elev[i] > 0 ? 1 : 0;
    const D = { land, T: [], P: [], wu: [], wv: [], tAnn: new Float32Array(N), pAnn: new Float32Array(N), kop: new Array(N), veg: E.veg, veg2: E.veg2, agri: E.lps, agri2: E.lps2,
      cu: new Float32Array(N), cv: new Float32Array(N), sstA: new Float32Array(N), ckind: new Int8Array(N), coastD: Core.distField(land.map(v => 1 - v)),
      crop: [], stock: [], farm: new Array(N).fill(null), whit: new Array(N).fill(null), irr: E.irr, cropAll: new Float32Array(N), cropNames: E.cropNames, stockNames: E.stockNames };
    for (let m = 0; m < 12; m++) {
      const t = new Float32Array(N), p = new Float32Array(N), u = new Float32Array(N), v = new Float32Array(N);
      for (let i = 0; i < N; i++) { t[i] = E.T[m * N + i] / 10; p[i] = E.P[m * N + i]; u[i] = E.wu[m * N + i] / 10; v[i] = E.wv[m * N + i] / 10; } // ℃, mm, m/s
      D.T.push(t); D.P.push(p); D.wu.push(u); D.wv.push(v);
    }
    E.cropNames.forEach((_, k) => { const f = new Float32Array(N); for (let i = 0; i < N; i++) { const v = E.crop[k * N + i] / 255; f[i] = v * v; } D.crop.push(f); });
    for (let i = 0; i < N; i++) { const v = E.cropAll[i] / 180; D.cropAll[i] = v * v; } // 収穫面積の合計(オリーブは「その他」に含まれるので二重に数えない) // セル面積に対する収穫面積の割合
    E.stockNames.forEach((_, k) => { const f = new Float32Array(N); for (let i = 0; i < N; i++) { const v = E.stock[k * N + i] / 8; f[i] = v * v; } D.stock.push(f); }); // 頭/km²
    for (let i = 0; i < N; i++) {
      const lat = latOf((i / W) | 0), t = [], p = [];
      for (let m = 0; m < 12; m++) { t.push(D.T[m][i]); p.push(D.P[m][i]); }
      const k = koppen(t, p, lat, world.elev[i]);
      D.tAnn[i] = k.tAvg; D.pAnn[i] = k.R; D.kop[i] = land[i] ? k.code : null;
      D.cu[i] = E.cu[i] / 200; D.cv[i] = E.cv[i] / 200; D.sstA[i] = E.sstA[i] / 10; // m/s, ℃
      if (land[i] && E.whit[i]) D.whit[i] = E.whitNames[E.whit[i] - 1]; // ホイットルセーの区分図から読み取った農業地域区分
      if (land[i]) { // 農業区分(自作の規則)
        const crop = {}; E.cropNames.forEach((n, j) => { crop[n] = D.crop[j][i]; });
        D.farm[i] = farmType({ kop: k.code, lat, lon: Core.lonOf(i % W), total: D.cropAll[i], crop, cattle: D.stock[0][i], sheep: D.stock[1][i], goats: D.stock[2][i], pigs: D.stock[3][i], irr: E.irr[i] / 255, lps: E.lps[i] });
      }
      // 暖流=同緯度の海より暖かく高緯度へ向かう流れ、寒流=冷たく低緯度へ向かう流れ
      const pole = D.cv[i] * (lat >= 0 ? 1 : -1), mg = Math.hypot(D.cu[i], D.cv[i]);
      D.ckind[i] = land[i] || Math.abs(lat) > 72 || mg < 0.024 ? 0 : (E.sstA[i] > 12 && pole > 0.15 * mg) ? 1 : (E.sstA[i] < -12 && pole < -0.15 * mg) ? -1 : 0;
    }
    return D;
  }

  const API = { koppen, build, farmType, HIGHLAND_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Climate = API;
})(typeof window !== 'undefined' ? window : globalThis);
