import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['app.js', 'queue/**/*.js', 'qdrant.js', 'embeddings.js', 'text-splitter.js'],
      thresholds: {
        lines: 30,
        functions: 20,
        branches: 20,
      },
    },
    testTimeout: 15000,
  },
});
