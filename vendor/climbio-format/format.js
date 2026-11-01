// Climbio 公開格式：可分享的牆面（kind: wall，室內）與 Topo（kind: topo，戶外）的 JSON Schema 和驗證器，規格見 README.md。
// 瀏覽器用 <script> 載入，掛在全域 ClimbioFormat；Node 用 require。climbio.schema.json 是 SCHEMA 原樣輸出給其他語言用（測試會比對）。
// English: Climbio open format: JSON Schema and validator for shared walls (indoor) and topos (outdoor). Apache-2.0.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClimbioFormat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const VERSION = 2;
  const ref = (name) => ({ $ref: `#/$defs/${name}` });
  const str = { type: 'string' }, int = { type: 'integer', minimum: 0 }, size = { type: 'integer', exclusiveMinimum: 0 };
  const map = (value) => ({ type: 'object', additionalProperties: value });
  const SCHEMA = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Climbio open format',
    oneOf: [ref('wall'), ref('topo')],
    $defs: {
      point: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
      // 照片：href 是相對路徑（不能往上層、不能從根目錄開始）或 https 網址；紙本、來源不明的照片不出裝置，origin 沒有這兩種
      photo: {
        type: 'object', required: ['href', 'w', 'h', 'mime', 'license', 'attribution', 'origin'],
        properties: {
          href: { type: 'string', pattern: '^(https://\\S+|(?![/\\\\])(?!(.*/)?\\.\\.(/|$))[^\\s:\\\\]+)$' },
          w: size, h: size,
          mime: { type: 'string', pattern: '^image/(jpeg|png|webp)$' },
          sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          license: { type: 'string', minLength: 1 },
          attribution: str,
          origin: { enum: ['self', 'authorized'] },
        },
      },
      derivedFrom: { type: 'object', required: ['url'], properties: { url: { type: 'string', pattern: '^https://' }, id: str, t: int } },
      hold: {
        type: 'object', required: ['id', 'poly'],
        properties: { id: { type: 'string', minLength: 1 }, poly: { type: 'array', items: ref('point'), minItems: 3 }, source: { enum: ['detect', 'edited', 'manual'] }, t: int },
      },
      route: {
        type: 'object', required: ['id', 'holds'],
        properties: {
          id: { type: 'string', pattern: '^[0-9a-z]{1,40}$' }, name: str, grade: str, author: str, t: int,
          holds: { ...map({ enum: ['s', 'h', 'f', 't'] }), minProperties: 1 },
          seq: { type: 'array', items: str },
          shapes: map(ref('hold')),
        },
      },
      wall: {
        type: 'object', required: ['climbio', 'kind', 'id', 'name', 'license', 't', 'photo', 'holds', 'routes'],
        properties: {
          climbio: { const: VERSION }, kind: { const: 'wall' },
          id: { type: 'string', pattern: '^[0-9a-z]{8,40}$' }, name: str, gym: str, author: str,
          license: { type: 'string', minLength: 1 }, t: int, derivedFrom: ref('derivedFrom'),
          thumb: { type: 'string', pattern: '^(data:image/|$)' },
          photo: ref('photo'),
          holds: { type: 'array', items: ref('hold') },
          routes: { type: 'array', items: ref('route') },
        },
      },
      topoRoute: {
        type: 'object',
        properties: { name: str, grade: str, line: { type: 'array', items: ref('point'), minItems: 2 }, bolts: map(ref('point')) },
      },
      position: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 3 },
      line: {
        oneOf: [
          { type: 'object', required: ['type', 'coordinates'], properties: { type: { const: 'LineString' }, coordinates: { type: 'array', items: ref('position'), minItems: 2 } } },
          { type: 'object', required: ['type', 'coordinates'], properties: { type: { const: 'MultiLineString' }, coordinates: { type: 'array', items: { type: 'array', items: ref('position'), minItems: 2 }, minItems: 1 } } },
        ],
      },
      topo: {
        type: 'object', required: ['climbio', 'kind', 'id', 'name', 'license', 't', 'photo', 'routes'],
        properties: {
          climbio: { const: VERSION }, kind: { const: 'topo' },
          id: { type: 'string', minLength: 1 }, name: str, author: str,
          license: { type: 'string', minLength: 1 }, t: int, derivedFrom: ref('derivedFrom'),
          source: { type: 'object', required: ['url'], properties: { url: { type: 'string', pattern: '^https://' }, version: str } },
          sector: str,
          photo: ref('photo'),
          crop: { type: 'object', required: ['x', 'y', 'w', 'h'], properties: { x: { type: 'number', minimum: 0 }, y: { type: 'number', minimum: 0 }, w: { type: 'number', exclusiveMinimum: 0 }, h: { type: 'number', exclusiveMinimum: 0 } } },
          routes: map(ref('topoRoute')),
          geo: { type: 'object', properties: { wall: ref('line') } },
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

  // ---------- SCHEMA 表達不了的：引用的 id 存在、座標在照片範圍內 ----------
  function relations(doc, out) {
    const { w, h } = doc.photo;
    const inside = (pts, where) => { if (pts.some(([x, y]) => x < 0 || y < 0 || x > w || y > h)) out.push(`${where}：座標超出照片範圍`); };
    if (doc.kind === 'wall') {
      const ids = new Set();
      doc.holds.forEach((hd, i) => { if (ids.has(hd.id)) out.push(`holds[${i}].id：重複的 ${hd.id}`); ids.add(hd.id); inside(hd.poly, `holds[${i}].poly`); });
      const rids = new Set();
      doc.routes.forEach((r, i) => {
        const where = `routes[${i}]`, own = r.shapes || {};
        if (rids.has(r.id)) out.push(`${where}.id：重複的 ${r.id}`);
        rids.add(r.id);
        for (const [k, sh] of Object.entries(own)) inside(sh.poly, `${where}.shapes.${k}.poly`);
        for (const k of Object.keys(r.holds)) if (!ids.has(k) && !own[k]) out.push(`${where}.holds.${k}：牆上和路線外框都沒有這顆岩點`);
        for (const k of r.seq || []) if (!(k in r.holds)) out.push(`${where}.seq：${k} 不是這條路線的岩點`);
      });
    } else {
      if (doc.crop) { const c = doc.crop; if (c.x + c.w > w || c.y + c.h > h) out.push('crop：超出照片範圍'); }
      for (const [k, r] of Object.entries(doc.routes)) {
        if (r.line) inside(r.line, `routes.${k}.line`);
        for (const [b, p] of Object.entries(r.bolts || {})) inside([p], `routes.${k}.bolts.${b}`);
      }
    }
  }

  // 回傳錯誤清單（`欄位路徑：原因`），空陣列就是合格；不認得的欄位略過
  function validate(doc) {
    const out = [];
    check(SCHEMA, doc, '', out);
    if (!out.length) relations(doc, out);
    return out;
  }

  return { VERSION, SCHEMA, validate };
});
