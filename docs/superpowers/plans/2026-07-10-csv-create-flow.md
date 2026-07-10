# CSV로 새 맵 만들기 + 클립보드 복사 수정 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈에서 CSV 파일 하나로 맵을 만들 수 있게 하고, 서버에서 조용히 실패하던 모든 복사 버튼을 고친다.

**Architecture:** 세 조각이 거의 독립이다. Ⓐ `lib/clipboard.ts`의 `copyText()`가 secure context 여부를 스스로 판단해 폴백하고 **성공 여부를 돌려준다** — 호출부 4곳이 그 값을 보고 실패를 표시한다. Ⓑ 백엔드가 `csv_manual_url`을 `/api/me`로 내려준다(기존 `manual_url`과 동일 경로, DB 무변경). Ⓒ 홈의 분할 버튼 → CSV 드롭존 모달(파싱·요약) → `CreateMapDialog`가 파싱 결과를 받아 파일 아코디언·이름 프리필을 보여주고, 생성 후 그래프를 저장한다.

**Tech Stack:** Next.js (App Router) · TypeScript strict · FastAPI + Pydantic · vitest (node 환경) · pytest · Tailwind(@theme 토큰)

**설계 문서:** `docs/superpowers/specs/2026-07-10-csv-create-flow-design.md`

## Global Constraints

- 브랜치 `worktree-csv-create-flow`, 워크트리 `.claude/worktrees/csv-create-flow`. **모든 명령은 이 디렉터리에서.** 원본 저장소로 `cd` 금지. 프론트 명령은 `frontend/`에서, 백엔드는 `backend/`에서.
- **컴포넌트 테스트 하네스가 없다.** `frontend/vitest.config.ts`는 `include: ["src/**/*.test.ts"]` (`.tsx` 아님) 이고 **node 환경**이다 — `document`·`navigator`가 없다. 18개 테스트 전부 순수 `lib/`. **jsdom을 추가하지 말고, 컴포넌트 테스트를 지어내지 말 것.** UI는 `npm run lint` + `npm test` + `npm run build` + 브라우저로 검증한다.
- **`copyText()`는 이 하네스에서 단위 테스트할 수 없다.** 그렇다고 "테스트했다"고 쓰지 말 것. 브라우저 검증은 **평문 HTTP 오리진(서버 IP)** 에서만 유효하다 — localhost는 secure context라 고치기 전에도 통과한다.
- Raw hex 금지. 색은 토큰(`text-ink-secondary`, `bg-surface-alt`, `text-error`, `border-hairline`, `bg-accent`, `text-on-accent`, `hover:bg-accent-focus` 등).
- UI 문구는 영어, 주석은 한국어. i18n 키는 `en`·`ko` **양쪽** 블록에 넣는다 (`ko`가 `Record<MessageKey, string>`이라 누락 시 타입 에러).
- 아이콘은 Lucide, `size={14}` 또는 `16`, `strokeWidth={1.5}`.
- React Compiler — `useCallback`/`useMemo`의 선언 deps가 추론 deps와 다르면 lint가 **빌드를 깬다**(`react-hooks/preserve-manual-memoization`). **렌더 중 ref 읽기 금지**(`react-hooks/refs`). **이펙트 안 동기 setState 금지**(`react-hooks/set-state-in-effect`) — 이펙트가 등록한 *이벤트 리스너* 안의 setState는 괜찮다.
- **`grep`이 ugrep이라 `[mapId]` 같은 대괄호 디렉터리를 조용히 건너뛴다.** 지난 브랜치에서 다섯 에이전트가 여기 속았다. 그 경로 검색과 "이 키가 아직 쓰이나" 확인은 python이나 `find`로 한다.
- 에러를 삼키지 않는다. `.catch(() => {})` 금지 — 상태에 담아 사용자에게 보인다.
- 커밋 메시지: `type(scope): English summary — 한국어 요약`. **커밋마다 `PROGRESS.md` 한 줄을 같은 커밋에** (`rules/common/git.md`). 말미에:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01AhULXV6HVeYVdyAn9ax8Tc
  ```

### 도메인 사실 (실측 — 추측하지 말 것)

- `navigator.clipboard`는 **secure context 전용**이다. 서버는 원격 IP + 평문 HTTP → `undefined`. 네 호출부 전부 `navigator.clipboard?.writeText()`라 `?.`가 실패를 삼킨다.
- `document.execCommand("copy")`는 **사용자 제스처 컨텍스트 안에서 동기적으로** 호출해야 한다. `await` 뒤에 부르면 브라우저가 거부할 수 있다.
- `getDirectory()`의 반환 타입은 **`Directory`** 다 (`DirectoryOut` 아님, `frontend/src/lib/api.ts`). `Directory = { users: DirectoryUser[]; departments: DirectoryDept[] }`.
- `DirectoryDept = { id: string /* org_path */; name: string /* 말단 세그먼트 */; korean_name: string /* 없으면 "" */; manager: string }`. `node.department`가 담는 값은 **`name`**(말단명)이지 `id`(org_path)가 아니다.
- `DirectoryUser` 에는 `id`(login_id)·`name`·`department`가 있다.
- 홈(`frontend/src/app/page.tsx`)은 `getMe()`를 **부르지 않는다.** CSV 모달이 직접 가져와야 한다.
- `CreateMapDialog`는 홈 말고 **`frontend/src/components/map-name-dropdown.tsx`도 마운트한다.** 새 prop은 반드시 optional.
- `manual_url`을 단언하는 백엔드 테스트는 **없다**. `backend/tests/test_maps.py:159` `test_me_includes_is_sysadmin` 이 `/api/me`를 GET하는 유일한 형태 참고.

## File Structure

| 파일 | 책임 | 변경 |
|------|------|------|
| `frontend/src/lib/clipboard.ts` | 복사 — secure/insecure 분기 + boolean 반환 | 생성 (T1) |
| `frontend/src/components/csv-template-actions.tsx` | 양식 다운로드 · 매뉴얼 · AI 프롬프트 3버튼 | 수정 (T1, T4) |
| `frontend/src/components/markdown-view.tsx` | 코드 복사 3곳 | 수정 (T1) |
| `backend/app/settings.py` · `schemas.py` · `main.py` · `.env.example` | `csv_manual_url` | 수정 (T2) |
| `backend/tests/test_maps.py` | `/api/me` 필드 단언 | 수정 (T2) |
| `frontend/src/lib/csv-import.ts` | `stripCsvExtension` · `toCsvDirectory` | 수정 (T3) |
| `frontend/src/lib/csv-import.test.ts` | 위의 단위 테스트 | 수정 (T3) |
| `frontend/src/app/maps/[mapId]/page.tsx` | 에디터가 `csv_manual_url` 전달 | 수정 (T4) |
| `frontend/src/components/csv-import-section.tsx` | `manualUrl` 통과 | 수정 (T4) |
| `frontend/src/components/csv-create-modal.tsx` | 드롭존 + 준비 액션 + 요약 2단계 | 생성 (T5) |
| `frontend/src/app/page.tsx` | 분할 버튼 + 메뉴 + 모달 마운트 + 핸드오프 | 수정 (T5) |
| `frontend/src/components/permissions/create-map-dialog.tsx` | `csv` prop · 프리필 · 아코디언 · `createdRef` | 수정 (T6) |
| `frontend/src/lib/i18n-messages.ts` | 신규/수정/삭제 키 | 수정 (T1, T4, T5, T6) |
| `frontend/scripts/pw-verify-csv-create-flow.mjs` | 브라우저 검증 | 생성 (T7) |

---

### Task 1: 클립보드 — `copyText()` + 호출부 4곳

**Files:**
- Create: `frontend/src/lib/clipboard.ts`
- Modify: `frontend/src/components/csv-template-actions.tsx`
- Modify: `frontend/src/components/markdown-view.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Produces: `export async function copyText(text: string): Promise<boolean>`

