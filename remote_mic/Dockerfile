ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM $BUILD_FROM

# Install Node.js, ALSA utils, and PulseAudio client
RUN apk add --no-cache \
    nodejs \
    npm \
    alsa-utils \
    pulseaudio-utils

WORKDIR /app

COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev

COPY server/ ./

RUN chmod +x /app/run.sh

CMD ["/app/run.sh"]
