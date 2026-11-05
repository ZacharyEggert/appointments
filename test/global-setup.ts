import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { testDatabaseUrl } from "./database";

export default function setup() {
  execFileSync("pnpm", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
      XDG_CACHE_HOME:
        process.env.XDG_CACHE_HOME ?? resolve("node_modules/.cache"),
    },
  });
}
