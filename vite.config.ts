import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Android 移动端使用相对路径（WebViewAssetLoader 根路径 "/" 不会自动映射到 index.html）
  base: "",
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "0.0.0.0",
    port: 1420,
    strictPort: true,
    hmr: {
      host: "192.168.10.51",
      protocol: "ws",
    },
    watch: {
      ignored: ["**/src-tauri/target/**", "**/src-tauri/gen/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: ["es2021", "chrome100", "safari13"],
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
