# 자동 로그인 + 딥링크 복원 (Auto Login & Deep-link Restore) — Design

2026-07-09 승인. 딥링크(`/maps/12`) 직접 진입 시 Keycloak SSO 세션이 있으면 로그인 버튼 클릭 없이
자동 로그인 후 원래 페이지로 복귀한다. 세션이 없으면 현행 앱 로그인 카드를 유지한다.

## 문제 (현행)

1. **자동 로그인 없음** — 미인증 상태로 보호 경로 진입 시 `AuthGate`(`providers.tsx`)가 `/login`으로
   보내고 끝. Keycloak 세션이 살아있어도 버튼을 눌러야 `signinRedirect()`가 실행된다.
2. **딥링크 유실** — `redirect_uri`가 항상 origin(`/`)이고 원래 경로를 저장하지 않아 로그인 성공 후
   홈으로 떨어진다. 버튼을 눌러 로그인해도 `/maps/12`로 돌아가지 못한다.
3. **로그아웃 제약** — `top-nav.tsx`의 로그아웃은 `removeUser()`만 호출(로컬 토큰 제거)하고 Keycloak
   SSO 세션은 끊지 않는다. 무조건 자동 로그인을 걸면 로그아웃 직후 즉시 재로그인되어 로그아웃 불가.

## 결정

- **세션 없는 사용자 처리: 앱 로그인 카드 유지** — `prompt=none` 사전 체크(전체 리다이렉트 왕복 1회).
  세션 있으면 자동 로그인, 없으면 `error=login_required`로 복귀 → 현행 카드+버튼 표시.
  (대안이었던 "무조건 signinRedirect로 Keycloak 폼 직행"은 기각 — 사용자 선택.)
- 자동 시도 억제는 sessionStorage 플래그 하나(`bpm.autoLoginSkip`, 탭 단위)로 통일.

## 설계

변경은 frontend 3곳.

### 1. `src/components/providers.tsx` — 딥링크 보존 + login_required 처리

- `AuthGate`가 `/login`으로 replace하기 전에 `sessionStorage["bpm.returnTo"] = pathname + search` 저장.
- 로그인 성공(`auth.isAuthenticated`) 후 returnTo가 있으면 **검증 후** `router.replace(returnTo)` + 키 제거.
  - 검증: `/`로 시작하고 `//`로 시작하지 않는 내부 경로만 허용(open redirect 방지). 실패 시 무시(홈 유지).
- prompt=none 실패 시 Keycloak이 `error=login_required`(또는 `interaction_required`)로 복귀 →
  `auth.error`를 에러 화면이 아니라 "세션 없음" 신호로 해석: `bpm.autoLoginSkip` 세팅 후 `/login`으로
  replace(returnTo는 유지). 그 외 에러는 현행 에러 화면 유지.
- `DevGate`(로컬 모드)에도 같은 returnTo 저장/복원 적용.

### 2. `src/app/login/page.tsx` + `src/lib/keycloak-login.ts` — 자동 silent 시도

- `signinRedirectFromLogin(options?: { promptNone?: boolean })`로 확장 — `prompt: "none"` 전달 지원.
- `/login` mount 시 `AUTH_ENABLED`이고 `bpm.autoLoginSkip` 없으면 자동으로
  `signinRedirect({ prompt: "none" })` 실행. 로그인 카드는 그대로 렌더(잠깐 보이는 화면).
  - 세션 있음 → Keycloak이 폼 없이 즉시 복귀 → 자동 로그인 → returnTo로 이동.
  - 세션 없음 → login_required 복귀 → 플래그 세팅 → 카드에서 대기(자동 재시도 없음 → 루프 방지).
- 버튼 수동 클릭 시 플래그 제거 후 일반 `signinRedirect()`(prompt 없음).

### 3. `src/components/top-nav.tsx` — 로그아웃 보호

- `onLogout`에서 `bpm.autoLoginSkip` 세팅 → 로그아웃 직후 자동 로그인 억제.

### 플래그 수명 (`bpm.autoLoginSkip`, sessionStorage)

| 시점 | 동작 |
|------|------|
| 로그아웃 | 세팅 |
| prompt=none 실패(login_required) | 세팅 |
| 로그인 버튼 수동 클릭 | 제거 |
| 로그인 성공 | 제거 |

## 검증

- 로컬(dev 모드): DevGate returnTo 복원을 Playwright로 확인 — 딥링크 → 로그인 → 원래 맵 복귀.
- returnTo 검증 헬퍼는 단위 테스트.
- Keycloak prompt=none 경로는 로컬에 Keycloak이 없어 **서버 배포 후 실검증 필요**. 시나리오 3케이스:
  ① SSO 세션 있음 + 딥링크 → 버튼 없이 원래 페이지 복귀,
  ② 세션 없음 → 로그인 카드 표시(루프 없음), 버튼 로그인 후 딥링크 복귀,
  ③ 로그아웃 직후 → 자동 재로그인 없이 로그인 카드 유지.
- 리스크: Keycloak 클라이언트 설정에 따라 prompt=none 응답이 다를 수 있음. 실패해도 플래그 덕에
  현행 흐름(버튼 클릭)으로 폴백되므로 배포 안전.

## 2차 라운드 (2026-07-09, 사용자 피드백 반영)

1. **부드러운 전환** — 리다이렉트 체인 중 클릭 가능한 로그인 카드가 플래시되는 문제.
   `AuthLoadingScreen`(브랜드 아이콘+스피너, `animate-item-in` 페이드) 신설: `/login` silent 시도 중 카드 대신
   렌더, AuthGate의 로딩·returnTo 대기 플레이스홀더도 교체. 인위적 지연 없음(짧은 전환은 페이드로 흡수).
2. **정상접근도 자동 로그인** — 억제 플래그를 소비형(`consumeAutoLoginSkip`)으로 변경: 로그아웃/silent 실패
   직후 "다음 로그인 페이지 1회"만 카드 유지, 이후 방문은 세션 있으면 다시 자동 로그인. 판정은 모듈 캐시
   `shouldAutoAttempt()`로 페이지 로드당 1회(StrictMode 이중 실행에도 consume 1번). 시도 실패(네트워크) 시
   플래그 원복해 다음 방문 자동 시도 유지.
3. **비공개 맵 403 게이트** — 백엔드는 이미 `require_map_role("viewer")`로 차단(데이터 유출 아님). 프론트가
   raw 에러 문자열만 보여주던 것을: `ApiError(status)` 신설(api.ts) → 에디터 초기 로드 403이면 ConfirmDialog
   (Lock 아이콘, 단일 확인 버튼 — `cancelLabel` 옵셔널화) 표시, 확인/닫기 모두 홈 이동. `/maps/N/settings`·
   `/compare`의 403, 404 처리는 범위 외(후속).
   검증: `pw-smoke-map-403.mjs`(라우트 목 403 주입 — 권한 시뮬레이션 세팅 불필요) 4체크.
