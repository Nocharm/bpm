# CSV 임포트 — 전체 교체에서 이름 기준 머지로 · 설계

날짜: 2026-07-10 · 브랜치: worktree-csv-import-merge · base: origin/main `42436e2`

## 목적

CSV 임포트가 기존 그래프를 통째로 버리고 새로 그리는 탓에, 임포트 후 버전 비교 화면이 **실제로 바뀌지 않은 것까지 전부 변경으로 잡는다.** 임포트를 이름 기준 머지로 바꿔 노드 정체성을 보존하고, 그 결과 비교가 진짜 변경만 보이게 한다. 아울러 새맵 다이얼로그에서 임포트를 걷어내 임포트 경로를 에디터 하나로 일원화한다.

## 배경 — 왜 "전부 잡히는가" (실측)

`frontend/src/lib/diff.ts`는 2단 매칭을 한다. 1차는 계보 키(`source_node_id ?? id`, `diff.ts:55`), 실패 시 2차로 `(부모계보, 제목)` fallback(`diff.ts:112`). 따라서 **제목이 같은 노드는 이미 짝지어진다.** 그럼에도 전부 잡히는 원인은 둘이다.

1. **엣지 diff에는 fallback이 없다.** `edgeKey`(`diff.ts:203`)가 노드의 raw 계보 키만 쓴다. `buildGraphFromCsv`가 만든 노드는 전부 새 `genId()`에 `source_node_id`가 없으므로, 좌우 엣지 키가 하나도 겹치지 않아 **모든 엣지가 removed/added**로 잡힌다.
2. **CSV가 싣지 않는 필드가 초기화된다.** `NODE_DEFAULTS`(`csv-import.ts:104`)가 `description`·`color`·`assignee`·`department`·`group_ids`를 빈 값으로 덮는다. 이 필드들은 `FIELD_KEYS`(`diff.ts:43`)에 포함되므로, 제목으로 짝지어진 노드도 `changed`로 **정당하게** 잡힌다.

여기에 더해 지금 임포트는 데이터를 실제로 파괴한다. `replace_graph`(`backend/app/routers/graph.py:120`)는 payload에 없는 노드를 지우면서 **그 노드의 코멘트까지 삭제**하고(`graph.py:194`), CSV가 `groups: []`를 보내므로 **그룹도 전부 삭제**한다(`graph.py:213`).

**결론: 비교 로직을 고치면 원인 1만 가려지고 원인 2는 못 고친다.** 이미 지워진 필드를 비교가 되살릴 수는 없다. 임포트를 고친다.

**백엔드는 이미 준비돼 있다.** `graph.py:242`의 노드 upsert는 `session.get(Node, node.id)`로 기존 id면 제자리 UPDATE하며 `source_node_id`를 건드리지 않는다. **프론트에서 노드 id만 재사용하면 계보·코멘트·그룹이 보존되고 엣지 키가 안정된다. 백엔드 변경 0줄.**

## 범위

②까지만 해도 비교 문제는 해결된다. ③은 그 위의 UX다.

| 단계 | 내용 | 단독 출하 |
|------|------|-----------|
| ① | 새맵 다이얼로그 축소 + 노티스 + 생성 후 항상 에디터 이동 | 가능 |
| ①-b | CSV 컬럼 확장 — Assignee(login_id)·Department + 해석 + 비차단 경고 | 가능 |
| ② | 임포트를 이름 기준 머지로 (id 재사용) | 가능 (비교 문제 해결) |
| ③ | 캔버스 프리뷰 + 인스펙터 Import 탭 (삭제/유지 선택) | ② 의존 |

## ① 새맵 다이얼로그 — 준비만, 임포트는 에디터에서

`frontend/src/components/csv-import-section.tsx`

- 다운로드·프롬프트 복사 두 버튼을 `CsvTemplateActions`로 추출한다. `CsvImportSection`은 이를 품고 파일선택·붙여넣기·요약을 덧붙인다 — 에디터 모달 동작은 무변경.
- 불리언 mode prop을 추가하지 않는다(단일 목적 컴포넌트 둘로 분리).

`frontend/src/components/permissions/create-map-dialog.tsx`

