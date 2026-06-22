import {
  codexCredentialFromTokenResponse,
  type CodexAuthSession,
  type CodexTokenResponse
} from './codexAuth.js';
import type { CodexAutoAuthEvent } from './codexAutoAuth.js';
import type { CodexCredentialJson } from '@team-manager/shared';

export interface SubaccountRegistrationOptions {
  session: CodexAuthSession;
  targetChatgptAccountId?: string;
  mailGroup?: string;
  now?: Date;
}

export interface SubaccountRegistrationResult {
  email: string;
  password: string;
  credential?: CodexCredentialJson;
  callbackUrl?: string;
  events: CodexAutoAuthEvent[];
}

export interface SubaccountRegistrationExecutor {
  register(options: SubaccountRegistrationOptions): Promise<SubaccountRegistrationResult>;
}

interface WorkerSubaccountRegistrationResponse {
  ok?: boolean;
  status?: string;
  message?: string;
  challenge?: string;
  email?: string;
  password?: string;
  callbackUrl?: string;
  tokenResponse?: CodexTokenResponse;
  events?: CodexAutoAuthEvent[];
}

export class SubaccountRegistrationError extends Error {
  constructor(
    message: string,
    readonly status: string,
    readonly challenge?: string,
    readonly email?: string,
    readonly password?: string,
    readonly events: CodexAutoAuthEvent[] = []
  ) {
    super(message);
  }
}

export class WorkerSubaccountRegistrationExecutor implements SubaccountRegistrationExecutor {
  private readonly endpoint: string;

  constructor(
    workerUrl: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    const base = workerUrl.trim().replace(/\/+$/, '');
    if (!base) throw new Error('TEAMMGR_CURL_CFFI_URL 为空');
    this.endpoint = `${base}/subaccounts/register`;
  }

  async register(options: SubaccountRegistrationOptions): Promise<SubaccountRegistrationResult> {
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        authUrl: options.session.authUrl,
        state: options.session.state,
        codeVerifier: options.session.codeVerifier,
        targetChatgptAccountId: options.targetChatgptAccountId,
        mailGroup: options.mailGroup
      })
    });
    const text = await response.text();
    let data: WorkerSubaccountRegistrationResponse;
    try {
      data = JSON.parse(text) as WorkerSubaccountRegistrationResponse;
    } catch {
      throw new SubaccountRegistrationError(`子号注册 worker 返回非 JSON: ${text.slice(0, 300)}`, 'bad_worker_response');
    }

    const events = Array.isArray(data.events) ? data.events : [];
    if (!response.ok) {
      throw new SubaccountRegistrationError(
        data.message ?? `子号注册 worker 请求失败: HTTP ${response.status}`,
        data.status ?? 'worker_http_error',
        data.challenge,
        data.email,
        data.password,
        events
      );
    }
    if (!data.ok || data.status !== 'ok' || !data.email || !data.password) {
      throw new SubaccountRegistrationError(
        data.message ?? `子号注册未完成: ${data.status ?? 'unknown'}`,
        data.status ?? 'unknown',
        data.challenge,
        data.email,
        data.password,
        events
      );
    }

    return {
      email: data.email,
      password: data.password,
      callbackUrl: data.callbackUrl,
      credential: data.tokenResponse
        ? codexCredentialFromTokenResponse(data.tokenResponse, options.now ?? new Date())
        : undefined,
      events
    };
  }
}

export function createSubaccountRegistrationExecutor(): SubaccountRegistrationExecutor | undefined {
  const workerUrl = process.env.TEAMMGR_CURL_CFFI_URL;
  if (!workerUrl?.trim()) return undefined;
  return new WorkerSubaccountRegistrationExecutor(workerUrl);
}
