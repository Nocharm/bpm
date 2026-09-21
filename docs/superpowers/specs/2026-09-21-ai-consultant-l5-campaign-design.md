# AI 컨설턴트 L5 캠페인 — 설계 (2026-09-21)

> 상태: 설계 초안(사용자 검토 대기). 브랜치 `feat/ai-consultant-l5`, 기준 dev `9bb4c9cd`.
> 한 줄: **"컨설턴트 인터뷰 JSON 0.5를 AI와 함께 앱 안에서 만들고, 기존 임포트로 적용한다."**

## 0. 결정 로그 (사용자 답변 2026-09-21)

| # | 질문 | 결정 |
|---|------|------|
| 1 | 진입점 | 설정 > Framework 관리자 탭, 인터뷰 임포트 옆(임포트와 동일한 sysadmin 게이트) |
| 2 | L6당 질문 방식 | 채팅이 아니라 **객관식 위주 설문지**. 문항도 AI가 만든다. 전부 답해야 제출, 제출 전 확인 화면, 주관식 빈칸은 제안값 자동 적용(플레이스홀더 = 제안). |
| 3 | 직렬/병렬 | L6는 **하나씩 순서대로 제출**. 제출한 것은 되돌리지 않는다. 제출 즉시 백그라운드 드로잉, 다음 L6 설문지는 미리 생성(파이프라인). |
| 4 | 등록 규칙 | **A안** = 임포트와 동일. L6 게시본까지 자동, SP 지정·슬롯 즉시, L5 캔버스는 draft, 확정은 관리자. |
| 5 | 체감 속도 | 최우선. 진행률·현재 단계·완료된 것부터 바로 확인·일시정지/재개·페이지 이탈 후 복귀 가능. |
| 6 | 외부 AI | CSV의 `buildAiPromptText`처럼 **외부 AI(ChatGPT 등)용 "인터뷰 JSON 0.5 작성 프롬프트" 복사 버튼**을 같이 제공. |

## 1. 목표와 비목표

**목표**
- sysadmin이 기존 L5 하나를 고르면, AI와 짧은 설문 n회로 L6 n개의 흐름과 L5 연결을 만들고, 기존 `POST /api/categories/import-interview`로 한 번에 등록한다.
- 결과물은 사람이 읽을 수 있는 인터뷰 JSON 0.5 파일 1개(= L5 1개). 다운로드·재임포트·감사가 가능하다.
- 총 AI 호출 ≈ 2N+2 (L6마다 설문 1 + 드로잉 1, L5 계획 1 + L5 연결 1).

**비목표(v1)**
- 새 L5 카테고리 생성(대상은 기존 L5만).
- 타 L5의 L6 참조(`externalTasks`). v1은 홈 L5 안의 L6끼리만 연결.
- 제출한 L6 설문 되돌리기(대신 드로잉 완료 후 "이 카드만 다시" 옵션은 v1.5 후보).
- sysadmin 외 사용자 개방(임포트 엔드포인트 게이트와 동일하게 시작).
- 병렬 설문 작성 UI.

## 2. 사용자 흐름

```
설정 > Framework
  ├─ [AI로 L5 채우기]  → 세션 생성 → /framework/consult/{sessionId}
  └─ [외부 AI 프롬프트 복사]  (클립보드, 선택한 L5가 있으면 코드·경로 프리필)

/framework/consult/{sessionId}   (전체 화면, 좌: L6 카드 보드+진행률 / 우: 현재 단계)
  ① L5 개요      대상 L5 확인 · 목적/범위 텍스트 · 첨부(docx/pdf/txt, 기존 parsing.py)
                 → AI: L6 후보 카드 목록(이름·한 줄 요약·역할·부서·순서·선행 L6)
                 → 사용자가 카드 편집(추가/삭제/이름/순서) → [계획 확정] (잠금)
  ② L6 설문 ×N   카드 k 설문지(6~12문항, 객관식 위주, 제안 답 선택됨, 주관식은 제안 플레이스홀더)
                 [제안대로 모두 채우기] · [확인 화면] · [제출]  → 카드 k = drawing(백그라운드)
                 카드 k+1 설문지는 k 작성 중 미리 생성됨(prefetch)
  ③ L5 연결      모든 카드 drawn → AI: 최상위 relations(entry+edges) 제안
                 → L5 미리보기(기존 buildL5PreviewGraph) → [연결 확정]
  ④ 등록         dry-run 리포트(기존 InterviewImportReport 재사용, 거버넌스 체크)
                 → [적용] = import-interview apply:true → 트리 갱신 · 캔버스 열기 링크
                 → [JSON 다운로드]
```

