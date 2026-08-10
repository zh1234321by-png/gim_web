#!/bin/bash
# ============================================================
# SEGM 课题组网站 - 阿里云 ECS 部署脚本
# 项目：西安科技大学测绘科学与技术学院
#       空间环境与地质灾害监测课题组网站
# 架构：Next.js 16 (App Router) + Tailwind CSS 4
# 服务器：阿里云 ECS (Ubuntu)
# 公网 IP：8.130.47.186
# 前端端口：5200
# ============================================================

set -e  # 遇到错误立即退出

# ==================== 配置区 ====================
PROJECT_NAME="segm-web"
PROJECT_DIR="/mnt/SEGMweb"          # 项目部署路径
FRONTEND_PORT=5200                   # 前端服务端口
REALTIME_PORT=8765                   # 实时观测台后台端口
NODE_VERSION="22.13.0"               # 最低 Node 版本要求
PM2_APP_NAME="segm-web"              # PM2 应用名
RUN_USER="root"                      # 运行用户
# ================================================

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ==================== 环境检查 ====================
check_environment() {
    info "========== 环境检查 =========="

    # 检查操作系统
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        info "操作系统：$PRETTY_NAME"
    fi

    # 检查 Node.js
    if command -v node &> /dev/null; then
        CURRENT_NODE=$(node -v | sed 's/v//')
        info "Node.js 版本：v$CURRENT_NODE"
        if [ "$(printf '%s\n' "$NODE_VERSION" "$CURRENT_NODE" | sort -V | head -n1)" = "$NODE_VERSION" ]; then
            success "Node.js 版本满足要求 (>= $NODE_VERSION)"
        else
            error "Node.js 版本过低，需要 >= $NODE_VERSION，当前为 v$CURRENT_NODE"
        fi
    else
        error "未检测到 Node.js，请先安装 Node.js $NODE_VERSION+"
    fi

    # 检查 pnpm
    if command -v pnpm &> /dev/null; then
        info "pnpm 版本：$(pnpm -v)"
        success "pnpm 已安装"
    else
        warn "未检测到 pnpm，正在安装..."
        npm install -g pnpm
        success "pnpm 安装完成"
    fi

    # 检查 PM2
    if command -v pm2 &> /dev/null; then
        info "PM2 版本：$(pm2 -v)"
        success "PM2 已安装"
    else
        warn "未检测到 PM2，正在安装..."
        npm install -g pm2
        success "PM2 安装完成"
    fi

    # 检查 Python3（实时观测台需要）
    if command -v python3 &> /dev/null; then
        info "Python3 版本：$(python3 --version)"
        success "Python3 已安装"
    else
        warn "未检测到 Python3，实时观测台功能不可用"
    fi

    echo ""
}

# ==================== 安装依赖 ====================
install_dependencies() {
    info "========== 安装依赖 =========="
    cd "$PROJECT_DIR"

    info "安装 Node.js 依赖..."
    pnpm install --frozen-lockfile
    success "Node.js 依赖安装完成"

    # 安装 Python 依赖（实时观测台）
    if command -v python3 &> /dev/null && [ -f "scripts/requirements-realtime.txt" ]; then
        info "安装 Python 依赖（实时观测台）..."
        python3 -m pip install --user -r scripts/requirements-realtime.txt 2>/dev/null || \
            warn "Python 依赖安装失败，实时观测台可能无法正常工作"
        success "Python 依赖安装完成"
    fi

    echo ""
}

# ==================== 构建项目 ====================
build_project() {
    info "========== 构建项目 =========="
    cd "$PROJECT_DIR"

    info "执行 Next.js 构建..."
    pnpm run build
    success "项目构建完成"

    echo ""
}

# ==================== 配置 PM2 ====================
setup_pm2() {
    info "========== 配置 PM2 服务 =========="
    cd "$PROJECT_DIR"

    # 创建日志目录
    mkdir -p runtime/logs

    # 创建 ecosystem.config.js
    cat > ecosystem.config.js << EOF
module.exports = {
  apps: [
    {
      name: '${PM2_APP_NAME}',
      script: 'pnpm',
      args: 'start -- -H 0.0.0.0 -p ${FRONTEND_PORT}',
      cwd: '${PROJECT_DIR}',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: ${FRONTEND_PORT}
      },
      error_file: '${PROJECT_DIR}/runtime/logs/pm2-error.log',
      out_file: '${PROJECT_DIR}/runtime/logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true
    }
  ]
};
EOF

    success "PM2 配置文件已创建"
    echo ""
}

# ==================== 配置实时观测台服务 ====================
setup_realtime_service() {
    info "========== 配置实时观测台服务 =========="

    if ! command -v python3 &> /dev/null; then
        warn "未检测到 Python3，跳过实时观测台服务配置"
        return
    fi

    SERVICE_FILE="/etc/systemd/system/segm-realtime.service"

    cat > "$SERVICE_FILE" << EOF
[Unit]
Description=SEGM real-time IGS SSR VTEC to GIM bridge
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${PROJECT_DIR}
Environment=PYTHONUNBUFFERED=1
ExecStart=/usr/bin/python3 ${PROJECT_DIR}/scripts/realtime_gim_bridge.py --mode ntrip --history-hours 168 --http-host 127.0.0.1 --http-port ${REALTIME_PORT}
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

    # 重新加载 systemd
    systemctl daemon-reload

    success "实时观测台 systemd 服务已创建：$SERVICE_FILE"
    info "使用以下命令管理服务："
    echo "  启动：systemctl start segm-realtime"
    echo "  停止：systemctl stop segm-realtime"
    echo "  开机自启：systemctl enable segm-realtime"
    echo "  查看状态：systemctl status segm-realtime"
    echo "  查看日志：journalctl -u segm-realtime -f"

    echo ""
}

