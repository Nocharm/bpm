# 매뉴얼 버튼 일관화 + `/manual` 외부 매뉴얼 드롭다운 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 흩어진 매뉴얼 버튼의 표기를 밀도별 하이브리드로 일관화(에디터 툴바 툴팁 통일 + 외부 버튼 external 큐)하고, `/manual` 뷰어에 외부 두 매뉴얼(편집사이트·CSV안내)로 가는 "한눈에 보기" 드롭다운을 추가한다.

**Architecture:** 프론트엔드 전용 변경. 구조 모델은 "컨텍스트별 분산 유지"로 라우팅은 현행 유지. 기존 버튼은 표기만 정리하고, `/manual` 페이지는 `getMe()`로 외부 URL을 조회해 드롭다운을 조건부 렌더한다. 백엔드 무변경(`/me`가 이미 `manual_url`·`csv_manual_url` 반환).

**Tech Stack:** Next.js(TS/React) + @xyflow/react, lucide-react 아이콘, 프로젝트 i18n(`lib/i18n-messages.ts`), Tailwind 토큰(`globals.css`).

**설계 문서:** `docs/superpowers/specs/2026-07-16-manual-buttons-rearrange-design.md`

## Global Constraints

- **디자인 토큰만** — raw hex 금지, 색은 토큰 클래스/`var(--color-*)` (`rules/frontend/design.md`).
- **아이콘: lucide, strokeWidth 1.5** — 크기는 각 행 로컬 규칙(툴바 14/16px) 유지(§6 컴팩트).
- **UI 영어 기본** — 신규 라벨은 EN·KO 양쪽 i18n 키로 추가.
- **id 생성은 `genId()`**(해당 시). `crypto.randomUUID()` 금지.
- **React Compiler 함정**(AGENTS.md) — setState만 하는 핸들러는 `useCallback` 없이 plain 인라인으로 두어 컴파일러 메모이제이션에 맡긴다. 이펙트 내 동기 setState 금지(비동기 `.then` setState는 허용).
- **grep는 ugrep** — `[mapId]` 등 대괄호 경로/디렉터리를 조용히 스킵. 검증 grep는 `find`+파일지정 또는 Read로.
- **줄바꿈 LF 고정.**
- **검증 정책:** 이 변경들은 순수 표시(JSX) 로직이라 신규 vitest 단위 테스트를 만들지 않는다(페이지 컴포넌트 테스트 인프라 부재 — 날조 금지). 게이트 = 기존 `npm test`(i18n 파리티 등 회귀 검출) + `npm run lint` + `npx tsc --noEmit` + `npm run build` + 브라우저 실검증.

---

### Task 0: 워크트리 셋업 & 베이스라인 확인

변경 전에 의존성 설치와 클린 베이스라인을 확보한다(조사 단계에서 `npm install` 미실행).

**Files:** (변경 없음 — 셋업만)

- [ ] **Step 1: 의존성 설치**

Run: `cd frontend && npm install`
Expected: 설치 완료, 에러 없음.

- [ ] **Step 2: 베이스라인 게이트 그린 확인**

Run: `cd frontend && npm run lint && npx tsc --noEmit && npm test`
Expected: lint 0 error(기존 경고는 허용), tsc 0 error, vitest 전부 pass. 실패가 있으면 **변경 착수 전에 보고**(사전 결함).

- [ ] **Step 3: (커밋 없음)**

셋업 태스크라 커밋하지 않는다.

---

### Task 1: Part 1 — 외부 버튼 표기 일관화 (툴바 툴팁 + external 큐)

에디터 툴바 매뉴얼 버튼(D2)의 툴팁을 상단 네비와 동일한 `<Tooltip>` 컴포넌트로 통일하고, 외부 새 탭으로 나가는 D2·D3 버튼에 `ExternalLink` 큐를 붙인다.

**Files:**
- Modify: `frontend/src/components/editor-toolbar.tsx` (import + D2 버튼 161–172)
- Modify: `frontend/src/components/csv-template-actions.tsx` (import + D3 버튼 57–68)

**Interfaces:**
- Consumes: 기존 i18n 키 `editor.manualSite`, `csvImport.manualLink`. 기존 컴포넌트 `Tooltip`(`@/components/tooltip`). lucide `ExternalLink`.
- Produces: (없음 — 표시 전용)

- [ ] **Step 1: `editor-toolbar.tsx` — lucide import에 `ExternalLink` 추가**

`src/components/editor-toolbar.tsx`의 lucide import 블록(5–18)에서 `BookOpen,` 아래에 한 줄 추가하여 알파벳 순 유지:

```tsx
  BookOpen,
  ChevronDown,
  ExternalLink,
  FileUp,
```

