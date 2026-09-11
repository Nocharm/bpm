# Catalog Aliases + Node Rest/Active Display Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 카탈로그 항목에 별칭을 붙여 검색·입력을 정식 표기로 치환하고, 캔버스 노드의 담당자/시스템 줄을 휴식(역할·정식명)↔활성(담당자·원문 메모)으로 1초 뒤 페이드 전환하며, 노드 내 역할 칩을 흑백 톤으로 바꾼다.

**Architecture:** 카탈로그 항목이 `str`에서 `{value, aliases[]}`로 바뀐다(백엔드 정규화가 "별칭 하나→값 하나" 불변식을 강제, 레거시 문자열은 읽기 승격). 프론트는 `CatalogEntry`를 `SuggestInput`까지 그대로 흘리고, 정규화 순수 함수(`normalizeToCatalog`·`commitSystem`)가 별칭을 값으로 접는다. 노드 전환은 `NodeFields`에 `active` prop(호버∨선택)과 단일 지연 상수 `NODE_ALT_DELAY_MS`로 구현하고, 두 표기를 겹쳐 놓고 opacity 교차 페이드한다.

**Tech Stack:** FastAPI + Pydantic v2 (py3.11) / Next.js + React 19 + TypeScript / vitest / pytest / Playwright(playwright-core + 시스템 Chrome)

**Spec:** `docs/design/2026-09-12-catalog-alias-node-swap-design.md` (전작 계약: `docs/design/2026-09-11-assignee-role-catalog-design.md`)

## Global Constraints

- Python 3.11 문법까지만. TypeScript `any` 금지·`interface`·named export. 토큰 색만, 굵기 300/400/600.
- i18n은 en 권위 + ko 동일 키 강제(`frontend/src/lib/i18n-messages.ts`).
- 오버레이 z: 자동완성 드롭다운 1400. 컴포넌트 머리 주석 1줄. 컴포넌트 추가·사용처 변경 시 `node scripts/build-component-catalog.mjs`.
- `frontend/src/app/maps/[mapId]/page.tsx`·`process-node.tsx`는 큰 파일 — 인용된 코드로 위치를 찾고 수술적으로 편집. ugrep은 대괄호 디렉터리를 건너뛰니 page.tsx는 경로를 명시.
- React Compiler 린트: `useCallback` 의존성 드리프트 금지, effect 안 동기 setState 금지(타이머 콜백·render-time adjust 사용).
- 지연 상수 이름 **`NODE_ALT_DELAY_MS`**(값 1000, `frontend/src/lib/canvas.ts`) — 다른 곳에 숫자 리터럴 금지.
- `Other`는 systems 예약 값: 값 잠금·별칭 허용·읽기 시 항상 0번.
- 커밋: `type(scope): English summary — 한국어 요약` + 트레일러 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01Cp6z7UQxkS4JyPnK2oo8Q2`, `PROGRESS.md` 1~3줄 동반. 브랜치 `dev` 직접 커밋, 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/dev`.
- 게이트: backend `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` + `.venv/bin/ruff check app/ tests/`; frontend `npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run lint && node scripts/build-component-catalog.mjs --check`.

---

## File Structure

**Backend (modify)**: `backend/app/app_settings.py`(엔트리 정규화·getter/setter), `backend/app/routers/app_settings.py`(PUT 처리), `backend/app/routers/catalogs.py`(응답형), `backend/app/schemas.py`(`CatalogEntryIn/Out`·`CatalogsOut`·`AppSettingsOut/Update`), `backend/tests/test_app_settings.py`.

**Frontend (modify)**: `src/lib/api.ts`, `src/lib/catalogs.ts`(+test), `src/lib/catalog-csv.ts`(+test), `src/components/suggest-input.tsx`, `src/components/system-suggest-input.tsx`, `src/components/permissions/role-tile.tsx`, `src/components/bpm-attribute-picker.tsx`, `src/components/settings/catalogs-panel.tsx`, `src/components/role-chip.tsx`, `src/components/process-node.tsx`, `src/lib/canvas.ts`, `src/lib/i18n-messages.ts`, `scripts/pw-smoke-assignee-role.mjs`, `COMPONENTS.md`(생성).

---

### Task 1: 백엔드 — 카탈로그 엔트리(값+별칭) 모델·정규화·API

**Files:**
- Modify: `backend/app/app_settings.py`(`normalize_managed_list` 아래에 엔트리 헬퍼 추가; `get_assignee_roles`·`ensure_other_first`·`get_systems` 교체)
- Modify: `backend/app/schemas.py`(`AppSettingsOut`·`AppSettingsUpdate`·`CatalogsOut` + 새 `CatalogEntryIn`/`CatalogEntryOut`)
- Modify: `backend/app/routers/app_settings.py`(`put_app_settings`의 `assignee_roles`/`systems` 분기)
- Modify: `backend/app/routers/catalogs.py`(변경 없음일 수도 — `get_*`가 엔트리 dict를 돌려주면 `CatalogsOut`이 검증)
- Test: `backend/tests/test_app_settings.py`

**Interfaces:**
- Produces: `normalize_managed_entries(values: list[object]) -> list[dict[str, object]]`(각 `{"value": str, "aliases": list[str]}`), `get_managed_entries(session, key) -> list[dict]`, `set_managed_entries(session, key, values, user) -> list[dict]`, `get_assignee_roles(session) -> list[dict]`, `get_systems(session) -> list[dict]`(Other 0번), `ensure_other_first(entries) -> list[dict]`.
- Produces: `CatalogEntryIn {value: str(1..100), aliases: list[str] (≤20)}`, `CatalogEntryOut {value, aliases}`; `AppSettingsUpdate.assignee_roles/systems: list[CatalogEntryIn | str] | None`; `AppSettingsOut.assignee_roles/systems: list[CatalogEntryOut]`; `CatalogsOut` 동일.

- [ ] **Step 1: 기존 테스트를 엔트리 형태로 갱신 + 새 테스트** — `backend/tests/test_app_settings.py`

