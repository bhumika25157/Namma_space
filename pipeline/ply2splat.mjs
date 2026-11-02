// Convert a 3D Gaussian Splatting PLY (e.g. from Brush) into the compact 32-byte ".splat" format
// (pos f32x3, scale f32x3, rgba u8x4, quat u8x4), most important splats first, capped at maxSplats.
// Usage: node ply2splat.mjs <in.ply> <out.splat> [maxSplats=600000]
import fs from 'node:fs';

const [inFile, outFile, maxArg] = process.argv.slice(2);
const MAX = Number(maxArg || 600000);
const buf = fs.readFileSync(inFile);
const hdrEnd = buf.indexOf('end_header\n') + 'end_header\n'.length;
const header = buf.subarray(0, hdrEnd).toString('latin1').split('\n');
const n = Number(header.find((l) => l.startsWith('element vertex')).split(' ')[2]);
const props = header.filter((l) => l.startsWith('property ')).map((l) => l.split(' '));
const SIZE = { float: 4, float32: 4, double: 8, uchar: 1, uint8: 1, int: 4, uint: 4, short: 2, ushort: 2 };
const off = {};
let stride = 0;
for (const [, type, name] of props) { off[name] = { o: stride, t: type }; stride += SIZE[type]; }
const dv = new DataView(buf.buffer, buf.byteOffset + hdrEnd);
const get = (i, name) => {
  const p = off[name];
  return p.t === 'double' ? dv.getFloat64(i * stride + p.o, true) : dv.getFloat32(i * stride + p.o, true);
};

const SH_C0 = 0.28209479177387814;
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const order = new Uint32Array(n).map((_, i) => i);
const imp = new Float32Array(n);
for (let i = 0; i < n; i++) {
  imp[i] = Math.exp(get(i, 'scale_0') + get(i, 'scale_1') + get(i, 'scale_2')) * sigmoid(get(i, 'opacity'));
}
order.sort((a, b) => imp[b] - imp[a]);
const count = Math.min(n, MAX);
const out = Buffer.alloc(count * 32);
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
for (let k = 0; k < count; k++) {
  const i = order[k], o = k * 32;
  out.writeFloatLE(get(i, 'x'), o); out.writeFloatLE(get(i, 'y'), o + 4); out.writeFloatLE(get(i, 'z'), o + 8);
  out.writeFloatLE(Math.exp(get(i, 'scale_0')), o + 12);
  out.writeFloatLE(Math.exp(get(i, 'scale_1')), o + 16);
  out.writeFloatLE(Math.exp(get(i, 'scale_2')), o + 20);
  out[o + 24] = clamp((0.5 + SH_C0 * get(i, 'f_dc_0')) * 255);
  out[o + 25] = clamp((0.5 + SH_C0 * get(i, 'f_dc_1')) * 255);
  out[o + 26] = clamp((0.5 + SH_C0 * get(i, 'f_dc_2')) * 255);
  out[o + 27] = clamp(sigmoid(get(i, 'opacity')) * 255);
  const q = [get(i, 'rot_0'), get(i, 'rot_1'), get(i, 'rot_2'), get(i, 'rot_3')]; // w, x, y, z
  const len = Math.hypot(...q) || 1;
  for (let j = 0; j < 4; j++) out[o + 28 + j] = clamp((q[j] / len) * 128 + 128);
}
fs.writeFileSync(outFile, out);
console.log(`splats in=${n} out=${count} bytes=${out.length}`);
