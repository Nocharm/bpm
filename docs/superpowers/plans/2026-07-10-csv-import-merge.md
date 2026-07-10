# CSV 임포트 머지 전환 + 담당자·부서 컬럼 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CSV 임포트를 전체 교체에서 이름 기준 머지로 바꿔 노드 정체성(계보·코멘트·그룹)을 보존하고, 담당자·부서 컬럼을 추가하며, 그 결과 버전 비교가 실제 변경만 잡게 한다.

**Architecture:** 프론트 전용 변경이다. `buildGraphFromCsv`에 기존 그래프(`base`)와 디렉터리를 넘겨, 제목이 일치하는 기존 노드의 **id를 재사용**한다. 백엔드 `replace_graph`의 노드 upsert가 id 기준 제자리 UPDATE이므로(`backend/app/routers/graph.py:242`) `source_node_id`가 살아남고, `diff.ts`의 계보 매칭과 `edgeKey`가 자동으로 맞아떨어진다. **백엔드 변경 0줄.** 그 위에 캔버스 프리뷰(기존 `data.diffStatus` 렌더 재사용)와 인스펙터 Import 탭을 얹어 소멸 노드의 삭제/유지를 사용자가 고르게 한다.

**Tech Stack:** Next.js (App Router) · TypeScript strict · @xyflow/react · vitest · Tailwind(@theme 토큰)

**설계 문서:** `docs/superpowers/specs/2026-07-10-csv-import-merge-design.md`

## Global Constraints

- 브랜치 `worktree-csv-import-merge`, 워크트리 `.claude/worktrees/csv-import-merge`. **모든 명령은 이 디렉터리에서.** 원본 저장소로 `cd` 금지.
- **컴포넌트 테스트가 존재하지 않는다** (`frontend/src/**/*.test.*`는 전부 `lib/` 순수 모듈, 16파일 162테스트). UI 태스크는 테스트를 지어내지 말고 `npm run lint` + `npm run build` + 브라우저 실검증으로 검증한다.
- id 생성은 `genId()` (`@/lib/id`). `crypto.randomUUID()` 금지 — 서버는 평문 HTTP라 Web Crypto가 없다.
- Raw hex 금지. 색은 토큰(`var(--color-removed)`, `var(--color-added)`, `text-ink-secondary` 등).
- UI 문구는 영어. 주석·설계문서는 한국어. i18n은 `en`/`ko` 두 블록 **모두** 추가 (`ko`가 `Record<MessageKey, string>`이라 누락 시 타입 에러).
- 아이콘은 Lucide, `size={14}` 또는 `16`, `strokeWidth={1.5}`.
- React Compiler — `useCallback`/`useMemo`의 선언 deps가 추론 deps와 다르면 `npm run lint`가 `react-hooks/preserve-manual-memoization`으로 **빌드를 깬다**. setState만 호출하는 자명한 핸들러는 `useCallback` 없이 **plain 함수**로 둔다. 이펙트 안 동기 setState(`react-hooks/set-state-in-effect`)도 금지.
- `grep`이 ugrep이라 `[mapId]` 같은 대괄호 디렉터리를 조용히 건너뛴다. 해당 경로는 `find`+per-file grep 또는 python으로 확인한다.
- 커밋 메시지: `type(scope): English summary — 한국어 요약`. **커밋마다 `PROGRESS.md` 한 줄을 같은 커밋에 포함** (`rules/common/git.md`).
- 커밋 말미에 다음 두 줄을 붙인다:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01AhULXV6HVeYVdyAn9ax8Tc
  ```

### 도메인 사실 (실측 — 추측하지 말 것)

- `NodeIn.assignee`·`NodeIn.department`(`backend/app/schemas.py`)는 `default=""`, `max_length=100`. **백엔드는 담당자 실재를 검증하지 않는다.**
- `node.assignee`에는 **이름**이 저장된다. 복수면 `", "` 구분. `parseAssignees`/`formatAssignees`/`driftedAssignees`(`frontend/src/lib/assignee.ts`)가 그 규약을 쥔다.
- `node.department`는 org_path가 아니라 **말단 부서명**이다.
- `eligible`(`EligibleAssignees`, `page.tsx:819`)의 `users[].id`가 login_id, `.name`이 표시명, `.department`가 말단 부서명. `departments`가 부서 목록, `dept_infos[정식명].korean_name`이 한글 부서명.
- `hasBpmAttributes(nodeType)`(`canvas.ts:94`)는 start/end/**subprocess**를 제외한다. 서브프로세스 노드는 담당자를 `spAssignee`(링크맵 지정값)로 표시하므로 CSV 담당자를 써도 렌더되지 않는다.
- **빈 셀 = 기존 값 유지**(전 속성 열). `Next`만 예외 — 빈 값은 "말단"이라는 의미다.

## File Structure

| 파일 | 책임 | 변경 |
|------|------|------|
| `frontend/src/lib/csv-import.ts` | CSV 파싱 · 담당자/부서 해석 · **머지 그래프 생성**(순수) | 수정 (Task 2, 3, 4) |
| `frontend/src/lib/csv-import.test.ts` | 위의 단위 테스트 | 수정 (Task 2, 4) |
| `frontend/src/lib/diff.test.ts` | 머지 후 비교가 실제 변경만 잡는지 (신규 파일) | 생성 (Task 6) |
| `docs/samples/*.csv` | 임포트 예시 3종 (현재 헤더가 낡음) | 수정 (Task 3) |
| `frontend/src/components/csv-template-actions.tsx` | 템플릿 다운로드 + AI 프롬프트 복사 두 버튼 | 생성 (Task 1) |
| `frontend/src/components/csv-import-section.tsx` | 위 + 파일선택/붙여넣기/요약/경고 | 수정 (Task 1, 5) |
| `frontend/src/components/permissions/create-map-dialog.tsx` | 맵 생성 — 임포트 제거, 노티스 | 수정 (Task 1) |
| `frontend/src/components/csv-import-tab.tsx` | 인스펙터 Import 탭 본문 | 생성 (Task 8) |
| `frontend/src/components/inspector-panel.tsx` | `import` 탭 + `forcedTab`/`lockTabs` | 수정 (Task 8) |
| `frontend/src/app/maps/[mapId]/page.tsx` | 프리뷰 상태 기계 · 배선 | 수정 (Task 5, 7, 8) |
| `frontend/src/lib/i18n-messages.ts` | 신규 키 (en+ko) | 수정 (Task 1, 5, 8) |

---

### Task 1: 새맵 다이얼로그 — 준비만, 임포트는 에디터에서

**Files:**
- Create: `frontend/src/components/csv-template-actions.tsx`
- Modify: `frontend/src/components/csv-import-section.tsx`
- Modify: `frontend/src/components/permissions/create-map-dialog.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: `buildAiPromptText`, `buildTemplateCsv` (기존, `@/lib/csv-import`)
- Produces: `CsvTemplateActions({ disabled }: { disabled?: boolean })` · `CSV_OUTLINE_BTN` 상수

- [ ] **Step 1: `CsvTemplateActions` 컴포넌트 생성**

`frontend/src/components/csv-template-actions.tsx`:

```tsx
"use client";

// CSV 준비 액션 — 템플릿 다운로드 + AI 프롬프트 복사. 새 맵 다이얼로그와 CsvImportSection이 공용.
// 외부 AI 왕복: [AI 프롬프트 복사]→외부 AI에 문서와 함께 붙여넣기→받은 CSV를 에디터에서 임포트.
import { useState } from "react";

import { Check, Download, Sparkles } from "lucide-react";

import { buildAiPromptText, buildTemplateCsv } from "@/lib/csv-import";
import { useI18n } from "@/lib/i18n";

export const CSV_OUTLINE_BTN =
  "inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-surface px-2.5 py-1 text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-50";

export function CsvTemplateActions({ disabled }: { disabled?: boolean }) {
  const { t } = useI18n();
  // AI 프롬프트 복사 피드백 — 토스트 의존 없이 버튼 라벨을 잠깐 전환
  const [promptCopied, setPromptCopied] = useState(false);

  const handleDownloadTemplate = () => {
    // UTF-8 BOM 접두 — Excel이 한글을 올바른 인코딩으로 열도록
    const blob = new Blob(["﻿" + buildTemplateCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "bpm-map-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyPrompt = () => {
    void navigator.clipboard?.writeText(buildAiPromptText());
    setPromptCopied(true);
    window.setTimeout(() => setPromptCopied(false), 1200);
  };

  return (
    <>
      <button
        type="button"
        data-id="csv-template-download"
        className={CSV_OUTLINE_BTN}
        onClick={handleDownloadTemplate}
        disabled={disabled}
      >
        <Download size={14} strokeWidth={1.5} />
        {t("csvImport.template")}
      </button>
      <button
        type="button"
        data-id="csv-copy-ai-prompt"
        className={CSV_OUTLINE_BTN}
        onClick={handleCopyPrompt}
        disabled={disabled}
        title={t("csvImport.copyPromptHint")}
      >
        {promptCopied ? (
          <Check size={14} strokeWidth={1.5} className="text-accent" />
        ) : (
          <Sparkles size={14} strokeWidth={1.5} />
        )}
        {promptCopied ? t("csvImport.promptCopied") : t("csvImport.copyPrompt")}
      </button>
    </>
  );
}
```

⚠️ 원본 `csv-import-section.tsx:41`의 BOM은 소스에 리터럴 U+FEFF로 박혀 있다. 위처럼 `"﻿"` 이스케이프로 옮겨 적는다 — 편집기가 보이지 않는 문자를 먹는 사고를 막는다.

- [ ] **Step 2: `CsvImportSection`이 `CsvTemplateActions`를 품게 리팩터**

`csv-import-section.tsx`에서 `handleDownloadTemplate`·`handleCopyPrompt`·`promptCopied` state·`OUTLINE_BTN` 상수·두 버튼 JSX와 이제 안 쓰는 import(`Check`, `Download`, `Sparkles`, `buildAiPromptText`, `buildTemplateCsv`)를 제거한다. 버튼 행 맨 앞에 `<CsvTemplateActions disabled={disabled} />`를 두고, 나머지 버튼은 `CSV_OUTLINE_BTN`을 import해 쓴다.

```tsx
      <div className="flex flex-wrap items-center gap-2">
        <CsvTemplateActions disabled={disabled} />
        <button type="button" data-id="csv-file-pick" className={CSV_OUTLINE_BTN} onClick={() => fileRef.current?.click()} disabled={disabled}>
          <Upload size={14} strokeWidth={1.5} />
          {t("csvImport.chooseFile")}
        </button>
        <button
          type="button"
          data-id="csv-paste-toggle"
          className={`${CSV_OUTLINE_BTN} ${pasteOpen ? "border-accent bg-accent-tint text-accent" : ""}`}
          onClick={() => setPasteOpen((open) => !open)}
          disabled={disabled}
          aria-expanded={pasteOpen}
        >
          <ClipboardPaste size={14} strokeWidth={1.5} />
          {t("csvImport.pasteToggle")}
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => void handleFile(event)} />
      </div>
```

- [ ] **Step 3: i18n 키 추가 · 수정 · 삭제**

`frontend/src/lib/i18n-messages.ts` — `en` 블록(≈96행)과 `ko` 블록(≈1358행) **양쪽**.

수정:
```ts
// en
"csvImport.sectionTitle": "Prepare a CSV (optional)",
// ko
"csvImport.sectionTitle": "CSV 준비 (선택)",
```

추가:
```ts
// en
"csvImport.createNotice": "Import the finished CSV from the editor after the map is created.",
// ko
"csvImport.createNotice": "작성한 CSV는 맵 생성 후 편집 화면에서 임포트합니다.",
```

삭제 (Step 4에서 마지막 사용처가 사라지는 고아):
```ts
"csvImport.mapCreatedImportFailed"   // en·ko 양쪽
```

- [ ] **Step 4: `create-map-dialog.tsx`에서 임포트 제거**

제거: import `acquireCheckout`·`saveGraph`·`CsvImportSection`·`type CsvImportOutcome` / state `csv`·`csvFileName`(`:137-138`)·`createdRef`(`:140`) / `handleCreate`의 `createdRef` 가드와 CSV 분기 / `canCreate`의 csv 절.

추가: `import { CsvTemplateActions } from "@/components/csv-template-actions";` · `lucide-react`의 `{ X, Globe, Lock }` → `{ X, Globe, Lock, Info }`.

```tsx
  const handleCreate = useCallback(async () => {
    if (!currentUser) return;
    const trimmed = name.trim();
    if (!trimmed || approvers.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      // 1. 맵 생성 — 생성자가 owner(서버 부여) / Real map create (owner = creator).
      const detail = await createMap(trimmed, description.trim(), visibility);
      // 2. 초기 협업자 권한 부여 — 즉시 적용(서버) / Grant initial collaborators.
      for (const c of collaborators) {
        const role: "viewer" | "editor" = c.role === "viewer" ? "viewer" : "editor";
        await addMapPermission(detail.id, c.principalType, c.principalId, role);
      }
      // 3. 필수 결재자 지정 — 전체 목록 PUT / Set required approvers (full list).
      await setMapApprovers(detail.id, approvers.map((a) => a.userId));
      onCreated();
      onClose();
      // 4. 항상 에디터로 — CSV 임포트는 편집 화면에서 한다. draft 버전은 에디터가 체크아웃을 자동 획득한다.
      router.push(`/maps/${detail.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("err.createMap"));
      setSubmitting(false);
    }
  }, [currentUser, name, description, visibility, collaborators, approvers, onCreated, onClose, router, t]);

  const canCreate =
    currentUser !== null && name.trim().length > 0 && approvers.length >= 1 && !submitting;
```

CSV 섹션(`:408-420`) 교체:

```tsx
        {/* CSV 준비 (선택) — 템플릿/프롬프트만. 실제 임포트는 에디터에서 한다. */}
        <div className="flex flex-col gap-1.5">
          <label className="text-caption text-ink-secondary">{t("csvImport.sectionTitle")}</label>
          <div className="flex flex-wrap items-center gap-2">
            <CsvTemplateActions disabled={submitting} />
          </div>
          <p data-id="csv-create-notice" className="flex items-start gap-1.5 rounded-sm bg-surface-alt px-2.5 py-1.5 text-fine text-ink-tertiary">
            <Info size={14} strokeWidth={1.5} className="mt-px shrink-0" />
            {t("csvImport.createNotice")}
          </p>
        </div>
