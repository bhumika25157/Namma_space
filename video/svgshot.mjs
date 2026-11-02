import puppeteer from 'puppeteer-core';
const [src, out] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1000, height: 1000 } });
const p = await b.newPage();
await p.goto('file:///' + src);
await p.screenshot({ path: out });
await b.close();
