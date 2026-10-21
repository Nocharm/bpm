# Progress

프로젝트 진행 로그. 커밋 직전 갱신 (`rules/common/git.md`). **한 줄 요약만** — 상세는 git 이력·`docs/spec.md` 참조.
최근 요약만 유지하고, 이전 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-07-20 전체 스냅샷 + 이후 이동분) + git history로 아카이브한다.

## 2026-10-21 — 공개 저장소 서버 주소 가림 (main)

- 저장소가 공개라 실서버 IP(Keycloak·n8n 예시)와 사내 호스트명(AI GPU·예정 도메인)을 `<keycloak-host>`·`<n8n-host>`·`<ai-host>`·"도메인"으로 바꿨다. 실값은 서버 `.env`에만 둔다. compose 내부 브리지 대역(사설망)은 배포 설정이라 유지. git 이력에는 옛 값이 남는다.

## 2026-10-21 — 서버 compose 메모리 상한 정렬 (main)

- 서버의 `docker-compose.yml`이 저장소와 달라져 있었다(git 이력에 없는 값, 서버에서 직접 수정). proxy 상한 128M → 96M은 nginx 실사용(수십 MB)에 충분해 저장소를 서버 값에 맞췄다. 서버는 로컬 수정을 버리고(`git checkout -- docker-compose.yml`) 받아야 `git pull`이 멈추지 않는다.

## 2026-10-21 — 사내 AI GLM-5.3 전환 v1.1.1 (main)

- 사내 공지(5.3: `enable_thinking` 폐지, 사고량은 `reasoning_effort` low/high/max·생략=max, `clear_thinking` 신설·채팅 true 권장, 끄던 자리는 low+clear_thinking): `ai_client.call_ai`가 지정 사고량이면 `{"reasoning_effort": <값>, "clear_thinking": True}`, 최대(None)는 종전대로 생략. 사고를 끄는 값이 없어져 `AiReasoning` `"none"`을 `"low"`로 개명(호출부 3곳·재시도). 우리 메시지엔 이전 사고 내용(`reasoning_content`)을 싣지 않아 `clear_thinking`은 권장값을 따르는 것 외에 동작 차이는 없을 것으로 본다(실서버 확인 전).
- 모델 표기 `glm-5.3-nvfp4`: `.env.example`·`deploy.md`·관리자 매뉴얼 ko/en·관리자 슬라이드(HTML·PDF 재생성, 캡처 원본은 dev 워크트리 `.shots`에서 복사). 공지는 v1.1.1 배포 기준으로. pytest 1818·ruff.
- 운영 배포 2026-10-21(서버 `e4fde97b` = v1.1.1 + 문서·proxy 96M), `CHANGELOG.md`에 기록.
- 모델 id 정정 `glm-5.3:nvfp4` → `glm-5.3-nvfp4`(사용자 확인): 처음 전달받은 표기를 옮긴 것이라 문서·예시·주석만 바꿨다(코드는 `.env` `AI_MODEL`을 그대로 실어 앱 동작 불변 → 버전 유지).

## 2026-10-21 — 서비스 버전 도입 v1.1.0 (main)

- 사용자 요청 "상단바에 버전, 메인 머지마다 기준": 운영이 `a7d6cd99`(10-14 main)인 것을 기준점 v1.0.0으로 태그하고, 지금 main을 v1.1.0으로. 값은 `frontend/package.json` `version` 하나 → `next.config.ts` `env.BPM_APP_VERSION` 인라인 → 상단 바 이름 옆(툴팁으로 맵 버전과 구분, 측정 복제 행에도 넣어 반응형 단계 유지). 백엔드는 함께 배포되므로 따로 두지 않았다(Docker 빌드 컨텍스트에 `.git`이 없어 커밋 해시 대신 태그로 추적).
- 규칙 `rules/common/git.md` "On Main Merge — 서비스 버전"(MINOR=보이는 변경·PATCH=수정만, 머지 정리 커밋에 버전+`CHANGELOG.md`, annotated 태그 푸시, 배포일 기록), `deploy.md` §3·§4·§8, 공지 제목을 v1.1.0 배포 공지로.

## 2026-10-21 — 입출력 상자 사선 눕힘 (main)

