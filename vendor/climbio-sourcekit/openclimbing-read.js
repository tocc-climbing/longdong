// OpenClimbing（openclimbing.org）／OpenStreetMap 的讀取：OSM 公開 API 與 Wikimedia Commons → 岩場、路線、Topo 照片與線。
// 紅點貓（redpoint/openclimbing.js，存成一個組合）和收藏擴充功能（extension/，存進 Drive）共用；只讀、不碰 DOM。
// 路線資料 ODbL（© OpenStreetMap contributors）；照片逐張有授權，只收 CC 與公眾領域。
// English: shared read side of the OSM / Commons converter (no DOM, no storage).
import { TOPO_EDGE, COMMONS_REQUEST_WIDTH, fitSize } from './photo-size.js';

const OSM = 'https://api.openstreetmap.org/api/0.6';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const BATCH = 500;

/** 判斷網址是否為 OpenClimbing 或 OSM 的 relation */
export function isOpenClimbing(url) {
  return /openclimbing\.org\/(node|way|relation)\/\d+/i.test(url) ||
    /openstreetmap\.org\/relation\/\d+/i.test(url) ||
    /^osm:relation:\d+$/i.test(url);
}

/** 解析網址中的 relation id → { type, id } */
export function parseUrl(url) {
  try {
    const osmMatch = String(url).match(/^osm:(relation|node|way):(\d+)$/i);
    if (osmMatch) return { type: osmMatch[1].toLowerCase(), id: Number(osmMatch[2]) };
    const u = new URL(url);
    const m = u.pathname.match(/\/(node|way|relation)\/(\d+)/i);
    return m ? { type: m[1].toLowerCase(), id: Number(m[2]) } : null;
  } catch {
    return null;
  }
}

const defaultGet = async (url, signal) => {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`讀不到 ${url}（HTTP ${res.status}）`);
  return res.json();
};

const chunk = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));

async function fetchMany(get, kind, ids, signal) {
  const out = [];
  for (const part of chunk([...new Set(ids)], BATCH)) {
    const data = await get(`${OSM}/${kind}.json?${kind}=${part.join(',')}`, signal);
    out.push(...(data.elements || []));
  }
  return out;
}

export function photosOf(tags = {}) {
  return Object.keys(tags).filter((k) => /^wikimedia_commons(:\d+)?$/.test(k) && /^File:/i.test(tags[k]))
    .map((k) => ({ title: tags[k].replace(/^file:/i, 'File:'), path: tags[`${k}:path`] }));
}

export function parsePath(path) {
  // OpenClimbing uses B/A/P/S/U markers after coordinates, and a colon
  // before "|" to designate a dotted segment. The Climbio layer stores
  // the normalized points; marker semantics can be added separately.
  const segments = String(path ?? '').split('|');
  if (segments.length < 2) return [];
  const points = [];
  for (const segment of segments) {
    const match = segment.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)),([+-]?(?:\d+(?:\.\d*)?|\.\d+))[BAPSU]?:?$/i);
    if (!match) return [];
    const x = Number(match[1]), y = Number(match[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return [];
    points.push([x, y]);
  }
  return points;
}

export function spdxOf(name = '') {
  const s = name.trim();
  let m;
  if (/^CC0/i.test(s)) return 'CC0-1.0';
  if (/^(public domain|pd)/i.test(s)) return 'LicenseRef-PD';
  if ((m = s.match(/^CC[ -]BY(?:[ -]SA)?[ -](\d\.\d)(?:[ -]\w+)?$/i))) return `CC-BY${/SA/i.test(s) ? '-SA' : ''}-${m[1]}`;
  return null;
}

