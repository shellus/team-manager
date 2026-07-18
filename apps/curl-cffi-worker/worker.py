from __future__ import annotations

import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urljoin

from curl_cffi import requests


BASE_URL = os.environ.get("TEAMMGR_CHATGPT_BASE_URL", "https://chatgpt.com").rstrip("/") + "/"
PROXY_URL = os.environ.get("TEAMMGR_CHATGPT_PROXY", "").strip()
IMPERSONATE = os.environ.get("TEAMMGR_CURL_CFFI_IMPERSONATE", "chrome110").strip() or "chrome110"
REQUEST_TIMEOUT = float(os.environ.get("TEAMMGR_CURL_CFFI_TIMEOUT", "60"))
PORT = int(os.environ.get("TEAMMGR_CURL_CFFI_PORT", "8080"))
ALLOWED_METHODS = {"GET", "POST", "PATCH", "DELETE"}


class WorkerHandler(BaseHTTPRequestHandler):
    server_version = "team-manager-curl-cffi/2.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[curl-cffi-worker] {self.address_string()} {fmt % args}", flush=True)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.write_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "service": "team-manager-curl-cffi",
                    "capabilities": {"fetch": True},
                },
            )
            return
        self.write_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_POST(self) -> None:
        if self.path != "/fetch":
            self.write_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        try:
            request = parse_fetch_payload(self.read_json())
            status, body = fetch_chatgpt(request)
            self.write_json(HTTPStatus.OK, {"status": status, "body": body})
        except ValueError as exc:
            self.write_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except Exception as exc:
            self.write_json(
                HTTPStatus.BAD_GATEWAY,
                {"error": exc.__class__.__name__, "message": str(exc)},
            )

    def read_json(self) -> Any:
        length = int(self.headers.get("content-length") or "0")
        if length <= 0:
            raise ValueError("empty request body")
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid JSON: {exc.msg}") from exc

    def write_json(self, status: int, data: dict[str, Any]) -> None:
        raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(int(status))
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def parse_fetch_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("request body must be a JSON object")
    method = str(payload.get("method") or "").upper()
    if method not in ALLOWED_METHODS:
        raise ValueError(f"unsupported method: {method or '<empty>'}")
    path = str(payload.get("path") or "")
    if not path.startswith("/") or path.startswith("//"):
        raise ValueError("path must be an absolute application path")
    headers = payload.get("headers") or {}
    if not isinstance(headers, dict):
        raise ValueError("headers must be an object")
    body = payload.get("body")
    if body is not None and not isinstance(body, str):
        raise ValueError("body must be a string when present")
    proxy = payload.get("proxy")
    if proxy is not None and not isinstance(proxy, str):
        raise ValueError("proxy must be a string when present")
    return {
        "method": method,
        "path": path,
        "headers": {str(key): str(value) for key, value in headers.items() if value is not None},
        "body": body,
        "proxy": proxy.strip() if isinstance(proxy, str) and proxy.strip() else None,
    }


def fetch_chatgpt(request: dict[str, Any]) -> tuple[int, str]:
    url = urljoin(BASE_URL, request["path"].lstrip("/"))
    session_kwargs: dict[str, Any] = {"impersonate": IMPERSONATE, "verify": True}
    proxy_url = request.get("proxy") or PROXY_URL
    if proxy_url:
        session_kwargs["proxy"] = proxy_url
    with requests.Session(**session_kwargs) as session:
        response = session.request(
            request["method"],
            url,
            headers=request["headers"],
            data=request["body"],
            timeout=REQUEST_TIMEOUT,
        )
        return int(response.status_code), response.text


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", PORT), WorkerHandler)
    print(f"[curl-cffi-worker] listening on 0.0.0.0:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
