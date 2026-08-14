# 상단 네비 4단계 반응형 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** top-nav를 폭 실측 기반 4단계 누적 강등(탭 활성만 라벨→피드백 아이콘→언어 토글 1개→이름 아이콘)으로 반응형화.

**Architecture:** 순수 판정 함수(`lib/display-stage.ts`, TDD) + `top-nav.tsx` 내 측정 복제 4개(S0~S3, 비상호작용 스팬)와 ResizeObserver로 stage state(0~4)를 산정, 단계별 조건 렌더. 검증은 신규 Playwright 스크립트.

**Tech Stack:** Next.js + TS strict + Tailwind 토큰, vitest, Playwright+시스템 Chrome.

**Spec:** `docs/superpowers/specs/2026-08-14-topnav-responsive-design.md` (사용자 승인 완료 — 단계 정의 §3·판정 §4·검증 §5는 스펙이 진실)

## Global Constraints

- **작업 위치**: 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/frontend-minor` (브랜치 `fix/frontend-minor`). 디스패치 시 절대경로 + `pwd`·브랜치 확인 필수. frontend 명령은 `frontend/`에서.
- raw hex 금지(토큰만), Lucide strokeWidth 1.5(탭/버튼 14px, 이름 아이콘 16px), 이모지 금지, UI 영어(i18n EN·KO 양쪽).
- React Compiler: trivial setState 핸들러 plain function, RO 초기 산정은 rAF 이연(page.tsx 필터 훅 선례).
- 측정 복제: `aria-hidden` + `invisible absolute pointer-events-none`, dataId 없음, 상호작용 요소 금지(스팬만), InboxBadge/NotificationBell은 정적 플레이스홀더.
- 오버플로 검증에 `scrollWidth` 금지(복제 오염 — T9 교훈) — 가시 요소 bounding rect로.
- 커밋마다 PROGRESS.md 동봉(`## 2026-08-14 — 협업자 스테이징 UX 구현 (fix/frontend-minor)` 섹션 위에 `## 2026-08-14 — 상단 네비 반응형 (fix/frontend-minor)` 섹션 신설·불릿 추가), 메시지 `type(scope): English — 한국어`.
- 게이트(각 태스크): 해당 vitest + `npx tsc --noEmit` + `npm run lint`. T3에서 build+브라우저.

---

### Task 1: `lib/display-stage.ts` (TDD)

**Files:**
- Create: `frontend/src/lib/display-stage.ts`
- Test: `frontend/src/lib/display-stage.test.ts`

**Interfaces:**
- Produces: `pickDisplayStage(available: number, stageWidths: number[], marginPx = 8): number` — Task 2가 소비. stageWidths[i]=단계 i 소요 폭(내림차순 전제), 반환 0..stageWidths.length(전부 불가 시 length=최종 강등).

- [ ] **Step 1: 실패 테스트 작성**

```ts
import { describe, expect, it } from "vitest";

import { pickDisplayStage } from "./display-stage";

describe("pickDisplayStage", () => {
  const widths = [500, 420, 360, 300]; // S0~S3 소요 폭

  it("최상 단계가 들어가면 0", () => {
    expect(pickDisplayStage(508, widths)).toBe(0);
  });

  it("여유 미달 시 다음 단계로 내려간다(margin 8 포함)", () => {
    expect(pickDisplayStage(507, widths)).toBe(1);
    expect(pickDisplayStage(428, widths)).toBe(1);
    expect(pickDisplayStage(427, widths)).toBe(2);
  });

  it("측정된 전 단계가 안 들어가면 최종 강등(stageWidths.length)", () => {
    expect(pickDisplayStage(307, widths)).toBe(4);
  });

  it("측정 전(0 이하 폭 존재)·빈 배열은 0 유지(강등 금지)", () => {
    expect(pickDisplayStage(400, [500, 0, 360, 300])).toBe(0);
    expect(pickDisplayStage(400, [])).toBe(0);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/display-stage.test.ts` → FAIL(모듈 없음)

