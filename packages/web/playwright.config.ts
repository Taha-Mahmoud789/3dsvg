import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120000,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    browserName: "chromium",
  },
  webServer: {
    command: "npm run dev",
    port: 3000,
    timeout: 120000,
    reuseExistingServer: true,
  },
});
