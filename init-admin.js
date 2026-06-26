import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcrypt';
import pool from './db.js';

// 默认管理员账户
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = '123456';

export async function ensureAdminUser() {
  if (process.env.USE_MOCK_DB === 'true') {
    console.log('✅ Mock 模式: admin 用户已预置');
    return;
  }

  try {
    // 检查是否已存在
    const [existing] = await pool.query(
      'SELECT id, username, role FROM users WHERE username = ?',
      [ADMIN_USERNAME]
    );

    if (existing.length > 0) {
      console.log(`✅ Admin user exists: ${existing[0].username} (${existing[0].role})`);
      return;
    }

    // 创建管理员
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [ADMIN_USERNAME, passwordHash, 'admin']
    );

    console.log(`✅ Admin user created: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
  } catch (error) {
    console.error('⚠️ Failed to ensure admin user:', error.message);
  }
}
