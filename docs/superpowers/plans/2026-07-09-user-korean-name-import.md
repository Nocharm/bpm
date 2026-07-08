# 유저 한글이름 필드 + 일괄 등록 모달 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AD가 제공하지 못하는 한글이름을 `Employee.korean_name` 필드로 추가하고, 어드민 Employees 탭에서 미보유 목록 다운로드 + JSON 임포트(충돌 시 Skip all/Overwrite all)로 일괄 등록한다.

**Architecture:** 백엔드는 컬럼 1개 + `PUT /api/employees/korean-names` 엔드포인트 1개(모드 판정은 서버가 수행). 프론트는 순수 파서/분류 lib(vitest) + 모달 컴포넌트 + Employees 탭 wiring. Export는 클라이언트에서 생성(백엔드 불필요). 스키마 반영은 startup `_add_missing_columns` 자동보강(마이그레이션 없음).

**Tech Stack:** FastAPI + SQLAlchemy(async) + pytest / Next.js + React + vitest + playwright-core 스모크.

**Spec:** `docs/superpowers/specs/2026-07-09-user-korean-name-import-design.md`

## Global Constraints

- 작업 루트(워크트리): `/Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement` — 모든 명령은 이 아래 `backend/`·`frontend/`에서 실행. 메인 체크아웃(`/Users/hyeonjin/Documents/bpm`)은 건드리지 않는다.
- **모든 커밋에 `PROGRESS.md`(워크트리 루트) 갱신을 같은 커밋에 포함** — 최상단 `## 2026-07-09 — 유저 한글이름 필드 + 일괄 등록 모달 설계` 섹션에 한 줄씩 추가.
- 커밋 메시지: `type(scope): English summary — 한국어 요약` + 마지막에
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01GYhJfUnNEGtfRwVwC4UoGv`
- `git add`는 파일 명시(`git add .` 금지).
- Python: 함수 시그니처 타입힌트 필수, `ruff check app/ tests/` 0 에러.
- TS: raw hex 금지(토큰 클래스만), Lucide 16px `strokeWidth={1.5}`, UI 라벨 영어 + i18n en/ko 키 쌍, 주요 요소 `data-id` 부여, `any` 금지.
- React Compiler 함정: setState만 호출하는 트리비얼 핸들러는 `useCallback` 없이 plain function으로. effect 안 동기 setState 금지.
- 백엔드 테스트: `cd backend && .venv/bin/python -m pytest tests/ -q`. 프론트: `cd frontend && npm test`, `npm run lint`.

---

### Task 1: Backend — `korean_name` 컬럼 + `EmployeeOut` 노출 + AD sync 보존

**Files:**
- Modify: `backend/app/models.py` (Employee 클래스, ~line 364)
- Modify: `backend/app/schemas.py` (EmployeeOut, ~line 637)
- Test: `backend/tests/test_korean_names.py` (신규)

**Interfaces:**
- Produces: `Employee.korean_name: str`(기본 `""`), `EmployeeOut.korean_name: str` — GET `/api/employees` 응답에 포함. Task 2·3이 의존.

- [ ] **Step 0: 워크트리 backend venv 준비 (없을 때만)**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement/backend
ls .venv 2>/dev/null || (uv venv .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt)
# uv가 없으면: python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
```

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_korean_names.py` 신규:

```python
"""한글이름(korean_name) 필드·일괄 등록 엔드포인트 테스트 — spec 2026-07-09."""

import asyncio

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import Employee


def _seed(login_id: str, korean_name: str = "") -> None:
    """employees 행 멱등 시드 — korean_name까지 지정."""

    async def _run() -> None:
        async with SessionLocal() as session:
            emp = await session.get(Employee, login_id)
            if emp is None:
                emp = Employee(login_id=login_id, source="local")
                session.add(emp)
            emp.korean_name = korean_name
            await session.commit()

    asyncio.run(_run())


def _korean_name_of(login_id: str) -> str | None:
    async def _run() -> str | None:
        async with SessionLocal() as session:
            emp = await session.get(Employee, login_id)
            return None if emp is None else emp.korean_name

    return asyncio.run(_run())