- [ ] **Step 2: `editor-toolbar.tsx` — Tooltip import 추가**

컴포넌트 import 그룹(23행 `AddNodeMenu` 근처)에 추가:

```tsx
import { AddNodeMenu } from "@/components/add-node-menu";
import { Tooltip } from "@/components/tooltip";
```

- [ ] **Step 3: `editor-toolbar.tsx` — D2 버튼을 Tooltip 래핑 + external 큐로 교체**

기존(161–172):

```tsx
        {manualUrl && (
          <button
            type="button"
            data-id="toolbar-manual-site"
            className={iconBtn}
            onClick={() => window.open(manualUrl, "_blank", "noopener,noreferrer")}
            title={t("editor.manualSite")}
            aria-label={t("editor.manualSite")}
          >
            <BookOpen size={16} strokeWidth={1.5} />
          </button>
        )}
```

교체:

```tsx
        {manualUrl && (
          <Tooltip label={t("editor.manualSite")}>
            <button
              type="button"
              data-id="toolbar-manual-site"
              className={`${iconBtn} gap-0.5`}
              onClick={() => window.open(manualUrl, "_blank", "noopener,noreferrer")}
              aria-label={t("editor.manualSite")}
            >
              <BookOpen size={16} strokeWidth={1.5} />
              <ExternalLink size={12} strokeWidth={1.5} className="text-ink-tertiary" />
            </button>
          </Tooltip>
        )}
```

(네이티브 `title` 제거 — 스타일드 툴팁으로 대체. `aria-label` 유지. `gap-0.5`로 2-글리프 간격.)

- [ ] **Step 4: `csv-template-actions.tsx` — lucide import에 `ExternalLink` 추가**

7행 교체:

```tsx
import { AlertTriangle, BookOpen, Check, Download, ExternalLink, Sparkles } from "lucide-react";
```

- [ ] **Step 5: `csv-template-actions.tsx` — D3 버튼에 후행 external 큐 추가**

기존(57–68)의 버튼 내부, 라벨 다음에 `ExternalLink` 한 줄 추가:

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
          <ExternalLink size={12} strokeWidth={1.5} className="text-ink-tertiary" />
        </button>
      )}
```

(`CSV_OUTLINE_BTN`은 이미 `gap-1.5`라 후행 아이콘 간격 자동.)

- [ ] **Step 6: 게이트 검증**

Run: `cd frontend && npm run lint && npx tsc --noEmit && npm run build`
Expected: lint 0 error, tsc 0 error, build 성공.

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/components/editor-toolbar.tsx frontend/src/components/csv-template-actions.tsx
git commit -m "feat(manual): unify editor-toolbar tooltip + external-link cue on external manual buttons — 외부 매뉴얼 버튼 external 큐"
```

---

### Task 2: Part 2 — `/manual` 뷰어 "한눈에 보기" 드롭다운 + i18n 키

`/manual` 페이지에 `getMe()`로 외부 URL을 조회해, 헤더 우측에 외부 두 매뉴얼(D2 편집사이트·D3 CSV안내) 앵커를 담은 드롭다운을 추가한다.

**Files:**
- Modify: `frontend/src/lib/i18n-messages.ts` (EN 877행 뒤·KO 2247행 뒤 신규 키)
- Modify: `frontend/src/app/manual/page.tsx` (import·상태·getMe 이펙트·헤더 드롭다운)
- Modify: `PROGRESS.md` (기능 완료 항목 — 코드와 같은 커밋)

**Interfaces:**
- Consumes: `getMe()`(`@/lib/api`) → `{ manual_url: string; csv_manual_url: string; ... }`. 기존 키 `csvImport.manualLink`. lucide `BookOpen`, `ExternalLink`, `LayoutGrid`, `ChevronDown`.
- Produces: 신규 i18n 키 `manual.externalMenu`, `manual.editSite`.

- [ ] **Step 1: i18n — EN 키 추가**

`src/lib/i18n-messages.ts` EN 블록, 877행 `"manual.title": "Manual",` 바로 아래에 삽입:

```ts
  "manual.externalMenu": "At a glance",
  "manual.editSite": "Manual editor site",
```

- [ ] **Step 2: i18n — KO 키 추가**

동일 파일 KO 블록, 2247행 `"manual.title": "사용 매뉴얼",` 바로 아래에 삽입:

```ts
  "manual.externalMenu": "한눈에 보기",
  "manual.editSite": "편집 매뉴얼 사이트",
```

- [ ] **Step 3: i18n 파리티 확인**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: tsc 0 error(신규 키가 `MessageKey` 타입에 반영), 기존 i18n 파리티 테스트(있다면) pass. 실패 시 EN/KO 양쪽 키 존재 재확인.

