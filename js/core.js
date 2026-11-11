/* 地形・プレートのデータモデル(実在の地球)
 * グリッド: 経度1°×緯度1°(360×180)。x は経度方向で東西がつながる。
 * 距離や半径の定数は「2°セル」を単位に書いてあり、K(=2°あたりのセル数)で実際のセル数に直す。 */
(function (root) {
  'use strict';
  const K = 2, DEG = 2 / K, W = 180 * K, H = 90 * K, N = W * H;
  const latOf = y => 90 - DEG / 2 - DEG * y;
  const lonOf = x => -180 + DEG / 2 + DEG * x;
  const idx = (x, y) => y * W + ((x % W) + W) % W;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  const PLATE_COLORS = ['#e4572e', '#3b8ea5', '#f0b429', '#7a9e3a', '#9b5de5', '#d6588f', '#4f6d7a', '#c2703d', '#2a9d8f', '#8d99ae', '#b5403a', '#5f7fd0', '#a8a23a', '#6b4c9a', '#3f8f6b', '#d98e4a'];

  function newWorld() {
    return { W, H, elev: new Float32Array(N), plate: new Uint8Array(N), oro: new Uint8Array(N), mantle: null, plates: [], name: '' }; // oro: 1=新期造山帯 2=古期造山帯
  }
  function mkPlate(i, name, dir, speed) {
    return { name, color: PLATE_COLORS[i % PLATE_COLORS.length], dir, speed };
  }

  /* ---- 距離変換(海岸からの距離など) ---- */
  function distField(mask) { // mask[i] 真のセルからの距離(2°セル単位, 4近傍BFS)
    const d = new Float32Array(N).fill(9999); const q = new Int32Array(N); let qh = 0, qt = 0;
    for (let i = 0; i < N; i++) if (mask[i]) { d[i] = 0; q[qt++] = i; }
    while (qh < qt) {
      const i = q[qh++], x = i % W, y = (i / W) | 0, nd = d[i] + 1 / K;
      const nb = [idx(x + 1, y), idx(x - 1, y), y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const j of nb) if (j >= 0 && d[j] > nd + 1e-6) { d[j] = nd; q[qt++] = j; }
    }
    return d;
  }

  /* ---- プレート境界 ---- */
  // 戻り値: type[i] 0=なし 1=狭まる 2=広がる 3=ずれる, other[i]=相手プレート, rate[i]=収束/発散の強さ
  function boundaries(w) {
    const type = new Uint8Array(N), other = new Int16Array(N).fill(-1), rate = new Float32Array(N);
    const pvx = w.plates.map(p => p.speed * Math.sin(p.dir * Math.PI / 180));
    const pvy = w.plates.map(p => p.speed * Math.cos(p.dir * Math.PI / 180)); // 北向き正
    const cell = !!w.pvx; // 実データ: セルごとの速度(オイラー極まわりの回転)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, a = w.plate[i];
      let bj = -1;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1], [0, 1]]) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        const b = w.plate[idx(x + dx, yy)]; if (b !== a) { bj = b; break; }
      }
      if (bj < 0) continue;
      // 境界の向き: 周囲(±4°)にある相手プレートの重心方向を法線とする(階段状の境界をならす)
      let nx = 0, ny = 0;
      for (let dy = -2 * K; dy <= 2 * K; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -2 * K; dx <= 2 * K; dx++) if (w.plate[idx(x + dx, yy)] === bj) { nx += dx; ny -= dy; } }
      const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      let rx, ry;
      if (cell) { // 相手プレート側の最寄りセルの速度との差
        let j = -1, bd = 99;
        for (let dy = -2; dy <= 2; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -2; dx <= 2; dx++) { const q = idx(x + dx, yy), d = Math.abs(dx) + Math.abs(dy); if (w.plate[q] === bj && d < bd) { bd = d; j = q; } } }
        rx = w.pvx[i] - w.pvx[j]; ry = w.pvy[i] - w.pvy[j];
      } else { rx = pvx[a] - pvx[bj]; ry = pvy[a] - pvy[bj]; }
      const closing = rx * nx + ry * ny, shear = Math.abs(rx * ny - ry * nx);
      const t = Math.abs(closing) < Math.max(0.8, 0.45 * shear) ? 3 : closing > 0 ? 1 : 2;
      type[i] = t; other[i] = bj; rate[i] = Math.abs(closing);
    }
    return { type, other, rate };
  }

  /* ---- マントルの流れ(プレート境界からの推定) ---- */
  // phi > 0: 上昇流(海嶺の下), phi < 0: 下降流(沈み込み帯の下)。表層の流れは phi の高い所から低い所へ。
  function mantleFlow(phi, i) { // [東向き, 北向き]
    const x = i % W, y = (i / W) | 0;
    return [-(phi[idx(x + K, y)] - phi[idx(x - K, y)]) / 2, -(phi[idx(x, Math.max(0, y - K))] - phi[idx(x, Math.min(H - 1, y + K))]) / 2];
  }
  // プレートの配置からマントルの流れを推定する
  function mantleFromPlates(w) {
    const b = boundaries(w), dD = distField(b.type.map(t => t === 2 ? 1 : 0)), dC = distField(b.type.map(t => t === 1 ? 1 : 0));
    const p = new Float32Array(N);
    for (let i = 0; i < N; i++) p[i] = Math.exp(-dD[i] / 7) - Math.exp(-dC[i] / 7);
    return p;
  }
  /* ---- 地球の主な山脈(大地形の区分用) ---- */
  // [経路(経度,緯度), 高さm, 幅(2°セル単位)]
  const EARTH_MTS = [
    [[[-135, 60], [-120, 50], [-112, 42], [-106, 35]], 2300, 2.6], [[[-121, 46], [-118, 37]], 1500, 0.8], [[[-106, 30], [-100, 20], [-88, 14]], 2000, 1.5],
    [[[-84, 34], [-74, 42]], 800, 1], [[[-75, 8], [-78, -2], [-76, -10], [-69, -17], [-69, -28], [-71, -40], [-72, -50]], 4200, 1.3],
    [[[-48, -12], [-44, -20]], 800, 3], [[[-64, 4], [-58, 3]], 800, 1.5], [[[6, 45], [14, 47]], 2400, 1], [[[7, 60], [16, 68]], 1300, 1], [[[59, 52], [60, 66]], 800, 1],
    [[[40, 43], [47, 42]], 2600, 0.8], [[[30, 39], [44, 38], [52, 33], [62, 30]], 1700, 2.2], [[[73, 35], [80, 31], [88, 28], [96, 28]], 5500, 1.3],
    [[[80, 34], [98, 34]], 4600, 3.2], [[[70, 41], [88, 43]], 3400, 1.2], [[[66, 35], [74, 38]], 4000, 1.2], [[[86, 50], [98, 46]], 2400, 1.2],
    [[[95, 47], [112, 45]], 1300, 3], [[[125, 58], [140, 63], [160, 66]], 1100, 1.6], [[[74, 18], [77, 10]], 1100, 0.8], [[[98, 25], [100, 18]], 1500, 1],
    [[[133, 35], [138, 36], [141, 40]], 700, 0.7], [[[-7, 31], [8, 36]], 2000, 1], [[[36, 13], [40, 7]], 2400, 2], [[[31, 1], [36, -3], [34, -12]], 1300, 3],
    [[[20, -22], [28, -28]], 1200, 4], [[[146, -20], [151, -28], [148, -36]], 900, 1], [[[168, -45], [172, -42]], 2200, 0.6], [[[135, -4], [146, -6]], 3400, 0.8],
    [[[40, 25], [44, 15]], 1700, 1.2], [[[-45, 62], [-40, 78]], 2300, 4], [[[-170, -84], [-60, -82], [0, -80], [90, -78], [170, -82]], 2800, 6]
  ];
  const EARTH_NEW = [0, 1, 2, 4, 7, 10, 11, 12, 13, 15, 20, 21, 22, 27, 28], EARTH_OLD = [3, 8, 9, 14, 16, 26]; // EARTH_MTS の番号
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }
  /* ---- 地球(実データ) ---- */
  function b64bytes(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  // data/earth.js(gzip圧縮)を展開して型付き配列にする。ブラウザでは Promise、Node では同期で使える unpackEarth を使う
  function unpackEarth(D, raw) {
    const E = { plates: D.plates }, T = { i1: Int8Array, u1: Uint8Array, i2: Int16Array, u2: Uint16Array };
    let off = 0;
    for (const [name, dt, len] of D.layout) { const bytes = len * T[dt].BYTES_PER_ELEMENT; E[name] = new T[dt](raw.buffer.slice(raw.byteOffset + off, raw.byteOffset + off + bytes)); off += bytes; }
    return E;
  }
  function loadEarth(D) {
    if (!D || D.W !== W || typeof DecompressionStream === 'undefined') return Promise.reject(new Error('earth data unavailable'));
    const st = new Blob([b64bytes(D.gz)]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(st).arrayBuffer().then(buf => unpackEarth(D, new Uint8Array(buf)));
  }
  function realEarthWorld(E) {
    const w = newWorld(); w.name = '地球(実データ)'; w.real = true;
    for (let i = 0; i < N; i++) w.elev[i] = E.elev[i];
    w.plate.set(E.plate);
    w.plates = E.plates.map((p, i) => mkPlate(i, p.name, p.dir, p.speed));
    w.pvx = new Float32Array(N); w.pvy = new Float32Array(N);
    for (let i = 0; i < N; i++) { w.pvx[i] = E.pvx[i] / 10; w.pvy[i] = E.pvy[i] / 10; }
    // 大地形の区分は教科書的な造山帯の位置を手で指定したもの(データセットではない)
    const dc = distField(boundaries(w).type.map(t => t === 1 ? 1 : 0));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (w.elev[i] <= 0) continue;
      const lo = lonOf(x), la = latOf(y); let best = 9, mk = -1;
      EARTH_MTS.forEach(([path, h, wd], mi) => { for (let k = 0; k < path.length - 1; k++) { const d = segDist(lo, la, path[k][0], path[k][1], path[k + 1][0], path[k + 1][1]) / 2 / (wd * 0.62 + 0.6); if (d < best) { best = d; mk = mi; } } });
      if (best < 1.1 && EARTH_NEW.includes(mk) && w.elev[i] > 400) w.oro[i] = 1;
      else if (best < 1.1 && EARTH_OLD.includes(mk) && w.elev[i] > 250) w.oro[i] = 2;
      else if (dc[i] <= 1 && w.elev[i] > 300 && Math.abs(la) < 62) w.oro[i] = 1;
    }
    return w;
  }

  const API = { W, H, N, K, DEG, latOf, lonOf, idx, clamp, newWorld, mkPlate, distField, boundaries, mantleFlow, mantleFromPlates, realEarthWorld, loadEarth, unpackEarth, b64bytes, PLATE_COLORS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Core = API;
})(typeof window !== 'undefined' ? window : globalThis);
