from __future__ import annotations

import json
import os
import base64
import hashlib
import random
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable
from urllib.parse import parse_qs, quote, urljoin, urlparse
from urllib.request import Request, urlopen

from curl_cffi import requests
import yaml


BASE_URL = os.environ.get("TEAMMGR_CHATGPT_BASE_URL", "https://chatgpt.com").rstrip("/") + "/"
PROXY_URL = os.environ.get("TEAMMGR_CHATGPT_PROXY", "").strip()
AUTH_PROXY_URL = os.environ.get("TEAMMGR_AUTH_PROXY", "").strip() or PROXY_URL
IMPERSONATE = os.environ.get("TEAMMGR_CURL_CFFI_IMPERSONATE", "chrome110").strip() or "chrome110"
AUTH_IMPERSONATE = os.environ.get("TEAMMGR_AUTH_IMPERSONATE", "chrome146").strip() or IMPERSONATE
REQUEST_TIMEOUT = float(os.environ.get("TEAMMGR_CURL_CFFI_TIMEOUT", "60"))
PORT = int(os.environ.get("TEAMMGR_CURL_CFFI_PORT", "8080"))
ALLOWED_METHODS = {"GET", "POST", "PATCH", "DELETE"}
FLARESOLVERR_URL = os.environ.get("TEAMMGR_FLARESOLVERR_URL", "").strip().rstrip("/")
GONGXI_MAIL_BASE_URL = os.environ.get("TEAMMGR_GONGXI_MAIL_BASE_URL", "").strip().rstrip("/")
GONGXI_MAIL_API_KEY = os.environ.get("TEAMMGR_GONGXI_MAIL_API_KEY", "").strip()
GONGXI_MAIL_TIMEOUT = float(os.environ.get("TEAMMGR_GONGXI_MAIL_TIMEOUT", "150"))
PHONE_POOL_YAML = os.environ.get("TEAMMGR_PHONE_POOL_YAML", "").strip()
if not PHONE_POOL_YAML:
    legacy_phone_pool_file = os.environ.get("TEAMMGR_PHONE_POOL_FILE", "").strip()
    if legacy_phone_pool_file.lower().endswith((".yaml", ".yml")):
        PHONE_POOL_YAML = legacy_phone_pool_file
PHONE_OTP_TIMEOUT = float(os.environ.get("TEAMMGR_PHONE_OTP_TIMEOUT", "180"))
AUTH_BASE_URL = "https://auth.openai.com"
CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback"
AUTH_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
)
AUTH_SEC_CH_UA = '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"'
AUTH_COMMON_HEADERS = {
    "accept": "application/json",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    "content-type": "application/json",
    "origin": AUTH_BASE_URL,
    "priority": "u=1, i",
    "sec-ch-ua": AUTH_SEC_CH_UA,
    "sec-ch-ua-arch": '"x86_64"',
    "sec-ch-ua-bitness": '"64"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-model": '""',
    "sec-ch-ua-platform": '"Linux"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": AUTH_USER_AGENT,
}
CODE_SUBJECT_RE = re.compile(r"(temporary (chatgpt )?(login|verification) code|verification code)", re.I)
OPENAI_SENDER_RE = re.compile(r"(openai|chatgpt)", re.I)