- 사용자 요청 "45도보다 더 눕혀서 티나게": 사선을 가로:세로 2:1(14×7px, 약 27°)로. 칠 안쪽 당김은 비율에서 나오는 상수(0.764·0.382px)라 크기를 바꿔도 선 두께 1px 유지. PNG 옵션 창 축소 견본은 `--compact`(5px)로 같은 각도, 왼쪽 아이콘이 사선에 걸리지 않게. `pw-png-export-word` 38/38.

## 2026-10-21 — 9~10월 통합 공지 초안 (main)

- 앱 공지는 08-25 이후 게시된 적이 없어(사용자 확인), 10월 3차 초안을 08-25 ~ 10-21 통합본 `docs/notices/2026-10-21-release.md`로 다시 썼다. 갈래 규칙·Primary end·이탈 확인·Word 제거·역할·용어 통일을 "먼저 확인해 주세요"로 앞에 두고 나머지는 화면별로 묶었다. 출처는 미게시 초안 3건(9월 1차·10월 2·3차)과 초안이 없던 09-12 ~ 10-06 구간(커밋 293개·매뉴얼 ko 변경분 조사, 그 뒤 다시 바뀐 동작은 최종 모습으로).
- 미게시 초안 3건은 `docs/history/release-notices.md` "미게시 초안"에 원문으로(10-16 파일은 이동). 관리자 절은 선택 게시, AI 항목은 운영 AI 켜짐 전제, "지금 백업"은 db-backup 재생성 뒤 참이라 게시 메모에 남김.

## 2026-10-21 — dev → main 머지(7차): 시스템 리뷰 수정 1~7단계 + PNG 문서용 나눠 싣기·정렬 유지

- **시스템 리뷰 수정**(`docs/qa/2026-10-19-system-review.md` P0 3·P1 14·P2 59·P3 10, 권장 순서 7단계): 단계마다 수정 전 코드로 재현(회귀 pytest·vitest, 브라우저 `pw-verify-*`, 동시성·운영 전용은 일회용 postgres:16) → 수정 후 확인. 단계별 상세·수치는 `git show 81f35c0f:PROGRESS.md`.
  - 1 보안 경계: 그래프 PUT은 다른 버전 node·group·edge id 409·삭제는 버전 한정, 새 SP 링크·핀 소속 검사(기존 grandfather, 부재·권한 부족은 같은 422), 코멘트·워크플로·승인자 viewer 게이트, 승인자 변경=현재 owner, `password_hash` 가림. 테스트 고정 id는 버전별로.
  - 2 결재: 정족수=유효 승인자 ⊆ 승인 집합(`workflow.is_fully_approved`), `version_approvals` 유니크+기동 정리, 전이 `FOR UPDATE`·맵 행 잠금, 제출자 부재 시 sysadmin 대신 게시·회수, 진행 중 버전이 있으면 재게시 409.
  - 3 임포트·AI: 재전달 계보를 직전 게시본에 같은 제목 → 같은 자리·유형으로 맞춤(오너 값 밀림 해소), keep 행은 맵을 쓰지 않음, 분류 이동·다른 L5 taskId는 파일 error, 인터뷰 Draft `retarget`.
  - 4 운영 PG: 기동 시 컬럼 형 넓히기(`db._reconcile_column_types` TIMESTAMPTZ·TEXT), 제목·라벨 200자 422, KST 날짜 자르기, compose `restart`·`FORWARDED_ALLOW_IPS`, 복원 런북=빈 스키마+단일 트랜잭션, HR 대량 퇴직은 멈춤 대신 `hr_sync_runs` 이력(사용자 결정).
  - 5 편집 유실: 앱 안 이동 확인창(`lib/navigation-guard.ts`, 사용자 결정), 뒤로 가기는 즉시 저장, 확정 전 대기 편집 저장.
  - 6 업무 체계: 확정 요청 중 결정권자만 점유(요청자 재점유 금지), 휴지통 캔버스는 `live_linkage_map_id()`로 없음 취급(포인터 유지·복구), 레벨이 바뀌는 이동 422·형제 이름 409, 트리·카테고리·요청 행 잠금, 조상 걷기 사이클 가드.
  - 7 잔여: 권한·결재(7a, E-12=B 분류 권한자 교체 허용+알림) · 편집·SP·비교(7b, 그래프 id 중복 422·일반 맵 제출 서버 출력 규칙 F-4=A·숫자 정규화 FE·BE 동치) · CSV 왕복(7c, 반복 ◇ 두 번째부터 번호 D-7=A·수식 가드 왕복) · 운영(7d①, Backup now `requests/`·sqlite FK ON·HR 주기 잇기·`reset_db` PG 가드·`CHECKOUT_TTL_MINUTES` 제거) · 무결성(7d②, 끝 ≥2면 대표 끝을 사람이 고름 F-3·게이트 3은 다른 L5의 L6만·권한 행 중복 잠금) · 화면(7d③, 점유 표시는 편집 가능 상태만·좁은 상단 바). 공개 일반 맵 Draft 전원 열람은 설계 의도로 확정.