def test_employees_include_korean_name(client: TestClient) -> None:
    _seed("kr.have", "홍길동")
    res = client.get("/api/employees", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    by_id = {row["login_id"]: row for row in res.json()}
    assert by_id["kr.have"]["korean_name"] == "홍길동"


def test_ad_upsert_preserves_korean_name(client: TestClient) -> None:
    """AD 동기화 upsert가 korean_name을 덮지 않는다 — AD 미제공 필드 회귀 가드."""
    from app.ad.service import EmployeeFields, _upsert

    _seed("kr.sync", "김철수")

    async def _run() -> None:
        fields = EmployeeFields(
            login_id="kr.sync",
            name="CS Kim",
            title="Pro",
            org_l1=None,
            org_l2=None,
            org_l3=None,
            org_l4=None,
            org_l5=None,
            department="TeamA",
            role="user",
            active=True,
            email="",
        )
        async with SessionLocal() as session:
            await _upsert(session, fields)
            await session.commit()

    asyncio.run(_run())
    assert _korean_name_of("kr.sync") == "김철수"
```

- [ ] **Step 2: 실패 확인**

Run: `.venv/bin/python -m pytest tests/test_korean_names.py -q`
Expected: FAIL — `'korean_name' is an invalid keyword argument` 또는 `AttributeError: korean_name` / `KeyError: 'korean_name'`

- [ ] **Step 3: 구현** — `backend/app/models.py` Employee의 `email` 필드 아래(created_at 위)에 추가:

```python
    # 한글이름 — AD 미제공. 어드민 JSON 임포트로만 채운다(spec 2026-07-09). sync 미간섭.
    korean_name: Mapped[str] = mapped_column(String(200), default="")
```

`backend/app/schemas.py` `EmployeeOut`의 `department: str` 아래에 추가:

```python
    korean_name: str
```

참고: `_add_missing_columns`(`app/db.py`)가 metadata 기준으로 기존 테이블에 컬럼을 자동 ALTER 하므로 별도 마이그레이션 없음. `ad/service.py._upsert`는 `EmployeeFields` 고정 필드만 갱신하므로 수정 불필요(Step 1 테스트가 이를 고정).

- [ ] **Step 4: 통과 확인 + 전체 회귀 + 린트**

Run: `.venv/bin/python -m pytest tests/test_korean_names.py -q` → PASS (2 passed)
Run: `.venv/bin/python -m pytest tests/ -q` → 전체 PASS (기존 400여 개 유지)
Run: `.venv/bin/ruff check app/ tests/` → 0 에러

- [ ] **Step 5: PROGRESS.md 한 줄 추가 후 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement
git add backend/app/models.py backend/app/schemas.py backend/tests/test_korean_names.py PROGRESS.md
git commit -m "feat(employees): korean_name column + EmployeeOut exposure — 한글이름 컬럼 추가·AD sync 보존"
```

---

### Task 2: Backend — `PUT /api/employees/korean-names` 임포트 엔드포인트

**Files:**
- Modify: `backend/app/schemas.py` (EmployeeOut 아래)
- Modify: `backend/app/routers/employees.py`
- Test: `backend/tests/test_korean_names.py` (추가)

**Interfaces:**
- Consumes: Task 1의 `Employee.korean_name`.
- Produces: `PUT /api/employees/korean-names` — body `{"mode": "skip"|"overwrite", "entries": {login_id: name}}`, 응답 `{"updated": int, "skipped": int, "unknown": [str]}`. Task 4의 `importKoreanNames()`가 호출.

- [ ] **Step 1: 실패하는 테스트 추가** — `backend/tests/test_korean_names.py`에 append. import 블록에 `from collections.abc import Iterator`, `import pytest`, `from app.settings import settings` 추가:

```python
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


def test_import_skip_mode_and_unknown(client: TestClient) -> None:
    _seed("kr.empty1", "")
    _seed("kr.taken", "기존이름")
    res = client.put(
        "/api/employees/korean-names",
        headers={"X-Dev-User": "admin.kim"},
        json={
            "mode": "skip",
            "entries": {"kr.empty1": " 신규이름 ", "kr.taken": "새이름", "kr.ghost": "유령"},
        },
    )
    assert res.status_code == 200
    assert res.json() == {"updated": 1, "skipped": 1, "unknown": ["kr.ghost"]}
    assert _korean_name_of("kr.empty1") == "신규이름"  # trim 적용
    assert _korean_name_of("kr.taken") == "기존이름"  # skip — 기존 값 유지


def test_import_overwrite_mode(client: TestClient) -> None:
    _seed("kr.taken2", "기존이름")
    res = client.put(
        "/api/employees/korean-names",
        headers={"X-Dev-User": "admin.kim"},
        json={"mode": "overwrite", "entries": {"kr.taken2": "새이름"}},
    )
    assert res.status_code == 200
    assert res.json() == {"updated": 1, "skipped": 0, "unknown": []}
    assert _korean_name_of("kr.taken2") == "새이름"


def test_import_ignores_blank_values(client: TestClient) -> None:
    _seed("kr.blank", "기존")
    res = client.put(
        "/api/employees/korean-names",
        headers={"X-Dev-User": "admin.kim"},
        json={"mode": "overwrite", "entries": {"kr.blank": "   "}},
    )
    assert res.status_code == 200
    assert res.json() == {"updated": 0, "skipped": 0, "unknown": []}
    assert _korean_name_of("kr.blank") == "기존"  # 빈 값은 삭제가 아니라 무시


def test_import_rejects_bad_mode(client: TestClient) -> None:
    res = client.put(
        "/api/employees/korean-names",
        headers={"X-Dev-User": "admin.kim"},
        json={"mode": "merge", "entries": {}},
    )
    assert res.status_code == 422


def test_import_requires_sysadmin(client: TestClient, sysadmin_enforced: None) -> None:
    res = client.put(
        "/api/employees/korean-names",
        headers={"X-Dev-User": "user.lee"},
        json={"mode": "skip", "entries": {}},
    )
    assert res.status_code == 403
```

- [ ] **Step 2: 실패 확인**

Run: `.venv/bin/python -m pytest tests/test_korean_names.py -q`
Expected: 신규 5개 FAIL — `405 Method Not Allowed`(라우트 없음), 기존 2개 PASS

- [ ] **Step 3: 구현** — `backend/app/schemas.py`의 `EmployeeOut` 아래에 추가(파일 상단 import에 `Literal`이 없으면 `from typing import Literal` 추가 — 기존 import 그룹 관례 유지):

```python
class KoreanNamesImportIn(BaseModel):
    """한글이름 일괄 등록 — mode: skip(기존 값 보유 유저 건너뜀) | overwrite(덮어씀)."""

    mode: Literal["skip", "overwrite"]
    entries: dict[str, str]


class KoreanNamesImportOut(BaseModel):
    updated: int
    skipped: int
    unknown: list[str]
```

`backend/app/routers/employees.py` — import에 `KoreanNamesImportIn, KoreanNamesImportOut` 추가, 파일 끝에:

```python
@router.put("/korean-names", response_model=KoreanNamesImportOut)
async def import_korean_names(
    payload: KoreanNamesImportIn,
    _: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> KoreanNamesImportOut:
    """한글이름 일괄 등록 — AD 미제공 필드. 서버가 mode 판정(클라이언트 diff 미신뢰)."""
    updated = 0
    skipped = 0
    unknown: list[str] = []
    for login_id, raw_name in payload.entries.items():
        name = raw_name.strip()
        if not name:
            continue  # 빈 값은 이름 삭제가 아니라 미기입 — 무시
        emp = await session.get(Employee, login_id)
        if emp is None:
            unknown.append(login_id)
            continue
        if emp.korean_name and payload.mode == "skip":
            skipped += 1
            continue
        emp.korean_name = name
        updated += 1
    await session.commit()
    return KoreanNamesImportOut(updated=updated, skipped=skipped, unknown=unknown)
```

- [ ] **Step 4: 통과 확인 + 린트**

Run: `.venv/bin/python -m pytest tests/test_korean_names.py -q` → 7 passed
Run: `.venv/bin/python -m pytest tests/ -q` → 전체 PASS
Run: `.venv/bin/ruff check app/ tests/` → 0 에러

- [ ] **Step 5: PROGRESS.md 갱신 후 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement
git add backend/app/schemas.py backend/app/routers/employees.py backend/tests/test_korean_names.py PROGRESS.md
git commit -m "feat(employees): PUT /korean-names bulk import (skip/overwrite) — 한글이름 일괄 등록 API"
```

---

### Task 3: Frontend lib — JSON 파서·분류·다운로드 생성 (vitest)

**Files:**
- Modify: `frontend/src/lib/api.ts` (`EmployeeRow`, ~line 497)
- Create: `frontend/src/lib/korean-name-import.ts`
- Test: `frontend/src/lib/korean-name-import.test.ts`

**Interfaces:**
- Consumes: `EmployeeRow`(api.ts).
- Produces (Task 4가 사용):
  - `parseKoreanNamesJson(text: string): { entries: Record<string, string> } | { error: string }`
  - `classifyKoreanNames(entries: Record<string, string>, rows: EmployeeRow[]): KoreanNameClassification` — `{ fresh, conflicts: KoreanNameConflict[], unknownIds, entries }`
  - `buildMissingIdsJson(rows: EmployeeRow[]): string`
  - `interface KoreanNameConflict { loginId: string; current: string; next: string }`

- [ ] **Step 1: `EmployeeRow`에 필드 추가** — `frontend/src/lib/api.ts`의 `EmployeeRow`에 `department: string;` 아래:

```ts
  korean_name: string;
```

- [ ] **Step 2: 실패하는 테스트 작성** — `frontend/src/lib/korean-name-import.test.ts` 신규:

```ts
import { describe, expect, it } from "vitest";

import type { EmployeeRow } from "./api";
import {
  buildMissingIdsJson,
  classifyKoreanNames,
  parseKoreanNamesJson,
} from "./korean-name-import";

const row = (login_id: string, korean_name: string): EmployeeRow => ({
  login_id,
  name: "",
  title: "",
  source: "ad",
  role: "user",
  department: "",
  korean_name,
});

describe("parseKoreanNamesJson", () => {
  it("parses object map, trims values, drops blanks", () => {
    const res = parseKoreanNamesJson('{"a.b": " 홍길동 ", "c.d": "  ", "e.f": "김철수"}');
    expect(res).toEqual({ entries: { "a.b": "홍길동", "e.f": "김철수" } });
  });

  it("rejects invalid JSON", () => {
    expect(parseKoreanNamesJson("{oops")).toHaveProperty("error");
  });

  it("rejects arrays and non-objects", () => {
    expect(parseKoreanNamesJson('["a.b"]')).toHaveProperty("error");
    expect(parseKoreanNamesJson('"str"')).toHaveProperty("error");
    expect(parseKoreanNamesJson("null")).toHaveProperty("error");
  });

  it("rejects non-string values with the offending key", () => {
    const res = parseKoreanNamesJson('{"a.b": 3}');
    expect("error" in res && res.error).toContain("a.b");
  });
});

describe("classifyKoreanNames", () => {
  it("splits fresh / conflicts / unknown", () => {
    const rows = [row("new.user", ""), row("has.name", "기존이름")];
    const res = classifyKoreanNames(
      { "new.user": "신규", "has.name": "교체", "no.user": "유령" },
      rows,
    );
    expect(res.fresh).toEqual({ "new.user": "신규" });
    expect(res.conflicts).toEqual([
      { loginId: "has.name", current: "기존이름", next: "교체" },
    ]);
    expect(res.unknownIds).toEqual(["no.user"]);
    expect(res.entries).toEqual({ "new.user": "신규", "has.name": "교체", "no.user": "유령" });
  });
});

describe("buildMissingIdsJson", () => {
  it("lists only ids without korean_name as a JSON array", () => {
    const rows = [row("miss.one", ""), row("has.one", "홍길동"), row("miss.two", "")];
    expect(JSON.parse(buildMissingIdsJson(rows))).toEqual(["miss.one", "miss.two"]);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement/frontend && npm test`
Expected: FAIL — `Cannot find module './korean-name-import'` (기존 테스트는 PASS 유지)

- [ ] **Step 4: 구현** — `frontend/src/lib/korean-name-import.ts` 신규:

```ts
// 한글이름 JSON 임포트 파서·분류 — 어드민 일괄 등록 모달용(순수 함수, DOM/fetch 없음).
// 설계: docs/superpowers/specs/2026-07-09-user-korean-name-import-design.md

import type { EmployeeRow } from "./api";

export interface KoreanNameConflict {
  loginId: string;
  current: string;
  next: string;
}

export interface KoreanNameClassification {
  /** 기존 값 없는 유저 — 확인 없이 적용 가능 */
  fresh: Record<string, string>;
  /** 기존 값 보유 유저 — skip/overwrite 선택 대상 */
  conflicts: KoreanNameConflict[];
  /** employees에 없는 login_id — 서버도 unknown으로 재보고 */
  unknownIds: string[];
  /** trim·빈값 제거 후 전체 항목 — PUT payload 그대로 */
  entries: Record<string, string>;
}

export function parseKoreanNamesJson(
  text: string,
): { entries: Record<string, string> } | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "Invalid JSON file." };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { error: 'Expected an object map: { "login_id": "korean name" }.' };
  }
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== "string") {
      return { error: `Value for "${key}" must be a string.` };
    }
    const name = value.trim();
    if (!name) continue; // 빈 값은 이름 삭제가 아니라 미기입 — 무시
    entries[key.trim()] = name;
  }
  return { entries };
}

