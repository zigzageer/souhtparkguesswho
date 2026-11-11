import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= '/workspace/.cache/ms-playwright';
process.env.LD_LIBRARY_PATH = ['/workspace/.cache/webkit-libs/usr/lib/x86_64-linux-gnu', process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
export default defineConfig({
  testDir: './test/browser', fullyParallel: false, workers: 1, timeout: 90_000,
  use: { baseURL: 'http://127.0.0.1:3002', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] } } },
    { name: 'webkit', use: { browserName: 'webkit', launchOptions: { executablePath: fileURLToPath(new URL('./scripts/webkit-launch.sh', import.meta.url)) } } },
    { name: 'chromium-redis', use: { baseURL: 'http://127.0.0.1:3001', browserName: 'chromium', launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] } } },
    { name: 'webkit-redis', use: { baseURL: 'http://127.0.0.1:3001', browserName: 'webkit', launchOptions: { executablePath: fileURLToPath(new URL('./scripts/webkit-launch.sh', import.meta.url)) } } },
  ],
  webServer: [
    { command: 'PORT=3002 npm start', url: 'http://127.0.0.1:3002/api/health', reuseExistingServer: !process.env.CI },
    { command: 'node scripts/serve-redis-test.mjs', url: 'http://127.0.0.1:3001/api/health', reuseExistingServer: !process.env.CI },
  ],
});
