# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**BPM (Business Process Management) — 프로세스맵을 그리는 웹 서비스.** 현업이 노드/엣지로 계층형 프로세스 흐름을 시각적으로 작성·편집하고, As-Is/To-Be를 버전으로 관리·비교하는 도구. **기능 명세: `docs/spec.md`** (데이터 모델, UX, 구현 순서).

> 상태(메인 기준): ⑤ Keycloak 인증 · ⑥ docker-compose 배포(9900) · ⑦ **하위프로세스 참조 모델(Call Activity)** — 인라인 계층 편집(`parent_node_id`) 폐기, 평면 노드 + 다른 맵 링크(읽기전용 임베드) · ⑧ **권한 관리(RBAC) 백엔드**(맵 가시성·협업자·승인자·버전 워크플로·유저그룹) · ⑨ **플로우 규칙(F1 디시전 드롭·F14 흐름 하이라이트)·Settings v2(가시성 스테이징·승인자 카드)·맵 소프트삭제+휴지통·타임스탬프 KST(`backend/app/clock.py`)·로그인 기록(`login_records`)·역할/상태 i18n 영어 고정** · ⑩ **거버넌스 UX(권한/가시성 승인 라이프사이클·결재 대기 통합·게시 동봉·협업자 스택 저장)·승인 단계 코멘트(`VersionEvent.note`)·HR 웹훅 디렉터리(AD→n8n, `backend/app/hr/`)·조직 기준 departments(EDW 직책 부서장)·업무체계 Framework(시범)** 머지 완료. 진행 현황은 `PROGRESS.md`, 구현 순서는 `docs/spec.md` §6.
> ⑪ **L5 퍼블리시 거버넌스(confirmed 계약·게이트 6종·레벨 위임) · 슬롯 거버넌스(`fw_slot` 승인·캔버스 자동 재지정·임포트 플레이스홀더, `docs/qa/2026-09-fw-slot-governance-qa.md`) · 라이브러리 필터(부서 트리 플라이아웃·역할 필·미등록 스위치)**. ⑫ **홈 업무 체계 뷰 = L5 포커스 드릴다운**(`components/maps/framework-drill.tsx`, 브레드크럼 + 형제(1):하위(2) 두 열, 소속 맵은 우측 요약, `/categories/nodes`에 `l5_count`·`canvas_state`·`admin`·`slot_pending_count`) + **탐색 모달**(`framework-explorer-modal.tsx`, 계단식 트리 ↔ ERD식 다이어그램 `lib/framework-diagram.ts`, 우클릭 메뉴). ⑬ **AI 컨설턴트 L5 캠페인 1·2라운드**(`backend/app/framework_interview/`·`routers/framework_interviews.py`·FE `/framework/consult/[sessionId]`, 관리 패널 타일 진입·계획 단계 행·AI 설문·연결 캔버스+채팅 게이트·등록=0.5 임포트, 가짜 AI `frontend/scripts/fake-ai-server.mjs`) · 부서 뷰 L5 연계 캔버스 6종(관리 부서 `admin_department`) · 비교 AI 요약 결재자 보고서+제출 코멘트 초안 — **2026-09-24 main 머지 완료**.
> ⑭ **2026-09-30 main**: 캠페인 폴리시(계획 단계=카드의 명시적 `stage`+선행 불변식, 외부 L6/L5 참조 타일 `mode="external"`, 삭제 예정 복구, L6 활동별 IO 규칙) · 엣지 라벨 알약 강조(`--xy-edge-stroke-selected`) · **Word 맵 모드·Word 내보내기 제거**(폐기 컬럼은 모델에 유지, 아래 Lessons 체크리스트) · 매뉴얼 5·6차(슬라이드 도구 저장소 상주).
> ⑮ **2026-10-01 main**: 엣지 팬아웃(같은 핸들 수렴 엣지의 나선 펼침, `lib/edge-fanout.ts`) · **하위프로세스 출구 다중 연결 + 들어오는 문 네 방향**(끝별 출구 엣지·출구 선택 목록 `EdgeEndModal`·라벨 미러링·스왑 출력 자리 바꾸기 모달·펼침 게이트웨이 끝별, 아래 Lessons 핸들 계약).
> ⑯ **2026-10-06 main**: **출력 규칙**(출구당 연결 1개·노드 속성 병렬 출구 `parallel_outputs`·start 기본 병렬, 아래 Lessons 출력 규칙) · 흐름 펄스(`lib/edge-pulse.ts`) · IO 계약 최신화(내보내기 열 선택·잠금 열·재전달 승계) · 프런트 node:22·`# syntax` 지시어 제거 · ko 용어 통일(게시본·오너·Draft·승인자·거절·Check out·입력물/산출물·주관 부서·연결선)과 짧은 흐름 필 영어 고정. 2차: 위·아래 변 연결선 최소 높이 40px(`lib/edge-stub.ts`)·흐름 펄스 개정(분기 차례 반짝임만·병렬 공통 구간 후 길이별 속도).
> ⑰ **2026-10-06 main(3차)**: **엣지·정렬 개선 라운드** — 자동정렬 큰길=최장 경로+예 라벨(TS·Python 동시)·라벨 간격·갈래 순서 고정·부분 정렬 겹침 해소·영역 묶음·L5 핸들 보존, 엣지 경로 단일 해석기(`lib/edge-path.ts`, 우회는 마주 보는 핸들만)·엣지 생성기 `buildAppEdge`·연결 판정 공유(`lib/edge-rewire.ts`)·끝점 재연결·연결 변 다시 고르기, 비교 삭제 노드 배치(`lib/compare-layout.ts`)·화면 맞춤 1회, SVG 프리뷰 기하(`lib/preview-geometry.ts`)·줌 공유·인터뷰 캔버스 에디터 엣지 (아래 Lessons 엣지 경로·레이아웃 이중 구현).
> DB: 로컬 네이티브는 sqlite 파일(무설정), 서버 compose는 postgres. 스키마는 startup `create_all`(마이그레이션 후속). **로컬 데모 시드: `backend/scripts/reset_db.py`**(`python -m scripts.reset_db` — `drop_all` 포함, 운영 실행 금지). **자동 백업·복구: `docs/deploy/backup.md`**(compose `db-backup` 사이드카, 일간 04:00 KST·14일 보존). **db-viewer 읽기전용 조회: `docs/deploy/db-viewer-readonly.md`** — compose의 db가 external `dbv-shared`에 합류하므로 서버에 그 네트워크가 없으면 `docker compose up`이 실패한다(`setup-once.md` A9).
> ⚠️ **캔버스/에디터 작업 전 `docs/lessons/`(시행착오 방지)를 먼저 읽을 것** — 아래 "Lessons" 섹션. (단, 인라인 계층 *편집*은 ⑦에서 제거됨 → 읽기전용 임베드. lessons는 React Flow/좌표/검증 함정 위주로 유효.)

## Commands

실행 명령은 **bash(macOS/Linux)와 PowerShell(Windows)을 병기**한다 — 로컬 검증이 Windows PC에서 이뤄지기 때문 (`rules/common/documentation.md`).