`test_catalogs_default_has_other_only`의 단언을 교체:
```python
    assert body["assignee_roles"] == []
    assert body["systems"] == [{"value": "Other", "aliases": []}]
```
`test_app_settings_managed_lists_roundtrip` 전체를 교체:
```python
def test_app_settings_managed_lists_roundtrip(client: TestClient) -> None:
    body = client.put(
        "/api/admin/app-settings",
        json={
            # 문자열(구 클라이언트)과 엔트리가 섞여도 전부 엔트리로 승격된다
            "assignee_roles": [" 실험자 ", {"value": "검토자", "aliases": [" 리뷰어 ", "review", "리뷰어", "검토자"]}, "실험자", ""],
            "systems": ["lims", {"value": "LIMS", "aliases": ["랩정보"]}, "SAP", {"value": "other", "aliases": ["기타"]}],
        },
    ).json()
    # 값: trim·casefold 중복 제거(첫 표기). 별칭: trim·중복 제거·자기 값과 같은 별칭 제거
    assert body["assignee_roles"] == [
        {"value": "실험자", "aliases": []},
        {"value": "검토자", "aliases": ["리뷰어", "review"]},
    ]
    # Other는 맨 앞·별칭 보존. 뒤에 온 LIMS 엔트리는 값 중복이라 통째로 버려진다(별칭도 승계 안 함)
    assert body["systems"] == [
        {"value": "Other", "aliases": ["기타"]},
        {"value": "lims", "aliases": []},
        {"value": "SAP", "aliases": []},
    ]
    catalogs = client.get("/api/catalogs").json()
    assert catalogs["assignee_roles"] == body["assignee_roles"]
    assert catalogs["systems"] == body["systems"]
    body = client.put("/api/admin/app-settings", json={"assignee_roles": [], "systems": []}).json()
    assert body["assignee_roles"] == [] and body["systems"] == [{"value": "Other", "aliases": []}]


def test_app_settings_alias_conflicts_prefer_values(client: TestClient) -> None:
    """별칭 하나 → 정식 표기 하나: 다른 항목의 값·앞선 별칭과 겹치는 별칭은 버린다 (design 2026-09-12 §1)."""
    body = client.put(
        "/api/admin/app-settings",
        json={
            "assignee_roles": [
                {"value": "Reviewer", "aliases": ["검토자", "approver"]},
                {"value": "Approver", "aliases": ["승인자", "검토자"]},
            ],
        },
    ).json()
    assert body["assignee_roles"] == [
        {"value": "Reviewer", "aliases": ["검토자"]},
        {"value": "Approver", "aliases": ["승인자"]},
    ]
    client.put("/api/admin/app-settings", json={"assignee_roles": []})


def test_app_settings_alias_cap_and_legacy_string_storage(client: TestClient) -> None:
    """별칭 20개 상한 + 저장된 레거시 문자열 배열은 읽기 시 승격."""
    import asyncio

    from app.app_settings import ASSIGNEE_ROLES_KEY, set_app_setting
    from app.db import SessionLocal

    too_many = {"value": "Operator", "aliases": [f"a{i}" for i in range(25)]}
    body = client.put("/api/admin/app-settings", json={"assignee_roles": [too_many]}).json()
    assert len(body["assignee_roles"][0]["aliases"]) == 20

    async def _seed_legacy() -> None:
        async with SessionLocal() as session:
            await set_app_setting(session, ASSIGNEE_ROLES_KEY, '["Legacy One", "Legacy Two"]', "test")
            await session.commit()

    asyncio.run(_seed_legacy())
    assert client.get("/api/catalogs").json()["assignee_roles"] == [
        {"value": "Legacy One", "aliases": []},
        {"value": "Legacy Two", "aliases": []},
    ]
    client.put("/api/admin/app-settings", json={"assignee_roles": []})
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_app_settings.py -q`
Expected: 엔트리 관련 4개 FAIL(현재는 문자열 반환·422).

- [ ] **Step 3: 헬퍼** — `backend/app/app_settings.py`

`MANAGED_ITEM_MAX_LEN = 100` 아래: `MANAGED_ALIASES_MAX = 20`.
`get_managed_list` 아래에 추가:

```python
def normalize_managed_entries(values: list[object]) -> list[dict[str, object]]:
    """카탈로그 엔트리 정규화 — str은 별칭 없는 엔트리로 승격. 값·별칭 모두 trim·100자·casefold 중복 제거.
    불변식 "별칭 하나 → 정식 표기 하나": 값을 먼저 전부 확보하고, 별칭은 어떤 값(자기 포함)·앞선 별칭과
    겹치면 버린다(값이 별칭보다 우선). 항목당 별칭 20개 (design 2026-09-12 §1)."""
    taken: set[str] = set()
    staged: list[tuple[str, list[object]]] = []
    for raw in values:
        if isinstance(raw, str):
            value, aliases = raw, []
        elif isinstance(raw, dict):
            value = raw.get("value")
            aliases_raw = raw.get("aliases")
            aliases = aliases_raw if isinstance(aliases_raw, list) else []
        else:
            continue
        if not isinstance(value, str):
            continue
        value = value.strip()[:MANAGED_ITEM_MAX_LEN]
        if not value or value.casefold() in taken:
            continue
        taken.add(value.casefold())
        staged.append((value, aliases))
    out: list[dict[str, object]] = []
    for value, aliases in staged:
        cleaned: list[str] = []
        for alias in aliases:
            if not isinstance(alias, str):
                continue
            text = alias.strip()[:MANAGED_ITEM_MAX_LEN]
            if not text or text.casefold() in taken:
                continue
            taken.add(text.casefold())
            cleaned.append(text)
            if len(cleaned) >= MANAGED_ALIASES_MAX:
                break
        out.append({"value": value, "aliases": cleaned})
    return out


async def get_managed_entries(session: AsyncSession, key: str) -> list[dict[str, object]]:
    """엔트리 목록 — 레거시 문자열 배열도 승격해 돌려준다. 행 부재/파싱 불가/배열 아님이면 빈 목록."""
    row = await session.get(AppSetting, key)
    if row is None:
        return []
    try:
        stored = json.loads(row.value)
    except ValueError:
        return []
    if not isinstance(stored, list):
        return []
    return normalize_managed_entries(stored)


async def set_managed_entries(
    session: AsyncSession, key: str, values: list[object], user: str
) -> list[dict[str, object]]:
    cleaned = normalize_managed_entries(list(values))[:MANAGED_LIST_MAX]
    await set_app_setting(session, key, json.dumps(cleaned, ensure_ascii=False), user)
    return cleaned
```

`get_assignee_roles`·`ensure_other_first`·`get_systems`를 교체:

```python
async def get_assignee_roles(session: AsyncSession) -> list[dict[str, object]]:
    return await get_managed_entries(session, ASSIGNEE_ROLES_KEY)


def ensure_other_first(entries: list[dict[str, object]]) -> list[dict[str, object]]:
    """예약 항목 불변식 — Other는 항상 1개, 맨 앞. 저장된 Other 엔트리가 있으면 별칭을 보존한다."""
    other: dict[str, object] = {"value": OTHER_SYSTEM, "aliases": []}
    rest: list[dict[str, object]] = []
    for entry in entries:
        if str(entry["value"]).casefold() == OTHER_SYSTEM.casefold():
            other = {"value": OTHER_SYSTEM, "aliases": entry["aliases"]}
        else:
            rest.append(entry)
    return [other, *rest]


async def get_systems(session: AsyncSession) -> list[dict[str, object]]:
    return ensure_other_first(await get_managed_entries(session, SYSTEMS_KEY))
```

