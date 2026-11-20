import contract from '../game.contract.json' with { type: 'json' };
import { groundAt, maps } from './maps.mjs';

export const tuning = contract.tuning;
export const hz = 60;
export const defaultInput = { move: [0, 0], cam_yaw_deg: 0, jump: false, interact: false, pulse: false, dash: false, pause: false };
const t = tuning;
const dt = 1 / hz;
const fullFuel = t.fuel_max * hz;
const safeFuel = t.low_fuel_threshold * hz;
const fuelPerMote = t.fuel_per_mote * hz;
const displayFuel = lamp => Math.round(lamp.fuelTicks / (hz / 10)) / 10;
export const isSafeLantern = lamp => lamp.lit && lamp.fuelTicks >= safeFuel;
export const lanternCost = lamp => lamp.ever_lit ? t.relight_cost : t.lantern_cost;
export const capacityFor = (successfulLights) => Math.min(t.capacity_max, t.carry_capacity + 2 * successfulLights);
export const requiredLights = game => Math.ceil(game.lanterns.length * t.win_ratio);
const ticksFor = seconds => Math.round(seconds * hz);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const distance3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const direction = (from, to, fallback = [1, 0]) => {
  const length = distance(from, to);
  return length ? [(to[0] - from[0]) / length, (to[2] - from[2]) / length] : fallback;
};
const add = (pos, dir, length) => [pos[0] + dir[0] * length, pos[1], pos[2] + dir[1] * length];
const rank = (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true });
const left = (until, tick) => Math.max(0, until - tick);

function randomFrom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(1664525, value) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}
const pick = (items, random) => items[Math.floor(random() * items.length)];

function addMote(game, pos, kind, slot = null) {
  game.motes.push({ id: 'M' + game.nextMote++, pos: [...pos], kind, slot,
    expires: kind === 'dropped' ? game.simTick + 480 : null });
}
function spawnMote(game) {
  if (game.motes.length >= 30) return;
  const taken = new Set(game.motes.map(mote => mote.slot));
  const open = game.map.motes.map((_, i) => i).filter(i => !taken.has(i));
  if (!open.length) return;
  const slot = pick(open, game.random);
  addMote(game, game.map.motes[slot], 'random', slot);
}