# ==================== 启动/重启服务 ====================
restart_service() {
    info "========== 启动/重启服务 =========="
    cd "$PROJECT_DIR"

    # 检查 PM2 中是否已有该应用
    if pm2 list | grep -q "$PM2_APP_NAME"; then
        info "检测到已有运行中的服务，执行重启..."
        pm2 reload ecosystem.config.js --update-env
        success "服务已重启"
    else
        info "启动新服务..."
        pm2 start ecosystem.config.js
        success "服务已启动"
    fi

    # 保存 PM2 进程列表
    pm2 save

    # 设置 PM2 开机自启
    pm2 startup systemd -u "$RUN_USER" --hp "/root" 2>/dev/null || \
        warn "PM2 开机自启配置失败，请手动执行：pm2 startup"

    echo ""
}

# ==================== 防火墙配置 ====================
setup_firewall() {
    info "========== 防火墙配置 =========="

    # 检查 ufw (Ubuntu 默认)
    if command -v ufw &> /dev/null && ufw status | grep -q "active"; then
        info "检测到 ufw..."
        if ufw status | grep -q "${FRONTEND_PORT}/tcp"; then
            success "端口 $FRONTEND_PORT 已在防火墙中开放"
        else
            info "开放端口 $FRONTEND_PORT..."
            ufw allow "${FRONTEND_PORT}/tcp"
            success "端口 $FRONTEND_PORT 已开放"
        fi
    # 检查 firewalld (CentOS/RHEL 默认)
    elif command -v firewall-cmd &> /dev/null && systemctl is-active --quiet firewalld; then
        info "检测到 firewalld..."
        if firewall-cmd --query-port="${FRONTEND_PORT}/tcp" --permanent | grep -q "yes"; then
            success "端口 $FRONTEND_PORT 已在防火墙中开放"
        else
            info "开放端口 $FRONTEND_PORT..."
            firewall-cmd --permanent --add-port="${FRONTEND_PORT}/tcp"
            firewall-cmd --reload
            success "端口 $FRONTEND_PORT 已开放"
        fi
    else
        warn "未检测到防火墙，请确保阿里云安全组已开放 TCP 端口 $FRONTEND_PORT"
    fi

    echo ""
}

# ==================== 健康检查 ====================
health_check() {
    info "========== 健康检查 =========="

    # 等待服务启动
    sleep 3

    # 检查前端服务
    if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${FRONTEND_PORT}/" | grep -q "200"; then
        success "前端服务运行正常：http://127.0.0.1:${FRONTEND_PORT}/"
    else
        warn "前端服务可能未正常启动"
        info "查看日志：pm2 logs $PM2_APP_NAME"
    fi

    # 检查实时观测台
    if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${REALTIME_PORT}/health" 2>/dev/null | grep -q "200"; then
        success "实时观测台运行正常：http://127.0.0.1:${REALTIME_PORT}/health"
    else
        info "实时观测台未运行（可选功能，如需使用请启动 segm-realtime 服务）"
    fi

    echo ""
}

# ==================== 显示部署信息 ====================
show_deployment_info() {
    success "========================================"
    success "  SEGM 课题组网站部署成功！"
    success "========================================"
    echo ""
    info "访问地址："
    echo "  公网访问：http://8.130.47.186:${FRONTEND_PORT}"
    echo "  本地访问：http://127.0.0.1:${FRONTEND_PORT}"
    echo ""
    info "项目路径：$PROJECT_DIR"
    echo ""
    info "常用命令："
    echo "  查看状态：pm2 status"
    echo "  查看日志：pm2 logs $PM2_APP_NAME"
    echo "  重启服务：pm2 reload $PM2_APP_NAME"
    echo "  停止服务：pm2 stop $PM2_APP_NAME"
    echo ""
    info "实时观测台服务："
    echo "  启动：systemctl start segm-realtime"
    echo "  停止：systemctl stop segm-realtime"
    echo "  状态：systemctl status segm-realtime"
    echo "  日志：journalctl -u segm-realtime -f"
    echo ""
    warn "重要：请确保阿里云安全组已开放 TCP 端口 $FRONTEND_PORT"
    echo ""
}

# ==================== 主函数 ====================
main() {
    echo ""
    echo "=============================================="
    echo "   SEGM 课题组网站 - 阿里云 ECS 部署脚本"
    echo "   架构：Next.js 16 + Tailwind CSS 4"
    echo "   端口：$FRONTEND_PORT"
    echo "   路径：$PROJECT_DIR"
    echo "=============================================="
    echo ""

    check_environment
    install_dependencies
    build_project
    setup_pm2
    setup_realtime_service
    restart_service
    setup_firewall
    health_check
    show_deployment_info
}

# 支持单独执行某个步骤
case "${1:-all}" in
    all)
        main
        ;;
    check)
        check_environment
        ;;
    build)
        build_project
        restart_service
        health_check
        ;;
    restart)
        restart_service
        health_check
        ;;
    status)
        pm2 status
        systemctl status segm-realtime 2>/dev/null || true
        ;;
    logs)
        pm2 logs "${PM2_APP_NAME}" --lines 50
        ;;
    *)
        echo "用法：$0 {all|check|build|restart|status|logs}"
        echo ""
        echo "  all     - 完整部署（默认）"
        echo "  check   - 仅检查环境"
        echo "  build   - 重新构建并重启"
        echo "  restart - 仅重启服务"
        echo "  status  - 查看服务状态"
        echo "  logs    - 查看服务日志"
        exit 1
        ;;
esac
