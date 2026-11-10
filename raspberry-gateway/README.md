# SCADA gateway for Raspberry Pi 2 Model B v1.1

Python service; no Docker or ARM64 binaries on the board. Requires Python 3.9+, pyserial and systemd. Intended for Debian-based Raspberry Pi and Rock Pi Linux. Deployment verification on Raspberry Pi 2 with DietPi is recorded in `docs/dietpi-deployment-2026-10-16.md`; Rock Pi hardware remains untested.

## One-time installation

1. Install Raspberry Pi OS, connect Ethernet and set the correct time (NTP). USB-UART is the simplest connection. For GPIO UART enable the serial interface and disable its login console in `raspi-config`; reboot. GPIO UART uses 3.3 V signal levels and a common ground.
2. In SCADA sign in as administrator, open **Платы и устройства**, add the Raspberry, copy its collector key.
3. Copy this directory to Raspberry, then run `sudo sh install.sh`. Enter the SCADA HTTPS URL and key. It installs Python/pyserial and enables automatic startup and restart.
4. Flash the ESP32 firmware with `esp32_scada.h` integrated as described below and connect USB-UART. Discovered channels appear in the panel within approximately 15–30 seconds.
5. Click **Добавить в SCADA**, choose a group, name, unit and engineering range. Keep the ESP32 input range at 4–20 if it transmits mA. For pressure 0–10 bar, enter engineering limits 0 and 10, unit bar. A current of 12 mA then produces 5 bar.

Subsequent USB device discovery, channel addition, assignment, scaling and baud-rate changes are performed through the panel. Device IDs must remain stable across reboots. Replacing the collector key or changing the board's network settings requires access to the board. Disabling a gateway blocks its API access; re-enable it in the panel to restore communication.

## ESP32 protocol

115200 baud, 8N1. Each UTF-8 JSON message ends with a newline, maximum 2048 bytes:

```json
{"protocol":"scada-uart-v1","device_id":"esp32_aabbccddeeff","name":"ESP32 4-20mA","channel":"current_1","value":12.0}
```

Device ID: 1–64 ASCII letters/digits/underscore/hyphen; channel: 1–32. Send a sample periodically (recommended once per second), including before enrollment: the gateway uses samples to discover channels. Multiple channels use the same device ID and different channel names. No commands or probes are transmitted to serial devices. Ordinary UART cannot identify an arbitrary unknown sensor or share multiple transmitters on one wire; use separate USB-UART connections or one ESP32 publishing several channels.

Include `esp32_scada.h` in your existing Arduino ESP32 firmware; call `Serial.begin(115200)` in setup and `scadaPublishCurrent(measuredCurrentMa)` after reading your actual calibrated input. For a second channel call `scadaPublishCurrent(secondCurrentMa, "current_2")`. This header provides telemetry only: the 4–20 mA ADC circuit, reference, calibration and pin assignment depend on your design. It does not invent measurements or supply a complete ADC firmware.

The gateway supports this JSON protocol. The older 21-byte temperature sensor protocol in `sensor-reader/` is a separate legacy client.

## Reliability and maintenance

- HTTPS certificate and hostname verification, separate revocable 256-bit key for every board. No incoming connection, public IP or VPN is needed on the Raspberry.
- systemd restarts a crashed process after 5 seconds and restarts a stalled main loop after a 90-second watchdog timeout. Serial-manager failure also restarts the process. Internet outages keep the process running and buffering data.
- Daily consistent SQLite/configuration snapshots are kept in `/var/backups/scada-gateway` (seven snapshots, root only). These local snapshots do not protect against losing the SD card; keep an external copy as well.
- Enrolled channels are cached locally. The UART threads continue collecting while the Internet/server is unavailable; SQLite commits each sample to disk. Unenrolled channels are only discovered, not archived.
- Delivery starts immediately, in batches of at most 30 readings. An idle loop adds up to 0.5 seconds before network delivery. Status/configuration polling is every 15 seconds. This is not a guaranteed end-to-end latency.
- Every reading has a persistent UUID and UTC measurement time. Only server-acknowledged records are removed. Duplicate retries do not create duplicate samples. The server separately records receive time in its deduplication ledger.
- Unassigned/disabled channel records remain in a local rejected archive; restoring the assignment retries them. Changing scaling affects subsequent uploads, including buffered data: drain the queue before changing calibration.
- Maximum 250000 queued/archived records per board; capacity is shared by all channels (about 69 hours at one total sample per second). When full, new samples cannot be stored; the error appears in service logs and status. SD card reliability and available disk space also matter. There is no automatic archive deletion.
- Physical device state is inferred from the last sample, not a separate presence signal. Collector/devices are marked offline after 60 seconds without their respective updates.
- NTP must be configured; the server rejects timestamps before 2020 or more than five minutes in the future.

```sh
sudo systemctl status scada-gateway
sudo journalctl -u scada-gateway -f
```

Config: `/etc/scada-gateway/gateway.env` (root only). Queue/config cache: `/var/lib/scada-gateway/`. Default scan: USB serial plus `/dev/serial0`. To use other GPIO UARTs set comma-separated paths in `UART_PORTS` and restart the service. Do not run a serial login console on those ports.

Service updates: replace this directory and rerun `sudo sh install.sh`; existing key, queue and cached settings are preserved. Back up the queue with SQLite's backup API, rather than copying only the main database while WAL writes are active.
