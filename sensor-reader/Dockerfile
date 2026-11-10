# node:20-slim instead of alpine — serialport needs native build tools
FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      build-essential \
      python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY sensor-reader.js ./

CMD ["node", "sensor-reader.js"]
