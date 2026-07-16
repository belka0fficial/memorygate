import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://localhost:8021';
const label = process.argv[3] || '';
const agent = process.argv[4] || 'conker';
const adminKey = process.argv[5] || 'test-admin-key-123';
const width = Number(process.argv[6]) || 1440;
const height = Number(process.argv[7]) || 900;

const dir = './temporary screenshots';
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const existing = fs.readdirSync(dir).filter((f) => f.startsWith('screenshot-'));
const nums = existing.map((f) => parseInt(f.match(/screenshot-(\d+)/)?.[1] || '0', 10));
const next = nums.length ? Math.max(...nums) + 1 : 1;
const filename = label ? `screenshot-${next}-${label}.png` : `screenshot-${next}.png`;
const outPath = path.join(dir, filename);

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.setViewport({ width, height });

// first load: go through the real login form
await page.goto(url.split('#')[0].replace(/\/[a-z]+$/, '') || url, { waitUntil: 'networkidle0' });
await page.goto((new URL(url)).origin, { waitUntil: 'networkidle0' });

const keyInput = await page.$('input[type="password"]');
if (keyInput) {
  await keyInput.type(adminKey);
  await page.click('button[type="submit"]');
  await new Promise((r) => setTimeout(r, 600));
}

await page.evaluate((a) => localStorage.setItem('memorygate_selected_agent', a), agent);

const targetUrl = new URL(url);
await page.goto(targetUrl.toString(), { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 500));

await page.screenshot({ path: outPath, fullPage: true });
await browser.close();

console.log(`Saved ${outPath}`);
