# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신 (`rules/common/git.md`). 한 줄 요약만 — 상세는 git 이력·`docs/superpowers/specs/`·`docs/spec.md` 참조.

## 2026-06-15
- 그룹 중첩(하위 그룹핑, 항목 8 — 옵션1 중첩만, 큰 다중소속 모델은 보류). 백엔드: `groups.parent_group_id`(자기참조, 스톱갭 컬럼 보강·고아/자기참조 정리·복제 리맵, 테스트). 프론트: 그룹 멤버 부분집합 선택→"그룹 생성" 시 하위 그룹으로 중첩, 해제 시 멤버·하위그룹 상위로 승격, 중첩 높이 기반 패딩으로 박스 포함 렌더, 일괄편집·색은 서브트리 대상. 순수 헬퍼 `collectKeptGroups`/`computeGroupHeights`/`groupSubtreeIds`(bun 검증). 백엔드 94 passed+ruff, 프론트 build green.
- 에디터 14종 배치(브랜치 `feat/editor-batch`) — 12개 구현(항목 8 중첩/다중그룹은 설계 협의 후 별도): 아웃라인 행 우클릭 메뉴·더블클릭 이름편집(#1), 노드 우클릭 "정보 수정" 모달(요약모달 편집 확장, 색 1줄+더보기)(#2), 더블클릭 인라인 이름편집·타이틀 I-beam(#3), 드롭존 중앙 위치교환(#4), 엣지 선택 강조 강화(#5), 다중선택→그룹 생성(#6), 그룹 해제(#7), Delete 전용 삭제(#9), dagre 간격·노드별 박스로 겹침 완화(#10), 엣지 스타일 맵 전역 선택(곡선/꺾은선/직선)(#11), 겹침 시 시야 자동 보정(#12), AI 채팅 풀 플로팅 창(ScopeWindow·dock 재사용)(#13), 알림센터 바깥클릭 닫힘(#14). eslint+build green.
- AI 채팅 패널 플로팅 슬라이드 인/아웃 + 일괄 속성 적용 후 입력·정책 초기화·"적용 완료" 토스트.
- 후속 UI: 미리보기 노드 호버 채우기, 일괄 속성 동일값 자동 스킵, 노드정보 박스 아웃라인 밖 이동·접기.
- 후속 UI: AI 패널 상시 표시(비활성 시 사유), 대시보드 상단 sticky·본문 스크롤, 서브프로세스 버튼 미리보기 이동, 그룹 일괄 편집 개선(개별선택 마법사·그룹명·기존값 팝오버), 노드정보 토글 스위치.
- 그룹 멤버 일괄 편집(색상·속성, 충돌 처리: 교체/추가/건너뛰기/개별) 신규 `group-bulk-modal.tsx`.
- UI 개선 4종: 대시보드 정리, 요약 모달 서브프로세스 진입 버튼, 드롭존 0.7배·겹침+dwell 트리거, 노드 표시 정보 선택(localStorage).
- DB 스톱갭(`app/db.py`)에 워크플로우 컬럼 보강(`status` DEFAULT 'draft' 백필) — 기존 DB 데이터 보존 자동 마이그레이션. `tests/test_db.py`.
- AI 모델 선택(프론트 드롭다운, `/v1/models` 프록시) + 접속 테스트 문서 `docs/ai-connectivity-test.md`.
- 온프레미스 AI 채팅 구현 — 백엔드 OpenAI 호환 프록시(`ai_client`/`ai_prompt`/`manual`/`routers/ai`, 502에 내부 URL 비노출, AI 서버 mock 테스트) + 프론트 채팅·미리보기·적용·매뉴얼. 설계 `specs/2026-06-15-ai-chat-flowchart-design.md`. **미해결: 실 vLLM `/v1/models` 502(서버측, 보류).**

## 2026-06-14
- 버전 승인 워크플로우 풀스택 완료 — Draft→Pending→Approved→Published(+Rejected), 맵별 만장일치 승인자, 수동 게시+구버전 강등, 인앱 알림. 대시보드(라이프사이클 stepper·승인자 체크리스트·높이조절), 상태배지·액션 버튼. 설계 `specs/2026-06-14-version-approval-workflow-design.md`.
- 워크플로우 버그·스모크 수정 — 모달 갇힘 portal화, Submit 막다른길 방지, `isMapOwner` 백엔드 정합.
- 캔버스 UX — 드롭존 줌 고정, 아웃라인/검색 선택 노드 보더, 방향별 엣지 색강조.

## 2026-06-13
- 에디터 UI 대개편 — 좌 사이드바(아웃라인 트리), 우 인스펙터 상시·폭조절, 컨텍스트 메뉴(divider), 단축키 레전드, 드래그-오버 드롭존(앞/뒤/그룹/하위), 비활성창 정적 SVG 프리뷰. 설계 `specs/2026-06-13-{editor-ui,drag-drop-zones,node-interactions}-design.md`.
- 그룹(업무 묶음) 풀스택 — `groups` 테이블+`nodes.group_id`, 그룹 박스·타이틀바(이름/색/이동/나가기). 노드·그룹 색 팔레트 무채도 톤으로 세련화.
- Whimsical 디자인 — 바이올렛 액센트(#6A41FF)·파스텔 노드·dot-grid·움직이는 엣지·겹침 방지. `specs/2026-06-13-whimsical-design-design.md`, `rules/frontend/design.md`.

## 2026-06-12
- OS형 자유 창(드릴인 윈도우 `ScopeWindow` — 이동/리사이즈/포커스/최소·최대/영속). `specs/2026-06-12-os-windows-design.md`.
- UI 디자인 시스템 — Tailwind4 `@theme` 토큰·Pretendard·Lucide, flat+hairline. `specs/2026-06-12-ui-design-system-design.md`.
- UI 개선 — 계단식 창, 전역 네비바+경량 i18n(en/ko), 박스선택·스페이스 팬. `specs/2026-06-12-ui-improvements-design.md`.
- 기능 확장 Phase A/B/C(`docs/spec.md` §7) — A: undo/redo·마우스위치 컨텍스트메뉴·자동저장·노드 색/모양/엣지 라벨. B: BPM 속성 4종·버전 diff(계보 매칭)·초성 검색·PNG. C: 체크아웃 잠금·노드 코멘트(폴링).
- 문서 명령 bash/PowerShell 병기 원칙(`rules/common/documentation.md`).

## 2026-06-11
- 초기 구축(spec §6 ①~⑤): 스캐폴딩(Next+FastAPI+nginx+compose, 9787) → 맵 CRUD+캔버스 → 계층(드릴다운·브레드크럼)+정렬(dagre) → 버전관리+비교 → Keycloak 인증(AUTH_ENABLED). 배포 준비 `docs/deploy.md`. 기능 명세 `docs/spec.md`. 프로젝트명 BPM 확정.
