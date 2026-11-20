import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { benchmarkGame, benchmarkTick, capacityFor, createGame, hz, isSafeLantern, lanternCost, requiredLights, step, targetLantern, timeLeft, tuning } from './game.mjs';
import { maps, ramps } from './maps.mjs';
import { gameAudio } from './audio.mjs';
import { actions, bindingLabel, defaultBindings, loadBindings, reservedKeys } from './bindings.mjs';
import { topEntries, validName } from './leaderboard.mjs';

const color = {
  sky: '#0e1430', fog: '#1b2350', grass: '#2f5d50', sand: '#c9b48a', wood: '#6b4a2f', cloud: '#12384a',
  lamp: '#ffb347', core: '#ffe9b0', off: '#5b5f6e', mote: '#fff6c2', glow: '#ffe58a',
  shade: '#120a1a', edge: '#7a3cff', stunned: '#3a3450', shirt: '#e8e2d0', red: '#c8102e',
  gold: '#f2c14e', drifter: '#8fa3b8'
};
const $ = id => document.getElementById(id);
const scene = new THREE.Scene();
scene.background = new THREE.Color(color.sky);
scene.fog = new THREE.Fog(color.fog, 20, 110);
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.12, 180);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
document.body.append(renderer.domElement);
const ambient = new THREE.HemisphereLight('#e1e7ff', '#a3a2aa', 0.15);
scene.add(ambient);
const moon = new THREE.DirectionalLight('#d3dbff', 1.7);
moon.position.set(-19, 25, -7);
scene.add(moon);

const ball = new THREE.IcosahedronGeometry(1, 0);
const materialCache = new Map();
const landscapeColors = new Map();
function mesh(parent, geometry, tint, x, y, z, unlit = false) {
  const key = tint + unlit;
  if (!materialCache.has(key)) materialCache.set(key, unlit
    ? new THREE.MeshBasicMaterial({ color: tint })
    : new THREE.MeshLambertMaterial({ color: tint, flatShading: true }));
  const piece = new THREE.Mesh(geometry, materialCache.get(key));
  piece.position.set(x, y, z);
  parent.add(piece);
  return piece;
}
function orb(parent, tint, x, y, z, radius, unlit = false) {
  const piece = mesh(parent, ball, tint, x, y, z, unlit);
  piece.scale.setScalar(radius);
  return piece;
}
function cylinder(parent, x, z, top, radius, height, tint, segments = 48) {
  return mesh(parent, new THREE.CylinderGeometry(radius, radius, height, segments), tint, x, top - height / 2, z);
}
const ring = (parent, x, y, z, radius, tint) => {
  const piece = mesh(parent, new THREE.RingGeometry(radius - 0.09, radius, 48), tint, x, y, z, true);
  piece.rotation.x = -Math.PI / 2;
  return piece;
};

const may = new THREE.Group();
scene.add(may);
mesh(may, new THREE.CylinderGeometry(0.23, 0.43, 0.77, 8), color.shirt, 0, 0.62, 0);
mesh(may, new THREE.CylinderGeometry(0.26, 0.27, 0.14, 8), color.red, 0, 0.94, 0);
orb(may, '#dfac85', 0, 1.17, 0, 0.27);
mesh(may, new THREE.ConeGeometry(0.63, 0.35, 14), color.sand, 0, 1.48, 0);
mesh(may, new THREE.CylinderGeometry(0.018, 0.018, 0.25, 5), color.wood, 0.49, 1.22, 0);
orb(may, color.lamp, 0.49, 1.02, 0, 0.14, true);
const feet = [-0.16, 0.16].map(x => mesh(may, new THREE.BoxGeometry(0.21, 0.28, 0.34), color.wood, x, 0.15, 0));
const pulseRing = ring(scene, 0, 0, 0, 1, color.glow);
const leafBatch = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.32, 0.16), new THREE.MeshBasicMaterial({
  color: color.gold, side: THREE.DoubleSide
}), 30);
leafBatch.frustumCulled = false;
scene.add(leafBatch);
const leafTransform = new THREE.Object3D();

const params = new URLSearchParams(location.search);
const benchmarkDuration = Number(params.get('benchmark')) || 0;
let settings = { volume: 45, sensitivity: 45, clearPalette: false, reducedMotion: false, largeText: false,
  bindings: { ...defaultBindings } };
try {
  const stored = JSON.parse(localStorage.getItem('lantern-settings') ?? '{}');
  for (const key of ['volume', 'sensitivity']) if (Number.isFinite(stored[key])) settings[key] = stored[key];
  for (const key of ['clearPalette', 'reducedMotion', 'largeText']) settings[key] = stored[key] === true;
  settings.bindings = loadBindings(stored.bindings);

} catch { /* Storage may be disabled. */ }
const saveSettings = () => {
  try { localStorage.setItem('lantern-settings', JSON.stringify(settings)); } catch { /* Optional persistence. */ }
};
const audio = gameAudio(() => settings.volume);