- [ ] **Step 4: 스키마** — `backend/app/schemas.py`

`AppSettingsOut` 위(파일 안 어디든 두 클래스보다 앞)에:

```python
class CatalogEntryIn(BaseModel):
    """카탈로그 항목 — 정식 표기 + 별칭(검색·입력 시 정식 표기로 치환) (design 2026-09-12 §1)."""

    value: str = Field(min_length=1, max_length=100)
    aliases: list[str] = Field(default_factory=list, max_length=20)


class CatalogEntryOut(BaseModel):
    value: str
    aliases: list[str] = []
```

- `AppSettingsOut`: `assignee_roles: list[CatalogEntryOut] = []`, `systems: list[CatalogEntryOut] = []`
- `AppSettingsUpdate`: `assignee_roles: list[CatalogEntryIn | str] | None = Field(default=None, max_length=500)`, `systems` 동일. 주석: "문자열은 별칭 없는 엔트리로 승격(구 클라이언트·스크립트 호환)".
- `CatalogsOut`: `assignee_roles: list[CatalogEntryOut]`, `systems: list[CatalogEntryOut]`.

- [ ] **Step 5: 라우터** — `backend/app/routers/app_settings.py`

import에 `set_managed_entries` 추가(`set_managed_list`는 `exposed_positions`가 안 쓰면 제거해 ruff F401을 피한다 — 현재 `exposed_positions`는 `set_app_setting` 직접 사용이므로 제거). PUT 분기 교체:

```python
    if payload.assignee_roles is not None:
        await set_managed_entries(
            session, ASSIGNEE_ROLES_KEY, [_entry_payload(e) for e in payload.assignee_roles], user
        )
    if payload.systems is not None:
        # Other는 값 잠금·별칭 허용 — 저장은 그대로 두고 읽기(get_systems)가 맨 앞으로 옮긴다
        await set_managed_entries(session, SYSTEMS_KEY, [_entry_payload(e) for e in payload.systems], user)
```

모듈 하단(또는 `_to_out` 위)에:

```python
def _entry_payload(entry: "CatalogEntryIn | str") -> object:
    """PUT 페이로드 항목 → 정규화 입력(str 그대로 / 모델은 dict)."""
    return entry if isinstance(entry, str) else entry.model_dump()
```

(`CatalogEntryIn`을 `app.schemas`에서 import.)

- [ ] **Step 6: 통과 + 전체 게이트**

Run: `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전부 PASS.

- [ ] **Step 7: 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev
git add backend/app/app_settings.py backend/app/schemas.py backend/app/routers/app_settings.py backend/tests/test_app_settings.py PROGRESS.md
git commit -m "feat(catalogs): catalog entries carry aliases with a one-alias-one-value invariant — 카탈로그 항목 별칭(값 우선 충돌 정리·Other 별칭 보존)"
```

---

### Task 2: 프론트 — `CatalogEntry` 타입·별칭 정규화·CSV 2열

**Files:**
- Modify: `frontend/src/lib/api.ts`(`Catalogs`·`AppSettings`·`putAppSettings`)
- Modify: `frontend/src/lib/catalogs.ts`, Test: `frontend/src/lib/catalogs.test.ts`
- Modify: `frontend/src/lib/catalog-csv.ts`, Test: `frontend/src/lib/catalog-csv.test.ts`

**Interfaces:**
- Produces: `api.CatalogEntry { value: string; aliases: string[] }`; `Catalogs`/`AppSettings.assignee_roles|systems: CatalogEntry[]`; `putAppSettings({ assignee_roles?: CatalogEntry[]; systems?: CatalogEntry[] })`.
- Produces: `normalizeToCatalog(value, entries: readonly CatalogEntry[]): string | null`(값·별칭 일치 → `entry.value`), `commitSystem(raw, systems: readonly CatalogEntry[], currentFallback)`, `findCatalogEntry(value, entries): CatalogEntry | null`, `EMPTY.systems = [{ value: OTHER_SYSTEM, aliases: [] }]`.
- Produces: `parseCatalogCsv(text): CatalogEntry[]`, `mergeCatalogEntries(current, incoming): { next: CatalogEntry[]; added: number; duplicates: number; aliasesAdded: number }`, `normalizeAliases(entries): CatalogEntry[]`(전역 값·별칭 중복 제거, 값 우선 — 서버 규칙의 FE 미러).

- [ ] **Step 1: 테스트 갱신**

`frontend/src/lib/catalogs.test.ts`의 `SYSTEMS`를 엔트리로 바꾸고 별칭 케이스 추가:
```ts
const SYSTEMS = [
  { value: OTHER_SYSTEM, aliases: ["기타"] },
  { value: "LIMS", aliases: ["랩정보", "lab info"] },
  { value: "SAP", aliases: [] },
];
...
  it("matches an alias and returns the canonical value", () => {
    expect(normalizeToCatalog("랩정보", SYSTEMS)).toBe("LIMS");
    expect(normalizeToCatalog(" LAB INFO ", SYSTEMS)).toBe("LIMS");
    expect(normalizeToCatalog("기타", SYSTEMS)).toBe("Other");
  });
```
`commitSystem` describe에 추가:
```ts
  it("alias input stores the canonical system, not Other", () => {
    expect(commitSystem("랩정보", SYSTEMS, "memo")).toEqual({ system: "LIMS", system_fallback: "memo", keptNote: false });
  });
```
기존 케이스는 그대로(엔트리 배열로 통과해야 함).

