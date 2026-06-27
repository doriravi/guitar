// Shared helpers for the Guitar Reach E2E suite.

// Unique email per test run so registration always creates a fresh account
// (the backend persists to SQLite across runs).
export function uniqueEmail() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `pwtest-${Date.now()}-${rand}@example.com`;
}

export const PASSWORD = 'Password123!';

// Register a brand-new account through the email-first auth UI, leaving the
// app at the mandatory hand-measurement onboarding gate.
export async function registerNewUser(page, email = uniqueEmail()) {
  await page.goto('/');

  // Step 1: email screen. Use the explicit "Create account" path.
  await page.getByPlaceholder('email@address.com').fill(email);
  await page.getByRole('button', { name: 'Create account' }).click();

  // Step 2: name + password.
  await page.locator('input[name="name"]').fill('PW Test');
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: /create account/i }).click();

  return email;
}

// From the onboarding gate, adjust a slider (so the profile is non-default) and
// save it — this clears the gate and reveals the main tabbed app.
export async function completeOnboarding(page) {
  const slider = page.locator('input[type="range"]').first();
  await slider.waitFor();
  // Nudge the slider via keyboard so React's onChange fires with a real value.
  await slider.focus();
  await slider.press('ArrowRight');
  await slider.press('ArrowRight');

  await page.getByRole('button', { name: 'Save Profile' }).click();
  // After saving a non-default profile the tab bar appears.
  await page.getByRole('button', { name: /Chords/ }).first().waitFor();
}