- [ ] **Step 3: 구현**

```ts
// 폭 실측 기반 표시 단계 판정 — 상단 네비 등 누적 강등 UI 공용. stageWidths[i]는 단계 i의
// 자연 소요 폭(내림차순). 전부 안 들어가면 미측정 최종 단계(length)로 강등. margin은 진동 방지 여유.

export function pickDisplayStage(
  available: number,
  stageWidths: number[],
  marginPx = 8,
): number {
  if (stageWidths.length === 0 || stageWidths.some((w) => w <= 0)) return 0; // 측정 전 — 강등 금지
  for (let i = 0; i < stageWidths.length; i += 1) {
    if (available >= stageWidths[i] + marginPx) return i;
  }
  return stageWidths.length;
}
```

- [ ] **Step 4: 그린 확인** — `npx vitest run src/lib/display-stage.test.ts && npx tsc --noEmit` → PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/display-stage.ts frontend/src/lib/display-stage.test.ts PROGRESS.md
git commit -m "feat(nav): pickDisplayStage width-based stage picker — 폭 실측 단계 판정 유틸"
```

---

### Task 2: `top-nav.tsx` 4단계 반응형 + i18n

**Files:**
- Modify: `frontend/src/components/top-nav.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts` (EN·KO 양쪽)

**Interfaces:**
- Consumes: Task 1 `pickDisplayStage`, 기존 `Tooltip`, lucide `User`.
- Produces: stage별 DOM(Task 3 스크립트가 단언) — 탭 라벨 span은 상시 렌더하되 비가시 단계에선 `max-w-0 opacity-0`(가시성 판정은 offsetWidth), 피드백 아이콘 버튼은 `data-id="nav-feedback"` 유지 여부 무관(기존에 dataId 없음 — 추가 금지), 이름 아이콘 버튼은 기존 드롭다운 그대로.

- [ ] **Step 1: i18n 키(EN·KO)**

```ts
// EN
"nav.langSwitchEn": "Switch to English",
"nav.langSwitchKo": "Switch to Korean",
// KO
"nav.langSwitchEn": "영어로 전환",
"nav.langSwitchKo": "한국어로 전환",
```

- [ ] **Step 2: stage 산정 배선** — TopNav 본문에:

```ts
  const navRef = useRef<HTMLElement | null>(null);
  const cloneRefs = [useRef<HTMLDivElement | null>(null), useRef<HTMLDivElement | null>(null), useRef<HTMLDivElement | null>(null), useRef<HTMLDivElement | null>(null)];
  const [stage, setStage] = useState(0);
  const userName = user?.name ?? "";

  // 실측 4복제(S0~S3) 자연폭 vs nav 가용폭(clientWidth − px-4 32px). rAF 초기 산정 + RO.
  // deps: 언어·이름·활성 탭 라벨이 폭 변수(page.tsx 필터 모드 훅 선례).
  useEffect(() => {
    const nav = navRef.current;
    const clones = cloneRefs.map((r) => r.current);
    if (!nav || clones.some((c) => c === null)) return;
    const update = () => {
      setStage(
        pickDisplayStage(
          nav.clientWidth - 32,
          clones.map((c) => c?.scrollWidth ?? 0),
        ),
      );
    };
    const raf = requestAnimationFrame(update);
    const ro = new ResizeObserver(update);
    ro.observe(nav);
    for (const c of clones) if (c) ro.observe(c);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint 경고 시 cloneRefs 배열은 렌더마다 새 배열 — refs를 개별 상수 4개로 선언해 deps 안정화
  }, [lang, userName, tabIndex]);