export function classifyKoreanNames(
  entries: Record<string, string>,
  rows: EmployeeRow[],
): KoreanNameClassification {
  const byId = new Map(rows.map((r) => [r.login_id, r]));
  const fresh: Record<string, string> = {};
  const conflicts: KoreanNameConflict[] = [];
  const unknownIds: string[] = [];
  for (const [loginId, next] of Object.entries(entries)) {
    const match = byId.get(loginId);
    if (!match) {
      unknownIds.push(loginId);
    } else if (match.korean_name) {
      conflicts.push({ loginId, current: match.korean_name, next });
    } else {
      fresh[loginId] = next;
    }
  }
  return { fresh, conflicts, unknownIds, entries };
}

export function buildMissingIdsJson(rows: EmployeeRow[]): string {
  const ids = rows.filter((r) => !r.korean_name).map((r) => r.login_id);
  return JSON.stringify(ids, null, 2);
}
```

- [ ] **Step 5: 통과 확인 + 린트**

Run: `npm test` → 전체 PASS (신규 7개 포함)
Run: `npm run lint` → 0 에러 (기존 warning 1건 무시)

- [ ] **Step 6: PROGRESS.md 갱신 후 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement
git add frontend/src/lib/api.ts frontend/src/lib/korean-name-import.ts frontend/src/lib/korean-name-import.test.ts PROGRESS.md
git commit -m "feat(admin): korean-name import parser/classifier lib — 한글이름 임포트 파서·분류 lib"
```

