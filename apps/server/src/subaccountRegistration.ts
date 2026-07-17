import { parseChatGptSessionInput, type ChatGptSessionInput } from '@team-manager/shared';

export type SubaccountRegistrationEvent = Record<string, unknown> & { phase?: string };

export interface SubaccountRegistrationOptions {
  mailGroup?: string;
  email?: string;
  password?: string;
  resumeExisting?: boolean;
  onEvent?: (event: SubaccountRegistrationEvent) => void | Promise<void>;
}

export interface SubaccountRegistrationResult {
  email: string;
  password: string;
  name?: string;
  birthdate?: string;
  callbackUrl?: string;
  session: ChatGptSessionInput;
  events: SubaccountRegistrationEvent[];
}

export interface SubaccountRegistrationMailboxResult {
  email: string;
  group: string;
  events: SubaccountRegistrationEvent[];
}

export interface SubaccountRegistrationExecutor {
  register(options: SubaccountRegistrationOptions): Promise<SubaccountRegistrationResult>;
  completeMailbox(email: string): Promise<SubaccountRegistrationMailboxResult>;
}

interface WorkerSubaccountRegistrationResponse {
  ok?: boolean;
  status?: string;
  message?: string;
  challenge?: string;
  email?: string;
  password?: string;
  name?: string;
  birthdate?: string;
  callbackUrl?: string;
  session?: unknown;
  group?: string;
  events?: SubaccountRegistrationEvent[];
}

export class SubaccountRegistrationError extends Error {
  constructor(
    message: string,
    readonly status: string,
    readonly challenge?: string,
    readonly email?: string,
    readonly password?: string,
    readonly events: SubaccountRegistrationEvent[] = []
  ) {
    super(message);
  }
}

export class WorkerSubaccountRegistrationExecutor implements SubaccountRegistrationExecutor {
  private readonly registerEndpoint: string;
  private readonly registerEventEndpoint: string;
  private readonly mailboxEndpoint: string;

  constructor(
    workerUrl: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    const base = workerUrl.trim().replace(/\/+$/, '');
    if (!base) throw new Error('TEAMMGR_CURL_CFFI_URL 为空');
    this.registerEndpoint = `${base}/subaccounts/register`;
    this.registerEventEndpoint = `${base}/subaccounts/register-events`;
    this.mailboxEndpoint = `${base}/subaccounts/registration/mailbox-group`;
  }

  async register(options: SubaccountRegistrationOptions): Promise<SubaccountRegistrationResult> {
    if (options.onEvent) {
      const streamed = await this.registerStreaming(options);
      if (streamed) return streamed;
    }
    return this.registerJson(options);
  }

  private requestBody(options: SubaccountRegistrationOptions): string {
    return JSON.stringify({
      mailGroup: options.mailGroup,
      email: options.email,
      password: options.password,
      resumeExisting: options.resumeExisting
    });
  }

  private async registerJson(options: SubaccountRegistrationOptions): Promise<SubaccountRegistrationResult> {
    const data = await this.request(this.registerEndpoint, {
      mailGroup: options.mailGroup,
      email: options.email,
      password: options.password,
      resumeExisting: options.resumeExisting
    });
    const events = Array.isArray(data.events) ? data.events : [];
    if (!data.ok || data.status !== 'ok' || !data.email || !data.password || !data.session) {
      throw new SubaccountRegistrationError(
        data.message ?? `子号注册未完成: ${data.status ?? 'unknown'}`,
        data.status ?? 'unknown',
        data.challenge,
        data.email,
        data.password,
        events
      );
    }
    const parsed = parseChatGptSessionInput(data.session);
    if ('error' in parsed) {
      throw new SubaccountRegistrationError(
        `子号注册 worker 返回的 ChatGPT Session 无效: ${parsed.error}`,
        'invalid_session',
        undefined,
        data.email,
        data.password,
        events
      );
    }
    if (parsed.user.email.toLowerCase() !== data.email.toLowerCase()) {
      throw new SubaccountRegistrationError(
        `子号注册邮箱与 Session 邮箱不一致: ${data.email} != ${parsed.user.email}`,
        'session_email_mismatch',
        undefined,
        data.email,
        data.password,
        events
      );
    }
    return {
      email: data.email,
      password: data.password,
      name: data.name,
      birthdate: data.birthdate,
      callbackUrl: data.callbackUrl,
      session: parsed,
      events
    };
  }

  private async registerStreaming(
    options: SubaccountRegistrationOptions
  ): Promise<SubaccountRegistrationResult | undefined> {
    const response = await this.fetchImpl(this.registerEventEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: this.requestBody(options)
    });
    if (response.status === 404 || response.status === 405) return undefined;
    if (!response.ok) {
      const text = await response.text();
      throw new SubaccountRegistrationError(
        `子号注册事件流 worker 请求失败: HTTP ${response.status} ${text.slice(0, 300)}`,
        'worker_http_error'
      );
    }
    if (!response.body) return undefined;