- [ ] **Step 4: `manual/page.tsx` — lucide import 확장**

7행 교체:

```tsx
import { BookOpen, ChevronDown, Contrast, ExternalLink, LayoutGrid, MoveHorizontal } from "lucide-react";
```

- [ ] **Step 5: `manual/page.tsx` — api import에 `getMe` 추가**

api import 블록(10–17)에 `getMe`를 `getManualDoc` 다음에 삽입:

```tsx
import {
  getManual,
  getManualDoc,
  getMe,
  listManualDocs,
  type ManualDoc,
  type ManualDocSummary,
  type ManualLang,
} from "@/lib/api";
```

- [ ] **Step 6: `manual/page.tsx` — 상태 추가**

`const [readTheme, setReadTheme] = useState(false);`(67행) 아래에 추가:

```tsx
  // 외부 매뉴얼 URL(편집사이트·CSV안내) — "한눈에 보기" 드롭다운용
  const [manualUrl, setManualUrl] = useState("");
  const [csvManualUrl, setCsvManualUrl] = useState("");
  const [extOpen, setExtOpen] = useState(false);
```

- [ ] **Step 7: `manual/page.tsx` — getMe 이펙트 추가**

`listManualDocs` 이펙트(84–…) 바로 위 또는 아래에 새 이펙트 추가:

```tsx
  // 외부 매뉴얼 URL 로드 — 실패(미인증 등)는 삼켜 버튼만 숨김 유지 (csv-create-modal 패턴)
  useEffect(() => {
    let alive = true;
    getMe()
      .then((me) => {
        if (!alive) return;
        setManualUrl(me.manual_url);
        setCsvManualUrl(me.csv_manual_url);
      })
      .catch(() => {
        /* 버튼 숨김 유지 */
      });
    return () => {
      alive = false;
    };
  }, []);
```

- [ ] **Step 8: `manual/page.tsx` — 헤더에 "한눈에 보기" 드롭다운 삽입**

읽기 도구 클러스터 주석/블록(246–247)

```tsx
          {/* 읽기 도구 — 읽기폭·본문 한정 읽기 테마 */}
          <div className="flex shrink-0 items-center gap-1">
```

**바로 앞에** 다음 블록을 삽입(즉 스페이서 `<div className="flex-1" />` 다음, 읽기 도구 앞):

```tsx
          {/* 한눈에 보기 — 외부 매뉴얼(편집사이트·CSV안내) 바로가기. 둘 다 없으면 숨김. */}
          {(manualUrl || csvManualUrl) && (
            <div className="relative shrink-0">
              <button
                type="button"
                data-id="manual-external-menu"
                className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2.5 py-1 text-caption text-ink-secondary hover:bg-surface-alt"
                aria-haspopup="menu"
                aria-expanded={extOpen}
                onClick={() => setExtOpen((v) => !v)}
              >
                <LayoutGrid size={16} strokeWidth={1.5} />
                {t("manual.externalMenu")}
                <ChevronDown size={14} strokeWidth={1.5} className="text-ink-tertiary" />
              </button>
              {extOpen && (
                <>
                  <div className="fixed inset-0 z-[1000]" onClick={() => setExtOpen(false)} />
                  <div
                    role="menu"
                    className="absolute right-0 z-[1001] mt-1 w-56 rounded-md border border-hairline bg-surface py-1 shadow-lg"
                  >
                    {manualUrl && (
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption text-ink hover:bg-surface-alt"
                        onClick={() => {
                          window.open(manualUrl, "_blank", "noopener,noreferrer");
                          setExtOpen(false);
                        }}
                      >
                        <BookOpen size={14} strokeWidth={1.5} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{t("manual.editSite")}</span>
                        <ExternalLink size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                      </button>
                    )}
                    {csvManualUrl && (
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption text-ink hover:bg-surface-alt"
                        onClick={() => {
                          window.open(csvManualUrl, "_blank", "noopener,noreferrer");
                          setExtOpen(false);
                        }}
                      >
                        <BookOpen size={14} strokeWidth={1.5} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{t("csvImport.manualLink")}</span>
                        <ExternalLink size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
```

- [ ] **Step 9: 게이트 검증**

Run: `cd frontend && npm run lint && npx tsc --noEmit && npm run build`
Expected: lint 0 error(신규 `useCallback`/`useMemo` 없음 → preserve-manual-memoization 무관), tsc 0 error, build 성공.

- [ ] **Step 10: PROGRESS.md 갱신 (코드와 같은 커밋)**

`PROGRESS.md` 최상단(`# Progress` 아래)에 항목 추가:

