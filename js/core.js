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
    return { W, H, elev: new Float32Array(N), plate: new Uint8Array(N), oro: new Uint8Array(N), plates: [], name: '' }; // oro: 1=新期造山帯 2=古期造山帯
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

  /* ---- 地球(実データ) ---- */
  function b64bytes(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  // data/earth.js(gzip圧縮)を展開して型付き配列にする。ブラウザでは Promise、Node では同期で使える unpackEarth を使う
  function unpackEarth(D, raw) {
    const E = { plates: D.plates, cropNames: D.crops, stockNames: D.stock, whitNames: D.whit }, T = { i1: Int8Array, u1: Uint8Array, i2: Int16Array, u2: Uint16Array };
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
    // 大地形: Hasterok et al. (2022) の最後の造山運動による区分。狭まるプレート境界から1°以内の陸地は新期造山帯とする
    w.oro.set(E.oro);
    const dc = distField(boundaries(w).type.map(t => t === 1 ? 1 : 0));
    for (let i = 0; i < N; i++) if (w.elev[i] > 0 && dc[i] <= 0.5 && Math.abs(latOf((i / W) | 0)) < 62) w.oro[i] = 1;
    return w;
  }

  const API = { W, H, N, K, DEG, latOf, lonOf, idx, clamp, newWorld, mkPlate, distField, boundaries, realEarthWorld, loadEarth, unpackEarth, b64bytes, PLATE_COLORS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Core = API;
})(typeof window !== 'undefined' ? window : globalThis);
