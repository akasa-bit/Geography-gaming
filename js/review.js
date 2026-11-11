/* クイズの解答記録と傾向分析(記録はこのブラウザの localStorage に保存) */
(function (root) {
  'use strict';
  const G = root.Geo, KEY = 'geo-quiz-log-v2', BLOCK = 50, MAX = 2000;
  const ITEMS = [['elev', '標高'], ['kop', '気候区分'], ['veg', '植生'], ['agri', '農業形態'], ['land', '耕地の広がり'], ['crops', '作物・家畜']];
  let log = null;
  function all() {
    if (!log) { try { log = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { log = []; } if (!Array.isArray(log)) log = []; }
    return log;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(log)); } catch (e) { /* 保存できなくても続行 */ } }
  function add(entry) { all().push(entry); if (log.length > MAX) log.splice(0, log.length - MAX); save(); return log.length; }
  function reset() { log = []; save(); }

  /* ---- 誤りの分類 ---- */
  const isB = c => c === 'BS' || c === 'BW';
  function errType(c, a) { // c=正解, a=回答
    if (c === 'H' || a === 'H') return 'H';
    if (isB(c) && isB(a)) return 'half';
    if (isB(c) !== isB(a)) return 'dry';
    if (c[0] !== a[0]) return 'temp';
    if (c[0] === 'A') return 'a60';
    if (c[0] === 'E') return 'e0';
    if ((c === 'Cfa' && a === 'Cfb') || (c === 'Cfb' && a === 'Cfa')) return 't22';
    return 'season';
  }
  const ERR = {
    dry: ['乾燥帯かどうか(乾燥限界)の判定', '最初に乾燥限界を計算する習慣をつける。年平均気温 t と降水型(夏雨型 x=14・年中 x=7・冬雨型 x=0)から r=20(t+x) を出し、年降水量と比べてから A・C・D に進む。'],
    half: ['砂漠(BW)とステップ(BS)の境目', 'r だけでなく r/2 も必ず計算する。年降水量が r/2 未満なら BW、r/2 以上 r 未満なら BS。気温が低い地点は r が小さいので、少ない雨でも BS になる。'],
    temp: ['気温の境界(18℃・-3℃・10℃)の読み', '最寒月と最暖月を先に数値で読む。最寒月18℃以上=A、-3℃以上18℃未満=C、-3℃未満=D、最暖月10℃未満=E。雨温図に18℃・-3℃・10℃の線を引くつもりで見る。'],
    a60: ['熱帯の乾季の判定(最少雨月60mm)', '最少雨月が60mm以上なら Af。60mm未満のとき、年降水量が多く 100−R/25 以上なら Am、それ未満なら Aw。乾季の棒の高さを数値で確認する。'],
    e0: ['寒帯の区分(最暖月0℃)', '最暖月が0℃以上10℃未満なら ET、0℃未満なら EF。'],
    t22: ['最暖月22℃(Cfa と Cfb)', '年中湿潤な温帯は最暖月22℃で分ける。22℃以上=Cfa(大陸東岸・年較差大)、22℃未満=Cfb(大陸西岸・年較差小)。'],
    season: ['降水の季節配分(s・w・f)', '夏と冬のどちらが乾くかを確認する。s: 夏の最少雨月が30mm未満で、冬の最多雨月の1/3以下。w: 夏の最多雨月が冬の最少雨月の10倍以上。どちらでもなければ f。南半球は夏が10〜3月。'],
    H: ['高山気候(標高)の扱い', '標高の数値を最初に見る。2000m以上なら高山気候(H)。低緯度の高地は、気温が低めなのに年較差が小さい「常春」型のグラフになる。']
  };

  /* ---- 集計 ---- */
  function analyze(es) {
    const A = { n: es.length, avg: 0, item: {}, itemN: {}, type: { graph: [0, 0], map: [0, 0] }, byCode: {}, conf: {}, err: {}, hemi: { N: [0, 0], S: [0, 0] }, loc: { on: [0, 0], off: [0, 0] }, weak: {} };
    for (const [k] of ITEMS) { A.item[k] = 0; A.itemN[k] = 0; A.weak[k] = {}; }
    for (const e of es) {
      A.avg += e.total / es.length;
      const ty = A.type[e.type === 'map' ? 'map' : 'graph']; ty[0]++; ty[1] += e.total;
      for (const [k] of ITEMS) {
        if (e.r[k] === undefined) continue; // その形式にない項目
        A.item[k] += e.r[k]; A.itemN[k]++;
        const w = A.weak[k][e.code] = A.weak[k][e.code] || { n: 0, s: 0, wrong: {}, right: {} }; w.n++; w.s += e.r[k];
        if (k !== 'kop' && e.c && e.c[k]) w.right[e.c[k]] = (w.right[e.c[k]] || 0) + 1;
        if (k !== 'kop') {
          const picks = Array.isArray(e.a[k]) ? e.a[k] : (e.a[k] != null ? [e.a[k]] : []);
          if (!picks.length) w.wrong['(未回答)'] = (w.wrong['(未回答)'] || 0) + 1;
          else if (e.r[k] < 1) for (const p of picks) if (!(e.ok && e.ok[k] && e.ok[k].includes(p))) w.wrong[p] = (w.wrong[p] || 0) + 1;
        }
      }
      const b = A.byCode[e.code] = A.byCode[e.code] || { n: 0, ok: 0 }, hit = e.r.kop === 1; b.n++; if (hit) b.ok++;
      const h = A.hemi[e.lat >= 0 ? 'N' : 'S']; h[0]++; if (hit) h[1]++;
      const l = A.loc[e.loc ? 'on' : 'off']; l[0]++; if (hit) l[1]++;
      if (!hit && e.a.kop) {
        const key = e.code + '>' + e.a.kop; A.conf[key] = (A.conf[key] || 0) + 1;
        const t = errType(e.code, e.a.kop); A.err[t] = (A.err[t] || 0) + 1;
      }
    }
    for (const [k] of ITEMS) if (A.itemN[k]) A.item[k] /= A.itemN[k];
    return A;
  }

  /* ---- 表示 ---- */
  const pct = v => Math.round(v * 100);
  const bar = (v, cls) => `<span class="rbar"><i class="${cls || ''}" style="width:${Math.max(2, pct(v))}%"></i></span>`;
  const nameOf = (k, key) => key === '(未回答)' ? key : k === 'elev' ? G.ELEV[key] : k === 'veg' ? G.VEG[key].name : k === 'agri' ? (G.FARM[key] ? G.FARM[key].name : G.AGRI[key] ? G.AGRI[key].name : String(key)) : k === 'land' ? G.LAND[key] : key === 'none' ? '該当なし' : G.CROPS[key] || G.STOCK[key];
  const topOf = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n, c]) => `${n}(${c}問)`).join(' / ');
  function report(es, prev, title) {
    if (!es.length) return '<p class="note">まだ記録がありません。クイズを解くと、ここに間違いの記録と傾向が出ます。</p>';
    const A = analyze(es), P = prev && prev.length ? analyze(prev) : null;
    const diff = (a, b) => { if (b == null) return ''; const d = Math.round(a - b); return ` <span class="${d >= 0 ? 'up' : 'down'}">(前回比 ${d >= 0 ? '+' : ''}${d})</span>`; };
    let h = `<h3>${title}</h3><div class="total"><span class="pts">${Math.round(A.avg)}</span><span class="max">点(平均)/ ${A.n}問</span>${P ? `<span class="hint">${diff(A.avg, P.avg)}</span>` : ''}</div>`;
    h += `<h3>項目別の得点率</h3><div class="rtable">${ITEMS.filter(([k]) => A.itemN[k]).map(([k, n]) => `<span>${n}</span>${bar(A.item[k], A.item[k] < 0.5 ? 'bad' : A.item[k] < 0.75 ? 'mid' : '')}<span class="num">${pct(A.item[k])}%${P && P.itemN[k] ? diff(pct(A.item[k]), pct(P.item[k])) : ''}</span>`).join('')}</div>`;
    // 気候区分ごと
    const codes = G.KOPPEN_ORDER.filter(c => A.byCode[c]);
    h += `<h3>気候区分ごとの正答率</h3><div class="rtable">${codes.map(c => { const b = A.byCode[c], v = b.ok / b.n; return `<span class="num">${c}</span>${bar(v, v < 0.5 ? 'bad' : v < 0.75 ? 'mid' : '')}<span class="num">${b.ok}/${b.n}</span>`; }).join('')}</div>`;
    // 取り違え
    const conf = Object.entries(A.conf).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (conf.length) h += `<h3>よくある取り違え(正解 → あなたの回答)</h3><ul class="rlist">${conf.map(([k, n]) => { const [c, a] = k.split('>'); return `<li><b>${c} → ${a}</b> ${n}回<br><span class="hint">${ERR[errType(c, a)][1]}</span></li>`; }).join('')}</ul>`;
    else h += '<h3>よくある取り違え</h3><p class="note">気候区分の間違いはありませんでした。</p>';
    // 誤りの種類
    const errs = Object.entries(A.err).sort((a, b) => b[1] - a[1]), nErr = errs.reduce((s, e) => s + e[1], 0);
    if (errs.length) h += `<h3>間違いの原因(気候区分 ${nErr}問)</h3><div class="rtable">${errs.map(([t, n]) => `<span>${ERR[t][0]}</span>${bar(n / nErr, 'bad')}<span class="num">${n}問</span>`).join('')}</div>`;
    // 条件別
    const rate = a => a[0] ? `${a[1]}/${a[0]}(${pct(a[1] / a[0])}%)` : '出題なし';
    h += `<h3>条件別の気候区分正答率</h3><dl class="facts"><div class="fact"><dt>北半球</dt><dd>${rate(A.hemi.N)}</dd></div><div class="fact"><dt>南半球</dt><dd>${rate(A.hemi.S)}</dd></div><div class="fact"><dt>地点表示なし</dt><dd>${rate(A.loc.off)}</dd></div><div class="fact"><dt>地点表示あり</dt><dd>${rate(A.loc.on)}</dd></div><div class="fact"><dt>グラフ形式の平均点</dt><dd>${A.type.graph[0] ? Math.round(A.type.graph[1] / A.type.graph[0]) + '点(' + A.type.graph[0] + '問)' : '出題なし'}</dd></div><div class="fact"><dt>白地図形式の平均点</dt><dd>${A.type.map[0] ? Math.round(A.type.map[1] / A.type.map[0]) + '点(' + A.type.map[0] + '問)' : '出題なし'}</dd></div></dl>`;
    // 気候区分以外で落としている所
    const weakRows = [];
    for (const [k, n] of ITEMS.filter(x => x[0] !== 'kop')) {
      const ws = Object.entries(A.weak[k]).map(([c, w]) => [c, w.s / w.n, w]).filter(x => x[1] < 0.75).sort((a, b) => a[1] - b[1] || b[2].n - a[2].n).slice(0, 3);
      for (const [c, v, w] of ws) {
        const wr = Object.entries(w.wrong).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p, m]) => `${nameOf(k, p)}×${m}`).join('、');
        weakRows.push(`<li><b>${n}・${c}</b> 得点率 ${pct(v)}%(${w.n}問)${wr ? `<br><span class="hint">選んだ誤答: ${wr}</span>` : ''}<br><span class="hint">この区分で多かった正解: ${topOf(w.right)}</span></li>`);
      }
    }
    if (weakRows.length) h += `<h3>標高・植生・農業形態・作物で落としている区分</h3><ul class="rlist">${weakRows.join('')}</ul>`;
    // 行動
    const acts = [];
    for (const [t, n] of errs.slice(0, 3)) if (n >= 2 || errs.length <= 2) acts.push(`<b>${ERR[t][0]}(${n}問)</b>: ${ERR[t][1]}`);
    if (A.hemi.S[0] >= 4 && A.hemi.N[0] >= 4 && A.hemi.S[1] / A.hemi.S[0] < A.hemi.N[1] / A.hemi.N[0] - 0.15) acts.push('<b>南半球で正答率が落ちている</b>: 気温の山が12〜2月にあれば南半球。夏・冬を読み替えてから、乾季がどちらの季節かを判定する。');
    const worstCode = codes.map(c => [c, A.byCode[c].ok / A.byCode[c].n, A.byCode[c].n]).filter(x => x[2] >= 2 && x[1] < 0.5).sort((a, b) => a[1] - b[1])[0];
    if (worstCode) acts.push(`<b>${worstCode[0]}(${G.KOPPEN[worstCode[0]].name})が最も苦手</b>: 「気候を読む」で地図を「ケッペン」にして ${worstCode[0]} の地点を5か所タップし、判定の手順を声に出して追う。`);
    const worstItem = ITEMS.filter(x => x[0] !== 'kop' && A.itemN[x[0]]).map(([k, n]) => [k, n, A.item[k]]).sort((a, b) => a[2] - b[2])[0];
    if (worstItem && worstItem[2] < 0.6) acts.push(`<b>${worstItem[1]}の得点率が${pct(worstItem[2])}%</b>: 地図を「地形」「植生」「農業」に切り替えて、上の「落としている区分」の地域で実際の分布を確かめる。`);
    if (!acts.length) acts.push('大きな偏りはありません。地点表示なしのまま、平均85点以上を目標に続けましょう。');
    h += `<h3>次にやること</h3><ol class="steps-list">${acts.map(a => `<li>${a}</li>`).join('')}</ol>`;
    return h;
  }
  function mistakes(es, offset) {
    const rows = es.map((e, j) => [e, offset + j + 1]).filter(([e]) => e.total < 100).reverse().slice(0, 50);
    if (!rows.length) return '';
    const m = v => v >= 1 ? '○' : v > 0 ? '△' : '×';
    return `<h3>間違えた問題の記録(新しい順・最大50件)</h3><div class="tablewrap"><table class="months rlog"><tr><th>問</th><th>形式</th><th>正解</th><th>回答</th><th>植生</th><th>農業</th><th>作物</th><th>点</th><th>位置</th><th>標高</th></tr>${rows.map(([e, n]) => `<tr><td>${n}</td><td>${e.type === 'map' ? '白地図' : 'グラフ'}</td><td>${e.code}</td><td class="${e.r.kop === 1 ? '' : 'ng'}">${e.a.kop || '—'}</td><td>${m(e.r.veg)}</td><td>${m(e.r.agri !== undefined ? e.r.agri : e.r.land)}</td><td>${m(e.r.crops)}</td><td>${e.total}</td><td>${Math.abs(e.lat)}°${e.lat >= 0 ? 'N' : 'S'} ${e.lon != null ? Math.abs(e.lon) + '°' + (e.lon >= 0 ? 'E' : 'W') : ''}</td><td>${Math.round(e.elev / 10) * 10}</td></tr>`).join('')}</table></div>`;
  }
  // sel: 'all' | 'now' | 数字(第n回)
  function render(box, sel, onChange) {
    const L = all(), nb = Math.floor(L.length / BLOCK), rest = L.length - nb * BLOCK;
    const opts = [];
    for (let b = nb; b >= 1; b--) opts.push([String(b), `第${b}回の分析(${(b - 1) * BLOCK + 1}〜${b * BLOCK}問)`]);
    if (rest) opts.splice(0, 0, ['now', `途中経過(${nb * BLOCK + 1}〜${L.length}問)`]);
    opts.push(['all', `全期間(${L.length}問)`]);
    if (!opts.some(o => o[0] === sel)) sel = opts[0][0];
    let es, prev = null, off = 0, title;
    if (sel === 'all') { es = L; title = '全期間の傾向'; }
    else if (sel === 'now') { off = nb * BLOCK; es = L.slice(off); prev = nb ? L.slice(off - BLOCK, off) : null; title = `途中経過(次の分析まであと${BLOCK - rest}問)`; }
    else { const b = +sel; off = (b - 1) * BLOCK; es = L.slice(off, off + BLOCK); prev = b > 1 ? L.slice(off - BLOCK, off) : null; title = `第${b}回 傾向分析(${off + 1}〜${off + BLOCK}問)`; }
    box.innerHTML = `<div class="block"><label class="sel">範囲 <select id="reviewRange">${opts.map(([v, t]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <p class="hint">${BLOCK}問ごとに自動で傾向分析をまとめます。記録はこの端末のブラウザに保存されます。</p>
      ${report(es, prev, title)}${mistakes(es, off)}</div>`;
    box.querySelector('#reviewRange').onchange = e => onChange(e.target.value);
  }
  root.Review = { add, all, reset, render, BLOCK };
})(window);