**진행 가시성**
- 좌측 보드: 카드마다 상태 칩 `대기 · 설문 준비 중 · 답변 중 · 그리는 중 · 완료 · 실패`. 상단 진행률 `k/N 완료`, 현재 백그라운드 작업 이름, 남은 시간 추정(완료된 드로잉 평균 × 남은 수).
- 완료 카드는 클릭 즉시 미리보기(기존 `buildPreviewGraph` + `PreviewCanvas`). 사용자는 다음 설문을 쓰면서 앞 결과를 확인할 수 있다.
- [일시정지]: 진행 중인 AI 호출은 끝내고 큐를 멈춘다. [재개]로 이어간다. 페이지를 떠나도 상태는 DB에 있으므로 관리자 탭의 "진행 중인 세션" 목록에서 복귀한다.
- 폴링: 활성 작업이 있는 동안 FE가 2초 간격 `GET .../framework-interviews/{id}`. 서버 푸시는 도입하지 않는다(기존 인터뷰 첨부 추출과 같은 방식).

## 3. 데이터 모델

새 테이블 2개(`create_all`로 생성, 기존 테이블 컬럼 추가 없음 → `_ADDED_COLUMNS` 등록 불필요).

```python
class FrameworkInterviewSession(Base):            # framework_interview_sessions
    id, login_id, category_id (FK process_categories, L5),
    status: planning | plan_locked | answering | linking | ready | applied | abandoned
    paused: bool
    lang: "ko" | "en"
    brief: Text            # 사용자가 쓴 목적/범위
    plan: JSON             # 잠금 후 L6 카드 목록 [{task_id, name, summary, owner_role, department, seq, depends_on[]}]
    relations: JSON | None # ③에서 확정한 최상위 relations
    assembled: JSON | None # 마지막으로 조립한 0.5 문서(다운로드·dry-run 입력)
    label: str             # 임포트 label (기본 "AI consult {date}")
    created_at, updated_at

class FrameworkInterviewTask(Base):               # framework_interview_tasks (L6 1건)
    id, session_id (FK, CASCADE), task_id (rows[].taskId = consultant_code), seq
    status: pending | questionnaire_ready | answering | submitted | drawing | drawn | failed
    questionnaire: JSON | None   # {questions:[...]}
    answers: JSON | None         # {qid: value}
    row: JSON | None             # 0.4 rows[] 원소(드로잉 결과)
    issues: JSON                 # convert_interview 검증 이슈(경고/오류)
    error: str | None
    drawn_at, updated_at
```

첨부는 기존 `InterviewAttachment`를 재사용하지 않고 세션 `brief`에 파싱 텍스트를 병합한다(첨부 원문 보관 불필요, 첫 호출에만 쓰임). 파싱은 `backend/app/interview/parsing.py` 재사용.

**`task_id` 규칙**: `{L5 nodeCode}-{NN}`(두 자리 순번, 기존 L6의 `consultant_code`와 충돌하지 않게 max+1부터). 계획 단계에 표시되는 "이미 등록된 L6"는 읽기 전용 카드로 보여주고 v1은 제외한다(재생성 없음). 임포트 멱등성은 `consultant_code`이므로 같은 세션을 다시 적용해도 중복 생성되지 않는다.

## 4. 설문지 계약

```json
{
  "questions": [
    {
      "id": "q1", "kind": "multi" | "single" | "text" | "ordered",
      "maps_to": "activities" | "branches" | "roles" | "systems" | "io" | "conditions" | "params",
      "text": "이 업무의 주요 활동을 고르세요(순서대로)",
      "options": [{"id": "a1", "label": "요청 접수"}, ...],
      "suggested": ["a1", "a3"]   // text면 "suggested": "…"
    }
  ]
}
```

- 규칙: 6~12문항, `activities`(ordered) 1개 필수, `text`는 최대 3개. 옵션 라벨은 역할·시스템 카탈로그(`format_catalog_block`)를 우선 사용.
- 검증(FE·BE 동일): 모든 문항에 값이 있어야 제출. `text` 빈칸은 `suggested`로 채워 제출한다(서버가 채우고 `answers[qid].auto = true` 표시). "제안대로 모두 채우기"는 전 문항을 suggested로 채우는 클라이언트 동작.
- 확인 화면: 문항별 최종값과 "자동 적용됨" 배지 목록. [제출]은 여기서만.

## 5. AI 호출 4종 (prompt_registry 키 추가, 관리자 오버라이드 가능)

