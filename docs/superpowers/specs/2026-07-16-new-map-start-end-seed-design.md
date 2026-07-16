# 새 맵 생성 시 Start·End 자동 시드 — 설계

- 날짜: 2026-07-16
- 브랜치: `worktree-workflow-improvements`
- 범위: 백엔드 `create_map` 1곳 + 테스트. 프론트·스키마·DB 구조 변경 없음.

## 배경 / 목표
새로 만든 빈 맵은 캔버스가 비어 있어 사용자가 매번 Start/End를 직접 추가해야 한다. CSV 임포트로 만든 맵은 이미 Start/End가 생성된다. 새 맵도 동일하게 **초기 버전에 Start·End 노드를 자동 생성**한다(엣지는 만들지 않음 — 사용자가 사이에 노드를 넣어 연결).

## 결정
- **위치**: 백엔드 `backend/app/routers/maps.py` `create_map` — 초기 버전 flush 직후 `Node` 2행 삽입.
  - 대안(프론트 `create-map-dialog`의 `saveGraph` 주입)보다 백엔드 초크포인트가 견고: 클라이언트 무관하게 모든 새 맵에 적용, 왕복·부분실패 없음. 2노드라 dagre 불필요(고정 좌표).
- **노드**:
  - Start: `node_type="start"`, `title="Start"`, `sort_order=0`, `pos_x=120, pos_y=200`.
  - End: `node_type="end"`, `title="End"`, `is_primary_end=True`, `sort_order=1`, `pos_x=480, pos_y=200`.
  - id는 `uuid.uuid4().hex`(`clone_graph` 스타일). 엣지 없음.
- **범위**: 새 맵의 초기 버전만. 나중에 만드는 빈 새 버전(source 없는 `create_version`)·복사(`copy_map`, 이미 clone)는 대상 아님.

## 정합성
- `validate_process`(`subprocess.py`): start 정확히 1개·end 대표 1개·end 제목 유니크 → 통과.
- **CSV 생성 경로 무영향**: `create-map-dialog`가 `createMap`(이제 start/end 시드) 후 `saveGraph(csvGraph)` 호출. `PUT /graph`는 전체 교체(`graph.py:184-204`: payload에 없는 기존 노드 삭제) → 시드된 start/end(백엔드 id)는 삭제되고 CSV 자체 start/end(genId)로 대체. 중복 없음.
- **에디터 렌더**: `title="Start"/"End"`는 CSV가 생성하는 노드와 동일 shape → 기존 CSV 맵과 동일하게 정상 렌더.

## 검증
- 백엔드: `POST /maps` → `GET /versions/{v}/graph` → start 1·end(primary) 1·edges 0 단언(`test_maps.py`). 기존 `test_new_version_has_empty_graph`는 새 동작(초기 버전에 시드)에 맞춰 `test_new_map_version_seeds_start_end`로 갱신.
- 브라우저 실검증: 새 맵 생성 → 에디터가 캔버스에 `Start`·`End` 2노드 렌더, 엣지 0, 콘솔 에러 0(`pw-verify-new-map-seed.mjs`).

## 게이트
- 백엔드: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" pytest tests/ -q` + `ruff check`.