const keys = new Set();
const taps = new Set();
const screen = $('screen');
let game, yaw, pulseTick, lastHud, lastSecond, clearedScore = 0, view, rebinding, spawnCue, pendingScore;
let world = new THREE.Group();
let tower;
scene.add(world);
const lamps = new Map();
const maxRenderedMotes = 512;
const moteTransform = new THREE.Object3D();
const [moteHalo, moteCore] = [color.glow, color.mote].map(tint => {
  const batch = new THREE.InstancedMesh(ball, new THREE.MeshBasicMaterial({ color: tint }), maxRenderedMotes);
  batch.frustumCulled = false;
  scene.add(batch);
  return batch;
});
const shades = new Map();
const drifters = new Map();
const charms = new Map();
const seedArg = Number(params.get('seed') ?? 12);
const seed = Number.isSafeInteger(seedArg) ? seedArg : 12;
const slots = Array.from({ length: tuning.capacity_max }, () => $('slot-cells').appendChild(document.createElement('i')));
const displayTime = seconds => {
  const value = Math.max(0, Math.ceil(seconds));
  return String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
};

function batchLandscape() {
  const byMaterial = new Map();
  const sunlight = new THREE.Vector3(-0.42, 0.83, -0.36).normalize();
  const normal = new THREE.Vector3();
  for (const piece of [...world.children]) {
    if (!piece.isMesh) continue;
    piece.updateMatrix();
    const geometry = piece.geometry.index ? piece.geometry.toNonIndexed() : piece.geometry.clone();
    geometry.applyMatrix4(piece.matrix);
    const normals = geometry.getAttribute('normal');
    const colors = new Float32Array(normals.count * 3);
    for (let i = 0; i < normals.count; i++) {
      normal.fromBufferAttribute(normals, i);
      colors.fill(0.58 + 0.42 * Math.max(0, normal.dot(sunlight)), i * 3, i * 3 + 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (!byMaterial.has(piece.material)) byMaterial.set(piece.material, []);
    byMaterial.get(piece.material).push(geometry);
    world.remove(piece);
    if (piece.geometry !== ball) piece.geometry.dispose();
  }
  for (const [source, geometries] of byMaterial) {
    const key = source.color.getHexString();
    if (!landscapeColors.has(key)) {
      const material = new THREE.MeshBasicMaterial({ color: source.color, vertexColors: true });
      landscapeColors.set(key, { material, base: source.color.clone() });
    }
    world.add(new THREE.Mesh(mergeGeometries(geometries), landscapeColors.get(key).material));
    geometries.forEach(geometry => geometry.dispose());
  }
}

function landscape() {
  for (const island of game.map.islands) {
    cylinder(world, island.x, 0, 0, island.radius, 3, color.grass);
    mesh(world, new THREE.CylinderGeometry(island.radius, island.radius * 0.36, 8, 18), color.sand, island.x, -7, 0);
    for (let i = 0; i < 14; i++) {
      const angle = i * 2.399963;
      const r = island.radius - 1.5 - i % 3;
      const x = island.x + r * Math.cos(angle), z = r * Math.sin(angle);
      if (game.night === 2 && Math.abs(z) < 4) continue;
      mesh(world, new THREE.CylinderGeometry(0.13, 0.22, 1.6, 5), color.wood, x, 0.8, z);
      mesh(world, new THREE.ConeGeometry(0.95, 2.7, 6), color.grass, x, 2, z);
    }
  }
  if (game.night === 2) {
    mesh(world, new THREE.BoxGeometry(18, 0.35, 4), color.wood, 35, -0.18, 0);
    for (let i = 0; i < 18; i++) mesh(world, new THREE.BoxGeometry(0.94, 0.1, 4), color.sand, 26.5 + i, -0.055, 0);
  }
  if (game.night === 3) {
    const halfRing = new THREE.Shape();
    halfRing.absarc(0, 0, 24, 0, Math.PI, false);
    halfRing.lineTo(-12, 0);
    halfRing.absarc(0, 0, 12, Math.PI, 0, true);
    halfRing.closePath();
    const terrace = mesh(world, new THREE.ExtrudeGeometry(halfRing, { depth: 3, bevelEnabled: false, curveSegments: 32 }),
      color.grass, 0, 3, 0);
    terrace.rotation.x = Math.PI / 2;
    tower = new THREE.Group();
    world.add(tower);
    cylinder(tower, 0, 0, 6, 8, 1.2, color.sand);
    cylinder(tower, 0, 0, 14, 2, 8, color.wood, 16);
    mesh(tower, new THREE.ConeGeometry(2.6, 1.5, 12), color.lamp, 0, 14.65, 0);
    for (const a of ramps) {
      const ramp = mesh(world, new THREE.BoxGeometry(Math.hypot(6, 3), 0.25, 3), color.sand, 27 * Math.cos(a), 1.4, 27 * Math.sin(a));
      ramp.rotation.set(0, -a, -Math.atan2(3, 6), 'YZX');
    }
  }
  for (let i = 0; i < 26; i++) {
    const a = i * 2.399963, r = 49 + i % 16;
    const cloud = orb(world, color.cloud, (game.night === 2 ? 35 : 0) + r * Math.cos(a), -5 - i % 3, r * Math.sin(a), 1);
    cloud.scale.set(6 + i % 4, 0.8, 3.4);
  }
  for (const pad of game.map.pads) cylinder(world, pad.pos[0], pad.pos[2], pad.pos[1] + 0.055, 1, 0.12, color.gold, 16);
}

function setupNight(night) {
  game = createGame(seed, {}, night);
  if (benchmarkDuration) game = benchmarkGame(seed);
  yaw = 0;
  may.rotation.y = 0;
  pulseTick = -100;
  lastHud = '';
  lastSecond = Infinity;
  spawnCue = undefined;
  keys.clear();
  taps.clear();
  for (const map of [lamps, shades, drifters, charms]) map.clear();
  const disposed = new Set();
  world.traverse(object => {
    if (object.isMesh && object.geometry !== ball) disposed.add(object.geometry);
  });
  disposed.forEach(geometry => geometry.dispose());
  scene.remove(world);
  world = new THREE.Group();
  scene.add(world);
  tower = null;
  landscape();
  batchLandscape();
  for (const lamp of game.lanterns) {
    const group = new THREE.Group();
    group.position.set(...lamp.pos);
    world.add(group);
    cylinder(group, 0, 0, 2.35, 0.19, 2.35, color.wood, 8);
    const housing = new THREE.Group();
    housing.position.y = 2.35;
    group.add(housing);
    const body = cylinder(housing, 0, 0, 0.95, 0.62, 1, color.off, 8);
    const core = mesh(housing, new THREE.CylinderGeometry(0.65, 0.68, 0.22, 8), color.core, 0, 0.44, 0, true);
    mesh(housing, new THREE.ConeGeometry(0.9, 0.6, 8), color.wood, 0, 1.25, 0);
    const tears = new THREE.Group();
    housing.add(tears);
    const tearShape = new THREE.Shape();
    tearShape.moveTo(-0.14, 0);
    tearShape.lineTo(0.07, 0.18);
    tearShape.lineTo(0.015, 0.04);
    tearShape.lineTo(0.13, 0.08);
    tearShape.lineTo(-0.08, -0.18);
    tearShape.lineTo(-0.04, -0.03);
    tearShape.closePath();
    const tearGeometry = new THREE.ShapeGeometry(tearShape);
    for (let face = 0; face < 4; face++) {
      const angle = face * Math.PI / 2;
      mesh(tears, tearGeometry, color.sky, Math.sin(angle) * 0.625, 0.48,
        Math.cos(angle) * 0.625, true).rotation.y = angle;
    }
    const gauge = new THREE.Group();
    gauge.position.y = 4.2;
    group.add(gauge);
    const rail = mesh(gauge, new THREE.PlaneGeometry(1.65, 0.22), color.sky, 0, 0, 0, true);
    const fill = mesh(gauge, new THREE.PlaneGeometry(1.55, 0.13), color.gold, 0, 0, 0.025, true);
    const halo = ring(group, 0, 0.04, 0, tuning.safe_radius, color.gold);
    if (!materialCache.has('litLamp')) materialCache.set('litLamp', new THREE.MeshLambertMaterial({
      color: color.lamp, emissive: color.lamp, emissiveIntensity: 0.34
    }));
    lamps.set(lamp.id, { housing, body, off: body.material, core, tears, gauge, rail, fill, halo });
  }
  for (const charm of game.charms) {
    const group = new THREE.Group();
    mesh(group, new THREE.BoxGeometry(0.44, 0.67, 0.053), color.gold, 0, 0, 0, true);
    mesh(group, new THREE.BoxGeometry(0.33, 0.53, 0.065), color.red, 0, 0, 0, true);
    world.add(group);
    charms.set(charm.id, group);
  }
}

function overlay(mode, title, text, buttons, kicker = '') {
  view = mode;
  rebinding = undefined;
  $('binding-status').textContent = '';
  $('leaderboard').hidden = mode !== 'leaderboard';
  $('save-score').hidden = true;
  screen.querySelector('.controls').hidden = mode !== 'intro' && mode !== 'pause';
  screen.dataset.view = mode;
  if (mode !== 'playing') {
    keys.clear();
    taps.clear();
  }
  $('hud').hidden = mode !== 'playing' && mode !== 'pause';
  $('screen-title').textContent = title;
  $('screen-message').textContent = text;
  $('screen-kicker').textContent = kicker;
  $('settings').hidden = mode !== 'settings';
  $('actions').replaceChildren(...buttons.map(([label, action]) => Object.assign(document.createElement('button'), {
    textContent: label, onclick: () => { audio.initialize(); action(); }
  })));
  if (mode === 'playing') screen.close();
  else if (!screen.open) screen.showModal();
  audio.background(mode === 'playing');
}

function menu() {
  clearedScore = 0;
  setupNight(1);
  overlay('menu', 'Đảo Đèn Lồng', 'Giữ đủ đèn sáng tới bình minh. Đèn yếu nhấp nháy và có thể bị Bóng Mực hút dầu.', [
    ['Bắt đầu', () => intro(1)], ['Bảng xếp hạng', showLeaderboard], ['Cài đặt', () => openSettings(menu)]
  ], 'Đèn cạn dầu');
}
const messages = [
  'Mây à, hãy giữ ít nhất ba đèn sáng tới bình minh. Đèn yếu cần châm dầu để xua Bóng Mực.',
  'Cầu tre nối hai bờ. Hãy thử những bục nhảy nếu con muốn sang đảo bên kia.',
  'Theo đường dốc lên tầng cao, rồi lấy đà từ bục nhảy để tới tháp chuông.'
];
function intro(night) {
  setupNight(night);
  overlay('intro', game.map.name, 'Ông Đăng · “' + messages[night - 1] + '”',
    [['Vào đảo', play], ['Về menu', menu]], 'Đêm ' + night);
}
function play() {
  if (game.state === 'paused') togglePause();
  overlay('playing', '', '', []);
}
function pause() {
  if (game.state === 'playing') togglePause();
  overlay('pause', 'Tạm dừng', game.map.name, [
    ['Tiếp tục', play], ['Chơi lại Đêm', () => intro(game.night)],
    ['Cài đặt', () => openSettings(pause)], ['Về menu', menu]
  ]);
}
function openSettings(back) {
  overlay('settings', 'Cài đặt', '', [['Quay lại', back]]);
  renderBindings();
}
for (const key of ['volume', 'sensitivity']) {
  const input = $(key);
  input.value = settings[key];
  $(key + '-value').textContent = input.value + '%';
  input.addEventListener('input', () => {
    settings[key] = Number(input.value);
    $(key + '-value').textContent = input.value + '%';
    audio.volume();
    saveSettings();
  });
}
function applyPreferences() {
  document.body.classList.toggle('clear-palette', settings.clearPalette);
  document.body.classList.toggle('reduced-motion', settings.reducedMotion);
  document.documentElement.classList.toggle('large-text', settings.largeText);
  lastHud = '';
}
for (const [id, key] of [['clear-palette', 'clearPalette'], ['reduced-motion', 'reducedMotion'], ['large-text', 'largeText']]) {
  const input = $(id);
  input.checked = settings[key];
  input.addEventListener('change', () => {
    settings[key] = input.checked;
    saveSettings();
    applyPreferences();
  });
}
applyPreferences();

const labelFor = action => settings.bindings[action].map(bindingLabel).join('/');
function renderBindings() {
  $('controls-summary').textContent = Object.keys(actions).map(action => actions[action] + ' ' + labelFor(action)).join(' · ') + ' · Kéo chuột để xoay';
  const buttons = Object.keys(actions).map(action => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = actions[action] + ' · ' + labelFor(action);
    button.dataset.action = action;
    button.onclick = () => {
      rebinding = action;
      $('binding-status').textContent = 'Nhấn phím mới cho ' + actions[action] + '.';
    };
    return button;
  });
  $('bindings').replaceChildren(...buttons);
}
$('reset-bindings').onclick = () => {
  settings.bindings = { ...defaultBindings };
  rebinding = undefined;
  saveSettings();
  renderBindings();
  $('binding-status').textContent = 'Đã khôi phục phím mặc định.';
};
renderBindings();

function localEntries() {
  return topEntries(JSON.parse(localStorage.getItem('lantern-leaderboard') ?? '[]'));
}
async function leaderboardRequest(entry) {
  const response = await fetch('/api/leaderboard', entry ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry)
  } : undefined);
  if (response.headers.get('content-type')?.includes('application/json') && response.status !== 404) {
    if (!response.ok) throw new Error('Không thể truy cập bảng xếp hạng.');
    const data = await response.json();
    return data.entries;
  }
  if (![200, 404, 405].includes(response.status)) throw new Error('Không thể truy cập bảng xếp hạng.');
  const entries = entry ? topEntries([...localEntries(), entry]) : localEntries();
  if (entry) localStorage.setItem('lantern-leaderboard', JSON.stringify(entries));
  return entries;
}
async function showLeaderboard() {
  overlay('leaderboard', 'Bảng xếp hạng', 'Đang tải…', [['Về menu', menu]]);
  $('leaderboard').replaceChildren();
  try {
    const entries = await leaderboardRequest();
    if (view !== 'leaderboard') return;
    $('screen-message').textContent = entries.length ? '' : 'Chưa có điểm được lưu.';
    for (const entry of entries) {
      const item = document.createElement('li');
      item.textContent = entry.name + ' · ' + entry.score + ' điểm · ' + entry.nights_won + '/3 đêm';
      $('leaderboard').append(item);
    }
  } catch (error) {
    if (view === 'leaderboard') $('screen-message').textContent = error.message;
  }
}
function offerScore(nightsWon) {
  pendingScore = { score: clearedScore, nights_won: nightsWon, seed };
  $('score-name').value = '';
  $('score-status').textContent = '';
  $('save-score').querySelector('button').disabled = false;
  $('save-score').hidden = false;
}
$('save-score').addEventListener('submit', async event => {
  event.preventDefault();
  if (!pendingScore) return;
  const name = $('score-name').value.trim();
  if (!validName(name)) {
    $('score-status').textContent = 'Dùng 3–12 chữ, số hoặc dấu _.';
    return;
  }
  const target = pendingScore;
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    await leaderboardRequest({ ...target, name, achieved_at: new Date().toISOString() });
    if (pendingScore === target) {
      pendingScore = undefined;
      $('score-status').textContent = 'Đã lưu điểm.';
    }
  } catch (error) {
    if (pendingScore === target) {
      button.disabled = false;
      $('score-status').textContent = error.message;
    }
  }
});

