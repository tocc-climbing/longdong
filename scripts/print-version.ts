/** 印出目前 commit 的 App 版號（例如 1.0.98），部署時打版號標籤用 */
import { appVersion } from './lib/appVersion'

console.log(appVersion().version)
