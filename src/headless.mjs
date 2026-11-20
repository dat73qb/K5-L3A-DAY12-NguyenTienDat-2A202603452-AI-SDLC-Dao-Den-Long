import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { maps } from './maps.mjs';
import { createGame, defaultInput, snapshot, step, tuning } from './game.mjs';

const int = value => Number.isSafeInteger(value);
const number = value => Number.isFinite(value);
const nonnegative = value => number(value) && value >= 0;
const count = value => int(value) && value >= 0;
const bool = value => typeof value === 'boolean';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const vec = (value, size, test) => Array.isArray(value) && value.length === size && value.every(test);
const pos = value => vec(value, 3, number);
const id = value => typeof value === 'string' && value.length > 0;
const bounded = max => value => count(value) && value <= max;

function requireFields(value, checks, path) {
  if (!object(value)) throw new Error(path + ' must be an object');
  for (const [key, check] of Object.entries(checks)) {
    if (Object.hasOwn(value, key) && !check(value[key])) throw new Error('Invalid ' + path + '.' + key);
  }
}

function inputs(value) {
  requireFields(value, { frames: Array.isArray }, 'inputs');
  if (!Array.isArray(value.frames)) throw new Error('inputs.frames is required');
  let previous = -1;
  for (const frame of value.frames) {
    requireFields(frame, {
      tick: count, move: value => vec(value, 2, n => number(n) && Math.abs(n) <= 1),
      cam_yaw_deg: number, jump: bool, interact: bool, pulse: bool, dash: bool, pause: bool
    }, 'frame');
    if (!count(frame.tick) || frame.tick <= previous) throw new Error('Frame ticks must increase strictly');
    previous = frame.tick;
  }
}

function uniqueEntities(list, kind, checks, required) {
  const ids = new Set();
  for (const entity of list ?? []) {
    requireFields(entity, { id, ...checks }, kind);
    if (!required(entity) || ids.has(entity.id)) throw new Error('Invalid ' + kind + ' or duplicate ID');
    if (entity.id !== undefined) ids.add(entity.id);
  }
}

function scenario(value, night) {
  requireFields(value, {
    player: object, random_motes: bool, random_shades: bool, random_drifters: bool, wind_enabled: bool,
    motes: list => Array.isArray(list) && list.every(pos), shades: Array.isArray, drifters: Array.isArray,
    lanterns: Array.isArray, charms: Array.isArray, time_left_s: nonnegative
  }, 'scenario');
  if (value.player) requireFields(value.player, {
    pos, carried: bounded(tuning.carry_capacity), flames: count,
    invuln_ticks: count, dash_cd_ticks: count, pulse_cd_ticks: count, charm_ticks: count
  }, 'player');
  uniqueEntities(value.shades, 'shade', {
    pos, state: value => ['spawning', 'wander', 'chase', 'recoil', 'stunned'].includes(value), state_ticks_left: count
  }, shade => pos(shade.pos));
  uniqueEntities(value.drifters, 'drifter', {
    pos, state: value => ['idle', 'chase', 'flee', 'removed'].includes(value),
    stolen: bounded(3), state_ticks_left: count
  }, drifter => pos(drifter.pos));
  const ids = maps[night].lanterns.map((_, index) => 'L' + (index + 1));
  uniqueEntities(value.lanterns, 'lantern', {
    pos, id: value => ids.includes(value), lit: bool, deposited: bounded(tuning.lantern_cost)
  }, lantern => Boolean(lantern.id));
  uniqueEntities(value.charms, 'charm', { pos, available: bool, respawn_ticks: count }, () => true);
}

class InputFileError extends Error {}

async function load(path, fallback, check) {
  if (path === undefined) return fallback;
  const raw = await readFile(path, 'utf8');
  try {
    const value = JSON.parse(raw);
    check(value);
    return value;
  } catch (error) {
    throw new InputFileError(path + ': ' + error.message);
  }
}

function integer(value, name, min = Number.MIN_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!/^-?\d+$/.test(value ?? '') || !int(parsed) || parsed < min) throw new Error('Invalid --' + name);
  return parsed;
}

async function main() {
  const names = ['seed', 'night', 'scenario', 'inputs', 'ticks', 'out', 'snapshot-every'];
  const args = process.argv.slice(2);
  const seedIndex = args.indexOf('--seed');
  if (seedIndex >= 0 && /^-\d+$/.test(args[seedIndex + 1] ?? '')) {
    args.splice(seedIndex, 2, '--seed=' + args[seedIndex + 1]);
  }
  const { values } = parseArgs({ args, options: Object.fromEntries(names.map(name => [name, { type: 'string' }])) });
  const seed = integer(values.seed, 'seed');
  const night = integer(values.night, 'night', 1);
  if (!maps[night]) throw new Error('--night must be 1, 2 or 3');
  const ticks = integer(values.ticks, 'ticks', 0);
  const every = integer(values['snapshot-every'] ?? '10', 'snapshot-every', 1);
  if (!values.out) throw new Error('Missing --out');
  const game = createGame(seed, await load(values.scenario, {}, value => scenario(value, night)), night);
  const { frames } = await load(values.inputs, { frames: [] }, inputs);
  const output = createWriteStream(values.out);
  const completion = finished(output);
  completion.catch(() => {});
  const write = record => output.write(JSON.stringify(record) + '\n');
  try {
    await once(output, 'open');
    const input = { ...defaultInput };
    let nextFrame = 0;
    let ready = write(snapshot(game));
    if (ticks > 0) ready = write({ type: 'event', tick: 0, name: 'night_start', data: { night } }) && ready;
    while (game.tick < ticks && (game.state === 'playing' || game.state === 'paused')) {
      if (!ready) await once(output, 'drain');
      ready = true;
      if (frames[nextFrame]?.tick === game.tick) Object.assign(input, frames[nextFrame++]);
      step(game, input, event => { ready = write(event) && ready; });
      if (game.tick % every === 0) ready = write(snapshot(game)) && ready;
    }
    write({ type: 'end', ticks: game.tick, state: game.state, score: game.score });
    output.end();
    await completion;
  } finally {
    output.destroy();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = error instanceof InputFileError ? 2 : 1;
});
