// Runtime tests for the extension's ConnectionManager, driven against the real
// MCP server. Lives here rather than in opendia-extension because it needs both
// the server and the `ws` client, which are this package's dependencies; it
// reads the extension source directly and never imports from that package.
//
// Simulates Firefox MV2 (importScripts undefined -> isServiceWorker false, a
// manifest with applications.gecko -> isFirefox true). That is the path which
// installs a heartbeat and schedules reconnects, so it is where a stale socket
// event does the most damage.
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const WebSocket = require('ws');

const SERVER = path.join(__dirname, 'server.js');
const BACKGROUND = path.join(__dirname, '..', 'opendia-extension', 'src', 'background', 'background.js');
const WS_PORT = 45553;
const HTTP_PORT = 45554;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function assert(label, cond, detail = '') {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${detail ? ' -> ' + detail : ''}`);
  if (!cond) failures++;
}

function waitForServer(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(
        { host: '127.0.0.1', port: HTTP_PORT, path: '/ports', timeout: 1000 },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
          });
        }
      );
      req.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`server never came up on ${HTTP_PORT} (port busy?)`));
        } else {
          setTimeout(attempt, 250);
        }
      });
      req.on('timeout', () => req.destroy());
    };
    attempt();
  });
}

// Loads the real background.js under stubbed extension globals.
function loadBackground() {
  const manifest = { manifest_version: 2, applications: { gecko: { id: 'opendia@test' } } };
  const sandbox = {
    console: { log: () => {}, error: () => {}, warn: () => {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    WebSocket, Date, JSON, Promise, Error, Math, Array, Object, String, Number, Boolean,
    performance: { now: () => Date.now() },
    // discoverServerPorts probes a fixed port list that will not contain our
    // test port, so answer the first probe and point it at the real server.
    fetch: async (url) => {
      if (!url.includes(':5556/ports')) throw new Error('connection refused');
      return {
        ok: true,
        json: async () => ({
          websocket: WS_PORT,
          http: HTTP_PORT,
          websocketUrl: `ws://127.0.0.1:${WS_PORT}`,
          httpUrl: `http://127.0.0.1:${HTTP_PORT}`,
        }),
      };
    },
    chrome: undefined,
  };
  sandbox.globalThis = sandbox;
  sandbox.browser = {
    runtime: { getManifest: () => manifest, onMessage: { addListener: () => {} }, lastError: null },
    storage: { local: { get: (_keys, cb) => cb({}), set: () => {} } },
    tabs: { query: async () => [], get: async () => ({}), sendMessage: () => {} },
  };

  const ctx = vm.createContext(sandbox);
  // Top-level const/let stay lexical in a vm script, so export what we drive.
  const src = fs.readFileSync(BACKGROUND, 'utf8') + '\n;globalThis.__cm = connectionManager;';
  vm.runInContext(src, ctx, { filename: 'background.js' });
  return ctx.__cm;
}

async function run() {
  const srv = spawn('node', [SERVER, `--ws-port=${WS_PORT}`, `--http-port=${HTTP_PORT}`], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', () => {});
  srv.stderr.on('data', () => {});

  try {
    const ports = await waitForServer();
    assert('server listening on requested ports', ports.websocket === WS_PORT, `ws=${ports.websocket}`);

    const cm = loadBackground();
    assert('background.js loaded, ConnectionManager present', !!cm);
    assert('simulating Firefox MV2 (heartbeat path)',
      cm.isServiceWorker === false && !!cm.isFirefox);

    // --- A stale socket's events must not touch live connection state ---
    await cm.connect();
    await sleep(400);
    const socketA = cm.mcpSocket;
    assert('connected, socket A open', socketA && socketA.readyState === WebSocket.OPEN);
    assert('heartbeat installed', cm.heartbeatInterval !== null);
    assert('attempts reset on successful open', cm.reconnectAttempts === 0);

    // Open a second connection. The server closes the previous extension socket
    // when a new one arrives, so A's close event lands while B is the live one.
    await cm.createConnection();
    await sleep(800);
    const socketB = cm.mcpSocket;
    assert('socket replaced, B is current', socketB !== socketA);
    assert('socket A closed by the server', socketA.readyState === WebSocket.CLOSED);
    assert('socket B still open', socketB.readyState === WebSocket.OPEN);

    // The three things a stale close used to do to a healthy connection:
    assert('stale close did not clear the live heartbeat', cm.heartbeatInterval !== null);
    assert('stale close did not inflate the attempt counter', cm.reconnectAttempts === 0,
      `attempts=${cm.reconnectAttempts}`);
    assert('stale close did not arm a reconnect', cm.reconnectTimer === null,
      cm.reconnectTimer === null ? '' : 'ARMED');

    // --- One attempt increment per real failure, not two ---
    srv.kill();
    await sleep(600);
    cm.clearHeartbeat();
    cm.clearReconnectTimer();
    cm.reconnectAttempts = 0;
    cm.mcpSocket = null;

    try { await cm.createConnection(); } catch { /* expected */ }
    await sleep(900);
    assert('a failed connect increments attempts exactly once', cm.reconnectAttempts === 1,
      `attempts=${cm.reconnectAttempts}; 2 means onerror and onclose are both counting`);

    // --- Reconnect must be one-shot, not fixed-rate ---
    cm.clearReconnectTimer();
    cm.reconnectAttempts = 0;
    cm.scheduleReconnect();
    assert('reconnect scheduled', cm.reconnectTimer !== null);
    // Node marks a repeating timer with a non-null _repeat.
    assert('scheduled one-shot (setTimeout, not setInterval)',
      cm.reconnectTimer && cm.reconnectTimer._repeat === null,
      `_repeat=${cm.reconnectTimer && cm.reconnectTimer._repeat}`);
    cm.clearReconnectTimer();
    assert('clearReconnectTimer disarms it', cm.reconnectTimer === null);
  } finally {
    srv.kill();
    await sleep(200);
  }
}

run()
  .then(() => {
    console.log(failures === 0 ? '\n✅ Connection tests passed' : `\n❌ ${failures} failure(s)`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error('❌ Harness error:', e.message);
    process.exit(1);
  });
