# CSV로 새 맵 만들기 + 클립보드 복사 수정 — 설계

날짜: 2026-07-10 · 브랜치: worktree-csv-create-flow · base: `aa87766`

## 목적

CSV를 손에 든 사용자가 홈에서 곧장 맵을 만들 수 있게 한다. 파일을 떨구고 요약을 확인한 뒤 협업자·결재자만 고르면 생성된다. 겸해서 **모든 복사 버튼이 서버에서 조용히 실패하던 버그**를 고친다.

## 배경 — 클립보드는 "안 되는 것 같다"가 아니라 확정된 버그다

복사하는 곳이 네 군데이고 전부 이렇게 쓴다:

```ts
void navigator.clipboard?.writeText(text);
```

- `frontend/src/components/csv-template-actions.tsx:32` (AI 프롬프트)
- `frontend/src/components/markdown-view.tsx:179, 188, 198` (AI 답변 코드 블록 3종)

`navigator.clipboard`는 **secure context(HTTPS 또는 localhost)에서만 정의된다.** `CLAUDE.md`가 못박아 둔 대로 이 서버는 **원격 IP + 평문 HTTP**다 — `crypto.randomUUID`가 죽는 것과 같은 이유로 `navigator.clipboard`가 `undefined`다. 그런데 `?.`가 그걸 삼켜서 **에러도 없이 아무 일도 일어나지 않는다.** 더 나쁜 건 버튼이 "복사됨!"으로 바뀐다는 것 — UI가 거짓말을 한다.

로컬에서 재현되지 않은 이유도 같은 문서에 있다: *"localhost는 secure context라 재현 안 됨 — 서버/원격 IP로 검증"*.

## 범위

A와 B는 단독 출하 가능. C는 B 없이도 동작한다(매뉴얼 버튼만 숨겨짐).

| 조각 | 내용 | 단독 출하 |
|------|------|-----------|
| A | 클립보드 공용 헬퍼 + 호출부 4곳 | 가능 |
| B | 백엔드 `csv_manual_url` (Settings → `/api/me`) | 가능 |
| C | 홈 분할 버튼 → CSV 모달 → 생성 다이얼로그 | 가능 |

## A. 클립보드 — `frontend/src/lib/clipboard.ts` (신규)

```ts
/** 복사 성공 여부를 돌려준다. 서버는 평문 HTTP(insecure context)라 navigator.clipboard가 없다. */
export async function copyText(text: string): Promise<boolean>
```

1. `navigator.clipboard`가 있으면 `writeText` 시도, 성공하면 `true`.
2. 없거나 실패하면 화면 밖 `<textarea>` + `document.execCommand("copy")` 폴백.
3. 둘 다 실패하면 `false`.

**호출부는 반환값을 반드시 본다.**

- `csv-template-actions.tsx` — 실패 시 "복사됨!" 대신 `text-error`로 실패 문구(신규 키 `csvImport.promptCopyFailed`)를 1.6초 노출.
- `markdown-view.tsx` ×3 — `.md-copied` 하이라이트와 `onCopy?.()` 콜백을 **성공했을 때만** 실행.

### 테스트 불가 — 정직하게 기록

`frontend/vitest.config.ts`는 **node 환경**이고 jsdom이 없다(18개 테스트 전부 순수 `lib/`). `document`·`navigator`를 만지는 `copyText`는 이 하네스에서 단위 테스트할 수 없다. jsdom을 새 devDependency로 넣는 것은 별개 결정이므로 **하네스를 지어내지 않는다.**

검증은 브라우저로 하되 **반드시 평문 HTTP 오리진(서버 IP)에서** 한다. localhost는 secure context라 고치기 전에도 통과한다 — 이 버그를 놓친 원인이 바로 그것이다.

## B. 백엔드 — `csv_manual_url`

기존 `manual_url`과 **완전히 같은 경로**를 따른다. DB 스키마는 건드리지 않는다.

| 파일 | 변경 |
|------|------|
| `backend/app/settings.py` | `csv_manual_url: str = ""` (주석: 비우면 CSV 모달의 매뉴얼 버튼 숨김) |
| `backend/app/schemas.py` | `MeOut.csv_manual_url: str = ""` |
| `backend/app/main.py` | `csv_manual_url=settings.csv_manual_url,` (기존 `manual_url` 옆) |
| `.env.example` | `CSV_MANUAL_URL=` + 예시 주석 |