| 키 | 입력 | 출력 | 시점 |
|----|------|------|------|
| `l5_plan_contract` | L5 경로·brief·첨부 텍스트·기존 L6 목록·카탈로그 | L6 카드 목록 JSON | ① |
| `l6_questionnaire_contract` | 계획 카드 k·brief·이웃 카드(선행/후행)·카탈로그 | 설문지 JSON(§4) | ② prefetch |
| `l6_row_drafter_contract` | 카드 k·설문 답·카탈로그 | 0.4 `rows[]` 원소(actions·fields·relations) | ② 제출 후 백그라운드 |
| `l5_relations_contract` | 계획·각 row의 start/end 조건·depends_on | 최상위 `relations{entry, edges}` | ③ |

- 호출은 전부 `ai_client.call_ai` 경유(전역 세마포어·엔드포인트 라우팅·usage 계측 `AiUsageEvent kind="framework_interview"`).
- JSON 무효 시 1회 재프롬프트 후 실패 처리(`_ask_and_validate` 패턴). 실패 카드는 `failed` + 사유, [다시 시도] 버튼.
- 드래프터 결과는 즉시 부분 문서로 `convert_interview`에 넣어 그 row의 이슈만 추출해 `issues`에 저장(오류가 있으면 `failed`, 경고는 카드에 표시).

## 6. 백그라운드 실행

- 단일 uvicorn 워커(Dockerfile CMD) 전제로 `backend/app/kb/indexing.py`의 `spawn` 패턴(강참조 태스크 집합)을 `backend/app/framework_interview/runner.py`로 일반화해 사용한다.
- 세션당 러너 1개: 큐 = `submitted` 태스크(드로잉) 우선, 그다음 `pending` 중 가장 앞 카드의 설문 prefetch 1개. `paused`면 현재 호출을 마치고 멈춘다.
- 재기동 복구: 앱 시작 시 `drawing`·`questionnaire_ready` 생성 중 상태를 각각 `submitted`·`pending`으로 되돌린다(중복 실행 방지, 러너는 요청이 들어올 때 lazy 기동).
- 동시 편집: 세션은 `login_id` 소유. 같은 L5에 활성 세션이 있으면 생성 409(재개 유도).

## 7. 조립과 등록

- 조립(`assemble_document(session)`): `framework.categories` = L5의 조상 체인(코드·이름·레벨·parent), `l5 = {label, nodeCode}`, `rows` = 각 task의 `row`, `relations` = 세션의 `relations`, `labelSource: "ai-assisted"`, `schema_version: "0.5-bpm-interface-draft"`, `_readme`에 세션 id·생성 시각. `externalTasks`는 비움.
- dry-run/apply는 **기존 엔드포인트를 그대로** 호출한다(`importInterview({files:[{name, content}], apply, decisions})`). 리포트 UI는 `components/admin/import-report/interview-import-report.tsx` 재사용. 적용 성공 시 세션 `applied`.
- 임포트 엔진 규칙이 그대로 적용된다: 게시 직행, `owner` 없으면 actor 폴백 + `consultant_owner_pending`, SP 지정 인라인, 캔버스는 draft(첫 생성 시 자동 배치), 확정은 사람.

## 8. API

```
POST   /api/framework-interviews                      {category_id, brief, lang}      → 세션 (409 if active)
GET    /api/framework-interviews?active=1              진행 중 목록(관리자 탭 복귀용)
GET    /api/framework-interviews/{id}                  세션 + tasks 요약(폴링)
POST   /api/framework-interviews/{id}/attachments      파일 → 파싱 텍스트를 brief에 병합
POST   /api/framework-interviews/{id}/plan             AI 계획 생성(①, 재요청 가능)
PUT    /api/framework-interviews/{id}/plan             카드 편집 저장 / {lock:true}로 잠금 → tasks 생성
GET    /api/framework-interviews/{id}/tasks/{tid}      설문지·답·row·issues
POST   /api/framework-interviews/{id}/tasks/{tid}/answers   제출(검증·빈 text 자동 채움) → submitted
POST   /api/framework-interviews/{id}/tasks/{tid}/retry     failed → submitted 재큐
POST   /api/framework-interviews/{id}/pause | /resume
POST   /api/framework-interviews/{id}/relations        AI 연결 제안(③)
PUT    /api/framework-interviews/{id}/relations        확정 → assembled 생성, status ready
GET    /api/framework-interviews/{id}/document         조립된 0.5 JSON(다운로드)
DELETE /api/framework-interviews/{id}                  abandon
```
전부 `require_sysadmin` + AI 활성(`is_ai_access_enabled`) 게이트. 적용은 기존 `POST /api/categories/import-interview`.

## 9. 프론트

