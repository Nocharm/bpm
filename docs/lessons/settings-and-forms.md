# Lessons — 설정/관리자 화면 · 폼/모달/피커 (비캔버스)

`frontend/src/components/{groups,admin,permissions}` · `app/settings` · `app/groups` 작업에서 얻은 교훈. (캔버스가 아닌 RBAC/설정 UI)

## 모달·피커
- **피커 모달의 명단 높이를 미리 확보**한다. 항목을 추가할수록 모달이 길어지거나 주변 컨트롤이 밀리면 사용자가 싫어한다. 명단 영역에 **고정/최대 높이 + 내부 스크롤**을 주고, 스크롤바는 평소 숨기고 hover/스크롤 시만 노출(`.scroll-soft` 유틸 in `globals.css`). 행 기반은 ~3.5행, 칩 기반은 ~1.5~3행. 빈 상태에도 영역을 비워둬 크기를 일정하게.
- **트리거 버튼과 다이얼로그가 다른(형제) 컴포넌트에 있으면 다이얼로그 open 상태를 부모로 들어올린다**(controlled `open`/`onClose`). 예: 멤버 추가 버튼은 카드 헤더(`GroupActions`)에, 피커 다이얼로그는 본문(`GroupDetail`)에 있을 때 — 부모(`groups-panel`)가 `addMemberOpen`을 들고 양쪽에 내려준다.
- **커스텀 피커의 Esc는 검색어 비우기 + `blur()`**로 처리한다. 펼친 목록이 `focused || query`로 노출되면, 검색어만 지워도 포커스가 남아 목록이 안 닫힌다. `(e.currentTarget).blur()`로 닫는다(항목 유무와 무관하게 Esc를 먼저 처리).

## 카드 헤더 레이아웃
- **클릭 토글되는 카드 헤더 안에는 다른 `<button>`을 넣을 수 없다**(중첩 버튼 무효). 액션 버튼을 헤더에 두려면: 토글을 **풀폭 버튼**으로 두고 액션은 그 **형제 요소(아래 행/우측)**로 렌더한다. 토글 버튼이 풀폭이어야 우측의 **상태 배지가 카드 우측끝에 정렬**된다(flex-1로 좁히면 배지가 안쪽으로 들어와 어긋남).

## 백엔드(FastAPI/SQLAlchemy)
- **정적 하위 경로는 `/{id}` 경로보다 먼저 등록**한다. `GET /groups/deleted`·`GET /groups/name-available`는 `GET /groups/{group_id}`보다 위에 둬야 "deleted"가 id로 파싱되지 않는다.
- **스키마 추가는 `backend/app/db.py`의 `_ADDED_COLUMNS`**(startup ALTER 백필) 패턴으로. 마이그레이션 프레임워크 없음. **스키마 변경은 사용자 확인 필수**(이번 `user_groups.deleted_at`·`name_changed_at` 승인받음). JSON payload 필드 추가(`from_visibility`)는 무스키마.
- **소프트삭제+복구**는 맵 패턴 복제: `deleted_at` 세팅 → 목록 조회 시 lazy purge(보존 7일) → `restore`는 `deleted_at=None`. 상태 전이로 권한이 빠지는 동작(비활성 시 `map_permissions` 삭제)은 명시적으로 처리.

## 검증
- **호버/포커스로만 나타나는 UI는 브라우저 자동화로 트리거 불가**(mouse_move 미지원, React 합성이벤트 JS dispatch 미발화). DOM 구조를 확인하거나, JS로 해당 요소의 **상태를 강제**(inline `style.opacity='1'` / `display='flex'` / grid-cols 등)한 뒤 스크린샷으로 시각 검증한다. 자세한 함정은 [browser-verification.md](browser-verification.md).
- **lucide `Map` 아이콘은 전역 `Map` 생성자를 가린다** — `import { Map as MapIcon }`로 alias.
