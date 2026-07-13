# 노드 파라미터 재정의 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 노드 숫자 파라미터를 "회당 단가" 모델로 재정의하고(회당 소요시간·회당 추가비용(원/달러 배타)·회당 투입인원·연간 건수·FTE), 서브프로세스 지정을 3종으로 축소하며, Σ 합산/미리보기·CSV·Excel·AI 계약까지 일괄 반영한다.

**Architecture:** 백엔드는 컬럼 개명 + `cost` → `cost_krw`/`cost_usd` 분리 + 배타 422 검증기를 경계(NodeIn/SubprocessDesignationIn/AiNodeAttributes)에 두고, 프론트는 `lib/params.ts`(필드·순서·라벨)와 `lib/duration.ts`(정규화·서식)를 단일 소스로 삼아 ParamInput·칩·Σ·CSV·Excel·AI 변환이 모두 거기서 파생되게 한다. 운영 미배포이므로 DB는 재생성 전제(기존 `cost` 값 폐기).

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic v2 / Next.js(React) + TypeScript + @xyflow/react / pytest·ruff / vitest·tsc·eslint

**설계 문서:** `docs/superpowers/specs/2026-07-13-node-params-redefinition-design.md` (이 계획의 근거. 충돌 시 스펙이 우선)

## Global Constraints

- **필드 키 = DB 컬럼 = API 키 = CSV 헤더**: `duration`, `cost_krw`, `cost_usd`, `headcount`, `annual_count`, `fte`. 표시 순서도 이 순서.
- **비용 배타**: `cost_krw`와 `cost_usd`는 동시에 값을 가질 수 없다. 위반 시 API는 **422**(조용한 소거 금지). 둘 다 빈 값은 정상.
- **무효값 소거**: 배타 위반을 제외한 개별 필드의 무효 숫자·자유텍스트는 경계에서 `""`로 소거(422 아님) — 기존 계약 유지(`from_attributes` 응답 겸용이라 422를 내면 조회가 깨진다).
- **duration 계약 불변**: H.MM(소수부=분, `0.30`=30분, ≥60 이월). 정규화는 FE `lib/duration.ts` ↔ BE `app/duration.py` 동치 이중 구현 — 한쪽만 고치지 말 것.
- **표시형**: 편집 중(포커스)에는 원문, 그 외에는 표시형(duration `1h30m`, 비용 천단위 콤마). CSV(왕복)·Excel(숫자 셀)은 예외로 raw 숫자.
- **SP 지정 파라미터는 3종**: `sp_duration`, `sp_cost_krw`, `sp_cost_usd`, `sp_headcount`. `sp_etf`·`sp_extra`는 제거.
- **SP 노드 편집 규칙**: 서브프로세스 노드에서 사람이 입력 가능한 파라미터는 `annual_count`, `fte` 뿐. 나머지 4개는 링크 맵 지정값의 읽기전용 표시. AI도 동일 제한(프롬프트 명시 + 변환단 강제).
- **정규화 대칭**: CSV 경로와 AI 경로의 값 정규화는 항상 같이 바꾼다(한쪽만 하면 무효 에코가 `mergeNode` pick을 통과해 백엔드 소거로 기존값이 유실된다).
- **커밋 메시지**: `type(scope): English summary — 한국어 요약`. 각 태스크 커밋에 `PROGRESS.md` 한 줄을 **함께** 담는다(`rules/common/git.md`).
- **언어**: UI 문자열 영어 기본, 코드/식별자/에러 메시지 영어, 주석·설명 한국어.
- **테스트 실행 환경(중요)**: `backend/.env`가 있으면 기본 비활성 가정 테스트가 깨진다. 전체 그린 확인은
  `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q`

---

## File Structure

**백엔드 (신규 없음, 수정만)**
- `backend/app/models.py` — `Node`/`ProcessMap` 파라미터 컬럼 개명·분리
- `backend/app/schemas.py` — `NodeIn`/`SubprocessDesignationIn`/`SubprocessRefOut`/`MapDetailOut`/`AiNodeAttributes` 필드·검증기
- `backend/app/db.py` — `_ADDED_COLUMNS` 목록
- `backend/app/routers/graph.py` `versions.py` `maps.py` — upsert·clone·SP 지정
- `backend/app/subprocess.py` — `get_subprocess_refs` 컬럼
- `backend/app/ai_prompt.py` — 프롬프트 스키마·규칙·그래프 직렬화
- `backend/scripts/seed_org_demo.py` — 데모 값
- `backend/tests/test_numeric_params.py` `test_sp_params.py` `test_ai.py`

**프론트엔드**
- `frontend/src/lib/params.ts` — 필드 목록·순서·라벨 키·**노드 타입별 편집 가능 필드**(단일 소스)
- `frontend/src/lib/duration.ts` — 숫자 정규화 + **천단위 콤마 서식/파싱**
- `frontend/src/lib/param-sum.ts` — Σ 합산·평균
- `frontend/src/lib/api.ts` `diff.ts` `canvas.ts` `i18n-messages.ts`
- `frontend/src/lib/csv-import.ts` `csv-export.ts` `excel-export.ts`
- `frontend/src/components/param-input.tsx` `process-node.tsx` `node-summary-modal.tsx` `group-bulk-modal.tsx` `subprocess-inspector-card.tsx` `permissions/subprocess-designation-{modal,panel}.tsx`
- `frontend/src/app/maps/[mapId]/page.tsx` (에디터 — AppNode data·인스펙터·AI 변환) · `compare/page.tsx`
- `docs/samples/*.csv` · `docs/db-seed.md`

---

### Task 1: 백엔드 — 필드 개명 + 비용 2필드 분리 + 배타 422

**Files:**
- Modify: `backend/app/models.py:101-106`(sp_*), `backend/app/models.py:204-209`(Node)
- Modify: `backend/app/schemas.py:42-80`(SubprocessDesignationIn), `:541-546`(MapDetailOut sp_*), `:580-622`(NodeIn), `:679-700`(SubprocessRefOut)
- Modify: `backend/app/db.py:57-66`
- Modify: `backend/app/routers/graph.py:261-265`, `backend/app/routers/versions.py:71-75`, `backend/app/routers/maps.py:561-565`
- Modify: `backend/app/subprocess.py:100-147`(get_subprocess_refs)
- Test: `backend/tests/test_numeric_params.py`, `backend/tests/test_sp_params.py`

**Interfaces:**
- Produces: 노드/SP API의 필드 키 `duration`·`cost_krw`·`cost_usd`·`headcount`·`annual_count`·`fte` (SP 지정·SubprocessRefOut은 `annual_count`/`fte` 없음). 배타 위반 시 422.

- [ ] **Step 1: 기존 테스트를 새 계약으로 고쳐 실패시키기**

`backend/tests/test_numeric_params.py`에서 `etf`/`extra`/`cost` 키를 새 키로 바꾸고, 배타 케이스를 추가한다. 파일 맨 아래에 다음 테스트를 추가:

```python
@pytest.mark.asyncio
async def test_node_rejects_both_currencies(client: AsyncClient, version_id: int) -> None:
    """cost_krw와 cost_usd를 동시에 채우면 422 — 조용한 소거는 데이터 유실이라 거절한다."""
    payload = {
        "nodes": [
            {"id": "n1", "title": "T", "node_type": "process",
             "cost_krw": "1000", "cost_usd": "10"},
        ],
        "edges": [],
    }
    res = await client.put(f"/api/versions/{version_id}/graph", json=payload)
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_node_accepts_single_currency(client: AsyncClient, version_id: int) -> None:
    payload = {
        "nodes": [
            {"id": "n1", "title": "T", "node_type": "process",
             "cost_krw": "1250000", "annual_count": "1200", "fte": "0.8", "headcount": "2"},
        ],
        "edges": [],
    }
    res = await client.put(f"/api/versions/{version_id}/graph", json=payload)
    assert res.status_code == 200
    node = res.json()["nodes"][0]
    assert node["cost_krw"] == "1250000"
    assert node["cost_usd"] == ""
    assert node["annual_count"] == "1200"
    assert node["fte"] == "0.8"
```

