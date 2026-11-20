import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { tuning } from '../src/game.mjs';

const empty = { random_motes: false, random_shades: false, random_drifters: false, charms: [] };
const event = (records, name) => records.find(record => record.name === name);
const events = (records, name) => records.filter(record => record.name === name);
const snap = (records, tick) => records.find(record => record.type === 'snapshot' && record.tick === tick);

function run(t, { scenario = empty, frames = [], ticks = 60, every = 1, night = 1 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lantern-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const scenarioPath = join(dir, 'scenario.json');
  const inputsPath = join(dir, 'inputs.json');
  const out = join(dir, 'out.jsonl');
  writeFileSync(scenarioPath, JSON.stringify(scenario));
  writeFileSync(inputsPath, JSON.stringify({ frames }));
  const result = spawnSync(process.execPath, ['src/headless.mjs', '--night', String(night), '--seed', '-12',
    '--scenario', scenarioPath, '--inputs', inputsPath, '--ticks', String(ticks),
    '--snapshot-every', String(every), '--out', out], { encoding: 'utf8' });
  if (result.status !== 0) return result;
  const raw = readFileSync(out, 'utf8');
  return { raw, records: raw.trimEnd().split('\n').map(JSON.parse) };
}

test('tick zero, yaw, diagonal normalization, partial frames, grounded jump and fixed clock', t => {
  const { records } = run(t, { frames: [{ tick: 0, move: [1, 1], cam_yaw_deg: 90 }, { tick: 30, jump: true }] });
  assert.deepEqual(records[0].player.pos, [0, 0, 0]);
  assert.equal(event(records, 'night_start').tick, 0);
  assert.equal(snap(records, 31).sim_tick, 31);
  assert.ok(snap(records, 31).player.pos[1] > 0);
  assert.deepEqual(snap(records, 60).player.pos.filter((_, axis) => axis !== 1), [4.243, -4.243]);
  assert.equal(snap(records, 60).time_left_s, tuning.night1_duration_s - 1);
  assert.deepEqual(run(t, { ticks: 0 }).records.at(-1), { type: 'end', ticks: 0, state: 'playing', score: 0 });
});

test('pickup height, capacity, deposit at XZ boundary, rising edge and victory score', t => {
  const { records } = run(t, { scenario: { ...empty, player: { carried: 9 },
    motes: [[0, 80, 0], [0, 1.5, 1], [0, 0, 0]],
    lanterns: Array.from({ length: 5 }, (_, i) => ({ id: 'L' + (i + 1), pos: [2, 0, 0], lit: i !== 0 }))
  }, frames: [{ tick: 0, interact: true }], ticks: 12 });
  assert.equal(records[0].score, 0);
  assert.equal(events(records, 'mote_picked').length, 1);
  assert.deepEqual(event(records, 'deposit').data, { lantern_id: 'L1', amount: 10, deposited: 10 });
  assert.equal(event(records, 'game_over').tick, 1);
  assert.equal(records.at(-1).score, 948);
  const partial = run(t, { scenario: { ...empty, player: { carried: 1 }, motes: [[0, 0, 1.3]],
    lanterns: [{ id: 'L2', pos: [0, 0, 0] }, { id: 'L1', pos: [0, 0, 0] }] },
  frames: [{ tick: 0, interact: true }, { tick: 1, move: [0, 1] },
    { tick: 3, interact: false }, { tick: 4, interact: true }], ticks: 5 }).records;
  assert.deepEqual(events(partial, 'deposit').map(record => [record.tick, record.data.lantern_id]), [[1, 'L1'], [5, 'L1']]);
});

test('pulse uses 3D range, moves four metres over 15 ticks, and applies cooldown', t => {
  const { records } = run(t, { scenario: { ...empty, player: { carried: 6 }, shades: [
    { id: 'S1', pos: [5, 0.8, 0] }, { id: 'S2', pos: [0, 6, 0] }
  ] }, frames: [{ tick: 0, pulse: true }, { tick: 1, pulse: false }, { tick: 2, pulse: true }], ticks: 122 });
  assert.deepEqual(event(records, 'pulse').data.stunned_ids, ['S1']);
  assert.equal(events(records, 'pulse').length, 1);
  assert.equal(snap(records, 15).player.carried, 3);
  assert.deepEqual(snap(records, 15).shades[0].pos, [9, 0.8, 0]);
  assert.equal(snap(records, 120).shades[0].state, 'stunned');
  assert.equal(snap(records, 121).shades[0].state, 'chase');
});

test('hit order, recoil, invulnerability, drops and safe zone push', t => {
  const scenario = { ...empty, player: { carried: 8 }, shades: [{ id: 'S2', pos: [0, 0.8, 0] }, { id: 'S1', pos: [0, 0.8, 0] }] };
  const { records } = run(t, { scenario, ticks: 95 });
  assert.deepEqual(events(records, 'player_hit').map(hit => hit.tick), [1, 91]);
  assert.deepEqual(event(records, 'player_hit').data, { by: 'shade', flames: 2, dropped: 4 });
  assert.equal(snap(records, 1).shades[0].state, 'recoil');
  assert.equal(snap(records, 61).shades[0].pos[0], 2);
  assert.equal(snap(records, 1).motes[0].ttl_s, 8);
  const protectedRun = run(t, { scenario: { ...scenario, lanterns: [{ id: 'L1', pos: [0, 0, 0], lit: true }] }, ticks: 31 });
  assert.equal(event(protectedRun.records, 'player_hit'), undefined);
  assert.equal(Math.hypot(...snap(protectedRun.records, 30).shades[0].pos.filter((_, axis) => axis !== 1)), 6);
});

test('fall ignores invulnerability; respawn waits 60 ticks and resets movement', t => {
  const scenario = { ...empty, player: { pos: [41, -10.1, 0], carried: 7, invuln_ticks: 500 } };
  const { records } = run(t, { scenario, ticks: 61 });
  assert.deepEqual(event(records, 'player_hit').data, { by: 'fall', flames: 2, dropped: 0, lost: 7 });
  assert.equal(events(records, 'player_hit').length, 1);
  assert.ok(snap(records, 60).player.pos[1] < -10);
  assert.deepEqual(snap(records, 61).player.pos, [0, 0, 0]);
  assert.deepEqual(snap(records, 61).player.vel, [0, 0, 0]);
  assert.equal(snap(records, 61).player.invuln, true);
  const fatal = run(t, { scenario: { ...scenario, player: { ...scenario.player, flames: 1 },
    lanterns: Array.from({ length: 5 }, (_, i) => ({ id: 'L' + (i + 1), lit: true })) } }).records;
  assert.equal(event(fatal, 'game_over').data.reason, 'no_flames');
  const dawn = run(t, { scenario: { ...empty, time_left_s: 0.05 }, ticks: 100 }).records;
  assert.equal(event(dawn, 'game_over').data.reason, 'dawn');
  assert.equal(dawn.at(-1).ticks, 3);
});

test('pause freezes simulation, clock, pickups and cooldowns across wall ticks', t => {
  const { records } = run(t, { scenario: { ...empty, player: { dash_cd_ticks: 60, charm_ticks: 10 }, motes: [[0, 0, 0]] },
    frames: [{ tick: 0, pause: true }, { tick: 2, pause: false }, { tick: 4, pause: true }], ticks: 6 });
  assert.equal(event(records, 'paused').tick, 1);
  assert.equal(snap(records, 4).state, 'paused');
  assert.equal(snap(records, 4).sim_tick, 0);
  assert.equal(snap(records, 4).player.charm_s, 1 / 6);
  assert.equal(snap(records, 4).time_left_s, 300);
  assert.equal(event(records, 'resumed').tick, 5);
  assert.equal(event(records, 'mote_picked').tick, 5);
  assert.equal(snap(records, 6).sim_tick, 2);
});

test('dash lasts 12 ticks, airborne elevation is held, and charm skips cooldown only', t => {
  const { records } = run(t, { night: 2, scenario: { ...empty, charms: [{ id: 'C1', pos: [0, 0, 0] }] },
    frames: [{ tick: 1, jump: true }, { tick: 2, dash: true }, { tick: 3, dash: false },
      { tick: 4, dash: true }, { tick: 5, dash: false }, { tick: 14, dash: true }], ticks: 27 });
  assert.equal(event(records, 'charm_picked').data.charm_ticks, 600);
  assert.deepEqual(events(records, 'dash').map(record => record.tick), [3, 15]);
  assert.equal(snap(records, 14).player.pos[2], 2.8);
  assert.equal(snap(records, 2).player.pos[1], snap(records, 14).player.pos[1]);
  assert.equal(snap(records, 26).player.pos[2], 5.6);
  assert.equal(snap(records, 26).player.dash_cd_s, 0);
  const normal = run(t, { frames: [{ tick: 0, dash: true }, { tick: 12, dash: false },
    { tick: 13, dash: true }, { tick: 14, dash: false }, { tick: 90, dash: true }], ticks: 91 }).records;
  assert.deepEqual(events(normal, 'dash').map(record => record.tick), [1, 91]);
  assert.equal(snap(normal, 12).player.pos[2], 2.8);
});

test('standard spawn positions, renewable motes and spawn schedule', t => {
  const { records } = run(t, { scenario: { random_drifters: false }, ticks: 780, every: 20 });
  const initial = records[0];
  assert.equal(initial.motes.length, 20);
  assert.equal(new Set(initial.motes.map(mote => JSON.stringify(mote.pos))).size, 20);
  assert.deepEqual(initial.lanterns[1].pos, [23.8, 0, 7.7]);
  assert.equal(snap(records, 240).motes.length, 21);
  assert.deepEqual(events(records, 'shade_spawned').map(record => [record.tick, record.data.id]), [[300, 'S1'], [300, 'S2'], [780, 'S3']]);
  assert.equal(snap(records, 300).shades[0].state, 'spawning');
});

test('Night 2 bridge charm and pad; Night 3 terrace pad', t => {
  const bridge = run(t, { night: 2, scenario: { ...empty, charms: [{ id: 'C1' }], player: { pos: [34, 0, 0] } },
    frames: [{ tick: 0, move: [1, 0] }], ticks: 90 }).records;
  assert.equal(event(bridge, 'charm_picked').data.charm_id, 'C1');
  assert.equal(snap(bridge, 90).player.grounded, true);
  assert.equal(snap(bridge, 90).lanterns.length, 6);
  const launch = run(t, { night: 2, scenario: { ...empty, player: { pos: [20, 0, 18] } },
    frames: [{ tick: 0, move: [-1, 0] }], ticks: 84 }).records;
  assert.ok(snap(launch, 60).player.pos[0] > 42);
  assert.equal(snap(launch, 84).player.grounded, true);
  const terrace = run(t, { night: 3, scenario: { ...empty, player: { pos: [0, 3, 13] } }, ticks: 80 }).records;
  assert.equal(snap(terrace, 80).player.pos[1], 6);
  assert.equal(snap(terrace, 80).player.grounded, true);
  assert.equal(snap(terrace, 80).lanterns.length, 7);
});

test('Gió Lạc attacks before shade, bypasses immunity and drops stolen motes on pulse', t => {
  const scenario = { ...empty, player: { carried: 8, invuln_ticks: 100 }, shades: [{ pos: [0, 0.8, 0] }],
    drifters: [{ id: 'D1', pos: [0, 0.8, 0] }] };
  const { records } = run(t, { night: 2, scenario, frames: [{ tick: 1, pulse: true }], ticks: 124 });
  assert.equal(event(records, 'drifter_steal').tick, 1);
  assert.equal(event(records, 'player_hit'), undefined);
  assert.deepEqual(event(records, 'drifter_drop').data, { drifter_id: 'D1', amount: 3 });
  assert.equal(snap(records, 2).motes.length, 3);
  assert.equal(snap(records, 2).motes[0].kind, 'dropped');
  assert.equal(snap(records, 123).drifters.length, 0);
  const ordered = run(t, { night: 2, scenario: { ...scenario, player: { carried: 8 } }, ticks: 1 }).records;
  assert.ok(ordered.findIndex(record => record.name === 'drifter_steal') < ordered.findIndex(record => record.name === 'player_hit'));
  assert.equal(event(ordered, 'player_hit').data.dropped, 2);
  const chased = run(t, { night: 2, scenario: { ...scenario, drifters: [{ id: 'D1', state: 'chase', pos: [0, 0.8, 0] }] },
    frames: [{ tick: 0, pulse: true }], ticks: 2 }).records;
  assert.equal(event(chased, 'drifter_steal'), undefined);
  assert.equal(snap(chased, 1).drifters[0].state, 'flee');
});

test('wind starts at tick 1800, adds 2 m/s, then stops; charms respawn', t => {
  const { records } = run(t, { night: 3, scenario: { ...empty, player: { pos: [0, 0, -12] } }, ticks: 2100, every: 1 });
  assert.equal(snap(records, 1799).wind.active, false);
  assert.equal(snap(records, 1800).wind.active, true);
  assert.ok(Math.abs(Math.hypot(...snap(records, 1800).player.vel) - 2) < 0.001);
  assert.equal(snap(records, 2099).wind.active, true);
  assert.equal(snap(records, 2100).wind.active, false);
  const charm = run(t, { night: 2, scenario: { ...empty, charms: [{ id: 'C1', available: false, respawn_ticks: 3 }] },
    ticks: 4 }).records;
  assert.equal(snap(charm, 2).charms[0].available, false);
  assert.equal(snap(charm, 3).charms[0].available, true);
});

test('seeded output byte match and invalid inputs exit 2', t => {
  const options = { scenario: {}, night: 3, ticks: 1200, every: 10 };
  assert.equal(run(t, options).raw, run(t, options).raw);
  const duplicate = run(t, { frames: [{ tick: 3 }, { tick: 3 }] });
  assert.equal(duplicate.status, 2);
  assert.match(duplicate.stderr, /increase strictly/);
  const badScenario = run(t, { scenario: { random_drifters: 'false' } });
  assert.equal(badScenario.status, 2);
});

test('Night 3 walls block ascent, ramps climb, and the origin stays on level zero', t => {
  const wall = run(t, { night: 3, scenario: { ...empty, player: { pos: [0, 0, 25] } },
    frames: [{ tick: 0, move: [0, -1] }], ticks: 60 }).records;
  assert.equal(snap(wall, 60).player.pos[1], 0);
  assert.ok(snap(wall, 60).player.pos[2] >= 24);
  const x = Math.cos(Math.PI / 6), z = Math.sin(Math.PI / 6);
  const ramp = run(t, { night: 3, scenario: { ...empty, player: { pos: [30 * x, 0, 30 * z] } },
    frames: [{ tick: 0, move: [-x, -z] }], ticks: 62 }).records;
  assert.equal(snap(ramp, 62).player.pos[1], 3);
  assert.equal(snap(ramp, 62).player.grounded, true);
  const spawn = run(t, { night: 3, frames: [{ tick: 0, move: [0, -1] }], ticks: 100 }).records;
  assert.deepEqual(snap(spawn, 100).player.pos, [0, 0, -10]);
  assert.equal(event(spawn, 'player_hit'), undefined);
});

test('drifter schedule fills two active slots and no drifter is scheduled in Night 1', t => {
  const options = { scenario: { random_motes: false, random_shades: false }, ticks: 3600, every: 1200 };
  const night1 = run(t, options).records;
  const night2 = run(t, { ...options, night: 2 }).records;
  assert.deepEqual(snap(night1, 3600).drifters, []);
  assert.deepEqual(snap(night2, 1200).drifters.map(item => item.id), ['D1']);
  assert.deepEqual(snap(night2, 2400).drifters.map(item => item.id), ['D1', 'D2']);
  assert.deepEqual(snap(night2, 3600).drifters.map(item => item.id), ['D1', 'D2']);
});

test('finish at dusk when alive and add no negative time bonus', t => {
  const { records } = run(t, { scenario: { ...empty, time_left_s: 1 / 60, player: { carried: 10 },
    lanterns: Array.from({ length: 5 }, (_, i) => ({ id: 'L' + (i + 1), pos: [0, 0, 0], lit: i !== 0 }))
  }, frames: [{ tick: 0, interact: true }], ticks: 5 });
  assert.equal(event(records, 'game_over').data.reason, 'all_lit');
  assert.deepEqual(records.at(-1), { type: 'end', ticks: 1, state: 'won', score: 350 });
});
