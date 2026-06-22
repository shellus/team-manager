import {
  codexCredentialFromTokenResponse,
  type CodexAuthSession,
  type CodexTokenResponse
} from './codexAuth.js';
import type { CodexCredentialJson } from '@team-manager/shared';

export interface CodexAutoAuthEvent {
  phase?: string;
  status?: number;
  pageType?: string;
  continueUrl?: string;
  location?: string;
  message?: string;
}

export interface CodexAutoAuthCompleteOptions {
  email: string;
  session: CodexAuthSession;
  targetChatgptAccountId?: string;
  password?: string;
  now?: Date;
  onEvent?: (event: CodexAutoAuthEvent) => void | Promise<void>;
}

export interface CodexAutoAuthCompleteResult {
  credential: CodexCredentialJson;
  callbackUrl?: string;
  events: CodexAutoAuthEvent[];
}

export interface CodexAutoAuthExecutor {
  complete(options: CodexAutoAuthCompleteOptions): Promise<CodexAutoAuthCompleteResult>;
}

interface WorkerCodexAutoAuthResponse {
  ok?: boolean;
  status?: string;
  message?: string;
  challenge?: string;
  callbackUrl?: string;
  tokenResponse?: CodexTokenResponse;
  events?: CodexAutoAuthEvent[];
}

export class CodexAutoAuthError extends Error {
  constructor(
    message: string,
    readonly status: string,
    readonly challenge?: string,
    readonly events: CodexAutoAuthEvent[] = []
  ) {
    super(message);
  }
}

export class WorkerCodexAutoAuthExecutor implements CodexAutoAuthExecutor {
  private readonly endpoint: string;
  private readonly eventEndpoint: string;

  constructor(
    workerUrl: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    const base = workerUrl.trim().replace(/\/+$/, '');
    if (!base) throw new Error('TEAMMGR_CURL_CFFI_URL 为空');
    this.endpoint = `${base}/codex-auth/auto`;
    this.eventEndpoint = `${base}/codex-auth/auto-events`;
  }

  async complete(options: CodexAutoAuthCompleteOptions): Promise<CodexAutoAuthCompleteResult> {
    if (options.onEvent) {
      const streamed = await this.completeStreaming(options);
      if (streamed) return streamed;
    }
    return this.completeJson(options);
  }

  private requestBody(options: CodexAutoAuthCompleteOptions): string {
    return JSON.stringify({
      email: options.email,
      authUrl: options.session.authUrl,
      state: options.session.state,
      codeVerifier: options.session.codeVerifier,
      targetChatgptAccountId: options.targetChatgptAccountId,
      password: options.password
    });
  }

  private async completeJson(options: CodexAutoAuthCompleteOptions): Promise<CodexAutoAuthCompleteResult> {
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: this.requestBody(options)
    });
    const text = await response.text();
    let data: WorkerCodexAutoAuthResponse;
    try {
      data = JSON.parse(text) as WorkerCodexAutoAuthResponse;
    } catch {
      throw new CodexAutoAuthError(`Codex 自动授权 worker 返回非 JSON: ${text.slice(0, 300)}`, 'bad_worker_response');
    }

    const events = Array.isArray(data.events) ? data.events : [];
    if (!response.ok) {
      throw new CodexAutoAuthError(
        data.message ?? `Codex 自动授权 worker 请求失败: HTTP ${response.status}`,
        data.status ?? 'worker_http_error',
        data.challenge,
        events
      );
    }
    if (!data.ok || data.status !== 'ok' || !data.tokenResponse) {
      throw new CodexAutoAuthError(
        data.message ?? `Codex 自动授权未完成: ${data.status ?? 'unknown'}`,
        data.status ?? 'unknown',
        data.challenge,
        events
      );
    }

    return {
      credential: codexCredentialFromTokenResponse(data.tokenResponse, options.now ?? new Date()),
      callbackUrl: data.callbackUrl,
      events
    };
  }

  private async completeStreaming(
    options: CodexAutoAuthCompleteOptions
  ): Promise<CodexAutoAuthCompleteResult | undefined> {
    const response = await this.fetchImpl(this.eventEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: this.requestBody(options)
    });
    if (response.status === 404 || response.status === 405) return undefined;

    const events: CodexAutoAuthEvent[] = [];
    if (!response.ok) {
      const text = await response.text();
      throw new CodexAutoAuthError(
        `Codex 自动授权事件流 worker 请求失败: HTTP ${response.status} ${text.slice(0, 200)}`,
        'worker_http_error',
        undefined,
        events
      );
    }
    if (!response.body) return undefined;

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = '';
    let result: WorkerCodexAutoAuthResponse | undefined;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        result = await this.handleEventLine(line, events, options.onEvent, result);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) result = await this.handleEventLine(buffer, events, options.onEvent, result);
    if (!result) {
      throw new CodexAutoAuthError('Codex 自动授权事件流没有返回最终结果', 'bad_worker_response', undefined, events);
    }
    return this.resultFromWorkerResponse(result, events, options);
  }

  private async handleEventLine(
    line: string,
    events: CodexAutoAuthEvent[],
    onEvent: CodexAutoAuthCompleteOptions['onEvent'],
    currentResult: WorkerCodexAutoAuthResponse | undefined
  ): Promise<WorkerCodexAutoAuthResponse | undefined> {
    const trimmed = line.trim();
    if (!trimmed) return currentResult;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      throw new CodexAutoAuthError(`Codex 自动授权事件流返回非 JSON 行: ${trimmed.slice(0, 200)}`, 'bad_worker_response', undefined, events);
    }
    if (data.type === 'event' && data.event && typeof data.event === 'object') {
      const event = data.event as CodexAutoAuthEvent;
      events.push(event);
      await onEvent?.(event);
      return currentResult;
    }
    if (data.type === 'result' && data.result && typeof data.result === 'object') {
      return data.result as WorkerCodexAutoAuthResponse;
    }
    if (data.type === 'error') {
      throw new CodexAutoAuthError(
        typeof data.message === 'string' ? data.message : 'Codex 自动授权事件流失败',
        typeof data.status === 'string' ? data.status : 'worker_error',
        typeof data.challenge === 'string' ? data.challenge : undefined,
        events
      );
    }
    return currentResult;
  }

  private resultFromWorkerResponse(
    data: WorkerCodexAutoAuthResponse,
    streamedEvents: CodexAutoAuthEvent[],
    options: CodexAutoAuthCompleteOptions
  ): CodexAutoAuthCompleteResult {
    const events = Array.isArray(data.events) ? data.events : streamedEvents;
    if (!data.ok || data.status !== 'ok' || !data.tokenResponse) {
      throw new CodexAutoAuthError(
        data.message ?? `Codex 自动授权未完成: ${data.status ?? 'unknown'}`,
        data.status ?? 'unknown',
        data.challenge,
        events
      );
    }

    return {
      credential: codexCredentialFromTokenResponse(data.tokenResponse, options.now ?? new Date()),
      callbackUrl: data.callbackUrl,
      events
    };
  }
}

export function createCodexAutoAuthExecutor(): CodexAutoAuthExecutor | undefined {
  const workerUrl = process.env.TEAMMGR_CURL_CFFI_URL;
  if (!workerUrl?.trim()) return undefined;
  return new WorkerCodexAutoAuthExecutor(workerUrl);
}
