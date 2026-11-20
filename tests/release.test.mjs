import assert from 'node:assert/strict';
import { test } from 'node:test';
import { benchmarkGame, benchmarkTick, snapshot } from '../src/game.mjs';
import { defaultBindings, loadBindings } from '../src/bindings.mjs';
import { topEntries, validEntry } from '../src/leaderboard.mjs';

test('benchmark has the standard population, fixed player, full fuel and no gameplay side effects', () => {
  const game = benchmarkGame(42);
  const before = snapshot(game);
  assert.deepEqual(before, snapshot(benchmarkGame(42)));
  assert.equal(before.motes.length, 100);
  assert.equal(before.shades.length, 200);
  assert.deepEqual(before.lanterns.filter(lamp => lamp.lit).map(({ id, fuel }) => [id, fuel]),
    [['L1', 100], ['L2', 100], ['L3', 100]]);
  for (let i = 0; i < 240; i++) benchmarkTick(game);
  const after = snapshot(game);
  assert.deepEqual(after.player, before.player);
  assert.deepEqual(after.lanterns, before.lanterns);
  assert.deepEqual(after.motes, before.motes);
  assert.ok(after.shades.every(shade => shade.state === 'wander'));
  assert.notDeepEqual(after.shades, before.shades);
});

test('leaderboard validates entries, keeps top 10 and breaks ties by achievement instant', () => {
  const entry = (name, score, achieved_at) => ({ name, score, achieved_at, seed: 12, nights_won: 2 });
  const first = entry('Mai_1', 900, '2026-11-20T15:00:00+07:00');
  const second = entry('May', 900, '2026-11-20T08:00:01Z');
  const invalid = entry('<x>', 1000, '2026-11-20T08:00:01Z');
  assert.equal(validEntry(invalid), false);
  assert.deepEqual(topEntries([second, invalid, first]), [first, second]);
  assert.equal(topEntries(Array.from({ length: 15 }, (_, score) => ({ ...first, score }))).length, 10);
});

test('key changes retain other defaults and reject duplicate stored assignments', () => {
  assert.deepEqual(loadBindings({ interact: ['KeyF'] }).interact, ['KeyF']);
  assert.deepEqual(loadBindings({ interact: ['KeyQ'] }), defaultBindings);
  assert.deepEqual(loadBindings({ jump: ['Enter'] }).jump, defaultBindings.jump);
});
