// Make the OpenMVS GLB web-ready without sharp/libvips:
// embed textures (re-encoded to JPEG by ffmpeg), weld + meshopt-compress geometry.
// Usage: node web_glb.mjs <in.glb> <out.glb> <ffmpeg.exe> [maxTexture=4096] [jpegQ=3]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { weld, quantize, reorder, meshopt, dedup, prune, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const [inFile, outFile, ffmpeg, maxTexArg, qArg] = process.argv.slice(2);
const maxTex = Number(maxTexArg || 4096);
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(inFile); // resolves external texture URIs next to the GLB

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webglb-'));
doc.getRoot().listTextures().forEach((tex, i) => {
  const src = path.join(tmp, `t${i}.${tex.getMimeType() === 'image/jpeg' ? 'jpg' : 'png'}`);
  const dst = path.join(tmp, `t${i}_out.jpg`);
  fs.writeFileSync(src, tex.getImage());
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', src,
    '-vf', `scale='min(${maxTex},iw)':-2`, '-q:v', String(qArg || 3), dst]);
  const before = tex.getImage().byteLength;
  tex.setImage(fs.readFileSync(dst)).setMimeType('image/jpeg').setURI(`texture_${i}.jpg`);
  console.log(`texture ${i}: ${(before / 1048576).toFixed(2)} MB -> ${(tex.getImage().byteLength / 1048576).toFixed(2)} MB`);
});

await doc.transform(dedup(), weld(), reorder({ encoder: MeshoptEncoder }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }), prune(), unpartition()); // GLB allows one buffer (OpenMVS writes one per atlas)
await io.write(outFile, doc);
console.log(`glb: ${(fs.statSync(inFile).size / 1048576).toFixed(2)} MB (+external textures) -> ${(fs.statSync(outFile).size / 1048576).toFixed(2)} MB`);
