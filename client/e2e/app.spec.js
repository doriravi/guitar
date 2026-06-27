import { test, expect } from '@playwright/test';
import { registerNewUser, completeOnboarding, uniqueEmail, PASSWORD } from './helpers.js';

// Fail the test on uncaught page errors so a broken render surfaces clearly.
test.beforeEach(async ({ page }) => {
  page.on('pageerror', err => {
    throw new Error(`Uncaught page error: ${err.message}`);
  });
});

test.describe('Auth landing page (login gate)', () => {
  test('shows the email-first sign-in screen as the landing page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('email@address.com')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
  });

  test('does not advance to the password step for an invalid email', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('email@address.com').fill('not-an-email');
    await page.getByRole('button', { name: 'Continue' }).click();
    // Whether blocked by native HTML5 validation or the app's own regex, the
    // user stays on the email step — no password field appears.
    await expect(page.locator('input[name="password"]')).toHaveCount(0);
    await expect(page.getByPlaceholder('email@address.com')).toBeVisible();
  });

  test('advances to the password step for a valid email', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('email@address.com').fill(uniqueEmail());
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });
});

test.describe('Registration + onboarding', () => {
  test('a new account is forced through the hand-measurement gate', async ({ page }) => {
    await registerNewUser(page);
    // Onboarding gate: hand profile setup with sliders + Save Profile button.
    await expect(page.getByRole('button', { name: 'Save Profile' })).toBeVisible();
    await expect(page.locator('input[type="range"]').first()).toBeVisible();
  });

  test('saving a measured profile reveals the main app', async ({ page }) => {
    await registerNewUser(page);
    await completeOnboarding(page);
    // Main tabbed app: all the feature tabs are present.
    for (const tab of ['Start', 'My Hand', 'Strings', 'Tuner', 'Chords']) {
      await expect(page.getByRole('button', { name: new RegExp(tab) }).first()).toBeVisible();
    }
  });
});

test.describe('Main app navigation', () => {
  test('can switch between the core tabs without errors', async ({ page }) => {
    await registerNewUser(page);
    await completeOnboarding(page);

    // Chords tab: difficulty table should render content.
    await page.getByRole('button', { name: /Chords/ }).first().click();
    await expect(page.locator('table').first()).toBeVisible();

    // Strings tab.
    await page.getByRole('button', { name: /Strings/ }).first().click();
    // Progressions tab.
    await page.getByRole('button', { name: /Progressions/ }).first().click();
    // Triplets tab.
    await page.getByRole('button', { name: /Triplets/ }).first().click();
  });
});

test.describe('Wrong-password handling', () => {
  test('shows an error when signing in with the wrong password', async ({ page }) => {
    // Register an account, then sign out and try a bad password.
    const email = await registerNewUser(page);
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'Sign out' }).click();

    // Back at the login landing page.
    await page.getByPlaceholder('email@address.com').fill(email);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('input[name="password"]').fill('wrong-password-xyz');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/Incorrect password/i)).toBeVisible();
  });
});
