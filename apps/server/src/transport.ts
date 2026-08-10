import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { appendPrivateFile, ensurePrivateDirectory } from './privateDataFile.js';

export interface HttpRequest {
  method: string;
  path: string; // backend-api 相对路径，如 /backend-api/accounts/.../users
  baseUrl?: string;
  upstream?: string;
  headers: Record<string, string>;
  body?: string;
  proxy?: string;
}

export type HttpHeaderList = Array<[string, string | null]>;

export interface UpstreamRequest {
  method: string;
  url: string;
  headers: HttpHeaderList;
  body?: string;
}

export interface HttpNetworkDetails {
  httpVersion?: number;
  primaryIp?: string;
  primaryPort?: number;
  localIp?: string;
  localPort?: number;
  redirectCount?: number;
  requestSize?: number;
  responseSize?: number;
  uploadSize?: number;
  downloadSize?: number;
}

export interface HttpWireEvent {
  type: string;
  data: string;
}

export interface HttpResponse {
  status: number;
  body: string;
  headers?: HttpHeaderList;
  url?: string;
  request?: UpstreamRequest;
  network?: HttpNetworkDetails;
  wire?: HttpWireEvent[];
}

/** 传输后端：负责把请求送达 ChatGPT/OpenAI 上游并返回响应 */
export interface Transport {
  fetch(req: HttpRequest): Promise<HttpResponse>;
}

const BASE_URL = 'https://chatgpt.com';
const DEFAULT_TRACE_FILE = 'upstream-http-trace.jsonl';
const nativeFetch = globalThis.fetch.bind(globalThis);

let traceWriteChain = Promise.resolve();
let catchAllFetchInstalled = false;
const catchAllFetchSources = new WeakMap<typeof fetch, typeof fetch>();

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: SerializedError | { value: unknown };
  details?: unknown;
}

/** 保留完整内部错误细节供原始追踪落盘，对外 message 仍可保持简短。 */
class TransportError extends Error {
  constructor(message: string, readonly details: unknown, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TransportError';
  }
}

/**
 * curl_cffi sidecar 传输。
 * sidecar 使用浏览器 TLS impersonation + 代理发请求，Node 只负责转发请求参数。
 */
export class CurlCffiTransport implements Transport {
  private readonly endpoint: string;

  constructor(workerUrl: string) {
    const base = workerUrl.trim().replace(/\/+$/, '');
    if (!base) throw new Error('TEAMMGR_CURL_CFFI_URL 为空');
    this.endpoint = `${base}/fetch`;
  }

  async fetch(req: HttpRequest): Promise<HttpResponse> {
    const res = await nativeFetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });
    const text = await res.text();
    if (!res.ok) {
      throw new TransportError(`curl_cffi worker 请求失败 ${res.status}`, {
        status: res.status,
        headers: fetchHeaderList(res.headers),
        body: text,
        url: res.url
      });
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new TransportError(
        'curl_cffi worker 返回非 JSON',
        {
          status: res.status,
          headers: fetchHeaderList(res.headers),
          body: text,
          url: res.url
        },
        { cause: error }
      );
    }
    if (!isWorkerResponse(data)) {
      throw new TransportError('curl_cffi worker 返回结构无效', {
        status: res.status,
        headers: fetchHeaderList(res.headers),
        body: text,
        url: res.url
      });
    }
    return data;
  }
}

function isWorkerResponse(value: unknown): value is HttpResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (typeof record.status !== 'number' || typeof record.body !== 'string') return false;
  if (record.headers !== undefined && !isHeaderList(record.headers)) return false;
  if (record.url !== undefined && typeof record.url !== 'string') return false;
  if (record.request !== undefined && !isUpstreamRequest(record.request)) return false;
  if (record.network !== undefined && (!record.network || typeof record.network !== 'object')) return false;
  if (record.wire !== undefined && !isWireTrace(record.wire)) return false;
  return true;
}

function isHeaderList(value: unknown): value is HttpHeaderList {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'string' &&
        (typeof entry[1] === 'string' || entry[1] === null)
    )
  );
}

function isUpstreamRequest(value: unknown): value is UpstreamRequest {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.method === 'string' &&
    typeof record.url === 'string' &&
    isHeaderList(record.headers) &&
    (record.body === undefined || typeof record.body === 'string')
  );
}

