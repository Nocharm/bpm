# 멤버 카드 아이콘 톤·패딩 + 조직 레벨 아이콘 세트 — 설계

날짜: 2026-07-09 · 브랜치: worktree-ui-improvement-4 · 선행: 멤버 카드 아이콘 22px 확대(ui-improvement-2)

## 목적

맵 상세 > 허용된 인원 멤버 카드에서 22px로 키운 아이콘이 `text-ink` 상속으로 과하게 진해 보이는 문제를 회색 톤으로 해소하고, 행 왼쪽 패딩을 줄여 밀도를 개선한다. 조직 레벨 아이콘(센터/담당/팀/그룹/파트)은 추상적인 파트(Boxes) 중심으로 직관성이 떨어져, 통일성과 규모 차이가 보이는 세트로 교체한다. 시안은 비주얼 컴패니언으로 확정(회색 톤 3안 중 C, 아이콘 세트 3안 중 C).

## 범위

`frontend/src/components/maps/map-detail-card.tsx` 단일 파일. worktree-ui-improvement-3 미접촉 파일 — 충돌 없음. 조직 레벨 아이콘 정의(`LEVEL_ICONS`)는 이 파일에만 존재함을 확인(inspector-panel·node-summary-modal의 `Boxes`는 노드 수·서브프로세스용으로 무관).

## 변경 1 — 멤버 카드 아이콘 회색 톤 + 왼쪽 패딩

- 아이콘 컨테이너(`h-9 w-9` span)에 `text-ink-muted`(#A0A0A8) 추가 — 유저·부서·그룹 아이콘 전부 회색화. ME 배지는 자체 `text-accent`라 액센트 유지.
- 멤버 행 패딩 `px-2.5` → `pl-1.5 pr-2.5` (왼쪽 10px→6px, 오른쪽·상하 유지).
- `MembersSkeleton` 고스트 행은 실제 행 치수 모사가 목적이므로 같은 패딩으로 동기화.

## 변경 2 — 조직 레벨 아이콘 세트 (건축 + 조각)

- `LEVEL_ICONS = [Landmark, Building2, Building, House, Puzzle]` (deptLevelRank 순서: 센터/담당/팀/그룹/파트).
  - 규모 사다리: 기관 → 오피스 → 빌딩 → 집, 파트만 퍼즐 조각("전체의 한 부분") — 의미 전달 최우선.
  - 부수 효과: 그룹 레벨이 UsersRound를 벗어나 사용자 그룹 행 아이콘(UsersRound)과의 충돌 해소.
- import 정리: `Boxes` 제거(LEVEL_ICONS 전용), `Building`·`House`·`Puzzle` 추가. `Users`(멤버 수 표시 11px)·`UsersRound`(사용자 그룹 행)는 타 용도 사용 중 — 유지.
- 미매칭 레벨 폴백 `?? Building2` 유지.

## 검증

- `npx vitest run`(베이스라인 147 pass) + `npm run lint`.
- 백엔드 :8000(main 트리, 무변경) + 프론트 dev :3002(워크트리) 기동 — 맵 상세 > 허용된 인원 Playwright 스크린샷으로 1차 확인 후 사용자 육안 확인(:3002).
