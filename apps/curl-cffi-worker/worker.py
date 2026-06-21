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
from typing import Any
from urllib.parse import parse_qs, urljoin, urlparse
from urllib.request import Request, urlopen

from curl_cffi import requests


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
PHONE_POOL_FILES = [
    value.strip()
    for value in (
        os.environ.get("TEAMMGR_PHONE_POOL_FILES")
        or os.environ.get("TEAMMGR_PHONE_POOL_FILE", "")
    ).split(",")
    if value.strip()
]
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

    return {"method": method, "path": path, "headers": normalized_headers, "body": body}


def fetch_chatgpt(request: dict[str, Any]) -> tuple[int, str]:
    url = urljoin(BASE_URL, request["path"].lstrip("/"))
    session_kwargs: dict[str, Any] = {"impersonate": IMPERSONATE, "verify": True}
    if PROXY_URL:
        session_kwargs["proxy"] = PROXY_URL

    with requests.Session(**session_kwargs) as session:
        response = session.request(
            request["method"],
            url,
            headers=request["headers"],
            data=request["body"],
            timeout=REQUEST_TIMEOUT,
        )
        return int(response.status_code), response.text


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


def run_codex_auto_auth(payload: Any) -> dict[str, Any]:
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

    events: list[dict[str, Any]] = []
    session_kwargs: dict[str, Any] = {"impersonate": AUTH_IMPERSONATE, "verify": False}
    if AUTH_PROXY_URL:
        session_kwargs["proxy"] = AUTH_PROXY_URL

    with requests.Session(**session_kwargs) as session:
        session.headers.update({"user-agent": AUTH_USER_AGENT})
        flow_started_at = datetime.now(timezone.utc)
        initial_url = solve_auth_page(session, auth_url, events)
        device_id = cookie_value(session, "oai-did") or str(uuid.uuid4())

        otp_requested_at = flow_started_at
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

        step_type = page_type(step_json)
        if step_type == "email_otp_verification" or str(step_json.get("continue_url") or "").endswith("/email-verification"):
            code = poll_gongxi_code(email, otp_requested_at)
            _, step_json = post_auth_json(
                session,
                "/api/accounts/email-otp/validate",
                {"code": code},
                f"{AUTH_BASE_URL}/email-verification",
                events,
                "email_otp_validate",
                device_id,
            )
            step_type = page_type(step_json)

        if step_type == "add_phone":
            step_json = complete_add_phone_verification(session, step_json, device_id, email, events)
            phone_error = step_json.get("_phone_error")
            if isinstance(phone_error, dict):
                return {
                    "ok": False,
                    "status": "verification_required",
                    "challenge": phone_error.get("kind") or "phone_send_exhausted",
                    "message": phone_error.get("message") or "All phone numbers were rejected",
                    "events": events,
                }
            step_type = page_type(step_json)

        if step_type in {"phone_otp_verification", "auth_challenge"}:
            step_json = complete_existing_phone_verification(session, step_json, device_id, events)
            phone_error = step_json.get("_phone_error")
            if isinstance(phone_error, dict):
                return {
                    "ok": False,
                    "status": "verification_required",
                    "challenge": phone_error.get("kind") or step_type,
                    "message": phone_error.get("message") or f"Codex Auth requires manual verification: {step_type}",
                    "events": events,
                }
            step_type = page_type(step_json)

        if step_type in {"add_phone", "phone_otp_verification", "auth_challenge"}:
            return {
                "ok": False,
                "status": "verification_required",
                "challenge": step_type,
                "message": f"Codex Auth requires manual verification: {step_type}",
                "events": events,
            }
        if step_type == "phone_otp_select_channel":
            # 已绑手机但需先选验证渠道:选 SMS 触发发码，进入 phone_otp_verification 后复用既有取码逻辑
            select_ref = str(step_json.get("continue_url") or f"{AUTH_BASE_URL}/phone-otp/select-channel")
            _, step_json = post_auth_json(
                session,
                "/api/accounts/phone-otp/send",
                {"channel": "sms"},
                select_ref,
                events,
                "phone_otp_select_channel_send",
                device_id,
            )
            step_type = page_type(step_json)
            if step_type in {"phone_otp_verification", "auth_challenge"}:
                step_json = complete_existing_phone_verification(session, step_json, device_id, events)
                phone_error = step_json.get("_phone_error")
                if isinstance(phone_error, dict):
                    return {
                        "ok": False,
                        "status": "verification_required",
                        "challenge": phone_error.get("kind") or "phone_otp_select_channel",
                        "message": phone_error.get("message") or "Phone OTP verification failed",
                        "events": events,
                    }
                step_type = page_type(step_json)
        if step_type != "sign_in_with_chatgpt_codex_consent":
            return {
                "ok": False,
                "status": "unexpected_page",
                "challenge": step_type or "",
                "message": f"Unexpected auth page: {step_type or '<empty>'}",
                "events": events,
            }

        session_data = auth_session_payload(step_json)
        workspaces = session_data.get("workspaces") or []
        if not workspaces:
            return {"ok": False, "status": "unexpected_page", "message": "No Codex workspaces in auth session", "events": events}
        workspace = select_codex_workspace(workspaces, target_chatgpt_account_id)
        if target_chatgpt_account_id and not workspace:
            return {
                "ok": False,
                "status": "workspace_not_found",
                "message": "Target Codex workspace was not available in auth session",
                "events": events,
            }
        workspace_id = workspace.get("id") if workspace else session_data.get("current_workspace_id") or workspaces[0].get("id")
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

        if page_type(step_json) == "sign_in_with_chatgpt_codex_organization":
            session_data = auth_session_payload(step_json)
            orgs = session_data.get("orgs") or []
            if not orgs:
                return {"ok": False, "status": "unexpected_page", "message": "No organizations in auth session", "events": events}
            org = orgs[0]
            projects = org.get("projects") or []
            project_id = projects[0].get("id") if projects else ""
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

        callback_url = follow_to_callback(session, step_json, device_id, events)
        if not callback_url:
            return {"ok": False, "status": "no_callback", "message": "Codex Auth did not return callback URL", "events": events}

        params = parse_qs(urlparse(callback_url).query)
        if (params.get("state") or [""])[0] != expected_state:
            return {"ok": False, "status": "state_mismatch", "message": "Codex Auth state mismatch", "events": events}
        code = (params.get("code") or [""])[0]
        if not code:
            return {"ok": False, "status": "missing_code", "message": "Codex Auth callback is missing code", "events": events}

        token_response = exchange_codex_token(session, code, code_verifier, events)
        if not token_response.get("access_token") or not token_response.get("refresh_token") or not token_response.get("id_token"):
            return {"ok": False, "status": "token_failed", "message": "Codex token response is incomplete", "events": events}
        return {
            "ok": True,
            "status": "ok",
            "callbackUrl": callback_url,
            "tokenResponse": token_response,
            "events": events,
        }


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
            events.append({"phase": "phone_send_rejected", "phoneSlot": entry["slot"], "message": str(exc)[:160]})
            continue

        events.append({"phase": "phone_slot_selected", "phoneSlot": entry["slot"]})
        if page_type(phone_step) != "phone_otp_verification":
            return phone_step

        try:
            code = poll_phone_code(entry["url"], baseline)
        except Exception as exc:
            events.append({"phase": "phone_otp_poll_failed", "phoneSlot": entry["slot"], "message": str(exc)[:160]})
            raise

        _, verified_step = post_auth_json(
            session,
            "/api/accounts/phone-otp/validate",
            {"code": code},
            str(phone_step.get("continue_url") or f"{AUTH_BASE_URL}/phone-verification"),
            events,
            "phone_otp_validate",
            device_id,
        )
        events.append(
            {
                "phase": "phone_otp_done",
                "phoneSlot": entry["slot"],
                "sentAt": sent_at.isoformat(),
            }
        )
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
) -> dict[str, Any]:
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
    try:
        code = poll_phone_code(entry["url"], baseline)
    except Exception as exc:
        events.append({"phase": "bound_phone_otp_poll_failed", "phoneSlot": entry["slot"], "message": str(exc)[:160]})
        return phone_verification_error("phone_otp_timeout", str(exc)[:240])

    _, verified_step = post_auth_json(
        session,
        "/api/accounts/phone-otp/validate",
        {"code": code},
        str(step_json.get("continue_url") or f"{AUTH_BASE_URL}/phone-verification"),
        events,
        "bound_phone_otp_validate",
        device_id,
    )
    events.append({"phase": "bound_phone_otp_done", "phoneSlot": entry["slot"]})
    return verified_step


