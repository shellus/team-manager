import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCatchAllTracingFetch,
  createTransport,
  CurlCffiTransport,
  fetchWithRawTrace,
  TracingTransport,
  type Transport
} from './transport.js';

const originalWorkerUrl = process.env.TEAMMGR_CURL_CFFI_URL;
const originalDataDir = process.env.TEAMMGR_DATA_DIR;
const originalTraceFile = process.env.TEAMMGR_UPSTREAM_TRACE_FILE;
let server: Server | undefined;
let tempDirectory: string | undefined;

afterEach(async () => {
  if (originalWorkerUrl === undefined) delete process.env.TEAMMGR_CURL_CFFI_URL;
  else process.env.TEAMMGR_CURL_CFFI_URL = originalWorkerUrl;
  if (originalDataDir === undefined) delete process.env.TEAMMGR_DATA_DIR;
  else process.env.TEAMMGR_DATA_DIR = originalDataDir;
  if (originalTraceFile === undefined) delete process.env.TEAMMGR_UPSTREAM_TRACE_FILE;
  else process.env.TEAMMGR_UPSTREAM_TRACE_FILE = originalTraceFile;
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
  tempDirectory = undefined;
});

describe('createTransport', () => {
  it('uses curl_cffi sidecar when TEAMMGR_CURL_CFFI_URL is configured', () => {
    process.env.TEAMMGR_CURL_CFFI_URL = 'http://127.0.0.1:3011';
    delete process.env.TEAMMGR_DATA_DIR;
    delete process.env.TEAMMGR_UPSTREAM_TRACE_FILE;

    const transport = createTransport();

    assert.ok(transport instanceof CurlCffiTransport);
  });

  it('enables raw tracing automatically for the runtime data directory', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'team-manager-trace-config-'));
    process.env.TEAMMGR_CURL_CFFI_URL = 'http://127.0.0.1:3011';
    process.env.TEAMMGR_DATA_DIR = tempDirectory;
    delete process.env.TEAMMGR_UPSTREAM_TRACE_FILE;

    const transport = createTransport();

    assert.ok(transport instanceof TracingTransport);
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
      res.end(
        JSON.stringify({
          status: 401,
          body: '{"detail":"Unauthorized"}',
          headers: [
            ['content-type', 'application/json'],
            ['set-cookie', 'session=raw-cookie']
          ],
          url: 'https://chatgpt.com/backend-api/accounts/workspace/settings',
          request: {
            method: 'PATCH',
            url: 'https://chatgpt.com/backend-api/accounts/workspace/settings',
            headers: [['Authorization', 'Bearer token']],
            body: '{"name":"New Team"}'
          },
          network: { primaryIp: '104.18.0.1', primaryPort: 443 },
          wire: [{
            type: 'request_headers',
            data: 'PATCH /backend-api/accounts/workspace/settings HTTP/2\r\n'
          }]
        })
      );
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const transport = new CurlCffiTransport(`http://127.0.0.1:${port}`);

    const response = await transport.fetch({
      method: 'PATCH',
      baseUrl: 'https://auth.openai.com',
      path: '/backend-api/accounts/workspace/settings',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: '{"name":"New Team"}',
      proxy: 'http://request-proxy.example:8080'
    });

    assert.deepEqual(received, {
      method: 'PATCH',
      baseUrl: 'https://auth.openai.com',
      path: '/backend-api/accounts/workspace/settings',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: '{"name":"New Team"}',
      proxy: 'http://request-proxy.example:8080'
    });
    assert.deepEqual(response, {
      status: 401,
      body: '{"detail":"Unauthorized"}',
      headers: [
        ['content-type', 'application/json'],
        ['set-cookie', 'session=raw-cookie']
      ],
      url: 'https://chatgpt.com/backend-api/accounts/workspace/settings',
      request: {
        method: 'PATCH',
        url: 'https://chatgpt.com/backend-api/accounts/workspace/settings',
        headers: [['Authorization', 'Bearer token']],
        body: '{"name":"New Team"}'
      },
      network: { primaryIp: '104.18.0.1', primaryPort: 443 },
      wire: [{
        type: 'request_headers',
        data: 'PATCH /backend-api/accounts/workspace/settings HTTP/2\r\n'
      }]
    });
  });
});

