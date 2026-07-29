// Protocol tests: drives the real server over stdio and SSE.
//
// Covers notifications/tools/list_changed, which exists because the extension
// connects independently of the MCP client: a client that lists tools before
// the extension is up gets fallback schemas, and without this notification it
// would keep them for the whole session.
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const SERVER = path.join(__dirname, 'server.js');
const WS_PORT = 45551;
const HTTP_PORT = 45552;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function assert(label, cond, detail = '') {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${detail ? ' -> ' + detail : ''}`);
  if (!cond) failures++;
}

// The server shifts to another port when one is busy, which would silently
// point the rest of the test at nothing. Confirm it took the ports we asked for.
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

async function run() {
  const srv = spawn('node', [SERVER, `--ws-port=${WS_PORT}`, `--http-port=${HTTP_PORT}`], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  srv.stderr.on('data', () => {});

  const frames = [];
  let buf = '';
  srv.stdout.on('data', (c) => {
    buf += c.toString();
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const l of lines) {
      if (!l.trim()) continue;
      try { frames.push(JSON.parse(l)); } catch { /* non-JSON */ }
    }
  });

  const send = (o) => srv.stdin.write(JSON.stringify(o) + '\n');
  const notes = () => frames.filter((f) => f.method === 'notifications/tools/list_changed');
  const resultFor = (id) => frames.find((f) => f.id === id)?.result;

  try {
    const ports = await waitForServer();
    assert('server listening on requested ports', ports.websocket === WS_PORT,
      `ws=${ports.websocket}`);

    // --- initialize ---
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'test' } } });
    await sleep(300);
    assert('initialize declares tools.listChanged',
      resultFor(1)?.capabilities?.tools?.listChanged === true);

    // --- cold tools/list, before the extension connects ---
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await sleep(300);
    const before = resultFor(2)?.tools || [];
    assert('cold tools/list returns fallback tools', before.length > 0, `${before.length} tools`);
    assert('no notification before anything changed', notes().length === 0);

    // --- SSE stream, opened before the change so it can receive the push ---
    const sseFrames = [];
    await new Promise((resolve, reject) => {
      const req = http.get(
        { host: '127.0.0.1', port: HTTP_PORT, path: '/sse', headers: { Accept: 'text/event-stream' } },
        (res) => {
          assert('SSE stream opened', res.statusCode === 200, `HTTP ${res.statusCode}`);
          res.on('data', (c) => {
            for (const block of c.toString().split('\n\n')) {
              const line = block.trim();
              if (!line.startsWith('data: ')) continue;
              try { sseFrames.push(JSON.parse(line.slice(6))); } catch { /* ignore */ }
            }
          });
          resolve();
        }
      );
      req.on('error', reject);
    });
    await sleep(300);

    // --- a fake extension registers its tools ---
    const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    const tools = [
      { name: 'page_analyze', description: 'x', inputSchema: { type: 'object', properties: { tab_id: { type: 'number' } } } },
      { name: 'element_click', description: 'x', inputSchema: { type: 'object', properties: { tab_id: { type: 'number' } } } },
    ];
    ws.send(JSON.stringify({ type: 'register', tools }));
    await sleep(600);

    assert('notification sent after extension registers', notes().length === 1,
      `${notes().length} sent`);
    const n = notes()[0];
    assert('notification is a well-formed JSON-RPC notification',
      n && n.jsonrpc === '2.0' && !('id' in n), JSON.stringify(n));
    assert('notification also delivered over SSE',
      sseFrames.filter((f) => f.method === 'notifications/tools/list_changed').length === 1);

    // --- re-list now returns the extension's schemas ---
    send({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    await sleep(300);
    const after = resultFor(3)?.tools || [];
    assert('re-list returns extension tools', after.length === 2, `${after.length} tools`);
    assert('extension schemas carry tab_id',
      after.every((t) => t.inputSchema?.properties?.tab_id));

    // --- an unchanged re-register must not re-notify ---
    ws.send(JSON.stringify({ type: 'register', tools }));
    await sleep(400);
    assert('identical re-register does not re-notify', notes().length === 1,
      `${notes().length} total`);

    // --- disconnect reverts the list, so notify again ---
    ws.close();
    await sleep(700);
    assert('notification sent on extension disconnect', notes().length === 2,
      `${notes().length} total`);
  } finally {
    srv.kill();
    await sleep(200);
  }
}

run()
  .then(() => {
    console.log(failures === 0 ? '\n✅ Protocol tests passed' : `\n❌ ${failures} failure(s)`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error('❌ Harness error:', e.message);
    process.exit(1);
  });