**테스트 없음 — 이유를 기억할 것.** vitest는 node 환경이고 `include`가 `*.test.ts`뿐이라 DOM이 없다. 이 태스크는 테스트를 추가하지 않는다. 게이트는 lint·기존 테스트·build이고, 진짜 검증은 T7의 브라우저 스크립트다.

- [ ] **Step 1: `frontend/src/lib/clipboard.ts` 생성**

```ts
// 클립보드 복사 — 성공 여부를 돌려준다.
// 서버는 원격 IP + 평문 HTTP(insecure context)라 navigator.clipboard가 아예 없다.
// 기존 코드가 `navigator.clipboard?.writeText()`로 써서 실패를 조용히 삼키고 있었다.

/**
 * 화면 밖 textarea + execCommand 폴백.
 * execCommand는 사용자 제스처 컨텍스트 안에서 **동기적으로** 불러야 하므로 async가 아니다.
 */
function copyViaTextarea(text: string): boolean {
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  // 화면 밖 + 스크롤 점프 방지. readOnly는 iOS 키보드 팝업 방지.
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-9999px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

/** 복사 성공하면 true. 호출부는 이 값을 보고 성공 표시를 낼 것. */
export async function copyText(text: string): Promise<boolean> {
  // insecure context면 navigator.clipboard 자체가 없다 → await 없이 동기 폴백(제스처 컨텍스트 보존)
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return copyViaTextarea(text);
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // clipboard API가 있는데 거부된 경우(권한 등). await 뒤라 제스처가 풀렸을 수 있어 실패할 수도 있다.
    return copyViaTextarea(text);
  }
}
```

`document.execCommand`는 deprecated지만 insecure context에서 동작하는 유일한 수단이다. TypeScript가 deprecation 경고만 내고 에러는 아니다.

- [ ] **Step 2: i18n 키 추가 (`en`·`ko` 양쪽)**

```ts
// en
"csvImport.promptCopyFailed": "Copy failed",
// ko
"csvImport.promptCopyFailed": "복사 실패",
```

- [ ] **Step 3: `csv-template-actions.tsx` 호출부 교체**

`promptCopied` boolean state를 3-상태로 바꾼다. `handleCopyPrompt`(`:31-35`)를 교체:

```tsx
  // 복사 결과 — idle | copied | failed. 서버(평문 HTTP)에선 실패할 수 있으므로 성공을 가정하지 않는다.
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const handleCopyPrompt = async () => {
    const ok = await copyText(buildAiPromptText());
    setCopyState(ok ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), ok ? 1200 : 1600);
  };
```

버튼(`:49-63`):

```tsx
      <button
        type="button"
        data-id="csv-copy-ai-prompt"
        className={CSV_OUTLINE_BTN}
        onClick={() => void handleCopyPrompt()}
        disabled={disabled}
        title={t("csvImport.copyPromptHint")}
      >
        {copyState === "copied" ? (
          <Check size={14} strokeWidth={1.5} className="text-accent" />
        ) : copyState === "failed" ? (
          <AlertTriangle size={14} strokeWidth={1.5} className="text-error" />
        ) : (
          <Sparkles size={14} strokeWidth={1.5} />
        )}
        <span className={copyState === "failed" ? "text-error" : undefined}>
          {copyState === "copied"
            ? t("csvImport.promptCopied")
            : copyState === "failed"
              ? t("csvImport.promptCopyFailed")
              : t("csvImport.copyPrompt")}
        </span>
      </button>
```

import에 `AlertTriangle`(lucide-react)와 `copyText`(`@/lib/clipboard`)를 더하고 `promptCopied` state를 지운다.

⚠️ `handleCopyPrompt`는 async라 `useCallback` 없이 plain 함수로 둔다(React Compiler가 알아서 메모한다).

- [ ] **Step 4: `markdown-view.tsx` 호출부 3곳 교체**

`onCopy?.()`와 하이라이트 클래스를 **성공했을 때만** 실행한다. `handleClick`·`handleDoubleClick` 교체:

```tsx
  // 클릭 위임(dangerouslySetInnerHTML) — ①코드블록 복사 버튼 ②인라인 코드 클릭 복사.
  // 복사 실패(서버는 insecure context) 시에는 성공 표시도 onCopy도 내지 않는다.
  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const btn = target.closest(".md-copy");
    if (btn) {
      const code = btn.parentElement?.querySelector("code")?.textContent ?? "";
      void copyText(code).then((ok) => {
        if (!ok) return;
        btn.classList.add("md-copy-done");
        window.setTimeout(() => btn.classList.remove("md-copy-done"), 1200);
        onCopy?.();
      });
      return;
    }
    // 인라인 코드(pre 밖의 code) 클릭 → 텍스트 복사.
    const codeEl = target.closest("code");
    if (codeEl && !codeEl.closest("pre")) {
      void copyText(codeEl.textContent ?? "").then((ok) => {
        if (!ok) return;
        flashCopied(codeEl);
        onCopy?.();
      });
    }
  };

  // 코드블록 행 더블클릭 → 해당 행만 복사.
  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const line = (event.target as HTMLElement).closest(".md-codeline");
    if (!line) return;
    void copyText(line.textContent ?? "").then((ok) => {
      if (!ok) return;
      flashCopied(line);
      onCopy?.();
    });
  };
```

import에 `copyText`를 더한다.

- [ ] **Step 5: 게이트**

`navigator.clipboard`가 더 이상 컴포넌트에서 직접 쓰이지 않는지 확인한다 (ugrep 함정 회피):
```bash
python3 -c "
import pathlib
hits=[f'{p}:{i}' for p in pathlib.Path('frontend/src').rglob('*.ts*') for i,l in enumerate(p.read_text().splitlines(),1) if 'navigator.clipboard' in l]
print(hits)"
```
Expected: `frontend/src/lib/clipboard.ts` 한 파일만.

```bash
npm run lint && npm test && npm run build
```
Expected: lint 0 errors · `Tests 219 passed` · build 성공.

- [ ] **Step 6: 커밋**

`PROGRESS.md`의 `## 2026-07-10 — CSV로 새 맵 만들기 + 클립보드 수정 설계` 섹션 아래에:
```markdown
- Ⓐ `lib/clipboard.ts` `copyText()` — insecure context면 textarea+execCommand 동기 폴백, 성공 여부를 boolean으로 반환. 호출부 4곳이 실패 시 성공 표시·onCopy를 내지 않는다. 단위 테스트 불가(vitest node 환경) — 브라우저·평문 HTTP에서 검증. vitest 219·lint 0에러.
```

