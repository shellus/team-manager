export interface HttpRequest {
  method: string;
  path: string; // backend-api 相对路径，如 /backend-api/accounts/.../users
  headers: Record<string, string>;
  body?: string;
  proxy?: string;
}

export interface HttpResponse {
  status: number;
  body: string;
}

/** 传输后端：负责把请求送达 chatgpt.com 并返回响应 */
export interface Transport {
  fetch(req: HttpRequest): Promise<HttpResponse>;
}

const BASE_URL = 'https://chatgpt.com';

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
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`curl_cffi worker 请求失败 ${res.status}: ${text.slice(0, 300)}`);
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`curl_cffi worker 返回非 JSON: ${text.slice(0, 300)}`);
    }
    if (!isWorkerResponse(data)) {
      throw new Error(`curl_cffi worker 返回结构无效: ${text.slice(0, 300)}`);
    }
    return { status: data.status, body: data.body };
  }
}

function isWorkerResponse(value: unknown): value is HttpResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.status === 'number' && typeof record.body === 'string';
}

/**
 * Node 原生 fetch 直连。
 * 仅用于未配置 sidecar 的本地调试；生产和当前部署应配置 TEAMMGR_CURL_CFFI_URL。
 */
export class DirectTransport implements Transport {
  async fetch(req: HttpRequest): Promise<HttpResponse> {
    const res = await fetch(BASE_URL + req.path, {
      method: req.method,
      headers: req.headers,
      body: req.body
    });
    return { status: res.status, body: await res.text() };
  }
}

/** 按环境选传输后端：配置 sidecar 则走 curl_cffi，否则直连。 */
export function createTransport(): Transport {
  const workerUrl = process.env.TEAMMGR_CURL_CFFI_URL;
  if (workerUrl?.trim()) return new CurlCffiTransport(workerUrl);
  return new DirectTransport();
}
