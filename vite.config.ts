import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    // 依然保留 loadEnv，以防你以后需要加载非敏感的公开配置
    const env = loadEnv(mode, '.', '');
    
    return {
      // GitHub Pages 配置关键：base 必须设置为 '/仓库名/'
      // 如果你的访问地址是 https://用户名.github.io/my-repo/，则 base 为 '/my-repo/'
      base: '/test-a1/', 
      
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      
      define: {},
      
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },

      // 建议：如果你是部署到 GitHub Pages，可以指定输出目录为 dist
      build: {
        outDir: 'dist',
      }
    };
});