```bash
git add frontend/src/lib/clipboard.ts frontend/src/components/csv-template-actions.tsx frontend/src/components/markdown-view.tsx frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "$(cat <<'EOF'
fix(clipboard): copy silently failed on the server — 서버에서 조용히 실패하던 복사 수정

navigator.clipboard only exists in a secure context, and the server runs plain
HTTP on a remote IP, so `navigator.clipboard?.writeText()` swallowed the failure
while the button still said "Copied!". copyText() falls back to execCommand and
returns whether it worked; callers no longer claim success they did not get.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhULXV6HVeYVdyAn9ax8Tc
EOF
)"
```

---

### Task 2: 백엔드 — `csv_manual_url`

**Files:**
- Modify: `backend/app/settings.py`
- Modify: `backend/app/schemas.py` (`MeOut`)
- Modify: `backend/app/main.py`
- Modify: `.env.example`
- Test: `backend/tests/test_maps.py`

**Interfaces:**
- Produces: `GET /api/me` 응답에 `csv_manual_url: str` (기본 `""`). 프론트 `MeOut` 타입(`frontend/src/lib/api.ts`)에도 필드를 더한다.

**환경 준비:** 워크트리에 backend venv가 없다. 먼저 만든다.
```bash
cd backend && python -m venv .venv && .venv/bin/pip install -q -r requirements-dev.txt
```
(`uv`가 있으면 `uv venv .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt` 도 됨.)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`backend/tests/test_maps.py`의 `test_me_includes_is_sysadmin`(`:159`) 아래에 추가:

```python
def test_me_includes_csv_manual_url(client: TestClient) -> None:
    # /api/me 가 CSV 임포트 매뉴얼 주소 노출 — 비면 프론트가 버튼을 숨긴다
    body = client.get("/api/me").json()

    assert "csv_manual_url" in body
    assert body["csv_manual_url"] == ""
```

- [ ] **Step 2: 실패 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_maps.py::test_me_includes_csv_manual_url -q
```
Expected: FAIL — `assert 'csv_manual_url' in body` (KeyError 아님, 단언 실패).

- [ ] **Step 3: 구현**

`backend/app/settings.py` — `manual_url`(`:29`) 바로 아래:
```python
    # CSV 임포트 안내 문서 주소 — 비우면 CSV 모달·에디터의 매뉴얼 버튼 숨김
    csv_manual_url: str = ""
```

`backend/app/schemas.py` — `MeOut.manual_url` 아래:
```python
    # CSV 임포트 안내 문서 주소 — 비어 있으면 매뉴얼 버튼 숨김
    csv_manual_url: str = ""
```

`backend/app/main.py` — `manual_url=settings.manual_url,`(`:130`) 아래:
```python
        csv_manual_url=settings.csv_manual_url,
```

`.env.example` — `MANUAL_URL=` 아래:
```
# CSV 임포트 안내 문서 주소 — 비우면 CSV 모달·에디터의 매뉴얼 버튼 숨김
# 예: CSV_MANUAL_URL=https://manual.example.com/csv-import
CSV_MANUAL_URL=
```

프론트 타입은 `frontend/src/lib/api.ts`의 **`Me`** 다 (백엔드의 `MeOut`과 이름이 다르다). `manual_url: string;` 아래에:
```ts
  // CSV 임포트 안내 문서 주소 — 비면 매뉴얼 버튼 숨김
  csv_manual_url: string;
```

- [ ] **Step 4: 통과 확인**

```bash
cd backend && .venv/bin/python -m pytest tests/test_maps.py::test_me_includes_csv_manual_url -q
```
Expected: PASS

```bash
cd backend && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
```
Expected: 전부 통과(개수는 기존 + 1). **실제 개수를 보고에 적을 것.**

```bash
cd frontend && npm run lint && npm test && npm run build
```
Expected: lint 0 errors · `Tests 219 passed` · build 성공.

- [ ] **Step 5: 커밋**

`PROGRESS.md`:
```markdown
- Ⓑ 백엔드 `csv_manual_url` — Settings → `MeOut` → `/api/me`(기존 `manual_url`과 동일 경로, DB 무변경). `.env.example`에 `CSV_MANUAL_URL=`. pytest +1.
```

```bash
git add backend/app/settings.py backend/app/schemas.py backend/app/main.py backend/tests/test_maps.py .env.example frontend/src/lib/api.ts PROGRESS.md
git commit -m "$(cat <<'EOF'
feat(config): serve csv_manual_url through /api/me — CSV 매뉴얼 주소를 /api/me로 노출

The CSV import manual is a deployment-specific link, so it follows manual_url's
existing path (Settings -> MeOut -> /api/me) rather than a NEXT_PUBLIC_ variable
that would be baked in at build time. Empty hides the button.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhULXV6HVeYVdyAn9ax8Tc
EOF
)"
```

---

### Task 3: 순수 헬퍼 — `stripCsvExtension` · `toCsvDirectory` (TDD)

**Files:**
- Modify: `frontend/src/lib/csv-import.ts`
- Test: `frontend/src/lib/csv-import.test.ts`

**Interfaces:**
- Consumes: `Directory`, `DirectoryDept`, `DirectoryUser` (`@/lib/api`), `CsvDirectory` (기존, 같은 파일)
- Produces:
  ```ts
  export function stripCsvExtension(fileName: string): string
  export function toCsvDirectory(dir: Directory): CsvDirectory
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`frontend/src/lib/csv-import.test.ts` 하단에 추가. 상단 import에 `stripCsvExtension`, `toCsvDirectory`를, 타입 import에 `type Directory`(`./api`)를 더한다.