describe('TracingTransport', () => {
  it('writes the complete unredacted request and response to a private JSONL file', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'team-manager-raw-trace-'));
    const traceFile = join(tempDirectory, 'nested', 'upstream.jsonl');
    const inner: Transport = {
      async fetch() {
        return {
          status: 200,
          body: '{"seat_type":"codex"}',
          headers: [
            ['content-type', 'application/json'],
            ['set-cookie', 'upstream-session=secret']
          ],
          url: 'https://chatgpt.com/backend-api/accounts/workspace/users/member-1',
          request: {
            method: 'PATCH',
            url: 'https://chatgpt.com/backend-api/accounts/workspace/users/member-1',
            headers: [['Authorization', 'Bearer actual-upstream-token']],
            body: '{"seat_type":"codex"}'
          },
          network: { primaryIp: '104.18.0.1', primaryPort: 443 },
          wire: [{
            type: 'request_headers',
            data: 'Authorization: Bearer actual-upstream-token\r\n'
          }]
        };
      }
    };
    const transport = new TracingTransport(inner, traceFile, 'test');

    await transport.fetch({
      method: 'PATCH',
      path: '/backend-api/accounts/workspace/users/member-1',
      headers: {
        Authorization: 'Bearer submitted-token',
        Cookie: 'session=raw-cookie'
      },
      body: '{"seat_type":"codex"}',
      proxy: 'http://proxy-user:proxy-password@proxy.example:8080'
    });

    const line = (await readFile(traceFile, 'utf8')).trim();
    const record = JSON.parse(line);
    assert.equal(record.request.headers.Authorization, 'Bearer submitted-token');
    assert.equal(record.request.headers.Cookie, 'session=raw-cookie');
    assert.equal(record.request.body, '{"seat_type":"codex"}');
    assert.equal(record.request.proxy, 'http://proxy-user:proxy-password@proxy.example:8080');
    assert.equal(record.upstreamRequest.headers[0][1], 'Bearer actual-upstream-token');
    assert.equal(record.response.headers[1][1], 'upstream-session=secret');
    assert.equal(record.response.body, '{"seat_type":"codex"}');
    assert.equal(record.response.network.primaryIp, '104.18.0.1');
    assert.match(record.response.wire[0].data, /actual-upstream-token/);
    assert.equal((await stat(traceFile)).mode & 0o777, 0o600);
    assert.equal((await stat(join(tempDirectory, 'nested'))).mode & 0o777, 0o700);
  });

  it('records the full transport error before rethrowing it', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'team-manager-error-trace-'));
    const traceFile = join(tempDirectory, 'upstream.jsonl');
    const inner: Transport = {
      async fetch() {
        throw new Error('proxy connection failed with complete diagnostic text');
      }
    };
    const transport = new TracingTransport(inner, traceFile, 'test');

    await assert.rejects(
      transport.fetch({ method: 'GET', path: '/backend-api/me', headers: {} }),
      /complete diagnostic text/
    );

    const record = JSON.parse((await readFile(traceFile, 'utf8')).trim());
    assert.equal(record.response, null);
    assert.equal(record.error.message, 'proxy connection failed with complete diagnostic text');
    assert.match(record.error.stack, /complete diagnostic text/);
  });
});

