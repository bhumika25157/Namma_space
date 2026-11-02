// Narration: one neural-TTS clip per sentence, then measure each clip so the recorder can time captions and action.
// Usage: node tts.mjs [KEY=value ...]   (placeholders like {DENSE_M} in narration.json are filled from the arguments)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { FFMPEG } from './rec.mjs';

const vars = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')));
const cfg = JSON.parse(fs.readFileSync('narration.json', 'utf8'));
const FFPROBE = FFMPEG.replace('ffmpeg.exe', 'ffprobe.exe');
fs.mkdirSync('audio', { recursive: true });
const cachePath = 'audio/cache.json';
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};

const out = {};
for (const [seg, lines] of Object.entries(cfg.segments)) {
  out[seg] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
    const file = `audio/${seg}_${i}.mp3`;
    for (let attempt = 0; cache[file] !== text || !fs.existsSync(file); attempt++) {
      try {
        const tts = new MsEdgeTTS();
        await tts.setMetadata(cfg.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
        const dir = fs.mkdtempSync('audio/tmp_');
        const { audioFilePath } = await tts.toFile(dir, text);
        fs.renameSync(audioFilePath, file);
        fs.rmSync(dir, { recursive: true });
        tts.close?.();
        cache[file] = text;
        fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1));
      } catch (e) {
        if (attempt >= 4) throw e;
        console.log(`retry ${file}: ${e.message}`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    const dur = Number(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
    out[seg].push({ file, text, dur });
    console.log(`${file} ${dur.toFixed(2)}s  ${text.slice(0, 60)}`);
  }
}
fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1));
fs.writeFileSync('audio/timing.json', JSON.stringify(out, null, 1));
const total = Object.values(out).flat().reduce((s, x) => s + x.dur, 0);
console.log('total speech', total.toFixed(1), 's');
process.exit(0);