function result(event) {
  const won = game.state === 'won';
  const night = game.night;
  audio.play(game.state);
  if (won) clearedScore += game.score;
  if (won && night === 3) {
    overlay('result', 'Bình Minh', 'Ba hòn đảo đã sáng. Tổng điểm: ' + clearedScore + '.', [
      ['Về menu', menu]
    ], 'Đã hoàn thành ba đêm');
    offerScore(3);
    return;
  }
  const reasons = { dawn_survived: 'Đủ đèn sáng khi bình minh đến.', dawn: 'Bình minh đến khi đảo chưa đủ đèn sáng.', no_flames: 'Mây đã hết Ngọn Lửa.' };
  overlay('result', won ? 'Đảo đã bừng sáng' : 'Đêm kết thúc',
    reasons[event.data.reason] + ' Điểm đêm này: ' + game.score + (won ? '. Tổng điểm: ' + clearedScore : '') + '.',
    [[won ? 'Đêm kế tiếp' : 'Chơi lại Đêm', () => intro(won ? night + 1 : night)], ['Về menu', menu]],
    'Đêm ' + night + ' · ' + game.map.name);
  if (!won) offerScore(night - 1);
}
function onEvent(event) {
  if (event.name === 'shade_spawned') spawnCue = { id: event.data.id, until: game.simTick + 180 };
  if (event.name === 'pulse') pulseTick = game.simTick;
  if (event.name === 'game_over') result(event);
  else audio.play(event.name);
}