```

주의: `cloneRefs`를 배열 리터럴로 만들면 훅 규칙/컴파일러와 충돌 여지 — **개별 `useRef` 4개**(`measure0Ref`~`measure3Ref`)로 선언하고 배열은 effect 내부에서 조립한다.

- [ ] **Step 3: 측정 복제 마크업** — nav에 `ref={navRef}` + `relative` 추가, 자식 맨 끝에 4개 복제:

```tsx
      {/* 측정 복제 S0~S3 — 좌그룹+스페이서+우그룹 한 줄 자연폭. 비상호작용 스팬만(클론이
          폴링·포커스를 만들면 안 됨), 뱃지/벨은 정적 플레이스홀더. T9 교훈: 이 복제들 때문에
          nav.scrollWidth는 오염되므로 오버플로 검증은 가시 rect 기반이어야 한다. */}
      {([0, 1, 2, 3] as const).map((s) => (
        <div
          key={s}
          ref={[measure0Ref, measure1Ref, measure2Ref, measure3Ref][s]}
          aria-hidden
          className="pointer-events-none invisible absolute left-0 top-0 flex items-center"
        >
          <NavMeasureRow stage={s} lang={lang} userName={userName} activeIdx={tabIndex} loggedIn={user !== null} t={t} />
        </div>
      ))}
```

`NavMeasureRow`는 top-nav.tsx 모듈 레벨 비공개 컴포넌트 — 라이브와 동일 클래스의 span 구성:
브랜드(text-body-strong) · 16px 스페이서 · 탭 세그먼트(stage 0=아이콘+라벨 3개 / ≥1=활성만 라벨,
라벨은 실제 `t(labelKey)` 텍스트, 인박스 뱃지 플레이스홀더 `<span className="inline-block h-4 w-4" />`)
· 매뉴얼 아이콘 자리(`p-1.5`+14 아이콘) · 피드백(stage<2=아이콘+라벨 / ≥2=`p-1.5` 아이콘) ·
벨 플레이스홀더(`p-1.5`+16) · 이름(stage<4... S3 복제까지는 텍스트 `userName`, 비로그인 시 `t("nav.login")`)
· 언어 토글(stage<3=2버튼 / =3: 현재 언어 1버튼). gap은 라이브와 동일(`gap-4`/`gap-3`) 재현.
아이콘은 실제 lucide 컴포넌트 사용(크기 동일성 — 상호작용 없음).

- [ ] **Step 4: 단계별 라이브 렌더 전환**

(a) **탭(S1+)** — 세그먼트 래퍼를 `inline-flex gap-1 rounded-sm bg-surface-alt p-1 text-fine`로 통일,
각 탭 라벨을 span으로 감싸 IconPillFilter 문법 적용:

```tsx
                <span
                  className={
                    "overflow-hidden whitespace-nowrap transition-all duration-350 ease-smooth " +
                    (stage === 0 || active ? "ml-1 max-w-28 opacity-100" : "max-w-0 opacity-0")
                  }
                >
                  {t(tab.labelKey)}
                </span>
```

비활성 탭(stage≥1)은 `title={t(tab.labelKey)}` 부여. `InboxBadge`는 라벨 span 밖(뒤)이라 상시 렌더 유지.
아이콘과 라벨 사이 기존 `gap-1`은 라벨 span의 `ml-1`로 대체(접힘 시 잔여 갭 방지 — IconPillFilter와 동일).

(b) **피드백(S2+)**:

```tsx
        {user && (stage >= 2 ? (
          <Tooltip label={t("feedback.button")}>
            <button
              type="button"
              onClick={openFeedbackPanel}
              className="inline-flex rounded-sm border border-hairline p-1.5 text-accent hover:bg-accent-tint"
            >
              <MessageSquare size={14} strokeWidth={1.5} />
            </button>
          </Tooltip>
        ) : (
          /* 기존 아이콘+라벨 버튼 그대로 */
        ))}
