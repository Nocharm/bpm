# syntax=docker/dockerfile:1
FROM python:3.11-slim

WORKDIR /app

# 프로덕션 의존성만 설치 (requirements-dev.txt 제외).
# 사내망에서 GHCR(uv 이미지)이 차단되므로 python 내장 pip 사용 — 외부 Docker 레지스트리 의존 제거.
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

COPY app/ app/

# 비루트 사용자로 실행
RUN useradd --create-home appuser
USER appuser

# fallback — 실제 값은 docker-compose의 .env가 소스 오브 트루스
ENV DATABASE_URL="" \
    AUTH_ENABLED="false" \
    KEYCLOAK_ISSUER=""

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