(기존 픽스처 이름은 파일 상단에서 확인해 그대로 쓴다. `version_id` 픽스처가 없으면 파일에 이미 있는 맵/버전 생성 헬퍼를 재사용한다 — 새 픽스처를 만들지 말 것.)

`backend/tests/test_sp_params.py`도 동일하게: SP 지정 페이로드의 `etf`/`extra` 키를 제거하고, `cost` → `cost_krw`/`cost_usd`로 바꾸며, 다음을 추가:

```python
@pytest.mark.asyncio
async def test_sp_designation_rejects_both_currencies(client: AsyncClient, map_id: int) -> None:
    res = await client.put(
        f"/api/maps/{map_id}/subprocess",
        json={"department": "Owning Anchor Division", "cost_krw": "1000", "cost_usd": "10"},
    )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_sp_designation_has_no_annual_or_fte(client: AsyncClient, map_id: int) -> None:
    """연간 건수·FTE는 부모 맥락 값이라 SP 지정에 존재하지 않는다 — 보내도 무시된다."""
    res = await client.put(
        f"/api/maps/{map_id}/subprocess",
        json={"department": "Owning Anchor Division", "duration": "1.30",
              "annual_count": "999", "fte": "9"},
    )
    assert res.status_code == 200
    detail = (await client.get(f"/api/maps/{map_id}")).json()
    assert detail["sp_duration"] == "1.30"
    assert "sp_annual_count" not in detail
    assert "sp_fte" not in detail
```

> 백엔드 테스트에서 맵을 만들 때 오우닝 부서는 **"Owning Anchor Division"** 앵커를 써야 한다(권한 시드 규약).

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_numeric_params.py tests/test_sp_params.py -q
```
Expected: FAIL — 새 키가 응답에 없고(`KeyError`/`assert`), 배타 케이스는 200이 나온다.

- [ ] **Step 3: 모델 컬럼 개명·분리**

`backend/app/models.py` `ProcessMap`(101-106):

```python
    sp_duration: Mapped[str | None] = mapped_column(String(50), default=None)
    # SP 지정 파라미터 3종 — 회당 소요시간·회당 추가비용(원/달러 배타)·회당 투입인원.
    # 연간 건수·FTE는 부모 맥락 값이라 노드 행에 저장한다 (design 2026-07-13 §2.2).
    sp_cost_krw: Mapped[str | None] = mapped_column(String(50), default=None)
    sp_cost_usd: Mapped[str | None] = mapped_column(String(50), default=None)
    sp_headcount: Mapped[str | None] = mapped_column(String(50), default=None)
```

`Node`(204-209):

```python
    duration: Mapped[str] = mapped_column(String(50), default="")
    # 회당 단가 파라미터 — 비용은 원/달러 배타 2필드, 연간 건수·FTE는 노드 값 (design 2026-07-13 §2.1)
    cost_krw: Mapped[str] = mapped_column(String(50), default="")
    cost_usd: Mapped[str] = mapped_column(String(50), default="")
    headcount: Mapped[str] = mapped_column(String(50), default="")
    annual_count: Mapped[str] = mapped_column(String(50), default="")
    fte: Mapped[str] = mapped_column(String(50), default="")
```

`backend/app/db.py`의 `_ADDED_COLUMNS`(57-66)를 교체:

```python
    # 회당 단가 파라미터 (design 2026-07-13) — 운영 미배포라 구 컬럼(etf/cost/extra)은 이관 없이 폐기
    ("nodes", "cost_krw", "VARCHAR(50) DEFAULT ''"),
    ("nodes", "cost_usd", "VARCHAR(50) DEFAULT ''"),
    ("nodes", "headcount", "VARCHAR(50) DEFAULT ''"),
    ("nodes", "annual_count", "VARCHAR(50) DEFAULT ''"),
    ("nodes", "fte", "VARCHAR(50) DEFAULT ''"),
    ("process_maps", "sp_cost_krw", "VARCHAR(50)"),
    ("process_maps", "sp_cost_usd", "VARCHAR(50)"),
    ("process_maps", "sp_headcount", "VARCHAR(50)"),
```

- [ ] **Step 4: 스키마 필드·검증기 교체**

`backend/app/schemas.py`에 공용 배타 검증 헬퍼를 `NUMERIC_RE` import 아래에 추가:

```python
def _assert_single_currency(krw: str, usd: str) -> None:
    """비용은 원/달러 중 하나만 — 둘 다 채우면 422 (design 2026-07-13 §3.3)."""
    if krw.strip() and usd.strip():
        raise ValueError("cost_krw and cost_usd are mutually exclusive — fill only one")
```

`NodeIn`(580-622):

```python
    duration: str = Field(default="", max_length=50)
    # 회당 단가 파라미터 — 무효값은 validator가 경계에서 "" 소거, 비용 배타만 422 (design 2026-07-13)
    cost_krw: str = Field(default="", max_length=50)
    cost_usd: str = Field(default="", max_length=50)
    headcount: str = Field(default="", max_length=50)
    annual_count: str = Field(default="", max_length=50)
    fte: str = Field(default="", max_length=50)
```

`@field_validator("headcount", "etf", "cost", "extra", ...)` → `@field_validator("cost_krw", "cost_usd", "headcount", "annual_count", "fte", mode="after")` (본문 동일).

그리고 `_drop_label_without_url` 옆에 model_validator 추가:

```python
    @model_validator(mode="after")
    def _check_single_currency(self) -> "NodeIn":
        _assert_single_currency(self.cost_krw, self.cost_usd)
        return self
```

`SubprocessDesignationIn`(42-80): 파라미터 필드를 `duration` / `cost_krw` / `cost_usd` / `headcount` 4개로 교체(=`etf`·`extra` 삭제), 숫자 validator 대상도 교체, 동일한 `_check_single_currency` model_validator 추가.

`SubprocessRefOut`(679-700): `headcount`, `cost_krw`, `cost_usd`만 유지(`etf`·`extra` 삭제).

`MapDetailOut`(541-546): `sp_cost_krw`, `sp_cost_usd`, `sp_headcount`로 교체(`sp_etf`·`sp_extra` 삭제).

- [ ] **Step 5: 라우터·subprocess 반영**

`routers/graph.py:261-265`:

```python
            existing.duration = node.duration
            existing.cost_krw = node.cost_krw
            existing.cost_usd = node.cost_usd
            existing.headcount = node.headcount
            existing.annual_count = node.annual_count
            existing.fte = node.fte
```
(같은 함수 안의 **신규 노드 생성 경로**도 동일 필드로 갱신할 것 — `Node(...)` 생성자 인자를 grep으로 확인.)

`routers/versions.py:71-75`(clone_graph):

```python
            duration=node.duration,
            cost_krw=node.cost_krw,
            cost_usd=node.cost_usd,
            headcount=node.headcount,
            annual_count=node.annual_count,
            fte=node.fte,
```

`routers/maps.py:561-565`(SP 지정):

```python
    found_map.sp_duration = payload.duration
    found_map.sp_cost_krw = payload.cost_krw
    found_map.sp_cost_usd = payload.cost_usd
    found_map.sp_headcount = payload.headcount
```

`subprocess.py`의 `get_subprocess_refs` select/언패킹에서 `sp_etf`·`sp_extra`를 빼고 `sp_cost_krw`·`sp_cost_usd`를 넣는다(컬럼 순서와 언패킹 순서가 어긋나면 값이 뒤바뀌므로 둘을 같이 고칠 것).

- [ ] **Step 6: 테스트 통과 확인 + 전체 스위트**

```bash
cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
```
Expected: 전부 PASS (다른 테스트가 구 필드명을 쓰고 있으면 함께 갱신 — `grep -rn "etf\|extra\|\"cost\"" tests/`).

- [ ] **Step 7: 커밋**

```bash
git add backend/app backend/tests PROGRESS.md
git commit -m "feat(params): rename node params and split cost into KRW/USD — 노드 파라미터 개명·비용 통화 분리"
```

---

### Task 2: 백엔드 — AI 계약 확장 (6필드 + SP 제한)

**Files:**
- Modify: `backend/app/schemas.py:1100-1114`(AiNodeAttributes)
- Modify: `backend/app/ai_prompt.py:14-35`(스키마·규칙), `:60-80`(_serialize_node)
- Test: `backend/tests/test_ai.py`

**Interfaces:**
- Consumes: Task 1의 필드 키.
- Produces: `AiNodeAttributes`가 `cost_krw`·`cost_usd`·`headcount`·`annual_count`·`fte`를 파싱(부분 갱신 시맨틱 유지: `None`=유지, `""`=삭제).

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_ai.py` 하단에 추가:

```python
def test_ai_node_attributes_parses_new_params() -> None:
    attr = AiNodeAttributes.model_validate(
        {"cost_krw": "1250000", "headcount": "2", "annual_count": "1200", "fte": "0.8"}
    )
    assert attr.cost_krw == "1250000"
    assert attr.annual_count == "1200"
    assert attr.fte == "0.8"
    assert attr.cost_usd is None  # 미제공 = 기존값 유지


def test_ai_node_attributes_rejects_both_currencies() -> None:
    with pytest.raises(ValidationError):
        AiNodeAttributes.model_validate({"cost_krw": "1000", "cost_usd": "10"})


def test_ai_prompt_states_subprocess_param_limit() -> None:
    """SP 노드는 annual_count·fte만 수정 가능하다는 제한이 프롬프트에 명시돼야 한다."""
    from app.ai_prompt import _INSTRUCTIONS

    assert "annual_count" in _INSTRUCTIONS
    assert "subprocess" in _INSTRUCTIONS.lower()
```

`ValidationError`는 `from pydantic import ValidationError`, `AiNodeAttributes`는 `from app.schemas import AiNodeAttributes`로 import.

- [ ] **Step 2: 실패 확인**

```bash
cd backend && AI_ENABLED=false .venv/bin/python -m pytest tests/test_ai.py -q
```
Expected: FAIL (`cost_krw` 필드 없음 → `attr.cost_krw` AttributeError).

- [ ] **Step 3: AiNodeAttributes 확장**

`backend/app/schemas.py:1107-1114`에 추가:

```python
    duration: str | None = Field(default=None, max_length=50)
    # 회당 단가 파라미터 — NodeIn과 동일 제약. None=유지, ""=삭제 (design 2026-07-13 §6)
    cost_krw: str | None = Field(default=None, max_length=50)
    cost_usd: str | None = Field(default=None, max_length=50)
    headcount: str | None = Field(default=None, max_length=50)
    annual_count: str | None = Field(default=None, max_length=50)
    fte: str | None = Field(default=None, max_length=50)
```

같은 클래스에 배타 검증 추가:

```python
    @model_validator(mode="after")
    def _check_single_currency(self) -> "AiNodeAttributes":
        _assert_single_currency(self.cost_krw or "", self.cost_usd or "")
        return self
```

- [ ] **Step 4: 프롬프트 갱신**

`ai_prompt.py`의 graph 스키마 예시(17행)의 `attributes`를 교체:

```
           "attributes":{"assignee":"","department":"","system":"","duration":"","cost_krw":"","cost_usd":"","headcount":"","annual_count":"","fte":"","url":"","url_label":"","color":""},
```

규칙 블록(34행 근처)에 다음 3줄을 추가:

```
- 파라미터 의미 — duration=회당 소요시간(H.MM 시간, 소수부 2자리는 분: 0.30=30분, "2일" 같은 텍스트 금지),
  cost_krw/cost_usd=회당 추가비용(인건비 제외), headcount=회당 투입 인원, annual_count=연간 처리 건수, fte=FTE. 모르면 비워두세요.
- 비용은 cost_krw·cost_usd 중 하나만 채웁니다 — 둘 다 채우면 제안 전체가 거절됩니다.
- subprocess 노드는 annual_count·fte만 수정할 수 있습니다. duration·cost_krw·cost_usd·headcount는 하위 맵의 지정값이라 수정할 수 없습니다(무시됩니다).
```

`_serialize_node`(68행 아래)에 값 노출을 추가 — 모델이 기존 값을 보고 보존/판단할 수 있게:

```python
    if node.cost_krw:
        meta.append(f"비용={node.cost_krw}원")
    if node.cost_usd:
        meta.append(f"비용=${node.cost_usd}")
    if node.headcount:
        meta.append(f"인원={node.headcount}")
    if node.annual_count:
        meta.append(f"연간건수={node.annual_count}")
    if node.fte:
        meta.append(f"FTE={node.fte}")
```

- [ ] **Step 5: 통과 확인**

```bash
cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
```
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add backend/app backend/tests PROGRESS.md
git commit -m "feat(ai): expose per-run params to AI contract with subprocess limits — AI 계약에 회당 파라미터 노출·SP 제한"
```

---

### Task 3: 프론트 코어 — 필드 개명 스윕 + 편집 가능 필드 정의

**Files:**
- Modify: `frontend/src/lib/params.ts`, `frontend/src/lib/api.ts:78-150`, `frontend/src/lib/canvas.ts:104-106`, `frontend/src/lib/diff.ts:16-59`, `frontend/src/lib/i18n-messages.ts:216-220,1585-1589`
- Modify(기계적 개명): `components/process-node.tsx`, `node-summary-modal.tsx`, `group-bulk-modal.tsx`, `subprocess-inspector-card.tsx`, `permissions/subprocess-designation-{modal,panel}.tsx`, `lib/param-sum.ts`, `lib/csv-{import,export}.ts`, `lib/excel-export.ts`, `app/maps/[mapId]/page.tsx`, `app/maps/[mapId]/compare/page.tsx`
- Test: `frontend/src/lib/params.test.ts` (신규)

**Interfaces:**
- Produces:
  - `PARAM_FIELDS: readonly ["duration","cost_krw","cost_usd","headcount","annual_count","fte"]`
  - `type ParamField`
  - `PARAM_LABEL_KEY: Record<ParamField, MessageKey>`
  - `getEditableParamFields(nodeType: string): readonly ParamField[]`
  - `SP_PARAM_FIELDS: readonly ["duration","cost_krw","cost_usd","headcount"]` (SP 지정 화면·읽기전용 표시용)
  - `GraphNode`의 파라미터 키가 `cost_krw`/`cost_usd`/`annual_count`/`fte`로 개명(모두 `?: string`)

> 이 태스크는 **동작 변경 없는 개명**이다. 콤마 서식·배타 disabled·Σ 규칙 변경은 다음 태스크들에서.
> 개명 도중 tsc가 깨지므로 **한 태스크 안에서 전 파일을 끝내야** 그린이 된다.

- [ ] **Step 1: 실패 테스트 작성 — `frontend/src/lib/params.test.ts`**

```typescript
import { describe, expect, it } from "vitest";

import { getEditableParamFields, PARAM_FIELDS, SP_PARAM_FIELDS } from "./params";

describe("PARAM_FIELDS", () => {
  it("표시 순서는 소요시간 → 비용(원/달러) → 인원 → 연간 건수 → FTE", () => {
    expect([...PARAM_FIELDS]).toEqual([
      "duration", "cost_krw", "cost_usd", "headcount", "annual_count", "fte",
    ]);
  });
});

