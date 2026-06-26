'use strict';

const { spawn, execSync } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Config — read from /data/options.json (written by HA supervisor before start)
// ---------------------------------------------------------------------------
function loadOptions() {
  try { return JSON.parse(fs.readFileSync('/data/options.json', 'utf8')); }
  catch { return {}; }
}

const opt = loadOptions();
const DEVICE      = opt.device      || 'hw:0,0';
const SAMPLE_RATE = opt.sample_rate || 44100;
const CHANNELS    = opt.channels    || 1;
const BIT_DEPTH   = opt.bit_depth   || 16;
const PORT        = 8765;

const ALSA_FORMAT = { 8: 'U8', 16: 'S16_LE', 24: 'S24_LE', 32: 'S32_LE' }[BIT_DEPTH] || 'S16_LE';

console.log('[remote-mic] starting');
console.log(`[remote-mic] device=${DEVICE}  rate=${SAMPLE_RATE}  ch=${CHANNELS}  bits=${BIT_DEPTH}`);

// ---------------------------------------------------------------------------
// List available ALSA capture devices on startup for diagnostics
// ---------------------------------------------------------------------------
try {
  const list = execSync('arecord -l 2>&1').toString().trim();
  console.log('[remote-mic] ALSA capture devices:\n' + list);
} catch {
  console.warn('[remote-mic] arecord -l failed — /dev/snd may not be mounted');
}

// ---------------------------------------------------------------------------
// HTTP + WebSocket server
// ---------------------------------------------------------------------------
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: '/ws' });

app.use(express.static(path.join(__dirname, 'public')));

// Audio config + direct port so browser can connect outside ingress
app.get('/config', (_req, res) => {
  res.json({ sampleRate: SAMPLE_RATE, channels: CHANNELS, bitDepth: BIT_DEPTH, port: PORT });
});

// List capture devices — useful for the UI device picker
app.get('/devices', (_req, res) => {
  try {
    const raw = execSync('arecord -l 2>&1').toString();
    // Parse lines like: card 0: PCH [HDA Intel PCH], device 0: ALC... [Mic]
    const devices = [];
    for (const line of raw.split('\n')) {
      const m = line.match(/^card\s+(\d+).*?device\s+(\d+)/i);
      if (m) {
        const label = line.replace(/^card\s+\d+:\s*/i, '').trim();
        devices.push({ value: `hw:${m[1]},${m[2]}`, label });
      }
    }
    res.json({ devices, current: DEVICE });
  } catch (err) {
    res.json({ devices: [], current: DEVICE, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Audio recorder — spawns arecord, broadcasts raw PCM to all WS clients
// ---------------------------------------------------------------------------
let recorder  = null;
const clients = new Set();

function startRecorder() {
  const args = ['-D', DEVICE, '-r', String(SAMPLE_RATE), '-c', String(CHANNELS),
                '-f', ALSA_FORMAT, '-t', 'raw'];
  console.log(`[recorder] arecord ${args.join(' ')}`);

  const proc = spawn('arecord', args);

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

function stopRecorder() {
  recorder?.kill();
  recorder = null;
}

// ---------------------------------------------------------------------------
// WebSocket — one connection per browser tab
// ---------------------------------------------------------------------------
wss.on('connection', (ws, req) => {
  console.log(`[ws] connected  ${req.socket.remoteAddress}  total=${clients.size + 1}`);
  clients.add(ws);
  if (!recorder) startRecorder();

  ws.on('close',   () => { clients.delete(ws); console.log(`[ws] closed  total=${clients.size}`); if (!clients.size) stopRecorder(); });
  ws.on('error',   err => { console.error('[ws] error', err.message); clients.delete(ws); });
  ws.on('message', ()  => {}); // ignore any client messages
});

server.listen(PORT, '0.0.0.0', () =>
  console.log(`[remote-mic] ready  http://0.0.0.0:${PORT}`));