- `CsvImportSection` → `CsvTemplateActions`로 교체. 아래에 노티스 영역 추가.
- 제거: `csv`/`csvFileName` state, `createdRef`, `acquireCheckout`·`saveGraph` import, `handleCreate`의 CSV 분기, `canCreate`의 csv 절.
- `handleCreate`는 성공 시 **항상** `router.push(/maps/{id})`. 에디터는 draft 버전이면 마운트 시 체크아웃을 자동 획득하므로(`page.tsx:2207` poll) 도착 즉시 임포트 가능하다.
- `csvImport.mapCreatedImportFailed` 키는 미사용이 된다 — 삭제한다(이 변경이 만든 고아).

노티스 문구 (신규 키 `csvImport.createNotice`):

- EN: `Import the finished CSV from the editor after the map is created.`
- KO: `작성한 CSV는 맵 생성 후 편집 화면에서 임포트합니다.`

섹션 타이틀 `csvImport.sectionTitle`도 실제 동작에 맞춘다: `Start from CSV (optional)` → `Prepare a CSV (optional)` / `CSV 준비 (선택)`.

## ①-b CSV 컬럼 확장 — 담당자 · 부서

`frontend/src/lib/csv-import.ts`

컬럼은 8개가 된다 (순서는 템플릿 표기 순, **파서는 순서 무관**):

`Name, Assignee, Department, System, Duration, URL, URL_Label, Next`

### Assignee — login_id로 적고, 임포트가 이름으로 해석한다

`NodeIn.assignee`(`backend/app/schemas.py`)는 `default=""`, `max_length=100`이 전부다. **백엔드는 담당자 실재 여부를 검증하지 않는다.** 유일한 안전망은 프론트 렌더 시 배지다 — `driftedAssignees()`(`assignee.ts:44`)가 "노드 부서와 다른 부서 소속" 또는 "디렉터리에 없는 사람"을 찾아 `data.assigneeWarning`을 세우고 `process-node.tsx:440`이 배지를 그린다.

그런데 `node.assignee`에 저장되는 값은 **이름**이다 (`driftedAssignees`가 `u.name === name`으로 대조). CSV에는 login_id를 적으므로(사용자 확정), 임포트가 해석해야 한다:

- 셀은 login_id를 콤마로 나열한다. 복수면 셀 전체를 큰따옴표로 감싼다 — `"hong.gd, kim.cs"` (RFC4180, `parseCsvRecords`가 지원).
- 각 토큰을 `eligible.users`에서 `id`(login_id)로 찾아 `name`으로 바꾼다. 결과는 `formatAssignees()`가 `", "`로 잇는다.
- 못 찾은 토큰은 **원문 그대로 저장**하고 비차단 경고를 남긴다 — 기존 드리프트 배지가 임포트 후에도 잡아준다.
- 해석 **후** 길이를 검사한다(`max_length=100` 미러). id는 짧아도 이름은 길 수 있다.

`buildGraphFromCsv`는 순수 함수를 유지하되 디렉터리를 인자로 받는다. 디렉터리가 없으면 해석도 경고도 하지 않으므로, **에디터의 Import CSV 버튼을 `eligible !== null`로 게이팅**한다 — 로드 타이밍에 따라 결과가 달라지는 걸 막는다.

### Department — 정식 부서명 또는 한글 부서명

`node.department`는 org_path가 아니라 **말단 부서명**이다(`eligible.departments`가 그 목록, `DirectoryUserOut.department`). 셀 값이

1. `eligible.departments`에 있으면 그대로,
2. 어떤 부서의 `dept_infos[dept].korean_name`과 같으면 그 정식 부서명으로 치환,
3. 둘 다 아니면 원문 저장 + 비차단 경고.

### 비차단 경고 (`warnings`)

행 단위 경고를 `CsvImportOutcome.warnings`로 모아 임포트 요약과 Import 탭에 노출한다. **임포트를 막지 않는다** — "우선 등록하고 문제는 알려준다"가 사용자 확정 방침이다.

- 해석되지 않은 담당자 토큰
- 알 수 없는 부서
- 담당자들의 디렉터리 부서가 서로 다르거나 행의 Department와 어긋남 (`assignee.ts`의 "전원 같은 부서" 불변식)

### 빈 셀 = 기존 값 유지 (전 속성 열)

