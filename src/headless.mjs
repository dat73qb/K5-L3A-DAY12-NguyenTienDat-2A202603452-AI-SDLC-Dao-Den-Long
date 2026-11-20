import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { parseArgs } from 'node:util';
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
      cam_yaw_deg: number, jump: bool, interact: bool, pulse: bool, dash: bool
    }, 'frame');
    if (!count(frame.tick) || frame.tick <= previous) throw new Error('Frame ticks must increase strictly');
    previous = frame.tick;
  }
}

function scenario(value) {
  requireFields(value, {
    player: object, random_motes: bool, random_shades: bool,
    motes: list => Array.isArray(list) && list.every(pos), shades: Array.isArray,
    lanterns: Array.isArray, time_left_s: nonnegative
  }, 'scenario');
  if (value.player) requireFields(value.player, {
    pos, carried: bounded(tuning.carry_capacity), flames: count
  }, 'player');
  const shadeIds = new Set();
  for (const shade of value.shades ?? []) {
    requireFields(shade, { pos, id }, 'shade');
    if (!pos(shade.pos) || shadeIds.has(shade.id)) throw new Error('Invalid shade position or duplicate ID');
    if (shade.id !== undefined) shadeIds.add(shade.id);
  }
  const lanternIds = new Set();
  for (const lantern of value.lanterns ?? []) {
    requireFields(lantern, {
      pos, id: value => typeof value === 'string' && /^L[1-5]$/.test(value),
      lit: bool, deposited: bounded(tuning.lantern_cost)
    }, 'lantern');
    if (!lantern.id || lanternIds.has(lantern.id)) throw new Error('Missing or duplicate lantern ID');
    lanternIds.add(lantern.id);
  }
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
  if (integer(values.night, 'night') !== 1) throw new Error('Only --night 1 is available');
  const ticks = integer(values.ticks, 'ticks', 0);
  const every = integer(values['snapshot-every'] ?? '10', 'snapshot-every', 1);
  if (!values.out) throw new Error('Missing --out');
  const game = createGame(seed, await load(values.scenario, {}, scenario));
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
    while (game.tick < ticks && game.state === 'playing') {
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
