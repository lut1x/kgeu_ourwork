FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY *.js *.sql ./
EXPOSE 3001
CMD ["node", "server.js"]