```

- [ ] **Step 5: 게이트**

```bash
npm run lint && npm test && npm run build
```
Expected: lint 0 errors · `Tests 162 passed` · build 성공.

```bash
python3 -c "
import pathlib
hits=[f'{p}:{i}' for p in pathlib.Path('frontend/src').rglob('*.ts*') for i,l in enumerate(p.read_text().splitlines(),1) if 'mapCreatedImportFailed' in l]
print(hits or 'clean')"
```
Expected: `clean`

- [ ] **Step 6: 커밋**

`PROGRESS.md`의 `## 2026-07-10 — CSV 임포트 머지 전환 설계` 섹션 아래에 추가:
```markdown
- ① 새맵 다이얼로그 축소 — CsvTemplateActions 추출(템플릿·프롬프트만), 노티스 추가, 생성 후 항상 에디터 이동. `mapCreatedImportFailed` 키 제거. vitest 162·lint 0에러.
```

```bash
git add frontend/src/components/csv-template-actions.tsx frontend/src/components/csv-import-section.tsx frontend/src/components/permissions/create-map-dialog.tsx frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "$(cat <<'EOF'
feat(csv-import): create dialog prepares CSV only, editor imports — 새맵은 CSV 준비만, 임포트는 에디터로 일원화

Two import paths (silent full-write on a fresh map, guarded replace in the
editor) meant the create dialog could never warn about data loss. Collapse to
one path: the dialog offers the template and the AI prompt, and the editor owns
the actual import.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhULXV6HVeYVdyAn9ax8Tc
EOF
)"
```

---

### Task 2: Description · Assignee(login_id) · Department 컬럼 + 비차단 경고 (TDD, 순수 모듈)

**Files:**
- Modify: `frontend/src/lib/csv-import.ts`
- Test: `frontend/src/lib/csv-import.test.ts`

**Interfaces:**
- Consumes: `parseAssignees`, `formatAssignees`, `driftedAssignees` (`@/lib/assignee`)
- Produces:
  ```ts
  export interface CsvDirectory {
    users: readonly { id: string; name: string; department: string }[];
    departments: readonly string[];
    // 정식 부서명 → { korean_name } — 한글 부서명으로 적힌 셀을 정식명으로 되돌린다
    dept_infos?: Readonly<Record<string, { korean_name?: string }>>;
  }
  export interface CsvImportContext { directory?: CsvDirectory }
  export interface CsvImportWarning { line: number; message: string }
  // CsvImportOutcome 에 warnings: CsvImportWarning[] 추가
  export function buildGraphFromCsv(text: string, context?: CsvImportContext): CsvImportOutcome
  ```
  `EligibleAssignees`(`@/lib/api`)는 `CsvDirectory`를 구조적으로 만족한다 — 에디터가 `eligible`을 그대로 넘긴다.

**해석 규칙 (확정):**
- Description 셀 = 자유 텍스트. **`MAX_LEN`에 넣지 않는다** — `NodeIn.description`(`backend/app/schemas.py:18`)에 `max_length`가 없고 `Node.description`은 `Text` 컬럼(`models.py:186`)이다. 미러할 백엔드 제약이 없으므로 상한을 지어내지 않는다. 콤마·줄바꿈은 큰따옴표 셀로 처리된다(`parseCsvRecords`가 이미 지원).
- Assignee 셀 = login_id를 콤마로 나열. 복수면 셀을 큰따옴표로 감싼다.
- 토큰이 `users[].id`와 일치 → 그 사람의 `name`으로 치환.
- 일치하지 않지만 `users[].name`과 정확히 일치 → **경고 없이 그대로 통과**(이미 저장 형식이다. 거짓 경고 방지).
- 둘 다 아니면 원문 저장 + 경고.
- Department 셀이 `departments`에 있으면 그대로. 없으면 `dept_infos[d].korean_name === 셀`인 `d`로 치환. 둘 다 아니면 원문 + 경고.
- 최종 노드의 담당자가 `driftedAssignees(finalDept, names, users)`에 걸리면 경고.
- `directory`가 없으면 해석도 경고도 하지 않는다(원문 통과).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`frontend/src/lib/csv-import.test.ts` 하단에 추가. 상단 import는 그대로 두고 `type CsvDirectory`를 더한다.

```ts
// ── 설명 · 담당자(login_id) · 부서 컬럼 ──────────────────────────

const H9 = "Name,Description,Assignee,Department,System,Duration,URL,URL_Label,Next";

const DIR: CsvDirectory = {
  users: [
    { id: "hong.gd", name: "홍길동", department: "Quality Part 1" },
    { id: "kim.cs", name: "김철수", department: "Quality Part 1" },
    { id: "lee.yh", name: "이영희", department: "Finance Part" },
  ],
  departments: ["Quality Part 1", "Finance Part"],
  dept_infos: { "Quality Part 1": { korean_name: "품질1파트" } },
};

function outcomeOf(csv: string, directory?: CsvDirectory) {
  return buildGraphFromCsv(csv, directory ? { directory } : undefined);
}

describe("buildGraphFromCsv — Description/Assignee/Department 컬럼", () => {
  it("설명 셀을 노드 description으로 싣는다", () => {
    const o = outcomeOf(`${H9}\n요청 검토,담당자가 내용을 확인한다,,,,,,,\n`, DIR);
    expect(o.errors).toEqual([]);
    expect(o.graph!.nodes.find((n) => n.title === "요청 검토")!.description).toBe("담당자가 내용을 확인한다");
  });

  it("따옴표 안 콤마·줄바꿈을 품은 설명을 그대로 싣는다", () => {
    const o = outcomeOf(`${H9}\n요청 검토,"1줄, 쉼표\n2줄",,,,,,,\n`, DIR);
    expect(o.errors).toEqual([]);
    expect(o.graph!.nodes.find((n) => n.title === "요청 검토")!.description).toBe("1줄, 쉼표\n2줄");
  });

  it("login_id를 이름으로 해석한다", () => {
    const o = outcomeOf(`${H9}\n요청 검토,,hong.gd,Quality Part 1,,,,,\n`, DIR);
    expect(o.errors).toEqual([]);
    expect(o.warnings).toEqual([]);
    const node = o.graph!.nodes.find((n) => n.title === "요청 검토")!;
    expect(node.assignee).toBe("홍길동");
    expect(node.department).toBe("Quality Part 1");
  });

  it("따옴표 셀의 복수 login_id를 해석해 \", \"로 잇는다", () => {
    const o = outcomeOf(`${H9}\n승인,,"hong.gd, kim.cs",Quality Part 1,,,,,\n`, DIR);
    expect(o.warnings).toEqual([]);
    expect(o.graph!.nodes.find((n) => n.title === "승인")!.assignee).toBe("홍길동, 김철수");
  });

  it("이미 이름으로 적힌 토큰은 경고 없이 통과시킨다", () => {
    const o = outcomeOf(`${H9}\n요청 검토,,홍길동,Quality Part 1,,,,,\n`, DIR);
    expect(o.warnings).toEqual([]);
    expect(o.graph!.nodes.find((n) => n.title === "요청 검토")!.assignee).toBe("홍길동");
  });

  it("해석되지 않는 담당자는 원문을 남기고 경고한다", () => {
    const o = outcomeOf(`${H9}\n요청 검토,,ghost.id,Quality Part 1,,,,,\n`, DIR);
    expect(o.errors).toEqual([]);
    expect(o.graph!.nodes.find((n) => n.title === "요청 검토")!.assignee).toBe("ghost.id");
    expect(o.warnings).toHaveLength(1);
    expect(o.warnings[0].line).toBe(2);
    expect(o.warnings[0].message).toContain("ghost.id");
  });

  it("한글 부서명을 정식 부서명으로 되돌린다", () => {
    const o = outcomeOf(`${H9}\n요청 검토,,hong.gd,품질1파트,,,,,\n`, DIR);
    expect(o.warnings).toEqual([]);
    expect(o.graph!.nodes.find((n) => n.title === "요청 검토")!.department).toBe("Quality Part 1");
  });

  it("알 수 없는 부서는 원문을 남기고 경고한다", () => {
    const o = outcomeOf(`${H9}\n요청 검토,,,없는파트,,,,,\n`, DIR);
    expect(o.graph!.nodes.find((n) => n.title === "요청 검토")!.department).toBe("없는파트");
    expect(o.warnings.some((w) => w.message.includes("없는파트"))).toBe(true);
  });

  it("담당자 부서가 행 부서와 다르면 경고한다 (assignee.ts 불변식)", () => {
    const o = outcomeOf(`${H9}\n승인,,"hong.gd, lee.yh",Quality Part 1,,,,,\n`, DIR);
    expect(o.errors).toEqual([]);
    expect(o.warnings.some((w) => w.message.includes("이영희"))).toBe(true);
  });

  it("해석 후 길이가 100자를 넘으면 에러다 (NodeIn max_length 미러)", () => {
    const longName = "가".repeat(101);
    const dir: CsvDirectory = { users: [{ id: "x", name: longName, department: "Finance Part" }], departments: ["Finance Part"] };
    const o = outcomeOf(`${H9}\n요청 검토,,x,Finance Part,,,,,\n`, dir);
    expect(o.graph).toBeNull();
    expect(o.errors[0].message).toContain("assignee");
  });

  it("디렉터리가 없으면 해석도 경고도 하지 않는다", () => {
    const o = outcomeOf(`${H9}\n요청 검토,,hong.gd,품질1파트,,,,,\n`);
    expect(o.warnings).toEqual([]);
    const node = o.graph!.nodes.find((n) => n.title === "요청 검토")!;
    expect(node.assignee).toBe("hong.gd");
    expect(node.department).toBe("품질1파트");
  });

  it("새 열이 없는 옛 CSV도 그대로 파싱된다 (회귀)", () => {
    const o = outcomeOf(`${HEADER}\nReview request,SAP,2 days,,\n`, DIR);
    expect(o.errors).toEqual([]);
    const node = o.graph!.nodes.find((n) => n.title === "Review request")!;
    expect(node.description).toBe("");
    expect(node.assignee).toBe("");
    expect(node.department).toBe("");
    expect(node.system).toBe("SAP");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npm test -- csv-import
```
Expected: FAIL — `Unknown column "Assignee"` / `o.warnings` undefined / `CsvDirectory` is not exported.

- [ ] **Step 3: 구현**

`csv-import.ts` 상단:

```ts
import { driftedAssignees, formatAssignees, parseAssignees } from "./assignee";

const HEADER_COLUMNS = [
  "name", "description", "assignee", "department", "system", "duration", "url", "url_label", "next",
] as const;
type HeaderColumn = (typeof HEADER_COLUMNS)[number];

// 백엔드 NodeIn 제약 미러. description은 NodeIn에 max_length가 없고 Node.description이 Text 컬럼이라 제외한다.
const MAX_LEN: Record<Exclude<HeaderColumn, "next" | "description">, number> = {
  name: 200,
  assignee: 100,   // NodeIn.assignee — 해석된 "이름" 문자열 기준
  department: 100, // NodeIn.department
  system: 100,
  duration: 50,
  url: 500,
  url_label: 100,
};

export interface CsvDirectory {
  users: readonly { id: string; name: string; department: string }[];
  departments: readonly string[];
  // 정식 부서명 → { korean_name } — 한글로 적힌 부서 셀을 정식명으로 되돌린다
  dept_infos?: Readonly<Record<string, { korean_name?: string }>>;
}

/** 임포트 문맥 — 디렉터리는 담당자/부서 해석에, base(Task 4)는 머지에 쓴다. */
export interface CsvImportContext {
  directory?: CsvDirectory;
}

/** 비차단 경고 — 임포트를 막지 않는다. 백엔드는 담당자를 검증하지 않으므로 유일한 사전 안내다. */
export interface CsvImportWarning {
  line: number;
  message: string;
}
```