export function createGame(seed, scenario = {}, night = 1) {
  const map = maps[night];
  const pos = [...(scenario.player?.pos ?? [0, 0, 0])];
  const initial = scenario.player ?? {};
  const game = {
    tick: 0, simTick: 0, night, map, state: 'playing', score: 0, duration: scenario.time_left_s ?? t['night' + night + '_duration_s'],
    player: { pos, vel: [0, 0, 0], grounded: pos[1] === groundAt(night, pos[0], pos[2]) || (night === 3 && pos[1] === 0 && Math.hypot(pos[0], pos[2]) <= 8),
      carried: initial.carried ?? 0, flames: initial.flames ?? 3, facing: [0, 1] },
    successfulLights: initial.successful_lights ?? 0,
    lanterns: map.lanterns.map((position, index) => {
      const id = 'L' + (index + 1);
      const spec = scenario.lanterns?.find(lamp => lamp.id === id);
      const deposited = spec?.deposited ?? 0;
      const lit = spec?.lit ?? (deposited === (spec?.ever_lit ? t.relight_cost : t.lantern_cost));
      return { id, pos: [...(spec?.pos ?? position)], deposited, lit, ever_lit: lit || (spec?.ever_lit ?? false),
        relit_count: 0, fuelTicks: lit ? Math.round((spec?.fuel ?? t.fuel_max) * hz) : 0 };
    }),
    random: randomFrom(seed),
    randomMotes: scenario.random_motes ?? true,
    randomShades: scenario.random_shades ?? true,
    randomDrifters: scenario.random_drifters ?? true,
    windEnabled: night === 3 && (scenario.wind_enabled ?? true),
    wind: { active: false, dir_deg: 0 },
    motes: [], nextMote: 1, nextShade: 1, nextDrifter: 1,
    previous: defaultInput, dashUntil: 0, dashReady: initial.dash_cd_ticks ?? 0,
    pulseReady: initial.pulse_cd_ticks ?? 0, charmUntil: initial.charm_ticks ?? 0,
    invulnerableUntil: initial.invuln_ticks ?? 0, respawnAt: 0, launch: null, dashDirection: [0, 1]
  };
  game.shades = (scenario.shades ?? []).map(spec => ({
    id: spec.id, pos: [...spec.pos], state: spec.state ?? 'wander', targetId: spec.target_lantern_id, drainTicks: 0,
    until: spec.state_ticks_left ?? (spec.state === 'spawning' ? 1 : 0), motionUntil: 0, motion: [1, 0], escapeUntil: 0
  }));
  game.drifters = (scenario.drifters ?? []).map(spec => ({
    id: spec.id, pos: [...spec.pos], state: spec.state ?? 'idle', stolen: spec.stolen ?? 0,
    until: spec.state_ticks_left ?? (spec.state === 'flee' ? 240 : 0), heading: [1, 0]
  }));
  for (const entity of game.shades) entity.id ??= nextId(game, 'S', game.shades, 'nextShade');
  for (const entity of game.drifters) entity.id ??= nextId(game, 'D', game.drifters, 'nextDrifter');
  game.shades.sort(rank);
  for (const shade of game.shades) {
    if (shade.state === 'drain' && !shade.targetId) {
      shade.targetId = nearestLamp(shade.pos, game.lanterns.filter(lamp => lamp.lit && !isSafeLantern(lamp)))?.id;
    }
  }
  game.drifters.sort(rank);
  game.charms = (scenario.charms ?? map.charms.map((pos, i) => ({ id: 'C' + (i + 1), pos }))).map((spec, i) => {
    const id = spec.id ?? 'C' + (i + 1);
    const fallback = map.charms[Number(id.slice(1)) - 1];
    return { id, pos: [...(spec.pos ?? fallback ?? [0, 0, 0])], available: spec.available ?? !spec.respawn_ticks,
      respawnAt: spec.respawn_ticks ?? (spec.available === false ? 2700 : 0) };
  }).sort(rank);
  if (scenario.motes) {
    for (const position of scenario.motes) {
      const index = map.motes.findIndex(point => distance3(point, position) < 0.0001);
      addMote(game, position, 'random', index < 0 ? null : index);
    }
  } else if (game.randomMotes) {
    for (let i = 0; i < 20; i++) spawnMote(game);
  }
  return game;
}

function nextId(game, prefix, entities, counter) {
  while (entities.some(entity => entity.id === prefix + game[counter])) game[counter]++;
  return prefix + game[counter]++;
}

export function timeLeft(game) {
  return game.duration - game.simTick / hz;
}

function updateWind(game, emit) {
  if (!game.windEnabled) return;
  const interval = game.simTick % 1800;
  if (interval === 1680) {
    game.wind.dir_deg = Math.floor(game.random() * 360);
    emit('wind_warning', {});
  }
  game.wind.active = game.simTick >= 1800 && interval < 300;
}

function playerFloor(game, previous, position) {
  const floor = groundAt(game.night, position[0], position[2]);
  if (game.night === 3 && previous[1] < 5 && Math.hypot(previous[0], previous[2]) <= 8 && floor === 6) return 0;
  return floor;
}

function walkable(game, pos, next, maxRise = 0.16, player = false) {
  if (game.night === 3 && next[1] >= 6 && Math.hypot(next[0], next[2]) < 2) return false;
  const floor = player ? playerFloor(game, pos, next) : groundAt(game.night, next[0], next[2]);
  return floor <= pos[1] + maxRise;
}

function launchFromPad(game, emit) {
  const { player } = game;
  if (!player.grounded) return false;
  const pad = game.map.pads.find(item => distance(player.pos, item.pos) <= 1 && Math.abs(player.pos[1] - item.pos[1]) < 0.05);
  if (!pad) return false;
  const dir = direction(player.pos, pad.target);
  game.launch = dir.map(value => value * pad.speed);
  player.vel = [game.launch[0], pad.up, game.launch[1]];
  player.grounded = false;
  emit('jump_sound', {});
  return true;
}

