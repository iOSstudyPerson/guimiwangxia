#!/usr/bin/env bash
# 服务器日常更新：git pull + 重启
# 用法：sudo bash /opt/wangxia-club/deploy/update.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

# root 更新 www-data 所属仓库时，避免 dubious ownership
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

echo "==> 拉取最新代码"
git fetch --all --prune
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git pull --ff-only origin "$BRANCH"

echo "==> 重启服务"
systemctl restart wangxia
systemctl --no-pager --full status wangxia || true

echo "==> 完成 $(date '+%F %T')  当前提交: $(git rev-parse --short HEAD)"
