# 來源

`climb-io/climbio-internal` 的 `dev` 分支 `format/`，commit `8257bebe30ff6fb5368e13f0740063bb244ea45d`（格式 2.1.0）。

規格只在那裡改，這裡不改；規格更新時整份重新複製，並更新上面的 commit。
`format.d.ts` 是原本的 `index.d.ts`，改名讓 TypeScript 對應到 `format.js`。
`@climbio/format` 上了 npm 之後改用 `npm install @climbio/format@^2`，刪掉這個資料夾。