머지에서 **값이 있는 셀만 덮어쓴다.** 빈 셀은 기존 값을 지킨다. 근거는 기존 AI 프롬프트 자신이다 (`csv-import.ts:395`):

> `"문서에 없는 단계를 지어내지 말고, 불명확한 속성(System·Duration·URL)은 비워두세요."`

AI가 모르는 속성을 비워두게 지시해 놓고 빈 칸이 값을 지우면, AI가 만든 CSV를 재임포트할 때마다 기존 속성이 전멸한다. 따라서 `Assignee`·`Department`·`System`·`Duration`·`URL`·`URL_Label` 전부 "빈 셀 = 유지"다.

**`Next`는 예외다.** 빈 `Next`는 "이 단계가 말단"이라는 의미 있는 값이므로, 엣지는 CSV가 계속 **전량** 규정한다.

**대가:** CSV만으로는 속성을 지울 수 없다. 지우려면 에디터에서 직접 비운다. 데이터 파괴보다 이쪽이 낫다.

⚠️ 서브프로세스 노드는 담당자·부서를 링크맵 지정값(`spAssignee`/`spDepartment`)으로 표시하고 `hasBpmAttributes("subprocess")`가 `false`다. 매칭된 서브프로세스 노드에 CSV 담당자를 써도 렌더되지 않는다(무해하나 무의미). 특별 처리하지 않는다.

## ② 이름 기준 머지 임포트

`frontend/src/lib/csv-import.ts`

`buildGraphFromCsv(text)` → `buildGraphFromCsv(text, context?)`. `context.base`가 없으면 현행(전량 신규)과 동일하게 동작한다 — 빈 맵 임포트 경로가 그대로 산다.

### 매칭 규칙

| 대상 | 키 | 비고 |
|------|-----|------|
| Start | 기존 `node_type === "start"` 노드 | `validate_process`(`backend/app/subprocess.py:17`)가 정확히 1개를 보장 |
| End | 기존 대표 끝(`is_primary_end`), 없으면 `sort_order` 최소 끝 | |
| 데이터 행 | 나머지 기존 노드와 **제목 완전일치** | CSV는 중복 이름을 이미 거부(`csv-import.ts:199`) |

Start/End는 **기존 제목을 유지한다** — CSV가 이름을 싣지 않으므로 `"시작"`을 `"Start"`로 덮으면 거짓 변경이 된다.

### 매칭된 노드

- `id`를 재사용한다. **이것이 이 설계의 전부다** — 계보·코멘트·그룹이 여기서 보존된다.
- `title`은 매칭 키이므로 불변.
- **값이 있을 때만 덮어쓰기**: `assignee`(해석된 이름), `department`(정식 부서명), `system`, `duration`, `url`, `url_label`. 빈 셀은 기존 값을 지킨다(위 "빈 셀 = 기존 값 유지").
- **항상 덮어쓰기**: `node_type` — CSV의 `Next` 개수가 `process`/`decision`을 결정한다.
- **항상 보존**: `description`, `color`, `group_ids`, `linked_map_id`, `follow_latest`, `linked_version_id`, `pos_x`, `pos_y`. CSV가 싣지 않는 필드다.
- **예외 — 서브프로세스 노드**(`linked_map_id !== null`)는 `node_type`도 보존한다. CSV 추론값(`process`)으로 덮으면 Call Activity 링크 렌더가 깨진다. (확정)

`url_label`의 기존 캐스케이드 규칙(URL 없는 라벨은 무시)은 유지한다. 단 "빈 셀 = 유지" 아래에서는 **행의 URL 셀이 비어 있어도 기존 노드에 URL이 있으면** 라벨이 유효하다 — `ignoredLabelCount`는 *결과 노드에 URL이 없는* 경우만 센다.

### 신규 · 소멸 노드

- CSV에만 있는 행 → `genId()` 신규 노드. `diffStatus: "added"`.
- 기존에만 있는 노드 → `diffStatus: "removed"`. 삭제/유지는 ③에서 사용자가 고른다. ②만 단독 출하할 경우 기본 삭제.

### 엣지 · 그룹 · 좌표

