#!/usr/bin/env python3
"""実在の地球のデータを 1°グリッド(360×180)に集計して data/earth.js を作る。

使い方: python3 tools/build_earth_data.py <ダウンロード済みデータのフォルダ>
必要なファイル(入手先は data/SOURCES.md):
  etopo2022.txt  udel_air.nc  udel_precip.nc  oisst.nc  air2m.nc  gpcp.nc
  uwnd.nc  vwnd.nc  ucur.txt  vcur.txt  pb_plates.txt  pb_poles.txt
  whittlesey.jpg  potveg.asc.gz  lps/glps_gleam_61113_10km.tif  spam/spam.zip  gaez/Olives.tif gaez/Foddercrops.tif  cattle.tif sheep.tif goats.tif pigs.tif  gprv.shp/.dbf/.shx
"""
import base64, gzip, json, math, os, re, sys
import numpy as np
import netCDF4
import rasterio, shapefile

R = sys.argv[1].rstrip('/') + '/'
W, H = 360, 180
LAT = 89.5 - np.arange(H)            # セル中心の緯度
LON = -179.5 + np.arange(W)          # セル中心の経度
DAYS = np.array([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])


def to_grid(lat, lon, a):
    """(…, lat, lon) の格子を、緯度=北→南・経度=-180→180 に並べ替える"""
    a = np.ma.filled(np.ma.masked_invalid(np.ma.array(a, dtype=float)), np.nan)
    if lat[0] < lat[-1]:
        a = a[..., ::-1, :]; lat = lat[::-1]
    lon = np.where(lon > 180, lon - 360, lon)
    o = np.argsort(lon)
    return lat, lon[o], a[..., o]


def block_mean(a, fy, fx):
    """整数倍で粗くする(欠損は除いて平均)。a: (..., H*fy, W*fx)"""
    s = a.shape[:-2] + (H, fy, W, fx)
    with np.errstate(invalid='ignore'):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            return np.nanmean(a.reshape(s), axis=(-3, -1))


def sample(lat, lon, a):
    """粗い格子を 1°セル中心へ双線形補間(経度は周期、欠損は無視)"""
    out = np.full(a.shape[:-2] + (H, W), np.nan)
    dlat = lat[0] - lat[1]; dlon = lon[1] - lon[0]
    for y in range(H):
        fy = np.clip((lat[0] - LAT[y]) / dlat, 0, len(lat) - 1); y0 = int(math.floor(fy)); y1 = min(y0 + 1, len(lat) - 1); ty = fy - y0
        for x in range(W):
            fx = ((LON[x] - lon[0]) / dlon) % len(lon); x0 = int(math.floor(fx)) % len(lon); x1 = (x0 + 1) % len(lon); tx = fx - math.floor(fx)
            v = np.stack([a[..., y0, x0], a[..., y0, x1], a[..., y1, x0], a[..., y1, x1]])
            wt = np.array([(1 - ty) * (1 - tx), (1 - ty) * tx, ty * (1 - tx), ty * tx]).reshape((4,) + (1,) * (v.ndim - 1))
            ok = ~np.isnan(v); ws = (wt * ok).sum(0)
            with np.errstate(invalid='ignore', divide='ignore'):
                out[..., y, x] = np.where(ws > 0, np.nansum(v * wt, 0) / ws, np.nan)
    return out


def nc(name, var):
    d = netCDF4.Dataset(R + name)
    return to_grid(np.array(d['lat'][:], dtype=float), np.array(d['lon'][:], dtype=float), d[var][:])


def dods_ascii(name):
    """THREDDS/OPeNDAP の .ascii 出力を読む → {変数名: 配列}"""
    out, cur, rows = {}, None, []
    for line in open(R + name):
        m = re.match(r'^(\w+)\.(\w+)((\[\d+\])+)\s*$', line)
        if m:
            if cur: out[cur] = np.array(rows, dtype=float)
            cur, rows = m.group(2), []; continue
        if cur is None or not line.strip(): continue
        if line.startswith('['):
            rows.append([float(v) for v in line.split(',')[1:] if v.strip()])
        else:
            rows.append([float(v) for v in line.split(',') if v.strip()])
    if cur: out[cur] = np.array(rows, dtype=float)
    return out


# ---------- 標高・水深: NOAA ETOPO 2022 (氷床表面) ----------
e = dods_ascii('etopo2022.txt')
lat, lon, z = to_grid(e['lat'].ravel(), e['lon'].ravel(), e['z'])   # 10分間隔 1080×2160
z6 = z.reshape(H, 6, W, 6)
landfrac = (z6 > 0).mean(axis=(1, 3))
land = landfrac >= 0.5
with np.errstate(invalid='ignore'):
    import warnings
    warnings.simplefilter('ignore')
    eland = np.nanmean(np.where(z6 > 0, z6, np.nan), axis=(1, 3))
    esea = np.nanmean(np.where(z6 <= 0, z6, np.nan), axis=(1, 3))
