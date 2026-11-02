// Records the NammaSpace demo, segment by segment, at a deterministic 30 fps.
// Studio segments render time-driven title pages; viewer segments drive the real web app with CDP mouse/keyboard input.
// Usage: node record.mjs <segment|all> [scene id]
import fs from 'node:fs';
import { launch, encoder, shot, FPS, W, H, PRELUDE } from './rec.mjs';

const ONLY = process.argv[2] || 'all';
const PREVIEW = !!process.env.PREVIEW; // step every frame, but only save every 15th frame as a still
const SCENE = process.argv[3] || 'drjohnson';
const BASE = 'http://localhost:8765';
const timing = JSON.parse(fs.readFileSync('audio/timing.json', 'utf8'));
const pipe = fs.existsSync('pipe.json') ? JSON.parse(fs.readFileSync('pipe.json', 'utf8')) : {};
fs.mkdirSync('out', { recursive: true });

// lead: silence before first sentence; pre[i]: extra pause before sentence i; gap after each sentence; tail after last.
const PLAN = {
  intro: { kind: 'studio', lead: 0.8, pre: [0, 0.6, 0.6], tail: 1.2 },
  data: { kind: 'studio', lead: 0.6, pre: [0, 0.4, 1.4, 0.6], tail: 4.5 },
  stages: { kind: 'viewer', lead: 1.2, pre: [0, 2.2, 2.4, 2.4], tail: 2.0, chapter: 'Part 2 · Reconstruction results' },
  viewer: { kind: 'viewer', lead: 1.0, pre: [0, 3.5, 2.5, 5.0, 3.0], tail: 4.5, chapter: 'Part 3 · Interactive 3D viewer' },
  walk: { kind: 'viewer', lead: 0.8, pre: [0, 2.5, 3.5, 3.0, 4.0, 4.0], tail: 6.5, chapter: 'Part 4 · Free roaming' },
  outro: { kind: 'studio', lead: 0.6, pre: [0, 0.8, 1.2], tail: 3.8 },
};
const ORDER = ['intro', 'data', 'stages', 'viewer', 'walk', 'outro'];

function schedule(name) {
  const p = PLAN[name], lines = timing[name];
  let t = p.lead;
  const sents = lines.map((l, i) => {
    t += p.pre[i] || 0;
    const s = { start: t, dur: l.dur, text: l.text, file: l.file };
    t += l.dur + 0.5;
    return s;
  });
  return { sents, T: t + p.tail };
}

// Caption chunks (<= ~95 chars), timed proportionally to their length.
function captionAt(sents, t) {
  for (const s of sents) {
    if (t < s.start - 0.05 || t > s.start + s.dur + 0.15) continue;
    // Clauses (split after , : ; .) merged greedily up to ~100 chars; over-long clauses split into even word groups.
    const clauses = s.text.split(/(?<=[,:;.])\s+/).map((x) => x.trim()).filter(Boolean); // punctuation + space only: keeps 2.1 / three.js
    const pieces = [];
    for (const c of clauses) {
      if (c.length <= 100) { pieces.push(c); continue; }
      const words = c.split(' '), k = Math.ceil(c.length / 90), per = Math.ceil(words.length / k);
      for (let i = 0; i < words.length; i += per) pieces.push(words.slice(i, i + per).join(' '));
    }
    const parts = [];
    for (const p of pieces) {
      const last = parts[parts.length - 1];
      if (last && (last + ' ' + p).length <= 100) parts[parts.length - 1] = last + ' ' + p; else parts.push(p);
    }
    const total = parts.reduce((a, x) => a + x.length, 0);
    let acc = s.start;
    for (const x of parts) {
      const d = (s.dur * x.length) / total;
      if (t < acc + d || x === parts[parts.length - 1]) return { text: x, op: Math.min(1, (t - s.start + 0.05) / 0.15, (s.start + s.dur + 0.15 - t) / 0.15) };
      acc += d;
    }
  }
  return { text: '', op: 0 };
}

// ---------------- input primitives (async generators, one step per frame) ----------------
const M = { x: W / 2, y: H / 2, down: false, show: true };
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const frames = (sec) => Math.max(1, Math.round(sec * FPS));