```ts
// ── 생성 플로우용 순수 헬퍼 ──────────────────────────────────────

describe("stripCsvExtension", () => {
  it(".csv 확장자를 뗀다", () => {
    expect(stripCsvExtension("sales-process.csv")).toBe("sales-process");
  });

  it("대문자 확장자도 뗀다", () => {
    expect(stripCsvExtension("SALES.CSV")).toBe("SALES");
  });

  it("마지막 .csv만 뗀다 (앞의 점은 이름의 일부)", () => {
    expect(stripCsvExtension("2026.q3.plan.csv")).toBe("2026.q3.plan");
  });

  it("다른 확장자는 건드리지 않는다", () => {
    expect(stripCsvExtension("notes.txt")).toBe("notes.txt");
  });

  it("확장자가 없으면 그대로 둔다", () => {
    expect(stripCsvExtension("plan")).toBe("plan");
  });

  it("확장자뿐이면 빈 문자열이 된다", () => {
    expect(stripCsvExtension(".csv")).toBe("");
  });

  it("빈 문자열은 빈 문자열이다", () => {
    expect(stripCsvExtension("")).toBe("");
  });
});

describe("toCsvDirectory", () => {
  const dir: Directory = {
    users: [
      { id: "hong.gd", name: "홍길동", department: "Quality Part 1" },
      { id: "lee.yh", name: "이영희", department: "Finance Part" },
    ],
    departments: [
      { id: "HQ/Quality Office/Quality Part 1", name: "Quality Part 1", korean_name: "품질1파트", manager: "hong.gd" },
      { id: "HQ/Finance Part", name: "Finance Part", korean_name: "", manager: "" },
    ],
  };

  it("부서 목록은 org_path가 아니라 말단명이다 (node.department가 담는 값)", () => {
    expect(toCsvDirectory(dir).departments).toEqual(["Quality Part 1", "Finance Part"]);
  });

  it("한글 부서명이 있는 부서만 dept_infos에 담는다", () => {
    expect(toCsvDirectory(dir).dept_infos).toEqual({
      "Quality Part 1": { korean_name: "품질1파트" },
    });
  });

  it("사용자는 id·name·department만 옮긴다", () => {
    expect(toCsvDirectory(dir).users).toEqual([
      { id: "hong.gd", name: "홍길동", department: "Quality Part 1" },
      { id: "lee.yh", name: "이영희", department: "Finance Part" },
    ]);
  });

  it("빈 디렉터리도 안전하다", () => {
    expect(toCsvDirectory({ users: [], departments: [] })).toEqual({
      users: [],
      departments: [],
      dept_infos: {},
    });
  });

  it("결과를 buildGraphFromCsv가 그대로 쓸 수 있다 (login_id → 이름 해석)", () => {
    const csv = "Name,Description,Assignee,Department,System,Duration,URL,URL_Label,Next\n검토,,hong.gd,품질1파트,,,,,\n";
    const outcome = buildGraphFromCsv(csv, { directory: toCsvDirectory(dir) });
    expect(outcome.errors).toEqual([]);
    expect(outcome.warnings).toEqual([]);
    const node = outcome.graph!.nodes.find((n) => n.title === "검토")!;
    expect(node.assignee).toBe("홍길동");
    expect(node.department).toBe("Quality Part 1");
  });
});
```

⚠️ 마지막 테스트는 `toCsvDirectory`가 실제 파서와 물리는지 확인하는 통합 지점이다. `Directory` 타입에 없는 필드를 리터럴에 넣으면 타입 에러가 난다 — `DirectoryUser`의 optional 필드(`title`/`org_path`/`role`/`korean_name`/`korean_dept`)는 생략해도 된다.

- [ ] **Step 2: 실패 확인**

```bash
cd frontend && npm test -- csv-import
```
Expected: FAIL — `stripCsvExtension is not exported` / `toCsvDirectory is not exported`.

- [ ] **Step 3: 구현**

`frontend/src/lib/csv-import.ts` 의 import에 타입을 더한다:
```ts
import type { Directory, Graph, GraphEdge, GraphNode } from "./api";
```

파일 끝(`withKeptNodes` 근처)에 추가:

```ts
/** 맵 이름 프리필용 — 마지막 .csv 확장자만 뗀다. 다른 확장자는 이름의 일부로 본다. */
export function stripCsvExtension(fileName: string): string {
  return fileName.replace(/\.csv$/i, "");
}

/**
 * `/api/directory` 응답 → CSV 담당자/부서 해석용 디렉터리.
 * 맵 생성 시점엔 버전이 없어 listEligibleAssignees를 못 쓰므로 전 직원 디렉터리를 쓴다.
 * departments는 말단 부서명(node.department가 담는 값) — DirectoryDept.id는 org_path라 쓰면 안 된다.
 */
export function toCsvDirectory(dir: Directory): CsvDirectory {
  return {
    users: dir.users.map((user) => ({
      id: user.id,
      name: user.name,
      department: user.department,
    })),
    departments: dir.departments.map((dept) => dept.name),
    // korean_name은 없을 때 undefined가 아니라 "" 다
    dept_infos: Object.fromEntries(
      dir.departments
        .filter((dept) => dept.korean_name !== "")
        .map((dept) => [dept.name, { korean_name: dept.korean_name }]),
    ),
  };
}
```

- [ ] **Step 4: 통과 확인**

```bash
cd frontend && npm test -- csv-import
```
Expected: PASS — 기존 51개 + 신규 12개 = 63개.

```bash
npm run lint && npm test && npm run build
```
Expected: lint 0 errors · `Tests 231 passed` (219 + 12) · build 성공.

- [ ] **Step 5: 커밋**

`PROGRESS.md`:
```markdown
- Ⓒ 순수 헬퍼 `stripCsvExtension`·`toCsvDirectory` — 생성 시점엔 `listEligibleAssignees(versionId)`를 못 써서 `/api/directory`로 담당자/부서를 해석한다. departments는 말단명(org_path 아님). vitest 231·lint 0에러.
```

```bash
git add frontend/src/lib/csv-import.ts frontend/src/lib/csv-import.test.ts PROGRESS.md
git commit -m "$(cat <<'EOF'
feat(csv-import): pure helpers for the creation flow — 생성 플로우용 순수 헬퍼

A map has no version before it exists, so listEligibleAssignees is unavailable
and the full directory stands in. DirectoryDept.id is an org_path; the value a
node stores is the leaf name, so toCsvDirectory maps `name`, not `id`.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhULXV6HVeYVdyAn9ax8Tc
EOF
)"
```

---

### Task 4: `CsvTemplateActions` — 매뉴얼 버튼 + 라벨 변경

**Files:**
- Modify: `frontend/src/components/csv-template-actions.tsx`
- Modify: `frontend/src/components/csv-import-section.tsx`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: `Me.csv_manual_url` (T2, 프론트 타입 이름은 `Me`)
- Produces: `CsvTemplateActions({ disabled?: boolean; manualUrl?: string })` · `CsvImportSection` 이 `manualUrl?: string` 을 통과시킨다.

- [ ] **Step 1: i18n (en·ko 양쪽)**

수정:
```ts
// en
"csvImport.copyPrompt": "Ask another AI",
// ko
"csvImport.copyPrompt": "다른 AI에게 부탁하기",
```

추가:
```ts
// en
"csvImport.manualLink": "CSV import manual",
// ko
"csvImport.manualLink": "CSV 임포트 매뉴얼",
```

- [ ] **Step 2: `CsvTemplateActions`에 매뉴얼 버튼**

시그니처와 버튼 순서를 바꾼다 — `양식 다운로드 · CSV 임포트 매뉴얼 · 다른 AI에게 부탁하기`.

```tsx
export function CsvTemplateActions({
  disabled,
  manualUrl,
}: {
  disabled?: boolean;
  // CSV 임포트 안내 문서(.env CSV_MANUAL_URL) — 비면 버튼 숨김. manual_url(편집 매뉴얼)과 별개다.
  manualUrl?: string;
}) {
```

다운로드 버튼과 프롬프트 버튼 **사이에** 넣는다:

```tsx
      {manualUrl && (
        <button
          type="button"
          data-id="csv-manual-link"
          className={CSV_OUTLINE_BTN}
          onClick={() => window.open(manualUrl, "_blank", "noopener,noreferrer")}
          disabled={disabled}
        >
          <BookOpen size={14} strokeWidth={1.5} />
          {t("csvImport.manualLink")}
        </button>
      )}
```

lucide import에 `BookOpen` 추가.

- [ ] **Step 3: `CsvImportSection` 통과 + 에디터 배선**