---

### Task 4: Frontend — API 클라이언트 + i18n 키 + 모달 컴포넌트

**Files:**
- Modify: `frontend/src/lib/api.ts` (`syncEmployees` 아래, ~line 519)
- Modify: `frontend/src/lib/i18n-messages.ts` (en `"admin.syncing"` ~line 857 아래 / ko `"admin.syncing"` ~line 2072 아래)
- Create: `frontend/src/components/admin/korean-name-modal.tsx`

**Interfaces:**
- Consumes: Task 3의 `parseKoreanNamesJson`/`classifyKoreanNames`/`buildMissingIdsJson`/`KoreanNameConflict`, Task 2의 PUT 엔드포인트.
- Produces: `importKoreanNames(mode, entries): Promise<KoreanNamesImportSummary>`(api.ts), `<KoreanNameModal rows onClose onApplied />` — Task 5가 마운트.

- [ ] **Step 1: api.ts에 임포트 함수 추가** — `syncEmployees` 아래:

```ts
export interface KoreanNamesImportSummary {
  updated: number;
  skipped: number;
  unknown: string[];
}

export function importKoreanNames(
  mode: "skip" | "overwrite",
  entries: Record<string, string>,
): Promise<KoreanNamesImportSummary> {
  return request<KoreanNamesImportSummary>("/employees/korean-names", {
    method: "PUT",
    body: JSON.stringify({ mode, entries }),
  });
}
```