elev = np.where(land, np.maximum(eland, 1), np.minimum(esea, -1))

# ---------- 気温 ----------
_, _, t_udel = nc('udel_air.nc', 'air')          # 陸上 0.5° (℃)
_, _, p_udel = nc('udel_precip.nc', 'precip')    # 陸上 0.5° (cm/月)
t_land = block_mean(t_udel, 2, 2); p_land = block_mean(p_udel, 2, 2) * 10
_, _, sst = nc('oisst.nc', 'sst')                # 海面水温 1° (℃)
t_sea = block_mean(sst, 1, 1)
la, lo, a2 = nc('air2m.nc', 'air'); t_ncep = sample(la, lo, a2) - 273.15   # 再解析 2m気温(欠損の補完用)
la, lo, gp = nc('gpcp.nc', 'precip'); p_gpcp = sample(la, lo, gp) * DAYS[:, None, None]  # mm/日 → mm/月

T = np.where(land, t_land, t_sea)
src_t = np.where(land, 1, 2) * np.ones((12, 1, 1), dtype=int)
miss = np.isnan(T)
# 陸セルで観測格子がない(南極・グリーンランド内陸など)/海セルで海面水温がない所は再解析で補う
T = np.where(miss, t_ncep, T); src_t = np.where(miss, 3, src_t)
P = np.where(land, p_land, p_gpcp)
missp = np.isnan(P); P = np.where(missp, p_gpcp, P)
print('陸セル', int(land.sum()), '気温を再解析で補完した陸セル', int((miss[0] & land).sum()), '降水をGPCPで補完した陸セル', int((missp[0] & land).sum()))
assert not np.isnan(T).any() and not np.isnan(P).any()

# ---------- 風: NCEP/NCAR 再解析 地表付近(sigma 0.995) ----------
la, lo, u = nc('uwnd.nc', 'uwnd'); wu = sample(la, lo, u)
la, lo, v = nc('vwnd.nc', 'vwnd'); wv = sample(la, lo, v)

# ---------- 海流: NOAA GODAS 深さ5m, 月別平年値の年平均 ----------
def godas(name, var):
    d = dods_ascii(name)
    a = d[var].reshape(12, 418, 360); a[np.abs(a) > 1e30] = np.nan
    return to_grid(d['lat'].ravel(), d['lon'].ravel(), np.nanmean(a, axis=0))
gl, go, gu = godas('ucur.txt', 'ucur'); _, _, gv = godas('vcur.txt', 'vcur')
cu = np.zeros((H, W)); cv = np.zeros((H, W))
for y in range(H):
    ys = np.where(np.abs(gl - LAT[y]) <= 0.5)[0]
    for x in range(W):
        xs = np.where(np.abs(go - LON[x]) <= 0.5)[0]
        if len(ys) and len(xs):
            a = gu[np.ix_(ys, xs)]; b = gv[np.ix_(ys, xs)]
            if np.isfinite(a).any(): cu[y, x] = np.nanmean(a); cv[y, x] = np.nanmean(b)
# 暖流・寒流: 同じ緯度の海の平均水温との差
sst_ann = np.where(land, np.nan, T.mean(axis=0))
zonal = np.nanmean(sst_ann, axis=1, keepdims=True)
sst_anom = np.nan_to_num(sst_ann - zonal)

# ---------- プレート: Bird (2003) PB2002 ----------
polys, name, pts = [], None, []
for line in open(R + 'pb_plates.txt'):
    s = line.strip()
    if s.startswith('***'):
        polys.append((name, np.array(pts))); name, pts = None, []
    elif name is None: name = s
    elif s:
        a, b = s.split(','); pts.append((float(a), float(b)))
def xyz(lon, lat):
    lo, la = np.radians(lon), np.radians(lat)
    return np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], axis=-1)
LON2, LAT2 = np.meshgrid(LON, LAT)
Pc = xyz(LON2.ravel(), LAT2.ravel())                     # セル中心
orig = np.full(W * H, -1)
for k, (nm, pp) in enumerate(polys):
    # プレートの重心を中心とする正距方位図法に投影し、平面上で内外判定(日付変更線や極をまたぐプレートも扱える)
    V = xyz(pp[:, 0], pp[:, 1]); c = V.mean(0); c /= np.linalg.norm(c)
    ax = np.cross([0, 0, 1.0], c); ax = ax / np.linalg.norm(ax) if np.linalg.norm(ax) > 1e-9 else np.array([1.0, 0, 0]); ay = np.cross(c, ax)
    def proj(Q):
        d = np.arccos(np.clip(Q @ c, -1, 1)); az = np.arctan2(Q @ ay, Q @ ax)
        return d * np.cos(az), d * np.sin(az)
    vx_, vy_ = proj(V); px, py = proj(Pc)
    inside = np.zeros(W * H, dtype=bool)
    for i in range(len(vx_)):
        x1, y1, x2, y2 = vx_[i], vy_[i], vx_[(i + 1) % len(vx_)], vy_[(i + 1) % len(vx_)]
        if y1 == y2: continue
        cond = ((y1 > py) != (y2 > py)) & (px < (x2 - x1) * (py - y1) / (y2 - y1) + x1)
        inside ^= cond
    orig[inside & (orig < 0)] = k
