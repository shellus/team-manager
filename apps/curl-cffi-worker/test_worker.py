import importlib.util
from pathlib import Path
import sys
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


class PhoneVerificationTests(unittest.TestCase):
    def test_exhausted_phone_pool_returns_rejected_attempts(self):
        worker = load_worker()
        events = []
        pool = [
            {"phone": "+10000000001", "url": "https://example.invalid/1", "section": "## 未用", "slot": "pool:1"},
            {"phone": "+10000000002", "url": "https://example.invalid/2", "section": "## 未用", "slot": "pool:2"},
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
            {"phone": "+12025550188", "url": "https://example.invalid/sms", "section": "## 已用", "slot": "pool:8"},
        ]
        step = {
            "continue_url": "https://auth.openai.com/phone-verification",
            "page": {
                "type": "phone_otp_verification",
                "payload": {"phone_number": "+1 202 555 0188"},
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

    def test_existing_bound_phone_not_in_pool_returns_switch_email_signal(self):
        worker = load_worker()
        events = []
        pool = [
            {"phone": "+12025550177", "url": "https://example.invalid/sms", "section": "## 已用", "slot": "pool:7"},
        ]
        step = {
            "continue_url": "https://auth.openai.com/phone-verification",
            "page": {
                "type": "phone_otp_verification",
                "payload": {"phone_number": "+1 202 555 0188"},
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

    def test_existing_bound_phone_ambiguous_tail_does_not_submit_code(self):
        worker = load_worker()
        events = []
        pool = [
            {"phone": "+12025550188", "url": "https://example.invalid/1", "section": "## 已用", "slot": "pool:1"},
            {"phone": "+13105550188", "url": "https://example.invalid/2", "section": "## 已用", "slot": "pool:2"},
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