**기존에 `manual_url`을 단언하는 백엔드 테스트는 없다** (`grep manual_url backend/tests/` → 0건). `backend/tests/test_maps.py:161`이 이미 `/api/me`를 GET하므로 그 자리에 `csv_manual_url` 키 존재와 기본값 `""` 단언을 더한다.

프론트는 `getMe()`가 이미 부르는 곳에서 받는다 — 홈(`app/page.tsx`)과 에디터(`maps/[mapId]/page.tsx`).

## C. CSV로 새 맵 만들기

### C1. 홈 진입점 — 분할 버튼

`frontend/src/app/page.tsx:365-371`의 `New map` 버튼 우측에 쉐브론 버튼을 붙인다. 재사용할 드롭다운 프리미티브가 없다(`map-name-dropdown.tsx`는 287줄짜리 전용 컴포넌트). 항목 하나짜리 작은 메뉴를 그 자리에 만든다 — 바깥 클릭·`Escape` 닫기.

- `data-id="home-create-menu-toggle"` (쉐브론), `data-id="home-create-from-csv"` (메뉴 항목, `FileUp` 아이콘).
- 기존 `New map` 버튼의 동작(빈 다이얼로그)은 그대로.

### C2. `frontend/src/components/csv-create-modal.tsx` (신규)

두 단계 모달.

**1단계 — 파일 고르기**
- 드롭존: `onDragOver`/`onDrop`, 클릭하면 숨은 `<input type="file" accept=".csv,text/csv">`가 열린다(탐색기 창).
- 버튼 3개는 `CsvTemplateActions`가 그린다(아래 C4).
- 파일을 받으면 `decodeCsvBuffer` → `buildGraphFromCsv(text, { directory })`.
  - **`base`를 넘기지 않는다** — 새 맵이라 머지할 대상이 없다. 전량 신규 + 전체 dagre 경로.
- 파싱 에러가 있으면 행 단위 에러 목록을 보여주고 `[확인]`을 막는다.

**2단계 — 요약**
- `[확인]`을 누르면 `노드 N개 · 연결 M개를 만듭니다`(신규 키 `csvImport.createSummary`)와 비차단 경고 목록을 보여준다.
- `[뒤로]`로 1단계 복귀, `[계속]`으로 모달을 닫고 생성 다이얼로그에 `{ outcome, fileName }`을 넘긴다.

### C3. 담당자·부서 해석 — 소스가 다르다

에디터는 `listEligibleAssignees(versionId)`를 쓰지만 **맵을 만들기 전에는 버전이 없다.** 대신 `getDirectory()`로 `CsvDirectory`를 조립한다.

```ts
// lib/csv-import.ts — 순수 함수, 테스트 대상
export function toCsvDirectory(dir: Directory): CsvDirectory
```
`getDirectory()`의 반환 타입은 `Directory`다(`DirectoryOut`이 아니다, `lib/api.ts`).

- `users` ← `dir.users` 중 `{ id, name, department }`
- `departments` ← `dir.departments.map(d => d.name)` (말단 부서명 — `node.department`가 담는 값. `DirectoryDept.id`는 org_path라 쓰면 안 된다)
- `dept_infos` ← `korean_name`이 **빈 문자열이 아닌** 부서만 `{ [정식명]: { korean_name } }`. `DirectoryDept.korean_name`은 `string | undefined`가 아니라 `string`이고 없을 때 `""`다 — `filter(Boolean)`으로 거른다.

범위 차이를 의식한다: `eligible`은 그 맵을 볼 수 있는 사람만, `directory`는 전 직원이다. **생성 시점엔 협업자가 아직 없으므로 전 직원이 맞다.**

⚠️ 에디터가 `eligible !== null`로 임포트를 게이팅하듯, **디렉터리 로드 전에는 `[확인]`을 막는다.** 안 그러면 같은 CSV가 로드 타이밍에 따라 다르게 해석된다.

### C4. `CsvTemplateActions` — 매뉴얼 버튼 추가

`manualUrl?: string` prop을 더하고 버튼 순서를 `양식 다운로드 · CSV 임포트 매뉴얼 · 다른 AI에게 부탁하기`로 한다. 값이 비면 가운데 버튼을 숨긴다.

`CsvImportSection`(에디터 임포트 모달)도 같은 컴포넌트를 쓰므로 매뉴얼 버튼이 함께 붙는다. CSV 형식 설명은 거기서도 필요하니 그대로 둔다 — `maps/[mapId]/page.tsx`가 `getMe()`에서 받은 값을 내려준다.

프롬프트 복사 버튼의 라벨을 바꾼다: `csvImport.copyPrompt` → EN `"Ask another AI"` / KO `"다른 AI에게 부탁하기"`.