```bash
# === bash (macOS/Linux) ===
# backend (backend/ 에서, 로컬 네이티브)
# 의존성 설치 — uv (빠름) 또는 pip 중 환경에 맞게. 사내 로컬은 uv 불가 → pip 사용.
uv venv .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt
# pip 대안: python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload --port 8000   # 개발 서버
.venv/bin/python -m pytest tests/ -q                  # 테스트
# ⚠️ backend/.env(AI_ENABLED 등)가 있으면 "기본 비활성" 가정 테스트가 깨짐 — 전체 그린 확인은:
# AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q
.venv/bin/ruff check app/ tests/                      # 린트

# frontend (frontend/ 에서, 로컬 네이티브)
npm install
npm run dev    # 개발 서버 :3000 — /api는 BACKEND_URL(기본 localhost:8000)로 프록시
npm run build  # 프로덕션 빌드 (standalone) — next dev를 먼저 내려야 한다
npm run lint
npx tsc --noEmit -p tsconfig.json                  # 타입 게이트
npx vitest run                                     # 단위 테스트(~1,000) — 커밋 전 필수
node scripts/build-component-catalog.mjs --check   # COMPONENTS.md 최신 검사
# 브라우저 검증: frontend/에서 BASE_URL=http://localhost:3000 node scripts/pw-<name>.mjs
# 스모크·매뉴얼 캡처 산출물은 저장소 루트 `.shots/`(gitignore, 스크립트 기준 `../.shots`) — docs/qa에 PNG를 커밋하지 않는다.
# 캡처 언어는 PW_LANG=ko|en(캠페인 스모크·pw-manual-shots*.mjs). 매뉴얼 슬라이드 재생성:
#   캡처 → content/*.py 카피·shot 갱신 → python3 docs/manual/slides/build_deck.py(shot:True는 직전 덱의 같은 제목 슬라이드 이미지 이월, 없으면 순번 — 이월 슬라이드 제목을 바꾸면 파일 경로 지정) → node scripts/check-deck-overflow.mjs → export-pdf.mjs
# AI 검증: 가짜 AI(frontend/scripts/fake-ai-server.mjs)는 고정 응답 — 배선 확인용. 프롬프트 품질은 실모델로:
#   운영은 SGLang이라 ai_client가 chat_template_kwargs를 보낸다 → OpenAI 키로 직접 붙으면 400. 그 필드를 떼는 로컬 프록시를 거쳐
#   AI_BASE_URL=http://localhost:<프록시>/v1 로 backend를 띄운다(작은 모델은 id만 준 힌트로 노드를 오인 — 힌트엔 제목 병기).
# dev 인증 = localStorage `bpm.devUser` / 헤더 `X-Dev-User`. 역할 차등을 보려면 backend를
# DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys 로 기동 (시드의 sysadmin은 admin.sys)
```

```powershell
# === PowerShell (Windows) ===
# backend (backend\ 에서, 로컬 네이티브) — 사내 로컬은 uv 불가 → pip 사용
python -m venv .venv
.venv\Scripts\pip install -r requirements-dev.txt
.venv\Scripts\uvicorn app.main:app --reload --port 8000   # 개발 서버
.venv\Scripts\python -m pytest tests/ -q                  # 테스트
# .env 존재 시 전체 그린 확인: $env:AI_ENABLED="false"; $env:DEV_ENFORCE_PERMISSIONS="false"; $env:BPM_SYSADMINS=""; .venv\Scripts\python -m pytest tests/ -q
.venv\Scripts\ruff check app/ tests/                      # 린트

# frontend (frontend\ 에서) — npm 명령은 동일
npm install
npm run dev
npm run build
npm run lint
npx tsc --noEmit -p tsconfig.json
npx vitest run
node scripts\build-component-catalog.mjs --check
# 브라우저 검증: $env:BASE_URL="http://localhost:3000"; node scripts\pw-<name>.mjs
```

```bash
# 서버 배포 (리눅스 서버, 저장소 루트, .env 필요 — .env.example 참고)
docker compose up -d --build   # 접속: http://<서버>:9900
```

## Architecture

모노레포. 4개 컨테이너를 docker-compose로 묶어 nginx 리버스 프록시 뒤에 둔다.

| 레이어 | 스택 | 역할 |
|--------|------|------|
| **frontend** | Next.js (TypeScript, React) + @xyflow/react | 프로세스맵 에디터 UI — 캔버스/노드/엣지 편집, 계층 오버레이, 버전 비교 |
| **backend** | Python — FastAPI + SQLAlchemy + Pydantic | 맵/버전/노드/엣지 CRUD·검증·영속화 API, Keycloak JWT 검증 |
| **db** | PostgreSQL | 맵·버전·노드·엣지 영속 저장 |
| **proxy** | nginx | 앱 내부 리버스 프록시 — `/` → frontend, `/api` → backend 라우팅. **서버 노출 포트 9900** |

**경계:** 브라우저 → `:9900`(앱 nginx) → (Next.js | FastAPI) → PostgreSQL. frontend↔backend 통신은 nginx 경유 HTTP. 입력 검증은 backend API 경계에서 수행 (`rules/common/security.md`).

**nginx 토폴로지 (확정):** 서버 엣지 nginx(443/80)는 직접 편집 가능한 별도 자산. 앱 compose nginx는 **9900**에 노출하고 우선 포트로 직접 접속, 추후 엣지 nginx에 도메인(g-ai-agent.sbiologics.com) 라우팅 추가.

**인증 (확정):** 같은 서버의 기존 Keycloak(realm `ai-portal`) OIDC 사용. 주소는 하드코딩 금지 — `.env` 경유 (`docs/spec.md` §4).

**디렉터리 구조:**
```
frontend/   # Next.js 앱 (에디터: src/app/maps/[mapId]/page.tsx — ~12,500줄 단일 컴포넌트) · scripts/pw-*.mjs = Playwright 검증 스크립트
backend/    # Python API 서버 + requirements.txt / requirements-dev.txt
nginx/      # 리버스 프록시 설정
docs/       # 인덱스 docs/README.md · spec.md · lessons/(시행착오 방지) · deploy/·qa/·design/(설계 기록)·manual/
docker-compose.yml
```

언어 규칙은 backend → `rules/languages/python.md`, frontend → `rules/languages/typescript.md` 적용. 컨테이너/설정 규칙은 `rules/backend/` 참고.

## Lessons — 시행착오 방지

캔버스 에디터(React Flow)에서 실측으로 얻은 교훈. **`frontend/src/app/maps/[mapId]/page.tsx`를 건드리기 전에 해당 카테고리를 먼저 읽을 것** (인덱스: `docs/lessons/README.md`). 인라인 계층 *편집*은 하위프로세스 참조 모델(⑦)에서 제거됨 — 임베드 자식은 읽기전용이라 아래 자식-편집/스코프-저장 항목은 주로 **역사적 기록**이나, React Flow 렌더/좌표/검증 함정은 읽기전용 임베드에도 유효.

