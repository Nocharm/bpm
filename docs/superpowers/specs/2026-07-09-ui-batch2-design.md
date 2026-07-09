# UI 개선 배치 2 (7항목) — 설계

날짜: 2026-07-09 · 브랜치: worktree-ui-improvement-5 · 항목 번호는 사용자 원 요청 번호(⑥ 없음)

## 목적

새맵 모달 오버플로·맵 목록 가로 스크롤 등 소형 UI 결함 수정과, 맵/멤버 목록의 권한 기반 시각 그루핑, 서브프로세스 섹션 스캔성, 노드 URL 노출(표시 필드+배지)을 한 배치로 처리한다.

## ① 새맵 모달 — 뷰포트 제한 + 내부 스크롤

`frontend/src/components/permissions/create-map-dialog.tsx`

- 다이얼로그 컨테이너(현 `w-full max-w-lg flex-col gap-5 p-6`)에 `max-h-[calc(100dvh-2rem)]` + `min-h-0`.
- 헤더(타이틀+닫기)와 하단 버튼바는 고정, 그 사이 폼 영역을 `flex-1 min-h-0 overflow-y-auto scrollbar-hidden`(기존 유틸) 래퍼로 감싼다 — 스크롤바 숨김은 사용자 요구.
- 큰 화면에서는 현행과 동일(스크롤 미발생). 레이아웃 재배치 없음.
- ⚠️ worktree-ui-improvement-3이 같은 파일 +3줄(import·피커 어댑터) 수정 — 영역이 달라 충돌 낮음, 머지 시 인지.

## ② 맵카드 목록 — 가로 스크롤 방지

`frontend/src/app/page.tsx` 좌측 리스트

- 검색 `ul`(≈474)·브라우즈 컨테이너(≈486)에 `overflow-x-hidden`.
- 원인 보강: `map-card.tsx` 호버 스왑 행(`whitespace-nowrap`, ≈195·199)의 조상 셀에 `min-w-0` — 좁은 폭에서 재현 확인 후 최소 수정.

## ③ 전체맵 목록 — 권한 > 시간 정렬 + 순수 간격

`frontend/src/app/page.tsx` 브라우즈 모드 전체 목록만. **최근 밴드·검색 결과는 현행 유지**(확정).

- 정렬 키: `my_role` 순위 owner(0) → editor(1) → viewer(2), 동순위 내 `updated_at` desc.
- 역할 그룹 사이 **순수 간격 스페이서**(라벨 없음, ≈8px)(확정). 정렬·그룹화는 렌더 직전 파생(useMemo), 서버 응답·필터 로직 무변경.

## ④ 허용된 인원 — 역할 클러스터 간격

`frontend/src/components/maps/map-detail-card.tsx` 멤버 렌더 (홈 우측 패널·에디터 Map 탭 공용이라 양쪽 자동 적용)

- 각 타입 그룹(Individuals/Teams/User groups) 내부 정렬을 역할 우선(owner→editor→viewer)으로, 부서는 같은 역할 안에서 기존 레벨 정렬 유지.
- 역할 클러스터 사이 작은 간격(≈6px, 스페이서 요소). 그룹 라벨/행 마크업 무변경.

## ⑤ 서브프로세스 섹션 — 스캔성

`frontend/src/components/subprocess-inspector-card.tsx` + `lib/i18n-messages.ts` (EN/KO)

- `inspector.spNote` 2문장 프로즈를 한 줄로 축약(EN: "Designated maps can be embedded in other maps as subprocess nodes." / KO: "지정된 맵은 다른 맵에 서브프로세스 노드로 임베드할 수 있습니다.") — 기존 전체 문구는 Info 아이콘 `title` 툴팁으로 이동(신규 키 `inspector.spNoteFull`로 기존 문구 보존).
- label:value 행 대비는 현행 유지(라벨 `ink-secondary` / 값 `ink`) — 이 항목의 핵심 변경은 노트 축약 하나다. 카드 구조·버튼 무변경.
- 속성탭 빈 상태(subprocessSlot)와 Map 탭 동일 컴포넌트 — 양쪽 자동 적용.

## ⑦ 노드 표시 정보 — 타입 대신 URL

`lib/node-actions.ts` · `components/process-node.tsx` · `app/maps/[mapId]/page.tsx`(체크박스) · `lib/i18n-messages.ts`

- `NodeDisplayField`: `"nodeType"` 제거, `"url"` 추가. `NODE_DISPLAY_FIELDS = [assignee, department, system, duration, url]`.
- 노드 표시줄(NodeFields): url 필드 값은 **`urlLabel`이 있으면 라벨만, 없으면 고정 텍스트 `LINK`**(확정 — URL 원문 미노출). 아이콘은 lucide `Link`. url이 비면 다른 필드처럼 줄 자체 미표시.
- 서브프로세스 노드는 지정 어트리뷰트의 URL(`spUrl`/`sp_url`) 기준 — 라벨 소스가 없으므로 값 존재 시 `LINK`.
- localStorage(`bpm.nodeDisplayFields`) 로드 시 유효 필드만 필터(기존 저장값의 `nodeType` 제거 위생).
- 에디터 좌측 표시 체크박스: `nodeType` 라벨 키 제거, `url` 키 추가(EN "URL"/KO "URL"). 기본값(`["assignee"]`) 무변경.

## ⑧ 노드 URL 배지 — 표시 전용, 좌상단

`components/process-node.tsx`

- url 있는 노드 좌상단 `-left-2 -top-2`에 표시 전용 배지: `rounded-xs border border-accent-tint-border bg-accent-tint/80 p-0.5 text-accent opacity-70` + `Link` 12px, `title`=URL 툴팁(확정: 클릭 동작 없음).
- **비교뷰에서는 미표시** — 좌상단 삭제 배지와 충돌 회피. 비교 렌더 구분 수단(prop/context)은 구현 시 기존 diff 배지 분기 재사용.
- 토큰만 사용(raw hex 금지).

## 검증

- `npx vitest run`(베이스라인 147) + `npm run lint`(에러 0, 기존 경고 1 무시).
- 캔버스 항목(⑦⑧)은 구현 전 `docs/lessons/canvas-react-flow.md`·`react-ts-patterns.md` 정독.
- 백엔드 :8000(워크트리, 시드) + 프론트 :3002 기동 — Playwright 스크린샷: 새맵 모달(작은 뷰포트), 맵 목록(정렬+스페이서), 멤버 카드(역할 간격), 노드(URL 표시줄+배지), 서브프로세스 섹션. 사용자 육안 확인 게이트.
