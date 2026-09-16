#!/usr/bin/env bash
# 本机一键发布：提交(可选) → 推 GitHub → SSH 更新云服务器
# 用法：
#   ./deploy/ship.sh -m "说明这次改了什么"
#   ./deploy/ship.sh                 # 无未提交改动时，只 push + 更新服务器
#   ./deploy/ship.sh --skip-commit   # 跳过提交，只 push + 更新服务器
#   ./deploy/ship.sh --server-only   # 只更新服务器（不 push）
#   ./deploy/ship.sh --dry-run       # 只打印将要执行的步骤
#
# 可选本地配置（勿提交）：deploy/ship.local.env
#   DEPLOY_HOST=139.224.224.26
#   DEPLOY_USER=root
#   DEPLOY_PATH=/opt/wangxia-club
#   DEPLOY_BRANCH=main
#   DEPLOY_SSH_OPTS="-o ConnectTimeout=15"

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ---------- 默认配置（可用环境变量 / ship.local.env 覆盖）----------
DEPLOY_HOST="${DEPLOY_HOST:-139.224.224.26}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/wangxia-club}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
DEPLOY_SSH_OPTS="${DEPLOY_SSH_OPTS:--o StrictHostKeyChecking=accept-new -o ConnectTimeout=20}"
LIVE_URL="${LIVE_URL:-http://${DEPLOY_HOST}:8765/}"

if [[ -f "$ROOT/deploy/ship.local.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "$ROOT/deploy/ship.local.env"
  set +a
fi

COMMIT_MSG=""
SKIP_COMMIT=0
SERVER_ONLY=0
DRY_RUN=0
PUSH_ONLY=0

usage() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message)
      COMMIT_MSG="${2:-}"
      shift 2
      ;;
    --skip-commit) SKIP_COMMIT=1; shift ;;
    --server-only) SERVER_ONLY=1; shift ;;
    --push-only) PUSH_ONLY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage 0 ;;
    *)
      echo "未知参数: $1" >&2
      usage 1
      ;;
  esac
done

# ---------- 日志 ----------
ts() { date '+%H:%M:%S'; }
log()  { printf '[%s] %s\n' "$(ts)" "$*"; }
ok()   { printf '[%s] ✓ %s\n' "$(ts)" "$*"; }
warn() { printf '[%s] ! %s\n' "$(ts)" "$*" >&2; }
die()  { printf '[%s] ✗ %s\n' "$(ts)" "$*" >&2; exit 1; }
run()  {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "(dry-run) $*"
    return 0
  fi
  log "+ $*"
  "$@"
}

# ---------- 预检 ----------
log "======== 王下七武海 · 一键发布 ========"
log "项目目录: $ROOT"
log "GitHub:   $(git remote get-url origin 2>/dev/null || echo '无 origin')"
log "服务器:   ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}"
log "分支:     ${DEPLOY_BRANCH}"
[[ "$DRY_RUN" -eq 1 ]] && warn "dry-run：不会真正执行写操作"

command -v git >/dev/null || die "未找到 git"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "当前目录不是 git 仓库"

# 禁止把敏感文件加进提交
assert_no_secrets_staged() {
  local bad
  bad="$(git diff --cached --name-only | grep -E '(^|/)\.env$|\.db$|credentials|secret' || true)"
  if [[ -n "$bad" ]]; then
    die "暂存区含敏感文件，已中止："$'\n'"$bad"
  fi
}

has_changes() {
  ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]
}

# ---------- 1) 提交 ----------
if [[ "$SERVER_ONLY" -eq 0 && "$SKIP_COMMIT" -eq 0 ]]; then
  log "步骤 1/3 · 检查本地改动"
  if has_changes; then
    if [[ -z "$COMMIT_MSG" ]]; then
      die "有未提交改动，请带提交说明：  ./deploy/ship.sh -m \"你的说明\""
    fi
    log "发现未提交改动，准备提交…"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      log "(dry-run) git add -A && git commit -m \"$COMMIT_MSG\""
      git status -sb
    else
      git add -A
      assert_no_secrets_staged
      # 若 hook 或空提交，不视为致命（后面 push 仍可继续）
      if git diff --cached --quiet; then
        warn "暂存区为空（可能都是被忽略文件），跳过 commit"
      else
        git commit -m "$COMMIT_MSG"
        ok "已提交: $(git log -1 --oneline)"
      fi
    fi
  else
    ok "工作区干净，无需 commit"
  fi
else
  log "步骤 1/3 · 跳过提交"
fi

# ---------- 2) 推 GitHub ----------
if [[ "$SERVER_ONLY" -eq 0 ]]; then
  log "步骤 2/3 · 推送到 GitHub (origin/${DEPLOY_BRANCH})"
  CURRENT="$(git rev-parse --abbrev-ref HEAD)"
  if [[ "$CURRENT" != "$DEPLOY_BRANCH" ]]; then
    warn "当前分支是「$CURRENT」，将 push 到 origin/${DEPLOY_BRANCH}"
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "(dry-run) git push -u origin HEAD:${DEPLOY_BRANCH}"
  else
    if ! git push -u origin "HEAD:${DEPLOY_BRANCH}"; then
      die "git push 失败。若 443 超时请开 VPN；认证请用 GitHub Personal Access Token"
    fi
    ok "GitHub 已更新: $(git rev-parse --short HEAD)"
  fi
else
  log "步骤 2/3 · 跳过 GitHub push (--server-only)"
fi

if [[ "$PUSH_ONLY" -eq 1 ]]; then
  ok "仅 push，完成"
  exit 0
fi

# ---------- 3) 云服务器更新 ----------
log "步骤 3/3 · 更新云服务器（git pull + 重启，不碰 .env / club.db）"
command -v ssh >/dev/null || die "未找到 ssh"

# 注意：远程命令用单引号包裹，避免本机展开
REMOTE_CMD='set -euo pipefail; cd '"'"${DEPLOY_PATH}"'"' && sudo bash deploy/update.sh && echo REMOTE_HEAD=$(git rev-parse --short HEAD)'

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "(dry-run) ssh ${DEPLOY_USER}@${DEPLOY_HOST} → ${DEPLOY_PATH}/deploy/update.sh"
else
  # shellcheck disable=SC2086
  if ! ssh ${DEPLOY_SSH_OPTS} "${DEPLOY_USER}@${DEPLOY_HOST}" "$REMOTE_CMD"; then
    die "服务器更新失败。请确认：1) SSH 能登录 ${DEPLOY_USER}@${DEPLOY_HOST}  2) 服务器上 ${DEPLOY_PATH} 存在  3) 有 sudo 权限跑 update.sh"
  fi
  ok "云服务器代码已更新并重启服务"
fi

# ---------- 健康检查（非致命）----------
log "健康检查: ${LIVE_URL}"
if [[ "$DRY_RUN" -eq 1 ]]; then
  log "(dry-run) curl ${LIVE_URL}api/overview"
else
  if command -v curl >/dev/null; then
    CODE="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 8 "${LIVE_URL}api/overview" || true)"
    if [[ "$CODE" == "200" ]]; then
      ok "线上接口正常 (HTTP $CODE) → ${LIVE_URL}"
    else
      warn "线上探测返回 HTTP ${CODE:-无}，请浏览器强制刷新确认: ${LIVE_URL}"
    fi
  else
    warn "无 curl，请自行打开 ${LIVE_URL}"
  fi
fi

ok "======== 发布完成 $(date '+%F %T') ========"
echo
echo "提示：浏览器建议强制刷新（Cmd+Shift+R）以加载最新前端资源。"