- [`docs/lessons/canvas-react-flow.md`](docs/lessons/canvas-react-flow.md) — 자식 노드는 메인 `nodes`에 합치지 말고 별도 `childNodes` state, prop-only 자식의 visibility/이벤트 함정, `getNode`/`getIntersectingNodes` 자식 한계, 펼침 중 인터랙션 게이팅.
- [`docs/lessons/scope-save-and-coordinates.md`](docs/lessons/scope-save-and-coordinates.md) — 자식 스코프 저장 `getGraph→변형→PUT`(그룹 보존), fullGraph 낙관적 갱신, 스코프상대↔표시 좌표(`childOffsets`/`scopeOffsets`), buildScope는 dagre 대신 저장 pos.
- [`docs/lessons/browser-verification.md`](docs/lessons/browser-verification.md) — Playwright+시스템 Chrome 검증, **dev.db 오염/readonly 함정**("0 events"는 코드 아닌 오염일 수 있음), 연결 드롭 flaky, node cwd.
- [`docs/lessons/react-ts-patterns.md`](docs/lessons/react-ts-patterns.md) — useCallback deps TDZ → ref 미러, set-state-in-effect 린트(rAF/then/ResizeObserver 콜백으로), 큰 상태 모델은 메인 state 오염 금지, Tailwind display 클래스 이중 지정 금지(`inline-flex`+`hidden`).
- [`docs/lessons/settings-and-forms.md`](docs/lessons/settings-and-forms.md) — 설정/관리자 화면·폼/모달/피커(비캔버스) 교훈.
- **노드 속성 추가 체크리스트** — 열거 지점 전부 갱신: `models.py` 컬럼 · `schemas.NodeIn`(+검증기) · `graph.py` upsert · `versions.py` clone_graph · `csv-import.ts`(NODE_DEFAULTS·mergeNode pick·행 변환) · AI 변환 2곳(`buildGraphFromAiProposal`, page.tsx `aiNodeToGraphNode`) · FE 매핑 page.tsx `buildGraph`/`toAppNodes` · `node-clipboard.ts` 복사 보존 규칙 · 재전달 승계 `backend/scripts/import_consultant.py` `INHERITED_NODE_FIELDS`(전달물이 싣지 않는 필드면 추가, draft 재사용 판정은 `NodeIn` 기준이라 자동) · **콘텐츠 서명 4벌**: 비교/확정 3곳(`change-summary-section.tsx` `buildLiveGraph` · `compare/page.tsx` `buildAppNodes`+인스펙터 행 목록(+`diff.ts` FIELD_KEYS·라벨 i18n, `merge-diff.ts`는 따라감) · `backend/app/framework_confirm.py` `_canvas_content_signature`, 2026-09-11 필드 누락 3건 실사고) + 임포트 변경 감지 `backend/scripts/import_consultant.py` `_graph_signature`·`fields_changed`. 임포트 서명은 **전달 필드만** 담아(`system_fallback`·`output_forms`·`parallel_outputs`와 파라미터 중 전달되는 `annual_count`·`fte` 포함, 검토값 `gmp`·`input_forms`와 전달물이 싣지 않는 `assignee_role`·`url`·`url_label`·회당 파라미터 5종(`duration`·`touch_time`·`cost_krw`·`cost_usd`·`headcount`)·맵 측 `sp_*` 제외) 포함 집합이 앞의 셋과 다르다 — 의도(검토 완료 맵의 무변경 재전달이 새 버전으로 뒤집히지 않게, design 2026-08-19 §4.1). `url`·`url_label`은 비교 셋(FIELD_KEYS·인스펙터·확정 서명·AI 비교 페이로드)에 들어간다(2026-10-02). FE `diff.ts` FIELD_KEYS는 링크 정체성(`linked_map_id`·`placeholder_category_id`·`is_primary_end`·`follow_latest`)도 담아 BE 확정 서명과 같은 집합이다. 엣지 정체성도 비교·변경 요약·확정이 하나를 공유한다: (출발 계보, 도착 계보, 라벨, 출구 키 FE `getOutputKey` ↔ BE `get_output_key`)이고 변 id·입구 변형·`target_handle`은 레이아웃이라 키에 넣지 않는다. 2026-10-01 `parallel_outputs`는 4벌에 기억으로 맞췄고 이 목록에 없던 템플릿·AI CSV 프롬프트·Excel·슬라이드 4곳이 빠졌다(아래 내보내기 항목이 그 열거). 값 정규화는 CSV·AI 경로 대칭 필수 — 한쪽만 하면 무효 에코가 pick을 통과해 백엔드 소거로 기존값이 유실된다. 회당 파라미터는 7필드(`duration`·`touch_time`·`cost_krw`·`cost_usd`·`headcount`·`annual_count`·`fte`, 단일 소스 `frontend/src/lib/params.ts` `PARAM_FIELDS`) — 구 `etf`/`cost`/`extra`(SP는 `sp_etf`/`sp_cost`/`sp_extra`)는 폐기. **신규 컬럼은 `db.py` `_ADDED_COLUMNS`에 수동 등록 필수**(서버는 배포 시 자동 ALTER로 보강 — 리셋 불가, 운영 데이터 있음: `docs/deploy/deploy.md` §3). 관리 목록 자동완성 필드(역할·시스템)는 app_settings 키 + GET /catalogs + lib/catalogs.ts useCatalogs + SuggestInput 한 벌 — 새 목록은 이 4곳에 얹고 설정 Catalogs 탭 카드 하나를 추가한다(design 2026-09-11). 항목은 `{value, aliases}` 엔트리(별칭→정식 표기 치환, `normalize_managed_entries`/`normalizeAliases` 불변식)(design 2026-09-12). **카탈로그 커밋 규칙은 이중 구현** — FE `commitRole`/`commitSystem`(`lib/catalogs.ts`) ↔ BE `commit_role`/`commit_system`(`app_settings.py`); CSV·AI 변환단(`buildGraphFromCsv`·`buildGraphFromAiProposal`·`aiNodeToGraphNode`·set_attr)은 순수 함수라 카탈로그를 `CsvImportContext.catalogs`/인자로 받고, 컨설턴트 임포트는 `_normalize_systems`가 서명 계산 전에 돌린다. **AI 표면엔 담당자 실명(`assignee`)이 없다** — 사람 필드는 `assignee_role`만(사용자 결정 2026-09-12). 쓰기뿐 아니라 **읽기도 막는다**(2026-10-02): 에디터 AI 그래프 직렬화(`ai_prompt.py` `_serialize_node`)·AI 비교 페이로드는 실명을 싣지 않고, 외부 AI용 CSV 프롬프트(`buildAiPromptText`)는 Assignee를 비우고 Role을 쓰라고 안내한다. 에디터 AI 챗이 실어 보낸 subprocess `linked_map_id`는 서버 보정 없이 그대로 받는다(의도, 사용자 결정 2026-10-02: 직렬화가 실존 링크를 보여 주므로 에코가 정상 경로이고, 기존 노드는 `mergeNode`가 기존 링크를 우선한다. 이전 작업본 링크만 살리는 `_sanitize_subprocess`는 인터뷰 경로 전용).
- **노드 속성 추가 체크리스트 — 내보내기·AI·문서 표면** — 위 열거와 같은 커밋에서: 열 정의 단일 소스 `frontend/src/lib/export-columns.ts`(`CSV_COLUMNS` 25열·`EXCEL_COLUMNS`, `csv-import.ts` HEADER_COLUMNS·`csv-export.ts` 헤더·`buildTemplateCsv`가 파생) · `csv-export.ts` 셀 변환 · `buildAiPromptText` 열 규칙 문구 · Excel `excel-export.ts` 행 모델·셀 + `excel-wbs.ts` 꼬리(넣을지 뺄지를 명시적으로 결정) · `compare-summary-payload.ts` 값 표기 · AI 계약 `api.ts` `AiNodeAttributes` ↔ `schemas.AiNodeAttributes` + `ai_prompt.py`(예시 JSON·set_attr 안내·`_serialize_node` 메타) · AI 프롬프트 키를 늘리면 `backend/app/prompt_registry.py` `PROMPT_KEYS` ↔ `frontend/src/lib/ai-prompt-keys.ts`+i18n en/ko 라벨을 같이(`ai-prompt-keys.test.ts`가 집합·순서·라벨을 가드) · 인터뷰 JSON 착지는 아래 "0.5 계약" 항목 · 매뉴얼 열 문장(`backend/app/manual.md` 가져오기·내보내기 줄, `docs/manual/user-manual-editing-ko/en.md` 8·9장, 슬라이드 `docs/manual/slides/content/user_ko/en.py`). 내보내기는 직전 **열 선택 체크박스**(기본 전부, 해제한 키는 브라우저 localStorage `bpm.exportColumns.csv|excel`, 잠금 CSV Name·Parallel·Next, Excel No·Name·Type·Parallel·Next)를 거치고, 해제한 열은 파일에 없어 재가져오기 때 기존값이 유지된다. Excel 잠금 5열은 맵을 다시 그릴 최소 정보다(사용자 결정 2026-10-02: 노드 모양=Type, 연결·방향·분기 라벨·SP 출구 끝 이름=Next, 분기 주석 `[No:라벨]`=Name, 병렬=Parallel). Excel Parallel 셀은 켠 키 ∪ 실제 2갈래 이상 병렬 출구(`getOutputGroups`: 시작 기본 병렬·레거시 gateway)라 접힌 무라벨 분기(여러 Next)와 구분된다. Next 칸은 대상을 줄 번호로 가리킨다(사용자 결정 2026-10-02: `3. 검토 [예]; 5. 반려`, 라벨은 대괄호, `formatExcelNextCell`·`dedupeExcelNextRefs`를 1안·WBS가 공유): 같은 제목 노드가 합쳐지던 문제와 제목의 `:`·`;` 충돌을 막는다. 대상 행은 같은 맵 인스턴스(`rowByNodeId`)에서 풀고 번호 부여 뒤 조립하며, 행이 없는 대상(기본 End·WBS 시작/끝/펼친 SP·상한 밖)은 번호 없이 제목만. 남은 한계(사용자 결정: 유지): WBS는 시작·끝·펼친 SP 행이 없어 그 연결이 시트에 없다. CSV는 임포트의 전 단계라 다시 가져오기에 필요한 열을 잠근다(사용자 결정 2026-10-02, 25열 전수 프로브로 확정): Name(헤더 필수·식별), Next(빠지면 연결·분기 라벨·SP 출구가 전부 `lostEdges`), Parallel(빠지면 새 맵 만들기에서 병렬 노드가 경고 없이 decision으로 추론). 줄 정렬 열은 `pairedWith`로 값 열을 따라간다(Input→Input_Flags·Input_Forms, Output→Output_Forms: 값 열만 담아 줄을 고치면 `mergeAlignedLines`가 빠진 플래그·폼을 통째로 비운다). 판정은 `isExportColumnForced` 하나를 피커 비활성·`normalizeExportColumns`(내보내기 함수 포함)가 공유. 새 CSV 열이 임포트 구조(타입 추론·엣지)에 쓰이면 `required`, 다른 열과 줄 정렬되면 `pairedWith`를 단다. 모든 열은 피커 묶음 `group`(`EXPORT_COLUMN_GROUPS`: 흐름·일반·속성·수행 지표·입출력·조건, 묶음 머리 체크박스가 `toggleExportColumnGroup`으로 일괄 선택/해제)을 갖고, 아이콘은 `export-column-picker.tsx` `COLUMN_ICON`(CSV∪Excel 키 누락은 타입 오류). CSV 표면 제외(결정 2026-08-24, 구 패리티 설계에서 흡수): `system_fallback`은 자체 열이 없고 System=Other면 원문 메모가 System 셀에 실려 왕복한다. IO 링크 3종(`output_ids`·`input_links`·`output_links`)은 itemId 기반이라 제외(병합의 보존/해산 규칙이 담당). CSV `GMP`는 값만 저장하고 에디터의 GMP→노드색 자동 확정은 적용하지 않으며, SP 행의 GMP·폼 셀은 링크 맵 상속이라 드롭+경고. **재전달 승계(2026-10-02)**: 컨설턴트 재전달 재빌드는 전달물이 싣지 않는 노드 필드(역할·링크·회당 파라미터 5종 `duration`·`touch_time`·`cost_krw`·`cost_usd`·`headcount`, 링크 아닌 노드의 `annual_count`·`fte`(링크 노드는 승계 대상 아님: L6 맵 연계 노드는 전달 params, L5 캔버스 L6 노드는 전달분이 빈 칸만 채우고 기존 값은 유지+경고), 조건·입력 플래그·폭·그룹·링크 노드 추종 설정·사용자가 건 IO 링크 등)를 직전 게시본의 같은 계보 노드에서 승계한다(`gmp`·폼과 같은 규칙, 줄 정렬 필드는 IO 텍스트 불변일 때만, 목록은 `import_consultant.py` `INHERITED_NODE_FIELDS` 한 곳). 전달물이 싣는 필드는 전달분이 진실이다. 새 노드 필드는 전달 여부를 정해 이 승계 상수나 `_graph_signature`(전달 필드)에 반영한다.
- **폐기 컬럼은 모델에서 지우지 않는다** — Word 제거(2026-09-30)로 죽은 `process_maps.doc_name/doc_sections/doc_imported_at/doc_generated_at`·`nodes.section_anchor`·`interview_sessions.mode`는 create_all DB에서 NOT NULL·기본값 없음이라 매핑을 빼는 순간 INSERT가 500. 마이그레이션 도구가 없고 운영 리셋 불가이므로 매핑만 유지하고 어디서도 읽지 않는다. 드랍은 별도 마이그레이션 시점에.
- **레이아웃 이중 구현** — 임포트 배치(`backend/scripts/consultant_layout.py`)는 에디터 자동정렬(`frontend/src/lib/flow-layout.ts` `autoLayoutFlow`, LR)의 파이썬 동치본이다(dagre 대신 rank+배리센터). `duration.ts`↔`duration.py`와 같은 계약 — 한쪽을 고치면 다른 쪽과 테스트를 같이 옮긴다. 좌표·엣지 변은 `_graph_signature` 밖이라 **무변경 재임포트는 배치를 갱신하지 않는다**. 양쪽이 맞춰야 하는 규칙(2026-10-06, 그래프 규칙 단일 소스 `frontend/src/lib/layout-graph.ts`): 큰길(척추)=역행 엣지를 뺀 정방향 그래프에서 시작→대표 끝 **최장 경로**, 길이가 같으면 예 라벨(yes·y·예·네·승인·approve·approved·ok)을 더 지나는 쪽(사용자 결정. 최단 경로는 반려 지름길이 큰길을 차지했다) · 역행 엣지 분리 DFS는 정렬 키 순서 · 형제 정렬 키(예 라벨 → 기본 출구 → 라벨 → 도착 id, 예가 위) · 라벨 있는 엣지는 라벨 상자만큼 랭크 간격(TS dagre 라벨 더미 ↔ Python `_gap_steps`) · 곁가지 사슬(1입력·1출력) 직선화 · 척추 노드를 건너뛰는 지름길은 아래(LR)/오른쪽(TB) 변(같은 판정을 미리보기 `flow-side-handles.ts`도 쓴다) · 랭크 열 가운데 정렬. 에디터 쪽만의 것: 영역(그룹)은 dagre compound로 묶고, L5 캔버스는 핸들을 유지하며(`preserveHandles`, 임포트 분기 출구 보존), 부분 정렬은 `autoLayoutSubsetFlow`(겹친 비선택 노드를 밀고 선택 안 엣지 핸들만 재지정), 전체 정렬 뒤 화면 맞춤. 인스펙터 "자동 정렬"은 핸들 다수결 방향(`inferFlowDir`)으로 같은 `applyAutoLayout`을 탄다.
- **숫자 파라미터(duration H.MM) 계약** — duration 소수부는 분(0.30=30분, ≥60 이월). 정규화는 FE `lib/duration.ts` ↔ BE `app/duration.py` 동치 이중 구현(수정 시 양쪽+테스트 동기화). 무효값은 경계에서 `""` 소거(422 아님 — from_attributes 응답 겸용) → **시드/픽스처의 자유텍스트 duration은 조용히 증발**. 표시는 편집 중만 `1.30`, 그 외 `formatDurationHm`(`1h30m`) — CSV(왕복)/Excel(숫자 셀) 예외. raw dict 직렬화 엔드포인트(library.py류)는 응답 validator를 우회 — 경계 규칙 추가 시 별도 스윕. 비용은 `cost_krw`/`cost_usd` 배타 — 동시 입력이면 저장 422(`NodeIn`/`SubprocessDesignationIn` model_validator). subprocess 노드는 `annual_count`·`fte`만 직접 편집 — 나머지 5필드는 링크 맵 SP 지정값 읽기전용 상속이며, UI(`getEditableParamFields`)·CSV(`dropUneditableParams`)·AI 변환(`resolveAiParamPatch`) 3표면 모두 강제(프롬프트 문구만으론 안 막힘).
- **인터뷰 JSON 0.5 계약 3표면** — 어댑터 `backend/scripts/consultant_interview.py`(단일 진실) ↔ AI 캠페인 조립기 `backend/app/framework_interview/assemble.py`+프롬프트 `contracts.py` ↔ 외부 AI 프롬프트 `frontend/src/lib/interview-json-prompt.ts`+`docs/samples/interview-json-0.5.md`. 키 집합이 바뀌면 셋을 같이 옮기고 `test_framework_interview_assemble.py`(조립 문서가 어댑터를 이슈 0으로 통과)·`interview-json-prompt.test.ts`로 확인한다. **역변환 `backend/app/framework_interview/existing.py` `map_to_row`(맵 그래프 → rows[] 1건, 기존 L6 학습·정정)가 네 번째 표면** — 어댑터의 `format_node_description`·엣지 착지 규칙을 되돌리므로 어댑터를 고치면 같이 옮기고 `test_framework_interview_existing.py` 라운드트립으로 확인한다. action의 input/output은 문자열 배열이다(2026-09-23, 어댑터 `_join_multi`가 개행으로 합친다). 임포트 L6 끝 노드는 빈 제목으로 만들고(표시는 End) 재전달은 사람이 붙인 끝 제목을 승계한다(`INHERITED_NODE_FIELDS` `(title, end)`). 레거시 "End"/"종료"는 `_graph_signature`에서 빈 제목과 동치라 제목만 다른 재임포트는 새 버전을 만들지 않는다. 활동(action) 단위 역할·부서·링크·회당 파라미터·GMP·색 키는 없다(의도: `ownerRole`·`department`는 `rows[]` 행 단위로 맵 SP 지정에 착지하고 L6 노드엔 전파하지 않음, 사용자 결정 2026-09-12). CSV·AI보다 좁은 이 비대칭은 재전달 승계가 메운다(사용자가 노드에 적은 값은 재전달에 유지). 넣기로 하면 어댑터 키·`CanonicalNode`·`map_to_row`·프롬프트 3표면을 함께 옮긴다.
- **오버레이 z 사다리** — 1000/1001 페이지 내 드롭다운(레거시, 백드롭+메뉴 — 모달 아래라 모달 안에서는 포털 1350을 쓴다) · 1100 캔버스 플로팅 크롬(독·링크 미리보기·엣지 라벨 편집, RF 노드 1000/1001 위) · 1200 모달·컨텍스트 메뉴 · 1250 모달 안 피커 드롭다운 · 1300 확인/프롬프트·토스트·조직 카드 · 1340 포털 백드롭 · 1350 포털 드롭다운(SearchSelect)·플라이아웃 · 1400 툴팁·호버 카드·플라이아웃 위 카드(`OrgInfoModal elevated`). 새 오버레이는 이 사다리에 맞춘다 — 낮게 두면 포털 뒤로 숨는다(2026-09-24 감사: 사다리 밖 단발 값 1201·1240·1320·1355·1360은 인접 단으로 흡수 대상).
- **드롭다운 계약(2026-10-01)** — 포털 메뉴는 트리거와 같은 폭, 간극 0(`GAP=0`), 등장은 `globals.css .dropdown-in`(180ms overshoot). 아래 공간이 없어 위로 뒤집으면 `top` 대신 `bottom` 앵커로 트리거 상단에 밀착(추정 높이 FLYOUT_H보다 실제가 작으면 top 계산은 간극이 생긴다). 짧은 고정 목록은 `MenuSelect`(역할·GMP), 검색이 필요하면 `SearchSelect`. 네이티브 `<select>` 신규 금지. 맵 설정의 인터뷰 승격 필드(GMP·조건·시간·시스템)는 서브프로세스 섹션 타일에서만 편집한다(종전 "조건 · GMP" 카드 삭제, 2026-10-01). 소유권 이전은 `TransferOwnerDialog` 한 게이트(위험 구역 피커·협업자 역할 메뉴 Owner 항목), 후보는 `lib/owner-candidates.ts`(명시 editor+ ∪ 오우닝 부서 소속 파생 editor, BE `transfer_owner`가 파생 대상에 owner 행을 생성).
- **라이브러리 행 `department` = SP 지정 `sp_department`(리프명, 조직 경로 아님)** — 조직 경로 해석은 `frontend/src/lib/library-dept-options.ts`(`DeptPathIndex`) 한 곳; 하위 트리 필터·한글명·조직 카드가 같은 값을 본다. 중복 리프(두 상위 아래 같은 이름)는 후보 전부 매칭.
- **트리 아코디언 모션은 `useSectionMotion`(`frontend/src/lib/use-closing-keys.ts`)+`.accordion-open/-close/-static`** — 행이 도착한 뒤 마운트, 닫힘 고스트 유지, 사용자가 편 노드만 `open`(자동 드릴인은 `static`). 체크박스는 공용 `CheckInput`(네이티브 체크박스 금지).
- **하위프로세스 핸들 계약(2026-10-01)** — 들어오는 문 `in`(좌)·`in:top/right/bottom`(헬퍼 `subprocessInHandle`/`parseSubprocessInHandle`, `sideFromHandleId`가 변으로 읽음. BE `app/subprocess.py` `subprocess_in_handle`이 동치본으로 L6 임포트 `build_graph_rows`가 배치 변을 `in:<변>`으로 싣는다), 출구는 끝 키(`__primary__` 또는 끝 제목, `isSubprocessEndHandle`). **in 핸들은 받기 전용**(`isConnectableStart=false`, 연결 드래그 중에만 노출 — 시작 가능하면 역방향 연결로 끌어간 노드가 입력이 된다). **출구는 우측 한 점**: 끝 핸들을 전부 라벨 라인(18px)에 겹쳐 대표 끝만 보이고 잡히며, 끝 ≥2에서 끌어 놓으면 `handleFlowConnect`가 출구 목록(`EdgeEndModal`)으로 끝을 고른다(세로 분산은 폭 조절 그립과 겹쳐 폐기, 2026-10-01). `withSubprocessHandles`는 **끝 키·in 변형을 보존**하고 변 id·없음일 때만 기본값으로 — 예전처럼 무조건 대표 끝으로 덮으면 보조 끝 엣지가 전부 대표 끝으로 되돌아간다. 끝 한정 동작은 `sourceHandle` 인자 한 벌(`withEdge`·`insertNodeAfter/Before`·`removeOutgoingEdges`·`edgeAction/edgeSelect/pending` state·`applyFlowEdges`). 로드 정규화는 `toAppEdges`(SP 소스 변 id→`__primary__`, SP 타깃 변 id→in 변형 — CSV·AI 엣지가 조용히 안 그려지던 원인). **끝 핸들은 resolved 도착 뒤 늘어나므로 `SubprocessHandles`가 끝 키 집합 변화마다 `updateNodeInternals`를 호출**해야 보조 끝 저장 엣지가 로드 직후 렌더된다(RF handleBounds 스테일, 콘솔 에러 없이 사라짐). 출구 라벨 미러는 렌더 전용(`applyMirroredEndLabels` → `data.labelMirrored`, 점선 알약은 `labelBgStyle.strokeDasharray`를 HTML 라벨이 dashed로 번역) — edges state엔 넣지 않는다. 스왑 `swapNodeEdges(…, pairs)`: 미지정=전면 교환, 지정=입력 교환+직접 엣지 끝점 교환+짝은 타깃만. **CSV·AI·비교의 끝 정체성(2026-10-02)**: 생성 경로(컨설턴트 임포트·AI·CSV)가 새로 만드는 SP 엣지는 출구를 대표 끝(`__primary__`), 입구를 `in`에 붙인다(L6 임포트만 배치 변 `in:<변>`, CSV Next 문법·AI 엣지 계약에 끝 차원이 없고, AI ops 연결/끊기는 (출발, 도착) 쌍 단위). 보조 끝 출구와 끝별 병렬은 캔버스 전용이다. 같은 맵 재가져오기(CSV·AI 머지)는 base 엣지의 `source_side/target_side/source_handle/target_handle/line_style/gateway`를 (출발→도착) 쌍 큐로 이월하고, 소비되지 않은 base 엣지는 프리뷰 `lostEdges`로 보인다(새 맵 만들기는 대표 끝). 내보내기는 SP 다중 출구(보조 끝 엣지)를 경고하고, Excel(읽기 전용)은 SP에서 나가는 무라벨 엣지의 Next에 끝 제목을 라벨처럼 적는다(렌더 미러와 같은 표기, 데이터 불변). 확정 서명·변경 요약·비교 diff 키·AI 비교 페이로드는 같은 규칙: 변 id(`s-*`/`t-*`)·입구 변형(`in`/`in:*`)은 레이아웃이라 변경으로 세지 않고 **SP 출구 끝 키만 내용**(같은 쌍의 두 끝은 별개 엣지, 끝 키가 바뀌면 changed, FE·BE 동치 헬퍼). **알려진 한계**: 끝 키=끝 제목이라 링크 맵이 끝을 개명·삭제하면 부모 엣지 `source_handle`과 `parallel_outputs`의 끝 키 항목이 함께 고아가 된다(검출은 `handleUpdateSubprocess` 핀 갱신 토스트 `subprocess.endRebindWarn`뿐, follow_latest는 무경고, RF는 dev 빌드에서만 warn 008, `ref_audit.py` 미스캔). 고아 끝 키 엣지는 별도 출구 그룹으로 세어져 게이트 6·저장 체크리스트가 잡지 못한다. 끝 제목이 `in`·`in:<변>`·`s-/t-<변>`·변 이름이면 FE `isSubprocessEndHandle`/`sideFromHandleId`·BE `get_output_key`가 대표 끝으로 오분류한다(`validate_process`는 유니크만 검사). 안정 id(끝 노드 id) 전환은 엣지·`parallel_outputs` 저장값 마이그레이션이 필요한 별도 트랙. Playwright 드롭존 조준 전엔 `centerOn`(DOM transform 직접 수정) 금지 — RF 스토어와 어긋나 링이 안 뜬다. 재진입 + 화면 맞춤 버튼으로 대신한다(`pw-verify-sp-ends.mjs`).
- **출력 규칙(2026-10-01, `frontend/src/lib/output-rules.ts`)** — 일반 맵·L5 캔버스 공통: 출구(일반 노드 `__primary__` 하나, SP는 `endKeyOfEdge` 끝 키)마다 엣지 1개, 병렬 출구(`parallelOutputs` ∪ 엣지 ≥2·전부 `gateway="parallel"` 레거시 도출)는 2개 이상, decision은 규칙 밖. **start도 규칙 밖이고 기본 병렬**(사용자 결정 2026-10-02): 연결 수를 따지지 않고(`getOutputGroups`가 start 출구를 `parallel`로, BE `find_output_rule_violations`는 start·decision을 건너뜀) 팬아웃은 병렬로 펄스하며 우클릭 병렬 토글이 없다(택일 시작은 start 바로 뒤 decision). 사용자에게 보이는 규칙 문구는 "갈래는 판단 노드나 병렬 출구로"/"Splits use a decision or a parallel exit"(`save.checkSingleOutput`·`framework.gate.plain_fanout`), 실패 필은 "판단·병렬 없이 갈라짐"/"Split without a decision or parallel exit"(`framework.gateFail.plain_fanout`)이고, 매뉴얼·슬라이드·`backend/app/manual.md`도 이 표현을 쓴다("출구마다 연결 1개" 표현은 폐기). 삽입 재연결은 일시 초과를 허용하고 저장 체크리스트(`getSaveCheckStates` `singleOutput`)가 수동 저장·승인 시작을 막는다(autosave는 막지 않음). SP 라벨 끝 배지(`SpOutputBadge`)가 같은 판정을 쓴다. 백엔드 확정 게이트 6과 동치 유지. AI·CSV는 노드 기본 출구 병렬 플래그만 다룬다(`applyParallelFlag`, AI `attributes.parallel`·CSV `Parallel` Y/N, 생략·빈 칸=유지) — SP 끝별 병렬은 우클릭 전용. CSV는 Next ≥2면 decision이되 Parallel=Y면 병렬 일반 노드. L6 임포트 어댑터는 전부 병행이 아닌 팬아웃 뒤에 ◇를 세운다(L5 `expand_linkage_branches`와 같은 이름 규칙, `map_to_row`가 접음). 흐름 펄스(`lib/edge-pulse.ts`+`components/edge-pulse-dot.tsx`, 렌더 전용 `edge.data.pulse`)는 병렬 갈래·분기 갈래에 SMIL 점 — **RF는 엣지마다 `<svg>`를 따로 그려 SMIL 시계가 엣지별**이라 마운트 때 `setCurrentTime(performance.now()/1000)`로 맞춰야 나중에 생긴 갈래도 박자가 맞는다. 타임라인(2026-10-02, 2026-10-06 개정): 병렬=공통 구간 36px를 형제가 같은 속도로 천천히 가속해 함께 간 뒤 각자 길이(끝점 맨해튼 근사 `getPathSpan`)에 맞춘 속도로 경로 75%에 동시 도달(퍼지는 구간 스플라인 시작 기울기를 공통 구간 끝 속도에 맞추고 끝은 감속), 분기=동시 출발→정지→순차 반짝임(차례 아닌 갈래는 완전히 사라졌다 돌아옴, 함께 반짝임 없음)→노드 id 시드로 1갈래만 50%(첫 회차들은 셔플이라 모든 갈래가 한 번씩 이김), 소스 노드 선택=채도↑·불투명 0.9·1.25배속, 형제 한 갈래 선택=나머지는 `endElementAt(회차 남은 시간)`으로 이번 회차 뒤 정지(재개는 circle key 재마운트), L5 차콜=밝은 점+밝은 테두리. 정지 장면(2026-10-03): 엣지마다 숨긴 `.bpm-edge-pulse-still` 점(병렬 75%·분기 멈춤 지점, cx/cy는 측정용 path로 DOM에 직접 — animateMotion 변환은 PNG 복제에 안 실린다)을 두고 모션 축소(globals.css)·PNG 출력(`lib/export` `applyEdgeFixups`)에서 움직이는 점과 교대, 비교 화면은 `pulse.still`로 정지 장면만. 줌 `PULSE_MIN_ZOOM`(0.5) 미만은 움직이는 점만 언마운트(정지 점은 출력용이라 유지). 범례는 `PulseLegend`(노드 표시 정보 카드 `pulseLegend`). 선택 해제는 pane 클릭(`onPaneClick`) — Esc는 RF 표시 선택만 지우고 `selectedEdgeId`는 남는다(스모크 함정). 병렬 해제(`setOutputParallel`)는 그 출구 엣지의 레거시 `gateway=parallel`까지 지운다(남기면 도출이 다시 병렬로 읽어 게이트 6을 우회). 핸들→핸들 연결은 잡은·놓은 핸들 그대로(`createEdge`·`edgeAction.connectHandles`), 같은 병렬 출구→같은 타깃 중복 갈래는 토스트로 막는다.
- **위·아래 변 연결선 최소 높이 40px(`frontend/src/lib/edge-stub.ts`, 사용자 결정 2026-10-06)** — 위·아래 끝이 있고 두 끝이 서로 정면이 아닌 연결(같은 변끼리·상대가 등 뒤)은 꺾기 전 40px(꺾은선 RF `offset`, 곡선은 꼭짓점이 40px 뜨게 제어점 4/3배). 마주 보는 연결은 가운데에서 꺾여 제외(강제하면 좁은 간격에서 선이 지나쳤다 되돌아온다). 에디터·L5(`multiline-edge`)·비교(`LabeledSmoothEdge`)·팬아웃 루프백 레인 기저·SP 미리보기 역행 통로(`scope-preview`)가 같은 상수.
- **엣지 경로·생성·재연결 단일 소스(2026-10-06)** — 경로는 `frontend/src/lib/edge-path.ts` `resolveEdgePath` 한 곳(팬 → 장애물 우회 → RF+최소 높이 순)을 에디터(`multiline-edge.tsx`)와 비교(`LabeledSmoothEdge`)가 공유하고, 라벨 앵커를 경로 요소 `data-label-x/y`(플로우 좌표)에 실어 인라인 라벨 편집 상자가 그 점에 붙는다. 우회(`buildDetourPoints`)는 **두 핸들이 서로 마주 볼 때만**(정면 거리 좌우 20·위아래 40의 2배 이상) — 역방향·같은 변 연결에 우회를 걸면 선이 자기 노드를 관통했다. 장애물은 노드 배열 단위 WeakMap 캐시라 RF 인스턴스가 여럿인 화면(인터뷰·선택지·관계 캔버스, `EDITOR_EDGE_TYPES` 재사용)도 안전하고, `useNodes` 구독은 꺾은선 엣지만 한다. SVG 경량 프리뷰(`ScopePreview`)는 `lib/preview-geometry.ts`가 같은 우회·라벨·변·SP 끝 미러 규칙을 따르고 줌은 `use-preview-zoom.ts` 한 벌. 엣지 객체 생성은 `canvas.ts` `buildAppEdge` 하나(기본값·폴백 핸들·SP 정규화·`gateway:null`). 연결 판정은 `lib/edge-rewire.ts`: `decideExitConnection`(병렬 출구 갈래 추가·같은 대상 중복 차단)을 핸들 연결·드롭 삽입·끝점 재연결이 공유하고, 삽입·재연결 결과는 적용 전에 `findRewireProblem`으로 새 역행 쌍·조용히 빠진 연결을 막는다(토스트 `edge.rewireReciprocal`). **끝점 재연결**(RF `onReconnect`, 사용자 결정): 같은 id·라벨·선 모양 유지, onConnect와 같은 검사, 펼친 자식·게이트웨이 엣지 제외. 끝 ≥2 SP의 출구가 바뀌면 출구 목록(`isSourceExitChange`), 출발을 판단 노드로 옮기면 분기 라벨 모달·판단 노드에서 떼면 라벨 소거(`decideReconnectLabel`), 도착 끝만 옮기면 라벨 유지. **연결 변 다시 고르기**(노드·엣지 우클릭, 사용자 결정: 자동 재계산 대신 수동 명령, 데이터 모델 불변)는 위치 기준 방향(`inferFlowDirFromPositions`)과 `pickHandleSide`로 고른다. 비교의 삭제 노드 배치(위상 순서·실측 사각형 겹침 회피·이웃 없는 노드는 bbox 밖 한 줄)는 `lib/compare-layout.ts`.
- **엣지 팬아웃은 렌더 전용 파생(`frontend/src/lib/edge-fanout.ts`)** — 같은 (노드·변) 앵커에 2개 이상 붙는 엣지 끝에 레인 k를 주고(`assignFanLanes`, 에디터 `styledEdges`·비교 `appEdges`가 `edge.data.fan`으로 주입), 엣지 컴포넌트가 라이브 끝점으로 그린다. 저장·백엔드·서명 무영향, 변(side)은 바꾸지 않는다. 정렬 규칙 두 가지: 대향 진입은 먼 소스가 안쪽, 동측(루프백 top→top)은 가까운 소스가 안쪽(무지개, 반경 기저 R0+스텁 34px, 위·아래 변은 최소 높이 40px), 한 측면에 둘 다 있으면 동측이 안쪽. **반경은 배정 단계에서 확정**(`FanLane.r`) — 형제의 측면 거리·수평 여유에 맞춰 바깥부터 압축(최소 간격 6), 안 들어가면 `r=0`(팬 없음). 끝마다 따로 클램프하면 순서가 뒤집혀 교차하고 `r=|v|`면 0길이 구간이 `NaN` 경로가 된다(리뷰 2026-09-30). 꺾은선 = 게이트 포인트+원호(`A`), 팬 폴리라인이 다른 노드를 관통하면 그 엣지만 현행 경로(`isPolylineBlocked`). 그룹 키는 (노드·변) — `s-<변>`/`t-<변>`·SP 끝 핸들(우측 한 점)이 같은 픽셀이라 한 그룹. 드래그 중엔 k 동결(`nodes` state 동결)·모양만 라이브. 스모크 `pw-smoke-edge-fanout.mjs`(API 시드 맵, 오우닝 부서는 `/api/directory` org_path·시작/끝 노드 필수). 비교 데모 맵 13은 노드가 전부 (0,0)이라 에디터 캡처엔 못 쓴다.