- **엣지**: CSV의 `next`가 전부 규정한다(자동 `Start→루트`, `말단→End` 포함). 해석된 id를 참조한다.
- **그룹**: 기존 `base.groups`를 그대로 통과시킨다. 소멸 노드의 멤버십만 빠진다.
- **좌표**: 매칭 노드는 기존 좌표 유지. 신규 노드만 그래프 아래에 배치(`page.tsx:1703-1708`의 `baseY = maxY + 140`, `x=80`, 120px 간격 패턴 재사용) 후 신규 id 집합에 `layoutSubsetWithDagre`. **전체 dagre를 돌리지 않는다** — 사용자 레이아웃 파괴 방지.

### 왜 비교가 고쳐지는가

id 보존 → `graph.py:242` upsert가 제자리 UPDATE → `source_node_id` 생존 → `getLineageKey` 매칭 → `edgeKey`(`diff.ts:203`) 안정. 원인 1 해소. 그리고 CSV 미탑재 필드를 보존하므로 원인 2 해소.

## ③ 캔버스 프리뷰 + 인스펙터 Import 탭

### 프리뷰 상태 기계 (일반화)

`frontend/src/app/maps/[mapId]/page.tsx`

`aiPreviewRef` → `previewRef`로 이름을 바꾸고 CSV와 공유한다. 기존 AI 경로의 동작은 불변.

```
pushHistory()                 // 스냅샷 1회
previewRef.current = true     // saveCurrentScope(1332)·scheduleAutoSave(1363) 차단
setNodes/setEdges/setGroups   // 병합 결과를 캔버스에만
layoutSubsetWithDagre(added)  // 직접 호출
commit  = previewRef 해제 + saveCurrentScope()
discard = previewRef 해제 + undo()
```

⚠️ **`applyAutoLayout`을 호출하면 안 된다.** 내부에 `pushHistory()`가 있어(`page.tsx:3014`) undo 스택이 2단이 되고, Cancel의 `undo()` 한 번이 정렬만 되돌린 채 임포트를 캔버스에 남긴다. `layoutSubsetWithDagre`를 직접 부른다. 이 함수는 `subset.length < 2`면 no-op이므로(`canvas.ts`), 신규 노드가 1개일 때를 위해 초기 배치를 반드시 준다.

### 캔버스 하이라이트

노드는 **새 렌더링 코드가 필요 없다.** 에디터(`page.tsx:197`)와 비교(`compare/page.tsx:79`)가 같은 `nodeTypes = { process: ProcessNode }`를 쓰고, `ProcessNode`는 `data.diffStatus`를 읽어 diff 테두리·틴트·뱃지를 그린다(`process-node.tsx:408`). `canvas.ts:33`의 주석대로 "에디터에서는 미설정"일 뿐이다. 프리뷰 노드에 `diffStatus`를 채우면 끝.

엣지는 비교와 동일한 인라인 스타일을 얹는다 — `stroke: var(--color-removed)`, `strokeWidth: 2`, `strokeDasharray: "6 3"` (`compare/page.tsx:257-259`). 비교의 `RemovedArcEdge`는 불필요하다(프리뷰에선 양 끝 노드가 캔버스에 남아 있다).

### 인스펙터 Import 탭

`frontend/src/components/inspector-panel.tsx`

- `InspectorTab` 유니온에 `"import"` 추가. 이 탭은 프리뷰 중에만 `TABS`에 나타난다.
- prop 2개 추가: `forcedTab?: InspectorTab`, `lockTabs?: boolean`. 내부 `useState`(`inspector-panel.tsx:87`)는 유지하고 `tab = forcedTab ?? internalTab`으로 파생한다 — 상태를 끌어올리지 않아 4개 슬롯 소비자가 흔들리지 않고, `react-hooks/set-state-in-effect`(`frontend/AGENTS.md`)도 피한다.
- `lockTabs`면 다른 탭 버튼과 **접기 버튼(`onCollapse`, line 97)을 함께 비활성화**한다.

⚠️ 접기를 막지 않으면 AI 패널이 현재 갖고 있는 덫을 재현한다: `page.tsx:7173`의 마운트 조건 때문에 AI 창을 닫거나 최소화하면 Apply/Discard가 사라지는데 `previewRef`는 `true`로 남아 자동저장이 꺼진 채 빠져나올 수 없다. (기존 잠복 버그 — 이번 범위 밖, 기록만.)

