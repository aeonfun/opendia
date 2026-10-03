// Config tests: the OPENDIA_* environment fallbacks.
//
// The Claude Desktop DXT passes its user_config settings to the server as env
// variables, so these are the only way those settings reach it. Flags must keep
// winning over env, a bad env port must fail loudly, and an optional value the
// user left blank must count as unset.
const http = require('http');
const { spawnSync } = require('child_process');
const { SERVER, sleep, makeAsserter, startServer } = require('./test-helpers');

const { assert, state } = makeAsserter();

// Start from an env with no OPENDIA_* leaking in from the caller's shell.
const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('OPENDIA_'))
);

// Keeps ngrok off PATH so the tunnel path runs without opening a real tunnel.
const NO_NGROK = { PATH: '/nonexistent' };

function getJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function postStatus(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/json' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end('{}');
  });
}

async function withServer(opts, fn) {
  const srv = await startServer({ ...opts, env: { ...baseEnv, ...opts.env } });
  srv.proc.stdout.on('data', () => {});
  try {
    await fn(srv);
  } finally {
    srv.proc.kill();
    await sleep(200);
  }
}

function runSync(env) {
  return spawnSync(process.execPath, [SERVER], {
    env: { ...baseEnv, ...env },
    input: '',
    encoding: 'utf8',
    timeout: 10000,
  });
}

async function run() {
  // --- Env ports are used when no flag is given ---
  await withServer({ args: [], env: { OPENDIA_WS_PORT: '45561', OPENDIA_HTTP_PORT: '45562' } },
    async (srv) => {
      assert('env ports bind', srv.wsPort === 45561 && srv.httpPort === 45562,
        `ws=${srv.wsPort} http=${srv.httpPort}`);
      const { body } = await getJson(srv.httpPort, '/ports');
      assert('/ports reports the env ports', body.websocket === 45561 && body.http === 45562,
        JSON.stringify(body));
    });

  // --- Flags win over env ---
  await withServer({
    args: ['--ws-port=45563', '--http-port=45564'],
    env: { OPENDIA_WS_PORT: '45561', OPENDIA_HTTP_PORT: '45562' },
  }, async (srv) => {
    assert('--ws-port/--http-port override env', srv.wsPort === 45563 && srv.httpPort === 45564,
      `ws=${srv.wsPort} http=${srv.httpPort}`);
  });

  await withServer({
    args: ['--port=45565'],
    env: { OPENDIA_WS_PORT: '45561', OPENDIA_HTTP_PORT: '45562' },
  }, async (srv) => {
    assert('--port overrides both env ports (http = port+1)',
      srv.wsPort === 45565 && srv.httpPort === 45566, `ws=${srv.wsPort} http=${srv.httpPort}`);
  });

  // --- Bad env ports fail with a usage error ---
  for (const [name, value] of [['OPENDIA_WS_PORT', 'abc'], ['OPENDIA_HTTP_PORT', '70000']]) {
    const res = runSync({ [name]: value });
    assert(`${name}=${value} exits non-zero`, res.status === 1, `status=${res.status}`);
    assert(`${name}=${value} names the bad value`,
      res.stderr.includes(`${name}=${value} is not a valid port`), res.stderr.trim().split('\n')[0]);
  }

  // --- Tunnel + token from env ---
  await withServer({
    args: ['--ws-port=45567', '--http-port=45568'],
    env: { ...NO_NGROK, OPENDIA_ENABLE_TUNNEL: 'Yes', OPENDIA_TOKEN: 'env-token-123' },
  }, async (srv) => {
    await sleep(300);
    const out = srv.stderr();
    assert('OPENDIA_ENABLE_TUNNEL=Yes starts the tunnel', out.includes('Starting automatic tunnel'));
    assert('OPENDIA_TOKEN is the /sse token', out.includes('/sse token: env-token-123'));
    assert('/sse rejects a request without the token', await postStatus(srv.httpPort, '/sse') === 401);
  });

  await withServer({
    args: ['--ws-port=45567', '--http-port=45568', '--token=flag-token-456'],
    env: { ...NO_NGROK, OPENDIA_ENABLE_TUNNEL: 'true', OPENDIA_TOKEN: 'env-token-123' },
  }, async (srv) => {
    assert('--token overrides OPENDIA_TOKEN', srv.stderr().includes('/sse token: flag-token-456'));
  });

  // A blank optional DXT field arrives as "" or as the raw placeholder; either
  // way the server must generate a token rather than adopt the literal.
  for (const blank of ['', '${user_config.auth_token}']) {
    await withServer({
      args: ['--ws-port=45567', '--http-port=45568'],
      env: { ...NO_NGROK, OPENDIA_ENABLE_TUNNEL: '1', OPENDIA_TOKEN: blank },
    }, async (srv) => {
      const token = srv.stderr().match(/\/sse token: (\S+)/)?.[1];
      assert(`OPENDIA_TOKEN=${JSON.stringify(blank)} counts as unset`,
        /^[0-9a-f]{48}$/.test(token || ''), `token=${token}`);
    });
  }

  await withServer({
    args: ['--ws-port=45567', '--http-port=45568'],
    env: { ...NO_NGROK, OPENDIA_ENABLE_TUNNEL: 'false', OPENDIA_TOKEN: 'env-token-123' },
  }, async (srv) => {
    const out = srv.stderr();
    assert('OPENDIA_ENABLE_TUNNEL=false stays local',
      out.includes('LOCAL MODE') && !out.includes('Starting automatic tunnel'));
    assert('no token required locally', !out.includes('/sse token:'));
  });
}

run()
  .then(() => {
    console.log(state.failures === 0 ? '\n✅ Config tests passed' : `\n❌ ${state.failures} failure(s)`);
    process.exit(state.failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error('❌ Harness error:', e.message);
    process.exit(1);
  });