print('どのプレートにも入らなかったセル', int((orig < 0).sum()))
g = orig.reshape(H, W)
while (g < 0).any():   # 境界上などで漏れたセルは隣から埋める
    for y, x in zip(*np.where(g < 0)):
        for yy, xx in ((y, (x + 1) % W), (y, (x - 1) % W), (max(y - 1, 0), x), (min(y + 1, H - 1), x)):
            if g[yy, xx] >= 0: g[y, x] = g[yy, xx]; break
orig = g.ravel()
codes = [p[0] for p in polys]
poles = {}
for line in open(R + 'pb_poles.txt'):
    m = re.match(r'^([A-Z]{2})\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)', line)
    if m: poles[m.group(1)] = xyz(float(m.group(3)), float(m.group(2))) * math.radians(float(m.group(4)))   # rad/100万年, 太平洋プレート基準
# 太平洋プレートの絶対運動(NNR-NUVEL-1A: 63.0°S 107.3°E 0.641°/100万年)を足して、地球全体での回転がない基準にする
PA_ABS = xyz(107.33, -63.04) * math.radians(0.6408)
om = np.array([poles[codes[k]] + PA_ABS for k in orig])
vel = np.cross(om, Pc) * 6371.0 / 10                     # km/100万年 = mm/年 → cm/年
lo_r, la_r = np.radians(LON2.ravel()), np.radians(LAT2.ravel())
east = np.stack([-np.sin(lo_r), np.cos(lo_r), np.zeros_like(lo_r)], -1)
north = np.stack([-np.sin(la_r) * np.cos(lo_r), -np.sin(la_r) * np.sin(lo_r), np.cos(la_r)], -1)
pvx = (vel * east).sum(1); pvy = (vel * north).sum(1)

# 高校地理で扱う主要プレートにまとめる(小プレートは隣接する主要プレートへ)
MERGE = {'SO': 'AF', 'AM': 'EU', 'YA': 'EU', 'SU': 'EU', 'AS': 'EU', 'AT': 'EU', 'OK': 'NA', 'ND': 'SA', 'AP': 'SA', 'PM': 'CA', 'RI': 'CO', 'MA': 'PS', 'SL': 'AN', 'SW': 'SC', 'IN': 'AU', 'BU': 'EU'}
NAMES = {'AF': 'アフリカプレート', 'AN': '南極プレート', 'AR': 'アラビアプレート', 'AU': 'インド・オーストラリアプレート', 'CA': 'カリブプレート', 'CO': 'ココスプレート',
         'EU': 'ユーラシアプレート', 'NA': '北アメリカプレート', 'NZ': 'ナスカプレート', 'PA': '太平洋プレート', 'PS': 'フィリピン海プレート', 'SA': '南アメリカプレート', 'SC': 'スコシアプレート', 'JF': 'ファンデフカプレート'}
lab = np.array([MERGE.get(codes[k], codes[k]) for k in orig]).reshape(H, W)
while True:   # 主要プレート以外・小さすぎるものは、最も長く接する隣へ
    ids, cnt = np.unique(lab, return_counts=True)
    small = [i for i, c in zip(ids, cnt) if i not in NAMES or c < 24]
    if not small: break
    sm = min(small, key=lambda i: cnt[list(ids).index(i)])
    m = lab == sm; adj = {}
    for nb in (np.roll(lab, 1, 1), np.roll(lab, -1, 1), np.vstack([lab[:1], lab[:-1]]), np.vstack([lab[1:], lab[-1:]])):
        for v in nb[m & (nb != sm)]: adj[v] = adj.get(v, 0) + 1
    lab[m] = max(adj, key=adj.get)
ids, cnt = np.unique(lab, return_counts=True)
order = [i for _, i in sorted(zip(-cnt, ids))]
plate = np.array([order.index(v) for v in lab.ravel()], dtype=np.uint8)
plates = []
for k, c in enumerate(order):
    m = plate == k; vx, vy = pvx[m].mean(), pvy[m].mean()
    plates.append({'code': c, 'name': NAMES[c], 'dir': int(round(math.degrees(math.atan2(vx, vy)) / 45) * 45 % 360), 'speed': round(float(np.hypot(pvx[m], pvy[m]).mean()), 1)})
