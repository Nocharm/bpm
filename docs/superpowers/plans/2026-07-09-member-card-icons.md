# 멤버 카드 아이콘 톤·패딩 + 조직 레벨 아이콘 세트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 맵 상세 > 허용된 인원 멤버 카드의 아이콘을 회색(`text-ink-muted`)으로 낮추고 행 왼쪽 패딩을 6px로 줄이며, 조직 레벨 아이콘을 건축+조각 세트(Landmark/Building2/Building/House/Puzzle)로 교체한다.

**Architecture:** `frontend/src/components/maps/map-detail-card.tsx` 단일 파일의 스타일 클래스·아이콘 상수 변경. 신규 컴포넌트/상태 없음. 스펙: `docs/superpowers/specs/2026-07-09-member-card-icons-design.md`.

**Tech Stack:** Next.js + Tailwind 토큰 클래스 + lucide-react. 검증: vitest(기존 147개, 이 변경으로 증감 없음) + `npm run lint` + Playwright(playwright-core+시스템 Chrome) 스크린샷.

## Global Constraints

- Raw hex 금지 — 색은 토큰 클래스만(`text-ink-muted` = `--color-ink-muted` #A0A0A8) (`rules/frontend/design.md`).
- 아이콘은 Lucide, strokeWidth 1.5 유지. 멤버 카드 아이콘 크기 22px는 기존 확정값 — 변경 금지.
- 커밋 메시지: `type(scope): English summary — 한국어 요약` + 각 커밋에 PROGRESS.md 갱신 동봉 (`rules/common/git.md`).
- 스타일 변경이라 컴포넌트 테스트 하네스(testing-library) 없음 — 신규 테스트 파일을 만들지 말 것. 검증은 vitest 무회귀 + lint + 스크린샷 육안 확인(`rules/guidelines.md` §4).
- 이 파일 외 다른 파일 수정 금지(PROGRESS.md 제외) — worktree-ui-improvement-3와의 비충돌이 브랜치 전제.

---

### Task 1: 멤버 카드 아이콘 회색 톤 + 왼쪽 패딩 6px

**Files:**
- Modify: `frontend/src/components/maps/map-detail-card.tsx:99` (MembersSkeleton 행), `:517` (멤버 행 className), `:530` (아이콘 컨테이너)
- Modify: `PROGRESS.md` (기존 2026-07-09 멤버 카드 항목에 한 줄 추가)

**Interfaces:**
- Consumes: 없음 (독립 스타일 변경)
- Produces: 없음 (Task 2와 독립 — 같은 파일이지만 다른 라인)

- [ ] **Step 1: 멤버 행 패딩 축소 (line 517)**

```
old: className={`group flex items-start justify-between gap-2 rounded-sm border px-2.5 py-1.5 transition-colors ${
new: className={`group flex items-start justify-between gap-2 rounded-sm border py-1.5 pl-1.5 pr-2.5 transition-colors ${
```

- [ ] **Step 2: 아이콘 컨테이너 회색 톤 (line 530)**

```
old: <span className="flex h-9 w-9 shrink-0 items-center justify-center self-start">
new: <span className="flex h-9 w-9 shrink-0 items-center justify-center self-start text-ink-muted">
```

ME 배지는 `MemberIcon` 내부에서 자체 `text-accent`를 지정하므로 손대지 않는다.

- [ ] **Step 3: 스켈레톤 고스트 행 패딩 동기화 (line 99)**

```
old: className="flex items-center justify-between gap-2 rounded-sm border border-hairline bg-surface px-2.5 py-1.5"
new: className="flex items-center justify-between gap-2 rounded-sm border border-hairline bg-surface py-1.5 pl-1.5 pr-2.5"
```

- [ ] **Step 4: 검증 실행**

Run (frontend/): `npx vitest run && npm run lint`
Expected: `Tests  147 passed`, lint 에러 0.

- [ ] **Step 5: PROGRESS.md 갱신 + 커밋**

PROGRESS.md의 `## 2026-07-09 — 멤버 카드 아이콘 톤·조직 레벨 아이콘 설계` 섹션에 불릿 추가:

```
- 변경 1 구현 — 아이콘 컨테이너 `text-ink-muted`·행 패딩 `pl-1.5`(스켈레톤 동기화). vitest 147·lint 0에러.
```

```bash
git add frontend/src/components/maps/map-detail-card.tsx PROGRESS.md
git commit -m "feat(members): mute member-card icon tone + tighten left padding — 멤버 카드 아이콘 회색 톤·왼쪽 패딩 축소"
```

---

### Task 2: 조직 레벨 아이콘 세트 교체 (건축 + 조각)

**Files:**
- Modify: `frontend/src/components/maps/map-detail-card.tsx:9-22` (lucide import), `:65` (LEVEL_ICONS)
- Modify: `PROGRESS.md` (같은 섹션에 한 줄 추가)

**Interfaces:**
- Consumes: 없음
- Produces: 없음 (`LEVEL_ICONS`는 이 파일 전용 상수 — 외부 소비자 없음 확인됨)

- [ ] **Step 1: lucide import 교체 (lines 9–22)**

`Boxes` 제거, `Building`·`House`·`Puzzle` 추가 (알파벳 순 유지):

```tsx
import {
  ArrowUpRight,
  Building,
  Building2,
  Copy,
  Hand,
  House,
  Landmark,
  Loader2,
  Puzzle,
  Settings,
  Trash2,
  User,
  Users,
  UsersRound,
} from "lucide-react";
```

`Users`(멤버 수 11px, lines 465·480)·`UsersRound`(사용자 그룹 행, line 86)·`Building2`(폴백, line 87)는 계속 사용 — 제거 금지.

- [ ] **Step 2: LEVEL_ICONS 교체 (line 65)**

```
old: const LEVEL_ICONS = [Landmark, Building2, Users, UsersRound, Boxes];
new: const LEVEL_ICONS = [Landmark, Building2, Building, House, Puzzle];
```

deptLevelRank 순서(센터/담당/팀/그룹/파트) 그대로. 위 주석(line 64)은 여전히 정확 — 수정하지 않는다.

- [ ] **Step 3: 검증 실행**

Run (frontend/): `npx vitest run && npm run lint`
Expected: `Tests  147 passed`, lint 에러 0.

- [ ] **Step 4: PROGRESS.md 갱신 + 커밋**

같은 섹션에 불릿 추가:

```
- 변경 2 구현 — `LEVEL_ICONS`=[Landmark, Building2, Building, House, Puzzle]·`Boxes` import 제거. vitest 147·lint 0에러.
```

```bash
git add frontend/src/components/maps/map-detail-card.tsx PROGRESS.md
git commit -m "feat(members): architectural org-level icon ladder + puzzle part — 조직 레벨 아이콘 건축 사다리·파트 퍼즐"
```

---

### Task 3: 시각 검증 — :3002 기동 + 스크린샷 + 사용자 확인

**Files:**
- Create: 스크린샷 스크립트는 scratchpad(세션 임시 디렉터리)에만 — 저장소에 추가하지 않는다.

**Interfaces:**
- Consumes: Task 1·2가 커밋된 워킹 트리
- Produces: 멤버 카드 스크린샷(사용자 육안 확인 게이트)

- [ ] **Step 1: 백엔드 준비 (워크트리 backend/, 코드 무변경 — 실행 환경만)**

```bash
cd backend
uv venv .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt
# uv 없으면: python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m scripts.reset_db   # sqlite dev.db 생성 + 데모 시드 (docs/db-seed.md)
```

- [ ] **Step 2: 포트 확인 후 서버 기동 (백그라운드)**

```bash
lsof -nP -iTCP:8000 -iTCP:3002 -sTCP:LISTEN   # 점유 시 중단하고 보고 — 임의 kill 금지
cd backend && .venv/bin/uvicorn app.main:app --port 8000     # bg
cd frontend && npm run dev -- -p 3002                         # bg (BACKEND_URL 기본 8000)
```

Expected: `curl -s localhost:3002` 200, `curl -s localhost:8000/api/maps` JSON.
주의: dev 서버가 3002 점유 시 3003으로 폴백함 — 기동 로그에서 실제 포트 확인(`docs/lessons/browser-verification.md` 좀비 함정).

- [ ] **Step 3: Playwright 스크린샷 (scratchpad 스크립트)**

playwright-core + 시스템 Chrome(`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`), `bpm.devUser=admin.sys`·`bpm.lang=en` localStorage 주입(기존 `scripts/pw-smoke-korean-names.mjs` 부트스트랩 재사용). `http://localhost:3002/` 홈에서 멤버(유저·부서 여러 레벨·사용자 그룹)가 있는 맵을 선택해 우측 상세 패널의 허용된 인원 섹션을 `locator.screenshot()`으로 저장. 부서 레벨별(센터/담당/팀/그룹/파트) 아이콘이 모두 보이는 맵이 없으면 보이는 레벨만으로 확인하고 보고에 명시.

Expected: 스크린샷에서 ① 아이콘 회색·ME 배지 액센트 ② 왼쪽 패딩 축소 ③ 새 레벨 아이콘 확인.

- [ ] **Step 4: 사용자 확인 게이트**

스크린샷을 사용자에게 전송(SendUserFile)하고 :3002 주소 안내. 사용자 OK가 나올 때까지 머지 단계로 넘어가지 않는다. 세션 종료 시 dev 서버가 함께 종료될 수 있음 — 오래 볼 경우 사용자 터미널에서 `! npm run dev -- -p 3002` 안내.

---

## 완료 후

superpowers:finishing-a-development-branch 스킬로 머지/PR 여부를 사용자에게 확인한다(main 직접 머지가 저장소 관례 — ui-improvement-2·3 선례).
