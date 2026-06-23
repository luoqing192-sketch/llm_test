#!/bin/bash

# ============================================================
# restart.sh - 部署 & 重启 AI 聊天助手应用
#
# 用法:
#   ./restart.sh              # 拉代码 + 安装 + 构建 + 重启
#   ./restart.sh development  # 指定环境
#   ./restart.sh stop         # 只停止
#   ./restart.sh status       # 查看状态
#   ./restart.sh start        # 只启动（不拉代码）
# ============================================================

set -e

ENV=${1:-production}
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$APP_DIR/app.pid"
LOG_FILE="$APP_DIR/app.log"
PORT=3000

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
step()  { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

# ==================== 拉取代码 ====================
pull_code() {
  step "1/4 拉取最新代码"
  cd "$APP_DIR"

  local branch
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
  info "当前分支: $branch"

  local before after
  before=$(git rev-parse HEAD 2>/dev/null)

  git pull origin "$branch"
  after=$(git rev-parse HEAD 2>/dev/null)

  if [ "$before" = "$after" ]; then
    info "已是最新，无新提交"
  else
    info "代码已更新: ${before:0:7} → ${after:0:7}"
    git log --oneline "${before}..${after}" 2>/dev/null | head -5
  fi
}

# ==================== 安装依赖 ====================
install_deps() {
  step "2/4 安装后端依赖"
  cd "$APP_DIR"

  if [ -f "package.json" ]; then
    npm install --production=false
    info "后端依赖安装完成"
  else
    warn "未找到 package.json，跳过"
  fi
}

# ==================== 构建前端 ====================
build_frontend() {
  step "3/4 构建前端"
  local frontend_dir="$APP_DIR/frontend"

  if [ ! -d "$frontend_dir" ]; then
    warn "frontend/ 目录不存在，跳过"
    return
  fi

  cd "$frontend_dir"

  # 安装前端依赖
  if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
    info "安装前端依赖..."
    npm install
  fi

  # 始终重新构建（代码可能变了）
  info "构建前端..."
  npm run build
  info "前端构建完成"
}

# ==================== 停止 ====================
stop_app() {
  local killed=false

  # 1. PID 文件
  if [ -f "$PID_FILE" ]; then
    local pid
    pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      info "停止进程 PID=$pid ..."
      kill "$pid"
      for i in $(seq 1 10); do
        if ! kill -0 "$pid" 2>/dev/null; then
          killed=true
          break
        fi
        sleep 1
      done
      if ! $killed; then
        warn "进程未响应，强制终止"
        kill -9 "$pid" 2>/dev/null || true
        killed=true
      fi
    fi
    rm -f "$PID_FILE"
  fi

  # 2. 兜底：按端口杀进程
  local port_pids
  port_pids=$(lsof -ti :"$PORT" 2>/dev/null || true)
  if [ -n "$port_pids" ]; then
    info "清理端口 $PORT 上的残留进程: $port_pids"
    echo "$port_pids" | xargs kill -9 2>/dev/null || true
    killed=true
  fi

  if $killed; then
    info "应用已停止"
  else
    warn "没有发现运行中的应用"
  fi
}

# ==================== 状态 ====================
show_status() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      info "应用运行中  PID=$pid  端口=$PORT  环境=$ENV"
      if curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
        info "健康检查: OK"
      else
        warn "健康检查: 无响应"
      fi
      return 0
    fi
  fi

  local port_pids
  port_pids=$(lsof -ti :"$PORT" 2>/dev/null || true)
  if [ -n "$port_pids" ]; then
    info "端口 $PORT 有进程: $port_pids（PID 文件丢失）"
    return 0
  fi

  warn "应用未运行"
  return 1
}

# ==================== 启动 ====================
start_app_process() {
  step "4/4 启动应用"

  # 检查端口占用
  local port_pids
  port_pids=$(lsof -ti :"$PORT" 2>/dev/null || true)
  if [ -n "$port_pids" ]; then
    warn "端口 $PORT 已被占用 (PID: $port_pids)，先停止"
    stop_app
    sleep 1
  fi

  export NODE_ENV="$ENV"
  export PORT="$PORT"

  info "启动应用  环境=$ENV  端口=$PORT"
  nohup node "$APP_DIR/server.js" >> "$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_FILE"

  # 等待启动（最多 15 秒）
  for i in $(seq 1 15); do
    if curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
      echo ""
      info "应用启动成功  PID=$pid"
      info "访问地址: http://localhost:$PORT"
      info "日志文件: $LOG_FILE"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo ""
      error "启动失败，进程已退出。查看日志:"
      tail -20 "$LOG_FILE"
      rm -f "$PID_FILE"
      return 1
    fi
    printf "."
    sleep 1
  done

  echo ""
  warn "启动超时（15秒），进程仍在运行 PID=$pid，请检查日志: $LOG_FILE"
}

# ==================== 完整部署流程 ====================
deploy() {
  echo -e "${CYAN}"
  echo "╔══════════════════════════════════════╗"
  echo "║     AI 聊天助手 - 部署 & 重启       ║"
  echo "╚══════════════════════════════════════╝"
  echo -e "${NC}"
  info "环境: $ENV  目录: $APP_DIR"

  # 停止旧进程
  stop_app
  sleep 1

  # 拉代码 → 装依赖 → 构建 → 启动
  pull_code
  install_deps
  build_frontend
  start_app_process

  echo ""
  info "========== 部署完成 =========="
}

# ==================== 主逻辑 ====================
case "$1" in
  stop)
    stop_app
    ;;
  status)
    show_status
    ;;
  start)
    start_app_process
    ;;
  restart|"")
    deploy
    ;;
  pull)
    pull_code
    ;;
  build)
    build_frontend
    ;;
  *)
    echo "用法: $0 {restart|start|stop|status|pull|build} [environment]"
    echo ""
    echo "  restart (默认)  拉代码 + 安装依赖 + 构建前端 + 重启  ← 推荐"
    echo "  start           只启动（不拉代码、不构建）"
    echo "  stop            停止应用"
    echo "  status          查看运行状态"
    echo "  pull            只拉取代码"
    echo "  build           只构建前端"
    echo ""
    echo "环境: development | staging | production (默认 production)"
    echo ""
    echo "示例:"
    echo "  ./restart.sh                # 完整部署: pull → install → build → restart"
    echo "  ./restart.sh development    # development 环境完整部署"
    echo "  ./restart.sh start          # 仅启动"
    echo "  ./restart.sh stop           # 停止"
    echo "  ./restart.sh status         # 查状态"
    exit 1
    ;;
esac
