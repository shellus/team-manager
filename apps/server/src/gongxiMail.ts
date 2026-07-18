import type { SubaccountRegistrationEvent } from './subaccountRegistration.js';

type EventSink = (event: SubaccountRegistrationEvent) => void | Promise<void>;

interface GongXiMailConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  sourceGroup?: string;
  registeredGroup: string;
}

interface MailCodeCandidate {
  code: string;
  receivedAt?: number;
  mailbox: string;
  subject: string;
}

export class GongXiMailClient {
  constructor(
    private readonly config: GongXiMailConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async allocateEmail(group: string | undefined, emit?: EventSink): Promise<string> {
    const selectedGroup = group?.trim() || this.config.sourceGroup;
    const url = new URL('/api/get-email', `${this.config.baseUrl}/`);
    if (selectedGroup) url.searchParams.set('group', selectedGroup);
    const response = await this.request('gongxi_get_email', url.toString(), {
      method: 'GET',
      headers: this.headers(false)
    }, emit, { mailGroup: selectedGroup });
    const email = extractEmail(response.json);
    if (!email) throw new Error(`gongxi_get_email_missing_email: ${response.text}`);
    await emit?.({ phase: 'registration_identity_allocated', at: new Date().toISOString(), email });
    return email;
  }

  async pollVerificationCode(
    email: string,
    notBefore: number,
    emit?: EventSink,
    excludedCodes: Set<string> = new Set()
  ): Promise<string> {
    const deadline = Date.now() + this.config.timeoutMs;
    while (Date.now() < deadline) {
      const candidates = await this.codeCandidates(email, emit);
      const candidate = candidates.find((item) =>
        !excludedCodes.has(item.code) && (!item.receivedAt || item.receivedAt >= notBefore - 5000)
      );
      if (candidate) {
        await emit?.({
          phase: 'email_otp_validate_code_received',
          at: new Date().toISOString(),
          email,
          code: candidate.code,
          mailbox: candidate.mailbox,
          subject: candidate.subject,
          receivedAt: candidate.receivedAt
        });
        return candidate.code;
      }
      await delay(4000);
    }
    throw new Error(`email_code_timeout: ${email}`);
  }

  async moveToRegisteredGroup(email: string, emit?: EventSink): Promise<{ email: string; group: string }> {
    const group = this.config.registeredGroup.trim();
    if (!group) throw new Error('TEAMMGR_GONGXI_MAIL_REGISTERED_GROUP is required');
    const url = new URL('/api/move-email-group', `${this.config.baseUrl}/`).toString();
    const response = await this.request('gongxi_move_email_group', url, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ email, group })
    }, emit);
    if ((response.json as Record<string, unknown> | undefined)?.success !== true) {
      throw new Error(`gongxi_move_email_group_failed: ${response.text}`);
    }
    return { email, group };
  }

  private async codeCandidates(email: string, emit?: EventSink): Promise<MailCodeCandidate[]> {
    const candidates: MailCodeCandidate[] = [];
    for (const mailbox of ['inbox', 'junk']) {
      const url = new URL('/api/mail_all', `${this.config.baseUrl}/`).toString();
      const response = await this.request('gongxi_mail_poll', url, {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({ email, mailbox })
      }, emit, { email, mailbox });
      const messages = readMessages(response.json);
      for (const message of messages) {
        const subject = stringValue(message.subject);
        const sender = `${stringValue(message.from)} ${stringValue(message.sender)}`;
        if (!/(openai|chatgpt)/i.test(`${sender} ${subject}`)) continue;
        const content = ['text', 'body', 'preview', 'snippet', 'html']
          .map((key) => stringValue(message[key]))
          .join('\n');
        const code = `${subject}\n${content}`.match(/(?<!\d)(\d{6})(?!\d)/)?.[1];
        if (!code) continue;
        candidates.push({
          code,
          mailbox,
          subject,
          receivedAt: parseMailDate(
            message.date ?? message.receivedDateTime ?? message.received_at ?? message.createdAt
          )
        });
      }
    }
    return candidates.sort((left, right) => (right.receivedAt ?? 0) - (left.receivedAt ?? 0));
  }

  private headers(json: boolean): Record<string, string> {
    return {
      accept: 'application/json',
      ...(json ? { 'content-type': 'application/json' } : {}),
      'x-api-key': this.config.apiKey
    };
  }

  private async request(
    phase: string,
    url: string,
    init: RequestInit,
    emit?: EventSink,
    extra: Record<string, unknown> = {}
  ): Promise<{ text: string; json?: unknown }> {
    const response = await this.fetchImpl(url, init);
    const text = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    const event: SubaccountRegistrationEvent = {
      phase,
      at: new Date().toISOString(),
      request: {
        method: init.method ?? 'GET',
        url,
        headers: init.headers,
        body: init.body
      },
      response: {
        status: response.status,
        url: response.url,
        headers: Object.fromEntries(response.headers.entries()),
        body: text
      },
      ...extra
    };
    if (emit) await emit(event);
    else console.log(`[subaccount-registration] ${JSON.stringify(event)}`);
    if (!response.ok) throw new Error(`${phase}_failed_${response.status}: ${text}`);
    return { text, json };
  }
}

export function createGongXiMailClient(): GongXiMailClient | undefined {
  const baseUrl = process.env.TEAMMGR_GONGXI_MAIL_BASE_URL?.trim().replace(/\/+$/, '');
  const apiKey = process.env.TEAMMGR_GONGXI_MAIL_API_KEY?.trim();
  const registeredGroup = process.env.TEAMMGR_GONGXI_MAIL_REGISTERED_GROUP?.trim();
  if (!baseUrl || !apiKey || !registeredGroup) return undefined;
  const timeoutSeconds = Number(process.env.TEAMMGR_GONGXI_MAIL_TIMEOUT ?? 150);
  return new GongXiMailClient({
    baseUrl,
    apiKey,
    timeoutMs: Number.isFinite(timeoutSeconds) ? timeoutSeconds * 1000 : 150_000,
    sourceGroup: process.env.TEAMMGR_GONGXI_MAIL_GROUP?.trim() || undefined,
    registeredGroup
  });
}

function extractEmail(value: unknown): string | undefined {
  if (typeof value === 'string') return value.includes('@') ? value.trim() : undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['email', 'mail', 'address', 'account']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.includes('@')) return candidate.trim();
  }
  return extractEmail(record.data);
}

function readMessages(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const data = (value as Record<string, unknown>).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const messages = (data as Record<string, unknown>).messages;
  return Array.isArray(messages)
    ? messages.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
}

function parseMailDate(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
