// Pick the sharpest frame from each window of candidate frames.
// Input: ffmpeg `blurdetect` metadata dump (lower lavfi.blur = sharper).
// Usage: node select_frames.mjs <blur.txt> <frames_all_dir> <out_images_dir> <target_count>
import fs from 'node:fs';
import path from 'node:path';

const [blurFile, srcDir, outDir, targetArg] = process.argv.slice(2);
const target = Number(targetArg || 160);

const blur = [];
for (const line of fs.readFileSync(blurFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^lavfi\.blur=([\d.]+)/);
  if (m) blur.push(Number(m[1]));
}
const frames = fs.readdirSync(srcDir).filter((f) => f.endsWith('.jpg')).sort();
const n = Math.min(frames.length, blur.length || frames.length);
if (n === 0) throw new Error('no frames extracted');

const win = Math.max(1, Math.round(n / target));
fs.mkdirSync(outDir, { recursive: true });
let kept = 0;
const scores = [];
for (let start = 0; start < n; start += win) {
  let best = start;
  for (let i = start; i < Math.min(start + win, n); i++) {
    if (blur.length && blur[i] < blur[best]) best = i;
  }
  scores.push(blur[best] ?? 0);
  fs.copyFileSync(path.join(srcDir, frames[best]), path.join(outDir, `frame_${String(kept).padStart(4, '0')}.jpg`));
  kept++;
}
const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
console.log(`candidates=${n} window=${win} kept=${kept} mean_blur=${avg.toFixed(2)}`);
