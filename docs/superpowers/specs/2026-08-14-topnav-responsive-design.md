# 상단 네비 4단계 반응형 — 설계 스펙

- **날짜**: 2026-08-14
- **상태**: 사용자 승인 완료 (구현 전)
- **브랜치**: `fix/frontend-minor` (dev 831bac2 동기화 후 착수)
- **관련**: 홈 필터 3단계 반응형(⑦, `lib/filter-display.ts` — 측정 복제+RO 패턴)의 확장 적용

## 0. 목표 (한 줄)

`top-nav.tsx`가 좁은 폭에서 깨지지 않도록, 폭 실측 기반으로 4단계 누적 강등(탭 활성만 라벨 →
피드백 아이콘 → 언어 토글 1개 → 이름 아이콘)을 적용한다.

## 1. 확정된 결정 (사용자 Q&A)

| 결정 | 선택 |
|---|---|
| 탭 아코디언 해석 | **활성만 라벨 확장** — 비활성 아이콘만+툴팁, 활성 아이콘+라벨(IconPillFilter 문법, 350ms 슬라이드). 원클릭 이동 유지 |
| 강등 순서 | 사용자 명시 순서 그대로 누적: S1 탭 → S2 피드백 → S3 토글 → S4 이름 |
| 판정 방식 | 고정 브레이크포인트 아닌 **실측**(언어·이름 길이·활성 라벨이 폭 변수) |

## 2. 현재 상태 (실측)

- `frontend/src/components/top-nav.tsx` (231줄): 좌 = 브랜드 Link + 탭 세그먼트
  (`grid-cols-3`, 아이콘 14px+라벨, 인박스에 `InboxBadge`), 우 = 매뉴얼 아이콘 Link(이미 아이콘만) +
  피드백 버튼(아이콘+라벨) + `NotificationBell` + 이름 버튼(드롭다운: Settings/Logout) + 한/영
  세그먼트(2버튼). 좁은 폭에서 줄바꿈/깨짐.
- 선례: `icon-pill-filter.tsx`(비활성=아이콘만·활성=아이콘+라벨, `max-w-0/28 opacity` 350ms),
  `app/page.tsx` 필터 모드 훅(측정 복제 invisible absolute + RO + rAF 초기 산정 + Clear 폭 차감).
- T9 교훈: invisible absolute 복제가 컨테이너 `scrollWidth`를 오염 — 오버플로 단언은 가시 요소
  bounding rect 기반으로.

## 3. 단계 정의 (누적, S0→S4)

| 단계 | 변화 |
|---|---|
| S0 | 현행 그대로 |
| S1 | 탭: 비활성 아이콘만+`title`, 활성 아이콘+라벨(라벨 span `max-w`/`opacity` 350ms `ease-smooth`). 래퍼 `grid-cols-3`→`inline-flex`(단계 무관 통일 가능 — 시각 동일 검증). **InboxBadge는 라벨 유무와 무관하게 상시 렌더** |
| S2 | + 피드백 버튼 아이콘만 — 매뉴얼 아이콘 버튼과 동일 스타일(`border border-hairline p-1.5`) + `Tooltip`(라벨=`feedback.button`) |
| S3 | + 한/영 토글: **현재 언어 버튼 1개만**, 클릭=즉시 반대 언어 전환. `Tooltip` — 신규 i18n `nav.langSwitchEn`("Switch to English"/"영어로 전환")·`nav.langSwitchKo`("Switch to Korean"/"한국어로 전환") |
| S4 | + 이름 버튼 → `User` 아이콘 16px + `Tooltip`(=user.name), 드롭다운 동작 불변. 비로그인 Login 버튼은 전 단계 불변 |

## 4. 판정 로직

- 신규 `lib/display-stage.ts`:

```ts
/** 측정된 단계별 소요 폭(내림차순)에서 처음 들어가는 단계를 선택. 전부 안 맞으면
 * stageWidths.length(최종 강등 단계 — 미측정, 항상 수용 가정). 측정 전(0 이하 폭 존재)엔 0 유지. */
export function pickDisplayStage(available: number, stageWidths: number[], marginPx = 8): number;
```

- `top-nav.tsx` 배선: nav(relative) 안에 **측정 복제 4개(S0~S3)** — 각 복제는 좌그룹+16px 스페이서+
  우그룹을 한 줄 inline-flex로 담은 **비상호작용 스팬 마크업**(동일 클래스). `InboxBadge`·
  `NotificationBell`은 동일 크기 정적 플레이스홀더(복제가 폴링/구독을 유발하면 안 됨).
  `aria-hidden` + `invisible absolute pointer-events-none`, dataId 없음.
- `available = nav.clientWidth − 32(px-4)`. 필요 폭 = 복제의 `scrollWidth`.
- ResizeObserver(nav+복제 4) + rAF 초기 산정(`set-state-in-effect` 회피), 재측정 deps
  `[lang, user?.name ?? "", tabIndex]`.

## 5. 검증

- vitest: `display-stage.test.ts` — 최상 단계 수용/중간/전부 불가(=length)/미측정 0 유지/빈 배열 0.
- `frontend/scripts/pw-verify-topnav-responsive.mjs` 신규 — 1440/1200/1000/860/760px × EN·KO:
  ① nav 가시 요소 세로 중심 동일(줄바꿈 없음) ② 가시 요소 bounding rect가 nav 우측 경계 내
  (오버플로 없음, scrollWidth 사용 금지 — 복제 오염) ③ 1440=S0(탭 라벨 3개 가시)·760=S4(이름
  아이콘) 앵커 단언 + 중간 폭은 ①②만(단계는 언어별 상이 허용) ④ 각 조합 스크린샷.
- 전체 게이트(FE vitest/tsc/lint/build · BE 무변경).
- **검증 정정(T3 실측)**: 실 시드 콘텐츠(admin.sys="System Admin", 표준 EN/KO 라벨)는 760px에서
  S1로 충분(피드백 라벨·언어 2버튼·이름 텍스트가 아직 안 밀림) — 앵커를 760=S1로 정정, S4는 보조
  600px 케이스로 검증(avail<~644px 부터 S4, 760px 시점엔 미도달). pickDisplayStage의 "필요한
  만큼만 강등" 설계와 일치 — 버그 아님. 같은 실측 과정에서 진짜 버그 2건 발견·수정: 벨 플레이스홀더
  12px 과대측정(진짜 padding 없는 실 버튼과 불일치), 복제 4개의 `absolute left-0`(right 미지정)가
  containing block(nav 전체폭) 기준 shrink-to-fit로 좁은 뷰포트에서 자연폭을 클램프 — `w-max`로
  고정. 코드리뷰 후속: `w-max`가 자연폭을 살리며 좁은 뷰포트에서 S0 클론이 nav보다 넓어져 문서
  가로 스크롤을 유발할 수 있음이 드러나 전용 클리핑 래퍼(`absolute inset-0 overflow-hidden`,
  nav 자체엔 미적용 — 드롭다운이 nav 아래로 나가야 함)로 복제만 가두고, 검증 스크립트에
  `document.documentElement.scrollWidth <= innerWidth` 가드를 추가.

## 6. 리스크·한계

- 복제 마크업이 라이브와 드리프트하면 판정이 틀어짐 — 복제는 라이브와 같은 클래스 문자열·아이콘
  크기를 쓰고, NAV_TABS 등 상수를 공유해 완화. 최종 안전망은 브라우저 실측(§5).
- 플레이스홀더 크기(벨·뱃지)는 근사 — margin 8px로 흡수, 실측 검증에서 어긋나면 보정.
