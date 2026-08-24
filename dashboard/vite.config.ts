/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync } from 'fs';

export default defineConfig(() => {
  // 读取项目根目录的 .env 文件
  let nodeEnv = 'production';
  try {
    const envPath = resolve(__dirname, '..', '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    const match = envContent.match(/NODE_ENV=(\w+)/);
    if (match) {
      nodeEnv = match[1];
    }
  } catch (error) {
    console.warn('Failed to read .env file, using default NODE_ENV=production');
  }
  
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@model-hub/common': resolve(__dirname, '../src/common'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api/v1': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-monaco': ['@monaco-editor/react'],
          },
        },
      },
    },
    define: {
      // 将根目录 .env 中的 NODE_ENV 暴露给前端
      'import.meta.env.VITE_NODE_ENV': JSON.stringify(nodeEnv),
    },
    test: {
      globals: true,
      environment: 'node',
    },
  };
});
