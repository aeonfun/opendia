// Shared harness helpers for the runtime test suites.
const { spawn } = require('child_process');
const path = require('path');

const SERVER = path.join(__dirname, 'server.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeAsserter() {
  const state = { failures: 0 };
  const assert = (label, cond, detail = '') => {
    console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${detail ? ' -> ' + detail : ''}`);
    if (!cond) state.failures++;
  };
  return { assert, state };
}

// Starts the server and resolves once it reports it is listening.
//
// Reads the ports back from the startup banner rather than assuming the
// requested ones were free: the server shifts to the next available port on a
// conflict, which would otherwise leave the test polling an address nothing is
// bound to. On failure the captured stderr is included, so a CI failure is
// diagnosable from the log alone.
function startServer({ wsPort, httpPort, timeoutMs = 30000 } = {}) {
  const proc = spawn('node', [SERVER, `--ws-port=${wsPort}`, `--http-port=${httpPort}`], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  let exited = null;
  proc.stderr.on('data', (c) => { stderr += c.toString(); });
  proc.on('exit', (code, signal) => { exited = { code, signal }; });

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const fail = (why) => {
      try { proc.kill(); } catch { /* already gone */ }
      reject(new Error(
        `${why}\n--- server stderr ---\n${stderr.trim() || '(no output)'}\n---------------------`
      ));
    };

    const poll = () => {
      if (exited) {
        return fail(`server exited early (code=${exited.code} signal=${exited.signal})`);
      }
      // "🌐 HTTP/SSE server running on 127.0.0.1:5556"
      const listening = stderr.match(/HTTP\/SSE server running on\s+(\S+):(\d+)/);
      // "✅ Ports resolved: WebSocket=5555, HTTP=5556"
      const resolved = stderr.match(/Ports resolved:\s*WebSocket=(\d+),\s*HTTP=(\d+)/);
      if (listening && resolved) {
        return resolve({
          proc,
          host: listening[1],
          wsPort: Number(resolved[1]),
          httpPort: Number(resolved[2]),
          stderr: () => stderr,
        });
      }
      if (Date.now() > deadline) return fail(`server did not report listening within ${timeoutMs}ms`);
      setTimeout(poll, 150);
    };
    poll();
  });
}

module.exports = { sleep, makeAsserter, startServer };