`CsvImportOutcome`에 `warnings: CsvImportWarning[]`를 더하고 `fail()`이 `warnings: []`를 채우게 한다.

`rows` 매핑에 세 열을 추가한다:
```ts
  const rows = dataRecords.map((r) => ({
    name: cellOf(r, "name"),
    description: cellOf(r, "description"),
    assignee: cellOf(r, "assignee"),
    department: cellOf(r, "department"),
    system: cellOf(r, "system"),
    duration: cellOf(r, "duration"),
    url: cellOf(r, "url"),
    url_label: cellOf(r, "url_label"),
    nextRaw: cellOf(r, "next"),
    line: r.line,
  }));
```

해석 헬퍼를 `buildGraphFromCsv` 위에 둔다:

```ts
/** login_id → 이름. 이미 이름이면 그대로(거짓 경고 방지). 못 찾으면 원문 + 경고. */
function resolveAssignee(
  raw: string, dir: CsvDirectory | undefined, line: number, warnings: CsvImportWarning[],
): string {
  if (raw === "" || dir === undefined) return raw;
  const names = parseAssignees(raw).map((token) => {
    const byId = dir.users.find((user) => user.id === token);
    if (byId) return byId.name;
    if (dir.users.some((user) => user.name === token)) return token;
    warnings.push({ line, message: `Unknown assignee "${token}"` });
    return token;
  });
  return formatAssignees(names);
}

/** 정식 부서명 그대로, 아니면 한글 부서명 역인덱스. 못 찾으면 원문 + 경고. */
function resolveDepartment(
  raw: string, dir: CsvDirectory | undefined, line: number, warnings: CsvImportWarning[],
): string {
  if (raw === "" || dir === undefined) return raw;
  if (dir.departments.includes(raw)) return raw;
  const canonical = Object.entries(dir.dept_infos ?? {}).find(
    ([, info]) => info.korean_name === raw,
  )?.[0];
  if (canonical) return canonical;
  warnings.push({ line, message: `Unknown department "${raw}"` });
  return raw;
}
```

해석·길이 검사 루프를 **`nextsOf` 파싱 직후, `if (errors.length > 0) return fail(errors);` 바로 앞**에 넣는다. 그래야 `names`(첫 검증 루프에서 채워짐)를 참조할 수 있고, 길이 에러가 조기 반환에 함께 실린다. **해석 후** 길이를 잰다 — id는 짧아도 이름은 길 수 있다:

```ts
  const warnings: CsvImportWarning[] = [];
  const resolved = new Map<string, { assignee: string; department: string }>();
  for (const row of rows) {
    if (!names.has(row.name)) continue; // 이름 에러 행은 스킵
    const assignee = resolveAssignee(row.assignee, context?.directory, row.line, warnings);
    const department = resolveDepartment(row.department, context?.directory, row.line, warnings);
    if (assignee.length > MAX_LEN.assignee) {
      errors.push({ line: row.line, message: `assignee exceeds ${MAX_LEN.assignee} characters` });
    }
    if (department.length > MAX_LEN.department) {
      errors.push({ line: row.line, message: `department exceeds ${MAX_LEN.department} characters` });
    }
    resolved.set(row.name, { assignee, department });
  }
```

기존 `for (const col of ["name","system","duration","url","url_label"] as const)` 길이 루프는 그대로 둔다 (assignee/department는 위에서 해석 후 검사했으므로 제외).

노드 생성 시 세 필드를 채운다 (`NODE_DEFAULTS` 뒤):
```ts
      description: row.description,
      assignee: resolved.get(row.name)?.assignee ?? "",
      department: resolved.get(row.name)?.department ?? "",
```

⚠️ 기존 길이 검사 루프는 `["name","system","duration","url","url_label"]`만 돈다. **`description`을 거기 넣지 말 것** — `MAX_LEN`에 키가 없어 타입 에러가 난다. 이는 의도된 것이다(백엔드에 제약 없음).

노드가 완성된 뒤 부서 불일치 경고를 낸다 (`driftedAssignees` 재사용). 행 번호가 필요하므로 `rows`와 짝지어 돈다:
```ts
  if (context?.directory) {
    const dir = context.directory;
    for (const row of rows) {
      const info = resolved.get(row.name);
      if (!info || info.assignee === "") continue;
      const drifted = driftedAssignees(info.department, parseAssignees(info.assignee), dir.users);
      for (const name of drifted) {
        warnings.push({ line: row.line, message: `"${name}" is not in department "${info.department}"` });
      }
    }
  }
```

⚠️ `driftedAssignees`는 부서가 다르거나 디렉터리에 없는 사람을 모두 돌려준다. 이미 `resolveAssignee`가 경고한 미해석 토큰이 여기서 또 걸린다 — **중복 경고를 막으려면** 해석에 성공한 이름만 검사한다:
```ts
      const known = parseAssignees(info.assignee).filter((n) => dir.users.some((u) => u.name === n));
      const drifted = driftedAssignees(info.department, known, dir.users);
```

반환값에 `warnings`를 싣는다.

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm test -- csv-import
```
Expected: PASS — 기존 23개 + 신규 12개 = 35개.

```bash
npm run lint && npm test && npm run build
```
Expected: lint 0 errors · `Tests 174 passed` · build 성공.

- [ ] **Step 5: 커밋**

`PROGRESS.md`:
```markdown
- ①-b CSV 컬럼 확장 — Description(길이 제한 없음, Text 컬럼)·Assignee(login_id→이름 해석, 이름 직접 표기도 통과)·Department(한글 부서명→정식명) + 비차단 경고(미해석 담당자·미지 부서·부서 불일치). 백엔드는 담당자를 검증하지 않아 프론트 드리프트 배지가 유일한 안전망. vitest 174·lint 0에러.
```

```bash
git add frontend/src/lib/csv-import.ts frontend/src/lib/csv-import.test.ts PROGRESS.md
git commit -m "$(cat <<'EOF'
feat(csv-import): add Description, Assignee (login_id) and Department columns — CSV에 설명·담당자·부서 열 추가

Nodes store assignee as a display name, so a login_id written in the CSV is
resolved through the eligible-assignee directory. Unresolved tokens and unknown
departments are kept verbatim and reported as non-blocking warnings — the
backend validates neither, and the drift badge is the only safety net.
Description has no backend length limit (Text column), so it gets no MAX_LEN.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhULXV6HVeYVdyAn9ax8Tc
EOF
)"
```

---

### Task 3: 템플릿 · AI 프롬프트 · 샘플 CSV 갱신

**Files:**
- Modify: `frontend/src/lib/csv-import.ts` (`buildTemplateCsv`, `buildAiPromptText`)
- Modify: `docs/samples/csv-sample-01-procurement.csv`
- Modify: `docs/samples/csv-sample-02-recruitment.csv`
- Modify: `docs/samples/csv-sample-03-incident-change.csv`

**Interfaces:**
- Consumes: `MAX_LEN`, `MAX_DATA_ROWS` (Task 2)
- Produces: 9열 헤더 `Name,Description,Assignee,Department,System,Duration,URL,URL_Label,Next`

⚠️ 샘플 3종은 **이미 낡았다** — 헤더가 `Name,System,Duration,URL,Next`로 `URL_Label`이 빠져 있다. 파서가 열 부분집합을 허용해 조용히 통과 중이었다. 9열로 재작성한다. 앞의 BOM(`﻿`)은 유지한다.

- [ ] **Step 1: `buildTemplateCsv` 교체**

```ts
/** 다운로드용 템플릿 — 구매 프로세스 예시. Excel 호환 CRLF(BOM은 다운로드 시 접두).
 *  Assignee는 사내 계정 id, Department는 정식 부서명. 값은 예시라 실제 디렉터리에 없으면 경고가 뜬다. */
export function buildTemplateCsv(): string {
  return [
    "Name,Description,Assignee,Department,System,Duration,URL,URL_Label,Next",
    "Review request,Check the request against the purchasing policy,hong.gd,Quality Part 1,SAP ERP,2 days,,,Approval decision",
    'Approval decision,,"hong.gd, kim.cs",Quality Part 1,,,,,Sign contract:approved;Notify rejection:rejected',
    "Sign contract,,lee.yh,Finance Part,,3 days,https://example.com/contract,Contract,",
    "Notify rejection,,,,,1 day,,,",
  ].join("\r\n");
}
```

⚠️ 3행은 셀 안에 콤마가 있어 **작은따옴표 문자열 + 큰따옴표 셀**로 적는다. 각 행의 셀은 정확히 9개다 — `join("\r\n")` 뒤 파서를 다시 통과해야 한다.

- [ ] **Step 2: `buildAiPromptText`에 세 컬럼 규칙 추가**

`[컬럼 규칙]` 블록의 `Name` 다음에 삽입:

```ts
    "- Description: 선택, 그 단계가 무엇을 하는지 한두 문장. 콤마나 줄바꿈이 들어가면 셀 전체를 큰따옴표로 감싸세요. 길이 제한은 없습니다.",
    `- Assignee: 선택, 담당자의 사내 계정 id(login id). 여러 명이면 콤마로 나열하고 셀 전체를 큰따옴표로 감싸세요 — 예: "hong.gd, kim.cs". 한 행의 담당자는 모두 같은 부서여야 합니다. 모르면 비워두세요.`,
    `- Department: 선택, 담당 부서의 정식 부서명(${MAX_LEN.department}자 이하). 모르면 비워두세요.`,
```

`[작성 규칙]`의 마지막 줄을 세 열까지 포함하도록 고친다:

```ts
    "- 문서에 없는 단계를 지어내지 말고, 불명확한 속성(Description·Assignee·Department·System·Duration·URL)은 비워두세요.",
    "- 빈 칸은 기존 값을 지웁니다가 아니라 '건드리지 않음'입니다 — 이미 있는 맵에 임포트해도 기존 값이 보존됩니다.",
```

- [ ] **Step 3: 샘플 CSV 3종 재작성**

각 파일의 헤더를 9열로 바꾸고 모든 행의 셀 수를 맞춘다. Description/Assignee/Department는 실제 디렉터리를 모르므로 **비워 둔다**(경고 없이 임포트되게). `URL_Label` 열도 추가한다.

`docs/samples/csv-sample-01-procurement.csv`의 앞부분:
```
Name,Description,Assignee,Department,System,Duration,URL,URL_Label,Next
구매 요청 등록,,,,SAP ERP,0.5 days,,,요청 내용 검토
요청 내용 검토,,,,,1 day,,,예산 확인
예산 확인,,,,SAP ERP,0.5 days,,,팀장 승인:예산 내;예산 조정 협의:예산 초과
```

원본 행을 기계적으로 변환한다. `Name,System,Duration,URL,Next` → `Name,,,,System,Duration,URL,,Next`:

```bash
python3 - <<'PY'
import pathlib
NEW = "Name,Description,Assignee,Department,System,Duration,URL,URL_Label,Next"
for p in sorted(pathlib.Path("docs/samples").glob("*.csv")):
    raw = p.read_text(encoding="utf-8")
    bom = raw.startswith("﻿")
    lines = raw.lstrip("﻿").splitlines()
    assert lines[0].strip() == "Name,System,Duration,URL,Next", (p, lines[0])
    out = [NEW]
    for line in lines[1:]:
        if not line.strip():
            continue
        # 5열 → 9열. 따옴표 셀이 없는 샘플이라 단순 split 으로 충분(검증: 셀 5개)
        cells = line.split(",")
        assert len(cells) == 5, (p, line)
        name, system, duration, url, nxt = cells
        out.append(",".join([name, "", "", "", system, duration, url, "", nxt]))
    p.write_text(("﻿" if bom else "") + "\n".join(out) + "\n", encoding="utf-8")
    print("rewrote", p, len(out) - 1, "rows")
