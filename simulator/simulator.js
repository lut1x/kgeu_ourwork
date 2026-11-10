const axios = require('axios');

const API_URL = process.env.API_URL || 'http://backend:3001/api/data';
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS) || 1000;

// Current values with smooth drift
let cpuTemp = 55.0;   // Start at a mid-range value
let fanSpeed = 2800;   // Start at mid-range
let voltage = 4.2;     // Start at nominal
let coolantTemp = 64;
let pressure = 4.5;
let flow = 65;

/**
 * Generate next value with realistic smooth drift
 * @param {number} current - Current value
 * @param {number} min - Minimum allowed
 * @param {number} max - Maximum allowed
 * @param {number} maxDrift - Maximum change per tick
 * @param {number} decimals - Decimal places
 */
function drift(current, min, max, maxDrift, decimals = 2) {
  const change = (Math.random() - 0.5) * 2 * maxDrift;
  let next = current + change;
  
  // Add occasional spikes for realism
  if (Math.random() < 0.02) {
    next += (Math.random() - 0.3) * maxDrift * 5;
  }
  
  // Clamp to range
  next = Math.max(min, Math.min(max, next));
  return parseFloat(next.toFixed(decimals));
}

async function sendReading() {
  cpuTemp = drift(cpuTemp, 35.0, 85.0, 1.5, 1);
  fanSpeed = drift(fanSpeed, 1000, 5000, 150, 0);
  voltage = drift(voltage, 3.0, 5.5, 0.05, 2);
  coolantTemp = drift(coolantTemp, 45, 105, 0.6, 1);
  pressure = drift(pressure, 2, 9.5, 0.12, 2);
  flow = drift(flow, 35, 140, 2, 1);

  const data = {
    cpu_temp: cpuTemp,
    fan_speed: Math.round(fanSpeed),
    voltage: voltage
  };

  try {
    await axios.post(API_URL, { readings: [
      { sensor_key: 'temp_01', value: cpuTemp }, { sensor_key: 'fan_01', value: Math.round(fanSpeed) },
      { sensor_key: 'voltage_01', value: voltage }, { sensor_key: 'temp_02', value: coolantTemp },
      { sensor_key: 'pressure_01', value: pressure }, { sensor_key: 'flow_01', value: flow },
    ] }, { headers: { 'X-Ingest-Key': process.env.INGEST_API_KEY } });
    console.log(`📊 Sent: CPU=${data.cpu_temp}°C  Fan=${data.fan_speed}RPM  V=${data.voltage}V`);
  } catch (err) {
    console.error(`❌ Failed to send data: ${err.message}`);
  }
}

// Wait for backend to be ready
async function waitForBackend(retries = 60, delay = 2000) {
  const healthUrl = API_URL.replace('/api/data', '/api/health');
  for (let i = 0; i < retries; i++) {
    try {
      await axios.get(healthUrl);
      console.log('✅ Backend is ready');
      return;
    } catch {
      console.log(`⏳ Waiting for backend... (${i + 1}/${retries})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('❌ Backend not available');
}

// Main
(async () => {
  console.log('🔧 Tech Monitor Simulator Starting...');
  console.log(`📡 Sending to: ${API_URL}`);
  console.log(`⏱️  Interval: ${INTERVAL_MS}ms`);

  await waitForBackend();

  // Send readings at configured interval
  setInterval(sendReading, INTERVAL_MS);
  sendReading(); // Send first reading immediately
})();
