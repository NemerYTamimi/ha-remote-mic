'use strict';

const { spawn } = require('child_process');
const express = require('express');
const path = require('path');
const http = require('http');
const fs = require('fs');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
  } catch {
    return {};
  }
}

const cfg = loadConfig();
const SAMPLE_RATE = cfg.sample_rate || 44100;
const CHANNELS = cfg.channels || 1;
const BIT_DEPTH = cfg.bit_depth || 16;
const DEVICE = cfg.device || '';
const PORT = 8765;

console.log(`[config] rate=${SAMPLE_RATE} ch=${CHANNELS} bits=${BIT_DEPTH} device="${DEVICE || '(default)'}"`);
console.log(`[config] PULSE_SERVER=${process.env.PULSE_SERVER || '(not set)'}`);

const app = express();
const server = http.createServer(app);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/config', (_req, res) => {
  res.json({ sampleRate: SAMPLE_RATE, channels: CHANNELS, bitDepth: BIT_DEPTH });
});

// Set of active HTTP streaming responses
const listeners = new Set();

let recorder = null;

function wavHeader(sampleRate, channels, bitDepth) {
  // Write a WAV header with "infinite" data length so browsers stream forever
  const buf = Buffer.alloc(44);
  const byteRate = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(0xffffffff, 4);      // chunk size — infinite
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);             // subchunk size
  buf.writeUInt16LE(1, 20);             // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitDepth, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(0xffffffff, 40);    // data size — infinite
  return buf;
}

function startRecorder() {
  const args = [
    '--record',
    '--raw',
    `--rate=${SAMPLE_RATE}`,
    `--channels=${CHANNELS}`,
    '--format=s16le',
    '--latency-msec=50',
    ...(DEVICE ? [`--device=${DEVICE}`] : []),
  ];

  console.log(`[recorder] pacat ${args.join(' ')}`);
  const proc = spawn('pacat', args);

  proc.stdout.on('data', (chunk) => {
    for (const res of listeners) {
      res.write(chunk);
    }
  });

  proc.stderr.on('data', (d) => console.error(`[recorder] ${d.toString().trim()}`));

  proc.on('close', (code) => {
    console.warn(`[recorder] exited (code ${code}), restarting in 2s…`);
    recorder = null;
    setTimeout(() => {
      if (listeners.size > 0) startRecorder();
    }, 2000);
  });

  recorder = proc;
}

function stopRecorder() {
  if (recorder) {
    recorder.kill();
    recorder = null;
  }
}

// Browser connects here and receives a live WAV stream
app.get('/stream.wav', (req, res) => {
  console.log(`[stream] client connected from ${req.socket.remoteAddress}`);

  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.setHeader('Connection', 'keep-alive');

  // Send WAV header so the browser knows the audio format immediately
  res.write(wavHeader(SAMPLE_RATE, CHANNELS, BIT_DEPTH));

  listeners.add(res);
  if (!recorder) startRecorder();

  req.on('close', () => {
    listeners.delete(res);
    console.log(`[stream] client disconnected — total: ${listeners.size}`);
    if (listeners.size === 0) stopRecorder();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] listening on http://0.0.0.0:${PORT}`);
});