class WorkerHandler(BaseHTTPRequestHandler):
    server_version = "team-manager-curl-cffi/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[curl-cffi-worker] {self.address_string()} {fmt % args}", flush=True)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.write_json(HTTPStatus.OK, worker_health_payload())
            return
        self.write_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_POST(self) -> None:
        if self.path == "/fetch":
            try:
                payload = self.read_json()
                request = parse_fetch_payload(payload)
                status, body = fetch_chatgpt(request)
                self.write_json(HTTPStatus.OK, {"status": status, "body": body})
            except ValueError as exc:
                self.write_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            except Exception as exc:
                self.write_json(HTTPStatus.BAD_GATEWAY, {"error": exc.__class__.__name__, "message": str(exc)})
            return

        if self.path == "/codex-auth/auto":
            try:
                payload = self.read_json()
                result = run_codex_auto_auth(payload)
                self.write_json(HTTPStatus.OK, result)
            except ValueError as exc:
                self.write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "status": "bad_request", "message": str(exc)})
            except Exception as exc:
                self.write_json(
                    HTTPStatus.BAD_GATEWAY,
                    {"ok": False, "status": "worker_error", "error": exc.__class__.__name__, "message": str(exc)},
                )
            return

        if self.path == "/codex-auth/auto-events":
            try:
                payload = self.read_json()
            except ValueError as exc:
                self.write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "status": "bad_request", "message": str(exc)})
                return

            try:
                self.write_ndjson_start(HTTPStatus.OK)

                def emit_event(event: dict[str, Any]) -> None:
                    self.write_ndjson({"type": "event", "event": event})

                result = run_codex_auto_auth(payload, emit_event)
                self.write_ndjson({"type": "result", "result": result})
            except ValueError as exc:
                self.write_ndjson({"type": "error", "status": "bad_request", "message": str(exc)})
            except Exception as exc:
                self.write_ndjson(
                    {
                        "type": "error",
                        "status": "worker_error",
                        "error": exc.__class__.__name__,
                        "message": str(exc),
                    }
                )
            return

        if self.path == "/subaccounts/register":
            try:
                payload = self.read_json()
                result = run_subaccount_registration(payload)
                self.write_json(HTTPStatus.OK, result)
            except ValueError as exc:
                self.write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "status": "bad_request", "message": str(exc)})
            except Exception as exc:
                self.write_json(
                    HTTPStatus.BAD_GATEWAY,
                    {"ok": False, "status": "worker_error", "error": exc.__class__.__name__, "message": str(exc)},
                )
            return

        else:
            self.write_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return

    def read_json(self) -> Any:
        length = int(self.headers.get("content-length") or "0")
        if length <= 0:
            raise ValueError("empty request body")
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid JSON: {exc.msg}") from exc

    def write_json(self, status: int, data: dict[str, Any]) -> None:
        raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(int(status))
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def write_ndjson_start(self, status: int) -> None:
        self.send_response(int(status))
        self.send_header("content-type", "application/x-ndjson; charset=utf-8")
        self.end_headers()

    def write_ndjson(self, data: dict[str, Any]) -> None:
        raw = (json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        self.wfile.write(raw)
        self.wfile.flush()


def parse_fetch_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("request body must be a JSON object")

    method = str(payload.get("method") or "").upper()
    if method not in ALLOWED_METHODS:
        raise ValueError(f"unsupported method: {method or '<empty>'}")

    path = str(payload.get("path") or "")
    if not path.startswith("/"):
        raise ValueError("path must start with /")

    headers = payload.get("headers") or {}
    if not isinstance(headers, dict):
        raise ValueError("headers must be an object")
    normalized_headers = {str(k): str(v) for k, v in headers.items() if v is not None}

    body = payload.get("body")
    if body is not None and not isinstance(body, str):
        raise ValueError("body must be a string when present")

    proxy = payload.get("proxy")
    if proxy is not None and not isinstance(proxy, str):
        raise ValueError("proxy must be a string when present")
    normalized_proxy = proxy.strip() if isinstance(proxy, str) else ""

    return {
        "method": method,
        "path": path,
        "headers": normalized_headers,
        "body": body,
        "proxy": normalized_proxy or None,
    }


def fetch_chatgpt(request: dict[str, Any]) -> tuple[int, str]:
    url = urljoin(BASE_URL, request["path"].lstrip("/"))
    session_kwargs: dict[str, Any] = {"impersonate": IMPERSONATE, "verify": True}
    proxy_url = str(request.get("proxy") or "").strip() or PROXY_URL
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


class EventRecorder(list[dict[str, Any]]):
    def __init__(self, event_sink: Callable[[dict[str, Any]], None] | None = None) -> None:
        super().__init__()
        self.event_sink = event_sink

    def append(self, event: dict[str, Any]) -> None:
        super().append(event)
        if not self.event_sink:
            return
        try:
            self.event_sink(event)
        except Exception as exc:
            print(f"[curl-cffi-worker] progress event write failed: {exc}", flush=True)


class SentinelTokenGenerator:
    MAX_ATTEMPTS = 500_000
    ERROR_PREFIX = "wQ8Lk5FbGpA2NcR9dShT6gYjU7VxZ4D"

    def __init__(self, device_id: str, user_agent: str):
        self.device_id = device_id
        self.user_agent = user_agent
        self.sid = str(uuid.uuid4())

    @staticmethod
    def _fnv1a_32(text: str) -> str:
        value = 2166136261
        for ch in text:
            value ^= ord(ch)
            value = (value * 16777619) & 0xFFFFFFFF
        value ^= value >> 16
        value = (value * 2246822507) & 0xFFFFFFFF
        value ^= value >> 13
        value = (value * 3266489909) & 0xFFFFFFFF
        value ^= value >> 16
        return format(value & 0xFFFFFFFF, "08x")

    @staticmethod
    def _b64(data: Any) -> str:
        return base64.b64encode(json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode()).decode("ascii")

    def _config(self) -> list[Any]:
        perf_now = random.uniform(1000, 50000)
        return [
            "1920x1080",
            time.strftime("%a %b %d %Y %H:%M:%S GMT+0000 (Coordinated Universal Time)", time.gmtime()),
            4294705152,
            random.random(),
            self.user_agent,
            "https://sentinel.openai.com/sentinel/20260124ceb8/sdk.js",
            None,
            None,
            "en-US",
            random.random(),
            random.choice(["vendorSub-undefined", "plugins-undefined", "mimeTypes-undefined"]),
            random.choice(["location", "implementation", "URL", "documentURI", "compatMode"]),
            random.choice(["Object", "Function", "Array", "Number", "parseFloat", "undefined"]),
            perf_now,
            self.sid,
            "",
            random.choice([4, 8, 12, 16]),
            time.time() * 1000 - perf_now,
        ]

    def requirements_token(self) -> str:
        data = self._config()
        data[3] = 1
        data[9] = round(random.uniform(5, 50))
        return "gAAAAAC" + self._b64(data)

    def proof_token(self, seed: str, difficulty: str) -> str:
        start = time.time()
        data = self._config()
        difficulty = str(difficulty or "0")
        for index in range(self.MAX_ATTEMPTS):
            data[3] = index
            data[9] = round((time.time() - start) * 1000)
            payload = self._b64(data)
            if self._fnv1a_32(seed + payload)[: len(difficulty)] <= difficulty:
                return "gAAAAAB" + payload + "~S"
        return "gAAAAAB" + self.ERROR_PREFIX + self._b64(str(None))


def build_sentinel_token(session: requests.Session, device_id: str, flow: str) -> str:
    generator = SentinelTokenGenerator(device_id, AUTH_USER_AGENT)
    response = session.post(
        "https://sentinel.openai.com/backend-api/sentinel/req",
        data=json.dumps({"p": generator.requirements_token(), "id": device_id, "flow": flow}),
        headers={
            "Content-Type": "text/plain;charset=UTF-8",
            "Referer": "https://sentinel.openai.com/backend-api/sentinel/frame.html",
            "Origin": "https://sentinel.openai.com",
            "User-Agent": AUTH_USER_AGENT,
            "sec-ch-ua": AUTH_SEC_CH_UA,
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Linux"',
        },
        timeout=20,
        verify=False,
    )
    try:
        data = response.json() if response.text else {}
    except Exception:
        fallback = {"p": generator.requirements_token(), "t": "", "c": "", "id": device_id, "flow": flow}
        return json.dumps(fallback, separators=(",", ":"))
    token = str(data.get("token") or "").strip()
    if response.status_code != 200 or not token:
        raise RuntimeError(f"sentinel_req_failed_{response.status_code}")
    proof = data.get("proofofwork") or {}
    p_value = (
        generator.proof_token(str(proof.get("seed") or ""), str(proof.get("difficulty") or "0"))
        if proof.get("required") and proof.get("seed")
        else generator.requirements_token()
    )
    return json.dumps({"p": p_value, "t": "", "c": token, "id": device_id, "flow": flow}, separators=(",", ":"))


def run_codex_auto_auth(payload: Any, event_sink: Callable[[dict[str, Any]], None] | None = None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("request body must be a JSON object")
    email = str(payload.get("email") or "").strip()
    auth_url = str(payload.get("authUrl") or "").strip()
    code_verifier = str(payload.get("codeVerifier") or "").strip()
    expected_state = str(payload.get("state") or "").strip()
    target_chatgpt_account_id = str(payload.get("targetChatgptAccountId") or "").strip()
    password = str(payload.get("password") or "").strip()
    if not email:
        raise ValueError("email is required")
    if not auth_url:
        raise ValueError("authUrl is required")
    if not code_verifier:
        raise ValueError("codeVerifier is required")
    if not expected_state:
        raise ValueError("state is required")
    if not FLARESOLVERR_URL:
        raise ValueError("TEAMMGR_FLARESOLVERR_URL is required")
    if not GONGXI_MAIL_BASE_URL or not GONGXI_MAIL_API_KEY:
        raise ValueError("TEAMMGR_GONGXI_MAIL_BASE_URL and TEAMMGR_GONGXI_MAIL_API_KEY are required")

    events: list[dict[str, Any]] = EventRecorder(event_sink)
    session_kwargs: dict[str, Any] = {"impersonate": AUTH_IMPERSONATE, "verify": False}
    if AUTH_PROXY_URL:
        session_kwargs["proxy"] = AUTH_PROXY_URL

    with requests.Session(**session_kwargs) as session:
        session.headers.update({"user-agent": AUTH_USER_AGENT})
        flow_started_at = datetime.now(timezone.utc)
        initial_url = solve_auth_page(session, auth_url, events)
        device_id = cookie_value(session, "oai-did") or str(uuid.uuid4())

        otp_requested_at = flow_started_at
        try:
            if "/email-verification" in initial_url:
                step_json = {"continue_url": f"{AUTH_BASE_URL}/email-verification", "page": {"type": "email_otp_verification"}}
                events.append({"phase": "email_otp_already_requested", "status": 200, "pageType": "email_otp_verification"})
            elif password:
                otp_requested_at = datetime.now(timezone.utc)
                _, step_json = post_auth_json(
                    session,
                    "/api/accounts/password/verify",
                    {"password": password},
                    f"{AUTH_BASE_URL}/log-in/password",
                    events,
                    "password_verify",
                    device_id,
                    sentinel_flow="password_verify",
                )
            elif "/log-in/password" in initial_url:
                otp_requested_at = datetime.now(timezone.utc)
                _, step_json = post_auth_json(
                    session,
                    "/api/accounts/passwordless/send-otp",
                    None,
                    f"{AUTH_BASE_URL}/log-in/password",
                    events,
                    "passwordless_send_otp",
                    device_id,
                )
            else:
                otp_requested_at = datetime.now(timezone.utc)
                _, step_json = post_auth_json(
                    session,
                    "/api/accounts/authorize/continue",
                    {"username": {"kind": "email", "value": email}, "screen_hint": "login"},
                    f"{AUTH_BASE_URL}/log-in",
                    events,
                    "authorize_continue_login",
                    device_id,
                )
        except Exception as exc:
            if is_account_locked_error(str(exc)):
                return account_locked_auth_result(events)
            raise

        step_type = page_type(step_json)
        if step_type in {"email_otp_send", "email_otp_verification"} or str(step_json.get("continue_url") or "").endswith("/email-verification"):
            step_json, email_error = complete_email_otp_steps(session, step_json, email, otp_requested_at, events, device_id)
            if email_error:
                challenge = email_error.get("kind") or "email_otp_invalid"
                return {
                    "ok": False,
                    "status": phone_error_status(challenge),
                    "challenge": challenge,
                    "message": email_error.get("message") or "Email OTP verification failed",
                    "events": events,
                }
            step_type = page_type(step_json)

        phone_result = complete_phone_steps(session, step_json, device_id, email, events)
        if phone_result.get("_phone_result"):
            challenge = phone_result["_phone_result"].get("challenge") or page_type(step_json)
            return {
                "ok": False,
                "status": phone_error_status(challenge),
                "challenge": challenge,
                "message": phone_result["_phone_result"].get("message") or "Phone verification failed",
                "events": events,
            }
        step_json = phone_result
        step_json, email_error = complete_email_otp_steps(session, step_json, email, otp_requested_at, events, device_id)
        if email_error:
            challenge = email_error.get("kind") or "email_otp_invalid"
            return {
                "ok": False,
                "status": phone_error_status(challenge),
                "challenge": challenge,
                "message": email_error.get("message") or "Email OTP verification failed",
                "events": events,
            }

        token_or_error = complete_codex_workspace_and_token(
            session,
            step_json,
            device_id,
            target_chatgpt_account_id,
            expected_state,
            code_verifier,
            events,
        )
        return {**token_or_error, "events": events}


def run_subaccount_registration(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("request body must be a JSON object")
    auth_url = str(payload.get("authUrl") or "").strip()
    code_verifier = str(payload.get("codeVerifier") or "").strip()
    expected_state = str(payload.get("state") or "").strip()
    target_chatgpt_account_id = str(payload.get("targetChatgptAccountId") or "").strip()
    mail_group = str(payload.get("mailGroup") or os.environ.get("TEAMMGR_GONGXI_MAIL_GROUP") or "").strip()
    if not auth_url:
        raise ValueError("authUrl is required")
    if not code_verifier:
        raise ValueError("codeVerifier is required")
    if not expected_state:
        raise ValueError("state is required")
    if not FLARESOLVERR_URL:
        raise ValueError("TEAMMGR_FLARESOLVERR_URL is required")
    if not GONGXI_MAIL_BASE_URL or not GONGXI_MAIL_API_KEY:
        raise ValueError("TEAMMGR_GONGXI_MAIL_BASE_URL and TEAMMGR_GONGXI_MAIL_API_KEY are required")

    events: list[dict[str, Any]] = []
    email = ""
    password = ""
    session_kwargs: dict[str, Any] = {"impersonate": AUTH_IMPERSONATE, "verify": False}
    if AUTH_PROXY_URL:
        session_kwargs["proxy"] = AUTH_PROXY_URL

    with requests.Session(**session_kwargs) as session:
        session.headers.update({"user-agent": AUTH_USER_AGENT})
        otp_requested_at = datetime.now(timezone.utc)
        solve_auth_page(session, auth_url, events)
        device_id = cookie_value(session, "oai-did") or str(uuid.uuid4())
        max_email_attempts = max(1, int(os.environ.get("TEAMMGR_REGISTRATION_EMAIL_MAX_ATTEMPTS", "3")))
        step_json: dict[str, Any] = {}
        for email_attempt in range(1, max_email_attempts + 1):
            email = allocate_gongxi_email(mail_group, events)
            password = generate_registration_password()
            try:
                _, step_json = post_auth_json(
                    session,
                    "/api/accounts/authorize/continue",
                    {"username": {"kind": "email", "value": email}, "screen_hint": "signup"},
                    f"{AUTH_BASE_URL}/sign-up",
                    events,
                    "authorize_continue_signup",
                    device_id,
                )
                step_type = page_type(step_json)
                if step_type == "auth_challenge":
                    step_json, challenge_error = resolve_auth_challenge_for_token_stage(session, step_json, device_id, events)
                    if challenge_error:
                        return {
                            **challenge_error,
                            "email": email,
                            "password": password,
                            "events": events,
                        }
                    step_type = page_type(step_json)
                if step_type != "create_account_password":
                    if is_registration_email_rejected_page(step_json):
                        events.append(
                            {
                                "phase": "registration_email_rejected",
                                "attempt": email_attempt,
                                "pageType": step_type,
                            }
                        )
                        continue
                    return registration_unexpected_page(email, password, step_type, events)

                otp_requested_at = datetime.now(timezone.utc)
                _, step_json = post_auth_json(
                    session,
                    "/api/accounts/user/register",
                    {"username": email, "password": password},
                    str(step_json.get("continue_url") or f"{AUTH_BASE_URL}/create-account/password"),
                    events,
                    "user_register",
                    device_id,
                    sentinel_flow="user_register",
                )
                break
            except Exception as exc:
                message = str(exc)
                if is_registration_email_rejected_error(message):
                    events.append(
                        {
                            "phase": "registration_email_rejected",
                            "attempt": email_attempt,
                            "message": message[:160],
                        }
                    )
                    continue
                if is_account_locked_error(message):
                    challenge = "account_locked"
                else:
                    challenge = "registration_sentinel" if is_registration_sentinel_error(message) else "registration_failed"
                return {
                    "ok": False,
                    "status": registration_failure_status(challenge),
                    "challenge": challenge,
                    "email": email,
                    "password": password,
                    "message": message[:240],
                    "events": events,
                }
        else:
            return {
                "ok": False,
                "status": "error",
                "challenge": "registration_email_unavailable",
                "message": f"No usable GongXi-Mail email after {max_email_attempts} attempt(s)",
                "events": events,
            }

        step_json, email_error = complete_email_otp_steps(session, step_json, email, otp_requested_at, events, device_id)
        if email_error:
            return registration_email_otp_error_result(email, password, email_error, events)

        phone_result = complete_phone_steps(session, step_json, device_id, email, events)
        if phone_result.get("_phone_result"):
            challenge = phone_result["_phone_result"].get("challenge") or "phone_verification"
            return {
                "ok": False,
                "status": phone_error_status(challenge),
                "challenge": challenge,
                "email": email,
                "password": password,
                "message": phone_result["_phone_result"].get("message") or "Phone verification failed",
                "events": events,
            }
        step_json = phone_result
        step_type = page_type(step_json)
        step_json, email_error = complete_email_otp_steps(session, step_json, email, otp_requested_at, events, device_id)
        if email_error:
            return registration_email_otp_error_result(email, password, email_error, events)

        token_or_error = complete_codex_workspace_and_token(
            session,
            step_json,
            device_id,
            target_chatgpt_account_id,
            expected_state,
            code_verifier,
            events,
        )
        if not token_or_error.get("ok"):
            return {
                **token_or_error,
                "email": email,
                "password": password,
                "events": events,
            }

        return {
            "ok": True,
            "status": "ok",
            "email": email,
            "password": password,
            "callbackUrl": token_or_error.get("callbackUrl"),
            "tokenResponse": token_or_error.get("tokenResponse"),
            "events": events,
        }


def complete_email_otp_steps(
    session: requests.Session,
    step_json: dict[str, Any],
    email: str,
    otp_requested_at: datetime,
    events: list[dict[str, Any]],
    device_id: str,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    step_type = page_type(step_json)
    if step_type == "auth_challenge":
        step_json, challenge_error = resolve_otp_auth_challenge(session, step_json, device_id, events)
        if challenge_error:
            return {}, challenge_error
        step_type = page_type(step_json)

    email_send_attempts = 0
    while step_type == "email_otp_send":
        email_send_attempts += 1
        if email_send_attempts > 3:
            events.append({"phase": "email_otp_send_loop"})
            return {}, {"kind": "email_otp_send_loop", "message": "Email OTP send did not reach verification"}
        otp_requested_at = datetime.now(timezone.utc)
        try:
            _, step_json = get_auth_json(
                session,
                "/api/accounts/email-otp/send",
                str(step_json.get("continue_url") or f"{AUTH_BASE_URL}/email-verification"),
                events,
                "email_otp_send",
                device_id,
            )
        except Exception as exc:
            if is_account_locked_error(str(exc)):
                events.append({"phase": "account_locked"})
                return {}, {"kind": "account_locked", "message": "Account is locked or unavailable"}
            raise
        step_json, challenge_error = resolve_otp_auth_challenge(session, step_json, device_id, events)
        if challenge_error:
            return {}, challenge_error
        step_type = page_type(step_json)

    if step_type == "email_otp_verification" or str(step_json.get("continue_url") or "").endswith("/email-verification"):
        return validate_email_otp_with_retry(
            session,
            email,
            otp_requested_at,
            f"{AUTH_BASE_URL}/email-verification",
            events,
            "email_otp_validate",
            device_id,
        )

    return step_json, None


def registration_email_otp_error_result(
    email: str,
    password: str,
    email_error: dict[str, Any],
    events: list[dict[str, Any]],
) -> dict[str, Any]:
    challenge = email_error.get("kind") or "email_otp_invalid"
    return {
        "ok": False,
        "status": phone_error_status(challenge),
        "challenge": challenge,
        "email": email,
        "password": password,
        "message": email_error.get("message") or "Email OTP verification failed",
        "events": events,
    }


def complete_phone_steps(
    session: requests.Session,
    step_json: dict[str, Any],
    device_id: str,
    email: str,
    events: list[dict[str, Any]],
) -> dict[str, Any]:
    step_type = page_type(step_json)
    if step_type == "add_phone":
        step_json = complete_add_phone_verification(session, step_json, device_id, email, events)
        phone_error = step_json.get("_phone_error")
        if isinstance(phone_error, dict):
            return {
                **step_json,
                "_phone_result": {
                    "challenge": phone_error.get("kind") or "phone_send_exhausted",
                    "message": phone_error.get("message") or "All phone numbers were rejected",
                },
            }
        step_type = page_type(step_json)
        if step_type == "add_phone":
            return {
                **step_json,
                "_phone_result": {
                    "challenge": "add_phone",
                    "message": "Codex Auth requires manual verification: add_phone",
                },
            }

    if step_type in {"phone_otp_verification", "auth_challenge"}:
        step_json = complete_existing_phone_verification(session, step_json, device_id, events, email)
        phone_error = step_json.get("_phone_error")
        if isinstance(phone_error, dict):
            return {
                **step_json,
                "_phone_result": {
                    "challenge": phone_error.get("kind") or step_type,
                    "message": phone_error.get("message") or f"Codex Auth requires manual verification: {step_type}",
                },
            }
        step_type = page_type(step_json)

    select_channel_attempts = 0
    while step_type == "phone_otp_select_channel":
        select_channel_attempts += 1
        if select_channel_attempts > 3:
            events.append({"phase": "phone_otp_select_channel_loop"})
            step_json = phone_verification_error(
                "phone_otp_select_channel_loop",
                "Phone OTP channel selection did not reach verification",
            )
            return {
                **step_json,
                "_phone_result": {
                    "challenge": "phone_otp_select_channel_loop",
                    "message": "Phone OTP channel selection did not reach verification",
                },
            }
        select_ref = str(step_json.get("continue_url") or f"{AUTH_BASE_URL}/phone-otp/select-channel")
        try:
            _, step_json = post_auth_json(
                session,
                "/api/accounts/phone-otp/send",
                {"channel": "sms"},
                select_ref,
                events,
                "phone_otp_select_channel_send",
                device_id,
            )
        except Exception as exc:
            if is_account_locked_error(str(exc)):
                events.append({"phase": "account_locked"})
                step_json = phone_verification_error("account_locked", "Account is locked or unavailable")
                return {
                    **step_json,
                    "_phone_result": {
                        "challenge": "account_locked",
                        "message": "Account is locked or unavailable",
                    },
                }
            raise
        step_type = page_type(step_json)
        if step_type in {"phone_otp_verification", "auth_challenge"}:
            step_json = complete_existing_phone_verification(session, step_json, device_id, events, email)
            phone_error = step_json.get("_phone_error")
            if isinstance(phone_error, dict):
                return {
                    **step_json,
                    "_phone_result": {
                        "challenge": phone_error.get("kind") or "phone_otp_select_channel",
                        "message": phone_error.get("message") or "Phone OTP verification failed",
                    },
                }
            step_type = page_type(step_json)
    return step_json


def complete_codex_workspace_and_token(
    session: requests.Session,
    step_json: dict[str, Any],
    device_id: str,
    target_chatgpt_account_id: str,
    expected_state: str,
    code_verifier: str,
    events: list[dict[str, Any]],
) -> dict[str, Any]:
    step_type = page_type(step_json)
    if step_type != "sign_in_with_chatgpt_codex_consent":
        return {
            "ok": False,
            "status": "unexpected_page",
            "challenge": step_type or "",
            "message": f"Unexpected auth page: {step_type or '<empty>'}",
        }

    session_data = auth_session_payload(step_json)
    workspaces = session_data.get("workspaces") or []
    if not workspaces:
        return {"ok": False, "status": "unexpected_page", "message": "No Codex workspaces in auth session"}
    workspace = select_codex_workspace(workspaces, target_chatgpt_account_id)
    if target_chatgpt_account_id and not workspace:
        return {
            "ok": False,
            "status": "workspace_not_found",
            "message": "Target Codex workspace was not available in auth session",
        }
    workspace_id = workspace.get("id") if workspace else session_data.get("current_workspace_id") or workspaces[0].get("id")
    try:
        _, step_json = post_auth_json(
            session,
            "/api/accounts/workspace/select",
            {"workspace_id": workspace_id},
            f"{AUTH_BASE_URL}/sign-in-with-chatgpt/codex/consent",
            events,
            "workspace_select",
            device_id,
            allow_redirects=False,
        )
    except Exception as exc:
        if is_account_locked_error(str(exc)):
            return account_locked_auth_result(events)
        raise
    step_json, challenge_error = resolve_auth_challenge_for_token_stage(session, step_json, device_id, events)
    if challenge_error:
        return challenge_error

    if page_type(step_json) == "sign_in_with_chatgpt_codex_organization":
        session_data = auth_session_payload(step_json)
        orgs = session_data.get("orgs") or []
        if not orgs:
            return {"ok": False, "status": "unexpected_page", "message": "No organizations in auth session"}
        org = orgs[0]
        projects = org.get("projects") or []
        project_id = projects[0].get("id") if projects else ""
        try:
            _, step_json = post_auth_json(
                session,
                "/api/accounts/organization/select",
                {"org_id": org.get("id"), "project_id": project_id},
                f"{AUTH_BASE_URL}/sign-in-with-chatgpt/codex/organization",
                events,
                "organization_select",
                device_id,
                allow_redirects=False,
            )
        except Exception as exc:
            if is_account_locked_error(str(exc)):
                return account_locked_auth_result(events)
            raise
        step_json, challenge_error = resolve_auth_challenge_for_token_stage(session, step_json, device_id, events)
        if challenge_error:
            return challenge_error

    callback_url, callback_error = follow_to_callback_result(session, step_json, device_id, events)
    if callback_error:
        return callback_error
    if not callback_url:
        return {"ok": False, "status": "no_callback", "message": "Codex Auth did not return callback URL"}

    params = parse_qs(urlparse(callback_url).query)
    if (params.get("state") or [""])[0] != expected_state:
        return {"ok": False, "status": "state_mismatch", "message": "Codex Auth state mismatch"}
    code = (params.get("code") or [""])[0]
    if not code:
        return {"ok": False, "status": "missing_code", "message": "Codex Auth callback is missing code"}

    try:
        token_response = exchange_codex_token(session, code, code_verifier, events)
    except Exception as exc:
        if is_account_locked_error(str(exc)):
            return account_locked_auth_result(events)
        raise
    if not token_response.get("access_token") or not token_response.get("refresh_token") or not token_response.get("id_token"):
        return {"ok": False, "status": "token_failed", "message": "Codex token response is incomplete"}
    return {"ok": True, "status": "ok", "callbackUrl": callback_url, "tokenResponse": token_response}


def resolve_auth_challenge_for_token_stage(
    session: requests.Session,
    step_json: dict[str, Any],
    device_id: str,
    events: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    if page_type(step_json) != "auth_challenge":
        return step_json, None

    blocking_challenge = classify_blocking_auth_challenge(step_json)
    if not blocking_challenge:
        events.append({"phase": "auth_challenge_required"})
        return step_json, {
            "ok": False,
            "status": "verification_required",
            "challenge": "auth_challenge",
            "message": "Auth challenge is required",
        }

    kind, message, phase = blocking_challenge
    resolved_step = try_resolve_blocking_auth_challenge(session, step_json, device_id, events, kind)
    if resolved_step:
        next_blocking_challenge = classify_blocking_auth_challenge(resolved_step)
        if not next_blocking_challenge:
            if page_type(resolved_step) != "auth_challenge":
                return resolved_step, None
            events.append({"phase": "auth_challenge_required"})
            return resolved_step, {
                "ok": False,
                "status": "verification_required",
                "challenge": "auth_challenge",
                "message": "Auth challenge is required",
            }
        step_json = resolved_step
        kind, message, phase = next_blocking_challenge

    events.append({"phase": phase})
    return step_json, {
        "ok": False,
        "status": phone_error_status(kind),
        "challenge": kind,
        "message": message,
    }


def registration_unexpected_page(email: str, password: str, step_type: str, events: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "ok": False,
        "status": "unexpected_page",
        "challenge": step_type or "",
        "email": email,
        "password": password,
        "message": f"Unexpected registration page: {step_type or '<empty>'}",
        "events": events,
    }


def is_registration_sentinel_error(message: str) -> bool:
    return bool(re.search(r"account_creation_failed|sentinel|proof", message, re.I))


def is_registration_email_rejected_page(step_json: dict[str, Any]) -> bool:
    step_type = page_type(step_json)
    if step_type in {"email_otp_send", "email_otp_verification"}:
        return True
    if re.search(r"(login|password|account_exists|already_exists)", step_type, re.I):
        return True
    text = json.dumps(step_json, ensure_ascii=False)
    return is_registration_email_rejected_error(text)


def is_registration_email_rejected_error(message: str) -> bool:
    return bool(
        re.search(r"(email|account|user).{0,40}(already exists|exists|registered|taken)", message, re.I)
        or re.search(r"(already exists|registered|taken).{0,40}(email|account|user)", message, re.I)
        or re.search(r"(邮箱|账号|账户).{0,16}(已存在|已注册|被占用)", message)
        or re.search(r"(已存在|已注册|被占用).{0,16}(邮箱|账号|账户)", message)
    )


def is_account_locked_error(message: str) -> bool:
    return bool(
        re.search(r"\b(locked|suspended|disabled|deactivated)\b", message, re.I)
        or re.search(r"(账号|账户).*(锁定|停用|封禁)", message)
    )


def registration_failure_status(challenge: str) -> str:
    if challenge == "account_locked":
        return "account_locked"
    if challenge == "registration_sentinel":
        return "verification_required"
    return "error"


def select_codex_workspace(workspaces: list[Any], target_chatgpt_account_id: str) -> dict[str, Any] | None:
    if not target_chatgpt_account_id:
        return None
    for workspace in workspaces:
        if not isinstance(workspace, dict):
            continue
        candidates = [
            workspace.get("id"),
            workspace.get("account_id"),
            workspace.get("accountId"),
            workspace.get("chatgpt_account_id"),
            workspace.get("chatgptAccountId"),
        ]
        account = workspace.get("account")
        if isinstance(account, dict):
            candidates.extend([account.get("id"), account.get("account_id"), account.get("accountId")])
        if any(str(candidate or "").strip() == target_chatgpt_account_id for candidate in candidates):
            return workspace
    return None


def complete_add_phone_verification(
    session: requests.Session,
    step_json: dict[str, Any],
    device_id: str,
    email: str,
    events: list[dict[str, Any]],
) -> dict[str, Any]:
    pool = ordered_phone_pool(email)
    if not pool:
        events.append({"phase": "phone_pool_empty"})
        return step_json

    referer = str(step_json.get("continue_url") or f"{AUTH_BASE_URL}/add-phone")
    max_attempts = max(1, int(os.environ.get("TEAMMGR_PHONE_MAX_ATTEMPTS", "4")))
    last_error = ""
    attempted = 0
    for entry in pool[:max_attempts]:
        attempted += 1
        baseline = fetch_phone_messages(entry["url"])
        sent_at = datetime.now(timezone.utc)
        try:
            _, phone_step = post_auth_json(
                session,
                "/api/accounts/add-phone/send",
                {"phone_number": entry["phone"], "channel": "sms"},
                referer,
                events,
                "phone_send",
                device_id,
            )
        except Exception as exc:
            last_error = str(exc)
            if is_account_locked_error(last_error):
                events.append({"phase": "account_locked"})
                return phone_verification_error("account_locked", "Account is locked or unavailable")
            if is_phone_pool_exhaustion_error(last_error):
                mark_phone_pool_exhausted(entry, last_error)
            events.append({"phase": "phone_send_rejected", "phoneSlot": entry["slot"], "message": str(exc)[:160]})
            continue

        events.append({"phase": "phone_slot_selected", "phoneSlot": entry["slot"]})
        phone_step, challenge_error = resolve_otp_auth_challenge(session, phone_step, device_id, events)
        if challenge_error:
            return phone_verification_error(
                str(challenge_error.get("kind") or "auth_challenge"),
                str(challenge_error.get("message") or "Auth challenge is required"),
            )
        if page_type(phone_step) != "phone_otp_verification":
            return phone_step

        verified_step, phone_error = validate_phone_otp_with_retry(
            session,
            entry,
            str(phone_step.get("continue_url") or f"{AUTH_BASE_URL}/phone-verification"),
            events,
            "phone_otp_validate",
            device_id,
            baseline,
        )
        if phone_error:
            return phone_verification_error(
                str(phone_error.get("kind") or "phone_otp_failed"),
                str(phone_error.get("message") or "Phone OTP verification failed"),
            )
        events.append(
            {
                "phase": "phone_otp_done",
                "phoneSlot": entry["slot"],
                "sentAt": sent_at.isoformat(),
            }
        )
        record_phone_pool_binding(entry, email)
        return verified_step

    message = f"phone_send_exhausted: tried {attempted} phone numbers"
    if last_error:
        message = f"{message}; last error: {last_error[:180]}"
    events.append({"phase": "phone_send_exhausted", "attempted": attempted, "message": message})
    return {
        "page": {"type": "phone_otp_verification"},
        "_phone_error": {
            "kind": "phone_send_exhausted",
            "attempted": attempted,
            "lastError": last_error,
            "message": message,
        },
    }


def complete_existing_phone_verification(
    session: requests.Session,
    step_json: dict[str, Any],
    device_id: str,
    events: list[dict[str, Any]],
    email: str = "",
) -> dict[str, Any]:
    blocking_challenge = classify_blocking_auth_challenge(step_json)
    if blocking_challenge:
        kind, message, phase = blocking_challenge
        resolved_step = try_resolve_blocking_auth_challenge(session, step_json, device_id, events, kind)
        if resolved_step:
            step_json = resolved_step
            blocking_challenge = classify_blocking_auth_challenge(step_json)
            if blocking_challenge:
                kind, message, phase = blocking_challenge
            elif page_type(step_json) == "auth_challenge":
                events.append({"phase": "auth_challenge_required"})
                return phone_verification_error("auth_challenge", "Auth challenge is required")
            else:
                kind = message = phase = ""
        if blocking_challenge:
            events.append({"phase": phase})
            return phone_verification_error(kind, message)

    step_type = page_type(step_json)
    if step_type == "add_phone" and email:
        return complete_add_phone_verification(session, step_json, device_id, email, events)
    if step_type == "auth_challenge":
        events.append({"phase": "auth_challenge_required"})
        return phone_verification_error("auth_challenge", "Auth challenge is required")
    if step_type != "phone_otp_verification":
        return step_json

    pool = read_phone_pool()
    if not pool:
        events.append({"phase": "bound_phone_pool_empty"})
        return phone_verification_error("phone_not_in_pool", "No phone pool entries are configured")

    entry, error_kind = match_bound_phone_entry(step_json, pool)
    if not entry:
        if error_kind == "phone_pool_ambiguous":
            events.append({"phase": "bound_phone_ambiguous"})
            return phone_verification_error(
                "phone_pool_ambiguous",
                "Bound phone hint matches multiple phone pool entries",
            )
        phase = "bound_phone_hint_missing" if error_kind == "phone_hint_missing" else "bound_phone_not_in_pool"
        events.append({"phase": phase})
        return phone_verification_error(
            "phone_not_in_pool",
            "Bound phone is not available in the phone pool",
        )

    baseline = fetch_phone_messages(entry["url"])
    events.append({"phase": "bound_phone_slot_selected", "phoneSlot": entry["slot"]})
    verified_step, phone_error = validate_phone_otp_with_retry(
        session,
        entry,
        str(step_json.get("continue_url") or f"{AUTH_BASE_URL}/phone-verification"),
        events,
        "bound_phone_otp_validate",
        device_id,
        baseline,
    )
    if phone_error:
        return phone_verification_error(
            str(phone_error.get("kind") or "phone_otp_failed"),
            str(phone_error.get("message") or "Phone OTP verification failed"),
        )
    events.append({"phase": "bound_phone_otp_done", "phoneSlot": entry["slot"]})
    record_phone_pool_binding(entry, email)
    return verified_step


def validate_email_otp_with_retry(
    session: requests.Session,
    email: str,
    min_dt: datetime,
    referer: str,
    events: list[dict[str, Any]],
    phase: str,
    device_id: str,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    max_attempts = max(1, int(os.environ.get("TEAMMGR_EMAIL_CODE_MAX_ATTEMPTS", "3")))
    rejected_codes: set[str] = set()
    last_error = ""
    for attempt in range(1, max_attempts + 1):
        try:
            code = poll_gongxi_code(email, min_dt, rejected_codes)
        except Exception as exc:
            events.append({"phase": f"{phase}_poll_failed", "message": str(exc)[:160]})
            return {}, {"kind": "email_otp_timeout", "message": str(exc)[:240]}

        try:
            _, verified_step = post_auth_json(
                session,
                "/api/accounts/email-otp/validate",
                {"code": code},
                referer,
                events,
                phase,
                device_id,
            )
        except Exception as exc:
            last_error = str(exc)
            if is_account_locked_error(last_error):
                events.append({"phase": "account_locked"})
                return {}, {"kind": "account_locked", "message": "Account is locked or unavailable"}
            if not is_otp_invalid_error(last_error):
                raise
            rejected_codes.add(code)
            events.append(
                {
                    "phase": f"{phase}_rejected",
                    "attempt": attempt,
                    "message": redact_otp_message(last_error)[:160],
                }
            )
            continue

        if is_email_otp_invalid_response(verified_step):
            last_error = "email_otp_invalid_response"
            rejected_codes.add(code)
            events.append({"phase": f"{phase}_rejected", "attempt": attempt})
            continue

        verified_step, challenge_error = resolve_otp_auth_challenge(session, verified_step, device_id, events)
        if challenge_error:
            return {}, challenge_error

        return verified_step, None

    message = f"Email OTP code was rejected after {max_attempts} attempt(s)"
    if last_error:
        message = f"{message}: {redact_otp_message(last_error)[:180]}"
    return {}, {"kind": "email_otp_invalid", "message": message}


def validate_phone_otp_with_retry(
    session: requests.Session,
    entry: dict[str, Any],
    referer: str,
    events: list[dict[str, Any]],
    phase: str,
    device_id: str,
    baseline: str,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    max_attempts = max(1, int(os.environ.get("TEAMMGR_PHONE_CODE_MAX_ATTEMPTS", "3")))
    current_baseline = baseline
    last_error = ""
    for attempt in range(1, max_attempts + 1):
        try:
            code = poll_phone_code(str(entry["url"]), current_baseline)
        except Exception as exc:
            events.append({"phase": f"{phase}_poll_failed", "phoneSlot": entry["slot"], "message": str(exc)[:160]})
            return {}, {"kind": "phone_otp_timeout", "message": str(exc)[:240]}

        try:
            _, verified_step = post_auth_json(
                session,
                "/api/accounts/phone-otp/validate",
                {"code": code},
                referer,
                events,
                phase,
                device_id,
            )
        except Exception as exc:
            last_error = str(exc)
            if is_account_locked_error(last_error):
                events.append({"phase": "account_locked"})
                return {}, {"kind": "account_locked", "message": "Account is locked or unavailable"}
            if not is_otp_invalid_error(last_error):
                raise
            events.append(
                {
                    "phase": f"{phase}_rejected",
                    "phoneSlot": entry["slot"],
                    "attempt": attempt,
                    "message": redact_otp_message(last_error)[:160],
                }
            )
            current_baseline = f"{current_baseline}\n{code}"
            continue

        if is_phone_otp_invalid_response(verified_step):
            last_error = "phone_otp_invalid_response"
            events.append({"phase": f"{phase}_rejected", "phoneSlot": entry["slot"], "attempt": attempt})
            current_baseline = f"{current_baseline}\n{code}"
            continue

        verified_step, challenge_error = resolve_otp_auth_challenge(session, verified_step, device_id, events)
        if challenge_error:
            return {}, challenge_error

        return verified_step, None

    message = f"Phone OTP code was rejected after {max_attempts} attempt(s)"
    if last_error:
        message = f"{message}: {redact_otp_message(last_error)[:180]}"
    return {}, {"kind": "phone_otp_invalid", "message": message}


def resolve_otp_auth_challenge(
    session: requests.Session,
    step_json: dict[str, Any],
    device_id: str,
    events: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    blocking_challenge = classify_blocking_auth_challenge(step_json)
    if blocking_challenge:
        kind, message, phase_name = blocking_challenge
        resolved_step = try_resolve_blocking_auth_challenge(session, step_json, device_id, events, kind)
        if resolved_step:
            next_blocking_challenge = classify_blocking_auth_challenge(resolved_step)
            if not next_blocking_challenge:
                if page_type(resolved_step) != "auth_challenge":
                    return resolved_step, None
                kind, message, phase_name = "auth_challenge", "Auth challenge is required", "auth_challenge_required"
            else:
                kind, message, phase_name = next_blocking_challenge
        events.append({"phase": phase_name})
        return {}, {"kind": kind, "message": message}

    if page_type(step_json) == "auth_challenge":
        events.append({"phase": "auth_challenge_required"})
        return {}, {"kind": "auth_challenge", "message": "Auth challenge is required"}

    return step_json, None


def is_otp_invalid_error(message: str) -> bool:
    return bool(
        re.search(r"invalid[_ -]?(code|otp)", message, re.I)
        or re.search(r"(invalid|incorrect|wrong|expired).{0,40}(code|otp|verification)", message, re.I)
        or re.search(r"(code|otp|verification).{0,40}(invalid|incorrect|wrong|expired)", message, re.I)
        or re.search(r"验证码.{0,12}(错误|无效|过期)", message)
        or re.search(r"(错误|无效|过期).{0,12}验证码", message)
    )


def is_email_otp_invalid_response(data: dict[str, Any]) -> bool:
    text = json.dumps(data, ensure_ascii=False)
    return page_type(data) == "email_otp_verification" and is_otp_invalid_error(text)


def is_phone_otp_invalid_response(data: dict[str, Any]) -> bool:
    text = json.dumps(data, ensure_ascii=False)
    return page_type(data) == "phone_otp_verification" and is_otp_invalid_error(text)


def redact_otp_message(message: str) -> str:
    return re.sub(r"(?<!\d)(\d{6})(?!\d)", "<CODE>", message)


def try_resolve_blocking_auth_challenge(
    session: requests.Session,
    step_json: dict[str, Any],
    device_id: str,
    events: list[dict[str, Any]],
    kind: str,
) -> dict[str, Any] | None:
    if kind != "human_verification" or not FLARESOLVERR_URL:
        return None
    challenge_url = str(step_json.get("continue_url") or f"{AUTH_BASE_URL}/auth-challenge")
    if challenge_url.startswith("/"):
        challenge_url = urljoin(AUTH_BASE_URL, challenge_url)
    if not challenge_url.startswith("http"):
        return None

    events.append({"phase": "human_verification_solver_start", "continueUrl": short_url(challenge_url)})
    try:
        solved_url = solve_auth_page(session, challenge_url, events)
    except Exception as exc:
        events.append({"phase": "human_verification_solver_failed", "message": str(exc)[:160]})
        return None

    api_path = auth_api_path_from_url(solved_url or challenge_url)
    if not api_path:
        events.append({"phase": "human_verification_solver_no_json_state", "url": short_url(solved_url)})
        return None

    try:
        _, resolved_step = get_auth_json(
            session,
            api_path,
            solved_url or challenge_url,
            events,
            "human_verification_solver_continue",
            device_id,
        )
    except Exception as exc:
        events.append({"phase": "human_verification_solver_continue_failed", "message": str(exc)[:160]})
        return None
    if not page_type(resolved_step):
        events.append({"phase": "human_verification_solver_empty_state"})
        return None
    return resolved_step


def auth_api_path_from_url(value: str) -> str:
    parsed = urlparse(value)
    auth_host = urlparse(AUTH_BASE_URL).netloc
    if parsed.netloc and parsed.netloc != auth_host:
        return ""
    if not parsed.path.startswith("/api/"):
        return ""
    return parsed.path + (f"?{parsed.query}" if parsed.query else "")


def phone_verification_error(kind: str, message: str) -> dict[str, Any]:
    return {
        "page": {"type": "phone_otp_verification"},
        "_phone_error": {
            "kind": kind,
            "message": message,
        },
    }


def phone_error_status(kind: Any) -> str:
    return "account_locked" if str(kind or "") == "account_locked" else "verification_required"


def account_locked_auth_result(events: list[dict[str, Any]]) -> dict[str, Any]:
    events.append({"phase": "account_locked"})
    return {
        "ok": False,
        "status": "account_locked",
        "challenge": "account_locked",
        "message": "Account is locked or unavailable",
        "events": events,
    }


def classify_blocking_auth_challenge(step_json: dict[str, Any]) -> tuple[str, str, str] | None:
    if page_type(step_json) != "auth_challenge":
        return None
    text = json.dumps(step_json, ensure_ascii=False).lower()
    if is_account_locked_error(text):
        return ("account_locked", "Account is locked or unavailable", "account_locked")
    if re.search(r"\b(captcha|arkose|human|robot)\b", text) or re.search(r"人机|真人|机器人", text):
        return ("human_verification", "Human verification is required", "human_verification_required")
    return None


def match_bound_phone_entry(step_json: dict[str, Any], pool: list[dict[str, str]]) -> tuple[dict[str, str] | None, str]:
    hints = extract_phone_hints(step_json)
    if not hints:
        return None, "phone_hint_missing"

    matches_by_phone: dict[str, dict[str, str]] = {}
    for hint in hints:
        for entry in pool:
            entry_digits = phone_digits(entry.get("phone") or "")
            if not entry_digits:
                continue
            if phone_hint_matches_entry(hint, entry_digits):
                key = phone_match_key(entry_digits)
                matches_by_phone.setdefault(key, entry)

    if len(matches_by_phone) == 1:
        return next(iter(matches_by_phone.values())), ""
    if len(matches_by_phone) > 1:
        return None, "phone_pool_ambiguous"
    return None, "phone_not_in_pool"


def extract_phone_hints(value: Any, path: str = "") -> list[str]:
    hints: list[str] = []
    if isinstance(value, dict):
        for key, nested in value.items():
            nested_path = f"{path}.{key}" if path else str(key)
            hints.extend(extract_phone_hints(nested, nested_path))
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            hints.extend(extract_phone_hints(nested, f"{path}[{index}]"))
    elif isinstance(value, str):
        lower_path = path.lower()
        related_path = any(token in lower_path for token in ("phone", "mobile", "sms", "tel"))
        related_text = bool(
            re.search(r"(phone|mobile|sms|text message|ending|last)", value, re.I)
            or re.search(r"(\+\d|[*xX]{2,}\D*\d{2,4})", value)
        )
        digits = phone_digits(value)
        if len(digits) >= 4 and (related_path or related_text):
            hints.append(digits)
    return hints


def phone_hint_matches_entry(hint_digits: str, entry_digits: str) -> bool:
    if len(hint_digits) >= 10:
        return entry_digits.endswith(hint_digits[-10:]) or hint_digits.endswith(entry_digits[-10:])
    return len(hint_digits) >= 4 and entry_digits.endswith(hint_digits[-4:])


def phone_match_key(entry_digits: str) -> str:
    return entry_digits[-10:] if len(entry_digits) >= 10 else entry_digits


def phone_digits(value: str) -> str:
    return re.sub(r"\D", "", value)


def ordered_phone_pool(email: str) -> list[dict[str, str]]:
    pool = read_phone_pool()
    if not pool:
        return []
    eligible = [entry for entry in pool if not entry.get("exhausted") or phone_pool_entry_has_account(entry, email)]
    current = [entry for entry in eligible if phone_pool_entry_has_account(entry, email)]
    fresh = [entry for entry in eligible if not entry.get("gptAccounts") and entry not in current]
    fallback = [entry for entry in eligible if entry not in current and entry not in fresh]
    seed = int(hashlib.sha256(email.lower().encode()).hexdigest()[:8], 16)
    random.Random(seed).shuffle(fallback)
    return current + fresh + fallback


def read_phone_pool() -> list[dict[str, Any]]:
    document = load_phone_pool_document()
    rows: list[dict[str, Any]] = []
    phones = document.get("phones") if isinstance(document, dict) else []
    if not isinstance(phones, list):
        raise ValueError("phone pool yaml field 'phones' must be a list")
    for index, record in enumerate(phones, start=1):
        if not isinstance(record, dict):
            continue
        phone = phone_pool_record_string(record, "phone", "number")
        url = phone_pool_record_string(record, "url", "smsUrl", "inboxUrl")
        if not phone or not url.startswith("http"):
            continue
        rows.append(
            {
                "phone": phone,
                "url": url,
                "exhausted": record.get("exhausted") is True,
                "gptAccounts": normalize_phone_pool_accounts(record.get("gptAccounts")),
                "slot": f"{os.path.basename(PHONE_POOL_YAML or 'phone-pool.yaml')}:{index}",
            }
        )
    return rows


def load_phone_pool_document() -> dict[str, Any]:
    if not PHONE_POOL_YAML:
        return {"version": 1, "phones": []}
    try:
        with open(PHONE_POOL_YAML, "r", encoding="utf-8") as handle:
            loaded = yaml.safe_load(handle) or {}
    except FileNotFoundError:
        return {"version": 1, "phones": []}
    if isinstance(loaded, list):
        return {"version": 1, "phones": loaded}
    if not isinstance(loaded, dict):
        raise ValueError("phone pool yaml must be an object")
    phones = loaded.get("phones")
    if phones is None:
        loaded["phones"] = []
    elif not isinstance(phones, list):
        raise ValueError("phone pool yaml field 'phones' must be a list")
    return loaded


def save_phone_pool_document(document: dict[str, Any]) -> None:
    if not PHONE_POOL_YAML:
        return
    directory = os.path.dirname(PHONE_POOL_YAML)
    if directory:
        os.makedirs(directory, exist_ok=True)
    tmp_path = f"{PHONE_POOL_YAML}.tmp-{os.getpid()}-{uuid.uuid4().hex}"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        yaml.safe_dump(document, handle, allow_unicode=True, sort_keys=False)
    os.replace(tmp_path, PHONE_POOL_YAML)


def phone_pool_record_string(record: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def normalize_phone_pool_accounts(value: Any) -> list[dict[str, str]]:
    accounts: list[dict[str, str]] = []
    if not isinstance(value, list):
        return accounts
    for item in value:
        if isinstance(item, str) and item.strip():
            accounts.append({"email": item.strip()})
        elif isinstance(item, dict):
            normalized = {
                str(key): str(nested).strip()
                for key, nested in item.items()
                if nested is not None and str(nested).strip()
            }
            if normalized:
                accounts.append(normalized)
    return accounts


def phone_pool_entry_has_account(entry: dict[str, Any], email: str) -> bool:
    normalized_email = email.strip().lower()
    if not normalized_email:
        return False
    for account in normalize_phone_pool_accounts(entry.get("gptAccounts")):
        if str(account.get("email") or "").strip().lower() == normalized_email:
            return True
    return False


def record_phone_pool_binding(entry: dict[str, Any], email: str) -> None:
    if not email.strip():
        return
    now = datetime.now(timezone.utc).isoformat()

    def update(record: dict[str, Any]) -> None:
        accounts = normalize_phone_pool_accounts(record.get("gptAccounts"))
        if not any(str(account.get("email") or "").strip().lower() == email.strip().lower() for account in accounts):
            accounts.append({"email": email.strip(), "boundAt": now})
        record["gptAccounts"] = accounts
        record["exhausted"] = record.get("exhausted") is True
        record["lastUsedAt"] = now

    update_phone_pool_record(entry, update)


def mark_phone_pool_exhausted(entry: dict[str, Any], reason: str) -> None:
    now = datetime.now(timezone.utc).isoformat()

    def update(record: dict[str, Any]) -> None:
        record["exhausted"] = True
        record["exhaustedAt"] = now
        record["exhaustedReason"] = reason[:240]

    update_phone_pool_record(entry, update)


def update_phone_pool_record(entry: dict[str, Any], updater: Any) -> None:
    phone = phone_digits(str(entry.get("phone") or ""))
    if not phone:
        return
    document = load_phone_pool_document()
    phones = document.get("phones")
    if not isinstance(phones, list):
        return
    for record in phones:
        if not isinstance(record, dict):
            continue
        record_phone = phone_digits(phone_pool_record_string(record, "phone", "number"))
        if record_phone and record_phone == phone:
            updater(record)
            save_phone_pool_document(document)
            return


def is_phone_pool_exhaustion_error(message: str) -> bool:
    return bool(
        re.search(r"maximum number of accounts", message, re.I)
        or re.search(r"too many accounts", message, re.I)
        or re.search(r"账号数量.*(最大|上限|过多)", message)
        or re.search(r"(最大|上限|过多).*账号数量", message)
    )


def worker_health_payload() -> dict[str, Any]:
    phone_pool_count = 0
    phone_pool_exhausted_count = 0
    phone_pool_ok = False
    phone_pool_error = ""
    try:
        phone_pool = read_phone_pool()
        phone_pool_count = len([entry for entry in phone_pool if not entry.get("exhausted")])
        phone_pool_exhausted_count = len([entry for entry in phone_pool if entry.get("exhausted")])
        phone_pool_ok = phone_pool_count > 0
        if not PHONE_POOL_YAML:
            phone_pool_error = "未配置 TEAMMGR_PHONE_POOL_YAML"
    except Exception:
        phone_pool_error = "短信接码 YAML 配置不可用"
    return {
        "ok": True,
        "capabilities": {
            "chatgptFetch": True,
            "codexAutoAuth": bool(FLARESOLVERR_URL and GONGXI_MAIL_BASE_URL and GONGXI_MAIL_API_KEY),
            "subaccountRegistration": bool(FLARESOLVERR_URL and GONGXI_MAIL_BASE_URL and GONGXI_MAIL_API_KEY),
            "flaresolverr": bool(FLARESOLVERR_URL),
            "gongxiMail": bool(GONGXI_MAIL_BASE_URL and GONGXI_MAIL_API_KEY),
            "phoneOtp": phone_pool_ok,
        },
        "phonePoolCount": phone_pool_count,
        "phonePoolExhaustedCount": phone_pool_exhausted_count,
        "phonePoolError": phone_pool_error or None,
    }


def fetch_phone_messages(url: str) -> str:
    request = Request(url, headers={"user-agent": AUTH_USER_AGENT})
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", "replace")


def poll_phone_code(url: str, baseline: str) -> str:
    deadline = time.time() + PHONE_OTP_TIMEOUT
    last_preview = ""
    baseline_codes = set(extract_sms_codes(baseline))
    while time.time() < deadline:
        text = fetch_phone_messages(url)
        last_preview = re.sub(r"(?<!\d)(\d{6})(?!\d)", "<CODE>", text[:120])
        if not re.search(r"(暂时没有收到消息|\bno\b)", text, re.I):
            codes = [code for code in extract_sms_codes(text) if code not in baseline_codes]
            if codes:
                return codes[-1]
        time.sleep(5)
    raise TimeoutError(f"phone_otp_timeout: {last_preview[:80]}")


def extract_sms_codes(text: str) -> list[str]:
    return re.findall(r"(?<!\d)(\d{6})(?!\d)", text)


def solve_auth_page(session: requests.Session, auth_url: str, events: list[dict[str, Any]]) -> str:
    payload: dict[str, Any] = {"cmd": "request.get", "url": auth_url, "maxTimeout": 90000}
    if AUTH_PROXY_URL:
        payload["proxy"] = {"url": AUTH_PROXY_URL}
    response = requests.post(f"{FLARESOLVERR_URL}/v1", json=payload, timeout=120)
    try:
        data = response.json()
    except Exception as exc:
        raise RuntimeError(f"flaresolverr_invalid_json: {response.text[:300]}") from exc
    solution_url = str(((data.get("solution") or {}).get("url") or "")[:240])
    events.append(
        {
            "phase": "flaresolverr_authorize",
            "status": response.status_code,
            "solverStatus": data.get("status"),
            "url": solution_url,
        }
    )
    if data.get("status") != "ok":
        raise RuntimeError(f"flaresolverr_failed: {data.get('message')}")
    solution = data.get("solution") or {}
    if solution.get("userAgent"):
        session.headers.update({"user-agent": str(solution["userAgent"])})
    for cookie in solution.get("cookies") or []:
        session.cookies.set(
            str(cookie.get("name")),
            str(cookie.get("value")),
            domain=str(cookie.get("domain") or "auth.openai.com"),
            path=str(cookie.get("path") or "/"),
        )
    return solution_url


def post_auth_json(
    session: requests.Session,
    path: str,
    payload: dict[str, Any] | None,
    referer: str,
    events: list[dict[str, Any]],
    phase: str,
    device_id: str,
    *,
    sentinel_flow: str = "",
    allow_redirects: bool = True,
) -> tuple[Any, dict[str, Any]]:
    headers = auth_headers(session, referer, device_id)
    if sentinel_flow:
        headers["openai-sentinel-token"] = build_sentinel_token(session, device_id, sentinel_flow)
    response = session.post(
        f"{AUTH_BASE_URL}{path}",
        json=payload,
        headers=headers,
        allow_redirects=allow_redirects,
        timeout=REQUEST_TIMEOUT,
    )
    data = response_json(response)
    event = {
        "phase": phase,
        "method": "POST",
        "path": path,
        "status": response.status_code,
        "pageType": page_type(data),
        "continueUrl": short_url(data.get("continue_url")),
    }
    if response.headers.get("location"):
        event["location"] = short_url(response.headers.get("location"))
    if response.status_code >= 400:
        error_preview = redact_otp_message(response.text)[:300]
        event["errorPreview"] = error_preview
    events.append(event)
    if response.status_code >= 400:
        raise RuntimeError(f"{phase}_failed_{response.status_code}: {redact_otp_message(response.text)[:300]}")
    return response, data


def get_auth_json(
    session: requests.Session,
    path: str,
    referer: str,
    events: list[dict[str, Any]],
    phase: str,
    device_id: str,
) -> tuple[Any, dict[str, Any]]:
    response = session.get(
        f"{AUTH_BASE_URL}{path}",
        headers=auth_headers(session, referer, device_id),
        timeout=REQUEST_TIMEOUT,
    )
    data = response_json(response)
    event = {
        "phase": phase,
        "method": "GET",
        "path": path,
        "status": response.status_code,
        "pageType": page_type(data),
        "continueUrl": short_url(data.get("continue_url")),
    }
    if response.status_code >= 400:
        error_preview = redact_otp_message(response.text)[:300]
        event["errorPreview"] = error_preview
    events.append(event)
    if response.status_code >= 400:
        raise RuntimeError(f"{phase}_failed_{response.status_code}: {redact_otp_message(response.text)[:300]}")
    return response, data


def follow_to_callback(
    session: requests.Session,
    step_json: dict[str, Any],
    device_id: str,
    events: list[dict[str, Any]],
) -> str:
    callback_url, _ = follow_to_callback_result(session, step_json, device_id, events)
    return callback_url


def follow_to_callback_result(
    session: requests.Session,
    step_json: dict[str, Any],
    device_id: str,
    events: list[dict[str, Any]],
) -> tuple[str, dict[str, Any] | None]:
    candidate = step_json.get("continue_url") or ""
    if candidate.startswith("/"):
        candidate = AUTH_BASE_URL + candidate
    for index in range(8):
        if not candidate:
            return "", None
        if candidate.startswith(CODEX_REDIRECT_URI):
            return candidate, None
        response = session.get(candidate, headers=auth_headers(session, candidate, device_id), allow_redirects=False, timeout=REQUEST_TIMEOUT)
        data = response_json(response)
        location = response.headers.get("location") or ""
        events.append(
            {
                "phase": f"follow_continue_{index + 1}",
                "method": "GET",
                "status": response.status_code,
                "pageType": page_type(data),
                "location": short_url(location),
                "continueUrl": short_url(data.get("continue_url") if data else ""),
            }
        )
        if location:
            candidate = location if not location.startswith("/") else AUTH_BASE_URL + location
        else:
            if page_type(data) == "auth_challenge":
                data, challenge_error = resolve_auth_challenge_for_token_stage(session, data, device_id, events)
                if challenge_error:
                    return "", challenge_error
            if data.get("continue_url"):
                candidate = str(data["continue_url"])
            else:
                return "", None
        if candidate.startswith("/"):
            candidate = AUTH_BASE_URL + candidate
    return (candidate, None) if candidate.startswith(CODEX_REDIRECT_URI) else ("", None)


def exchange_codex_token(session: requests.Session, code: str, code_verifier: str, events: list[dict[str, Any]]) -> dict[str, Any]:
    response = session.post(
        f"{AUTH_BASE_URL}/oauth/token",
        data={
            "grant_type": "authorization_code",
            "client_id": CODEX_CLIENT_ID,
            "code": code,
            "redirect_uri": CODEX_REDIRECT_URI,
            "code_verifier": code_verifier,
        },
        headers={"content-type": "application/x-www-form-urlencoded", "accept": "application/json", "user-agent": AUTH_USER_AGENT},
        timeout=REQUEST_TIMEOUT,
    )
    data = response_json(response)
    events.append(
        {
            "phase": "oauth_token_exchange",
            "method": "POST",
            "path": "/oauth/token",
            "status": response.status_code,
            "responseKeys": sorted(data.keys()),
        }
    )
    if response.status_code >= 400:
        raise RuntimeError(f"oauth_token_exchange_failed_{response.status_code}: {response.text[:300]}")
    return data


def auth_headers(session: requests.Session, referer: str, device_id: str) -> dict[str, str]:
    headers = dict(AUTH_COMMON_HEADERS)
    headers.update(
        {
            "referer": referer,
            "oai-device-id": device_id,
            "cookie": cookie_header(session),
        }
    )
    return headers


def cookie_value(session: requests.Session, name: str) -> str:
    for cookie in session.cookies.jar:
        if cookie.name == name:
            return str(cookie.value)
    return ""


def cookie_header(session: requests.Session) -> str:
    pairs = []
    for cookie in session.cookies.jar:
        if cookie.domain and "auth.openai.com" not in cookie.domain:
            continue
        pairs.append(f"{cookie.name}={cookie.value}")
    return "; ".join(pairs)


def response_json(response: Any) -> dict[str, Any]:
    try:
        data = response.json() if response.text else {}
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def page_type(data: dict[str, Any]) -> str:
    page = data.get("page") if isinstance(data, dict) else None
    return str((page or {}).get("type") or "")


def auth_session_payload(data: dict[str, Any]) -> dict[str, Any]:
    session_data = data.get("oai-client-auth-session") if isinstance(data, dict) else None
    if isinstance(session_data, dict):
        return session_data
    page = data.get("page") if isinstance(data, dict) else None
    payload = (page or {}).get("payload") if isinstance(page, dict) else None
    return payload if isinstance(payload, dict) else {}


def short_url(value: Any) -> str:
    text = str(value or "")
    return text[:240]


def poll_gongxi_code(email: str, min_dt: datetime, excluded_codes: set[str] | None = None) -> str:
    deadline = time.time() + GONGXI_MAIL_TIMEOUT
    excluded = excluded_codes or set()
    while time.time() < deadline:
        rows = [
            row
            for row in gongxi_code_candidates(email)
            if row["date"] and row["date"] >= min_dt - timedelta(seconds=5) and str(row["code"]) not in excluded
        ]
        if rows:
            return str(rows[0]["code"])
        time.sleep(4)
    latest = gongxi_code_candidates(email)[:3]
    raise TimeoutError(
        "email_code_timeout: "
        + repr([(row["mailbox"], row["subject"], row["date"].isoformat() if row["date"] else None) for row in latest])
    )


def allocate_gongxi_email(mail_group: str, events: list[dict[str, Any]] | None = None) -> str:
    query = f"?group={quote(mail_group)}" if mail_group else ""
    response = requests.get(
        f"{GONGXI_MAIL_BASE_URL}/api/get-email{query}",
        headers={"accept": "application/json", "x-api-key": GONGXI_MAIL_API_KEY},
        timeout=45,
    )
    data = response_json(response)
    email = extract_gongxi_email(data)
    if events is not None:
        events.append(
            {
                "phase": "gongxi_get_email",
                "status": response.status_code,
                "mailGroup": bool(mail_group),
                "emailPresent": bool(email),
            }
        )
    if response.status_code >= 400:
        raise RuntimeError(f"gongxi_get_email_failed_{response.status_code}: {response.text[:240]}")
    if not email:
        raise RuntimeError(f"gongxi_get_email_missing_email: {response.text[:240]}")
    return email


def extract_gongxi_email(value: Any) -> str:
    if isinstance(value, str):
        return value.strip() if "@" in value else ""
    if isinstance(value, dict):
        for key in ("email", "mail", "address", "account"):
            nested = value.get(key)
            if isinstance(nested, str) and "@" in nested:
                return nested.strip()
        data = value.get("data")
        if isinstance(data, (dict, str)):
            found = extract_gongxi_email(data)
            if found:
                return found
    return ""


def generate_registration_password() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    raw = "".join(random.SystemRandom().choice(alphabet) for _ in range(22))
    return f"{raw}!9a"


def gongxi_code_candidates(email: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for mailbox in ("inbox", "junk"):
        response = requests.post(
            f"{GONGXI_MAIL_BASE_URL}/api/mail_all",
            headers={"content-type": "application/json", "x-api-key": GONGXI_MAIL_API_KEY},
            json={"email": email, "mailbox": mailbox},
            timeout=45,
        )
        data = response_json(response)
        messages = ((data.get("data") or {}).get("messages") or []) if isinstance(data.get("data"), dict) else []
        for message in messages:
            if not isinstance(message, dict):
                continue
            subject = str(message.get("subject") or "")
            sender = str(message.get("from") or message.get("sender") or "")
            if not CODE_SUBJECT_RE.search(subject) or not OPENAI_SENDER_RE.search(sender + " " + subject):
                continue
            text = "\n".join(str(message.get(key) or "") for key in ("text", "body", "preview", "snippet", "html"))
            codes = re.findall(r"(?<!\d)(\d{6})(?!\d)", subject + "\n" + text)
            if codes:
                rows.append(
                    {
                        "mailbox": mailbox,
                        "date": parse_mail_datetime(
                            message.get("date")
                            or message.get("receivedDateTime")
                            or message.get("received_at")
                            or message.get("createdAt")
                        ),
                        "subject": subject,
                        "code": codes[0],
                    }
                )
    rows.sort(key=lambda row: row["date"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return rows


def parse_mail_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000 if value > 10_000_000_000 else value, timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def main() -> None:
    print(
        f"[curl-cffi-worker] listening on :{PORT} base={BASE_URL.rstrip('/')} "
        f"proxy={'set' if PROXY_URL else 'none'} impersonate={IMPERSONATE}",
        flush=True,
    )
    ThreadingHTTPServer(("0.0.0.0", PORT), WorkerHandler).serve_forever()


if __name__ == "__main__":
    main()
