import { defineConfig } from "@playwright/test";

// The e2e server port is configurable because fixed ports are often taken by other
// local projects: LT_E2E_PORT=4391 npm run test:e2e
const port = Number(process.env.LT_E2E_PORT ?? 4391);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: origin,
    browserName: "chromium",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: "ja-JP",
  },
  webServer: {
    // Test the production build, served statically like the real host would.
    command: `npm run build -- --outDir .e2e-dist && npx vite preview --outDir .e2e-dist --host 127.0.0.1 --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
