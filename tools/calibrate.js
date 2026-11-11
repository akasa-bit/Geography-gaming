// 簡略気候モデルの検証: 実在の地球の地形でシミュレーションし、観測データから判定したケッペン区分と陸セルごとに比べる
// 使い方: node tools/calibrate.js
require('../data/earth.js');
const Core = require('../js/core.js'), Climate = require('../js/climate.js');
const D = globalThis.EARTH_DATA, E = Core.unpackEarth(D, require('zlib').gunzipSync(Buffer.from(D.gz, 'base64')));
const w = Core.realEarthWorld(E);
const model = Climate.simulate(w), mk = model.kop.slice(), mT = Float32Array.from(model.tAnn), mP = Float32Array.from(model.pAnn);
const obs = Climate.applyObserved(Climate.simulate(w), w, E);
let n = 0, same = 0, grp = 0, dT = 0, by = {};
for (let i = 0; i < Core.N; i++) {
  if (!obs.land[i]) continue;
  const o = obs.kop[i], m = mk[i]; n++; if (o === m) same++; if (o[0] === m[0]) grp++;
  dT += Math.abs(mT[i] - obs.tAnn[i]);
  const b = by[o] = by[o] || { n: 0, ok: 0 }; b.n++; if (o === m) b.ok++;
}
console.log(`陸セル ${n} / 区分が一致 ${(same / n * 100).toFixed(1)}% / 大区分(A〜E・H)が一致 ${(grp / n * 100).toFixed(1)}% / 年平均気温の平均誤差 ${(dT / n).toFixed(1)}℃`);
console.log('観測の区分ごと(セル数, モデル一致率):', Object.keys(by).map(k => `${k} ${by[k].n} ${(by[k].ok / by[k].n * 100).toFixed(0)}%`).join(' / '));
