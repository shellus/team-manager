FROM python:3.13-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple \
    TEAMMGR_CURL_CFFI_PORT=8080

RUN pip install --no-cache-dir "curl-cffi>=0.15.0" "pyyaml>=6.0"

COPY worker.py turnstile.py ./

EXPOSE 8080

CMD ["python", "worker.py"]
