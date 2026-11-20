import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const address = process.argv[2] ?? 'http://127.0.0.1:4173';
const profile = await mkdtemp(join(tmpdir(), 'lantern-chrome-'));
const gpuFlags = process.env.BROWSER_SOFTWARE === '1'
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : ['--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'];
const browser = spawn(process.env.BROWSER_BIN ?? 'google-chrome', [
  '--headless', '--no-sandbox', ...gpuFlags,
  '--remote-debugging-port=0', '--no-first-run', '--user-data-dir=' + profile, address
], { stdio: 'ignore' });
const exited = new Promise(resolve => { browser.once('error', resolve); browser.once('exit', resolve); });
let ws;

async function until(action, timeout = 25000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await action();
    if (result) return result;
    await wait(80);
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for ' + action);
}

try {
  const port = await until(async () => (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')
    .catch(() => '')).split('\n')[0]);
  const tab = await until(async () => (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json())
    .find(page => page.type === 'page'));
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const pending = new Map();
  const errors = [];
  let id = 0;
  let breakpoint;
  let fixture;
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.method === 'Debugger.paused') {
      const callFrameId = message.params.callFrames[0].callFrameId;
      if (!fixture) { send('Debugger.resume').catch(error => errors.push(error.message)); return; }
      const expression = fixture === 'win' ?
        'game.duration = 2; game.player.carried = 10; game.lanterns.slice(1).forEach(lamp => Object.assign(lamp, {lit: true, ever_lit: true, fuelTicks: 6000})); game.lanterns[0].pos = [0,0,0];'
        : 'game.duration = 2; Object.assign(game.lanterns[0], {pos: [0,0,4], lit: true, ever_lit: true, fuelTicks: 1200}); game.lanterns[1].pos = [2,0,5];';
      send('Debugger.evaluateOnCallFrame', { callFrameId, expression }).then(result => {
        if (result.exceptionDetails) errors.push(result.exceptionDetails.text);
        return send('Debugger.resume');
      }).catch(error => errors.push(error.message));
    }
    const callback = pending.get(message.id);
    if (callback) { callback(message); pending.delete(message.id); }
  };
  async function send(method, params = {}) {
    const key = ++id;
    const response = new Promise(resolve => pending.set(key, resolve));
    ws.send(JSON.stringify({ id: key, method, params }));
    const message = await response;
    if (message.error) throw new Error(message.error.message);
    return message.result;
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  const title = () => evaluate("document.querySelector('#screen-title')?.textContent");
  const waitTitle = expected => until(async () => await title() === expected);
  const waitPlaying = () => until(() => evaluate("document.querySelector('#screen')?.open === false"));
  const click = text => evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === ${JSON.stringify(text)}).click()`);
  async function key(code, key, windowsVirtualKeyCode) {
    const args = { code, key, windowsVirtualKeyCode };
    await send('Input.dispatchKeyEvent', { ...args, type: 'rawKeyDown' });
    await send('Input.dispatchKeyEvent', { ...args, type: 'keyUp' });
  }
  async function screenshot(name) {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    await mkdir('docs/proof', { recursive: true });
    await writeFile('docs/proof/' + name, Buffer.from(data, 'base64'));
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await waitTitle('Đảo Đèn Lồng');
  assert.equal(await evaluate("document.querySelector('#screen-kicker').textContent"), 'Đèn cạn dầu');
  await click('Cài đặt');
  await evaluate("document.querySelector('[data-action=interact]').click()");
  await key('KeyQ', 'q', 81);
  assert.match(await evaluate("document.querySelector('#binding-status').textContent"), /Phím đã dùng/);
  await key('KeyF', 'f', 70);
  assert.match(await evaluate("document.querySelector('[data-action=interact]').textContent"), / · F$/);
  await evaluate("document.querySelector('#reduced-motion').click(); document.querySelector('#large-text').click()");
  await evaluate(`for (const [id, value] of [['volume', '0'], ['sensitivity', '72']]) {
    const input = document.getElementById(id);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }`);
  await evaluate(`{
    const palette = document.getElementById('clear-palette');
    palette.checked = true;
    palette.dispatchEvent(new Event('change'));
  }`);
  await send('Page.reload');
  await waitTitle('Đảo Đèn Lồng');
  await click('Cài đặt');
  assert.deepEqual(await evaluate("['volume','sensitivity'].map(id => document.getElementById(id).value)"), ['0', '72']);
  assert.equal(await evaluate("document.getElementById('clear-palette').checked && document.body.classList.contains('clear-palette')"), true);
  assert.match(await evaluate("document.querySelector('[data-action=interact]').textContent"), / · F$/);
  assert.equal(await evaluate("getComputedStyle(document.body).fontSize"), '22.5px');
  assert.equal(await evaluate("document.body.classList.contains('reduced-motion')"), true);
  await click('Khôi phục mặc định');
  assert.match(await evaluate("document.querySelector('[data-action=interact]').textContent"), / · E$/);
  await click('Quay lại');
  await evaluate(`{
    const start = OscillatorNode.prototype.start;
    globalThis.playedFrequencies = [];
    OscillatorNode.prototype.start = function (...args) {
      playedFrequencies.push(this.frequency.value);
      return start.apply(this, args);
    };
  }`);
  await click('Bắt đầu');
  await waitTitle('Đảo Bến');
  assert.match(await evaluate("document.querySelector('#screen-message').textContent"), /Ông Đăng/);
  await click('Vào đảo');
  await waitPlaying();
  async function verifyFps(island) {
    const fps = await evaluate(`new Promise(resolve => {
      let start, frames = 0;
      function frame(now) {
        start ??= now;
        if (now - start >= 4000) resolve(frames * 1000 / (now - start));
        else { frames++; requestAnimationFrame(frame); }
      }
      requestAnimationFrame(frame);
    })`);
    const graphics = await evaluate(`(() => {
      const canvas = document.querySelector('canvas');
      const gl = canvas.getContext('webgl2');
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
        viewport: [innerWidth, innerHeight], buffer: [canvas.width, canvas.height] };
    })()`);
    assert.deepEqual(graphics, { ...graphics, viewport: [1280, 720], buffer: [1280, 720] });
    console.log('Normal ' + island + ', 4s mean FPS:', fps.toFixed(2), JSON.stringify(graphics));
    assert.ok(fps >= 30, 'Expected at least 30 FPS');
  }
  await verifyFps('Đảo Bến');
  await screenshot('phase-4-game.png');
  assert.ok(await evaluate("playedFrequencies.includes(196)"));
  await key('ShiftLeft', 'Shift', 16);
  await until(() => evaluate("/Lướt\\s+[0-9]/.test(document.querySelector('#cooldowns').textContent)"));
  assert.ok(await evaluate("playedFrequencies.includes(210)"));
  await key('KeyP', 'p', 80);
  await waitTitle('Tạm dừng');
  const time = await evaluate("document.querySelector('#clock').textContent");
  await wait(1100);
  assert.equal(await evaluate("document.querySelector('#clock').textContent"), time);
  await click('Cài đặt');
  await waitTitle('Cài đặt');
  await click('Quay lại');
  await key('Escape', 'Escape', 27);
  await waitPlaying();
  console.log('Menu, night intro, frozen pause clock, settings persistence, and keyboard resume passed.');

  // Override only fixtures in the test browser, then win through the real E input and scoring code.
  const module = await (await fetch(address + '/src/browser.mjs')).text();
  const lineNumber = module.split('\n').findIndex(line => line.includes('game = createGame(seed, {}, night);')) + 1;
  assert.ok(lineNumber > 0);
  await send('Debugger.enable');
  ({ breakpointId: breakpoint } = await send('Debugger.setBreakpointByUrl', {
    lineNumber, urlRegex: '/src/browser[.]mjs(?:[?].*)?$'
  }));
  fixture = 'lose';
  await key('KeyP', 'p', 80);
  await click('Chơi lại Đêm');
  await click('Vào đảo');
  await until(() => evaluate("document.querySelector('#clock').classList.contains('danger')"));
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#clock')).color"), 'rgb(255, 255, 255)');
  assert.match(await evaluate("document.querySelector('#clock').textContent"), /^⚠/);
  assert.match(await evaluate("document.querySelector('#fuel-board [data-state=weak]').textContent"), /^L1 · ⚠/);
  assert.equal(await evaluate("document.querySelectorAll('#fuel-board [data-state=off]').length"), 4);
  await screenshot('phase-4-low-fuel.png');
  await waitTitle('Đêm kết thúc');
  await evaluate("document.querySelector('#score-name').value='Demo_7'; document.querySelector('#save-score').requestSubmit()");
  await until(() => evaluate("document.querySelector('#score-status').textContent === 'Đã lưu điểm.'"));
  assert.ok(await evaluate("playedFrequencies.includes(550) && playedFrequencies.includes(370)"));
  console.log('HUD dash cooldown, warning clock, background, dash, countdown and loss audio tones passed.');
  fixture = 'win';
  await click('Chơi lại Đêm');
  for (const name of ['Đảo Bến', 'Đảo Cau', 'Đảo Chuông']) {
    await waitTitle(name);
    await click('Vào đảo');
    await waitPlaying();
    await key('KeyE', 'e', 69);
    await until(() => evaluate("document.querySelector('#carry').textContent === '0/12'"));
    assert.equal(await evaluate("document.querySelector('#screen').open"), false);
    await waitTitle(name === 'Đảo Chuông' ? 'Bình Minh' : 'Đảo đã bừng sáng');
    if (name === 'Đảo Chuông') continue;
    fixture = null;
    await click('Đêm kế tiếp');
    const next = name === 'Đảo Bến' ? 'Đảo Cau' : 'Đảo Chuông';
    await waitTitle(next);
    await click('Vào đảo');
    await waitPlaying();
    await verifyFps(next);
    fixture = 'win';
    await key('KeyP', 'p', 80);
    await click('Chơi lại Đêm');
  }
  const summary = await evaluate("document.querySelector('#screen-message').textContent");
  assert.equal(summary, 'Ba hòn đảo đã sáng. Tổng điểm: 3564.');
  await screenshot('phase-4-dawn.png');
  await send('Debugger.removeBreakpoint', { breakpointId: breakpoint });
  await click('Về menu');
  await waitTitle('Đảo Đèn Lồng');
  await click('Bảng xếp hạng');
  await until(() => evaluate("document.querySelector('#leaderboard li')?.textContent.includes('Demo_7')"));
  assert.deepEqual(errors, []);
  console.log('Rebinding, duplicate detection, reset, reduced motion, large text and saved leaderboard passed.');
  console.log('Fixture replay, three-night progression via E, capacity increase, delayed dawn victory, total score, color palette persistence and return to menu passed.');
} finally {
  ws?.close();
  browser.kill();
  await Promise.race([exited, wait(1000)]);
  await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}
