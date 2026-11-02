// Grab real viewer renders of each reconstruction stage for the pipeline slide (studio/stage_*.jpg).
import { launch, FFMPEG } from './rec.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const SCENE = process.argv[2] || 'drjohnson';
const { browser, page } = await launch();
await page.goto(`http://localhost:8765/?scene=${SCENE}`, { waitUntil: 'load' });
await page.waitForFunction('window.__nsReady === true', { timeout: 180000 });
await page.evaluate(() => window.__vclock.start());
const step = (n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.__vclock.step(1000 / 30); }, n);
await step(40);
const save = async (name, clip) => {
  const tmp = `studio/${name}.png`;
  fs.writeFileSync(tmp, await page.screenshot({ type: 'png', clip }));
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-vf', 'scale=640:-2:flags=lanczos', '-q:v', '3', `studio/${name}.jpg`]);
  fs.rmSync(tmp);
};
const clip = { x: 330, y: 150, width: 1260, height: 830 };
for (const [layer, name] of [['sparse', 'stage_sparse'], ['dense', 'stage_dense'], ['mesh', 'stage_mesh'], ['textured', 'stage_tex']]) {
  await page.click(`#layers button[data-layer=${layer}]`);
  await step(6);
  await save(name, clip);
}
await page.click('.seg button[data-mode=walk]');
await step(20);
await save('stage_viewer', { x: 0, y: 0, width: 1920, height: 1080 });
const info = await page.evaluate(() => ({ n: window.__ns.room.poses.length, ext: window.__ns.room.ext, h: window.__ns.room.height, tris: window.__ns.room.tris, counts: window.__ns.room.counts }));
console.log(JSON.stringify(info));
await browser.close();
process.exit(0);