print('プレート', [(p['name'], int((plate == k).sum()), p['dir'], p['speed']) for k, p in enumerate(plates)])

# ---------- 植生: SAGE Global Potential Vegetation (Ramankutty & Foley 1999), 5分格子・15区分 ----------
with gzip.open(R + 'potveg.asc.gz', 'rt') as f:
    hdr = [f.readline().split() for _ in range(6)]
    pv = np.loadtxt(f, dtype=np.int16)                 # 北→南, 西→東
assert pv.shape == (2160, 4320), pv.shape
pv6 = pv.reshape(H, 12, W, 12).transpose(0, 2, 1, 3).reshape(H, W, 144)
veg = np.zeros((H, W), dtype=np.uint8); veg2 = np.zeros((H, W), dtype=np.uint8)
for y in range(H):
    for x in range(W):
        v = pv6[y, x]; v = v[(v >= 1) & (v <= 15)]
        if len(v) < 36: continue                         # データのある部分が1/4未満なら「なし」
        c = np.bincount(v, minlength=16); o = np.argsort(-c)
        veg[y, x] = o[0]
        if c[o[1]] >= 0.25 * len(v): veg2[y, x] = o[1]   # 2番目に広い区分(25%以上を占める場合)
print('植生データのある陸セル', int(((veg > 0) & land).sum()), '/', int(land.sum()), '区分別', np.bincount(veg[land].ravel(), minlength=16).tolist())

# ---------- 作物: MapSPAM 2020 V2r2 収穫面積 (IFPRI 2024), 5分格子・ha。オリーブと飼料作物だけ GAEZ+ 2015 (1000ha) ----------
lat_edge = np.radians(90 - np.arange(H + 1))
cell_km2 = (6371.0 ** 2) * np.radians(1.0) * (np.sin(lat_edge[:-1]) - np.sin(lat_edge[1:]))   # 1°セルの面積
def agg5(a):
    a = a.astype(float); assert a.shape == (2160, 4320)
    a[~np.isfinite(a)] = 0; a[a < 0] = 0
    return a.reshape(H, 12, W, 12).sum(axis=(1, 3))
def tif5(path):
    with rasterio.open(path) as d:
        assert abs(d.bounds.top - 90) < 1e-3 and abs(d.bounds.left + 180) < 1e-3
        return agg5(d.read(1))
# アプリでの作物名 → MapSPAM の作物コード(複数は合計)
SPAM = {'Wheat': ['WHEA'], 'Rice': ['RICE'], 'Maize': ['MAIZ'], 'Barley': ['BARL'], 'Othercereals': ['OCER'], 'Millet': ['MILL', 'PMIL'], 'Sorghum': ['SORG'],
        'Potato': ['POTA'], 'Sweetpotato': ['SWPO'], 'Cassava': ['CASS'], 'Yams': ['YAMS', 'ORTS'], 'Sugarcane': ['SUGC'], 'Sugarbeet': ['SUGB'], 'Soybean': ['SOYB'],
        'Pulses': ['BEAN', 'CHIC', 'COWP', 'PIGE', 'LENT', 'OPUL'], 'Rapeseed': ['RAPE'], 'Sunflower': ['SUNF'], 'Groundnut': ['GROU'], 'Sesame': ['SESA'], 'Oilpalm': ['OILP'], 'Coconut': ['CNUT'],
        'Cotton': ['COTT'], 'Otherfibre': ['OFIB'], 'Coffee': ['COFF', 'RCOF'], 'Cocoa': ['COCO'], 'Tea': ['TEAS'], 'Rubber': ['RUBB'], 'Tobacco': ['TOBA'], 'Banana': ['BANA', 'PLNT'],
        'Citrus': ['CITR'], 'Tropicalfruit': ['TROF'], 'Temperatefruit': ['TEMF'], 'Vegetables': ['TOMA', 'ONIO', 'VEGE'], 'Othercrops': ['OOIL', 'REST']}
GAEZ = {'Olives': 'Olives', 'Fodder': 'Foddercrops'}   # MapSPAM にない区分
CROPS = list(SPAM) + list(GAEZ)
import zipfile
from rasterio.io import MemoryFile
zf = zipfile.ZipFile(R + 'spam/spam.zip'); znames = zf.namelist()
crop_frac = np.zeros((len(CROPS), H, W))
for k, c in enumerate(CROPS):
    if c in SPAM:
        for code in SPAM[c]:
            n = [x for x in znames if x.endswith('_H_' + code + '_A.tif')]; assert len(n) == 1, code
            with MemoryFile(zf.read(n[0])) as mf, mf.open() as d:
                assert abs(d.bounds.top - 90) < 1e-3 and abs(d.bounds.left + 180) < 1e-3
                crop_frac[k] += agg5(d.read(1)) / 100.0 / cell_km2[:, None]      # ha → km² → セル面積に対する割合
    else:
        crop_frac[k] = tif5(R + 'gaez/' + GAEZ[c] + '.tif') * 10.0 / cell_km2[:, None]   # 1000ha=10km²
