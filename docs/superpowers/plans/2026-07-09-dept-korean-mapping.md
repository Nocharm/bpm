# 부서 한글명 매핑 관리 + 유저 추출 옵션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 부서 탭에서 영어부서↔한글부서 1:N을 발견(필터·korean dept 열)하고 더블클릭 모달로 전원 덮어쓰기 정규화하며, 한글이름 모달의 JSON 추출에 4가지 대상 옵션(스플릿 버튼)을 만든다.

**Architecture:** 매핑의 실체는 `employees.korean_dept` 일괄 갱신(접근 A — 스키마 무변경). 부서 페이지는 기존 `GET /api/admin/users` 데이터에 korean 필드 2개를 추가해 클라이언트 순수 함수로 집계한다. 신규 백엔드는 PUT 1개.

**Tech Stack:** FastAPI + SQLAlchemy(async) + pytest / Next.js + React + vitest + playwright-core.

**Spec:** `docs/superpowers/specs/2026-07-09-dept-korean-mapping-design.md`

## Global Constraints

- 작업 루트: `/Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement` — 메인 체크아웃 접근 금지, 브랜치 전환 금지.
- 모든 커밋에 `PROGRESS.md` 갱신 포함(최상단 2026-07-09 섹션에 한 줄), 커밋 메시지 `type(scope): English — 한국어` + 트레일러 2줄(`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01GYhJfUnNEGtfRwVwC4UoGv`). `git add` 파일 명시.
- Python 타입힌트 필수·`ruff check app/ tests/` 0. TS `any` 금지·raw hex 금지·Lucide 16px strokeWidth 1.5·data-id 부여·`useCallback` 추가 금지·effect 내 동기 setState 금지.
- backend 명령: `backend/`에서 `.venv/bin/python -m pytest tests/ -q`, `.venv/bin/ruff check app/ tests/`. frontend: `frontend/`에서 `npm test`, `npm run lint`, `npm run build`.
- 기존 파일 무관 변경 금지(surgical). 기존 lint warning 1건(`pw-smoke-task8.mjs`)은 무시.

---

### Task 1: BE — AdminUserOut korean 필드 + PUT /api/admin/departments/korean-dept

**Files:**
- Modify: `backend/app/schemas.py` (AdminUserOut ~line 685, 그 아래 신규 2클래스)
- Modify: `backend/app/routers/admin.py` (AdminUserOut 생성부 ~line 53, 파일 내 신규 엔드포인트)
- Test: `backend/tests/test_dept_korean_mapping.py` (신규)

**Interfaces:**
- Produces: `AdminUserOut.korean_name/korean_dept`(GET /api/admin/users에 노출 — Task 2·3 의존), `PUT /api/admin/departments/korean-dept` body `{"org_levels": [...], "korean_dept": str}` → `{"updated": int}` (Task 3의 `setDeptKoreanDept`가 호출).

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_dept_korean_mapping.py` 신규:

```python
"""부서 한글명 매핑 — /admin/users korean 필드 노출 + 부서 전원 korean_dept 일괄 갱신."""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import Employee
from app.settings import settings


def _seed_org(
    login_id: str, levels: list[str], korean_dept: str = "", korean_name: str = ""
) -> None:
    """org 경로까지 지정하는 멱등 시드 — 부서 매핑 테스트용."""

    async def _run() -> None:
        async with SessionLocal() as session:
            emp = await session.get(Employee, login_id)
            if emp is None:
                emp = Employee(login_id=login_id, source="local")
                session.add(emp)
            padded = (levels + [None] * 5)[:5]
            emp.org_l1, emp.org_l2, emp.org_l3, emp.org_l4, emp.org_l5 = padded
            emp.department = levels[-1] if levels else ""
            emp.korean_dept = korean_dept
            emp.korean_name = korean_name
            await session.commit()

    asyncio.run(_run())


def _get_korean_dept(login_id: str) -> str | None:
    async def _run() -> str | None:
        async with SessionLocal() as session:
            emp = await session.get(Employee, login_id)
            return None if emp is None else emp.korean_dept

    return asyncio.run(_run())


@pytest.fixture
def sysadmin_enforced() -> Iterator[None]:
    """enforce ON + sysadmin=admin.kim — 비 sysadmin 403 검증용(test_employees.py와 동일 패턴)."""
    prev_enforce = settings.dev_enforce_permissions
    prev_sys = settings.bpm_sysadmins
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = "admin.kim"
    yield
    settings.dev_enforce_permissions = prev_enforce
    settings.bpm_sysadmins = prev_sys