function isWireTrace(value: unknown): value is HttpWireEvent[] {
  return (
    Array.isArray(value) &&
    value.every((event) => {
      if (!event || typeof event !== 'object') return false;
      const record = event as Record<string, unknown>;
      return typeof record.type === 'string' && typeof record.data === 'string';
    })
  );
}

/**
 * Node 原生 fetch 直连。
 * 仅用于未配置 sidecar 的本地调试；生产和当前部署应配置 TEAMMGR_CURL_CFFI_URL。
 */
export class DirectTransport implements Transport {
  async fetch(req: HttpRequest): Promise<HttpResponse> {
    const url = requestUrl(req);
    const res = await nativeFetch(url, {
      method: req.method,
      headers: req.headers,
      body: req.body
    });
    return {
      status: res.status,
      body: await res.text(),
      headers: fetchHeaderList(res.headers),
      url: res.url,
      request: {
        method: req.method,
        url,
        headers: Object.entries(req.headers),
        ...(req.body === undefined ? {} : { body: req.body })
      }
    };
  }
}

/**
 * 统一记录原始上游请求与响应。
 *
 * 故意不脱敏、不截断：追踪文件属于私有运行数据，目的是在上游协议或数据结构
 * 变动时可以完整还原现场。写入失败不能把已成功的上游变更伪装成失败，因此只报服务端错误。
 */
export class TracingTransport implements Transport {
  constructor(
    private readonly inner: Transport,
    private readonly traceFile: string,
    private readonly transportName: string
  ) {}

  async fetch(req: HttpRequest): Promise<HttpResponse> {
    const traceId = randomUUID();
    const startedAt = new Date();
    const startedNs = process.hrtime.bigint();

    try {
      const response = await this.inner.fetch(req);
      await this.writeTrace({
        traceId,
        upstream: req.upstream ?? null,
        transport: this.transportName,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: elapsedMilliseconds(startedNs),
        request: serializeRequest(req),
        upstreamRequest: response.request ?? null,
        response: {
          status: response.status,
          headers: response.headers ?? null,
          body: response.body,
          url: response.url ?? null,
          network: response.network ?? null,
          wire: response.wire ?? null
        },
        error: null
      });
      return response;
    } catch (error) {
      await this.writeTrace({
        traceId,
        upstream: req.upstream ?? null,
        transport: this.transportName,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: elapsedMilliseconds(startedNs),
        request: serializeRequest(req),
        upstreamRequest: null,
        response: null,
        error: serializeError(error)
      });
      throw error;
    }
  }

  private async writeTrace(record: unknown): Promise<void> {
    await writeTraceSafely(this.traceFile, record);
  }
}

/** 记录不经过 ChatGPT Transport 的其他外部 HTTP 请求。 */
export async function fetchWithRawTrace(
  upstream: string,
  input: RequestInfo | URL,
  init: RequestInit = {},
  fetchImpl: typeof fetch = nativeFetch,
  traceOptions: { requestBody?: string } = {}
): Promise<Response> {
  const traceFile = resolveTraceFile();
  const effectiveFetch = catchAllFetchSources.get(fetchImpl) ?? fetchImpl;
  if (!traceFile) return effectiveFetch(input, init);

  const traceId = randomUUID();
  const startedAt = new Date();
  const startedNs = process.hrtime.bigint();
  const preparedRequest = new Request(input, init);
  const request = {
    method: preparedRequest.method,
    url: preparedRequest.url,
    headers: fetchHeaderList(preparedRequest.headers),
    body: traceOptions.requestBody ?? await requestBodyText(preparedRequest)
  };

  try {
    const response = await effectiveFetch(input, init);
    const responseBody = await response.clone().text();
    await writeTraceSafely(traceFile, {
      traceId,
      upstream,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: elapsedMilliseconds(startedNs),
      request,
      upstreamRequest: null,
      response: {
        status: response.status,
        headers: fetchHeaderList(response.headers),
        body: responseBody,
        url: response.url || preparedRequest.url,
        network: null
      },
      error: null
    });
    return response;
  } catch (error) {
    await writeTraceSafely(traceFile, {
      traceId,
      upstream,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: elapsedMilliseconds(startedNs),
      request,
      upstreamRequest: null,
      response: null,
      error: serializeError(error)
    });
    throw error;
  }
}