def phone_verification_error(kind: str, message: str) -> dict[str, Any]:
    return {
        "page": {"type": "phone_otp_verification"},
        "_phone_error": {
            "kind": kind,
            "message": message,
        },
    }


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
    preferred = [entry for entry in pool if "未用" in entry["section"]]
    fallback = [entry for entry in pool if entry not in preferred]
    seed = int(hashlib.sha256(email.lower().encode()).hexdigest()[:8], 16)
    random.Random(seed).shuffle(fallback)
    return preferred + fallback


def read_phone_pool() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for file_path in PHONE_POOL_FILES:
        section = ""
        try:
            with open(file_path, "r", encoding="utf-8") as handle:
                for line_number, raw_line in enumerate(handle, start=1):
                    line = raw_line.strip()
                    if not line:
                        continue
                    if line.startswith("#"):
                        section = line
                        continue
                    parts = [part.strip() for part in line.split("|") if part.strip()]
                    if len(parts) < 2:
                        continue
                    phone = parts[-2]
                    url = parts[-1]
                    if not url.startswith("http"):
                        continue
                    rows.append(
                        {
                            "phone": phone,
                            "url": url,
                            "section": section,
                            "slot": f"{os.path.basename(file_path)}:{line_number}",
                        }
                    )
        except FileNotFoundError:
            continue
    return rows


