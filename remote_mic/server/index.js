'use strict';

const { spawn } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const http = require('http');
const fs = require('fs');

// HA supervisor writes add-on config to /data/options.json before start
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
// pacat outputs s16le always; BIT_DEPTH kept for /config endpoint info
const DEVICE = cfg.device || '';  // empty = PulseAudio default source
const PORT = 8765;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/stream' });

app.use(express.static(path.join(__dirname, 'public')));

// Send config so the browser knows how to set up AudioContext
app.get('/config', (_req, res) => {
  res.json({ sampleRate: SAMPLE_RATE, channels: CHANNELS, bitDepth: BIT_DEPTH });
});

let recorder = null;
let clients = new Set();

function startRecorder() {
  // HA supervisor sets PULSE_SERVER when audio:true — pacat uses it directly.
  // arecord -D pulse fails in Alpine because ALSA's pulse plugin isn't configured.
  const cmd = 'pacat';
  const args = [
    '--record',
    '--raw',
    `--rate=${SAMPLE_RATE}`,
    `--channels=${CHANNELS}`,
    '--format=s16le',
    '--latency-msec=50',
    ...(DEVICE ? [`--device=${DEVICE}`] : []),
  ];

  console.log(`[recorder] launching: ${cmd} ${args.join(' ')}`);
  const proc = spawn(cmd, args);

  proc.stdout.on('data', (chunk) => {
    for (const client of clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(chunk, { binary: true });
      }
    }
  });

  proc.stderr.on('data', (d) => console.error(`[recorder] ${d.toString().trim()}`));

  proc.on('close', (code) => {
    console.warn(`[recorder] exited with code ${code}, restarting in 2s…`);
    recorder = null;
    setTimeout(() => {
      if (clients.size > 0) startRecorder();
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

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[ws] client connected from ${ip} — total: ${clients.size + 1}`);
  clients.add(ws);

  if (!recorder) startRecorder();

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[ws] client disconnected — total: ${clients.size}`);
    if (clients.size === 0) stopRecorder();
  });

  ws.on('error', (err) => {
    console.error(`[ws] client error: ${err.message}`);
    clients.delete(ws);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] listening on http://0.0.0.0:${PORT}`);
});

function bitDepthToAlsaFormat(bits) {
  const map = { 8: 'U8', 16: 'S16_LE', 24: 'S24_LE', 32: 'S32_LE' };
  return map[bits] || 'S16_LE';
}
