#!/bin/zsh
cd "$(dirname "$0")"

# 自动加载同目录 .env（若存在）
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# 可按需覆盖：ADMIN_USER / ADMIN_PASSWORD / PORT / COS_*
export ADMIN_USER="${ADMIN_USER:-王下七武海}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-123456}"
export PORT="${PORT:-8765}"

# 兼容误写 aap-shanghai
if [[ "${COS_REGION}" == aap-* ]]; then
  export COS_REGION="ap-${COS_REGION#aap-}"
fi

# 启动前释放被占用的端口，避免 Address already in use
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -ti:"$PORT" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "端口 $PORT 已被占用，正在释放: $PIDS"
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
    sleep 0.5
  fi
fi

exec python3 server.py