describe("getEditableParamFields", () => {
  it("일반 노드는 6필드 전부 편집 가능", () => {
    expect([...getEditableParamFields("process")]).toEqual([...PARAM_FIELDS]);
    expect([...getEditableParamFields("decision")]).toEqual([...PARAM_FIELDS]);
  });

  it("서브프로세스 노드는 연간 건수·FTE만 편집 가능 — 나머지는 링크 맵 지정값", () => {
    expect([...getEditableParamFields("subprocess")]).toEqual(["annual_count", "fte"]);
  });

  it("start/end는 파라미터 없음", () => {
    expect(getEditableParamFields("start")).toHaveLength(0);
    expect(getEditableParamFields("end")).toHaveLength(0);
  });

  it("SP 지정 파라미터는 3종(비용 2필드 포함)", () => {
    expect([...SP_PARAM_FIELDS]).toEqual(["duration", "cost_krw", "cost_usd", "headcount"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
cd frontend && npx vitest run src/lib/params.test.ts
```
Expected: FAIL — `getEditableParamFields` / `SP_PARAM_FIELDS` 미존재.

- [ ] **Step 3: `lib/params.ts` 교체**

```typescript
// 회당 단가 파라미터 6종 메타 — 필드·순서·라벨·노드 타입별 편집 가능 집합의 단일 소스
// (design 2026-07-13 §2.1, §3.1)
import type { MessageKey } from "./i18n-messages";

export const PARAM_FIELDS = [
  "duration", "cost_krw", "cost_usd", "headcount", "annual_count", "fte",
] as const;
export type ParamField = (typeof PARAM_FIELDS)[number];

/** SP 지정값(하위 맵이 대표로 노출)은 3종 — 연간 건수·FTE는 부모 맥락 값이라 제외 */
export const SP_PARAM_FIELDS = ["duration", "cost_krw", "cost_usd", "headcount"] as const;
export type SpParamField = (typeof SP_PARAM_FIELDS)[number];

/** 서브프로세스 노드에서 사람이 직접 입력하는 필드 — 나머지 4개는 링크 맵 지정값(읽기전용) */
export const SUBPROCESS_OWN_FIELDS = ["annual_count", "fte"] as const;

export const COST_FIELDS = ["cost_krw", "cost_usd"] as const;

export const PARAM_LABEL_KEY: Record<ParamField, MessageKey> = {
  duration: "field.duration",
  cost_krw: "field.costKrw",
  cost_usd: "field.costUsd",
  headcount: "field.headcount",
  annual_count: "field.annualCount",
  fte: "field.fte",
};

/** 노드 타입 → 편집 가능한 파라미터. start/end는 없음, subprocess는 2개 (design §3.1) */
export function getEditableParamFields(nodeType: string): readonly ParamField[] {
  if (nodeType === "start" || nodeType === "end") return [];
  if (nodeType === "subprocess") return SUBPROCESS_OWN_FIELDS;
  return PARAM_FIELDS;
}

export const PARAMS_COLLAPSED_KEY = "bpm.paramsCollapsed";

/** 저장값 없으면 기본 접힘(true). 직전 토글 상태는 세션 간 유지 (design 2026-07-11 SP §5). */
export function readParamsCollapsed(): boolean {
  if (typeof window === "undefined") return true;
  const saved = window.localStorage.getItem(PARAMS_COLLAPSED_KEY);
  return saved === null ? true : saved === "1";
}

export function writeParamsCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PARAMS_COLLAPSED_KEY, collapsed ? "1" : "0");
}
```

- [ ] **Step 4: i18n 라벨 교체**

`lib/i18n-messages.ts` EN(216-220):

```typescript
  "field.duration": "Duration / run (h)",
  "field.costKrw": "Cost / run (KRW)",
  "field.costUsd": "Cost / run (USD)",
  "field.headcount": "Headcount / run",
  "field.annualCount": "Annual volume",
  "field.fte": "FTE",
```

KO(1585-1589):

```typescript
  "field.duration": "회당 소요시간(h)",
  "field.costKrw": "회당 추가비용(원)",
  "field.costUsd": "회당 추가비용($)",
  "field.headcount": "회당 투입인원",
  "field.annualCount": "연간 건수",
  "field.fte": "FTE",
```

`field.etf`/`field.cost`/`field.extra` 키는 삭제(EN·KO 양쪽). 삭제 후 `MessageKey` 타입 에러가 나는 참조는 Step 5에서 정리된다.

- [ ] **Step 5: 타입·소비처 기계적 개명**

- `lib/api.ts:88-92`(GraphNode) → `cost_krw?: string; cost_usd?: string; headcount?: string; annual_count?: string; fte?: string;`
- `lib/api.ts:143-147`(SubprocessRef) → `cost_krw: string | null; cost_usd: string | null; headcount: string | null;` (`etf`·`extra` 삭제)
- `lib/api.ts`의 `MapDetail`(sp_* 필드) → `sp_cost_krw`·`sp_cost_usd`·`sp_headcount` (`sp_etf`·`sp_extra` 삭제)
- `lib/diff.ts:16-20,55-59` → 새 6키
- `lib/canvas.ts:104-106` → `hasBpmAttributes`는 그대로 두되(담당자·부서·시스템 등 비-파라미터 속성 판정에 계속 쓰인다), 파라미터 판정은 `getEditableParamFields`를 쓰도록 소비처를 바꾼다.
- 나머지 파일들(`process-node.tsx`의 `spEtf`→`spCostKrw`/`spCostUsd`·`spAnnualCount` 등 AppNode data 키 포함)에서 `etf`→`fte`, `extra`→`annual_count`, `cost`→`cost_krw`(+`cost_usd` 추가) 로 일괄 개명. **에디터 `page.tsx`는 ugrep이 브래킷 디렉터리를 건너뛰므로** 다음으로 확인:

```bash
cd frontend && python3 - <<'EOF'
import re
p="src/app/maps/[mapId]/page.tsx"
for i,l in enumerate(open(p,encoding="utf-8"),1):
    if re.search(r"\betf\b|\bextra\b|\bcost\b|spEtf|spExtra|spCost", l): print(i, l.rstrip()[:120])
EOF
```

`param-sum.ts`·`csv-*`·`excel-export.ts`는 이 태스크에서 **키만** 바꾸고(동작 유지), 규칙 변경은 Task 4·8·9에서 한다. 단 `cost_usd`는 새 필드이므로 CSV/Excel 컬럼 추가는 Task 8·9까지 미루지 말고 **키 개명 시 컴파일이 깨지지 않는 최소 형태**(기존 cost 자리에 cost_krw)만 유지한다.

- [ ] **Step 6: 게이트 확인**

```bash
cd frontend && npx vitest run && npx tsc --noEmit && npm run lint
```
Expected: 전부 PASS (기존 테스트의 구 키는 함께 갱신).

- [ ] **Step 7: 커밋**

```bash
git add frontend/src PROGRESS.md
git commit -m "refactor(params): rename param fields and define per-type editable sets — 파라미터 개명·타입별 편집 집합"
```

---

### Task 4: Σ 합산 규칙 (비용 2필드 독립 합 + 인원 평균)

**Files:**
- Modify: `frontend/src/lib/param-sum.ts`
- Test: `frontend/src/lib/param-sum.test.ts`

**Interfaces:**
- Consumes: `Graph`(api.ts), `SP_PARAM_FIELDS`(params.ts)
- Produces: `sumParamField(graph: Graph, field: SpParamField): string` — `duration`·`cost_krw`·`cost_usd`는 합, `headcount`는 평균(SP 노드 제외, 소수점 2자리).

- [ ] **Step 1: 실패 테스트 작성** (`param-sum.test.ts`의 기존 케이스는 키만 갱신하고, 아래를 추가)

```typescript
it("비용은 원·달러를 각각 독립 합산한다", () => {
  const graph = makeGraph([
    { id: "a", cost_krw: "1250000", cost_usd: "" },
    { id: "b", cost_krw: "380000", cost_usd: "" },
    { id: "c", cost_krw: "", cost_usd: "1200.50" },
  ]);
  expect(sumParamField(graph, "cost_krw")).toBe("1630000");
  expect(sumParamField(graph, "cost_usd")).toBe("1200.5");
});

it("인원은 값이 있는 노드의 평균 — 소수점 2자리", () => {
  const graph = makeGraph([
    { id: "a", headcount: "2" },
    { id: "b", headcount: "1" },
    { id: "c", headcount: "" }, // 분모에서 제외
  ]);
  expect(sumParamField(graph, "headcount")).toBe("1.50");
});

it("인원 평균은 서브프로세스 노드를 제외한다 (design §4)", () => {
  const graph = makeGraph([
    { id: "a", headcount: "2" },
    { id: "b", headcount: "1" },
    { id: "sp", node_type: "subprocess", linked_map_id: 7 },
  ]);
  graph.subprocess_refs = { 7: spRef({ headcount: "9", duration: "1", cost_krw: "500" }) };
  expect(sumParamField(graph, "headcount")).toBe("1.50"); // SP 인원 9는 무시
  expect(sumParamField(graph, "duration")).toBe("1");     // 소요시간·비용은 SP 포함
  expect(sumParamField(graph, "cost_krw")).toBe("500");
});

it("기여값이 없으면 빈 문자열 — 0과 구분", () => {
  const graph = makeGraph([{ id: "a", headcount: "" }]);
  expect(sumParamField(graph, "headcount")).toBe("");
  expect(sumParamField(graph, "cost_usd")).toBe("");
});
```

`makeGraph`/`spRef` 헬퍼는 기존 테스트 파일 상단의 것을 재사용/확장한다(새 헬퍼 파일을 만들지 말 것).

- [ ] **Step 2: 실패 확인**

```bash
cd frontend && npx vitest run src/lib/param-sum.test.ts
```
Expected: FAIL — 평균 미구현(합이 나옴), `cost_usd` 미지원.

- [ ] **Step 3: `param-sum.ts` 구현**

```typescript
// Σ 합산 — 게시본 그래프의 파라미터. subprocess 노드는 링크 맵의 sp값(subprocess_refs).
// duration은 분 환산 캐리, 비용은 통화별 독립 합, 인원은 "값 있는 일반 노드의 평균"(SP 제외).
// design 2026-07-13 §4.
import type { Graph } from "./api";
import { DURATION_PATTERN, NUMERIC_PATTERN, normalizeDuration } from "./duration";
import type { SpParamField } from "./params";

/** 합산 기여값 — SP 노드는 링크 맵 지정값. includeSubprocess=false면 SP 노드를 건너뛴다. */
function collectValues(graph: Graph, field: SpParamField, includeSubprocess: boolean): string[] {
  const values: string[] = [];
  for (const node of graph.nodes) {
    const isSubprocess = node.node_type === "subprocess" && node.linked_map_id !== null;
    if (isSubprocess && !includeSubprocess) continue;
    const raw = isSubprocess
      ? graph.subprocess_refs?.[node.linked_map_id as number]?.[field] ?? ""
      : (node[field] ?? "");
    if (raw !== "") values.push(raw);
  }
  return values;
}

function sumDecimal(values: string[]): string {
  const valid = values.filter((v) => NUMERIC_PATTERN.test(v));
  if (valid.length === 0) return "";
  const maxDecimals = valid.reduce((max, v) => Math.max(max, v.split(".")[1]?.length ?? 0), 0);
  const scale = 10 ** maxDecimals;
  const total = valid.reduce((sum, v) => sum + Math.round(Number(v) * scale), 0);
  return String(total / scale);
}

/** 유효 기여값 합(인원은 평균). 기여값 0개면 "" — 입력을 비워두는 것과 0을 구분한다. */
export function sumParamField(graph: Graph, field: SpParamField): string {
  if (field === "duration") {
    let totalMinutes = 0;
    let contributed = 0;
    for (const raw of collectValues(graph, field, true)) {
      const normalized = normalizeDuration(raw);
      if (normalized === null || normalized === "" || !DURATION_PATTERN.test(normalized)) continue;
      const [h, mm = ""] = normalized.split(".");
      totalMinutes += Number.parseInt(h, 10) * 60 + (mm === "" ? 0 : Number.parseInt(mm, 10));
      contributed += 1;
    }
    if (contributed === 0) return "";
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0 ? String(hours) : `${hours}.${String(minutes).padStart(2, "0")}`;
  }
  if (field === "headcount") {
    // 평균 — SP 노드는 하위 맵의 평균값이라 이중 반영을 피해 제외 (design §4)
    const valid = collectValues(graph, field, false).filter((v) => NUMERIC_PATTERN.test(v));
    if (valid.length === 0) return "";
    const total = valid.reduce((sum, v) => sum + Number(v), 0);
    return (total / valid.length).toFixed(2);
  }
  return sumDecimal(collectValues(graph, field, true));
}
```

- [ ] **Step 4: 통과 확인**

```bash
cd frontend && npx vitest run src/lib/param-sum.test.ts && npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/param-sum.ts frontend/src/lib/param-sum.test.ts PROGRESS.md
git commit -m "feat(params): sum costs per currency and average headcount excluding subprocess — 통화별 합산·인원 평균"
```

---

### Task 5: 입력 서식 — 천단위 콤마 + 비용 배타 + 칩 표시

**Files:**
- Modify: `frontend/src/lib/duration.ts`(콤마 서식/파싱 추가)
- Modify: `frontend/src/components/param-input.tsx`
- Modify: `frontend/src/components/process-node.tsx`(칩)
- Test: `frontend/src/lib/duration.test.ts`, `frontend/src/components/param-input.test.tsx`(신규)

**Interfaces:**
- Produces:
  - `formatThousands(raw: string): string` — `"1250000"` → `"1,250,000"`, `"1200.5"` → `"1,200.5"`, 무효/빈값 → `""`
  - `stripThousands(raw: string): string` — 콤마 제거
  - `ParamInput` prop 확장: `disabled`(기존), `placeholder`(기존) — 콤마 표시 스왑은 내부에서 `field`로 판단

- [ ] **Step 1: 실패 테스트 작성**

`duration.test.ts`에 추가:

```typescript
describe("formatThousands", () => {
  it("정수부에 세 자리마다 콤마", () => {
    expect(formatThousands("1250000")).toBe("1,250,000");
    expect(formatThousands("380000")).toBe("380,000");
    expect(formatThousands("999")).toBe("999");
  });

  it("소수부는 콤마 없이 보존", () => {
    expect(formatThousands("1200.50")).toBe("1,200.50");
  });

  it("빈값·무효값은 빈 문자열", () => {
    expect(formatThousands("")).toBe("");
    expect(formatThousands("abc")).toBe("");
  });
});

describe("stripThousands", () => {
  it("콤마를 제거한다 — CSV의 '1,250,000' 같은 입력 허용", () => {
    expect(stripThousands("1,250,000")).toBe("1250000");
    expect(stripThousands("1200.50")).toBe("1200.50");
  });
});
```

`param-input.test.tsx`(신규 — `@testing-library/react` 사용. 이미 다른 컴포넌트 테스트가 쓰는 방식과 동일하게 작성):

```typescript
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ParamInput } from "./param-input";

describe("ParamInput 비용 서식", () => {
  it("포커스가 없으면 콤마 표시, 포커스 중엔 원문", () => {
    render(
      <ParamInput field="cost_krw" value="1250000" ariaLabel="cost" onCommit={vi.fn()} />,
    );
    const input = screen.getByLabelText("cost") as HTMLInputElement;
    expect(input.value).toBe("1,250,000");
    fireEvent.focus(input);
    expect(input.value).toBe("1250000");
  });

  it("타이핑은 숫자·점만 통과한다", () => {
    const onCommit = vi.fn();
    render(<ParamInput field="cost_krw" value="" ariaLabel="cost" onCommit={onCommit} />);
    const input = screen.getByLabelText("cost");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "12a" } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "12" } });
    expect(onCommit).toHaveBeenCalledWith("12");
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
cd frontend && npx vitest run src/lib/duration.test.ts src/components/param-input.test.tsx
```
Expected: FAIL — `formatThousands` 미존재.

- [ ] **Step 3: `duration.ts`에 서식 함수 추가**

```typescript
/** 천단위 콤마 표시형 — 비용 필드 전용(편집 중이 아닐 때). 무효/빈값 → "". */
export function formatThousands(raw: string): string {
  const text = raw.trim();
  if (text === "" || !NUMERIC_PATTERN.test(text)) return "";
  const [intPart, fracPart] = text.split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fracPart === undefined ? withCommas : `${withCommas}.${fracPart}`;
}

/** 콤마 제거 — CSV·붙여넣기의 "1,250,000" 입력을 받아들이기 위한 역변환. */
export function stripThousands(raw: string): string {
  return raw.replace(/,/g, "");
}
```

- [ ] **Step 4: `param-input.tsx` — 비용 표시 스왑**

`display` 계산을 필드별로 확장(기존 duration 스왑은 유지):

```typescript
import { COST_FIELDS, type ParamField } from "@/lib/params";
import { formatDurationHm, formatThousands, normalizeDuration, normalizeNumericParam } from "@/lib/duration";

const isCost = (field: ParamField): boolean =>
  (COST_FIELDS as readonly string[]).includes(field);

// ...컴포넌트 내부
  const display = focused
    ? value
    : field === "duration"
      ? formatDurationHm(value)
      : isCost(field)
        ? formatThousands(value)
        : value;
```

`onBlur`의 정규화는 그대로(`normalizeDuration` / `normalizeNumericParam`) — 콤마는 타이핑 필터가 막으므로 별도 처리 불필요.

- [ ] **Step 5: `process-node.tsx` 칩 서식**

`PARAM_ICON`을 새 키로 교체(`cost_krw`/`cost_usd`는 `Coins`, `annual_count`는 `Tag`, `fte`는 `Target`), `displayValue`를 확장:

```typescript
  const displayValue = (f: ParamField): string | null | undefined => {
    const raw = values[f] ?? "";
    if (f === "duration") return formatDurationHm(raw);
    if (f === "cost_krw") return raw ? `₩${formatThousands(raw)}` : "";
    if (f === "cost_usd") return raw ? `$${formatThousands(raw)}` : "";
    return raw;
  };
```

SP 노드의 `values`는 `spDuration`·`spCostKrw`·`spCostUsd`·`spHeadcount` + 노드 자신의 `annual_count`·`fte`를 합쳐서 만든다(SP 노드도 6칩 노출 가능).

- [ ] **Step 6: 통과 확인**

```bash
cd frontend && npx vitest run && npx tsc --noEmit && npm run lint
```
Expected: PASS.

- [ ] **Step 7: 커밋**

```bash
git add frontend/src PROGRESS.md
git commit -m "feat(params): thousand separators for cost inputs and chips — 비용 천단위 콤마 표시"
```

---

### Task 6: SP 지정 화면 — Σ 4버튼 + 결과 placeholder 미리보기

**Files:**
- Modify: `frontend/src/components/permissions/subprocess-designation-modal.tsx`
- Modify: `frontend/src/components/permissions/subprocess-designation-panel.tsx`
- Modify: `frontend/src/components/subprocess-inspector-card.tsx`
- Test: `frontend/src/components/permissions/subprocess-designation-modal.test.tsx`(신규)

**Interfaces:**
- Consumes: `sumParamField`(Task 4), `SP_PARAM_FIELDS`·`PARAM_LABEL_KEY`(Task 3), `formatThousands`·`formatDurationHm`(Task 5)

- [ ] **Step 1: 실패 테스트 작성**

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// api 모듈은 기존 컴포넌트 테스트와 동일한 방식으로 vi.mock 한다.
// 게시본 그래프: 노드 2개(소요 1h + 30m, 비용 500,000 + 1,130,000, 인원 2 + 1)

describe("SP 지정 Σ 미리보기", () => {
  it("게시본이 있으면 Σ 결과가 placeholder로 노출된다", async () => {
    render(<SubprocessDesignationModal {...props} />);
    await waitFor(() => {
      expect(screen.getByLabelText("Duration / run (h)")).toHaveAttribute("placeholder", "1h30m");
    });
    expect(screen.getByLabelText("Cost / run (KRW)")).toHaveAttribute("placeholder", "1,630,000");
    expect(screen.getByLabelText("Headcount / run")).toHaveAttribute("placeholder", "1.50");
  });

  it("게시본이 없으면 placeholder가 없다", async () => {
    render(<SubprocessDesignationModal {...propsWithoutPublished} />);
    await waitFor(() => {
      expect(screen.getByLabelText("Duration / run (h)")).not.toHaveAttribute("placeholder");
    });
  });
});
```

(props·mock 형태는 기존 `subprocess-designation-modal.tsx`의 실제 시그니처를 읽고 맞춘다. 게시본 그래프는 `fetchGraph` 계열 API를 mock 해 주입.)

- [ ] **Step 2: 실패 확인**

```bash
cd frontend && npx vitest run src/components/permissions/subprocess-designation-modal.test.tsx
```
Expected: FAIL — placeholder 없음.

- [ ] **Step 3: 모달 구현**

- 파라미터 행 렌더를 `PARAM_FIELDS` → **`SP_PARAM_FIELDS`**(4행: duration·cost_krw·cost_usd·headcount)로 교체.
- 모달 오픈 시(게시본 존재 시) 그래프를 한 번 로드해 4개 Σ 값을 계산, `previews: Record<SpParamField, string>` state에 저장.
- 각 `ParamInput`에 `placeholder={previewText(key)}`를 넘긴다:

```typescript
  const previewText = (field: SpParamField): string | undefined => {
    const raw = previews[field];
    if (!raw) return undefined;
    if (field === "duration") return formatDurationHm(raw);
    if (field === "cost_krw" || field === "cost_usd") return formatThousands(raw);
    return raw; // headcount 평균은 "1.50" 형태 그대로
  };
```

- placeholder 스타일(회색 이탤릭)은 입력 클래스에 `placeholder:italic placeholder:text-ink-tertiary` 추가.
- Σ 버튼은 4행 **전부**에 노출(기존 `key !== "headcount"` 조건 삭제). 클릭 시 기존 `handleSum`이 값을 채운다.
- **비용 배타**: `cost_krw`에 값이 있으면 `cost_usd` 입력과 그 Σ 버튼을 `disabled`, 반대도 동일.

- [ ] **Step 4: 패널·인스펙터 카드 반영**

`subprocess-designation-panel.tsx`와 `subprocess-inspector-card.tsx`의 표시 행 목록을 SP 3종(비용 2필드)으로 교체하고, 비용은 `formatThousands` + 통화 기호, duration은 `formatDurationHm`으로 표시한다. `field.etf`/`field.extra` 행은 삭제.

- [ ] **Step 5: 통과 확인**

```bash
cd frontend && npx vitest run && npx tsc --noEmit && npm run lint
```
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/components PROGRESS.md
git commit -m "feat(sp): preview sum results as placeholders in designation form — Σ 결과 placeholder 미리보기"
```

---

### Task 7: 에디터 — SP 노드 부분 편집 + 인스펙터/요약/비교 반영

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (인스펙터 파라미터 섹션 ~7640-7720, AppNode data 매핑 512-520·616-620·1185-1200, 노드 생성 기본값 3049·3664·3714, `nodeDisplayFields` 5646)
- Modify: `frontend/src/components/node-summary-modal.tsx`
- Modify: `frontend/src/app/maps/[mapId]/compare/page.tsx:168-209,1161-1165`
- Modify: `frontend/src/components/group-bulk-modal.tsx` (라벨 키만)
- Test: `frontend/src/lib/params.test.ts`(편집 집합은 Task 3에서 커버), 수동 확인 스텝 포함

**Interfaces:**
- Consumes: `getEditableParamFields`, `SP_PARAM_FIELDS`, `PARAM_LABEL_KEY`

- [ ] **Step 1: 인스펙터·요약 모달 — 편집 가능 필드 분기**

인스펙터/요약 모달의 파라미터 섹션을 다음 규칙으로 렌더:

```typescript
const editable = getEditableParamFields(node.node_type);
// 모든 노드: PARAM_FIELDS 순서로 6행을 그리되,
//  - editable에 포함되면 ParamInput(입력 가능)
//  - subprocess의 나머지 4행은 링크 맵 지정값을 읽기전용 텍스트로(값 없으면 "—")
```

서브프로세스 노드의 읽기전용 4행 값은 `selectedSpRef`(page.tsx 7716 근처의 기존 매핑)에서 가져오고, 표시형은 duration→`formatDurationHm`, 비용→통화기호+`formatThousands`.

- [ ] **Step 2: 노드 데이터·생성 기본값 갱신**

`page.tsx`의 AppNode data 매핑 3곳(512-520, 616-620, 7316-7320)과 노드 생성 기본값 3곳(3049, 3664, 3714)에서 구 키를 새 키로 바꾸고 `cost_usd`를 추가한다. `subprocess_refs` 매핑(1185-1200)은 `spCostKrw`·`spCostUsd`·`spHeadcount`로.

- [ ] **Step 3: 비교 화면**

`compare/page.tsx`의 라벨 맵(168-172)·필드 목록(1161-1165)·노드 스냅샷(205-209)을 새 6키로 교체하고, `displayFieldValue`에 비용 콤마 서식을 추가:

```typescript
const displayFieldValue = (field: string, value: string): string =>
  field === "duration"
    ? formatDurationHm(value) || value
    : field === "cost_krw" || field === "cost_usd"
      ? formatThousands(value) || value
      : value;
```

- [ ] **Step 4: 게이트 + 실기동 확인**

```bash
cd frontend && npx vitest run && npx tsc --noEmit && npm run lint && npm run build
```

수동: `python -m scripts.reset_db` 후 `npm run dev`로 에디터를 열어
(1) 일반 노드에서 6필드 입력 — 비용 한쪽 입력 시 반대쪽 비활성,
(2) 서브프로세스 노드에서 연간 건수·FTE만 입력 가능하고 나머지 4개는 읽기전용 표시,
(3) 저장 후 새로고침에도 값 유지.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src PROGRESS.md
git commit -m "feat(editor): allow subprocess nodes to own annual volume and FTE — SP 노드 연간건수·FTE 입력"
```

---

### Task 8: CSV 임포트/익스포트 14컬럼

**Files:**
- Modify: `frontend/src/lib/csv-export.ts:5`(HEADER), `:line()` 행 변환
- Modify: `frontend/src/lib/csv-import.ts:62-64`(HEADER_COLUMNS), `:76-80`(길이), `:153-157`(NODE_DEFAULTS), `:185-189`(mergeNode pick), `:332-336`(행 파싱), `:355-372`(검증), `:477-481`(정규화)
- Modify: `docs/samples/*.csv`
- Test: `frontend/src/lib/csv-import.test.ts`, `frontend/src/lib/csv-export.test.ts`

**Interfaces:**
- Produces: CSV 헤더 `Name,Description,Assignee,Department,System,Duration,Cost_KRW,Cost_USD,Headcount,Annual_Count,FTE,URL,URL_Label,Next`

- [ ] **Step 1: 실패 테스트 작성** (`csv-import.test.ts`)

```typescript
it("14컬럼 헤더를 파싱한다", () => {
  const csv = [
    "Name,Description,Assignee,Department,System,Duration,Cost_KRW,Cost_USD,Headcount,Annual_Count,FTE,URL,URL_Label,Next",
    "검토,,,,,1.30,1250000,,2,1200,0.8,,,",
  ].join("\n");
  const result = parseCsv(csv);
  expect(result.errors).toEqual([]);
  expect(result.rows[0].cost_krw).toBe("1250000");
  expect(result.rows[0].annual_count).toBe("1200");
  expect(result.rows[0].fte).toBe("0.8");
});

it("콤마 표기 비용을 허용한다", () => {
  const csv = [
    "Name,Duration,Cost_KRW",
    '검토,1.30,"1,250,000"',
  ].join("\n");
  const result = parseCsv(csv);
  expect(result.errors).toEqual([]);
  expect(result.rows[0].cost_krw).toBe("1250000");
});

it("원·달러를 동시에 채운 행은 에러", () => {
  const csv = ["Name,Cost_KRW,Cost_USD", "검토,1000,10"].join("\n");
  const result = parseCsv(csv);
  expect(result.errors[0].message).toMatch(/only one/i);
});

it("구 헤더(ETF/Cost/Extra)는 미지원 헤더 에러", () => {
  const csv = ["Name,ETF", "검토,1"].join("\n");
  const result = parseCsv(csv);
  expect(result.errors.length).toBeGreaterThan(0);
});
```

(`parseCsv`의 실제 export 이름·반환 형태는 파일 상단에서 확인해 맞춘다.)

`csv-export.test.ts`에 왕복 테스트 추가: 그래프 → CSV → 파싱 시 `cost_krw`/`annual_count`/`fte` 값 보존, 비용은 **콤마 없이** 출력.

- [ ] **Step 2: 실패 확인**

```bash
cd frontend && npx vitest run src/lib/csv-import.test.ts src/lib/csv-export.test.ts
```
Expected: FAIL.

- [ ] **Step 3: 구현**

- `HEADER_COLUMNS`: `["name","description","assignee","department","system","duration","cost_krw","cost_usd","headcount","annual_count","fte","url","url_label","next"]`
- 셀 정규화: 숫자 필드는 `normalizeNumericParam(stripThousands(cell))`, duration은 기존대로 `normalizeDuration`.
- 검증: 숫자 무효 → 기존 형식의 에러 메시지(필드명 = 헤더명). 비용 양쪽 값 존재 → `` `Row ${line}: fill only one of Cost_KRW / Cost_USD` ``.
- `NODE_DEFAULTS`·`mergeNode` pick 목록에 `cost_krw`·`cost_usd`·`annual_count`·`fte` 추가(빈 값 = 유지 시맨틱 그대로).
- `csv-export.ts` `HEADER` 및 `line()`의 셀 순서를 14컬럼으로 교체(값은 raw 숫자).
- `docs/samples/*.csv` 3종의 헤더·값을 새 컬럼으로 갱신(비용은 KRW 위주, 한 행은 USD로 배타 예시).

- [ ] **Step 4: 통과 확인 + 왕복 수동 확인**

```bash
cd frontend && npx vitest run && npx tsc --noEmit
```
수동: 에디터에서 CSV 내보내기 → 그 파일을 다시 임포트 → 값 동일.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib docs/samples PROGRESS.md
git commit -m "feat(csv): 14-column schema with split cost currencies — CSV 14컬럼·통화 분리"
```

---

### Task 9: Excel 내보내기 컬럼·서식

**Files:**
- Modify: `frontend/src/lib/excel-export.ts:14-20`(row 타입), `:100-110`(행 생성), `:147-151`(COLUMNS), `:185-195`(셀·numFmt)
- Test: `frontend/src/lib/excel-export.test.ts`

**Interfaces:**
- Consumes: `buildExcelModel(graph, rootMapId)` (기존 시그니처 유지 — rootMapId 필수)

- [ ] **Step 1: 실패 테스트 작성**

```typescript
it("행 모델이 새 파라미터 6필드를 담는다", () => {
  const model = buildExcelModel(graph, 1);
  const row = model.rows[0];
  expect(row.cost_krw).toBe("1250000");
  expect(row.cost_usd).toBe("");
  expect(row.annual_count).toBe("1200");
  expect(row.fte).toBe("0.8");
});

it("컬럼 헤더가 새 라벨·순서를 따른다", () => {
  expect(COLUMNS.map((c) => c.header)).toEqual([
    "No", "Name", "Type", "Description", "Assignee", "Department", "System",
    "Duration (h)", "Cost (KRW)", "Cost (USD)", "Headcount", "Annual volume", "FTE",
    "URL", "Groups", "Next",
  ]);
});
```

- [ ] **Step 2: 실패 확인**

```bash
cd frontend && npx vitest run src/lib/excel-export.test.ts
```
Expected: FAIL.

- [ ] **Step 3: 구현**

`COLUMNS`를 위 순서로 교체(width는 기존 감각 유지: 비용 14, Annual volume 13, FTE 8). 행 값 push 순서를 컬럼과 맞추고 numFmt를 적용:

```typescript
    r.getCell(8).numFmt = "0.00";     // Duration — H.MM 표기 보존("1.30"이 1.3으로 뭉개지지 않게)
    r.getCell(9).numFmt = "#,##0";    // Cost (KRW)
    r.getCell(10).numFmt = "#,##0.00"; // Cost (USD)
    r.getCell(11).numFmt = "0.00";    // Headcount
    r.getCell(12).numFmt = "#,##0";   // Annual volume
    r.getCell(13).numFmt = "0.00";    // FTE
```

셀 값은 기존 `num()` 헬퍼로 숫자 변환(빈 값은 빈 셀 유지).

- [ ] **Step 4: 통과 확인**

```bash
cd frontend && npx vitest run && npx tsc --noEmit
```
수동: Excel 내보내기 → 열어서 비용 셀이 `1,250,000`으로 보이고 편집 시 숫자인지 확인.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/excel-export.ts frontend/src/lib/excel-export.test.ts PROGRESS.md
git commit -m "feat(excel): add cost currency columns with number formats — Excel 통화 컬럼·서식"
```

---

### Task 10: AI 변환단 — SP 제한·비용 배타 강제

**Files:**
- Modify: `frontend/src/lib/csv-import.ts:587-700`(buildGraphFromAiProposal)
- Modify: `frontend/src/app/maps/[mapId]/page.tsx:566-600`(aiNodeToGraphNode), `:1765-1780`(ops set_attr)
- Test: `frontend/src/lib/csv-import.test.ts` (AI 변환 섹션)

**Interfaces:**
- Consumes: `SUBPROCESS_OWN_FIELDS`(params.ts), `normalizeNumericParam`·`normalizeDuration`(duration.ts)
- Produces: AI 제안이 SP 노드의 금지 필드를 담고 있으면 **드롭 + 경고 문자열**을 프리뷰 warnings에 추가.

- [ ] **Step 1: 실패 테스트 작성**

```typescript
it("AI가 SP 노드의 소요시간·비용·인원을 바꾸려 하면 드롭하고 경고한다", () => {
  const base = graphWithSubprocessNode(); // linked_map_id=7, sp 지정값 보유
  const proposal = {
    kind: "graph",
    nodes: [{
      key: "k1", title: "구매 승인", node_type: "subprocess",
      attributes: { duration: "9", cost_krw: "999", headcount: "9", annual_count: "1200", fte: "0.8" },
    }],
    edges: [],
  };
  const result = buildGraphFromAiProposal(proposal, base, true);
  const node = result.graph.nodes.find((n) => n.node_type === "subprocess");
  expect(node?.annual_count).toBe("1200");  // 허용 필드는 반영
  expect(node?.fte).toBe("0.8");
  expect(node?.duration).toBe(base.nodes[0].duration); // 금지 필드는 무변경
  expect(result.warnings.join(" ")).toMatch(/subprocess/i);
});

it("AI가 비용을 원·달러 둘 다 채우면 그 노드의 비용을 반영하지 않고 경고한다", () => {
  const proposal = {
    kind: "graph",
    nodes: [{ key: "k1", title: "검토", node_type: "process",
              attributes: { cost_krw: "1000", cost_usd: "10" } }],
    edges: [],
  };
  const result = buildGraphFromAiProposal(proposal, emptyGraph(), false);
  const node = result.graph.nodes[0];
  expect(node.cost_krw).toBe("");
  expect(node.cost_usd).toBe("");
  expect(result.warnings.join(" ")).toMatch(/only one/i);
});
```

(반환 형태에 `warnings`가 없으면 기존 프리뷰 경고 채널 이름을 확인해 그것을 쓴다 — 새 채널을 만들지 말 것.)

- [ ] **Step 2: 실패 확인**

```bash
cd frontend && npx vitest run src/lib/csv-import.test.ts
```
Expected: FAIL.

- [ ] **Step 3: 구현**

`buildGraphFromAiProposal`의 노드 변환에 필드 게이트를 추가:

```typescript
// AI 계약: SP 노드는 annual_count·fte만 수정 가능. 금지 필드 에코는 드롭 + 경고
// (프롬프트만 믿지 않는다 — design 2026-07-13 §6)
const isSubprocessNode = node.node_type === "subprocess";
const allowed = isSubprocessNode ? SUBPROCESS_OWN_FIELDS : PARAM_FIELDS;
```

- 금지 필드에 값이 실려 오면 `warnings.push(...)` 후 무시(기존 노드 값 유지 = `mergeNode` pick이 빈값을 유지로 처리하도록 `""`를 넣는다).
- 비용 배타 위반: 두 필드 모두 `""`로 만들고 경고.
- 값 정규화는 CSV 경로와 동일: `normalizeDuration(...) ?? ""`, `normalizeNumericParam(stripThousands(...)) ?? ""`.

`page.tsx`의 `aiNodeToGraphNode`와 ops `set_attr` 경로에도 **동일 규칙**을 적용한다(두 경로 비대칭이 과거 버그의 원인).

- [ ] **Step 4: 통과 확인**

```bash
cd frontend && npx vitest run && npx tsc --noEmit && npm run lint && npm run build
```
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src PROGRESS.md
git commit -m "feat(ai): enforce subprocess and currency limits in graph conversion — AI 변환단 SP·통화 제한 강제"
```

---

### Task 11: 시드·문서·전체 검증

**Files:**
- Modify: `backend/scripts/seed_org_demo.py:118-125,285-295`
- Modify: `docs/db-seed.md`, `CLAUDE.md`(노드 속성 체크리스트의 필드 목록·숫자 파라미터 계약 문단)
- Modify: `PROGRESS.md`

- [ ] **Step 1: 시드 값 갱신**

`seed_org_demo.py`의 노드 데모값을 새 필드로:

```python
        # 회당 단가 데모값 — duration=H.MM(1.30=1시간30분), 비용은 통화 배타 (design 2026-07-13)
        ..., duration="1.30", cost_krw="500000", cost_usd="",
        headcount="3", annual_count="1200", fte="1.5"),
```
최소 한 노드는 `cost_usd`만 채워 배타 규칙을 시연한다. SP 지정 시드(`DESIGNATED_SPECS`)는 `sp_duration`·`sp_cost_krw`·`sp_headcount`를 채운다.

- [ ] **Step 2: DB 재생성 + 시드 실행**

```bash
cd backend && .venv/bin/python -m scripts.reset_db
```
Expected: 오류 없이 완료, 맵/버전/노드 시드 생성.

- [ ] **Step 3: 문서 갱신**

- `docs/db-seed.md`: 이번 변경으로 **DB 재생성이 필수**임을 명시(구 컬럼 폐기, 기존 cost 값 미이관).
- `CLAUDE.md`의 "노드 속성 추가 체크리스트"와 "숫자 파라미터(duration H.MM) 계약" 문단: 필드 목록을 새 6필드로 갱신하고 비용 배타 규칙(422)·SP 편집 제한을 한 줄씩 추가.

- [ ] **Step 4: 전체 게이트**

```bash
cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
cd ../frontend && npx vitest run && npx tsc --noEmit && npm run lint && npm run build
```
Expected: 전부 그린.

- [ ] **Step 5: 수동 시나리오 확인 (`npm run dev` + uvicorn)**

1. 일반 노드: 6필드 입력 → 비용 한쪽 입력 시 반대쪽 비활성 → 저장/새로고침 유지
2. 비용 표시: 포커스 아웃 시 `1,250,000`, 포커스 시 `1250000`
3. SP 지정 화면: Σ 4버튼 동작, 진입 시 placeholder(회색 이탤릭)로 예상값 노출, 인원은 평균(SP 노드 제외)
4. SP 노드: 연간 건수·FTE만 입력 가능, 나머지 4개는 하위 맵 지정값 읽기전용
5. CSV 내보내기 → 재임포트 왕복 일치, 콤마 표기 임포트 허용, 원·달러 동시 입력 행은 에러
6. Excel 내보내기 → 비용 셀 `#,##0` 서식
7. AI 채팅: "이 노드 비용 원화 120만원, 연간 3000건" → 반영. SP 노드에 소요시간 변경 요청 → 무시 + 경고

- [ ] **Step 6: 커밋**

```bash
git add backend/scripts docs CLAUDE.md PROGRESS.md
git commit -m "chore(params): refresh seed and docs for per-run param model — 시드·문서 갱신"
```

---

## Self-Review 결과

- **스펙 커버리지**: §2 데이터 모델 → T1 / §2.3 마이그레이션 → T11 / §3.1 편집 집합 → T3·T7 / §3.2 서식·배타 → T5 / §3.3 422 → T1 / §4 Σ → T4 / §4.1 placeholder → T6 / §5 CSV·Excel → T8·T9 / §6 AI → T2(백엔드)·T10(변환단) / §7 영향범위 → T1·T3·T7 / §8 검증 → 각 태스크 + T11.
- **타입 일관성**: `ParamField`(6) ⊃ `SpParamField`(4) ⊃ `SUBPROCESS_OWN_FIELDS`(2). `sumParamField`는 `SpParamField`만 받는다(연간 건수·FTE는 Σ 대상 아님 — SP 지정에 그 필드가 없으므로 일관).
- **주의**: 에디터 `page.tsx`는 ugrep이 브래킷 디렉터리를 건너뛰므로 python/find로 검색할 것.