# 灌漑の割合: MapSPAM の灌漑(_I)の収穫面積 ÷ 合計(_A)
irr_ha = np.zeros((H, W)); all_ha = np.zeros((H, W))
for n in znames:
    if n.endswith('_I.tif') or n.endswith('_A.tif'):
        with MemoryFile(zf.read(n)) as mf, mf.open() as d:
            v = agg5(d.read(1))
        if n.endswith('_I.tif'): irr_ha += v
        else: all_ha += v
irr = np.where(all_ha > 0, irr_ha / np.maximum(all_ha, 1e-9), 0)
print('灌漑の割合(世界平均)', round(float(irr_ha.sum() / all_ha.sum()), 3))
# 合計にはオリーブを入れない(MapSPAM の「その他」に含まれるため二重に数えない)
crop_all = crop_frac[[k for k, c in enumerate(CROPS) if c != 'Olives']].sum(axis=0)
print('作物の世界合計(100万ha):', {c: round(float((crop_frac[k] * cell_km2[:, None]).sum() / 1e4), 1) for k, c in enumerate(CROPS)})

# ---------- 家畜: FAO Gridded Livestock of the World 2015 (GLW 4, Gilbert et al. 2018), 5分格子・頭数 ----------
STOCK = ['cattle', 'sheep', 'goats', 'pigs']
stock = np.stack([tif5(R + n + '.tif') / cell_km2[:, None] for n in STOCK])      # 頭/km²
print('家畜の世界合計(億頭):', {n: round(float((stock[k] * cell_km2[:, None]).sum() / 1e8), 2) for k, n in enumerate(STOCK)})

# ---------- 農業形態: FAO/ILRI Global livestock production systems v5 (Robinson et al. 2011/2018), 5分格子 ----------
# 元の15区分を 1=放牧中心(LG) 2=天水の混合農業(MR) 3=灌漑の混合農業(MI) 4=森林など(Other) 5=不適地 にまとめる。都市は数えない
with rasterio.open(R + 'lps/glps_gleam_61113_10km.tif') as d:
    lp = d.read(1); assert lp.shape == (2160, 4320)
GRP = np.array([0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 0, 4, 5], dtype=np.uint8)
lg = GRP[lp].reshape(H, 12, W, 12).transpose(0, 2, 1, 3).reshape(H, W, 144)
lps = np.zeros((H, W), dtype=np.uint8); lps2 = np.zeros((H, W), dtype=np.uint8)
for y in range(H):
    for x in range(W):
        v = lg[y, x]; v = v[v > 0]
        if len(v) < 36: continue
        c = np.bincount(v, minlength=6); o = np.argsort(-c)
        lps[y, x] = o[0]
        if c[o[1]] >= 0.25 * len(v): lps2[y, x] = o[1]
print('農業形態(陸セル) なし/放牧/天水混合/灌漑混合/森林など/不適地', np.bincount(lps[land].ravel(), minlength=6).tolist())

# ---------- 農業地域区分: ホイットルセー(1936)の区分図の画像を読み取る ----------
# 画像はロビンソン図法(縦に引き伸ばし)。陸海の形が ETOPO と最もよく重なるように位置合わせしてから、色を区分に直す
from PIL import Image
wim = np.array(Image.open(R + 'whittlesey.jpg').convert('RGB')).astype(int); WIH, WIW = wim.shape[:2]
WPAL = {'ocean': (12, 156, 252), 'white': (255, 255, 255), 'water': (204, 252, 252), 'border': (140, 90, 160),
        'nomad': (252, 252, 60), 'ranch': (252, 204, 252), 'shifting': (204, 108, 12), 'sedentary': (160, 64, 252), 'rice': (60, 204, 12), 'upland': (156, 252, 204),
        'plantation': (252, 60, 100), 'medit': (252, 156, 60), 'grain': (252, 204, 156), 'mixed': (156, 252, 108), 'substock': (156, 204, 12), 'dairy': (12, 204, 252),
        'horti': (252, 60, 204), 'none': (156, 156, 156)}
