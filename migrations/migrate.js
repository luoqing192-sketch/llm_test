import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function runMigration() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '123456',
    multipleStatements: true
  });

  try {
    await connection.query('USE chatapp');

    // 删除知识库相关表
    await connection.query('DROP TABLE IF EXISTS document_chunks');
    await connection.query('DROP TABLE IF EXISTS documents');
    await connection.query('DROP TABLE IF EXISTS knowledge_items');
    await connection.query('DROP TABLE IF EXISTS knowledge_bases');

    // 删除相关设置
    await connection.query("DELETE FROM settings WHERE setting_key IN ('knowledge_retrieval_limit', 'knowledge_min_score')");

    console.log('✅ 数据库迁移完成');
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.log('ℹ️  数据库未运行，跳过迁移');
    } else {
      console.error('❌ 迁移失败:', error);
      process.exit(1);
    }
  } finally {
    await connection.end();
  }
}

runMigration();