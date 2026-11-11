import { test, expect } from '@playwright/test';
const mobile = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

test('two iPhone X-sized clients: invite, ready, questions, private eliminations, reload, guess and rematch', async ({ browser }) => {
  const aContext = await browser.newContext(mobile), bContext = await browser.newContext(mobile);
  const a = await aContext.newPage(), b = await bContext.newPage();
  const errors = []; for (const p of [a, b]) p.on('pageerror', e => errors.push(e.message));
  await a.goto('/'); await expect(a.locator('.character')).toHaveCount(25);
  await a.locator('#player-name').fill('Stan'); await a.locator('#create-button').click();
  await expect(a.locator('#room-panel')).toBeVisible();
  const code = await a.locator('#code-display').textContent();
  await b.goto('/?room=' + code); await expect(b.locator('#room-code')).toHaveValue(code);
  await b.locator('#player-name').fill('Kyle'); await b.locator('#join-form button').click();
  await expect(a.locator('#opponent-name')).toHaveText('Kyle');
  await expect(b.locator('#opponent-name')).toHaveText('Stan');
  await b.locator('#change-character').click();
  await b.getByRole('button', { name: 'Choose ManBearPig (Character) as your secret', exact: true }).click();
  await expect(b.locator('#secret-name')).toHaveText('ManBearPig (Character)');
  const target = await b.locator('#secret-name').textContent();
  await a.locator('#ready').click(); await b.locator('#ready').click();
  await expect(a.locator('#guess-mode')).toBeVisible();
  const firstCard = a.locator('.character').first(); const firstName = await firstCard.locator('.character-name').textContent();
  await firstCard.click(); await expect(a.locator('.character.excluded')).toHaveCount(1);
  await expect(b.locator('.character.excluded')).toHaveCount(0);
  await a.reload(); await expect(a.locator('.character.excluded')).toHaveCount(1);
  await expect(a.locator('#undo')).toBeDisabled(); // Undo history is local; elimination state survives.
  await a.getByRole('button', { name: `Restore ${firstName}`, exact: true }).click(); await expect(a.locator('.character.excluded')).toHaveCount(0);
  await a.locator('#question-text').fill('Do they wear a hat?'); await a.locator('#ask-button').click();
  await expect(b.locator('#question-log')).toContainText('Do they wear a hat?');
  await b.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(a.locator('#question-log .answer')).toHaveText('Yes');
  await a.locator('#question-text').fill('Are they a kid?'); await a.locator('#ask-button').click();
  await a.locator('#guess-mode').click(); await a.getByRole('button', { name: `Guess ${target}`, exact: true }).click();
  await a.locator('#confirm-guess').click();
  await expect(a.locator('#modal-title')).toHaveText('You cracked the case.');
  await expect(b.locator('#modal-title')).toHaveText('Well played, buddy.');
  await a.locator('#modal-rematch').click(); await b.locator('#modal-rematch').click();
  await expect(a.locator('#board-eyebrow')).toContainText('ROUND 2');
  await expect(a.locator('#ready')).toBeVisible();
  for (const p of [a, b]) {
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await p.locator('#player-name').evaluate(e => getComputedStyle(e).fontSize)).toBe('16px');
  }
  expect(errors).toEqual([]);
  await aContext.close(); await bContext.close();
});

test('desktop landing, real portraits, rules, and complete catalog pagination', async ({ page }) => {
  const catalog = await (await page.request.get('/api/catalog')).json();
  await page.goto('/'); await expect(page.locator('.character')).toHaveCount(25);
  await expect(page.locator('h1')).toContainText('A small town.');
  await expect(page.locator('.character img')).toHaveCount(25);
  await expect.poll(() => page.locator('.character img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0))).toBe(true);
  await page.locator('#rules').click(); await expect(page.locator('#modal-title')).toContainText('friendly suspicion'); await page.locator('#close-modal').click();
  await page.locator('#player-name').fill('Deep cut'); await page.locator('#deck-mode').selectOption('all'); await page.locator('#create-button').click();
  await expect(page.locator('#board-count')).toHaveText(catalog.characters.length.toLocaleString());
  await expect(page.locator('.character')).toHaveCount(48);
  await page.locator('#next-page').click(); await expect(page.locator('#page-label')).toContainText('2 /');
  await page.locator('#search').fill('Eric Cartman'); await expect(page.locator('.character-name')).toContainText(['Eric Cartman']);
  await page.locator('#sources').click(); await expect(page.locator('#modal-content')).toContainText(catalog.characters.length.toLocaleString() + ' character pages');
});
