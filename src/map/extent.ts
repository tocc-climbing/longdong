/**
 * 地圖資料的範圍（緯度、經度）：地圖的移動範圍（bounds.ts 的 BOUNDS）東西各多約 1.5 公里、南邊多約 1 公里、北邊多約 0.5 公里（北邊沒有岩場，不用太遠）。
 * 電腦的寬螢幕縮到最小時左右看得到範圍外（最多縮到畫面寬等於這個範圍，見 mapView.ts 的 maxScale）；
 * 一個區域放大來看時，在移動範圍內任意移動、旋轉，畫面四角都還在資料裡；縮到最小再旋轉時才看得到外面（畫成海的顏色）。
 * 這個範圍裡有航照（離線下載也涵蓋，外圈的層級粗一點，見 ortho.ts）與 OpenStreetMap 的陸地、建物、道路、步道
 * （救援資訊圖沒有畫到的部分，見 scripts/gen-scale-map.ts、scripts/fetch-osm-extent.ts）。
 */
export const EXTENT_LATLNG = { north: 25.1287, south: 25.0922, west: 121.8995, east: 121.9402 }
