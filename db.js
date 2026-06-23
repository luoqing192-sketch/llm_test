import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 按脚本所在目录加载 .env，与 cwd 解耦（db.js 在 import 阶段就会建连接池，
// 此时 server.js 的 dotenv 还没执行，所以必须在此处用绝对路径加载）
dotenv.config({ path: path.join(__dirname, '.env') });

// 启动期校验：缺少数据库配置时直接报错，避免运行到登录才抛误导性的 500
const requiredDbVars = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_DATABASE'];
const missingDbVars = requiredDbVars.filter((v) => !process.env[v]);
if (missingDbVars.length > 0) {
  console.error(
    `❌ 数据库配置缺失: ${missingDbVars.join(', ')}。` +
      `请确认 .env 文件存在且已正确填写（参考 .env.production）。`
  );
}

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
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
