// Climbio 公開格式 v2 ↔ TopoKit 的路線模型。API 只吃 v2：照片畫面（kind: view, surface: photo）加上圖層（kind: layer），
// 座標是照片像素；輸出也是圖層。不認萬分比或任何 App 的舊格式。
//
// 對應（詞彙見 format/VOCABULARY.md）：
//   路線＝type: route 的節點，線段＝指向它的 LineString 標註；標註的 props.label 是編號牌的文字，props.style.stroke 是線的顏色
//   bolt／anchor＝type: bolt／anchor 的節點（parent 是路線，name 是位置，例如 B01、A01），位置＝指向它的 Point 標註，標註的 props.label 是旁邊的材質說明
//   路線的 props.style 是 sport 時畫藍色，其他紅色；props.grade 與 name 顯示在編號旁邊
// English: reads v2 view + layers into a route model and writes edits back as a layer.

const GRADE_SYSTEMS = ['yds', 'french', 'v', 'font', 'uiaa', 'british', 'dan'];

/** 名稱：字串，或語言代碼 → 字串；依 lang 選，沒有就 zh-Hant、en、第一個 */
export function pickName(name, lang) {
  if (name == null || typeof name === 'string') return name;
  const keys = Object.keys(name);
  const hit = [lang, lang?.split('-')[0], 'zh-Hant', 'en'].find((k) => k && name[k]) ?? keys[0];
  return hit ? name[hit] : undefined;
}

/** 難度：props.grade 是 { 系統: 值 }；依 systems 的順序取第一個有的，沒有就取第一個 */
export function pickGrade(grade, systems = GRADE_SYSTEMS) {
  if (grade == null || typeof grade === 'string') return grade;
  const key = systems.find((s) => grade[s] != null) ?? Object.keys(grade)[0];
  return key ? String(grade[key]) : undefined;
}

const localId = (ref) => (typeof ref === 'string' && ref.includes('#') ? ref.split('#').pop() : ref);

/** 16 碼隨機 id（[0-9a-z]，格式規定的新檔案 id、全域節點 id） */
export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => (b % 36).toString(36)).join('');
}

/** 檢查是 v2 的照片畫面；不是就丟錯（錯誤要明確，不靜默） */
export function assertView(view) {
  if (!view || view.climbio !== 2 || view.kind !== 'view' || view.surface !== 'photo') throw new Error('TopoKit 只收 Climbio v2 的照片畫面（kind: view, surface: photo）');
  if (!(view.w > 0 && view.h > 0) || typeof view.href !== 'string') throw new Error('照片畫面缺 href、w、h');
}

/**
 * { view, layers, nodes } → 要畫的路線模型。
 * view：照片畫面；layers：疊在畫面上的圖層（每個都要 on＝view.id）；nodes：額外的節點（例如組合檔裡的路線名稱、難度）。
 * 回傳 { photo: { href, w, h }, crop?, routes }；每條路線 { id, label, kind, grade, name, line, bolts, layer }，layer 是它的標註在第幾個圖層。
 */
export function readTopo({ view, layers = [], nodes = [] }, { lang, gradeSystems } = {}) {
  assertView(view);
  for (const l of layers) if (l.kind !== 'layer' || l.on !== view.id) throw new Error(`圖層 ${l.id} 不是疊在這個畫面（${view.id}）上`);
  const byId = new Map();
  for (const n of [...nodes, ...(view.nodes ?? []), ...layers.flatMap((l) => l.nodes ?? [])]) byId.set(n.id, n);
  const sources = [{ marks: view.marks ?? [], layer: -1 }, ...layers.map((l, layer) => ({ marks: l.marks ?? [], layer }))];
  const routes = new Map();
  const route = (id, layer) => {
    if (!routes.has(id)) {
      const n = byId.get(id);
      routes.set(id, {
        id,
        kind: n?.props?.style === 'sport' ? 'sport' : 'other',
        grade: pickGrade(n?.props?.grade, gradeSystems),
        name: pickName(n?.name, lang),
        layer,
      });
    }
    return routes.get(id);
  };
  // 先收線段（有線段的才是路線），再收 bolt：bolt 的 parent 找得到路線才收
  for (const { marks, layer } of sources) {
    for (const m of marks) {
      if (m.geometry?.type !== 'LineString' || !m.node) continue;
      const r = route(localId(m.node), layer);
      r.line = m.geometry.coordinates.map(([x, y]) => [x, y]);
      if (m.props?.label != null) r.label = String(m.props.label);
      if (m.props?.style?.stroke) r.stroke = m.props.style.stroke;
      r.lineProps = m.props;
    }
  }
  for (const { marks, layer } of sources) {
    for (const m of marks) {
      if (m.geometry?.type !== 'Point' || !m.node) continue;
      const b = byId.get(localId(m.node));
      if (!b || (b.type !== 'bolt' && b.type !== 'anchor')) continue;
      const parent = localId(b.parent);
      if (!parent || (!routes.has(parent) && byId.get(parent)?.type !== 'route')) continue;
      const r = route(parent, layer);
      const pos = typeof b.name === 'string' ? b.name : b.id;
      (r.bolts ??= {})[pos] = { at: [m.geometry.coordinates[0], m.geometry.coordinates[1]], anchor: b.type === 'anchor' || pos.startsWith('A'), id: b.id, ...(m.props?.label != null ? { note: String(m.props.label) } : {}) };
    }
  }
  return { photo: { href: view.href, w: view.w, h: view.h }, ...(view.props?.crop ? { crop: view.props.crop } : {}), routes: [...routes.values()] };
}

