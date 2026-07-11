import { defineConfig } from 'vitest/config';

// Unit tests live in src/ and run in Node. The Playwright end-to-end specs in
// e2e/ are driven by `npm run test:e2e`, NOT Vitest — exclude them so Vitest
// never tries to load @playwright/test's test.describe.configure().
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
    environment: 'node',
  },
});
