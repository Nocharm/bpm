# AI 프롬프트 관리 (sysadmin) — 설계

2026-08-04. 시스템관리자가 프론트(`/settings`)에서 AI 시스템 프롬프트를 열람·수정·기본값 복원하는 기능. 기존 마크다운 뷰어(`markdown-view.tsx`)와 매뉴얼 관리 패널의 편집 패턴(textarea + Edit/Preview 토글)을 재사용한다.

## 배경 · 목적

AI 프롬프트는 전부 백엔드 파이썬 모듈 상수로 하드코딩돼 있어(설정 훅 없음), 프롬프트 튜닝마다 코드 수정·배포가 필요했다. 운영 중 sysadmin이 직접 확인·조정할 수 있게 하되, 잘못 고쳤을 때 즉시 되돌릴 수 있어야 한다.

## 범위 — 편집 대상 7개

큰 프롬프트 상수만 노출한다. 그래프 직렬화·구조 힌트·스테이지 목표문 등 코드가 조립하는 동적 블록은 제외(프롬프트 본문이 아니거나 소형 문장 다수).

| key | 원본 상수 | 위치 | 용도 |
|---|---|---|---|
| `ai_chat_instructions` | `_INSTRUCTIONS` | `app/ai_prompt.py:5` | 맵 에디터 AI 챗 시스템 지침(모드·JSON 스키마·규칙) |
| `interviewer_contract` | `_INTERVIEWER_CONTRACT` | `app/interview/agents.py:81` | 컨설턴트 인터뷰어 페르소나+응답 계약 |
| `drafter_contract` | `_DRAFTER_CONTRACT` | `app/interview/agents.py:110` | 순서도 드래프터 계약(델타 출력 규칙 포함) |
| `interviewer_word_addendum` | `_INTERVIEWER_WORD_ADDENDUM` | `app/interview/agents.py:131` | Word/SOP 모드 인터뷰어 애드덤 |
| `drafter_word_addendum` | `_DRAFTER_WORD_ADDENDUM` | `app/interview/agents.py:145` | Word 모드 드래프터 규칙(섹션 노드·앵커) |
| `extract_contract` | `_EXTRACT_CONTRACT` | `app/interview/orchestrator.py:546` | 첨부문서 facts 추출 계약 |
| `anti_repeat_nudge` | `_ANTI_REPEAT_NUDGE` | `app/interview/orchestrator.py:625` | 반복 응답 감지 시 재시도 넛지 |

## 데이터 모델

신규 테이블 `ai_prompts` — **오버라이드만 행으로 저장**. 행이 없으면 코드 기본값 사용.

```python
class AiPrompt(Base):
    __tablename__ = "ai_prompts"
    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    content: Mapped[str] = mapped_column(Text)
    updated_by: Mapped[str] = mapped_column(String(100))
    updated_at: Mapped[datetime]
```

- 신규 테이블은 startup `create_all`이 자동 생성 — 운영 DB에 ALTER 불필요(안전). `_ADDED_COLUMNS` 등록 대상 아님(신규 컬럼이 아니라 신규 테이블).
- "기본값 복원" = 행 삭제. 배포로 코드 기본 프롬프트가 개선되면 미커스텀 항목은 자동 반영된다(스냅샷 박제 없음).

## 백엔드 구조

**신규 `app/prompt_registry.py`** — 단일 소스 레지스트리 + 조회 헬퍼:

- `PROMPT_DEFS: dict[str, str]` — key → 기본 상수 매핑(7개). 각 모듈의 상수를 import해 참조.
- `async def get_prompt_overrides(session) -> dict[str, str]` — `ai_prompts` 전체 조회(최대 7행, 요청당 1회).
- 유효 프롬프트 = `overrides.get(key) or PROMPT_DEFS[key]`.

**호출부 스레딩** — 빌더에 `overrides: Mapping[str, str] | None = None` 파라미터 추가, `None`/키 없음이면 기존 상수 폴백(기존 테스트·호출부 무해):