function makeInput(page) {
  const I = {
    async *wait(sec) { for (let i = 0; i < frames(sec); i++) yield; },
    async *moveTo(x, y, sec = 0.6) {
      const x0 = M.x, y0 = M.y, n = frames(sec);
      for (let i = 1; i <= n; i++) {
        const k = ease(i / n);
        M.x = lerp(x0, x, k); M.y = lerp(y0, y, k);
        await page.mouse.move(M.x, M.y);
        yield;
      }
    },
    async *click(selector, sec = 0.6) {
      const r = await page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, selector);
      yield* I.moveTo(r.x, r.y, sec);
      yield* I.wait(0.12);
      M.down = true; await page.mouse.down(); yield; yield;
      M.down = false; await page.mouse.up(); yield;
      yield* I.wait(0.2);
    },
    // Drag by (dx, dy) over sec seconds with the given button, eased.
    async *drag(dx, dy, sec, button = 'left') {
      const x0 = M.x, y0 = M.y, n = frames(sec);
      M.down = true; await page.mouse.down({ button }); yield;
      for (let i = 1; i <= n; i++) {
        const k = ease(i / n);
        M.x = x0 + dx * k; M.y = y0 + dy * k;
        await page.mouse.move(M.x, M.y);
        yield;
      }
      M.down = false; await page.mouse.up({ button }); yield;
    },
    async *wheel(total, sec) {
      const n = frames(sec);
      for (let i = 0; i < n; i++) {
        const k0 = ease(i / n), k1 = ease((i + 1) / n);
        await page.mouse.wheel({ deltaY: total * (k1 - k0) });
        yield;
      }
    },
    async *dblclick(x, y) {
      yield* I.moveTo(x, y, 0.6);
      yield* I.wait(0.15);
      for (let c = 0; c < 2; c++) {
        M.down = true; await page.mouse.down(); yield;
        M.down = false; await page.mouse.up(); yield; yield;
      }
    },
    async *hold(code, sec) {
      await page.keyboard.down(code);
      yield* I.wait(sec);
      await page.keyboard.up(code);
    },
  };
  return I;
}

// ---------------- walking autopilot: real WASD + mouse-drag look, steering along the capture path ----------------
async function* autopilot(page, I, opts) {
  const { until, waypoints } = opts;
  let wi = 0, wDown = false, lastProgress = { t: 0, d: 1e9 }, frame = 0;
  const setW = async (on) => { if (on !== wDown) { wDown = on; on ? await page.keyboard.down('KeyW') : await page.keyboard.up('KeyW'); } };
  const press = async () => { M.down = true; await page.mouse.down(); };
  const release = async () => { M.down = false; await page.mouse.up(); };
  await press();
  while (!until()) {
    frame++;
    const s = await page.evaluate(() => ({ x: window.__ns.walk.pos.x, z: window.__ns.walk.pos.z, yaw: window.__ns.walk.yaw, pitch: window.__ns.walk.pitch }));
    let wp = waypoints[wi];
    let dx = wp.x - s.x, dz = wp.z - s.z, dist = Math.hypot(dx, dz);
    if (dist < 0.45 || (frame - lastProgress.t > 50 && dist > lastProgress.d - 0.15)) {
      wi = (wi + 1) % waypoints.length;
      lastProgress = { t: frame, d: 1e9 };
      wp = waypoints[wi]; dx = wp.x - s.x; dz = wp.z - s.z; dist = Math.hypot(dx, dz);
    }
    if (dist < lastProgress.d - 0.15) lastProgress = { t: frame, d: dist };
    const want = Math.atan2(-dx, -dz);
    let e = want - s.yaw;
    while (e > Math.PI) e -= 2 * Math.PI;
    while (e < -Math.PI) e += 2 * Math.PI;
    const ep = (opts.pitch ?? -0.06) - s.pitch;
    // Drag: yaw += dx * 0.0042, pitch += dy * 0.0042.
    const mx = Math.max(-11, Math.min(11, (e * 0.16) / 0.0042));
    const my = Math.max(-4, Math.min(4, (ep * 0.1) / 0.0042));
    await setW(Math.abs(e) < 0.55 && !opts.paused?.());
    if (M.x + mx < 520 || M.x + mx > 1400 || M.y + my < 300 || M.y + my > 780) {
      // Re-grab: release, glide back to the centre, press again (as a person would).
      await release();
      yield;
      const n = 8, x0 = M.x, y0 = M.y;
      for (let i = 1; i <= n; i++) { M.x = lerp(x0, W / 2, ease(i / n)); M.y = lerp(y0, H / 2 + 60, ease(i / n)); await page.mouse.move(M.x, M.y); yield; }
      await press();
      yield;
      continue;
    }
    M.x += mx; M.y += my;
    await page.mouse.move(M.x, M.y);
    yield;
  }
  await setW(false);
  await release();
}

