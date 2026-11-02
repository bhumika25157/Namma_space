// Top-down plot of camera centres (gravity-aligned) + sparse points, labelled by capture index.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { FFMPEG } from './rec.mjs';
const dir = process.argv[2];
const L = fs.readFileSync(dir + '/images.txt', 'utf8').split('\n').filter((l) => l && l[0] !== '#');
const cams = [];
for (let i = 0; i < L.length; i += 2) {
  const t = L[i].split(' ').map(Number); const name = L[i].split(' ')[9];
  const [qw, qx, qy, qz, tx, ty, tz] = t.slice(1, 8);
  const R = [[1-2*(qy*qy+qz*qz), 2*(qx*qy-qz*qw), 2*(qx*qz+qy*qw)], [2*(qx*qy+qz*qw), 1-2*(qx*qx+qz*qz), 2*(qy*qz-qx*qw)], [2*(qx*qz-qy*qw), 2*(qy*qz+qx*qw), 1-2*(qx*qx+qy*qy)]];
  const C = [0,1,2].map((j) => -(R[0][j]*tx + R[1][j]*ty + R[2][j]*tz));
  const up = [0,1,2].map((j) => -R[1][j]); // camera -Y in world
  cams.push({ name, C, up });
}
cams.sort((a, b) => a.name.localeCompare(b.name));
const up = [0,1,2].map((j) => cams.reduce((s, c) => s + c.up[j], 0)); const n = Math.hypot(...up); up.forEach((v, j) => (up[j] = v / n));
// basis: e1 perpendicular to up
let a = Math.abs(up[0]) < 0.9 ? [1,0,0] : [0,1,0];
const dot = (p, q) => p[0]*q[0]+p[1]*q[1]+p[2]*q[2];
let e1 = a.map((v, j) => v - dot(a, up) * up[j]); const n1 = Math.hypot(...e1); e1 = e1.map((v) => v / n1);
const e2 = [up[1]*e1[2]-up[2]*e1[1], up[2]*e1[0]-up[0]*e1[2], up[0]*e1[1]-up[1]*e1[0]];
const P = fs.readFileSync(dir + '/points3D.txt', 'utf8').split('\n').filter((l) => l && l[0] !== '#').map((l) => l.split(' ').slice(1, 4).map(Number));
const pts = P.map((p) => [dot(p, e1), dot(p, e2)]);
const cp = cams.map((c) => [dot(c.C, e1), dot(c.C, e2)]);
const xs = cp.map((p) => p[0]), ys = cp.map((p) => p[1]);
const pad = 2.5, x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
const S = 1000, sc = S / Math.max(x1 - x0, y1 - y0);
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" style="background:#111">`;
for (const p of pts) { const X = (p[0]-x0)*sc, Y = (p[1]-y0)*sc; if (X>=0&&X<S&&Y>=0&&Y<S) svg += `<rect x="${X.toFixed(1)}" y="${Y.toFixed(1)}" width="1.2" height="1.2" fill="#666"/>`; }
svg += `<polyline fill="none" stroke="#ffb547" stroke-width="1.5" points="${cp.map((p) => `${((p[0]-x0)*sc).toFixed(1)},${((p[1]-y0)*sc).toFixed(1)}`).join(' ')}"/>`;
cp.forEach((p, i) => { if (i % 10 === 0) svg += `<text x="${((p[0]-x0)*sc+4).toFixed(1)}" y="${((p[1]-y0)*sc-4).toFixed(1)}" fill="#6af" font-size="15" font-family="sans-serif">${i}</text><circle cx="${((p[0]-x0)*sc).toFixed(1)}" cy="${((p[1]-y0)*sc).toFixed(1)}" r="3" fill="#6af"/>`; });
svg += '</svg>';
fs.writeFileSync('chk/traj.svg', svg);
console.log('cams', cams.length, 'extent', (x1-x0).toFixed(2), (y1-y0).toFixed(2));