function movePlayer(game, input, press, emit) {
  const { player: p, simTick: k } = game;
  if (game.respawnAt) {
    if (k < game.respawnAt) return;
    game.respawnAt = 0;
    p.pos = [0, 0, 0];
    p.vel = [0, 0, 0];
    p.facing = [0, 1];
    p.grounded = true;
    game.invulnerableUntil = k + ticksFor(t.invuln_s);
    return;
  }
  const [x, z] = input.move;
  const yaw = (input.cam_yaw_deg % 360) * Math.PI / 180;
  const length = Math.max(1, Math.hypot(x, z));
  const move = [(x * Math.cos(yaw) + z * Math.sin(yaw)) / length, (-x * Math.sin(yaw) + z * Math.cos(yaw)) / length];
  if (x || z) p.facing = direction([0, 0, 0], [move[0], 0, move[1]]);
  if (press('dash') && k >= game.dashUntil && (k >= game.dashReady || k < game.charmUntil)) {
    game.dashUntil = k + ticksFor(t.dash_duration_s);
    game.dashReady = k < game.charmUntil ? k : k + ticksFor(t.dash_cooldown_s);
    game.dashDirection = [...p.facing];
    emit('dash', {});
  }
  if (!launchFromPad(game, emit) && press('jump') && p.grounded) {
    p.vel[1] = 11;
    p.grounded = false;
    emit('jump_sound', {});
  }
  const dashing = k < game.dashUntil;
  const speed = k < game.charmUntil ? 7.2 : t.player_speed;
  const horizontal = dashing ? game.dashDirection.map(value => value * t.dash_speed)
    : game.launch ?? move.map(value => value * speed);
  const wind = game.wind.dir_deg * Math.PI / 180;
  const vx = horizontal[0] + (game.wind.active ? 2 * Math.cos(wind) : 0);
  const vz = horizontal[1] + (game.wind.active ? 2 * Math.sin(wind) : 0);
  const original = p.pos;
  const next = [original[0] + vx * dt, original[1], original[2] + vz * dt];
  if (!walkable(game, original, next, 0.16, true)) {
    next[0] = original[0];
    next[2] = original[2];
  }
  const floor = playerFloor(game, original, next);
  const prevFloor = playerFloor(game, original, original);
  if (p.grounded && floor >= prevFloor - 0.15 && floor <= prevFloor + 0.16) {
    next[1] = floor;
  } else if (dashing) {
    p.grounded = p.grounded && next[1] === floor;
  } else {
    const nextY = original[1] + p.vel[1] * dt - 10 * dt * dt;
    p.vel[1] -= 20 * dt;
    if (p.vel[1] <= 0 && nextY <= floor && original[1] >= floor - 0.001) {
      next[1] = floor;
      p.grounded = true;
      p.vel[1] = 0;
      game.launch = null;
    } else {
      next[1] = nextY;
      p.grounded = false;
    }
  }
  p.vel[0] = (next[0] - original[0]) * hz;
  p.vel[2] = (next[2] - original[2]) * hz;
  p.pos = next;
  if (p.pos[1] >= -10) {
    launchFromPad(game, emit);
    return;
  }
  const lost = p.carried;
  p.carried = 0;
  p.flames = Math.max(0, p.flames - 1);
  p.vel = [0, 0, 0];
  game.dashUntil = k;
  game.launch = null;
  if (p.flames) game.respawnAt = k + 60;
  emit('player_hit', { by: 'fall', flames: p.flames, dropped: 0, lost });
}

function pickup(game, emit) {
  const { player: p, simTick: k } = game;
  const near = pos => distance(p.pos, pos) <= t.pickup_radius && Math.abs(p.pos[1] - pos[1]) <= 1.5;
  game.motes = game.motes.filter(mote => {
    if (p.carried >= capacityFor(game.successfulLights) || !near(mote.pos)) return true;
    if (mote.kind === 'dropped' && mote.expires === k + 480) return true;
    p.carried++;
    emit('mote_picked', { carried: p.carried });
    return false;
  });
  for (const charm of game.charms) {
    if (!charm.available || !near(charm.pos)) continue;
    charm.available = false;
    charm.respawnAt = k + 2700;
    game.charmUntil = k + 600;
    emit('charm_picked', { charm_id: charm.id, charm_ticks: 600 });
  }
}

function nearestLamp(pos, lamps, metric = distance) {
  let nearest;
  let best = Infinity;
  for (const lamp of lamps) {
    const range = metric(pos, lamp.pos);
    if (!nearest || range < best || (range === best && rank(lamp, nearest) < 0)) {
      nearest = lamp;
      best = range;
    }
  }
  return nearest;
}