const cameraKeys = new Set(['ArrowLeft', 'ArrowRight']);
window.addEventListener('keydown', event => {
  if (view === 'settings' && rebinding) {
    event.preventDefault();
    if (event.repeat) return;
    const assigned = Object.keys(actions).find(action => action !== rebinding && settings.bindings[action].includes(event.code));
    if (assigned || reservedKeys.has(event.code) || !event.code) {
      $('binding-status').textContent = assigned ? 'Phím đã dùng cho ' + actions[assigned] + '.' : 'Phím này dành cho giao diện.';
      return;
    }
    settings.bindings[rebinding] = [event.code];
    const action = rebinding;
    rebinding = undefined;
    saveSettings();
    renderBindings();
    $('bindings').querySelector('[data-action="' + action + '"]').focus();
    $('binding-status').textContent = 'Đã lưu phím ' + labelFor(action) + '.';
    return;
  }
  if (settings.bindings.pause.includes(event.code) && (view === 'playing' || view === 'pause')) {
    event.preventDefault();
    if (!event.repeat) (view === 'playing' ? pause : play)();
    return;
  }
  if (view !== 'playing' || (!cameraKeys.has(event.code) && !Object.values(settings.bindings).some(codes => codes.includes(event.code)))) return;
  event.preventDefault();
  keys.add(event.code);
  if (!event.repeat) taps.add(event.code);
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { keys.clear(); taps.clear(); });
const maxMouseDelta = 40;
let mouseLocked = false;
renderer.domElement.addEventListener('pointerdown', event => {
  if (view !== 'playing') return;
  renderer.domElement.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  mouseLocked = document.pointerLockElement === renderer.domElement;
});
renderer.domElement.addEventListener('pointermove', event => {
  if (mouseLocked && view === 'playing') {
    const delta = Math.max(-maxMouseDelta, Math.min(maxMouseDelta, event.movementX));
    yaw -= delta * settings.sensitivity / 100;
  }
});
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
screen.addEventListener('cancel', event => event.preventDefault());

function togglePause() {
  game.previous = { ...game.previous, pause: false };
  step(game, { ...game.previous, move: [0, 0], jump: false, interact: false, pulse: false, dash: false, pause: true }, onEvent);
}
function runTick() {
  const down = action => Number(settings.bindings[action].some(code => keys.has(code)));
  const pressed = action => settings.bindings[action].some(code => keys.has(code) || taps.has(code));
  const cameraDown = code => Number(keys.has(code) && !Object.values(settings.bindings).some(codes => codes.includes(code)));
  yaw += (cameraDown('ArrowRight') - cameraDown('ArrowLeft')) * 2;
  step(game, { move: [down('right') - down('left'), down('forward') - down('back')], cam_yaw_deg: yaw,
    jump: pressed('jump'), interact: pressed('interact'), pulse: pressed('pulse'),
    dash: pressed('dash'), pause: false }, onEvent, name => audio.play(name));
  taps.clear();
  const second = Math.ceil(timeLeft(game));
  if (second !== lastSecond && second <= 10 && second >= 1) audio.play('countdown');
  lastSecond = second;
}

function syncEntities(entities, cache, create, update) {
  const active = new Set();
  for (const entity of entities) {
    if (!cache.has(entity.id)) cache.set(entity.id, create());
    update(cache.get(entity.id), entity);
    active.add(entity.id);
  }
  for (const [id, object] of cache) if (!active.has(id)) {
    world.remove(object);
    cache.delete(id);
  }
}
const shadeGroup = (parent = world) => {
  const group = new THREE.Group();
  orb(group, color.edge, 0, 0, 0, 0.83, true);
  orb(group, color.shade, 0, 0.055, 0.04, 0.78, true);
  const stunned = orb(group, color.stunned, 0, 0, 0.02, 0.85, true);
  stunned.visible = false;
  const eyes = new THREE.Group();
  for (const x of [-0.21, 0.21]) orb(eyes, color.edge, x, 0.13, 0.72, 0.105, true);
  group.add(eyes);
  parent.add(group);
  return group;
};
// Render the same shade parts in four draw calls when there are 200 of them.
let benchmarkShades;
function drawBenchmarkShades(tick) {
  if (!benchmarkShades) {
    const prototype = shadeGroup(new THREE.Group());
    const parts = [prototype.children[0], prototype.children[1], ...prototype.children[3].children];
    benchmarkShades = parts.map(part => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, 200);
      mesh.frustumCulled = false;
      scene.add(mesh);
      part.updateMatrix();
      return { mesh, local: part.matrix.clone() };
    });
  }
  for (let i = 0; i < game.shades.length; i++) {
    const { pos } = game.shades[i];
    moteTransform.position.set(pos[0], pos[1] + Math.sin(tick / 14) * 0.1, pos[2]);
    moteTransform.rotation.y = Math.atan2(-pos[0], -pos[2]);
    moteTransform.scale.setScalar(1);
    moteTransform.updateMatrix();
    for (const { mesh, local } of benchmarkShades) mesh.setMatrixAt(i, shadeMatrix.multiplyMatrices(moteTransform.matrix, local));
  }
  for (const { mesh } of benchmarkShades) mesh.instanceMatrix.needsUpdate = true;
  moteTransform.rotation.y = 0;
}
const shadeMatrix = new THREE.Matrix4();