- [ ] **Step 2: i18n 키 추가** — `frontend/src/lib/i18n-messages.ts`.

en 블록 `"admin.syncing": "Syncing…",` 아래:

```ts
  "admin.krAdd": "Add Korean Names",
  "admin.krTitle": "Add Korean names",
  "admin.krHint": "AD does not provide Korean names. Download the missing list, fill in names, then import the JSON file.",
  "admin.krSchema": "Import file format (JSON)",
  "admin.krDownload": "Download missing list",
  "admin.krImport": "Import JSON",
  "admin.krConflictUsers": "{n} users",
  "admin.krConflictRest": "already have Korean names.",
  "admin.krSkipAll": "Skip all",
  "admin.krOverwriteAll": "Overwrite all",
  "admin.krUpdated": "Updated",
  "admin.krSkipped": "Skipped",
  "admin.krUnknown": "Unknown ids",
  "admin.krClose": "Close",
```

ko 블록 `"admin.syncing": "동기화 중…",` 아래:

```ts
  "admin.krAdd": "한글이름 추가",
  "admin.krTitle": "한글이름 추가",
  "admin.krHint": "AD는 한글이름을 제공하지 않습니다. 미보유 목록을 내려받아 이름을 채운 뒤 JSON 파일로 임포트하세요.",
  "admin.krSchema": "임포트 파일 형식 (JSON)",
  "admin.krDownload": "미보유 목록 다운로드",
  "admin.krImport": "JSON 임포트",
  "admin.krConflictUsers": "{n}명 유저",
  "admin.krConflictRest": "의 한글이름이 이미 등록되어 있습니다.",
  "admin.krSkipAll": "모두 넘어가기",
  "admin.krOverwriteAll": "모두 덮어쓰기",
  "admin.krUpdated": "갱신",
  "admin.krSkipped": "건너뜀",
  "admin.krUnknown": "미존재 id",
  "admin.krClose": "닫기",
```

- [ ] **Step 3: 모달 컴포넌트 작성** — `frontend/src/components/admin/korean-name-modal.tsx` 신규:

```tsx
"use client";

// 한글이름 일괄 등록 모달 — 미보유 목록 다운로드 + JSON 임포트(충돌 시 skip/overwrite 확인).
// 설계: docs/superpowers/specs/2026-07-09-user-korean-name-import-design.md

import { FileDown, FileUp, Languages, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";

import {
  importKoreanNames,
  type EmployeeRow,
  type KoreanNamesImportSummary,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  buildMissingIdsJson,
  classifyKoreanNames,
  parseKoreanNamesJson,
  type KoreanNameClassification,
  type KoreanNameConflict,
} from "@/lib/korean-name-import";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";

const BTN_SECONDARY =
  "flex items-center gap-1.5 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";
const BTN_ACCENT =
  "flex items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus disabled:opacity-40";

interface KoreanNameModalProps {
  rows: EmployeeRow[];
  onClose: () => void;
  /** 적용 성공 후 직원 목록 재조회 */
  onApplied: () => void;
}

type Phase = "idle" | "confirm" | "result";

/** "N users" 호버 시 충돌 목록 툴팁 — 25행 청킹 무한스크롤(직원 ~5000명 대비). */
function ConflictHover({ conflicts }: { conflicts: KoreanNameConflict[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { visible, hasMore, sentinelRef } = useInfiniteSlice(conflicts, "");
  return (
    <span
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="cursor-help font-semibold text-accent underline decoration-dotted">
        {t("admin.krConflictUsers", { n: conflicts.length })}
      </span>
      {open && (
        <div
          data-id="kr-conflict-tooltip"
          className="absolute left-0 top-full z-10 mt-1 max-h-64 w-80 overflow-y-auto rounded-md border border-hairline bg-surface p-2 shadow-lg"
        >
          {visible.map((c) => (
            <div key={c.loginId} className="flex items-baseline gap-2 px-1 py-0.5 text-fine">
              <span className="shrink-0 text-ink-secondary">{c.loginId}</span>
              <span className="truncate text-ink-tertiary">{c.current}</span>
              <span className="shrink-0 text-ink-tertiary">→</span>
              <span className="truncate text-ink">{c.next}</span>
            </div>
          ))}
          {hasMore && <div ref={sentinelRef} className="h-4" />}
        </div>
      )}
    </span>
  );
}

export function KoreanNameModal({ rows, onClose, onApplied }: KoreanNameModalProps) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [classification, setClassification] = useState<KoreanNameClassification | null>(null);
  const [summary, setSummary] = useState<KoreanNamesImportSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onDownload = () => {
    const blob = new Blob([buildMissingIdsJson(rows)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "korean-names-missing.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const applyImport = async (mode: "skip" | "overwrite", cls: KoreanNameClassification) => {
    setBusy(true);
    setError("");
    try {
      setSummary(await importKoreanNames(mode, cls.entries));
      setPhase("result");
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "import failed");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    setError("");
    const parsed = parseKoreanNamesJson(await file.text());
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    const cls = classifyKoreanNames(parsed.entries, rows);
    setClassification(cls);
    if (cls.conflicts.length > 0) {
      setPhase("confirm");
    } else {
      await applyImport("skip", cls); // 충돌 0 — 확인 없이 바로 적용(모드 무의미)
    }
  };

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm">
      <div
        data-id="korean-name-modal"
        className="flex w-full max-w-md flex-col gap-3 rounded-md bg-surface p-6 shadow-lg"
      >
        <div className="flex items-center gap-2">
          <Languages size={16} strokeWidth={1.5} className="text-accent" />
          <h2 className="text-body-strong text-ink">{t("admin.krTitle")}</h2>
        </div>

        {phase === "idle" && (
          <>
            <p className="text-caption text-ink-tertiary">{t("admin.krHint")}</p>
            <div className="rounded-sm bg-surface-alt p-3">
              <p className="pb-1 text-fine uppercase tracking-wide text-ink-tertiary">
                {t("admin.krSchema")}
              </p>
              <pre className="overflow-x-auto text-fine text-ink-secondary">{`{
  "hong.gd": "홍길동",
  "kim.cs": "김철수"
}`}</pre>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" data-id="kr-download-btn" className={BTN_SECONDARY} onClick={onDownload}>
                <FileDown size={16} strokeWidth={1.5} />
                {t("admin.krDownload")}
              </button>
              <button
                type="button"
                data-id="kr-import-btn"
                className={BTN_ACCENT}
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <FileUp size={16} strokeWidth={1.5} />
                {t("admin.krImport")}
              </button>
              <input
                ref={fileRef}
                data-id="kr-file-input"
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ""; // 같은 파일 재선택 허용
                  if (file) void onFile(file);
                }}
              />
            </div>
          </>
        )}

        {phase === "confirm" && classification && (
          <div className="flex flex-col gap-3" data-id="kr-conflict-step">
            <div className="flex items-start gap-2 rounded-sm bg-surface-alt p-3">
              <TriangleAlert size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-error" />
              <p className="text-caption text-ink">
                <ConflictHover conflicts={classification.conflicts} />{" "}
                {t("admin.krConflictRest")}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className={BTN_SECONDARY} onClick={() => setPhase("idle")}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                data-id="kr-skip-all"
                className={BTN_SECONDARY}
                disabled={busy}
                onClick={() => void applyImport("skip", classification)}
              >
                {t("admin.krSkipAll")}
              </button>
              <button
                type="button"
                data-id="kr-overwrite-all"
                className={BTN_ACCENT}
                disabled={busy}
                onClick={() => void applyImport("overwrite", classification)}
              >
                {t("admin.krOverwriteAll")}
              </button>
            </div>
          </div>
        )}

        {phase === "result" && summary && (
          <div className="flex flex-col gap-2" data-id="kr-result">
            <div className="rounded-sm bg-surface-alt p-3 text-caption text-ink">
              <p>
                {t("admin.krUpdated")}: {summary.updated} · {t("admin.krSkipped")}: {summary.skipped}
              </p>
              {summary.unknown.length > 0 && (
                <div className="pt-1">
                  <p className="text-caption text-error">
                    {t("admin.krUnknown")} ({summary.unknown.length})
                  </p>
                  <div className="max-h-32 overflow-y-auto pt-1 text-fine text-ink-tertiary">
                    {summary.unknown.map((id) => (
                      <p key={id}>{id}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {error && <p className="text-caption text-error">{error}</p>}

        {phase !== "confirm" && (
          <div className="flex justify-end border-t border-hairline pt-3">
            <button type="button" data-id="kr-close-btn" className={BTN_SECONDARY} onClick={onClose}>
              {phase === "result" ? t("admin.krClose") : t("common.cancel")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 컴파일·린트·기존 테스트 확인**

Run: `npm run lint` → 0 에러
Run: `npm test` → 전체 PASS
주의: `react-hooks/preserve-manual-memoization` 에러가 나면 해당 핸들러의 `useCallback`을 제거하고 plain function으로(이 코드엔 useCallback 없음 — 추가하지 말 것).

- [ ] **Step 5: PROGRESS.md 갱신 후 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement
git add frontend/src/lib/api.ts frontend/src/lib/i18n-messages.ts frontend/src/components/admin/korean-name-modal.tsx PROGRESS.md
git commit -m "feat(admin): korean-name bulk add modal (download/import/conflict) — 한글이름 일괄 등록 모달"
```

