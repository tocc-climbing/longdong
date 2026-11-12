/** 原向量圖全範圍；攀岩岸段改用已核對的 B5000 細海岸。 */
import { readFileSync, writeFileSync } from 'node:fs'
import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import { EXTENT_LATLNG } from '../../src/map/extent'

const base = JSON.parse(readFileSync('public/rescue/kitbase.json', 'utf8'))
const fine = JSON.parse(readFileSync('scripts/data/coast-b5000.json', 'utf8'))
const rect = ([w, s, e, n]: number[]): MultiPolygon => [[[[w, s], [e, s], [e, n], [w, n], [w, s]]]]
const { west, south, east, north } = EXTENT_LATLNG
const extent = [west, south, east, north]
const land = base.marks.find((m: { props?: { kind: string } }) => m.props?.kind === 'land').geometry.coordinates as MultiPolygon
const geometry = polygonClipping.intersection(polygonClipping.union(polygonClipping.difference(land, rect(fine.extent)), fine.geometry.coordinates), rect(extent))
writeFileSync('scripts/data/coast-map.json', JSON.stringify({ extent, attribution: base.attribution, license: 'ODbL-1.0', sources: ['public/rescue/kitbase.json', 'scripts/data/coast-b5000.json'], geometry: { type: 'MultiPolygon', coordinates: geometry } })+'\n')
console.log('全圖海岸', geometry.length, '塊；範圍', extent)
