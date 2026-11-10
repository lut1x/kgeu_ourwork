import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, initialState, resetProtections, setMode } from './processModel.mjs';
function run(state, seconds) { for (let i = 0; i < seconds; i++) state = advance(state, 1); return state; }
test('automatic loops reach their setpoints and compensate an increased outlet flow', () => {
  let state = run(initialState(), 1800);
  assert.ok(Math.abs(state.level - state.levelSP) < 0.7);
  assert.ok(Math.abs(state.temperature - state.temperatureSP) < 0.5);
  const previousPump = state.pump;
  state = run({ ...state, valve: 90 }, 1200);
  assert.ok(Math.abs(state.level - state.levelSP) < 0.7);
  assert.ok(state.pump > previousPump + 15);
  assert.equal(state.alarms.length, 0);
  assert.ok(state.history.length <= 240);
});
test('manual commands control actuator outputs without changing setpoints', () => {
  const state = advance({ ...initialState(), pumpMode: 'manual', heaterMode: 'manual', manualPump: 72, manualHeater: 33 }, 1);
  assert.equal(state.pump, 72); assert.equal(state.heater, 33);
  assert.equal(state.levelSP, 65); assert.equal(state.temperatureSP, 45);
});
test('manual to automatic mode transfer starts near the existing actuator output', () => {
  let state = advance({ ...initialState(), pumpMode: 'manual', manualPump: 33 }, 1);
  state = advance(setMode(state, 'pump', 'auto'), 0.1);
  assert.ok(Math.abs(state.pump - 33) < 1);
});
test('emergency stop and invalid level signal override both control modes', () => {
  for (const mode of ['manual', 'auto']) for (const fault of ['estop', 'sensorFault']) {
    const state = advance({ ...initialState(), pumpMode: mode, heaterMode: mode, manualPump: 100, manualHeater: 100, [fault]: true }, 1);
    assert.equal(state.pump, 0); assert.equal(state.heater, 0);
    assert.ok(state.alarms.some(a => a.severity === 'critical'));
  }
});
test('high level protection latches and cannot reset while its cause is present', () => {
  let state = advance({ ...initialState(), level: 96 }, 1);
  assert.equal(state.highTrip, true); assert.equal(state.pump, 0);
  assert.equal(resetProtections(state).highTrip, true);
  state = advance({ ...state, level: 89 }, 1);
  assert.equal(state.pump, 0);
  state = advance(resetProtections(state), 1);
  assert.equal(state.highTrip, false);
});
test('heater cannot run at low level and temperature trip requires a safe reset', () => {
  assert.equal(advance({ ...initialState(), level: 10, heaterMode: 'manual', manualHeater: 100 }, 1).heater, 0);
  let state = advance({ ...initialState(), temperature: 71 }, 1);
  assert.equal(state.overheatTrip, true); assert.equal(state.heater, 0);
  assert.equal(resetProtections(state).overheatTrip, true);
  state = resetProtections({ ...state, temperature: 59 });
  assert.equal(state.overheatTrip, false);
});
