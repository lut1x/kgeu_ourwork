CREATE DATABASE IF NOT EXISTS techmonitor;
USE techmonitor;

CREATE TABLE IF NOT EXISTS readings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    cpu_temp DECIMAL(5,2) NOT NULL COMMENT 'CPU Temperature in °C',
    fan_speed INT NOT NULL COMMENT 'Fan Speed in RPM',
    voltage DECIMAL(4,2) NOT NULL COMMENT 'System Voltage in V',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
