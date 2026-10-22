/**
 * 藍色小岩點（Climbio 的岩點，有螺栓孔）：放在網站名稱後面當簽名，與 App 圖示、分享圖片相同
 * （外形見 scripts/gen-icons.ts、scripts/lib/ogImage.ts 的 HOLD）。
 */
export function HoldMark() {
  return (
    <svg className="hold-mark" viewBox="-44 -66 80 132" aria-hidden>
      <g transform="rotate(-16)">
        <path d="M-30,-56 C-6,-64 22,-50 26,-20 C30,10 24,46 0,56 C-24,62 -40,40 -38,6 C-36,-26 -46,-50 -30,-56 Z" />
        <circle className="hold-mark-hole" cx="-3.7" cy="-23.8" r="9" />
      </g>
    </svg>
  )
}
