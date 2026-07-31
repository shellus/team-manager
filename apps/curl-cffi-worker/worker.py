from __future__ import annotations

import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urljoin

from curl_cffi import Curl, CurlOpt, requests
from curl_cffi.curl import CURLINFO_HEADER_IN, CURLINFO_HEADER_OUT, CURLINFO_TEXT


BASE_URL = os.environ.get("TEAMMGR_CHATGPT_BASE_URL", "https://chatgpt.com").rstrip("/") + "/"
CODEX_AUTH_BASE_URL = "https://auth.openai.com/"
ALLOWED_BASE_URLS = {BASE_URL, CODEX_AUTH_BASE_URL}
PROXY_URL = os.environ.get("TEAMMGR_CHATGPT_PROXY", "").strip()
IMPERSONATE = os.environ.get("TEAMMGR_CURL_CFFI_IMPERSONATE", "chrome110").strip() or "chrome110"
REQUEST_TIMEOUT = float(os.environ.get("TEAMMGR_CURL_CFFI_TIMEOUT", "60"))
PORT = int(os.environ.get("TEAMMGR_CURL_CFFI_PORT", "8080"))
ALLOWED_METHODS = {"GET", "POST", "PATCH", "DELETE"}
WIRE_EVENT_NAMES = {
    CURLINFO_TEXT: "diagnostic",
    CURLINFO_HEADER_IN: "response_headers",
    CURLINFO_HEADER_OUT: "request_headers",
}


class UpstreamFetchError(Exception):
    def __init__(self, cause: Exception, wire: list[dict[str, str]]):
        super().__init__(str(cause))
        self.cause = cause
        self.wire = wire


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
            self.write_json(HTTPStatus.OK, fetch_upstream(request))
        except ValueError as exc:
            self.write_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except UpstreamFetchError as exc:
            self.write_json(
                HTTPStatus.BAD_GATEWAY,
                {
                    "error": exc.cause.__class__.__name__,
                    "message": str(exc.cause),
                    "wire": exc.wire,
                },
            )
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
    base_url = str(payload.get("baseUrl") or BASE_URL).rstrip("/") + "/"
    if base_url not in ALLOWED_BASE_URLS:
        raise ValueError("unsupported upstream base URL")
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
        "base_url": base_url,
        "headers": {str(key): str(value) for key, value in headers.items() if value is not None},
        "body": body,
        "proxy": proxy.strip() if isinstance(proxy, str) and proxy.strip() else None,
    }


def fetch_upstream(request: dict[str, Any]) -> dict[str, Any]:
    url = urljoin(request["base_url"], request["path"].lstrip("/"))
    curl, wire = wire_traced_curl()
    session_kwargs: dict[str, Any] = {
        "curl": curl,
        "impersonate": IMPERSONATE,
        "verify": True,
    }
    proxy_url = request.get("proxy") or PROXY_URL
    if proxy_url:
        session_kwargs["proxy"] = proxy_url
    try:
        with requests.Session(**session_kwargs) as session:
            response = session.request(
                request["method"],
                url,
                headers=request["headers"],
                data=request["body"],
                timeout=REQUEST_TIMEOUT,
            )
    except Exception as exc:
        raise UpstreamFetchError(exc, wire) from exc

    sent_request = response.request
    return {
        "status": int(response.status_code),
        "body": response.text,
        "headers": header_items(response.headers),
        "url": str(response.url),
        "request": {
            "method": str(sent_request.method),
            "url": str(sent_request.url),
            "headers": header_items(sent_request.headers),
            **(
                {"body": sent_request.body.decode("utf-8", errors="replace")}
                if sent_request.body is not None
                else {}
            ),
        },
        "network": {
            "httpVersion": int(response.http_version),
            "primaryIp": str(response.primary_ip),
            "primaryPort": int(response.primary_port),
            "localIp": str(response.local_ip),
            "localPort": int(response.local_port),
            "redirectCount": int(response.redirect_count),
            "requestSize": int(response.request_size),
            "responseSize": int(response.response_size),
            "uploadSize": int(response.upload_size),
            "downloadSize": int(response.download_size),
        },
        "wire": wire,
    }


def wire_traced_curl() -> tuple[Curl, list[dict[str, str]]]:
    wire: list[dict[str, str]] = []

    def capture(event_type: int, data: bytes) -> None:
        event_name = WIRE_EVENT_NAMES.get(event_type)
        if event_name is None:
            return
        wire.append({"type": event_name, "data": data.decode("latin-1")})

    curl = Curl()
    curl.setopt(CurlOpt.VERBOSE, 1)
    curl.setopt(CurlOpt.DEBUGFUNCTION, capture)
    return curl, wire


def header_items(headers: Any) -> list[list[str | None]]:
    return [[str(key), None if value is None else str(value)] for key, value in headers.multi_items()]


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", PORT), WorkerHandler)
    print(f"[curl-cffi-worker] listening on 0.0.0.0:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
