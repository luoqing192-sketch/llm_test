import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,

  // 连接池配置
  waitForConnections: true,
  connectionLimit: parseInt(process.env.MYSQL_CONNECTION_LIMIT) || 10,
  queueLimit: 100,
  acquireTimeout: 60000,
  timeout: 60000,

  // 性能优化
  multipleStatements: false,
  charset: 'utf8mb4',
  dateStrings: true,

  // 连接健康检查
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

// 连接池事件监听
pool.on('acquire', (connection) => {
  console.log(`Connection ${connection.threadId} acquired`);
});

pool.on('release', (connection) => {
  console.log(`Connection ${connection.threadId} released`);
});

pool.on('connection', (connection) => {
  console.log(`New connection ${connection.threadId} created`);
});

// 健康检查函数
export async function checkHealth() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    return true;
  } catch (error) {
    console.error('Database health check failed:', error);
    return false;
  }
}

export default pool;
