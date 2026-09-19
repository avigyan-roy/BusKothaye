#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import process from 'node:process';

/**
 * Supervise the real fleet worker for Playwright and expose a separate readiness
 * port. Playwright's webServer manager expects every background command to own a
 * URL; the worker itself correctly owns none because it is an API client.
 */
const port = Number(process.env.FLEET_HEALTH_PORT ?? 3102);
const child = spawn(process.execPath, ['apps/simulator/dist/fleet-worker.js'], {
  env: process.env,
  stdio: 'inherit',
});
const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(child.exitCode === null ? 200 : 503, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    response.end(JSON.stringify({ status: child.exitCode === null ? 'ok' : 'stopped' }));
    return;
  }
  response.writeHead(404).end();
});

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (child.exitCode === null) child.kill('SIGTERM');
  server.close(() => process.exit(code));
  setTimeout(() => process.exit(code || 1), 3_000).unref();
}

child.on('exit', (code, signal) => {
  if (!shuttingDown) shutdown(signal === null ? (code ?? 1) : 1);
});
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
server.listen(port, '127.0.0.1');
