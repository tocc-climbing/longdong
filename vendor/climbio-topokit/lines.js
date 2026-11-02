// 路線線段的共用與編輯。座標是照片像素；路線是 { id, line?: [x, y][], bolts?: { 位置: { at: [x, y] } } }。
// v2 沒有共用線段：分岔是複製前段的點，兩端座標相同的線段就視為共用，只畫一次。
// 移植自龍洞（MIT）src/core/topo/lines.ts，座標由萬分比改成像素（距離不用再依寬高比換算）。
// English: shared segments and line editing. Fork = copied prefix points; identical segments are drawn once.

export const sameSpot = (a, b) => a[0] === b[0] && a[1] === b[1];

/** 線段的 key，兩端對調視為同一段 */
const segmentKey = (a, b) => (a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? `${a}|${b}` : `${b}|${a}`);

/** keep 為真的連續線段接成折線 */
function runsOf(line, keep) {
  const runs = [];
  let run;
  for (let i = 0; i < line.length - 1; i++) {
    if (!keep(segmentKey(line[i], line[i + 1]))) { run = undefined; continue; }
    if (!run) runs.push((run = [line[i]]));
    run.push(line[i + 1]);
  }
  return runs;
}

/** 每條路線實際要畫的折線：共用的線段只畫一次，歸排在前面的那條；連續的線段接成一條折線。lines：[id, line][] */
export function drawnRuns(lines) {
  const seen = new Set();
  return new Map(lines.map(([id, line]) => [id, runsOf(line, (key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })]));
}

/** 每條路線獨有的折線：不和任何一條路線共用的線段。分岔的編號標在這裡，不標在共用的前段 */
export function ownRuns(lines) {
  const uses = new Map();
  for (const [, line] of lines) {
    for (const key of new Set(line.slice(1).map((p, i) => segmentKey(line[i], p)))) uses.set(key, (uses.get(key) ?? 0) + 1);
  }
  return new Map(lines.map(([id, line]) => [id, runsOf(line, (key) => uses.get(key) === 1)]));
}

/**
 * 點在哪一段線的中間：垂足在線段內（兩端是把手，不算），距離不超過 near（照片像素）。
 * 回傳最近那段的起點索引，沒有則 -1。
 */
export function segmentAt(line, p, near) {
  let best = -1, bestDistance = near;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? -1 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    if (t <= 0 || t >= 1) continue;
    const distance = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    if (distance <= bestDistance) [best, bestDistance] = [i - 1, distance];
  }
  return best;
}

/**
 * 在路線 id 的線上加一個點：點在線段中間就插進那一段，否則接在線尾。
 * 插進共用的線段（分岔路線的前段）時，共用這一段的路線一起插入，兩條線不會分開。回傳新的路線陣列。
 */
export function addLinePoint(routes, id, p, near) {
  const line = routes.find((r) => r.id === id)?.line ?? [];
  const at = segmentAt(line, p, near);
  if (at < 0) return routes.map((r) => (r.id === id ? { ...r, line: [...line, p] } : r));
  const a = line[at], b = line[at + 1], key = segmentKey(a, b);
  return routes.map((r) => (r.line ? { ...r, line: r.line.flatMap((q, i, all) => (i < all.length - 1 && segmentKey(q, all[i + 1]) === key ? [q, p] : [q])) } : r));
}

/** 從另一條路線的第 index 個點分岔：複製到這個點為止的前段 */
export const forkLine = (line, index) => line.slice(0, index + 1);

/** 把所有落在 from 的線段端點一起移到 to：分岔出來的路線與原路線共用的點不會拖開 */
export function moveSharedPoint(routes, from, to) {
  return routes.map((r) => (r.line ? { ...r, line: r.line.map((p) => (sameSpot(p, from) ? to : p)) } : r));
}

/** 刪掉路線 id 的第 index 個點；落在同一個點的共用路線一起刪（和 moveSharedPoint 對稱，分岔不會斷開） */
export function removeLinePoint(routes, id, index) {
  const spot = routes.find((r) => r.id === id).line[index];
  return routes.map((r) => (r.line ? { ...r, line: r.line.filter((p, i) => !(sameSpot(p, spot) && (r.id !== id || i === index))) } : r));
}