### 탭 내용

- **요약**: `MarkdownView`(`frontend/src/components/markdown-view.tsx`) 재사용. 카운트와 "매칭된 노드는 코멘트·색·그룹을 유지하고, CSV가 비워둔 칸은 기존 값을 지킵니다" 안내.
- **경고 목록**: `warnings`가 있으면 행 번호와 함께 표시(해석 안 된 담당자·알 수 없는 부서·부서 불일치). 임포트를 막지 않는다.
- **삭제 대상 목록**: 일반 React 리스트. **`MarkdownView`에 넣지 않는다** — 노드 제목이 마크다운으로 해석되어 `**긴급**`은 굵게, `#출고`는 태그 알약(인라인 태그 필 로직 실재), `[검토](x)`는 링크로 변질된다. 또 마크다운 출력은 HTML 문자열이라 클릭 핸들러를 달 수 없다. 리스트로 두면 제목 클릭 → `highlightNode`(`page.tsx:1747`) 포커스가 된다.
- **컨트롤**: 세그먼트 `[Delete] [Keep]` + `Apply` / `Cancel`.

### 유지(Keep)의 의미 — 확정

**노드만 남고 그 엣지는 전부 사라진다.** `removeOutgoingEdges`(`canvas.ts:504`) 주석대로 decision을 뺀 노드는 출력이 1개로 강제되므로, 유지 노드로 들어오던 엣지를 살리면 출발 노드가 출력 2개가 되어 규칙을 위반한다. 나가던 엣지는 CSV가 흐름 전체를 규정하므로 사라진다. 결과가 프리뷰의 빨간 점선과 정확히 일치한다.

### 버튼 호버 문구

`Tooltip`(`frontend/src/components/tooltip.tsx`)을 쓴다 — portal+fixed라 인스펙터의 `overflow-y-auto`(`inspector-panel.tsx:130`)에 잘리지 않고, `content` prop으로 리치 카드(2줄)를 받는다. `IconTip`은 absolute라 잘린다.

| 버튼 | 문구 (EN, `design.md` §5에 따라 UI 영어) |
|------|------|
| Delete | **Removes {n} nodes and {m} connections.** / Nodes missing from the CSV are deleted, along with their comments. |
| Keep | **Keeps {n} nodes, drops {m} connections.** / A node has a single output, so the old links can't survive the CSV's flow. Reconnect them manually after import. |
| Apply | **Saves the merged map to this version.** |
| Cancel | **Discards the import.** / The canvas returns to how it was. |

- 코멘트 삭제 경고는 실제 동작이다(`graph.py:194`) — 현재 확인 모달에는 빠져 있다.
- Keep 첫 줄은 기존 i18n 문구(`i18n-messages.ts:663`, `"A node has a single output — use a Decision node to branch."`)의 표현을 따른다. 그 키 자체는 **정의만 되고 미사용**이다(dead copy, 범위 밖).
- **가정**: 사용자가 요청한 원문은 "노드는 2개의 출력을 가질 수 없어 엣지들은 삭제된다"였다. 이는 들어오는 엣지에 대해선 정확하나 나가는 엣지가 사라지는 이유(CSV가 흐름 전체를 규정)는 설명하지 못해 위와 같이 2줄로 다듬었다. 문구는 되돌리기 쉬우므로 이 안으로 진행한다.

## 파생 산출물 갱신

컬럼이 8개로 늘어나므로 함께 고친다.

- `buildTemplateCsv()` — 헤더와 예시 4행에 `Assignee`(login_id)·`Department` 추가.
- `buildAiPromptText()` — 두 컬럼 규칙 + "복수 담당자는 콤마로 나열하고 셀을 큰따옴표로 감쌀 것" + "담당자는 사번/계정 id로 적을 것" 추가.
- `docs/samples/*.csv` 3종 — **이미 낡았다.** 헤더가 `Name,System,Duration,URL,Next`로 `URL_Label`이 빠져 있다(템플릿은 6열). 파서가 열 부분집합을 허용해 조용히 통과 중이었다. 8열로 재작성한다.

## 검증

