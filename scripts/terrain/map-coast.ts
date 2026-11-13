/** 全圖以 OSM 海岸圍出陸地；攀岩岸段改用已核對的 B5000 細海岸。 */
import { readFileSync, writeFileSync } from 'node:fs'
import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import { EXTENT_LATLNG } from '../../src/map/extent'
import { coastLand } from '../lib/coastLand'

const osm = JSON.parse(readFileSync('scripts/data/osm-extent.json', 'utf8')) as { coastline: [number, number][][] }
const fine = JSON.parse(readFileSync('scripts/data/coast-b5000.json', 'utf8'))
const rect = ([w, s, e, n]: number[]): MultiPolygon => [[[[w, s], [e, s], [e, n], [w, n], [w, s]]]]
const { west, south, east, north } = EXTENT_LATLNG
const extent = [west, south, east, north]
// 救援示意圖的頁框拼接會在北側山坡留空；地形直接用原始海岸，不沿用該頁框。
const land: MultiPolygon = coastLand(osm.coastline.map((line) => line.map(([lat, lng]) => [lng, lat])), EXTENT_LATLNG).map((ring) => [ring])
const geometry = polygonClipping.intersection(polygonClipping.union(polygonClipping.difference(land, rect(fine.extent)), fine.geometry.coordinates), rect(extent))
writeFileSync('scripts/data/coast-map.json', JSON.stringify({ extent, attribution: '© OpenStreetMap contributors · © 內政部國土測繪中心', license: 'ODbL-1.0', sources: ['scripts/data/osm-extent.json', 'scripts/data/coast-b5000.json'], geometry: { type: 'MultiPolygon', coordinates: geometry } })+'\n')
console.log('全圖海岸', geometry.length, '塊；範圍', extent)
