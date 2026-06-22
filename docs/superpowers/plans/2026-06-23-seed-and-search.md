# Seed Integrity + Search/Approver UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 시드 워크플로 정합성 보정 + 재사용 검색 모듈(초성·로마자초성·소속·콤마AND·하이라이트) + 승인자 필 UI + 홈 맵 검색.

**Architecture:** 백엔드는 시드 후 멱등 정규화 패스로 워크플로 불변식을 보정한다. 프론트는 deps 없는 순수 `lib/search.ts`(원문 인덱스 range 반환)와 `<Highlight>`를 추가하고, principal-picker·approvers-panel·create-map-dialog·홈에 적용한다.

**Tech Stack:** Backend — FastAPI, SQLAlchemy(async), pytest. Frontend — Next.js + React + TS(strict), vitest, Tailwind 토큰, Lucide.

## Global Constraints

- 작업 위치: 워크트리 `/Users/hyeonjin/Documents/bpm-seed-and-search` (브랜치 `feat/seed-and-search`, base main 7b72ebc). 브랜치 전환 금지. 백엔드 venv 재사용: `/Users/hyeonjin/Documents/bpm/backend/.venv`. 프론트 node_modules는 메인 폴더에서 심링크됨.
- 디자인 토큰만 — raw hex 금지. Lucide 16px strokeWidth 1.5. 이모지 금지.
- `data-id` 부여(주요 구조 요소). 토큰 클래스만. 버튼 커서·클릭눌림은 globals.css 전역 base(컴포넌트엔 hover 배경만).
- Python: 타입힌트 필수, `X | None`/`list[X]`, 함수명 동사 시작, ruff clean.
- TS: strict, `any` 금지, interface for props, named export. 2-space indent. LF.
- i18n: en 권위·ko 동일키(tsc 강제), 신규 키는 en+ko 동시.
- 이니셜=로마자초성(ㅇ 묵음=빈자). 콤마=AND, 항 내 필드/모드=OR.
- 검증: 백엔드 `/Users/hyeonjin/Documents/bpm/backend/.venv/bin/python -m pytest tests/ -q`(296 유지)·`ruff check app/ tests/ scripts/`. 프론트(워크트리 frontend/) `npm test`(vitest)·`npx tsc --noEmit`·`npm run lint`. 모든 명령은 각 디렉터리에서 실행.

---

## File Structure

**Backend**
- Create `backend/scripts/seed_invariants.py` — `normalize_workflow_invariants(session)`.
- Modify `backend/scripts/reset_db.py` — main()에서 호출.
- Create `backend/tests/test_seed_invariants.py`.

**Frontend**
- Create `frontend/src/lib/search.ts` — matchTerm/filterByQuery + 로마자초성.
- Create `frontend/src/lib/search.test.ts` — vitest.
- Create `frontend/src/components/highlight.tsx` — `<Highlight>`.
- Modify `frontend/src/components/permissions/principal-picker.tsx` — filterByQuery + department + Highlight.
- Modify `frontend/src/components/permissions/approvers-panel.tsx` — pills + picker.
- Modify `frontend/src/components/permissions/create-map-dialog.tsx` — approver pills + thread departments.
- Modify `frontend/src/app/page.tsx` — 맵 검색.
- Modify `frontend/src/components/maps/map-card.tsx` — nameRanges 하이라이트.
- Modify `frontend/src/lib/i18n-messages.ts` — 신규 키.

---

## Task 1: Seed workflow invariant normalization (backend)

**Files:**
- Create: `backend/scripts/seed_invariants.py`
- Modify: `backend/scripts/reset_db.py` (main, after all seeds)
- Test: `backend/tests/test_seed_invariants.py`

**Interfaces:**
- Produces: `async def normalize_workflow_invariants(session: AsyncSession) -> dict[str, int]` — 멱등. 반환 키: `owners_set, approvers_added, submitters_set, approvals_added`.

**Invariants enforced (idempotent):**
1. 모든 맵: `owner_id` None → `created_by` or 첫 LOCAL_USER; `created_by` None → `owner_id`. MapApprover 0개 → LOCAL_USER 1명 추가(맵 owner와 다른 사람 우선).
2. 비-draft 버전(status ∈ {pending,approved,published}): `submitted_by` None → 맵 owner.
3. approved/published 버전: 현재 맵의 각 MapApprover에 대해 VersionApproval 없으면 생성.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_seed_invariants.py`

```python
"""시드 워크플로 불변식 정규화 — 멱등 보정 (design 2026-06-23)."""

import asyncio
from collections.abc import Awaitable, Callable
from typing import TypeVar

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db import SessionLocal
from app.models import MapApprover, MapVersion, ProcessMap, VersionApproval

T = TypeVar("T")


def _run(coro_factory: Callable[..., Awaitable[T]]) -> T:
    async def _inner() -> T:
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_inner())