function nightEntities(tick) {
  moteHalo.count = moteCore.count = Math.min(game.motes.length, maxRenderedMotes);
  for (let i = 0; i < moteHalo.count; i++) {
    const { pos } = game.motes[i];
    const y = pos[1] + 0.59 + 0.14 * Math.sin(tick / 15 + pos[0]);
    moteTransform.position.set(pos[0], y, pos[2]);
    moteTransform.scale.setScalar(0.17);
    moteTransform.updateMatrix();
    moteHalo.setMatrixAt(i, moteTransform.matrix);
    moteTransform.position.y += 0.045;
    moteTransform.position.z += 0.045;
    moteTransform.scale.setScalar(0.135);
    moteTransform.updateMatrix();
    moteCore.setMatrixAt(i, moteTransform.matrix);
  }
  moteHalo.instanceMatrix.needsUpdate = true;
  moteCore.instanceMatrix.needsUpdate = true;
  if (benchmarkDuration) drawBenchmarkShades(tick);
  else syncEntities(game.shades, shades, shadeGroup, (mesh, shade) => {
    mesh.position.set(shade.pos[0], shade.pos[1] + Math.sin(tick / 14) * 0.1, shade.pos[2]);
    mesh.rotation.y = Math.atan2(game.player.pos[0] - shade.pos[0], game.player.pos[2] - shade.pos[2]);
    const tint = settings.clearPalette ? '#00b3ff' : color.edge;
    const key = tint + true;
    if (!materialCache.has(key)) materialCache.set(key, new THREE.MeshBasicMaterial({ color: tint }));
    const material = materialCache.get(key);
    mesh.children[0].material = material;
    for (const eye of mesh.children[3].children) eye.material = material;
    mesh.children[2].visible = shade.state === 'stunned';
    mesh.scale.setScalar(shade.state === 'spawning' ? 0.7 : 1);
  });
  syncEntities(game.drifters.filter(item => item.state !== 'removed'), drifters,
    () => orb(world, color.drifter, 0, 0, 0, 1),
    (mesh, drifter) => {
      mesh.position.set(drifter.pos[0], drifter.pos[1] + 0.35 * Math.sin(tick * 0.12), drifter.pos[2]);
      mesh.scale.set(1.15, 0.21, 0.51);
      mesh.rotation.y = Math.atan2(-drifter.heading[1], drifter.heading[0]);
      mesh.rotation.z = Math.sin(tick * 0.13) * 0.27;
    });
  for (const charm of game.charms) {
    const piece = charms.get(charm.id);
    piece.visible = charm.available;
    piece.position.set(charm.pos[0], charm.pos[1] + 0.8 + 0.16 * Math.sin(tick / 17), charm.pos[2]);
    piece.rotation.y = tick * 0.021;
  }
}

