#!/usr/bin/env bash
# 服务器上首次部署（在 /opt 下以 root 或 sudo 执行）
# 用法：
#   export REPO_URL='https://github.com/<你的用户名>/wangxia-club.git'
#   sudo -E bash deploy/setup-server.sh
set -euo pipefail

REPO_URL="${REPO_URL:-}"
APP_DIR="${APP_DIR:-/opt/wangxia-club}"
APP_USER="${APP_USER:-www-data}"

if [[ -z "$REPO_URL" ]]; then
  echo "请先设置: export REPO_URL='https://github.com/<user>/wangxia-club.git'"
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请使用 sudo 运行"
  exit 1
fi

apt-get update -y
apt-get install -y git python3 ca-certificates

if [[ ! -d "$APP_DIR/.git" ]]; then
  mkdir -p "$(dirname "$APP_DIR")"
  git clone "$REPO_URL" "$APP_DIR"
else
  echo "目录已存在，跳过 clone: $APP_DIR"
fi

id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"

mkdir -p "$APP_DIR/data"
if [[ ! -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo "已生成 $APP_DIR/.env ，请编辑填写 ADMIN_PASSWORD / COS_*"
fi

chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env" || true

install -m 644 "$APP_DIR/deploy/wangxia.service" /etc/systemd/system/wangxia.service
# 若 APP_DIR / APP_USER 自定义，可 sed 替换；默认 /opt/wangxia-club + www-data
systemctl daemon-reload
systemctl enable wangxia
systemctl restart wangxia
systemctl --no-pager --full status wangxia || true

echo
echo "部署完成。请确认："
echo "  1) 已编辑 $APP_DIR/.env（强密码 + COS）"
echo "  2) 阿里云安全组放行 TCP 8765（或 80，若前面有 Nginx）"
echo "  3) 访问 http://<公网IP>:8765/"
echo "日常更新: sudo bash $APP_DIR/deploy/update.sh"
