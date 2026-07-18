import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Browser, BrowserContext, Locator, Page, Request, Response } from 'playwright-core';
import { parseChatGptSessionInput } from '@team-manager/shared';
import { CloakBrowserClient, type CloakProfile } from './cloakBrowserClient.js';
import { GongXiMailClient } from './gongxiMail.js';
import {
  SubaccountRegistrationError,
  type SubaccountRegistrationEvent,
  type SubaccountRegistrationExecutor,
  type SubaccountRegistrationMailboxResult,
  type SubaccountRegistrationOptions,
  type SubaccountRegistrationResult
} from './subaccountRegistration.js';

class CloakChallengeError extends Error {}

class CloakRetryableEnvironmentError extends Error {
  override name = 'CloakRetryableEnvironmentError';
}

interface RegistrationIdentity {
  email: string;
  password: string;
  name: string;
  birthdate: string;
}

export class CloakSubaccountRegistrationExecutor implements SubaccountRegistrationExecutor {
  private readonly networkChallenges = new WeakMap<Page, string>();

  constructor(
    private readonly cloak: CloakBrowserClient,
    private readonly mail: GongXiMailClient,
    private readonly dataDir: string = process.env.TEAMMGR_DATA_DIR?.trim() || './data'
  ) {}

  async register(options: SubaccountRegistrationOptions): Promise<SubaccountRegistrationResult> {
    const events: SubaccountRegistrationEvent[] = [];
    const emit = async (event: SubaccountRegistrationEvent) => {
      const normalized = { at: new Date().toISOString(), ...event };
      events.push(normalized);
      console.log(`[subaccount-registration] ${JSON.stringify(normalized)}`);
      await options.onEvent?.(normalized);
    };
    const jobId = options.jobId?.trim() || `manual-${Date.now()}`;
    const identity: RegistrationIdentity = {
      email: options.email?.trim() || await this.mail.allocateEmail(options.mailGroup, emit),
      password: options.password?.trim() || generatePassword(),
      ...generateProfile()
    };
    await emit({
      phase: 'registration_identity_ready',
      email: identity.email,
      password: identity.password,
      name: identity.name,
      birthdate: identity.birthdate
    });

    let profile: CloakProfile | undefined;
    let startAttempt = 1;
    if (options.cloakProfileId) {
      profile = await this.cloak.getProfile(options.cloakProfileId, emit);
      startAttempt = 3;
      await emit({
        phase: 'cloak_profile_resume',
        email: identity.email,
        cloakProfileId: profile.id,
        cloakProfileName: profile.name,
        message: '复用等待人工处理的 CloakBrowser profile 继续注册'
      });
    }

    for (let attempt = startAttempt; attempt <= 3; attempt += 1) {
      if (!profile) profile = await this.cloak.createProfile(identity.email, jobId, emit);
      await emit({
        phase: 'cloak_registration_attempt',
        attempt,
        maxAttempts: 3,
        email: identity.email,
        cloakProfileId: profile.id,
        cloakProfileName: profile.name
      });

      try {
        const result = await this.runBrowserAttempt(
          profile,
          identity,
          jobId,
          attempt,
          Boolean(options.cloakProfileId),
          events,
          emit
        );
        await this.cloak.stopProfile(profile.id, emit).catch(async (error) => {
          await emit({ phase: 'cloak_profile_stop_failed', error: serializeError(error) });
        });
        return {
          ...result,
          events,
          registrationMethod: 'cloak_browser',
          cloakProfileId: profile.id,
          cloakProfileName: profile.name
        };
      } catch (error) {
        const challenge = error instanceof CloakChallengeError;
        const retryableEnvironment = challenge || isRetryableBrowserEnvironmentError(error);
        await emit({
          phase: challenge
            ? 'cloak_challenge_detected'
            : retryableEnvironment
              ? 'cloak_environment_retry'
              : 'cloak_registration_failed',
          attempt,
          email: identity.email,
          cloakProfileId: profile.id,
          cloakProfileName: profile.name,
          error: serializeError(error)
        });
        if (!retryableEnvironment) {
          await this.cloak.stopProfile(profile.id, emit).catch(async (stopError) => {
            await emit({ phase: 'cloak_profile_stop_failed', error: serializeError(stopError) });
          });
          await this.cloak.deleteProfile(profile.id, emit, profile.proxySession).catch(async (deleteError) => {
            await emit({ phase: 'cloak_profile_delete_failed', error: serializeError(deleteError) });
          });
          throw this.registrationError(error, 'registration_failed', identity, events, profile);
        }
        if (attempt >= 3) {
          if (!challenge) {
            await this.cloak.stopProfile(profile.id, emit).catch(async (stopError) => {
              await emit({ phase: 'cloak_profile_stop_failed', error: serializeError(stopError) });
            });
            await this.cloak.deleteProfile(profile.id, emit, profile.proxySession).catch(async (deleteError) => {
              await emit({ phase: 'cloak_profile_delete_failed', error: serializeError(deleteError) });
            });
            throw this.registrationError(
              new Error(`连续三次浏览器代理环境不可用: ${(error as Error).message}`),
              'registration_failed',
              identity,
              events,
              profile
            );
          }
          throw this.registrationError(
            new Error('连续三次遇到 Cloudflare/CAPTCHA，已保留最后一个独立 profile，等待人工处理'),
            'verification_required',
            identity,
            events,
            profile,
            'cloak_manual_required'
          );
        }
        await this.cloak.deleteProfile(profile.id, emit, profile.proxySession);
        profile = undefined;
        await this.cloak.rotateProxy(attempt, identity.email, emit);
      }
    }
    throw new Error('unreachable');
  }