---

### Task 5: Frontend — Employees 탭 wiring (열 + 버튼 + 모달 마운트)

**Files:**
- Modify: `frontend/src/components/admin/employee-table.tsx`

**Interfaces:**
- Consumes: Task 4의 `KoreanNameModal`, Task 3의 `EmployeeRow.korean_name`.
- Produces: Employees 탭 최종 UI — 스모크(Task 6)가 검증.

- [ ] **Step 1: 테이블·버튼·모달 wiring** — `employee-table.tsx` 수정:

import 추가:

```tsx
import { KoreanNameModal } from "./korean-name-modal";
```

state 추가(`const [msg, setMsg] = useState("");` 아래):

```tsx
  const [showKrModal, setShowKrModal] = useState(false);
```

기존 `useEffect`·`onSync`는 건드리지 않는다(surgical). 헤더 우측 버튼 영역 — 기존 sync 버튼을 `flex gap-2`로 감싸고 왼쪽에 추가:

```tsx
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-id="kr-add-btn"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
            onClick={() => setShowKrModal(true)}
          >
            {t("admin.krAdd")}
          </button>
          <button
            type="button"
            className="rounded-sm bg-accent px-3 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={() => void onSync()}
            disabled={busy}
          >
            {busy ? t("admin.syncing") : t("admin.sync")}
          </button>
        </div>
```

테이블 — `<th>name</th>` 아래에 `<th className={ADMIN_TH}>korean name</th>`, 본문 `{r.name}` 셀 아래에:

```tsx
              <td className={ADMIN_TD}>{r.korean_name}</td>
```

센티널 행 `colSpan={6}` → `colSpan={7}`.

컴포넌트 return 마지막(닫는 `</div>` 직전)에 모달 마운트:

```tsx
      {showKrModal && (
        <KoreanNameModal
          rows={rows}
          onClose={() => setShowKrModal(false)}
          onApplied={() => void listEmployees().then(setRows).catch(() => setRows([]))}
        />
      )}
```

- [ ] **Step 2: 린트·테스트·빌드**

Run: `npm run lint` → 0 에러
Run: `npm test` → 전체 PASS
Run: `npm run build` → 성공

- [ ] **Step 3: PROGRESS.md 갱신 후 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement
git add frontend/src/components/admin/employee-table.tsx PROGRESS.md
git commit -m "feat(admin): korean name column + add button on Employees tab — 직원 탭 한글이름 열·추가 버튼"
```

---

### Task 6: 브라우저 스모크 검증 (워크트리 백엔드 기동 포함)

**Files:**
- Create: `frontend/scripts/pw-smoke-korean-names.mjs`

**Interfaces:**
- Consumes: Task 1~5 전부 — 실 서버·실 브라우저로 end-to-end 검증.

- [ ] **Step 1: 워크트리 서버 기동** — 메인 체크아웃 백엔드(:8000)는 두고, 워크트리 백엔드를 **:8001**에 별도 기동. 워크트리 `backend/`에 `.env`가 없으므로 기본값(auth OFF·enforce OFF — 전원 sysadmin, 신규 sqlite `dev.db`에 로컬 유저 5명 자동 시드)으로 뜬다:

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement/backend
.venv/bin/uvicorn app.main:app --port 8001   # 백그라운드로
```

프론트 dev 서버(:3000)는 프록시 대상 변경이 필요하므로 **기존 프로세스를 중지 후 재기동**(3000 점유 좀비 확인 — `lsof -nP -iTCP:3000 -sTCP:LISTEN`):

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement/frontend
BACKEND_URL=http://localhost:8001 npm run dev   # 백그라운드로
```

확인: `curl -s localhost:3000/api/employees -H "X-Dev-User: admin.sys" | head -c 200` → JSON 배열(각 행에 `korean_name` 포함).

- [ ] **Step 2: 스모크 스크립트 작성** — `frontend/scripts/pw-smoke-korean-names.mjs` 신규:

```js
// 한글이름 일괄 등록 스모크 — Employees 탭→모달→다운로드→임포트(신규/충돌 skip/overwrite)→테이블 반영.
// 실행: frontend/ 에서 node scripts/pw-smoke-korean-names.mjs
// 전제: 워크트리 backend(:8001, 새 dev.db)+frontend(:3000, BACKEND_URL=8001) 기동. playwright-core+시스템 Chrome.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en"); // 기본 ko — 탭 라벨 "Employees" 고정용
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

