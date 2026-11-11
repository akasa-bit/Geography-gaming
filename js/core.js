/* 地形・プレートのデータモデルと生成処理
 * グリッド: 経度1°×緯度1°(360×180)。x は経度方向で東西がつながる。
 * 距離や半径の定数は「2°セル」を単位に書いてあり、K(=2°あたりのセル数)で実際のセル数に直す。 */
(function (root) {
  'use strict';
  const K = 2, DEG = 2 / K, W = 180 * K, H = 90 * K, N = W * H;
  const latOf = y => 90 - DEG / 2 - DEG * y;
  const lonOf = x => -180 + DEG / 2 + DEG * x;
  const idx = (x, y) => y * W + ((x % W) + W) % W;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  /* ---- 乱数・ノイズ ---- */
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s += 0x6D2B79F5; let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash3(x, y, z, seed) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(seed, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, z, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fx = x - xi, fy = y - yi, fz = z - zi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
    let v = 0;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      v += hash3(xi + dx, yi + dy, zi + dz, seed) * (dx ? sx : 1 - sx) * (dy ? sy : 1 - sy) * (dz ? sz : 1 - sz);
    }
    return v;
  }
  /* 円筒上のフラクタルノイズ(東西がつながる)。戻り値はおよそ 0〜1 */
  function fbm(x, y, freq, oct, seed) {
    const ang = (x / W) * Math.PI * 2, R = W / (2 * Math.PI);
    let px = Math.cos(ang) * R, pz = Math.sin(ang) * R, py = y;
    let amp = 1, sum = 0, tot = 0, f = freq / K;
    for (let o = 0; o < oct; o++) {
      sum += amp * vnoise(px * f + 31.7, py * f + 17.3, pz * f + 5.1, seed + o * 101);
      tot += amp; amp *= 0.5; f *= 2;
    }
    return sum / tot;
  }

  const PLATE_COLORS = ['#e4572e', '#3b8ea5', '#f0b429', '#7a9e3a', '#9b5de5', '#d6588f', '#4f6d7a', '#c2703d', '#2a9d8f', '#8d99ae', '#b5403a', '#5f7fd0', '#a8a23a', '#6b4c9a', '#3f8f6b', '#d98e4a'];

  function newWorld() {
    const w = { W, H, elev: new Float32Array(N), plate: new Uint8Array(N), oro: new Uint8Array(N), mantle: null, plates: [], name: '' }; // oro: 1=新期造山帯 2=古期造山帯
    w.elev.fill(-4000);
    w.plates = [mkPlate(0, 'プレートA', 90, 3)];
    return w;
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

  /* ---- 造山運動: プレート境界に応じて地形を変化させる ---- */
  function orogeny(w, seed) {
    const b = boundaries(w), e = w.elev;
    const up = new Float32Array(N), down = new Float32Array(N);
    // プレートごとの境界付近の平均標高(どちらが沈み込むかの判定用)
    const stamp = (cx, cy, R, fn) => {
      for (let dy = -R * K; dy <= R * K; dy++) {
        const y = cy + dy; if (y < 0 || y >= H) continue;
        for (let dx = -R * K; dx <= R * K; dx++) {
          const d = Math.hypot(dx, dy) / K; if (d > R) continue;
          fn(idx(cx + dx, y), d);
        }
      }
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, t = b.type[i]; if (!t || t === 3) continue;
      const me = w.plate[i], ot = b.other[i];
      const s = clamp(b.rate[i] / 6, 0.3, 1.5);
      // 相手側の隣接セルの標高
      let eo = -4000;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1], [0, 1]]) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        const j = idx(x + dx, yy); if (w.plate[j] === ot) eo = e[j];
      }
      const landMe = e[i] > -300, landOt = eo > -300;
      if (t === 1) {
        if (landMe && landOt) { // 大陸どうしの衝突 → 大山脈(ヒマラヤ型)
          stamp(x, y, 5, (j, d) => { if (w.plate[j] === me) up[j] = Math.max(up[j], 1000 * s * Math.exp(-d * d / 7)); });
        } else if (landMe && !landOt) { // 海洋プレートが沈み込む側の大陸縁 → 火山性の山脈(アンデス型)
          stamp(x, y, 4, (j, d) => { if (w.plate[j] === me) up[j] = Math.max(up[j], 750 * s * Math.exp(-(d - 1) * (d - 1) / 2.2)); });
        } else if (!landMe && landOt) { // 沈み込む海洋プレート → 海溝
          stamp(x, y, 1, (j, d) => { if (w.plate[j] === me) down[j] = Math.max(down[j], 1500 * s * (1 - d / 2)); });
        } else { // 海洋どうし: 番号の大きい方が沈み込み、他方に弧状列島
          if (me > ot) stamp(x, y, 1, (j, d) => { if (w.plate[j] === me) down[j] = Math.max(down[j], 1500 * s * (1 - d / 2)); });
          else stamp(x, y, 3, (j, d) => { if (w.plate[j] === me) up[j] = Math.max(up[j], 1900 * s * Math.exp(-(d - 2) * (d - 2) / 1.2)); });
        }
      } else if (t === 2) {
        if (landMe) { // 大陸の裂け目 → 地溝帯
          stamp(x, y, 2, (j, d) => { if (d < 1) down[j] = Math.max(down[j], 260 * s); else up[j] = Math.max(up[j], 90 * s); });
        } else { // 海嶺
          stamp(x, y, 2, (j, d) => { if (e[j] < -2600) up[j] = Math.max(up[j], 500 * s * Math.exp(-d * d / 2)); });
        }
      }
    }
    for (let i = 0; i < N; i++) {
      const x = i % W, y = (i / W) | 0;
      const n = 0.55 + 0.9 * fbm(x, y, 0.35, 2, seed);
      e[i] = clamp(e[i] + up[i] * n - down[i], -9000, 8500);
      if (up[i] > 250 && e[i] > 0 && b.type[i] !== 2) w.oro[i] = 1;
    }
    for (let k = 0; k < K; k++) smooth(w, 0.12, true);
  }

  function smooth(w, k, landOnly) {
    const e = w.elev, o = new Float32Array(e);
    for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (landOnly && o[i] <= 0) continue;
      const av = (o[idx(x + 1, y)] + o[idx(x - 1, y)] + o[i - W] + o[i + W]) / 4;
      const v = o[i] + (av - o[i]) * k;
      e[i] = landOnly ? Math.max(v, 1) : v;
    }
  }

  /* ---- マントル対流 ---- */
  // phi > 0: 上昇流(プルーム・海嶺の下), phi < 0: 下降流(沈み込み帯の下)。表層の流れは phi の高い所から低い所へ。
  function mantleField(seed, landBias) {
    let p = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) p[y * W + x] = fbm(x, y, 0.032, 2, seed) - (landBias ? landBias[y * W + x] : 0);
    for (let k = 0; k < 4 * K * K; k++) { // なめらかにして小さな渦を消す
      const o = Float32Array.from(p);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, u = y > 0 ? o[i - W] : o[i], d = y < H - 1 ? o[i + W] : o[i];
        p[i] = (o[i] * 2 + o[idx(x + 1, y)] + o[idx(x - 1, y)] + u + d) / 6;
      }
    }
    let mn = 1e9, mx = -1e9; for (let i = 0; i < N; i++) { if (p[i] < mn) mn = p[i]; if (p[i] > mx) mx = p[i]; }
    for (let i = 0; i < N; i++) p[i] = (p[i] - mn) / (mx - mn) * 2 - 1;
    return p;
  }
  function mantleFlow(phi, i) { // [東向き, 北向き]
    const x = i % W, y = (i / W) | 0;
    return [-(phi[idx(x + K, y)] - phi[idx(x - K, y)]) / 2, -(phi[idx(x, Math.max(0, y - K))] - phi[idx(x, Math.min(H - 1, y + K))]) / 2];
  }
  // プレートの配置から逆にマントルの流れを推定する(手描き・地球モデル用)
  function mantleFromPlates(w) {
    const b = boundaries(w), dD = distField(b.type.map(t => t === 2 ? 1 : 0)), dC = distField(b.type.map(t => t === 1 ? 1 : 0));
    const p = new Float32Array(N);
    for (let i = 0; i < N; i++) p[i] = Math.exp(-dD[i] / 7) - Math.exp(-dC[i] / 7);
    return p;
  }
  // マントル対流からプレートを決める: 同じ上昇流から湧き、同じ下降流へ向かう範囲が1枚のプレート
  function platesFromMantle(w, phi) {
    const climb = sign => {
      const to = new Int32Array(N);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x; let best = i, bv = phi[i] * sign;
        for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -1; dx <= 1; dx++) { const j = idx(x + dx, yy), v = phi[j] * sign; if (v > bv) { bv = v; best = j; } } }
        to[i] = best;
      }
      for (let i = 0; i < N; i++) { let r = i; while (to[r] !== r) r = to[r]; let c = i; while (to[c] !== r) { const n = to[c]; to[c] = r; c = n; } }
      return to;
    };
    const src = climb(1), snk = climb(-1), ids = new Map(), lab = new Int32Array(N);
    for (let i = 0; i < N; i++) { const k = src[i] * N + snk[i]; if (!ids.has(k)) ids.set(k, ids.size); lab[i] = ids.get(k); }
    // 小さすぎるプレートは、境界を最も長く接する隣のプレートに併合する
    for (;;) {
      const size = new Map(); for (let i = 0; i < N; i++) size.set(lab[i], (size.get(lab[i]) || 0) + 1);
      let small = -1, sv = 1e9; for (const [k, v] of size) if (v < sv) { sv = v; small = k; }
      if (size.size <= 1 || (size.size <= 9 && sv >= N * 0.03)) break;
      const adj = new Map();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x; if (lab[i] !== small) continue;
        for (const j of [idx(x + 1, y), idx(x - 1, y), y > 0 ? i - W : i, y < H - 1 ? i + W : i]) if (lab[j] !== small) adj.set(lab[j], (adj.get(lab[j]) || 0) + 1);
      }
      let to = -1, tv = -1; for (const [k, v] of adj) if (v > tv) { tv = v; to = k; }
      for (let i = 0; i < N; i++) if (lab[i] === small) lab[i] = to;
    }
    const order = [...new Set(lab)], vx = order.map(() => 0), vy = order.map(() => 0), cnt = order.map(() => 0);
    for (let i = 0; i < N; i++) { const p = order.indexOf(lab[i]); w.plate[i] = p; const f = mantleFlow(phi, i); vx[p] += f[0]; vy[p] += f[1]; cnt[p]++; }
    let vm = 1e-9; for (let p = 0; p < order.length; p++) { vx[p] /= cnt[p]; vy[p] /= cnt[p]; vm = Math.max(vm, Math.hypot(vx[p], vy[p])); }
    w.plates = order.map((_, p) => {
      const dir = (Math.round(Math.atan2(vx[p], vy[p]) * 180 / Math.PI / 45) * 45 + 360) % 360; // マントルに引きずられる向き
      const sp = [1, 2, 3, 5, 7, 9][Math.min(5, Math.floor(Math.hypot(vx[p], vy[p]) / vm * 6))];
      return mkPlate(p, 'プレート' + 'ABCDEFGHIJ'[p], dir, sp);
    });
    w.mantle = phi;
  }
  // いまの地形を残したまま、マントルとプレートだけ自動生成する(海嶺が大陸を避けるようにする)
  function autoPlates(w, seed) {
    const land = new Float32Array(N); for (let i = 0; i < N; i++) land[i] = w.elev[i] > 0 ? 0.16 : 0;
    for (let k = 0; k < 6 * K * K; k++) { const o = Float32Array.from(land); for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) { const i = y * W + x; land[i] = (o[i] + o[idx(x + 1, y)] + o[idx(x - 1, y)] + o[i - W] + o[i + W]) / 5; } }
    platesFromMantle(w, mantleField(seed, land));
  }

  /* ---- マントル対流から惑星をまるごと生成 ---- */
  function randomWorld(seed) {
    const w = newWorld(), r = rng(seed), e = w.elev;
    w.name = '自動生成の惑星 #' + seed;
    platesFromMantle(w, mantleField(seed));
    let b = boundaries(w);
    const dDiv = distField(b.type.map(t => t === 2 ? 1 : 0)), dCon = distField(b.type.map(t => t === 1 ? 1 : 0));
    // 大陸地殻: 広がる境界(新しい海洋底ができる所)を避ける。狭まる境界では大陸の縁になりやすい(沈み込み帯)
    const c = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, a = Math.abs(latOf(y));
      c[i] = fbm(x, y, 0.05, 4, seed + 77) - 0.22 * Math.exp(-dDiv[i] / 5) - 0.09 * Math.exp(-dCon[i] / 2.5) - (a > 68 ? (a - 68) * 0.006 : 0);
    }
    const thr = Float32Array.from(c).sort()[Math.floor(N * 0.69)];
    const land = new Uint8Array(N); for (let i = 0; i < N; i++) land[i] = c[i] > thr ? 1 : 0;
    const dLand = distField(land), dSea = distField(land.map(v => 1 - v));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, n = fbm(x, y, 0.2, 3, seed + 5);
      const m = c[i] - thr; // 海岸線からの余裕(連続値)。これで海岸線がなめらかになる
      if (land[i]) e[i] = Math.min(60 + Math.min(dSea[i], 7) * 40 + n * 260, 8 + m * 9000); // 安定陸塊: 楯状地・卓状地の低い平原や台地
      else { // 海洋底は海嶺から離れる(古くなる)ほど深い。大陸の縁には大陸棚
        const age = -2700 - 2500 * (1 - Math.exp(-dDiv[i] / 9)) - n * 500;
        const shelf = dLand[i] <= 1 ? -160 - n * 200 : dLand[i] <= 2 ? Math.max(age, -1800) : age;
        e[i] = Math.min(Math.max(shelf, -8 + m * 60000), -2);
      }
    }
    for (let k = 0; k < 2; k++) orogeny(w, seed + k); // 新期造山帯・海溝・弧状列島・海嶺・地溝帯
    // 古期造山帯: プレート境界から離れた大陸内部の、侵食されて低くなだらかな山地
    for (let k = 0, made = 0; k < 400 && made < 4; k++) {
      let x = Math.floor(r() * W), y = 6 * K + Math.floor(r() * (H - 12 * K)), ang = r() * Math.PI * 2;
      if (!land[y * W + x] || dCon[y * W + x] < 7 || dSea[y * W + x] < 2) continue;
      const h = 800 + r() * 700, len = (7 + Math.floor(r() * 8)) * K;
      for (let s = 0; s < len; s++) {
        for (let dy = -2 * K; dy <= 2 * K; dy++) for (let dx = -2 * K; dx <= 2 * K; dx++) {
          const yy = Math.round(y) + dy; if (yy < 0 || yy >= H) continue;
          const j = idx(Math.round(x) + dx, yy), add = h * Math.exp(-(dx * dx + dy * dy) / K / K / 1.3);
          if (e[j] > 0 && w.oro[j] !== 1 && e[j] < 150 + add * 1.2) { e[j] = Math.max(e[j], 150 + add * (0.7 + 0.5 * fbm(j % W, yy, 0.4, 2, seed + 9))); if (add > 350) w.oro[j] = 2; }
        }
        ang += (r() - 0.5) * 0.7 / K; x += Math.cos(ang); y += Math.sin(ang) * 0.8;
        if (y < 3 * K || y > H - 4 * K) break;
      }
      made++;
    }
    // ホットスポット: プレート内部の火山島列。プレートが動く向きに古い島(低い島・海山)が並ぶ
    for (let k = 0, made = 0; k < 300 && made < 3; k++) {
      const x = Math.floor(r() * W), y = 12 * K + Math.floor(r() * (H - 24 * K)), i = y * W + x, p = w.plates[w.plate[i]];
      if (e[i] > -3000 || dDiv[i] < 6 || dCon[i] < 6 || dLand[i] < 6 || p.speed < 2) continue;
      const a = p.dir * Math.PI / 180;
      for (let s = 0; s < 5; s++) {
        const j = idx(Math.round(x + Math.sin(a) * s * 2 * K), clamp(Math.round(y - Math.cos(a) * s * 2 * K), 0, H - 1));
        if (w.plate[j] !== w.plate[i]) break;
        e[j] = 1100 - s * 420; for (const q of [idx(j % W + 1, (j / W) | 0), idx(j % W - 1, (j / W) | 0)]) if (e[q] < -1500) e[q] = -1500;
      }
      made++;
    }
    return w;
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

  const API = { realEarthWorld, loadEarth, unpackEarth, b64bytes, K, DEG, W, H, N, latOf, lonOf, idx, clamp, rng, fbm, newWorld, mkPlate, distField, boundaries, orogeny, smooth, randomWorld, mantleField, mantleFlow, mantleFromPlates, platesFromMantle, autoPlates, PLATE_COLORS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Core = API;
})(typeof window !== 'undefined' ? window : globalThis);