def test_normalize_fills_owner_approver_submitter_approvals(client: TestClient) -> None:
    from scripts.seed_invariants import normalize_workflow_invariants

    async def seed_broken(session) -> int:
        # owner 없음 + 승인자 없음 + published인데 submitted_by 없음 + 승인이력 없음
        m = ProcessMap(name="broken demo", owner_id=None, created_by=None)
        m.versions.append(MapVersion(label="As-Is", status="published"))
        session.add(m)
        await session.flush()
        return m.id

    map_id = _run(seed_broken)
    _run(normalize_workflow_invariants)

    async def check(session) -> dict:
        m = await session.get(ProcessMap, map_id)
        approver_rows = (
            await session.scalars(select(MapApprover.user_id).where(MapApprover.map_id == map_id))
        ).all()
        v = (
            await session.scalars(select(MapVersion).where(MapVersion.map_id == map_id))
        ).all()[0]
        approval_rows = (
            await session.scalars(
                select(VersionApproval.approver).where(VersionApproval.version_id == v.id)
            )
        ).all()
        assert m is not None
        return {
            "owner": m.owner_id,
            "approvers": list(approver_rows),
            "submitted_by": v.submitted_by,
            "approvals": sorted(approval_rows),
            "status": v.status,
        }

    result = _run(check)
    assert result["owner"] is not None
    assert len(result["approvers"]) >= 1
    assert result["submitted_by"] is not None
    # published → 모든 승인자가 승인행을 가져야 (만장일치)
    assert result["approvals"] == sorted(result["approvers"])