PY
```

⚠️ 이 스크립트는 파일을 만든다. 위 Global Constraints의 "파일 작성은 Write/Edit로"는 **소스 코드**에 대한 것이고, 여기서는 기계적 열 변환이라 스크립트가 정확하다. 변환 후 `git diff`로 눈으로 확인한다.

⚠️ `assert len(cells) == 5`가 터지면 그 행에 콤마가 들어 있다는 뜻이다. 그 파일은 손으로 고친다. 스크립트를 완화해 넘기지 말 것.

- [ ] **Step 4: 샘플이 실제로 파싱되는지 확인**

임시 테스트로 세 파일을 파서에 통과시킨다. 통과를 확인한 뒤 **테스트 파일은 남기지 않는다**(샘플은 문서 자산이지 코드가 아니다).

```bash
npx tsx -e '
import { readFileSync, readdirSync } from "node:fs";
import { buildGraphFromCsv, decodeCsvBuffer } from "./src/lib/csv-import.ts";
for (const f of readdirSync("../docs/samples")) {
  const buf = readFileSync(`../docs/samples/${f}`);
  const o = buildGraphFromCsv(decodeCsvBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
  console.log(f, "errors:", o.errors, "nodes:", o.nodeCount);
}' 2>&1 | tail -8
```
Expected: 세 파일 모두 `errors: []`.

`tsx`가 없으면 대신 파싱 결과를 확인하는 **일회성 vitest**를 만들어 돌리고 지운다. 어느 쪽이든 **눈으로 `errors: []`를 확인**한 뒤 넘어간다.

- [ ] **Step 5: 게이트 · 커밋**

```bash
npm run lint && npm test && npm run build
```
Expected: lint 0 errors · `Tests 174 passed` · build 성공.

⚠️ `buildTemplateCsv()`가 바뀌면 그 출력을 헤더로 쓰는 `buildAiPromptText` 테스트(`csv-import.test.ts`의 `buildTemplateCsv`/`buildAiPromptText` describe)가 깨질 수 있다. 깨지면 **기대값을 새 헤더로 갱신**한다 — 테스트를 지우지 말 것.

`PROGRESS.md`:
```markdown
- ①-b 템플릿·AI 프롬프트에 Description·Assignee(계정 id)·Department 규칙 추가, "빈 칸=건드리지 않음" 명시. `docs/samples/*.csv` 3종은 헤더가 URL_Label 없이 낡아 있어 9열로 재작성. vitest 174·lint 0에러.
```

```bash
git add frontend/src/lib/csv-import.ts docs/samples/ PROGRESS.md
git commit -m "$(cat <<'EOF'
docs(csv-import): template, AI prompt and samples carry the new columns — 템플릿·프롬프트·샘플에 담당자·부서 열 반영

The three sample files were already stale — their header predates URL_Label and
the parser's column-subset tolerance hid it. Rewritten to the full 8-column
header alongside the new Assignee/Department rules.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhULXV6HVeYVdyAn9ax8Tc
EOF
)"
```

---

### Task 4: 이름 기준 머지 코어 (TDD, 순수 모듈)

**Files:**
- Modify: `frontend/src/lib/csv-import.ts`
- Test: `frontend/src/lib/csv-import.test.ts`

**Interfaces:**
- Consumes: `Graph`, `GraphNode`, `GraphEdge` (`@/lib/api`), `layoutWithDagre`, `layoutSubsetWithDagre`, `normalizeNodeType`, `AppNode` (`@/lib/canvas`), `genId` (`@/lib/id`), `CsvImportContext` (Task 2)
- Produces:
  ```ts
  export interface CsvMergeInfo {
    addedNodeIds: string[];      // CSV에만 있어 새로 만든 노드 id
    removedNodes: GraphNode[];   // base에만 있는 노드 (삭제 대상 후보)
    lostEdges: GraphEdge[];      // base에 있으나 결과 그래프에 없는 엣지
    matchedCount: number;        // id를 재사용한 노드 수
  }
  // CsvImportContext 에 base?: Graph 추가
  // CsvImportOutcome 에 merge: CsvMergeInfo 추가
  export function withKeptNodes(graph: Graph, kept: GraphNode[]): Graph
  ```

**핵심 규칙:**
- 매칭 키 = 제목. Start/End는 `node_type`으로 매칭하고 **기존 제목을 유지**.
- 매칭 노드는 `id`·좌표·`color`·`group_ids`·서브프로세스 링크를 보존.
- **값이 있는 셀만 덮어쓴다** (`description`·`assignee`·`department`·`system`·`duration`·`url`·`url_label`). 빈 셀은 기존 값 유지.
- `node_type`은 항상 CSV 추론값. 단 `linked_map_id !== null`이면 보존.
- 엣지는 CSV의 `next`가 전량 규정.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`csv-import.test.ts` 하단에 추가. import에 `withKeptNodes`, `type GraphNode`를 더한다.

```ts
// ── 머지 임포트 (base 지정) ─────────────────────────────────────

const NODE_BASE: Omit<GraphNode, "id" | "title" | "node_type" | "sort_order"> = {
  description: "", color: "", assignee: "", department: "", system: "", duration: "",
  url: "", url_label: "", pos_x: 0, pos_y: 0, group_ids: [],
  linked_map_id: null, follow_latest: false, linked_version_id: null, is_primary_end: false,
};

function baseGraph(): Graph {
  return {
    nodes: [
      { ...NODE_BASE, id: "s1", title: "시작", node_type: "start", sort_order: 0 },
      {
        ...NODE_BASE, id: "a1", title: "Review request", node_type: "process", sort_order: 1,
        pos_x: 300, pos_y: 40, color: "#334155", assignee: "홍길동", department: "Quality Part 1",
        system: "SAP", description: "기존 설명", group_ids: ["g1"],
      },
      { ...NODE_BASE, id: "e1", title: "종료", node_type: "end", sort_order: 2, pos_x: 600, is_primary_end: true },
    ],
    edges: [
      { id: "x1", source_node_id: "s1", target_node_id: "a1", label: "", source_side: "right", target_side: "left", source_handle: null, target_handle: null },
      { id: "x2", source_node_id: "a1", target_node_id: "e1", label: "", source_side: "right", target_side: "left", source_handle: null, target_handle: null },
    ],
    groups: [{ id: "g1", parent_group_id: null, label: "검수", color: "" }],
  };
}

function mergeOf(csv: string, base = baseGraph()) {
  return buildGraphFromCsv(csv, { base });
}

describe("buildGraphFromCsv — 머지", () => {
  it("제목이 같은 노드는 id를 재사용한다 (계보·코멘트 보존의 근거)", () => {
    const o = mergeOf(`${H9}\nReview request,,,,,,,,\n`);
    expect(o.errors).toEqual([]);
    expect(o.graph!.nodes.find((n) => n.title === "Review request")!.id).toBe("a1");
    expect(o.merge.matchedCount).toBe(3); // start + Review request + end
    expect(o.merge.addedNodeIds).toEqual([]);
    expect(o.merge.removedNodes).toEqual([]);
  });

  it("빈 셀은 기존 값을 지킨다", () => {
    const o = mergeOf(`${H9}\nReview request,,,,,,,,\n`);
    const node = o.graph!.nodes.find((n) => n.id === "a1")!;
    expect(node.description).toBe("기존 설명");
    expect(node.assignee).toBe("홍길동");
    expect(node.department).toBe("Quality Part 1");
    expect(node.system).toBe("SAP");
  });

  it("값이 있는 셀은 덮어쓴다", () => {
    const o = buildGraphFromCsv(`${H9}\nReview request,새 설명,kim.cs,Quality Part 1,ERP,5 days,,,\n`, { base: baseGraph(), directory: DIR });
    const node = o.graph!.nodes.find((n) => n.id === "a1")!;
    expect(node.description).toBe("새 설명");
    expect(node.assignee).toBe("김철수");
    expect(node.department).toBe("Quality Part 1");
    expect(node.system).toBe("ERP");
    expect(node.duration).toBe("5 days");
  });

  it("CSV가 싣지 않는 필드는 언제나 보존한다", () => {
    const o = mergeOf(`${H9}\nReview request,,,,,,,,\n`);
    const node = o.graph!.nodes.find((n) => n.id === "a1")!;
    expect(node.color).toBe("#334155");
    expect(node.group_ids).toEqual(["g1"]);
    expect(node.pos_x).toBe(300);
  });

  it("기존 그룹을 그대로 통과시킨다", () => {
    const o = mergeOf(`${H9}\nReview request,,,,,,,,\n`);
    expect(o.graph!.groups).toEqual([{ id: "g1", parent_group_id: null, label: "검수", color: "" }]);
  });

  it("Start/End는 타입으로 매칭하고 기존 제목을 유지한다", () => {
    const o = mergeOf(`${H9}\nReview request,,,,,,,,\n`);
    const start = o.graph!.nodes.find((n) => n.node_type === "start")!;
    const end = o.graph!.nodes.find((n) => n.node_type === "end")!;
    expect([start.id, start.title]).toEqual(["s1", "시작"]);
    expect([end.id, end.title]).toEqual(["e1", "종료"]);
    expect(end.is_primary_end).toBe(true);
  });

  it("서브프로세스 노드는 node_type을 보존한다 (Call Activity 링크 유지)", () => {
    const base = baseGraph();
    base.nodes[1] = { ...base.nodes[1], node_type: "subprocess", linked_map_id: 7 };
    const o = mergeOf(`${H9}\nReview request,,,,,,,,\n`, base);
    const node = o.graph!.nodes.find((n) => n.id === "a1")!;
    expect(node.node_type).toBe("subprocess");
    expect(node.linked_map_id).toBe(7);
  });

  it("CSV에만 있는 행은 신규 노드가 되고 addedNodeIds에 담긴다", () => {
    const o = mergeOf(`${H9}\nReview request,,,,,,,,Sign contract\nSign contract,,,,,,,,\n`);
    const sign = o.graph!.nodes.find((n) => n.title === "Sign contract")!;
    expect(o.merge.addedNodeIds).toEqual([sign.id]);
    expect(sign.id).not.toBe("a1");
  });

  it("base에만 있는 노드는 결과에서 빠지고 removedNodes로 보고된다", () => {
    const o = mergeOf(`${H9}\nSign contract,,,,,,,,\n`);
    expect(o.graph!.nodes.some((n) => n.id === "a1")).toBe(false);
    expect(o.merge.removedNodes.map((n) => n.id)).toEqual(["a1"]);
  });

  it("결과 그래프에 없는 base 엣지를 lostEdges로 보고한다", () => {
    const o = mergeOf(`${H9}\nSign contract,,,,,,,,\n`);
    expect(o.merge.lostEdges.map((e) => e.id).sort()).toEqual(["x1", "x2"]);
  });

  it("흐름이 그대로면 lostEdges가 비어 있다", () => {
    const o = mergeOf(`${H9}\nReview request,,,,,,,,\n`);
    expect(o.merge.lostEdges).toEqual([]);
  });

  it("신규 노드만 재배치하고 매칭 노드 좌표는 건드리지 않는다", () => {
    const o = mergeOf(`${H9}\nReview request,,,,,,,,Sign contract\nSign contract,,,,,,,,\n`);
    expect(o.graph!.nodes.find((n) => n.id === "a1")!.pos_x).toBe(300);
    expect(o.graph!.nodes.find((n) => n.id === "s1")!.pos_x).toBe(0);
  });

  it("base 미지정이면 전량 신규다 (회귀)", () => {
    const o = buildGraphFromCsv(`${H9}\nReview request,,,,,,,,\n`);
    expect(o.merge.removedNodes).toEqual([]);
    expect(o.merge.matchedCount).toBe(0);
    expect(o.merge.addedNodeIds).toHaveLength(3); // Start + 1행 + End
    expect(o.graph!.groups).toEqual([]);
  });

  it("빈 base는 base 미지정과 같다", () => {
    const o = buildGraphFromCsv(`${H9}\nReview request,,,,,,,,\n`, { base: { nodes: [], edges: [], groups: [] } });
    expect(o.merge.matchedCount).toBe(0);
    expect(o.merge.removedNodes).toEqual([]);
  });
});

