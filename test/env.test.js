'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadDotEnv } = require('../lib/env');

// Write a throwaway .env in a fresh temp dir and return the dir path.
function tmpDirWithEnv(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-read-env-'));
  if (contents !== null) fs.writeFileSync(path.join(dir, '.env'), contents);
  return dir;
}

test('loads a KEY=VALUE pair into the target env object', () => {
  const dir = tmpDirWithEnv('ZYTE_API_KEY=abc123\n');
  const env = {};
  const loaded = loadDotEnv(dir, env);
  assert.equal(env.ZYTE_API_KEY, 'abc123');
  assert.deepEqual(loaded, ['ZYTE_API_KEY']);
});

test('does not overwrite an already-set variable', () => {
  const dir = tmpDirWithEnv('ZYTE_API_KEY=fromfile\n');
  const env = { ZYTE_API_KEY: 'preexisting' };
  const loaded = loadDotEnv(dir, env);
  assert.equal(env.ZYTE_API_KEY, 'preexisting');
  assert.deepEqual(loaded, []); // nothing newly set
});

test('strips surrounding single and double quotes from values', () => {
  const dir = tmpDirWithEnv('A="quoted"\nB=\'single\'\n');
  const env = {};
  loadDotEnv(dir, env);
  assert.equal(env.A, 'quoted');
  assert.equal(env.B, 'single');
});

test('ignores comments and malformed lines', () => {
  const dir = tmpDirWithEnv('# a comment\nNOT A PAIR\nGOOD=yes\n\n');
  const env = {};
  const loaded = loadDotEnv(dir, env);
  assert.deepEqual(loaded, ['GOOD']);
  assert.equal(env.GOOD, 'yes');
});

test('is a no-op (returns []) when .env is missing', () => {
  const dir = tmpDirWithEnv(null); // no file written
  const env = {};
  const loaded = loadDotEnv(dir, env);
  assert.deepEqual(loaded, []);
  assert.deepEqual(env, {});
});
