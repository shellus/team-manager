import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPageEvaluationInterruptedByNavigation,
  isRetryableBrowserEnvironmentError
} from './cloakSubaccountRegistration.js';

test('classifies observed Playwright navigation and click failures as retryable browser errors', () => {
  const timeout = new Error('page.goto: Timeout 90000ms exceeded.');
  timeout.name = 'TimeoutError';

  assert.equal(isRetryableBrowserEnvironmentError(timeout), true);
  assert.equal(
    isRetryableBrowserEnvironmentError(new Error('locator.click: Timeout 30000ms exceeded.')),
    true
  );
  assert.equal(
    isRetryableBrowserEnvironmentError(new Error('page.goto: net::ERR_ABORTED at https://chatgpt.com/')),
    true
  );
  assert.equal(
    isRetryableBrowserEnvironmentError(new Error('page.goto: net::ERR_PROXY_CONNECTION_FAILED')),
    true
  );
  assert.equal(
    isRetryableBrowserEnvironmentError(new Error(
      'page.evaluate: Execution context was destroyed, most likely because of a navigation'
    )),
    true
  );
});

test('recognizes page evaluation errors caused by an in-flight navigation', () => {
  assert.equal(
    isPageEvaluationInterruptedByNavigation(new Error(
      'page.evaluate: Execution context was destroyed, most likely because of a navigation'
    )),
    true
  );
  assert.equal(
    isPageEvaluationInterruptedByNavigation(new Error('注册邮箱与 Session 邮箱不一致')),
    false
  );
});

test('does not classify account and data validation failures as retryable browser errors', () => {
  assert.equal(
    isRetryableBrowserEnvironmentError(new Error('注册邮箱与 Session 邮箱不一致')),
    false
  );
  assert.equal(
    isRetryableBrowserEnvironmentError(new Error('ChatGPT Session 无效: 缺少 accessToken')),
    false
  );
});