### C5. `CreateMapDialog` 확장

**선택 prop** `csv?: { outcome: CsvImportOutcome; fileName: string }`.

⚠️ **반드시 optional이다.** 이 컴포넌트는 홈 말고 `map-name-dropdown.tsx`(에디터 상단바)도 마운트한다. 필수 prop을 넣으면 그쪽이 깨진다.

- **CSV 준비 섹션을 통째로 제거**한다(템플릿·프롬프트·노티스). `csvImport.createNotice`는 고아가 되므로 삭제.
- 그 자리에 `csv`가 있을 때만 **파일 아코디언**:
  ```
  ▸ sales-process.csv
      노드 12개 · 연결 14개를 만듭니다
      ⚠ 4행: Unknown assignee "ghost.id"
  ```
  클릭으로 펼침/접힘.
- **이름·설명 프리필**: 확장자를 뗀 파일명. `useState` **초기값**으로 넣는다 — 이펙트 안 setState는 `react-hooks/set-state-in-effect`가 막는다.
  ```ts
  // lib/csv-import.ts — 순수 함수, 테스트 대상
  export function stripCsvExtension(fileName: string): string
  ```
- **생성**: `createMap` → 협업자 → 결재자 → (csv면) `acquireCheckout(versionId)` + `saveGraph(versionId, csv.outcome.graph)` → `router.push(/maps/{id})`.

### C6. 저장 실패 처리 — `createdRef` 복원

`createMap`은 성공했는데 체크아웃·저장이 실패하면(423 경합·네트워크) 다이얼로그를 유지하고 인라인 에러를 보여준다. `createdRef`에 `{ mapId, versionId }`를 기억해 두어, **Create를 다시 눌러도 맵을 재생성하지 않고** 체크아웃+저장만 재시도한다.

지웠던 키 `csvImport.mapCreatedImportFailed`를 되살린다.

### C7. AI 프롬프트 한 줄 수정

현재 문구는 머지 전용이라 새 맵 맥락에서 헷갈린다.

- 현재: `"빈 칸은 기존 값을 지웁니다가 아니라 '건드리지 않음'입니다 — 이미 있는 맵에 임포트해도 기존 값이 보존됩니다."`
- 수정: `"빈 칸은 '건드리지 않음'입니다 — 새 맵이면 빈 값으로 두고, 이미 있는 맵에 임포트하면 기존 값이 보존됩니다."`

## 결정 기록

- **백엔드 변경**: 승인. `manual_url`과 같은 경로(Settings → `/api/me`). `NEXT_PUBLIC_`은 빌드 시점에 박혀 값 변경에 재빌드가 필요해 기각.
- **클립보드 수정 범위**: 네 곳 전부. 같은 원인이고, `markdown-view`를 두면 AI 챗 코드 복사가 서버에서 계속 조용히 죽는다.
- **저장 실패**: 다이얼로그 유지 + 재시도(`createdRef`). Task 1 이전 동작 복원.
- **생성 시 임포트 재도입**: Task 1이 이를 제거한 이유는 *경고 없이 그래프를 써버려서*였다. 새 설계는 요약·확인 단계가 있고 빈 맵이라 잃을 데이터가 없다. 그 이유가 사라졌으므로 정당하다.

## 검증

**순수 로직(TDD):**
- `stripCsvExtension` — `.csv`/`.CSV` 제거, 확장자 없음, 점 여러 개(`a.b.csv` → `a.b`), 빈 문자열.
- `toCsvDirectory` — `departments`가 말단명, `dept_infos`가 `korean_name` 보유 부서만, 빈 디렉터리.

**게이트:** `npm run lint` 0 errors · `npm test` (219 + 신규) · `npm run build` · `pytest`(백엔드 변경 있으므로 실행).

**브라우저(사용자 터미널 필요):** 스크립트 `frontend/scripts/pw-verify-csv-create-flow.mjs`로 작성하되, **클립보드 항목은 평문 HTTP 오리진에서만 유효**하다는 것을 스크립트 헤더와 로그에 못박는다. localhost에서 돌리면 클립보드 단언은 `SKIP`으로 보고한다.

## 범위 밖 (기록만)

- jsdom 도입 및 컴포넌트 테스트 하네스.
- `map-name-dropdown.tsx`에 "CSV로 새 맵" 항목 추가.
- 이전 브랜치의 `pw-verify-csv-import-merge.mjs` 7시나리오는 **아직 미실행**이다.