// ---------------- segment choreography ----------------
function viewerScript(name, page, I, S, T) {
  const at = (t, gen) => ({ t, gen });
  const center = [W / 2, H / 2 + 40];
  if (name === 'stages') {
    return [
      at(0, async function* () { yield* I.moveTo(760, 620, 0.5); yield* I.drag(-140, 0, 0.5); }),
      at(S[0].start + 0.3, async function* () { yield* I.click('#layers button[data-layer=sparse]'); yield* I.moveTo(760, 640, 0.6); yield* I.drag(-320, -40, 4.2); }),
      at(S[1].start - 0.6, async function* () { yield* I.click('#layers button[data-layer=dense]'); yield* I.moveTo(760, 640, 0.5); yield* I.drag(-300, 20, 3.5); }),
      at(S[2].start - 0.6, async function* () { yield* I.click('#layers button[data-layer=mesh]'); yield* I.moveTo(760, 640, 0.5); yield* I.drag(-300, 20, 3.5); }),
      at(S[3].start - 0.6, async function* () { yield* I.click('#layers button[data-layer=textured]'); yield* I.moveTo(760, 640, 0.5); yield* I.drag(-280, -10, 3.2); }),
    ];
  }
  if (name === 'viewer') {
    return [
      at(0.3, async function* () { yield* I.moveTo(640, 560, 0.7); yield* I.drag(760, 0, 9.5); }),
      at(S[1].start + 0.2, async function* () { yield* I.moveTo(960, 420, 0.5); yield* I.drag(-140, 230, 3.2); yield* I.wait(0.6); yield* I.drag(220, -60, 2.2); }),
      at(S[2].start + 0.2, async function* () {
        const p = await page.evaluate(() => window.__demoTarget?.('zoom'));
        yield* I.moveTo(p ? p[0] : center[0], p ? p[1] : center[1], 0.7);
        yield* I.wheel(-1700, 2.6); yield* I.wait(0.2); yield* I.drag(0, -110, 1.8); yield* I.drag(300, 0, 3.2);
      }),
      at(S[3].start + 0.2, async function* () {
        const p = await page.evaluate(() => window.__demoTarget?.('focus', { pref: [960, 600], any: true }));
        yield* I.dblclick(p ? p[0] : center[0], p ? p[1] : center[1]);
        yield* I.wait(1.4);
        yield* I.moveTo(900, 600, 0.5); yield* I.drag(-200, -40, 2.0, 'right'); yield* I.wait(0.3); yield* I.drag(-240, 0, 2.2);
      }),
      at(S[4].start, async function* () {
        yield* I.click('#btn-info'); yield* I.wait(3.6); yield* I.click('#info-close');
        yield* I.click('#btn-full'); yield* I.wait(0.8); yield* I.click('#btn-reset'); yield* I.moveTo(1150, 640, 0.8);
      }),
    ];
  }
  if (name === 'walk') {
    let wps = null, shift = false;
    const tourAt = S[5].start + 3.2;
    return [
      at(0.4, async function* () { yield* I.click('.seg button[data-mode=walk]'); yield* I.moveTo(W / 2, H / 2 + 60, 0.5); }),
      // Look around in place.
      at(S[0].start + 2.2, async function* () { yield* I.drag(-420, 0, 2.6); yield* I.wait(0.2); yield* I.drag(420, -15, 2.4); }),
      // Walk the capture path through the rooms, steering with real W + mouse-drag look.
      at(S[1].start + 0.5, async function* () {
        wps = await page.evaluate(() => window.__demoTarget('route', { indices: [160, 60, 80, 110, 90, 150, 10, 20, 180, 30, 260, 200, 40, 170, 120] }));
        yield* autopilot(page, I, { waypoints: wps, until: () => I.now() >= S[2].start + 0.2 });
        yield* I.hold('KeyA', 1.0); yield* I.hold('KeyD', 1.0);
        yield* autopilot(page, I, { waypoints: wps, until: () => I.now() >= S[5].start - 0.2 });
        await page.keyboard.down('ShiftLeft'); shift = true;
        yield* autopilot(page, I, { waypoints: wps, until: () => I.now() >= S[5].start + 2.4 });
        await page.keyboard.up('ShiftLeft'); shift = false;
        yield* I.click('.seg button[data-mode=tour]', 0.7);
        yield* I.moveTo(1500, 700, 0.8);
      }),
    ];
  }
  return [];
}