function updateHud(lit, tick) {
  const { player } = game;
  const seconds = timeLeft(game);
  const near = targetLantern(game, true);
  const capacity = capacityFor(game.successfulLights);
  const fuel = near?.lit ? Math.round(near.fuelTicks / hz) : null;
  const dash = tick < game.charmUntil ? 0 : Math.max(0, game.dashReady - tick);
  const pulse = Math.max(0, game.pulseReady - tick);
  const fuelStates = game.lanterns.map(lamp => ({
    id: lamp.id, lit: lamp.lit, weak: lamp.lit && !isSafeLantern(lamp), fuel: Math.ceil(lamp.fuelTicks / hz)
  }));
  const values = [player.flames, player.carried, lit, displayTime(seconds), game.score,
    Math.ceil(dash / 6), Math.ceil(pulse / 6), near?.id, near?.deposited, fuel, capacity, ...fuelStates.map(state => state.lit ? state.fuel + (state.weak ? '!' : '') : 'off')];
  if (lastHud !== values.join('/')) {
    lastHud = values.join('/');
    $('island').textContent = 'Đêm ' + game.night + ' · ' + game.map.name;
    $('flames').textContent = 'Lửa ' + player.flames + '/3';
    $('clock').textContent = (settings.clearPalette && seconds <= 30 ? '⚠ ' : '') + displayTime(seconds);
    $('clock').classList.toggle('danger', seconds <= 30);
    $('clock').classList.toggle('final-countdown', seconds <= 10);
    $('lanterns').textContent = 'Đèn ' + lit + '/' + game.lanterns.length + ' · Cần ' + requiredLights(game);
    $('score').textContent = 'Điểm ' + game.score;
    $('fuel-board').replaceChildren(...fuelStates.map(state => {
      const tile = document.createElement('div');
      tile.dataset.state = state.weak ? 'weak' : state.lit ? 'lit' : 'off';
      const label = document.createElement('span');
      label.textContent = state.id + ' · ' + (state.weak ? '⚠ ' : '') + (state.lit ? state.fuel : 'Tắt');
      const meter = document.createElement('meter');
      meter.max = tuning.fuel_max;
      meter.value = state.fuel;
      meter.setAttribute('aria-label', 'Dầu đèn ' + state.id);
      tile.append(label, meter);
      return tile;
    }));
    $('carry').textContent = player.carried + '/' + capacity;
    $('slots').setAttribute('aria-label', 'Đom đóm ' + player.carried + '/' + capacity);
    slots.forEach((slot, i) => {
      slot.hidden = i >= capacity;
      slot.classList.toggle('on', i < player.carried);
    });
    const timer = value => value ? (Math.ceil(value / 6) / 10).toFixed(1) + ' s' : '✓';
    $('cooldowns').innerHTML = '<span>⇥ Lướt <b>' + timer(dash) + '</b></span><span>✦ Tỏa sáng <b>' + timer(pulse) + '</b></span>';
    $('hint').textContent = !near ? '' : near.lit ? labelFor('interact') + ' — Châm dầu (' + fuel + '/100)'
      : labelFor('interact') + ' — ' + (near.ever_lit ? 'Thắp lại' : 'Nạp ánh sáng') + ' (' + near.deposited + '/' + lanternCost(near) + ')';
  }
  const target = targetLantern(game);
  const arrow = $('arrow');
  arrow.hidden = true;
  if (target) {
    const projected = new THREE.Vector3(target.pos[0], target.pos[1] + 3, target.pos[2]).project(camera);
    if (Math.abs(projected.x) > 0.91 || Math.abs(projected.y) > 0.85 || projected.z > 1 || projected.z < -1) {
      const angle = Math.atan2(target.pos[0] - player.pos[0], target.pos[2] - player.pos[2]) * 180 / Math.PI - yaw;
      $('arrow-icon').style.transform = 'rotate(' + angle + 'deg)';
      $('arrow-name').textContent = target.id;
      arrow.hidden = false;
    }
  }
  const cue = spawnCue && tick < spawnCue.until && game.shades.find(shade => shade.id === spawnCue.id);
  $('shade-cue').hidden = !cue;
  if (cue) {
    const angle = Math.atan2(cue.pos[0] - player.pos[0], cue.pos[2] - player.pos[2]) * 180 / Math.PI - yaw;
    const direction = (angle + 360) % 360;
    $('shade-cue').style.setProperty('--cue-x', (direction > 180 ? 13 : 87) + '%');
    $('shade-direction').style.transform = 'rotate(' + angle + 'deg)';
  }
  const warning = game.windEnabled && tick % 1800 >= 1680;
  $('wind').hidden = !warning && !game.wind.active;
  $('wind').textContent = warning ? 'Gió mạnh sắp đến' : 'Gió mạnh';
  leafBatch.visible = warning || game.wind.active;
  if (leafBatch.visible) {
    for (let i = 0; i < leafBatch.count; i++) {
      const wind = game.wind.dir_deg * Math.PI / 180;
      const offset = ((tick + 17 * i) % 300) / 14 - 10;
      leafTransform.position.set(player.pos[0] + offset * Math.cos(wind) + (i % 7 - 3) * 2,
        player.pos[1] + 0.9 + i % 5 * 0.36, player.pos[2] + offset * Math.sin(wind) + (i % 6 - 3) * 2);
      leafTransform.rotation.set(i + tick * 0.05, 0.4 * i, tick * 0.02);
      leafTransform.updateMatrix();
      leafBatch.setMatrixAt(i, leafTransform.matrix);
    }
    leafBatch.instanceMatrix.needsUpdate = true;
  }
}