- **PNG 문서용 다듬기**(워스트케이스 목업 확인 뒤): 머리 블록·범례 pt 고정, 나눠 싣기(`lib/print-split`, 빈 칸 DP·같은 dpi 조각 ZIP), 연결선 펼침 칩·미리보기 차이, 입출력 사선 상자(화면+출력), 문서용 꺾임 r2·1px. **정렬 유지**(feat/print-align-anchor): 출력 크기가 바뀌어도 노드 축 기준을 이웃 투표로 추론해 출력 좌표만 옮긴다(`lib/print-anchor`, 간격 보정은 이동을 따로 받음).
- 매뉴얼 10차(md 빈틈 2곳·슬라이드 사용자 79·관리자 46장·PDF 4종). **배포 주의**: 사이드카 스크립트가 바뀌어 `docker compose up -d --force-recreate db-backup`(deploy.md), 기동 로그의 중복 행 경고는 데이터 불변. 머지 게이트: pytest 1818·ruff·vitest 1541·tsc·COMPONENTS 최신.
- 머지 시 문서 정리: 구현 끝난 거버넌스 UX 설계와 검증 끝난 QA 기록 4종(알림 감사·거버넌스 체크리스트·IO 연결·height-shift) 폐기, 공지 7건을 `docs/history/release-notices.md`로 통합, `frontend/README.md` 템플릿 교체, 이 파일의 10-06(1·2차) 이전 항목을 아카이브로, CLAUDE.md 상태 줄 시간순 정리.

## 2026-10-16~17 — dev → main 머지(6차): 출력 형식 전수 개선 + PNG Word 문서용 + 캔버스 성능

- **PNG Word 문서용**(시안 3종·워스트 목업 뒤 B안 구조+스타일 3종 모노·그레이·그레이+네이비): 캡처 순간에만 `.bpm-export-word--<style>` 토큰 클래스, 옵션 창(`png-export-modal`: 화면 그대로/Word·병렬 표시·정보 블록·교차 표시·표시 정보 칩·입출력 펼침, 인쇄 크기 패널 A4·dpi·pHYs, `bpm.pngExport`), A4 가이드 B안(`bpm.a4Guide`), 캡처 중 숨김 `bpm-print-hide`.
- **출력 형식 전수**(사용자 결정: Excel 소요시간=실제 시간 값 `[h]:mm`, 비교 PNG=표시 토글 실시간 미리보기): 파일 이름 KST `lib/download-name`, Excel 인쇄용 문서, CSV 수식 셀 `'` 가드·창 안 미리보기·경고, `downloadBlob` 통일, 비교 PNG 차이 색 보존+옵션 창, 매뉴얼 PDF 창. 3갈래 병렬 워크트리(fix/export-excel·csv·compare).
- **캔버스 성능**: 대기·휠 60→28fps 회귀는 조건 캡션 아이콘 `filter: drop-shadow`의 GPU 합성 → 제거로 60fps, `EdgeLabelPortal`. 축소 드래그는 영역 멤버 동결(`GroupBoxLayer`·`lib/drag-live`·`lib/drop-target`)로 drag-fit p95 33.4→16.8ms·노드 재렌더 ~12,200→~540. 측정 `scripts/pw-perf-canvas.mjs`.
- 마크다운 뷰어 줄바꿈·목록 간격, 매뉴얼 md·슬라이드(78장)·공지 초안 `docs/notices/2026-10-16-release.md`, page.tsx 테스트용 export를 `lib/graph-serialize.ts`로(webpack 빌드), `pw-verify-export` 현행 계약 22/22.

## 2026-10-14 — dev → main 머지(5차): 노드 조건·IO 가시성 + 비교 화면 상태 색 정리

