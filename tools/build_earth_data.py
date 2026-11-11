#!/usr/bin/env python3
"""実在の地球のデータを 2°グリッド(180×90)に集計して data/earth.js を作る。

使い方: python3 tools/build_earth_data.py <ダウンロード済みデータのフォルダ>
必要なファイル(入手先は data/SOURCES.md):
  etopo2022.txt  udel_air.nc  udel_precip.nc  oisst.nc  air2m.nc  gpcp.nc
  uwnd.nc  vwnd.nc  ucur.txt  vcur.txt  pb_plates.txt  pb_poles.txt
"""
import base64, json, math, os, re, sys
import numpy as np
import netCDF4

R = sys.argv[1].rstrip('/') + '/'
W, H = 180, 90
LAT = 89 - 2 * np.arange(H)          # セル中心の緯度
LON = -179 + 2 * np.arange(W)        # セル中心の経度
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
    """粗い格子を 2°セル中心へ双線形補間(経度は周期、欠損は無視)"""
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
lat, lon, z = to_grid(e['lat'].ravel(), e['lon'].ravel(), e['z'])   # 20分間隔 540×1080
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
t_land = block_mean(t_udel, 4, 4); p_land = block_mean(p_udel, 4, 4) * 10
_, _, sst = nc('oisst.nc', 'sst')                # 海面水温 1° (℃)
t_sea = block_mean(sst, 2, 2)
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
    ys = np.where(np.abs(gl - LAT[y]) <= 1)[0]
    for x in range(W):
        xs = np.where(np.abs(go - LON[x]) <= 1)[0]
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
    small = [i for i, c in zip(ids, cnt) if i not in NAMES or c < 6]
    if not small: break
    s = min(small, key=lambda i: cnt[list(ids).index(i)])
    adj = {}
    for y in range(H):
        for x in range(W):
            if lab[y, x] != s: continue
            for yy, xx in ((y, (x + 1) % W), (y, (x - 1) % W), (max(y - 1, 0), x), (min(y + 1, H - 1), x)):
                if lab[yy, xx] != s: adj[lab[yy, xx]] = adj.get(lab[yy, xx], 0) + 1
    lab[lab == s] = max(adj, key=adj.get)
ids, cnt = np.unique(lab, return_counts=True)
order = [i for _, i in sorted(zip(-cnt, ids))]
plate = np.array([order.index(v) for v in lab.ravel()], dtype=np.uint8)
plates = []
for k, c in enumerate(order):
    m = plate == k; vx, vy = pvx[m].mean(), pvy[m].mean()
    plates.append({'code': c, 'name': NAMES[c], 'dir': int(round(math.degrees(math.atan2(vx, vy)) / 45) * 45 % 360), 'speed': round(float(np.hypot(pvx[m], pvy[m]).mean()), 1)})
print('プレート', [(p['name'], int((plate == k).sum()), p['dir'], p['speed']) for k, p in enumerate(plates)])

# ---------- 書き出し ----------
def b64(a, dt):
    return base64.b64encode(np.ascontiguousarray(a, dtype=dt).tobytes()).decode()
out = {
    'W': W, 'H': H,
    'elev': b64(np.round(elev), '<i2'),
    'plate': b64(plate, 'u1'), 'plates': plates,
    'pvx': b64(np.clip(np.round(pvx * 10), -127, 127), 'i1'), 'pvy': b64(np.clip(np.round(pvy * 10), -127, 127), 'i1'),   # 0.1 cm/年
    'T': b64(np.round(T * 10), '<i2'),                                  # 0.1 ℃, [月][y][x]
    'P': b64(np.clip(np.round(P), 0, 65535), '<u2'),                    # mm/月
    'wu': b64(np.clip(np.round(wu * 10), -127, 127), 'i1'), 'wv': b64(np.clip(np.round(wv * 10), -127, 127), 'i1'),   # 0.1 m/s
    'cu': b64(np.clip(np.round(cu * 200), -127, 127), 'i1'), 'cv': b64(np.clip(np.round(cv * 200), -127, 127), 'i1'),  # 0.5 cm/s
    'sstA': b64(np.clip(np.round(sst_anom * 10), -127, 127), 'i1'),     # 0.1 ℃
    'tsrc': b64(src_t[0], 'u1'),                                        # 1=陸上観測格子 2=海面水温 3=再解析で補完
}
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'earth.js')
os.makedirs(os.path.dirname(dst), exist_ok=True)
with open(dst, 'w') as f:
    f.write('/* 実在の地球の観測・解析データ(2°グリッド)。tools/build_earth_data.py が生成。出典は data/SOURCES.md */\n')
    f.write('window.EARTH_DATA = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
print('書き出し', os.path.getsize(dst), 'bytes')

# ---------- 検算: 実在都市の値 ----------
def cell(la_, lo_):
    y = int(round((89 - la_) / 2)); x = int(round((lo_ + 179) / 2)) % W
    if not land[y, x]:
        best = None
        for dy in range(-1, 2):
            for dx in range(-1, 2):
                yy, xx = y + dy, (x + dx) % W
                if 0 <= yy < H and land[yy, xx] and (best is None or abs(dy) + abs(dx) < best[0]): best = (abs(dy) + abs(dx), yy, xx)
        if best: y, x = best[1], best[2]
    return y, x
for nm, la_, lo_ in [('東京', 35.7, 139.7), ('ロンドン', 51.5, -0.1), ('シンガポール', 1.3, 103.8), ('カイロ', 30, 31.2), ('モスクワ', 55.8, 37.6), ('ローマ', 41.9, 12.5), ('ヤクーツク', 62, 129.7), ('ブエノスアイレス', -34.6, -58.4), ('ラサ', 29.7, 91.1), ('昭和基地付近', -70, 40)]:
    y, x = cell(la_, lo_)
    print(f'{nm}: 標高{elev[y, x]:.0f}m 1月{T[0, y, x]:.1f}℃ 7月{T[6, y, x]:.1f}℃ 年降水{P[:, y, x].sum():.0f}mm')