`csv-import-section.tsx`의 props에 추가하고 넘긴다:
```tsx
interface CsvImportSectionProps {
  outcome: CsvImportOutcome | null;
  fileName: string | null;
  onChange: (outcome: CsvImportOutcome | null, fileName: string | null) => void;
  context?: CsvImportContext;
  // CSV 임포트 안내 문서 주소 — 비면 버튼 숨김
  manualUrl?: string;
}
```
```tsx
        <CsvTemplateActions manualUrl={manualUrl} />
```

`frontend/src/app/maps/[mapId]/page.tsx`:
- `manualUrl` state 옆에 `const [csvManualUrl, setCsvManualUrl] = useState("");` 추가
- `getMe()` 콜백(`setManualUrl(me.manual_url);` 있는 곳)에 `setCsvManualUrl(me.csv_manual_url);` 추가
- `<CsvImportSection ... />` 에 `manualUrl={csvManualUrl}` 전달

⚠️ 편집 위치를 찾을 때 `grep` 대신 python을 쓴다(대괄호 디렉터리).

- [ ] **Step 4: 게이트 · 커밋**

```bash
cd frontend && npm run lint && npm test && npm run build
```
Expected: lint 0 errors · `Tests 231 passed` · build 성공.

`PROGRESS.md`:
```markdown
- Ⓒ `CsvTemplateActions`에 CSV 매뉴얼 버튼(값 없으면 숨김) + 프롬프트 버튼 라벨을 "다른 AI에게 부탁하기"로. 에디터 임포트 모달도 같은 컴포넌트라 함께 적용. vitest 231·lint 0에러.
```

```bash
git add frontend/src/components/csv-template-actions.tsx frontend/src/components/csv-import-section.tsx "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "$(cat <<'EOF'
feat(csv-import): manual link button beside the template and prompt — CSV 매뉴얼 버튼 추가

The CSV format needs explaining wherever a CSV is prepared, so the link lives in
the shared actions component and reaches the editor's import modal for free.
Hidden when CSV_MANUAL_URL is empty.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhULXV6HVeYVdyAn9ax8Tc
EOF
)"
```

---

### Task 5: CSV 모달 + 홈 분할 버튼

**Files:**
- Create: `frontend/src/components/csv-create-modal.tsx`
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: `toCsvDirectory` (T3), `CsvTemplateActions({ disabled, manualUrl })` (T4), `getDirectory()`·`getMe()` (`@/lib/api`), `buildGraphFromCsv(text, { directory })`·`decodeCsvBuffer` (`@/lib/csv-import`), `ModalBackdrop` (`@/components/modal-backdrop`)
- Produces: `CsvCreateModal({ onClose, onContinue })` — `onContinue(outcome: CsvImportOutcome, fileName: string)`

- [ ] **Step 1: i18n (en·ko 양쪽)**

```ts
// en
"csvImport.createFromCsv": "Create from CSV",
"csvImport.createModalTitle": "Create a map from CSV",
"csvImport.dropzone": "Drop a CSV file here, or click to choose one",
"csvImport.dropzoneActive": "Release to load the file",
"csvImport.createSummary": "Creates {nodes} nodes · {edges} connections",
"csvImport.back": "Back",
"csvImport.directoryFailed": "Could not load the employee directory — assignees cannot be resolved.",
// ko
"csvImport.createFromCsv": "CSV로 새 맵 만들기",
"csvImport.createModalTitle": "CSV로 새 맵 만들기",
"csvImport.dropzone": "CSV 파일을 여기에 놓거나, 클릭해 선택하세요",
"csvImport.dropzoneActive": "놓으면 불러옵니다",
"csvImport.createSummary": "노드 {nodes}개 · 연결 {edges}개를 만듭니다",
"csvImport.back": "뒤로",
"csvImport.directoryFailed": "직원 디렉터리를 불러오지 못했습니다 — 담당자를 해석할 수 없습니다.",
```

`common.confirm`·`common.cancel`이 실재하는지 확인하고 없으면 이 목록에 더한다:
```bash
python3 -c "
import pathlib
t=pathlib.Path('frontend/src/lib/i18n-messages.ts').read_text()
for k in ['\"common.confirm\"','\"common.cancel\"']: print(k, t.count(k))"
```
(각각 2 = en·ko 양쪽에 있음)

- [ ] **Step 2: `frontend/src/components/csv-create-modal.tsx` 생성**

```tsx
"use client";

// CSV로 새 맵 만들기 — 드롭존 + 준비 액션 + 파싱 요약(2단계). [계속]이 파싱 결과를 CreateMapDialog로 넘긴다.
// 생성 시점엔 버전이 없어 listEligibleAssignees를 못 쓴다 → getDirectory()로 담당자/부서를 해석한다.
// 디렉터리 로드 전에는 [확인]을 막는다 — 같은 CSV가 로드 타이밍에 따라 다르게 해석되면 안 된다.
import { useEffect, useRef, useState } from "react";

import { AlertTriangle, FileUp, X } from "lucide-react";

import { CsvTemplateActions } from "@/components/csv-template-actions";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { getDirectory, getMe } from "@/lib/api";
import {
  buildGraphFromCsv,
  decodeCsvBuffer,
  toCsvDirectory,
  type CsvDirectory,
  type CsvImportOutcome,
} from "@/lib/csv-import";
import { useI18n } from "@/lib/i18n";

interface Props {
  onClose: () => void;
  onContinue: (outcome: CsvImportOutcome, fileName: string) => void;
}

export function CsvCreateModal({ onClose, onContinue }: Props) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [directory, setDirectory] = useState<CsvDirectory | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [csvManualUrl, setCsvManualUrl] = useState("");
  const [outcome, setOutcome] = useState<CsvImportOutcome | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [step, setStep] = useState<"pick" | "summary">("pick");

  useEffect(() => {
    let alive = true;
    void Promise.all([getDirectory(), getMe()])
      .then(([dir, me]) => {
        if (!alive) return;
        setDirectory(toCsvDirectory(dir));
        setCsvManualUrl(me.csv_manual_url);
      })
      .catch((err) => {
        // 삼키지 않는다 — 사용자에게 보이고 [확인]을 막는다
        console.warn("directory/me fetch failed", err);
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const loadFile = async (file: File) => {
    if (directory === null) return;
    const text = decodeCsvBuffer(await file.arrayBuffer());
    setOutcome(buildGraphFromCsv(text, { directory }));
    setFileName(file.name);
    setStep("pick");
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  };

  // 같은 파일 재선택을 허용하기 위해 input value 리셋
  const handlePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void loadFile(file);
  };

  const parsedOk = outcome?.graph != null && outcome.errors.length === 0;
  const canConfirm = parsedOk && directory !== null;

  return (
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1200] flex items-start justify-center bg-ink/20 pt-4 backdrop-blur-sm"
    >
      <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col gap-4 rounded-md bg-surface p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-body-strong text-ink">{t("csvImport.createModalTitle")}</h2>
          <button type="button" onClick={onClose} className="rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt" aria-label={t("common.cancel")}>
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {loadError && (
          <p className="flex items-start gap-1.5 text-caption text-error">
            <AlertTriangle size={14} strokeWidth={1.5} className="mt-px shrink-0" />
            {t("csvImport.directoryFailed")}
          </p>
        )}

        {step === "pick" ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <CsvTemplateActions manualUrl={csvManualUrl} />
            </div>

            <button
              type="button"
              data-id="csv-dropzone"
              onClick={() => fileRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`flex flex-col items-center gap-2 rounded-sm border border-dashed px-4 py-10 text-caption ${
                dragOver ? "border-accent bg-accent-tint text-accent" : "border-hairline text-ink-tertiary hover:bg-surface-alt"
              }`}
            >
              <FileUp size={16} strokeWidth={1.5} />
              {dragOver ? t("csvImport.dropzoneActive") : t("csvImport.dropzone")}
              {fileName !== null && <span className="text-caption-strong text-ink">{fileName}</span>}
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handlePick} />

            {outcome !== null && outcome.errors.length > 0 && (
              <ul data-id="csv-create-errors" className="flex flex-col gap-0.5">
                {outcome.errors.slice(0, 10).map((err) => (
                  <li key={`${err.line}-${err.message}`} className="text-caption text-error">
                    {t("csvImport.rowError", { line: err.line, message: err.message })}
                  </li>
                ))}
                {outcome.errors.length > 10 && (
                  <li className="text-caption text-ink-tertiary">{t("csvImport.moreErrors", { n: outcome.errors.length - 10 })}</li>
                )}
              </ul>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-sm border border-hairline px-4 py-1.5 text-caption text-ink hover:bg-surface-alt">
                {t("common.cancel")}
              </button>
              <button
                type="button"
                data-id="csv-create-confirm"
                disabled={!canConfirm}
                onClick={() => setStep("summary")}
                className="rounded-sm bg-accent px-4 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
              >
                {t("common.confirm")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div data-id="csv-create-summary" className="flex flex-col gap-1 rounded-sm border border-hairline bg-surface-alt px-3 py-2">
              <span className="truncate text-caption-strong text-ink">{fileName}</span>
              <p className="text-caption text-ink-secondary">
                {t("csvImport.createSummary", { nodes: outcome!.nodeCount, edges: outcome!.edgeCount })}
              </p>
              {outcome!.warnings.map((warn) => (
                <p key={`${warn.line}-${warn.message}`} className="text-caption text-ink-tertiary">
                  {t("csvImport.rowWarning", { line: warn.line, message: warn.message })}
                </p>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" data-id="csv-create-back" onClick={() => setStep("pick")} className="rounded-sm border border-hairline px-4 py-1.5 text-caption text-ink hover:bg-surface-alt">
                {t("csvImport.back")}
              </button>
              <button
                type="button"
                data-id="csv-create-continue"
                onClick={() => onContinue(outcome!, fileName!)}
                className="rounded-sm bg-accent px-4 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
              >
                {t("csvImport.continue")}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalBackdrop>
  );
}
```