- 조건·IO 가시성(목업 비교 후 사용자 결정): 조건은 모든 노드 밖 위(시작)·아래(종료) 한 줄 캡션(Conditions 토글, 배경 없이 tertiary+헤일로, L5 하늘은 밝은 글자, 호버 툴팁 전문, 위쪽 변 연결선이 있으면 왼쪽 절반), 간격은 표시 보정(에디터 height-shift `captionAbove`·비교 배치 대칭 패딩, `lib/condition-captions.ts`). 연결선엔 전달물 개수 점+호버 카드(`From [노드 필]`·경유, 원본→미러 최단 흐름 경로, 서브프로세스는 같은 이름 매칭, 줌 0.5 미만 숨김, `lib/edge-carry.ts`).
- 분기 노드 IO 아일랜드: 알약(아이콘+`체크/전체`, 체크 수 바뀌면 숫자 팝)과 Input·Output 독립 박스가 한 상자 — 호버·선택 같은 크기로 `ease-glide`(처음·끝 느린 대칭 곡선, 새 토큰) 확장, 상자 안 클릭은 체크만(버블 차단). 노드 편집 모달 선후행 전환은 독 카드가 이동하며 모달 크기로 커지고 새 카드가 내용 높이로 이어 펼침(펼침 창 뒤 섹션 접기는 즉시, 팝인 재생 깜빡임 제거). 노드 IO 행 링크·양식 아이콘 세로 가운데.
- 비교 화면: 상태 색 관례형(추가 `#1a7f37`·변경 앰버 `#9a6700`·삭제 빨강, 배지 +·연필·− 아이콘), 무변경 노드·흐름 점 회색, 범례 옆 2×2 색 견본으로 연두·청록 팔레트와 전환. 입출력은 `입출력 ±n` 요약만(필 제외, 모든 노드), 조건은 캡션만(호버 이전→이후·지워진 조건 취소선), 분기 노드 필은 캡션·요약 아래로, diff 배지 있는 노드의 시작 캡션은 배지 위. 삭제 연결선이 필 뒤로 지나가는 것은 그대로 둠(사용자 결정). 검증 스크립트 `pw-shot-condition-captions`·`decision-island`·`summary-glide`·`edge-carry-card`·`compare-decision`·`compare-regions`·`compare-captions`·`verify-io-row-icons`.

## 2026-10-13 — dev → main 머지(4차): 유리(Liquid Glass) 레이어 + 개인 화면 설정(유리 끄기·악센트 테마)

- 떠 있는 오버레이 전부(캔버스 크롬·메뉴·피커·팝오버·툴팁·다이얼로그 ~110곳)를 `glass` 유틸리티로, 글자 많은 면은 `glass-dense`. 정적 패널·인스펙터(흰 위 흰이라 효과 없음 실측)·유리 안 중첩 플라이아웃(backdrop root)은 비적용. CPU 4x A/B 팬·드래그 p95 동일. 표면은 `--glass-*` 변수로만 그려 사용자 끄기(`html[data-glass=off]`)가 hover 배경을 안 죽인다.
- 사용자 메뉴 = 아이콘 + '화면 설정' 플라이아웃(유리 효과·강조 색, localStorage, head 스크립트로 첫 페인트 전 적용). 악센트 파생 고정 hex 9개를 `color-mix(var(--color-accent))`로(기본 바이올렛 Δ≤7) — 선택 링·서브프로세스 기본색·차트·선택 엣지·Excel 헤더까지 테마를 따른다. 프리셋 4종(바이올렛·블루·오션·플럼): 의미색 충돌 색과 워스트 케이스에서 떨어진 로즈·그래파이트 제외.
- 다크 면(L5 하늘·대시보드) 대비가 기본 바이올렛부터 1.0~2.5로 미달이던 기존 결함 보정: `--color-accent-sky` oklch 명도 고정, 캔버스 강조 `--color-accent-canvas`(하늘 안 자동 sky). 가드 `scripts/pw-verify-accent-contrast.mjs`(프리셋×18조합). 규칙: design.md §1(악센트 테마)·§2(유리).

## 2026-10-08 — 결재 대기 카드 세로 배치·이름 표시·요청 시각 (dev)

- 인스펙터 결재 대기가 한 줄 카드(내용 | 버튼)라 기본 폭 360에서 텍스트 칸이 ~100px — 종류 배지가 세로로 깨지고 요약이 `use…`로 잘리며, 넓어도 `user:id`·로그인 ID·`restricted` 원시 값이 그대로 나왔다. 목업 비교 후 A안(사용자 결정): 폭 무관 세로 카드(종류·시각 / 대상·전→후 / 요청자·버튼), 대상은 UserPill·그룹 이름·DeptPill(말단), 역할·공개범위 라벨, 요청 시각은 `useAgo`+KST 툴팁. 맵 설정 결재 대기 탭도 같은 패널. 검증: vitest 1362·tsc·lint, `pw-shot-pending-approvals-width.mjs` 300/360/520·설정 ko/en 캡처.

