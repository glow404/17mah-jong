/** Drizzle Kit 配置：从 db/schema.ts 读取表结构，并把迁移生成到 drizzle/。 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./db/schema.ts",
  dialect: "sqlite",
});
