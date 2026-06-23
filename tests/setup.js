// Test setup file for Vitest
// This runs before each test file

import { beforeAll, afterAll } from 'vitest';

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-testing';
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '3306';
process.env.DB_USER = process.env.DB_USER || 'root';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'root';
process.env.DB_NAME = process.env.DB_NAME || 'chatapp_test';
process.env.QDRANT_HOST = process.env.QDRANT_HOST || 'localhost';
process.env.QDRANT_PORT = process.env.QDRANT_PORT || '6333';

// Global test timeout
beforeAll(async () => {
  // Test environment is ready
});

afterAll(async () => {
  // Cleanup if needed
});
