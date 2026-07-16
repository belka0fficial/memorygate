import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://localhost:8021';
const label = process.argv[3] || '';
const agent = process.argv[4] || 'conker';
const width = Number(process.argv[5]) || 1440;
const height = Number(process.argv[6]) || 900;

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
await page.goto(url, { waitUntil: 'networkidle0' });

await page.evaluate((a) => localStorage.setItem('memorygate_agent_id', a), agent);
await page.reload({ waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));

await page.screenshot({ path: outPath, fullPage: true });
await browser.close();

console.log(`Saved ${outPath}`);
