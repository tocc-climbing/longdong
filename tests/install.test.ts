import { describe, expect, it } from 'vitest'
import { detectIos } from '../src/install'

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const IPHONE_LINE = `${IPHONE_SAFARI} Line/14.10.0`
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'

describe('detectIos', () => {
  it('iPhone Safari、還沒加入主畫面：顯示教學', () => {
    expect(detectIos(IPHONE_SAFARI, 5, false)).toBe('safari')
  })

  it('已從主畫面開啟：不顯示', () => {
    expect(detectIos(IPHONE_SAFARI, 5, true)).toBeNull()
  })

  it('iPad 以 Mac UA 呈現時，用觸控點數辨認；真正的 Mac 不顯示', () => {
    expect(detectIos(IPAD_DESKTOP_UA, 5, false)).toBe('safari')
    expect(detectIos(IPAD_DESKTOP_UA, 0, undefined)).toBeNull()
  })

  it('LINE 等 App 的內建瀏覽器：提示先用 Safari 開啟', () => {
    expect(detectIos(IPHONE_LINE, 5, false)).toBe('in-app')
  })

  it('Android：不顯示 iOS 教學', () => {
    expect(detectIos(ANDROID, 5, undefined)).toBeNull()
  })
})
