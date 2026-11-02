// Deterministic frame recorder: drives real Chrome (headless, GPU) with a virtual clock so every frame of the
// live web app is captured at exactly 30 fps, while input arrives as genuine CDP mouse/keyboard events.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const FPS = 30;
export const W = 1920, H = 1080;
export const ROOT = fileURLToPath(new URL('..', import.meta.url)); // project root (parent of video/)
export const FFMPEG = process.env.FFMPEG || `${ROOT}tools/ffmpeg/ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe`;
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// Injected before any page script: virtual performance.now + requestAnimationFrame, a visible cursor and a caption layer.
export const PRELUDE = `(() => {
  const realRAF = window.requestAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  let virtual = false, vt = 0, queue = [];
  performance.now = () => (virtual ? vt : realNow());
  window.requestAnimationFrame = (cb) => { if (!virtual) return realRAF(cb); queue.push(cb); return queue.length; };
  window.__vclock = {
    start() { vt = realNow(); virtual = true; },
    step(ms) { vt += ms; const q = queue; queue = []; for (const cb of q) { try { cb(vt); } catch (e) { console.error(e); } } },
  };
  addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style');
    st.textContent = \`
      #__cursor { position: fixed; left: 0; top: 0; width: 26px; height: 26px; z-index: 99999; pointer-events: none; transform: translate(-3px,-2px); filter: drop-shadow(0 2px 3px rgba(0,0,0,.6)); }
      #__cursor.hide { display: none; }
      #__cursor .ring { position: absolute; left: -11px; top: -11px; width: 26px; height: 26px; border-radius: 50%; border: 2px solid #ffb547; opacity: 0; }
      #__cursor.down .ring { opacity: 1; }
      #__cap { position: fixed; left: 50%; bottom: 112px; transform: translateX(-50%); max-width: 1240px; z-index: 99998; pointer-events: none;
        font: 600 29px/1.38 "Segoe UI", system-ui, sans-serif; color: #fff; text-align: center; padding: 10px 22px; border-radius: 12px;
        background: rgba(6,8,12,.72); text-shadow: 0 1px 2px #000; opacity: 0; transition: none; }
      #__chap { position: fixed; left: 24px; top: 158px; z-index: 99998; pointer-events: none; font: 700 15px "Segoe UI", system-ui, sans-serif;
        letter-spacing: .14em; text-transform: uppercase; color: #ffb547; background: rgba(6,8,12,.72); padding: 8px 14px; border-radius: 8px;
        border-left: 3px solid #ffb547; opacity: 0; }
    \`;
    document.head.appendChild(st);
    const c = document.createElement('div');
    c.id = '__cursor'; c.className = 'hide';
    c.innerHTML = '<div class="ring"></div><svg width="26" height="26" viewBox="0 0 26 26"><path d="M3 2 L3 21 L8 16.5 L11.5 24 L15 22.5 L11.6 15.2 L18.5 15.2 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const cap = document.createElement('div'); cap.id = '__cap'; document.body.appendChild(cap);
    const chap = document.createElement('div'); chap.id = '__chap'; document.body.appendChild(chap);
    window.__overlay = {
      cursor(x, y, down, show) { c.style.left = x + 'px'; c.style.top = y + 'px'; c.classList.toggle('down', !!down); c.classList.toggle('hide', !show); },
      caption(text, op) { cap.textContent = text || ''; cap.style.opacity = text ? op : 0; },
      chapter(text, op) { chap.textContent = text || ''; chap.style.opacity = text ? op : 0; },
    };
  });
})();`;

export async function launch() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-vsync',
      `--window-size=${W},${H}`, '--hide-scrollbars', '--mute-audio', '--force-color-profile=srgb'],
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(PRELUDE);
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('[page]', m.type(), m.text().slice(0, 300)); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return { browser, page };
}

// Encoder fed with JPEG frames over stdin.
export function encoder(out) {
  const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS), out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)))));
  return {
    async write(buf) { if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r)); },
    async close() { ff.stdin.end(); await done; },
  };
}

export async function shot(page) {
  return page.screenshot({ type: 'jpeg', quality: 93, optimizeForSpeed: true, captureBeyondViewport: false });
}
