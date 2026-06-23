#!/bin/bash

# ============================================================
# restart.sh - 重启 AI 聊天助手应用
#
# 用法:
#   ./restart.sh              # 默认 production 环境
#   ./restart.sh development  # 指定环境
#   ./restart.sh stop         # 只停止
#   ./restart.sh status       # 查看状态
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
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

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
      # 等待进程退出（最多 10 秒）
      for i in $(seq 1 10); do
        if ! kill -0 "$pid" 2>/dev/null; then
          killed=true
          break
        fi
        sleep 1
      done
      # 还没退就强杀
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
      # 健康检查
      if curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
        info "健康检查: OK"
      else
        warn "健康检查: 无响应"
      fi
      return 0
    fi
  fi

  # 兜底查端口
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
start_app() {
  # 检查端口占用
  local port_pids
  port_pids=$(lsof -ti :"$PORT" 2>/dev/null || true)
  if [ -n "$port_pids" ]; then
    warn "端口 $PORT 已被占用 (PID: $port_pids)，先停止"
    stop_app
    sleep 1
  fi

  # 构建前端
  local frontend_dist="$APP_DIR/frontend/dist/index.html"
  if [ ! -f "$frontend_dist" ]; then
    info "前端未构建，正在构建..."
    if [ ! -d "$APP_DIR/frontend/node_modules" ]; then
      info "安装前端依赖..."
      (cd "$APP_DIR/frontend" && npm install)
    fi
    (cd "$APP_DIR/frontend" && npm run build)
    info "前端构建完成"
  else
    info "前端已就绪"
  fi

  # 启动
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
    # 检查进程是否还活着
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

# ==================== 主逻辑 ====================
case "$1" in
  stop)
    stop_app
    ;;
  status)
    show_status
    ;;
  restart|"")
    info "========== 重启应用 =========="
    stop_app
    sleep 1
    start_app
    ;;
  start)
    start_app
    ;;
  *)
    echo "用法: $0 {start|stop|restart|status} [environment]"
    echo ""
    echo "  restart (默认)  停止并重新启动"
    echo "  start           启动应用"
    echo "  stop            停止应用"
    echo "  status          查看运行状态"
    echo ""
    echo "环境变量: development | staging | production (默认 production)"
    echo ""
    echo "示例:"
    echo "  ./restart.sh                # production 重启"
    echo "  ./restart.sh development    # development 重启"
    echo "  ./restart.sh stop           # 停止"
    echo "  ./restart.sh status         # 查状态"
    exit 1
    ;;
esac