⚠️ `outcome!`/`fileName!` non-null 단언은 `step === "summary"`가 `canConfirm`을 거쳐야만 도달하므로 안전하다. TypeScript가 좁히지 못할 뿐이다. **`as` 캐스트는 쓰지 말 것.**

- [ ] **Step 3: 홈 분할 버튼 + 메뉴 + 마운트**

`frontend/src/app/page.tsx`:

state 추가 (`dialogOpen` 옆, `:35`):
```tsx
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  // CSV 모달 → 생성 다이얼로그 핸드오프 (파싱 결과 + 파일명)
  const [csvHandoff, setCsvHandoff] = useState<{ outcome: CsvImportOutcome; fileName: string } | null>(null);
```

import 추가: `FileUp` (lucide, `ChevronDown`은 이미 있음), `CsvCreateModal`, `type CsvImportOutcome`.

바깥 클릭·Escape 닫기 (이펙트 **본문**에서 setState 하지 않는다 — 리스너 안에서만):
```tsx
  useEffect(() => {
    if (!createMenuOpen) return;
    const close = () => setCreateMenuOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCreateMenuOpen(false);
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [createMenuOpen]);
```

버튼(`:365-371`)을 분할 버튼으로 교체:
```tsx
          {/* 분할 버튼 — 왼쪽=빈 맵, 오른쪽 쉐브론=CSV로 만들기. 재사용할 드롭다운 프리미티브가 없어 1항목 메뉴를 직접 둔다. */}
          <div className="relative flex shrink-0" onClick={(event) => event.stopPropagation()}>
            <button
              className="inline-flex shrink-0 items-center gap-1 rounded-l-sm bg-accent px-3 py-2 text-caption-strong text-on-accent hover:bg-accent-focus"
              onClick={() => setDialogOpen(true)}
            >
              <Plus size={16} strokeWidth={1.5} />
              {t("perm.createDialog.title")}
            </button>
            <button
              data-id="home-create-menu-toggle"
              aria-expanded={createMenuOpen}
              aria-label={t("csvImport.createFromCsv")}
              className="inline-flex shrink-0 items-center rounded-r-sm border-l border-accent-focus bg-accent px-2 py-2 text-on-accent hover:bg-accent-focus"
              onClick={() => setCreateMenuOpen((open) => !open)}
            >
              <ChevronDown size={16} strokeWidth={1.5} />
            </button>
            {createMenuOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 min-w-52 rounded-sm border border-hairline bg-surface py-1 shadow-lg">
                <button
                  data-id="home-create-from-csv"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    setCsvModalOpen(true);
                  }}
                >
                  <FileUp size={16} strokeWidth={1.5} />
                  {t("csvImport.createFromCsv")}
                </button>
              </div>
            )}
          </div>
```

`border-accent-focus`는 `--color-accent-focus`(`globals.css:14`) 토큰이다 — accent 배경 위에 미세한 구분선을 만든다. **raw hex와 임의 불투명도(`/30`)를 쓰지 말 것.**

모달 마운트 (`dialogOpen` 블록 `:617` 위에):
```tsx
      {csvModalOpen && (
        <CsvCreateModal
          onClose={() => setCsvModalOpen(false)}
          onContinue={(outcome, fileName) => {
            setCsvModalOpen(false);
            setCsvHandoff({ outcome, fileName });
            setDialogOpen(true);
          }}
        />
      )}
```

`dialogOpen` 블록을 고쳐 핸드오프를 넘기고 닫을 때 비운다:
```tsx
      {dialogOpen && (
        <CreateMapDialog
          csv={csvHandoff ?? undefined}
          onClose={() => {
            setDialogOpen(false);
            setCsvHandoff(null);
          }}
          onCreated={() => {
            void refresh();
            showToast(t("perm.createDialog.toastSuccess"));
          }}
        />
      )}
```

⚠️ `csv` prop은 T6에서 추가된다. **T5와 T6은 연속으로 수행하고 그 사이에 앱을 시연하지 않는다** — T5만 적용하면 타입 에러로 빌드가 깨진다. 두 태스크를 한 번에 구현하고 커밋을 둘로 나눠도 좋다.

- [ ] **Step 4: 게이트 · 커밋**

T6까지 마친 뒤 함께 게이트를 돌린다. 이 커밋 단독으로는 `npm run build`가 깨진다(의도).

