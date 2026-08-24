import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  // 加载环境变量
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      // 使用环境变量 PORT，默认 7004
      port: parseInt(env.PORT || '7004', 10),
      proxy: {
        // 代理 /api 请求到后端 API 服务
        '/api': {
          target: env.VITE_API_TARGET || 'http://localhost:7000',
          changeOrigin: true,
          // 不去掉 /api 前缀，因为后端路由是 /v1/workflows
          // 需要确认后端是否有 /api 前缀
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  };
});
