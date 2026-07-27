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
        response.url = "https://chatgpt.com/backend-api/me"
        response.headers.multi_items.return_value = [
            ("content-type", "application/json"),
            ("set-cookie", "first=1"),
            ("set-cookie", "second=2"),
        ]
        response.request.method = "GET"
        response.request.url = "https://chatgpt.com/backend-api/me"
        response.request.headers.multi_items.return_value = [("Authorization", "Bearer token")]
        response.request.body = None
        response.http_version = 2
        response.primary_ip = "104.18.0.1"
        response.primary_port = 443
        response.local_ip = "10.0.0.2"
        response.local_port = 45123
        response.redirect_count = 0
        response.request_size = 256
        response.response_size = 512
        response.upload_size = 0
        response.download_size = 128
        session = MagicMock()
        session.__enter__.return_value = session
        session.__exit__.return_value = None
        session.request.return_value = response
        fake_curl = MagicMock()

        with (
            patch.object(worker, "wire_traced_curl", return_value=(fake_curl, [])),
            patch.object(worker.requests, "Session", return_value=session) as create_session,
        ):
            result = worker.fetch_chatgpt(
                {
                    "method": "GET",
                    "path": "/backend-api/me",
                    "headers": {"Authorization": "Bearer token"},
                    "body": None,
                    "proxy": "http://proxy.example:8080",
                }
            )

        self.assertEqual(
            result,
            {
                "status": 200,
                "body": '{"ok":true}',
                "headers": [
                    ["content-type", "application/json"],
                    ["set-cookie", "first=1"],
                    ["set-cookie", "second=2"],
                ],
                "url": "https://chatgpt.com/backend-api/me",
                "request": {
                    "method": "GET",
                    "url": "https://chatgpt.com/backend-api/me",
                    "headers": [["Authorization", "Bearer token"]],
                },
                "network": {
                    "httpVersion": 2,
                    "primaryIp": "104.18.0.1",
                    "primaryPort": 443,
                    "localIp": "10.0.0.2",
                    "localPort": 45123,
                    "redirectCount": 0,
                    "requestSize": 256,
                    "responseSize": 512,
                    "uploadSize": 0,
                    "downloadSize": 128,
                },
                "wire": [],
            },
        )
        create_session.assert_called_once_with(
            curl=fake_curl,
            impersonate=worker.IMPERSONATE,
            verify=True,
            proxy="http://proxy.example:8080",
        )
        session.request.assert_called_once()

    def test_wraps_transport_failures_with_the_complete_wire_trace(self):
        wire = [{"type": "diagnostic", "data": "Trying proxy.example:8080...\n"}]
        session = MagicMock()
        session.__enter__.return_value = session
        session.__exit__.return_value = None
        session.request.side_effect = RuntimeError("proxy connect reset")

        with (
            patch.object(worker, "wire_traced_curl", return_value=(MagicMock(), wire)),
            patch.object(worker.requests, "Session", return_value=session),
        ):
            with self.assertRaises(worker.UpstreamFetchError) as raised:
                worker.fetch_chatgpt(
                    {
                        "method": "GET",
                        "path": "/backend-api/me",
                        "headers": {},
                        "body": None,
                        "proxy": "http://proxy.example:8080",
                    }
                )

        self.assertEqual(str(raised.exception.cause), "proxy connect reset")
        self.assertEqual(raised.exception.wire, wire)


if __name__ == "__main__":
    unittest.main()