WN = list(WPAL); WP = np.array([WPAL[n] for n in WN])
wcls = ((wim.reshape(-1, 1, 3) - WP) ** 2).sum(-1).argmin(-1).reshape(WIH, WIW)
wland = ~np.isin(wcls, [0, 1, 3])
RLT = np.arange(0, 91, 5)
RX = np.array([1, .9986, .9954, .99, .9822, .973, .96, .9427, .9216, .8962, .8679, .835, .7986, .7597, .7186, .6732, .6213, .5722, .5322])
RY = np.array([0, .0620, .1240, .1860, .2480, .3100, .3720, .4340, .4958, .5571, .6176, .6769, .7346, .7903, .8435, .8936, .9394, .9761, 1])
WLA, WLO = np.meshgrid(LAT, LON, indexing='ij')
def wproj(q):
    dl = ((WLO - q[4] + 180) % 360) - 180
    return q[0] + q[1] * np.interp(np.abs(WLA), RLT, RX) * dl / 180, q[2] - q[3] * np.interp(np.abs(WLA), RLT, RY) * np.sign(WLA)
def wscore(q):
    x, y = wproj(q); xi = np.round(x).astype(int); yi = np.round(y).astype(int)
    ok = (xi >= 0) & (xi < WIW) & (yi >= 0) & (yi < WIH) & (np.abs(WLA) < 72)
    a = np.zeros_like(land); a[ok] = wland[yi[ok], xi[ok]]
    return ((a == land) & ok).sum() / ok.sum()
sc = WIW / 2000.0
q = np.array([1000 * sc, 935 * sc, 590 * sc, 591 * sc, 10.0]); best = wscore(q); step = np.array([20, 20, 20, 20, 4.0])
while step[0] >= 0.25:
    moved = False
    for k in range(5):
        for sg in (1, -1):
            t = q.copy(); t[k] += sg * step[k]; v = wscore(t)
            if v > best: best, q, moved = v, t, True
    if not moved: step /= 2
print('農業地域区分図の位置合わせ: 陸海の一致率', round(float(best), 4), 'パラメータ', np.round(q, 1).tolist())
wx, wy = wproj(q)
# 図法が完全なロビンソン図法ではないので、地域ごと(経度20°×緯度15°)に陸海の形が最もよく合うずれを求めて補正する
tla = np.arange(-52.5, 83, 15); tlo = np.arange(-170, 181, 20)
sdx = np.full((len(tla), len(tlo)), np.nan); sdy = sdx.copy()
for a_, la0 in enumerate(tla):
    for b_, lo0 in enumerate(tlo):
        dlo = ((WLO - lo0 + 180) % 360) - 180
        m = (np.abs(WLA - la0) <= 15) & (np.abs(dlo) <= 20)
        lm = land[m]
        if lm.sum() < 40 or (~lm).sum() < 40: continue          # 海岸線がないと合わせられない
        bx, by, bv = 0, 0, -1
        for dy in range(-14, 15, 2):
            for dx in range(-14, 15, 2):
                xi = np.clip(np.round(wx[m] + dx).astype(int), 0, WIW - 1); yi = np.clip(np.round(wy[m] + dy).astype(int), 0, WIH - 1)
                v = (wland[yi, xi] == lm).mean() - 0.0004 * (dx * dx + dy * dy) ** 0.5
                if v > bv: bx, by, bv = dx, dy, v
        sdx[a_, b_] = bx; sdy[a_, b_] = by
def fill_smooth(g):
    g = g.copy()
    for _ in range(8):   # 求められなかった所は周りの平均で埋める
        nanm = np.isnan(g)
        if not nanm.any(): break
        pad = np.pad(g, 1, mode='edge'); stack = np.stack([pad[1:-1, :-2], pad[1:-1, 2:], pad[:-2, 1:-1], pad[2:, 1:-1]])
        with np.errstate(invalid='ignore'):
            import warnings; warnings.simplefilter('ignore'); mean = np.nanmean(stack, axis=0)
        g[nanm] = mean[nanm]
    g = np.nan_to_num(g)
    pad = np.pad(g, 1, mode='edge')
    return (pad[1:-1, 1:-1] * 2 + pad[1:-1, :-2] + pad[1:-1, 2:] + pad[:-2, 1:-1] + pad[2:, 1:-1]) / 6
sdx = fill_smooth(sdx); sdy = fill_smooth(sdy)
def interp_shift(g):
    fa = np.clip((WLA - tla[0]) / 15, 0, len(tla) - 1); fb = np.clip((WLO - tlo[0]) / 20, 0, len(tlo) - 1)
    a0 = np.floor(fa).astype(int); b0 = np.floor(fb).astype(int); a1 = np.minimum(a0 + 1, len(tla) - 1); b1 = np.minimum(b0 + 1, len(tlo) - 1)
    ta = fa - a0; tb = fb - b0
    return (g[a0, b0] * (1 - tb) + g[a0, b1] * tb) * (1 - ta) + (g[a1, b0] * (1 - tb) + g[a1, b1] * tb) * ta