function render(orbitSeconds = 0) {
  const { player, simTick: tick } = game;
  const lit = game.lanterns.filter(lamp => lamp.lit).length;
  ambient.intensity = 0.15 + 0.55 * lit / game.lanterns.length;
  for (const { material, base } of landscapeColors.values()) {
    material.color.copy(base).multiplyScalar(0.77 + ambient.intensity * 0.35);
  }
  if (tower) tower.visible = player.pos[1] >= 4.7 || Math.hypot(player.pos[0], player.pos[2]) > 8;
  may.position.set(...player.pos);
  may.rotation.y = Math.atan2(...player.facing);
  may.visible = !game.respawnAt && (settings.reducedMotion || tick >= game.invulnerableUntil || tick % 12 < 8);
  const walking = player.grounded && Math.hypot(player.vel[0], player.vel[2]) > 0;
  feet.forEach((foot, i) => { foot.rotation.x = walking ? Math.sin(tick * 0.29) * (i ? 0.45 : -0.45) : 0; });
  for (const lamp of game.lanterns) {
    const { housing, body, off, core, tears, gauge, rail, fill, halo } = lamps.get(lamp.id);
    const flashOn = settings.reducedMotion || isSafeLantern(lamp) || tick % hz < hz / 2;
    const fuel = lamp.fuelTicks / (hz * tuning.fuel_max);
    housing.scale.setScalar(lamp.lit ? 1 : 0.8);
    body.material = lamp.lit && flashOn ? materialCache.get('litLamp') : off;
    core.visible = lamp.lit && flashOn;
    tears.visible = !lamp.lit;
    gauge.visible = lamp.lit && flashOn;
    gauge.quaternion.copy(camera.quaternion);
    rail.visible = gauge.visible;
    fill.scale.x = fuel;
    fill.position.x = (fuel - 1) * 1.55 / 2;
    halo.visible = isSafeLantern(lamp);
  }
  nightEntities(tick);
  const pulseAge = tick - pulseTick;
  pulseRing.visible = !settings.reducedMotion && pulseAge < 22;
  pulseRing.position.set(player.pos[0], player.pos[1] + 0.11, player.pos[2]);
  pulseRing.scale.setScalar(Math.max(0.12, tuning.pulse_radius * pulseAge / 22));
  const angle = yaw * Math.PI / 180;
  const y = game.respawnAt ? 0 : player.pos[1];
  camera.position.set(player.pos[0] - Math.sin(angle) * 7.5, y + 5.6, player.pos[2] - Math.cos(angle) * 7.5);
  camera.lookAt(player.pos[0] + Math.sin(angle) * 2.6, y + 1, player.pos[2] + Math.cos(angle) * 2.6);
  if (benchmarkDuration) {
    const orbit = orbitSeconds * Math.PI * 2 / 15;
    camera.position.set(30 * Math.cos(orbit), 15, -30 * Math.sin(orbit));
    camera.lookAt(0, 0, 0);
  }
  camera.updateMatrixWorld();
  if (!benchmarkDuration) updateHud(lit, tick);
  renderer.render(scene, camera);
}

