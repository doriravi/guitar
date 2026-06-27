// Live demo: register 3 brand-new customers in a visible browser, end to end.
// Run headed + slow so you can watch each signup happen:
//   npx playwright test e2e/live-3-customers.spec.js --headed --project=chromium
import { test, expect } from '@playwright/test';
import { registerNewUser, completeOnboarding, uniqueEmail } from './helpers.js';

test.describe.configure({ mode: 'serial' });

// Three distinct customers, each a fresh account.
const customers = [
  { label: 'Customer 1 — Ava',   email: uniqueEmail() },
  { label: 'Customer 2 — Diego', email: uniqueEmail() },
  { label: 'Customer 3 — Mei',   email: uniqueEmail() },
];

for (const c of customers) {
  test(`register ${c.label}`, async ({ page }) => {
    // Slow each step a touch so it's watchable live.
    page.setDefaultTimeout(20000);

    await test.step(`sign up ${c.email}`, async () => {
      await registerNewUser(page, c.email);
    });

    await test.step('pass the hand-profile onboarding gate', async () => {
      await completeOnboarding(page);
    });

    await test.step('confirm logged in to the main app', async () => {
      // Email shows in the header once authenticated; tab bar is visible.
      await expect(page.getByText(c.email)).toBeVisible();
      await expect(page.getByRole('button', { name: /Chords/ }).first()).toBeVisible();
    });

    // Brief pause so the finished state is visible on screen.
    await page.waitForTimeout(1500);
  });
}
