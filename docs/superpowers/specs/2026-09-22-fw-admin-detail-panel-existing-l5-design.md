# Categories & import 상세 패널 재구성 + 기존 L5 학습·정정 — 설계 (2026-09-22)

> 상태: 사용자 승인(A안, 2026-09-22). main 머지 시 삭제(설계 폐기 정책). 선행 설계: `2026-09-21-ai-consultant-l5-campaign-design.md`.

## 0. 결정 요약 (사용자 지시 2026-09-22)

1. **Manage 뷰 = 좌 트리 : 우 상세 패널, 같은 높이**(검색 상자 + 10행 = 340px). 아코디언 섹션 3종 폐기.
2. **트리 행에서 액션 아이콘·관리자 표시를 뺀다.** 행 클릭 = 선택(+드릴인). 선택 행은 우측 패널 머리에 이름·요약 정보.
3. **우측 패널 구성(위→아래)**: 선택 행 머리 → 정보 줄 → 액션 6종(불가는 숨기지 말고 비활성) → AI L5 블록(L4 선택=새 L5 만들기 활성, L5 선택=채우기 활성) → 맨 아래 [인터뷰 임포트] 버튼(왼쪽 목록 끝선에 맞춤).
4. **임포트 버튼 = 바로 파일 탐색기.** 고른 파일은 그리드 아래 전폭 스트립에 필(이름·×)로 옆으로 나열 + 개수 + [Dry run]. 리포트는 그 아래 전폭(현행).
5. **기존 L5에 맵이 있으면 먼저 불러와 학습**: 세션 시작 시 그 L5의 L6 맵을 읽어 계획·설문·드로잉 프롬프트에 넣는다. **추가 vs 정정은 계획 카드 단위(A안)**: 기존 맵은 "기존" 카드로 나타나고 기본 유지, 카드별로 정정 전환.

## 1. 관리자 화면 (frontend `components/admin/framework-panel.tsx`)

### 1.1 레이아웃
- `framework-manage-grid`: `grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4`. 좌 `framework-admin-tree`와 우 `framework-admin-detail` 모두 **`h-[340px]`**(트리는 `max-h`가 아니라 고정 높이, 내부 스크롤 유지).
- 그리드 아래: `interview-import-strip`(파일이 1개 이상일 때만) → `interview-import-report-wrap`(현행 0fr→1fr 전환 유지).
- `AdminSection` 컴포넌트는 이 패널이 유일한 사용처였으므로 **삭제**하고 `COMPONENTS.md` 재생성.

### 1.2 트리 행
- 남기는 것: 펼침 셰브런, `LevelPill`, 이름, 코드, 우측 숫자 묶음(L4 행만 L5 수, 접힌 행만 `CountTag` 맵 수).
- 빼는 것: 액션 아이콘 6종, `renderInlineAdmins`(관리자 표시는 상세 패널로).
- 이름 버튼 클릭 = `setSelectedId(node.id)` + (자식이 있을 수 있으면) 펼침 토글. 선택 행은 `aria-current="true"` + `bg-accent-tint`. 검색 히트 클릭(`revealCategory`)도 체인 펼침 후 선택.
- 선택 노드는 id만 상태로 두고 `childrenByParent`에서 찾는다(이름 변경·이동 후 갱신 반영). 트리에서 사라지면(삭제) 선택 해제.

