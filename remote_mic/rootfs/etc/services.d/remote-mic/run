#!/usr/bin/with-contenv bashio

export SAMPLE_RATE=$(bashio::config 'sample_rate')
export CHANNELS=$(bashio::config 'channels')
export BIT_DEPTH=$(bashio::config 'bit_depth')
export AUDIO_DEVICE=$(bashio::config 'device')

bashio::log.info "Starting Remote Mic add-on"
bashio::log.info "  Device:      ${AUDIO_DEVICE}"
bashio::log.info "  Sample rate: ${SAMPLE_RATE} Hz"
bashio::log.info "  Channels:    ${CHANNELS}"
bashio::log.info "  Bit depth:   ${BIT_DEPTH}"

exec node /app/index.js
