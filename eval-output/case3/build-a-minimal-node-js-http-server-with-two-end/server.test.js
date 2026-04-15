const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

describe('Minimal HTTP Server', () => {
  let server;
  let baseUrl;

  before(async () => {
    const { createServer } = require('./server');
    server = createServer();
    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  // [TEST:WRITE] health-ok
  it('GET /health returns 200 with {"status":"ok"}', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await res.json();
    assert.deepStrictEqual(body, { status: 'ok' });
  });

  // [TEST:WRITE] health-extra-params
  it('GET /health?extra=ignored returns 200 with {"status":"ok"}', async () => {
    const res = await fetch(`${baseUrl}/health?extra=ignored`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await res.json();
    assert.deepStrictEqual(body, { status: 'ok' });
  });

  // [TEST:WRITE] echo-simple
  it('GET /echo?msg=hello returns 200 with {"message":"hello"}', async () => {
    const res = await fetch(`${baseUrl}/echo?msg=hello`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await res.json();
    assert.deepStrictEqual(body, { message: 'hello' });
  });

  // [TEST:WRITE] echo-url-encoded
  it('GET /echo?msg=hello%20world returns 200 with decoded message', async () => {
    const res = await fetch(`${baseUrl}/echo?msg=hello%20world`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await res.json();
    assert.deepStrictEqual(body, { message: 'hello world' });
  });

  // [TEST:WRITE] echo-multiple-msg
  it('GET /echo?msg=a&msg=b returns 200 with first value', async () => {
    const res = await fetch(`${baseUrl}/echo?msg=a&msg=b`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await res.json();
    assert.deepStrictEqual(body, { message: 'a' });
  });

  // [TEST:WRITE] echo-missing-msg
  it('GET /echo without msg returns 400', async () => {
    const res = await fetch(`${baseUrl}/echo`);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await res.json();
    assert.deepStrictEqual(body, { error: 'Missing required query parameter: msg' });
  });

  // [TEST:WRITE] echo-empty-msg
  it('GET /echo?msg= (empty) returns 400', async () => {
    const res = await fetch(`${baseUrl}/echo?msg=`);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await res.json();
    assert.deepStrictEqual(body, { error: 'Missing required query parameter: msg' });
  });

  // [TEST:WRITE] unknown-route
  it('GET /unknown returns 404', async () => {
    const res = await fetch(`${baseUrl}/unknown`);
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await res.json();
    assert.deepStrictEqual(body, { error: 'Not Found' });
  });

  // [TEST:WRITE] trailing-slash-404
  it('GET /health/ returns 404 (trailing slash not normalized)', async () => {
    const res = await fetch(`${baseUrl}/health/`);
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await res.json();
    assert.deepStrictEqual(body, { error: 'Not Found' });
  });

  // [TEST:WRITE] method-not-allowed
  it('POST /health returns 405', async () => {
    const res = await fetch(`${baseUrl}/health`, { method: 'POST' });
    assert.strictEqual(res.status, 405);
    assert.strictEqual(res.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await res.json();
    assert.deepStrictEqual(body, { error: 'Method Not Allowed' });
  });

  // [TEST:WRITE] content-type-header
  it('all responses include Content-Type application/json; charset=utf-8', async () => {
    const urls = [
      `${baseUrl}/health`,
      `${baseUrl}/echo?msg=test`,
      `${baseUrl}/echo`,
      `${baseUrl}/unknown`,
    ];
    for (const url of urls) {
      const res = await fetch(url);
      assert.strictEqual(
        res.headers.get('content-type'),
        'application/json; charset=utf-8',
        `Content-Type mismatch for ${url}`
      );
    }
  });

  // [TEST:WRITE] port-env-default
  it('createServer returns an http.Server instance', () => {
    const http = require('node:http');
    assert.ok(server instanceof http.Server);
  });
});