if (benchmarkDuration) {
  setupNight(1);
  renderer.setPixelRatio(1);
  renderer.setSize(1280, 720);
  let complete;
  globalThis.benchmarkResult = new Promise(resolve => { complete = resolve; });
  const frames = [];
  let firstFrame, lastFrame, simulated = 0;
  renderer.setAnimationLoop(now => {
    firstFrame ??= now;
    const elapsedMs = now - firstFrame;
    const target = Math.floor(elapsedMs * hz / 1000);
    while (simulated < target) {
      benchmarkTick(game);
      simulated++;
    }
    render(elapsedMs / 1000);
    if (lastFrame !== undefined && lastFrame >= firstFrame + 3000 && elapsedMs <= 3000 + benchmarkDuration * 1000) {
      frames.push(now - lastFrame);
    }
    lastFrame = now;
    if (elapsedMs >= 3000 + benchmarkDuration * 1000) {
      renderer.setAnimationLoop(null);
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      complete({ frames, firstFrameAt: performance.timeOrigin + firstFrame,
        renderer: 'Three.js r' + THREE.REVISION + ' / WebGL2 / ' + gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
        width: gl.drawingBufferWidth, height: gl.drawingBufferHeight });
    }
  });
} else {
  menu();
  let previous = performance.now();
  let elapsed = 0;
  renderer.setAnimationLoop(now => {
    elapsed += Math.min(250, now - previous);
    previous = now;
    while (elapsed >= 1000 / hz) {
      if (view === 'playing') runTick();
      else if (game.state === 'paused') step(game);
      elapsed -= 1000 / hz;
    }
    audio.update();
    render();
  });
}
