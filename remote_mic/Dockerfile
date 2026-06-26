FROM node:20-alpine

RUN apk add --no-cache alsa-utils pulseaudio-utils

WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev

COPY server/ ./

CMD ["node", "index.js"]
