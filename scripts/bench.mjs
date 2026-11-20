import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, type, release, arch } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { serveGame } from './run.mjs';

const launchedAt = Date.now() - process.uptime() * 1000;
const { values } = parseArgs({ options: {
  seed: { type: 'string' }, duration: { type: 'string' }, out: { type: 'string' }
} });
const seed = Number(values.seed), duration = Number(values.duration);
if (!Number.isSafeInteger(seed) || !Number.isFinite(duration) || duration <= 0 || !values.out) {
  throw new Error('Usage: --seed <integer> --duration <seconds> --out <file>');
}
const { server, url } = await serveGame();
const profile = await mkdtemp(join(tmpdir(), 'lantern-bench-'));
const executable = process.env.BROWSER_BIN ?? (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const linux = process.platform === 'linux';
const software = process.env.BROWSER_SOFTWARE === '1';
const headless = process.env.BROWSER_HEADLESS === '1';
const browser = spawn(executable, [
  '--no-first-run', '--no-default-browser-check', ...(headless ? ['--headless=new'] : []), '--remote-debugging-port=0', '--user-data-dir=' + profile,
  '--window-size=1280,720', '--force-device-scale-factor=1', '--disable-gpu-vsync', '--disable-frame-rate-limit',
  ...(software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : linux ? ['--use-gl=angle', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] : []),
  '--app=' + url + '/?seed=' + seed + '&benchmark=' + duration
], { stdio: 'ignore' });
let browserError;
browser.on('error', error => { browserError = error; });
let socket;
try {
  let page;
  const deadline = Date.now() + 12000;
  while (!page && Date.now() < deadline) {
    if (browserError || browser.exitCode !== null) throw browserError ?? new Error('Chromium window closed during launch');
    const [port] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n');
    if (port) {
      try {
        const tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
        page = tabs.find(tab => tab.type === 'page' && tab.url.startsWith(url));
      } catch { /* The browser may still be starting. */ }
    }
    if (!page) await wait(40);
  }
  if (!page) throw new Error('Không mở được Chromium. Kiểm tra DISPLAY hoặc BROWSER_BIN.');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const callback = pending.get(message.id);
    if (callback) { pending.delete(message.id); callback(message); }
  };
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  function send(method, params) {
    const key = ++id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(key);
        reject(new Error('Chromium timed out: ' + method));
      }, (duration + 15) * 1000);
      pending.set(key, message => {
        clearTimeout(timeout);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      });
      socket.send(JSON.stringify({ id: key, method, params }));
    });
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, mobile: false, deviceScaleFactor: 1 });
  let ready = false;
  const readyBy = Date.now() + 10000;
  while (!ready && Date.now() < readyBy) {
    try {
      const status = await send('Runtime.evaluate', { expression: 'Boolean(window.benchmarkResult)', returnByValue: true });
      ready = status.result.value === true;
    } catch (error) {
      if (!/context|navigat/i.test(error.message)) throw error;
    }
    if (!ready) await wait(50);
  }
  if (!ready) throw new Error('Benchmark scene failed to load');
  const evaluated = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true,
    expression: 'window.benchmarkResult' });
  if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.exception?.description ?? evaluated.exceptionDetails.text);
  const run = evaluated.result.value;
  if (!run.frames.length || run.width !== 1280 || run.height !== 720) throw new Error('Invalid benchmark capture');
  const sorted = run.frames.toSorted((a, b) => a - b);
  const n = sorted.length;
  const tail = sorted.slice(-Math.max(1, Math.ceil(n * 0.01)));
  const sum = values => values.reduce((total, item) => total + item, 0);
  const avg = 1000 * n / sum(sorted);
  const data = { contract_version: '1.3', avg_fps: avg, p1_low_fps: 1000 * tail.length / sum(tail),
    frame_ms_p95: sorted[Math.ceil(0.95 * n) - 1], frames: n, load_ms: Math.max(0, Math.round(run.firstFrameAt - launchedAt)),
    peak_mem_mb: null, vsync_off: true, renderer: run.renderer, os: type() + ' ' + release() + ' ' + arch() };
  await writeFile(values.out, JSON.stringify(data, null, 2) + '\n');
  console.log(JSON.stringify(data));
} finally {
  socket?.close();
  browser.kill();
  server.close();
  await Promise.race([new Promise(resolve => browser.once('close', resolve)), wait(1500)]);
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}
