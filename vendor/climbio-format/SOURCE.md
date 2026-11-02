# 來源

`climb-io/climbio-internal` 的 `dev` 分支 `format/`，commit `22070e249666d64a62cf2013827a4ab4a97d40b0`（格式 2.2.0）。

規格只在那裡改，這裡不改；規格更新時整份重新複製，並更新上面的 commit。
`format.d.ts` 是原本的 `index.d.ts`，改名讓 TypeScript 對應到 `format.js`；`index.mjs`、`package.json` 是 npm 套件用的，沒有複製。
`@climbio/format` 上了 npm 之後改用 `npm install @climbio/format@^2`，刪掉這個資料夾。
