import contract from '../game.contract.json' with { type: 'json' };

export const tuning = contract.tuning;
export const hz = 60;
export const islandRadius = 36;
export const defaultInput = { move: [0, 0], cam_yaw_deg: 0, jump: false, interact: false, pulse: false };
const t = tuning;
const angle = (i, count) => i * Math.PI * 2 / count;
const point = (r, a, y = 0) => [r * Math.cos(a), y, r * Math.sin(a)];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

function randomFrom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(1664525, value) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export function createGame(seed, scenario = {}) {
  const random = randomFrom(seed);
  const lanterns = Array.from({ length: t.lantern_count_night1 }, (_, i) => {
    const id = 'L' + (i + 1);
    const spec = scenario.lanterns?.find(lantern => lantern.id === id);
    const deposited = spec?.deposited ?? 0;
    return { id, pos: [...(spec?.pos ?? point(14, angle(i, t.lantern_count_night1)))],
      lit: spec?.lit ?? (deposited === t.lantern_cost), deposited };
  });
  const motePositions = scenario.motes ?? (scenario.random_motes === false ? [] : lanterns.flatMap((_, i) =>
    Array.from({ length: 8 }, (_, j) => point(4 + j * 2.1, angle(i, lanterns.length) + (random() - 0.5) * 0.35))));
  const shadeSpecs = scenario.shades ?? (scenario.random_shades === false ? [] :
    Array.from({ length: 3 }, (_, i) => ({ pos: point(23 + random() * 5, angle(i, 3) + 0.5, 0.8) })));
  const reserved = new Set(shadeSpecs.map(shade => shade.id).filter(Boolean));
  let nextShade = 1;
  const shades = shadeSpecs.map(spec => {
    while (reserved.has('S' + nextShade)) nextShade++;
    const id = spec.id ?? 'S' + nextShade++;
    return { id, pos: [...spec.pos], stunnedUntil: 0 };
  });
  return {
    tick: 0, state: 'playing', score: 0, duration: scenario.time_left_s ?? t.night1_duration_s,
    player: { carried: scenario.player?.carried ?? 0, flames: scenario.player?.flames ?? t.flames,
      pos: [...(scenario.player?.pos ?? [0, 0, 0])] },
    lanterns, shades, motes: motePositions.map((pos, i) => ({ id: 'M' + (i + 1), pos: [...pos] })),
    nextMote: motePositions.length + 1, verticalSpeed: 0, invulnerableUntil: 0, pulseReady: 0,
    previous: { jump: false, interact: false, pulse: false }
  };
}

export function timeLeft(game) {
  return game.duration - game.tick / hz;
}

function movePlayer(game, input, jump) {
  const pos = game.player.pos;
  const [x, z] = input.move;
  const length = Math.max(1, Math.hypot(x, z));
  const yaw = (input.cam_yaw_deg % 360) * Math.PI / 180;
  const scale = t.player_speed / (hz * length);
  const nextX = pos[0] + (x * Math.cos(yaw) + z * Math.sin(yaw)) * scale;
  const nextZ = pos[2] + (-x * Math.sin(yaw) + z * Math.cos(yaw)) * scale;
  if (Math.hypot(nextX, nextZ) <= islandRadius || Math.hypot(nextX, nextZ) < Math.hypot(pos[0], pos[2])) {
    pos[0] = nextX;
    pos[2] = nextZ;
  }
  if (jump && pos[1] <= 0) game.verticalSpeed = 11;
  if (pos[1] > 0 || game.verticalSpeed > 0) {
    game.verticalSpeed -= 18 / hz;
    pos[1] = Math.max(0, pos[1] + game.verticalSpeed / hz);
    if (pos[1] === 0) game.verticalSpeed = 0;
  }
}

function deposit(game, emit) {
  const { player } = game;
  const lantern = game.lanterns.filter(lamp => !lamp.lit && distance(lamp.pos, player.pos) <= t.interact_radius)
    .sort((a, b) => distance(a.pos, player.pos) - distance(b.pos, player.pos) || a.id.localeCompare(b.id))[0];
  if (!lantern || !player.carried) return;
  const amount = Math.min(player.carried, Math.max(0, t.lantern_cost - lantern.deposited));
  if (!amount) return;
  player.carried -= amount;
  lantern.deposited += amount;
  emit('deposit', { lantern_id: lantern.id, amount, deposited: lantern.deposited });
  if (lantern.deposited === t.lantern_cost) {
    lantern.lit = true;
    game.score += t.score.per_lantern;
    emit('lantern_lit', { lantern_id: lantern.id });
  }
}

