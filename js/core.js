/* 地形・プレートのデータモデルと生成処理
 * グリッド: 経度2°×緯度2°(180×90)。x は経度方向で東西がつながる。 */
(function (root) {
  'use strict';
  const W = 180, H = 90, N = W * H;
  const latOf = y => 89 - 2 * y;
  const lonOf = x => -179 + 2 * x;
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
    let amp = 1, sum = 0, tot = 0, f = freq;
    for (let o = 0; o < oct; o++) {
      sum += amp * vnoise(px * f + 31.7, py * f + 17.3, pz * f + 5.1, seed + o * 101);
      tot += amp; amp *= 0.5; f *= 2;
    }
    return sum / tot;
  }

  const PLATE_COLORS = ['#e4572e', '#3b8ea5', '#f0b429', '#7a9e3a', '#9b5de5', '#d6588f', '#4f6d7a', '#c2703d', '#2a9d8f', '#8d99ae'];

  function newWorld() {
    const w = { W, H, elev: new Float32Array(N), plate: new Uint8Array(N), plates: [], name: '' };
    w.elev.fill(-4000);
    w.plates = [mkPlate(0, 'プレートA', 90, 3)];
    return w;
  }
  function mkPlate(i, name, dir, speed) {
    return { name, color: PLATE_COLORS[i % PLATE_COLORS.length], dir, speed };
  }

  /* ---- 距離変換(海岸からの距離など) ---- */
  function distField(mask) { // mask[i] 真のセルからの距離(セル数, 4近傍BFS)
    const d = new Int16Array(N).fill(9999); const q = new Int32Array(N); let qh = 0, qt = 0;
    for (let i = 0; i < N; i++) if (mask[i]) { d[i] = 0; q[qt++] = i; }
    while (qh < qt) {
      const i = q[qh++], x = i % W, y = (i / W) | 0, nd = d[i] + 1;
      const nb = [idx(x + 1, y), idx(x - 1, y), y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const j of nb) if (j >= 0 && d[j] > nd) { d[j] = nd; q[qt++] = j; }
    }
    return d;
  }

  /* ---- プレート境界 ---- */
  // 戻り値: type[i] 0=なし 1=狭まる 2=広がる 3=ずれる, other[i]=相手プレート, rate[i]=収束/発散の強さ
  function boundaries(w) {
    const type = new Uint8Array(N), other = new Int16Array(N).fill(-1), rate = new Float32Array(N);
    const vx = w.plates.map(p => p.speed * Math.sin(p.dir * Math.PI / 180));
    const vy = w.plates.map(p => p.speed * Math.cos(p.dir * Math.PI / 180)); // 北向き正
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, a = w.plate[i];
      let bj = -1;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1], [0, 1]]) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        const b = w.plate[idx(x + dx, yy)]; if (b !== a) { bj = b; break; }
      }
      if (bj < 0) continue;
      // 境界の向き: 周囲5×5セルにある相手プレートの重心方向を法線とする(階段状の境界をならす)
      let nx = 0, ny = 0;
      for (let dy = -2; dy <= 2; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -2; dx <= 2; dx++) if (w.plate[idx(x + dx, yy)] === bj) { nx += dx; ny -= dy; } }
      const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      const rx = vx[a] - vx[bj], ry = vy[a] - vy[bj];
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
      for (let dy = -R; dy <= R; dy++) {
        const y = cy + dy; if (y < 0 || y >= H) continue;
        for (let dx = -R; dx <= R; dx++) {
          const d = Math.hypot(dx, dy); if (d > R) continue;
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
          else stamp(x, y, 3, (j, d) => { if (w.plate[j] === me) up[j] = Math.max(up[j], 1500 * s * Math.exp(-(d - 2) * (d - 2) / 1.2)); });
        }
      } else if (t === 2) {
        if (landMe) { // 大陸の裂け目 → 地溝帯
          stamp(x, y, 2, (j, d) => { if (d < 1) down[j] = Math.max(down[j], 260 * s); else up[j] = Math.max(up[j], 90 * s); });
        } else { // 海嶺
          stamp(x, y, 2, (j, d) => { if (e[j] < -2000) up[j] = Math.max(up[j], 500 * s * Math.exp(-d * d / 2)); });
        }
      }
    }
    for (let i = 0; i < N; i++) {
      const x = i % W, y = (i / W) | 0;
      const n = 0.55 + 0.9 * fbm(x, y, 0.35, 2, seed);
      e[i] = clamp(e[i] + up[i] * n - down[i], -9000, 8500);
    }
    smooth(w, 0.12, true);
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

  /* ---- ランダムな世界 ---- */
  function randomWorld(seed) {
    const w = newWorld(), r = rng(seed);
    w.name = 'ランダム惑星 #' + seed;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const a = Math.abs(latOf(y));
      let f = fbm(x, y, 0.045, 5, seed) - 0.55 - (a > 62 ? (a - 62) * 0.004 : 0);
      w.elev[y * W + x] = f > 0 ? 80 + f * 3200 : Math.max(-5500, -300 + f * 26000);
    }
    // ボロノイ分割でプレートを作る
    const np = 7, seeds = [];
    w.plates = [];
    for (let p = 0; p < np; p++) {
      seeds.push([r() * W, 8 + r() * (H - 16)]);
      w.plates.push(mkPlate(p, 'プレート' + 'ABCDEFGHIJ'[p], Math.round(r() * 8) * 45 % 360, 2 + Math.round(r() * 7)));
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let best = 1e9, bp = 0;
      const jx = (fbm(x, y, 0.1, 3, seed + 7) - 0.5) * 22, jy = (fbm(x, y, 0.1, 3, seed + 13) - 0.5) * 22;
      for (let p = 0; p < np; p++) {
        let dx = Math.abs(x + jx - seeds[p][0]); dx = Math.min(dx, W - dx);
        const d = Math.hypot(dx, y + jy - seeds[p][1]);
        if (d < best) { best = d; bp = p; }
      }
      w.plate[y * W + x] = bp;
    }
    for (let k = 0; k < 2; k++) orogeny(w, seed + k);
    return w;
  }

  /* ---- 地球(簡略モデル) ---- */
  const EARTH_LAND = [
    [[-168, 66], [-156, 71], [-125, 70], [-95, 69], [-82, 67], [-78, 62], [-65, 60], [-56, 52], [-66, 45], [-70, 42], [-76, 35], [-81, 31], [-80, 25], [-82, 29], [-90, 30], [-97, 27], [-97, 20], [-91, 18], [-87, 21], [-87, 16], [-83, 10], [-78, 8], [-80, 7], [-86, 12], [-95, 16], [-105, 20], [-110, 24], [-113, 30], [-117, 33], [-124, 40], [-124, 48], [-135, 58], [-150, 60], [-158, 57], [-165, 60]],
    [[-55, 60], [-44, 60], [-22, 70], [-20, 80], [-40, 83], [-60, 81], [-70, 77], [-55, 70]],
    [[-78, 8], [-72, 12], [-62, 10], [-52, 5], [-50, 0], [-35, -6], [-39, -15], [-41, -22], [-48, -26], [-53, -34], [-58, -38], [-65, -42], [-66, -48], [-69, -53], [-74, -52], [-73, -40], [-71, -30], [-70, -18], [-76, -14], [-81, -5], [-80, 0], [-77, 4]],
    [[-17, 15], [-16, 22], [-10, 29], [-6, 35], [10, 37], [11, 33], [20, 31], [32, 31], [35, 25], [38, 18], [43, 12], [51, 11], [48, 4], [40, -3], [39, -10], [40, -16], [35, -24], [32, -29], [26, -34], [19, -34], [15, -27], [12, -17], [13, -8], [9, -1], [9, 4], [4, 6], [-8, 4], [-13, 8]],
    [[44, -16], [49, -12], [50, -17], [47, -25], [44, -23]],
    [[-9, 37], [-9, 43], [-1, 44], [-4, 48], [2, 51], [5, 53], [9, 54], [8, 57], [6, 58], [5, 62], [12, 66], [18, 70], [28, 71], [40, 67], [44, 68], [60, 69], [68, 72], [80, 73], [100, 77], [112, 74], [130, 72], [150, 71], [170, 70], [180, 68], [180, 65], [178, 62], [170, 60], [163, 58], [162, 55], [156, 51], [156, 57], [160, 61], [155, 59], [143, 59], [135, 54], [140, 52], [138, 46], [132, 43], [128, 40], [129, 35], [126, 34], [126, 38], [122, 40], [118, 39], [122, 37], [119, 35], [122, 31], [120, 26], [114, 22], [108, 21], [106, 18], [109, 13], [105, 9], [100, 13], [99, 8], [103, 1.5], [101, 3], [98, 8], [98, 16], [94, 17], [92, 22], [87, 21], [80, 15], [80, 10], [77, 8], [73, 18], [72, 21], [67, 24], [62, 25], [57, 26], [56, 27], [51, 28], [48, 30], [51, 25], [56, 24], [59, 22], [55, 17], [45, 13], [43, 13], [39, 21], [35, 28], [35, 31], [36, 36], [28, 36], [26, 40], [29, 41], [40, 41], [41, 43], [37, 45], [33, 45], [30, 46], [28, 42], [24, 40], [23, 37], [21, 38], [19, 42], [14, 45], [12, 44], [18, 40], [16, 38], [12, 42], [9, 44], [3, 43], [0, 39], [-2, 37], [-5, 36]],
    [[-180, 68], [-170, 66], [-173, 64], [-180, 63]],
    [[-5, 50], [1, 51], [0, 54], [-3, 58], [-6, 57], [-3, 54], [-5, 52]], [[-10, 52], [-6, 52], [-6, 55], [-9, 54]], [[-24, 64], [-14, 64], [-14, 66], [-22, 66]],
    [[130, 31], [132, 34], [136, 34], [140, 35], [142, 39], [141, 41], [140, 40], [137, 37], [133, 35], [130, 33]], [[140, 42], [145, 43], [142, 45], [140, 43]],
    [[120, 14], [122, 18], [124, 13], [126, 7], [122, 7], [121, 11]], [[109, 1], [113, -3], [116, -4], [118, 1], [117, 6], [114, 5]],
    [[95, 5], [98, 4], [104, -2], [106, -6], [102, -4], [97, 1]], [[105, -6], [115, -6.5], [115, -8.5], [105, -8]], [[119, -5], [120, 1], [124, 1], [122, -4]],
    [[131, -1], [138, -2], [146, -6], [150, -10], [143, -9], [138, -8], [133, -4]], [[79, 6], [81, 9.5], [82.5, 7]],
    [[114, -22], [122, -18], [129, -15], [131, -12], [136, -12], [136, -16], [140, -17], [142, -11], [146, -19], [153, -25], [153, -31], [150, -37], [146, -39], [140, -38], [135, -35], [129, -32], [123, -34], [115, -34]],
    [[145, -41], [148.5, -41], [147, -43.5]], [[173, -35], [178, -38], [175, -41], [173, -39]], [[172, -41], [174, -42], [170, -46], [167, -46]],
    [[-180, -90], [-180, -78], [-150, -77], [-100, -73], [-75, -72], [-62, -64], [-58, -64], [-60, -74], [-30, -77], [-10, -70], [30, -69], [60, -67], [90, -66], [120, -66], [150, -68], [170, -72], [180, -78], [180, -90]],
    [[-84, 22], [-75, 20], [-74, 21], [-80, 23.5]], [[-74, 18], [-68, 18], [-70, 20]]
  ];
  const EARTH_WATER = [
    [[-94, 60], [-85, 64], [-78, 60], [-80, 52], [-88, 56]], [[47, 45], [53, 46], [54, 38], [49, 37]],
    [[11, 55], [20, 55], [23, 59], [29, 60], [22, 60], [21, 64], [24, 65], [18, 62], [17, 58], [13, 56]]
  ];
  // [経路, 高さm, 幅(セル)]
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
  function inPoly(px, py, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }
  function earthWorld() {
    const w = newWorld(); w.name = '地球(簡略モデル)';
    const land = new Uint8Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const lo = lonOf(x), la = latOf(y);
      let L = false;
      for (const p of EARTH_LAND) if (inPoly(lo, la, p)) { L = true; break; }
      if (L) for (const p of EARTH_WATER) if (inPoly(lo, la, p)) { L = false; break; }
      land[y * W + x] = L ? 1 : 0;
    }
    const dLand = distField(land), sea = land.map(v => 1 - v), dSea = distField(sea);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, lo = lonOf(x), la = latOf(y), n = fbm(x, y, 0.2, 3, 42);
      if (!land[i]) { w.elev[i] = -150 - Math.min(dLand[i], 6) / 6 * 3900 - n * 600; continue; }
      let e = 40 + Math.min(dSea[i], 6) * 35 + n * 160, m = 0;
      for (const [path, h, wd] of EARTH_MTS) for (let k = 0; k < path.length - 1; k++) {
        const d = segDist(lo, la, path[k][0], path[k][1], path[k + 1][0], path[k + 1][1]) / 2 / 0.62;
        m = Math.max(m, h * Math.exp(-(d / wd) * (d / wd)));
      }
      w.elev[i] = e + m * (0.8 + 0.4 * n);
    }
    // プレート(簡略)
    const P = [['太平洋プレート', 315, 9], ['北アメリカプレート', 270, 2], ['ユーラシアプレート', 90, 1], ['アフリカプレート', 45, 2], ['南アメリカプレート', 270, 3],
      ['インド・オーストラリアプレート', 0, 7], ['南極プレート', 0, 0], ['ナスカプレート', 90, 7], ['フィリピン海プレート', 315, 7]];
    w.plates = P.map((p, i) => mkPlate(i, p[0], p[1], p[2]));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const lo = lonOf(x), la = latOf(y);
      const ridge = la > 15 ? -32 - (la > 50 ? 0 : (50 - la) * 0.35) : -14 - Math.max(0, la + 5) * 0.9; // 大西洋中央海嶺の経度
      let p;
      if (la < -58 || (la < -48 && (lo < -75 || lo > 150 || (lo > -20 && lo < 60)))) p = 6;
      else if (lo >= 124 && lo < 146 && la > 4 && la < 34 && !(lo < 132 && la > 30)) p = 8;
      else if (lo >= -112 && lo < -71 && la < 4 && la > -46 && lo < -70 - (la < -18 ? 2 : la > -6 ? 9 : 5)) p = 7;
      else if (lo >= 146 || lo < -168 || (lo < -110 && la < 22) || (lo < -125 && la < 56) || (lo < -116 && la < 32)) p = (lo >= 146 && lo < 166 && la < -8 && la > -48) ? 5 : (lo >= 146 && la > 50 && lo < 164) ? 1 : 0;
      else if (lo < ridge) p = la > 14 ? 1 : 4;
      else if (lo >= 60 && la < (lo < 98 ? 27 : lo < 122 ? -8 : -2)) p = 5;
      else if (la > 36 || lo > 58 || (lo > 34 && la > 38)) p = 2;
      else p = 3;
      w.plate[y * W + x] = p;
    }
    return w;
  }

  const API = { W, H, N, latOf, lonOf, idx, clamp, rng, fbm, newWorld, mkPlate, distField, boundaries, orogeny, smooth, randomWorld, earthWorld, PLATE_COLORS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Core = API;
})(typeof window !== 'undefined' ? window : globalThis);
