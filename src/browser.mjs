import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { capacityFor, createGame, hz, isSafeLantern, lanternCost, requiredLights, step, targetLantern, timeLeft, tuning } from './game.mjs';
import { maps, ramps } from './maps.mjs';
import { gameAudio } from './audio.mjs';

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

let settings = { volume: 45, sensitivity: 45, clearPalette: false };
try {
  const stored = JSON.parse(localStorage.getItem('lantern-settings') ?? '{}');
  for (const key of ['volume', 'sensitivity']) if (Number.isFinite(stored[key])) settings[key] = stored[key];
  settings.clearPalette = stored.clearPalette === true;
} catch { /* Storage may be disabled. */ }
const saveSettings = () => {
  try { localStorage.setItem('lantern-settings', JSON.stringify(settings)); } catch { /* Optional persistence. */ }
};
const audio = gameAudio(() => settings.volume);

const keys = new Set();
const taps = new Set();
const screen = $('screen');
let game, yaw, pulseTick, lastHud, lastSecond, clearedScore = 0, view;
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
const seedArg = Number(new URLSearchParams(location.search).get('seed') ?? 12);
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
  yaw = 0;
  may.rotation.y = 0;
  pulseTick = -100;
  lastHud = '';
  lastSecond = Infinity;
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
  overlay('menu', 'Đảo Đèn Lồng', 'Cùng Mây mang ánh sáng trở về qua ba đêm.', [
    ['Bắt đầu', () => intro(1)], ['Cài đặt', () => openSettings(menu)]
  ]);
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
function applyPalette() {
  document.body.classList.toggle('clear-palette', settings.clearPalette);
  lastHud = '';
}
const paletteInput = $('clear-palette');
paletteInput.checked = settings.clearPalette;
paletteInput.addEventListener('change', () => {
  settings.clearPalette = paletteInput.checked;
  saveSettings();
  applyPalette();
});
applyPalette();

function result(event) {
  const won = game.state === 'won';
  const night = game.night;
  audio.play(game.state);
  if (won) clearedScore += game.score;
  if (won && night === 3) {
    overlay('result', 'Bình Minh', 'Ba hòn đảo đã sáng. Tổng điểm: ' + clearedScore + '.', [
      ['Về menu', menu]
    ], 'Đã hoàn thành ba đêm');
    return;
  }
  const reasons = { dawn_survived: 'Đủ đèn sáng khi bình minh đến.', dawn: 'Bình minh đến khi đảo chưa đủ đèn sáng.', no_flames: 'Mây đã hết Ngọn Lửa.' };
  overlay('result', won ? 'Đảo đã bừng sáng' : 'Đêm kết thúc',
    reasons[event.data.reason] + ' Điểm đêm này: ' + game.score + (won ? '. Tổng điểm: ' + clearedScore : '') + '.',
    [[won ? 'Đêm kế tiếp' : 'Chơi lại Đêm', () => intro(won ? night + 1 : night)], ['Về menu', menu]],
    'Đêm ' + night + ' · ' + game.map.name);
}
function onEvent(event) {
  if (event.name === 'pulse') pulseTick = game.simTick;
  if (event.name === 'game_over') result(event);
  else audio.play(event.name);
}