- `frontend/src/lib/csv-import.test.ts` — 컬럼 케이스 신규: ⓐ login_id → 이름 해석, ⓑ 복수 담당자(따옴표 셀) 해석·`", "` 결합, ⓒ 미해석 토큰 원문 저장 + 경고, ⓓ 한글 부서명 → 정식 부서명 치환, ⓔ 알 수 없는 부서 경고, ⓕ 해석 후 100자 초과 에러, ⓖ 디렉터리 미지정 시 해석·경고 없음.
- `frontend/src/lib/csv-import.test.ts` — 머지 케이스 신규: ⓐ 제목 일치 시 id 재사용, ⓑ CSV 미탑재 필드(color/description/group_ids) 보존, ⓒ **빈 셀이 기존 assignee·department·system을 지키는지**, ⓓ 값 있는 셀이 덮어쓰는지, ⓔ 서브프로세스 노드의 `node_type` 보존, ⓕ Start/End 제목 보존, ⓖ 소멸 노드 삭제/유지 두 모드, ⓗ `base` 미지정 시 현행 동작 불변(회귀).
- `frontend/src/lib/diff.test.ts` — **신규 파일**(현재 `diff.ts`에는 테스트가 없다; `merge-diff.test.ts`는 별개 모듈). 머지 임포트 결과를 좌/우로 넣어 **변경 노드만** entries에 잡히고 미변경 엣지가 added/removed로 안 잡히는지.
- `npm run lint` · `npm test` · `npm run build` 전부 통과.
- 백엔드 무변경 → `pytest`는 회귀 확인용으로만 1회.
- **브라우저 실검증**(`docs/lessons/browser-verification.md`): 로컬 네이티브로 맵 하나에 CSV 임포트 → 프리뷰 하이라이트 육안 확인 → Apply → 비교 화면에서 실제 변경만 잡히는지 확인. 좀비 `next dev` 전수 `pkill` 선행.

## 결정 기록

- **머지 vs 비교 수정**: 머지. 비교 수정은 엣지 오탐만 가리고 필드 초기화·코멘트 삭제는 못 고친다.
- **CSV에 없는 노드**: 사용자 선택(삭제/유지). 유지는 노드만.
- **서브프로세스 `node_type`**: 보존. (사용자 확정)
- **생성 후 이동**: 항상 에디터로. (사용자 확정, A안)
- **Assignee 열**: login_id를 적고 임포트가 이름으로 해석. 못 찾으면 원문 저장 + 경고. (사용자 확정)
- **Department 열**: 정식 부서명 또는 한글 부서명. 못 찾으면 원문 저장 + 경고.
- **빈 셀**: 전 속성 열에서 기존 값 유지. 사용자는 Assignee/Department에 대해서만 답했으나, AI 프롬프트(`csv-import.ts:395`)가 "불명확한 속성(System·Duration·URL)은 비워두라"고 지시하므로 빈 칸이 값을 지우면 AI 생성 CSV 재임포트가 속성을 전멸시킨다. 전 열에 일관 적용한다. `Next`만 예외(빈 값 = 말단).
- **담당자 검증**: 임포트를 막지 않는 경고. 백엔드 검증은 존재하지 않으며(`NodeIn`은 길이만 본다) 안전망은 프론트 드리프트 배지 한 겹뿐이다.

## 범위 밖 (기록만)

- `csvImport.confirmDelete` 문구가 코멘트 삭제를 언급하지 않는다.
- `edge.outputSwapped`(`i18n-messages.ts:663`, `1925`)는 정의만 되고 미사용이다.
- AI 프리뷰 중 AI 창을 닫거나 최소화하면 Apply/Discard가 사라진 채 자동저장이 꺼진 상태에 갇힌다(`page.tsx:7173` + `1332`).
- `diff.ts`의 노드 fallback 매칭과 엣지 `edgeKey`가 비대칭이다. 이번 머지로 CSV 경로에서는 문제가 안 되지만 구조적 불일치는 남는다.

## 충돌 예고

main에서 진행 중인 "AI 권한 게이트 · proposal 페이로드 저장"(`ab41430` 스펙)이 `page.tsx`·`ai-chat-panel.tsx`를 건드릴 가능성이 크다. 본 브랜치도 `page.tsx`의 `aiPreviewRef`를 일반화하므로 머지 충돌을 예상한다.
