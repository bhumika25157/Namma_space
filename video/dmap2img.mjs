// Render an OpenMVS .dmap depth map as a colour-mapped image (for the pipeline slide).
// Usage: node dmap2img.mjs <depthXXXX.dmap> <out.jpg>
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { FFMPEG } from './rec.mjs';

const [src, out] = process.argv.slice(2);
const b = fs.readFileSync(src);
let o = 0;
const u16 = () => { const v = b.readUInt16LE(o); o += 2; return v; };
const u32 = () => { const v = b.readUInt32LE(o); o += 4; return v; };
if (b.toString('latin1', 0, 2) !== 'DR') throw new Error('not a dmap');
o = 4; // magic, flags, padding
const iw = u32(), ih = u32(), w = u32(), h = u32();
o += 8; // dMin, dMax
const nName = u16(); o += nName;
const nIDs = u32(); o += 4 * nIDs;
o += 8 * (9 + 9 + 3); // K, R, C
const d = new Float32Array(b.buffer.slice(b.byteOffset + o, b.byteOffset + o + 4 * w * h));
const vals = Array.from(d).filter((x) => x > 0).sort((a, c) => a - c);
const lo = vals[Math.floor(vals.length * 0.02)], hi = vals[Math.floor(vals.length * 0.98)];
// Turbo colour map (polynomial fit), histogram-equalised depth, near = warm.
const poly = (t, c) => c.reduceRight((a, k) => a * t + k, 0);
const ramp = (t) => [
  poly(t, [0.13572138, 4.6153926, -42.66032258, 132.13108234, -152.94239396, 59.28637943]),
  poly(t, [0.0914026, 2.19418839, 4.84296658, -14.18503333, 4.27729857, 2.82956604]),
  poly(t, [0.1066733, 12.64194608, -60.58204836, 110.36276771, -89.90310912, 27.34824973]),
].map((x) => Math.round(255 * Math.max(0, Math.min(1, x))));
const rank = (z) => { let a = 0, c = vals.length; while (a < c) { const m = (a + c) >> 1; if (vals[m] < z) a = m + 1; else c = m; } return a / vals.length; };
const ppm = Buffer.alloc(w * h * 3);
for (let i = 0; i < w * h; i++) {
  const z = d[i];
  const c = z > 0 ? ramp(0.05 + 0.9 * (1 - rank(z))) : [12, 14, 20];
  ppm[i * 3] = c[0]; ppm[i * 3 + 1] = c[1]; ppm[i * 3 + 2] = c[2];
}
const tmp = out + '.ppm';
fs.writeFileSync(tmp, Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`), ppm]));
execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-vf', 'scale=640:-2:flags=lanczos', '-q:v', '3', out]);
fs.rmSync(tmp);
console.log(`${src}: ${w}x${h} (image ${iw}x${ih}), depth ${lo.toFixed(2)}..${hi.toFixed(2)} -> ${out}`);
