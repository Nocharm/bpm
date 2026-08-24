# 노드 간격 자동 재조정 (height-shift) — 설계 스펙

브랜치 `feat/node-spacing` (base: `feat/io-linking` @ 9801b9b1 — IO 체크리스트 UI 의존).
워크트리 `.claude/worktrees/node-spacing`.

## 1. 배경·목적

노드 디스플레이(표시 필드 토글·IO 체크리스트 펼침·긴 제목 줄바꿈·SP 배너)로 노드가 세로로
커지면 아래 노드를 덮는다. io-linking QA M3 실측: 워스트 노드 628px(캡 상태)에서 280px 아래
노드가 완전히 파묻힘 — 지배 요인은 상시 노출 섹션(제목 68·조건 92·담당 37·시스템 37·파라미터
39px). 캡(3.5줄)만으론 해소 불가 → 표시 높이에 맞춰 아래 노드를 밀어내는 변위 레이어가 필요.

## 2. 사용자 결정 (2026-08-23 브레인스토밍)

| 질문 | 결정 |
|---|---|
| 간격 의미론 | **원래 간격 보존** — 추가 높이만큼 밀어 저장 좌표의 여백을 화면에서도 유지 |
| 밀기 범위 | **아래 전체(행 보존)** — X 무관, 커진 노드보다 아래면 전부. 행 정렬·엣지 직선 유지 |
| 작동 방식 | **상시 자동** — 토글 없음. 높이 변화에 항상 반응, 전환은 애니메이션 |
| 접근안 | 안 1 — 실측(measured) 기반 전역 Y 계단함수 |

## 3. 좌표 모델 (불변식)

- **저장 좌표는 절대 불변.** 표시 좌표 = 저장 + X변위(기존 inline-shift, 인라인 펼침 footprint)
  + **Y변위(신규 height-shift)**. 두 축 독립 합성.
- 표시 상태(디스플레이 토글·IO 리스트 상태)는 사용자 로컬이므로, 변위가 저장 좌표를 바꾸면 다른
  사용자·게시본 레이아웃이 오염된다 — 그래서 표시 전용.
- 소비자 구분: 노드·엣지·미니맵·PNG 내보내기 = 표시 좌표 / 저장·서버·Excel·Word = 저장 좌표.

## 4. height-shift 모듈 (`frontend/src/lib/height-shift.ts`, 신규)

```ts
import type { ShiftStep } from "@/lib/inline-shift"; // {x, footprint} — 축 중립 1D 계단

/** 표시높이: measured 우선, 미측정은 estimateNodeHeight 폴백. */
export function getDisplayHeight(node: AppNode): number;

/**
 * 커진 노드들로 Y 계단함수 스텝 생성.
 * - extra = max(0, 표시높이 − nodeSizeOf(type).h)  (기준: process 52 · decision 96 · start/end 40 · subprocess 64)
 * - extra < EPSILON(4px)은 무시(미세 지터 방지).
 * - 앵커 구간 = [savedY, savedY + 기준높이]. 구간이 겹치는 앵커는 한 밴드로 병합:
 *   bottom = max(구간 bottom), extra = max(extra)  — 같은 행 동반 성장 시 아래는 1회만 밀림.
 * - 반환: ShiftStep[{x: band.bottom, footprint: band.extra}] (y를 x 필드에 실음 — 축 재사용).
 */
export function buildHeightSteps(nodes: AppNode[]): ShiftStep[];
```

- 오프셋 조회·역변환은 **기존 `inline-shift.ts` 재사용**: `offsetAtSavedX(savedY, steps)`,
  `displayToSavedX(displayY, steps)`. 신규 수학 없음(도달 불가 갭 클램프 포함 검증된 코드).
- 노드 자신의 밴드 bottom은 자신의 savedY보다 항상 아래 → 자기 오프셋에 미포함(자기참조 안전).
- 수직 스택은 밴드 합산(사슬 간격 보존), 같은 행은 max — §2 간격 의미론과 일치.

## 5. 에디터 통합 (`page.tsx`)

- **합성 지점**: `displayNodes` 메모에서 노드별 `position.y += offsetAtSavedX(savedY, ySteps)`.
  메인 `nodes` state는 저장 좌표 유지(lessons: 메인 state 오염 금지).
- **재계산**: `ySteps = useMemo(buildHeightSteps, [nodes])` — RF dimension change가
  `handleNodesChange`로 nodes를 갱신하므로 IO 펼침·토글·제목 편집이 자동 반영.
  오프셋은 위치만 바꾸고 콘텐츠 높이를 안 바꾸므로 측정 피드백 루프 없음.
