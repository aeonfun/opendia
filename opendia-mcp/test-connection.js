// Runtime tests for the extension's ConnectionManager, driven against the real
// MCP server. Lives here rather than in opendia-extension because it needs both
// the server and the `ws` client, which are this package's dependencies; it
// reads the extension source directly and never imports from that package.
//
// Simulates Firefox MV2 (importScripts undefined -> isServiceWorker false, a
// manifest with applications.gecko -> isFirefox true). That is the path which
// installs a heartbeat and schedules reconnects, so it is where a stale socket
// event does the most damage.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const WebSocket = require('ws');
const { sleep, makeAsserter, startServer } = require('./test-helpers');

const BACKGROUND = path.join(__dirname, '..', 'opendia-extension', 'src', 'background', 'background.js');
const WS_PORT = 45553;
const HTTP_PORT = 45554;

const { assert, state } = makeAsserter();

// Loads the real background.js under stubbed extension globals.
function loadBackground(wsPort, httpPort) {
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
          websocket: wsPort,
          http: httpPort,
          websocketUrl: `ws://127.0.0.1:${wsPort}`,
          httpUrl: `http://127.0.0.1:${httpPort}`,
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
  const { proc: srv, wsPort, httpPort } = await startServer({ wsPort: WS_PORT, httpPort: HTTP_PORT });
  srv.stdout.on('data', () => {});

  try {
    assert('server listening', wsPort > 0 && httpPort > 0, `ws=${wsPort} http=${httpPort}`);

    const cm = loadBackground(wsPort, httpPort);
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
    console.log(state.failures === 0 ? '\n✅ Connection tests passed' : `\n❌ ${state.failures} failure(s)`);
    process.exit(state.failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error('❌ Harness error:', e.message);
    process.exit(1);
  });
