// 底圖圖磚（可以開關）：OpenStreetMap、國土測繪中心的正射影像（航照）、1/5000 基本地形圖的等高線與海岸線。
// 圖磚是 Web Mercator（GoogleMapsCompatible），換成地圖的平面座標放在 SVG 裡。
// 移植自龍洞（MIT）src/map/ortho.ts、contourTiles.ts。
// English: toggleable basemap tiles (OSM, NLSC orthophoto, B5000 contours). Ported from Longdong (MIT).
import { toMap } from './viewport.js';

/** 圖磚來源：網址樣板（{z}/{x}/{y}）、層級範圍、授權標示 */
export const SOURCES = {
  osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', minZ: 12, maxZ: 19, credit: '© OpenStreetMap', href: 'https://www.openstreetmap.org/copyright' },
  ortho: { url: 'https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}', minZ: 14, maxZ: 19, credit: '© 內政部國土測繪中心', href: 'https://maps.nlsc.gov.tw/' },
  contours: { url: 'https://wmts.nlsc.gov.tw/wmts/B5000/default/GoogleMapsCompatible/{z}/{y}/{x}', minZ: 14, maxZ: 19, credit: '© 內政部國土測繪中心', href: 'https://maps.nlsc.gov.tw/' },
};
/** 一層最多幾張圖磚，超過就降一層 */
const MAX_TILES = 64;
/** 最底下固定墊一層：縮放時這層的圖磚不換，新的圖磚載入前不會整片空白 */
const BASE_Z = 16;
const EARTH_M = 2 * Math.PI * 6378137;

const tileX = (lng, n) => ((lng + 180) / 360) * n;
const tileY = (lat, n) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
};
const tileLngLat = (x, y, n) => [(x / n) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI];
const urlOf = (src, z, x, y) => src.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);

/** 畫面清楚需要的層級（圖磚像素不大於螢幕像素） */
export function tileLevel(proj, view, dpr = 1, source = SOURCES.ortho) {
  const lat = proj.unproject([view.cx, view.cy])[1];
  const metersPerTilePx = (z) => (EARTH_M * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z);
  let z = source.maxZ;
  while (z > source.minZ && metersPerTilePx(z - 1) <= view.s / dpr) z--;
  return z;
}

/**
 * 畫面上看得到的圖磚 { key, href, x, y, w, h }（平面座標）：一層清楚的，不透明的來源底下再墊一層粗兩級的與固定的 BASE_Z，
 * 換層級時不會整片空白；透明的來源（等高線）只畫一層。level：沿用的層級（縮放中不換圖磚）。
 */
export function visibleTiles(proj, view, frame, source, { dpr = 1, level = tileLevel(proj, view, dpr, source), transparent = false } = {}) {
  const corners = [[0, 0], [frame.w, 0], [0, frame.h], [frame.w, frame.h]].map((q) => proj.unproject(toMap(view, frame, q)));
  const lngs = corners.map((c) => c[0]), lats = corners.map((c) => c[1]);
  const [north, south, west, east] = [Math.max(...lats), Math.min(...lats), Math.min(...lngs), Math.max(...lngs)];
  const layer = (z) => {
    const n = 2 ** z;
    const [x0, x1, y0, y1] = [Math.floor(tileX(west, n)), Math.floor(tileX(east, n)), Math.floor(tileY(north, n)), Math.floor(tileY(south, n))];
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) return undefined;
    const tiles = [];
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const [left, top] = proj.project(tileLngLat(x, y, n));
        const [right, bottom] = proj.project(tileLngLat(x + 1, y + 1, n));
        tiles.push({ key: `${z}/${x}/${y}`, href: urlOf(source, z, x, y), x: left, y: top, w: right - left, h: bottom - top });
      }
    return tiles;
  };
  let z = level;
  let fine = layer(z);
  while (!fine && z > source.minZ) fine = layer(--z);
  if (transparent) return fine ?? [];
  const coarse = z - 2 > BASE_Z ? layer(z - 2) : undefined;
  const base = z > BASE_Z ? layer(BASE_Z) : undefined;
  return [...(base ?? []), ...(coarse ?? []), ...(fine ?? [])];
}

/** 地形圖的等高線（洋紅）換成 CONTOUR_RGB、海岸線（藍）換成 COAST_RGB，其他透明 */
export const CONTOUR_RGB = [255, 150, 40];
export const COAST_RGB = [60, 170, 255];

/** 就地改寫 RGBA 像素 */
export function keepContours(px) {
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    const to = r === 255 && g === 0 && b === 255 ? CONTOUR_RGB : r === 0 && g === 0 && b === 255 ? COAST_RGB : undefined;
    if (to) [px[i], px[i + 1], px[i + 2]] = to;
    else px[i + 3] = 0;
  }
}

const contourCache = new Map();

/** 地形圖圖磚 → 只有等高線與海岸線的圖（object URL）；同一張只處理一次，失敗的不留著 */
export function contourTile(href) {
  let p = contourCache.get(href);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const g = canvas.getContext('2d');
          g.drawImage(img, 0, 0);
          // 伺服器沒有允許 CORS 時讀不到像素（SecurityError）
          const data = g.getImageData(0, 0, canvas.width, canvas.height);
          keepContours(data.data);
          g.putImageData(data, 0, 0);
          canvas.toBlob((blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error(`等高線圖磚轉換失敗：${href}`))));
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error(`等高線圖磚載入失敗：${href}`));
      img.src = href;
    });
    p.catch(() => contourCache.delete(href));
    contourCache.set(href, p);
  }
  return p;
}