### 1.3 상세 패널 `framework-admin-detail` (`flex flex-col gap-3 rounded-md border border-hairline bg-surface-pearl p-3`)
1. **머리** `framework-admin-detail-head`: `LevelPill` + 이름(`text-body-strong`) + 코드(`text-fine text-ink-tertiary`). 선택 없음: `framework-admin-detail-empty` 안내문("트리에서 행을 고르세요") 하나만.
2. **정보 줄** `framework-admin-detail-info`(flex-wrap, 라벨:값 `text-fine`): 맵 수 · L5 수(레벨 ≤4만) · 관리 부서(`admin_department` 없으면 "없음") · 관리자(`permNamesByCategory`, 3명 + "+n" 툴팁, 없으면 "없음") · L5면 캔버스 상태(none/draft/confirmed) + `linkage_map_id` 있으면 `/maps/{id}` 링크 "열기".
3. **액션 줄** `framework-admin-actions`: 아이콘+라벨 버튼 6개 고정 순서 — 하위 추가(`add`) · 이름 변경(`rename`) · 관리 부서(`dept`) · 권한(`perms`) · 이동(`move`) · 삭제(`delete`). data-id `framework-admin-action-{key}`. `disabled` 조건: 선택 없음 → 전부; add → `level >= 5`; perms/move/delete → `!canManageInScope(...)`. 클릭 동작은 현행 행 아이콘과 동일(`setNamePrompt`·`setDeptNode`·`setPermsNode`·`setMovingNode`·`openDelete`).
4. **AI L5 블록** `framework-admin-ai`(제목 "AI L5" + 우측 `InterviewJsonPromptButton`):
   - 줄 1: 새 L5 이름 입력 `fw-consult-new-name` + [L5 만들고 시작] `fw-consult-create` — 선택이 L4일 때만 활성(이름 비면 비활성).
   - 줄 2: [AI로 L5 채우기] `fw-consult-start` — 선택이 L5일 때만 활성. 그 L5에 진행 중 세션(`activeSessions.find(category_id)`)이 있으면 라벨 "이어서 진행"·클릭 시 세션 페이지로 이동.
   - 줄 3: "진행 중 세션 n" 버튼 `fw-consult-sessions-toggle`(n=0이면 비활성) → 버튼 아래 fixed 포털 목록 `fw-consult-sessions-panel`(z 1350, 바깥 클릭·Esc 닫힘, 행: 카테고리 이름·drawn/total·[이어서]).
   - 기존 `consultMode` 세그먼트·`FrameworkCascadePicker` 사용은 제거(피커 컴포넌트는 남긴다. 세션 페이지 등 다른 사용처 없음 확인 후에도 공용으로 유지).
5. **하단** `mt-auto`: [인터뷰 임포트] 버튼 `interview-import-pick`(Upload 아이콘, 파일 수 배지) → `interviewInputRef.current?.click()`. 숨은 `<input type=file multiple>` `interview-import-files`는 유지.

### 1.4 임포트 스트립 `interview-import-strip`
- `flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-surface p-2`.
- 파일 필 `interview-import-file-{i}`: 파일 아이콘 + 이름(truncate max-w 240px) + 에러면 `text-error` 테두리 + × `interview-import-remove-{i}`.
- 끝: 개수 `interview-import-file-count`(기존 i18n `framework.interviewFileCount`) · [모두 지우기] `interview-import-clear` · [Dry run] `interview-import-dryrun`(현행 disabled 규칙).
- 리포트·Apply·pending 안내는 현행 마크업 그대로 스트립 아래.

### 1.5 i18n(en/ko) 추가 키
`framework.adminDetailEmpty`, `framework.adminInfoMaps`, `framework.adminInfoL5`, `framework.adminInfoDept`, `framework.adminInfoAdmins`, `framework.adminInfoCanvas`, `framework.adminOpenCanvas`, `framework.adminNone`, `fwConsult.aiBlock`("AI L5"), `fwConsult.resume`(기존), `fwConsult.sessionsToggle`("진행 중 세션 {n}"), `fwConsult.needL4`, `fwConsult.needL5`(비활성 버튼 title), `framework.interviewImportPick`(버튼 라벨, 기존 키 재사용 가능하면 재사용).
- 긴 대시(—) 금지.

## 2. 기존 L5 학습 + 카드 단위 정정 (backend)

### 2.1 기존 맵 스냅샷 `backend/app/framework_interview/existing.py` (신규)
```python
async def load_existing_l6(db, category_id: int) -> list[dict]
# ProcessMap.category_id == category_id and deleted_at is None and consultant_code is not None
# 버전 선택: 최신 PUBLISHED(id desc) → 없으면 최신 DRAFT. 없으면 그 맵은 제외.
# 반환 원소: {"map_id", "code": consultant_code, "name", "summary": description[:300],
#            "activities": [label...], "row": map_to_row(...)}

def map_to_row(map_name: str, owning_department: str | None, nodes: list[Node], edges: list[Edge]) -> dict
```
`map_to_row`는 어댑터 `format_node_description`의 역변환:
- 대상 노드 = `node_type in {"process", "decision"}`, `sort_order` 순 → `seq` 1..n. start/end/subprocess는 제외(subprocess는 이번 라운드 손실 허용, 이슈 없음).
- `label` = title. `description`을 줄로 나눠 첫 빈 줄 전까지 = `name`; 이후 `Rule: `·`Screen: `·`Quote: ` 접두 줄 → 해당 키, `Variant: exception` → `variant="exception"`(또는 `color == EXCEPTION_VARIANT_COLOR`), `Kind: handoff` → `kind="handoff"`. `node_type == "decision"` → `kind="decision"`.
- `input`/`output`/`system` = 노드 컬럼(빈 문자열은 키 생략).
- 행: `l6`=map_name, `ownerRole`=가장 흔한 비어있지 않은 `assignee_role`(없으면 ""), `department`=owning_department or "", `fields`={} + 첫 활동 노드의 `start_condition`·마지막 활동 노드의 `end_condition`이 비어있지 않으면 `start_condition`/`done_criteria`.
- `relations.edges`: 두 끝이 모두 활동 노드인 엣지만. `kind`: 소스가 decision → `"branch"`(`gateway`=edge.gateway or "exclusive", `condition`=label), 목적지 seq < 소스 seq → `"loop"`(`condition`=label), 그 외 `"seq"`(label 있으면 `label`).
- 결과는 `validate_row`를 **오류 0**으로 통과해야 한다(경고 허용). 라운드트립 테스트: 어댑터 샘플 문서를 임포트한 맵 → `map_to_row` → 활동 label/seq/kind와 엣지 kind가 원문과 같다.

