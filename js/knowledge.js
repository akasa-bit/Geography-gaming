/* 名称・色と、教科書的な解説文。植生・作物・家畜の区分はデータセットの区分に合わせてある */
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

  // 植生: SAGE Global Potential Vegetation (Ramankutty & Foley 1999) の15区分。番号はデータの値
  const VEG = {
    1: { name: '熱帯常緑樹林', sub: '熱帯雨林(セルバ・ジャングル)', color: '#0e6b3a' },
    2: { name: '熱帯落葉樹林', sub: '熱帯季節林・雨緑林(乾季に落葉)', color: '#5a9a3c' },
    3: { name: '温帯常緑広葉樹林', sub: '照葉樹林・硬葉樹林', color: '#2f8f4e' },
    4: { name: '温帯常緑針葉樹林', sub: 'マツ・スギ・米マツなど', color: '#3f7f6a' },
    5: { name: '温帯落葉広葉樹林', sub: 'ブナ・ナラ・カエデ', color: '#8ac25a' },
    6: { name: '亜寒帯常緑針葉樹林', sub: 'タイガ(トウヒ・モミ)', color: '#2d6f73' },
    7: { name: '亜寒帯落葉針葉樹林', sub: 'タイガ(カラマツ)', color: '#5c8f8c' },
    8: { name: '混合林', sub: '針葉樹と広葉樹が混じる森林', color: '#63a56a' },
    9: { name: 'サバナ', sub: '丈の長い草原と疎林', color: '#c9c15a' },
    10: { name: '草原・ステップ', sub: 'ステップ・プレーリー・パンパ', color: '#e3cf8f' },
    11: { name: '密な低木林', sub: '低木が密生(マキ・チャパラルなど)', color: '#a8a04a' },
    12: { name: 'まばらな低木林', sub: '半砂漠の低木・とげのある灌木', color: '#d6c7a0' },
    13: { name: 'ツンドラ', sub: '地衣類・蘚苔類', color: '#aab7ae' },
    14: { name: '砂漠', sub: '植生はほとんどなし', color: '#eedfc0' },
    15: { name: '極地の荒原・氷雪', sub: '岩・氷におおわれる', color: '#f2f5f7' }
  };
  const VEG_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

  // 作物: MapSPAM 2020 の収穫面積(オリーブと飼料作物だけ GAEZ+ 2015)。キーは tools/build_earth_data.py の作物名
  const CROPS = {
    Wheat: '小麦', Rice: '米', Maize: 'トウモロコシ', Barley: '大麦', Othercereals: 'その他の麦類・穀物(ライ麦・エン麦など)', Millet: 'ミレット(雑穀)', Sorghum: 'ソルガム(コウリャン)',
    Potato: 'ジャガイモ', Sweetpotato: 'サツマイモ', Cassava: 'キャッサバ', Yams: 'ヤムイモ・タロイモ', Sugarcane: 'サトウキビ', Sugarbeet: 'テンサイ', Soybean: '大豆', Pulses: '豆類',
    Rapeseed: 'ナタネ', Sunflower: 'ヒマワリ', Groundnut: 'ラッカセイ', Sesame: 'ゴマ', Oilpalm: '油ヤシ', Coconut: 'ココヤシ', Olives: 'オリーブ', Cotton: '綿花', Otherfibre: 'その他の繊維(ジュート・麻など)',
    Coffee: 'コーヒー', Cocoa: 'カカオ', Tea: '茶', Rubber: '天然ゴム', Tobacco: 'タバコ', Banana: 'バナナ', Citrus: '柑橘類', Tropicalfruit: '熱帯の果樹(マンゴー・パイナップルなど)',
    Temperatefruit: '温帯の果樹(ブドウ・リンゴなど)', Vegetables: '野菜', Fodder: '飼料作物(牧草など)', Othercrops: 'その他の作物'
  };
  // 家畜: FAO Gridded Livestock of the World 2015
  const STOCK = { cattle: '牛', sheep: '羊', goats: 'ヤギ', pigs: '豚' };
  const STOCK_MIN = { cattle: 15, sheep: 15, goats: 15, pigs: 20 }; // 「多い」とみなす密度(頭/km²)
  // 耕地の広がり: 全作物の収穫面積の合計がセル面積に占める割合(二期作などは重複して数える)
  const LAND = { 0: 'ほとんど耕作されていない(1%未満)', 1: '耕地が点在する(1〜10%)', 2: '耕地が多い(10〜35%)', 3: '大部分が耕地(35%以上)' };
  // 農業形態: FAO/ILRI Global livestock production systems v5 の区分をまとめたもの。番号はデータの値
  const AGRI = {
    1: { name: '放牧中心', sub: '草地で家畜だけを飼う。遊牧・企業的牧畜など', color: '#e0b060' },
    2: { name: '天水の耕作+家畜', sub: '雨にたよる畑作と家畜飼育の組み合わせ。混合農業・畑作など', color: '#86c06c' },
    3: { name: '灌漑の耕作+家畜', sub: '灌漑による耕作と家畜飼育。稲作・オアシス農業など', color: '#2f8fb0' },
    4: { name: '森林など(農牧業はわずか)', sub: '森林・湿地におおわれ、農牧業がほとんどない', color: '#3f7f5a' },
    5: { name: '農牧業に不適', sub: '氷雪・水域など', color: '#dfe3e6' }
  };
  const AGRI_ORDER = [1, 2, 3, 4, 5];
  // 農業地域区分。whit: ホイットルセー(1936)の区分図から読み取ったもの / farm: 現在のデータに規則をあてはめた自作の区分(js/climate.js の farmType)
  const FARM = {
    nomad: { name: '遊牧', color: '#f3e06a' }, ranch: { name: '企業的牧畜', color: '#f0b8d8' }, shifting: { name: '焼畑農業', color: '#b96a1e' }, sedentary: { name: '粗放的定住農業', color: '#9a55d8' },
    rice: { name: '集約的稲作農業(アジア式稲作)', color: '#2f9a3a' }, upland: { name: '集約的畑作農業(アジア式畑作)', color: '#8fd8b0' }, plantation: { name: 'プランテーション農業', color: '#e0405a' },
    medit: { name: '地中海式農業', color: '#f09a3a' }, grain: { name: '企業的穀物農業', color: '#e8b890' }, mixed: { name: '混合農業(商業的)', color: '#8fd060' }, substock: { name: '自給的混合農業', color: '#9ab020' },
    dairy: { name: '酪農', color: '#3fb8e8' }, horti: { name: '園芸農業', color: '#e040b8' }, oasis: { name: 'オアシス農業(灌漑農業)', color: '#2a50c0' }, none: { name: '非農業地域(農牧業はほぼなし)', color: '#b8bcc0' }
  };
  const WHIT_ORDER = ['nomad', 'ranch', 'shifting', 'sedentary', 'rice', 'upland', 'plantation', 'medit', 'grain', 'mixed', 'substock', 'dairy', 'horti', 'none'];           // 区分図の14区分
  const FARM_ORDER = ['nomad', 'ranch', 'oasis', 'shifting', 'rice', 'upland', 'plantation', 'medit', 'grain', 'mixed', 'dairy', 'horti', 'none'];                      // 自作の13区分
  const FARM_NEAR = [['nomad', 'ranch'], ['rice', 'upland'], ['mixed', 'dairy'], ['mixed', 'horti'], ['dairy', 'horti'], ['shifting', 'plantation'], ['grain', 'mixed'], ['shifting', 'sedentary'], ['mixed', 'substock'], ['sedentary', 'substock']]; // 近い型(半分の点)
  // 標高の区分(白地図クイズ用)
  const ELEV = ['0〜50m', '50〜500m', '500〜1000m', '1000〜2000m', '2000m〜'];
  const elevClass = e => e < 50 ? 0 : e < 500 ? 1 : e < 1000 ? 2 : e < 2000 ? 3 : 4;
  const landClass = f => f < 0.01 ? 0 : f < 0.10 ? 1 : f < 0.35 ? 2 : 3;

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

  const API = { KOPPEN, KOPPEN_ORDER, VEG, VEG_ORDER, CROPS, STOCK, STOCK_MIN, LAND, landClass, ELEV, elevClass, AGRI, AGRI_ORDER, FARM, FARM_ORDER, WHIT_ORDER, FARM_NEAR, AGRI_NOTE, SOIL_NOTE };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Geo = API;
})(typeof window !== 'undefined' ? window : globalThis);
