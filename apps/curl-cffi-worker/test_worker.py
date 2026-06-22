import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


def load_worker():
    fake_curl_cffi = types.ModuleType("curl_cffi")
    fake_curl_cffi.requests = types.SimpleNamespace()
    sys.modules.setdefault("curl_cffi", fake_curl_cffi)
    path = Path(__file__).with_name("worker.py")
    spec = importlib.util.spec_from_file_location("worker", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def load_phone_pool_migration():
    path = Path(__file__).with_name("phone_pool_migration.py")
    spec = importlib.util.spec_from_file_location("phone_pool_migration", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class PhonePoolMigrationTests(unittest.TestCase):
    def test_parse_legacy_txt_entries_from_supported_line_shapes(self):
        migration = load_phone_pool_migration()

        entries = migration.parse_legacy_phone_pool_text(
            """
section header
+15550000001|https://sms.example/inbox-a
1|15550000002|https://sms.example/inbox-b
+15550000001|https://sms.example/inbox-a
not a phone line
""".strip()
        )

        self.assertEqual(
            entries,
            [
                {"phone": "+15550000001", "url": "https://sms.example/inbox-a"},
                {"phone": "15550000002", "url": "https://sms.example/inbox-b"},
            ],
        )

    def test_build_yaml_document_initializes_self_managed_fields(self):
        migration = load_phone_pool_migration()

        document = migration.build_phone_pool_document(
            [{"phone": "+15550000001", "url": "https://sms.example/inbox-a"}]
        )

        self.assertEqual(
            document,
            {
                "version": 1,
                "phones": [
                    {
                        "phone": "+15550000001",
                        "url": "https://sms.example/inbox-a",
                        "exhausted": False,
                        "gptAccounts": [],
                    }
                ],
            },
        )


class PhoneVerificationTests(unittest.TestCase):
    def test_registration_flow_allocates_gongxi_email_and_uses_signup_register_sequence(self):
        worker = load_worker()

        class FakeSession:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        post_calls = []

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            post_calls.append({"path": path, "payload": payload, "phase": phase, "sentinelFlow": kwargs.get("sentinel_flow")})
            events.append({"phase": phase, "status": 200, "path": path})
            if path == "/api/accounts/authorize/continue":
                return 200, {"continue_url": "https://auth.openai.com/create-account/password", "page": {"type": "create_account_password"}}
            if path == "/api/accounts/user/register":
                return 200, {"continue_url": "https://auth.openai.com/email-verification", "page": {"type": "email_otp_send"}}
            if path == "/api/accounts/email-otp/validate":
                return 200, {
                    "continue_url": "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
                    "page": {"type": "sign_in_with_chatgpt_codex_consent"},
                    "oai-client-auth-session": {"workspaces": [{"id": "workspace-account-id"}]},
                }
            if path == "/api/accounts/workspace/select":
                return 200, {"continue_url": "http://localhost:1455/auth/callback?code=callback-code&state=expected-state", "page": {"type": "external_url"}}
            raise AssertionError(f"unexpected post path {path}")

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "status": 200, "path": path})
            return 200, {"continue_url": "https://auth.openai.com/email-verification", "page": {"type": "email_otp_verification"}}

        with (
            patch.object(worker.requests, "Session", return_value=FakeSession(), create=True),
            patch.object(worker, "allocate_gongxi_email", return_value="registered-child@example.com"),
            patch.object(worker, "generate_registration_password", return_value="generated-child-password"),
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/sign-up"),
            patch.object(worker, "cookie_value", return_value="device-id"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(worker, "poll_gongxi_code", return_value="123456"),
            patch.object(worker, "follow_to_callback", return_value="http://localhost:1455/auth/callback?code=callback-code&state=expected-state"),
            patch.object(
                worker,
                "exchange_codex_token",
                return_value={"access_token": "access", "refresh_token": "refresh", "id_token": "id"},
            ),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(worker, "GONGXI_MAIL_BASE_URL", "https://example.invalid/gongxi"),
            patch.object(worker, "GONGXI_MAIL_API_KEY", "gongxi-key"),
        ):
            result = worker.run_subaccount_registration(
                {
                    "authUrl": "https://auth.openai.com/oauth/authorize",
                    "state": "expected-state",
                    "codeVerifier": "verifier",
                    "mailGroup": "clean-outlook",
                    "targetChatgptAccountId": "workspace-account-id",
                }
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["email"], "registered-child@example.com")
        self.assertEqual(result["password"], "generated-child-password")
        self.assertEqual(post_calls[0]["payload"]["screen_hint"], "signup")
        self.assertEqual(post_calls[1]["path"], "/api/accounts/user/register")
        self.assertEqual(post_calls[1]["payload"], {"username": "registered-child@example.com", "password": "generated-child-password"})
        self.assertEqual(post_calls[1]["sentinelFlow"], "user_register")
        self.assertIn("tokenResponse", result)
        self.assertIn("email_otp_send", [event["phase"] for event in result["events"]])

    def test_registration_reports_verification_required_when_add_phone_has_no_pool(self):
        worker = load_worker()

        class FakeSession:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "status": 200, "path": path})
            if path == "/api/accounts/authorize/continue":
                return 200, {"continue_url": "https://auth.openai.com/create-account/password", "page": {"type": "create_account_password"}}
            if path == "/api/accounts/user/register":
                return 200, {"continue_url": "https://auth.openai.com/email-verification", "page": {"type": "email_otp_send"}}
            if path == "/api/accounts/email-otp/validate":
                return 200, {"continue_url": "https://auth.openai.com/add-phone", "page": {"type": "add_phone"}}
            raise AssertionError(f"unexpected post path {path}")

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "status": 200, "path": path})
            return 200, {"continue_url": "https://auth.openai.com/email-verification", "page": {"type": "email_otp_verification"}}

        with (
            patch.object(worker.requests, "Session", return_value=FakeSession(), create=True),
            patch.object(worker, "allocate_gongxi_email", return_value="registered-child@example.com"),
            patch.object(worker, "generate_registration_password", return_value="generated-child-password"),
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/sign-up"),
            patch.object(worker, "cookie_value", return_value="device-id"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(worker, "poll_gongxi_code", return_value="123456"),
            patch.object(worker, "PHONE_POOL_YAML", ""),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(worker, "GONGXI_MAIL_BASE_URL", "https://example.invalid/gongxi"),
            patch.object(worker, "GONGXI_MAIL_API_KEY", "gongxi-key"),
        ):
            result = worker.run_subaccount_registration(
                {
                    "authUrl": "https://auth.openai.com/oauth/authorize",
                    "state": "expected-state",
                    "codeVerifier": "verifier",
                    "targetChatgptAccountId": "workspace-account-id",
                }
            )

        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "verification_required")
        self.assertEqual(result["challenge"], "add_phone")
        self.assertEqual(result["email"], "registered-child@example.com")
        self.assertEqual(result["password"], "generated-child-password")
        self.assertIn("phone_pool_empty", [event["phase"] for event in result["events"]])

    def test_registration_signup_challenge_uses_solver_and_continues_to_password_creation(self):
        worker = load_worker()

        class FakeSession:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        post_calls = []

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            post_calls.append({"path": path, "payload": payload, "phase": phase})
            events.append({"phase": phase, "status": 200, "path": path})
            if path == "/api/accounts/authorize/continue":
                return 200, {
                    "continue_url": "https://auth.openai.com/auth-challenge",
                    "page": {
                        "type": "auth_challenge",
                        "payload": {"description": "Complete the captcha to continue."},
                    },
                }
            if path == "/api/accounts/user/register":
                return 200, {"continue_url": "https://auth.openai.com/email-verification", "page": {"type": "email_otp_send"}}
            if path == "/api/accounts/email-otp/validate":
                return 200, {
                    "continue_url": "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
                    "page": {"type": "sign_in_with_chatgpt_codex_consent"},
                    "oai-client-auth-session": {"workspaces": [{"id": "workspace-account-id"}]},
                }
            if path == "/api/accounts/workspace/select":
                return 200, {"continue_url": "http://localhost:1455/auth/callback?code=callback-code&state=expected-state", "page": {"type": "external_url"}}
            raise AssertionError(f"unexpected post path {path}")

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "status": 200, "path": path})
            if path == "/api/accounts/auth-challenge/continue":
                return 200, {
                    "continue_url": "https://auth.openai.com/create-account/password",
                    "page": {"type": "create_account_password"},
                }
            return 200, {"continue_url": "https://auth.openai.com/email-verification", "page": {"type": "email_otp_verification"}}

        with (
            patch.object(worker.requests, "Session", return_value=FakeSession(), create=True),
            patch.object(worker, "allocate_gongxi_email", return_value="registered-child@example.com"),
            patch.object(worker, "generate_registration_password", return_value="generated-child-password"),
            patch.object(worker, "solve_auth_page", side_effect=["https://auth.openai.com/sign-up", "https://auth.openai.com/api/accounts/auth-challenge/continue"]),
            patch.object(worker, "cookie_value", return_value="device-id"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(worker, "poll_gongxi_code", return_value="123456"),
            patch.object(worker, "follow_to_callback_result", return_value=("http://localhost:1455/auth/callback?code=callback-code&state=expected-state", None)),
            patch.object(
                worker,
                "exchange_codex_token",
                return_value={"access_token": "access", "refresh_token": "refresh", "id_token": "id"},
            ),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(worker, "GONGXI_MAIL_BASE_URL", "https://example.invalid/gongxi"),
            patch.object(worker, "GONGXI_MAIL_API_KEY", "gongxi-key"),
        ):
            result = worker.run_subaccount_registration(
                {
                    "authUrl": "https://auth.openai.com/oauth/authorize",
                    "state": "expected-state",
                    "codeVerifier": "verifier",
                    "targetChatgptAccountId": "workspace-account-id",
                }
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["email"], "registered-child@example.com")
        self.assertIn("human_verification_solver_continue", [event["phase"] for event in result["events"]])
        self.assertEqual([call["path"] for call in post_calls if call["path"] == "/api/accounts/user/register"], ["/api/accounts/user/register"])

    def test_registration_signup_challenge_reports_account_locked_with_allocated_credentials(self):
        worker = load_worker()

        class FakeSession:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "status": 200, "path": path})
            if path == "/api/accounts/authorize/continue":
                return 200, {
                    "continue_url": "https://auth.openai.com/auth-challenge",
                    "page": {
                        "type": "auth_challenge",
                        "payload": {"description": "Your account has been locked."},
                    },
                }
            raise AssertionError(f"unexpected post path {path}")

        with (
            patch.object(worker.requests, "Session", return_value=FakeSession(), create=True),
            patch.object(worker, "allocate_gongxi_email", return_value="registered-child@example.com"),
            patch.object(worker, "generate_registration_password", return_value="generated-child-password"),
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/sign-up"),
            patch.object(worker, "cookie_value", return_value="device-id"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(worker, "GONGXI_MAIL_BASE_URL", "https://example.invalid/gongxi"),
            patch.object(worker, "GONGXI_MAIL_API_KEY", "gongxi-key"),
        ):
            result = worker.run_subaccount_registration(
                {
                    "authUrl": "https://auth.openai.com/oauth/authorize",
                    "state": "expected-state",
                    "codeVerifier": "verifier",
                    "targetChatgptAccountId": "workspace-account-id",
                }
            )

        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "account_locked")
        self.assertEqual(result["challenge"], "account_locked")
        self.assertEqual(result["email"], "registered-child@example.com")
        self.assertEqual(result["password"], "generated-child-password")
        self.assertIn("account_locked", [event["phase"] for event in result["events"]])

    def test_registration_user_register_challenge_continues_to_email_otp_after_solver(self):
        worker = load_worker()

        class FakeSession:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        post_calls = []

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            post_calls.append({"path": path, "payload": payload, "phase": phase})
            events.append({"phase": phase, "status": 200, "path": path})
            if path == "/api/accounts/authorize/continue":
                return 200, {"continue_url": "https://auth.openai.com/create-account/password", "page": {"type": "create_account_password"}}
            if path == "/api/accounts/user/register":
                return 200, {
                    "continue_url": "https://auth.openai.com/auth-challenge",
                    "page": {
                        "type": "auth_challenge",
                        "payload": {"description": "Complete the captcha to continue."},
                    },
                }
            if path == "/api/accounts/email-otp/validate":
                return 200, {
                    "continue_url": "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
                    "page": {"type": "sign_in_with_chatgpt_codex_consent"},
                    "oai-client-auth-session": {"workspaces": [{"id": "workspace-account-id"}]},
                }
            if path == "/api/accounts/workspace/select":
                return 200, {"continue_url": "http://localhost:1455/auth/callback?code=callback-code&state=expected-state", "page": {"type": "external_url"}}
            raise AssertionError(f"unexpected post path {path}")

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "status": 200, "path": path})
            if path == "/api/accounts/auth-challenge/continue":
                return 200, {"continue_url": "https://auth.openai.com/email-verification", "page": {"type": "email_otp_send"}}
            if path == "/api/accounts/email-otp/send":
                return 200, {"continue_url": "https://auth.openai.com/email-verification", "page": {"type": "email_otp_verification"}}
            raise AssertionError(f"unexpected get path {path}")

        with (
            patch.object(worker.requests, "Session", return_value=FakeSession(), create=True),
            patch.object(worker, "allocate_gongxi_email", return_value="registered-child@example.com"),
            patch.object(worker, "generate_registration_password", return_value="generated-child-password"),
            patch.object(worker, "solve_auth_page", side_effect=["https://auth.openai.com/sign-up", "https://auth.openai.com/api/accounts/auth-challenge/continue"]),
            patch.object(worker, "cookie_value", return_value="device-id"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(worker, "poll_gongxi_code", return_value="123456"),
            patch.object(worker, "follow_to_callback_result", return_value=("http://localhost:1455/auth/callback?code=callback-code&state=expected-state", None)),
            patch.object(
                worker,
                "exchange_codex_token",
                return_value={"access_token": "access", "refresh_token": "refresh", "id_token": "id"},
            ),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(worker, "GONGXI_MAIL_BASE_URL", "https://example.invalid/gongxi"),
            patch.object(worker, "GONGXI_MAIL_API_KEY", "gongxi-key"),
        ):
            result = worker.run_subaccount_registration(
                {
                    "authUrl": "https://auth.openai.com/oauth/authorize",
                    "state": "expected-state",
                    "codeVerifier": "verifier",
                    "targetChatgptAccountId": "workspace-account-id",
                }
            )

        self.assertTrue(result["ok"])
        self.assertIn("human_verification_solver_continue", [event["phase"] for event in result["events"]])
        self.assertIn("email_otp_send", [event["phase"] for event in result["events"]])
        self.assertEqual([call["path"] for call in post_calls if call["path"] == "/api/accounts/email-otp/validate"], ["/api/accounts/email-otp/validate"])

    def test_workspace_select_human_challenge_uses_solver_before_token_exchange(self):
        worker = load_worker()
        events = []

        class FakeResponse:
            status_code = 200
            headers = {}
            text = "{}"

            def json(self):
                return {}

        class FakeCookies:
            jar = []

        class FakeSession:
            cookies = FakeCookies()

            def get(self, *args, **kwargs):
                return FakeResponse()

        consent_step = {
            "continue_url": "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
            "page": {"type": "sign_in_with_chatgpt_codex_consent"},
            "oai-client-auth-session": {"workspaces": [{"id": "workspace-account-id"}]},
        }
        challenge_step = {
            "continue_url": "https://auth.openai.com/auth-challenge",
            "page": {"type": "auth_challenge", "payload": {"description": "Complete the captcha to continue."}},
        }

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "path": path})
            if path == "/api/accounts/workspace/select":
                return 200, challenge_step
            raise AssertionError(f"unexpected post path {path}")

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "path": path})
            return 200, {
                "continue_url": "http://localhost:1455/auth/callback?code=callback-code&state=expected-state",
                "page": {"type": "external_url"},
            }

        with (
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(
                worker,
                "solve_auth_page",
                return_value="https://auth.openai.com/api/accounts/auth-challenge/continue",
            ),
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(
                worker,
                "exchange_codex_token",
                return_value={"access_token": "access", "refresh_token": "refresh", "id_token": "id"},
            ),
        ):
            result = worker.complete_codex_workspace_and_token(
                FakeSession(),
                consent_step,
                "device-id",
                "workspace-account-id",
                "expected-state",
                "verifier",
                events,
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["callbackUrl"], "http://localhost:1455/auth/callback?code=callback-code&state=expected-state")
        self.assertIn("human_verification_solver_continue", [event["phase"] for event in events])

    def test_token_stage_solver_returning_unknown_challenge_reports_verification_required(self):
        worker = load_worker()
        events = []
        step = {
            "continue_url": "https://auth.openai.com/auth-challenge",
            "page": {
                "type": "auth_challenge",
                "payload": {"description": "Complete the human verification to continue."},
            },
        }

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "status": 200, "path": path})
            return 200, {
                "continue_url": "https://auth.openai.com/auth-challenge",
                "page": {
                    "type": "auth_challenge",
                    "payload": {"description": "Additional verification is required."},
                },
            }

        with (
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/api/accounts/auth-challenge/continue"),
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
        ):
            resolved_step, challenge_error = worker.resolve_auth_challenge_for_token_stage(
                object(),
                step,
                "device-id",
                events,
            )

        self.assertEqual(resolved_step["page"]["type"], "auth_challenge")
        self.assertEqual(challenge_error["status"], "verification_required")
        self.assertEqual(challenge_error["challenge"], "auth_challenge")
        self.assertEqual(challenge_error["message"], "Auth challenge is required")
        self.assertIn("auth_challenge_required", [event["phase"] for event in events])

    def test_workspace_select_locked_error_is_returned_as_account_locked(self):
        worker = load_worker()
        events = []
        consent_step = {
            "continue_url": "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
            "page": {"type": "sign_in_with_chatgpt_codex_consent"},
            "oai-client-auth-session": {"workspaces": [{"id": "workspace-account-id"}]},
        }

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "path": path})
            if path == "/api/accounts/workspace/select":
                raise RuntimeError("workspace_select_failed_403: account disabled")
            raise AssertionError(f"unexpected post path {path}")

        with patch.object(worker, "post_auth_json", side_effect=post_auth_json):
            try:
                result = worker.complete_codex_workspace_and_token(
                    object(),
                    consent_step,
                    "device-id",
                    "workspace-account-id",
                    "expected-state",
                    "verifier",
                    events,
                )
            except RuntimeError as exc:
                self.fail(f"unexpected exception: {exc}")

        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "account_locked")
        self.assertEqual(result["challenge"], "account_locked")
        self.assertIn("account_locked", [event["phase"] for event in events])

    def test_token_exchange_locked_error_is_returned_as_account_locked(self):
        worker = load_worker()
        events = []
        consent_step = {
            "continue_url": "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
            "page": {"type": "sign_in_with_chatgpt_codex_consent"},
            "oai-client-auth-session": {"workspaces": [{"id": "workspace-account-id"}]},
        }

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "path": path})
            if path == "/api/accounts/workspace/select":
                return 200, {
                    "continue_url": "http://localhost:1455/auth/callback?code=callback-code&state=expected-state",
                    "page": {"type": "external_url"},
                }
            raise AssertionError(f"unexpected post path {path}")

        with (
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(
                worker,
                "follow_to_callback_result",
                return_value=("http://localhost:1455/auth/callback?code=callback-code&state=expected-state", None),
            ),
            patch.object(worker, "exchange_codex_token", side_effect=RuntimeError("oauth_token_exchange_failed_403: account locked")),
        ):
            try:
                result = worker.complete_codex_workspace_and_token(
                    object(),
                    consent_step,
                    "device-id",
                    "workspace-account-id",
                    "expected-state",
                    "verifier",
                    events,
                )
            except RuntimeError as exc:
                self.fail(f"unexpected exception: {exc}")

        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "account_locked")
        self.assertEqual(result["challenge"], "account_locked")
        self.assertIn("account_locked", [event["phase"] for event in events])

    def test_follow_to_callback_uses_solver_when_continue_returns_human_challenge(self):
        worker = load_worker()
        events = []

        class FakeCookies:
            jar = []

        class FakeResponse:
            status_code = 200
            headers = {}

            def __init__(self, data):
                self._data = data
                self.text = "{}"

            def json(self):
                return self._data

        class FakeSession:
            cookies = FakeCookies()

            def get(self, *args, **kwargs):
                return FakeResponse(
                    {
                        "continue_url": "https://auth.openai.com/auth-challenge",
                        "page": {
                            "type": "auth_challenge",
                            "payload": {"description": "Complete the captcha to continue."},
                        },
                    }
                )

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "path": path})
            return 200, {
                "continue_url": "http://localhost:1455/auth/callback?code=callback-code&state=expected-state",
                "page": {"type": "external_url"},
            }

        with (
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(
                worker,
                "solve_auth_page",
                return_value="https://auth.openai.com/api/accounts/auth-challenge/continue",
            ),
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
        ):
            callback_url = worker.follow_to_callback(
                FakeSession(),
                {"continue_url": "https://auth.openai.com/continue"},
                "device-id",
                events,
            )

        self.assertEqual(callback_url, "http://localhost:1455/auth/callback?code=callback-code&state=expected-state")
        self.assertIn("human_verification_solver_continue", [event["phase"] for event in events])

    def test_callback_follow_account_lock_is_returned_as_account_locked(self):
        worker = load_worker()
        events = []

        class FakeCookies:
            jar = []

        class FakeResponse:
            status_code = 200
            headers = {}

            def __init__(self, data):
                self._data = data
                self.text = "{}"

            def json(self):
                return self._data

        class FakeSession:
            cookies = FakeCookies()

            def get(self, *args, **kwargs):
                return FakeResponse(
                    {
                        "continue_url": "https://auth.openai.com/auth-challenge",
                        "page": {
                            "type": "auth_challenge",
                            "payload": {"description": "Your account has been locked."},
                        },
                    }
                )

        consent_step = {
            "continue_url": "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
            "page": {"type": "sign_in_with_chatgpt_codex_consent"},
            "oai-client-auth-session": {"workspaces": [{"id": "workspace-account-id"}]},
        }

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "path": path})
            if path == "/api/accounts/workspace/select":
                return 200, {"continue_url": "https://auth.openai.com/continue", "page": {"type": "external_url"}}
            raise AssertionError(f"unexpected post path {path}")

        with patch.object(worker, "post_auth_json", side_effect=post_auth_json):
            result = worker.complete_codex_workspace_and_token(
                FakeSession(),
                consent_step,
                "device-id",
                "workspace-account-id",
                "expected-state",
                "verifier",
                events,
            )

        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "account_locked")
        self.assertEqual(result["challenge"], "account_locked")
        self.assertIn("account_locked", [event["phase"] for event in events])

    def test_registration_retries_another_gongxi_email_when_allocated_email_already_exists(self):
        worker = load_worker()

        class FakeSession:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        post_calls = []

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            post_calls.append({"path": path, "payload": payload, "phase": phase})
            events.append({"phase": phase, "status": 200, "path": path})
            if path == "/api/accounts/authorize/continue":
                email = payload["username"]["value"]
                if email == "used-child@example.com":
                    return 200, {
                        "continue_url": "https://auth.openai.com/log-in/password",
                        "page": {"type": "login_password", "payload": {"description": "Account already exists"}},
                    }
                return 200, {
                    "continue_url": "https://auth.openai.com/create-account/password",
                    "page": {"type": "create_account_password"},
                }
            if path == "/api/accounts/user/register":
                return 200, {"continue_url": "https://auth.openai.com/email-verification", "page": {"type": "email_otp_send"}}
            if path == "/api/accounts/email-otp/validate":
                return 200, {
                    "continue_url": "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
                    "page": {"type": "sign_in_with_chatgpt_codex_consent"},
                    "oai-client-auth-session": {"workspaces": [{"id": "workspace-account-id"}]},
                }
            if path == "/api/accounts/workspace/select":
                return 200, {"continue_url": "http://localhost:1455/auth/callback?code=callback-code&state=expected-state", "page": {"type": "external_url"}}
            raise AssertionError(f"unexpected post path {path}")

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "status": 200, "path": path})
            return 200, {"continue_url": "https://auth.openai.com/email-verification", "page": {"type": "email_otp_verification"}}

        with (
            patch.object(worker.requests, "Session", return_value=FakeSession(), create=True),
            patch.object(worker, "allocate_gongxi_email", side_effect=["used-child@example.com", "registered-child@example.com"]),
            patch.object(worker, "generate_registration_password", side_effect=["used-child-password", "generated-child-password"]),
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/sign-up"),
            patch.object(worker, "cookie_value", return_value="device-id"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(worker, "poll_gongxi_code", return_value="123456"),
            patch.object(worker, "follow_to_callback", return_value="http://localhost:1455/auth/callback?code=callback-code&state=expected-state"),
            patch.object(
                worker,
                "exchange_codex_token",
                return_value={"access_token": "access", "refresh_token": "refresh", "id_token": "id"},
            ),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(worker, "GONGXI_MAIL_BASE_URL", "https://example.invalid/gongxi"),
            patch.object(worker, "GONGXI_MAIL_API_KEY", "gongxi-key"),
            patch.dict(worker.os.environ, {"TEAMMGR_REGISTRATION_EMAIL_MAX_ATTEMPTS": "2"}),
        ):
            result = worker.run_subaccount_registration(
                {
                    "authUrl": "https://auth.openai.com/oauth/authorize",
                    "state": "expected-state",
                    "codeVerifier": "verifier",
                    "targetChatgptAccountId": "workspace-account-id",
                }
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["email"], "registered-child@example.com")
        self.assertEqual(result["password"], "generated-child-password")
        self.assertEqual(
            [call["payload"]["username"]["value"] for call in post_calls if call["path"] == "/api/accounts/authorize/continue"],
            ["used-child@example.com", "registered-child@example.com"],
        )
        self.assertEqual(
            [call["payload"]["username"] for call in post_calls if call["path"] == "/api/accounts/user/register"],
            ["registered-child@example.com"],
        )
        self.assertIn("registration_email_rejected", [event["phase"] for event in result["events"]])

    def test_registration_retries_another_gongxi_email_when_signup_returns_email_otp_verification(self):
        worker = load_worker()

        class FakeSession:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        post_calls = []

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            post_calls.append({"path": path, "payload": payload, "phase": phase})
            events.append({"phase": phase, "status": 200, "path": path})
            if path == "/api/accounts/authorize/continue":
                email = payload["username"]["value"]
                if email == "used-child@example.com":
                    return 200, {
                        "continue_url": "https://auth.openai.com/email-verification",
                        "page": {"type": "email_otp_verification"},
                    }
                return 200, {
                    "continue_url": "https://auth.openai.com/create-account/password",
                    "page": {"type": "create_account_password"},
                }
            if path == "/api/accounts/user/register":
                return 200, {"continue_url": "https://auth.openai.com/email-verification", "page": {"type": "email_otp_send"}}
            if path == "/api/accounts/email-otp/validate":
                return 200, {
                    "continue_url": "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
                    "page": {"type": "sign_in_with_chatgpt_codex_consent"},
                    "oai-client-auth-session": {"workspaces": [{"id": "workspace-account-id"}]},
                }
            if path == "/api/accounts/workspace/select":
                return 200, {"continue_url": "http://localhost:1455/auth/callback?code=callback-code&state=expected-state", "page": {"type": "external_url"}}
            raise AssertionError(f"unexpected post path {path}")

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "status": 200, "path": path})
            return 200, {"continue_url": "https://auth.openai.com/email-verification", "page": {"type": "email_otp_verification"}}

        with (
            patch.object(worker.requests, "Session", return_value=FakeSession(), create=True),
            patch.object(worker, "allocate_gongxi_email", side_effect=["used-child@example.com", "registered-child@example.com"]),
            patch.object(worker, "generate_registration_password", side_effect=["used-child-password", "generated-child-password"]),
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/sign-up"),
            patch.object(worker, "cookie_value", return_value="device-id"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(worker, "poll_gongxi_code", return_value="123456"),
            patch.object(worker, "follow_to_callback", return_value="http://localhost:1455/auth/callback?code=callback-code&state=expected-state"),
            patch.object(
                worker,
                "exchange_codex_token",
                return_value={"access_token": "access", "refresh_token": "refresh", "id_token": "id"},
            ),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(worker, "GONGXI_MAIL_BASE_URL", "https://example.invalid/gongxi"),
            patch.object(worker, "GONGXI_MAIL_API_KEY", "gongxi-key"),
            patch.dict(worker.os.environ, {"TEAMMGR_REGISTRATION_EMAIL_MAX_ATTEMPTS": "2"}),
        ):
            result = worker.run_subaccount_registration(
                {
                    "authUrl": "https://auth.openai.com/oauth/authorize",
                    "state": "expected-state",
                    "codeVerifier": "verifier",
                    "targetChatgptAccountId": "workspace-account-id",
                }
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["email"], "registered-child@example.com")
        self.assertEqual(result["password"], "generated-child-password")
        self.assertEqual(
            [call["payload"]["username"]["value"] for call in post_calls if call["path"] == "/api/accounts/authorize/continue"],
            ["used-child@example.com", "registered-child@example.com"],
        )
        self.assertEqual(
            [call["payload"]["username"] for call in post_calls if call["path"] == "/api/accounts/user/register"],
            ["registered-child@example.com"],
        )
        self.assertIn("registration_email_rejected", [event["phase"] for event in result["events"]])

    def test_registration_returns_email_unavailable_without_credentials_when_all_allocated_emails_are_registered(self):
        worker = load_worker()

        class FakeSession:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "status": 200, "path": path})
            if path == "/api/accounts/authorize/continue":
                return 200, {
                    "continue_url": "https://auth.openai.com/email-verification",
                    "page": {"type": "email_otp_verification"},
                }
            raise AssertionError(f"unexpected post path {path}")

        with (
            patch.object(worker.requests, "Session", return_value=FakeSession(), create=True),
            patch.object(worker, "allocate_gongxi_email", side_effect=["used-one@example.com", "used-two@example.com"]),
            patch.object(worker, "generate_registration_password", side_effect=["used-one-password", "used-two-password"]),
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/sign-up"),
            patch.object(worker, "cookie_value", return_value="device-id"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(worker, "GONGXI_MAIL_BASE_URL", "https://example.invalid/gongxi"),
            patch.object(worker, "GONGXI_MAIL_API_KEY", "gongxi-key"),
            patch.dict(worker.os.environ, {"TEAMMGR_REGISTRATION_EMAIL_MAX_ATTEMPTS": "2"}),
        ):
            result = worker.run_subaccount_registration(
                {
                    "authUrl": "https://auth.openai.com/oauth/authorize",
                    "state": "expected-state",
                    "codeVerifier": "verifier",
                }
            )

        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["challenge"], "registration_email_unavailable")
        self.assertNotIn("email", result)
        self.assertNotIn("password", result)
        self.assertEqual([event["phase"] for event in result["events"]].count("registration_email_rejected"), 2)

    def test_registration_returns_verification_required_when_user_register_sentinel_fails(self):
        worker = load_worker()

        class FakeSession:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "status": 200, "path": path})
            if path == "/api/accounts/authorize/continue":
                return 200, {"continue_url": "https://auth.openai.com/create-account/password", "page": {"type": "create_account_password"}}
            if path == "/api/accounts/user/register":
                raise RuntimeError("user_register_failed_400: account_creation_failed")
            raise AssertionError(f"unexpected post path {path}")

        with (
            patch.object(worker.requests, "Session", return_value=FakeSession(), create=True),
            patch.object(worker, "allocate_gongxi_email", return_value="registered-child@example.com"),
            patch.object(worker, "generate_registration_password", return_value="generated-child-password"),
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/sign-up"),
            patch.object(worker, "cookie_value", return_value="device-id"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(worker, "GONGXI_MAIL_BASE_URL", "https://example.invalid/gongxi"),
            patch.object(worker, "GONGXI_MAIL_API_KEY", "gongxi-key"),
        ):
            result = worker.run_subaccount_registration(
                {
                    "authUrl": "https://auth.openai.com/oauth/authorize",
                    "state": "expected-state",
                    "codeVerifier": "verifier",
                }
            )

        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "verification_required")
        self.assertEqual(result["challenge"], "registration_sentinel")
        self.assertEqual(result["email"], "registered-child@example.com")
        self.assertEqual(result["password"], "generated-child-password")

    def test_registration_returns_account_locked_when_user_register_reports_locked_account(self):
        worker = load_worker()

        class FakeSession:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "status": 200, "path": path})
            if path == "/api/accounts/authorize/continue":
                return 200, {"continue_url": "https://auth.openai.com/create-account/password", "page": {"type": "create_account_password"}}
            if path == "/api/accounts/user/register":
                raise RuntimeError("user_register_failed_403: account disabled")
            raise AssertionError(f"unexpected post path {path}")

        with (
            patch.object(worker.requests, "Session", return_value=FakeSession(), create=True),
            patch.object(worker, "allocate_gongxi_email", return_value="locked-child@example.com"),
            patch.object(worker, "generate_registration_password", return_value="generated-child-password"),
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/sign-up"),
            patch.object(worker, "cookie_value", return_value="device-id"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(worker, "GONGXI_MAIL_BASE_URL", "https://example.invalid/gongxi"),
            patch.object(worker, "GONGXI_MAIL_API_KEY", "gongxi-key"),
        ):
            result = worker.run_subaccount_registration(
                {
                    "authUrl": "https://auth.openai.com/oauth/authorize",
                    "state": "expected-state",
                    "codeVerifier": "verifier",
                }
            )

        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "account_locked")
        self.assertEqual(result["challenge"], "account_locked")
        self.assertEqual(result["email"], "locked-child@example.com")
        self.assertEqual(result["password"], "generated-child-password")

    def test_auto_auth_retries_another_gongxi_code_when_email_otp_is_rejected(self):
        worker = load_worker()

        class FakeSession:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        validate_codes = []

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            if path == "/api/accounts/authorize/continue":
                events.append({"phase": phase, "status": 200, "path": path})
                return 200, {
                    "continue_url": "https://auth.openai.com/email-verification",
                    "page": {"type": "email_otp_verification"},
                }
            if path == "/api/accounts/email-otp/validate":
                validate_codes.append(payload["code"])
                if payload["code"] == "111111":
                    raise RuntimeError("email_otp_validate_failed_400: invalid verification code 111111")
                return 200, {
                    "continue_url": "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
                    "page": {"type": "sign_in_with_chatgpt_codex_consent"},
                    "oai-client-auth-session": {"workspaces": [{"id": "workspace-account-id"}]},
                }
            if path == "/api/accounts/workspace/select":
                return 200, {"continue_url": "http://localhost:1455/auth/callback?code=callback-code&state=expected-state", "page": {"type": "external_url"}}
            raise AssertionError(f"unexpected post path {path}")

        with (
            patch.object(worker.requests, "Session", return_value=FakeSession(), create=True),
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/log-in"),
            patch.object(worker, "cookie_value", return_value="device-id"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "poll_gongxi_code", side_effect=["111111", "222222"]),
            patch.object(worker, "follow_to_callback", return_value="http://localhost:1455/auth/callback?code=callback-code&state=expected-state"),
            patch.object(
                worker,
                "exchange_codex_token",
                return_value={"access_token": "access", "refresh_token": "refresh", "id_token": "id"},
            ),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(worker, "GONGXI_MAIL_BASE_URL", "https://example.invalid/gongxi"),
            patch.object(worker, "GONGXI_MAIL_API_KEY", "gongxi-key"),
            patch.dict(worker.os.environ, {"TEAMMGR_EMAIL_CODE_MAX_ATTEMPTS": "2"}),
        ):
            result = worker.run_codex_auto_auth(
                {
                    "email": "child@example.com",
                    "authUrl": "https://auth.openai.com/oauth/authorize",
                    "state": "expected-state",
                    "codeVerifier": "verifier",
                    "targetChatgptAccountId": "workspace-account-id",
                }
            )

        self.assertTrue(result["ok"])
        self.assertEqual(validate_codes, ["111111", "222222"])
        self.assertIn("email_otp_validate_rejected", [event["phase"] for event in result["events"]])
        self.assertNotIn("111111", str(result["events"]))

    def test_email_otp_validate_locked_challenge_reports_account_locked(self):
        worker = load_worker()
        events = []

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "status": 200, "path": path})
            return 200, {
                "continue_url": "https://auth.openai.com/auth-challenge",
                "page": {
                    "type": "auth_challenge",
                    "payload": {"description": "Your account has been disabled."},
                },
            }

        with (
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "poll_gongxi_code", return_value="123456"),
        ):
            step_json, email_error = worker.validate_email_otp_with_retry(
                object(),
                "child@example.com",
                worker.datetime.now(worker.timezone.utc),
                "https://auth.openai.com/email-verification",
                events,
                "email_otp_validate",
                "device-id",
            )

        self.assertEqual(step_json, {})
        self.assertEqual(email_error["kind"], "account_locked")
        self.assertEqual(email_error["message"], "Account is locked or unavailable")
        self.assertIn("account_locked", [event["phase"] for event in events])

    def test_email_otp_validate_human_challenge_uses_solver(self):
        worker = load_worker()
        events = []

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "status": 200, "path": path})
            return 200, {
                "continue_url": "https://auth.openai.com/auth-challenge",
                "page": {
                    "type": "auth_challenge",
                    "payload": {"description": "Complete the human verification to continue."},
                },
            }

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "status": 200, "path": path})
            return 200, {
                "continue_url": "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
                "page": {"type": "sign_in_with_chatgpt_codex_consent"},
            }

        with (
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "poll_gongxi_code", return_value="123456"),
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/api/accounts/auth-challenge/continue"),
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
        ):
            step_json, email_error = worker.validate_email_otp_with_retry(
                object(),
                "child@example.com",
                worker.datetime.now(worker.timezone.utc),
                "https://auth.openai.com/email-verification",
                events,
                "email_otp_validate",
                "device-id",
            )

        self.assertIsNone(email_error)
        self.assertEqual(step_json["page"]["type"], "sign_in_with_chatgpt_codex_consent")
        phases = [event["phase"] for event in events]
        self.assertIn("human_verification_solver_start", phases)
        self.assertIn("human_verification_solver_continue", phases)

    def test_email_otp_validate_unknown_challenge_reports_verification_required(self):
        worker = load_worker()
        events = []

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "status": 200, "path": path})
            return 200, {
                "continue_url": "https://auth.openai.com/auth-challenge",
                "page": {
                    "type": "auth_challenge",
                    "payload": {"description": "Additional verification is required."},
                },
            }

        with (
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "poll_gongxi_code", return_value="123456"),
        ):
            step_json, email_error = worker.validate_email_otp_with_retry(
                object(),
                "child@example.com",
                worker.datetime.now(worker.timezone.utc),
                "https://auth.openai.com/email-verification",
                events,
                "email_otp_validate",
                "device-id",
            )

        self.assertEqual(step_json, {})
        self.assertEqual(email_error["kind"], "auth_challenge")
        self.assertEqual(email_error["message"], "Auth challenge is required")
        self.assertIn("auth_challenge_required", [event["phase"] for event in events])

    def test_email_otp_send_human_challenge_uses_solver(self):
        worker = load_worker()
        events = []

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "status": 200, "path": path})
            if phase == "email_otp_send":
                return 200, {
                    "continue_url": "https://auth.openai.com/auth-challenge",
                    "page": {
                        "type": "auth_challenge",
                        "payload": {"description": "Complete the human verification to continue."},
                    },
                }
            if phase == "human_verification_solver_continue":
                return 200, {
                    "continue_url": "https://auth.openai.com/email-verification",
                    "page": {"type": "email_otp_verification"},
                }
            raise AssertionError(f"unexpected get phase {phase}")

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "status": 200, "path": path})
            return 200, {"page": {"type": "sign_in_with_chatgpt_codex_consent"}}

        with (
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/api/accounts/auth-challenge/continue"),
            patch.object(worker, "poll_gongxi_code", return_value="123456"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
        ):
            step_json, email_error = worker.complete_email_otp_steps(
                object(),
                {"continue_url": "https://auth.openai.com/email-verification", "page": {"type": "email_otp_send"}},
                "child@example.com",
                worker.datetime.now(worker.timezone.utc),
                events,
                "device-id",
            )

        self.assertIsNone(email_error)
        self.assertEqual(step_json["page"]["type"], "sign_in_with_chatgpt_codex_consent")
        phases = [event["phase"] for event in events]
        self.assertIn("human_verification_solver_start", phases)
        self.assertIn("email_otp_validate", phases)

    def test_email_otp_send_solver_returning_send_state_sends_again_before_validate(self):
        worker = load_worker()
        events = []
        send_count = 0

        def get_auth_json(session, path, referer, events, phase, device_id):
            nonlocal send_count
            events.append({"phase": phase, "status": 200, "path": path})
            if phase == "email_otp_send":
                send_count += 1
                if send_count == 1:
                    return 200, {
                        "continue_url": "https://auth.openai.com/auth-challenge",
                        "page": {
                            "type": "auth_challenge",
                            "payload": {"description": "Complete the human verification to continue."},
                        },
                    }
                return 200, {
                    "continue_url": "https://auth.openai.com/email-verification",
                    "page": {"type": "email_otp_verification"},
                }
            if phase == "human_verification_solver_continue":
                return 200, {
                    "continue_url": "https://auth.openai.com/email-verification",
                    "page": {"type": "email_otp_send"},
                }
            raise AssertionError(f"unexpected get phase {phase}")

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "status": 200, "path": path})
            return 200, {"page": {"type": "sign_in_with_chatgpt_codex_consent"}}

        with (
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/api/accounts/auth-challenge/continue"),
            patch.object(worker, "poll_gongxi_code", return_value="123456"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
        ):
            step_json, email_error = worker.complete_email_otp_steps(
                object(),
                {"continue_url": "https://auth.openai.com/email-verification", "page": {"type": "email_otp_send"}},
                "child@example.com",
                worker.datetime.now(worker.timezone.utc),
                events,
                "device-id",
            )

        self.assertIsNone(email_error)
        self.assertEqual(step_json["page"]["type"], "sign_in_with_chatgpt_codex_consent")
        self.assertEqual([event["phase"] for event in events].count("email_otp_send"), 2)
        self.assertIn("email_otp_validate", [event["phase"] for event in events])

    def test_email_otp_send_unknown_challenge_reports_verification_required(self):
        worker = load_worker()
        events = []

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "status": 200, "path": path})
            return 200, {
                "continue_url": "https://auth.openai.com/auth-challenge",
                "page": {
                    "type": "auth_challenge",
                    "payload": {"description": "Additional verification is required."},
                },
            }

        with patch.object(worker, "get_auth_json", side_effect=get_auth_json):
            step_json, email_error = worker.complete_email_otp_steps(
                object(),
                {"continue_url": "https://auth.openai.com/email-verification", "page": {"type": "email_otp_send"}},
                "child@example.com",
                worker.datetime.now(worker.timezone.utc),
                events,
                "device-id",
            )

        self.assertEqual(step_json, {})
        self.assertEqual(email_error["kind"], "auth_challenge")
        self.assertEqual(email_error["message"], "Auth challenge is required")
        self.assertIn("auth_challenge_required", [event["phase"] for event in events])

    def test_email_otp_send_loop_reports_verification_required(self):
        worker = load_worker()
        events = []

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "status": 200, "path": path})
            return 200, {
                "continue_url": "https://auth.openai.com/email-verification",
                "page": {"type": "email_otp_send"},
            }

        with patch.object(worker, "get_auth_json", side_effect=get_auth_json):
            step_json, email_error = worker.complete_email_otp_steps(
                object(),
                {"continue_url": "https://auth.openai.com/email-verification", "page": {"type": "email_otp_send"}},
                "child@example.com",
                worker.datetime.now(worker.timezone.utc),
                events,
                "device-id",
            )

        self.assertEqual(step_json, {})
        self.assertEqual(email_error["kind"], "email_otp_send_loop")
        self.assertEqual(email_error["message"], "Email OTP send did not reach verification")
        self.assertEqual([event["phase"] for event in events].count("email_otp_send"), 3)
        self.assertIn("email_otp_send_loop", [event["phase"] for event in events])

    def test_email_otp_steps_entry_human_challenge_uses_solver(self):
        worker = load_worker()
        events = []
        step = {
            "continue_url": "https://auth.openai.com/auth-challenge",
            "page": {
                "type": "auth_challenge",
                "payload": {"description": "Complete the human verification to continue."},
            },
        }

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "status": 200, "path": path})
            return 200, {
                "continue_url": "https://auth.openai.com/email-verification",
                "page": {"type": "email_otp_verification"},
            }

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "status": 200, "path": path})
            return 200, {"page": {"type": "sign_in_with_chatgpt_codex_consent"}}

        with (
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/api/accounts/auth-challenge/continue"),
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(worker, "poll_gongxi_code", return_value="123456"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
        ):
            step_json, email_error = worker.complete_email_otp_steps(
                object(),
                step,
                "child@example.com",
                worker.datetime.now(worker.timezone.utc),
                events,
                "device-id",
            )

        self.assertIsNone(email_error)
        self.assertEqual(step_json["page"]["type"], "sign_in_with_chatgpt_codex_consent")
        phases = [event["phase"] for event in events]
        self.assertIn("human_verification_solver_start", phases)
        self.assertIn("email_otp_validate", phases)

    def test_email_otp_steps_entry_unknown_challenge_reports_verification_required(self):
        worker = load_worker()
        events = []
        step = {
            "continue_url": "https://auth.openai.com/auth-challenge",
            "page": {
                "type": "auth_challenge",
                "payload": {"description": "Additional verification is required."},
            },
        }

        step_json, email_error = worker.complete_email_otp_steps(
            object(),
            step,
            "child@example.com",
            worker.datetime.now(worker.timezone.utc),
            events,
            "device-id",
        )

        self.assertEqual(step_json, {})
        self.assertEqual(email_error["kind"], "auth_challenge")
        self.assertEqual(email_error["message"], "Auth challenge is required")
        self.assertIn("auth_challenge_required", [event["phase"] for event in events])

    def test_auto_auth_sends_email_otp_when_login_returns_email_otp_send(self):
        worker = load_worker()

        class FakeSession:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "status": 200, "path": path})
            if path == "/api/accounts/authorize/continue":
                return 200, {
                    "continue_url": "https://auth.openai.com/email-verification",
                    "page": {"type": "email_otp_send"},
                }
            if path == "/api/accounts/email-otp/validate":
                return 200, {
                    "continue_url": "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
                    "page": {"type": "sign_in_with_chatgpt_codex_consent"},
                    "oai-client-auth-session": {"workspaces": [{"id": "workspace-account-id"}]},
                }
            if path == "/api/accounts/workspace/select":
                return 200, {
                    "continue_url": "http://localhost:1455/auth/callback?code=callback-code&state=expected-state",
                    "page": {"type": "external_url"},
                }
            raise AssertionError(f"unexpected post path {path}")

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "status": 200, "path": path})
            if path == "/api/accounts/email-otp/send":
                return 200, {
                    "continue_url": "https://auth.openai.com/email-verification",
                    "page": {"type": "email_otp_verification"},
                }
            raise AssertionError(f"unexpected get path {path}")

        with (
            patch.object(worker.requests, "Session", return_value=FakeSession(), create=True),
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/log-in"),
            patch.object(worker, "cookie_value", return_value="device-id"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(worker, "poll_gongxi_code", return_value="123456"),
            patch.object(worker, "follow_to_callback", return_value="http://localhost:1455/auth/callback?code=callback-code&state=expected-state"),
            patch.object(
                worker,
                "exchange_codex_token",
                return_value={"access_token": "access", "refresh_token": "refresh", "id_token": "id"},
            ),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(worker, "GONGXI_MAIL_BASE_URL", "https://example.invalid/gongxi"),
            patch.object(worker, "GONGXI_MAIL_API_KEY", "gongxi-key"),
        ):
            result = worker.run_codex_auto_auth(
                {
                    "email": "child@example.com",
                    "authUrl": "https://auth.openai.com/oauth/authorize",
                    "state": "expected-state",
                    "codeVerifier": "verifier",
                    "targetChatgptAccountId": "workspace-account-id",
                }
            )

        self.assertTrue(result["ok"])
        phases = [event["phase"] for event in result["events"]]
        self.assertIn("email_otp_send", phases)
        self.assertLess(phases.index("email_otp_send"), phases.index("email_otp_validate"))

    def test_auto_auth_continues_email_otp_after_human_challenge_solver(self):
        worker = load_worker()

        class FakeSession:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        def solve_auth_page(session, auth_url, events):
            if "auth-challenge" in auth_url:
                return "https://auth.openai.com/api/accounts/email-otp/send"
            return "https://auth.openai.com/log-in"

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "status": 200, "path": path})
            if path == "/api/accounts/authorize/continue":
                return 200, {
                    "continue_url": "https://auth.openai.com/auth-challenge",
                    "page": {
                        "type": "auth_challenge",
                        "payload": {"description": "Complete the human verification to continue."},
                    },
                }
            if path == "/api/accounts/email-otp/validate":
                return 200, {
                    "continue_url": "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
                    "page": {"type": "sign_in_with_chatgpt_codex_consent"},
                    "oai-client-auth-session": {"workspaces": [{"id": "workspace-account-id"}]},
                }
            if path == "/api/accounts/workspace/select":
                return 200, {
                    "continue_url": "http://localhost:1455/auth/callback?code=callback-code&state=expected-state",
                    "page": {"type": "external_url"},
                }
            raise AssertionError(f"unexpected post path {path}")

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "status": 200, "path": path})
            if phase == "human_verification_solver_continue":
                return 200, {
                    "continue_url": "https://auth.openai.com/email-verification",
                    "page": {"type": "email_otp_send"},
                }
            if phase == "email_otp_send":
                return 200, {
                    "continue_url": "https://auth.openai.com/email-verification",
                    "page": {"type": "email_otp_verification"},
                }
            raise AssertionError(f"unexpected get phase {phase}")

        with (
            patch.object(worker.requests, "Session", return_value=FakeSession(), create=True),
            patch.object(worker, "solve_auth_page", side_effect=solve_auth_page),
            patch.object(worker, "cookie_value", return_value="device-id"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(worker, "poll_gongxi_code", return_value="123456"),
            patch.object(worker, "follow_to_callback", return_value="http://localhost:1455/auth/callback?code=callback-code&state=expected-state"),
            patch.object(
                worker,
                "exchange_codex_token",
                return_value={"access_token": "access", "refresh_token": "refresh", "id_token": "id"},
            ),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(worker, "GONGXI_MAIL_BASE_URL", "https://example.invalid/gongxi"),
            patch.object(worker, "GONGXI_MAIL_API_KEY", "gongxi-key"),
        ):
            result = worker.run_codex_auto_auth(
                {
                    "email": "child@example.com",
                    "authUrl": "https://auth.openai.com/oauth/authorize",
                    "state": "expected-state",
                    "codeVerifier": "verifier",
                    "targetChatgptAccountId": "workspace-account-id",
                }
            )

        self.assertTrue(result["ok"])
        phases = [event["phase"] for event in result["events"]]
        self.assertIn("human_verification_solver_continue", phases)
        self.assertIn("email_otp_send", phases)
        self.assertIn("email_otp_validate", phases)
        self.assertIn("tokenResponse", result)

    def test_poll_phone_code_ignores_codes_that_already_exist_in_baseline(self):
        worker = load_worker()
        with (
            patch.object(
                worker,
                "fetch_phone_messages",
                side_effect=[
                    "OpenAI code 111111",
                    "OpenAI code 111111\nOpenAI code 222222",
                ],
            ),
            patch.object(worker.time, "sleep"),
            patch.object(worker.time, "time", side_effect=[0, 1, 2, 3]),
        ):
            code = worker.poll_phone_code("https://example.invalid/sms", "OpenAI code 111111")

        self.assertEqual(code, "222222")

    def test_yaml_phone_pool_skips_exhausted_numbers_for_new_bindings(self):
        worker = load_worker()
        with tempfile.TemporaryDirectory() as directory:
            pool_path = Path(directory) / "phone-pool.yaml"
            pool_path.write_text(
                """
version: 1
phones:
  - phone: "+100001"
    url: "https://example.invalid/exhausted"
    exhausted: true
    gptAccounts:
      - email: "old@example.com"
  - phone: "+100002"
    url: "https://example.invalid/available"
    exhausted: false
    gptAccounts: []
""".strip(),
                encoding="utf-8",
            )

            with patch.object(worker, "PHONE_POOL_YAML", str(pool_path)):
                entries = worker.ordered_phone_pool("new@example.com")

        self.assertEqual([entry["phone"] for entry in entries], ["+100002"])

    def test_worker_health_reports_available_and_exhausted_phone_pool_counts(self):
        worker = load_worker()
        with tempfile.TemporaryDirectory() as directory:
            pool_path = Path(directory) / "phone-pool.yaml"
            pool_path.write_text(
                """
version: 1
phones:
  - phone: "+100001"
    url: "https://example.invalid/exhausted"
    exhausted: true
  - phone: "+100002"
    url: "https://example.invalid/available"
    exhausted: false
""".strip(),
                encoding="utf-8",
            )

            with patch.object(worker, "PHONE_POOL_YAML", str(pool_path)):
                health = worker.worker_health_payload()

        self.assertEqual(health["phonePoolCount"], 1)
        self.assertEqual(health["phonePoolExhaustedCount"], 1)
        self.assertTrue(health["capabilities"]["phoneOtp"])
        self.assertIn("subaccountRegistration", health["capabilities"])

    def test_successful_add_phone_records_gpt_account_in_yaml(self):
        worker = load_worker()
        events = []
        with tempfile.TemporaryDirectory() as directory:
            pool_path = Path(directory) / "phone-pool.yaml"
            pool_path.write_text(
                """
version: 1
phones:
  - phone: "+100001"
    url: "https://example.invalid/sms"
    exhausted: false
    gptAccounts: []
""".strip(),
                encoding="utf-8",
            )

            with (
                patch.object(worker, "PHONE_POOL_YAML", str(pool_path)),
                patch.object(worker, "fetch_phone_messages", return_value='"no丨暂时没有收到消息"'),
                patch.object(worker, "poll_phone_code", return_value="123456"),
                patch.object(
                    worker,
                    "post_auth_json",
                    side_effect=[
                        (200, {"continue_url": "https://auth.openai.com/phone-verification", "page": {"type": "phone_otp_verification"}}),
                        (200, {"page": {"type": "sign_in_with_chatgpt_codex_consent"}}),
                    ],
                ),
            ):
                result = worker.complete_add_phone_verification(
                    object(),
                    {"continue_url": "https://auth.openai.com/add-phone"},
                    "device-id",
                    "child@example.com",
                    events,
                )
                stored = worker.load_phone_pool_document()

        self.assertEqual(result["page"]["type"], "sign_in_with_chatgpt_codex_consent")
        self.assertEqual(stored["phones"][0]["gptAccounts"][0]["email"], "child@example.com")
        self.assertFalse(stored["phones"][0]["exhausted"])

    def test_add_phone_retries_another_sms_code_when_first_code_is_rejected(self):
        worker = load_worker()
        events = []
        validate_codes = []
        with tempfile.TemporaryDirectory() as directory:
            pool_path = Path(directory) / "phone-pool.yaml"
            pool_path.write_text(
                """
version: 1
phones:
  - phone: "+100001"
    url: "https://example.invalid/sms"
    exhausted: false
    gptAccounts: []
""".strip(),
                encoding="utf-8",
            )

            def post_auth_json(*args, **kwargs):
                payload = args[2]
                if payload and payload.get("phone_number"):
                    return 200, {
                        "continue_url": "https://auth.openai.com/phone-verification",
                        "page": {"type": "phone_otp_verification"},
                    }
                if payload and payload.get("code"):
                    validate_codes.append(payload["code"])
                    if payload["code"] == "222222":
                        raise RuntimeError("phone_otp_validate_failed_400: invalid_code")
                    return 200, {"page": {"type": "sign_in_with_chatgpt_codex_consent"}}
                raise AssertionError(f"unexpected payload {payload}")

            with (
                patch.object(worker, "PHONE_POOL_YAML", str(pool_path)),
                patch.object(
                    worker,
                    "fetch_phone_messages",
                    side_effect=[
                        '"no丨暂时没有收到消息"',
                        "OpenAI code 111111\nAccount notice 222222",
                        "OpenAI code 111111\nAccount notice 222222",
                    ],
                ),
                patch.object(worker, "post_auth_json", side_effect=post_auth_json),
                patch.object(worker.time, "sleep"),
                patch.object(worker.time, "time", side_effect=[0, 1, 2, 3]),
            ):
                result = worker.complete_add_phone_verification(
                    object(),
                    {"continue_url": "https://auth.openai.com/add-phone"},
                    "device-id",
                    "child@example.com",
                    events,
                )
                stored = worker.load_phone_pool_document()

        self.assertEqual(result["page"]["type"], "sign_in_with_chatgpt_codex_consent")
        self.assertEqual(validate_codes, ["222222", "111111"])
        self.assertEqual(stored["phones"][0]["gptAccounts"][0]["email"], "child@example.com")
        self.assertIn("phone_otp_validate_rejected", [event["phase"] for event in events])
        self.assertNotIn("222222", str(events))

    def test_rejected_add_phone_marks_number_exhausted_and_skips_next_account(self):
        worker = load_worker()
        events = []
        with tempfile.TemporaryDirectory() as directory:
            pool_path = Path(directory) / "phone-pool.yaml"
            pool_path.write_text(
                """
version: 1
phones:
  - phone: "+100001"
    url: "https://example.invalid/rejected"
    exhausted: false
    gptAccounts: []
  - phone: "+100002"
    url: "https://example.invalid/available"
    exhausted: false
    gptAccounts: []
""".strip(),
                encoding="utf-8",
            )

            def post_auth_json(*args, **kwargs):
                payload = args[2]
                if payload and payload.get("phone_number") == "+100001":
                    raise RuntimeError("phone_send_failed_403: maximum number of accounts")
                if payload and payload.get("phone_number") == "+100002":
                    return 200, {
                        "continue_url": "https://auth.openai.com/phone-verification",
                        "page": {"type": "phone_otp_verification"},
                    }
                return 200, {"page": {"type": "sign_in_with_chatgpt_codex_consent"}}

            with (
                patch.object(worker, "PHONE_POOL_YAML", str(pool_path)),
                patch.object(worker, "fetch_phone_messages", return_value='"no丨暂时没有收到消息"'),
                patch.object(worker, "poll_phone_code", return_value="123456"),
                patch.object(worker, "post_auth_json", side_effect=post_auth_json),
                patch.dict(worker.os.environ, {"TEAMMGR_PHONE_MAX_ATTEMPTS": "2"}),
            ):
                result = worker.complete_add_phone_verification(
                    object(),
                    {"continue_url": "https://auth.openai.com/add-phone"},
                    "device-id",
                    "child@example.com",
                    events,
                )
                stored = worker.load_phone_pool_document()
                next_entries = worker.ordered_phone_pool("next@example.com")

        self.assertEqual(result["page"]["type"], "sign_in_with_chatgpt_codex_consent")
        self.assertTrue(stored["phones"][0]["exhausted"])
        self.assertEqual(stored["phones"][0]["exhaustedReason"], "phone_send_failed_403: maximum number of accounts")
        self.assertEqual(stored["phones"][1]["gptAccounts"][0]["email"], "child@example.com")
        self.assertEqual([entry["phone"] for entry in next_entries], ["+100002"])
        self.assertIn("phone_send_rejected", [event["phase"] for event in events])

    def test_add_phone_reports_account_locked_without_marking_number_exhausted(self):
        worker = load_worker()
        events = []
        with tempfile.TemporaryDirectory() as directory:
            pool_path = Path(directory) / "phone-pool.yaml"
            pool_path.write_text(
                """
version: 1
phones:
  - phone: "+100001"
    url: "https://example.invalid/sms"
    exhausted: false
    gptAccounts: []
""".strip(),
                encoding="utf-8",
            )

            def post_auth_json(*args, **kwargs):
                raise RuntimeError("phone_send_failed_403: Your account has been locked")

            with (
                patch.object(worker, "PHONE_POOL_YAML", str(pool_path)),
                patch.object(worker, "fetch_phone_messages", return_value='"no丨暂时没有收到消息"'),
                patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            ):
                result = worker.complete_add_phone_verification(
                    object(),
                    {"continue_url": "https://auth.openai.com/add-phone"},
                    "device-id",
                    "child@example.com",
                    events,
                )
                stored = worker.load_phone_pool_document()

        self.assertEqual(result["_phone_error"]["kind"], "account_locked")
        self.assertEqual(result["_phone_error"]["message"], "Account is locked or unavailable")
        self.assertFalse(stored["phones"][0]["exhausted"])
        self.assertEqual([event["phase"] for event in events], ["account_locked"])

    def test_add_phone_send_locked_challenge_reports_account_locked(self):
        worker = load_worker()
        events = []
        pool = [{"phone": "+100001", "url": "https://example.invalid/sms", "slot": "pool:1"}]

        def post_auth_json(*args, **kwargs):
            return 200, {
                "continue_url": "https://auth.openai.com/auth-challenge",
                "page": {
                    "type": "auth_challenge",
                    "payload": {"description": "Your account has been locked."},
                },
            }

        with (
            patch.object(worker, "ordered_phone_pool", return_value=pool),
            patch.object(worker, "fetch_phone_messages", return_value='"no丨暂时没有收到消息"'),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
        ):
            result = worker.complete_add_phone_verification(
                object(),
                {"continue_url": "https://auth.openai.com/add-phone"},
                "device-id",
                "child@example.com",
                events,
            )

        self.assertEqual(result["_phone_error"]["kind"], "account_locked")
        self.assertEqual(result["_phone_error"]["message"], "Account is locked or unavailable")
        self.assertIn("account_locked", [event["phase"] for event in events])

    def test_add_phone_send_human_challenge_uses_solver(self):
        worker = load_worker()
        events = []
        pool = [{"phone": "+100001", "url": "https://example.invalid/sms", "slot": "pool:1"}]

        def post_auth_json(*args, **kwargs):
            return 200, {
                "continue_url": "https://auth.openai.com/auth-challenge",
                "page": {
                    "type": "auth_challenge",
                    "payload": {"description": "Complete the human verification to continue."},
                },
            }

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "status": 200, "path": path})
            return 200, {
                "continue_url": "https://auth.openai.com/phone-verification",
                "page": {"type": "phone_otp_verification"},
            }

        with (
            patch.object(worker, "ordered_phone_pool", return_value=pool),
            patch.object(worker, "fetch_phone_messages", return_value='"no丨暂时没有收到消息"'),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/api/accounts/auth-challenge/continue"),
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(worker, "poll_phone_code", return_value="123456"),
            patch.object(worker, "validate_phone_otp_with_retry", return_value=({"page": {"type": "sign_in_with_chatgpt_codex_consent"}}, None)),
            patch.object(worker, "record_phone_pool_binding") as record_phone_pool_binding,
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
        ):
            result = worker.complete_add_phone_verification(
                object(),
                {"continue_url": "https://auth.openai.com/add-phone"},
                "device-id",
                "child@example.com",
                events,
            )

        self.assertEqual(result["page"]["type"], "sign_in_with_chatgpt_codex_consent")
        phases = [event["phase"] for event in events]
        self.assertIn("human_verification_solver_start", phases)
        self.assertIn("human_verification_solver_continue", phases)
        record_phone_pool_binding.assert_called_once()

    def test_add_phone_send_unknown_challenge_returns_verification_required(self):
        worker = load_worker()
        events = []
        pool = [{"phone": "+100001", "url": "https://example.invalid/sms", "slot": "pool:1"}]

        def post_auth_json(*args, **kwargs):
            return 200, {
                "continue_url": "https://auth.openai.com/auth-challenge",
                "page": {
                    "type": "auth_challenge",
                    "payload": {"description": "Additional verification is required."},
                },
            }

        with (
            patch.object(worker, "ordered_phone_pool", return_value=pool),
            patch.object(worker, "fetch_phone_messages", return_value='"no丨暂时没有收到消息"'),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
        ):
            result = worker.complete_add_phone_verification(
                object(),
                {"continue_url": "https://auth.openai.com/add-phone"},
                "device-id",
                "child@example.com",
                events,
            )

        self.assertEqual(result["_phone_error"]["kind"], "auth_challenge")
        self.assertEqual(result["_phone_error"]["message"], "Auth challenge is required")
        self.assertIn("auth_challenge_required", [event["phase"] for event in events])

    def test_add_phone_validate_reports_account_locked_without_binding_number(self):
        worker = load_worker()
        events = []
        with tempfile.TemporaryDirectory() as directory:
            pool_path = Path(directory) / "phone-pool.yaml"
            pool_path.write_text(
                """
version: 1
phones:
  - phone: "+100001"
    url: "https://example.invalid/sms"
    exhausted: false
    gptAccounts: []
""".strip(),
                encoding="utf-8",
            )

            def post_auth_json(*args, **kwargs):
                payload = args[2]
                if payload and payload.get("phone_number"):
                    return 200, {
                        "continue_url": "https://auth.openai.com/phone-verification",
                        "page": {"type": "phone_otp_verification"},
                    }
                if payload and payload.get("code"):
                    raise RuntimeError("phone_otp_validate_failed_403: account disabled")
                raise AssertionError(f"unexpected payload {payload}")

            with (
                patch.object(worker, "PHONE_POOL_YAML", str(pool_path)),
                patch.object(worker, "fetch_phone_messages", return_value='"no丨暂时没有收到消息"'),
                patch.object(worker, "poll_phone_code", return_value="123456"),
                patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            ):
                try:
                    result = worker.complete_add_phone_verification(
                        object(),
                        {"continue_url": "https://auth.openai.com/add-phone"},
                        "device-id",
                        "child@example.com",
                        events,
                    )
                except RuntimeError as exc:
                    self.fail(f"unexpected exception: {exc}")
                stored = worker.load_phone_pool_document()

        self.assertEqual(result["_phone_error"]["kind"], "account_locked")
        self.assertEqual(result["_phone_error"]["message"], "Account is locked or unavailable")
        self.assertFalse(stored["phones"][0]["exhausted"])
        self.assertEqual(stored["phones"][0].get("gptAccounts") or [], [])
        self.assertIn("account_locked", [event["phase"] for event in events])

    def test_add_phone_validate_locked_challenge_does_not_bind_number(self):
        worker = load_worker()
        events = []
        with tempfile.TemporaryDirectory() as directory:
            pool_path = Path(directory) / "phone-pool.yaml"
            pool_path.write_text(
                """
version: 1
phones:
  - phone: "+100001"
    url: "https://example.invalid/sms"
    exhausted: false
    gptAccounts: []
""".strip(),
                encoding="utf-8",
            )

            def post_auth_json(*args, **kwargs):
                payload = args[2]
                if payload and payload.get("phone_number"):
                    return 200, {
                        "continue_url": "https://auth.openai.com/phone-verification",
                        "page": {"type": "phone_otp_verification"},
                    }
                if payload and payload.get("code"):
                    return 200, {
                        "continue_url": "https://auth.openai.com/auth-challenge",
                        "page": {
                            "type": "auth_challenge",
                            "payload": {"description": "Your account has been locked."},
                        },
                    }
                raise AssertionError(f"unexpected payload {payload}")

            with (
                patch.object(worker, "PHONE_POOL_YAML", str(pool_path)),
                patch.object(worker, "fetch_phone_messages", return_value='"no丨暂时没有收到消息"'),
                patch.object(worker, "poll_phone_code", return_value="123456"),
                patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            ):
                result = worker.complete_add_phone_verification(
                    object(),
                    {"continue_url": "https://auth.openai.com/add-phone"},
                    "device-id",
                    "child@example.com",
                    events,
                )
                stored = worker.load_phone_pool_document()

        self.assertEqual(result["_phone_error"]["kind"], "account_locked")
        self.assertEqual(result["_phone_error"]["message"], "Account is locked or unavailable")
        self.assertFalse(stored["phones"][0]["exhausted"])
        self.assertEqual(stored["phones"][0].get("gptAccounts") or [], [])
        self.assertIn("account_locked", [event["phase"] for event in events])

    def test_add_phone_validate_human_challenge_without_solver_does_not_bind_number(self):
        worker = load_worker()
        events = []
        with tempfile.TemporaryDirectory() as directory:
            pool_path = Path(directory) / "phone-pool.yaml"
            pool_path.write_text(
                """
version: 1
phones:
  - phone: "+100001"
    url: "https://example.invalid/sms"
    exhausted: false
    gptAccounts: []
""".strip(),
                encoding="utf-8",
            )

            def post_auth_json(*args, **kwargs):
                payload = args[2]
                if payload and payload.get("phone_number"):
                    return 200, {
                        "continue_url": "https://auth.openai.com/phone-verification",
                        "page": {"type": "phone_otp_verification"},
                    }
                if payload and payload.get("code"):
                    return 200, {
                        "continue_url": "https://auth.openai.com/auth-challenge",
                        "page": {
                            "type": "auth_challenge",
                            "payload": {"description": "Complete the human verification to continue."},
                        },
                    }
                raise AssertionError(f"unexpected payload {payload}")

            with (
                patch.object(worker, "PHONE_POOL_YAML", str(pool_path)),
                patch.object(worker, "fetch_phone_messages", return_value='"no丨暂时没有收到消息"'),
                patch.object(worker, "poll_phone_code", return_value="123456"),
                patch.object(worker, "post_auth_json", side_effect=post_auth_json),
                patch.object(worker, "FLARESOLVERR_URL", ""),
            ):
                result = worker.complete_add_phone_verification(
                    object(),
                    {"continue_url": "https://auth.openai.com/add-phone"},
                    "device-id",
                    "child@example.com",
                    events,
                )
                stored = worker.load_phone_pool_document()

        self.assertEqual(result["_phone_error"]["kind"], "human_verification")
        self.assertEqual(result["_phone_error"]["message"], "Human verification is required")
        self.assertEqual(stored["phones"][0].get("gptAccounts") or [], [])
        self.assertIn("human_verification_required", [event["phase"] for event in events])

    def test_add_phone_validate_unknown_challenge_does_not_bind_number(self):
        worker = load_worker()
        events = []
        with tempfile.TemporaryDirectory() as directory:
            pool_path = Path(directory) / "phone-pool.yaml"
            pool_path.write_text(
                """
version: 1
phones:
  - phone: "+100001"
    url: "https://example.invalid/sms"
    exhausted: false
    gptAccounts: []
""".strip(),
                encoding="utf-8",
            )

            def post_auth_json(*args, **kwargs):
                payload = args[2]
                if payload and payload.get("phone_number"):
                    return 200, {
                        "continue_url": "https://auth.openai.com/phone-verification",
                        "page": {"type": "phone_otp_verification"},
                    }
                if payload and payload.get("code"):
                    return 200, {
                        "continue_url": "https://auth.openai.com/auth-challenge",
                        "page": {
                            "type": "auth_challenge",
                            "payload": {"description": "Additional verification is required."},
                        },
                    }
                raise AssertionError(f"unexpected payload {payload}")

            with (
                patch.object(worker, "PHONE_POOL_YAML", str(pool_path)),
                patch.object(worker, "fetch_phone_messages", return_value='"no丨暂时没有收到消息"'),
                patch.object(worker, "poll_phone_code", return_value="123456"),
                patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            ):
                result = worker.complete_add_phone_verification(
                    object(),
                    {"continue_url": "https://auth.openai.com/add-phone"},
                    "device-id",
                    "child@example.com",
                    events,
                )
                stored = worker.load_phone_pool_document()

        self.assertEqual(result["_phone_error"]["kind"], "auth_challenge")
        self.assertEqual(result["_phone_error"]["message"], "Auth challenge is required")
        self.assertEqual(stored["phones"][0].get("gptAccounts") or [], [])
        self.assertIn("auth_challenge_required", [event["phase"] for event in events])

    def test_phone_channel_send_reports_account_locked_in_shared_phone_steps(self):
        worker = load_worker()
        events = []
        step = {
            "continue_url": "https://auth.openai.com/phone-otp/select-channel",
            "page": {"type": "phone_otp_select_channel"},
        }

        def post_auth_json(*args, **kwargs):
            raise RuntimeError("phone_otp_send_failed_403: account disabled")

        with patch.object(worker, "post_auth_json", side_effect=post_auth_json):
            try:
                result = worker.complete_phone_steps(
                    object(),
                    step,
                    "device-id",
                    "child@example.com",
                    events,
                )
            except RuntimeError as exc:
                self.fail(f"unexpected exception: {exc}")

        self.assertEqual(result["_phone_result"]["challenge"], "account_locked")
        self.assertEqual(result["_phone_result"]["message"], "Account is locked or unavailable")
        self.assertEqual(result["_phone_error"]["kind"], "account_locked")

    def test_phone_channel_solver_returning_select_channel_sends_sms_again(self):
        worker = load_worker()
        events = []
        send_count = 0
        step = {
            "continue_url": "https://auth.openai.com/phone-otp/select-channel",
            "page": {"type": "phone_otp_select_channel"},
        }

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            nonlocal send_count
            events.append({"phase": phase, "status": 200, "path": path})
            if path == "/api/accounts/phone-otp/send":
                send_count += 1
                if send_count == 1:
                    return 200, {
                        "continue_url": "https://auth.openai.com/auth-challenge",
                        "page": {
                            "type": "auth_challenge",
                            "payload": {"description": "Complete the human verification to continue."},
                        },
                    }
                return 200, {
                    "continue_url": "https://auth.openai.com/phone-verification",
                    "page": {
                        "type": "phone_otp_verification",
                        "payload": {"phone_number": "+1 555 0188"},
                    },
                }
            if path == "/api/accounts/phone-otp/validate":
                return 200, {"page": {"type": "sign_in_with_chatgpt_codex_consent"}}
            raise AssertionError(f"unexpected post path {path}")

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "status": 200, "path": path})
            return 200, {
                "continue_url": "https://auth.openai.com/phone-otp/select-channel",
                "page": {"type": "phone_otp_select_channel"},
            }

        pool = [
            {"phone": "+15550188", "url": "https://example.invalid/sms", "slot": "pool:8"},
        ]
        with (
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/api/accounts/auth-challenge/continue"),
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(worker, "read_phone_pool", return_value=pool),
            patch.object(worker, "fetch_phone_messages", return_value='"no丨暂时没有收到消息"'),
            patch.object(worker, "poll_phone_code", return_value="123456"),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
        ):
            result = worker.complete_phone_steps(object(), step, "device-id", "child@example.com", events)

        self.assertEqual(result["page"]["type"], "sign_in_with_chatgpt_codex_consent")
        phases = [event["phase"] for event in events]
        self.assertEqual(phases.count("phone_otp_select_channel_send"), 2)
        self.assertIn("human_verification_solver_continue", phases)
        self.assertIn("bound_phone_otp_done", phases)

    def test_phone_channel_select_loop_reports_verification_required(self):
        worker = load_worker()
        events = []
        step = {
            "continue_url": "https://auth.openai.com/phone-otp/select-channel",
            "page": {"type": "phone_otp_select_channel"},
        }

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "status": 200, "path": path})
            return 200, {
                "continue_url": "https://auth.openai.com/phone-otp/select-channel",
                "page": {"type": "phone_otp_select_channel"},
            }

        with patch.object(worker, "post_auth_json", side_effect=post_auth_json):
            result = worker.complete_phone_steps(object(), step, "device-id", "child@example.com", events)

        self.assertEqual(result["_phone_result"]["challenge"], "phone_otp_select_channel_loop")
        self.assertEqual(result["_phone_error"]["kind"], "phone_otp_select_channel_loop")
        self.assertEqual([event["phase"] for event in events].count("phone_otp_select_channel_send"), 3)
        self.assertIn("phone_otp_select_channel_loop", [event["phase"] for event in events])

    def test_exhausted_phone_pool_returns_rejected_attempts(self):
        worker = load_worker()
        events = []
        pool = [
            {"phone": "+100001", "url": "https://example.invalid/1", "section": "## 未用", "slot": "pool:1"},
            {"phone": "+100002", "url": "https://example.invalid/2", "section": "## 未用", "slot": "pool:2"},
        ]

        def reject_phone_send(*args, **kwargs):
            raise RuntimeError("phone_send_failed_403: maximum number of accounts")

        with (
            patch.object(worker, "ordered_phone_pool", return_value=pool),
            patch.object(worker, "fetch_phone_messages", return_value='"no丨暂时没有收到消息"'),
            patch.object(worker, "post_auth_json", side_effect=reject_phone_send),
            patch.dict(worker.os.environ, {"TEAMMGR_PHONE_MAX_ATTEMPTS": "2"}),
        ):
            result = worker.complete_add_phone_verification(
                object(),
                {"continue_url": "https://auth.openai.com/add-phone"},
                "device-id",
                "child@example.com",
                events,
            )

        self.assertEqual(result["_phone_error"]["attempted"], 2)
        self.assertEqual(result["_phone_error"]["lastError"], "phone_send_failed_403: maximum number of accounts")
        self.assertEqual([event["phase"] for event in events], [
            "phone_send_rejected",
            "phone_send_rejected",
            "phone_send_exhausted",
        ])

    def test_existing_bound_phone_uses_matching_pool_entry(self):
        worker = load_worker()
        events = []
        pool = [
            {"phone": "+15550188", "url": "https://example.invalid/sms", "section": "## 已用", "slot": "pool:8"},
        ]
        step = {
            "continue_url": "https://auth.openai.com/phone-verification",
            "page": {
                "type": "phone_otp_verification",
                "payload": {"phone_number": "+1 555 0188"},
            },
        }

        with (
            patch.object(worker, "read_phone_pool", return_value=pool),
            patch.object(worker, "fetch_phone_messages", return_value='"no丨暂时没有收到消息"'),
            patch.object(worker, "poll_phone_code", return_value="123456"),
            patch.object(
                worker,
                "post_auth_json",
                return_value=(200, {"page": {"type": "sign_in_with_chatgpt_codex_consent"}}),
            ) as post_auth_json,
        ):
            result = worker.complete_existing_phone_verification(object(), step, "device-id", events)

        self.assertEqual(result["page"]["type"], "sign_in_with_chatgpt_codex_consent")
        post_auth_json.assert_called_once()
        self.assertEqual(post_auth_json.call_args.args[2], {"code": "123456"})
        self.assertEqual([event["phase"] for event in events], [
            "bound_phone_slot_selected",
            "bound_phone_otp_done",
        ])

    def test_existing_bound_phone_validate_reports_account_locked(self):
        worker = load_worker()
        events = []
        pool = [
            {"phone": "+15550188", "url": "https://example.invalid/sms", "slot": "pool:8"},
        ]
        step = {
            "continue_url": "https://auth.openai.com/phone-verification",
            "page": {
                "type": "phone_otp_verification",
                "payload": {"phone_number": "+1 555 0188"},
            },
        }

        def post_auth_json(*args, **kwargs):
            raise RuntimeError("bound_phone_otp_validate_failed_403: account locked")

        with (
            patch.object(worker, "read_phone_pool", return_value=pool),
            patch.object(worker, "fetch_phone_messages", return_value='"no丨暂时没有收到消息"'),
            patch.object(worker, "poll_phone_code", return_value="123456"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
        ):
            try:
                result = worker.complete_existing_phone_verification(object(), step, "device-id", events)
            except RuntimeError as exc:
                self.fail(f"unexpected exception: {exc}")

        self.assertEqual(result["_phone_error"]["kind"], "account_locked")
        self.assertEqual(result["_phone_error"]["message"], "Account is locked or unavailable")
        self.assertIn("account_locked", [event["phase"] for event in events])

    def test_existing_bound_phone_validate_locked_challenge_reports_account_locked(self):
        worker = load_worker()
        events = []
        pool = [
            {"phone": "+15550188", "url": "https://example.invalid/sms", "slot": "pool:8"},
        ]
        step = {
            "continue_url": "https://auth.openai.com/phone-verification",
            "page": {
                "type": "phone_otp_verification",
                "payload": {"phone_number": "+1 555 0188"},
            },
        }

        def post_auth_json(*args, **kwargs):
            return 200, {
                "continue_url": "https://auth.openai.com/auth-challenge",
                "page": {
                    "type": "auth_challenge",
                    "payload": {"description": "Your account has been disabled."},
                },
            }

        with (
            patch.object(worker, "read_phone_pool", return_value=pool),
            patch.object(worker, "fetch_phone_messages", return_value='"no丨暂时没有收到消息"'),
            patch.object(worker, "poll_phone_code", return_value="123456"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
        ):
            result = worker.complete_existing_phone_verification(object(), step, "device-id", events)

        self.assertEqual(result["_phone_error"]["kind"], "account_locked")
        self.assertEqual(result["_phone_error"]["message"], "Account is locked or unavailable")
        self.assertIn("account_locked", [event["phase"] for event in events])

    def test_existing_bound_phone_validate_human_challenge_uses_solver(self):
        worker = load_worker()
        events = []
        pool = [
            {"phone": "+15550188", "url": "https://example.invalid/sms", "slot": "pool:8"},
        ]
        step = {
            "continue_url": "https://auth.openai.com/phone-verification",
            "page": {
                "type": "phone_otp_verification",
                "payload": {"phone_number": "+1 555 0188"},
            },
        }

        def post_auth_json(*args, **kwargs):
            return 200, {
                "continue_url": "https://auth.openai.com/auth-challenge",
                "page": {
                    "type": "auth_challenge",
                    "payload": {"description": "Complete the human verification to continue."},
                },
            }

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "status": 200, "path": path})
            return 200, {
                "continue_url": "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
                "page": {"type": "sign_in_with_chatgpt_codex_consent"},
            }

        with (
            patch.object(worker, "read_phone_pool", return_value=pool),
            patch.object(worker, "fetch_phone_messages", return_value='"no丨暂时没有收到消息"'),
            patch.object(worker, "poll_phone_code", return_value="123456"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/api/accounts/auth-challenge/continue"),
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
        ):
            result = worker.complete_existing_phone_verification(object(), step, "device-id", events)

        self.assertEqual(result["page"]["type"], "sign_in_with_chatgpt_codex_consent")
        phases = [event["phase"] for event in events]
        self.assertIn("human_verification_solver_start", phases)
        self.assertIn("human_verification_solver_continue", phases)

    def test_existing_bound_phone_not_in_pool_returns_switch_email_signal(self):
        worker = load_worker()
        events = []
        pool = [
            {"phone": "+15550177", "url": "https://example.invalid/sms", "section": "## 已用", "slot": "pool:7"},
        ]
        step = {
            "continue_url": "https://auth.openai.com/phone-verification",
            "page": {
                "type": "phone_otp_verification",
                "payload": {"phone_number": "+1 555 0188"},
            },
        }

        with (
            patch.object(worker, "read_phone_pool", return_value=pool),
            patch.object(worker, "post_auth_json") as post_auth_json,
        ):
            result = worker.complete_existing_phone_verification(object(), step, "device-id", events)

        self.assertEqual(result["_phone_error"]["kind"], "phone_not_in_pool")
        self.assertEqual([event["phase"] for event in events], ["bound_phone_not_in_pool"])
        post_auth_json.assert_not_called()

    def test_existing_bound_phone_reports_invalid_sms_code_after_retry_budget(self):
        worker = load_worker()
        events = []
        pool = [
            {"phone": "+15550188", "url": "https://example.invalid/sms", "slot": "pool:8"},
        ]
        step = {
            "continue_url": "https://auth.openai.com/phone-verification",
            "page": {
                "type": "phone_otp_verification",
                "payload": {"phone_number": "+1 555 0188"},
            },
        }

        def post_auth_json(*args, **kwargs):
            raise RuntimeError("bound_phone_otp_validate_failed_400: incorrect verification code")

        with (
            patch.object(worker, "read_phone_pool", return_value=pool),
            patch.object(worker, "fetch_phone_messages", side_effect=['"no丨暂时没有收到消息"', "OpenAI code 111111"]),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker.time, "sleep"),
            patch.object(worker.time, "time", side_effect=[0, 1]),
            patch.dict(worker.os.environ, {"TEAMMGR_PHONE_CODE_MAX_ATTEMPTS": "1"}),
        ):
            result = worker.complete_existing_phone_verification(object(), step, "device-id", events)

        self.assertEqual(result["_phone_error"]["kind"], "phone_otp_invalid")
        self.assertIn("bound_phone_otp_validate_rejected", [event["phase"] for event in events])
        self.assertNotIn("111111", str(events))

    def test_post_auth_json_redacts_otp_codes_from_error_events(self):
        worker = load_worker()
        events = []

        class FakeCookies:
            jar = []

        class FakeResponse:
            status_code = 400
            text = '{"error":"invalid verification code 123456"}'
            headers = {}

            def json(self):
                return {"error": "invalid verification code 123456"}

        class FakeSession:
            cookies = FakeCookies()

            def post(self, *args, **kwargs):
                return FakeResponse()

        with self.assertRaises(RuntimeError) as raised:
            worker.post_auth_json(
                FakeSession(),
                "/api/accounts/phone-otp/validate",
                {"code": "123456"},
                "https://auth.openai.com/phone-verification",
                events,
                "phone_otp_validate",
                "device-id",
            )

        self.assertNotIn("123456", str(raised.exception))
        self.assertNotIn("123456", str(events))
        self.assertIn("<CODE>", str(events))

    def test_auth_challenge_with_human_verification_is_not_treated_as_missing_phone(self):
        worker = load_worker()
        events = []
        step = {
            "continue_url": "https://auth.openai.com/auth-challenge",
            "page": {
                "type": "auth_challenge",
                "payload": {"description": "Complete the captcha to continue."},
            },
        }

        with patch.object(worker, "post_auth_json") as post_auth_json:
            result = worker.complete_existing_phone_verification(object(), step, "device-id", events)

        self.assertEqual(result["_phone_error"]["kind"], "human_verification")
        self.assertEqual([event["phase"] for event in events], ["human_verification_required"])
        post_auth_json.assert_not_called()

    def test_auth_challenge_with_human_verification_uses_solver_and_continues_when_state_returns(self):
        worker = load_worker()
        events = []
        step = {
            "continue_url": "https://auth.openai.com/auth-challenge",
            "page": {
                "type": "auth_challenge",
                "payload": {"description": "Complete the captcha to continue."},
            },
        }
        pool = [
            {"phone": "+15550188", "url": "https://example.invalid/sms", "slot": "pool:8"},
        ]

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "path": path})
            return 200, {
                "continue_url": "https://auth.openai.com/phone-verification",
                "page": {
                    "type": "phone_otp_verification",
                    "payload": {"phone_number": "+1 555 0188"},
                },
            }

        with (
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(
                worker,
                "solve_auth_page",
                return_value="https://auth.openai.com/api/accounts/auth-challenge/continue",
            ) as solve_auth_page,
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(worker, "read_phone_pool", return_value=pool),
            patch.object(worker, "fetch_phone_messages", return_value='"no丨暂时没有收到消息"'),
            patch.object(worker, "poll_phone_code", return_value="123456"),
            patch.object(
                worker,
                "post_auth_json",
                return_value=(200, {"page": {"type": "sign_in_with_chatgpt_codex_consent"}}),
            ) as post_auth_json,
        ):
            result = worker.complete_existing_phone_verification(object(), step, "device-id", events)

        self.assertEqual(result["page"]["type"], "sign_in_with_chatgpt_codex_consent")
        solve_auth_page.assert_called_once()
        post_auth_json.assert_called_once()
        self.assertEqual(post_auth_json.call_args.args[2], {"code": "123456"})
        self.assertEqual(
            [event["phase"] for event in events],
            [
                "human_verification_solver_start",
                "human_verification_solver_continue",
                "bound_phone_slot_selected",
                "bound_phone_otp_done",
            ],
        )

    def test_existing_phone_solver_returning_unknown_challenge_reports_auth_challenge(self):
        worker = load_worker()
        events = []
        step = {
            "continue_url": "https://auth.openai.com/auth-challenge",
            "page": {
                "type": "auth_challenge",
                "payload": {"description": "Complete the human verification to continue."},
            },
        }

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "status": 200, "path": path})
            return 200, {
                "continue_url": "https://auth.openai.com/auth-challenge",
                "page": {
                    "type": "auth_challenge",
                    "payload": {"description": "Additional verification is required."},
                },
            }

        with (
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/api/accounts/auth-challenge/continue"),
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
        ):
            result = worker.complete_existing_phone_verification(object(), step, "device-id", events, "child@example.com")

        self.assertEqual(result["_phone_error"]["kind"], "auth_challenge")
        self.assertEqual(result["_phone_error"]["message"], "Auth challenge is required")
        self.assertIn("auth_challenge_required", [event["phase"] for event in events])

    def test_auth_challenge_solver_returns_non_phone_state_without_pool_lookup(self):
        worker = load_worker()
        events = []
        step = {
            "continue_url": "https://auth.openai.com/auth-challenge",
            "page": {
                "type": "auth_challenge",
                "payload": {"description": "Complete the captcha to continue."},
            },
        }

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "path": path})
            return 200, {
                "continue_url": "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
                "page": {"type": "sign_in_with_chatgpt_codex_consent"},
            }

        with (
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(
                worker,
                "solve_auth_page",
                return_value="https://auth.openai.com/api/accounts/auth-challenge/continue",
            ),
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(worker, "read_phone_pool", return_value=[]) as read_phone_pool,
            patch.object(worker, "post_auth_json") as post_auth_json,
        ):
            result = worker.complete_existing_phone_verification(object(), step, "device-id", events)

        self.assertEqual(result["page"]["type"], "sign_in_with_chatgpt_codex_consent")
        read_phone_pool.assert_not_called()
        post_auth_json.assert_not_called()
        self.assertEqual(
            [event["phase"] for event in events],
            [
                "human_verification_solver_start",
                "human_verification_solver_continue",
            ],
        )

    def test_auth_challenge_solver_returns_add_phone_and_continues_binding_when_email_is_known(self):
        worker = load_worker()
        events = []
        session = object()
        step = {
            "continue_url": "https://auth.openai.com/auth-challenge",
            "page": {
                "type": "auth_challenge",
                "payload": {"description": "Complete the captcha to continue."},
            },
        }
        add_phone_step = {"continue_url": "https://auth.openai.com/add-phone", "page": {"type": "add_phone"}}
        consent_step = {"page": {"type": "sign_in_with_chatgpt_codex_consent"}}

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "path": path})
            return 200, add_phone_step

        with (
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(
                worker,
                "solve_auth_page",
                return_value="https://auth.openai.com/api/accounts/auth-challenge/continue",
            ),
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(worker, "complete_add_phone_verification", return_value=consent_step) as complete_add_phone,
        ):
            result = worker.complete_existing_phone_verification(
                session,
                step,
                "device-id",
                events,
                "child@example.com",
            )

        self.assertEqual(result["page"]["type"], "sign_in_with_chatgpt_codex_consent")
        complete_add_phone.assert_called_once_with(
            session,
            add_phone_step,
            "device-id",
            "child@example.com",
            events,
        )

    def test_auth_challenge_with_account_lock_is_not_treated_as_missing_phone(self):
        worker = load_worker()
        events = []
        step = {
            "continue_url": "https://auth.openai.com/auth-challenge",
            "page": {
                "type": "auth_challenge",
                "payload": {"description": "Your account has been locked."},
            },
        }

        with patch.object(worker, "post_auth_json") as post_auth_json:
            result = worker.complete_existing_phone_verification(object(), step, "device-id", events)

        self.assertEqual(result["_phone_error"]["kind"], "account_locked")
        self.assertEqual([event["phase"] for event in events], ["account_locked"])
        post_auth_json.assert_not_called()

    def test_auto_auth_returns_account_locked_status_for_locked_challenge(self):
        worker = load_worker()

        class FakeSession:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "status": 200, "path": path})
            if path == "/api/accounts/authorize/continue":
                return 200, {
                    "continue_url": "https://auth.openai.com/auth-challenge",
                    "page": {
                        "type": "auth_challenge",
                        "payload": {"description": "Your account has been locked."},
                    },
                }
            raise AssertionError(f"unexpected post path {path}")

        with (
            patch.object(worker.requests, "Session", return_value=FakeSession(), create=True),
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/log-in"),
            patch.object(worker, "cookie_value", return_value="device-id"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(worker, "GONGXI_MAIL_BASE_URL", "https://example.invalid/gongxi"),
            patch.object(worker, "GONGXI_MAIL_API_KEY", "gongxi-key"),
        ):
            result = worker.run_codex_auto_auth(
                {
                    "email": "locked-child@example.com",
                    "authUrl": "https://auth.openai.com/oauth/authorize",
                    "state": "expected-state",
                    "codeVerifier": "verifier",
                }
            )

        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "account_locked")
        self.assertEqual(result["challenge"], "account_locked")
        self.assertIn("account_locked", [event["phase"] for event in result["events"]])

    def test_auto_auth_returns_account_locked_when_phone_channel_send_reports_disabled_account(self):
        worker = load_worker()

        class FakeSession:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "status": 200, "path": path})
            if path == "/api/accounts/authorize/continue":
                return 200, {
                    "continue_url": "https://auth.openai.com/phone-otp/select-channel",
                    "page": {"type": "phone_otp_select_channel"},
                }
            if path == "/api/accounts/phone-otp/send":
                raise RuntimeError("phone_otp_send_failed_403: account disabled")
            raise AssertionError(f"unexpected post path {path}")

        with (
            patch.object(worker.requests, "Session", return_value=FakeSession(), create=True),
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/log-in"),
            patch.object(worker, "cookie_value", return_value="device-id"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(worker, "GONGXI_MAIL_BASE_URL", "https://example.invalid/gongxi"),
            patch.object(worker, "GONGXI_MAIL_API_KEY", "gongxi-key"),
        ):
            try:
                result = worker.run_codex_auto_auth(
                    {
                        "email": "locked-child@example.com",
                        "authUrl": "https://auth.openai.com/oauth/authorize",
                        "state": "expected-state",
                        "codeVerifier": "verifier",
                    }
                )
            except RuntimeError as exc:
                self.fail(f"unexpected exception: {exc}")

        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "account_locked")
        self.assertEqual(result["challenge"], "account_locked")
        self.assertIn("account_locked", [event["phase"] for event in result["events"]])

    def test_auto_auth_returns_account_locked_when_password_verify_reports_locked_account(self):
        worker = load_worker()

        class FakeSession:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "status": 403, "path": path})
            if path == "/api/accounts/password/verify":
                raise RuntimeError("password_verify_failed_403: Your account has been suspended")
            raise AssertionError(f"unexpected post path {path}")

        with (
            patch.object(worker.requests, "Session", return_value=FakeSession(), create=True),
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/log-in/password"),
            patch.object(worker, "cookie_value", return_value="device-id"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(worker, "GONGXI_MAIL_BASE_URL", "https://example.invalid/gongxi"),
            patch.object(worker, "GONGXI_MAIL_API_KEY", "gongxi-key"),
        ):
            try:
                result = worker.run_codex_auto_auth(
                    {
                        "email": "locked-child@example.com",
                        "password": "private-password",
                        "authUrl": "https://auth.openai.com/oauth/authorize",
                        "state": "expected-state",
                        "codeVerifier": "verifier",
                    }
                )
            except RuntimeError as exc:
                self.fail(f"unexpected exception: {exc}")

        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "account_locked")
        self.assertEqual(result["challenge"], "account_locked")
        self.assertIn("account_locked", [event["phase"] for event in result["events"]])

    def test_auto_auth_returns_account_locked_when_email_otp_validate_reports_disabled_account(self):
        worker = load_worker()

        class FakeSession:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "status": 200, "path": path})
            if path == "/api/accounts/authorize/continue":
                return 200, {
                    "continue_url": "https://auth.openai.com/email-verification",
                    "page": {"type": "email_otp_verification"},
                }
            if path == "/api/accounts/email-otp/validate":
                raise RuntimeError("email_otp_validate_failed_403: account deactivated")
            raise AssertionError(f"unexpected post path {path}")

        with (
            patch.object(worker.requests, "Session", return_value=FakeSession(), create=True),
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/log-in"),
            patch.object(worker, "cookie_value", return_value="device-id"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "poll_gongxi_code", return_value="123456"),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(worker, "GONGXI_MAIL_BASE_URL", "https://example.invalid/gongxi"),
            patch.object(worker, "GONGXI_MAIL_API_KEY", "gongxi-key"),
        ):
            try:
                result = worker.run_codex_auto_auth(
                    {
                        "email": "locked-child@example.com",
                        "authUrl": "https://auth.openai.com/oauth/authorize",
                        "state": "expected-state",
                        "codeVerifier": "verifier",
                    }
                )
            except RuntimeError as exc:
                self.fail(f"unexpected exception: {exc}")

        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "account_locked")
        self.assertEqual(result["challenge"], "account_locked")
        self.assertIn("account_locked", [event["phase"] for event in result["events"]])

    def test_auto_auth_returns_account_locked_when_email_otp_send_reports_disabled_account(self):
        worker = load_worker()

        class FakeSession:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        def post_auth_json(session, path, payload, referer, events, phase, device_id, **kwargs):
            events.append({"phase": phase, "status": 200, "path": path})
            if path == "/api/accounts/authorize/continue":
                return 200, {
                    "continue_url": "https://auth.openai.com/email-verification",
                    "page": {"type": "email_otp_send"},
                }
            raise AssertionError(f"unexpected post path {path}")

        def get_auth_json(session, path, referer, events, phase, device_id):
            events.append({"phase": phase, "status": 403, "path": path})
            if path == "/api/accounts/email-otp/send":
                raise RuntimeError("email_otp_send_failed_403: account disabled")
            raise AssertionError(f"unexpected get path {path}")

        with (
            patch.object(worker.requests, "Session", return_value=FakeSession(), create=True),
            patch.object(worker, "solve_auth_page", return_value="https://auth.openai.com/log-in"),
            patch.object(worker, "cookie_value", return_value="device-id"),
            patch.object(worker, "post_auth_json", side_effect=post_auth_json),
            patch.object(worker, "get_auth_json", side_effect=get_auth_json),
            patch.object(worker, "FLARESOLVERR_URL", "https://example.invalid/flaresolverr"),
            patch.object(worker, "GONGXI_MAIL_BASE_URL", "https://example.invalid/gongxi"),
            patch.object(worker, "GONGXI_MAIL_API_KEY", "gongxi-key"),
        ):
            try:
                result = worker.run_codex_auto_auth(
                    {
                        "email": "locked-child@example.com",
                        "authUrl": "https://auth.openai.com/oauth/authorize",
                        "state": "expected-state",
                        "codeVerifier": "verifier",
                    }
                )
            except RuntimeError as exc:
                self.fail(f"unexpected exception: {exc}")

        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "account_locked")
        self.assertEqual(result["challenge"], "account_locked")
        self.assertIn("account_locked", [event["phase"] for event in result["events"]])

    def test_existing_bound_phone_ambiguous_tail_does_not_submit_code(self):
        worker = load_worker()
        events = []
        pool = [
            {"phone": "+15550188", "url": "https://example.invalid/1", "section": "## 已用", "slot": "pool:1"},
            {"phone": "+25550188", "url": "https://example.invalid/2", "section": "## 已用", "slot": "pool:2"},
        ]
        step = {
            "continue_url": "https://auth.openai.com/phone-verification",
            "page": {
                "type": "phone_otp_verification",
                "payload": {"description": "We sent a text message to the phone ending in 0188."},
            },
        }

        with (
            patch.object(worker, "read_phone_pool", return_value=pool),
            patch.object(worker, "post_auth_json") as post_auth_json,
        ):
            result = worker.complete_existing_phone_verification(object(), step, "device-id", events)

        self.assertEqual(result["_phone_error"]["kind"], "phone_pool_ambiguous")
        self.assertEqual([event["phase"] for event in events], ["bound_phone_ambiguous"])
        post_auth_json.assert_not_called()


if __name__ == "__main__":
    unittest.main()