  async completeMailbox(email: string): Promise<SubaccountRegistrationMailboxResult> {
    const events: SubaccountRegistrationEvent[] = [];
    const result = await this.mail.moveToRegisteredGroup(email, async (event) => {
      events.push(event);
    });
    return { ...result, events };
  }

  private async runBrowserAttempt(
    profile: CloakProfile,
    identity: RegistrationIdentity,
    jobId: string,
    attempt: number,
    resumeProfile: boolean,
    events: SubaccountRegistrationEvent[],
    emit: (event: SubaccountRegistrationEvent) => Promise<void>
  ): Promise<Omit<SubaccountRegistrationResult, 'events' | 'registrationMethod' | 'cloakProfileId' | 'cloakProfileName'>> {
    await this.cloak.launchProfile(profile.id, emit);
    const { browser, context, page } = await this.cloak.connect(profile.id);
    const artifactDir = join(
      this.dataDir,
      'subaccount-registration-artifacts',
      jobId,
      `attempt-${attempt}-${profile.id}`
    );
    await mkdir(artifactDir, { recursive: true });
    this.installRawPageLogging(page, emit);
    let shouldClose = true;
    try {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false }).catch(() => undefined);
      await emit({
        phase: 'cloak_browser_connected',
        email: identity.email,
        cloakProfileId: profile.id,
        cloakProfileName: profile.name,
        artifactDir
      });
      if (resumeProfile) {
        const resumedSession = await this.tryFetchCurrentSession(page, context, emit);
        if (resumedSession) {
          const parsed = parseChatGptSessionInput(resumedSession);
          if ('error' in parsed) throw new Error(`ChatGPT Session 无效: ${parsed.error}`);
          await context.tracing.stop({ path: join(artifactDir, 'trace.zip') }).catch(() => undefined);
          const callbackUrl = page.url();
          await browser.close();
          shouldClose = false;
          return {
            email: identity.email,
            password: identity.password,
            name: identity.name,
            birthdate: identity.birthdate,
            callbackUrl,
            session: parsed
          };
        }
      }
      await this.openSignup(page, emit, resumeProfile);
      await this.capture(page, artifactDir, '01-signup-entry', emit);
      await this.throwIfChallenge(page);

      await this.fillEmail(page, identity.email, emit);
      await this.capture(page, artifactDir, '02-email-submitted', emit);
      await this.throwIfChallenge(page);

      await this.fillPassword(page, identity.password, emit);
      const otpRequestedAt = Date.now();
      await this.capture(page, artifactDir, '03-password-submitted', emit);
      await this.throwIfChallenge(page);

      await this.fillEmailCode(page, identity.email, otpRequestedAt, emit);
      await this.capture(page, artifactDir, '04-email-verified', emit);
      await this.throwIfChallenge(page);