describe("withKeptNodes", () => {
  it("소멸 노드를 엣지 없이 되돌리고 sort_order를 뒤에 붙인다", () => {
    const o = mergeOf(`${H9}\nSign contract,,,,,,,,\n`);
    const maxOrder = o.graph!.nodes.reduce((max, n) => Math.max(max, n.sort_order), 0);
    const kept = withKeptNodes(o.graph!, o.merge.removedNodes);
    const review = kept.nodes.find((n) => n.id === "a1")!;
    expect(review.title).toBe("Review request");
    expect(review.color).toBe("#334155");
    expect(kept.edges.some((e) => e.source_node_id === "a1" || e.target_node_id === "a1")).toBe(false);
    expect(review.sort_order).toBe(maxOrder + 1);
  });

  it("유지 노드가 대표 끝을 다시 들고 오지 않는다 (validate_process 위반 방지)", () => {
    const base = baseGraph();
    base.nodes.push({ ...NODE_BASE, id: "e2", title: "취소 종료", node_type: "end", sort_order: 3 });
    const o = mergeOf(`${H9}\nReview request,,,,,,,,\n`, base);
    const kept = withKeptNodes(o.graph!, o.merge.removedNodes);
    expect(kept.nodes.filter((n) => n.is_primary_end)).toHaveLength(1);
  });

  it("빈 배열이면 그래프를 그대로 반환한다", () => {
    const o = mergeOf(`${H9}\nReview request,,,,,,,,\n`);
    expect(withKeptNodes(o.graph!, [])).toBe(o.graph!);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npm test -- csv-import
```
Expected: FAIL — `context.base` 미지원 / `o.merge` undefined / `withKeptNodes` is not exported.

- [ ] **Step 3: 구현**

import에 `layoutSubsetWithDagre`를 더한다:
```ts
import { type AppNode, layoutSubsetWithDagre, layoutWithDagre, normalizeNodeType } from "./canvas";
```

타입 확장:
```ts
export interface CsvMergeInfo {
  // CSV에만 있어 새로 만든 노드 id — 프리뷰에서 "added" 하이라이트 대상
  addedNodeIds: string[];
  // base에만 있는 노드 — 삭제/유지 선택 대상
  removedNodes: GraphNode[];
  // base에 있으나 결과 그래프에 없는 엣지 — 프리뷰에서 빨간 점선
  lostEdges: GraphEdge[];
  // id를 재사용한 노드 수 (Start/End 포함)
  matchedCount: number;
}

export interface CsvImportContext {
  directory?: CsvDirectory;
  // 머지 대상 기존 그래프. 없거나 비어 있으면 전량 신규(현행 동작).
  base?: Graph;
}
```
`CsvImportOutcome`에 `merge: CsvMergeInfo`를 더한다. `fail()`은 **매번 새 객체**를 만든다 — 공유 배열은 호출자의 실수 한 번으로 전역을 오염시킨다:
```ts
const emptyMerge = (): CsvMergeInfo => ({ addedNodeIds: [], removedNodes: [], lostEdges: [], matchedCount: 0 });

const fail = (errors: CsvImportError[]): CsvImportOutcome => ({
  graph: null, nodeCount: 0, edgeCount: 0, errors, ignoredLabelCount: 0, warnings: [], merge: emptyMerge(),
});
```

`errors` 검증 통과 뒤(`if (errors.length > 0) return fail(errors);` 아래)를 다음으로 교체한다:

```ts
  // ── 기존 그래프와 매칭 ────────────────────────────────────────
  const baseNodes = context?.base?.nodes ?? [];
  const baseStart = baseNodes.find((node) => node.node_type === "start") ?? null;
  const baseEnds = baseNodes.filter((node) => node.node_type === "end");
  // 대표 끝 우선, 없으면 sort_order 최소 (validate_process의 기본 지정 규칙과 동일)
  const baseEnd =
    baseEnds.find((node) => node.is_primary_end) ??
    [...baseEnds].sort((a, b) => a.sort_order - b.sort_order)[0] ??
    null;

  // 제목 → 기존 노드. start/end는 타입으로 이미 잡았으니 제외.
  // 제목 중복 시 sort_order 최소가 이긴다(결정적) — 나머지는 removedNodes로 떨어진다.
  const reservedIds = new Set([baseStart?.id, baseEnd?.id].filter((id): id is string => id !== undefined));
  const byTitle = new Map<string, GraphNode>();
  for (const node of [...baseNodes].sort((a, b) => a.sort_order - b.sort_order)) {
    if (reservedIds.has(node.id)) continue;
    if (!byTitle.has(node.title)) byTitle.set(node.title, node);
  }

  const matchedIds = new Set<string>();
  const addedNodeIds: string[] = [];
  const idOf = new Map<string, string>();
  for (const row of rows) {
    const existing = byTitle.get(row.name);
    if (existing) {
      idOf.set(row.name, existing.id);
      matchedIds.add(existing.id);
    } else {
      const id = genId();
      idOf.set(row.name, id);
      addedNodeIds.push(id);
    }
  }
  const startId = baseStart?.id ?? genId();
  const endId = baseEnd?.id ?? genId();
  if (baseStart) matchedIds.add(startId); else addedNodeIds.push(startId);
  if (baseEnd) matchedIds.add(endId); else addedNodeIds.push(endId);

  // 빈 셀은 "건드리지 않음" — AI 프롬프트가 모르는 속성을 비워두라고 지시하므로,
  // 빈 칸이 값을 지우면 AI 생성 CSV 재임포트마다 기존 속성이 전멸한다.
  const pick = (next: string, existing: string): string => (next === "" ? existing : next);

  // 매칭 노드: id·좌표·색·그룹·서브프로세스 링크 보존.
  // 서브프로세스 노드는 node_type도 보존 — CSV 추론값으로 덮으면 Call Activity 렌더가 깨진다.
  const mergeNode = (existing: GraphNode | null, next: GraphNode): GraphNode =>
    existing === null
      ? next
      : {
          ...existing,
          title: next.title,
          node_type: existing.linked_map_id !== null ? existing.node_type : next.node_type,
          description: pick(next.description, existing.description),
          assignee: pick(next.assignee, existing.assignee),
          department: pick(next.department, existing.department),
          system: pick(next.system, existing.system),
          duration: pick(next.duration, existing.duration),
          url: pick(next.url ?? "", existing.url ?? ""),
          url_label: pick(next.url_label ?? "", existing.url_label ?? ""),
          sort_order: next.sort_order,
        };

  const nodes: GraphNode[] = [
    // Start/End는 CSV가 이름을 싣지 않는다 → 기존 제목 유지("시작"을 "Start"로 덮으면 거짓 변경)
    mergeNode(baseStart, { ...NODE_DEFAULTS, id: startId, title: baseStart?.title ?? "Start", node_type: "start", sort_order: 0 }),
    ...rows.map((row, i) =>
      mergeNode(byTitle.get(row.name) ?? null, {
        ...NODE_DEFAULTS,
        id: idOf.get(row.name) as string,
        title: row.name,
        node_type: (nextsOf.get(row.name) ?? []).length >= 2 ? "decision" : "process",
        description: row.description,
        assignee: resolved.get(row.name)?.assignee ?? "",
        department: resolved.get(row.name)?.department ?? "",
        system: row.system,
        duration: row.duration,
        url: row.url,
        url_label: row.url_label,
        sort_order: i + 1,
      }),
    ),
    {
      ...mergeNode(baseEnd, { ...NODE_DEFAULTS, id: endId, title: baseEnd?.title ?? "End", node_type: "end", sort_order: rows.length + 1 }),
      // 유일한 끝이므로 대표를 강제 — 기존 대표가 삭제 대상이었던 경우를 덮는다
      is_primary_end: true,
    },
  ];

  // URL 없는 라벨 소거 — 머지 후 "최종" URL 기준으로 판정한다(행의 URL이 비어도 기존 노드에 있을 수 있다)
  let ignoredLabelCount = 0;
  const finalNodes = nodes.map((node) => {
    if ((node.url ?? "") === "" && (node.url_label ?? "") !== "") {
      ignoredLabelCount += 1;
      return { ...node, url_label: "" };
    }
    return node;
  });
```

⚠️ 기존의 행 단위 `ignoredLabelCount` 계산(`csv-import.ts:184-190`)을 **삭제**한다. 머지에서는 행이 URL을 비워도 기존 노드가 URL을 갖고 있을 수 있으므로 행만 보고 판단하면 틀린다. `row.url_label` 소거도 하지 않는다(위에서 최종 판정).

엣지는 현행 그대로(`idOf`/`startId`/`endId`만 위에서 해석됨). 그다음 좌표·소멸 계산:

```ts
  const isMerge = baseNodes.length > 0;
  const positioned = isMerge
    ? layoutAddedOnly(finalNodes, edges, new Set(addedNodeIds), baseNodes)
    : layoutEverything(finalNodes, edges);

  const removedNodes = baseNodes.filter((node) => !matchedIds.has(node.id));
  const keptEdgeKeys = new Set(edges.map((e) => `${e.source_node_id}→${e.target_node_id}`));
  const lostEdges = (context?.base?.edges ?? []).filter(
    (e) => !keptEdgeKeys.has(`${e.source_node_id}→${e.target_node_id}`),
  );

  return {
    graph: { nodes: positioned, edges, groups: context?.base?.groups ?? [] },
    nodeCount: positioned.length,
    edgeCount: edges.length,
    errors: [],
    ignoredLabelCount,
    warnings,
    merge: { addedNodeIds, removedNodes, lostEdges, matchedCount: matchedIds.size },
  };
```

좌표 헬퍼 네 개를 `buildGraphFromCsv` 위에 둔다 (기존 dagre 블록을 흡수):

```ts
/** dagre가 요구하는 최소 AppNode — layoutWithDagre는 data.nodeType 크기만 쓴다. */
function toLayoutNodes(nodes: GraphNode[]): AppNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: "process",
    position: { x: node.pos_x, y: node.pos_y },
    data: {
      label: node.title, description: "", nodeType: normalizeNodeType(node.node_type),
      color: "", assignee: "", department: "", system: node.system, duration: node.duration,
      url: node.url, urlLabel: node.url_label ?? "", groupIds: [], hasChildren: false,
    },
  }));
}

function toFlowEdges(edges: GraphEdge[]) {
  return edges.map((e) => ({ id: e.id, source: e.source_node_id, target: e.target_node_id }));
}

function applyPositions(nodes: GraphNode[], laid: AppNode[]): GraphNode[] {
  const posOf = new Map(laid.map((node) => [node.id, node.position]));
  return nodes.map((node) => {
    const pos = posOf.get(node.id);
    return pos ? { ...node, pos_x: pos.x, pos_y: pos.y } : node;
  });
}

/** 전량 신규(base 없음) — 현행 동작: 전체 dagre LR. */
function layoutEverything(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  return applyPositions(nodes, layoutWithDagre(toLayoutNodes(nodes), toFlowEdges(edges), "LR"));
}

/**
 * 머지 — 매칭 노드 좌표는 불변. 신규 노드만 기존 그래프 아래에 씨앗 배치 후 부분 dagre.
 * layoutSubsetWithDagre는 subset<2면 no-op이라 씨앗 배치가 1개짜리 신규 노드를 책임진다.
 */
function layoutAddedOnly(
  nodes: GraphNode[], edges: GraphEdge[], added: ReadonlySet<string>, baseNodes: GraphNode[],
): GraphNode[] {
  if (added.size === 0) return nodes;
  const baseMaxY = baseNodes.reduce((max, node) => Math.max(max, node.pos_y), 0);
  let slot = 0;
  const seeded = nodes.map((node) =>
    added.has(node.id) ? { ...node, pos_x: 80, pos_y: baseMaxY + 140 + slot++ * 120 } : node,
  );
  return applyPositions(seeded, layoutSubsetWithDagre(toLayoutNodes(seeded), toFlowEdges(edges), added, "LR"));
}
```

파일 끝(`buildTemplateCsv` 앞)에 `withKeptNodes`:

```ts
/**
 * 삭제 대신 유지 — 소멸 노드를 엣지 없이 되돌린다.
 * 엣지를 못 살리는 이유: 노드 출력은 1개로 고정이라(canvas.ts `removeOutgoingEdges`)
 * 들어오던 엣지를 살리면 출발 노드가 출력 2개가 된다. 나가던 엣지는 CSV가 흐름 전체를 규정하므로 사라진다.
 * 대표 끝은 이미 결과 그래프의 End가 쥐고 있으므로 유지 노드에서 떼어낸다(validate_process: 대표 끝 ≤1).
 */
