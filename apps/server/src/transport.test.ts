import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { createTransport, CurlCffiTransport } from './transport.js';

const originalWorkerUrl = process.env.TEAMMGR_CURL_CFFI_URL;
let server: Server | undefined;

afterEach(async () => {
  if (originalWorkerUrl === undefined) delete process.env.TEAMMGR_CURL_CFFI_URL;
  else process.env.TEAMMGR_CURL_CFFI_URL = originalWorkerUrl;
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

describe('createTransport', () => {
  it('uses curl_cffi sidecar when TEAMMGR_CURL_CFFI_URL is configured', () => {
    process.env.TEAMMGR_CURL_CFFI_URL = 'http://127.0.0.1:3011';

    const transport = createTransport();

    assert.ok(transport instanceof CurlCffiTransport);
  });
});

describe('CurlCffiTransport', () => {
  it('posts the ChatGPT request to the sidecar worker', async () => {
    let received: unknown;
    server = createServer(async (req, res) => {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/fetch');
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      received = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 401, body: '{"detail":"Unauthorized"}' }));
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const transport = new CurlCffiTransport(`http://127.0.0.1:${port}`);

    const response = await transport.fetch({
      method: 'PATCH',
      path: '/backend-api/accounts/workspace/settings',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: '{"name":"New Team"}',
      proxy: 'http://request-proxy.example:8080'
    });

    assert.deepEqual(received, {
      method: 'PATCH',
      path: '/backend-api/accounts/workspace/settings',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: '{"name":"New Team"}',
      proxy: 'http://request-proxy.example:8080'
    });
    assert.deepEqual(response, { status: 401, body: '{"detail":"Unauthorized"}' });
  });
});
