/**
 * 掛片（bolt hanger）的圖形：上面的小孔是 bolt，下面的長孔扣鉤環。座標是 240×240。
 * 用在拉測回報的入口與 Topo 的「顯示 bolt」按鈕：攀岩的人一看就知道是固定點。
 */
export const HANGER =
  'M130 15C152 12 168 33 166 60L163 178C160 218 122 236 94 218C66 200 48 150 44 108C41 84 44 70 58 61L108 24C115 19 122 15 130 15Z' +
  'M114 64a16 16 0 1 0 32 0a16 16 0 1 0-32 0Z' +
  'M87.5 92.4A21 50 -18 1 0 118.5 187.6A21 50 -18 1 0 87.5 92.4Z'

/** 單色的掛片（跟著文字顏色），孔是透明的 */
export function HangerIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 240 240" width={size} height={size} aria-hidden>
      <path d={HANGER} fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}
