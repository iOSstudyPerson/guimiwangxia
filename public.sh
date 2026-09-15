#!/bin/zsh
# 临时把本机服务暴露到公网（电脑需保持开机与 ./start.sh 运行中）
cd "$(dirname "$0")"
CF="./bin/cloudflared"
if [ ! -x "$CF" ]; then
  echo "缺少 bin/cloudflared，请先下载 Cloudflare Tunnel 客户端"
  exit 1
fi
echo "请确认已运行 ./start.sh"
echo "即将生成公网 HTTPS 链接（关掉本窗口后链接失效）..."
exec "$CF" tunnel --url "http://127.0.0.1:${PORT:-8765}"
