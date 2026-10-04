/**
 * Vite/Vinext 构建配置：组合 App Router、站点托管和 Cloudflare Worker 插件。
 * 受限沙箱中使用轮询监听，避免文件系统事件不可用导致热更新失效。
 */
import { sites } from "@openai/sites-vite-plugin";
import { cloudflare } from "@cloudflare/vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";

const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig({
  server: isCodexSeatbeltSandbox
    ? {
        watch: {
          useFsEvents: false,
          usePolling: true,
        },
      }
    : undefined,

  plugins: [
    vinext(),

    sites(),

    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});