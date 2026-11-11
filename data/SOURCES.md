# 地球(実データ)の出典

`data/earth.js` は下のデータを 1°×1°(360×180)に集計して gzip 圧縮したもの。`tools/build_earth_data.py <フォルダ>` で再生成できる(要 numpy, netCDF4, rasterio, pyshp。農業形態の7zの展開に py7zr)。取得日: 2026-11-11。

| 内容 | データセット | 提供機関 | 期間 | 入手先(保存ファイル名) |
| --- | --- | --- | --- | --- |
| 標高・水深 | ETOPO 2022, 60秒, 氷床表面 (doi:10.25921/fd45-gt74) | NOAA NCEI | — | `https://www.ngdc.noaa.gov/thredds/dodsC/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc.ascii?z[0:10:10799][0:10:21599]` (`etopo2022.txt`) |
| 陸上の気温 | Terrestrial Air Temperature v5.01 (Willmott & Matsuura) | デラウェア大学 / NOAA PSL | 1981–2010 | `https://downloads.psl.noaa.gov/Datasets/udel.airt.precip/air.mon.v501.ltm.1981-2010.nc` (`udel_air.nc`) |
| 陸上の降水量 | Terrestrial Precipitation v5.01 (Willmott & Matsuura) | デラウェア大学 / NOAA PSL | 1981–2010 | `.../udel.airt.precip/precip.mon.v501.ltm.1981-2010.nc` (`udel_precip.nc`) |
| 海面水温 | NOAA OI SST V2 (Reynolds et al. 2002) | NOAA PSL | 1991–2020 | `.../noaa.oisst.v2/sst.ltm.1991-2020.nc` (`oisst.nc`) |
| 海上の降水量・陸の欠損補完 | GPCP v2.3 Monthly (Adler et al. 2018) | NOAA PSL / NASA | 1991–2020 | `.../gpcp/precip.mon.ltm.1991-2020.nc` (`gpcp.nc`) |
| 気温の欠損補完 | NCEP/NCAR Reanalysis 1, 2m気温 (Kalnay et al. 1996) | NOAA PSL | 1991–2020 | `.../ncep.reanalysis.derived/surface_gauss/air.2m.mon.ltm.1991-2020.nc` (`air2m.nc`) |
| 風 | NCEP/NCAR Reanalysis 1, sigma 0.995 の東西風・南北風 | NOAA PSL | 1991–2020 | `.../ncep.reanalysis.derived/surface/{uwnd,vwnd}.sig995.mon.ltm.1991-2020.nc` |
| 海流 | GODAS 深さ5mの流速 (Behringer & Xue 2004) | NOAA NCEP / PSL | 1991–2020 | `https://psl.noaa.gov/thredds/dodsC/Datasets/godas/Derived/{ucur,vcur}.mon.ltm.1991-2020.nc.ascii?…[0:11][0][0:417][0:359]` (`ucur.txt`, `vcur.txt`) |
| プレート境界・相対運動 | PB2002 (Bird 2003, G-cubed, doi:10.1029/2001GC000252) | UCLA | — | `http://peterbird.name/oldFTP/PB2002/PB2002_plates.dig.txt`, `PB2002_poles.dat.txt` |
| 大地形(造山帯・安定陸塊) | Global geologic provinces (Hasterok et al. 2022, Earth-Science Reviews, doi:10.1016/j.earscirev.2022.104069) | アデレード大学 | — | `https://raw.githubusercontent.com/dhasterok/global_tectonics/main/plates%26provinces/shp/global_gprv.{shp,dbf,shx}` (`gprv.*`) |
| 植生(潜在自然植生) | Global Potential Vegetation Dataset, 5分 (Ramankutty & Foley 1999, Global Biogeochem. Cycles) | ウィスコンシン大学 SAGE | — | `https://sage-public-files.s3.amazonaws.com/global-potential-vegetation/glpotveg_5min.asc.gz` (`potveg.asc.gz`) |
| 作物の収穫面積 | MapSPAM 2020 V2r2, Global Spatially-Disaggregated Crop Production Statistics Data for 2020 (IFPRI, doi:10.7910/DVN/SWPENT)。46作物 | 国際食糧政策研究所 IFPRI / Harvard Dataverse | 2020年ごろ | Dataverse の `spam2020V2r2_global_harvested_area.geotiff.zip`(ダウンロード時に利用者フォームあり)を `spam/spam.zip` として置く |
| オリーブ・飼料作物の収穫面積 | GAEZ+ 2015 Crop Harvest Area (Frolking et al. 2020, doi:10.7910/DVN/KAGRFI, CC0)。FAO/IIASA GAEZ v4 にもとづく | ニューハンプシャー大学 / Harvard Dataverse | 2015年ごろ | `GAEZAct2015_HarvArea_{Olives,Foddercrops}_Total.tif` (`gaez/Olives.tif` `gaez/Foddercrops.tif`) |
| 農業形態 | Global distribution of ruminant livestock production systems V5 (Robinson et al. 2011; FAO/ILRI, doi:10.7910/DVN/WPDSZE, CC0) | FAO / ILRI / Harvard Dataverse | 2010年ごろ | `2_GlobalRuminantLPS_GIS.7z` を展開 (`lps/glps_gleam_61113_10km.tif`) |
| 家畜(牛・羊・ヤギ・豚) | Gridded Livestock of the World 2015, GLW 4 (Gilbert et al. 2018, Scientific Data)。doi:10.7910/DVN/LHBICE, VZOYHM, YYG6ET, CIVCPB | FAO / ブリュッセル自由大学 / Harvard Dataverse | 2015年 | 各データセットの `5_*_2015_Da.tif` (`cattle.tif` `sheep.tif` `goats.tif` `pigs.tif`) |

