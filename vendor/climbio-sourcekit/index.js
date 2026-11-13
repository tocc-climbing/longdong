// sourcekit：外部資料來源（站台、擴充功能、匯入器）共用的純函式——Topo 照片尺寸、合成預覽圖版面。不碰 DOM，Node 與瀏覽器都能用。
// 要畫布的部分在 preview-sheet.js（瀏覽器），OSM／Commons 讀取在 openclimbing-read.js，各自單獨 import。
// English: shared pure helpers for sites and importers: topo photo size policy and the preview-sheet layout.
export * from './photo-size.js';
export * from './preview-layout.js';
