// Climbio 公開格式：以畫面為中心（照片、向量圖、地圖）；常變更的標註放在疊在畫面上的圖層；其他東西都是畫面的組合。JSON Schema 和驗證器，規格見 README.md，詞彙見 VOCABULARY.md。
// 瀏覽器用 <script> 載入，掛在全域 ClimbioFormat；Node 用 require。climbio.schema.json 是 SCHEMA 原樣輸出給其他語言用（測試會比對）。
// English: Climbio open format: views (photo, drawing, map), layers drawn on a view, and sets that compose them. JSON Schema and validator. Apache-2.0.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClimbioFormat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const VERSION = 2;
  const ref = (name) => ({ $ref: `#/$defs/${name}` });
  const str = { type: 'string' }, int = { type: 'integer', minimum: 0 }, size = { type: 'integer', exclusiveMinimum: 0 };
  const obj = { type: 'object' };
  const arr = (items, minItems) => (minItems ? { type: 'array', items, minItems } : { type: 'array', items });
  // 檔案 id：隨機、至少 12 碼小寫英數（新產生的用 16 碼）；節點 id：檔案內唯一；跨檔案引用寫「檔案id#節點id」
  const FILE_ID = '[0-9a-z]{12,64}', NODE_ID = '[0-9a-z][0-9a-z_-]{0,63}';
  const geometry = (type, coordinates) => ({ type: 'object', required: ['type', 'coordinates'], properties: { type: { const: type }, coordinates } });
  const pos = ref('position'), ring = ref('ring');
  const href = { type: 'string', pattern: '^(https://\\S+|(?![/\\\\])(?!(.*/)?\\.\\.(/|$))[^\\s:\\\\#]+)$' };
  // 畫面和組合共用的欄位
  const common = {
    climbio: { const: VERSION },
    id: { type: 'string', pattern: `^${FILE_ID}$` },
    name: ref('text'), t: int, author: str,
    license: { type: 'string', minLength: 1 }, attribution: str,
    source: { type: 'object', required: ['url'], properties: { url: { type: 'string', pattern: '^https://' }, version: str } },
    derivedFrom: { type: 'object', required: ['url'], properties: { url: { type: 'string', pattern: '^https://' }, id: str, t: int } },
    props: obj,
    nodes: arr(ref('node')),
  };
  const view = (surface, required, extra) => ({
    type: 'object', required: ['climbio', 'kind', 'id', 'surface', 't', 'license', 'attribution', 'origin', ...required],
    properties: { ...common, kind: { const: 'view' }, surface: { const: surface }, origin: { enum: ['self', 'authorized'] }, marks: arr(ref('mark')), ...extra },
  });
  const SCHEMA = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Climbio open format',
    oneOf: [ref('photoView'), ref('drawingView'), ref('mapView'), ref('layer'), ref('set')],
    $defs: {
      // 名稱：字串，或語言代碼 → 字串
      text: { oneOf: [str, { type: 'object', additionalProperties: str, minProperties: 1 }] },
      position: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 3 },
      ring: arr(pos, 4),
      // 幾何：GeoJSON 的寫法；畫面上用畫面的座標（照片像素、向量圖的 w／h），地理位置用經緯度（經度在前）
      geometry: {
        oneOf: [
          geometry('Point', pos),
          geometry('MultiPoint', arr(pos, 1)),
          geometry('LineString', arr(pos, 2)),
          geometry('MultiLineString', arr(arr(pos, 2), 1)),
          geometry('Polygon', arr(ring, 1)),
          geometry('MultiPolygon', arr(arr(ring, 1), 1)),
        ],
      },
      // 節點：任何東西（路線、岩點、bolt、分區……），type 是自由字串，描述放 props（詞彙見 VOCABULARY.md）
      node: {
        type: 'object', required: ['id'],
        properties: {
          id: { type: 'string', pattern: `^${NODE_ID}$` },
          type: { type: 'string', minLength: 1 }, name: ref('text'),
          parent: { type: 'string', pattern: `^${NODE_ID}(#${NODE_ID})?$` },
          author: str, t: int, license: { type: 'string', minLength: 1 },
          geo: ref('geometry'), props: obj,
        },
      },
      // 標註：畫在畫面上的一個形狀，指向這個檔案的節點，或直接指向全域節點（不必再寫一份節點）
      mark: { type: 'object', required: ['geometry'], properties: { node: { type: 'string', pattern: `^(${NODE_ID}|${FILE_ID}#${NODE_ID})$` }, geometry: ref('geometry'), props: obj } },
      // 拍照資料：作者同意公開才寫；照片檔本身仍不帶 EXIF
      camera: {
        type: 'object', required: ['position'],
        properties: {
          position: pos,
          accuracy: { type: 'number', minimum: 0 },
          heading: { type: 'number', minimum: 0, exclusiveMaximum: 360 },
          pitch: { type: 'number', minimum: -90, maximum: 90 },
          t: int,
          focal: { type: 'number', exclusiveMinimum: 0 },
          model: str,
        },
      },
      photoView: view('photo', ['href', 'w', 'h', 'mime'], {
        href, w: size, h: size,
        mime: { type: 'string', pattern: '^image/(jpeg|png|webp)$' },
        sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        camera: ref('camera'),
      }),
      drawingView: view('drawing', ['w', 'h'], {
        href, w: { type: 'number', exclusiveMinimum: 0 }, h: { type: 'number', exclusiveMinimum: 0 },
        mime: { type: 'string', pattern: '^image/(svg\\+xml|png|webp|jpeg)$' },
        sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      }),
      mapView: view('map', [], {}),
      // 圖層：疊在某個畫面（on）上的節點和標註，座標用那個畫面的；常變更的資料（路線、線段）放這裡，畫面本身不用跟著改
      layer: {
        type: 'object', required: ['climbio', 'kind', 'id', 'on', 't', 'license'],
        properties: { ...common, kind: { const: 'layer' }, on: { type: 'string', pattern: `^${FILE_ID}$` }, href, marks: arr(ref('mark')) },
      },
      // 組合：放在一起的畫面或組合（items），可以再組合；組合自己也可以有節點。項目的 props 是列清單用的資料（縮圖、數量……）
      set: {
        type: 'object', required: ['climbio', 'kind', 'id', 't', 'license'],
        properties: {
          ...common, kind: { const: 'set' }, type: { type: 'string', minLength: 1 },
          items: arr({ type: 'object', required: ['href'], properties: { href, id: { type: 'string', pattern: `^${FILE_ID}$` }, name: ref('text'), t: int, props: obj } }),
        },
      },
    },
  };

  // ---------- 照 SCHEMA 檢查：只實作 SCHEMA 用到的關鍵字 ----------
  const typeOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v);
  const isType = (v, t) => typeOf(v) === t || (t === 'number' && typeOf(v) === 'integer');
  const at = (path, key) => (typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key);
  function check(s, v, path, out) {
    if (s.$ref) return check(SCHEMA.$defs[s.$ref.slice(8)], v, path, out);
    const where = path || '（最上層）', n = out.length;
    if (s.oneOf) {
      const tries = s.oneOf.map(b => { const e = []; check(b, v, path, e); return e; });
      const ok = tries.filter(e => !e.length).length;
      if (ok === 1) return;
      if (ok > 1) { out.push(`${where}：同時符合多種格式`); return; }
      out.push(...tries.reduce((a, b) => (b.length < a.length ? b : a)));
      return;
    }
    if ('const' in s && v !== s.const) out.push(`${where}：要是 ${JSON.stringify(s.const)}`);
    if (s.enum && !s.enum.includes(v)) out.push(`${where}：要是 ${s.enum.join('、')} 其中之一`);
    if (s.type && !isType(v, s.type)) { out.push(`${where}：要是 ${s.type}`); return; }
    if (out.length > n) return;
    if (typeof v === 'string') {
      if (s.minLength && v.length < s.minLength) out.push(`${where}：不能是空字串`);
      if (s.pattern && !new RegExp(s.pattern).test(v)) out.push(`${where}：格式不對`);
    }
    if (typeof v === 'number') {
      if ('minimum' in s && v < s.minimum) out.push(`${where}：不能小於 ${s.minimum}`);
      if ('exclusiveMinimum' in s && v <= s.exclusiveMinimum) out.push(`${where}：要大於 ${s.exclusiveMinimum}`);
      if ('maximum' in s && v > s.maximum) out.push(`${where}：不能大於 ${s.maximum}`);
      if ('exclusiveMaximum' in s && v >= s.exclusiveMaximum) out.push(`${where}：要小於 ${s.exclusiveMaximum}`);
    }
    if (Array.isArray(v)) {
      if (s.minItems && v.length < s.minItems) out.push(`${where}：至少 ${s.minItems} 項`);
      if (s.maxItems && v.length > s.maxItems) out.push(`${where}：最多 ${s.maxItems} 項`);
      if (s.items) v.forEach((x, i) => check(s.items, x, at(path, i), out));
    }
    if (typeOf(v) === 'object') {
      for (const k of s.required || []) if (!(k in v)) out.push(`${at(path, k)}：缺少`);
      if (s.minProperties && Object.keys(v).length < s.minProperties) out.push(`${where}：至少 ${s.minProperties} 項`);
      for (const [k, x] of Object.entries(v)) {
        const p = s.properties && s.properties[k];
        if (p) check(p, x, at(path, k), out);
        else if (s.additionalProperties) check(s.additionalProperties, x, at(path, k), out);
      }
    }
  }

  // ---------- SCHEMA 表達不了的：引用存在、上層不繞圈、座標範圍、多邊形封閉、常用詞彙 ----------
  const GLOBAL = new RegExp(`^${FILE_ID}(#${NODE_ID})?$`);
  const positions = (g) => (g.type === 'Point' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates.flat(2) : g.type === 'Polygon' || g.type === 'MultiLineString' ? g.coordinates.flat() : g.coordinates);
  const rings = (g) => (g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []);
  function shape(g, where, inside, out) {
    if (positions(g).some(p => !inside(p))) out.push(`${where}：座標超出範圍`);
    for (const r of rings(g)) { const a = r[0], b = r[r.length - 1]; if (a[0] !== b[0] || a[1] !== b[1]) { out.push(`${where}：多邊形的第一點和最後一點要相同`); break; } }
  }
  const lonLat = ([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90;
  function relations(doc, out) {
    const nodes = doc.nodes || [], byId = new Map();
    nodes.forEach((nd, i) => { if (byId.has(nd.id)) out.push(`nodes[${i}].id：重複的 ${nd.id}`); else byId.set(nd.id, nd); });
    nodes.forEach((nd, i) => {
      const where = `nodes[${i}]`;
      if (nd.parent && !byId.has(nd.parent) && !GLOBAL.test(nd.parent)) out.push(`${where}.parent：這個檔案沒有 ${nd.parent}，外部節點要寫全域 id 或「檔案id#節點id」`);
      for (let p = nd.parent, seen = new Set([nd.id]); p && byId.has(p); p = byId.get(p).parent) { if (seen.has(p)) { out.push(`${where}.parent：上層繞回自己`); break; } seen.add(p); }
      if (nd.geo) shape(nd.geo, `${where}.geo`, lonLat, out);
      // 常用詞彙：路線的岩點和出手順序
      const pr = nd.props || {};
      // 圖層的岩點可以在底下的畫面裡，這裡查不到，只查角色
      if (typeOf(pr.holds) === 'object') for (const [k, role] of Object.entries(pr.holds)) {
        if (!['s', 'h', 'f', 't'].includes(role)) out.push(`${where}.props.holds.${k}：角色要是 s、h、f、t 其中之一`);
        if (doc.kind === 'view' && (!byId.has(k) || byId.get(k).type !== 'hold')) out.push(`${where}.props.holds.${k}：這個檔案沒有這個岩點`);
      }
      if (Array.isArray(pr.seq)) for (const k of pr.seq) if (typeOf(pr.holds) !== 'object' || !(k in pr.holds)) out.push(`${where}.props.seq：${k} 不是這條路線的岩點`);
    });
    if (doc.kind === 'set') {
      (doc.items || []).forEach((it, i) => { if (it.id === doc.id) out.push(`items[${i}]：組合不能放自己`); });
      return;
    }
    if (doc.kind === 'layer' && doc.on === doc.id) out.push('on：圖層不能疊在自己上面');
    // 圖層的座標範圍要看底下的畫面，這裡只查多邊形封閉；不在這個檔案的本地 id 在圖層裡指底下的畫面
    const inside = doc.kind === 'layer' ? () => true : doc.surface === 'map' ? lonLat : ([x, y]) => x >= 0 && y >= 0 && x <= doc.w && y <= doc.h;
    (doc.marks || []).forEach((m, i) => {
      if (m.node && doc.kind === 'view' && !byId.has(m.node) && !GLOBAL.test(m.node)) out.push(`marks[${i}].node：這個檔案沒有 ${m.node}`);
      shape(m.geometry, `marks[${i}].geometry`, inside, out);
    });
    if (doc.camera && !lonLat(doc.camera.position)) out.push('camera.position：經度在前，經度 ±180、緯度 ±90');
    const crop = doc.props && doc.props.crop;
    if (crop && doc.surface !== 'map' && (crop.x < 0 || crop.y < 0 || crop.x + crop.w > doc.w || crop.y + crop.h > doc.h)) out.push('props.crop：超出畫面範圍');
  }

  // 回傳錯誤清單（`欄位路徑：原因`），空陣列就是合格；不認得的欄位、type、詞彙略過
  function validate(doc) {
    const out = [];
    check(SCHEMA, doc, '', out);
    if (!out.length) relations(doc, out);
    return out;
  }

  return { VERSION, SCHEMA, validate };
});