### 2.2 세션 모델·API
- `FrameworkInterviewSession.existing: JSON | None` — 2.1 목록(row 포함). `_ADDED_COLUMNS`에 `("framework_interview_sessions", "existing", "JSON")`.
- `FrameworkInterviewTask.mode: String(10) default "new"` — `new | keep | revise`. `_ADDED_COLUMNS`에 `("framework_interview_tasks", "mode", "VARCHAR(10) DEFAULT 'new'")`.
- 세션 생성(`POST /framework-interviews`)에서 `existing = await load_existing_l6(db, category_id)` 저장.
- 응답 `FrameworkInterviewOut.existing: list[FrameworkExistingOut]` = `{map_id, code, name, activity_count}` (row는 내려주지 않는다). `TaskOut.mode`.
- 계획 카드 스키마(`PlanCard`·`FrameworkInterviewPlanIn` 카드·FE `FwPlanCard`)에 `existing_code: str | None = None`, `mode: "new" | "keep" | "revise" = "new"` 추가.

### 2.3 계획 제안·병합
- `build_plan_messages(..., existing_maps: list[dict])`: user 메시지에 `[이미 있는 L6 맵]` 블록 — `- code · 이름: 요약 (활동: a → b → c)`. 없으면 `- (없음)`.
- `L5_PLAN_CONTRACT`에 규칙 추가: 이미 있는 L6 맵은 각각 카드 하나로 **이름 그대로** 포함하고 `existing_code`에 그 코드를 적는다. 새 카드는 빈 곳만 채운다. 이름·역할이 겹치는 새 카드를 만들지 않는다.
- 라우터 `propose_plan` 후처리 `merge_existing_cards(cards, existing) -> list[dict]`(existing.py): 기존 맵마다 카드 정확히 1개 보장 — `existing_code` 일치 또는 이름 완전 일치(공백 정리) 카드에 `existing_code`·`mode="keep"`(이미 revise면 유지)을 찍고, 없으면 `{name, summary, mode:"keep", existing_code}` 카드를 앞쪽(기존 맵 순서)에 삽입. 존재하지 않는 `existing_code`는 지운다(mode→new).
- 저장(`PUT /plan`, lock 아님)에서도 같은 `merge_existing_cards`를 돌려 카드 상태를 정규화한다(사용자가 기존 카드를 지워도 되살아난다. 기존 맵을 제외하고 싶으면 정정 없이 유지가 곧 "손대지 않음").

### 2.4 잠금·태스크 생성
- `task_id`: `existing_code`가 있으면 그 코드, 새 카드만 `allocate_task_ids(...)`로 채번(개수 = 새 카드 수).
- keep 카드 → 태스크 `mode="keep"`, `status="drawn"`, `row=existing[i]["row"]`, `issues=validate_row(...)`, `drawn_at=now`. 러너가 건드리지 않는다.
- revise 카드 → `mode="revise"`, `status="pending"`. 러너 설문 생성 시 `existing_row` 전달.
- new 카드 → 현행.