async function recordStudio(name, browser) {
  const { sents, T } = schedule(name);
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(PRELUDE);
  await page.goto('http://localhost:8766/index.html', { waitUntil: 'networkidle0' });
  await page.evaluate((n, b, T, p) => window.setScene(n, b, T, p), name, sents.map((s) => s.start), T, pipe);
  const enc = encoder(`out/${name}.mp4`);
  const n = Math.round(T * FPS);
  for (let f = 0; f < n; f++) {
    const t = f / FPS;
    const c = captionAt(sents, t);
    await page.evaluate((t, c) => { window.setT(t); window.__overlay.caption(c.text, c.op); window.__overlay.cursor(0, 0, false, false); }, t, c);
    await enc.write(await shot(page));
  }
  await enc.close();
  await page.close();
  return { name, T, sents };
}

async function recordViewer(name, page) {
  const { sents, T } = schedule(name);
  const I = makeInput(page);
  const tasks = viewerScript(name, page, I, sents, T).map((x) => ({ ...x, it: null, done: false }));
  const enc = PREVIEW ? null : encoder(`out/${name}.mp4`);
  if (PREVIEW) fs.mkdirSync('chk/prev', { recursive: true });
  const n = Math.round(T * FPS);
  let f = 0;
  I.now = () => f / FPS;
  const chap = PLAN[name].chapter;
  for (f = 0; f < n; f++) {
    const t = f / FPS;
    for (const k of tasks) {
      if (k.done || t < k.t) continue;
      if (!k.it) k.it = k.gen();
      const r = await k.it.next();
      if (r.done) k.done = true;
    }
    const c = captionAt(sents, t);
    const chOp = Math.min(1, t / 0.4, (T - t) / 0.4);
    await page.evaluate((m, c, chap, chOp) => {
      window.__overlay.cursor(m.x, m.y, m.down, m.show);
      window.__overlay.caption(c.text, c.op);
      window.__overlay.chapter(chap, chOp);
      window.__vclock.step(1000 / 30);
    }, M, c, chap, chOp);
    if (!PREVIEW) await enc.write(await shot(page));
    else if (f % 15 === 0) fs.writeFileSync(`chk/prev/${name}_${String(f).padStart(4, '0')}.jpg`, await shot(page));
    if (f % 150 === 0) console.log(`${name} ${t.toFixed(1)}/${T.toFixed(1)}s`);
  }
  // Finish any task still mid-action (e.g. release keys) without recording.
  for (const k of tasks) if (k.it && !k.done) await k.it.return?.();
  if (enc) await enc.close();
  return { name, T, sents };
}

const t0 = Date.now();
const { browser, page } = await launch();
const results = fs.existsSync('out/segments.json') ? JSON.parse(fs.readFileSync('out/segments.json', 'utf8')) : {};
const want = ONLY === 'all' ? ORDER : ONLY.split(',');
let viewerPage = null;
for (const name of want) {
  console.log('recording', name);
  if (PLAN[name].kind === 'studio') results[name] = await recordStudio(name, browser);
  else {
    if (!viewerPage) {
      viewerPage = page;
      await page.goto(`${BASE}/?scene=${SCENE}&hud=1`, { waitUntil: 'load' });
      await page.waitForFunction('window.__nsReady === true', { timeout: 180000 });
      await page.addScriptTag({ path: 'demo_targets.js' });
      await new Promise((r) => setTimeout(r, 1500));
      await page.evaluate(() => window.__vclock.start());
      await page.mouse.move(M.x, M.y);
    }
    results[name] = await recordViewer(name, page);
  }
  if (PREVIEW) continue;
  const merged = fs.existsSync('out/segments.json') ? JSON.parse(fs.readFileSync('out/segments.json', 'utf8')) : {};
  merged[name] = results[name];
  fs.writeFileSync('out/segments.json', JSON.stringify(merged, null, 1));
  console.log(`done ${name} (${results[name].T.toFixed(1)}s) after ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
await browser.close();
process.exit(0);
