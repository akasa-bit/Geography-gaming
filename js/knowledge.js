/* 地理の知識データ: 気候区分・植生・土壌・農業・作物の名称、色、対応関係、解説 */
(function (root) {
  'use strict';
  const KOPPEN = {
    Af: { name: '熱帯雨林気候', color: '#0b4fd6', note: '最寒月18℃以上で、最少雨月も60mm以上。年中、熱帯収束帯(赤道低圧帯)の影響を受けてスコールが降る。気温の年較差は小さく、日較差の方が大きい。' },
    Am: { name: '弱い乾季のある熱帯雨林気候(熱帯モンスーン気候)', color: '#2f86ff', note: '最寒月18℃以上。短い弱い乾季があるが、季節風(モンスーン)による雨季の雨が非常に多い。' },
    Aw: { name: 'サバナ気候', color: '#7cc0f7', note: '最寒月18℃以上。夏(高日季)は熱帯収束帯に入り雨季、冬(低日季)は亜熱帯高圧帯に入り乾季と、雨季・乾季がはっきり分かれる。' },
    BS: { name: 'ステップ気候', color: '#f0b040', note: '年降水量が乾燥限界の1/2以上〜乾燥限界未満。砂漠の周辺に分布し、短い雨季に丈の短い草原が広がる。' },
    BW: { name: '砂漠気候', color: '#e5503c', note: '年降水量が乾燥限界の1/2未満。亜熱帯高圧帯の下(回帰線付近)、大陸内部(隔海度大)、寒流沿岸、山脈の風下に分布。気温の日較差が大きい。' },
    Cs: { name: '地中海性気候', color: '#f2df2b', note: '最寒月-3℃以上18℃未満。夏は亜熱帯高圧帯に覆われて乾燥し、冬は偏西風(亜寒帯低圧帯・前線)の影響で雨が降る。緯度30〜45°の大陸西岸に分布。' },
    Cw: { name: '温暖冬季少雨気候', color: '#a8dd7a', note: '最寒月-3℃以上18℃未満。夏は季節風で多雨、冬は乾燥(夏の最多雨月が冬の最少雨月の10倍以上)。Awの高緯度側や低緯度の高原に分布。' },
    Cfa: { name: '温暖湿潤気候', color: '#5fc24a', note: '最寒月-3℃以上18℃未満、最暖月22℃以上で年中湿潤。緯度25〜40°の大陸東岸に分布。夏は高温多雨、冬は比較的寒く、年較差が大きい。' },
    Cfb: { name: '西岸海洋性気候', color: '#1f8f5a', note: '最寒月-3℃以上18℃未満、最暖月22℃未満で年中湿潤。偏西風と暖流の影響で、高緯度のわりに冬が温和。年較差が小さく、降水は年中平均している。緯度40〜60°の大陸西岸に分布。' },
    Df: { name: '亜寒帯(冷帯)湿潤気候', color: '#35b8c9', note: '最寒月-3℃未満、最暖月10℃以上で年中降水がある。北半球の高緯度にのみ分布(南半球にはこの緯度に大陸がない)。年較差が大きい。' },
    Dw: { name: '亜寒帯(冷帯)冬季少雨気候', color: '#8f8be0', note: '最寒月-3℃未満、最暖月10℃以上で冬に乾燥。冬に大陸上の高気圧(シベリア高気圧)が発達する大陸東部に分布。気温の年較差が極めて大きい。' },
    ET: { name: 'ツンドラ気候', color: '#b9bec4', note: '最暖月0℃以上10℃未満。短い夏に地表の永久凍土が融け、地衣類・蘚苔類が育つ。' },
    EF: { name: '氷雪気候', color: '#767d86', note: '最暖月0℃未満。一年中、氷と雪に覆われる(大陸氷河)。' },
    H: { name: '高山気候', color: '#a0567a', note: '標高が高いため同緯度の低地より気温が低い(100mにつき約0.65℃低下)。低緯度では年中春のような「常春」の気候になり、気温の年較差が小さく日較差が大きい。' }
  };
  const KOPPEN_ORDER = ['Af', 'Am', 'Aw', 'BS', 'BW', 'Cs', 'Cw', 'Cfa', 'Cfb', 'Df', 'Dw', 'ET', 'EF', 'H'];

  const VEG = {
    rainforest: { name: '熱帯雨林', sub: 'セルバ・ジャングル(常緑広葉樹の密林)', color: '#0e6b3a' },
    savanna: { name: 'サバナ', sub: '丈の長い草原と疎林(バオバブ・アカシア)', color: '#c9c15a' },
    steppe: { name: 'ステップ', sub: '丈の短い草原', color: '#e3cf8f' },
    desert: { name: '砂漠', sub: '植生はほとんどなし(オアシスを除く)', color: '#eedfc0' },
    sclerophyll: { name: '硬葉樹林', sub: 'オリーブ・コルクガシ・月桂樹', color: '#9aa63c' },
    laurel: { name: '照葉樹林', sub: 'シイ・カシ・クスなどの常緑広葉樹', color: '#2f8f4e' },
    deciduous: { name: '落葉広葉樹林・混合林', sub: 'ブナ・ナラ、針葉樹との混合林', color: '#74b85a' },
    prairie: { name: '長草草原', sub: 'プレーリー・パンパ・プスタ', color: '#b9d67a' },
    taiga: { name: '針葉樹林(タイガ)', sub: 'エゾマツ・トドマツ・カラマツ', color: '#2d6f73' },
    tundra: { name: 'ツンドラ', sub: '地衣類・蘚苔類', color: '#aab7ae' },
    ice: { name: '氷雪(植生なし)', sub: '大陸氷河', color: '#f2f5f7' },
    alpine: { name: '高山植生', sub: '高山草原(標高により垂直分布)', color: '#b58aa5' }
  };
  const VEG_ORDER = ['rainforest', 'savanna', 'steppe', 'desert', 'sclerophyll', 'laurel', 'deciduous', 'prairie', 'taiga', 'tundra', 'ice', 'alpine'];

  const SOIL = {
    latosol: 'ラトソル(赤色土)', redyellow: '赤黄色土', desert: '砂漠土', chestnut: '栗色土',
    black: '黒色土(チェルノーゼム・プレーリー土)', brown: '褐色森林土', podzol: 'ポドゾル', tundra: 'ツンドラ土', none: '土壌なし(氷雪)', alpine: '高山土'
  };
  const SOIL_ORDER = ['latosol', 'redyellow', 'desert', 'chestnut', 'black', 'brown', 'podzol', 'tundra', 'none', 'alpine'];

  const AGRI = {
    shifting: '焼畑農業', nomad: '遊牧', oasis: 'オアシス農業', rice: 'アジア式稲作(集約的稲作)', upland: 'アジア式畑作(集約的畑作)',
    medit: '地中海式農業', mixed: '混合農業', dairy: '酪農', horti: '園芸農業', grain: '企業的穀物農業', ranch: '企業的牧畜',
    plantation: 'プランテーション農業', none: '農業はほぼ不可能(非農業地域)'
  };
  const AGRI_ORDER = ['shifting', 'nomad', 'oasis', 'rice', 'upland', 'medit', 'mixed', 'dairy', 'horti', 'grain', 'ranch', 'plantation', 'none'];

  const CROPS = {
    rubber: '天然ゴム', oilpalm: '油ヤシ', cacao: 'カカオ', banana: 'バナナ', cassava: 'キャッサバ', coffee: 'コーヒー', sugarcane: 'サトウキビ', cotton: '綿花', tea: '茶', jute: 'ジュート',
    rice: '米', wheat: '小麦', maize: 'トウモロコシ', soy: '大豆', millet: '雑穀(ミレット・ソルガム)', dates: 'ナツメヤシ', olive: 'オリーブ', grape: 'ブドウ', citrus: '柑橘類', cork: 'コルクガシ',
    potato: 'ジャガイモ', rye: 'ライ麦', oats: 'エン麦', beet: 'テンサイ', barley: '大麦', pasture: '牧草(乳牛)', sheep: '羊', cattle: '肉牛', camel: 'ラクダ', reindeer: 'トナカイ', llama: 'リャマ・アルパカ・ヤク', nothing: '該当なし'
  };
  const CROP_ORDER = Object.keys(CROPS);

  // 気候区分ごとの対応(full=典型, part=部分点)。植生の full は地図の植生区分も加える。
  const MATCH = {
    Af: { veg: [['rainforest'], []], soil: [['latosol'], ['redyellow']], agri: [['shifting', 'plantation'], ['rice']], crops: [['rubber', 'oilpalm', 'cacao', 'banana', 'cassava'], ['rice', 'coffee', 'sugarcane']] },
    Am: { veg: [['rainforest'], ['savanna']], soil: [['latosol'], ['redyellow']], agri: [['rice', 'plantation'], ['shifting']], crops: [['rice', 'rubber', 'banana', 'sugarcane', 'tea', 'jute', 'oilpalm'], ['cacao', 'cassava', 'coffee']] },
    Aw: { veg: [['savanna'], []], soil: [['latosol'], ['redyellow']], agri: [['plantation', 'shifting', 'rice', 'ranch'], ['upland', 'nomad']], crops: [['coffee', 'sugarcane', 'cotton', 'rice', 'cassava', 'millet'], ['cattle', 'maize', 'banana', 'jute', 'soy']] },
    BS: { veg: [['steppe'], ['prairie']], soil: [['chestnut', 'black'], ['desert']], agri: [['nomad', 'ranch', 'grain'], ['upland', 'oasis']], crops: [['wheat', 'sheep', 'cattle', 'millet'], ['cotton', 'camel', 'barley', 'maize']] },
    BW: { veg: [['desert'], []], soil: [['desert'], []], agri: [['oasis', 'nomad'], ['none']], crops: [['dates', 'camel'], ['sheep', 'cotton', 'wheat', 'nothing']] },
    Cs: { veg: [['sclerophyll'], []], soil: [['brown', 'redyellow'], []], agri: [['medit'], ['horti']], crops: [['olive', 'grape', 'citrus', 'cork', 'wheat'], ['sheep', 'barley']] },
    Cw: { veg: [['laurel'], ['savanna', 'deciduous']], soil: [['redyellow'], ['latosol']], agri: [['rice', 'upland'], ['plantation']], crops: [['rice', 'tea', 'cotton', 'maize', 'sugarcane'], ['wheat', 'coffee', 'soy', 'millet']] },
    Cfa: { veg: [['laurel', 'deciduous', 'prairie'], []], soil: [['redyellow', 'brown'], ['black']], agri: [['rice', 'mixed'], ['horti', 'grain', 'ranch', 'upland']], crops: [['rice', 'maize', 'soy', 'tea', 'cotton', 'wheat'], ['cattle', 'citrus', 'sugarcane']] },
    Cfb: { veg: [['deciduous'], []], soil: [['brown'], ['podzol']], agri: [['mixed', 'dairy', 'horti'], ['ranch']], crops: [['wheat', 'pasture', 'potato', 'beet', 'barley', 'rye'], ['oats', 'sheep', 'cattle', 'grape']] },
    Df: { veg: [['taiga', 'deciduous'], ['prairie']], soil: [['podzol'], ['brown', 'black']], agri: [['mixed', 'dairy', 'grain'], ['none']], crops: [['wheat', 'rye', 'oats', 'potato', 'pasture', 'beet'], ['barley', 'maize', 'soy']] },
    Dw: { veg: [['taiga'], ['deciduous']], soil: [['podzol'], ['brown']], agri: [['upland'], ['none', 'mixed', 'nomad']], crops: [['wheat', 'soy', 'millet', 'maize'], ['potato', 'rye', 'reindeer', 'nothing']] },
    ET: { veg: [['tundra'], []], soil: [['tundra'], []], agri: [['nomad', 'none'], []], crops: [['reindeer'], ['nothing']] },
    EF: { veg: [['ice'], []], soil: [['none'], []], agri: [['none'], []], crops: [['nothing'], []] },
    H: { veg: [['alpine'], []], soil: [['alpine'], []], agri: [['nomad'], ['upland', 'none']], crops: [['llama', 'potato'], ['barley', 'maize', 'sheep']] }
  };
  const AGRI_NOTE = {
    Af: '伝統的にはキャッサバ・タロイモなどの焼畑農業。欧米資本による天然ゴム・油ヤシ・カカオのプランテーションも発達。土壌はやせたラトソル。',
    Am: 'モンスーンの豊富な雨を利用した稲作(アジア)や、茶・サトウキビ・天然ゴムのプランテーション。',
    Aw: '雨季と乾季を利用したコーヒー・サトウキビ・綿花のプランテーション。アジアでは稲作、南米のカンポ・リャノでは企業的牧畜、アフリカでは焼畑や雑穀栽培。',
    BS: '草原を利用した遊牧(モンゴル・中央アジア・サヘル)や企業的牧畜(グレートプレーンズ・パンパ西部)。肥沃な黒色土(チェルノーゼム)地帯では企業的穀物農業で小麦を栽培。',
    BW: '外来河川・湧水・地下水路(カナート、フォガラ)を利用したオアシス農業でナツメヤシ・小麦・綿花を栽培。それ以外はラクダ・羊の遊牧。',
    Cs: '夏の乾燥に耐えるオリーブ・ブドウ・柑橘類・コルクガシなどの樹木作物と、冬の雨を利用した小麦栽培を組み合わせる地中海式農業。夏は家畜を高地へ移す移牧も。',
    Cw: '夏の高温多雨を利用した稲作(華南・インド北部)や茶の栽培。少雨地域では綿花・トウモロコシなどのアジア式畑作。',
    Cfa: 'アジアでは稲作、アメリカでは混合農業(コーンベルト:トウモロコシ・大豆+肉牛・豚)や綿花栽培。湿潤パンパでは小麦・牧牛。',
    Cfb: '穀物・飼料作物栽培と家畜飼育を組み合わせた混合農業、冷涼でやせた氷食地では酪農、大都市近郊では園芸農業。',
    Df: '南部では混合農業・酪農、春小麦の企業的穀物農業(カナダ・ロシア南部)。ライ麦・エン麦・ジャガイモなど耐寒性作物。北部のタイガでは林業が中心。',
    Dw: '中国東北部では大豆・春小麦・コウリャン・トウモロコシのアジア式畑作。シベリア東部のタイガでは林業、トナカイの遊牧。',
    ET: '農耕は不可能。トナカイの遊牧(サーミ・ネネツ)や狩猟・漁労(イヌイット)。',
    EF: '農牧業は不可能。居住は観測基地などに限られる(アネクメーネ)。',
    H: 'アンデスではリャマ・アルパカ、チベットではヤクの遊牧。ジャガイモ(アンデス原産)や大麦など耐寒性作物を標高に応じて栽培する。'
  };
  const SOIL_NOTE = {
    Af: 'ラトソル: 高温多雨で養分が流され、鉄・アルミニウムが残った赤色のやせた土壌。', Am: 'ラトソル〜赤黄色土。', Aw: 'ラトソル(赤色土)。',
    BS: '栗色土。やや湿潤な側には世界で最も肥沃な黒色土(ウクライナのチェルノーゼム、北米のプレーリー土)が分布。', BW: '砂漠土。蒸発が盛んで塩類が集積しやすい(塩害)。',
    Cs: '褐色森林土や赤黄色土。石灰岩地域には間帯土壌のテラロッサが分布。', Cw: '赤黄色土。', Cfa: '赤黄色土(低緯度側)〜褐色森林土(高緯度側)。草原地帯はプレーリー土・パンパ土。',
    Cfb: '褐色森林土: 落葉広葉樹の落ち葉による腐植に富む肥沃な土壌。', Df: 'ポドゾル: 低温のため分解が進まず、酸性で灰白色のやせた土壌。南部は褐色森林土。', Dw: 'ポドゾル。地下には永久凍土。',
    ET: 'ツンドラ土: 低温で分解が進まない強酸性の土壌。地下は永久凍土。', EF: '氷雪に覆われ土壌は発達しない。', H: '標高により変化する(高山土)。'
  };

  const API = { KOPPEN, KOPPEN_ORDER, VEG, VEG_ORDER, SOIL, SOIL_ORDER, AGRI, AGRI_ORDER, CROPS, CROP_ORDER, MATCH, AGRI_NOTE, SOIL_NOTE };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Geo = API;
})(typeof window !== 'undefined' ? window : globalThis);
