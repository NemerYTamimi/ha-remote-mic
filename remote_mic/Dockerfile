ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM $BUILD_FROM

RUN apk add --no-cache \
    nodejs \
    npm \
    alsa-utils \
    pulseaudio-utils

WORKDIR /app

COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev

COPY server/ ./

COPY rootfs /
RUN chmod a+x /etc/services.d/remote-mic/run