wx = wx + interp_shift(sdx); wy = wy + interp_shift(sdy)
wxi = np.clip(np.round(wx).astype(int), 0, WIW - 1); wyi = np.clip(np.round(wy).astype(int), 0, WIH - 1)
okm = np.abs(WLA) < 72
print('地域ごとの補正後: 陸海の一致率', round(float((wland[wyi, wxi] == land)[okm].mean()), 4), '補正量(px)の最大', round(float(np.abs(sdx).max()), 1), round(float(np.abs(sdy).max()), 1))
# 境界や海岸のにじんだ色は使わない(凡例色に十分近いピクセルだけ数える)
wdist = ((wim.reshape(-1, 1, 3) - WP) ** 2).sum(-1).min(-1).reshape(WIH, WIW)
wpure = np.where(wdist <= 1800, wcls, 0)
whit = np.zeros((H, W), dtype=np.uint8)   # 0=読み取れず, 1..14 = WN[4:] の順
for y in range(H):
    for x in range(W):
        if not land[y, x] or abs(LAT[y]) > 80: continue
        v = wpure[max(0, wyi[y, x] - 3):wyi[y, x] + 4, max(0, wxi[y, x] - 3):wxi[y, x] + 4].ravel()
        c = np.bincount(v, minlength=len(WN)); c[:4] = 0
        if c.sum() >= 6: whit[y, x] = c.argmax() - 3
direct = int((whit > 0).sum())
for _ in range(8):   # 海岸や島で読み取れなかった陸セルは、隣(上下左右)の読み取れたセルから埋める
    src = whit.copy()
    for y, x in zip(*np.where(land & (src == 0) & (np.abs(LAT)[:, None] <= 80))):
        nb = [src[y, (x + 1) % W], src[y, (x - 1) % W], src[max(y - 1, 0), x], src[min(y + 1, H - 1), x]]
        nb = [v for v in nb if v]
        if nb: whit[y, x] = max(set(nb), key=nb.count)
print('農業地域区分: 直接読み取れた陸セル', direct, '隣から埋めた後', int((whit > 0).sum()), '/', int(land.sum()), '区分別', np.bincount(whit[land].ravel(), minlength=15).tolist())

# ---------- 大地形: Hasterok et al. (2022) Global geologic provinces ----------
# 最後の造山運動(lastorogen)を高校地理の3区分に対応させる。1=新期造山帯 2=古期造山帯 0=安定陸塊(その他の大陸地殻)・海洋
NEW = {'Cordilleran', 'Alpine-Himalayan', 'Antilles'}
OLD = {'Caledonian', 'Variscan-Hercynian', 'Uralian', 'Tasmanides', 'Tasmanide', 'Kazakh', 'Mongol', 'Indo-Sinian', 'Scotian'}
sf = shapefile.Reader(R + 'gprv')
fn = [f[0] for f in sf.fields[1:]]
oro = np.zeros((H, W), dtype=np.uint8)
for sr in sf.iterShapeRecords():
    rec = dict(zip(fn, sr.record)); cls = 1 if rec['lastorogen'] in NEW else 2 if rec['lastorogen'] in OLD else 0
    if not cls or rec['crust_type'] == 'oceanic': continue
    pts = np.array(sr.shape.points); parts = list(sr.shape.parts) + [len(pts)]
    x0, y0, x1, y1 = sr.shape.bbox
    xs = np.where((LON >= x0) & (LON <= x1))[0]; ys = np.where((LAT >= y0) & (LAT <= y1))[0]
    if not len(xs) or not len(ys): continue
    px, py = np.meshgrid(LON[xs], LAT[ys]); inside = np.zeros(px.shape, dtype=bool)
    for a, b in zip(parts[:-1], parts[1:]):
        r = pts[a:b]; xa, ya = r[:-1, 0], r[:-1, 1]; xb, yb = r[1:, 0], r[1:, 1]
        for i in range(len(xa)):
            if ya[i] == yb[i]: continue
            inside ^= ((ya[i] > py) != (yb[i] > py)) & (px < (xb[i] - xa[i]) * (py - ya[i]) / (yb[i] - ya[i]) + xa[i])
    sub = oro[np.ix_(ys, xs)]; sub[inside] = cls; oro[np.ix_(ys, xs)] = sub
oro[~land] = 0
print('大地形(陸セル): 安定陸塊ほか', int((land & (oro == 0)).sum()), '新期', int((oro == 1).sum()), '古期', int((oro == 2).sum()))