- `ai_prompt.build_system_prompt` / `build_messages` ← `routers/ai.py`가 요청당 1회 로드해 전달.
- `agents.build_interviewer_messages` / `build_drafter_messages` ← orchestrator가 전달.
- orchestrator의 `_EXTRACT_CONTRACT`·`_ANTI_REPEAT_NUDGE` 사용부 2곳도 overrides 조회로 치환.
- orchestrator는 진입점에서 `get_prompt_overrides(session)` 1회 호출 후 내부로 전달(턴당 다회 DB 조회 방지).

## API — `routers/ai_prompts.py` (prefix `/api/admin/ai-prompts`)

라우터 의존성 `Depends(get_current_user), Depends(require_sysadmin)` — 읽기·쓰기 모두 sysadmin 전용(기존 `app_settings` 라우터 패턴). AI kill switch와 무관하게 동작(관리 설정이므로).

| 메서드 | 경로 | 동작 |
|---|---|---|
| `GET` | `/` | 7개 전체 반환 — `key`, `content`(유효값=오버라이드 또는 기본), `is_customized`, `updated_by`, `updated_at`(커스텀 시만) |
| `PUT` | `/{key}` | 오버라이드 upsert. 검증: 미등록 key → 404, strip 후 빈 문자열 → 422, 길이 상한 50,000자 |
| `DELETE` | `/{key}` | 행 삭제 = 기본값 복원(멱등 — 없어도 200). 미등록 key → 404 |

스키마: `AiPromptOut`(위 필드), `AiPromptUpdate`(`content: str`). 제목·설명은 백엔드가 아니라 프론트 i18n에서 관리.

## 프론트엔드

**신규 `components/settings/ai-prompts-panel.tsx`** — `/settings` Content 카테고리(sysadmin 전용)에 `aiPrompts` 탭 추가(`settings/page.tsx` `CATEGORIES` — notices·manual·kb·aiChat 옆).

- **상단 선택 리스트**: 7개 프롬프트 행(제목 + 한 줄 설명). 커스텀 항목엔 "Customized" 배지 + 수정자·시각(`updated_by`, KST 표시).
- **편집 영역**(매뉴얼 관리 패널 패턴 재사용): 모노스페이스 `<textarea>` ↔ Eye/Pencil 토글로 `MarkdownView` 프리뷰. 툴바: Preview 토글 · Save · Reset to default(커스텀 상태에서만 활성, `ConfirmDialog` 확인).
- **경고 배너 1줄**: 프롬프트 내 JSON 응답 계약을 깨면 AI 기능이 오동작할 수 있음 — 문제 시 Reset.
- 더티 상태에서 다른 프롬프트 선택 시 확인. 저장/복원 후 목록 재조회.
- `lib/api.ts`: `AiPromptItem` 타입 + `getAiPrompts()` / `putAiPrompt(key, content)` / `resetAiPrompt(key)`.
- i18n: `aiPrompts.*` 키(en/ko) — 탭 라벨·7개 제목/설명·버튼·배너·토스트. UI 영어 기본(디자인 룰 §5).
- 주요 요소 `data-id` 부여(`ai-prompts-list`, `ai-prompt-editor`, `ai-prompt-save`, `ai-prompt-reset` 등).

## 검증

- **pytest**: 비sysadmin 403 · GET 7개 형태(`is_customized` false 기본) · PUT 후 GET 반영 + `build_system_prompt`/`build_interviewer_messages` 출력에 오버라이드 반영 · DELETE 후 기본값 복귀 · 빈값 422 · 미등록 key 404.
- **프론트**: `npm run lint` + `npm run build`, 로컬 브라우저(Playwright + 시스템 Chrome)로 편집→저장→프리뷰→복원 시나리오 확인.
- 기존 게이트 회귀: 백엔드 전체 pytest 그린(오버라이드 파라미터는 폴백 기본이라 기존 테스트 무영향 전제 확인).

## 제외 (YAGNI)

- 버전 히스토리 없음 — 복구는 Reset to default로 충분.
- 인터뷰 스테이지 목표문(9×한/영) 미포함 — 필요 시 후속.
- 프롬프트 구문(JSON 계약) 검증 없음 — 경고 배너 + Reset으로 대응.
- 기본값 대비 diff 뷰 없음.
