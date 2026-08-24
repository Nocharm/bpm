# React / TypeScript 패턴 (이 코드베이스)

`page.tsx`는 ~6700줄 단일 클라이언트 컴포넌트라 훅 순서·클로저·deps 함정이 잦다.

## 1. TDZ — useCallback deps에 "뒤에 정의된" 값 금지
- `useCallback(..., [x])`의 deps 배열은 **렌더 중(정의 시점) 평가**된다. `x`가 그 콜백보다 **아래에서 `const`로 정의**되면 ReferenceError(TDZ).
- 해결: ① 콜백을 의존 대상보다 **뒤로 이동**, 또는 ② 의존 대상을 **ref 미러**로 읽고 deps에서 제외. 예: `handleAddNode`가 한참 뒤의 `inlineComposition`을 써야 해서 `inlineCompositionRef`(미러 effect)로 읽음.

## 2. ref 미러로 stale 클로저 회피
- 이벤트 핸들러/타이머는 최신 state를 `nodesRef`/`childNodesRef`/`fullGraphRef`/`edgesRef` 등 ref 미러로 읽는다(`useEffect(() => { ref.current = state }, [state])`). setState 클로저의 stale 값을 피함.

## 3. effect 내 동기 setState 린트
- `react-hooks/set-state-in-effect` 경고: effect가 동기로 setState. **deps에 자기 state가 없어 cascade 루프가 없으면 안전** → `// eslint-disable-next-line react-hooks/set-state-in-effect` + 이유 주석(예: childNodes materialize effect).

## 4. 큰 상태 모델 변경 — 메인 state 오염 금지
- 새 데이터(예: 펼친 자식)를 **기존 핵심 state에 합치지 말 것.** 그 state에 깔린 가정(예: `nodes`=현재 스코프)이 광범위하게 깨진다. 별도 state + 합성/분배 레이어로. (1차 merge-into-state 시도가 광범위 회귀로 reset된 교훈 — `canvas-react-flow.md` 1번.)

## 5. 낙관적 업데이트
- 서버 저장(getGraph→PUT)은 비동기·디바운스. 즉시 반영이 필요하면 권위 캐시(`fullGraph`)를 낙관적으로 먼저 수정 → 파생 렌더가 따라옴. 저장 후 `refreshFullGraph`로 재동기화. (`scope-save-and-coordinates.md` 2번.)

## 6. React Compiler — 수동 메모 불일치 = 빌드 실패
- `react-hooks/preserve-manual-memoization`: `useCallback`/`useMemo`의 **추론 deps ≠ 선언 deps**면 `npm run lint`/`build` 실패. 특히 핸들러가 setState만 호출하면 컴파일러가 **setter를 dep로 추론** → 선언 deps와 어긋남.
- 해결: 사소한 핸들러는 **plain 함수**로(컴파일러 자동 메모), 또는 deps 정렬. 이번 라운드에서 create-map-dialog 핸들러·버전 핸들러 등 반복 발생.

## 7. useEffectEvent — "이펙트 내부" 최신값 읽기는 ref 미러 대신 이것 (React 19.2+)
- **이펙트 안**(타이머·구독 콜백 포함)에서 최신 state/props를 읽되 재구독을 원치 않으면 `useEffectEvent`로 뺀다 — deps에서 그 값이 빠져 인터벌/리스너가 유지된다. 적용례: 체크아웃 폴링(`page.tsx`) — `versions` 배열 identity·`t`가 deps에 있어 목록 갱신·언어 전환마다 인터벌 재구독 + `acquireCheckout` 즉시 재호출되던 것을 제거.
- **이펙트 밖에선 호출 금지**(lint 강제) — 이벤트 핸들러/props로 전달 불가. **비이펙트 콜백**(§1 TDZ, §2 stale 클로저)의 최신값 읽기는 여전히 ref 미러가 정답.
- 반응해야 하는 값까지 빼면 안 됨 — 예: 폴링 시작/정지를 가르는 버전 status는 **파생값으로 좁혀 deps에 남긴다**(`selectedVersionStatus`). identity가 변하는 배열 대신 실제 판단 기준을 dep로.

## 8. `<Activity>` — 이 코드베이스에선 함부로 쓰지 말 것 (React 19.2+)
- `mode="hidden"`은 state·DOM을 보존하지만 **이펙트를 정지**(cleanup 실행, 재표시 때 재실행). 탭 전환 시 state 소실을 막는 정석 도구지만, 아래 기존 설계와 충돌한다:
  - **숨김 중에도 이펙트가 돌아야 하는 패널** — 에디터 승인 배지 패널(`PendingApprovalsPanel`, 접혀도 fetch가 배지의 유일한 소스)은 수동 `display:none`(hidden) 유지가 맞다. Activity로 바꾸면 배지가 멈춘다.
  - **의도적 강제 리마운트** — 홈 `FrameworkTree`는 `key={frameworkVersion}`로 캐시 무효화. Activity 보존과 상충.
  - **Playwright strict mode** — 숨긴 패널이 DOM에 남아 텍스트/`data-id` 셀렉터가 다중 매치 → 기존 pw 스모크가 깨질 수 있다. 도입 시 해당 표면 스모크 전수 재실행 필수.
- 요약: 신규 탭형 UI에서 "전환 시 로컬 state 소실"이 실제 문제일 때만, 위 3함정을 점검하고 도입.