`frontend/src/lib/catalog-csv.test.ts`를 교체:
```ts
// 카탈로그 CSV 임포트 — value,aliases 2열 파싱(별칭 | 구분, 헤더 선택)·값 병합 + 별칭 합집합 (설정 Catalogs 탭)
import { describe, expect, it } from "vitest";

import { mergeCatalogEntries, normalizeAliases, parseCatalogCsv } from "./catalog-csv";

describe("parseCatalogCsv", () => {
  it("reads value and |-separated aliases, skips a header and blank lines", () => {
    expect(parseCatalogCsv("value,aliases\r\n실험자,\r\n\r\n 검토자 ,리뷰어| review |리뷰어\r\n")).toEqual([
      { value: "실험자", aliases: [] },
      { value: "검토자", aliases: ["리뷰어", "review"] },
    ]);
  });
  it("accepts a headerless single-column file", () => {
    expect(parseCatalogCsv("LIMS\nSAP\n")).toEqual([{ value: "LIMS", aliases: [] }, { value: "SAP", aliases: [] }]);
  });
});

describe("mergeCatalogEntries", () => {
  it("appends new values, unions aliases into existing values and counts duplicates", () => {
    const { next, added, duplicates, aliasesAdded } = mergeCatalogEntries(
      [{ value: "LIMS", aliases: ["랩정보"] }],
      [
        { value: "lims", aliases: ["lab info", "랩정보"] },
        { value: "SAP", aliases: ["sap erp"] },
        { value: " SAP ", aliases: [] },
        { value: "", aliases: ["x"] },
      ],
    );
    expect(next).toEqual([{ value: "LIMS", aliases: ["랩정보", "lab info"] }, { value: "SAP", aliases: ["sap erp"] }]);
    expect(added).toBe(1);
    expect(duplicates).toBe(2);
    expect(aliasesAdded).toBe(2);
  });
});

describe("normalizeAliases", () => {
  it("drops aliases that collide with any value or an earlier alias (values win)", () => {
    expect(
      normalizeAliases([
        { value: "Reviewer", aliases: ["검토자", "approver", "Reviewer"] },
        { value: "Approver", aliases: ["승인자", "검토자"] },
      ]),
    ).toEqual([{ value: "Reviewer", aliases: ["검토자"] }, { value: "Approver", aliases: ["승인자"] }]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/frontend && npx vitest run src/lib/catalogs.test.ts src/lib/catalog-csv.test.ts`
Expected: FAIL(타입은 vitest가 안 잡지만 값 불일치·미정의 export).

- [ ] **Step 3: api.ts**

`Catalogs` 위에:
```ts
// 카탈로그 항목 — 정식 표기 + 별칭(검색·입력 시 정식 표기로 치환) (design 2026-09-12 §1)
export interface CatalogEntry {
  value: string;
  aliases: string[];
}
```
`Catalogs`·`AppSettings`의 `assignee_roles: string[]`/`systems: string[]` → `CatalogEntry[]`; `putAppSettings` 패치의 두 필드도 `CatalogEntry[]`.

- [ ] **Step 4: lib/catalogs.ts**

- `import { getCatalogs, type CatalogEntry, type Catalogs } from "@/lib/api";`
- `const EMPTY: Catalogs = { assignee_roles: [], systems: [{ value: OTHER_SYSTEM, aliases: [] }] };`
- `normalizeToCatalog`를 교체:
```ts
/** 값 또는 별칭이 대소문자 무시로 일치하는 항목 — 없으면 null */
export function findCatalogEntry(value: string, entries: readonly CatalogEntry[]): CatalogEntry | null {
  const key = value.trim().toLocaleLowerCase();
  if (key === "") return null;
  return (
    entries.find(
      (entry) =>
        entry.value.toLocaleLowerCase() === key || entry.aliases.some((alias) => alias.toLocaleLowerCase() === key),
    ) ?? null
  );
}

/** trim 후 값·별칭 대소문자 무시 일치 → 정식 표기(value). 빈값·불일치는 null. */
export function normalizeToCatalog(value: string, entries: readonly CatalogEntry[]): string | null {
  return findCatalogEntry(value, entries)?.value ?? null;
}
```
- `commitSystem(raw, systems: readonly CatalogEntry[], currentFallback)` — 시그니처 타입만 바꾸고 본문은 그대로(`normalizeToCatalog` 사용).

- [ ] **Step 5: lib/catalog-csv.ts** — 전체 교체

```ts
// 카탈로그 CSV 임포트 순수 함수 — value,aliases 2열(별칭 | 구분, 헤더 선택) 파싱·값 병합+별칭 합집합·별칭 불변식
// (별칭 하나 → 값 하나, 값 우선)의 FE 미러(설정 Catalogs 탭). 파서는 csv-import parseCsvRecords(RFC4180) 재사용.

import type { CatalogEntry } from "@/lib/api";
import { parseCsvRecords } from "@/lib/csv-import";

const ITEM_MAX_LEN = 100; // 서버 MANAGED_ITEM_MAX_LEN과 동일
const ALIASES_MAX = 20; // 서버 MANAGED_ALIASES_MAX와 동일
const ALIAS_SEPARATOR = "|";

const clean = (raw: string): string => raw.trim().slice(0, ITEM_MAX_LEN);

/** 값·별칭 전역 중복 제거 — 값을 먼저 전부 확보하고, 별칭은 어떤 값·앞선 별칭과 겹치면 버린다 */
export function normalizeAliases(entries: readonly CatalogEntry[]): CatalogEntry[] {
  const taken = new Set<string>();
  const staged: CatalogEntry[] = [];
  for (const entry of entries) {
    const value = clean(entry.value);
    if (value === "" || taken.has(value.toLocaleLowerCase())) continue;
    taken.add(value.toLocaleLowerCase());
    staged.push({ value, aliases: entry.aliases });
  }
  return staged.map((entry) => {
    const aliases: string[] = [];
    for (const raw of entry.aliases) {
      const alias = clean(raw);
      if (alias === "" || taken.has(alias.toLocaleLowerCase())) continue;
      taken.add(alias.toLocaleLowerCase());
      aliases.push(alias);
      if (aliases.length >= ALIASES_MAX) break;
    }
    return { value: entry.value, aliases };
  });
}

export function parseCatalogCsv(text: string): CatalogEntry[] {
  const entries = parseCsvRecords(text)
    .map((record) => ({
      value: (record.cells[0] ?? "").trim(),
      aliases: (record.cells[1] ?? "")
        .split(ALIAS_SEPARATOR)
        .map((alias) => alias.trim())
        .filter((alias) => alias !== ""),
    }))
    .filter((entry) => entry.value !== "");
  if (entries.length > 0 && entries[0].value.toLocaleLowerCase() === "value") entries.shift();
  return normalizeAliases(entries);
}

export function mergeCatalogEntries(
  current: readonly CatalogEntry[],
  incoming: readonly CatalogEntry[],
): { next: CatalogEntry[]; added: number; duplicates: number; aliasesAdded: number } {
  const next = current.map((entry) => ({ value: entry.value, aliases: [...entry.aliases] }));
  const byKey = new Map(next.map((entry) => [entry.value.toLocaleLowerCase(), entry]));
  let added = 0;
  let duplicates = 0;
  for (const raw of incoming) {
    const value = clean(raw.value);
    if (value === "") continue;
    const existing = byKey.get(value.toLocaleLowerCase());
    if (existing) {
      duplicates += 1;
      existing.aliases.push(...raw.aliases);
      continue;
    }
    const entry = { value, aliases: [...raw.aliases] };
    byKey.set(value.toLocaleLowerCase(), entry);
    next.push(entry);
    added += 1;
  }
  const normalized = normalizeAliases(next);
  const before = current.reduce((sum, entry) => sum + entry.aliases.length, 0);
  const after = normalized.reduce((sum, entry) => sum + entry.aliases.length, 0);
  return { next: normalized, added, duplicates, aliasesAdded: Math.max(0, after - before) };
}
```