      await this.fillProfile(page, identity, emit);
      await this.capture(page, artifactDir, '05-profile-submitted', emit);
      await this.throwIfChallenge(page);

      const session = await this.fetchSession(page, context, emit);
      const parsed = parseChatGptSessionInput(session);
      if ('error' in parsed) throw new Error(`ChatGPT Session 无效: ${parsed.error}`);
      if (parsed.user.email.toLowerCase() !== identity.email.toLowerCase()) {
        throw new Error(`注册邮箱与 Session 邮箱不一致: ${identity.email} != ${parsed.user.email}`);
      }
      await this.capture(page, artifactDir, '06-session-ready', emit);
      await context.tracing.stop({ path: join(artifactDir, 'trace.zip') }).catch(() => undefined);
      const callbackUrl = page.url();
      await browser.close();
      shouldClose = false;
      return {
        email: identity.email,
        password: identity.password,
        name: identity.name,
        birthdate: identity.birthdate,
        callbackUrl,
        session: parsed
      };
    } catch (error) {
      await this.capture(page, artifactDir, 'error', emit).catch(() => undefined);
      await context.tracing.stop({ path: join(artifactDir, 'trace.zip') }).catch(() => undefined);
      if (error instanceof CloakChallengeError && attempt >= 3) {
        shouldClose = false;
        await emit({
          phase: 'cloak_profile_kept_running_for_manual',
          attempt,
          email: identity.email,
          cloakProfileId: profile.id,
          cloakProfileName: profile.name,
          url: page.url(),
          message: '已保持 CloakBrowser profile 和当前验证页面运行，等待人工接管'
        });
      }
      throw error;
    } finally {
      if (shouldClose) await browser.close().catch(() => undefined);
    }
  }

  private async openSignup(
    page: Page,
    emit: (event: SubaccountRegistrationEvent) => Promise<void>,
    resumeProfile: boolean
  ): Promise<void> {
    if (resumeProfile && /^https:\/\/(chatgpt|auth)\.openai\.com|^https:\/\/chatgpt\.com/i.test(page.url())) {
      await this.settle(page);
      await this.throwIfChallenge(page);
      if (await this.visible(page.locator('input, button'), 3000)) {
        await emit({ phase: 'cloak_signup_resume_page', url: page.url() });
        return;
      }
    }
    await emit({ phase: 'cloak_signup_open', url: 'https://chatgpt.com/auth/login' });
    await this.gotoCommitted(page, 'https://chatgpt.com/auth/login', emit);
    await this.settle(page);
    await this.throwIfChallenge(page);
    const emailInput = page.locator('input[type="email"], input[name="email"], input[autocomplete="email"]');
    if (await this.visible(emailInput)) return;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const signup = page.getByRole('button', { name: /sign up|注册|创建账号|create account/i }).or(
        page.getByRole('link', { name: /sign up|注册|创建账号|create account/i })
      );
      if (await this.visible(signup, 5000)) {
        await this.clickWithoutNavigationWait(page, signup.first());
        await this.settle(page, 2500);
        await this.throwIfChallenge(page);
        if (await this.visible(emailInput, 5000)) return;
      }
    }
    throw new Error(`OPENAI_AUTH_ENTRY_UNAVAILABLE: 未能从 ChatGPT 登录入口建立注册会话: ${page.url()}`);
  }

  private async fillEmail(
    page: Page,
    email: string,
    emit: (event: SubaccountRegistrationEvent) => Promise<void>
  ): Promise<void> {
    const input = page.locator('input[type="email"], input[name="email"], input[autocomplete="email"]').first();
    try {
      await input.waitFor({ state: 'visible', timeout: 30_000 });
    } catch (error) {
      await this.throwIfChallenge(page);
      await this.throwIfBrokenAuthPage(page);
      throw error;
    }
    for (let submission = 1; submission <= 3; submission += 1) {
      await humanPause();
      await input.fill(email);
      await emit({ phase: 'registration_email_filled', email, submission, url: page.url() });
      await this.clickContinue(page, input);
      try {
        const result = await page.waitForFunction(() => {
          const next = document.querySelector(
            'input[type="password"], input[autocomplete="one-time-code"], input[name="code"]'
          );
          if (next) return 'next';
          const emailInput = document.querySelector(
            'input[type="email"], input[name="email"], input[autocomplete^="email"]'
          ) as HTMLInputElement | null;
          return emailInput && emailInput.value === '' ? 'email_cleared' : false;
        }, undefined, { timeout: 60_000 });
        if (await result.jsonValue() === 'next') return;
        await this.throwIfChallenge(page);
        await emit({
          phase: 'registration_email_resubmit_after_challenge',
          email,
          submission,
          url: page.url(),
          message: 'Cloudflare 校验完成后返回空邮箱表单，正在同一 profile 重新提交'
        });
      } catch (error) {
        await this.throwIfChallenge(page);
        throw error;
      }
    }
    throw new Error(`OPENAI_AUTH_EMAIL_SUBMISSION_LOOP: 邮箱连续三次提交后仍返回登录表单: ${page.url()}`);
  }

  private async fillPassword(
    page: Page,
    password: string,
    emit: (event: SubaccountRegistrationEvent) => Promise<void>
  ): Promise<void> {
    const input = page.locator('input[type="password"], input[name="password"], input[autocomplete="new-password"]').first();
    if (!(await this.visible(input))) {
      const switchToPassword = page.getByRole('button', {
        name: /continue with password|use password|使用密码|密码继续/i
      }).or(page.getByRole('link', { name: /continue with password|use password|使用密码|密码继续/i })).first();
      if (!(await this.visible(switchToPassword, 5000))) {
        throw new Error(`注册页面没有提供密码输入或“Continue with password”入口: ${page.url()}`);
      }
      await humanPause();
      await this.clickWithoutNavigationWait(page, switchToPassword);
      await this.settle(page);
      await input.waitFor({ state: 'visible', timeout: 20_000 });
      await emit({ phase: 'registration_password_branch_selected', url: page.url() });
    }
    for (let submission = 1; submission <= 3; submission += 1) {
      await humanPause();
      await input.fill(password);
      await emit({ phase: 'registration_password_filled', password, submission, url: page.url() });
      await this.clickContinue(page, input);
      const result = await page.waitForFunction(() => {
        const text = document.body?.innerText ?? '';
        if (/operation timed out|操作超时/i.test(text)) return 'operation_timed_out';
        if (document.querySelector(
          'input[autocomplete="one-time-code"], input[name="code"], input[name="name"], input[autocomplete="name"]'
        )) return 'next';
        if (location.hostname === 'chatgpt.com' && !location.pathname.startsWith('/auth')) return 'next';
        const passwordInput = document.querySelector(
          'input[type="password"], input[name="password"], input[autocomplete="new-password"]'
        ) as HTMLInputElement | null;
        return passwordInput && passwordInput.value === '' ? 'password_cleared' : false;
      }, undefined, { timeout: 60_000 }).then((handle) => handle.jsonValue());
      if (result === 'next') return;
      await this.throwIfChallenge(page);
      if (result === 'operation_timed_out') {
        const retry = page.getByRole('button', { name: /try again|重试|再试一次/i }).or(
          page.getByRole('link', { name: /try again|重试|再试一次/i })
        ).first();
        await retry.waitFor({ state: 'visible', timeout: 10_000 });
        await this.clickWithoutNavigationWait(page, retry);
        await this.settle(page);
        await input.waitFor({ state: 'visible', timeout: 30_000 });
      }
      await emit({
        phase: 'registration_password_resubmit',
        submission,
        reason: result,
        url: page.url(),
        message: result === 'operation_timed_out'
          ? 'OpenAI 密码提交超时，正在同一 profile 重试'
          : 'Cloudflare 校验后密码表单被清空，正在同一 profile 重填'
      });
    }
    throw new Error(`OPENAI_AUTH_PASSWORD_SUBMISSION_LOOP: 密码连续三次提交仍未进入验证码或资料步骤: ${page.url()}`);
  }

  private async fillEmailCode(
    page: Page,
    email: string,
    notBefore: number,
    emit: (event: SubaccountRegistrationEvent) => Promise<void>
  ): Promise<void> {
    const codeInput = page.locator(
      'input[autocomplete="one-time-code"], input[name="code"], input[inputmode="numeric"], input[placeholder*="code" i], input[placeholder*="验证码"]'
    ).first();
    if (!(await this.visible(codeInput, 20_000))) {
      await emit({ phase: 'registration_email_code_step_skipped', url: page.url() });
      return;
    }
    await emit({ phase: 'email_otp_send', email, requestedAt: notBefore });
    const code = await this.mail.pollVerificationCode(email, notBefore, emit);
    await humanPause();
    await codeInput.fill(code);
    await emit({ phase: 'email_otp_validate', email, code, url: page.url() });
    await this.clickContinue(page, codeInput);
    await this.settle(page);
  }

  private async fillProfile(
    page: Page,
    identity: RegistrationIdentity,
    emit: (event: SubaccountRegistrationEvent) => Promise<void>
  ): Promise<void> {
    const nameInput = page.locator(
      'input[name="name"], input[autocomplete="name"], input[placeholder*="full name" i], input[placeholder*="全名"]'
    ).first();
    if (!(await this.visible(nameInput, 30_000))) {
      await emit({ phase: 'registration_profile_step_skipped', url: page.url() });
      return;
    }
    await humanPause();
    await nameInput.fill(identity.name);
    const [year, month, day] = identity.birthdate.split('-');
    const birthdayInput = page.locator('input[name="birthday"]:visible').first();
    const ageInput = page.locator('input[name="age"]:visible').first();
    const yearInput = page.locator('[role="spinbutton"][data-type="year"]').first();
    const monthInput = page.locator('[role="spinbutton"][data-type="month"]').first();
    const dayInput = page.locator('[role="spinbutton"][data-type="day"]').first();
    if (await this.visible(birthdayInput)) {
      await birthdayInput.fill(identity.birthdate);
    } else if (await this.visible(yearInput)) {
      await fillEditable(yearInput, year!);
      await fillEditable(monthInput, month!);
      await fillEditable(dayInput, day!);
    } else if (await this.visible(ageInput)) {
      await ageInput.fill(String(new Date().getUTCFullYear() - Number(year)));
    } else {
      const hiddenBirthday = page.locator('input[name="birthday"]').first();
      if (await hiddenBirthday.count()) {
        await hiddenBirthday.evaluate((element, value) => {
          const input = element as HTMLInputElement;
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }, identity.birthdate);
      } else {
        throw new Error(`未找到生日或年龄输入项: ${page.url()}`);
      }
    }
    const consent = page.locator('input[type="checkbox"]:visible').first();
    if (await this.visible(consent) && !(await consent.isChecked())) await consent.check();
    await emit({
      phase: 'registration_profile_generated',
      name: identity.name,
      birthdate: identity.birthdate,
      url: page.url()
    });
    await this.clickContinue(page, nameInput);
    await this.settle(page, 5000);
    await emit({ phase: 'create_account', url: page.url() });
  }

  private async fetchSession(
    page: Page,
    context: BrowserContext,
    emit: (event: SubaccountRegistrationEvent) => Promise<void>
  ): Promise<unknown> {
    if (!page.url().startsWith('https://chatgpt.com')) {
      await this.gotoCommitted(page, 'https://chatgpt.com/', emit);
    }
    const deadline = Date.now() + 90_000;
    let last: { status: number; text: string } | undefined;
    while (Date.now() < deadline) {
      await this.throwIfChallenge(page);
      last = await page.evaluate(async () => {
        const response = await fetch(`/api/auth/session?t=${Date.now()}`, { credentials: 'include' });
        return { status: response.status, text: await response.text() };
      });
      let data: Record<string, unknown> | undefined;
      try {
        data = JSON.parse(last.text) as Record<string, unknown>;
      } catch {
        data = undefined;
      }
      const cookies = await context.cookies('https://chatgpt.com');
      const sessionToken = extractSessionToken(cookies);
      await emit({
        phase: 'chatgpt_auth_session',
        request: { method: 'GET', url: 'https://chatgpt.com/api/auth/session', cookies },
        response: { status: last.status, body: last.text, cookies },
        sessionToken
      });
      if (last.status === 200 && data?.accessToken && data?.user && data?.account && sessionToken) {
        return { ...data, sessionToken };
      }
      await delay(3000);
    }
    throw new Error(`chatgpt_auth_session_invalid_${last?.status ?? 0}: ${last?.text ?? ''}`);
  }

  private async tryFetchCurrentSession(
    page: Page,
    context: BrowserContext,
    emit: (event: SubaccountRegistrationEvent) => Promise<void>
  ): Promise<unknown | undefined> {
    if (!page.url().startsWith('https://chatgpt.com')) return undefined;
    const result = await page.evaluate(async () => {
      const response = await fetch(`/api/auth/session?t=${Date.now()}`, { credentials: 'include' });
      return { status: response.status, text: await response.text() };
    }).catch(() => undefined);
    if (!result || result.status !== 200) return undefined;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(result.text) as Record<string, unknown>;
    } catch {
      return undefined;
    }
    const cookies = await context.cookies('https://chatgpt.com');
    const sessionToken = extractSessionToken(cookies);
    await emit({
      phase: 'chatgpt_auth_session_resume',
      response: { status: result.status, body: result.text, cookies },
      sessionToken
    });
    return data.accessToken && data.user && data.account && sessionToken ? { ...data, sessionToken } : undefined;
  }

  private async clickContinue(page: Page, input?: Locator): Promise<void> {
    let button: Locator | undefined;
    if (input) {
      const form = input.locator('xpath=ancestor::form[1]');
      if (await form.count()) {
        const formSubmit = form.locator('button[type="submit"]:visible, input[type="submit"]:visible').first();
        if (await this.visible(formSubmit)) button = formSubmit;
      }
    }
    button ??= page.getByRole('button', {
      name: /^(continue|继续|下一步|create account|创建账号|完成帐户创建|finish|done|agree)$/i
    }).first();
    if (!(await this.visible(button, 5000)) && input) {
      await input.focus();
      await page.keyboard.press('Enter');
      await this.settle(page);
      return;
    }
    await button.waitFor({ state: 'visible', timeout: 20_000 });
    await this.clickWithoutNavigationWait(page, button);
    await this.settle(page);
  }

  private async clickWithoutNavigationWait(page: Page, locator: Locator): Promise<void> {
    await locator.waitFor({ state: 'visible', timeout: 20_000 });
    await locator.scrollIntoViewIfNeeded({ timeout: 20_000 });
    const box = await locator.boundingBox({ timeout: 20_000 });
    if (!box) throw new Error(`无法取得按钮位置: ${page.url()}`);
    await humanPause();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y, { steps: 4 });
    await page.mouse.click(x, y);
  }

  private async gotoCommitted(
    page: Page,
    url: string,
    emit: (event: SubaccountRegistrationEvent) => Promise<void>
  ): Promise<void> {
    try {
      await page.goto(url, { waitUntil: 'commit', timeout: 60_000 });
    } catch (error) {
      await this.settle(page).catch(() => undefined);
      await this.throwIfChallenge(page);
      if (isExpectedNavigationDestination(page.url(), url)) {
        await emit({
          phase: 'cloak_navigation_recovered',
          targetUrl: url,
          url: page.url(),
          error: serializeError(error),
          message: '导航等待异常，但页面已进入目标站点，继续按页面状态执行'
        });
        return;
      }
      if (isRetryableBrowserEnvironmentError(error)) {
        throw new CloakRetryableEnvironmentError(
          `浏览器导航环境异常: ${url}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      throw error;
    }
  }

  private async throwIfChallenge(page: Page): Promise<void> {
    const networkChallenge = this.networkChallenges.get(page);
    if (networkChallenge) throw new CloakChallengeError(networkChallenge);
    const state = await this.evaluateStableDocument(page, () => ({
      title: document.title,
      text: (document.body?.innerText ?? '').slice(0, 10_000),
      url: location.href,
      visibleChallenge: [...document.querySelectorAll(
        'iframe[src*="challenge"], iframe[src*="turnstile"], .cf-turnstile, #challenge-running, [data-sitekey]'
      )].some((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      })
    }));
    const combined = `${state.title}\n${state.text}\n${state.url}`;
    if (
      state.visibleChallenge
      || /just a moment|cf-chl|challenge-platform|checking your browser|verify you are human|验证您是真人|人机验证|完成安全验证|unable to load site|if you are using a vpn|ray id:/i.test(combined)
    ) {
      throw new CloakChallengeError(`检测到 Cloudflare/CAPTCHA: ${state.title} ${state.url}`);
    }
  }

  private async throwIfBrokenAuthPage(page: Page): Promise<void> {
    if (!page.url().startsWith('https://auth.openai.com')) return;
    const state = await this.evaluateStableDocument(page, () => ({
      styleSheetCount: document.styleSheets.length,
      text: (document.body?.innerText ?? '').slice(0, 3000),
      hasEmailInput: Boolean(document.querySelector('input[type="email"], input[name="email"]'))
    }));
    if (/your session has ended|session has expired|会话已结束|会话已过期/i.test(state.text)) {
      throw new Error(`OPENAI_AUTH_SESSION_ENDED: OpenAI 注册会话初始化失败: ${page.url()}`);
    }
    if (state.hasEmailInput && state.styleSheetCount === 0 && /create an account|email address/i.test(state.text)) {
      throw new CloakChallengeError(
        `OpenAI 注册页资源加载失败，页面退化为裸 HTML，视为当前 IP/浏览器环境不可用: ${page.url()}`
      );
    }
  }

  private async evaluateStableDocument<T>(page: Page, evaluator: () => T): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await page.evaluate(evaluator);
      } catch (error) {
        if (!isPageEvaluationInterruptedByNavigation(error)) throw error;
        lastError = error;
        if (attempt < 3) {
          await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined);
          await delay(attempt * 250);
        }
      }
    }
    throw new CloakRetryableEnvironmentError(
      `浏览器页面状态检查持续被导航打断: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    );
  }

  private installRawPageLogging(
    page: Page,
    emit: (event: SubaccountRegistrationEvent) => Promise<void>
  ): void {
    page.on('request', (request) => {
      if (!isRelevantRequest(request)) return;
      void emit({
        phase: 'cloak_page_request',
        request: {
          method: request.method(),
          url: request.url(),
          headers: request.headers(),
          postData: request.postData()
        }
      });
    });
    page.on('response', (response) => {
      if (!isRelevantResponse(response)) return;
      void response.allHeaders().then((headers) => {
        if (response.status() === 403 && headers['cf-mitigated'] === 'challenge') {
          this.networkChallenges.set(
            page,
            `检测到 Cloudflare HTTP challenge: ${response.status()} ${response.url()} cf-ray=${headers['cf-ray'] ?? ''}`
          );
        }
      });
      void logResponse(response, emit);
    });
    page.on('console', (message) => {
      void emit({ phase: 'cloak_page_console', type: message.type(), text: message.text(), url: page.url() });
    });
    page.on('pageerror', (error) => {
      void emit({ phase: 'cloak_page_error', error: serializeError(error), url: page.url() });
    });
  }

  private async capture(
    page: Page,
    artifactDir: string,
    label: string,
    emit: (event: SubaccountRegistrationEvent) => Promise<void>
  ): Promise<void> {
    const screenshotPath = join(artifactDir, `${label}.png`);
    const htmlPath = join(artifactDir, `${label}.html`);
    await Promise.all([
      page.screenshot({ path: screenshotPath, fullPage: true }),
      page.content().then((html) => writeFile(htmlPath, html, 'utf8'))
    ]);
    await emit({
      phase: 'cloak_page_capture',
      label,
      url: page.url(),
      title: await page.title(),
      screenshotPath,
      htmlPath
    });
  }

  private async visible(locator: Locator, timeout = 1000): Promise<boolean> {
    try {
      await locator.first().waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  private async waitForOne(page: Page, selectors: string[], timeout: number): Promise<void> {
    await Promise.race(selectors.map((selector) => page.locator(selector).first().waitFor({ state: 'visible', timeout })));
  }

  private async settle(page: Page, minimumMs = 1200): Promise<void> {
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined),
      delay(minimumMs)
    ]);
  }

  private registrationError(
    error: unknown,
    status: string,
    identity: RegistrationIdentity,
    events: SubaccountRegistrationEvent[],
    profile: CloakProfile,
    challenge?: string
  ): SubaccountRegistrationError {
    return new SubaccountRegistrationError(
      (error as Error).message,
      status,
      challenge,
      identity.email,
      identity.password,
      events,
      profile.id,
      profile.name,
      'cloak_browser'
    );
  }
}

