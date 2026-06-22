from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

import yaml


URL_RE = re.compile(r"https?://\S+")
PHONE_RE = re.compile(r"\+?\d[\d\s().-]{7,}\d")


def parse_legacy_phone_pool_text(text: str) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    seen_phone_digits: set[str] = set()
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        url_match = URL_RE.search(line)
        if not url_match:
            continue
        url = url_match.group(0).rstrip("，,。.;；")
        phone = extract_phone_from_legacy_line(line[: url_match.start()] + " " + line[url_match.end() :])
        if not phone:
            continue
        digits = phone_digits(phone)
        if digits in seen_phone_digits:
            continue
        seen_phone_digits.add(digits)
        entries.append({"phone": phone, "url": url})
    return entries


def extract_phone_from_legacy_line(line_without_url: str) -> str:
    for part in re.split(r"[|\t,，\s]+", line_without_url):
        candidate = normalize_phone(part)
        if candidate:
            return candidate
    return ""


def normalize_phone(value: str) -> str:
    match = PHONE_RE.search(value.strip())
    if not match:
        return ""
    raw = match.group(0)
    digits = phone_digits(raw)
    if len(digits) < 10 or len(digits) > 15:
        return ""
    return ("+" if raw.strip().startswith("+") else "") + digits


def phone_digits(value: str) -> str:
    return re.sub(r"\D", "", value)


def build_phone_pool_document(entries: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "version": 1,
        "phones": [
            {
                "phone": entry["phone"],
                "url": entry["url"],
                "exhausted": False,
                "gptAccounts": [],
            }
            for entry in entries
        ],
    }


def parse_legacy_phone_pool_files(paths: list[Path]) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    seen_phone_digits: set[str] = set()
    for path in paths:
        for entry in parse_legacy_phone_pool_text(path.read_text(encoding="utf-8", errors="replace")):
            digits = phone_digits(entry["phone"])
            if digits in seen_phone_digits:
                continue
            seen_phone_digits.add(digits)
            entries.append(entry)
    return entries


def write_phone_pool_yaml(entries: list[dict[str, str]], output_path: Path) -> None:
    document = build_phone_pool_document(entries)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = output_path.with_name(f"{output_path.name}.tmp")
    tmp_path.write_text(yaml.safe_dump(document, allow_unicode=True, sort_keys=False), encoding="utf-8")
    tmp_path.replace(output_path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Migrate legacy phone pool TXT files to the YAML phone pool format.")
    parser.add_argument("inputs", nargs="+", type=Path, help="Legacy TXT files to read.")
    parser.add_argument("-o", "--output", required=True, type=Path, help="YAML file to write.")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing YAML file.")
    args = parser.parse_args(argv)

    missing = [str(path) for path in args.inputs if not path.is_file()]
    if missing:
        print(f"missing input files: {', '.join(missing)}", file=sys.stderr)
        return 2
    if args.output.exists() and not args.force:
        print(f"output exists, pass --force to overwrite: {args.output}", file=sys.stderr)
        return 2

    entries = parse_legacy_phone_pool_files(args.inputs)
    write_phone_pool_yaml(entries, args.output)
    print(f"wrote {len(entries)} phone pool entries to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
