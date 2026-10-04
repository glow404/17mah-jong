/** 声明 Cloudflare Worker 运行时注入的环境绑定，供 TypeScript 识别。 */
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
  }
}