- [ ] **Step 6: 통과 확인**

Run: `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/frontend && npx vitest run src/lib/catalogs.test.ts src/lib/catalog-csv.test.ts`
Expected: PASS. (tsc는 아직 소비자 3곳·패널 때문에 실패할 수 있다 — Task 3·4에서 해소. 이 태스크의 커밋 전 게이트는 vitest 두 파일 + `npx tsc --noEmit` 실행 결과를 보고에 적되, 실패가 소비자 파일(`suggest-input`·`role-tile`·`bpm-attribute-picker`·`system-suggest-input`·`catalogs-panel`·`pw` 제외)에 한정되는지 확인.)

- [ ] **Step 7: 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev
git add frontend/src/lib/api.ts frontend/src/lib/catalogs.ts frontend/src/lib/catalogs.test.ts frontend/src/lib/catalog-csv.ts frontend/src/lib/catalog-csv.test.ts PROGRESS.md
git commit -m "feat(catalogs): alias-aware entries, normalization and two-column CSV on the client — 별칭 매칭·CSV 2열·병합 순수 함수"
```

---

### Task 3: `SuggestInput` 별칭 검색·치환 + 소비자 3곳 + i18n

**Files:**
- Modify: `frontend/src/components/suggest-input.tsx`
- Modify: `frontend/src/components/system-suggest-input.tsx`(타입만), `frontend/src/components/permissions/role-tile.tsx`(타입만), `frontend/src/components/bpm-attribute-picker.tsx`(타입만)
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: `CatalogEntry`.
- Produces: `SuggestInput.options: readonly SuggestOption[]` where `export interface SuggestOption { value: string; aliases?: readonly string[] }`(`CatalogEntry`가 그대로 만족). Enter/blur 정확 일치는 값·별칭 → `value`로 커밋. 드롭다운 항목에 별칭 보조 텍스트(`data-id={dataId}-option-{i}` 유지).
- i18n 키(Task 4와 겹치지 않게 여기서만): `suggest.aliasesOf`("Aliases: {list}" / "별칭: {list}").

- [ ] **Step 1: SuggestInput 수정**

- 타입: `export interface SuggestOption { value: string; aliases?: readonly string[]; }`; props `options: readonly SuggestOption[]`.
- `hits`:
```ts
  const hits = open
    ? filterByQuery([...options], draft, (item) => [
        { field: "value", text: item.value },
        ...(item.aliases ?? []).map((alias) => ({ field: "alias", text: alias })),
      ])
        .slice(0, MAX_SUGGESTIONS)
        .map((hit) => hit.item)
    : [];
```
- `settle`: 하이라이트 커밋 `commit(hits[highlight].value)`; 정확 일치:
```ts
    const exact = options.find(
      (option) =>
        option.value.toLocaleLowerCase() === key ||
        (option.aliases ?? []).some((alias) => alias.toLocaleLowerCase() === key),
    );
    if (exact !== undefined) {
      commit(exact.value); // 별칭 입력도 정식 표기로 (design 2026-09-12 §2)
      return;
    }
```
- 렌더: `key={item.value}`, `onMouseDown` → `commit(item.value)`, 항목 본문:
```tsx
                  <span className="min-w-0 truncate">{item.value}</span>
                  {(item.aliases?.length ?? 0) > 0 && (
                    <span className="ml-auto min-w-0 shrink truncate pl-2 text-fine text-ink-tertiary" title={t("suggest.aliasesOf", { list: item.aliases!.join(", ") })}>
                      {item.aliases!.join(", ")}
                    </span>
                  )}
```
(`!` 단언 대신 `const aliases = item.aliases ?? [];`로 미리 꺼내 쓰면 `no-non-null-assertion` 린트를 피한다 — 그렇게 작성.)
- 머리 주석에 "별칭으로도 검색·정확 일치 시 정식 표기로 치환" 한 줄 추가.

- [ ] **Step 2: 소비자 3곳** — `useCatalogs()`가 이미 `CatalogEntry[]`를 돌려주므로 `options={roleOptions}`/`options={systems}`는 타입이 맞는다. `system-suggest-input.tsx`의 `commitSystem(raw, systems, ...)`도 그대로. 변경이 필요 없으면 손대지 않는다(tsc가 알려준다).

- [ ] **Step 3: i18n** — en `"suggest.noMatchFree"` 아래 `"suggest.aliasesOf": "Aliases: {list}",`; ko 같은 자리 `"suggest.aliasesOf": "별칭: {list}",`.

- [ ] **Step 4: 게이트** — `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npx vitest run` (tsc는 `catalogs-panel.tsx`만 남아 실패할 수 있다 — 그 파일의 오류만 남았는지 확인하고 보고. 다른 파일 오류는 여기서 고친다.)

- [ ] **Step 5: 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev
git add frontend/src/components/suggest-input.tsx frontend/src/components/system-suggest-input.tsx frontend/src/components/permissions/role-tile.tsx frontend/src/components/bpm-attribute-picker.tsx frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(ui): SuggestInput searches aliases and commits the canonical value — 별칭 검색·정식 표기 치환"
```

---

### Task 4: Catalogs 탭 — 별칭 편집·CSV 2열·i18n

**Files:**
- Modify: `frontend/src/components/settings/catalogs-panel.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`
- Modify: `frontend/COMPONENTS.md`(생성)

**Interfaces:**
- Consumes: `CatalogEntry`, `mergeCatalogEntries`, `normalizeAliases`, `parseCatalogCsv`.
- Produces `data-id`: `${card}-chip`(값 칩, 클릭=별칭 편집 토글), `${card}-alias-badge`, `${card}-alias-editor`, `${card}-alias-input`, `${card}-alias-apply`, `${card}-alias-cancel`. 기존 `-add-input`/`-add`/`-import`/`-file`/`-import-note`/`-candidates`/`-save` 유지.
- i18n 키: `catalog.aliases`("Aliases"/"별칭"), `catalog.aliasesFor`("Aliases for {value}"/"{value}의 별칭"), `catalog.aliasesPlaceholder`("Comma-separated, e.g. 검토자, 리뷰어"/"콤마 구분, 예: 검토자, 리뷰어"), `catalog.aliasesApply`("Apply"/"적용"), `catalog.aliasesCancel`("Cancel"/"취소"), `catalog.csvHint`("CSV columns: value, aliases (aliases separated by |). Header row optional."/"CSV 열: value, aliases(별칭은 | 구분). 헤더 행 선택."), `catalog.importResult` 문구 교체("Added {added}, merged {aliases} alias(es), skipped {duplicates} duplicate(s)."/"{added}건 추가, 별칭 {aliases}건 병합, 중복 {duplicates}건 제외."). 기존 `catalog.rolesHint`/`systemsHint`는 유지하고 `catalog.csvHint`를 카드 힌트 아래 한 줄로 추가 표시.

