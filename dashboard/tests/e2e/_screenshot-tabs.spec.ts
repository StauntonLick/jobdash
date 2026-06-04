const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('http://localhost:3000');
  await page.waitForSelector('#dashboard-tab-bar', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/tab-bar-loaded.png', clip: { x: 0, y: 0, width: 1440, height: 120 } });
  await browser.close();
})();