export function targetLantern(game, inRange = false) {
  const pos = game.player.pos;
  const lamps = inRange ? game.lanterns.filter(lamp => (!lamp.lit || lamp.fuelTicks < fullFuel) &&
    distance(lamp.pos, pos) <= t.interact_radius && (game.night !== 3 || Math.abs(lamp.pos[1] - pos[1]) <= 1.5))
    : game.lanterns.filter(lamp => !lamp.lit);
  return nearestLamp(pos, lamps, inRange ? distance : distance3);
}

function deposit(game, emit) {
  const lantern = targetLantern(game, true);
  if (!lantern) return;
  const carried = game.player.carried;
  if (lantern.lit) {
    const used = Math.min(carried, Math.ceil((fullFuel - lantern.fuelTicks) / fuelPerMote));
    if (used === 0) return;
    game.player.carried -= used;
    lantern.fuelTicks = Math.min(fullFuel, lantern.fuelTicks + used * fuelPerMote);
    game.score += used * t.score.per_mote;
    emit('refuel', { lantern_id: lantern.id, amount: used, fuel: displayFuel(lantern) });
    return;
  }
  const cost = lanternCost(lantern);
  const amount = Math.min(carried, cost - lantern.deposited);
  if (amount <= 0) return;
  game.player.carried -= amount;
  lantern.deposited += amount;
  game.score += amount * t.score.per_mote;
  emit('deposit', { lantern_id: lantern.id, amount, deposited: lantern.deposited });
  if (lantern.deposited !== cost) return;
  const relight = lantern.ever_lit;
  lantern.lit = lantern.ever_lit = true;
  lantern.fuelTicks = fullFuel;
  if (relight) lantern.relit_count++;
  game.successfulLights++;
  game.score += relight ? t.score.per_relight : t.score.per_lantern;
  emit('lantern_lit', { lantern_id: lantern.id, relight });
}

function drainTarget(game, shade) {
  const lamp = game.lanterns.find(item => item.id === shade.targetId);
  return lamp?.lit && !isSafeLantern(lamp) && distance(shade.pos, lamp.pos) <= t.interact_radius ? lamp : undefined;
}

function stopDrain(shade, state) {
  shade.state = state;
  shade.targetId = undefined;
  shade.until = 0;
  shade.drainTicks = 0;
}

function consumeFuel(game, emit) {
  const reports = [];
  for (const shade of game.shades) {
    if (shade.state !== 'drain') continue;
    const lamp = drainTarget(game, shade);
    if (!lamp) {
      stopDrain(shade, 'wander');
      continue;
    }
    if (++shade.drainTicks % hz === 0) reports.push({ shade, lamp });
  }
  // Compute targets before any subtraction so overlapping drains all count on the same tick.
  for (const lamp of game.lanterns) {
    if (!lamp.lit) continue;
    const drains = game.shades.filter(shade => shade.state === 'drain' && shade.targetId === lamp.id).length;
    lamp.fuelTicks = Math.max(0, lamp.fuelTicks - t.fuel_decay_per_s - drains * t.drain_per_s);
  }
  for (const { shade, lamp } of reports) {
    emit('fuel_drain', { lantern_id: lamp.id, shade_id: shade.id, fuel: displayFuel(lamp) });
  }
  for (const lamp of game.lanterns) {
    if (!lamp.lit || lamp.fuelTicks > 0) continue;
    lamp.lit = false;
    lamp.deposited = 0;
    emit('lantern_out', { lantern_id: lamp.id });
  }
  for (const shade of game.shades) {
    if (shade.state === 'drain' && !drainTarget(game, shade)) stopDrain(shade, 'wander');
  }
}

const fleeing = (drifter, player, until) => {
  drifter.state = 'flee';
  drifter.until = until;
  drifter.heading = direction(player.pos, drifter.pos);
};

