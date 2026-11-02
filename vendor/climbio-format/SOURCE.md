# 來源

`climb-io/climbio-internal` 的 `dev` 分支 `format/`，commit `22070e249666d64a62cf2013827a4ab4a97d40b0`（格式 2.2.0）。

規格只在那裡改，這裡不改；規格更新時整份重新複製，並更新上面的 commit。
`format.d.ts` 是原本的 `index.d.ts`，改名讓 TypeScript 對應到 `format.js`；`index.mjs` 是 npm 套件的 ESM 入口，沒有複製。
`package.json` 照原樣複製：沒有 `type`，Node 才會把 `format.js` 當 CommonJS 載入（建置腳本用預設匯入）。
`@climbio/format` 上了 npm 之後改用 `npm install @climbio/format@^2`，刪掉這個資料夾。