- **드래그 커밋**: 기존 X 커밋(`sx = displayToSavedX(dropDisplay.x, xSteps)`,
  `y = dropDisplay.y - offset.y`)을 확장 —
  `y = displayToSavedX(dropDisplay.y - offset.y, ySteps)` (인라인 컴포지션 y 오프셋 차감 후
  height-shift 역변환). 다중 선택 드래그도 노드별 동일식. 도달 불가 갭은 밴드 bottom으로 클램프.
- **신규 노드 생성/드롭 좌표**: 화면 좌표에서 만들 때 동일 역변환 경유(드롭·팔레트·붙여넣기).

## 6. 애니메이션

- CSS transition 금지 — 엣지는 SVG 재계산이라 노드만 미끄러지고 엣지가 즉시 점프(분리).
- **오프셋 rAF 트윈**: 이전 스텝 → 새 스텝을 350ms ease-smooth로 보간(노드별 오프셋 lerp),
  매 프레임 노드+엣지 동반 이동. 구현: `animatedYOffset(nodeId)` = lerp(prevOffset, nextOffset, t).
- 즉시 적용(트윈 생략) 3경우: ① 첫 로드/스텝 최초 생성(로드 출렁임 방지) ② 드래그 중
  ③ `prefers-reduced-motion`.

## 7. 적용 표면·경계 (V1)

| 표면 | 적용 |
|---|---|
| 에디터 루트/딥뷰 | ✅ (표시되는 노드 집합에 동일 규칙) |
| 인라인 펼침 중 | ❌ V1 비활성(스텝 빈 배열) — 펼침 자식 표시 좌표는 합성(inlineComposition) 파생이라 프레임 노드만 밀면 박스·자식이 찢어진다. 펼침 종료 시 자동 복귀. 후속 과제로 §9에 기록 |
| 비교 화면 | ❌ 자체 dagre + `COMPARE_RENDER_*` 실측 상수 배치 |
| 인터뷰 프리뷰 | ❌ Provider 부재 표면(토글 없음) |
| PNG 내보내기 | 표시 캡처라 자동 포함 |
| Excel·Word 내보내기 | 저장 좌표 사용 — 영향 없음 |
| 드롭 충돌 밀어내기(`pushOverlapped`) | 저장 공간 근사 유지 — V1 한계로 명기 |

## 8. 검증

- **vitest** (`height-shift.test.ts`): 밴드 병합(같은 행 max·수직 스택 합산·구간 경계 tolerance)·
  EPSILON 미만 무시·estimate 폴백·역변환 왕복(display→saved→display 항등, 갭 클램프).
- **Playwright 스모크**: IO 전체 펼침 → 아랫행 표시 Y가 (전체높이−캡높이)만큼 증가 실측 →
  접기 복원 → 드래그 커밋 후 저장 좌표(서버 graph) 대조 라운드트립.
- **브라우저 QA**: M3 워스트 시드 재현 → 캡/전체 펼침 모두 겹침 0(바운딩 박스 교차 검사) +
  스크린샷. 콘솔 에러 0.

## 9. 비범위 (V1 제외)

- X축 폭 성장 밀어내기(240px 캡이라 실사용 피해 낮음), 드롭 충돌 박스의 표시높이 반영,
  비교 화면/프리뷰 적용, 저장 좌표 재배치(정렬) 액션, 인라인 펼침 중 적용(자식 합성 좌표 결합 —
  펼침 박스가 아랫줄을 덮는 기존 동작 유지).
- 앵커는 콘텐츠 성장 타입만(process·decision·start·end·subprocess) — section(Word 맵 영역)은
  의도된 대형 박스라 앵커·피밀림 모두 제외(오프셋 0), Word 맵 한정 V1 한계.
- 밴드 경계 등호: 저장 Y가 밴드 bottom과 정확히 같은(간격 0으로 맞닿은) 노드는 밀리지 않는다
  (기존 offsetAtSavedX strict `<` 재사용) — 8px 그리드 배치에서 실사용 영향 없음.

## 10. 구현 노트

- 새 워크트리는 `node_modules` 부재 — APFS `cp -Rc`로 io-linking 워크트리에서 복제 후
  `npm install` 보강(turbopack 심링크 거부 선례).
- `.react-flow__node` 대상 CSS를 쓸 일이 생기면 globals.css 금지 — page.tsx raw `<style>`(purge 선례).
- 게이트: vitest·tsc·lint·build + BE 무변경 확인.