def test_normalize_is_idempotent(client: TestClient) -> None:
    from scripts.seed_invariants import normalize_workflow_invariants

    async def seed_broken(session) -> None:
        m = ProcessMap(name="idem demo", owner_id=None, created_by=None)
        m.versions.append(MapVersion(label="As-Is", status="pending"))
        session.add(m)
        await session.flush()

    _run(seed_broken)
    first = _run(normalize_workflow_invariants)
    second = _run(normalize_workflow_invariants)

    assert sum(first.values()) >= 1
    assert sum(second.values()) == 0
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/hyeonjin/Documents/bpm/backend && .venv/bin/python -m pytest /Users/hyeonjin/Documents/bpm-seed-and-search/backend/tests/test_seed_invariants.py -q`
Expected: FAIL — `ImportError: cannot import name 'normalize_workflow_invariants'`

> NOTE on running backend from the worktree: the worktree has no `.venv`. Run pytest with the main-folder venv but cwd in the WORKTREE backend so `app`/`scripts` resolve from the worktree code: `cd /Users/hyeonjin/Documents/bpm-seed-and-search/backend && /Users/hyeonjin/Documents/bpm/backend/.venv/bin/python -m pytest tests/test_seed_invariants.py -q`. Use this form for all backend commands in this plan.

- [ ] **Step 3: Create `backend/scripts/seed_invariants.py`**

```python
"""시드 후 워크플로 불변식 보정 — 정상 워크플로에서 불가능한 상태 제거 (멱등). 개발 시드 전용."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ad.service import LOCAL_USERS
from app.models import MapApprover, MapVersion, ProcessMap, VersionApproval

_NON_DRAFT = ("pending", "approved", "published")
_FULLY_APPROVED = ("approved", "published")


def _demo_user_ids() -> list[str]:
    """LOCAL_USERS의 login_id 결정적 순서."""
    return [u["login_id"] for u in LOCAL_USERS]


async def normalize_workflow_invariants(session: AsyncSession) -> dict[str, int]:
    """모든 맵/버전을 훑어 워크플로 불변식을 보정한다. 반환: 보정 건수."""
    counts = {"owners_set": 0, "approvers_added": 0, "submitters_set": 0, "approvals_added": 0}
    user_ids = _demo_user_ids()
    fallback = user_ids[0] if user_ids else "unknown"

    maps = (await session.scalars(select(ProcessMap))).all()
    for m in maps:
        # 1) owner / created_by
        if m.owner_id is None:
            m.owner_id = m.created_by or fallback
            counts["owners_set"] += 1
        if m.created_by is None:
            m.created_by = m.owner_id

        # 2) 승인자 ≥ 1 (owner와 다른 사람 우선)
        approvers = list(
            (await session.scalars(
                select(MapApprover.user_id).where(MapApprover.map_id == m.id)
            )).all()
        )
        if not approvers:
            pick = next((u for u in user_ids if u != m.owner_id), fallback)
            session.add(MapApprover(map_id=m.id, user_id=pick, assigned_by=m.owner_id))
            approvers = [pick]
            counts["approvers_added"] += 1

        # 3) 비-draft 버전: submitted_by + (approved/published) 승인이력
        versions = (
            await session.scalars(select(MapVersion).where(MapVersion.map_id == m.id))
        ).all()
        for v in versions:
            if v.status in _NON_DRAFT and v.submitted_by is None:
                v.submitted_by = m.owner_id
                counts["submitters_set"] += 1
            if v.status in _FULLY_APPROVED:
                approved = set(
                    (await session.scalars(
                        select(VersionApproval.approver).where(
                            VersionApproval.version_id == v.id
                        )
                    )).all()
                )
                for ap in approvers:
                    if ap not in approved:
                        session.add(VersionApproval(version_id=v.id, approver=ap))
                        counts["approvals_added"] += 1

    await session.commit()
    return counts
```

(`LOCAL_USERS` is `list[dict]` with `"login_id"` keys — see `app/ad/service.py`.)

- [ ] **Step 4: Run test to verify pass**

Run: `cd /Users/hyeonjin/Documents/bpm-seed-and-search/backend && /Users/hyeonjin/Documents/bpm/backend/.venv/bin/python -m pytest tests/test_seed_invariants.py -q`
Expected: PASS (2 passed)

- [ ] **Step 5: Wire into reset_db** — `backend/scripts/reset_db.py`, in `main()` after the nesting demo seed (after the `seed nesting demo` print, before the `# 6. 확인` verify block), add:

```python
    # 7. 워크플로 불변식 정규화 (멱등 — 시드가 남긴 불가능 상태 보정: owner·승인자·submitted_by·승인이력)
    from scripts.seed_invariants import normalize_workflow_invariants

    async with SessionLocal() as session:
        norm = await normalize_workflow_invariants(session)
    print(
        f"normalize invariants — owners={norm['owners_set']}, approvers={norm['approvers_added']}, "
        f"submitters={norm['submitters_set']}, approvals={norm['approvals_added']}"
    )
```

- [ ] **Step 6: Full suite + lint**

Run: `cd /Users/hyeonjin/Documents/bpm-seed-and-search/backend && /Users/hyeonjin/Documents/bpm/backend/.venv/bin/python -m pytest tests/ -q && /Users/hyeonjin/Documents/bpm/backend/.venv/bin/ruff check app/ tests/ scripts/`
Expected: all pass (296 + 2 new), ruff clean

- [ ] **Step 7: Commit**

```bash
cd /Users/hyeonjin/Documents/bpm-seed-and-search
git add backend/scripts/seed_invariants.py backend/scripts/reset_db.py backend/tests/test_seed_invariants.py
git commit -m "feat(seed): normalize workflow invariants (owner/approver/submitter/approvals) — 시드 정합성 보정"
```

---

## Task 2: search.ts core + vitest (frontend)

**Files:**
- Create: `frontend/src/lib/search.ts`
- Test: `frontend/src/lib/search.test.ts`

**Interfaces:**
- Produces:
  - `interface MatchRange { start: number; end: number }`
  - `interface FieldSpec { field: string; text: string }`
  - `interface FieldMatch { field: string; ranges: MatchRange[] }`
  - `interface SearchHit<T> { item: T; matches: FieldMatch[] }`
  - `matchTerm(text: string, term: string): MatchRange[] | null`
  - `filterByQuery<T>(items: T[], query: string, getFields: (item: T) => FieldSpec[]): SearchHit<T>[]`

- [ ] **Step 1: Write the failing test** — `frontend/src/lib/search.test.ts`

```ts
import { describe, expect, it } from "vitest";

import { filterByQuery, matchTerm } from "@/lib/search";

describe("matchTerm", () => {
  it("substring (case-insensitive) returns char ranges", () => {
    expect(matchTerm("Kim Daeri", "kim")).toEqual([{ start: 0, end: 3 }]);
  });
  it("hangul chosung matches (index-aligned)", () => {
    // 결재 → ㄱㅈ
    expect(matchTerm("결재", "ㄱㅈ")).toEqual([{ start: 0, end: 2 }]);
  });
  it("roman initials of a Korean name", () => {
    // 결재 → g(ㄱ) j(ㅈ) → "gj"
    expect(matchTerm("결재", "gj")).toEqual([{ start: 0, end: 2 }]);
  });
  it("roman initials skip silent ㅇ", () => {
    // 이재 → ㅇ(skip) j(ㅈ) → roman "j"; match "j" covers the 재 syllable
    expect(matchTerm("이재", "j")).toEqual([{ start: 1, end: 2 }]);
  });
  it("returns null when nothing matches", () => {
    expect(matchTerm("Kim", "zzz")).toBeNull();
  });
});

describe("filterByQuery", () => {
  const users = [
    { name: "Kim Daeri", dept: "Procurement" },
    { name: "Lee Minjae", dept: "Sales" },
    { name: "결재팀장", dept: "Procurement" },
  ];
  const fields = (u: { name: string; dept: string }) => [
    { field: "name", text: u.name },
    { field: "dept", text: u.dept },
  ];

  it("empty query returns all with no matches", () => {
    const hits = filterByQuery(users, "", fields);
    expect(hits).toHaveLength(3);
    expect(hits[0].matches).toEqual([]);
  });
  it("comma = AND across terms (each term in any field)", () => {
    // "kim, procurement" → name matches kim AND dept matches procurement
    const hits = filterByQuery(users, "kim, procurement", fields);
    expect(hits.map((h) => h.item.name)).toEqual(["Kim Daeri"]);
  });
  it("department field search", () => {
    const hits = filterByQuery(users, "sales", fields);
    expect(hits.map((h) => h.item.name)).toEqual(["Lee Minjae"]);
  });
  it("collects highlight ranges per field", () => {
    const hits = filterByQuery(users, "kim", fields);
    const nameMatch = hits[0].matches.find((m) => m.field === "name");
    expect(nameMatch?.ranges).toEqual([{ start: 0, end: 3 }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/hyeonjin/Documents/bpm-seed-and-search/frontend && npm test -- src/lib/search.test.ts`
Expected: FAIL — cannot resolve `@/lib/search`

- [ ] **Step 3: Create `frontend/src/lib/search.ts`**

```ts
// 재사용 검색 — 부분일치 + 한글초성 + 로마자초성, 콤마 AND, 원문 인덱스 range(하이라이트용). deps 없음.

import { extractChosung, isChosungQuery } from "@/lib/hangul";

export interface MatchRange {
  start: number;
  end: number;
}
export interface FieldSpec {
  field: string;
  text: string;
}
export interface FieldMatch {
  field: string;
  ranges: MatchRange[];
}
export interface SearchHit<T> {
  item: T;
  matches: FieldMatch[];
}

// 초성(가나다 순) → 개정로마자 자음. ㅇ은 묵음(빈자). hangul.ts CHOSUNG 순서와 동일.
const CHOSUNG_ROMAN = [
  "g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s",
  "ss", "", "j", "jj", "ch", "k", "t", "p", "h",
];
const CHOSUNG_CHARS = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];
const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const PER_CHOSUNG = 588;

function isLatinQuery(term: string): boolean {
  const t = term.replace(/\s/g, "");
  return t.length > 0 && /^[a-z]+$/i.test(t);
}

// 텍스트의 로마자초성 문자열 + 각 로마자 char가 유래한 원문 char 인덱스 배열.
function toRomanInitials(text: string): { roman: string; src: number[] } {
  let roman = "";
  const src: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
      const r = CHOSUNG_ROMAN[Math.floor((code - HANGUL_BASE) / PER_CHOSUNG)];
      for (const ch of r) {
        roman += ch;
        src.push(i);
      }
    } else {
      roman += text[i].toLowerCase();
      src.push(i);
    }
  }
  return { roman, src };
}

function allOccurrences(haystack: string, needle: string): number[] {
  const starts: number[] = [];
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    starts.push(idx);
    from = idx + 1;
  }
  return starts;
}

/** 한 term이 text에 매치하면 원문 기준 range 배열, 아니면 null. 우선순위 부분일치→초성→로마자. */
export function matchTerm(text: string, term: string): MatchRange[] | null {
  const trimmed = term.trim();
  if (!trimmed) return null;

  // 1) 부분일치 (대소문자 무시)
  const subStarts = allOccurrences(text.toLowerCase(), trimmed.toLowerCase());
  if (subStarts.length) {
    return subStarts.map((s) => ({ start: s, end: s + trimmed.length }));
  }

  // 2) 한글 초성 (extractChosung는 1:1 인덱스 정렬)
  if (isChosungQuery(trimmed)) {
    const chosung = extractChosung(text);
    const starts = allOccurrences(chosung, trimmed);
    if (starts.length) {
      return starts.map((s) => ({ start: s, end: s + trimmed.length }));
    }
  }

  // 3) 로마자 초성
  if (isLatinQuery(trimmed)) {
    const lower = trimmed.toLowerCase();
    const { roman, src } = toRomanInitials(text);
    const starts = allOccurrences(roman, lower);
    if (starts.length) {
      return starts.map((s) => {
        const last = src[s + lower.length - 1];
        return { start: src[s], end: last + 1 };
      });
    }
  }

  return null;
}

function splitTerms(query: string): string[] {
  return query.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
}

function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: MatchRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= prev.end) {
      prev.end = Math.max(prev.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/** 콤마=AND(각 term이 어떤 필드에든 매치), 필드/모드=OR. query 비면 전체 통과(matches=[]). */
export function filterByQuery<T>(
  items: T[],
  query: string,
  getFields: (item: T) => FieldSpec[],
): SearchHit<T>[] {
  const terms = splitTerms(query);
  if (terms.length === 0) {
    return items.map((item) => ({ item, matches: [] }));
  }
  const hits: SearchHit<T>[] = [];
  for (const item of items) {
    const fields = getFields(item);
    const perField = new Map<string, MatchRange[]>();
    let allTermsMatched = true;
    for (const term of terms) {
      let termMatched = false;
      for (const f of fields) {
        const ranges = matchTerm(f.text, term);
        if (ranges) {
          termMatched = true;
          perField.set(f.field, [...(perField.get(f.field) ?? []), ...ranges]);
        }
      }
      if (!termMatched) {
        allTermsMatched = false;
        break;
      }
    }
    if (allTermsMatched) {
      const matches: FieldMatch[] = [...perField.entries()].map(([field, ranges]) => ({
        field,
        ranges: mergeRanges(ranges),
      }));
      hits.push({ item, matches });
    }
  }
  return hits;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd /Users/hyeonjin/Documents/bpm-seed-and-search/frontend && npm test -- src/lib/search.test.ts`
Expected: PASS (all)

- [ ] **Step 5: tsc**

Run: `cd /Users/hyeonjin/Documents/bpm-seed-and-search/frontend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
cd /Users/hyeonjin/Documents/bpm-seed-and-search
git add frontend/src/lib/search.ts frontend/src/lib/search.test.ts
git commit -m "feat(search): reusable matcher (substring/chosung/roman-initials, comma-AND, ranges) — 재사용 검색 코어"
```

---

## Task 3: Highlight component

**Files:**
- Create: `frontend/src/components/highlight.tsx`

**Interfaces:**
- Consumes: `MatchRange` (Task 2).
- Produces: `Highlight({ text, ranges }: { text: string; ranges: MatchRange[] })`.

- [ ] **Step 1: Create `frontend/src/components/highlight.tsx`**

```tsx
// 매치 구간 하이라이트 — ranges(원문 char 인덱스)를 <mark> 토큰 스타일로 / inline highlight.

import { Fragment } from "react";

import type { MatchRange } from "@/lib/search";

export function Highlight({ text, ranges }: { text: string; ranges: MatchRange[] }) {
  if (!ranges || ranges.length === 0) return <>{text}</>;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((r, i) => {
    if (r.start > cursor) parts.push(<Fragment key={`t${i}`}>{text.slice(cursor, r.start)}</Fragment>);
    parts.push(
      <mark key={`m${i}`} className="rounded-[2px] bg-accent-tint text-accent">
        {text.slice(r.start, r.end)}
      </mark>,
    );
    cursor = Math.max(cursor, r.end);
  });
  if (cursor < text.length) parts.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>);
  return <>{parts}</>;
}
```

- [ ] **Step 2: tsc**

Run: `cd /Users/hyeonjin/Documents/bpm-seed-and-search/frontend && npx tsc --noEmit`
Expected: 0 errors

> Verify `bg-accent-tint`/`text-accent` exist in `globals.css @theme` (they do — used across the app). No raw hex.

- [ ] **Step 3: Commit**

```bash
cd /Users/hyeonjin/Documents/bpm-seed-and-search
git add frontend/src/components/highlight.tsx
git commit -m "feat(ui): Highlight component for search matches — 검색 하이라이트"
```

---

## Task 4: principal-picker — filterByQuery + department + highlight

**Files:**
- Modify: `frontend/src/components/permissions/principal-picker.tsx`

**Interfaces:**
- Consumes: `filterByQuery`, `MatchRange` (Task 2), `Highlight` (Task 3).
- Produces: `PrincipalOption` gains `department?: string`; `PrincipalPicker` gains optional prop `userDepartments?: Record<string, string>` (userId → dept name).

- [ ] **Step 1: Add `department?` to `PrincipalOption` + thread into buildOptions**

In `principal-picker.tsx`, change the interface (lines 13-17):

```tsx
export interface PrincipalOption {
  principalType: PrincipalType;
  principalId: string;
  displayName: string;
  department?: string;
}
```

Change `buildOptions` signature + user mapping (lines 29-46) to accept dept lookup:

```tsx
function buildOptions(
  users: MockUser[],
  departments: Department[],
  groups: UserGroup[],
  userDepartments?: Record<string, string>,
): PrincipalOption[] {
  const userOpts: PrincipalOption[] = users
    .filter((u) => u.status === "active")
    .map((u) => ({
      principalType: "user",
      principalId: u.id,
      displayName: u.name,
      department: userDepartments?.[u.id],
    }));
  const deptOpts: PrincipalOption[] = departments.map((d) => ({
    principalType: "department",
    principalId: d.id,
    displayName: d.name,
  }));
  const groupOpts: PrincipalOption[] = groups
    .filter((g) => g.status === "active")
    .map((g) => ({ principalType: "group", principalId: g.id, displayName: g.name }));
  return [...userOpts, ...deptOpts, ...groupOpts];
}
```

- [ ] **Step 2: Add prop + replace filter with filterByQuery + render Highlight**

Add `userDepartments` to props interface (after `excludeIds`):

```tsx
  /** userId → 소속명(검색용) / department name per user, for dept search. */
  userDepartments?: Record<string, string>;
```

Add it to the destructure and imports. Replace the filter logic (lines 64-70) with `filterByQuery` producing hits (with ranges):

```tsx
  const all = buildOptions(users, departments, groups, userDepartments).filter(
    (o) => !excludeIds.has(o.principalId),
  );

  const hits = query.trim()
    ? filterByQuery(all, query, (o) => [
        { field: "name", text: o.displayName },
        { field: "dept", text: o.department ?? "" },
      ])
    : all.map((item) => ({ item, matches: [] as { field: string; ranges: import("@/lib/search").MatchRange[] }[] }));
```

Add imports at top:

```tsx
import { filterByQuery, type MatchRange } from "@/lib/search";
import { Highlight } from "@/components/highlight";
```

Replace the results render (lines 86-115) to iterate `hits` and use `<Highlight>` for the name (and show dept when matched):

```tsx
      {query.trim() && (
        <div className="flex max-h-40 flex-col overflow-y-auto rounded-sm border border-hairline bg-surface shadow-md">
          {hits.slice(0, 8).map(({ item: opt, matches }) => {
            const nameRanges: MatchRange[] = matches.find((m) => m.field === "name")?.ranges ?? [];
            return (
              <button
                key={`${opt.principalType}:${opt.principalId}`}
                type="button"
                className="flex items-center gap-2 px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
                onClick={() => {
                  onSelect(opt);
                  setQuery("");
                }}
              >
                <PrincipalIcon type={opt.principalType} />
                <span>
                  <Highlight text={opt.displayName} ranges={nameRanges} />
                  {opt.department && (
                    <span className="ml-1.5 text-fine text-ink-tertiary">{opt.department}</span>
                  )}
                </span>
                <span className="ml-auto text-fine text-ink-tertiary">
                  {t(
                    opt.principalType === "user"
                      ? "perm.principalUser"
                      : opt.principalType === "department"
                        ? "perm.principalDept"
                        : "perm.principalGroup",
                  )}
                </span>
              </button>
            );
          })}
          {hits.length === 0 && (
            <span className="px-3 py-2 text-caption text-ink-tertiary">—</span>
          )}
        </div>
      )}
```

(Remove the now-unused `matchesQuery` import.)

- [ ] **Step 3: tsc + lint**

Run: `cd /Users/hyeonjin/Documents/bpm-seed-and-search/frontend && npx tsc --noEmit && npm run lint`
Expected: 0 errors, no new warnings. (Callers that don't pass `userDepartments` still compile — optional.)

- [ ] **Step 4: Commit**

```bash
cd /Users/hyeonjin/Documents/bpm-seed-and-search
git add frontend/src/components/permissions/principal-picker.tsx
git commit -m "feat(picker): chosung/roman/dept search + highlight in principal picker — 피커 검색 강화"
```

---

## Task 5: approvers-panel — pill UI (settings)

**Files:**
- Modify: `frontend/src/components/permissions/approvers-panel.tsx`

**Interfaces:**
- Consumes: `PrincipalPicker`/`PrincipalOption` (Task 4), `getDirectory` (`@/lib/api`).

**Approach:** Replace the `<select>` add-form with `PrincipalPicker` (users only) fed by the REAL directory (so chosung/roman/dept search works). Selected approvers already render as removable rows; restyle them as pills. Keep the existing `setApprovers`/`listApprovers` API flow.

- [ ] **Step 1: Fetch directory + build picker inputs**

In `approvers-panel.tsx`, add imports:

```tsx
import { getDirectory, listApprovers, setApprovers, type DirectoryUser } from "@/lib/api";
import { PrincipalPicker, type PrincipalOption } from "@/components/permissions/principal-picker";
```

Add directory state + load (after `approverIds` state):

```tsx
  const [dirUsers, setDirUsers] = useState<DirectoryUser[]>([]);
  useEffect(() => {
    let active = true;
    void getDirectory()
      .then((d) => { if (active) setDirUsers(d.users); })
      .catch(() => { /* picker falls back to empty */ });
    return () => { active = false; };
  }, []);
```

Build picker users (users-only) + department map + display-name resolver from directory (fallback to existing mock `userName`):

```tsx
  const pickerUsers = dirUsers.map((u) => ({
    id: u.id, name: u.name, email: "", departmentId: "",
    status: "active" as const, isSysadmin: false,
  }));
  const userDepartments = Object.fromEntries(dirUsers.map((u) => [u.id, u.department]));
  const dirName = (id: string) => dirUsers.find((u) => u.id === id)?.name ?? userName(id);
```

(`useState`/`useEffect` are already imported.)

- [ ] **Step 2: Replace the `<select>` add-form with the picker**

Replace the add-form block (lines 154-180, the `{isOwner && (<div ... <select> ...)}`) with:

```tsx
      {isOwner && (
        <div className="mt-2 flex flex-col gap-2 border-t border-hairline pt-3">
          <p className="text-caption-strong text-ink">{t("perm.approversAdd")}</p>
          <PrincipalPicker
            users={pickerUsers}
            departments={[]}
            groups={[]}
            excludeIds={new Set(approverIds)}
            userDepartments={userDepartments}
            onSelect={(opt: PrincipalOption) => {
              if (opt.principalType !== "user") return;
              void (async () => {
                try {
                  await setApprovers(mapIdNum, [...approverIds, opt.principalId]);
                  await reload();
                } catch (err) {
                  onToast(err instanceof Error ? err.message : String(err));
                }
              })();
            }}
          />
        </div>
      )}
```

Remove the now-unused `selectedUserId` state, `eligible`, and `handleAdd` (orphaned by your change). Keep `handleRemove`.

- [ ] **Step 3: Restyle selected approvers as pills**

Replace the approver list block (lines 112-146) so each approver is a pill chip:

```tsx
      {approverIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {approverIds.map((userId) => (
            <span
              key={userId}
              data-id={`approver-pill-${userId}`}
              className="inline-flex items-center gap-1 rounded-sm border border-hairline bg-surface-alt px-2 py-0.5 text-caption text-ink"
            >
              {dirName(userId)}
              {isOwner && (
                <button
                  type="button"
                  title={t("perm.removeButton")}
                  className="rounded-sm p-0.5 text-ink-tertiary hover:bg-surface hover:text-error"
                  onClick={() => void handleRemove(userId)}
                >
                  <X size={14} strokeWidth={1.5} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
```

(This drops the disabled "active toggle" placeholder — it was a Layer-4 no-op; removing it is in-scope cleanup of the element you're replacing. `usePermissions`/`userName` stay for the fallback resolver.)

- [ ] **Step 4: tsc + lint**

Run: `cd /Users/hyeonjin/Documents/bpm-seed-and-search/frontend && npx tsc --noEmit && npm run lint`
Expected: 0 errors, no new warnings (confirm no orphaned `selectedUserId`/`handleAdd`/`eligible`).

- [ ] **Step 5: Commit**

```bash
cd /Users/hyeonjin/Documents/bpm-seed-and-search
git add frontend/src/components/permissions/approvers-panel.tsx
git commit -m "feat(approvers): pill UI + real-directory typeahead search — 승인자 필·검색"
```

---

## Task 6: create-map-dialog — approver pills + thread departments

**Files:**
- Modify: `frontend/src/components/permissions/create-map-dialog.tsx`

**Interfaces:**
- Consumes: improved `PrincipalPicker` (Task 4).

- [ ] **Step 1: Build a userDepartments map + pass to the collaborator picker**

In `create-map-dialog.tsx`, after `pickerUsers` is built (~line 97-104), add:

```tsx
  const userDepartments = Object.fromEntries(dirUsers.map((u) => [u.id, u.department]));
```

Find the existing collaborator `<PrincipalPicker ... users={pickerUsers} ...>` (~line 325) and add the prop:

```tsx
                userDepartments={userDepartments}
```

- [ ] **Step 2: Replace the approver picker with PrincipalPicker (users-only) + pills**

The approver section currently uses a custom `pendingApprover` text input + `filteredApproverUsers` list + `handleAddApprover`. Replace that input/list with `PrincipalPicker` (users only) and render selected approvers (`approvers: ApproverEntry[]`) as pills.

Replace the approver picker input + results (the block rendering `filteredApproverUsers`, around lines 400-440) with:

```tsx
          <PrincipalPicker
            users={pickerUsers}
            departments={[]}
            groups={[]}
            excludeIds={new Set(approvers.map((a) => a.userId))}
            userDepartments={userDepartments}
            onSelect={(opt) => {
              if (opt.principalType === "user") handleAddApprover(opt.principalId, opt.displayName);
            }}
          />
          {approvers.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {approvers.map((a) => (
                <span
                  key={a.key}
                  data-id={`create-approver-pill-${a.userId}`}
                  className="inline-flex items-center gap-1 rounded-sm border border-hairline bg-surface-alt px-2 py-0.5 text-caption text-ink"
                >
                  {a.displayName}
                  <button
                    type="button"
                    className="rounded-sm p-0.5 text-ink-tertiary hover:bg-surface hover:text-error"
                    onClick={() => handleRemoveApprover(a.key)}
                  >
                    <X size={14} strokeWidth={1.5} />
                  </button>
                </span>
              ))}
            </div>
          )}
```

Remove the now-unused `pendingApprover` state, `filteredApproverUsers`, `allUsers`, `approverExcludeIds` (orphaned by this change). `handleAddApprover`/`handleRemoveApprover` stay. Ensure `X` (lucide) and `PrincipalPicker` are imported (PrincipalPicker already is; `X` already is).

- [ ] **Step 3: tsc + lint**

Run: `cd /Users/hyeonjin/Documents/bpm-seed-and-search/frontend && npx tsc --noEmit && npm run lint`
Expected: 0 errors, no new warnings (no orphaned `pendingApprover`/`filteredApproverUsers`).

- [ ] **Step 4: Commit**

```bash
cd /Users/hyeonjin/Documents/bpm-seed-and-search
git add frontend/src/components/permissions/create-map-dialog.tsx
git commit -m "feat(create-map): approver pills + dept search in pickers — 생성 다이얼로그 승인자 필"
```

---

## Task 7: home map search + map-card highlight + i18n

**Files:**
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/src/components/maps/map-card.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: `filterByQuery`, `MatchRange` (Task 2), `Highlight` (Task 3).
- Produces: `MapCard` gains optional `nameRanges?: MatchRange[]`.

- [ ] **Step 1: i18n key (en + ko)** — `frontend/src/lib/i18n-messages.ts`

Add to the `en` block near other `home.*` keys:

```ts
  "home.searchPlaceholder": "Search maps — name, description (chosung/initials ok)",
```

Add to the `ko` block at the matching spot:

```ts
  "home.searchPlaceholder": "맵 검색 — 이름·설명 (초성/이니셜 가능)",
```

- [ ] **Step 2: map-card — optional nameRanges + Highlight**

In `map-card.tsx`, add imports:

```tsx
import { Highlight } from "@/components/highlight";
import type { MatchRange } from "@/lib/search";
```

Add `nameRanges` to `MapCardProps`:

```tsx
  nameRanges?: MatchRange[];
```

Destructure it (`{ map, selected = false, onSelect, nameRanges }`) and render the name with Highlight (replace `{map.name}` at line 87):

```tsx
        <Highlight text={map.name} ranges={nameRanges ?? []} />
```

- [ ] **Step 3: page.tsx — search box + filtered list + pass ranges**

Add imports:

```tsx
import { filterByQuery } from "@/lib/search";
import { Search } from "lucide-react";
```

Add search state (with the other useState hooks):

```tsx
  const [mapQuery, setMapQuery] = useState("");
```

Compute hits from `visibleMaps` (after `visibleMaps` is derived):

```tsx
  const mapHits = filterByQuery(visibleMaps, mapQuery, (m) => [
    { field: "name", text: m.name },
    { field: "description", text: m.description },
  ]);
```

Add a search input in the header (inside the header `<div>` at lines 92-101, between the `<h1>` and the New-map `<button>` — wrap so it sits in the middle):

```tsx
        <div className="flex flex-1 items-center gap-1.5 rounded-sm border border-hairline bg-surface px-2 py-1.5">
          <Search size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
          <input
            type="text"
            data-id="home-map-search"
            className="w-full bg-transparent text-caption text-ink outline-none placeholder:text-ink-tertiary"
            placeholder={t("home.searchPlaceholder")}
            value={mapQuery}
            onChange={(e) => setMapQuery(e.target.value)}
          />
        </div>
```

Change the list to iterate `mapHits` instead of `visibleMaps`, passing `nameRanges`. Replace `visibleMaps.length === 0` guard with `mapHits.length === 0`, and the `.map`:

```tsx
            {mapHits.map(({ item: processMap, matches }) => (
              <li key={processMap.id} className="flex flex-col">
                <MapCard
                  map={processMap}
                  selected={effectiveSelected === processMap.id}
                  onSelect={setSelectedId}
                  nameRanges={matches.find((m) => m.field === "name")?.ranges ?? []}
                />
```

(Keep the accordion `<div>` and aside exactly as-is below it.)

> Note: `effectiveSelected` derives from `visibleMaps`; if the selected map is filtered out, the side/accordion detail simply won't render for it — acceptable (selection persists; clearing the query restores it). Do not change selection logic.

- [ ] **Step 4: tsc + lint + build**

Run: `cd /Users/hyeonjin/Documents/bpm-seed-and-search/frontend && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/hyeonjin/Documents/bpm-seed-and-search
git add frontend/src/app/page.tsx frontend/src/components/maps/map-card.tsx frontend/src/lib/i18n-messages.ts
git commit -m "feat(home): map search with chosung/initials + name highlight — 홈 맵 검색·하이라이트"
```

---

## Task 8: Integration verification

**Files:** none (verification only)

- [ ] **Step 1: Backend** — `cd /Users/hyeonjin/Documents/bpm-seed-and-search/backend && /Users/hyeonjin/Documents/bpm/backend/.venv/bin/python -m pytest tests/ -q && /Users/hyeonjin/Documents/bpm/backend/.venv/bin/ruff check app/ tests/ scripts/`
Expected: all pass (298), ruff clean.

- [ ] **Step 2: Frontend** — `cd /Users/hyeonjin/Documents/bpm-seed-and-search/frontend && npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: vitest green, tsc 0, lint 0 errors, build OK.

- [ ] **Step 3: Manual smoke (native env recommended)** — reseed (`cd backend && <venv>/python -m scripts.reset_db`; confirm "normalize invariants" line shows non-zero) then run servers and verify: 승인자 패널/생성 다이얼로그 — 초성/로마자/소속 검색·하이라이트·필 추가·X 제거; 홈 검색 — 이름/설명/초성/이니셜 필터 + 카드명 하이라이트. Record observed output; do not claim verified from reading alone.

---

## Self-Review

- **Spec coverage:** Task0 seed→Task1; Task2 search(초성·로마자·소속·콤마AND·하이라이트)→Tasks 2(core)+3(Highlight)+4(picker apply); Task1 approver pill→Tasks 5(settings)+6(create); Task3 home search→Task7. All spec sections mapped.
- **Type consistency:** `matchTerm`/`filterByQuery`/`MatchRange`/`SearchHit`/`FieldMatch` defined in Task 2, consumed identically in Tasks 4/7. `PrincipalOption.department?`/`userDepartments?` defined Task 4, used Tasks 5/6. `MapCard.nameRanges?` defined Task 7. `normalize_workflow_invariants` signature/return keys consistent Task 1.
- **Placeholder scan:** all steps carry concrete code/commands. Backend-from-worktree command form stated (Task 1 Step 2 note).
- **Risk note:** approvers-panel switches its user source from mock `state.users` to real `getDirectory` — display names now real; `dirName` falls back to mock `userName` until directory loads. Acceptable.
