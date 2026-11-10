#pragma once
#include <Arduino.h>
#include <math.h>

// Call Serial.begin(115200) once in setup(). Use the USB UART connected to Raspberry.
// Call after obtaining a calibrated CURRENT IN mA from your own 4-20 mA circuit.
// Channel must contain only letters, digits, '_' or '-'. No diagnostic text on this UART.
inline void scadaPublishCurrent(float currentMa, const char* channel = "current_1") {
  if (!isfinite(currentMa)) return;
  for (const char* p=channel; *p; ++p) {
    if (!(isalnum((unsigned char)*p) || *p=='_' || *p=='-')) return;
  }
  if (!*channel || strlen(channel)>32) return;
  const uint64_t chip = ESP.getEfuseMac();
  Serial.printf("{\"protocol\":\"scada-uart-v1\",\"device_id\":\"esp32_%04x%08x\",\"name\":\"ESP32 4-20mA\",\"channel\":\"%s\",\"value\":%.4f}\n",
      (unsigned int)(chip >> 32), (unsigned int)chip, channel, currentMa);
}