export async function commonsInfo(titles, get = defaultGet, signal) {
  const info = new Map();
  let skipped = 0;
  for (const part of chunk([...new Set(titles)], 40)) {
    const q = new URLSearchParams({
      action: 'query', format: 'json', origin: '*', prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(COMMONS_REQUEST_WIDTH), titles: part.join('|'),
    });
    const res = await get(`${COMMONS}?${q}`, signal);
    const pages = Object.values(res.query?.pages ?? {});
    for (const p of pages) {
      const i = p.imageinfo?.[0];
      if (!i) continue;
      const spdx = spdxOf(i.extmetadata?.LicenseShortName?.value);
      if (!spdx) { skipped++; continue; }
      info.set(p.title, {
        url: i.thumburl ?? i.url,
        // 照片最後存的大小：原圖長邊縮到 TOPO_EDGE 以內（Commons 的縮圖寬度會對齊標準尺寸，API 回報的 thumbwidth 不可信，所以從原圖算）
        ...fitSize(i.width ?? i.thumbwidth, i.height ?? i.thumbheight, TOPO_EDGE),
        mime: /\.png(\?.*)?$/i.test(i.thumburl ?? i.url) ? 'image/png' : 'image/jpeg',
        spdx,
        page: i.descriptionurl,
        artist: String(i.extmetadata?.Artist?.value ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return { info, skipped };
}

/** 讀取 OpenClimbing / OSM 岩場及其成員路線與照片 */
/** keepEmpty：沒有 Topo 的岩場也留在 units 裡（收藏擴充功能的勾選清單要列出來並標「沒有 Topo」） */
export async function loadUnits(url, { get = defaultGet, signal, keepEmpty = false } = {}) {
  const at = parseUrl(url);
  if (!at || at.type !== 'relation') throw Object.assign(new Error('這一頁不是岩場或區域'), { guide: true });
  const first = (await get(`${OSM}/relation/${at.id}.json`, signal)).elements[0];
  if (!first) throw new Error(`找不到 OSM 關係 ${at.id}`);
  const rels = [], seen = new Set(), parentOf = new Map();
  for (let level = [first]; level.length && rels.length < 400;) {
    const fresh = level.filter((r) => r.type === 'relation' && !seen.has(r.id));
    fresh.forEach((r) => seen.add(r.id));
    rels.push(...fresh);
    for (const r of fresh) for (const m of (r.members || []).filter((m) => m.type === 'relation')) if (!parentOf.has(m.ref)) parentOf.set(m.ref, r.id);
    const memberRelIds = fresh.flatMap((r) => (r.members || []).filter((m) => m.type === 'relation').map((m) => m.ref));
    level = memberRelIds.length ? await fetchMany(get, 'relations', memberRelIds, signal) : [];
  }
  const memberNodeIds = rels.flatMap((r) => (r.members || []).filter((m) => m.type === 'node').map((m) => m.ref));
  const nodes = new Map((await fetchMany(get, 'nodes', memberNodeIds, signal)).map((n) => [n.id, n]));
  const byRel = new Map(rels.map((r) => [r.id, r]));
  // 從根到這個岩場，在已經讀到的 OSM 關係樹裡的上下層（收藏的來源階層）
  const hierarchyOf = (id) => {
    const path = [], visited = new Set();
    for (let current = id; byRel.has(current) && !visited.has(current); current = parentOf.get(current)) {
      visited.add(current);
      const rel = byRel.get(current);
      path.unshift({ id: `osm:relation:${current}`, name: rel.tags?.name ?? `relation ${current}`, url: `https://www.openstreetmap.org/relation/${current}` });
    }
    return path;
  };
  const units = rels.map((rel) => ({
    hierarchy: hierarchyOf(rel.id),
    rel,
    kind: rel.tags?.climbing === 'area' ? 'area' : 'crag',
    name: rel.tags?.name ?? `relation ${rel.id}`,
    routes: (rel.members || []).filter((m) => m.type === 'node').map((m) => nodes.get(m.ref)).filter((n) => n?.tags && /^route(_bottom)?$/.test(n.tags.climbing ?? '')),
  })).filter((u) => u.routes.length);

  const allPhotoTitles = units.flatMap((u) => u.routes.flatMap((r) => photosOf(r.tags).filter((p) => parsePath(p.path).length).map((p) => p.title)));
  const { info, skipped } = await commonsInfo(allPhotoTitles, get, signal);

  for (const u of units) {
    const byTitle = new Map();
    for (const node of u.routes) {
      for (const p of photosOf(node.tags)) {
        const points = parsePath(p.path);
        if (!points.length || !info.has(p.title)) continue;
        byTitle.set(p.title, [...(byTitle.get(p.title) ?? []), { node, points }]);
      }
    }
    u.views = [...byTitle].map(([title, lines]) => ({ title, info: info.get(title), lines }));
    u.topos = u.views.length;
  }
  return { root: { ...at, name: first.tags?.name ?? '', rel: first }, units: keepEmpty ? units : units.filter((u) => u.topos > 0), skipped };
}

const GRADE = { fontainebleau: 'font', vermin: 'v' };
const STYLE = [['sport', 'sport'], ['trad', 'trad'], ['boulder', 'boulder'], ['toprope', 'toprope'], ['mixed', 'mixed'], ['ice', 'ice']];

export function routeProps(tags) {
  const grade = {};
  for (const [k, v] of Object.entries(tags)) {
    const m = k.match(/^climbing:grade:([a-z_]+)$/);
    if (m && v) grade[GRADE[m[1]] ?? m[1]] = v;
  }
  const length = Number(tags['climbing:length'] ?? tags.length);
  const style = STYLE.find(([key]) => tags[`climbing:${key}`] === 'yes')?.[1];
  return Object.fromEntries(Object.entries({
    grade: Object.keys(grade).length ? grade : undefined,
    length: Number.isFinite(length) && length > 0 ? length : undefined,
    style,
    description: tags.description,
  }).filter(([, v]) => v !== undefined));
}