```

(c) **언어 토글(S3+)** — stage<3 기존 2버튼, ≥3:

```tsx
          <Tooltip label={t(lang === "ko" ? "nav.langSwitchEn" : "nav.langSwitchKo")}>
            <button
              type="button"
              className="rounded-xs bg-accent-tint px-1.5 py-0.5 font-semibold text-accent"
              onClick={() => setLang(lang === "ko" ? "en" : "ko")}
            >
              {lang === "ko" ? t("nav.langKo") : t("nav.langEn")}
            </button>
          </Tooltip>
```

(래퍼 `inline-flex ... p-0.5` 유지 — 지오메트리 일관.)

(d) **이름(S4)** — user 존재 시 stage>=4면 버튼 내용만 교체:

```tsx
              {stage >= 4 ? (
                <Tooltip label={user.name}>
                  <span className="inline-flex"><User size={16} strokeWidth={1.5} /></span>
                </Tooltip>
              ) : (
                user.name
              )}
```

(버튼·드롭다운 구조 불변. lucide `User` 임포트 — 기존 `user` 변수와 충돌 없게 임포트명 확인.)

- [ ] **Step 5: 게이트** — `npx vitest run && npx tsc --noEmit && npm run lint` 전부 그린. 수동 확인:
`npm run dev` 없이도 tsc가 Tooltip children 제약(단일 요소) 충족 확인.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/top-nav.tsx frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(nav): 4-stage responsive top nav via measured widths — 상단 네비 실측 4단계 반응형"
```

---

### Task 3: 브라우저 검증 + 전체 게이트

**Files:**
- Create: `frontend/scripts/pw-verify-topnav-responsive.mjs`
- Modify: (검증 발견 결함 픽스 — 특히 복제 플레이스홀더 폭 보정)

- [ ] **Step 1: 서버 기동** — 기존 검증 태스크와 동일(`docs/lessons/browser-verification.md` 준수):
좀비 정리 → backend reset_db + uvicorn 8000 (`DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys`) → frontend 3000.

- [ ] **Step 2: 스크립트 작성** — 기존 `pw-verify-home-filter-responsive.mjs` 구조 재사용. 뷰포트
1440/1200/1000/860/760 × EN·KO, 로그인 유저로 각 조합에서:
  - nav 가시 자식들(복제 제외 — `aria-hidden` 아님 + offsetWidth>0 필터) 세로 중심 동일(±1px)
  - 가시 요소 `getBoundingClientRect().right <= nav rect.right + 1` (오버플로 없음 — `scrollWidth` 금지)
  - 앵커 단언: 1440px = S0(탭 라벨 3개 offsetWidth>0) · 760px = S4(이름 텍스트 대신 svg 아이콘, 언어 버튼 1개, 피드백 라벨 없음, 탭 라벨 ≤1)
  - 스크린샷 스크래치패드 저장
- [ ] **Step 3: 실행·픽스 루프** — 실패 시 원인 규명 후 최소 수정(복제 폭 보정 등), 재실행. 같은 픽스 2회 실패 시 중단·보고.
- [ ] **Step 4: 전체 게이트** — `npx vitest run && npx tsc --noEmit && npm run lint && npm run build`. 서버 종료.
- [ ] **Step 5: Commit**

```bash
git add frontend/scripts/pw-verify-topnav-responsive.mjs PROGRESS.md
git commit -m "test(nav): browser verification for responsive top nav — 상단 네비 반응형 실구동 검증"
```

---

## Self-Review 결과

- **스펙 커버리지**: §3 단계=T2 Step 4(a~d) · §4 판정=T1+T2 Step 2-3 · §5 검증=T1 테스트+T3. 갭 없음.
- **타입 일관성**: `pickDisplayStage` 시그니처 T1 정의 ↔ T2 소비 일치. stage 0..4 의미 통일(4=최종, 복제는 0~3만).
- **알려진 유동 지점**(실행 시 실측 판단): 복제 플레이스홀더(뱃지 h-4 w-4·벨 p-1.5+16)의 근사 오차 — T3 실측에서 보정. Tooltip children 제약(래퍼 span 필요 여부)은 tsc가 판정.
