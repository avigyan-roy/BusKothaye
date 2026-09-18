#!/usr/bin/env node
/**
 * Copy the repository's *source* into /mnt/user-data/outputs/buskothay so the
 * session can write it onto the user's own drive.
 *
 * This is a workflow helper for the AI build session, not part of the product.
 * It exists because the cloud workspace and the user's disk are different
 * filesystems; it deliberately skips node_modules, build output and anything
 * that must never leave the machine it was created on.
 */
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';

const SOURCE = resolve(process.argv[2] ?? '/home/claude/buskothay');
const DEST = resolve(process.argv[3] ?? '/mnt/user-data/outputs/buskothay');

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'coverage',
  'playwright-report',
  'test-results',
  '.dynamodb-local',
  'out',
]);
const SKIP_FILES = new Set(['.DS_Store']);

async function walk(dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name), acc);
    } else if (entry.isFile()) {
      if (SKIP_FILES.has(entry.name)) continue;
      if (entry.name.endsWith('.tsbuildinfo')) continue;
      if (entry.name === '.env' || entry.name.startsWith('.env.')) {
        if (!entry.name.endsWith('.example')) continue;
      }
      acc.push(join(dir, entry.name));
    }
  }
  return acc;
}

const files = await walk(SOURCE);
await rm(DEST, { recursive: true, force: true });
for (const file of files) {
  const rel = relative(SOURCE, file);
  const target = join(DEST, rel);
  await mkdir(resolve(target, '..'), { recursive: true });
  await cp(file, target);
}

let bytes = 0;
for (const file of files) bytes += (await stat(file)).size;

console.log(`${files.length} files, ${(bytes / 1024).toFixed(0)} KiB staged at ${DEST}`);
for (const file of files.sort()) console.log(relative(SOURCE, file));