describe('fetchWithRawTrace', () => {
  it('records complete unredacted requests for external services outside ChatGPT transport', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'team-manager-external-trace-'));
    const traceFile = join(tempDirectory, 'all-upstreams.jsonl');
    process.env.TEAMMGR_UPSTREAM_TRACE_FILE = traceFile;
    const fetchImpl = (async () => new Response('{"operation":"accepted"}', {
      status: 202,
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'account-manager-session=raw-secret'
      }
    })) as typeof fetch;

    const response = await fetchWithRawTrace(
      'account-manager',
      'http://127.0.0.1:3015/v1/accounts/register',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer account-manager-token',
          'Content-Type': 'application/json'
        },
        body: '{"email":"raw@example.com","password":"raw-password"}'
      },
      fetchImpl
    );

    assert.equal(await response.text(), '{"operation":"accepted"}');
    const record = JSON.parse((await readFile(traceFile, 'utf8')).trim());
    assert.equal(record.upstream, 'account-manager');
    assert.deepEqual(record.request.headers, [
      ['authorization', 'Bearer account-manager-token'],
      ['content-type', 'application/json']
    ]);
    assert.equal(record.request.body, '{"email":"raw@example.com","password":"raw-password"}');
    assert.equal(record.response.status, 202);
    assert.equal(record.response.body, '{"operation":"accepted"}');
    assert.match(
      record.response.headers.find(([name]: [string]) => name === 'set-cookie')[1],
      /raw-secret/
    );
  });

  it('records direct fetch calls through the process-wide catch-all safety net', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'team-manager-catch-all-trace-'));
    const traceFile = join(tempDirectory, 'all-upstreams.jsonl');
    process.env.TEAMMGR_UPSTREAM_TRACE_FILE = traceFile;
    const fetchImpl = (async () => new Response('raw-response', {
      status: 200,
      headers: { 'x-upstream-response': 'complete' }
    })) as typeof fetch;
    const catchAllFetch = createCatchAllTracingFetch(fetchImpl);
    const request = new Request('https://unclassified.example.test/v1/action', {
      method: 'POST',
      headers: { Authorization: 'Bearer direct-token' },
      body: 'raw-direct-body'
    });

    const response = await catchAllFetch(request);

    assert.equal(await response.text(), 'raw-response');
    const record = JSON.parse((await readFile(traceFile, 'utf8')).trim());
    assert.equal(record.upstream, 'catch-all-fetch');
    assert.equal(record.request.method, 'POST');
    assert.equal(record.request.url, 'https://unclassified.example.test/v1/action');
    assert.equal(record.request.body, 'raw-direct-body');
    assert.equal(
      record.request.headers.find(([name]: [string]) => name === 'authorization')[1],
      'Bearer direct-token'
    );
    assert.equal(record.response.body, 'raw-response');
  });

  it('keeps explicitly named upstream calls single-recorded when global fetch is the catch-all wrapper', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'team-manager-named-upstream-trace-'));
    const traceFile = join(tempDirectory, 'all-upstreams.jsonl');
    process.env.TEAMMGR_UPSTREAM_TRACE_FILE = traceFile;
    const fetchImpl = (async () => new Response('named-response')) as typeof fetch;
    const catchAllFetch = createCatchAllTracingFetch(fetchImpl);

    await fetchWithRawTrace(
      'named-upstream',
      'https://named.example.test/action',
      { method: 'POST', body: 'named-body' },
      catchAllFetch
    );

    const records = (await readFile(traceFile, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(records.length, 1);
    assert.equal(records[0].upstream, 'named-upstream');
    assert.equal(records[0].request.body, 'named-body');
  });
});

describe('server network egress architecture', () => {
  it('keeps production HTTP clients behind the traced transport module', async () => {
    const sourceDirectory = fileURLToPath(new URL('.', import.meta.url));
    const files = (await readdir(sourceDirectory, { recursive: true }))
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'transport.ts');
    const bypasses: string[] = [];

    for (const file of files) {
      const source = await readFile(join(sourceDirectory, file), 'utf8');
      if (/(?<![.\w])fetch\s*\(/.test(source)) bypasses.push(`${file}: direct fetch()`);
      if (/\b(?:globalThis|window)\.fetch\b/.test(source)) bypasses.push(`${file}: global fetch`);
      if (/['"](?:node:)?(?:http|https|net|tls|child_process|undici|axios|got|node-fetch)['"]/.test(source)) {
        bypasses.push(`${file}: bypass-capable network module`);
      }
    }

    assert.deepEqual(bypasses, []);
  });
});
