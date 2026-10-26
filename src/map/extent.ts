/**
 * 地圖資料的範圍（緯度、經度）：地圖的移動範圍（bounds.ts 的 BOUNDS，救援點周圍）四周各多約 600 公尺。
 * 一個區域放大到畫面約 600 公尺高時，在移動範圍內任意移動、旋轉，畫面四角都還在資料裡；縮到最小再旋轉時才看得到外面（畫成海的顏色）。
 * 這個範圍裡有航照與 OpenStreetMap 的陸地、建物、道路、步道（救援資訊圖沒有畫到的部分，見 scripts/gen-scale-map.ts、scripts/fetch-osm-extent.ts）。
 */
export const EXTENT_LATLNG = { north: 25.1205, south: 25.0958, west: 121.9084, east: 121.9313 }