    const events: SubaccountRegistrationEvent[] = [];
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = '';
    let result: WorkerSubaccountRegistrationResponse | undefined;
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
      throw new SubaccountRegistrationError('子号注册事件流没有返回最终结果', 'bad_worker_response', undefined, undefined, undefined, events);
    }
    return this.resultFromWorkerResponse(result, events);
  }

  private async handleEventLine(
    line: string,
    events: SubaccountRegistrationEvent[],
    onEvent: SubaccountRegistrationOptions['onEvent'],
    currentResult: WorkerSubaccountRegistrationResponse | undefined
  ): Promise<WorkerSubaccountRegistrationResponse | undefined> {
    const trimmed = line.trim();
    if (!trimmed) return currentResult;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      throw new SubaccountRegistrationError(
        `子号注册事件流返回非 JSON 行: ${trimmed.slice(0, 300)}`,
        'bad_worker_response',
        undefined,
        undefined,
        undefined,
        events
      );
    }
    if (data.type === 'event' && data.event && typeof data.event === 'object') {
      const event = data.event as SubaccountRegistrationEvent;
      events.push(event);
      await onEvent?.(event);
      return currentResult;
    }
    if (data.type === 'result' && data.result && typeof data.result === 'object') {
      return data.result as WorkerSubaccountRegistrationResponse;
    }
    if (data.type === 'error') {
      throw new SubaccountRegistrationError(
        typeof data.message === 'string' ? data.message : '子号注册事件流失败',
        typeof data.status === 'string' ? data.status : 'worker_error',
        typeof data.challenge === 'string' ? data.challenge : undefined,
        undefined,
        undefined,
        events
      );
    }
    return currentResult;
  }

  private resultFromWorkerResponse(
    data: WorkerSubaccountRegistrationResponse,
    streamedEvents: SubaccountRegistrationEvent[]
  ): SubaccountRegistrationResult {
    const events = Array.isArray(data.events) ? data.events : streamedEvents;
    if (!data.ok || data.status !== 'ok' || !data.email || !data.password || !data.session) {
      throw new SubaccountRegistrationError(
        data.message ?? `子号注册未完成: ${data.status ?? 'unknown'}`,
        data.status ?? 'unknown',
        data.challenge,
        data.email,
        data.password,
        events
      );
    }
    const parsed = parseChatGptSessionInput(data.session);
    if ('error' in parsed) {
      throw new SubaccountRegistrationError(
        `子号注册 worker 返回的 ChatGPT Session 无效: ${parsed.error}`,
        'invalid_session',
        undefined,
        data.email,
        data.password,
        events
      );
    }
    if (parsed.user.email.toLowerCase() !== data.email.toLowerCase()) {
      throw new SubaccountRegistrationError(
        `子号注册邮箱与 Session 邮箱不一致: ${data.email} != ${parsed.user.email}`,
        'session_email_mismatch',
        undefined,
        data.email,
        data.password,
        events
      );
    }
    return {
      email: data.email,
      password: data.password,
      name: data.name,
      birthdate: data.birthdate,
      callbackUrl: data.callbackUrl,
      session: parsed,
      events
    };
  }

  async completeMailbox(email: string): Promise<SubaccountRegistrationMailboxResult> {
    const data = await this.request(this.mailboxEndpoint, { email });
    const events = Array.isArray(data.events) ? data.events : [];
    if (!data.ok || data.status !== 'ok' || !data.email || !data.group) {
      throw new SubaccountRegistrationError(
        data.message ?? `GongXi-Mail 邮箱分组转移未完成: ${data.status ?? 'unknown'}`,
        data.status ?? 'unknown',
        data.challenge,
        data.email,
        undefined,
        events
      );
    }
    return { email: data.email, group: data.group, events };
  }

  private async request(endpoint: string, body: Record<string, unknown>): Promise<WorkerSubaccountRegistrationResponse> {
    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    let data: WorkerSubaccountRegistrationResponse;
    try {
      data = JSON.parse(text) as WorkerSubaccountRegistrationResponse;
    } catch {
      throw new SubaccountRegistrationError(`子号注册 worker 返回非 JSON: ${text}`, 'bad_worker_response');
    }
    if (!response.ok) {
      throw new SubaccountRegistrationError(
        data.message ?? `子号注册 worker 请求失败: HTTP ${response.status}`,
        data.status ?? 'worker_http_error',
        data.challenge,
        data.email,
        data.password,
        Array.isArray(data.events) ? data.events : []
      );
    }
    return data;
  }
}

export function createSubaccountRegistrationExecutor(): SubaccountRegistrationExecutor | undefined {
  const workerUrl = process.env.TEAMMGR_CURL_CFFI_URL;
  if (!workerUrl?.trim()) return undefined;
  return new WorkerSubaccountRegistrationExecutor(workerUrl);
}
