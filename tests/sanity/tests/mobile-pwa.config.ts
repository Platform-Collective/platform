// SPDX-License-Identifier: EPL-2.0
import { defineConfig, devices } from '@playwright/test'

// Independent from the shared auth setup: no cached credentials across origins.
export default defineConfig({
  testDir: './mobile',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  outputDir: process.env.MOBILE_PWA_OUTPUT,
  reporter: [['json', { outputFile: process.env.MOBILE_PWA_REPORT }]],
  use: {
    baseURL: process.env.MOBILE_PWA_BASE_URL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    testIdAttribute: 'data-id',
    locale: 'en-US',
    contextOptions: { reducedMotion: 'reduce' },
    // Trace collection starts after authentication, with no DOM/network snapshots.
    trace: 'off',
    screenshot: 'off',
    video: 'off'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'iphone-15', use: { ...devices['iPhone 15'] } },
    { name: 'pixel-7', use: { ...devices['Pixel 7'] } }
  ]
})
