#!/usr/bin/env node
/**
 * `npm run dev` — build the shared packages, then run the API and the web app
 * together, and shut both down cleanly on Ctrl-C.
 *
 * A small Node script rather than a shell one-liner so it behaves the same on
 * macOS, Linux and Windows, and so a path with a space in it does not break
 * somebody's morning.
 *
 * The API runs its *compiled* output with a TypeScript watcher beside it, not the
 * `.ts` source directly. Node's type stripping does not rewrite import
 * specifiers, and this project's ESM imports end in `.js` — running the source
 * would fail on the first import with a confusing "cannot find module app.js".
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import process, { loadEnvFile } from 'node:process';

const API_URL = 'http://localhost:3001';
const children = [];
let shuttingDown = false;

/**
 * Run an npm command without ever asking the OS to execute `npm.cmd` directly.
 *
 * On Windows `npm` is a batch file, and since the CVE-2024-27980 fix Node
 * refuses to spawn a `.cmd`/`.bat` without a shell — it throws `spawn EINVAL`
 * before the command ever starts. That is the whole story behind the
 * `spawn EINVAL` this script used to produce on Windows.
 *
 * The fix is to not go near the batch file. npm sets `npm_execpath` to its own
 * JavaScript entry point for every script it runs, so the child is a plain
 * `node npm-cli.js …` — no shell, no quoting rules, no platform branch. The
 * fallback only matters when this file is run as `node scripts/dev.mjs`
 * directly, and there Windows needs the shell that the batch file requires.
 */
const npmCli =
  typeof process.env.npm_execpath === 'string' && process.env.npm_execpath.endsWith('.js')
    ? process.env.npm_execpath
    : null;

function spawnNpm(args, options = {}) {
  if (npmCli !== null) {
    return spawn(process.execPath, [npmCli, ...args], { stdio: 'inherit', ...options });
  }
  return spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
}

// Keep local demo dispatch genuinely one-command. The API and worker receive
// the same per-run credential even when the developer has not created an .env
// yet. A configured value still wins, which keeps manual simulator commands and
// restart-persistent local setups working as documented.
if (existsSync('apps/api/.env')) loadEnvFile('apps/api/.env');
const simulatorToken =
  process.env.SIMULATOR_TOKEN ?? randomBytes(32).toString('hex');
const localEnv = { ...process.env, SIMULATOR_TOKEN: simulatorToken };

function track(name, child) {
  child.on('error', (error) => {
    if (shuttingDown) return;
    console.error(`\n${name} could not start: ${error.message}`);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (code !== 0 && signal === null) {
      console.error(`\n${name} exited with code ${code}. Shutting the rest down.`);
      shutdown(code ?? 1);
    }
  });
  children.push({ name, child });
  return child;
}

/** A Node process (the API, the demo worker): always safe to spawn directly. */
function runNode(name, args, options = {}) {
  return track(name, spawn(process.execPath, args, { stdio: 'inherit', ...options }));
}

/** An npm script in one of the workspaces. */
function runNpm(name, args, options = {}) {
  return track(name, spawnNpm(args, options));
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  setTimeout(() => {
    for (const { child } of children) {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    process.exit(code);
  }, 2000).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function npmRun(args) {
  return new Promise((resolve, reject) => {
    const child = spawnNpm(args);
    child.on('error', (error) =>
      reject(new Error(`${args.join(' ')} could not start: ${error.message}`)),
    );
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${args.join(' ')} failed with code ${code}`)),
    );
  });
}

try {
  console.log('Building shared packages, the API, and the demo worker…');
  await npmRun(['run', 'build:packages']);
  await npmRun(['run', 'build', '-w', '@buskothay/api']);
  await npmRun(['run', 'build', '-w', '@buskothay/simulator']);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(`\nAPI    → ${API_URL}`);
console.log('Web    → http://localhost:5173');
console.log('Worker → watching the admin demo switch');
console.log(`Try    → open http://localhost:5173/admin and sign in with admin / admin\n`);

// Recompile the API on change; `node --watch` then restarts on the new output.
runNpm('api:watch', ['run', 'watch', '-w', '@buskothay/api'], { env: localEnv });
runNode('api', [
  '--watch',
  // So that copying apps/api/.env.example to apps/api/.env actually does
  // something. Missing file is fine — every setting has a default.
  '--env-file-if-exists=apps/api/.env',
  'apps/api/dist/server.js',
], { env: localEnv });
runNpm('simulator:watch', ['run', 'watch', '-w', '@buskothay/simulator'], { env: localEnv });
runNode('fleet-worker', [
  '--watch',
  'apps/simulator/dist/fleet-worker.js',
], { env: { ...localEnv, API_BASE_URL: API_URL } });
runNpm('web', ['run', 'dev', '-w', '@buskothay/web'], { env: localEnv });

// Say clearly whether the API is actually up. A silent failure here is what
// makes the simulator fail later with nothing but "fetch failed".
setTimeout(async () => {
  if (shuttingDown) return;
  try {
    const response = await fetch(`${API_URL}/health`);
    if (!response.ok) throw new Error(String(response.status));
    console.log(`\n✓ API is responding at ${API_URL}\n`);
  } catch {
    console.error(
      `\n✗ The API is not responding at ${API_URL}. The web app will show ` +
        '"The route information could not be loaded."\n' +
        '  Look for an error above this line — the usual causes are a port already ' +
        'in use, or a bad value in apps/api/.env.\n',
    );
  }
}, 4000).unref();