/**
 * 安装进程级 fetch 兜底追踪。
 *
 * 已知业务出口仍使用具名 upstream；任何今后遗漏统一封装的直接 fetch 都会以
 * catch-all-fetch 记录，避免新增链路静默失去请求/响应现场。
 */
export function installCatchAllFetchTracing(): void {
  if (catchAllFetchInstalled || !resolveTraceFile()) return;
  globalThis.fetch = createCatchAllTracingFetch(nativeFetch);
  catchAllFetchInstalled = true;
}

export function createCatchAllTracingFetch(fetchImpl: typeof fetch = nativeFetch): typeof fetch {
  const tracedFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    fetchWithRawTrace('catch-all-fetch', input, init, fetchImpl)) as typeof fetch;
  catchAllFetchSources.set(tracedFetch, fetchImpl);
  return tracedFetch;
}

function serializeRequest(req: HttpRequest) {
  return {
    method: req.method,
    path: req.path,
    baseUrl: req.baseUrl ?? BASE_URL,
    url: requestUrl(req),
    headers: req.headers,
    body: req.body ?? null,
    proxy: req.proxy ?? null
  };
}

function requestUrl(req: HttpRequest): string {
  const baseUrl = (req.baseUrl ?? BASE_URL).replace(/\/+$/, '');
  return `${baseUrl}${req.path}`;
}

function elapsedMilliseconds(startedNs: bigint): number {
  return Number(process.hrtime.bigint() - startedNs) / 1_000_000;
}

async function requestBodyText(request: Request): Promise<string | null> {
  if (request.body === null) return null;
  return request.clone().text();
}

function fetchHeaderList(headers: Headers): HttpHeaderList {
  const entries = Array.from(headers.entries());
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const setCookies = getSetCookie?.call(headers) ?? [];
  if (setCookies.length === 0) return entries;
  return [
    ...entries.filter(([name]) => name.toLowerCase() !== 'set-cookie'),
    ...setCookies.map((value): [string, string] => ['set-cookie', value])
  ];
}

function serializeError(error: unknown): SerializedError | { value: unknown } {
  if (!(error instanceof Error)) return { value: error };
  const withDetails = error as Error & { details?: unknown };
  return {
    name: error.name,
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
    ...(error.cause === undefined ? {} : { cause: serializeError(error.cause) }),
    ...(withDetails.details === undefined ? {} : { details: withDetails.details })
  };
}

function enqueueTraceWrite(traceFile: string, line: string): Promise<void> {
  const write = traceWriteChain.then(
    () => appendTraceLine(traceFile, line),
    () => appendTraceLine(traceFile, line)
  );
  traceWriteChain = write.catch(() => undefined);
  return write;
}

async function appendTraceLine(traceFile: string, line: string): Promise<void> {
  await ensurePrivateDirectory(dirname(traceFile));
  await appendPrivateFile(traceFile, line);
}

async function writeTraceSafely(traceFile: string, record: unknown): Promise<void> {
  try {
    await enqueueTraceWrite(traceFile, `${JSON.stringify(record)}\n`);
  } catch (error) {
    console.error(`[team-manager] 上游原始追踪写入失败 (${traceFile}):`, error);
  }
}

function resolveTraceFile(): string | undefined {
  const configured = process.env.TEAMMGR_UPSTREAM_TRACE_FILE?.trim();
  if (configured) return resolve(configured);
  const dataDir = process.env.TEAMMGR_DATA_DIR?.trim();
  if (dataDir) return join(resolve(dataDir), DEFAULT_TRACE_FILE);
  return undefined;
}

/** 按环境选传输后端：配置 sidecar 则走 curl_cffi，否则直连。 */
export function createTransport(): Transport {
  const workerUrl = process.env.TEAMMGR_CURL_CFFI_URL;
  const baseTransport = workerUrl?.trim()
    ? new CurlCffiTransport(workerUrl)
    : new DirectTransport();
  const traceFile = resolveTraceFile();
  if (!traceFile) return baseTransport;
  return new TracingTransport(
    baseTransport,
    traceFile,
    baseTransport instanceof CurlCffiTransport ? 'curl_cffi' : 'direct'
  );
}
