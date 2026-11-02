/**
 * 地圖（mapkit，src/map/KitMap.tsx）的定位：第一次定位到、或按了「回到我的位置」但還沒定位時，要不要自動移到目前位置。
 */

/** 等定位到要移到目前位置的請求：記下提出時聚焦的 key（沒有聚焦時 undefined） */
export interface CenterRequest {
  focus: string | undefined
}

/** 請求還有效：提出後沒有換過聚焦。換了聚焦（例如從清單選了救援點）就以聚焦為準，定位到也不移過去 */
export function centerPending(request: CenterRequest | undefined, focus: string | undefined): boolean {
  return request !== undefined && request.focus === focus
}