function pulse(game, emit) {
  const { player, simTick: k } = game;
  if (player.carried < t.pulse_cost || k < game.pulseReady) return;
  player.carried -= t.pulse_cost;
  game.pulseReady = k + ticksFor(t.pulse_cooldown_s);
  const center = [player.pos[0], player.pos[1] + 0.8, player.pos[2]];
  const stunned_ids = [];
  for (const shade of game.shades) {
    if (shade.state === 'spawning' || distance3(center, shade.pos) > t.pulse_radius) continue;
    game.score += shade.state === 'drain' ? t.score.per_drain_stun : t.score.per_stun;
    stopDrain(shade, 'stunned');
    shade.until = k + ticksFor(t.pulse_stun_s);
    shade.motionUntil = k + 15;
    shade.motion = direction(player.pos, shade.pos);
    stunned_ids.push(shade.id);
  }
  emit('pulse', { stunned_ids });
  for (const drifter of game.drifters) {
    if (distance3(center, drifter.pos) > t.pulse_radius) continue;
    if (drifter.state === 'chase') fleeing(drifter, player, k + 240);
    else if (drifter.state === 'flee' && drifter.stolen) {
      const amount = drifter.stolen;
      for (let i = 0; i < amount; i++) addMote(game, drifter.pos, 'dropped');
      drifter.stolen = 0;
      fleeing(drifter, player, k + 120);
      emit('drifter_drop', { drifter_id: drifter.id, amount });
    }
  }
}

function shadeMove(game, shade, dir, length, safe) {
  const next = add(shade.pos, dir, length);
  const floor = groundAt(game.night, next[0], next[2]);
  if (!Number.isFinite(floor) || !walkable(game, shade.pos, next)) return false;
  for (const lamp of safe) {
    if (distance(shade.pos, lamp.pos) < t.safe_radius || distance(next, lamp.pos) >= t.safe_radius) continue;
    const along = direction(shade.pos, next);
    const dx = shade.pos[0] - lamp.pos[0], dz = shade.pos[2] - lamp.pos[2];
    const dot = dx * along[0] + dz * along[1];
    const gap = dx * dx + dz * dz - t.safe_radius ** 2;
    const edge = Math.max(0, -dot - Math.sqrt(Math.max(0, dot * dot - gap)));
    shade.pos = add(shade.pos, along, edge);
    return false;
  }
  next[1] = shade.pos[1] + (floor - groundAt(game.night, shade.pos[0], shade.pos[2]));
  if (!Number.isFinite(next[1])) next[1] = floor + 0.8;
  shade.pos = next;
  return true;
}

function updateSafe(game, safe) {
  for (const shade of game.shades) {
    const lamp = safe.find(lamp => distance(shade.pos, lamp.pos) < t.safe_radius - 1e-8);
    if (!lamp) { shade.escapeUntil = 0; continue; }
    shade.escapeUntil ||= game.simTick + 29;
    const remaining = Math.max(1, shade.escapeUntil - game.simTick + 1);
    shade.pos = add(shade.pos, direction(lamp.pos, shade.pos), (t.safe_radius - distance(shade.pos, lamp.pos)) / remaining);
  }
}

function updateShades(game, safe) {
  const { player, simTick: k } = game;
  const weakLamps = game.lanterns.filter(lamp => lamp.lit && !isSafeLantern(lamp));
  const darkLamps = game.lanterns.filter(lamp => !lamp.lit);
  for (const shade of game.shades) {
    if (shade.escapeUntil || shade.wanderAt === k) continue;
    if (shade.state === 'stunned' || shade.state === 'recoil') {
      if (k < shade.motionUntil) {
        const amount = shade.state === 'stunned' ? t.pulse_push_m / 15 : 2 / 60;
        if (!shadeMove(game, shade, shade.motion, amount, safe)) shade.motionUntil = k;
      }
      continue;
    }
    if (shade.state === 'spawning') continue;
    const range = distance(shade.pos, player.pos);
    if (shade.state === 'drain') {
      if (range > 6) continue;
      stopDrain(shade, 'chase');
    }
    if (range <= 12) shade.state = 'chase';
    if (range > 18) shade.state = 'wander';
    const speed = (game.night === 3 ? 4.5 : t.shade_speed) * dt;
    if (shade.state === 'chase') {
      shadeMove(game, shade, direction(shade.pos, player.pos, [0, 0]), Math.min(range, speed), safe);
      continue;
    }
    const weak = nearestLamp(shade.pos, weakLamps);
    const target = weak ?? nearestLamp(shade.pos, darkLamps);
    if (target) {
      const gap = distance(shade.pos, target.pos);
      if (!weak || gap > t.interact_radius) {
        shadeMove(game, shade, direction(shade.pos, target.pos), Math.min(gap, speed), safe);
      }
      if (weak && distance(shade.pos, weak.pos) <= t.interact_radius) {
        shade.state = 'drain';
        shade.targetId = weak.id;
        shade.drainTicks = 0;
      }
    } else {
      const a = k / 180 + (Number.parseInt(shade.id.slice(1), 10) || 0);
      shadeMove(game, shade, [Math.cos(a), Math.sin(a)], speed, safe);
    }
  }
}

