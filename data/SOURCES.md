# 地球(実データ)の出典

`data/earth.js` は下のデータを 2°×2°(180×90)に集計したもの。`tools/build_earth_data.py <フォルダ>` で再生成できる(要 numpy, netCDF4)。取得日: 2026-11-11。

| 内容 | データセット | 提供機関 | 期間 | 入手先(保存ファイル名) |
| --- | --- | --- | --- | --- |
| 標高・水深 | ETOPO 2022, 60秒, 氷床表面 (doi:10.25921/fd45-gt74) | NOAA NCEI | — | `https://www.ngdc.noaa.gov/thredds/dodsC/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc.ascii?z[0:20:10799][0:20:21599]` (`etopo2022.txt`) |
| 陸上の気温 | Terrestrial Air Temperature v5.01 (Willmott & Matsuura) | デラウェア大学 / NOAA PSL | 1981–2010 | `https://downloads.psl.noaa.gov/Datasets/udel.airt.precip/air.mon.v501.ltm.1981-2010.nc` (`udel_air.nc`) |
| 陸上の降水量 | Terrestrial Precipitation v5.01 (Willmott & Matsuura) | デラウェア大学 / NOAA PSL | 1981–2010 | `.../udel.airt.precip/precip.mon.v501.ltm.1981-2010.nc` (`udel_precip.nc`) |
| 海面水温 | NOAA OI SST V2 (Reynolds et al. 2002) | NOAA PSL | 1991–2020 | `.../noaa.oisst.v2/sst.ltm.1991-2020.nc` (`oisst.nc`) |
| 海上の降水量・陸の欠損補完 | GPCP v2.3 Monthly (Adler et al. 2018) | NOAA PSL / NASA | 1991–2020 | `.../gpcp/precip.mon.ltm.1991-2020.nc` (`gpcp.nc`) |
| 気温の欠損補完 | NCEP/NCAR Reanalysis 1, 2m気温 (Kalnay et al. 1996) | NOAA PSL | 1991–2020 | `.../ncep.reanalysis.derived/surface_gauss/air.2m.mon.ltm.1991-2020.nc` (`air2m.nc`) |
| 風 | NCEP/NCAR Reanalysis 1, sigma 0.995 の東西風・南北風 | NOAA PSL | 1991–2020 | `.../ncep.reanalysis.derived/surface/{uwnd,vwnd}.sig995.mon.ltm.1991-2020.nc` |
| 海流 | GODAS 深さ5mの流速 (Behringer & Xue 2004) | NOAA NCEP / PSL | 1991–2020 | `https://psl.noaa.gov/thredds/dodsC/Datasets/godas/Derived/{ucur,vcur}.mon.ltm.1991-2020.nc.ascii?…[0:11][0][0:417][0:359]` (`ucur.txt`, `vcur.txt`) |
| プレート境界・相対運動 | PB2002 (Bird 2003, G-cubed, doi:10.1029/2001GC000252) | UCLA | — | `http://peterbird.name/oldFTP/PB2002/PB2002_plates.dig.txt`, `PB2002_poles.dat.txt` |

## 加工の内容

- **標高**: 20分間隔に間引いた値を 2°セルごとに平均。陸の割合が半分以上なら陸セル(陸部分の平均標高)、それ以外は海セル(海部分の平均水深)。
- **気温・降水量**: 陸セルは 0.5°格子の平均。観測格子のない陸セル(南極・グリーンランド内陸など78セル)は、気温を NCEP/NCAR 再解析、降水を GPCP で補完。海セルの気温は海面水温、降水は GPCP。
- **暖流・寒流**: 年平均の海面水温が同緯度の海の平均より 1.2℃以上高く、高緯度へ向かう流れを暖流、1.2℃以上低く低緯度へ向かう流れを寒流として色分け。
- **プレート**: PB2002 の52プレートを高校地理で扱う主要14プレートにまとめた(例: ソマリア→アフリカ、アムール・スンダ・揚子江→ユーラシア、オホーツク→北アメリカ、インド+オーストラリア→インド・オーストラリア)。速度はPB2002のオイラー極(太平洋プレート基準)に、太平洋プレートの絶対運動(NNR-NUVEL-1A, Argus & Gordon 1991: 63.0°S, 107.3°E, 0.641°/100万年)を足して求めた。
- **ケッペンの気候区分・植生**: 上の気温・降水量から本アプリの判定法で計算(既存の気候区分図を読み込んだものではない)。標高2000m以上は高山気候(H)。
- **大地形(安定陸塊・古期/新期造山帯)**: データセットではなく、教科書に載る主な造山帯の位置を手で指定。

2°セルの平均なので、個々の都市の観測値とは一致しない(山がちな地域では標高が平均され、気温が低めになる)。
