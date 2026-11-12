"""裁切內政部 2025 新北市 DTM；只用標準函式庫，原始 ZIP 不隨網站發布。"""
import json
import hashlib
import math
import sys
import zipfile
from pathlib import Path
from fill_coast import fill_coast

ROOT = Path(__file__).resolve().parents[2]
SOURCE = 'https://www.tgos.tw/MDE/VirtualDir_TC/Product/9574dbb5-ca32-4ea3-aaf7-a9f582b9357b/分幅_新北市20MDEM(2025).zip'


def lnglat(east, north):
    # TWD97 / TM2 121（EPSG:3826），GRS80 橢球的反投影。
    a, e2, k = 6378137, 0.00669438002290, 0.9999
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    mu = north / k / (a * (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256))
    p = (mu + (3*e1/2 - 27*e1**3/32)*math.sin(2*mu)
         + (21*e1**2/16 - 55*e1**4/32)*math.sin(4*mu)
         + 151*e1**3/96*math.sin(6*mu) + 1097*e1**4/512*math.sin(8*mu))
    ep = e2 / (1-e2)
    n = a / math.sqrt(1-e2*math.sin(p)**2)
    r = a*(1-e2)/(1-e2*math.sin(p)**2)**1.5
    t, c, d = math.tan(p)**2, ep*math.cos(p)**2, (east-250000)/(n*k)
    lat = p - n*math.tan(p)/r*(d*d/2 - (5+3*t+10*c-4*c*c-9*ep)*d**4/24
                              + (61+90*t+298*c+45*t*t-252*ep-3*c*c)*d**6/720)
    lon = math.radians(121) + (d-(1+2*t+c)*d**3/6
                               +(5-2*c+28*t-3*c*c+8*ep+24*t*t)*d**5/120)/math.cos(p)
    return math.degrees(lon), math.degrees(lat)


def project(e, n):
    lng, lat = lnglat(e, n)
    return project_lnglat(lng, lat)


def project_lnglat(lng, lat):
    m = 6371000 * math.pi / 180
    return [(lng-121.92)*m*math.cos(math.radians(25.107)), (25.107-lat)*m]


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    full_map = '--map' in sys.argv
    args = [arg for arg in sys.argv[1:] if arg != '--map']
    zfile = Path(args[0]) if args else ROOT / '.cache/dtm/new-taipei.zip'
    # 龍洞與周邊山坡；不載入整個新北市。
    e0, n0, cols, rows = 341280, 2776460, 139, 133
    if full_map:
        # 原向量圖 extent 四周保留至少兩格內插餘量。
        e0, n0, cols, rows = 341160, 2776640, 141, 133
    samples = [None] * (cols*rows)
    tiles = []
    with zipfile.ZipFile(zfile) as archive:
        for name in archive.namelist():
            if not name.endswith('.grd'):
                continue
            # 每圖幅檔頭的原點與大小先排除無關圖幅。
            hdr = archive.read(name[:-3]+'hdr').decode('latin1').splitlines()
            width, height, x, y = map(int, hdr[8:12])
            if x > e0+(cols-1)*20 or x+(width-1)*20 < e0 or y > n0+(rows-1)*20 or y+(height-1)*20 < n0:
                continue
            tiles.append(name)
            for line in archive.read(name).decode('ascii').splitlines():
                e, n, z = map(float, line.split())
                col, row = round((e-e0)/20), round((n-n0)/20)
                if 0 <= col < cols and 0 <= row < rows:
                    if z <= -9999:
                        continue
                    samples[row*cols+col] = round(z*10)
    if not tiles or sum(z is not None for z in samples) < 1000:
        raise ValueError('裁切範圍沒有足夠的 DTM 資料')
    origin = project(e0, n0)
    u, v = project(e0+20, n0), project(e0, n0+20)
    coast_file = ROOT / ('scripts/data/coast-map.json' if full_map else 'scripts/data/coast-b5000.json')
    coast_data = json.loads(coast_file.read_text(encoding='utf-8'))
    coast = coast_data['geometry']['coordinates']
    polygons = [[list(map(lambda p: project_lnglat(*p), ring)) for ring in poly] for poly in coast]
    west, south, east, north = coast_data['extent']
    left, top = project_lnglat(west, north)
    right, bottom = project_lnglat(east, south)
    points = [[origin[0]+c*(u[0]-origin[0])+r*(v[0]-origin[0]), origin[1]+c*(u[1]-origin[1])+r*(v[1]-origin[1])]
              for r in range(rows) for c in range(cols)]
    heights, sea_runs, estimated, unresolved, water_runs = fill_coast(samples, cols, points, polygons, [left, top, right, bottom])
    assert all(z is None or heights[i] == z for i, z in enumerate(samples)), '實測高程被改動'
    result = dict(source=SOURCE, sourceSha256=hashlib.sha256(zfile.read_bytes()).hexdigest(), dataset='https://data.gov.tw/dataset/176927',
                  attribution='© 內政部地政司 · Taiwan DTM 20m · 政府資料開放授權條款第1版',
                  crs='EPSG:3826', verticalDatum='TWVD2001', edition=2025, tiles=tiles,
                  origin=[round(x, 5) for x in origin],
                  u=[round(u[i]-origin[i], 7) for i in range(2)],
                  v=[round(v[i]-origin[i], 7) for i in range(2)],
                  columns=cols, rows=rows, step=20, scale=0.1, heights=heights,
                  seaRuns=sea_runs, waterRuns=water_runs, interpolated=estimated,
                  coast=[[[[round(x, 1), round(y, 1)] for x, y in ring] for ring in poly] for poly in polygons],
                  reconstruction=dict(method='IDW2', radiusMeters=80, maxHoleCells=9, maxHoleSpanCells=3,
                                      seaLevel=0, coastSource=str(coast_file.relative_to(ROOT)),
                                      coastSha256=hashlib.sha256(coast_file.read_bytes()).hexdigest(),
                                      coastAttribution=coast_data['attribution'], coastLicense=coast_data['license'], unresolvedLand=unresolved))
    if full_map:
        region_coast = json.loads((ROOT / 'scripts/data/coast-b5000.json').read_text(encoding='utf-8'))['geometry']['coordinates']
        result['regionCoast'] = [[[[round(x, 1), round(y, 1)] for x, y in map(lambda p: project_lnglat(*p), ring)] for ring in poly] for poly in region_coast]
    out = ROOT / ('public/rescue/terrain-map-20m.json' if full_map else 'public/rescue/terrain-20m.json')
    out.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
    print(f'{out.name}: {out.stat().st_size:,} bytes, {len(tiles)} 圖幅，{sum(z is not None for z in samples)} 高程點')
    print('範圍:', lnglat(e0, n0), lnglat(e0+20*(cols-1), n0+20*(rows-1)))
    print(f'海面補零 {sum(n for _, n in sea_runs)} 點，陸上內插 {len(estimated)} 點，陸上保留缺值 {len(unresolved)} 點')


if __name__ == '__main__':
    main()

