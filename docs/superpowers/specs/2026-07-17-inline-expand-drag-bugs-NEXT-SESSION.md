# 다음 세션 핸드오프 — 인라인 펼침 상태 드래그/좌표 버그 (#2 프리즈 + #3 축고정·복제 드리프트)

> ## ✅ RESOLVED 2026-07-17 (worktree-inline-expand-drag-fix)
>
> 세 건 모두 해소. **#2의 근본 원인은 아래 가설(no-op 커밋)이 아니었다** — 라이브 계측으로 반증(제자리/소델타 커밋은 무해, 커밋 직후 프로브 정상). 진범:
>
> - **#2 = 팬텀 링 카메라 점프.** `screenRectOf`가 `nodesRef`(저장좌표)로 링 rect를 계산 → 펼침 중 footprint-shifted 노드를 드래그해 다른 노드 위에 dwell하면 링이 실제 위치보다 footprint만큼 왼쪽(대개 화면 밖)에 잡히고, `ensureRingVisible`이 그 팬텀을 향해 카메라를 200ms 애니메이션 팬(드롭 후에도 지속) → 캔버스가 통째로 밀려 직전 화면 좌표 기준 클릭/드래그가 전부 빗나감 = "하드 프리즈"로 관측(이전 계측 하네스도 옛 rect 중심을 클릭해 같은 오인). 수정: `reactFlow.getNode`(표시좌표) + 현재 스코프 멤버십 가드(임베드 자식 링 제외 유지). transform 바이트 동일 관측은 노드가 아니라 **뷰포트**가 움직였기 때문.
> - **sx 언와인드 루프**: 도달 불가 갭(앵커 점프 대역) 표시값에서 감소 사상 진동으로 발산 가능 → `lib/inline-shift.ts` `displayToSavedX`(구간 직해+앵커 클램프, vitest 7)로 대체. `suppressPosIdsRef` 2×rAF 지연 삭제는 실측상 경합 없음(원문 그대로 유지).
> - **#3a**: 수정 방향대로 — `handleNodeDrag` 라이브 기록 지점에 `constrainToAxis` 적용.
> - **#3b**: 수정 방향대로 — `applyCtrlDragCopy` 원위치 복귀를 `rootOffsets` 기반 표시→저장 환산(`resetPos`, updater 밖 선계산). 드롭 위치는 finalize의 `displayToSavedX`가 담당.
>
> 검증: 라이브 Playwright(시드 맵2 v12 펼침) — 드롭 후 재드래그 ALIVE·Shift y고정·Ctrl복제 원본 저장좌표 무오염+사본 정확 환산·평면 맵 회귀 없음. vitest 469/469·lint·tsc·build 그린. 상세는 PROGRESS.md 2026-07-17 항목.

> 편집 모드 개선(dev 머지 완료) 백로그 중 **#2, #3**은 같은 코드 영역(서브프로세스 인라인 펼침 좌표 변환 머신)의 버그라 다음 세션에서 함께 다룬다. **#1(엣지 핸들)·#4(add-node 선택)는 이 세션에서 처리 완료.** 이 문서는 재조사 비용을 줄이기 위한 근거·위치·수정 방향 기록.

## 공통 배경 — 인라인 펼침 좌표 머신 (`frontend/src/app/maps/[mapId]/page.tsx`)

서브프로세스 노드를 캔버스에서 **인라인 펼침**하면 루트 노드들의 **표시 좌표가 밀린다**(footprint shift). 관련 상태·함수:
- `inlineCompositionRef.current` = `{ rootOffsets, regions, rootShiftSteps }` — 펼침 시 각 루트 노드의 표시 오프셋.
- `dragLiveById` (state) + `dragLiveByIdRef` — 펼침 중 드래그하는 노드의 **라이브 표시 좌표**(매 프레임). `displayNodes`가 이걸로 직접 렌더(커서 1:1 추종).
- `suppressPosIdsRef` — 펼침 추적 드래그 중인 노드 id 집합. `dropDraggingPositions`(~L1354-1380)가 이 집합의 position 변경을 **버림**(nodes state 저장좌표 동결). `captureRootDragStart`(~L4261)에서만 채워지고(펼침+footprint-shift 노드 한정), `finalizeRootDrag`(~L4293)에서 **2×requestAnimationFrame 지연**으로 삭제(~L4347-4353).
- `captureRootDragStart`(~L4261): 드래그 시작 시 footprint 오프셋·시작 표시좌표 기록 + `dragLiveById` 시드.
- `finalizeRootDrag`(~L4293): 드롭 시 표시좌표→저장좌표 환산. **`sx` 언와인드 루프(L4323-4330)**가 계단함수 `offsetAtX` 고정점을 풀어 저장 x를 구함.