export function withKeptNodes(graph: Graph, kept: GraphNode[]): Graph {
  if (kept.length === 0) return graph;
  const maxOrder = graph.nodes.reduce((max, node) => Math.max(max, node.sort_order), 0);
  return {
    ...graph,
    nodes: [
      ...graph.nodes,
      ...kept.map((node, i) => ({ ...node, sort_order: maxOrder + 1 + i, is_primary_end: false })),
    ],
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm test -- csv-import
```
Expected: PASS — 35개 + 신규 17개 = 52개 (머지 14 + `withKeptNodes` 3).

```bash
npm run lint && npm test && npm run build
```
Expected: lint 0 errors · `Tests 191 passed` · build 성공.

- [ ] **Step 5: 커밋**

`PROGRESS.md`:
```markdown
- ② `buildGraphFromCsv(text, context?)` 이름 기준 머지 — 제목 일치 노드 id 재사용(계보·코멘트·그룹 보존), 빈 셀=기존 값 유지, 서브프로세스 node_type 보존, 신규 노드만 부분 dagre. `withKeptNodes` 추가. vitest 191·lint 0에러.
```

```bash
git add frontend/src/lib/csv-import.ts frontend/src/lib/csv-import.test.ts PROGRESS.md
git commit -m "$(cat <<'EOF'
feat(csv-import): merge by node title, reusing existing ids — CSV 임포트 이름 기준 머지

Rebuilding every node with a fresh id destroyed lineage (source_node_id),
comments and groups, which is why compare flagged untouched edges as
added/removed. Reuse the id of the existing node whose title matches; the
backend's id-keyed upsert then preserves everything, no backend change.

Blank cells now leave the existing value alone. The AI prompt tells the model to
leave unknown attributes blank, so a wiping blank would nuke attributes on every
re-import.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhULXV6HVeYVdyAn9ax8Tc
EOF
)"
```

---

### Task 5: 에디터 배선 — base · directory 전달, 실제 카운트 확인 모달

**Files:**
- Modify: `frontend/src/components/csv-import-section.tsx`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: `buildGraphFromCsv(text, context?)`, `CsvImportOutcome.merge`, `.warnings` (Task 2·4)
- Produces: `CsvImportSection`이 `context?: CsvImportContext` prop을 받는다.

- [ ] **Step 1: `CsvImportSection`에 `context` prop 추가**

```tsx
interface CsvImportSectionProps {
  outcome: CsvImportOutcome | null;
  fileName: string | null;
  onChange: (outcome: CsvImportOutcome | null, fileName: string | null) => void;
  disabled?: boolean;
  // 머지 base + 담당자/부서 해석 디렉터리. 없으면 전량 신규·해석 없음.
  context?: CsvImportContext;
}
```

`handleFile`·`handlePasteText`의 `buildGraphFromCsv(text)`를 `buildGraphFromCsv(text, context)`로 바꾼다. `import type { CsvImportContext } from "@/lib/csv-import";` 추가.

요약 블록(`:167-177`)을 머지 카운트 + 경고로 교체:

```tsx
          {outcome.errors.length === 0 ? (
            <>
              <p className="text-caption text-ink-secondary">
                {t("csvImport.mergeSummary", {
                  added: outcome.merge.addedNodeIds.length,
                  updated: outcome.merge.matchedCount,
                  removed: outcome.merge.removedNodes.length,
                })}
              </p>
              {outcome.ignoredLabelCount > 0 && (
                <p className="text-caption text-ink-tertiary">
                  {t("csvImport.ignoredLabels", { n: outcome.ignoredLabelCount })}
                </p>
              )}
              {outcome.warnings.length > 0 && (
                <ul className="flex flex-col gap-0.5">
                  {outcome.warnings.slice(0, 5).map((warn) => (
                    <li key={`${warn.line}-${warn.message}`} className="text-caption text-ink-tertiary">
                      {t("csvImport.rowWarning", { line: warn.line, message: warn.message })}
                    </li>
                  ))}
                  {outcome.warnings.length > 5 && (
                    <li className="text-caption text-ink-tertiary">
                      {t("csvImport.moreWarnings", { n: outcome.warnings.length - 5 })}
                    </li>
                  )}
                </ul>
              )}
            </>
          ) : (
```

- [ ] **Step 2: i18n 키 (en + ko)**

```ts
// en
"csvImport.mergeSummary": "{added} added · {updated} updated · {removed} removed",
"csvImport.rowWarning": "Row {line}: {message}",
"csvImport.moreWarnings": "+{n} more warnings",
"csvImport.confirmUpdate": "Keep {n} matching nodes (comments, color, groups preserved)",
"csvImport.confirmDelete": "Delete {n} nodes and their comments · {m} connections",
"csvImport.confirmCreate": "Create {x} nodes · {y} connections",
// ko
"csvImport.mergeSummary": "추가 {added} · 갱신 {updated} · 삭제 {removed}",
"csvImport.rowWarning": "{line}행: {message}",
"csvImport.moreWarnings": "+{n}건 더",
"csvImport.confirmUpdate": "일치하는 노드 {n}개 유지 (코멘트·색·그룹 보존)",
"csvImport.confirmDelete": "노드 {n}개와 그 코멘트 · 연결 {m}개 삭제",
"csvImport.confirmCreate": "새 노드 {x}개 · 연결 {y}개",
```

- [ ] **Step 3: 에디터가 `context`를 넘기고 확인 모달이 실제 카운트를 쓴다**

임포트 버튼을 `eligible !== null`로 게이팅한다 — 디렉터리 로드 타이밍에 따라 해석 결과가 달라지는 걸 막는다 (`page.tsx` ≈6452):

```tsx
          onImportCsv={
            checkout?.mine && currentParentId === null && eligible !== null
              ? () => setCsvImportOpen(true)
              : undefined
          }
```

`<CsvImportSection ... />`(≈8212)에 `context`를 넘긴다. 임포트는 루트 스코프에서만 열리므로 현재 캔버스가 곧 전체 그래프다:

```tsx
            <CsvImportSection
              outcome={csvOutcome}
              fileName={csvFileName}
              context={{
                base: buildGraph(nodesRef.current, edgesRef.current, groupsRef.current),
                directory: eligible ?? undefined,
              }}
              onChange={(nextOutcome, nextFileName) => {
                setCsvOutcome(nextOutcome);
                setCsvFileName(nextFileName);
              }}
            />
```

⚠️ `buildGraph`(`page.tsx:581`)는 아무 노드도 태그하지 않은 **빈 그룹을 버리고**(`:591`) `parent_group_id`를 `null`로 평탄화한다(`:632`). 자동저장이 매번 하는 정규화라 새 손실은 아니지만, base의 `groups`가 DB 원본과 정확히 같지는 않다.

확인 모달의 `sections`(≈8253-8275) 교체:

```tsx
          sections={[
            [
              {
                icon: <Trash2 size={14} strokeWidth={1.5} />,
                text: t("csvImport.confirmDelete", {
                  n: csvOutcome.merge.removedNodes.length,
                  m: csvOutcome.merge.lostEdges.length,
                }),
                tone: "error",
              },
            ],
            [
              {
                icon: <FilePlus2 size={14} strokeWidth={1.5} />,
                text: t("csvImport.confirmCreate", {
                  x: csvOutcome.merge.addedNodeIds.length,
                  y: csvOutcome.edgeCount,
                }),
                tone: "accent",
              },
              {
                icon: <Check size={14} strokeWidth={1.5} />,
                text: t("csvImport.confirmUpdate", { n: csvOutcome.merge.matchedCount }),
                tone: "accent",
              },
            ],
          ]}
```

`lucide-react` import에 `Check`가 없으면 더한다 (이미 있으면 중복 지정자로 lint가 막는다).

- [ ] **Step 4: 게이트 · 커밋**

```bash
npm run lint && npm test && npm run build
```
Expected: lint 0 errors · `Tests 191 passed` · build 성공.

`PROGRESS.md`:
```markdown
- ② 에디터 배선 — CsvImportSection `context`(base + eligible 디렉터리), 요약/확인 모달을 추가·갱신·삭제 실카운트로, 행 경고 노출, Import 버튼을 `eligible !== null`로 게이팅. vitest 191·lint 0에러.
```

```bash
git add frontend/src/components/csv-import-section.tsx "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "$(cat <<'EOF'
feat(csv-import): editor supplies merge base and assignee directory — 에디터가 머지 base와 담당자 디렉터리를 전달

The confirm dialog claimed every node and group would be deleted because import
really did delete them. It now reports the true added/updated/removed counts,
warns that comments on removed nodes go with them, and surfaces row-level
assignee/department warnings.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhULXV6HVeYVdyAn9ax8Tc
EOF
)"
```

---

### Task 6: 비교 회귀 테스트 — 머지 후 실제 변경만 잡히는가

**Files:**
- Create: `frontend/src/lib/diff.test.ts`

**Interfaces:**
- Consumes: `computeVersionDiff` (`@/lib/diff`), `FlatNode`·`VersionGraph`·`GraphEdge` (`@/lib/api`)
- Produces: 없음 (회귀 방어망)

현실 경로를 모사한다: v1 게시 → v2는 v1의 클론(`clone_graph`가 `source_node_id`에 v1 노드 id를 심는다) → v2에 CSV 머지. 머지가 id를 보존하므로 v2 노드의 `source_node_id`는 그대로다.

- [ ] **Step 1: 테스트를 쓴다**

`frontend/src/lib/diff.test.ts`:

```ts
// 버전 diff 회귀 — CSV 머지 임포트 후 "실제 변경"만 잡히는지. 머지 전(전체 교체)에는 전 엣지가 오탐이었다.
import { describe, expect, it } from "vitest";

import type { FlatNode, GraphEdge, VersionGraph } from "./api";
import { computeVersionDiff } from "./diff";

const FLAT: Omit<FlatNode, "id" | "title" | "node_type" | "source_node_id"> = {
  description: "", color: "", assignee: "", department: "", system: "", duration: "",
  url: "", url_label: "", pos_x: 0, pos_y: 0, sort_order: 0, group_ids: [],
  linked_map_id: null, follow_latest: false, linked_version_id: null,
  is_primary_end: false, parent_node_id: null,
};

const edge = (id: string, source: string, target: string): GraphEdge => ({
  id, source_node_id: source, target_node_id: target, label: "",
  source_side: "right", target_side: "left", source_handle: null, target_handle: null,
});

// v1 — 게시본. 계보 루트이므로 source_node_id는 null.
const v1: VersionGraph = {
  nodes: [
    { ...FLAT, id: "s1", title: "Start", node_type: "start", source_node_id: null },
    { ...FLAT, id: "a1", title: "Review request", node_type: "process", system: "SAP", source_node_id: null },
    { ...FLAT, id: "e1", title: "End", node_type: "end", source_node_id: null, is_primary_end: true },
  ],
  edges: [edge("x1", "s1", "a1"), edge("x2", "a1", "e1")],
};

// v2 — v1의 클론(새 id + source_node_id=원본). 그 위에 CSV 머지: A.system 변경 + B 추가.
const v2: VersionGraph = {
  nodes: [
    { ...FLAT, id: "s2", title: "Start", node_type: "start", source_node_id: "s1" },
    { ...FLAT, id: "a2", title: "Review request", node_type: "process", system: "ERP", source_node_id: "a1" },
    { ...FLAT, id: "b1", title: "Sign contract", node_type: "process", source_node_id: null },
    { ...FLAT, id: "e2", title: "End", node_type: "end", source_node_id: "e1", is_primary_end: true },
  ],
  edges: [edge("y1", "s2", "a2"), edge("y2", "a2", "b1"), edge("y3", "b1", "e2")],
};

describe("computeVersionDiff — CSV 머지 임포트 후", () => {
  it("바뀌지 않은 Start→Review 엣지를 added/removed로 잡지 않는다", () => {
    expect(computeVersionDiff(v1, v2).rightEdgeStatus.get("y1")).toBeUndefined();
  });

  it("실제로 사라진 엣지만 removed로 잡는다", () => {
    // Review→End 는 B 삽입으로 끊겼다
    expect([...computeVersionDiff(v1, v2).leftEdgeStatus.keys()]).toEqual(["x2"]);
  });

  it("실제로 생긴 엣지만 added로 잡는다", () => {
    expect([...computeVersionDiff(v1, v2).rightEdgeStatus.keys()].sort()).toEqual(["y2", "y3"]);
  });

  it("system이 바뀐 노드만 changed로 잡는다", () => {
    const changed = computeVersionDiff(v1, v2).entries.filter((e) => e.status === "changed");
    expect(changed).toHaveLength(1);
    expect(changed[0].title).toBe("Review request");
    expect(changed[0].changedFields).toEqual(["system"]);
  });

  it("신규 노드만 added로 잡는다", () => {
    const added = computeVersionDiff(v1, v2).entries.filter((e) => e.status === "added");
    expect(added.map((e) => e.title)).toEqual(["Sign contract"]);
  });

  it("삭제 노드는 없다", () => {
    expect(computeVersionDiff(v1, v2).entries.filter((e) => e.status === "removed")).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 통과해야 한다**

이 테스트는 **머지 구현(Task 4)이 이미 옳다는 것을 문서화**하는 회귀 방어망이다. 실패하면 Task 4가 틀렸거나 `diff.ts` 가정이 어긋난 것이니, 원인을 찾기 전에 넘어가지 않는다.

```bash
npm test -- diff
```
Expected: PASS (6 tests)

```bash
npm run lint && npm test
```
Expected: `Tests 197 passed`

- [ ] **Step 3: 커밋**

`PROGRESS.md`:
```markdown
- ② 비교 회귀 테스트 `diff.test.ts` 신설 — 클론+머지 시나리오에서 미변경 엣지가 오탐되지 않고 실제 변경만 잡히는지 6케이스. vitest 197.
```

```bash
git add frontend/src/lib/diff.test.ts PROGRESS.md
git commit -m "$(cat <<'EOF'
test(diff): lock in that merge import leaves untouched edges unflagged — 머지 임포트 후 미변경 엣지 오탐 방지 회귀

diff.ts had no tests. This pins the behaviour the merge import exists to
produce: after a clone + CSV merge, only the genuinely changed node and the
genuinely rerouted edges appear in the diff.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhULXV6HVeYVdyAn9ax8Tc
EOF
)"
```

---

### Task 7: 프리뷰 상태 기계 — 캔버스에 머지 결과를 미저장으로 띄운다

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`

**Interfaces:**
- Consumes: `withKeptNodes`, `CsvImportOutcome.merge` (Task 4)
- Produces: `previewSource: "ai" | "csv" | null`, `csvKeepRemoved: boolean`, `enterCsvPreview()`, `applyCsvImport()`, `cancelCsvPreview()` — Task 8이 Import 탭에 연결한다.

- [ ] **Step 1: `aiPreviewRef`/`aiPreviewActive`를 소스 태그로 일반화**

`page.tsx:820-821` 교체:

```tsx
  // 미리보기 — AI 제안과 CSV 임포트가 공유. null이 아니면 자동저장이 꺼진다(Apply 전 영속화 방지).
  const [previewSource, setPreviewSource] = useState<"ai" | "csv" | null>(null);
  const previewRef = useRef(false);
```

`aiPreviewRef.current`를 쓰는 두 곳(`:1332` `saveCurrentScope`, `:1363` `scheduleAutoSave`)을 `previewRef.current`로 바꾸고 주석의 "AI 미리보기"를 "미리보기"로 고친다.

`applyAiProposal`(`:1596-1601`)·`applyAiOps`(`:1725-1729`):
```tsx
      previewRef.current = true;
      ...
      setPreviewSource("ai");
```

`commitAiPreview`/`discardAiPreview`(`:1734-1744`):
```tsx
  const commitAiPreview = useCallback(() => {
    previewRef.current = false;
    setPreviewSource(null);
    void saveCurrentScope();
  }, [saveCurrentScope]);

  const discardAiPreview = useCallback(() => {
    previewRef.current = false;
    setPreviewSource(null);
    undo(); // restore the snapshot pushed in applyAiProposal
  }, [undo]);
```

`AiChatPanel`(`:7283`)은 prop 이름을 유지한 채 소스로 좁힌다 — CSV 프리뷰 중 AI 패널이 Apply 바를 띄우면 안 된다:
```tsx
                aiPreviewActive={previewSource === "ai"}
```

- [ ] **Step 2: CSV 프리뷰 진입**

`page.tsx:785` 근처에 추가하고 `csvConfirmOpen` state는 제거한다:
```tsx
  // CSV 임포트 프리뷰 — 소멸 노드를 삭제할지 유지할지. 기본 삭제(CSV가 정본).
  const [csvKeepRemoved, setCsvKeepRemoved] = useState(false);
```

`applyCsvImport`(`:1480`) 위에:

```tsx
  // CSV 머지 프리뷰 — 캔버스에만 반영(미저장). 소멸 노드/엣지는 삭제·유지와 무관하게 항상 빨간 점선으로 보여준다.
  const enterCsvPreview = useCallback(() => {
    const outcome = csvOutcome;
    if (versionId === null || !outcome?.graph) return;
    const added = new Set(outcome.merge.addedNodeIds);
    const removedIds = new Set(outcome.merge.removedNodes.map((node) => node.id));

    // 캔버스 그래프 = 머지 결과 + 소멸 노드(하이라이트용). 저장 payload는 Apply 시 따로 만든다.
    const canvasGraph = withKeptNodes(outcome.graph, outcome.merge.removedNodes);
    const previewNodes = toAppNodes(canvasGraph, null).map((node) => ({
      ...node,
      data: {
        ...node.data,
        diffStatus: removedIds.has(node.id)
          ? ("removed" as const)
          : added.has(node.id)
            ? ("added" as const)
            : undefined,
      },
    }));
    const previewEdges = [
      ...toAppEdges(canvasGraph),
      // toAppEdges는 graph.edges만 읽는다 (page.tsx:527) — 소멸 엣지만 담아 스타일을 얹는다
      ...toAppEdges({ nodes: [], edges: outcome.merge.lostEdges, groups: [] }).map((edge) => ({
        ...edge,
        // 비교 화면과 같은 시각 언어 (compare/page.tsx:257-259) — 사라질 엣지
        style: { stroke: "var(--color-removed)", strokeWidth: 2, strokeDasharray: "6 3" },
      })),
    ];

    pushHistory(); // Cancel = undo 1회로 임포트 이전 캔버스 복귀
    previewRef.current = true;
    setNodes(previewNodes);
    setEdges(previewEdges);
    setGroups(canvasGraph.groups);
    setSelectedId(null);
    setSelectedEdgeId(null);
    setMenu(null);
    setCsvKeepRemoved(false);
    setPreviewSource("csv");
    setCsvImportOpen(false);
  }, [versionId, csvOutcome, pushHistory, setNodes, setEdges, setGroups]);
```

import에 `withKeptNodes`(`@/lib/csv-import`)를 추가한다.

⚠️ **신규 노드 부분 자동정렬을 여기서 다시 하지 않는다.** `buildGraphFromCsv`의 `layoutAddedOnly`(Task 4)가 이미 씨앗 배치 + `layoutSubsetWithDagre`를 마쳤고 `outcome.graph`의 좌표가 최종값이다. 또 돌리면 앵커가 어긋난다. 그리고 `applyAutoLayout`은 내부 `pushHistory()`(`page.tsx:3014`) 때문에 undo가 2단이 되어 어느 경우에도 쓰면 안 된다.

- [ ] **Step 3: Apply / Cancel**

`applyCsvImport`(`:1480-1503`)를 프리뷰 커밋으로 교체한다.

```tsx
  // 프리뷰 확정 — 삭제/유지 선택을 반영한 최종 그래프를 PUT. 소멸 엣지는 어느 쪽이든 저장하지 않는다.
  // 직접 saveGraph를 쓰는 이유: setState 직후 ref 동기화 전에 saveCurrentScope를 부르면 이전 상태가 저장됨.
  const applyCsvImport = useCallback(async () => {
    const outcome = csvOutcome;
    if (versionId === null || !outcome?.graph) return;
    const payload = csvKeepRemoved
      ? withKeptNodes(outcome.graph, outcome.merge.removedNodes)
      : outcome.graph;
    try {
      const saved = await saveGraph(versionId, payload);
      previewRef.current = false;
      setPreviewSource(null);
      setNodes(toAppNodes(saved, null));
      setEdges(toAppEdges(saved));
      setGroups(saved.groups);
      dirtyRef.current = false;
      setSaveState("saved");
      refreshFullGraph();
      setCsvOutcome(null);
      setCsvFileName(null);
      showToast(t("csvImport.applied"));
    } catch (err) {
      // 프리뷰를 유지한 채 실패만 알린다 — 다시 Apply 하거나 Cancel 할 수 있다 (423/409)
      showToast(err instanceof Error ? err.message : t("err.save"));
    }
  }, [versionId, csvOutcome, csvKeepRemoved, setNodes, setEdges, setGroups, refreshFullGraph, showToast, t]);

  const cancelCsvPreview = useCallback(() => {
    previewRef.current = false;
    setPreviewSource(null);
    setCsvOutcome(null);
    setCsvFileName(null);
    undo(); // enterCsvPreview가 밀어넣은 스냅샷으로 복귀
  }, [undo]);
```

CSV 임포트 모달의 Continue 버튼(`:8232-8240`)이 `enterCsvPreview`를 부르게 한다:
```tsx
                onClick={enterCsvPreview}
```

`csvConfirmOpen` state·`setCsvConfirmOpen` 호출·`ConfirmDialog` 블록(`:8245-8279`)·미사용이 된 `FileUp`/`Trash2`/`FilePlus2`/`Check` import를 제거한다(`FileUp`은 툴바에서도 쓰이면 남긴다 — lint가 알려준다).

- [ ] **Step 4: 게이트**

```bash
npm run lint && npm test && npm run build
```
Expected: lint 0 errors (특히 `react-hooks/preserve-manual-memoization` 무발생) · `Tests 197 passed` · build 성공.

⚠️ 이 시점에서 Apply/Cancel 버튼은 아직 화면에 없다. 프리뷰에 들어가면 나올 방법이 없으므로 **Task 7과 8은 연속으로 수행하고 그 사이에 앱을 시연하지 않는다.**

- [ ] **Step 5: 커밋**

`PROGRESS.md`:
```markdown
- ③ 프리뷰 상태 기계 일반화(`aiPreviewRef`→`previewRef` + `previewSource`) + CSV 머지 프리뷰 진입/확정/취소. 소멸 노드·엣지 `diffStatus`/빨간 점선. 확인 모달 폐지. vitest 197·lint 0에러. ⚠️ Apply/Cancel UI는 다음 커밋(Import 탭).
```

```bash
git add "frontend/src/app/maps/[mapId]/page.tsx" PROGRESS.md
git commit -m "$(cat <<'EOF'
feat(csv-import): stage the merge on canvas before saving — CSV 머지 결과를 저장 전 캔버스 프리뷰로

Reuses the AI proposal's preview machinery (snapshot, autosave suppressed until
Apply) rather than duplicating it. Nodes carry data.diffStatus, which the shared
ProcessNode already renders; lost edges get the compare screen's red dashes.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhULXV6HVeYVdyAn9ax8Tc
EOF
)"
```

---

### Task 8: 인스펙터 Import 탭 — 삭제/유지 선택 + 호버 안내

**Files:**
- Create: `frontend/src/components/csv-import-tab.tsx`
- Modify: `frontend/src/components/inspector-panel.tsx`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: `previewSource`, `csvKeepRemoved`, `setCsvKeepRemoved`, `applyCsvImport`, `cancelCsvPreview`, `csvOutcome`, `highlightNode` (Task 7)
- Produces: `CsvImportTab` · `InspectorPanel`의 `importSlot`/`forcedTab`/`lockTabs`

- [ ] **Step 1: i18n 키 (en + ko)**

```ts
// en
"csvImport.tabTitle": "Import",
"csvImport.tabIntro": "**{updated} nodes matched.** They keep their comments, color and groups, and any cell you left blank keeps its old value.\n\n**{added} nodes added** from the CSV.",
"csvImport.tabNoRemoved": "Nothing in this map is missing from the CSV.",
"csvImport.removedTitle": "Not in the CSV ({n})",
"csvImport.removedHint": "Click a name to find it on the canvas.",
"csvImport.warningsTitle": "Warnings ({n})",
"csvImport.modeDelete": "Delete",
"csvImport.modeKeep": "Keep",
"csvImport.modeDeleteTipHead": "Removes {n} nodes and {m} connections.",
"csvImport.modeDeleteTipBody": "Nodes missing from the CSV are deleted, along with their comments.",
"csvImport.modeKeepTipHead": "Keeps {n} nodes, drops {m} connections.",
"csvImport.modeKeepTipBody": "A node has a single output, so the old links can't survive the CSV's flow. Reconnect them manually after import.",
"csvImport.applyTipHead": "Saves the merged map to this version.",
"csvImport.cancelTipHead": "Discards the import.",
"csvImport.cancelTipBody": "The canvas returns to how it was.",
"csvImport.apply": "Apply",
// ko
"csvImport.tabTitle": "임포트",
"csvImport.tabIntro": "**노드 {updated}개가 일치했습니다.** 코멘트·색·그룹을 유지하고, 비워둔 칸은 기존 값을 지킵니다.\n\n**노드 {added}개를 CSV에서 추가**합니다.",
"csvImport.tabNoRemoved": "CSV에서 빠진 노드가 없습니다.",
"csvImport.removedTitle": "CSV에 없음 ({n})",
"csvImport.removedHint": "이름을 클릭하면 캔버스에서 찾아줍니다.",
"csvImport.warningsTitle": "경고 ({n})",
"csvImport.modeDelete": "삭제",
"csvImport.modeKeep": "유지",
"csvImport.modeDeleteTipHead": "노드 {n}개와 연결 {m}개를 지웁니다.",
"csvImport.modeDeleteTipBody": "CSV에 없는 노드는 그 코멘트와 함께 삭제됩니다.",
"csvImport.modeKeepTipHead": "노드 {n}개를 남기고 연결 {m}개를 버립니다.",
"csvImport.modeKeepTipBody": "노드 출력은 1개이므로 기존 연결은 CSV 흐름에서 살아남을 수 없습니다. 임포트 후 직접 다시 연결하세요.",
"csvImport.applyTipHead": "머지 결과를 이 버전에 저장합니다.",
"csvImport.cancelTipHead": "임포트를 취소합니다.",
"csvImport.cancelTipBody": "캔버스가 원래대로 돌아갑니다.",
"csvImport.apply": "적용",
```

⚠️ `tabIntro`는 `MarkdownView`가 파싱한다. **노드 제목·담당자 이름을 절대 여기 넣지 않는다** — `**`·`#`·`[](...)`가 서식으로 해석되고 클릭 핸들러도 못 단다. 제목은 Step 2의 React 리스트가 렌더한다.

- [ ] **Step 2: `CsvImportTab` 컴포넌트**

`frontend/src/components/csv-import-tab.tsx`:

```tsx
"use client";

// 인스펙터 Import 탭 — CSV 머지 프리뷰의 요약·경고·소멸 노드 목록·삭제/유지 선택·Apply/Cancel.
// 프리뷰 중에는 다른 탭과 접기가 잠긴다(page.tsx). 요약만 MarkdownView, 노드 제목은 React 리스트로 —
// 마크다운은 제목의 `**`/`#`/`[]()` 를 서식으로 먹고 클릭 핸들러도 못 단다.
import type { ReactNode } from "react";

import { Check, Trash2, Undo2 } from "lucide-react";

import { MarkdownView } from "@/components/markdown-view";
import { Tooltip } from "@/components/tooltip";
import type { CsvImportWarning, CsvMergeInfo } from "@/lib/csv-import";
import { useI18n } from "@/lib/i18n";

interface CsvImportTabProps {
  merge: CsvMergeInfo;
  warnings: CsvImportWarning[];
  keepRemoved: boolean;
  onKeepRemovedChange: (keep: boolean) => void;
  onFocusNode: (nodeId: string) => void;
  onApply: () => void;
  onCancel: () => void;
}

// 리치 툴팁 카드 — 굵은 결론 한 줄 + 이유 한 줄 (Tooltip content는 max-w-56)
function TipCard({ head, body }: { head: string; body?: string }) {
  return (
    <span className="flex flex-col gap-0.5 text-left">
      <span className="text-fine font-semibold text-ink">{head}</span>
      {body && <span className="text-fine text-ink-secondary">{body}</span>}
    </span>
  );
}

export function CsvImportTab({
  merge, warnings, keepRemoved, onKeepRemovedChange, onFocusNode, onApply, onCancel,
}: CsvImportTabProps) {
  const { t } = useI18n();
  const removedCount = merge.removedNodes.length;
  const lostCount = merge.lostEdges.length;

  const modeButton = (mode: "delete" | "keep", label: string, tip: ReactNode) => {
    const active = (mode === "keep") === keepRemoved;
    return (
      <Tooltip content={tip} className="flex-1">
        <button
          type="button"
          data-id={`csv-import-mode-${mode}`}
          aria-pressed={active}
          onClick={() => onKeepRemovedChange(mode === "keep")}
          className={`flex w-full items-center justify-center gap-1.5 rounded-sm border px-2 py-1.5 text-caption ${
            active ? "border-accent bg-accent-tint text-accent" : "border-hairline text-ink-secondary hover:bg-surface-alt"
          }`}
        >
          {mode === "delete" ? <Trash2 size={14} strokeWidth={1.5} /> : <Undo2 size={14} strokeWidth={1.5} />}
          {label}
        </button>
      </Tooltip>
    );
  };

  return (
    <div data-id="csv-import-tab" className="flex flex-col gap-4">
      <MarkdownView
        className="md"
        source={t("csvImport.tabIntro", { updated: merge.matchedCount, added: merge.addedNodeIds.length })}
      />

      {warnings.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-caption-strong text-ink">{t("csvImport.warningsTitle", { n: warnings.length })}</span>
          <ul className="scroll-soft flex max-h-32 flex-col gap-0.5">
            {warnings.map((warn) => (
              <li key={`${warn.line}-${warn.message}`} className="text-fine text-ink-tertiary">
                {t("csvImport.rowWarning", { line: warn.line, message: warn.message })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {removedCount === 0 ? (
        <p className="text-caption text-ink-tertiary">{t("csvImport.tabNoRemoved")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-caption-strong text-ink">{t("csvImport.removedTitle", { n: removedCount })}</span>
            <span className="text-fine text-ink-tertiary">{t("csvImport.removedHint")}</span>
          </div>
          <ul className="scroll-soft flex max-h-40 flex-col gap-1">
            {merge.removedNodes.map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  onClick={() => onFocusNode(node.id)}
                  className="w-full truncate rounded-sm border border-dashed border-removed px-2 py-1 text-left text-caption text-ink hover:bg-surface-alt"
                  title={node.title}
                >
                  {node.title}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-1.5">
            {modeButton("delete", t("csvImport.modeDelete"), (
              <TipCard head={t("csvImport.modeDeleteTipHead", { n: removedCount, m: lostCount })} body={t("csvImport.modeDeleteTipBody")} />
            ))}
            {modeButton("keep", t("csvImport.modeKeep"), (
              <TipCard head={t("csvImport.modeKeepTipHead", { n: removedCount, m: lostCount })} body={t("csvImport.modeKeepTipBody")} />
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-1.5 border-t border-hairline pt-3">
        <Tooltip content={<TipCard head={t("csvImport.applyTipHead")} />} className="flex-1">
          <button
            type="button"
            data-id="csv-import-apply"
            onClick={onApply}
            className="flex w-full items-center justify-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
          >
            <Check size={14} strokeWidth={1.5} />
            {t("csvImport.apply")}
          </button>
        </Tooltip>
        <Tooltip content={<TipCard head={t("csvImport.cancelTipHead")} body={t("csvImport.cancelTipBody")} />}>
          <button
            type="button"
            data-id="csv-import-cancel"
            onClick={onCancel}
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
          >
            {t("common.cancel")}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
```

사용한 토큰·유틸은 전부 실재함을 확인했다 — `--color-removed`(`globals.css:51`), `--color-on-accent`(`:16`), `--color-accent-focus`(`:14`), `.scroll-soft`(`:117`), `.md`(`:366`), `text-caption-strong`(48곳). `border-removed`는 `compare/page.tsx:331`이 이미 쓴다. **raw hex 금지.**

`Tooltip`(`frontend/src/components/tooltip.tsx`)을 쓰는 이유: portal+fixed라 인스펙터의 `overflow-y-auto`(`inspector-panel.tsx:130`)에 잘리지 않고 `content`로 리치 카드를 받는다. `IconTip`은 absolute라 잘린다.

- [ ] **Step 3: `InspectorPanel`에 import 탭 · 잠금 추가**

```ts
type InspectorTab = "properties" | "map" | "approval" | "activity" | "import";

// CSV 프리뷰 중에만 나타나는 탭 — importSlot이 있을 때 TABS 뒤에 붙는다
const IMPORT_TAB: { key: InspectorTab; labelKey: MessageKey; icon: IconType } = {
  key: "import", labelKey: "csvImport.tabTitle", icon: FileUp,
};
```

props 3개:
```ts
  // CSV 임포트 프리뷰 — 슬롯이 있으면 Import 탭이 나타난다
  importSlot?: ReactNode;
  // 탭을 강제 고정(프리뷰 중). 내부 상태 대신 이 값이 이긴다.
  forcedTab?: InspectorTab;
  // 다른 탭·접기 잠금 — 프리뷰를 두고 빠져나가 자동저장 꺼진 상태에 갇히는 걸 막는다
  lockTabs?: boolean;
```

본문:
```tsx
  const [internalTab, setInternalTab] = useState<InspectorTab>("properties");
  const tab = forcedTab ?? internalTab;
  const tabs = importSlot ? [...TABS, IMPORT_TAB] : TABS;
```

- 접기 버튼(`:94-102`)에 `disabled={lockTabs}` 추가.
- 탭 map을 `tabs.map(...)`으로 바꾸고 `onClick={() => setInternalTab(key)}`, `disabled={lockTabs && key !== tab}`, className에 `disabled:opacity-40 disabled:hover:bg-transparent` 추가.
- 콘텐츠 영역에 `{tab === "import" && importSlot}` 추가.
- `lucide-react` import에 `FileUp` 추가.

- [ ] **Step 4: page.tsx 배선**

`<InspectorPanel ... />`에:

```tsx
            importSlot={
              previewSource === "csv" && csvOutcome !== null ? (
                <CsvImportTab
                  merge={csvOutcome.merge}
                  warnings={csvOutcome.warnings}
                  keepRemoved={csvKeepRemoved}
                  onKeepRemovedChange={setCsvKeepRemoved}
                  onFocusNode={highlightNode}
                  onApply={() => void applyCsvImport()}
                  onCancel={cancelCsvPreview}
                />
              ) : undefined
            }
            forcedTab={previewSource === "csv" ? "import" : undefined}
            lockTabs={previewSource === "csv"}
```

프리뷰 중 인스펙터가 접혀 있으면 강제로 펼친다 — **`enterCsvPreview` 핸들러 안**에서 부른다(이펙트 안 setState 금지). 우측 접힘 state 이름을 먼저 확인한다:

```bash
python3 -c "
import pathlib
for i,l in enumerate(pathlib.Path('frontend/src/app/maps/[mapId]/page.tsx').read_text().splitlines(),1):
    if 'Collapsed' in l: print(i, l.strip()[:90])" | head
```

- [ ] **Step 5: 게이트 · 커밋**

```bash
npm run lint && npm test && npm run build
```
Expected: lint 0 errors · `Tests 197 passed` · build 성공.

`PROGRESS.md`:
```markdown
- ③ 인스펙터 Import 탭(`forcedTab`/`lockTabs`, 프리뷰 중 다른 탭·접기 잠금) — MarkdownView 요약 + 행 경고 + 소멸 노드 React 리스트(클릭→캔버스 포커스) + 삭제/유지 세그먼트 + Apply/Cancel, 버튼별 리치 툴팁. vitest 197·lint 0에러.
```

```bash
git add frontend/src/components/csv-import-tab.tsx frontend/src/components/inspector-panel.tsx "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "$(cat <<'EOF'
feat(csv-import): inspector Import tab decides delete vs keep — 인스펙터 Import 탭에서 소멸 노드 삭제/유지 선택

The choice has to be made while looking at the highlighted canvas, so it lives
in the inspector rather than a modal that would cover it. Tabs and collapse lock
during preview: without that, leaving the tab strands the user in an unsaved
preview with autosave off and no way out.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhULXV6HVeYVdyAn9ax8Tc
EOF
)"
```

---

### Task 9: 브라우저 실검증

**Files:** 없음 (검증만). `PROGRESS.md`만 수정.

`docs/lessons/browser-verification.md`를 먼저 읽는다. dev.db 오염과 좀비 `next dev`가 거짓 결과를 만든 전례가 있다.

- [ ] **Step 1: 좀비 프로세스 정리 후 서버 기동**

```bash
pkill -f "next dev" || true
pkill -f "uvicorn app.main:app" || true
```
⚠️ 좀비 `next dev`가 3000을 잡고 있으면 새 프론트가 3001로 폴백해 **구버전에 붙은 채 거짓 결과**가 나온다.

서버는 **사용자 터미널에서** 띄운다(백그라운드 서버는 턴 경계에서 SIGTERM으로 회수된다). 사용자에게 요청한다:

```
! cd .claude/worktrees/csv-import-merge/backend && .venv/bin/uvicorn app.main:app --reload --port 8000
! cd .claude/worktrees/csv-import-merge/frontend && npm run dev
```

- [ ] **Step 2: 시나리오 실행**

1. 홈 → **New map** → 이름 입력 → CSV 섹션에 **다운로드·프롬프트 복사 두 버튼과 노티스만** 있는지 확인(파일 선택·붙여넣기 없음).
2. Create → **에디터로 자동 이동**하는지 확인.
3. 노드 몇 개를 손으로 그리고 색·담당자를 넣고 코멘트를 하나 단다. 저장을 기다린다.
4. 템플릿을 다운로드해 **9열 헤더**(`Name,Description,Assignee,Department,System,Duration,URL,URL_Label,Next`)인지 확인.
5. 툴바 **Import CSV** → 3의 노드 중 하나와 **제목이 같은 행**, 담당자에 **실제 login_id 하나**, 그리고 **존재하지 않는 id 하나**를 넣은 CSV를 붙여넣는다. 요약이 `추가 N · 갱신 M · 삭제 K`로 뜨고 **미해석 담당자 경고 1건**이 보이는지 확인.
6. CSV에서 어떤 행의 System 칸을 **비워** 두고, 그 노드의 기존 System이 **살아남는지** Apply 후 확인.
7. **Continue** → 캔버스가 병합 결과로 바뀌고, 신규 노드는 초록 테두리, CSV에 없는 노드와 사라질 엣지는 **빨간 점선**인지 확인. 신규 노드가 겹치지 않게 정렬돼 있는지 확인.
8. 인스펙터가 **Import 탭으로 고정**되고 다른 탭·접기가 **눌리지 않는지** 확인. 각 버튼에 호버해 툴팁 2줄이 **잘리지 않고** 뜨는지 확인.
9. 소멸 노드 이름 클릭 → 캔버스가 그 노드로 이동하는지 확인.
10. **Keep** 선택 → **Apply**. 유지한 노드가 엣지 없이 남았는지, 갱신된 노드의 **색·코멘트가 살아 있는지**, 해석된 담당자가 **이름으로** 들어갔는지, 미해석 담당자에 **드리프트 배지**가 떴는지 확인.
11. 비교 화면 진입 → **바뀐 노드와 실제로 재배선된 엣지만** 잡히는지 확인. 이전에는 전 엣지가 잡혔다.
12. 다시 임포트 → **Cancel** → 캔버스가 원래대로 복귀하고 자동저장이 다시 도는지 확인.

- [ ] **Step 3: 결과 기록 후 커밋**

관찰한 것만 적는다. 통과하지 못한 항목이 있으면 **통과했다고 쓰지 않는다.**

`PROGRESS.md`:
```markdown
- ③ 브라우저 실검증 12케이스 — 새맵 준비 UI·에디터 자동 이동·9열 템플릿·담당자 해석/경고·빈 셀 보존·머지 하이라이트·탭 잠금·툴팁·포커스·Keep/Apply 보존·비교 정상화·Cancel 복귀.
```

```bash
git add PROGRESS.md
git commit -m "$(cat <<'EOF'
docs(csv-import): record browser verification of the merge import — CSV 머지 임포트 브라우저 실검증 기록

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhULXV6HVeYVdyAn9ax8Tc
EOF
)"
```

---

## 완료 조건

- `npm run lint` 0 errors · `npm test` 197 passed (162 baseline + 12 컬럼 + 17 머지 + 6 diff) · `npm run build` 성공
- 백엔드 회귀 1회: `cd backend && .venv/bin/python -m pytest tests/ -q` (변경 없으므로 기존과 동일해야 한다)
- Task 9의 12개 시나리오를 실제로 실행하고 관찰 결과를 기록
- 머지 후 비교 화면이 **바뀐 것만** 표시

## 스코프 밖 — 손대지 않는다

- `edge.outputSwapped`(`i18n-messages.ts:663`, `1925`)는 정의만 되고 미사용이다. 삭제하지 않는다.
- AI 프리뷰 중 AI 창을 닫거나 최소화하면 Apply/Discard가 사라진 채 자동저장이 꺼진 상태에 갇힌다(`page.tsx:7173` + `1332`). 이번 CSV 경로는 인스펙터 잠금으로 막았지만 AI 경로는 그대로 둔다.
- `diff.ts`의 노드 fallback 매칭과 `edgeKey`의 비대칭.
- 백엔드가 담당자·부서를 검증하지 않는다는 사실 자체(길이만 본다). 서버 측 검증 추가는 별건이다.