function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(22);
  return `${[...bytes].map((value) => alphabet[value % alphabet.length]).join('')}!9a`;
}

function generateProfile(): Pick<RegistrationIdentity, 'name' | 'birthdate'> {
  const firstNames = ['Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Avery', 'Quinn'];
  const lastNames = ['Miller', 'Wilson', 'Anderson', 'Thomas', 'Jackson', 'Martin', 'Lee', 'Clark'];
  const bytes = randomBytes(5);
  const name = `${firstNames[bytes[0]! % firstNames.length]} ${lastNames[bytes[1]! % lastNames.length]}`;
  const year = 1986 + (bytes[2]! % 14);
  const month = 1 + (bytes[3]! % 12);
  const day = 1 + (bytes[4]! % 27);
  return { name, birthdate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}

async function fillEditable(locator: Locator, value: string): Promise<void> {
  await locator.click();
  await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await locator.fill(value).catch(async () => locator.pressSequentially(value, { delay: 80 }));
}

function extractSessionToken(cookies: Array<{ name: string; value: string }>): string {
  const direct = cookies.find((cookie) => cookie.name === '__Secure-next-auth.session-token')?.value;
  if (direct) return direct;
  return cookies
    .map((cookie) => {
      const match = cookie.name.match(/^__Secure-next-auth\.session-token\.(\d+)$/);
      return match ? { index: Number(match[1]), value: cookie.value } : undefined;
    })
    .filter((item): item is { index: number; value: string } => Boolean(item))
    .sort((left, right) => left.index - right.index)
    .map((item) => item.value)
    .join('');
}

function isRelevantRequest(request: Request): boolean {
  return ['document', 'xhr', 'fetch'].includes(request.resourceType())
    && /(^|\.)((chatgpt|openai)\.com)$/i.test(new URL(request.url()).hostname);
}

function isRelevantResponse(response: Response): boolean {
  return isRelevantRequest(response.request());
}

async function logResponse(
  response: Response,
  emit: (event: SubaccountRegistrationEvent) => Promise<void>
): Promise<void> {
  let body = '';
  try {
    body = await response.text();
  } catch (error) {
    body = `[response body unavailable: ${(error as Error).message}]`;
  }
  await emit({
    phase: 'cloak_page_response',
    response: {
      status: response.status(),
      url: response.url(),
      headers: await response.allHeaders(),
      body
    }
  });
}

function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { value: error };
  return { name: error.name, message: error.message, stack: error.stack };
}

