import dotenv from 'dotenv';
dotenv.config();

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDistPath = path.join(__dirname, 'frontend', 'dist');
const frontendIndexPath = path.join(frontendDistPath, 'index.html');

// Auto-build frontend if dist doesn't exist
if (!fs.existsSync(frontendIndexPath)) {
  console.log('📦 Frontend not built, building now...');
  try {
    const frontendDir = path.join(__dirname, 'frontend');
    if (!fs.existsSync(path.join(frontendDir, 'node_modules'))) {
      console.log('   Installing frontend dependencies...');
      execSync('npm install', { cwd: frontendDir, stdio: 'inherit' });
    }
    console.log('   Building frontend...');
    execSync('npm run build', { cwd: frontendDir, stdio: 'inherit' });
    console.log('✅ Frontend built successfully');
  } catch (error) {
    console.error('❌ Frontend build failed:', error.message);
    console.error('   Run manually: cd frontend && npm install && npm run build');
  }
}

import app from './app.js';
import { initQdrant } from './qdrant.js';
import { ensureAdminUser } from './init-admin.js';

const PORT = process.env.PORT || 3000;

async function start() {
  // 确保 admin 账户存在
  await ensureAdminUser();

  try {
    await initQdrant();
  } catch (error) {
    console.error('⚠️ Qdrant initialization failed (will retry on first request):', error.message);
  }

  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🎨 Frontend: ${fs.existsSync(frontendIndexPath) ? 'ready' : 'NOT AVAILABLE'}`);
  });
}

start();
