# Развёртывание на Rock Pi 4A

Инструкция по развёртыванию системы мониторинга на **Rock Pi 4A** (ARM64) с чтением данных с UART-датчика.

**Целевая ОС:** Armbian с Debian 13 (Trixie)

## 1. Подготовка Rock Pi 4A

### Установка Armbian

Официальные образы: https://www.armbian.com/rockpi4a/

После установки — первоначальная настройка:

```bash
# Обновление системы
sudo apt update && sudo apt upgrade -y
```

### Установка Docker

```bash
# Установка Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Добавить пользователя в группу docker
sudo usermod -aG docker $USER
newgrp docker

# Docker Compose (включён в Docker Engine 24+)
# Проверка:
docker compose version
```

### Активация UART2

Датчик подключён к `/dev/ttyS2` (UART2). Этот порт нужно активировать:

```bash
# Через armbian-config
sudo armbian-config
# → System → Hardware → включить uart2 → сохранить → перезагрузить

# Или вручную через overlays:
sudo nano /boot/armbianEnv.txt
# Добавить строку:
# overlays=uart2

sudo reboot
```

Проверка после перезагрузки:
```bash
ls -la /dev/ttyS2
# Должно показать /dev/ttyS2

# Дать доступ текущему пользователю:
sudo usermod -aG dialout $USER
```

## 2. Перенос проекта

```bash
# С десктопа на Rock Pi через SCP
scp -r tech-monitor/ user@<rock-pi-ip>:/home/user/

# Или через git
git clone <your-repo> /home/user/tech-monitor
```

## 3. Архитектура проекта

```
tech-monitor/
├── backend/          # Express + Socket.IO API
├── frontend/         # React + Recharts (Vite → Nginx)
├── sensor-reader/    # Чтение UART-датчика (/dev/ttyS2)
├── simulator/        # Симулятор (для разработки на десктопе)
├── mysql/            # SQL-инициализация
├── docker-compose.yml         # Продакшн (sensor-reader)
└── docker-compose.dev.yml     # Разработка (simulator)
```

### Компоненты

| Сервис | Образ | Описание |
|--------|-------|----------|
| `mysql` | MariaDB 11 | БД (легче MySQL на ARM64) |
| `backend` | Node.js 20 | REST API + WebSocket |
| `sensor-reader` | Node.js 20 + serialport | Чтение UART, POST в backend |
| `frontend` | Nginx + React | Статический UI |

## 4. Подключение датчика

### Физическое подключение

UART2 на Rock Pi 4A (40-pin GPIO header):

| Сигнал | GPIO Pin | Функция |
|--------|----------|---------|
| UART2_TX | Pin 8 (GPIO4_C4) | Передача |
| UART2_RX | Pin 10 (GPIO4_C3) | Приём |
| GND | Pin 6, 9, 14, 20, 25, 30, 34, 39 | Земля |

Подключение датчика:
- **TX датчика** → **RX Rock Pi** (Pin 10)
- **GND датчика** → **GND Rock Pi** (Pin 6)
- Если датчик требует питание: **VCC** → **3.3V** (Pin 1) или **5V** (Pin 2, 4)

### Протокол датчика

- **Скорость:** 9600 бод, 8N1
- **Пакет:** 21 байт
- **Тип пакета:** байт `[3]` = `0x05` (SENSOR)
- **Температура:** байты `[18..19]`, signed int16, делить на 10 → °C

## 5. Запуск (продакшн)

```bash
cd /home/user/tech-monitor

# Сборка и запуск
docker compose up --build -d

# Проверка статуса
docker compose ps

# Логи sensor-reader (проверить чтение датчика)
docker compose logs -f sensor-reader

# Логи всех сервисов
docker compose logs -f
```

Открыть дашборд: `http://<rock-pi-ip>`

## 6. Запуск (разработка на десктопе)

На десктопе нет `/dev/ttyS2`, поэтому используем override-файл с симулятором:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d
```

## 7. Автозапуск при включении

```bash
sudo bash -c 'cat > /etc/systemd/system/techmonitor.service <<EOF
[Unit]
Description=Tech Monitor — UART Sensor Dashboard
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/user/tech-monitor
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down

[Install]
WantedBy=multi-user.target
EOF'

sudo systemctl daemon-reload
sudo systemctl enable techmonitor
sudo systemctl start techmonitor
```

> **Примечание:** Замените `/home/user/tech-monitor` на фактический путь проекта.

## 8. Настройка переменных окружения

Все настройки sensor-reader задаются через `docker-compose.yml`:

| Переменная | По умолчанию | Описание |
|-----------|-------------|----------|
| `SERIAL_PATH` | `/dev/ttyS2` | Путь к UART-порту |
| `BAUD_RATE` | `9600` | Скорость порта |
| `API_URL` | `http://backend:3001/api/data` | Адрес backend API |

## 9. Troubleshooting

### Sensor-reader не видит порт

```bash
# Проверить что порт существует
ls -la /dev/ttyS2

# Проверить overlay
cat /boot/armbianEnv.txt | grep uart

# Проверить что Docker имеет доступ
docker compose exec sensor-reader ls -la /dev/ttyS2
```

### Нет данных на дашборде

```bash
# Проверить логи sensor-reader
docker compose logs sensor-reader

# Проверить backend
docker compose logs backend

# Проверить здоровье API
curl http://localhost:3001/api/health
curl http://localhost:3001/api/readings/latest
```

### MariaDB не стартует

```bash
# Очистить данные и пересоздать
docker compose down -v
docker compose up --build -d
```