function updateDrifters(game) {
  const { player, simTick: k } = game;
  for (const drifter of game.drifters) {
    if (drifter.state === 'removed') continue;
    if (drifter.state !== 'flee') {
      drifter.state = player.carried >= 5 && distance(drifter.pos, player.pos) <= 15 ? 'chase' : 'idle';
      const a = k / 110;
      drifter.heading = drifter.state === 'chase' ? direction(drifter.pos, player.pos, [0, 0]) : [Math.cos(a), Math.sin(a)];
    }
    drifter.pos = add(drifter.pos, drifter.heading, (drifter.state === 'idle' ? 2 : 7) * dt);
  }
}

function contact(game, safe, emit) {
  const { player, simTick: k } = game;
  for (const drifter of game.drifters) {
    if (drifter.state !== 'chase' || distance(drifter.pos, player.pos) > 1.2 || !player.carried) continue;
    const amount = Math.min(3, player.carried);
    player.carried -= amount;
    drifter.stolen = amount;
    fleeing(drifter, player, k + 240);
    emit('drifter_steal', { drifter_id: drifter.id, amount, carried: player.carried });
  }
  if (k < game.invulnerableUntil || safe.some(lamp => distance(lamp.pos, player.pos) <= t.safe_radius) || player.pos[1] > 0) return;
  const shade = game.shades.find(shade => (shade.state === 'chase' || shade.state === 'wander') &&
    !shade.escapeUntil && distance(shade.pos, player.pos) <= t.shade_hit_radius && Math.abs(shade.pos[1] - player.pos[1]) <= 1.5);
  if (!shade) return;
  player.flames = Math.max(0, player.flames - 1);
  const dropped = Math.floor(player.carried * t.hit_drop_ratio);
  player.carried -= dropped;
  game.invulnerableUntil = k + ticksFor(t.invuln_s);
  shade.state = 'recoil';
  shade.until = k + 61;
  shade.motionUntil = k + 61;
  shade.motion = direction(player.pos, shade.pos);
  for (let i = 0; i < dropped; i++) {
    const a = game.random() * Math.PI * 2;
    const position = add(player.pos, [Math.cos(a), Math.sin(a)], 1.5 + game.random());
    const floor = groundAt(game.night, position[0], position[2]);
    position[1] = Number.isFinite(floor) ? floor : 0;
    addMote(game, position, 'dropped');
  }
  emit('player_hit', { by: 'shade', flames: player.flames, dropped });
}

function spawn(game, emit) {
  const k = game.simTick;
  if (game.randomMotes && k % 240 === 0) spawnMote(game);
  if (game.randomShades && k >= 300 && (k - 300) % game.map.shadeInterval === 0) {
    const occupied = game.map.fog.filter(pos => game.shades.some(shade => distance(pos, shade.pos) < 1));
    const free = game.map.fog.filter(pos => !occupied.includes(pos) && distance(pos, game.player.pos) >= 15);
    for (let i = 0; i < (k === 300 ? 2 : 1) && free.length && game.shades.length < game.map.shadeMax; i++) {
      const pos = pick(free, game.random);
      free.splice(free.indexOf(pos), 1);
      const id = nextId(game, 'S', game.shades, 'nextShade');
      game.shades.push({ id, pos: [pos[0], 0.8, pos[2]], state: 'spawning', until: k + 1, escapeUntil: 0 });
      emit('shade_spawned', { id });
    }
    game.shades.sort(rank);
  }
  if (game.night >= 2 && game.randomDrifters && k % 1200 === 0 && game.drifters.filter(drifter => drifter.state !== 'removed').length < 2) {
    const pos = pick(game.map.fog, game.random);
    const id = nextId(game, 'D', game.drifters, 'nextDrifter');
    game.drifters.push({ id, pos: [pos[0], 0.8, pos[2]], state: 'idle', stolen: 0, until: 0, heading: [1, 0] });
    game.drifters.sort(rank);
  }
}