- [ ] **Step 1: 패널 수정** — `catalogs-panel.tsx`

- `Lists`·`ManagedListCardProps.values`·`onSave`·`save()`가 `CatalogEntry[]`.
- import: `import { mergeCatalogEntries, normalizeAliases, parseCatalogCsv } from "@/lib/catalog-csv";` `import type { CatalogEntry } from "@/lib/api";`
- 상태 추가: `const [editingAlias, setEditingAlias] = useState<string | null>(null);` `const [aliasDraft, setAliasDraft] = useState("");`
- `isLocked`/`has`는 `entry.value` 기준. `addValues(incoming: CatalogEntry[])` → `mergeCatalogEntries(draft, incoming)`; `handleAdd` → `addValues([{ value: adding, aliases: [] }])`; 후보 체크 → `addValues([{ value, aliases: [] }])`; `handleFile` → `const { added, duplicates, aliasesAdded } = addValues(parseCatalogCsv(text)); setImportNote(t("catalog.importResult", { added, duplicates, aliases: aliasesAdded }));`
- 칩 렌더 교체(값 칩은 버튼 — 클릭하면 별칭 편집 토글; 잠금 항목도 별칭 편집 가능, 삭제만 불가):
```tsx
        {draft.map((entry) => {
          const locked = isLocked(entry.value);
          const editing = editingAlias === entry.value;
          return (
            <span
              key={entry.value}
              data-id={`${dataId}-chip`}
              data-value={entry.value}
              className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-caption text-ink ${
                editing ? "border-accent bg-accent-tint" : "border-hairline bg-surface"
              }`}
            >
              <button
                type="button"
                className="inline-flex items-center gap-1"
                title={entry.aliases.length > 0 ? t("suggest.aliasesOf", { list: entry.aliases.join(", ") }) : t("catalog.aliases")}
                disabled={readOnly}
                onClick={() => {
                  setEditingAlias(editing ? null : entry.value);
                  setAliasDraft(entry.aliases.join(", "));
                }}
              >
                {entry.value}
                {entry.aliases.length > 0 && (
                  <span data-id={`${dataId}-alias-badge`} className="rounded-xs bg-surface-alt px-1 text-fine text-ink-tertiary">
                    +{entry.aliases.length}
                  </span>
                )}
              </button>
              {locked && <span className="text-fine text-ink-tertiary">{t("catalog.otherLocked")}</span>}
              {!readOnly && !locked && (
                <button type="button" aria-label={t("catalog.remove")} className="text-ink-tertiary hover:text-ink"
                  onClick={() => { setDraft((prev) => prev.filter((item) => item.value !== entry.value)); if (editing) setEditingAlias(null); }}>
                  <X size={11} strokeWidth={1.5} />
                </button>
              )}
            </span>
          );
        })}
```
- 칩 목록 바로 아래(읽기 전용 아닐 때) 별칭 편집 줄:
```tsx
      {!readOnly && editingAlias !== null && (
        <div data-id={`${dataId}-alias-editor`} className="flex items-center gap-2 rounded-sm border border-accent-tint-border bg-surface px-2 py-1.5">
          <span className="shrink-0 text-fine text-ink-secondary">{t("catalog.aliasesFor", { value: editingAlias })}</span>
          <input
            data-id={`${dataId}-alias-input`}
            className={INPUT_CLASS}
            value={aliasDraft}
            placeholder={t("catalog.aliasesPlaceholder")}
            maxLength={400}
            autoFocus
            onChange={(event) => setAliasDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); applyAliases(); }
              if (event.key === "Escape") { event.stopPropagation(); setEditingAlias(null); }
            }}
          />
          <button type="button" data-id={`${dataId}-alias-apply`} className={SECONDARY_BUTTON} onClick={applyAliases}>{t("catalog.aliasesApply")}</button>
          <button type="button" data-id={`${dataId}-alias-cancel`} className={SECONDARY_BUTTON} onClick={() => setEditingAlias(null)}>{t("catalog.aliasesCancel")}</button>
        </div>
      )}
```
- `applyAliases`(컴포넌트 안 plain function):
```ts
  const applyAliases = () => {
    if (editingAlias === null) return;
    const aliases = aliasDraft.split(",").map((alias) => alias.trim()).filter((alias) => alias !== "");
    // 값·별칭 전역 불변식은 normalizeAliases가 서버 규칙 그대로 집행(값 우선·casefold 중복 제거)
    setDraft((prev) => normalizeAliases(prev.map((entry) => (entry.value === editingAlias ? { value: entry.value, aliases } : entry))));
    setEditingAlias(null);
  };
```
- 카드 힌트 아래에 `<p className="text-fine text-ink-tertiary">{t("catalog.csvHint")}</p>`.
- 서버 값이 바뀌어 초안이 리셋될 때(`valuesKey !== seenKey` 블록) `setEditingAlias(null)`도 함께.

- [ ] **Step 2: i18n 키** — Task 4 Interfaces 목록을 en·ko `"catalog.saved"` 근처에 추가하고 `catalog.importResult`를 교체.

- [ ] **Step 3: 게이트 + 카탈로그** — `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npx vitest run && node scripts/build-component-catalog.mjs`. 이제 tsc는 전체 clean이어야 한다.

- [ ] **Step 4: 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev
git add frontend/src/components/settings/catalogs-panel.tsx frontend/src/lib/i18n-messages.ts frontend/COMPONENTS.md PROGRESS.md
git commit -m "feat(settings): edit catalog aliases inline and import value,aliases CSV — Catalogs 탭 별칭 편집·CSV 2열"
```

---

### Task 5: 노드 표시 전환(휴식=역할·정식명 / 활성=담당자·원문) + 칩 흑백 톤

**Files:**
- Modify: `frontend/src/lib/canvas.ts`(상수)
- Modify: `frontend/src/components/role-chip.tsx`(`tone`)
- Modify: `frontend/src/components/process-node.tsx`(`NodeFields`·3개 루트 호버·3개 호출 사이트)

