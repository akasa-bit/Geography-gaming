/* 気候シミュレーション
 * 地形 → 海流 → 気圧帯と風(季節移動+季節風) → 気温・降水量(12か月) → ケッペン・植生
 * 厳密な大気大循環モデルではなく、高校地理で学ぶ気候因子を1つずつ数式にした簡略モデル。 */
(function (root) {
  'use strict';
  const Core = (typeof module !== 'undefined' && module.exports) ? require('./core.js') : root.Core;
  const { W, H, N, K, latOf, idx, clamp } = Core;
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // 海面更正した年平均気温(緯度10°ごと)
  const TB = [27, 26.6, 25, 21, 14.5, 8, 2, -6, -14, -20];
  function tBase(a) { const k = Math.min(a / 10, 8.999), i = Math.floor(k); return TB[i] + (TB[i + 1] - TB[i]) * (k - i); }

  const itczF = a => { const d = Math.max(0, a - 4) / 8; return Math.exp(-d * d); }; // 熱帯収束帯の雨域
  function blur(src, r, passes) { // r は2°セル単位
    r = Math.round(r * K);
    let a = Float32Array.from(src), b = new Float32Array(N);
    for (let p = 0; p < passes; p++) {
      for (let y = 0; y < H; y++) { // 東西
        let s = 0; for (let k = -r; k <= r; k++) s += a[idx(k, y)];
        for (let x = 0; x < W; x++) { b[y * W + x] = s / (2 * r + 1); s += a[idx(x + r + 1, y)] - a[idx(x - r, y)]; }
      }
      for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) { // 南北
        let s = 0, c = 0;
        for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < H) { s += b[yy * W + x]; c++; } }
        a[y * W + x] = s / c;
      }
    }
    return a;
  }

  function simulate(world) {
    const elev = world.elev;
    const land = new Uint8Array(N); for (let i = 0; i < N; i++) land[i] = elev[i] > 0 ? 1 : 0;
    const landS = blur(land, 2, 2), landL = blur(land, 7, 2);
    const coastD = Core.distField(land.map(v => 1 - v)); // 陸セル: 海までの距離
    const landXL = blur(land, 12, 2);

    /* ---- 海流 ---- */
    const cu = new Float32Array(N), cv = new Float32Array(N), sstA0 = new Float32Array(N), ckind = new Int8Array(N), warmW = new Float32Array(N);
    const openPole = (x, y, sg) => { // 高緯度側に海が続いているか(環流が成立するか)
      const yy = y - sg * 8 * K; if (yy < 0 || yy >= H) return false;
      for (let k = -4 * K; k <= 4 * K; k++) if (!land[idx(x + k, yy)]) return true;
      return false;
    };
    for (let y = 0; y < H; y++) {
      const la = latOf(y), a = Math.abs(la), sg = la >= 0 ? 1 : -1;
      for (let x = 0; x < W; x++) {
        const i = y * W + x; if (land[i]) continue;
        let dW = 0, dE = 0;
        while (dW < 70 * K && !land[idx(x - dW - 1, y)]) dW++;
        while (dE < 70 * K && !land[idx(x + dE + 1, y)]) dE++;
        dW /= K; dE /= K; // 2°セル単位
        const wide = dW + dE >= 7;
        // 東西方向の流れ: 貿易風帯で西向き(赤道海流)、偏西風帯で東向き
        let u = 0, v = 0, an = 0;
        if (a < 24) u = -0.7 * Math.cos(a / 24 * Math.PI / 2) - 0.2;
        else if (a > 34 && a < 62) u = 0.8 * Math.sin((a - 34) / 28 * Math.PI);
        if (a < 5 && a > 1) u *= 0.3;
        if (wide) {
          const nearW = Math.exp(-dW / 4), nearE = Math.exp(-dE / 3);
          const sub = smoothstep(6, 14, a) * (1 - smoothstep(36, 44, a)); // 亜熱帯循環
          const pol = smoothstep(42, 48, a) * (1 - smoothstep(66, 74, a)); // 亜寒帯循環
          const op = openPole(x, y, sg) ? 1 : 0, oe = 1 - smoothstep(0.45, 0.6, landL[i]), big = dW + dE >= 14 ? 1 : 0;
          // 大洋の西岸: 低緯度→暖流が極向き、高緯度→寒流が赤道向き
          v += sg * nearW * (sub * 1.2 * oe - pol * 0.9 * big);
          an += nearW * (sub * 4.5 * oe * smoothstep(10, 24, a) - pol * 4.5 * big);
          // 大洋の東岸: 低緯度→寒流が赤道向き、高緯度→暖流が極向き
          v += sg * nearE * (-sub * 1.1 * op + pol * 0.8 * big);
          an += nearE * (-sub * 6.5 * op + pol * 1.5 * big);
          // 偏西風に運ばれる暖流(北大西洋海流など)は大洋の東側ほど暖かい
          an += pol * 6 * Math.exp(-dE / 14) * (dW > 8 ? 1 : 0);
        }
        cu[i] = u; cv[i] = v; sstA0[i] = an;
        if (wide) warmW[i] = Math.exp(-dW / 4) * smoothstep(6, 14, a) * (1 - smoothstep(36, 44, a)) * 4.5 * (1 - smoothstep(0.45, 0.6, landL[i])) * smoothstep(10, 24, a);
      }
    }
    // 内海・縁海にも外洋の海流の影響を及ぼす(海セルだけで平均)
    const sea = land.map(v => 1 - v), sN = blur(sstA0, 2, 1), sD = blur(sea, 2, 1);
    const sstA = new Float32Array(N);
    for (let i = 0; i < N; i++) { sstA[i] = land[i] ? 0 : 0.5 * sstA0[i] + 0.5 * sN[i] / Math.max(sD[i], 0.05); ckind[i] = sstA[i] > 1.2 ? 1 : sstA[i] < -1.2 ? -1 : 0; }
    const bN = blur(sstA, 4, 1), bD = blur(sea, 4, 1), sstB = new Float32Array(N); // 広域の海水温偏差
    for (let i = 0; i < N; i++) sstB[i] = bN[i] / Math.max(bD[i], 0.3);
    const wcoast = blur(warmW, 3, 1); // 亜熱帯の暖流が流れる沿岸

    /* ---- 風と水蒸気の追跡(月別) ---- */
    const wu = [], wv = [], T = [], P = [], Praw = [];
    const Msrc = [], srcA = [], srcB = [], upA = [], landSteps = [], oro = [], phiS = [], mons = [];
    const cont = new Float32Array(N), upMean = new Float32Array(N), upMax = new Float32Array(N);
    const gx = new Float32Array(N), gy = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      gx[i] = (landL[idx(x + K, y)] - landL[idx(x - K, y)]) / 2;
      gy[i] = (landL[idx(x, Math.max(0, y - K))] - landL[idx(x, Math.min(H - 1, y + K))]) / 2; // 北向き正
    }
    const seasOf = m => Math.cos(2 * Math.PI * (m - 6.2) / 12); // 北半球の夏で +1

    for (let m = 0; m < 12; m++) {
      const seas = seasOf(m);
      const u = new Float32Array(N), v = new Float32Array(N), ph = new Float32Array(N), mo = new Float32Array(N);
      for (let y = 0; y < H; y++) {
        const la = latOf(y), a0 = Math.abs(la);
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          // 季節風: 夏は海→大陸、冬は大陸→海(大陸と海洋の比熱差)。大きな大陸ほど強い
          const tc = seas * (la >= 0 ? 1 : -1) * smoothstep(2, 10, a0) * (1 - smoothstep(40, 60, a0)) * (0.35 + 0.65 * smoothstep(0.2, 0.5, landXL[i]));
          let mx = gx[i] * 16 * tc, my = gy[i] * 16 * tc;
          const mm = Math.hypot(mx, my); if (mm > 1.1) { mx *= 1.1 / mm; my *= 1.1 / mm; }
          const ms = Math.min(mm, 1.1); mo[i] = ms * (tc >= 0 ? 1 : -1);
          // 気圧帯の季節移動: 太陽の回帰に伴い夏半球側へ。陸上ほど、また夏の季節風が強いほど大きく動く
          const p = la - seas * (4 + 8 * landL[i]) * (1 - 0.6 * smoothstep(40, 70, a0)) - (tc > 0 ? Math.sign(seas) * 5 * ms : 0); ph[i] = p;
          const a = Math.abs(p), s = p >= 0 ? 1 : -1;
          let uu, vv;
          if (a < 30) { const k = Math.sin(Math.PI * a / 30); uu = -0.9 * k - 0.1; vv = -s * 0.55 * k; } // 貿易風
          else if (a < 70) { const k = Math.sin(Math.PI * (a - 30) / 40); uu = 1.0 * k + 0.05; vv = s * 0.25 * k; } // 偏西風
          else { uu = -0.5; vv = -s * 0.25; } // 極偏東風
          const tk = tc > 0 && a < 30 ? 1 - 0.6 * ms / 1.1 : 1; // 夏の季節風が強い所では貿易風が弱まる
          u[i] = uu * tk + mx; v[i] = vv * tk + my;
        }
      }
      wu.push(u); wv.push(v); phiS.push(ph); mons.push(mo);

      // 風上へさかのぼり、水蒸気の供給源(海)までの距離と途中の山を調べる
      const Mm = new Float32Array(N), sA = new Float32Array(N), sB = new Float32Array(N), uA = new Float32Array(N), lS = new Float32Array(N), oo = new Float32Array(N);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!land[i]) { Mm[i] = 1; sA[i] = sstA[i]; sB[i] = sstB[i]; continue; }
        let fx = x, fy = y, steps = 0, maxE = 0, found = false, first = -1, srcF = 1, up8 = -1;
        for (let k = 0; k < 44 * K; k++) {
          const c = idx(Math.round(fx), clamp(Math.round(fy), 0, H - 1));
          let ux = u[c], vy = v[c]; const mg = Math.hypot(ux, vy);
          if (mg < 1e-3) { ux = -1; vy = 0; } else { ux /= mg; vy /= mg; }
          fx -= ux; fy += vy;
          if (fy < 0 || fy > H - 1) break;
          const c2 = idx(Math.round(fx), Math.round(fy));
          if (k === K - 1) first = c2;
          if (k === 8 * K - 1) { up8 = landL[c2]; uA[i] = sstB[c2]; }
          if (!found && !land[c2]) { found = true; sA[i] = sstA[c2]; sB[i] = sstB[c2]; srcF = clamp(1.7 * (1 - landS[c2]), 0.2, 1); }
          if (found) { if (k >= 8 * K - 1) break; continue; }
          steps++; if (elev[c2] > maxE) maxE = elev[c2];
        }
        steps /= K; // 2°セル単位
        const a = Math.abs(ph[i]), itcz = itczF(a);
        const Lm = 17 + 9 * itcz; // 熱帯収束帯では蒸発散による水の再循環で内陸まで湿る
        const md = found ? Math.exp(-steps / Lm) * srcF : 0.04;
        if (up8 < 0) up8 = landL[i]; upMean[i] += up8 / 12; if (up8 > upMax[i]) upMax[i] = up8;
        const hb = Math.max(maxE, elev[i] * 0.7);
        Mm[i] = md * Math.exp(-hb / 1500);
        lS[i] = found ? steps : 44;
        const slope = first >= 0 ? elev[i] - Math.max(0, elev[first]) : 0;
        oo[i] = slope > 0 ? Math.min(1.2, slope / 1200) * md * Math.exp(-maxE / 2200) * Math.min(1, Math.hypot(u[i], v[i])) : 0;
        cont[i] += (found ? 1 - Math.exp(-steps / 25) * Math.exp(-maxE / 1500) : 1) / 12;
      }
      Msrc.push(Mm); srcA.push(sA); srcB.push(sB); upA.push(uA); landSteps.push(lS); oro.push(oo);
    }
    // 隔海度(大陸性の度合い 0〜1)
    const contB = blur(cont, 1, 1);
    for (let i = 0; i < N; i++) {
      const a = Math.abs(latOf((i / W) | 0)), ice = 0.5 * smoothstep(62, 76, a); // 海氷に覆われる海は大陸的
      contB[i] = land[i] ? clamp(Math.max(0.7 * contB[i] + 0.3 * cont[i], 0.75 * clamp((0.5 * upMean[i] + 0.5 * upMax[i] - 0.3) / 0.5, 0, 1), ice), 0, 1) : Math.max(contB[i] * 0.5, ice);
    }

    /* ---- 気温・降水量 ---- */
    for (let m = 0; m < 12; m++) {
      const Tm = new Float32Array(N), Pm = new Float32Array(N), ph = phiS[m];
      for (let y = 0; y < H; y++) {
        const la = latOf(y), a0 = Math.abs(la), sinA = Math.sin(a0 * Math.PI / 180), sg = la >= 0 ? 1 : -1;
        const g = Math.pow(Math.min(1, sinA / 0.87), 1.75);
        const wn = (1 - seasOf(m) * sg) / 2; // 冬らしさ 0〜1
        for (let x = 0; x < W; x++) {
          const i = y * W + x, L = land[i], c = L ? Math.max(contB[i], 0.3 * smoothstep(45, 60, a0)) : contB[i];
          const seasT = Math.cos(2 * Math.PI * (m - 6.2 - 0.8 * (1 - c)) / 12) * sg; // 海洋性ほど季節が遅れる
          const amp = (3.5 + 24 * c) * g + 0.4; // 年較差の半分
          let t = tBase(a0) - 11 * c * smoothstep(52, 72, a0) + amp * seasT;
          if (L) { // 海流の影響(暖流の熱は偏西風などで内陸まで運ばれる) と 気温の逓減 0.65℃/100m
            const sa = srcA[m][i], near = sa * Math.exp(-landSteps[m][i] / (sa > 0 ? 12 : 3));
            const far = upA[m][i];
            t += (far > 0 && far > near ? far : near) - 6.5 * elev[i] / 1000;
          } else t += sstA[i];
          Tm[i] = t;
          // 降水: 上昇気流の起きやすさ(気圧帯) × 水蒸気量
          const a = Math.abs(ph[i]);
          const itcz = itczF(a), fc = 54 - 6 * wn, fw = 11 + 4 * wn;
          const front = (0.45 + 0.15 * wn) * Math.exp(-((a - fc) / fw) * ((a - fc) / fw));
          const sw = a < 27 ? 10 : 7 + 4 * landL[i];
          let sub = Math.exp(-((a - 27) / sw) * ((a - 27) / sw)); // 亜熱帯高圧帯の下降気流
          const wm = Math.hypot(wu[m][i], wv[m][i]), east = L ? 0.3 + 0.7 * clamp(-wu[m][i] / (wm + 1e-3) * 1.5, 0, 1) : 0.6; // 東寄りの風
          const sMax = Math.max(srcA[m][i], srcB[m][i]), wc = clamp(wcoast[i] / 1.2, 0, 1);
          const warmSrc = Math.max(clamp(sMax / 3, 0, 1), wc); // 暖流の上を通ってきた湿った空気
          sub *= 1 - 0.85 * Math.max(clamp((sMax + 1) / 3, 0, 1) * east, wc);
          const dry = 1 - 0.8 * sub;
          const on = clamp(mons[m][i], 0, 1), out = clamp(-mons[m][i], 0, 1) * smoothstep(0.25, 0.5, landXL[i]); // 夏/冬の季節風
          if (L) { t -= 7 * clamp(-mons[m][i], 0, 1) * g * Math.max(0, -seasT); Tm[i] = t; } // 冬の季節風は大陸の寒気を運ぶ
          const Uo = (itcz * (1 + 0.6 * on) + 0.05 + 0.3 * on + 0.15 * wc) * dry, Uf = front * dry;
          let M = Msrc[m][i];
          const bl = Math.exp(-elev[i] * 0.7 / 1500);
          if (L) {
            // 温帯低気圧は風向によらず近くの海から水蒸気を運ぶ / 熱帯は蒸発散で水が循環する / 暖流沿岸は一年中湿潤
            const iso = Math.exp(-coastD[i] / 9) * bl;
            M = Math.max(M, (0.5 + 0.3 * wn) * iso * clamp(front / 0.3, 0, 1) * (1 - 0.9 * out * (1 - 0.5 * wc)), 0.7 * Math.exp(-coastD[i] / 25) * bl * Math.exp(-Math.pow(Math.max(0, a - 5) / 11, 2)), 0.5 * iso * wc);
          }
          const fs = clamp(1 + 0.13 * srcA[m][i], 0.3, 1.25); // 寒流上の空気は安定して雨を降らせにくい
          const warm = clamp((t - 16) / 10, 0, 1);
          const cap = 330 * (0.2 + 0.8 * Math.pow(clamp((t + 15) / 42, 0, 1), 1.3));
          // 夏の大陸内部の対流性降雨(中緯度)
          const ct = L ? 0.3 * clamp((t - 8) / 10, 0, 1) * (1 - sub) * (1 - sub) * Math.max(0.5 * M, 0.9 * Math.exp(-elev[i] * 0.7 / 2200) * smoothstep(30, 42, a)) : 0;
          Pm[i] = Math.max(0, cap * (M * (fs * (Uo + 0.25 * warm * east * warmSrc) + Math.max(fs, 0.8) * Uf) + ct + 0.5 * oro[m][i]));
        }
      }
      T.push(Tm); Praw.push(Pm);
    }
    for (let m = 0; m < 12; m++) { // 月ごとの切り替わりをなめらかに
      const a = Praw[(m + 11) % 12], b = Praw[m], c = Praw[(m + 1) % 12], o = new Float32Array(N);
      for (let i = 0; i < N; i++) o[i] = 0.2 * a[i] + 0.6 * b[i] + 0.2 * c[i];
      P.push(o);
    }

    /* ---- 気候区分・植生 ---- */
    const kop = new Array(N), veg = new Array(N);
    const tAnn = new Float32Array(N), pAnn = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t = [], p = [];
      for (let m = 0; m < 12; m++) { t.push(T[m][i]); p.push(P[m][i]); }
      const lat = latOf((i / W) | 0);
      const k = koppen(t, p, lat, elev[i]);
      tAnn[i] = k.tAvg; pAnn[i] = k.R;
      kop[i] = land[i] ? k.code : null;
      veg[i] = land[i] ? vegetation(k) : null;
    }
    return { land, landL, coastD, cu, cv, sstA, ckind, wu, wv, phiS, T, P, cont: contB, kop, veg, tAnn, pAnn, Msrc, srcA, landSteps, oro, mons, wcoast, landXL };
  }

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

  function vegetation(k) {
    switch (k.code) {
      case 'Af': case 'Am': return 'rainforest';
      case 'Aw': return 'savanna';
      case 'BS': return 'steppe';
      case 'BW': return 'desert';
      case 'Cs': return 'sclerophyll';
      case 'Cw': return 'laurel';
      case 'Cfa': return k.R < k.r * 1.6 ? 'prairie' : (k.tMin >= 3 ? 'laurel' : 'deciduous');
      case 'Cfb': return 'deciduous';
      case 'Df': return k.R < k.r * 1.6 && k.tMax >= 20 ? 'prairie' : (k.tMax >= 20 ? 'deciduous' : 'taiga');
      case 'Dw': return k.tMax >= 22 ? 'deciduous' : 'taiga';
      case 'ET': return 'tundra';
      case 'EF': return 'ice';
      case 'H': return 'alpine';
    }
    return 'desert';
  }

  /* ---- 実在の地球: シミュレーション結果を観測・解析データで置き換える ---- */
  function applyObserved(sim, world, E) {
    const T = E.T, P = E.P, wu = E.wu, wv = E.wv, cu = E.cu, cv = E.cv, sa = E.sstA;
    for (let m = 0; m < 12; m++) for (let i = 0; i < N; i++) {
      sim.T[m][i] = T[m * N + i] / 10; sim.P[m][i] = P[m * N + i];
      sim.wu[m][i] = wu[m * N + i] / 60; sim.wv[m][i] = wv[m * N + i] / 60; // 6 m/s を矢印の基準長に
    }
    for (let i = 0; i < N; i++) {
      const lat = latOf((i / W) | 0), t = [], p = [];
      for (let m = 0; m < 12; m++) { t.push(sim.T[m][i]); p.push(sim.P[m][i]); }
      const k = koppen(t, p, lat, world.elev[i]);
      sim.tAnn[i] = k.tAvg; sim.pAnn[i] = k.R;
      sim.kop[i] = sim.land[i] ? k.code : null; sim.veg[i] = sim.land[i] ? vegetation(k) : null;
      sim.cu[i] = cu[i] / 200 / 0.12; sim.cv[i] = cv[i] / 200 / 0.12; sim.sstA[i] = sa[i] / 10;
      // 暖流=同緯度の海より暖かく高緯度へ向かう流れ、寒流=冷たく低緯度へ向かう流れ
      const pole = sim.cv[i] * (lat >= 0 ? 1 : -1), mg = Math.hypot(sim.cu[i], sim.cv[i]);
      sim.ckind[i] = sim.land[i] || Math.abs(lat) > 72 || mg < 0.2 ? 0 : (sa[i] > 12 && pole > 0.15 * mg) ? 1 : (sa[i] < -12 && pole < -0.15 * mg) ? -1 : 0;
    }
    sim.observed = true;
    return sim;
  }

  const API = { simulate, koppen, vegetation, applyObserved, HIGHLAND_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Climate = API;
})(typeof window !== 'undefined' ? window : globalThis);
