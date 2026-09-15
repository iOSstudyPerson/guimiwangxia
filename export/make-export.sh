#!/usr/bin/env bash
# 生成可分享的干净源码副本（无业务数据、无密钥、无本工会专属信息）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TPL="$ROOT/export/templates"
STAMP="$(date +%Y%m%d)"
OUT_DIR="$ROOT/export/out"
DEST="$OUT_DIR/lotm-club-platform"
ZIP="$OUT_DIR/lotm-club-platform-$STAMP.zip"

mkdir -p "$OUT_DIR"
rm -rf "$DEST"
mkdir -p "$DEST"

echo "→ 从 $ROOT 复制源码到 $DEST"

copy_item() {
  local rel="$1"
  if [ -e "$ROOT/$rel" ]; then
    mkdir -p "$(dirname "$DEST/$rel")"
    cp -R "$ROOT/$rel" "$DEST/$rel"
  fi
}

copy_item "server.py"
copy_item "cos_util.py"
copy_item "index.html"
copy_item "start.sh"
copy_item "public.sh"
copy_item "Dockerfile"
copy_item "render.yaml"
copy_item ".gitignore"
copy_item "css"
copy_item "js"

# 使用通用模板，不复制本仓库里带工会信息的 README / .env.example
cp "$TPL/README.md" "$DEST/README.md"
cp "$TPL/.env.example" "$DEST/.env.example"

# 清理垃圾与敏感目录
find "$DEST" -name '.DS_Store' -delete 2>/dev/null || true
find "$DEST" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true
find "$DEST" -name '*.pyc' -delete 2>/dev/null || true
rm -rf "$DEST/data" "$DEST/.env" "$DEST/.git" "$DEST/bin" "$DEST/export"

# 抹去本工会品牌 / 桶名 / 默认口令等痕迹（仅改导出副本）
sanitize_file() {
  local f="$1"
  [ -f "$f" ] || return 0
  if ! grep -qI '' "$f" 2>/dev/null; then
    return 0
  fi
  local tmp="${f}.sanitize.tmp"
  sed \
    -e 's/王下七武海/我的工会/g' \
    -e "s/BEYONDERS' ARCHIVE/CLUB ARCHIVE/g" \
    -e 's/beyonders-archive/club-archive/g' \
    -e 's/wangxia-forum-1488262300/your-bucket-appid/g' \
    -e 's/wangxia-club/lotm-club/g' \
    -e 's/wangxia-local-migrate/club-local-migrate/g' \
    -e 's/ADMIN_USER:-我的工会/ADMIN_USER:-admin/g' \
    -e 's/ADMIN_USER:-王下七武海/ADMIN_USER:-admin/g' \
    -e 's/ADMIN_PASSWORD:-123456/ADMIN_PASSWORD:-please-change-me/g' \
    -e 's/get("ADMIN_USER", "我的工会")/get("ADMIN_USER", "admin")/g' \
    -e 's/get("ADMIN_USER", "王下七武海")/get("ADMIN_USER", "admin")/g' \
    -e 's/get("ADMIN_PASSWORD", "123456")/get("ADMIN_PASSWORD", "please-change-me")/g' \
    -e 's/ENV ADMIN_USER=.*/ENV ADMIN_USER=admin/' \
    -e 's/ENV ADMIN_PASSWORD=.*/ENV ADMIN_PASSWORD=please-change-me/' \
    -e 's/value: 我的工会/value: admin/g' \
    -e 's/value: 王下七武海/value: admin/g' \
    "$f" > "$tmp" && mv "$tmp" "$f"
}

while IFS= read -r -d '' f; do
  sanitize_file "$f"
done < <(find "$DEST" -type f ! -name '*.png' ! -name '*.jpg' ! -name '*.jpeg' ! -name '*.gif' ! -name '*.webp' ! -name '*.zip' -print0)

# 覆盖 start.sh / Dockerfile 默认账号，避免残留
cat > "$DEST/start.sh" <<'EOF'
#!/bin/zsh
cd "$(dirname "$0")"

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

export ADMIN_USER="${ADMIN_USER:-admin}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-please-change-me}"
export PORT="${PORT:-8765}"

if [[ "${COS_REGION}" == aap-* ]]; then
  export COS_REGION="ap-${COS_REGION#aap-}"
fi

if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -ti:"$PORT" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "端口 $PORT 已被占用，正在释放: $PIDS"
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
    sleep 0.5
  fi
fi

exec python3 server.py
EOF

cat > "$DEST/Dockerfile" <<'EOF'
# 诡秘之主俱乐部管理平台 · 容器示例
FROM python:3.12-slim
WORKDIR /app
COPY . /app
ENV ADMIN_USER=admin
ENV ADMIN_PASSWORD=please-change-me
ENV PORT=8765
EXPOSE 8765
CMD ["python3", "server.py"]
EOF

cat > "$DEST/render.yaml" <<'EOF'
services:
  - type: web
    name: lotm-club-platform
    runtime: python
    plan: free
    buildCommand: ""
    startCommand: python3 server.py
    envVars:
      - key: ADMIN_USER
        value: admin
      - key: ADMIN_PASSWORD
        generateValue: true
      - key: PORT
        value: "10000"
EOF

chmod +x "$DEST/start.sh" 2>/dev/null || true
chmod +x "$DEST/public.sh" 2>/dev/null || true

cat > "$DEST/START-HERE.txt" <<'EOF'
诡秘之主俱乐部管理平台 · 干净源码包
====================================

1. cp .env.example .env     # 设置你自己的管理员账号密码
2. 按需修改页面里的「我的工会」等品牌文案
3. ./start.sh
4. 浏览器打开 http://127.0.0.1:8765/

完整说明见 README.md
EOF

# 最终自检：不得残留本工会标识
LEAKS="$(grep -RIn --exclude-dir=.git \
  -e '王下七武海' -e '1488262300' -e 'wangxia-forum' -e 'wangxia-club' -e 'wangxia' \
  -e 'ADMIN_PASSWORD.*123456' -e ':-123456' \
  "$DEST" || true)"
if [ -n "$LEAKS" ]; then
  echo "✗ 导出包仍含敏感/工会信息，请检查：" >&2
  echo "$LEAKS" >&2
  exit 1
fi

if command -v zip >/dev/null 2>&1; then
  rm -f "$ZIP"
  (cd "$OUT_DIR" && zip -rq "$(basename "$ZIP")" "lotm-club-platform")
  echo "✓ 已生成目录: $DEST"
  echo "✓ 已生成压缩包: $ZIP"
else
  echo "✓ 已生成目录: $DEST"
  echo "（未找到 zip 命令，已跳过压缩包）"
fi

echo
echo "分享前请确认：包内没有 .env / data/，且品牌已换成占位名「我的工会」。"
