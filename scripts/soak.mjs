import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createGame, defaultInput, randomFrom, step } from '../src/game.mjs';

const { values } = parseArgs({ options: {
  seed: { type: 'string' }, nights: { type: 'string' }, out: { type: 'string' }
} });
const seed = Number(values.seed), nights = Number(values.nights);
if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(nights) || nights < 1 || !values.out) {
  throw new Error('Usage: --seed <integer> --nights <positive integer> --out <file>');
}

const results = [];
let crashes = 0;
let memStart;
const memory = () => {
  globalThis.gc?.();
  return process.memoryUsage.rss() / 1048576;
};
const start = performance.now();
for (let i = 0; i < nights; i++) {
  try {
    const night = i % 3 + 1;
    const game = createGame(seed + i, {}, night);
    memStart ??= memory();
    const rng = randomFrom(seed + i);
    const input = { ...defaultInput };
    while (game.state === 'playing') {
      if (game.tick % 30 === 0) {
        const angle = rng() * Math.PI * 2;
        input.move = [Math.cos(angle), Math.sin(angle)];
      }
      input.jump = rng() < 0.05;
      input.dash = rng() < 0.03;
      input.pulse = rng() < 0.02;
      input.interact = rng() < 0.1;
      step(game, { ...input });
    }
    results.push(game.state);
  } catch (error) {
    crashes++;
    results.push('crashed');
    console.error(error);
  }
}
const memEnd = memory();
await writeFile(values.out, JSON.stringify({ nights, crashes, results, mem_start_mb: memStart ?? memEnd,
  mem_end_mb: memEnd, duration_s: (performance.now() - start) / 1000 }, null, 2) + '\n');
if (crashes) process.exitCode = 1;