def test_admin_users_include_korean_fields(client: TestClient) -> None:
    _seed_org("dk.user1", ["HQ", "DeptB", "TeamA"], korean_dept="팀A", korean_name="김하나")
    res = client.get("/api/admin/users", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    by_id = {u["login_id"]: u for u in res.json()["users"]}
    assert by_id["dk.user1"]["korean_dept"] == "팀A"
    assert by_id["dk.user1"]["korean_name"] == "김하나"


def test_dept_mapping_updates_exact_path_only(client: TestClient) -> None:
    _seed_org("dk.a1", ["HQ", "DeptB", "TeamA"], korean_dept="팀A구")
    _seed_org("dk.a2", ["HQ", "DeptB", "TeamA"], korean_dept="")
    _seed_org("dk.child", ["HQ", "DeptB", "TeamA", "Cell1"], korean_dept="셀1")
    _seed_org("dk.sibling", ["HQ", "DeptB", "TeamB"], korean_dept="팀B")
    res = client.put(
        "/api/admin/departments/korean-dept",
        headers={"X-Dev-User": "admin.kim"},
        json={"org_levels": ["HQ", "DeptB", "TeamA"], "korean_dept": " 팀A그룹 "},
    )
    assert res.status_code == 200
    assert res.json() == {"updated": 2}
    # 전원 덮어쓰기(빈 값·다른 값 모두) + trim, 하위/형제 경로 미간섭
    assert _get_korean_dept("dk.a1") == "팀A그룹"
    assert _get_korean_dept("dk.a2") == "팀A그룹"
    assert _get_korean_dept("dk.child") == "셀1"
    assert _get_korean_dept("dk.sibling") == "팀B"


def test_dept_mapping_unknown_path_updates_zero(client: TestClient) -> None:
    res = client.put(
        "/api/admin/departments/korean-dept",
        headers={"X-Dev-User": "admin.kim"},
        json={"org_levels": ["No", "Such", "Path"], "korean_dept": "무소속"},
    )
    assert res.status_code == 200
    assert res.json() == {"updated": 0}


def test_dept_mapping_rejects_blank_and_overlong(client: TestClient) -> None:
    for korean_dept in ("   ", "그" * 201):
        res = client.put(
            "/api/admin/departments/korean-dept",
            headers={"X-Dev-User": "admin.kim"},
            json={"org_levels": ["HQ"], "korean_dept": korean_dept},
        )
        assert res.status_code == 422


def test_dept_mapping_rejects_empty_levels(client: TestClient) -> None:
    res = client.put(
        "/api/admin/departments/korean-dept",
        headers={"X-Dev-User": "admin.kim"},
        json={"org_levels": [], "korean_dept": "무소속"},
    )
    assert res.status_code == 422


def test_dept_mapping_requires_sysadmin(client: TestClient, sysadmin_enforced: None) -> None:
    res = client.put(
        "/api/admin/departments/korean-dept",
        headers={"X-Dev-User": "user.lee"},
        json={"org_levels": ["HQ"], "korean_dept": "무소속"},
    )
    assert res.status_code == 403
```

- [ ] **Step 2: 실패 확인**

Run: `.venv/bin/python -m pytest tests/test_dept_korean_mapping.py -q`
Expected: FAIL — korean 필드 KeyError / PUT 405.

- [ ] **Step 3: 구현**

`backend/app/schemas.py` — `AdminUserOut`의 `active: bool` 아래에:

```python
    korean_name: str   # AD 미제공 — 어드민 임포트 전용 (2026-07-09)
    korean_dept: str
```

같은 파일 `AdminDeptOut` 클래스 아래에(기존 `Annotated`/`StringConstraints` import 재사용):

```python
class DeptKoreanDeptIn(BaseModel):
    """부서 전원 korean_dept 일괄 갱신 — 영어부서↔한글부서 1:N 정규화 (dept-korean-mapping §1b)."""

    org_levels: list[str]
    korean_dept: Annotated[str, StringConstraints(max_length=200)]


class DeptKoreanDeptOut(BaseModel):
    updated: int
```

`backend/app/routers/admin.py` — import에 `DeptKoreanDeptIn, DeptKoreanDeptOut` 추가, `get_admin_users` 아래에:

```python
@router.put("/departments/korean-dept", response_model=DeptKoreanDeptOut)
async def set_department_korean_dept(
    payload: DeptKoreanDeptIn,
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DeptKoreanDeptOut:
    """부서(org 경로 정확 일치) 전원의 korean_dept 덮어쓰기 — sysadmin 전용."""
    if not is_sysadmin(login_id):
        raise HTTPException(status_code=403, detail="sysadmin required")
    korean_dept = payload.korean_dept.strip()
    if not korean_dept or not payload.org_levels:
        raise HTTPException(status_code=422, detail="org_levels and korean_dept required")
    target = tuple(payload.org_levels)
    rows = (await session.scalars(select(Employee))).all()
    updated = 0
    for emp in rows:
        levels = tuple(
            lv
            for lv in (emp.org_l1, emp.org_l2, emp.org_l3, emp.org_l4, emp.org_l5)
            if lv is not None
        )
        if levels == target:
            emp.korean_dept = korean_dept
            updated += 1
    await session.commit()
    return DeptKoreanDeptOut(updated=updated)
```

그리고 `get_admin_users`의 `AdminUserOut(` 생성에 `korean_name=emp.korean_name, korean_dept=emp.korean_dept,` 추가 (`active=emp.active,` 아래).

- [ ] **Step 4: GREEN + 전체 회귀 + 린트**

Run: `.venv/bin/python -m pytest tests/test_dept_korean_mapping.py -q` → 6 passed
Run: `.venv/bin/python -m pytest tests/ -q` → 전체 PASS · `.venv/bin/ruff check app/ tests/` → 0

- [ ] **Step 5: PROGRESS.md 한 줄 추가 후 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement
git add backend/app/schemas.py backend/app/routers/admin.py backend/tests/test_dept_korean_mapping.py PROGRESS.md
git commit -m "feat(admin): dept-wide korean_dept bulk set + korean fields in admin users — 부서 전원 한글부서 일괄 갱신 API"
```

---

### Task 2: FE lib — korean-dept.ts 순수 함수 + vitest + api 클라이언트

**Files:**
- Modify: `frontend/src/lib/api.ts` (`AdminUser` ~line 1073에 필드 2개, `getAdminUsers` 아래 함수 1개)
- Create: `frontend/src/lib/korean-dept.ts`
- Test: `frontend/src/lib/korean-dept.test.ts`

**Interfaces:**
- Consumes: Task 1의 확장 응답·PUT.
- Produces (Task 3·4가 사용): `getDeptMembers(users, orgLevels)`, `aggregateDeptKoreanDepts(members): DeptKoreanCandidate[]`, `shouldFlagDeptMapping(candidates, memberCount)`, `formatRosterName(user, lang)`, `buildExportIds(rows, option, rng?)`, `type ExportOption = "missing" | "deptSample" | "random50" | "all"`, api의 `setDeptKoreanDept(orgLevels: string[], koreanDept: string): Promise<{updated: number}>`.

- [ ] **Step 1: api.ts 갱신** — `AdminUser`의 `active: boolean;` 아래:

```ts
  korean_name: string;
  korean_dept: string;
```

`getAdminUsers` 아래에:

```ts
export function setDeptKoreanDept(
  orgLevels: string[],
  koreanDept: string,
): Promise<{ updated: number }> {
  return request<{ updated: number }>("/admin/departments/korean-dept", {
    method: "PUT",
    body: JSON.stringify({ org_levels: orgLevels, korean_dept: koreanDept }),
  });
}
```

- [ ] **Step 2: 실패하는 테스트 작성** — `frontend/src/lib/korean-dept.test.ts` 신규:

```ts
import { describe, expect, it } from "vitest";

import type { AdminUser, EmployeeRow } from "./api";
import {
  aggregateDeptKoreanDepts,
  buildExportIds,
  formatRosterName,
  getDeptMembers,
  shouldFlagDeptMapping,
} from "./korean-dept";

const user = (login_id: string, org: string[], korean_dept = "", korean_name = ""): AdminUser => ({
  login_id,
  name: `EN ${login_id}`,
  department: org[org.length - 1] ?? "",
  role: "user",
  is_sysadmin: false,
  org_levels: org,
  active: true,
  korean_name,
  korean_dept,
});

const emp = (login_id: string, department: string, korean_name = ""): EmployeeRow => ({
  login_id,
  name: "",
  title: "",
  source: "ad",
  role: "user",
  department,
  korean_name,
  korean_dept: "",
});

describe("getDeptMembers / aggregateDeptKoreanDepts", () => {
  const users = [
    user("a", ["HQ", "TeamA"], "팀에이"),
    user("b", ["HQ", "TeamA"], "팀A그룹"),
    user("c", ["HQ", "TeamA"], "팀A그룹"),
    user("d", ["HQ", "TeamA"], ""),
    user("e", ["HQ", "TeamA", "Cell"], "셀"),
  ];

  it("matches exact org path only", () => {
    expect(getDeptMembers(users, ["HQ", "TeamA"]).map((u) => u.login_id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("aggregates distinct non-empty values, count desc", () => {
    expect(aggregateDeptKoreanDepts(getDeptMembers(users, ["HQ", "TeamA"]))).toEqual([
      { value: "팀A그룹", count: 2 },
      { value: "팀에이", count: 1 },
    ]);
  });
});

describe("shouldFlagDeptMapping", () => {
  it("flags 2+ candidates or zero candidates with members", () => {
    expect(shouldFlagDeptMapping([{ value: "x", count: 1 }, { value: "y", count: 1 }], 2)).toBe(true);
    expect(shouldFlagDeptMapping([], 3)).toBe(true);
    expect(shouldFlagDeptMapping([{ value: "x", count: 3 }], 3)).toBe(false);
    expect(shouldFlagDeptMapping([], 0)).toBe(false);
  });
});

describe("formatRosterName", () => {
  const both = { name: "Hyeonjin Jang", korean_name: "장현진" };
  it("orders by lang, falls back to whichever exists", () => {
    expect(formatRosterName(both, "ko")).toBe("장현진 (Hyeonjin Jang)");
    expect(formatRosterName(both, "en")).toBe("Hyeonjin Jang (장현진)");
    expect(formatRosterName({ name: "Only EN", korean_name: "" }, "ko")).toBe("Only EN");
    expect(formatRosterName({ name: "", korean_name: "한글만" }, "en")).toBe("한글만");
  });
});

describe("buildExportIds", () => {
  const rows = [
    emp("m1", "TeamA", ""),
    emp("m2", "TeamA", "홍길동"),
    emp("m3", "TeamB", ""),
    emp("m4", "TeamB", ""),
  ];

  it("missing — only empty korean_name", () => {
    expect(buildExportIds(rows, "missing")).toEqual(["m1", "m3", "m4"]);
  });

  it("all — every id", () => {
    expect(buildExportIds(rows, "all")).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("deptSample — one per department, deterministic with rng", () => {
    expect(buildExportIds(rows, "deptSample", () => 0)).toEqual(["m1", "m3"]);
    expect(buildExportIds(rows, "deptSample", () => 0.99)).toEqual(["m2", "m4"]);
  });

  it("random50 — min(50, n) without replacement", () => {
    const picked = buildExportIds(rows, "random50", () => 0);
    expect(picked).toHaveLength(4);
    expect(new Set(picked).size).toBe(4);
  });
});
```

- [ ] **Step 3: 실패 확인** — `npm test` → `Cannot find module './korean-dept'`

- [ ] **Step 4: 구현** — `frontend/src/lib/korean-dept.ts` 신규:

```ts
// 부서 한글명 매핑·유저 추출 순수 함수 — 부서 탭·한글이름 모달용(DOM/fetch 없음).
// 설계: docs/superpowers/specs/2026-07-09-dept-korean-mapping-design.md

import type { AdminUser, EmployeeRow } from "./api";
import type { Lang } from "./i18n-messages";

export interface DeptKoreanCandidate {
  value: string;
  count: number;
}

export function getDeptMembers(users: AdminUser[], orgLevels: string[]): AdminUser[] {
  const path = orgLevels.join("/");
  return users.filter((u) => u.org_levels.join("/") === path);
}

export function aggregateDeptKoreanDepts(members: AdminUser[]): DeptKoreanCandidate[] {
  const counts = new Map<string, number>();
  for (const member of members) {
    if (!member.korean_dept) continue;
    counts.set(member.korean_dept, (counts.get(member.korean_dept) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** 매핑 필요 판정 — 한글부서가 2개 이상 갈리거나, 인원은 있는데 하나도 없을 때. */
export function shouldFlagDeptMapping(
  candidates: DeptKoreanCandidate[],
  memberCount: number,
): boolean {
  return candidates.length >= 2 || (memberCount > 0 && candidates.length === 0);
}

/** 명단 필 표기 — 언어 토글 연동: ko는 한글(영문), en은 영문(한글). 없는 쪽은 생략. */
export function formatRosterName(
  user: Pick<AdminUser, "name" | "korean_name">,
  lang: Lang,
): string {
  const primary = lang === "ko" ? user.korean_name : user.name;
  const secondary = lang === "ko" ? user.name : user.korean_name;
  if (!primary) return secondary;
  return secondary ? `${primary} (${secondary})` : primary;
}

export type ExportOption = "missing" | "deptSample" | "random50" | "all";

export function buildExportIds(
  rows: EmployeeRow[],
  option: ExportOption,
  rng: () => number = Math.random,
): string[] {
  switch (option) {
    case "missing":
      return rows.filter((r) => !r.korean_name).map((r) => r.login_id);
    case "all":
      return rows.map((r) => r.login_id);
    case "deptSample": {
      const byDept = new Map<string, EmployeeRow[]>();
      for (const r of rows) {
        const group = byDept.get(r.department);
        if (group) group.push(r);
        else byDept.set(r.department, [r]);
      }
      return [...byDept.values()].map(
        (group) => group[Math.floor(rng() * group.length)].login_id,
      );
    }
    case "random50": {
      const pool = [...rows];
      const picked: string[] = [];
      while (picked.length < 50 && pool.length > 0) {
        const i = Math.floor(rng() * pool.length);
        picked.push(pool[i].login_id);
        pool.splice(i, 1);
      }
      return picked;
    }
  }
}
```

주의: `Lang` 타입은 `@/lib/i18n-messages`에서 export됨(`i18n.tsx`가 재사용하는 것과 동일).

- [ ] **Step 5: GREEN + 린트** — `npm test` 전체 PASS(+10), `npm run lint` 0 에러

- [ ] **Step 6: PROGRESS.md 갱신 후 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement
git add frontend/src/lib/api.ts frontend/src/lib/korean-dept.ts frontend/src/lib/korean-dept.test.ts PROGRESS.md
git commit -m "feat(admin): dept korean mapping helpers + export samplers lib — 부서 매핑·추출 순수 함수 lib"
```

---

### Task 3: FE — 부서 페이지 개편 (필터·korean dept 열·명단 툴팁·매핑 모달)

**Files:**
- Modify: `frontend/src/components/admin/department-table.tsx` (전면 개편 — 기존 구조 유지하며 확장)
- Create: `frontend/src/components/admin/dept-korean-modal.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts` (en `"admin.krClose"` 아래 / ko 동일 위치에 신규 키)

**Interfaces:**
- Consumes: Task 2의 lib 함수·`setDeptKoreanDept`, 확장된 `AdminUser`.
- Produces: 부서 탭 최종 UI — Task 5 스모크가 검증.

- [ ] **Step 1: i18n 키 추가** — en 블록 `"admin.krClose": "Close",` 아래:

```ts
  "admin.deptNeedsFilter": "Needs mapping only",
  "admin.deptKrCol": "korean dept",
  "admin.deptKrTitle": "Map Korean Department",
  "admin.deptKrHint": "Pick one of the mapped values or type a new one. Applying overwrites every member of this department.",
  "admin.deptKrInputPlaceholder": "Korean department name",
  "admin.deptKrApply": "Apply to all members",
  "admin.deptKrNoCandidates": "No Korean department mapped yet — type one below or import user data first.",
  "admin.deptKrUpdated": "Updated {n} members.",
```

ko 블록 `"admin.krClose": "닫기",` 아래:

```ts
  "admin.deptNeedsFilter": "매핑 필요만 보기",
  "admin.deptKrCol": "한글 부서",
  "admin.deptKrTitle": "한글 부서 매핑",
  "admin.deptKrHint": "매핑된 값 중 선택하거나 직접 입력하세요. 적용 시 이 부서 전원에게 덮어씁니다.",
  "admin.deptKrInputPlaceholder": "한글 부서명",
  "admin.deptKrApply": "전원에게 적용",
  "admin.deptKrNoCandidates": "매핑된 한글 부서가 아직 없습니다 — 아래에 직접 입력하거나 유저 데이터를 먼저 임포트하세요.",
  "admin.deptKrUpdated": "{n}명 갱신되었습니다.",
```

- [ ] **Step 2: 매핑 모달 작성** — `frontend/src/components/admin/dept-korean-modal.tsx` 신규:

```tsx
"use client";

// 부서 한글명 매핑 모달 — 후보 선택 또는 직접 입력 → 부서 전원 korean_dept 덮어쓰기.
// 설계: docs/superpowers/specs/2026-07-09-dept-korean-mapping-design.md

import { Building2 } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { setDeptKoreanDept, type AdminDept } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { DeptKoreanCandidate } from "@/lib/korean-dept";

const BTN_SECONDARY =
  "rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";
const BTN_ACCENT =
  "rounded-sm bg-accent px-3 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus disabled:opacity-40";

interface DeptKoreanModalProps {
  dept: AdminDept;
  candidates: DeptKoreanCandidate[];
  onClose: () => void;
  /** 적용 성공 후 디렉터리 재조회 */
  onApplied: () => void;
}

export function DeptKoreanModal({ dept, candidates, onClose, onApplied }: DeptKoreanModalProps) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<number | null>(null);

  const onApply = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await setDeptKoreanDept(dept.org_levels, value.trim());
      setUpdated(res.updated);
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "apply failed");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <ModalBackdrop
      onClose={() => {
        if (!busy) onClose();
      }}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="dept-korean-modal"
        className="flex w-full max-w-md flex-col gap-3 rounded-md bg-surface p-6 shadow-lg"
      >
        <div className="flex items-center gap-2">
          <Building2 size={16} strokeWidth={1.5} className="text-accent" />
          <h2 className="text-body-strong text-ink">{t("admin.deptKrTitle")}</h2>
        </div>
        <p className="text-caption text-ink-secondary">{dept.org_levels.join(" / ")}</p>

        {updated === null ? (
          <>
            <p className="text-caption text-ink-tertiary">{t("admin.deptKrHint")}</p>
            {candidates.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {candidates.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    data-id="dept-kr-candidate"
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-fine ${
                      value === c.value
                        ? "border-accent bg-accent-tint text-accent"
                        : "border-hairline text-ink-secondary hover:bg-surface-alt"
                    }`}
                    onClick={() => setValue(c.value)}
                  >
                    {c.value}
                    <span className="text-ink-tertiary">{c.count}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-fine text-ink-tertiary">{t("admin.deptKrNoCandidates")}</p>
            )}
            <input
              data-id="dept-kr-input"
              type="text"
              value={value}
              maxLength={200}
              placeholder={t("admin.deptKrInputPlaceholder")}
              onChange={(e) => setValue(e.target.value)}
              className="rounded-sm border border-hairline bg-surface px-3 py-1.5 text-caption text-ink placeholder:text-ink-tertiary focus:border-accent focus:outline-none"
            />
            {error && <p className="text-caption text-error">{error}</p>}
            <div className="flex justify-end gap-2 border-t border-hairline pt-3">
              <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={onClose}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                data-id="dept-kr-apply"
                className={BTN_ACCENT}
                disabled={busy || !value.trim()}
                onClick={() => void onApply()}
              >
                {t("admin.deptKrApply")}
              </button>
            </div>
          </>
        ) : (
          <>
            <p data-id="dept-kr-result" className="rounded-sm bg-surface-alt p-3 text-caption text-ink">
              {t("admin.deptKrUpdated", { n: updated })}
            </p>
            <div className="flex justify-end border-t border-hairline pt-3">
              <button type="button" data-id="dept-kr-close" className={BTN_SECONDARY} onClick={onClose}>
                {t("admin.krClose")}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
```

- [ ] **Step 3: 부서 테이블 개편** — `frontend/src/components/admin/department-table.tsx` 전체를 다음으로 교체:

```tsx
"use client";

// 부서 테이블 — 기본: 부서명 + 한글부서 + 인원수(호버 명단). 디버그 토글(org 보기) 시 인원수 대신 가변 orgLevels 컬럼 /
// Department table — name + korean-dept pills + member count (roster on hover). Org-view swaps count for org columns.
// orgLevels depth is VARIABLE — max depth computed at runtime, never hardcoded.
// 한글부서 매핑: 필터(2개 이상/없음)·행 더블클릭 모달 — dept-korean-mapping design 2026-07-09.

import { useEffect, useState } from "react";

import { type AdminDept, type AdminUser, getAdminUsers } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  aggregateDeptKoreanDepts,
  formatRosterName,
  getDeptMembers,
  shouldFlagDeptMapping,
} from "@/lib/korean-dept";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";
import { ADMIN_HEAD_ROW, ADMIN_ROW, ADMIN_TD, ADMIN_TH, TableCard } from "./admin-table";
import { DeptKoreanModal } from "./dept-korean-modal";

const PILL =
  "inline-flex items-center gap-1 rounded-full border border-hairline px-2 py-0.5 text-fine text-ink-secondary";

/** 인원수 호버 명단 툴팁 — 이름 필(언어 토글 연동), 25행 청킹. 충돌 툴팁과 동일한 호버 연속(pt-1 래퍼). */
function RosterHover({ members, count }: { members: AdminUser[]; count: number }) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const { visible, hasMore, sentinelRef } = useInfiniteSlice(members, "");
  return (
    <span
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="cursor-help text-ink-secondary underline decoration-dotted">{count}</span>
      {open && (
        <div className="absolute left-0 top-full z-10 pt-1">
          <div
            data-id="dept-roster-tooltip"
            className="flex max-h-64 w-72 flex-wrap content-start gap-1 overflow-y-auto rounded-md border border-hairline bg-surface p-2 shadow-lg"
          >
            {visible.map((m) => (
              <span key={m.login_id} className={PILL}>
                {formatRosterName(m, lang)}
              </span>
            ))}
            {hasMore && <span ref={sentinelRef} className="h-4 w-full" />}
          </div>
        </div>
      )}
    </span>
  );
}

export function DepartmentTable() {
  const { t } = useI18n();
  const [departments, setDepartments] = useState<AdminDept[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showOrg, setShowOrg] = useState(false);
  const [needsOnly, setNeedsOnly] = useState(false);
  const [mappingDept, setMappingDept] = useState<AdminDept | null>(null);

  const loadDirectory = () => {
    getAdminUsers()
      .then((data) => {
        setDepartments(data.departments);
        setUsers(data.users);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(() => {
    loadDirectory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 매핑 필요 필터 — 후보 2개 이상 또는 0개(인원 있는 부서)
  const filtered = needsOnly
    ? departments.filter((dept) => {
        const members = getDeptMembers(users, dept.org_levels);
        return shouldFlagDeptMapping(aggregateDeptKoreanDepts(members), members.length);
      })
    : departments;

  // 25행씩 증분 렌더 — 필터 토글 시 처음부터(resetKey).
  const { visible, hasMore, sentinelRef } = useInfiniteSlice(filtered, needsOnly ? "needs" : "all");

  // orgLevels 최대 깊이 동적 계산 — 절대 하드코딩 금지 /
  // Compute max orgLevels length dynamically across all departments.
  const maxOrgDepth = departments.reduce((max, d) => Math.max(max, d.org_levels.length), 0);
  const orgColIndices = Array.from({ length: maxOrgDepth }, (_, i) => i);
  const colCount = showOrg ? 2 + maxOrgDepth : 3;

  if (error) {
    return (
      <div className="text-caption text-error">Failed to load departments: {error}</div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        {/* 디버그 토글 — org 보기 / Debug toggle: org columns */}
        <label className="flex cursor-pointer items-center gap-2 text-fine text-ink-secondary">
          <input
            type="checkbox"
            checked={showOrg}
            onChange={(e) => setShowOrg(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          {t("perm.sysadmin.deptDebugToggle")}
        </label>
        {/* 매핑 필요 필터 — 한글부서 2개 이상 갈리거나 하나도 없는 부서만 */}
        <label className="flex cursor-pointer items-center gap-2 text-fine text-ink-secondary">
          <input
            data-id="dept-needs-filter"
            type="checkbox"
            checked={needsOnly}
            onChange={(e) => setNeedsOnly(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          {t("admin.deptNeedsFilter")}
        </label>
      </div>

      <TableCard>
        <thead>
          <tr className={ADMIN_HEAD_ROW}>
            <th className={ADMIN_TH}>{t("perm.sysadmin.deptColName")}</th>
            <th className={ADMIN_TH}>{t("admin.deptKrCol")}</th>
            {/* org 미보기 시 인원수 열 / member-count column when org view is off */}
            {!showOrg && <th className={ADMIN_TH}>{t("perm.sysadmin.deptColCount")}</th>}
            {showOrg &&
              orgColIndices.map((i) => (
                <th key={i} className={ADMIN_TH}>
                  {t("perm.sysadmin.deptOrgCol", { n: String(i + 1) })}
                </th>
              ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((dept, idx) => {
            const members = getDeptMembers(users, dept.org_levels);
            const candidates = aggregateDeptKoreanDepts(members);
            return (
              <tr
                key={idx}
                className={`${ADMIN_ROW} cursor-pointer`}
                data-id="dept-row"
                onDoubleClick={() => setMappingDept(dept)}
              >
                <td className={ADMIN_TD}>{dept.name}</td>
                {/* 매핑된 한글부서 — 복수면 상하 나열, 필 + 인원수 */}
                <td className={ADMIN_TD} data-id="dept-kr-cell">
                  <div className="flex flex-col items-start gap-1">
                    {candidates.map((c) => (
                      <span key={c.value} className={PILL}>
                        {c.value}
                        <span className="text-ink-tertiary">{c.count}</span>
                      </span>
                    ))}
                  </div>
                </td>
                {!showOrg && (
                  <td className={ADMIN_TD}>
                    <RosterHover members={members} count={members.length} />
                  </td>
                )}
                {showOrg &&
                  orgColIndices.map((i) => (
                    <td key={i} className={`${ADMIN_TD} text-ink-tertiary`}>
                      {dept.org_levels[i] ?? ""}
                    </td>
                  ))}
              </tr>
            );
          })}
          {hasMore && (
            <tr ref={sentinelRef}>
              <td className={ADMIN_TD} colSpan={colCount} />
            </tr>
          )}
        </tbody>
      </TableCard>

      {mappingDept && (
        <DeptKoreanModal
          dept={mappingDept}
          candidates={aggregateDeptKoreanDepts(getDeptMembers(users, mappingDept.org_levels))}
          onClose={() => setMappingDept(null)}
          onApplied={loadDirectory}
        />
      )}
    </div>
  );
}
```

주의: `useEffect` 안 `loadDirectory()` 호출에 eslint `react-hooks/exhaustive-deps` 경고가 나면 위처럼 disable 주석 1줄 — 단 `react-hooks/set-state-in-effect`·`preserve-manual-memoization` 에러가 나는 형태(예: useCallback)로 우회하지 말 것. 만약 disable 주석이 lint에서 불허되면 기존 파일 패턴(`void getAdminUsers().then(...)` 인라인)을 useEffect에 남기고 `loadDirectory`는 onApplied 전용으로 둔다.

- [ ] **Step 4: 검증** — `npm run lint` 0 에러 · `npm test` 전체 PASS · `npm run build` 성공

- [ ] **Step 5: PROGRESS.md 갱신 후 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement
git add frontend/src/components/admin/department-table.tsx frontend/src/components/admin/dept-korean-modal.tsx frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(admin): dept tab korean mapping UI (filter/pills/roster/modal) — 부서 탭 한글부서 매핑 UI"
```

---

### Task 4: FE — 추출 스플릿 버튼 (korean-name-modal.tsx)

**Files:**
- Modify: `frontend/src/components/admin/korean-name-modal.tsx` (onDownload 교체 + 버튼 영역)
- Modify: `frontend/src/lib/i18n-messages.ts` (en/ko 각 4키)

**Interfaces:**
- Consumes: Task 2의 `buildExportIds`/`ExportOption`.

- [ ] **Step 1: i18n 키** — en `"admin.krDownload": "Download missing list",` 아래:

```ts
  "admin.krExportMissing": "Missing names only (default)",
  "admin.krExportDeptSample": "One random per department",
  "admin.krExportRandom50": "Random 50 users",
  "admin.krExportAll": "All users",
```

ko `"admin.krDownload": "미보유 목록 다운로드",` 아래:

```ts
  "admin.krExportMissing": "이름 없는 사람만 (기본)",
  "admin.krExportDeptSample": "부서별 랜덤 1인",
  "admin.krExportRandom50": "무작위 50인",
  "admin.krExportAll": "전체 목록",
```

- [ ] **Step 2: 스플릿 버튼 구현** — `korean-name-modal.tsx`:

import에 `ChevronDown` (lucide), `buildExportIds, type ExportOption` (`@/lib/korean-dept`) 추가. state에 `const [exportMenuOpen, setExportMenuOpen] = useState(false);` 추가.

`onDownload`를 다음으로 교체:

```tsx
  const EXPORT_FILENAMES: Record<ExportOption, string> = {
    missing: "korean-names-missing.json",
    deptSample: "korean-names-sample-dept.json",
    random50: "korean-names-sample-50.json",
    all: "korean-names-all.json",
  };

  const onDownload = (option: ExportOption) => {
    setExportMenuOpen(false);
    const ids = buildExportIds(rows, option);
    const blob = new Blob([JSON.stringify(ids, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = EXPORT_FILENAMES[option];
    anchor.click();
    URL.revokeObjectURL(url);
  };
```

(참고: `buildMissingIdsJson` import는 이 파일에서 제거 — `buildExportIds(rows, "missing")`이 동일 내용을 생성. lib의 함수 자체는 유지.)

idle 단계 다운로드 버튼을 스플릿 버튼으로 교체 — 기존 `kr-download-btn` 버튼 자리를:

```tsx
              <span className="relative inline-flex">
                <button
                  type="button"
                  data-id="kr-download-btn"
                  className={`${BTN_SECONDARY} rounded-r-none`}
                  onClick={() => onDownload("missing")}
                >
                  <FileDown size={16} strokeWidth={1.5} />
                  {t("admin.krDownload")}
                </button>
                <button
                  type="button"
                  data-id="kr-export-menu-btn"
                  aria-label="Export options"
                  className={`${BTN_SECONDARY} rounded-l-none border-l-0 px-1.5`}
                  onClick={() => setExportMenuOpen((open) => !open)}
                >
                  <ChevronDown size={16} strokeWidth={1.5} />
                </button>
                {exportMenuOpen && (
                  <div
                    data-id="kr-export-menu"
                    className="absolute right-0 top-full z-10 mt-1 flex w-56 flex-col rounded-md border border-hairline bg-surface py-1 shadow-lg"
                  >
                    {(
                      [
                        ["missing", "admin.krExportMissing"],
                        ["deptSample", "admin.krExportDeptSample"],
                        ["random50", "admin.krExportRandom50"],
                        ["all", "admin.krExportAll"],
                      ] as const
                    ).map(([option, labelKey]) => (
                      <button
                        key={option}
                        type="button"
                        data-id={`kr-export-opt-${option}`}
                        className="px-3 py-1.5 text-left text-caption text-ink hover:bg-surface-alt"
                        onClick={() => onDownload(option)}
                      >
                        {t(labelKey)}
                      </button>
                    ))}
                  </div>
                )}
              </span>
```

- [ ] **Step 3: 검증** — `npm run lint` 0 · `npm test` PASS · `npm run build` 성공

- [ ] **Step 4: PROGRESS.md 갱신 후 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement
git add frontend/src/components/admin/korean-name-modal.tsx frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(admin): export split-button with 4 target options — 유저 추출 스플릿 버튼 4옵션"
```

---

### Task 5: 브라우저 스모크 (부서 매핑 신규 + 추출 메뉴 확장) + 최종 게이트

**Files:**
- Create: `frontend/scripts/pw-smoke-korean-dept.mjs`
- Modify: `frontend/scripts/pw-smoke-korean-names.mjs` (추출 메뉴 체크 추가)

**Interfaces:**
- Consumes: Task 1~4 전부 — 실서버 e2e.

- [ ] **Step 1: 서버 기동** (턴 경계에 회수되므로 이 태스크 안에서 기동·사용):

```bash
pkill -f "uvicorn app.main:app --port 8001" 2>/dev/null; sleep 1
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement/backend
nohup .venv/bin/uvicorn app.main:app --port 8001 > /private/tmp/claude-501/-Users-hyeonjin-Documents-bpm/13be4761-75fa-46ee-9196-5f78cd845771/scratchpad/backend-8001.log 2>&1 & disown
cd ../frontend
lsof -nP -iTCP:3000 -sTCP:LISTEN || (BACKEND_URL=http://localhost:8001 nohup npm run dev > /private/tmp/claude-501/-Users-hyeonjin-Documents-bpm/13be4761-75fa-46ee-9196-5f78cd845771/scratchpad/frontend-3000.log 2>&1 & disown)
sleep 6
sqlite3 ../backend/dev.db "UPDATE employees SET korean_name='', korean_dept='';"
```

- [ ] **Step 2: 부서 매핑 스모크 작성** — `frontend/scripts/pw-smoke-korean-dept.mjs` 신규:

```js
// 부서 한글명 매핑 스모크 — 부서 탭: korean dept 열/필터/명단 툴팁/더블클릭 매핑 모달 e2e.
// 실행: frontend/ 에서 node scripts/pw-smoke-korean-dept.mjs
// 전제: 워크트리 backend(:8001)+frontend(:3000, BACKEND_URL=8001) 기동.
// 재실행 전제: sqlite3 backend/dev.db "UPDATE employees SET korean_name='', korean_dept='';" 로 리셋.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

// 준비: 2인 이상 부서 하나 골라 두 유저에 서로 다른 korean_dept 시드(임포트 API 경유)
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
const dir = await page.evaluate(async () => {
  const res = await fetch("/api/admin/users", { headers: { "X-Dev-User": "admin.sys" } });
  return res.json();
});
const byPath = new Map();
for (const u of dir.users) {
  const key = u.org_levels.join("/");
  if (!byPath.has(key)) byPath.set(key, []);
  byPath.get(key).push(u);
}
const target = [...byPath.entries()].find(([key, list]) => key && list.length >= 2);
if (!target) {
  console.log("FATAL: no department with 2+ members");
  process.exit(1);
}
const [targetPath, members] = target;
const deptLeaf = targetPath.split("/").at(-1);
await page.evaluate(
  async ({ a, b }) => {
    await fetch("/api/employees/korean-names", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Dev-User": "admin.sys" },
      body: JSON.stringify({
        mode: "overwrite",
        entries: {
          [a]: { name: "김하나", dept: "그룹시안" },
          [b]: { name: "박둘", dept: "그룹구안" },
        },
      }),
    });
  },
  { a: members[0].login_id, b: members[1].login_id },
);
check("seeded divergent korean_dept", true, `dept=${deptLeaf}`);

// ① 부서 탭 진입 — korean dept 열 + 필 2개
await page.getByRole("button", { name: "Departments", exact: true }).click();
await page.waitForSelector('[data-id="dept-needs-filter"]');
check("dept tab + filter", true);
const targetRow = page.locator('[data-id="dept-row"]', { hasText: deptLeaf }).first();
// 필터 켜서 대상 부서로 좁힘(전체 목록에선 25행 청킹 밖일 수 있음)
await page.click('[data-id="dept-needs-filter"]');
await targetRow.waitFor({ timeout: 10000 });
const cellText = await targetRow.locator('[data-id="dept-kr-cell"]').innerText();
check("two korean-dept pills", cellText.includes("그룹시안") && cellText.includes("그룹구안"));

// ② 인원수 호버 → 명단 툴팁(이름 필)
await targetRow.locator(".cursor-help").hover();
await page.waitForSelector('[data-id="dept-roster-tooltip"]');
const roster = await page.locator('[data-id="dept-roster-tooltip"]').innerText();
check("roster tooltip shows names", roster.includes("김하나") || roster.includes(members[0].name));

// ③ 더블클릭 → 모달: 후보 2개 → 선택 → 적용
await targetRow.dblclick();
await page.waitForSelector('[data-id="dept-korean-modal"]');
check("mapping modal candidates", (await page.locator('[data-id="dept-kr-candidate"]').count()) === 2);
await page.locator('[data-id="dept-kr-candidate"]', { hasText: "그룹시안" }).click();
check("candidate fills input", (await page.locator('[data-id="dept-kr-input"]').inputValue()) === "그룹시안");
await page.click('[data-id="dept-kr-apply"]');
await page.waitForSelector('[data-id="dept-kr-result"]');
const resultText = await page.locator('[data-id="dept-kr-result"]').innerText();
check("applied to all members", resultText.includes(String(members.length)), resultText);
await page.click('[data-id="dept-kr-close"]');

// ④ 반영: 해당 행이 단일 필이 되고, 필터 목록에서 사라짐(재조회 후)
await page.waitForTimeout(800);
const stillListed = await page
  .locator('[data-id="dept-row"]', { hasText: deptLeaf })
  .count();
check("resolved dept leaves the needs-filter list", stillListed === 0);

check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
```

주의: Departments 탭 라벨은 en 로케일 기준 — 실제 라벨은 `settings/page.tsx`의 탭 정의(t 키)에서 확인 후 필요 시 셀렉터 조정(실패 시 셀렉터 문제인지 먼저 규명).

- [ ] **Step 3: 기존 스모크에 추출 메뉴 체크 추가** — `pw-smoke-korean-names.mjs`의 ② 다운로드 체크 직후:

```js
// ②-b 추출 옵션 메뉴 — 4옵션 노출 + 전체 목록 다운로드
await page.click('[data-id="kr-export-menu-btn"]');
await page.waitForSelector('[data-id="kr-export-menu"]');
check(
  "export menu shows 4 options",
  (await page.locator('[data-id="kr-export-menu"] button').count()) === 4,
);
const dlAllPromise = page.waitForEvent("download");
await page.click('[data-id="kr-export-opt-all"]');
const dlAll = await dlAllPromise;
const allIds = JSON.parse(fs.readFileSync(await dlAll.path(), "utf8"));
check("all-users export covers directory", Array.isArray(allIds) && allIds.length === rows.length);
```

- [ ] **Step 4: 스모크 실행** — 두 스크립트 모두 전체 PASS까지(재실행 시 Step 1의 sqlite 리셋 먼저). 제품 결함 발견 시 고치지 말고 DONE_WITH_CONCERNS로 보고(스크립트 자체 문제는 스크립트에서 수정).

- [ ] **Step 5: 최종 게이트**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement/backend && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
cd ../frontend && npm run lint && npm test && npm run build
```

- [ ] **Step 6: DB 리셋 + PROGRESS.md 갱신 후 커밋**

```bash
sqlite3 /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement/backend/dev.db "UPDATE employees SET korean_name='', korean_dept='';"
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement
git add frontend/scripts/pw-smoke-korean-dept.mjs frontend/scripts/pw-smoke-korean-names.mjs PROGRESS.md
git commit -m "test(admin): dept korean-mapping smoke + export menu checks — 부서 매핑·추출 메뉴 스모크"
```

---

## 완료 후

- superpowers:finishing-a-development-branch — 사용자와 머지/푸시 결정(직전 패턴: 브랜치 유지 + 원격 푸시).
- 백로그: 부서 매핑 테이블+임포트 자동 정규화, 매핑 해제, org 보기 모드 인원수/툴팁.
