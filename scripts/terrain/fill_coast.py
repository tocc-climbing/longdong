"""以既有海岸線與實測網格補近岸小缺口；不修改任何有效 DTM 樣點。"""
import math


def inside_ring(p, ring):
    x, y = p
    inside = False
    for i, a in enumerate(ring):
        b = ring[i-1]
        if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
            inside = not inside
    return inside


def segment_distance(p, a, b):
    dx, dy = b[0]-a[0], b[1]-a[1]
    length = dx*dx+dy*dy
    u = max(0, min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)) if length else 0
    return math.hypot(p[0]-a[0]-u*dx, p[1]-a[1]-u*dy)


def runs(indices):
    result = []
    for i in indices:
        if result and result[-1][0]+result[-1][1] == i:
            result[-1][1] += 1
        else:
            result.append([i, 1])
    return result


def fill_coast(samples, columns, points, polygons, extent):
    """海面缺值為 0；陸上 ≤9 格、跨度 ≤3 格的缺口，以 80m 內實測點及海岸零高程反距離加權。"""
    left, top, right, bottom = extent
    land, sea, water = set(), [], []
    for i, p in enumerate(points):
        if not (left <= p[0] <= right and top <= p[1] <= bottom):
            continue  # 海岸圖範圍外不能直接判成海面。
        on_land = any(inside_ring(p, poly[0]) and not any(inside_ring(p, h) for h in poly[1:]) for poly in polygons)
        if on_land:
            if samples[i] is None:
                land.add(i)
        else:
            water.append(i)
            if samples[i] is None:
                sea.append(i)
    heights = samples.copy()
    for i in sea:
        heights[i] = 0
    # 排除裁切框的人工邊界，不把框邊當作零公尺海岸。
    segments = []
    for poly in polygons:
        for ring in poly:
            for a, b in zip(ring, ring[1:]+ring[:1]):
                artificial = any(abs(a[axis]-edge) < 0.05 and abs(b[axis]-edge) < 0.05
                                 for axis, edge in [(0, left), (0, right), (1, top), (1, bottom)])
                if not artificial:
                    segments.append((a, b))
    estimated = []
    pending = set(land)
    while pending:
        component = {pending.pop()}
        queue = list(component)
        for i in queue:
            col = i % columns
            adjacent = [i-columns, i+columns] + ([i-1] if col else []) + ([i+1] if col+1 < columns else [])
            for j in adjacent:
                if j in pending:
                    pending.remove(j)
                    component.add(j)
                    queue.append(j)
        cols, rows = [i % columns for i in component], [i // columns for i in component]
        if len(component) > 9 or max(cols)-min(cols) > 2 or max(rows)-min(rows) > 2:
            continue
        for i in sorted(component):
            p = points[i]
            near = []
            col, row = i % columns, i // columns
            for r in range(max(0, row-4), min(len(samples)//columns, row+5)):
                for c in range(max(0, col-4), min(columns, col+5)):
                    j = r*columns+c
                    if samples[j] is not None:
                        distance = math.dist(p, points[j])
                        if 0 < distance <= 80:
                            near.append((distance, samples[j]))
            if len(near) < 3:
                continue
            near = sorted(near)[:8]
            coast = min((segment_distance(p, a, b) for a, b in segments), default=math.inf)
            if coast <= 80:
                if coast < 0.01:
                    heights[i] = 0
                    estimated.append(i)
                    continue
                near.append((coast, 0))
            weight = sum(1/d**2 for d, _ in near)
            heights[i] = round(sum(z/d**2 for d, z in near)/weight)
            estimated.append(i)
    return heights, runs(sea), sorted(estimated), sorted(land-set(estimated)), runs(water)