```bash
git add frontend/src/components/csv-create-modal.tsx frontend/src/app/page.tsx frontend/src/lib/i18n-messages.ts PROGRESS.md
```
`PROGRESS.md`:
```markdown
- Ⓒ 홈 분할 버튼(쉐브론 → "CSV로 새 맵 만들기") + `csv-create-modal.tsx` — 드롭존(클릭=탐색기, 드래그&드롭)·양식/매뉴얼/프롬프트 3버튼·파싱 에러 차단·요약 2단계. 디렉터리 로드 전 [확인] 비활성. ⚠️ 빌드는 다음 커밋(CreateMapDialog `csv` prop)에서 초록.
```

---

### Task 6: `CreateMapDialog` — `csv` prop · 프리필 · 아코디언 · `createdRef`

**Files:**
- Modify: `frontend/src/components/permissions/create-map-dialog.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: `stripCsvExtension` (T3), `CsvImportOutcome` (`@/lib/csv-import`), `acquireCheckout`·`saveGraph` (`@/lib/api`), 홈의 `csv` 핸드오프 (T5)
- Produces: `CreateMapDialog({ onClose, onCreated, csv? })`

- [ ] **Step 1: i18n — 복원 1개, 삭제 2개**

복원 (en·ko 양쪽):
```ts
// en
"csvImport.mapCreatedImportFailed": "Map was created, but the CSV import failed — press Create again to retry.",
// ko
"csvImport.mapCreatedImportFailed": "맵은 생성되었지만 CSV 임포트에 실패했습니다 — Create를 다시 누르면 재시도합니다.",
```

삭제 (en·ko 양쪽) — 이 태스크가 마지막 사용처를 없앤다:
```ts
"csvImport.createNotice"
"csvImport.sectionTitle"
```
삭제 전 python으로 미참조를 증명한다:
```bash
python3 -c "
import pathlib
for k in ['csvImport.createNotice','csvImport.sectionTitle']:
    hits=[f'{p}:{i}' for p in pathlib.Path('frontend/src').rglob('*.ts*') for i,l in enumerate(p.read_text().splitlines(),1) if k in l]
    print(k, hits)"
```
i18n 정의 줄만 남아야 한다. 다른 참조가 있으면 **삭제하지 말고 BLOCKED로 보고**한다.

- [ ] **Step 2: props · 프리필 · state**

```tsx
interface Props {
  onClose: () => void;
  onCreated: () => void; // 생성 후 목록 갱신 콜백
  // CSV로 만들기 — 홈의 CSV 모달이 넘긴다. **optional 필수**: map-name-dropdown.tsx도 이 컴포넌트를 마운트한다.
  csv?: { outcome: CsvImportOutcome; fileName: string };
}

