// Assemble the final demo: segment videos (with short fades) + narration clips placed at their scheduled times.
// Usage: node assemble.mjs [output.mp4]
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { FFMPEG, ROOT } from './rec.mjs';

const OUT = process.argv[2] || `${ROOT}NammaSpace_Round1_Demo.mp4`;
const ORDER = ['intro', 'data', 'stages', 'viewer', 'walk', 'outro'];
const seg = JSON.parse(fs.readFileSync('out/segments.json', 'utf8'));
const FADE = 0.35;

const args = ['-hide_banner', '-loglevel', 'error', '-y'];
const vf = [];
ORDER.forEach((n, i) => {
  args.push('-i', `out/${n}.mp4`);
  const T = seg[n].T;
  vf.push(`[${i}:v]fade=t=in:st=0:d=${FADE},fade=t=out:st=${(T - FADE).toFixed(3)}:d=${FADE},setsar=1[v${i}]`);
});
vf.push(`${ORDER.map((_, i) => `[v${i}]`).join('')}concat=n=${ORDER.length}:v=1:a=0[vout]`);

// Narration: each sentence clip delayed to its absolute start.
let offset = 0, k = ORDER.length;
const mix = [];
for (const n of ORDER) {
  for (const s of seg[n].sents) {
    args.push('-i', s.file);
    const ms = Math.round((offset + s.start) * 1000);
    vf.push(`[${k}:a]aresample=48000,adelay=${ms}|${ms}[a${k}]`);
    mix.push(`[a${k}]`);
    k++;
  }
  offset += seg[n].T;
}
vf.push(`${mix.join('')}amix=inputs=${mix.length}:normalize=0:dropout_transition=0,apad=whole_dur=${offset.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`);

fs.writeFileSync('out/filter.txt', vf.join(';\n'));
args.push('-/filter_complex', 'out/filter.txt', '-map', '[vout]', '-map', '[aout]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30',
  '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-t', offset.toFixed(3), '-movflags', '+faststart', OUT);
console.log(`total ${offset.toFixed(1)} s, ${mix.length} narration clips -> ${OUT}`);
execFileSync(FFMPEG, args, { stdio: 'inherit' });
console.log('done');