/** 本地節點 id 要在檔案內唯一：路線 id 前 6 碼加位置（jag38d-b01 的寫法） */
function boltNodeId(routeId, pos, taken) {
  let id = `${routeId.slice(0, 6)}-${pos.toLowerCase()}`.replace(/[^0-9a-z_-]/g, '');
  while (taken.has(id)) id += 'x';
  taken.add(id);
  return id;
}

/**
 * 編輯後的路線 → 圖層。只改這個圖層裡屬於 routes（layer 等於 index 的路線）的線段與 bolt 標註、
 * 以及這些路線自己的 bolt 節點；其他標註和節點照舊。路線節點在別處（畫面、組合）已經有就不重複寫，沒有才補一個。
 * 座標照原樣寫回：編輯器新放的點本來就是整數像素，沒動的點（可能是別的 App 換算來的小數）不因為存檔而移動。回傳新的圖層（t 是現在）。
 */
export function writeLayer(layer, routes, index, known = new Set()) {
  const mine = routes.filter((r) => r.layer === index);
  const mineIds = new Set(mine.map((r) => r.id));
  const nodes = (layer.nodes ?? []).filter((n) => !((n.type === 'bolt' || n.type === 'anchor') && mineIds.has(localId(n.parent))));
  const taken = new Set(nodes.map((n) => n.id));
  const isMine = (m) => {
    const id = localId(m.node);
    if (m.geometry?.type === 'LineString') return mineIds.has(id);
    const n = (layer.nodes ?? []).find((x) => x.id === id);
    return m.geometry?.type === 'Point' && !!n && (n.type === 'bolt' || n.type === 'anchor') && mineIds.has(localId(n.parent));
  };
  const marks = (layer.marks ?? []).filter((m) => !isMine(m));
  for (const r of mine) {
    // 只有一個點的線留不住（編輯器另外記著），沒有線也沒有 bolt 的路線不寫
    if (!(r.line?.length >= 2) && !Object.keys(r.bolts ?? {}).length) continue;
    if (!known.has(r.id) && !nodes.some((n) => n.id === r.id)) nodes.push({ id: r.id, type: 'route', ...(typeof r.name === 'string' ? { name: r.name } : {}), ...(r.kind === 'sport' ? { props: { style: 'sport' } } : {}) });
    if (r.line && r.line.length >= 2) {
      const props = { ...r.lineProps, ...(r.label != null ? { label: r.label } : {}) };
      marks.push({ node: r.id, geometry: { type: 'LineString', coordinates: r.line.map(([x, y]) => [x, y]) }, ...(Object.keys(props).length ? { props } : {}) });
    }
    for (const [pos, b] of Object.entries(r.bolts ?? {})) {
      const id = b.id && !taken.has(b.id) ? (taken.add(b.id), b.id) : boltNodeId(r.id, pos, taken);
      nodes.push({ id, type: b.anchor ? 'anchor' : 'bolt', parent: r.id, name: pos });
      marks.push({ node: id, geometry: { type: 'Point', coordinates: [b.at[0], b.at[1]] }, ...(b.note != null ? { props: { label: b.note } } : {}) });
    }
  }
  return { ...layer, t: Date.now(), nodes, marks };
}