## Operations / Deployment

**파이프라인:** GitHub(Claude Code 수정) → Windows PC로 `git pull` → **로컬에서 Docker 없이 네이티브 실행·확인** → 서버(사내 71번)로 전송(scp 또는 gitlab pull) → **서버에서 docker-compose 배포**.

운영 환경이 코드에 부과하는 제약 — 위반하면 배포가 깨진다:

| 제약 | 이유 | 코드 반영 |
|------|------|-----------|
| **줄바꿈은 LF 고정** | Windows PC 경유 시 CRLF 오염 → Linux/Docker에서 스크립트·빌드 깨짐 | `.gitattributes`로 `* text=auto eol=lf` 강제 (Windows 전용 스크립트만 CRLF) |
| **로컬은 Docker 없음** | Windows PC에 Docker 미설치 | frontend/backend는 네이티브 실행 가능해야 함 (`npm run dev`, Python 직접 실행). DB·서비스 주소는 env로 분리 (`rules/backend/config.md`) — 로컬은 로컬 Postgres/원격, 서버는 compose 네트워크 |
| **앱 nginx는 443/80 미점유** | 서버 엣지 nginx가 이미 443/80 사용 | compose nginx는 **9900** 노출. 우선 포트 직접 접속, 도메인 라우팅은 추후 엣지 nginx에 추가 |
| **서버는 평문 HTTP(원격 IP)** | 브라우저 secure context 아님(HTTPS·localhost만) → `crypto.subtle`/`crypto.randomUUID` 등 Web Crypto 미동작 | id는 `frontend/src/lib/id.ts`의 `genId()` 사용(`crypto.randomUUID` 금지), Keycloak 로그인은 PKCE 비활성(`disablePKCE`). **localhost는 secure context라 재현 안 됨 — 서버/원격 IP로 검증** |
| **로컬↔서버 실행 경로 이원화** | 로컬=네이티브, 서버=Docker | 같은 코드가 양쪽에서 돌도록 환경 의존 값은 하드코딩 금지, 전부 `.env` 경유 |
| **서버는 Docker Hub 차단** | 베이스 이미지는 연결된 PC에서 amd64 tar로 반입(`docker load`) — 이미지 프룬이 빌드 전용 베이스(node·python)를 지운다(2026-10-02 배포 실패) | Dockerfile에 `# syntax=` 지시어 금지(빌드마다 `docker/dockerfile` 이미지를 레지스트리에서 조회). `FROM` 태그를 바꾸면 서버에 tar 반입이 같이 필요 — `docs/deploy/deploy.md` §0 |
| **배포 런타임이 로컬보다 낮음** | 이미지는 `python:3.11-slim` · `node:22-alpine` — 로컬은 3.12+/24 | 상위 문법을 쓰면 **로컬 게이트는 전부 green인데 컨테이너에서 import SyntaxError로 기동 불능**(2026-08-31 PEP 695 실사고). `backend/ruff.toml`의 `target-version = "py311"`이 가드 — Dockerfile 베이스 상향 시 같이 올린다. 확실한 검증은 3.11 venv로 `import app.main` |

**검증 단계:** 로컬 네이티브 실행으로 기능 확인 → 서버 docker-compose로 배포 확인. 로컬에서 통과해도 컨테이너 네트워크/포트/줄바꿈/**런타임 버전** 차이로 서버에서 깨질 수 있으니 양쪽 모두 검증한다. 배포 절차는 `docs/deploy/deploy.md`, 최초 1회 셋업은 `docs/deploy/setup-once.md`.

---

## Working Style — 최우선 (모든 룰보다 먼저)

**모든 작업의 행동 기반.** 아래 도메인 룰과 충돌해도 이 가이드의 원칙이 우선한다.

@rules/guidelines.md

---

## Rules — 범용 (유지)

@rules/common/comments.md
@rules/common/naming.md
@rules/common/git.md
@rules/common/security.md
@rules/common/error-handling.md
@rules/common/dependencies.md
@rules/common/documentation.md
@rules/common/testing.md

## Rules — 백엔드/Docker

@rules/backend/config.md
@rules/backend/docker.md
@rules/backend/sync-checklist.md

## Language-Specific Rules

@rules/languages/python.md
@rules/languages/typescript.md
@rules/frontend/design.md
@rules/frontend/identifiers.md
@rules/frontend/components.md
