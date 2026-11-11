// 地球(簡略モデル)でシミュレーション結果を実在都市と見比べる検証スクリプト: node tools/calibrate.js [map]
const Core = require('../js/core.js'), Climate = require('../js/climate.js');
const w = Core.earthWorld(), s = Climate.simulate(w);
const cities = [['シンガポール',1,104,'Af'],['マナオス',-3,-60,'Af/Am'],['キサンガニ',1,25,'Af'],['バンコク',14,100.5,'Aw'],['コルカタ',22.5,88,'Aw'],['ダーウィン',-13,131,'Aw'],['ブラジリア',-16,-48,'Aw'],['ンジャメナ',12,15,'BS'],
['カイロ',30,31,'BW'],['リヤド',25,47,'BW'],['アリススプリングス',-24,134,'BW'],['リマ',-12,-76,'BW'],['ウォルビスベイ',-23,15,'BW'],['ウランバートル',48,107,'BS'],['テヘラン',36,51,'BS'],['ダカール',15,-17,'BS'],
['ローマ',42,12.5,'Cs'],['リスボン',39,-9,'Cs'],['サンフランシスコ',38,-122,'Cs'],['ケープタウン',-34,19,'Cs'],['パース',-32,116,'Cs'],['サンティアゴ',-33,-71,'Cs'],
['香港',22.5,114,'Cw'],['東京',36,140,'Cfa'],['上海',31,121,'Cfa'],['ニューオーリンズ',31,-90,'Cfa'],['ブエノスアイレス',-35,-59,'Cfa'],['シドニー',-34,151,'Cfa'],
['ロンドン',51.5,0,'Cfb'],['パリ',49,2,'Cfb'],['メルボルン',-38,145,'Cfb'],['ウェリントン',-41,175,'Cfb'],['バンクーバー',49,-123,'Cfb/Cs'],
['モスクワ',56,38,'Df'],['札幌',43,142,'Df'],['シカゴ',42,-88,'Df'],['モントリオール',46,-74,'Df'],['ヘルシンキ',61,25,'Df'],['イルクーツク',52,104,'Dw/Df'],['ハバロフスク',48,135,'Dw'],['北京',40,116,'Dw/BS'],['ヤクーツク',62,130,'Df/Dw'],
['バロー',71,-156,'ET'],['ヌーク',64,-51,'ET'],['昭和基地',-75,40,'EF'],['ラサ',30,91,'H'],['ラパス',-17,-68,'H'],['ナイロビ',-1,37,'Cw/Aw'],['ムンバイ',19,73,'Aw/Am'],['マイアミ',26,-80,'Am/Aw'],['デンバー',40,-105,'BS'],['カラチ',25,67,'BW'],['アディスアベバ',9,39,'Cw/H']];
let ok = 0;
for (const [n, la, lo, exp] of cities) {
  let y = Math.round((89 - la) / 2), x = Math.round((lo + 179) / 2), i = y * Core.W + ((x + Core.W) % Core.W);
  if (!s.land[i]) { // 近くの陸セルを探す
    let best = -1, bd = 9; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const j = Core.idx(x + dx, y + dy); if (s.land[j] && Math.hypot(dx, dy) < bd) { bd = Math.hypot(dx, dy); best = j; } } i = best;
  }
  if (i < 0) { console.log(n, 'no land'); continue; }
  const t = [], p = []; for (let m = 0; m < 12; m++) { t.push(s.T[m][i]); p.push(s.P[m][i]); }
  const hit = exp.split('/').includes(s.kop[i]); if (hit) ok++;
  console.log((hit ? 'o ' : 'X ') + n.padEnd(10, '　'), (s.kop[i] || '').padEnd(4), 'exp', exp.padEnd(7), 'T1', t[0].toFixed(0).padStart(4), 'T7', t[6].toFixed(0).padStart(4), 'R', (p.reduce((a, b) => a + b)).toFixed(0).padStart(5), 'P1', p[0].toFixed(0).padStart(4), 'P7', p[6].toFixed(0).padStart(4), 'el', w.elev[i].toFixed(0), 'c', s.cont[i].toFixed(2), 'M', s.Msrc[0][i].toFixed(2), s.Msrc[6][i].toFixed(2), 'sA', s.srcA[0][i].toFixed(1), s.srcA[6][i].toFixed(1), 'XL', s.landXL[i].toFixed(2), 'mo', s.mons[0][i].toFixed(1), s.mons[6][i].toFixed(1), 'wc', s.wcoast[i].toFixed(1), 'P', p.map(v=>v.toFixed(0)).join(' '));
}
console.log('match', ok, '/', cities.length);
if (process.argv[2] === 'map') {
  const ch = { Af: 'A', Am: 'M', Aw: 'w', BS: 's', BW: '#', Cs: 'S', Cw: 'W', Cfa: 'a', Cfb: 'b', Df: 'f', Dw: 'd', ET: 't', EF: 'E', H: '^' };
  for (let y = 0; y < Core.H; y++) { let l = ''; for (let x = 0; x < Core.W; x++) { const k = s.kop[y * Core.W + x]; l += k ? ch[k] : (s.ckind[y * Core.W + x] > 0 ? '+' : s.ckind[y * Core.W + x] < 0 ? '-' : ' '); } console.log(l); }
}