### 2.5 프롬프트(정정)
- `build_questionnaire_messages(..., existing_row: dict | None = None)`: 있으면 user 메시지에 `[현재 등록된 내용]`(활동 seq·label·kind, fields, 엣지 요약). `L6_QUESTIONNAIRE_CONTRACT` 규칙 추가: 현재 등록된 내용이 있으면 질문은 "무엇을 바꿀지"를 묻고, `suggested`는 현재 값을 그대로 담는다(ordered 활동 질문의 options는 현재 활동 + 추가 후보).
- `build_row_messages(..., existing_row=None)`: 있으면 `[현재 등록된 내용]` 블록. `L6_ROW_DRAFTER_CONTRACT` 규칙 추가: 현재 내용을 바탕으로 답에서 바뀐 부분만 반영하고 나머지는 유지.
- 러너 `_generate_questionnaire`/`_draw_row`: `task.mode == "revise"`이면 `existing_row=_existing_row_of(session, task)`(existing 목록에서 code 일치).

### 2.6 정정 전환 엔드포인트
- `POST /framework-interviews/{id}/tasks/{task_pk}/revise`: `mode == "keep" and status == "drawn"`인 태스크만. `mode="revise"`, `status="pending"`, `questionnaire=answers=None`, `row` 유지(프리뷰용), 세션 `plan_locked`(reopen과 같은 규칙: `ready`/`linking`이면 되돌리고 `assembled=None`), `runner.kick`. 계획 카드의 `mode`도 revise로 갱신.
- 진행률: keep 태스크는 drawn으로 센다(변경 없음).

### 2.7 조립·등록
- `assemble_document`: 현행(drawn + row) — keep 태스크가 포함되므로 L5 relations가 기존 L6를 잇는다. 무변경 행은 임포트가 서명 비교로 건너뛴다(`_graph_signature`; 배치도 유지). revise/new 행은 코드 기준으로 갱신/생성.
- 외부 AI 프롬프트(`interview-json-prompt.ts`): `InterviewPromptTarget.existingL6?: {code, name}[]`를 받아 "이미 있는 L6" 목록을 넣고, 같은 taskId로 rows에 넣으면 갱신·빼면 그대로 둔다고 안내. 키 집합은 불변(3표면 규칙 위반 아님).

## 3. 세션 페이지 (frontend `components/framework-interview/`)
- `plan-editor.tsx`: `existing_code`가 있는 카드는 머리에 "기존" 칩(`fw-consult-plan-existing-{i}`) + 유지/정정 세그먼트(`fw-consult-plan-mode-{i}-keep|revise`), 삭제 버튼 비활성(병합이 되살리므로). 새 카드는 현행.
- `task-board.tsx`: `mode === "keep"` 태스크는 "기존" 칩 + [정정] 버튼(`fw-consult-revise-{id}`) → `reviseFrameworkTask`. 정정 태스크는 "정정" 칩. 나머지 현행.
- 계획 화면 머리: `session.existing.length > 0`이면 "이미 있는 L6 n개를 불러왔습니다" 안내(`fw-consult-existing-note`).
- `lib/api.ts`: `FwPlanCard.existing_code?/mode?`, `FwInterviewTask.mode`, `FwInterviewSession.existing: FwExisting[]`, `reviseFrameworkTask(sessionId, taskPk)`.
- 등록 dry run 리포트에서 keep 행은 "변경 없음"으로 보인다(임포트 리포트 현행 문구).

## 4. 검증
- backend: `test_framework_interview_existing.py`(map_to_row 라운드트립·merge_existing_cards), api 테스트(세션 생성 시 existing·잠금 시 keep/revise 태스크·revise 엔드포인트·plan 병합), contracts 테스트(existing 블록·현재 등록된 내용 블록), runner 테스트(revise 태스크가 existing_row를 넘김). 전체 그린 명령은 CLAUDE.md.
- frontend: tsc·lint·vitest·catalog. 스모크: `pw-fw-consult.mjs`(트리 행 클릭 → 우측 [AI로 L5 채우기]), `pw-fw-consult-new-l5.mjs`(L4 행 선택 → 이름 → 만들기), `pw-fw-admin-layout-shot.mjs`(휴지 상태·L5 선택·임포트 스트립 3장), `pw-fw-import-section-shot.mjs`(버튼 → 파일 → dry run), 신규 `pw-fw-consult-existing.mjs`(샘플 임포트로 L5+맵 준비 → 캠페인 → 기존 카드 칩 → 잠금 → keep 태스크 drawn → 정정 1건 → 설문 → 등록 dry run).
- 매뉴얼 ko/en "AI로 L5 채우기"·"카테고리 관리" 절 갱신, 스크린샷 `docs/qa/screens/` 갱신, PROGRESS.
