import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';
import { initQdrant } from './qdrant.js';

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await initQdrant();
  } catch (error) {
    console.error('⚠️ Qdrant initialization failed (will retry on first request):', error.message);
  }

  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

start();