export function isRetryableBrowserEnvironmentError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof CloakRetryableEnvironmentError
    || isPageEvaluationInterruptedByNavigation(error)
    || (error instanceof Error && error.name === 'TimeoutError')
    || /OPENAI_AUTH_(SESSION_ENDED|ENTRY_UNAVAILABLE|EMAIL_SUBMISSION_LOOP|PASSWORD_SUBMISSION_LOOP)|Target page, context or browser has been closed|Timeout \d+ms exceeded|ERR_ABORTED|ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_TIMED_OUT|SOCKS|proxy.*failed|Navigation interrupted by another one/i.test(message);
}

export function isPageEvaluationInterruptedByNavigation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Execution context was destroyed|Cannot find context with specified id|Inspected target navigated or closed|frame was detached/i.test(message);
}

function isExpectedNavigationDestination(currentUrl: string, targetUrl: string): boolean {
  try {
    const current = new URL(currentUrl);
    const target = new URL(targetUrl);
    if (target.hostname === 'chatgpt.com') {
      if (target.pathname === '/') return current.hostname === 'chatgpt.com';
      return current.hostname === 'chatgpt.com' || current.hostname === 'auth.openai.com';
    }
    return current.origin === target.origin;
  } catch {
    return false;
  }
}

function humanPause(): Promise<void> {
  return delay(450 + Math.floor(Math.random() * 800));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