function pulse(game, emit) {
  const { player, tick } = game;
  if (player.carried < t.pulse_cost || tick < game.pulseReady) return;
  player.carried -= t.pulse_cost;
  game.pulseReady = tick + t.pulse_cooldown_s * hz;
  const stunned_ids = [];
  for (const shade of game.shades) {
    const range = distance(player.pos, shade.pos);
    if (range > t.pulse_radius) continue;
    shade.stunnedUntil = tick + t.pulse_stun_s * hz;
    shade.pos[0] += (range ? (shade.pos[0] - player.pos[0]) / range : 1) * t.pulse_push_m;
    shade.pos[2] += (range ? (shade.pos[2] - player.pos[2]) / range : 0) * t.pulse_push_m;
    stunned_ids.push(shade.id);
    game.score += t.score.per_stun;
  }
  emit('pulse', { stunned_ids });
}

function updateShades(game, emit) {
  const { player, tick } = game;
  const safe = game.lanterns.filter(lantern => lantern.lit);
  for (const shade of game.shades) {
    if (tick < shade.stunnedUntil) continue;
    const range = distance(shade.pos, player.pos);
    const step = range ? Math.min(range, t.shade_speed / hz) / range : 0;
    const next = [shade.pos[0] + (player.pos[0] - shade.pos[0]) * step, shade.pos[1],
      shade.pos[2] + (player.pos[2] - shade.pos[2]) * step];
    for (const lantern of safe) {
      const radius = distance(next, lantern.pos);
      if (radius > t.safe_radius) continue;
      const boundary = t.safe_radius + 0.001;
      next[0] = lantern.pos[0] + (radius ? (next[0] - lantern.pos[0]) / radius : 1) * boundary;
      next[2] = lantern.pos[2] + (radius ? (next[2] - lantern.pos[2]) / radius : 0) * boundary;
    }
    if (safe.every(lantern => distance(next, lantern.pos) > t.safe_radius)) shade.pos = next;
    if (distance(player.pos, shade.pos) > t.shade_hit_radius || tick < game.invulnerableUntil ||
        safe.some(lantern => distance(player.pos, lantern.pos) <= t.safe_radius) ||
        player.pos[1] > 0) continue;
    player.flames = Math.max(0, player.flames - 1);
    const dropped = Math.floor(player.carried * t.hit_drop_ratio);
    player.carried -= dropped;
    game.invulnerableUntil = tick + t.invuln_s * hz;
    for (let i = 0; i < dropped; i++) {
      const offset = point(t.pickup_radius + 0.4, angle(i, dropped));
      game.motes.push({ id: 'M' + game.nextMote++, pos: [player.pos[0] + offset[0], 0, player.pos[2] + offset[2]] });
    }
    emit('player_hit', { by: 'shade', flames: player.flames, dropped });
    if (!player.flames) break;
  }
}

export function step(game, input = defaultInput, record = () => {}) {
  if (game.state !== 'playing') return;
  const tick = ++game.tick;
  const emit = (name, data) => record({ type: 'event', tick, name, data });
  const press = key => input[key] && !game.previous[key];
  const { player } = game;
  if (player.flames > 0) {
    movePlayer(game, input, press('jump'));
    game.motes = game.motes.filter(mote => {
      if (player.carried >= t.carry_capacity || distance(player.pos, mote.pos) > t.pickup_radius) return true;
      player.carried++;
      game.score += t.score.per_mote;
      emit('mote_picked', { carried: player.carried });
      return false;
    });
    if (press('interact')) deposit(game, emit);
    if (press('pulse')) pulse(game, emit);
    if (!game.lanterns.every(lantern => lantern.lit)) updateShades(game, emit);
  }
  game.previous = { jump: input.jump, interact: input.interact, pulse: input.pulse };
  const reason = game.lanterns.every(lantern => lantern.lit) ? 'all_lit'
    : player.flames === 0 ? 'no_flames' : timeLeft(game) <= 0 ? 'dawn' : null;
  if (!reason) return;
  game.state = reason === 'all_lit' ? 'won' : 'lost';
  if (game.state === 'won') {
    game.score += Math.floor(Math.max(0, timeLeft(game))) * t.score.per_second_left +
      player.flames * t.score.per_flame_left;
  }
  emit('game_over', { result: game.state, reason });
}

const roundPos = pos => pos.map(value => Number(value.toFixed(3)));
export function snapshot(game) {
  return {
    type: 'snapshot', tick: game.tick, sim_tick: game.tick, state: game.state,
    time_left_s: timeLeft(game), score: game.score,
    player: { ...game.player, pos: roundPos(game.player.pos) },
    lanterns: game.lanterns.map(lantern => ({ ...lantern, pos: roundPos(lantern.pos) })),
    shades: game.shades.map(shade => ({
      id: shade.id, pos: roundPos(shade.pos), state: game.tick < shade.stunnedUntil ? 'stunned' : 'chase'
    })),
    motes_active: game.motes.length,
    motes: game.motes.map(mote => ({ id: mote.id, pos: roundPos(mote.pos) }))
  };
}