## 2026-10-07 — 연결선 끝 최소 거리 40px를 좌·우 변까지 (main)

- 세로 정렬의 좌→좌(역행 루프)·우→우(척추 지름길)가 노드 옆 20px(RF 기본)에 붙어 납작하게 돌았다 — 가로 정렬 위→위를 40px로 고친(10-06) 것과 같은 모양이라 규칙을 네 변 공통으로(사용자 결정). `edge-stub.ts` `EDGE_MIN_STUB`·`needsEdgeStub`(정면 아닌 연결이면 변 방향 무관), 팬아웃 루프백 레인 기저 40, 팬 없는 끝은 실제 두 핸들이 정면이 아닐 때만 40(종전 위·아래는 정면이어도 40이라 세로 간격 40~80px 팬이 폴백하던 것 해소), SVG 미리보기 viewBox 좌·우 확장. 검증: vitest 1362·tsc·lint, TB 실측 좌→좌·우→우 40px, 스모크 팬아웃·재연결·SP 끝·프리뷰 통과.

## 2026-10-06 — dev → main 머지(3차): 엣지 배선·자동정렬·미리보기·비교 정렬 개선

- 오래된 엣지·정렬 로직 감사(4영역) 후 전부 반영. 원인은 둘이었다: 같은 맵을 화면마다 다른 경로 코드가 그렸고(에디터·비교·SVG 프리뷰·인터뷰 캔버스), TS 자동정렬이 Python 임포트 배치의 9~10월 개선(라벨 간격·사이클·팬아웃)을 못 따라왔다.
- **자동정렬**(사용자 결정: 큰길=최장 경로+예 라벨 동률): 반려 지름길이 큰길을 뺏던 최단 경로 폐기, 역행 엣지 분리·형제 정렬 키·라벨 폭 랭크 간격·곁가지 직선화·척추 지름길 아래 변·랭크 가운데 정렬을 TS(`layout-graph.ts`)·Python에 같이. 인스펙터 버튼 옛 경로 수정, 부분 정렬 겹침 해소+핸들 재지정, 영역 compound, L5 핸들 보존, 정렬 뒤 화면 맞춤. CSV 새 맵 배치에도 라벨 전달.
- **엣지**: 경로 해석기 `lib/edge-path.ts` 하나(우회는 마주 보는 핸들만 — 역방향 연결이 자기 노드를 관통하던 것, 팬 끝 40px), 생성기 `buildAppEdge`, 연결 판정 공유(`edge-rewire.ts`: 드롭 삽입 병렬 출구·삽입 역행 쌍 차단), 팬 레인 표시 좌표, 라벨 편집 상자 위치, SP 펼침 폭·자식 끝 라벨. 새 명령(사용자 결정): 끝점 재연결(판단 노드 라벨 모달/소거, SP 출구 목록), 연결 변 다시 고르기(수동, 데이터 모델 불변).
- **비교**: 삭제 노드가 원점에 포개지던 것→위상 순서·실측 겹침 회피(`compare-layout.ts`), 표시 필드 변경 시 줌 초기화 제거(맞춤 1회), 첫 화면 튐 제거, SP 출구 끝 라벨 점선 알약, 삭제 아크 깊이, 포커스 얕은 패치. 저장 배치 토글은 제외(사용자 결정).
- **미리보기**: SVG 프리뷰가 건너뛰는 선을 상자 밑에 숨기던 것→우회·라벨·변·줄바꿈·SP 폭(`preview-geometry.ts`), 줌 훅 공유, 마커 id 유일, 관계·인터뷰·선택지 캔버스에 에디터 엣지(장애물 캐시 WeakMap)·자동정렬 변.
- 검증: vitest 1358·pytest 1710·tsc·lint·ruff·카탈로그, 스모크 재연결 12/12·팬아웃 25/25·SP 끝 23/23·프리뷰 6/6·IO 25/25·L5 캔버스 25/25·선 모양 11/11·비교. 매뉴얼 ko/en·AI 도움말 갱신(슬라이드는 미갱신).

## 2026-10-06(1·2차 머지) 이전
- 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-10-21·09-30·09-24·09-02·08-12 이동분 포함) + git history.