// ① Employees 탭 진입 + 버튼/열 노출
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "Employees", exact: true }).click();
await page.waitForSelector('[data-id="kr-add-btn"]', { timeout: 15000 });
check("employees tab + kr-add button", true);
check("korean name column", await page.locator("th", { hasText: "korean name" }).count() === 1);

// 대상 유저 2명 확보(시드 로컬 유저)
const rows = await page.evaluate(async () => {
  const res = await fetch("/api/employees", { headers: { "X-Dev-User": "admin.sys" } });
  return res.json();
});
const [u1, u2] = rows.map((r) => r.login_id);
check("employees seeded", Boolean(u1 && u2), `u1=${u1} u2=${u2}`);

// ② 모달 + 미보유 목록 다운로드
await page.click('[data-id="kr-add-btn"]');
await page.waitForSelector('[data-id="korean-name-modal"]');
const dlPromise = page.waitForEvent("download");
await page.click('[data-id="kr-download-btn"]');
const download = await dlPromise;
const ids = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
check("download is id array incl. targets", Array.isArray(ids) && ids.includes(u1) && ids.includes(u2));

// ③ 1차 임포트 — 충돌 없음 → 즉시 결과(updated 2, unknown 1)
const tmp1 = path.join(os.tmpdir(), "kr-import-1.json");
fs.writeFileSync(tmp1, JSON.stringify({ [u1]: "홍길동", [u2]: "김철수", "no.such.user": "유령" }));
await page.setInputFiles('[data-id="kr-file-input"]', tmp1);
await page.waitForSelector('[data-id="kr-result"]');
const result1 = await page.locator('[data-id="kr-result"]').innerText();
check("first import applied", result1.includes("2") && result1.includes("no.such.user"), result1.replace(/\n/g, " "));
await page.click('[data-id="kr-close-btn"]');
check("table shows imported name", await page.locator("td", { hasText: "홍길동" }).count() >= 1);

// ④ 2차 임포트 — 충돌 → 툴팁 확인 → Skip all(값 유지)
const tmp2 = path.join(os.tmpdir(), "kr-import-2.json");
fs.writeFileSync(tmp2, JSON.stringify({ [u1]: "새이름" }));
await page.click('[data-id="kr-add-btn"]');
await page.setInputFiles('[data-id="kr-file-input"]', tmp2);
await page.waitForSelector('[data-id="kr-conflict-step"]');
check("conflict step shows 1 users", (await page.locator('[data-id="kr-conflict-step"]').innerText()).includes("1"));
await page.hover('[data-id="kr-conflict-step"] .cursor-help');
await page.waitForSelector('[data-id="kr-conflict-tooltip"]');
const tip = await page.locator('[data-id="kr-conflict-tooltip"]').innerText();
check("tooltip lists current → next", tip.includes(u1) && tip.includes("홍길동") && tip.includes("새이름"));
await page.click('[data-id="kr-skip-all"]');
await page.waitForSelector('[data-id="kr-result"]');
check("skip keeps value", (await page.locator('[data-id="kr-result"]').innerText()).includes("0"));
await page.click('[data-id="kr-close-btn"]');
check("table keeps old name", await page.locator("td", { hasText: "홍길동" }).count() >= 1);

// ⑤ 3차 임포트 — Overwrite all(값 교체)
await page.click('[data-id="kr-add-btn"]');
await page.setInputFiles('[data-id="kr-file-input"]', tmp2);
await page.waitForSelector('[data-id="kr-conflict-step"]');
await page.click('[data-id="kr-overwrite-all"]');
await page.waitForSelector('[data-id="kr-result"]');
await page.click('[data-id="kr-close-btn"]');
await page.waitForTimeout(500);
check("overwrite replaces value", await page.locator("td", { hasText: "새이름" }).count() >= 1);

check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 3: 스모크 실행**

Run: `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement/frontend && node scripts/pw-smoke-korean-names.mjs`
Expected: 전체 PASS (`N/N passed`, exit 0). 실패 시 systematic-debugging으로 원인 규명 후 수정(스크립트 셀렉터 문제인지 코드 결함인지 구분).

- [ ] **Step 4: 최종 게이트**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement/backend && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
cd ../frontend && npm run lint && npm test && npm run build
```
Expected: 전부 통과.

- [ ] **Step 5: PROGRESS.md 갱신 후 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement
git add frontend/scripts/pw-smoke-korean-names.mjs PROGRESS.md
git commit -m "test(admin): korean-name import browser smoke — 한글이름 임포트 스모크"
```

---

## 완료 후

- 스모크용으로 띄운 워크트리 백엔드(:8001)는 유지(후속 검토용), 프론트(:3000)도 유지.
- superpowers:finishing-a-development-branch 로 머지/PR 여부는 사용자와 결정.
- 후속 백로그(스펙 Out of scope): export 빈 맵 왕복, CSV, 타 화면 한글이름 노출.
