'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  fetchViaZyte,
  shouldUseBrowser,
  recordRawFailure,
  recordSuccess,
  loadEscalation,
  saveEscalation,
  createZyteBudget,
  COST,
} = require('../lib/zyte');

// ---- a fake https.request, recording calls and replaying a scripted response.
// Mirrors the slice of the https.request contract that lib/zyte.js uses:
// request(options, cb) -> req with .on('error'), .setTimeout, .write, .end;
// cb(res) where res has .statusCode and emits 'data' then 'end'.
function makeFakeRequest({ statusCode = 200, body = '', netError = null } = {}) {
  const calls = [];
  function request(options, cb) {
    const written = [];
    let errHandler = null;
    const req = {
      on(ev, fn) { if (ev === 'error') errHandler = fn; return req; },
      setTimeout() { return req; },
      write(p) { written.push(p); },
      end() {
        calls.push({ options, payload: written.join('') });
        setImmediate(() => {
          if (netError) { if (errHandler) errHandler(netError); return; }
          const res = {
            statusCode,
            on(ev, h) {
              if (ev === 'data') h(Buffer.from(body));
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

function zyteRawResponse(html) {
  return JSON.stringify({ httpResponseBody: Buffer.from(html, 'utf8').toString('base64') });
}

// ---------------------------------------------------------------- fetchViaZyte

test('raw mode posts httpResponseBody:true and decodes the base64 body', async () => {
  const request = makeFakeRequest({ statusCode: 200, body: zyteRawResponse('<html>hi</html>') });
  const { html } = await fetchViaZyte('https://example.com/', { mode: 'raw', apiKey: 'k', request });
  assert.equal(html, '<html>hi</html>');
  const payload = JSON.parse(request.calls[0].payload);
  assert.equal(payload.url, 'https://example.com/');
  assert.equal(payload.httpResponseBody, true);
  assert.equal(request.calls[0].options.hostname, 'api.zyte.com');
  assert.equal(request.calls[0].options.auth, 'k:'); // key as username, empty password
});

test('browser mode posts browserHtml:true and returns the rendered html', async () => {
  const request = makeFakeRequest({ statusCode: 200, body: JSON.stringify({ browserHtml: '<html>rendered</html>' }) });
  const { html } = await fetchViaZyte('https://example.com/', { mode: 'browser', apiKey: 'k', request });
  assert.equal(html, '<html>rendered</html>');
  const payload = JSON.parse(request.calls[0].payload);
  assert.equal(payload.browserHtml, true);
  assert.equal(payload.httpResponseBody, undefined);
});

test('rejects on non-200 with the status code in the message', async () => {
  const request = makeFakeRequest({ statusCode: 451, body: 'domain-forbidden' });
  await assert.rejects(
    () => fetchViaZyte('https://theguardian.com/', { mode: 'raw', apiKey: 'k', request }),
    /451/,
  );
});

test('rejects when ZYTE api key is missing', async () => {
  const request = makeFakeRequest({ statusCode: 200, body: zyteRawResponse('x') });
  await assert.rejects(
    () => fetchViaZyte('https://example.com/', { mode: 'raw', apiKey: '', request }),
    /ZYTE_API_KEY/,
  );
});

test('rejects on a network error', async () => {
  const request = makeFakeRequest({ netError: new Error('ECONNRESET') });
  await assert.rejects(
    () => fetchViaZyte('https://example.com/', { mode: 'raw', apiKey: 'k', request }),
    /ECONNRESET|Network error/,
  );
});

test('rejects when a 200 response is missing the expected body field', async () => {
  const request = makeFakeRequest({ statusCode: 200, body: JSON.stringify({ unexpected: true }) });
  await assert.rejects(
    () => fetchViaZyte('https://example.com/', { mode: 'raw', apiKey: 'k', request }),
    /missing|body/i,
  );
});

// ----------------------------------------------------- escalation map (pure)

test('a fresh domain defaults to raw (shouldUseBrowser=false)', () => {
  assert.equal(shouldUseBrowser({}, 'bbc.com'), false);
});

test('flips a domain to browser only after 2 consecutive raw failures', () => {
  const map = {};
  recordRawFailure(map, 'ft.com');
  assert.equal(shouldUseBrowser(map, 'ft.com'), false, 'one failure stays raw');
  recordRawFailure(map, 'ft.com');
  assert.equal(shouldUseBrowser(map, 'ft.com'), true, 'two failures escalate');
});

test('a success resets the consecutive-failure counter (no premature flip)', () => {
  const map = {};
  recordRawFailure(map, 'ap.org');
  recordSuccess(map, 'ap.org');
  recordRawFailure(map, 'ap.org');
  assert.equal(shouldUseBrowser(map, 'ap.org'), false, 'counter reset by success');
});

test('escalation, once flipped to browser, stays browser', () => {
  const map = {};
  recordRawFailure(map, 'x.com');
  recordRawFailure(map, 'x.com');
  recordSuccess(map, 'x.com'); // a later browser-mode success must not de-escalate
  assert.equal(shouldUseBrowser(map, 'x.com'), true);
});

test('escalation map round-trips through disk; missing file loads as {}', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-read-esc-'));
  const file = path.join(dir, 'zyte-escalation.json');
  assert.deepEqual(loadEscalation(file), {});
  const map = {};
  recordRawFailure(map, 'a.com');
  recordRawFailure(map, 'a.com');
  saveEscalation(file, map);
  assert.equal(shouldUseBrowser(loadEscalation(file), 'a.com'), true);
});

// ----------------------------------------------------------- budget guard

test('budget tallies request count and per-mode estimated cost', () => {
  const b = createZyteBudget();
  b.charge('raw');
  b.charge('raw');
  b.charge('browser');
  const s = b.summary();
  assert.equal(s.count, 3);
  assert.equal(s.raw, 2);
  assert.equal(s.browser, 1);
  assert.ok(Math.abs(s.estCostUsd - (2 * COST.raw + 1 * COST.browser)) < 1e-9);
});

test('budget canSpend goes false at the hard cap', () => {
  const b = createZyteBudget({ hardCap: 2, warnAt: 1 });
  assert.equal(b.canSpend(), true);
  b.charge('raw');
  b.charge('raw');
  assert.equal(b.canSpend(), false, 'at hard cap, no more spending');
});

test('budget warns exactly when crossing the warn threshold', () => {
  const b = createZyteBudget({ hardCap: 10, warnAt: 2 });
  assert.equal(b.charge('raw').warned, false);
  assert.equal(b.charge('raw').warned, true, 'crosses warnAt on the 2nd');
  assert.equal(b.charge('raw').warned, false, 'only the crossing charge warns');
});