- 라우트 `frontend/src/app/framework/consult/[sessionId]/page.tsx` (consult 페이지와 같은 좌우 분할, `bpm.fwConsultBoardWidth`).
- 컴포넌트 `frontend/src/components/framework-interview/`: `task-board.tsx`(카드+상태 칩+진행률), `plan-editor.tsx`(카드 편집), `questionnaire-form.tsx`(문항 렌더·검증·제안 채우기), `answer-review.tsx`(확인 화면), `relations-step.tsx`(L5 미리보기), `register-step.tsx`(dry-run 리포트·적용·다운로드). 새 컴포넌트는 `COMPONENTS.md` 재생성.
- 관리자 패널(`admin/framework-panel.tsx`) 인터뷰 임포트 섹션에 버튼 2개 + "진행 중인 세션" 목록.
- `lib/framework-interview.ts`: 상태 파생(진행률·ETA), 설문 검증(`validateAnswers`, 빈 text → suggested), 폴링 훅.
- `lib/interview-json-prompt.ts` `buildInterviewJsonPromptText({l5Code, l5Name, path})`: 외부 AI용 프롬프트(0.5 스켈레톤·키 규칙·엣지 kind/gateway·action kind·출력은 JSON만). 복사 버튼은 `csv-template-actions.tsx`의 `handleCopyPrompt` 패턴.
- i18n: `lib/i18n-messages.ts`에 `fwConsult.*` 키(ko/en). UI 문구는 긴 대시 금지.
- 디자인: 토큰만 사용, 상태 칩은 시맨틱 색(대기 slate·진행 accent·완료 sage·실패 rose), Lucide 16px.

## 10. 테스트

**Backend (pytest, AI는 monkeypatch)**
- 세션 생성/409/권한, 계획 생성→잠금→tasks 생성, 답 제출 검증(누락 422·빈 text 자동 채움·auto 표시), 러너 상태 전이(submitted→drawing→drawn, 실패→retry), pause/resume, 재기동 복구, `assemble_document` 결과가 `convert_interview`를 이슈 0으로 통과, `document` 다운로드, 적용 후 `applied`.
- 프롬프트 빌더 4종 스냅샷(카탈로그 블록 포함), `PROMPT_KEYS` 확장 회귀(`test_ai_prompts.py`).

**Frontend (vitest)**
- `validateAnswers`(필수 누락·빈 text 채움·ordered 순서 보존), 진행률·ETA 파생, `buildInterviewJsonPromptText`(필수 섹션·스켈레톤 JSON parse 가능).

**Browser (Playwright, `scripts/pw-fw-consult.mjs`)**
- 관리자 탭 진입 → 계획 확정 → 설문 1건 제출 → 카드 상태 변화 → 연결 확정 → dry-run 리포트 표시. AI는 `AI_ENABLED`+fake 엔드포인트 또는 서버 스텁으로.

## 11. 구현 순서

| 단계 | 내용 | 검증 |
|------|------|------|
| P1 | 모델·스키마·세션 CRUD·계획 생성/잠금(AI 1종) | pytest |
| P2 | 설문지 생성·답 제출·드래프터·러너(pause/resume·복구·prefetch) | pytest 상태 전이·동시성 |
| P3 | 연결 제안·조립·document·dry-run/apply 연동 | pytest: convert_interview 통과 |
| P4 | FE 페이지·보드·설문 폼·확인 화면·폴링 | vitest + Playwright 스모크 + 스크린샷 |
| P5 | 관리자 패널 진입/복귀·외부 AI 프롬프트 복사 | vitest 프롬프트 + 스모크 |
| P6 | 매뉴얼(admin ko/en)·PROGRESS·설정 AI 프롬프트 탭 키 노출 | 문서 링크 점검 |

## 12. 열린 위험

- **드래프터 품질**: 설문 답만으로 7~13 활동 흐름을 그리므로 `lint_graph` 톤 규칙을 row 단위로 재사용해 경고를 카드에 보여준다. 품질이 낮으면 v1.5에서 "이 카드만 다시" + 추가 주관식 1문항.
- **소요 시간**: 드로잉 1건 ≈ 드래프터 1콜(현재 인터뷰 draw single과 동일). N=8이면 사용자가 설문을 쓰는 동안 대부분 끝난다. 병목은 설문 prefetch가 사용자 입력보다 느린 경우이며, 이때 "설문 준비 중" 스켈레톤을 보여준다.
- **임포트 게이트 재사용**: 적용은 sysadmin 전용이므로 v1 개방 범위도 sysadmin. L5 관리자 개방은 임포트 엔드포인트 권한 완화와 함께 별도 트랙.
