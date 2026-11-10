CREATE TABLE IF NOT EXISTS collectors (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(100) NOT NULL,
 token_hash CHAR(64) NOT NULL UNIQUE,
 enabled BOOLEAN NOT NULL DEFAULT TRUE,
 baud_rate INT NOT NULL DEFAULT 115200,
 last_seen DATETIME(3) NULL,
 status_json JSON NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS collector_devices (
 collector_id INT UNSIGNED NOT NULL,
 device_id VARCHAR(64) NOT NULL,
 channel VARCHAR(32) NOT NULL,
 name VARCHAR(100) NOT NULL,
 port VARCHAR(150) NOT NULL,
 last_seen DATETIME(3) NOT NULL,
 PRIMARY KEY (collector_id,device_id,channel),
 FOREIGN KEY (collector_id) REFERENCES collectors(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS collector_channels (
 collector_id INT UNSIGNED NOT NULL,
 device_id VARCHAR(64) NOT NULL,
 channel VARCHAR(32) NOT NULL,
 sensor_id INT UNSIGNED NOT NULL UNIQUE,
 input_min DOUBLE NOT NULL,
 input_max DOUBLE NOT NULL,
 PRIMARY KEY (collector_id,device_id,channel),
 FOREIGN KEY (collector_id) REFERENCES collectors(id),
 FOREIGN KEY (sensor_id) REFERENCES sensors(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS collector_records (
 collector_id INT UNSIGNED NOT NULL,
 record_id CHAR(36) NOT NULL,
 payload_hash CHAR(64) NOT NULL,
 received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (collector_id,record_id),
 FOREIGN KEY (collector_id) REFERENCES collectors(id)
) ENGINE=InnoDB;
