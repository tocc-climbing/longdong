import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Pt } from '../map/heroFit'
import { drape, sampleTerrainLines, terrainHeroFit, terrainMesh, type Terrain, type TerrainRegion, type TerrainWall } from '../map/terrain'
import { rasterTerrain } from '../map/terrainRaster'
import { coastalIslands, terrainFramingPoints } from '../map/terrainRegions'

const cached = new Map<string, Promise<Terrain>>()
export function loadTerrain(scope: 'hero' | 'map' = 'hero') {
  const file = scope === 'hero' ? 'terrain-20m.json' : 'terrain-map-20m.json'
  if (!cached.has(file)) cached.set(file, fetch(`${import.meta.env.BASE_URL}rescue/${file}`).then((res) => {
    if (!res.ok) throw new Error(`DTM: ${res.status}`)
    return res.json() as Promise<Terrain>
  }).catch((error) => { cached.delete(file); throw error }))
  return cached.get(file)!
}

export function TerrainHero({ regions, walls, fit, overview, includeIslands, single, className }: {
  regions: TerrainRegion[]; walls: TerrainWall[]; fit: Pt[]; overview?: boolean; includeIslands?: boolean; single?: boolean; className?: string
}) {
  const ref = useRef<SVGSVGElement>(null)
  const id = useId().replace(/:/g, '')
  const [size, setSize] = useState<{ w: number; h: number }>()
  const [terrain, setTerrain] = useState<Terrain>()
  const [error, setError] = useState(false)
  useEffect(() => {
    let alive = true
    loadTerrain().then((t) => { if (alive) setTerrain(t) }, () => { if (alive) setError(true) })
    const element = ref.current!
    const observer = new ResizeObserver(() => {
      const r = element.getBoundingClientRect()
      setSize((old) => old?.w === r.width && old.h === r.height ? old : { w: r.width, h: r.height })
    })
    observer.observe(element)
    return () => { alive = false; observer.disconnect() }
  }, [])
  const scene = useMemo(() => {
    if (!terrain || !size || !fit.length) return undefined
    const inset = overview ? { top: 8, bottom: 8, left: 8, right: 8 } : { top: 54, bottom: 10, left: 12, right: 10 }
    const box = { ...size, ...inset }
    const islands = coastalIslands(terrain, regions)
    const fitting = overview || includeIslands
      ? [...fit, ...terrainFramingPoints(terrain, regions, size.w >= 600 ? 3 : 2), ...islands.flatMap((i) => i.ring)]
      : [...fit, ...sampleTerrainLines(terrain, walls.filter((w) => w.strong).flatMap((w) => w.lines), 0, 4).flatMap((p) => p ? [p.at] : [])]
    const placed = terrainHeroFit(terrain, fitting, box, { spread: overview || includeIslands ? 1.05 : 1.2, minSpan: overview || includeIslands ? 0 : single ? 65 : 100 })
    if (!placed) return undefined
    const angle = placed.angle
    const raster = rasterTerrain(terrain, regions, angle, placed.viewBox, size.w, size.h)
    const vector = raster ? undefined : terrainMesh(terrain, angle, placed.viewBox, 1)
    return {
      raster, paths: vector?.paths ?? [], triangles: raster?.triangles ?? vector!.triangles,
      viewBox: placed.viewBox, angle,
      // GPU 依地面座標裁海岸；只有無 WebGL2 的向量版使用投影輪廓。
      coastClip: raster ? undefined : terrain.coast?.flatMap((poly) => poly.map((ring) => drape(terrain, [[...ring, ring[0]]], angle, 0, 4)+'Z')).join(''),
      islands: islands.map((island) => ({ ...island, d: drape(terrain, [[...island.ring, island.ring[0]]], angle, 0, 4)+'Z' })),
      outlines: raster ? [] : regions.map((r) => ({ id: r.id, color: r.color, d: drape(terrain, r.rings.map((ring) => [...ring, ring[0]]), angle, 0) })),
      walls: walls.map((w) => ({ ...w, d: drape(terrain, w.lines, angle, 1.2) })),
    }
  }, [terrain, size, regions, walls, fit, overview, includeIslands, single])
  return <svg ref={ref} className={`${className ?? ''} hero-map terrain-hero`} viewBox={scene?.viewBox.join(' ')} aria-hidden data-terrain={error ? 'error' : scene ? 'ready' : 'loading'} data-bearing={scene?.angle} data-triangles={scene?.triangles} data-estimated-points={terrain?.interpolated?.length} data-renderer={scene?.raster ? 'webgl' : 'svg'} data-detail-meters={scene?.raster?.sampleMeters} data-coast-resolution={scene?.raster?.coastMeters} data-region-count={regions.length} data-wall-coverage={scene?.raster?.wallCoverage} data-continuous-coverage={scene?.raster?.continuousCoverage}>
    <title>{error ? 'DTM unavailable' : '© 內政部地政司 · Taiwan DTM 20m · 2025 · TWVD2001'}</title>
    {scene && <>
      <defs>
        {scene.coastClip && <clipPath id={`${id}-coast`}><path data-coastline d={scene.coastClip} clipRule="evenodd" /></clipPath>}
        {scene.outlines.map((r, i) => <clipPath key={i} id={`${id}-region-${i}`}><path d={r.d} /></clipPath>)}
        <g id={`${id}-mesh`} strokeLinejoin="round">
          {scene.raster ? <image data-surface="all" href={scene.raster.all} x={scene.viewBox[0]} y={scene.viewBox[1]} width={scene.viewBox[2]} height={scene.viewBox[3]} preserveAspectRatio="none" /> : [false, true].map((sea) => <g key={String(sea)} data-surface={sea ? 'sea' : 'land'}>
            {scene.paths.filter((p) => p.sea === sea).map((p, i) => <path key={i} d={p.d} fill="currentColor" stroke="currentColor" strokeWidth={0.25} style={{ filter: `brightness(${0.66+p.shade*0.055})` }} />)}
          </g>)}
        </g>
      </defs>
      <g className="terrain-surface" clipPath={scene.coastClip ? `url(#${id}-coast)` : undefined}>
        {scene.raster ? <use data-terrain-regions href={`#${id}-mesh`} opacity={0.95} /> : scene.outlines.map((r, i) => <use key={r.id} data-region={r.id} href={`#${id}-mesh`} color={r.color} opacity={0.9} clipPath={`url(#${id}-region-${i})`} />)}
      </g>
      <g className="terrain-islands">
        {scene.islands.map((island) => <path key={island.id} data-terrain-island={island.id} d={island.d} fill={island.color} fillOpacity={0.95} stroke={`color-mix(in srgb, ${island.color} 80%, white)`} strokeWidth={0.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
      </g>
      {scene.outlines.map((r, i) => <path key={i} d={r.d} fill="none" stroke={r.color} strokeWidth={0.8} strokeOpacity={0.45} vectorEffect="non-scaling-stroke" />)}
      {scene.walls.map((w, i) => <g key={i} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {w.strong && <path d={w.d} stroke="#fff" strokeOpacity={0.45} strokeWidth={4} vectorEffect="non-scaling-stroke" />}
        <path data-wall={w.strong ? 'strong' : 'nearby'} d={w.d} stroke={w.color} strokeWidth={w.strong ? 2.5 : 1.4} strokeOpacity={w.strong ? 1 : 0.45} vectorEffect="non-scaling-stroke" />
      </g>)}
    </>}
  </svg>
}
