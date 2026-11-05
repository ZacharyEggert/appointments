import { defineConfig } from "vitest/config";
import { testDatabaseUrl } from "./test/database";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/setup.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: testDatabaseUrl,
      SHOPIFY_API_KEY: "test_key",
      SHOPIFY_API_SECRET: "test_secret",
      SHOPIFY_APP_URL: "https://app.test",
      SCOPES: "read_products,write_metaobjects",
      GOOGLE_CLIENT_ID: "google_test_client",
      GOOGLE_CLIENT_SECRET: "google_test_secret",
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    },
  },
});
