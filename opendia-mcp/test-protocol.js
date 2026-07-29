// Protocol tests: drives the real server over stdio and SSE.
//
// Covers notifications/tools/list_changed, which exists because the extension
// connects independently of the MCP client: a client that lists tools before
// the extension is up gets fallback schemas, and without this notification it
// would keep them for the whole session.
const http = require('http');
const WebSocket = require('ws');
const { sleep, makeAsserter, startServer } = require('./test-helpers');

const WS_PORT = 45551;
const HTTP_PORT = 45552;

const { assert, state } = makeAsserter();

async function run() {
  const { proc: srv, httpPort, wsPort } = await startServer({ wsPort: WS_PORT, httpPort: HTTP_PORT });

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
    assert('server listening', wsPort > 0 && httpPort > 0, `ws=${wsPort} http=${httpPort}`);

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
        { host: '127.0.0.1', port: httpPort, path: '/sse', headers: { Accept: 'text/event-stream' } },
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
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
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
    console.log(state.failures === 0 ? '\n✅ Protocol tests passed' : `\n❌ ${state.failures} failure(s)`);
    process.exit(state.failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error('❌ Harness error:', e.message);
    process.exit(1);
  });
