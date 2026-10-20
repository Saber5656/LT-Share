import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/e2e',use:{baseURL:'http://127.0.0.1:4188',viewport:{width:390,height:844}},webServer:{command:'npm run build && npm run dev -- --port 4188',url:'http://127.0.0.1:4188/health',reuseExistingServer:!process.env.CI}});