**Interfaces:**
- Produces: `export const NODE_ALT_DELAY_MS = 1000;`(`lib/canvas.ts`); `RoleChip({ role, dataId, tone?: "accent" | "mono" })`; `NodeFields({ data, active })`; 담당자 줄 `data-id="node-assignee-line" data-alt="true|false"`, 시스템 줄 `data-id="node-system-line" data-alt`.

- [ ] **Step 1: 상수·칩**

`frontend/src/lib/canvas.ts`의 `NODE_WIDTH` 정의 위에:
```ts
// 노드 표시 전환 지연 — 호버/선택이 이만큼 지속되면 담당자 줄(역할→담당자)·시스템 줄(정식명→원문)을
// 페이드 전환한다. 미세 조정은 여기서만 (design 2026-09-12 §4)
export const NODE_ALT_DELAY_MS = 1000;
```
`role-chip.tsx`: props에 `tone?: "accent" | "mono";`(기본 `"accent"`), className을
```ts
  const toneClass =
    tone === "mono"
      ? "border-hairline bg-surface-alt text-ink-secondary"
      : "border-accent-tint-border bg-accent-tint text-accent";
```
로 분기해 `inline-flex max-w-full items-center gap-1 rounded-sm border px-1.5 py-0.5 text-fine ${toneClass}`. 머리 주석에 "노드 안은 mono(흑백) — 인물 필과 같은 중립 톤" 추가.

- [ ] **Step 2: NodeFields** — `process-node.tsx`

import: `NODE_ALT_DELAY_MS`를 `@/lib/canvas` import 목록에 추가; `useEffect`가 아직 import에 없으면 추가.

`NodeFields`를 아래로 교체:

```tsx
// 노드 속성 줄(담당자/부서/시스템) — 켜진 필드 중 값이 있는 것만, 규범 순서 고정.
// start/end는 BPM 속성 줄을 표시하지 않음. subprocess는 지정 어트리뷰트(sp*, 라이브 참조) (spec 2026-07-06).
// 휴식↔활성 전환(design 2026-09-12 §4): 담당자 줄은 휴식=역할 칩(있으면)·활성(호버/선택 NODE_ALT_DELAY_MS 지속)=
// 담당자 이름, 시스템 줄은 휴식=정식명(Other면 원문)·활성=원문 메모. 두 표기를 같은 grid 칸에 겹쳐 opacity로
// 교차 페이드해 높이가 흔들리지 않는다. 역할/원문이 없으면 전환 없이 단일 표기.
function NodeFields({ data, active }: { data: AppNode["data"]; active: boolean }) {
  const { displayFields } = useNodeActions();
  const { t } = useI18n();
  const warnings = useNodeWarnings(data);
  const alt = useDelayedFlag(active, NODE_ALT_DELAY_MS);
  const isSubprocess = data.nodeType === "subprocess";
  if (!hasBpmAttributes(data.nodeType) && !isSubprocess) return null;
  const warnedFields = {
    department: warnings.some((w) => w.kind === "deptOrphan"),
    assignee: hasAssigneeWarning(warnings),
    system: false,
  };
  const spValues: Record<(typeof ATTR_FIELD_ORDER)[number], string | null | undefined> = {
    assignee: data.spAssignee,
    department: data.spDepartment,
    system: data.spSystem,
  };
  const role = (isSubprocess ? data.spAssigneeRole : data.assignee_role) ?? "";
  const note = isSubprocess ? "" : (data.system_fallback ?? "").trim();
  const otherLabel = t("system.other");
  return (
    <>
      {ATTR_FIELD_ORDER.filter((field) => displayFields.includes(field)).map((field) => {
        const value = (isSubprocess ? spValues[field] : data[field]) ?? "";
        // 휴식/활성 표기 — 같으면 전환 없음
        let rest: ReactNode = value !== "" ? <span>{value}</span> : null;
        let alternate: ReactNode = rest;
        if (field === "assignee") {
          const names = value !== "" ? <span>{value}</span> : null;
          rest = role !== "" ? <RoleChip role={role} dataId="node-role-chip" tone="mono" /> : names;
          alternate = names ?? rest;
        } else if (field === "system") {
          const restText = value === OTHER_SYSTEM ? note || otherLabel : value;
          rest = value !== "" ? <span>{restText}</span> : null;
          alternate = note !== "" && note !== restText ? <span>{note}</span> : rest;
        }
        if (rest === null) return null;
        const swaps = alternate !== rest;
        const warned = warnedFields[field];
        const Icon = warned ? TriangleAlert : FIELD_ICON[field];
        return (
          <div
            key={field}
            data-id={`node-${field}-line`}
            data-alt={swaps && alt ? "true" : "false"}
            className="mt-0.5 text-xs text-ink-tertiary"
          >
            <span className="inline-flex items-center gap-1">
              <Icon size={12} strokeWidth={1.5} className={warned ? "text-warn" : undefined} />
              {swaps ? (
                // 교차 페이드 — 두 표기를 같은 칸에 겹치고 opacity만 바꾼다(높이=둘 중 큰 쪽)
                <span className="grid">
                  <span
                    aria-hidden={alt}
                    className={`col-start-1 row-start-1 transition-opacity duration-350 ease-smooth motion-reduce:transition-none ${alt ? "pointer-events-none opacity-0" : "opacity-100"}`}
                  >
                    {rest}
                  </span>
                  <span
                    aria-hidden={!alt}
                    className={`col-start-1 row-start-1 transition-opacity duration-350 ease-smooth motion-reduce:transition-none ${alt ? "opacity-100" : "pointer-events-none opacity-0"}`}
                  >
                    {alternate}
                  </span>
                </span>
              ) : (
                rest
              )}
            </span>
          </div>
        );
      })}
    </>
  );
}

// 활성이 delayMs 이상 지속되면 true, 비활성이면 즉시 false — 타이머는 effect, 즉시 복귀는 render-time adjust
function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [flag, setFlag] = useState(false);
  const [prevActive, setPrevActive] = useState(active);
  if (active !== prevActive) {
    setPrevActive(active);
    if (!active) setFlag(false);
  }
  useEffect(() => {
    if (!active) return undefined;
    const id = window.setTimeout(() => setFlag(true), delayMs);
    return () => window.clearTimeout(id);
  }, [active, delayMs]);
  return flag;
}
```
`OTHER_SYSTEM`을 `@/lib/catalogs`에서 import(`formatSystem`은 이 함수에서 더 쓰지 않으면 import 정리). `ReactNode` 타입 import 확인. 라벨 규칙: 값이 `Other`인데 원문도 없으면 `t("system.other")`.

- [ ] **Step 3: 호버·선택 배선** — `process-node.tsx` `ProcessNode`

