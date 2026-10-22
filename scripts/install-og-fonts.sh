#!/usr/bin/env bash
# 分享圖片（scripts/lib/ogImage.ts）的字型，給 GitHub Actions（Ubuntu）用：
# - 英數：Noto Sans（apt 的 fonts-noto-core）
# - 中文：Noto Sans TC。apt 的 fonts-noto-cjk 是字型集合（.ttc），Skia 只讀得到第一個字族（日文），
#   所以另外下載繁中的單一字型檔（固定版本 Sans2.004）
set -euo pipefail
sudo apt-get update -qq
sudo apt-get install -y -qq fonts-noto-core
dir=/usr/share/fonts/opentype/noto-tc
sudo mkdir -p "$dir"
for weight in Regular Bold; do
  sudo curl -sSfL -o "$dir/NotoSansTC-$weight.otf" \
    "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/SubsetOTF/TC/NotoSansTC-$weight.otf"
done
