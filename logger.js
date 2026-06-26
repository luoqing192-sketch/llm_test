import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, 'app.log');
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const KEEP_SIZE = 5 * 1024 * 1024; // 保留最后 5MB

// 启动时检查日志文件大小，超过 10MB 则截断保留最后 5MB
try {
  if (fs.existsSync(LOG_FILE)) {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > MAX_SIZE) {
      const buf = Buffer.alloc(KEEP_SIZE);
      const fd = fs.openSync(LOG_FILE, 'r');
      fs.readSync(fd, buf, 0, KEEP_SIZE, stat.size - KEEP_SIZE);
      fs.closeSync(fd);
      fs.writeFileSync(LOG_FILE, buf);
    }
  }
} catch (e) {
  // 截断失败不影响启动
}

const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

const originalLog = console.log;
const originalError = console.error;

console.log = (...args) => {
  originalLog(...args);
  const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  logStream.write(`[${timestamp()}] [INFO] ${msg}\n`);
};

console.error = (...args) => {
  originalError(...args);
  const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  logStream.write(`[${timestamp()}] [ERROR] ${msg}\n`);
};
