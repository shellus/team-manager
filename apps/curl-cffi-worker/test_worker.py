import unittest
from unittest.mock import MagicMock, patch

import worker


class FetchPayloadTests(unittest.TestCase):
    def test_accepts_supported_chatgpt_request(self):
        parsed = worker.parse_fetch_payload(
            {
                "method": "post",
                "path": "/backend-api/accounts/workspace/users",
                "headers": {"Authorization": "Bearer token"},
                "body": "{}",
                "proxy": " http://proxy.example:8080 ",
            }
        )

        self.assertEqual(parsed["method"], "POST")
        self.assertEqual(parsed["path"], "/backend-api/accounts/workspace/users")
        self.assertEqual(parsed["proxy"], "http://proxy.example:8080")

    def test_rejects_external_or_protocol_relative_paths(self):
        with self.assertRaisesRegex(ValueError, "absolute application path"):
            worker.parse_fetch_payload({"method": "GET", "path": "//example.com/secret"})

    def test_rejects_unsupported_methods(self):
        with self.assertRaisesRegex(ValueError, "unsupported method"):
            worker.parse_fetch_payload({"method": "PUT", "path": "/backend-api/me"})


class FetchChatGptTests(unittest.TestCase):
    def test_forwards_request_with_per_account_proxy(self):
        response = MagicMock(status_code=200, text='{"ok":true}')
        session = MagicMock()
        session.__enter__.return_value = session
        session.__exit__.return_value = None
        session.request.return_value = response

        with patch.object(worker.requests, "Session", return_value=session) as create_session:
            status, body = worker.fetch_chatgpt(
                {
                    "method": "GET",
                    "path": "/backend-api/me",
                    "headers": {"Authorization": "Bearer token"},
                    "body": None,
                    "proxy": "http://proxy.example:8080",
                }
            )

        self.assertEqual((status, body), (200, '{"ok":true}'))
        create_session.assert_called_once_with(
            impersonate=worker.IMPERSONATE,
            verify=True,
            proxy="http://proxy.example:8080",
        )
        session.request.assert_called_once()


if __name__ == "__main__":
    unittest.main()
