export const clamp = (value, low = 0, high = 100) => Math.min(high, Math.max(low, value));
export const clock = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export function event(state, message, severity = 'info') {
  return { ...state, nextEvent: state.nextEvent + 1, events: [{ id: state.nextEvent, time: state.time, message, severity }, ...state.events].slice(0, 100) };
}
export function initialState() {
  return {
    time: 0, running: true, level: 48, temperature: 31, pressure: 1.7, inflow: 5.1, outflow: 4.2,
    pump: 57, heater: 45, valve: 60, pumpMode: 'auto', heaterMode: 'auto', manualPump: 57, manualHeater: 45,
    levelSP: 65, temperatureSP: 45, levelIntegral: 0, temperatureIntegral: 0,
    levelKp: 3.2, levelKi: 0.045, temperatureKp: 6.5, temperatureKi: 0.035,
    estop: false, pumpFault: false, sensorFault: false, highTrip: false, overheatTrip: false,
    alarms: [], acknowledged: [], nextEvent: 2,
    events: [{ id: 1, time: 0, message: 'Симуляция запущена. Контуры уровня и температуры в АВТО.', severity: 'info' }],
    history: [{ time: 0, level: 48, temperature: 31, levelSP: 65, temperatureSP: 45, pump: 57, heater: 45 }],
  };
}
function controller(error, integral, kp, ki, bias, dt) {
  const raw = bias + kp * error + ki * integral;
  const canIntegrate = (raw > 0 && raw < 100) || (raw >= 100 && error < 0) || (raw <= 0 && error > 0);
  const nextIntegral = canIntegrate ? clamp(integral + error * dt, -5000, 5000) : integral;
  return { integral: nextIntegral, output: clamp(bias + kp * error + ki * nextIntegral) };
}
export function setMode(state, loop, mode) {
  if (state[loop + 'Mode'] === mode) return state;
  const levelLoop = loop === 'pump';
  const error = levelLoop ? state.levelSP - state.level : state.temperatureSP - state.temperature;
  const bias = levelLoop ? state.outflow / 9 * 100 : 35;
  const kp = levelLoop ? state.levelKp : state.temperatureKp;
  const ki = levelLoop ? state.levelKi : state.temperatureKi;
  const key = levelLoop ? 'levelIntegral' : 'temperatureIntegral';
  const next = { ...state, [loop + 'Mode']: mode };
  if (mode === 'auto') next[key] = clamp((state[loop] - bias - kp * error) / ki, -5000, 5000);
  else next[levelLoop ? 'manualPump' : 'manualHeater'] = state[loop];
  return event(next, `${levelLoop ? 'Насос P-101' : 'Нагреватель E-101'}: режим ${mode === 'auto' ? 'АВТО' : 'РУЧНОЙ'}.`);
}
export function resetProtections(state) {
  if (state.pumpFault || state.sensorFault || state.level >= 90 || state.temperature >= 60) {
    return event(state, 'Сброс отклонён: сначала устраните причину блокировки.', 'warning');
  }
  return advance(event({ ...state, estop: false, highTrip: false, overheatTrip: false }, 'Защиты сброшены. Автоматическое управление разрешено.'), 0);
}
export function advance(previous, dt) {
  let s = { ...previous, time: previous.time + dt };
  if (s.level >= 95 && !s.highTrip) s = event({ ...s, highTrip: true }, 'LSHH-101: подача заблокирована по верхнему аварийному уровню.', 'critical');
  if (s.temperature >= 70 && !s.overheatTrip) s = event({ ...s, overheatTrip: true }, 'TSHH-102: нагрев заблокирован по аварийной температуре.', 'critical');
  const pumpAllowed = s.running && !s.estop && !s.pumpFault && !s.sensorFault && !s.highTrip;
  const heaterAllowed = s.running && !s.estop && !s.overheatTrip && !s.sensorFault && s.level >= 15;
  if (pumpAllowed && s.pumpMode === 'auto') {
    const c = controller(s.levelSP - s.level, s.levelIntegral, s.levelKp, s.levelKi, s.outflow / 9 * 100, dt);
    s.levelIntegral = c.integral; s.pump = c.output;
  } else s.pump = pumpAllowed ? s.manualPump : 0;
  if (heaterAllowed && s.heaterMode === 'auto') {
    const c = controller(s.temperatureSP - s.temperature, s.temperatureIntegral, s.temperatureKp, s.temperatureKi, 35, dt);
    s.temperatureIntegral = c.integral; s.heater = c.output;
  } else s.heater = heaterAllowed ? s.manualHeater : 0;
  s.inflow = s.pump / 100 * 9;
  s.outflow = Math.min(s.valve / 100 * 7, s.level > 0 ? 7 : s.inflow);
  s.level = clamp(s.level + (s.inflow - s.outflow) / 3600 / 2 * 100 * dt);
  const volume = Math.max(0.12, s.level / 100 * 2);
  s.temperature = clamp(s.temperature + (s.heater / 100 * 0.10 - (s.temperature - 20) * 0.0007 + s.inflow / 3600 / volume * (20 - s.temperature)) * dt, 20, 95);
  s.pressure += ((s.pump ? 0.4 + s.pump / 100 * 3.2 : 0) - s.pressure) * Math.min(1, dt / 2);
  const alarms = [];
  if (s.estop) alarms.push({ key: 'estop', severity: 'critical', tag: 'ES-101', message: 'Аварийный останов', detail: 'Насос и нагреватель отключены. Для возврата выполните сброс защит.' });
  if (s.pumpFault) alarms.push({ key: 'pump', severity: 'critical', tag: 'P-101', message: 'Отказ насоса', detail: 'Нет подачи. Устраните отказ в панели сценариев.' });
  if (s.sensorFault) alarms.push({ key: 'sensor', severity: 'critical', tag: 'LT-101', message: 'Недостоверный сигнал уровня', detail: 'Контуры уровня и нагрева заблокированы.' });
  if (s.highTrip) alarms.push({ key: 'highTrip', severity: 'critical', tag: 'LSHH-101', message: 'Блокировка подачи по уровню', detail: 'Защита сработала на 95%. Сброс разрешён ниже 90%.' });
  if (s.overheatTrip) alarms.push({ key: 'overheat', severity: 'critical', tag: 'TSHH-102', message: 'Блокировка нагрева', detail: 'Защита сработала на 70 °C. Сброс разрешён ниже 60 °C.' });
  if (s.level >= 85) alarms.push({ key: 'high', severity: 'warning', tag: 'LAH-101', message: 'Высокий уровень', detail: 'Уровень выше 85%. Уменьшите подачу или увеличьте отбор.' });
  if (s.level <= 20) alarms.push({ key: 'low', severity: 'warning', tag: 'LAL-101', message: 'Низкий уровень', detail: 'Уровень ниже 20%. Нагрев отключается ниже 15%.' });
  if (s.temperature >= 65) alarms.push({ key: 'hot', severity: 'warning', tag: 'TAH-102', message: 'Высокая температура', detail: 'Температура выше 65 °C.' });
  for (const alarm of alarms) if (!previous.alarms.some(a => a.key === alarm.key)) s = event(s, `${alarm.tag}: ${alarm.message}.`, alarm.severity);
  for (const alarm of previous.alarms) if (!alarms.some(a => a.key === alarm.key)) s = event(s, `${alarm.tag}: условие аварии устранено.`);
  s.alarms = alarms;
  s.acknowledged = s.acknowledged.filter(key => alarms.some(a => a.key === key));
  if (s.time - s.history.at(-1).time >= 2) s.history = [...s.history, { time: s.time, level: s.level, temperature: s.temperature, levelSP: s.levelSP, temperatureSP: s.temperatureSP, pump: s.pump, heater: s.heater }].slice(-240);
  return s;
}
