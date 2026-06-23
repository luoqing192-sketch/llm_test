#!/bin/bash

set -e

echo "🚀 开始部署 LLM Chat 应用..."

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安装"
    exit 1
fi

# 检查 docker-compose
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose 未安装"
    exit 1
fi

# 构建镜像
echo "📦 构建 Docker 镜像..."
docker-compose build

# 启动服务
echo "🎯 启动服务..."
docker-compose up -d

# 等待服务启动
echo "⏳ 等待服务启动..."
sleep 10

# 健康检查
echo "🔍 检查服务状态..."
docker-compose ps

echo "✅ 部署完成！"
echo "📍 访问地址：http://localhost"
echo "📊 MySQL: localhost:3307"
echo "🔍 Qdrant: localhost:6333"