컴포넌트 상단(다른 `useState` 옆): `const [hovered, setHovered] = useState(false);` `const fieldsActive = hovered || (selected ?? false);`
세 루트 `<div className="group ...">`(subprocess ~1041행, decision ~1298행, 일반 ~1352행)에 `onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}` 추가. 세 `<NodeFields data={data} />` 호출을 `<NodeFields data={data} active={fieldsActive} />`로.

- [ ] **Step 4: 게이트** — `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npx vitest run && node scripts/build-component-catalog.mjs` (RoleChip 사용처 변경 없음이면 카탈로그 무변경).

- [ ] **Step 5: 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev
git add frontend/src/lib/canvas.ts frontend/src/components/role-chip.tsx frontend/src/components/process-node.tsx frontend/COMPONENTS.md PROGRESS.md
git commit -m "feat(canvas): node lines swap role→assignee and system→source note after a hover/select delay; mono role chip — 노드 표시 전환(1초 상수)·흑백 칩"
```

---

### Task 6: 스모크 확장 + 문서 + 전체 게이트

**Files:**
- Modify: `frontend/scripts/pw-smoke-assignee-role.mjs`
- Modify: `docs/design/README.md`·`docs/README.md`(상태 "dev 구현 완료"), `PROGRESS.md`, `CLAUDE.md`(카탈로그 문장에 "항목은 `{value, aliases}` 엔트리" 한 구 추가)

**Interfaces:**
- Consumes: 백엔드 8000·프론트 3000 네이티브 서버(에이전트가 자기 세션에서 기동, 끝나면 정지). 카탈로그 PUT은 엔트리 형태.

- [ ] **Step 1: 스모크 스크립트 수정**

- 시드 노드 `Weigh sample`에 `assignee: "Admin Sys"` 추가(호버 전환 판정용).
- 카탈로그 시드 PUT을 엔트리로: `{ assignee_roles: [{ value: "Reviewer", aliases: ["검토자"] }], systems: [{ value: "LIMS", aliases: ["랩정보"] }] }`.
- 역할 검사 뒤에 별칭 치환 검사 추가: 역할 입력에 `검토자` fill → Enter → 2600ms → GET graph → `assignee_role === "Reviewer"` (`check("alias input is normalized to the canonical role", ...)`).
- 시스템 검사에 별칭 케이스 추가: `랩정보` → `LIMS`.
- 호버 전환 검사(리로드 후 캔버스 검사 다음):
```js
  const line = page.locator(".react-flow__node", { hasText: "Weigh sample" }).locator('[data-id="node-assignee-line"]');
  check("rest state shows the role chip", (await line.getAttribute("data-alt")) === "false" && (await line.locator('[data-id="node-role-chip"]').count()) === 1);
  await page.locator(".react-flow__node", { hasText: "Weigh sample" }).first().hover();
  await page.waitForTimeout(1300); // NODE_ALT_DELAY_MS(1000) + 여유
  check("hover swaps to the assignee after the delay", (await line.getAttribute("data-alt")) === "true" && ((await line.textContent()) ?? "").includes("Admin Sys"));
  await page.mouse.move(10, 10);
  await page.waitForTimeout(300);
  check("leaving returns to the role", (await line.getAttribute("data-alt")) === "false");
```
- Catalogs 탭 검사: 기존 add/CSV 흐름 유지하되 CSV를 2열로(`value,aliases\r\nOperator,오퍼레이터|작업자\r\nreviewer,\r\n`), import note 정규식을 `/Added 1, merged 2/`로; 별칭 편집: 첫 칩(`[data-id="catalog-roles-chip"][data-value="Reviewer"] button`) 클릭 → `catalog-roles-alias-input` fill `검토자, 리뷰어` → `catalog-roles-alias-apply` 클릭 → 저장 → `/catalogs`의 `assignee_roles`가 `[{value:"Reviewer",aliases:["검토자","리뷰어"]},{value:"Approver",aliases:[]},{value:"Operator",aliases:["오퍼레이터","작업자"]}]`와 deep-equal(`check("aliases saved", JSON.stringify(...) === JSON.stringify(...))`).
- `finally` 정리 PUT은 `{ assignee_roles: [], systems: [] }` 그대로(문자열/빈 배열 호환).
- 파일 머리 주석의 시나리오 목록 갱신.

- [ ] **Step 2: 서버 기동·스모크 실행** — Task 11(전작)과 같은 절차: backend `nohup .venv/bin/uvicorn app.main:app --port 8000 > /tmp/bpm-backend.log 2>&1 &`, frontend `nohup npm run dev > /tmp/bpm-frontend.log 2>&1 &`(포트 점유 시 8047/3047 + `PORT`/`BACKEND_URL`, `API_URL`/`BASE_URL`), 준비 확인 후 `node scripts/pw-smoke-assignee-role.mjs` → 전부 PASS. 자기가 띄운 프로세스만 종료(`pkill -f` 광범위 패턴 금지 — PID로).

- [ ] **Step 3: 전체 게이트** — 백엔드 pytest+ruff, 프론트 tsc+vitest+lint+catalog `--check`.

- [ ] **Step 4: 문서** — `docs/design/README.md`·`docs/README.md`의 이 설계 항목을 "**dev 구현 완료**"로; `CLAUDE.md` Lessons의 카탈로그 문장에 "항목은 `{value, aliases}` 엔트리(별칭→정식 표기 치환, `normalize_managed_entries`/`normalizeAliases` 불변식)" 구를 덧붙임; `PROGRESS.md` 1~3줄.

- [ ] **Step 5: 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev
git add frontend/scripts/pw-smoke-assignee-role.mjs docs/design/README.md docs/README.md CLAUDE.md PROGRESS.md
git commit -m "test(editor): smoke covers alias normalization, hover swap and alias editing — 별칭·호버 전환·별칭 편집 스모크 + 문서"
```

---

## Self-Review

- **Spec coverage**: §1 모델·불변식·Other 별칭·레거시 승격(T1) · §2 타입·매칭·SuggestInput·CSV(T2·T3) · §3 탭 별칭 편집·CSV 2열·결과 문구(T4) · §4 전환·상수·톤·data-id(T5) · §5 검증(각 태스크 + T6).
- **Type consistency**: `CatalogEntry {value, aliases}` = 서버 `CatalogEntryOut`; `SuggestOption {value, aliases?}`는 `CatalogEntry`의 상위 타입; `normalizeAliases`(FE) ↔ `normalize_managed_entries`(BE) 같은 규칙(값 우선·casefold·20개); `NODE_ALT_DELAY_MS` 단일 소스; `data-id` `node-assignee-line`/`node-system-line`/`node-role-chip`/`catalog-*-alias-*`.
- **Placeholders**: 없음. 행 번호는 근사치 — 인용 코드로 찾는다.
