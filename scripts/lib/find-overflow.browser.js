/**
 * 在瀏覽器裡執行的檢查（scripts/check-text-overflow.ts 以原始碼字串送進頁面）：找出超出元件或畫面的文字。
 * 刻意寫成純 JS、不經過 TypeScript 編譯：編譯器插入的輔助函式在瀏覽器裡不存在。
 */
(function findProblems() {
  const problems = []
  const describe = (el) => {
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''
    return el.tagName.toLowerCase() + cls
  }
  const text = (el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  // 可以左右捲動或刻意隱藏的區域，裡面超出是正常的
  const exempt = (el) => !!el.closest('.table-wrap, .map-frame, .scale-map-frame > svg, .visually-hidden, [aria-hidden="true"]')

  const root = document.scrollingElement
  if (root.scrollWidth > window.innerWidth + 1) {
    problems.push({ kind: '頁面水平捲軸', element: 'html', text: '', detail: `內容寬 ${root.scrollWidth}px > 畫面 ${window.innerWidth}px` })
  }

  for (const el of document.querySelectorAll('main *, nav *, aside *, header *, .banner *')) {
    if (!(el instanceof HTMLElement) || exempt(el) || !el.offsetParent) continue
    if (!el.textContent?.trim()) continue
    const style = getComputedStyle(el)
    const nowrap = style.whiteSpace === 'nowrap' || style.whiteSpace === 'pre'
    const clips = style.overflowX === 'hidden' || style.overflowX === 'clip'
    const ellipsis = style.textOverflow === 'ellipsis'
    // 只看直接含文字的元素（避免同一個問題在每一層容器重複回報）
    const ownText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
    if (ownText && (nowrap || clips) && !ellipsis && el.scrollWidth > el.clientWidth + 1) {
      problems.push({ kind: '文字超出元件', element: describe(el), text: text(el), detail: `內容 ${el.scrollWidth}px > 元件 ${el.clientWidth}px` })
    }
    if (ownText) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.right > window.innerWidth + 1 && style.position !== 'fixed') {
        problems.push({ kind: '超出畫面右緣', element: describe(el), text: text(el), detail: `右緣 ${Math.round(r.right)}px > 畫面 ${window.innerWidth}px` })
      }
    }
  }
  // 應該是單行的元件（按鈕、膠囊、欄位標題、分頁）：文字太長時會被擠成兩行，也算超出
  const SINGLE_LINE =
    '.chip, .action, .sm-control, .sm-chip, .fact, .share-button, .rescue-button, .rt-sort, .rt-head > span, .segmented button, ' +
    '.bottom-nav a > span, .side-nav a, .area-tree a, .grade-pill, .badge, .share-menu button, .call-button strong, .sort-select select'
  for (const el of document.querySelectorAll(SINGLE_LINE)) {
    if (!(el instanceof HTMLElement) || exempt(el) || !el.offsetParent || !el.textContent?.trim()) continue
    // 只看文字本身的位置（圖示、圓點的高度和文字不同，不算換行）；相差超過半個字高才算另一行
    const half = parseFloat(getComputedStyle(el).fontSize) / 2
    const tops = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const r of range.getClientRects()) if (r.width > 0) tops.push(r.top)
    }
    const lines = tops.sort((a, b) => a - b).filter((top, i, all) => i === 0 || top - all[i - 1] > half).length
    if (lines > 1) problems.push({ kind: '應為單行卻換行', element: describe(el), text: text(el), detail: `${lines} 行` })
  }
  return problems
})