const controls = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight']);
const isPauseKey = code => code === 'Escape' || code === 'KeyP';
window.addEventListener('keydown', event => {
  if (isPauseKey(event.code) && (view === 'playing' || view === 'pause')) {
    event.preventDefault();
    if (!event.repeat) (view === 'playing' ? pause : play)();
    return;
  }
  if (!controls.has(event.code) || view !== 'playing') return;
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
  const down = key => Number(keys.has(key));
  const pressed = key => keys.has(key) || taps.has(key);
  yaw += (down('ArrowRight') - down('ArrowLeft')) * 2;
  step(game, { move: [down('KeyA') - down('KeyD'), down('KeyW') - down('KeyS')], cam_yaw_deg: yaw,
    jump: pressed('Space'), interact: pressed('KeyE'), pulse: pressed('KeyQ'),
    dash: pressed('ShiftLeft') || pressed('ShiftRight'), pause: false }, onEvent, name => audio.play(name));
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
const shadeGroup = () => {
  const group = new THREE.Group();
  orb(group, color.edge, 0, 0, 0, 0.83, true);
  orb(group, color.shade, 0, 0.055, 0.04, 0.78, true);
  const stunned = orb(group, color.stunned, 0, 0, 0.02, 0.85, true);
  stunned.visible = false;
  const eyes = new THREE.Group();
  for (const x of [-0.21, 0.21]) orb(eyes, color.edge, x, 0.13, 0.72, 0.105, true);
  group.add(eyes);
  world.add(group);
  return group;
};
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
  syncEntities(game.shades, shades, shadeGroup, (mesh, shade) => {
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
  const values = [player.flames, player.carried, lit, displayTime(seconds), game.score,
    Math.ceil(dash / 6), Math.ceil(pulse / 6), near?.id, near?.deposited, fuel, capacity];
  if (lastHud !== values.join('/')) {
    lastHud = values.join('/');
    $('island').textContent = 'Đêm ' + game.night + ' · ' + game.map.name;
    $('flames').textContent = 'Lửa ' + player.flames + '/3';
    $('clock').textContent = (settings.clearPalette && seconds <= 30 ? '⚠ ' : '') + displayTime(seconds);
    $('clock').classList.toggle('danger', seconds <= 30);
    $('lanterns').textContent = 'Đèn ' + lit + '/' + game.lanterns.length + ' · Cần ' + requiredLights(game);
    $('score').textContent = 'Điểm ' + game.score;
    $('carry').textContent = player.carried + '/' + capacity;
    $('slots').setAttribute('aria-label', 'Đom đóm ' + player.carried + '/' + capacity);
    slots.forEach((slot, i) => {
      slot.hidden = i >= capacity;
      slot.classList.toggle('on', i < player.carried);
    });
    const timer = value => value ? (Math.ceil(value / 6) / 10).toFixed(1) + ' s' : '✓';
    $('cooldowns').innerHTML = '<span>⇥ Lướt <b>' + timer(dash) + '</b></span><span>✦ Tỏa sáng <b>' + timer(pulse) + '</b></span>';
    $('hint').textContent = !near ? '' : near.lit ? 'E — Châm dầu (' + fuel + '/100)'
      : 'E — ' + (near.ever_lit ? 'Thắp lại' : 'Nạp ánh sáng') + ' (' + near.deposited + '/' + lanternCost(near) + ')';
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

function render() {
  const { player, simTick: tick } = game;
  const lit = game.lanterns.filter(lamp => lamp.lit).length;
  ambient.intensity = 0.15 + 0.55 * lit / game.lanterns.length;
  for (const { material, base } of landscapeColors.values()) {
    material.color.copy(base).multiplyScalar(0.77 + ambient.intensity * 0.35);
  }
  if (tower) tower.visible = player.pos[1] >= 4.7 || Math.hypot(player.pos[0], player.pos[2]) > 8;
  may.position.set(...player.pos);
  may.rotation.y = Math.atan2(...player.facing);
  may.visible = !game.respawnAt && (tick >= game.invulnerableUntil || tick % 12 < 8);
  const walking = player.grounded && Math.hypot(player.vel[0], player.vel[2]) > 0;
  feet.forEach((foot, i) => { foot.rotation.x = walking ? Math.sin(tick * 0.29) * (i ? 0.45 : -0.45) : 0; });
  for (const lamp of game.lanterns) {
    const { housing, body, off, core, tears, gauge, rail, fill, halo } = lamps.get(lamp.id);
    const flashOn = isSafeLantern(lamp) || tick % hz < hz / 2;
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
  pulseRing.visible = pulseAge < 22;
  pulseRing.position.set(player.pos[0], player.pos[1] + 0.11, player.pos[2]);
  pulseRing.scale.setScalar(Math.max(0.12, tuning.pulse_radius * pulseAge / 22));
  const angle = yaw * Math.PI / 180;
  const y = game.respawnAt ? 0 : player.pos[1];
  camera.position.set(player.pos[0] - Math.sin(angle) * 7.5, y + 5.6, player.pos[2] - Math.cos(angle) * 7.5);
  camera.lookAt(player.pos[0] + Math.sin(angle) * 2.6, y + 1, player.pos[2] + Math.cos(angle) * 2.6);
  camera.updateMatrixWorld();
  updateHud(lit, tick);
  renderer.render(scene, camera);
}

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
