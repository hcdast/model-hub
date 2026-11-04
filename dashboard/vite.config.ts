/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

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
  
  const buildTime = new Date().toISOString();
  const git = (args: string[]) => { try { return execFileSync('git', args, { cwd: resolve(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
  const commit = process.env.GIT_COMMIT || git(['rev-parse', 'HEAD']) || null;
  const dirty = !!git(['status', '--porcelain', '--untracked-files=normal']);
  const buildInfo = { id: process.env.BUILD_ID || `${commit?.slice(0, 12) || 'local'}${dirty ? '-dirty' : ''}-${buildTime}`, commit, dirty, builtAt: buildTime };
  return {
    plugins: [react(), { name: 'dashboard-build-info', generateBundle() { this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify(buildInfo) }); } }],
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
      // Retain hashed assets so already-open sessions can finish loading old chunks.
      emptyOutDir: false,
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const module = id.replace(/\\/g, '/');
            if (module.includes('/node_modules/zrender/')) return 'vendor-zrender';
            if (module.includes('/node_modules/@ant-design/icons-svg/')) return 'vendor-icons';
            if (/\/node_modules\/(?:rc-util|rc-motion|rc-field-form|rc-menu|rc-overflow|rc-resize-observer|resize-observer-polyfill|@rc-component\/(?:trigger|portal|async-validator))\//.test(module)) return 'vendor-ui-core';
            if (/\/node_modules\/(?:react|react-dom|react-router|react-router-dom|scheduler|@remix-run\/router)\//.test(module)) return 'vendor-react';
            if (module.includes('/node_modules/@monaco-editor/')) return 'vendor-monaco';
          },
        },
      },
    },
    define: {
      // 将根目录 .env 中的 NODE_ENV 暴露给前端
      'import.meta.env.VITE_BUILD_INFO': JSON.stringify(buildInfo),
      'import.meta.env.VITE_NODE_ENV': JSON.stringify(nodeEnv),
    },
    test: {
      globals: true,
      environment: 'node',
    },
  };
});