## #2 — 인라인 펼침 상태에서 footprint-shifted 노드 드래그 후 그 노드가 프리즈

**재현 조건(라이브 계측 확인):** 평면 맵에선 재현 안 됨. **서브프로세스 노드를 인라인 펼친 뒤**, 펼침 레인 뒤/옆에 밀린(footprint-shifted) 루트 노드를 드래그 → 그 노드가 이후 드래그/클릭에 반응 안 함. 다른(안 밀린) 노드는 정상.

**근본 원인(계측 증거):** 그 노드 드롭 시 `finalizeRootDrag`가 `tracked=true committed=true`(새 저장좌표 커밋했다고 판단)를 반환하지만, 화면 `transform`은 드롭 전후 **바이트 동일**(예: `translate(1628px,400px)`→동일) = **no-op 커밋**. 이후 그 노드는 해당 위치에서 클릭/드래그 무반응(하드 프리즈). 소델타 드래그일수록 잘 남.

**기존 버그 확정:** `git blame` → `suppressPosIdsRef`/`captureRootDragStart`/`finalizeRootDrag`는 `2a78b6b`(2026-06-21, inline-subprocess-embed 작업) 소산. shift 축고정(`dragStartPositionsRef`, `f34e15c`)·ctrl-drag는 무관(계측상 매 제스처 정상 시드/클리어).

**수정 방향(미구현):**
1. `finalizeRootDrag`의 `sx` 언와인드 루프(L4323-4330)를 footprint-shifted 노드 **소델타 드래그**에 대해 추적 — 왜 커밋이 화면상 no-op이 되는지(환산된 저장 x가 결국 같은 표시 x로 되돌아오는지 / `dragLiveById` 값이 드롭 순간 stale인지). 계측: 드롭 시 `dropDisplay`, 각 반복의 `sx`, 최종 `savedById`, 그리고 `setNodes` 후 displayNodes 파생 표시좌표를 로깅해 고정점 수렴이 맞는지 확인.
2. `suppressPosIdsRef`의 **2×rAF 지연 삭제**가 빠른 후속 제스처와 경합하는지(프리즈가 "영구"면 이건 부차, no-op 커밋이 주범일 가능성 큼). RF hitbox(내부 position)와 표시 transform이 어긋나 클릭이 빗나가는지도 확인(node.position vs transform 실측).

**재현 하네스:** 서브프로세스 링크 노드가 있는 맵 필요 → 데모 시드 맵 2(`[[demo-seed-reality]]`)에 서브프로세스 있음. 펼침 트리거 후 밀린 노드 드래그. `docs/lessons/scope-save-and-coordinates.md`·`canvas-react-flow.md` 선행 숙독.

## #3 — 같은 펼침 상태의 두 좁은 문제 (이번 브랜치 리뷰가 기록)

**#3a. 단일 노드 Shift 축고정 비활성(펼침 중):** 다른 서브프로세스가 인라인 펼쳐진 상태에서 단일 노드 Shift 드래그 시 축 고정이 안 먹음. `handleNodeDrag`(~L3917-3985 당시)가 펼침 추적 경로에서 라이브 좌표를 `dragLiveById`에 쓸 때 `constrainToAxis`를 적용 안 함(비확장 경로 `dropDraggingPositions`에서만 적용). 수정: 펼침 라이브 좌표 기록 지점에도 시작점 기준 `constrainToAxis` 적용.

**#3b. Ctrl드래그 복제 사본 좌표 드리프트(펼침 중):** `applyCtrlDragCopy`가 사본 위치로 `ghost.position`(=표시좌표)을 그대로 사용 → 펼침으로 밀린 노드를 복제하면 표시좌표가 저장좌표로 박혀 어긋남. 수정: 사본 저장 위치를 `finalizeRootDrag`와 동일한 표시→저장 환산(`offsetAtX`/`rootShiftSteps` 언와인드)으로 보정. #2 근본수정과 같은 환산 유틸을 공유하면 일석이조.

## 권장 접근

- #2가 근본(finalizeRootDrag 표시↔저장 환산)이고 #3b가 같은 환산을 재사용하므로 **표시↔저장 좌표 환산을 단일 검증된 헬퍼로 추출**(순수 함수, vitest)한 뒤 finalize·ctrl-drag·shift 경로가 공유하게 하는 게 정공법. #3a는 라이브 기록 지점에 constrain 한 줄.
- 반드시 **인라인 펼침 상태 라이브 재현**으로 검증(평면 맵 pw는 이 버그를 못 잡음 — 이번 세션 ctrl-drag pw가 그래서 놓쳤음).