export function step(game, input = defaultInput, record = () => {}, feedback = () => {}) {
  if (game.state === 'won' || game.state === 'lost') return;
  const tick = ++game.tick;
  const emit = (name, data) => record({ type: 'event', tick, name, data });
  const press = key => input[key] && !game.previous[key];
  const toggle = press('pause');
  if (toggle) {
    game.state = game.state === 'paused' ? 'playing' : 'paused';
    emit(game.state === 'paused' ? 'paused' : 'resumed', {});
  }
  if (game.state === 'paused') { game.previous = { ...input }; return; }

  const k = ++game.simTick;
  game.motes = game.motes.filter(mote => mote.expires === null || mote.expires > k);
  for (const charm of game.charms) if (!charm.available && k >= charm.respawnAt) charm.available = true;
  for (const shade of game.shades) {
    if (!shade.until || shade.until > k || shade.state === 'drain') continue;
    if (shade.state === 'stunned') shade.wanderAt = k;
    shade.state = 'wander';
    shade.until = 0;
  }
  game.drifters = game.drifters.filter(drifter => drifter.state !== 'removed');
  for (const drifter of game.drifters) if (drifter.state === 'flee' && drifter.until <= k) drifter.state = 'removed';
  consumeFuel(game, emit);
  if (game.player.flames > 0) {
    updateWind(game, feedback);
    movePlayer(game, input, press, (name, data) => name === 'jump_sound' ? feedback(name, data) : emit(name, data));
    if (!game.respawnAt && game.player.flames) {
      pickup(game, emit);
      if (press('interact')) deposit(game, emit);
    }
    for (const shade of game.shades) {
      if (shade.state === 'drain' && !drainTarget(game, shade)) stopDrain(shade, 'wander');
    }
    const safe = game.lanterns.filter(isSafeLantern);
    updateSafe(game, safe);
    if (!game.respawnAt && game.player.flames && press('pulse')) pulse(game, emit);
    updateShades(game, safe);
    updateDrifters(game);
    if (!game.respawnAt && game.player.flames) contact(game, safe, emit);
    spawn(game, emit);
  }
  game.previous = { ...input };
  const lit = game.lanterns.filter(lamp => lamp.lit);
  const reason = game.player.flames === 0 ? 'no_flames'
    : timeLeft(game) > 0 ? null : lit.length >= requiredLights(game) ? 'dawn_survived' : 'dawn';
  if (!reason) return;
  game.state = reason === 'dawn_survived' ? 'won' : 'lost';
  if (game.state === 'won') {
    game.score += lit.reduce((sum, lamp) => sum + t.score.per_lantern_at_dawn + Math.floor(lamp.fuelTicks / hz), 0)
      + game.player.flames * t.score.per_flame_left;
  }
  emit('game_over', { result: game.state, reason });
}

const roundPos = pos => pos.map(value => Number(value.toFixed(3)));
export function snapshot(game) {
  const k = game.simTick;
  const { player } = game;
  return {
    type: 'snapshot', tick: game.tick, sim_tick: k, night: game.night, state: game.state,
    time_left_s: timeLeft(game), score: game.score, wind: { ...game.wind },
    player: {
      pos: roundPos(player.pos), vel: roundPos(player.vel), flames: player.flames, carried: player.carried, capacity: capacityFor(game.successfulLights),
      grounded: player.grounded, invuln: k < game.invulnerableUntil,
      dash_cd_s: k < game.charmUntil ? 0 : left(game.dashReady, k) / hz,
      pulse_cd_s: left(game.pulseReady, k) / hz, charm_s: left(game.charmUntil, k) / hz
    },
    lanterns: game.lanterns.map(lamp => ({
      id: lamp.id, pos: roundPos(lamp.pos), lit: lamp.lit, deposited: lamp.deposited,
      fuel: displayFuel(lamp), ever_lit: lamp.ever_lit, relit_count: lamp.relit_count
    })),
    shades: game.shades.map(shade => ({ id: shade.id, pos: roundPos(shade.pos), state: shade.state })),
    motes_active: game.motes.length,
    motes: game.motes.map(mote => ({ id: mote.id, pos: roundPos(mote.pos), kind: mote.kind,
      ttl_s: mote.expires === null ? null : left(mote.expires, k) / hz })),
    drifters: game.drifters.map(drifter => ({ id: drifter.id, pos: roundPos(drifter.pos), state: drifter.state, stolen: drifter.stolen })),
    charms: game.charms.map(charm => ({ id: charm.id, available: charm.available,
      respawn_s: charm.available ? 0 : left(charm.respawnAt, k) / hz }))
  };
}
