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

  constructor(
    workerUrl: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    const base = workerUrl.trim().replace(/\/+$/, '');
    if (!base) throw new Error('TEAMMGR_CURL_CFFI_URL 为空');
    this.endpoint = `${base}/codex-auth/auto`;
  }

  async complete(options: CodexAutoAuthCompleteOptions): Promise<CodexAutoAuthCompleteResult> {
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        email: options.email,
        authUrl: options.session.authUrl,
        state: options.session.state,
        codeVerifier: options.session.codeVerifier,
        targetChatgptAccountId: options.targetChatgptAccountId,
        password: options.password
      })
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
}

export function createCodexAutoAuthExecutor(): CodexAutoAuthExecutor | undefined {
  const workerUrl = process.env.TEAMMGR_CURL_CFFI_URL;
  if (!workerUrl?.trim()) return undefined;
  return new WorkerCodexAutoAuthExecutor(workerUrl);
}