## 加工の内容

- **標高**: 10分間隔に間引いた値を 1°セルごとに平均(1セルあたり36点)。陸の割合が半分以上なら陸セル(陸部分の平均標高)、それ以外は海セル(海部分の平均水深)。
- **気温・降水量**: 陸セルは 0.5°格子4個の平均。観測格子のない陸セル(南極・グリーンランド内陸など513セル)は、気温を NCEP/NCAR 再解析、降水を GPCP で補完。海セルの気温は海面水温(1°)、降水は GPCP(2.5°を補間)。風(2.5°)も補間。
- **暖流・寒流**: 年平均の海面水温が同緯度の海の平均より 1.2℃以上高く、高緯度へ向かう流れを暖流、1.2℃以上低く低緯度へ向かう流れを寒流として色分け。
- **プレート**: PB2002 の52プレートを高校地理で扱う主要14プレートにまとめた(例: ソマリア→アフリカ、アムール・スンダ・揚子江→ユーラシア、オホーツク→北アメリカ、インド+オーストラリア→インド・オーストラリア)。速度はPB2002のオイラー極(太平洋プレート基準)に、太平洋プレートの絶対運動(NNR-NUVEL-1A, Argus & Gordon 1991: 63.0°S, 107.3°E, 0.641°/100万年)を足して求めた。
- **ケッペンの気候区分**: 上の気温・降水量を教科書の判定法(乾燥限界 r=20(t+x))にあてはめた結果(既存の気候区分図を読み込んだものではない)。標高2000m以上は高山気候(H)。
- **植生**: 5分格子144点のうち最も多い区分をそのセルの植生、25%以上を占める2番目の区分を「一部」とした。データのある点が1/4未満のセル(南極など)は「データなし」。
- **作物**: MapSPAM の5分格子の収穫面積(ha、灌漑+天水の合計)を1°セルで合計し、セル面積に対する割合にした。二期作などは重複して数えるので、合計が100%を超えるセルがある。46作物を36区分にまとめた(コーヒー=アラビカ+ロブスタ、ミレット=2種、豆類=6種、バナナ=バナナ+料理用バナナ、野菜=トマト+タマネギ+その他、ヤムイモ=ヤム+その他の根菜、その他の作物=その他の油料+残り)。MapSPAM にないオリーブと飼料作物は GAEZ+ 2015 から加えた(年次が5年ほど違う)。オリーブは MapSPAM の「その他の油料」と重なるので、合計には入れていない。ブドウ・ナツメヤシは「温帯の果樹」「熱帯の果樹」、ジュートは「その他の繊維」に含まれる。
- **農業形態**: 元データの15区分を、放牧中心(LGY/LGA/LGH/LGT)・天水の耕作+家畜(MRY/MRA/MRH/MRT)・灌漑の耕作+家畜(MIY/MIA/MIH/MIT)・森林など(Other)・不適地 の5つにまとめた(都市は数えない)。5分格子144点で最も多い型をそのセルの農業形態、25%以上を占める2番目を「一部」とした。ホイットルセーの農業地域区分(遊牧・混合農業・地中海式農業など)のデジタルデータは公開されているものが見つからなかったため、これを使っている。
- **灌漑の割合**: MapSPAM の灌漑の収穫面積(全作物の合計)÷ 収穫面積の合計。
- **農業地域区分(ホイットルセー)**: ホイットルセー(1936)の農業地域区分を描いた世界地図の画像(利用者が提供、出典・ライセンスは未確認。`data/whittlesey.jpg` に同梱。再生成するときはデータのフォルダに `whittlesey.jpg` としてコピーする)を読み取ったもの。画像をロビンソン図法(縦に引き伸ばし)とみなし、陸と海の形が ETOPO と最もよく重なるように位置合わせし、さらに経度20°×緯度15°の地域ごとにずれを補正した(陸海の一致率94.3%)。各1°セルの位置の7×7ピクセルのうち、凡例の色に十分近いピクセルで最も多い色を14区分に対応させた(黄=遊牧、薄桃=企業的牧畜、茶=焼畑、紫=粗放的定住、濃緑=集約的稲作、薄緑青=集約的畑作、赤=プランテーション、橙=地中海式、肌色=企業的穀物、黄緑=混合、オリーブ=自給的混合、水色=酪農、濃桃=園芸、灰=非農業)。凡例は画像についていなかったので、色と区分の対応は分布から読み取った。海岸や島で読み取れなかったセルは隣から埋めた。位置合わせのずれにより、海岸沿いの細い区分(プランテーション・園芸など)は1〜2セルずれることがある。クイズの農業形態の正解はこれ。
- **農業区分(自作)**: データセットではなく、本アプリが `js/climate.js` の `farmType` の規則で判定したもの。ケッペンの区分・収穫面積の合計・作物の構成・家畜の密度・灌漑の割合・家畜生産システムを使い、教科書のホイットルセー区分に近い13の型(遊牧・企業的牧畜・オアシス農業・焼畑/粗放的定住農業・集約的稲作・集約的畑作・プランテーション・地中海式・企業的穀物・混合・酪農・園芸・非農業)に分ける。自給的か企業的かを表すデータはないので、地域で代用している(南北アメリカ・オセアニア・南部アフリカ=企業的、南〜東アジア=アジア式、ウクライナ〜カザフスタンの黒土地帯=企業的穀物)。教科書の地図と食い違う場所がある。
- **家畜**: 5分格子の頭数を1°セルで合計し、セル面積で割った密度(頭/km²)。
- **大地形**: 元データの「最後の造山運動(lastorogen)」を次のように対応させた。新期造山帯 = Cordilleran, Alpine-Himalayan, Antilles。古期造山帯 = Caledonian, Variscan-Hercynian, Uralian, Tasmanides, Kazakh, Mongol, Indo-Sinian, Scotian。それ以外の大陸地殻 = 安定陸塊。加えて、PB2002 の狭まる境界から1°以内の陸地は新期造山帯とした。この対応づけは本アプリ独自のもの。
- **クイズの正解**: 植生はセルで最も広い区分(2番目に広い区分は半分の点)。農業形態は上のホイットルセーの農業地域区分(近い型は半分の点: 遊牧と企業的牧畜、稲作と畑作、混合・酪農・園芸、焼畑と粗放的定住とプランテーションなど)。作物は収穫面積の上位3つ(0.5%以上)、家畜は密度が基準(牛・羊・ヤギ15頭/km²、豚20頭/km²)以上のもの。しきい値は本アプリで決めたもの。

1°セル(約100km四方)の平均なので、個々の都市の観測値とは一致しない(山がちな地域では標高が平均され、気温が低めになる)。
