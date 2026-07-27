# 지식기반(KB) 임베딩 설정 · 백필

AI 컨설턴트 P2 지식기반 — bge-m3 임베딩 서버 연결과 기존 게시본 1회 백필 절차. (설계: `docs/design/2026-07-23-ai-consultant-interview-design.md` §7)

## 1. 환경 변수 (`.env`)

변수명은 사내 다른 임베딩 사용 서비스와 동일 — 그쪽 `.env` 값을 그대로 복사하면 된다. 인증 없음.

```
EMBED_URL=http://<임베딩서버>/v1     # /v1 루트·/embeddings 전체 경로 모두 허용
EMBED_MODEL=bge-m3
EMBED_DIM=1024
# EMBED_TIMEOUT_SECONDS=30 (기본값)
```

- **`EMBED_URL`이 비어 있으면 KB 기능 전체가 no-op** — 라이브러리 탭·검색 주입·유사 SP 제안 모두 비활성, 인터뷰는 P1 그대로 동작.
- `AI_ENABLED=true`도 함께 필요(KB 활성 = AI 활성 AND EMBED_URL).
- 서버 compose는 `docker-compose.yml` backend `environment:`에 매핑돼 있어 `.env`만 수정하면 된다.

사전 연결 확인:

```bash
curl -s http://<임베딩서버>/v1/embeddings -H "Content-Type: application/json" \
  -d '{"model":"bge-m3","input":["테스트"]}' | head -c 200   # data[0].embedding 배열이 보이면 OK
```

## 2. 인덱싱 소스 (자동)

| 소스 | 시점 | 비고 |
|------|------|------|
| 라이브러리 문서 | sysadmin이 설정 → Knowledge base 탭에서 업로드 시 | pdf/docx/xlsx/txt/md · 20MB |
| 게시 맵 | 버전 publish 시(fire-and-forget) | 재게시 시 맵 단위 교체 |
| 인터뷰 첨부 | 업로드 파싱 성공 시 | 해당 세션 검색에만 사용 |

임베딩 서버 다운 시 인터뷰는 참조 없이 계속 진행되고 세션당 1회 안내 노티스가 붙는다(그레이스풀).

## 3. 기존 게시본 백필 (1회)

publish 훅 도입 이전의 게시본은 수동 백필한다 — 서버 backend 컨테이너에서:

```bash
# === bash (서버 docker) ===
docker compose exec backend python -m scripts.backfill_kb_maps
```

```powershell
# === PowerShell (로컬 네이티브, backend\ 에서) ===
.venv\Scripts\python -m scripts.backfill_kb_maps
```

published 상태 버전만 인덱싱하며 재실행해도 안전(맵 단위 교체·멱등).