# ---------- 書き出し ----------
fields = [
    ('elev', 'i2', np.round(elev)),
    ('plate', 'u1', plate),
    ('pvx', 'i1', np.clip(np.round(pvx * 10), -127, 127)), ('pvy', 'i1', np.clip(np.round(pvy * 10), -127, 127)),   # 0.1 cm/年
    ('T', 'i2', np.round(T * 10)),                                   # 0.1 ℃, [月][y][x]
    ('P', 'u2', np.clip(np.round(P), 0, 65535)),                     # mm/月
    ('wu', 'i1', np.clip(np.round(wu * 10), -127, 127)), ('wv', 'i1', np.clip(np.round(wv * 10), -127, 127)),       # 0.1 m/s
    ('cu', 'i1', np.clip(np.round(cu * 200), -127, 127)), ('cv', 'i1', np.clip(np.round(cv * 200), -127, 127)),     # 0.5 cm/s
    ('sstA', 'i1', np.clip(np.round(sst_anom * 10), -127, 127)),     # 0.1 ℃
    ('veg', 'u1', veg), ('veg2', 'u1', veg2), ('oro', 'u1', oro), ('lps', 'u1', lps), ('lps2', 'u1', lps2), ('whit', 'u1', whit),
    ('crop', 'u1', np.clip(np.round(np.sqrt(crop_frac) * 255), 0, 255)),      # 割合 = (値/255)², [作物][y][x]
    ('irr', 'u1', np.clip(np.round(irr * 255), 0, 255)),                      # 灌漑の割合 = 値/255
    ('cropAll', 'u1', np.clip(np.round(np.sqrt(crop_all) * 180), 0, 255)),    # 収穫面積の合計の割合 = (値/180)²
    ('stock', 'u1', np.clip(np.round(np.sqrt(stock) * 8), 0, 255)),           # 頭/km² = (値/8)², [家畜][y][x]
]
NP = {'i1': 'i1', 'u1': 'u1', 'i2': '<i2', 'u2': '<u2'}
blob = b''.join(np.ascontiguousarray(a, dtype=NP[dt]).tobytes() for _, dt, a in fields)
out = {'W': W, 'H': H, 'plates': plates, 'crops': CROPS, 'stock': STOCK, 'whit': WN[4:], 'layout': [[n, dt, int(np.asarray(a).size)] for n, dt, a in fields],
       'gz': base64.b64encode(gzip.compress(blob, 9, mtime=0)).decode()}
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'earth.js')
os.makedirs(os.path.dirname(dst), exist_ok=True)
with open(dst, 'w') as f:
    f.write('/* 実在の地球の観測・解析データ(1°グリッド、gzip圧縮)。tools/build_earth_data.py が生成。出典は data/SOURCES.md */\n')
    f.write('(typeof window !== "undefined" ? window : globalThis).EARTH_DATA = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
print('書き出し', os.path.getsize(dst), 'bytes (展開後', len(blob), 'bytes)')

# ---------- 検算: 実在都市の値 ----------
def cell(la_, lo_):
    y = int(round(89.5 - la_)); x = int(round(lo_ + 179.5)) % W
    if not land[y, x]:
        best = None
        for dy in range(-1, 2):
            for dx in range(-1, 2):
                yy, xx = y + dy, (x + dx) % W
                if 0 <= yy < H and land[yy, xx] and (best is None or abs(dy) + abs(dx) < best[0]): best = (abs(dy) + abs(dx), yy, xx)
        if best: y, x = best[1], best[2]
    return y, x
def show(nm, la_, lo_):
    y, x = cell(la_, lo_)
    top = sorted([(crop_frac[k, y, x], CROPS[k]) for k in range(len(CROPS))], reverse=True)[:3]
    print(f'{nm}: 植生{veg[y, x]}/{veg2[y, x]} 農業形態{lps[y, x]}/{lps2[y, x]} 大地形{oro[y, x]} 作物' + ' '.join(f'{n}{v * 100:.1f}%' for v, n in top) + ' 家畜(頭/km²)' + ' '.join(f'{n}{stock[k, y, x]:.0f}' for k, n in enumerate(STOCK)))
for nm, la_, lo_ in [('モンゴル', 46.5, 103.5), ('ナイル河口', 30.5, 31.5), ('アイオワ', 42, -93.5), ('パンジャブ', 30.5, 75.5), ('マナオス', -3, -60), ('ニジェール内陸', 14, 8), ('ウラル', 58, 59.5), ('アルプス', 46.5, 10), ('NZ南島', -44.5, 170.5)]:
    show(nm, la_, lo_)
for nm, la_, lo_ in [('東京', 35.7, 139.7), ('ロンドン', 51.5, -0.1), ('シンガポール', 1.3, 103.8), ('カイロ', 30, 31.2), ('モスクワ', 55.8, 37.6), ('ローマ', 41.9, 12.5), ('ヤクーツク', 62, 129.7), ('ブエノスアイレス', -34.6, -58.4), ('ラサ', 29.7, 91.1), ('昭和基地付近', -70, 40)]:
    y, x = cell(la_, lo_)
    print(f'{nm}: 標高{elev[y, x]:.0f}m 1月{T[0, y, x]:.1f}℃ 7月{T[6, y, x]:.1f}℃ 年降水{P[:, y, x].sum():.0f}mm')