```markdown
## 2026-07-16 — 매뉴얼 버튼 일관화 + /manual 외부 매뉴얼 드롭다운 (worktree-manual-buttons)
- 분산 유지 구조에서 표기 통일: 에디터 툴바 매뉴얼(D2)을 네이티브 title→스타일드 `<Tooltip>`으로 통일, 외부 새 탭 버튼(D2 툴바·D3 CSV 액션)에 `ExternalLink` 큐 추가(내부 /manual 라우팅과 구분 — 에디터 우상단 BookOpen 2개 혼동 해소).
- `/manual` 뷰어에 "한눈에 보기"(At a glance) 드롭다운 신규 — `getMe()`의 `manual_url`(편집사이트)·`csv_manual_url`(CSV안내)을 앵커로. 둘 다 미설정이면 트리거 숨김. i18n 키 `manual.externalMenu`·`manual.editSite` 추가.
- 설계 `docs/superpowers/specs/2026-07-16-manual-buttons-rearrange-design.md`. 게이트: lint/tsc/build 그린. 백엔드 무변경.
```

- [ ] **Step 11: 커밋**

```bash
git add frontend/src/lib/i18n-messages.ts frontend/src/app/manual/page.tsx PROGRESS.md
git commit -m "feat(manual): add At-a-glance external manual dropdown on /manual viewer — 한눈에 보기 드롭다운"
```

---

### Task 3: 브라우저 실검증 (체크포인트)

로컬 네이티브로 앱을 띄워 실제 동작을 확인한다. 코드 결함 발견 시 fix-forward.

**Files:** (검증 — 결함 시 위 파일 수정)

- [ ] **Step 1: 외부 URL 세팅 + 서버 기동**

백엔드를 `MANUAL_URL`·`CSV_MANUAL_URL`을 넣어 기동(예: `MANUAL_URL=https://example.com/edit CSV_MANUAL_URL=https://example.com/csv .venv/bin/uvicorn app.main:app --port 8000`), 프론트 `npm run dev`(:3000). 로그인/dev 유저로 진입.
(참고: `docs/lessons/browser-verification.md`, 좀비 프론트 pkill 주의.)

- [ ] **Step 2: `/manual` 드롭다운 확인**

`/manual` 진입 → 헤더 우측 "한눈에 보기(At a glance)" 트리거 노출 → 클릭 시 드롭다운에 "편집 매뉴얼 사이트"·"CSV 임포트 매뉴얼" 2항목, 각 항목 클릭 시 외부 URL 새 탭(`target=_blank`) 오픈. 바깥 클릭 시 닫힘.

- [ ] **Step 3: 미설정 케이스**

두 env를 비우고 재기동 → `/manual` 헤더에 트리거 **미노출** 확인.

- [ ] **Step 4: 에디터 툴바 D2 확인**

`MANUAL_URL` 세팅 상태로 맵 에디터 진입 → 툴바 매뉴얼 버튼 호버 시 **스타일드 툴팁**(브라우저 기본 아님) + `BookOpen`+`ExternalLink` 큐 표시. 클릭 시 외부 새 탭.

- [ ] **Step 5: CSV 모달 D3 확인**

홈 "CSV로 만들기" 모달(또는 에디터 CSV 임포트) → "CSV 임포트 매뉴얼" 버튼에 라벨 뒤 `ExternalLink` 큐 표시(`CSV_MANUAL_URL` 세팅 시).

- [ ] **Step 6: 콘솔 에러 0 확인 & 결과 보고**

콘솔 에러/워닝 없음 확인. 이상 있으면 원인 수정 후 해당 Task 재검증. 전부 통과면 완료 보고.

---

## Self-Review

- **Spec coverage:**
  - Part 1a(툴팁 통일) → Task 1 Step 2–3. ✓
  - Part 1b(external 큐 D2·D3) → Task 1 Step 3·5. ✓
  - Part 2(getMe·트리거·드롭다운·가시성) → Task 2 Step 5–8. ✓
  - i18n 신규 키 2종 → Task 2 Step 1–2. ✓
  - 검증(lint/tsc/build/브라우저) → Task 1 Step 6, Task 2 Step 9, Task 3. ✓
  - 백엔드 무변경 → 계획에 백엔드 태스크 없음. ✓
- **Placeholder scan:** 모든 코드 스텝에 실제 코드 명시, TBD/TODO 없음. ✓
- **Type consistency:** `manual.externalMenu`·`manual.editSite`·`csvImport.manualLink`·`editor.manualSite` 키 표기 태스크 간 일치. 상태명 `manualUrl`/`csvManualUrl`/`extOpen` 일관. `me.manual_url`/`me.csv_manual_url` 필드명 api.ts와 일치. ✓
