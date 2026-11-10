const { SerialPort } = require('serialport');
const axios = require('axios');

// ── Configuration ────────────────────────────────────────────────
const SERIAL_PATH = process.env.SERIAL_PATH || '/dev/ttyS2';
const BAUD_RATE = parseInt(process.env.BAUD_RATE) || 9600;
const API_URL = process.env.API_URL || 'http://backend:3001/api/data';

const PACKET_LENGTH = 21;
const PACKET_TYPE_SENSOR = 0x05;

// ── Packet buffer ────────────────────────────────────────────────
// Data from serial port may arrive in chunks, so we buffer and
// scan for complete 21-byte packets.
let buffer = Buffer.alloc(0);

/**
 * Parse a validated 21-byte SENSOR packet.
 * Temperature is a signed int16 at bytes [18..19], divided by 10.
 */
function parseTemperature(packet) {
  const tempRaw = (packet[18] << 8) | packet[19];
  const tempSigned = tempRaw > 32767 ? tempRaw - 65536 : tempRaw;
  return tempSigned / 10;
}

/**
 * Process incoming serial data: buffer it, then extract and handle
 * every complete 21-byte packet found.
 */
function processData(data) {
  buffer = Buffer.concat([buffer, data]);

  while (buffer.length >= PACKET_LENGTH) {
    // Check packet type at byte [3]
    if (buffer[3] !== PACKET_TYPE_SENSOR) {
      // Not a SENSOR packet — skip one byte and try again
      buffer = buffer.subarray(1);
      continue;
    }

    const packet = buffer.subarray(0, PACKET_LENGTH);
    buffer = buffer.subarray(PACKET_LENGTH);

    const temperature = parseTemperature(packet);
    sendReading(temperature);
  }

  // Prevent buffer from growing indefinitely on garbage data
  if (buffer.length > PACKET_LENGTH * 10) {
    buffer = buffer.subarray(buffer.length - PACKET_LENGTH);
  }
}

/**
 * Send a reading to the backend API.
 * cpu_temp carries the sensor temperature.
 * fan_speed and voltage are stubs (0).
 */
async function sendReading(temperature) {
  const data = {
    sensor_key: process.env.SENSOR_KEY || 'temp_01',
    value: parseFloat(temperature.toFixed(1)),
  };

  try {
    await axios.post(API_URL, data, { headers: process.env.SENSOR_TOKEN ? { 'X-Sensor-Token': process.env.SENSOR_TOKEN } : { 'X-Ingest-Key': process.env.INGEST_API_KEY } });
    console.log(`📡 Датчик → ${temperature.toFixed(1)} °C  (отправлено)`);
  } catch (err) {
    console.error(`❌ Ошибка отправки: ${err.message}`);
  }
}

// ── Wait for backend ─────────────────────────────────────────────
async function waitForBackend(retries = 60, delay = 2000) {
  const healthUrl = API_URL.replace('/api/data', '/api/health');
  for (let i = 0; i < retries; i++) {
    try {
      await axios.get(healthUrl);
      console.log('✅ Backend доступен');
      return;
    } catch {
      console.log(`⏳ Ожидание backend... (${i + 1}/${retries})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('❌ Backend недоступен');
}

// ── Serial port setup ────────────────────────────────────────────
function openSerialPort() {
  const port = new SerialPort({
    path: SERIAL_PATH,
    baudRate: BAUD_RATE,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    autoOpen: false,
  });

  port.open((err) => {
    if (err) {
      console.error(`❌ Не удалось открыть ${SERIAL_PATH}:`, err.message);
      console.log('⏳ Повторная попытка через 5 секунд...');
      setTimeout(openSerialPort, 5000);
      return;
    }
    console.log(`✅ Порт ${SERIAL_PATH} открыт (${BAUD_RATE} бод)`);
  });

  port.on('data', (data) => {
    processData(data);
  });

  port.on('error', (err) => {
    console.error('❌ Ошибка порта:', err.message);
  });

  port.on('close', () => {
    console.log('⚠️  Порт закрыт. Переподключение через 5 секунд...');
    setTimeout(openSerialPort, 5000);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n🛑 Завершение работы...');
    if (port.isOpen) {
      port.close(() => process.exit(0));
    } else {
      process.exit(0);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// ── Main ─────────────────────────────────────────────────────────
(async () => {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Sensor Reader — Tech Monitor           ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`📟 Порт:    ${SERIAL_PATH}`);
  console.log(`⚡ Скорость: ${BAUD_RATE} бод`);
  console.log(`🌐 Backend: ${API_URL}`);
  console.log('');

  await waitForBackend();
  openSerialPort();
})();
