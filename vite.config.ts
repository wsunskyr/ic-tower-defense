import { defineConfig } from 'vite';

export default defineConfig({
  // 相对路径：打包结果放到任意子目录（如 GitHub Pages 的 /仓库名/）都能直接打开
  base: './',
  build: {
    // Phaser 本身约 1.2 MB，这是预期大小，不需要警告
    chunkSizeWarningLimit: 1600,
  },
});
