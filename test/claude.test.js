'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { callClaudeOnce, callClaude, callHaiku, isRetryable } = require('../lib/claude');

// Fake https.request that replays a SCRIPT of responses (one per call). Each entry
// is { statusCode, body } or { netError } or { timeout: true }. When the script is
// exhausted, the last entry repeats. Records the JSON payload of every call.
function makeFakeRequest(script) {
  const calls = [];
  function request(options, cb) {
    const written = [];
    let errHandler = null;
    const req = {
      on(ev, fn) { if (ev === 'error') errHandler = fn; return req; },
      setTimeout(ms, fn) { req._timeoutCb = fn; return req; },
      destroy() {},
      write(p) { written.push(p); },
      end() {
        const i = Math.min(calls.length, script.length - 1);
        const r = script[i];
        calls.push({ options, payload: written.join('') });
        setImmediate(() => {
          if (r.timeout) { if (req._timeoutCb) req._timeoutCb(); return; }
          if (r.netError) { if (errHandler) errHandler(r.netError); return; }
          const res = {
            statusCode: r.statusCode,
            on(ev, h) {
              if (ev === 'data') h(Buffer.from(r.body || ''));
              else if (ev === 'end') h();
              return res;
            },
          };
          cb(res);
        });
      },
    };
    return req;
  }
  request.calls = calls;
  return request;
}

const ok = (text) => JSON.stringify({ content: [{ type: 'text', text }] });
const noSleep = () => Promise.resolve();
const silent = () => {}; // suppress retry logging (writing to stdout corrupts the node:test IPC channel)

// ----------------------------------------------------------- callClaudeOnce

test('callClaudeOnce resolves the message text and sends model + auth', async () => {
  const request = makeFakeRequest([{ statusCode: 200, body: ok('hello world') }]);
  const text = await callClaudeOnce('prompt', { apiKey: 'k', request });
  assert.equal(text, 'hello world');
  const payload = JSON.parse(request.calls[0].payload);
  assert.equal(payload.model, 'claude-sonnet-4-6'); // default model
  assert.equal(request.calls[0].options.headers['x-api-key'], 'k');
});

test('callClaudeOnce rejects when the API returns an error object', async () => {
  const request = makeFakeRequest([{ statusCode: 200, body: JSON.stringify({ error: { message: 'bad request' } }) }]);
  await assert.rejects(() => callClaudeOnce('p', { apiKey: 'k', request }), /bad request/);
});

test('callClaudeOnce rejects 5xx before attempting to parse the body', async () => {
  const request = makeFakeRequest([{ statusCode: 503, body: '<html>gateway</html>' }]);
  await assert.rejects(() => callClaudeOnce('p', { apiKey: 'k', request }), /HTTP 503/);
});

// ----------------------------------------------------------- isRetryable (rule #17)

test('isRetryable: transient classes retry', () => {
  assert.equal(isRetryable('Overloaded'), true);
  assert.equal(isRetryable('HTTP 429 from Anthropic API'), true);
  assert.equal(isRetryable('HTTP 503 from Anthropic API'), true);
  assert.equal(isRetryable('529 overloaded'), true);
  assert.equal(isRetryable('Network error: ECONNRESET'), true);
  assert.equal(isRetryable('Failed to parse API response: ...'), true);
});

test('isRetryable: a TIMEOUT is fatal, never retried (hard-won rule #17)', () => {
  assert.equal(isRetryable('API request exceeded 300s (non-retryable)'), false);
});

test('isRetryable: 4xx client errors are fatal', () => {
  assert.equal(isRetryable('HTTP 400 from Anthropic API'), false);
  assert.equal(isRetryable('some unknown error'), false);
});

// ----------------------------------------------------------- callClaude (retry)

test('callClaude retries a transient failure then succeeds', async () => {
  const request = makeFakeRequest([
    { statusCode: 503, body: 'gateway' },
    { statusCode: 200, body: ok('recovered') },
  ]);
  const text = await callClaude('p', { apiKey: 'k', request, sleep: noSleep, log: silent });
  assert.equal(text, 'recovered');
  assert.equal(request.calls.length, 2); // one failure + one success
});

test('callClaude gives up after maxRetries on persistent transient failure', async () => {
  const request = makeFakeRequest([{ statusCode: 503, body: 'gateway' }]);
  await assert.rejects(
    () => callClaude('p', { apiKey: 'k', request, sleep: noSleep, maxRetries: 2, log: silent }),
    /HTTP 503/,
  );
  assert.equal(request.calls.length, 3); // initial + 2 retries
});

test('callClaude does NOT retry a timeout — fails fast (rule #17)', async () => {
  const request = makeFakeRequest([{ timeout: true }]);
  await assert.rejects(
    () => callClaude('p', { apiKey: 'k', request, sleep: noSleep, maxRetries: 3 }),
    /300s|non-retryable/,
  );
  assert.equal(request.calls.length, 1); // no retry on timeout
});

test('callClaude does NOT retry a 4xx client error', async () => {
  const request = makeFakeRequest([{ statusCode: 400, body: JSON.stringify({ error: { message: 'invalid' } }) }]);
  await assert.rejects(() => callClaude('p', { apiKey: 'k', request, sleep: noSleep }), /invalid/);
  assert.equal(request.calls.length, 1);
});

// ----------------------------------------------------------- callHaiku

test('callHaiku targets the haiku model', async () => {
  const request = makeFakeRequest([{ statusCode: 200, body: ok('haiku reply') }]);
  const text = await callHaiku('p', { apiKey: 'k', request });
  assert.equal(text, 'haiku reply');
  assert.equal(JSON.parse(request.calls[0].payload).model, 'claude-haiku-4-5');
});
