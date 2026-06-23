#!/bin/bash

BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

echo "💾 开始备份..."

# 备份 MySQL
docker exec llm-chat-mysql mysqldump -u chatapp -pchatapp_secret_123 chatapp_prod > $BACKUP_DIR/mysql_$TIMESTAMP.sql

# 备份上传文件
tar -czf $BACKUP_DIR/uploads_$TIMESTAMP.tar.gz uploads/

echo "✅ 备份完成：$BACKUP_DIR"
