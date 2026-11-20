import * as THREE from 'three';
import { createGame, hz, islandRadius, step, timeLeft, tuning } from './game.mjs';

const scene = new THREE.Scene();
scene.background = new THREE.Color('#211b3c');
scene.fog = new THREE.FogExp2('#302548', 0.022);
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 180);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.append(renderer.domElement);
const ambient = new THREE.HemisphereLight('#aeb9ff', '#746052', 1.9);
scene.add(ambient);
const moonlight = new THREE.DirectionalLight('#b7c6ff', 1.8);
moonlight.position.set(-12, 20, -16);
scene.add(moonlight);
const world = new THREE.Group();
scene.add(world);
let entities = new THREE.Group();
scene.add(entities);

function mesh(parent, geometry, color, x, y, z, glow = false) {
  const material = glow ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true });
  const piece = new THREE.Mesh(geometry, material);
  piece.position.set(x, y, z);
  parent.add(piece);
  return piece;
}
const ball = new THREE.IcosahedronGeometry(1, 0);
function orb(parent, color, x, y, z, size, glow = false) {
  const piece = mesh(parent, ball, color, x, y, z, glow);
  piece.scale.setScalar(size);
  return piece;
}

mesh(world, new THREE.CylinderGeometry(islandRadius, 25, 4, 48), '#386b61', 0, -2, 0);
mesh(world, new THREE.CylinderGeometry(25, 6, 10, 12), '#39334e', 0, -9, 0);
for (let i = 0; i < 52; i++) {
  const a = i * 2.399963;
  const r = 18 + i % 17;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  if (i % 4 === 0 && r > 23) {
    mesh(world, new THREE.CylinderGeometry(0.14, 0.29, 2, 6), '#513e4a', x, 1, z);
    mesh(world, new THREE.ConeGeometry(1.28, 3.4, 7), '#305c62', x, 2.5, z);
    mesh(world, new THREE.ConeGeometry(0.9, 2.6, 7), '#437a72', x, 3.8, z);
  } else {
    const stone = orb(world, i % 2 ? '#506078' : '#6f7880', x, 0.07, z, 0.35 + (i % 3) * 0.17);
    stone.scale.y *= 0.6;
  }
}
for (let i = 0; i < 40; i++) {
  const a = i * 2.399963;
  const r = 43 + i % 18;
  const cloud = orb(world, i % 2 ? '#5a537e' : '#4e496e', r * Math.cos(a), -4 - i % 6, r * Math.sin(a), 1);
  cloud.scale.set(4 + i % 6, 0.8 + (i % 3) * 0.4, 3.5);
}
for (let i = 0; i < 100; i++) {
  const a = i * 2.399963;
  orb(world, '#cfbdde', 76 * Math.cos(a), 6 + i % 37, 76 * Math.sin(a), 0.06 + (i % 5) * 0.027, true);
}

const may = new THREE.Group();
world.add(may);
mesh(may, new THREE.CylinderGeometry(0.23, 0.42, 0.76, 8), '#d56d52', 0, 0.62, 0);
orb(may, '#ffd2aa', 0, 1.17, 0, 0.27);
mesh(may, new THREE.ConeGeometry(0.62, 0.34, 14), '#efc884', 0, 1.48, 0);
mesh(may, new THREE.CylinderGeometry(0.018, 0.018, 0.28, 5), '#744538', 0.49, 1.22, 0);
orb(may, '#ffb655', 0.49, 1.00, 0, 0.14, true);
const feet = [-0.16, 0.16].map(x => mesh(may, new THREE.BoxGeometry(0.21, 0.28, 0.34), '#553a55', x, 0.18, 0));
const pulseRing = mesh(world, new THREE.RingGeometry(0.92, 1, 48), '#ffdf8a', 0, 0.12, 0, true);
pulseRing.rotation.x = -Math.PI / 2;
pulseRing.material.side = THREE.DoubleSide;
const haloGeometry = new THREE.RingGeometry(tuning.safe_radius - 0.07, tuning.safe_radius, 48);

