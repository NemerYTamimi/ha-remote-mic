'use strict';

const { spawn, execSync } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');
const http  = require('http');
const path  = require('path');
const fs    = require('fs');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
function loadOptions() {
  try { return JSON.parse(fs.readFileSync('/data/options.json', 'utf8')); }
  catch { return {}; }
}

const opt         = loadOptions();
const DEVICE      = opt.device      || '';   // PulseAudio source name, '' = default
const SAMPLE_RATE = opt.sample_rate || 44100;
const CHANNELS    = opt.channels    || 1;
const BIT_DEPTH   = opt.bit_depth   || 16;
const PORT        = 8765;

// ---------------------------------------------------------------------------
// PulseAudio socket — HA supervisor sets PULSE_SERVER when audio:true,
// but falls back to the known HA OS path just in case.
// ---------------------------------------------------------------------------
if (!process.env.PULSE_SERVER) {
  process.env.PULSE_SERVER = 'unix:/run/audio/pulse.sock';
}
if (!process.env.PULSE_COOKIE && fs.existsSync('/root/.config/pulse/cookie')) {
  process.env.PULSE_COOKIE = '/root/.config/pulse/cookie';
}

console.log('[remote-mic] starting v2.1.0');
console.log(`[remote-mic] PULSE_SERVER=${process.env.PULSE_SERVER}`);
console.log(`[remote-mic] device="${DEVICE||'(default)'}"  rate=${SAMPLE_RATE}  ch=${CHANNELS}  bits=${BIT_DEPTH}`);

// List PulseAudio sources for diagnostics
try {
  const src = execSync('pactl list sources short 2>&1').toString().trim();
  console.log('[remote-mic] PulseAudio sources:\n' + src);
} catch (e) {
  console.warn('[remote-mic] pactl list sources failed:', e.message);
}

// ---------------------------------------------------------------------------
// HTTP + WebSocket
// ---------------------------------------------------------------------------
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: '/ws' });

app.use(express.static(path.join(__dirname, 'public')));

app.get('/config', (_req, res) => {
  res.json({ sampleRate: SAMPLE_RATE, channels: CHANNELS, bitDepth: BIT_DEPTH, port: PORT });
});

// List PulseAudio capture sources so the UI can offer a picker
app.get('/devices', (_req, res) => {
  try {
    // pactl list sources short → columns: index name driver state
    const raw = execSync('pactl list sources short 2>&1').toString();
    const devices = [];
    for (const line of raw.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2 && !parts[1].includes('monitor')) {
        devices.push({ value: parts[1], label: parts[1] });
      }
    }
    res.json({ devices, current: DEVICE });
  } catch {
    res.json({ devices: [], current: DEVICE });
  }
});

// ---------------------------------------------------------------------------
// Recorder — pacat → raw PCM → WebSocket clients
// ---------------------------------------------------------------------------
let recorder  = null;
const clients = new Set();

function startRecorder() {
  const args = [
    '--record', '--raw',
    `--rate=${SAMPLE_RATE}`,
    `--channels=${CHANNELS}`,
    '--format=s16le',
    '--latency-msec=100',
    ...(DEVICE ? [`--device=${DEVICE}`] : []),
  ];
  console.log('[recorder] pacat', args.join(' '));

  const proc = spawn('pacat', args);

  proc.stdout.on('data', chunk => {
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(chunk, { binary: true });
    }
  });

  proc.stderr.on('data', d => console.error('[recorder]', d.toString().trim()));

  proc.on('close', code => {
    console.warn(`[recorder] exited (${code}), retry in 2 s`);
    recorder = null;
    if (clients.size > 0) setTimeout(startRecorder, 2000);
  });

  recorder = proc;
}

function stopRecorder() { recorder?.kill(); recorder = null; }

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
wss.on('connection', (ws, req) => {
  console.log(`[ws] +  ${req.socket.remoteAddress}  total=${clients.size + 1}`);
  clients.add(ws);
  if (!recorder) startRecorder();

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[ws] -  total=${clients.size}`);
    if (!clients.size) stopRecorder();
  });
  ws.on('error', err => { console.error('[ws] error', err.message); clients.delete(ws); });
  ws.on('message', () => {});
});

server.listen(PORT, '0.0.0.0', () =>
  console.log(`[remote-mic] ready  http://0.0.0.0:${PORT}`));