export function CreateMapDialog({ onClose, onCreated, csv }: Props) {
```

프리필은 `useState` **초기값**으로 (이펙트 안 setState 금지):
```tsx
  // CSV로 만들 때는 파일명(확장자 제외)을 이름·설명 기본값으로
  const csvBaseName = csv ? stripCsvExtension(csv.fileName) : "";
  const [name, setName] = useState(csvBaseName);
  const [description, setDescription] = useState(csvBaseName);
```

추가 state:
```tsx
  // 파일 아코디언 접힘 상태
  const [csvOpen, setCsvOpen] = useState(false);
  // 생성 완료 표시 — 저장 실패 후 Create 재클릭 시 맵 재생성(중복) 방지
  const createdRef = useRef<{ mapId: number; versionId: number } | null>(null);
```

import 추가: `acquireCheckout`·`saveGraph` (`@/lib/api`), `stripCsvExtension`·`type CsvImportOutcome` (`@/lib/csv-import`), `useRef` (react), `ChevronDown`·`ChevronRight`·`FileUp` (lucide). `Info`·`CsvTemplateActions` import는 제거한다(Step 3에서 마지막 사용처가 사라짐).

- [ ] **Step 3: CSV 준비 섹션 → 파일 아코디언**

`:382-392`의 블록을 교체:

```tsx
        {/* CSV로 만들기 — 파일명 아코디언. 누르면 요약·경고를 펼친다. */}
        {csv && (
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              data-id="csv-file-accordion"
              aria-expanded={csvOpen}
              onClick={() => setCsvOpen((open) => !open)}
              className="flex items-center gap-1.5 rounded-sm border border-hairline bg-surface-alt px-2.5 py-1.5 text-caption text-ink hover:bg-surface"
            >
              {csvOpen ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
              <FileUp size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
              <span className="truncate">{csv.fileName}</span>
            </button>
            {csvOpen && (
              <div data-id="csv-file-summary" className="flex flex-col gap-1 rounded-sm border border-hairline px-3 py-2">
                <p className="text-caption text-ink-secondary">
                  {t("csvImport.createSummary", { nodes: csv.outcome.nodeCount, edges: csv.outcome.edgeCount })}
                </p>
                {csv.outcome.warnings.map((warn) => (
                  <p key={`${warn.line}-${warn.message}`} className="text-caption text-ink-tertiary">
                    {t("csvImport.rowWarning", { line: warn.line, message: warn.message })}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 4: `handleCreate` — 그래프 저장 + 재시도**

`handleCreate`(`:208-`)를 교체. deps에 `csv`를 더한다.

```tsx
  const handleCreate = useCallback(async () => {
    if (!currentUser) return;
    const trimmed = name.trim();
    if (!trimmed || approvers.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      // 생성 단계는 최초 1회만 — 저장 실패 후 Create 재클릭 시 맵을 다시 만들지 않는다
      if (createdRef.current === null) {
        const detail = await createMap(trimmed, description.trim(), visibility);
        for (const c of collaborators) {
          const role: "viewer" | "editor" = c.role === "viewer" ? "viewer" : "editor";
          await addMapPermission(detail.id, c.principalType, c.principalId, role);
        }
        await setMapApprovers(detail.id, approvers.map((a) => a.userId));
        createdRef.current = { mapId: detail.id, versionId: detail.versions[0].id };
      }
      const created = createdRef.current;

      if (csv?.outcome.graph) {
        try {
          // 신규 As-Is 버전은 잠금 free — 체크아웃 획득 후 그래프 반영
          await acquireCheckout(created.versionId);
          await saveGraph(created.versionId, csv.outcome.graph);
        } catch (err) {
          // 맵은 이미 있다 — 목록만 갱신하고 다이얼로그를 유지, Create 재클릭 시 저장만 재시도
          onCreated();
          setError(
            err instanceof Error
              ? `${t("csvImport.mapCreatedImportFailed")} — ${err.message}`
              : t("csvImport.mapCreatedImportFailed"),
          );
          setSubmitting(false);
          return;
        }
      }

      onCreated();
      onClose();
      router.push(`/maps/${created.mapId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("err.createMap"));
      setSubmitting(false);
    }
  }, [currentUser, name, description, visibility, collaborators, approvers, csv, onCreated, onClose, router, t]);
```

- [ ] **Step 5: 게이트 (T5 + T6 합산)**

```bash
cd frontend && npm run lint && npm test && npm run build
```
Expected: lint 0 errors · `Tests 231 passed` · build 성공.

미참조 확인:
```bash
python3 -c "
import pathlib
for k in ['csvImport.createNotice','csvImport.sectionTitle','csv-create-notice']:
    hits=[f'{p}:{i}' for p in pathlib.Path('frontend/src').rglob('*.ts*') for i,l in enumerate(p.read_text().splitlines(),1) if k in l]
    print(k, hits or 'clean')"
```
Expected: 셋 다 `clean`.

- [ ] **Step 6: 커밋 (T5·T6 각각 1커밋)**

T5 커밋:
```bash
git commit -m "$(cat <<'EOF'
feat(csv-create): dropzone modal behind a split New-map button — CSV 드롭존 모달·홈 분할 버튼

Creation-time import returns, but with a parse/summary step and an empty base —
the reason it was removed (silently writing the graph) no longer applies. The
directory must load before Confirm, or the same CSV would resolve differently
depending on timing.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhULXV6HVeYVdyAn9ax8Tc
EOF
)"
```

T6 `PROGRESS.md`:
```markdown
- Ⓒ `CreateMapDialog`에 optional `csv` prop — 파일명 아코디언(요약·경고 펼침), 이름·설명을 확장자 뗀 파일명으로 프리필, `createdRef`로 저장 실패 후 맵 재생성 없이 재시도. `createNotice`·`sectionTitle` 키 제거. vitest 231·lint 0에러.
```
```bash
git add frontend/src/components/permissions/create-map-dialog.tsx frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "$(cat <<'EOF'
feat(csv-create): create dialog accepts a parsed CSV — 생성 다이얼로그가 파싱된 CSV를 받는다

Name and description prefill from the filename, the parse summary hides behind a
file accordion, and createdRef keeps a failed graph save from creating a second
map when Create is pressed again.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhULXV6HVeYVdyAn9ax8Tc
EOF
)"
```

---

### Task 7: 브라우저 검증 스크립트

**Files:**
- Create: `frontend/scripts/pw-verify-csv-create-flow.mjs`

기존 관례를 먼저 읽는다: `frontend/scripts/pw-verify-hotfix-ui-6.mjs`, `frontend/scripts/pw-verify-csv-import-merge.mjs`. `docs/lessons/browser-verification.md`도 읽는다(좀비 `next dev`가 3000을 잡으면 새 서버가 3001로 폴백해 구버전에 붙는다).

**스크립트를 실행하지 않는다** — 서버를 띄울 수 없다. 헤더 주석에 실행 명령(bash + PowerShell)을 적고, 서버가 없으면 크게 실패하게 한다.

시나리오 (위험 순):

1. **클립보드 — 오리진 의존.** `location.protocol`이 `https:`이거나 호스트가 `localhost`면 이 단언은 **`SKIP`**으로 보고한다(secure context라 고치기 전에도 통과하므로 무의미). 평문 HTTP 오리진에서만: `[data-id="csv-copy-ai-prompt"]` 클릭 → 버튼 라벨이 "Copy failed"가 **아니어야** 하고, `navigator.clipboard === undefined`임을 `page.evaluate`로 확인한 뒤 복사된 내용이 실제로 붙여넣기 가능한지 `textarea`에 `Ctrl+V`로 확인한다.
2. **분할 버튼 → CSV 모달.** `[data-id="home-create-menu-toggle"]` → `[data-id="home-create-from-csv"]` → 모달 뜸. 드롭존 클릭이 파일 입력을 연다(`page.setInputFiles`로 대체).
3. **파싱 에러 차단.** 잘못된 CSV(존재하지 않는 `Next` 대상) → `[data-id="csv-create-errors"]`가 뜨고 `[data-id="csv-create-confirm"]`이 `disabled`.
4. **요약 → 계속 → 프리필.** 정상 CSV → 확인 → `[data-id="csv-create-summary"]` → 계속 → 생성 다이얼로그의 이름 입력값이 **확장자 뗀 파일명**과 같다. 설명도 같다.
5. **파일 아코디언.** `[data-id="csv-file-accordion"]` 클릭 → `[data-id="csv-file-summary"]` 표시/숨김 토글.
6. **담당자 해석 + 경고.** 실제 login_id 하나와 가짜 하나를 넣은 CSV → 요약에 경고 1건. 생성 후 에디터에서 그 노드의 담당자가 **이름**으로 들어갔는지 확인.
7. **매뉴얼 버튼.** `csv_manual_url`이 비면 `[data-id="csv-manual-link"]`가 **없어야** 한다(현재 기본값이 `""`이므로 이게 기대값). 값이 있는 환경은 `SKIP`.
8. **`createdRef` 재시도.** 스크립트로 강제하기 어려우면 `NOT COVERED`로 명시한다 — 지어내지 말 것.

실제 login_id·부서는 런타임에 `/api/directory`에서 얻는다. 못 얻으면 `SKIP`(패스로 세지 않는다). 어떤 단언이든 실패하거나 콘솔 에러가 잡히면 exit 1. 마지막에 `N/M` 집계를 출력한다.

- [ ] **Step 1: 스크립트 작성**
- [ ] **Step 2: 문법·임포트 확인**

```bash
node --check frontend/scripts/pw-verify-csv-create-flow.mjs
cd frontend && npm run lint && npm test
```
Expected: `SYNTAX OK` · lint 0 errors · `Tests 231 passed` (스크립트는 vitest `include`(`src/**/*.test.ts`)에 안 걸린다).

**"시나리오가 통과했다"고 쓰지 말 것 — 실행하지 않았다.**

- [ ] **Step 3: 커밋**

`PROGRESS.md`:
```markdown
- Ⓒ 브라우저 검증 스크립트 `pw-verify-csv-create-flow.mjs` — 클립보드(평문 HTTP 오리진에서만 유효)·분할버튼·파싱 에러 차단·프리필·아코디언·담당자 해석 경고·매뉴얼 버튼 7시나리오. **아직 미실행**(서버 필요).
```

```bash
git add frontend/scripts/pw-verify-csv-create-flow.mjs PROGRESS.md
git commit -m "$(cat <<'EOF'
test(csv-create): browser verification script for the creation flow — CSV 생성 플로우 브라우저 검증 스크립트

The clipboard assertions only mean anything on a plain-HTTP origin; on localhost
they pass even against the old bug, so the script reports them as SKIP there.
Not yet executed — needs a running backend and frontend.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhULXV6HVeYVdyAn9ax8Tc
EOF
)"
```

---

## 완료 조건

- `npm run lint` 0 errors · `npm test` 231 passed (219 + 12) · `npm run build` 성공
- `cd backend && .venv/bin/python -m pytest tests/ -q` 통과 (기존 + 1), `ruff check app/ tests/` 통과
- `navigator.clipboard` 직접 참조가 `frontend/src/lib/clipboard.ts` 한 곳뿐
- `csvImport.createNotice` · `csvImport.sectionTitle` 미참조
- T7 스크립트는 **미실행** — 사용자가 서버를 띄울 수 있을 때 돌린다

## 스코프 밖 — 손대지 않는다

- jsdom 도입, 컴포넌트 테스트 하네스.
- `map-name-dropdown.tsx`에 "CSV로 새 맵" 항목 추가(그 컴포넌트는 `csv` prop을 넘기지 않는다 — optional이라 그대로 동작).
- 이전 브랜치의 `pw-verify-csv-import-merge.mjs` 7시나리오는 아직 미실행이다.
- `document.execCommand`의 deprecation. insecure context에서 동작하는 유일한 수단이다.