const keys = new Set();
const held = new Set();
let game;
let yaw, pulseTick, lastHint, lastHud;
const lamps = new Map();
const shades = new Map();
const motes = new Map();
const hud = document.querySelector('#hud');
const hint = document.querySelector('#hint');
const dialog = document.querySelector('#result');
const fmtTime = seconds => {
  const value = Math.max(0, Math.ceil(seconds));
  return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
};
const seed = Number(new URLSearchParams(location.search).get('seed') ?? 12);

function reset() {
  game = createGame(Number.isSafeInteger(seed) ? seed : 12);
  yaw = 0;
  pulseTick = -100;
  lastHint = lastHud = '';
  may.rotation.y = 0;
  keys.clear();
  held.clear();
  for (const cache of [lamps, shades, motes]) cache.clear();
  scene.remove(entities);
  const geometries = new Set();
  entities.traverse(object => {
    if (object.isMesh) {
      object.material.dispose();
      if (object.geometry !== ball && object.geometry !== haloGeometry) geometries.add(object.geometry);
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  entities = new THREE.Group();
  scene.add(entities);
  for (const lantern of game.lanterns) {
    const group = new THREE.Group();
    group.position.set(...lantern.pos);
    entities.add(group);
    mesh(group, new THREE.CylinderGeometry(0.16, 0.28, 2.4, 8), '#5c4150', 0, 1.2, 0);
    const housing = mesh(group, new THREE.CylinderGeometry(0.57, 0.73, 1.12, 8), '#8c504d', 0, 2.79, 0);
    mesh(group, new THREE.ConeGeometry(0.91, 0.61, 8), '#ad6261', 0, 3.59, 0);
    const halo = mesh(group, haloGeometry, '#e9b46a', 0, 0.035, 0, true);
    halo.rotation.x = -Math.PI / 2;
    halo.material.side = THREE.DoubleSide;
    const spill = new THREE.PointLight('#ffaf56', 26, 14, 2);
    spill.position.set(0, 2.65, 0);
    group.add(spill);
    lamps.set(lantern.id, { housing, halo, spill });
  }
}
reset();

const controls = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyQ', 'KeyE']);
window.addEventListener('keydown', event => {
  if (!controls.has(event.code) || dialog.open) return;
  event.preventDefault();
  keys.add(event.code);
  if (!event.repeat) held.add(event.code);
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { keys.clear(); held.clear(); });
const mouseSensitivity = 0.25;
const maxMouseDelta = 40; // giới hạn bước xoay tối đa mỗi khung hình
let mouseLocked = false;
window.addEventListener('mousedown', () => {
  if (!mouseLocked && !dialog.open) document.body.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  mouseLocked = !!document.pointerLockElement;
});
window.addEventListener('mousemove', event => {
  if (mouseLocked) {
    const delta = Math.max(-maxMouseDelta, Math.min(maxMouseDelta, event.movementX));
    yaw -= delta * mouseSensitivity;
  }
});
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
dialog.addEventListener('cancel', event => event.preventDefault());
document.querySelector('#restart').addEventListener('click', () => {
  reset();
  dialog.close();
});

function runTick() {
  const down = key => Number(keys.has(key));
  yaw += (down('ArrowRight') - down('ArrowLeft')) * 2;
  const move = [down('KeyA') - down('KeyD'), down('KeyW') - down('KeyS')];
  const input = { move, cam_yaw_deg: yaw,
    jump: keys.has('Space') || held.has('Space'), interact: keys.has('KeyE') || held.has('KeyE'),
    pulse: keys.has('KeyQ') || held.has('KeyQ') };
  held.clear();
  if (move.some(Boolean)) may.rotation.y = Math.atan2(move[0], move[1]) + yaw * Math.PI / 180;
  step(game, input, event => {
    if (event.name === 'pulse') pulseTick = event.tick;
    if (event.name !== 'game_over') return;
    const reasons = { all_lit: 'Tất cả đèn đã sáng.', dawn: 'Bình minh đến trước khi hết đèn.', no_flames: 'Hết lửa.' };
    document.querySelector('#outcome').textContent = game.state === 'won' ? 'Đào Đèn đã sáng' : 'Đêm 1 kết thúc';
    document.querySelector('#summary').textContent = reasons[event.data.reason] + ' Điểm: ' + game.score;
    dialog.showModal();
  });
}

function draw() {
  const { player, tick } = game;
  const lit = game.lanterns.filter(lamp => lamp.lit).length;
  ambient.intensity = 1.35 + lit * 0.26;
  may.position.set(...player.pos);
  may.visible = tick >= game.invulnerableUntil || tick % 12 < 8;
  const moving = keys.has('KeyW') || keys.has('KeyA') || keys.has('KeyS') || keys.has('KeyD');
  feet.forEach((foot, index) => { foot.rotation.x = moving ? Math.sin(tick * 0.29) * (index ? 0.42 : -0.42) : 0; });
  for (const lantern of game.lanterns) {
    const { housing, halo, spill } = lamps.get(lantern.id);
    housing.material.emissive.set(lantern.lit ? '#ff942f' : '#000000');
    halo.visible = spill.visible = lantern.lit;
  }
  for (const shade of game.shades) {
    if (!shades.has(shade.id)) {
      const body = orb(entities, '#48305d', 0, 0, 0, 0.83);
      shades.set(shade.id, body);
    }
    const body = shades.get(shade.id);
    body.position.set(shade.pos[0], shade.pos[1] + 0.16 * Math.sin(tick * 0.07), shade.pos[2]);
    body.rotation.y = tick * 0.028;
    body.material.color.set(tick < shade.stunnedUntil ? '#a475bc' : '#432655');
  }
  const active = new Set();
  for (const mote of game.motes) {
    active.add(mote.id);
    if (!motes.has(mote.id)) motes.set(mote.id, orb(entities, '#ffcc67', 0, 0, 0, 0.21, true));
    const light = motes.get(mote.id);
    light.position.set(mote.pos[0], mote.pos[1] + 0.65 + Math.sin(tick * 0.065 + mote.pos[0]) * 0.19, mote.pos[2]);
  }
  for (const [id, mote] of motes) {
    if (active.has(id)) continue;
    entities.remove(mote);
    mote.material.dispose();
    motes.delete(id);
  }
  const pulseAge = tick - pulseTick;
  pulseRing.visible = pulseAge < 22;
  pulseRing.position.set(player.pos[0], 0.12, player.pos[2]);
  pulseRing.scale.setScalar(Math.max(0.1, tuning.pulse_radius * pulseAge / 22));
  const angle = yaw * Math.PI / 180;
  camera.position.set(player.pos[0] - Math.sin(angle) * 7.5, player.pos[1] + 5.7, player.pos[2] - Math.cos(angle) * 7.5);
  camera.lookAt(player.pos[0] + Math.sin(angle) * 2.6, player.pos[1] + 1.1, player.pos[2] + Math.cos(angle) * 2.6);
  const values = ['Lửa ' + player.flames, 'Ánh sáng ' + player.carried + '/' + tuning.carry_capacity,
    'Đèn ' + lit + '/' + tuning.lantern_count_night1, fmtTime(timeLeft(game)), 'Điểm ' + game.score];
  if (values.join('|') !== lastHud) {
    lastHud = values.join('|');
    hud.replaceChildren(...values.map(value => Object.assign(document.createElement('span'), { textContent: value })));
  }
  const lamp = game.lanterns.find(lantern => !lantern.lit &&
    Math.hypot(lantern.pos[0] - player.pos[0], lantern.pos[2] - player.pos[2]) <= tuning.interact_radius);
  const message = lamp ? 'E · Nạp ' + lamp.id + ' (' + lamp.deposited + '/' + tuning.lantern_cost + ')' : '';
  if (message !== lastHint) hint.textContent = lastHint = message;
  renderer.render(scene, camera);
}

let previous = performance.now();
let elapsed = 0;
renderer.setAnimationLoop(now => {
  elapsed += Math.min(250, now - previous);
  previous = now;
  while (elapsed >= 1000 / hz) {
    if (game.state === 'playing') runTick();
    elapsed -= 1000 / hz;
  }
  draw();
});