def worker_health_payload() -> dict[str, Any]:
    phone_pool_count = 0
    phone_pool_ok = False
    phone_pool_error = ""
    try:
        phone_pool_count = len(read_phone_pool())
        phone_pool_ok = phone_pool_count > 0
    except Exception:
        phone_pool_error = "短信接码配置不可用"
    return {
        "ok": True,
        "capabilities": {
            "chatgptFetch": True,
            "codexAutoAuth": bool(FLARESOLVERR_URL and GONGXI_MAIL_BASE_URL and GONGXI_MAIL_API_KEY),
            "flaresolverr": bool(FLARESOLVERR_URL),
            "gongxiMail": bool(GONGXI_MAIL_BASE_URL and GONGXI_MAIL_API_KEY),
            "phoneOtp": phone_pool_ok,
        },
        "phonePoolCount": phone_pool_count,
        "phonePoolError": phone_pool_error or None,
    }


def fetch_phone_messages(url: str) -> str:
    request = Request(url, headers={"user-agent": AUTH_USER_AGENT})
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", "replace")


def poll_phone_code(url: str, baseline: str) -> str:
    deadline = time.time() + PHONE_OTP_TIMEOUT
    last_preview = ""
    while time.time() < deadline:
        text = fetch_phone_messages(url)
        last_preview = re.sub(r"(?<!\d)(\d{6})(?!\d)", "<CODE>", text[:120])
        if not re.search(r"(暂时没有收到消息|\bno\b)", text, re.I):
            codes = re.findall(r"(?<!\d)(\d{6})(?!\d)", text)
            if codes:
                return codes[-1]
        time.sleep(5)
    raise TimeoutError(f"phone_otp_timeout: {last_preview[:80]}")


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
        event["errorPreview"] = response.text[:300]
    events.append(event)
    if response.status_code >= 400:
        raise RuntimeError(f"{phase}_failed_{response.status_code}: {response.text[:300]}")
    return response, data


def follow_to_callback(
    session: requests.Session,
    step_json: dict[str, Any],
    device_id: str,
    events: list[dict[str, Any]],
) -> str:
    candidate = step_json.get("continue_url") or ""
    if candidate.startswith("/"):
        candidate = AUTH_BASE_URL + candidate
    for index in range(8):
        if not candidate:
            return ""
        if candidate.startswith(CODEX_REDIRECT_URI):
            return candidate
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
        elif data.get("continue_url"):
            candidate = str(data["continue_url"])
        else:
            return ""
    return candidate if candidate.startswith(CODEX_REDIRECT_URI) else ""


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


def poll_gongxi_code(email: str, min_dt: datetime) -> str:
    deadline = time.time() + GONGXI_MAIL_TIMEOUT
    while time.time() < deadline:
        rows = [row for row in gongxi_code_candidates(email) if row["date"] and row["date"] >= min_dt - timedelta(seconds=5)]
        if rows:
            return str(rows[0]["code"])
        time.sleep(4)
    latest = gongxi_code_candidates(email)[:3]
    raise TimeoutError(
        "email_code_timeout: "
        + repr([(row["mailbox"], row["subject"], row["date"].isoformat() if row["date"] else None) for row in latest])
    )


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
