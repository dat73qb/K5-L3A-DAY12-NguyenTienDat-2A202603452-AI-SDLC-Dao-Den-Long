import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createGame, defaultInput, step, tuning } from '../src/game.mjs';

const empty = { random_motes: false, random_shades: false };
const event = (records, name) => records.find(record => record.name === name);
const snap = (records, tick) => records.find(record => record.type === 'snapshot' && record.tick === tick);
function run(t, scenario = empty, frames = [], ticks = 60, every = 1) {
  const dir = mkdtempSync(join(tmpdir(), 'lantern-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const scenarioPath = join(dir, 'scenario.json');
  const inputsPath = join(dir, 'inputs.json');
  const out = join(dir, 'out.jsonl');
  writeFileSync(scenarioPath, JSON.stringify(scenario));
  writeFileSync(inputsPath, JSON.stringify({ frames }));
  const result = spawnSync(process.execPath, ['src/headless.mjs', '--night', '1', '--seed', '-12',
    '--scenario', scenarioPath, '--inputs', inputsPath, '--ticks', String(ticks),
    '--snapshot-every', String(every), '--out', out], { encoding: 'utf8' });
  if (result.status !== 0) return result;
  const raw = readFileSync(out, 'utf8');
  return { raw, records: raw.trimEnd().split('\n').map(JSON.parse) };
}

test('tick zero, rotated normalized movement, partial frames and fixed clock', t => {
  const { records } = run(t, empty, [
    { tick: 0, move: [1, 1], cam_yaw_deg: 90 }, { tick: 30, jump: true }
  ]);
  assert.deepEqual(records[0].player.pos, [0, 0, 0]);
  assert.equal(snap(records, 31).sim_tick, 31);
  assert.ok(snap(records, 31).player.pos[1] > 0);
  assert.deepEqual(snap(records, 60).player.pos.filter((_, axis) => axis !== 1), [4.95, -4.95]);
  assert.equal(snap(records, 60).time_left_s, tuning.night1_duration_s - 1);
  assert.deepEqual(run(t, empty, [], 0).records.at(-1), { type: 'end', ticks: 0, state: 'playing', score: 0 });
});

test('pickup and náº¡p in XZ, capacity, rising edge, winning and score', t => {
  const { records } = run(t, { ...empty,
    player: { carried: tuning.carry_capacity - 1 },
    motes: [[0, 80, tuning.pickup_radius], [0, 0, 0]],
    lanterns: Array.from({ length: 5 }, (_, i) => ({
      id: 'L' + (i + 1), pos: [tuning.interact_radius, 10, 0], lit: i !== 0
    }))
  }, [{ tick: 0, interact: true }], 12);
  assert.equal(records[0].score, 0);
  assert.deepEqual(event(records, 'mote_picked').data, { carried: tuning.carry_capacity });
  assert.deepEqual(event(records, 'deposit').data, { lantern_id: 'L1', amount: 4, deposited: 4 });
  assert.equal(event(records, 'game_over').tick, 1);
  assert.equal(records.at(-1).state, 'won');
  assert.equal(records.at(-1).score, 10 + 100 + 179 * 2 + 3 * 50);
  const partial = run(t, { ...empty, player: { carried: 1 }, motes: [[0, 0, 1.3]],
    lanterns: [{ id: 'L1', pos: [0, 0, 0] }] }, [
    { tick: 0, interact: true }, { tick: 1, move: [0, 1] },
    { tick: 3, interact: false }, { tick: 4, interact: true }
  ], 5).records;
  assert.deepEqual(partial.filter(record => record.name === 'deposit').map(record => record.tick), [1, 5]);
});

test('pulse range, push, cooldown and recovery', t => {
  const { records } = run(t, { ...empty, player: { carried: 6 }, shades: [
    { id: 'near', pos: [tuning.pulse_radius, 2, 0] }, { id: 'far', pos: [0, 0, 20] }
  ] }, [{ tick: 0, pulse: true }, { tick: 1, pulse: false }, { tick: 2, pulse: true }], 122);
  assert.deepEqual(event(records, 'pulse').data.stunned_ids, ['near']);
  assert.equal(records.filter(record => record.name === 'pulse').length, 1);
  assert.equal(snap(records, 1).player.carried, 4);
  assert.deepEqual(snap(records, 1).shades[0].pos, [8, 2, 0]);
  assert.equal(snap(records, 120).shades[0].state, 'stunned');
  assert.equal(snap(records, 121).shades[0].state, 'chase');
});

test('shade damage, drops, invulnerability, safe radius and both losses', t => {
  const contact = { ...empty, player: { flames: 2, carried: 8 }, shades: [{ pos: [0, 9, 0] }] };
  const { records } = run(t, contact, [], 200, 10);
  const hits = records.filter(record => record.name === 'player_hit');
  assert.deepEqual(hits.map(hit => hit.tick), [1, 121]);
  assert.deepEqual(hits[0].data, { by: 'shade', flames: 1, dropped: 2 });
  assert.equal(records.at(-1).ticks, 121);
  assert.equal(event(records, 'game_over').data.reason, 'no_flames');
  const protectedRun = run(t, { ...contact, lanterns: [{ id: 'L1', pos: [0, 0, 0], lit: true }] }, [], 12);
  assert.equal(event(protectedRun.records, 'player_hit'), undefined);
  assert.ok(Math.abs(snap(protectedRun.records, 1).shades[0].pos[0]) > tuning.safe_radius);
  const dawn = run(t, { ...empty, time_left_s: 0.05 }, [], 100, 10).records;
  assert.equal(event(dawn, 'game_over').data.reason, 'dawn');
  assert.equal(dawn.at(-1).ticks, 3);
});

test('seeded output is byte-identical and bad input files exit 2', t => {
  assert.equal(run(t, {}, [], 600, 10).raw, run(t, {}, [], 600, 10).raw);
  const duplicate = run(t, empty, [{ tick: 3 }, { tick: 3 }]);
  assert.equal(duplicate.status, 2);
  assert.match(duplicate.stderr, /increase strictly/);
  const badScenario = run(t, { random_shades: 'false' });
  assert.equal(badScenario.status, 2);
  assert.match(badScenario.stderr, /random_shades/);
});

test('finish the default seed from spawn using movement, recovery zones and lantern interactions', () => {
  const game = createGame(12);
  function walkTo(target) {
    while (game.state === 'playing') {
      const x = target[0] - game.player.pos[0];
      const z = target[2] - game.player.pos[2];
      const distance = Math.hypot(x, z);
      if (distance < 0.4) return;
      step(game, { ...defaultInput, move: [x / distance, z / distance] });
    }
  }
  for (let i = 0; i < 5; i++) {
    for (const mote of game.motes.filter(mote => Number(mote.id.slice(1)) > 8 * i &&
        Number(mote.id.slice(1)) <= 8 * (i + 1))) {
      if (game.player.carried >= tuning.lantern_cost) break;
      walkTo(mote.pos);
    }
    walkTo(game.lanterns[i].pos);
    step(game, { ...defaultInput, interact: true });
  }
  assert.equal(game.state, 'won');
});
