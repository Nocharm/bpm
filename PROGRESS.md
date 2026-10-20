# Progress

프로젝트 진행 로그. 커밋 직전 갱신 (`rules/common/git.md`). **한 줄 요약만** — 상세는 git 이력·`docs/spec.md` 참조.
최근 요약만 유지하고, 이전 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-07-20 전체 스냅샷 + 이후 이동분) + git history로 아카이브한다.

## 2026-10-20 — 7d③ 화면 잔여: 시스템 리뷰 D-9·W-9·W-10·W-11 + 확인 필요 "홈" (dev)

- 에디터 상단 바: 점유 표시는 편집 가능 상태(draft·rejected)에서만(승인 요청 뒤 폴이 멈춰 오너 본인에게 "편집 중 - 읽기 전용"·강제 편집이 남던 것), 오른쪽 묶음 `min-w-0`+줄바꿈 금지라 좁은 폭에선 반려 사유가 먼저 잘리고 저장 버튼은 화면 안. AI 챗 실패 안내는 kind `error`로 자동 제목에서 빠진다(`buildAutoTitle`). Excel 내려받기는 공용 `downloadBlob`(동기 해제 Safari 취소). 루트 스코프 자리표시 "홈"은 빈 제목(영어 화면 노출).
- 브라우저 `scripts/pw-verify-topbar-followups.mjs`: 수정 전 프런트 2/8(제출 뒤 "admin.sys is editing - read only · Force edit", 900·1060px에서 저장 버튼 x=1106) → 수정 후 8/8. vitest +2(수정 전 로직 재연 시 제목 "AI request failed (HTTP 502)"), 내보내기 스모크 22/22. tsc·lint·vitest 1532·COMPONENTS 최신. 공개 일반 맵의 Draft 전원 열람은 설계 의도로 확정(사용자 결정 2026-10-20) — spec·사용 안내 ko/en에 명시.

## 2026-10-20 — 7d② 무결성 잔여: 시스템 리뷰 F-3·F-10·F-11·F-12 + 확인 필요 게이트 3·중복 행 (dev)

- 대표 끝은 끝이 둘 이상이면 사람이 고른다(사용자 결정 F-3): 저장이 대신 고르지 않고 제출 422, 에디터·설정 패널 저장 체크리스트, 대표 토글은 하나만 켜짐(끝 하나는 자동 지정 그대로). 게이트 3은 다른 L5의 L6 링크가 SP 지정이 풀리면 끊긴 링크로 센다(자기 L5 소속 L6는 지정과 무관 — 그래프 저장 규칙과 같고, 슬롯 교체로 미지정 맵이 L6가 될 수 있어 전면 적용은 확정 불능을 만든다). 권한 행 중복은 맵 행 잠금(추가·오너 이전)과 임포트 오너 교체 정리로 막고, 이미 겹친 버전 번호·게시본·권한 행은 기동 로그로만 알린다(사용자 결정). 새 링크를 더하는 저장은 PG advisory 잠금으로 줄 세워 맞링크 순환을 막는다. 비교·변경 요약은 배열을 항목 경계로, 중복 엣지를 따로 세고, 제목 폴백 없이 계보로만 짝짓는다(확정 서명과 같은 판정). SP 끝 판정은 정확한 변 id만 대표 끝으로 접는다("t-shirt order" 끝).
- 회귀 pytest +5(수정 전 5 실패)·vitest +7(수정 전 5 실패). 일회용 postgres:16: 동시 권한 추가 수정 전 6/6 중복 → 0/10(409), 맞링크 동시 저장 수정 전 6/6 순환 → 0/10(422), 기존 중복은 경고만·데이터 보존. 브라우저 `scripts/pw-verify-primary-end.mjs` 6/6. pytest 1818·ruff·py3.11·tsc·lint·vitest 1530·COMPONENTS 최신. 매뉴얼 ko/en·`backend/app/manual.md`·CLAUDE.md 반영.

## 2026-10-20 — 7d① 운영 잔여: 시스템 리뷰 H-9·H-11·H-12 + 확인 필요 HR 주기·reset_db·ref_audit (dev)

- Backup now 트리거는 사이드카(root)가 1777로 만드는 `requests/`에 쓴다(비root backend가 root 소유 백업 디렉터리에 못 써 서버에서 500), 못 쓰면 503+조치 안내+실패 기록. 사이드카 스크립트가 바뀌었으니 배포 때 `docker compose up -d --force-recreate db-backup`(deploy.md). sqlite도 연결마다 FK를 켜 영구삭제 cascade가 운영과 같다. HR 자동 동기화는 마지막 회차(`hr_sync_runs`)에서 주기를 잇는다(지났으면 기동 5분 뒤, 기록 없는 첫 설치는 한 주기 뒤, 사용자 결정). `reset_db`는 postgres에 맵·직원이 있으면 지우기 전에 멈추고, A8 명령에 `-p`·`--env-file`. ref_audit은 반려·결재 대기 작업본도 스캔. 쓰이지 않던 `CHECKOUT_TTL_MINUTES` 제거(설정·env·compose·spec이 "무활동 자동 해제"로 안내), deploy.md 토큰 무효화 문구 정정.
- 회귀 `test_ops_followups.py` 3 + 백업 503·HR 첫 지연 테스트(수정 전 코드에서 cascade 잔재 1·1, 반려·대기 미스캔 재현). 실컨테이너(postgres 이미지, 명명 볼륨=root 소유): 비root 쓰기가 옛 경로 Permission denied → 새 경로 성공·사이드카 덤프 생성. 일회용 postgres: 빈 DB 리셋 정상 → 시드된 DB는 exit 1·12맵 보존. pytest 1813·ruff·py3.11·tsc·lint·vitest 1523. 관리자 매뉴얼 ko/en·backup/deploy/setup-once·spec·CLAUDE.md 반영.

## 2026-10-20 — 7c CSV 데이터 왕복: 시스템 리뷰 D-1~D-8 (dev)

- 같은 맵 재가져오기는 제목을 앞뒤 공백 없이 맞추되 원래 제목을 남기고, 기존 Start 연결을 유지한다(되돌아가기가 있는 맵은 행 순서만 바꿔도 Start가 옮겨 갔다). 판단 노드엔 병렬 출구를 두지 않고(`NodeIn`·CSV·AI 세 경로) 레거시 gateway 병렬 팬아웃은 CSV에도 Parallel=Y로 내보내 Excel과 맞춘다. 닫히지 않은 따옴표는 시작 줄을 알리는 오류(나머지 파일을 한 셀로 삼키던 것, 카탈로그 CSV 포함), 인용된 CRLF는 LF로, UTF-8이 아니어서 EUC-KR로 읽은 파일은 경고. 저장이 받는 값은 가져오기도 받는다(Other 메모 200자, http가 아닌 링크는 경고만, 열기는 여전히 http(s)만). `'=x` 같은 원문은 수식 가드를 한 번 더 붙여 왕복 보존(FE·관리자 CSV 동치). 이름 없는 단계·공백만 다른 같은 제목은 내보내기 경고. 자동 반복 ◇는 한 맵에서 두 번째부터 번호(사용자 결정 D-7=A, 어댑터·L5 창작부·역변환·미리보기 같은 규칙). L5 캔버스 에디터엔 CSV 가져오기를 열지 않는다.
- 회귀 vitest +10(가져오기 6·내보내기 2·가드 1·미리보기 1, 수정 전 전부 실패) + 기존 3건을 새 규칙으로, `test_csv_roundtrip_followups.py` 5(수정 전 코드에서 판단 병렬 유지·같은 이름 ◇ 둘·가드 누락 재현). 브라우저 `scripts/pw-verify-csv-roundtrip-followups.mjs`: 수정 전 프런트 0/7 → 수정 후 7/7, 기존 `pw-verify-csv-import-merge.mjs` 31/31. pytest 1808·ruff·py3.11·tsc·lint·vitest 1523·COMPONENTS 최신. 매뉴얼 ko/en(편집·관리자)·`backend/app/manual.md`·CLAUDE.md 반영.

## 2026-10-20 — 7b 편집·SP·비교 잔여: 시스템 리뷰 A-2·A-4·F-4~F-9·W-2·W-3·W-5·W-7·W-8 (dev)

- 그래프 저장은 같은 노드·엣지·그룹 id 중복과 그룹 부모 사이클을 422로(엣지 중복은 유니크 위반 500이었다). 일반 맵 승인 요청은 서버가 출력 규칙을 다시 보고(사용자 결정 F-4=A, 기존 게시본은 그대로), 설정 버전 패널의 제출·셀프 게시도 에디터와 같은 체크리스트(`lib/save-blockers.ts`)를 거친다. L5 확정 변경 요약에 계보를 넘겨 임포트 캔버스의 무변경이 변경으로 보이던 것을 막고, 고정 버전은 고정 중일 때만 비교·확정 서명에 든다. SP 노드의 상속 파라미터 5종은 `NodeIn`이 비우고(AI 신규 SP 경로도), 병렬 출구 키는 다듬지 않는다(끝 제목 공백). 숫자 정규화는 NFKC+JS trim+ASCII 숫자로 FE·BE 동치, 카탈로그 비교는 lower/toLowerCase, 이름 자르기는 코드 포인트, 서버는 고립 서러게이트를 지운다. 비교 화면 변 선택은 자동정렬과 같은 `pickEdgeHandleSides`, 맵 설정 `showToast` 메모(패널 재조회 반복), 열람권 없는 SP(refs `hidden`)엔 등록 요청·버전 피커를 숨기고, 펼친 SP 자식은 F2로 이름 편집이 열리지 않으며, 대시보드 누적 그래프는 기간 누적 합.
- 회귀 `test_editor_followups.py` 8(수정 전 8 실패) + 기존 병렬 키 다듬기 테스트를 새 규칙으로, vitest +15(정규화 표 FE·BE 짝·고정 버전 diff·저장 체크리스트·코드 포인트·신규 SP). 브라우저 `scripts/pw-verify-editor-followups.mjs`: 수정 전 프런트 0/5 → 수정 후 5/5(제출 체크리스트·비교 No 라벨·잠긴 SP·F2·L5 무변경). pytest 1803·ruff·py3.11·tsc·lint·vitest 1508·COMPONENTS 재생성. 매뉴얼 ko/en·`backend/app/manual.md`·CLAUDE.md 반영. F-3(대표 끝 삭제 시 자동 재지정)은 사용자 결정 대기.

## 2026-10-20 — 7a 권한·결재 잔여: 시스템 리뷰 C-6·C-7·E-12·B-9·B-10·B-11·W-4·W-6 (dev)

- 로그인 제한은 AD bind 전에 시도를 센다(동시 요청이 bind로 새던 것). HR이 로컬 계정을 인수하면 로컬 sysadmin 부여를 DB·캐시에서 거둔다. 분류 권한자 교체는 허용 그대로, 빠진 사람에게 `fw_admin_removed` 알림(사용자 결정 E-12=B). AI 비교 요약 캐시는 제출 코멘트가 있을 때만 키에 넣고(기존 캐시 유지), 동시 최초 저장은 유니크 위반을 되돌려 먼저 들어간 행을 갱신한다. 버전 이름 바꾸기는 편집 가능 상태+점유자·오너·sysadmin만, 만료본 삭제 409(이벤트 cascade 유실). 받은함 승인 창에 동봉 공개 범위 줄, 승인자 피커는 빈 안내 문구(`PrincipalPicker emptyLabel`)·열 때 후보 다시 읽기(`onOpen`), 반려본 비점유자 안내는 회수 뒤 요청으로.
- 회귀 `test_approval_followups.py` 7(수정 전 6 실패). postgres 동시 최초 생성: 수정 전 UniqueViolation으로 중단 → 수정 후 0/10. pytest 1795·ruff·py3.11·tsc·lint·vitest 1493·COMPONENTS 재생성, 브라우저 `scripts/pw-verify-approval-followups.mjs` 5/5. 매뉴얼 관리자 ko/en 반영. 로컬 sqlite가 영구삭제 맵 id를 재사용하며 권한·요청 행을 물려주는 것(H-11)을 다시 확인 — 7d에서 처리.

## 2026-10-20 — 업무 체계 6단계: 시스템 리뷰 E-1·E-3~E-10 (dev)

- 확정 요청이 대기 중이면 결정권자(직속 L5 관리자·sysadmin)만 점유한다(사용자 결정: 요청자 재점유 금지). 요청자 에디터는 `confirm_pending`으로 "Confirm requested" 읽기 전용이 되고, 요청·철회 직후 점유를 다시 읽는다(10초 폴 대기 없음). 휴지통 캔버스는 `live_linkage_map_id()`로 홈 열기·확정 집계·개요·대시보드에서 "캔버스 없음"으로 읽고 포인터는 남겨 sysadmin 복구로 돌아온다(그 사이 새 캔버스면 복구 409, 만든 L5 관리자 휴지통에선 숨김, 영구삭제는 포인터를 비운다). 레벨이 바뀌는 이동은 맵·캔버스를 품으면 422, 개명·이동도 형제 이름 중복 409, 다른 캔버스 플레이스홀더가 가리키는 L5 삭제 409, 삭제 시 권한 행도 지운다. 슬롯 교체로 은퇴한 맵을 L5 캔버스에 새로 링크하는 저장은 422(낡은 자동저장이 옛 노드를 되살리던 경로, FE는 새로고침 안내). 승인 대기 배지·대시보드는 결정할 side 기준. 이동은 트리 잠금, 캔버스 생성은 카테고리 행 잠금(+홈 버튼 진행 중 가드), 승인 결정은 요청 행 잠금, 조상 걷기 3곳 사이클 가드.
- 회귀 `test_framework_integrity.py` 12(수정 전 코드 11 중 10 실패, 1은 빈 서브트리 레벨 변경 허용 가드, 사이클 테스트는 수정 전 무한 루프라 제외) + 대시보드 테스트 시드를 실제 요청 모양(`sides`)으로. 일회용 postgres:16 동시 요청: 반대 이동·캔버스 두 번 열기·양측 동시 승인·요청 뒤 폴→승인이 수정 전 6/6 → 수정 후 0/10, 읽기·가드 SQL 12/12. pytest 1788·ruff·py3.11 컴파일·tsc·lint·vitest 1493·COMPONENTS 최신, 브라우저 `scripts/pw-verify-fw-confirm-checkout.mjs` 7/7. 매뉴얼 ko/en(편집·관리자)·`backend/app/manual.md`·CLAUDE.md 반영.

## 2026-10-20 — 편집 유실 5단계: 시스템 리뷰 W-1·E-11 (dev)

- 저장 안 된 편집(자동저장 2초 전·저장 실패)이 있으면 앱 안 이동을 확인창으로 붙잡는다(사용자 결정: 자동 저장 후 이동 대신 확인창, 저장하고 이동·저장하지 않고 이동·머무르기). `lib/navigation-guard.ts` 하나가 링크는 window 캡처로 가로채 고른 뒤 링크 자신의 동작을 다시 태우고(로고 전체 새로고침 등), 버튼 이동은 `runGuardedNavigation`으로 감싼다(에디터 5곳·상단 바 설정·로그아웃·알림·맵 전환·AI 챗·체계 탐색·피드백·체계 칩). 묻는 동안 자동저장을 멈추고 머무르면 다시 건다. 브라우저 뒤로 가기는 물을 수 없어 언마운트에서 바로 저장한다. L5 확정·확정 요청은 대기 중인 편집을 먼저 저장한다(`flushPendingSave`). `ConfirmDialog`에 셋째 버튼(`secondary`).
- 수정 전 코드로 같은 백엔드에서 재현: 이름 변경 150ms 뒤 Notices 클릭 → PUT 0·제목 그대로, L5 확정 POST가 PUT보다 먼저 나가 v1.0이 옛 위치(120, 화면 192)로 확정(E-11 PLAUSIBLE → 확인). 수정 후 `scripts/pw-verify-leave-guard.mjs` 12/12(ko·en). vitest 1492(+8)·tsc·lint·COMPONENTS 최신. 매뉴얼 ko/en 7장·`backend/app/manual.md`·CLAUDE.md 반영.

## 2026-10-19 — 운영 postgres 전용 4단계: 시스템 리뷰 H-1~H-7·H-10 (dev)

- 컬럼 형은 기동 시 모델 기준으로 넓힌다(`db._reconcile_column_types`, PG 전용·멱등): 시간대 없는 TIMESTAMP → TIMESTAMPTZ(USING 없이, 쓰기와 같은 세션 TimeZone으로 읽어 같은 절대 시각), VARCHAR → TEXT(`app_settings.value`가 JSON 목록을 담아 500이던 것). `_ADDED_COLUMNS` 시각 DDL도 TIMESTAMPTZ. 노드 제목·엣지 라벨·유저 그룹 이름은 컬럼 길이 200을 `max_length`(422)와 입력칸 `maxLength`로 막는다. 공지 수정·받은함 날짜 삭제 개수는 KST 날짜로 자른다(PG가 UTC `Z`로 응답해 저장마다 시작일이 하루 당겨졌다). compose 4서비스 `restart: unless-stopped`, backend `FORWARDED_ALLOW_IPS`=compose 서브넷(오른쪽부터 믿지 않는 첫 주소라 위조 불가). 복원 런북은 안전 덤프 → 빈 스키마 → `--exit-on-error --single-transaction`(덮어쓰기는 새 FK 테이블이 드랍을 막아 섞인 DB를 남겼다).
- HR 대량 퇴직은 동기화를 멈추지 않고 회차 이력으로 남긴다(사용자 결정 2026-10-19, `hr_sync_runs` 최근 200회·Batch jobs HR 카드 이력·펼치면 신규·퇴직·재입사·삭제·중복 ID 명단, 퇴직+삭제 ≥ 관리 인원 5%·10명이면 Mass departure). 피드 판정: status 대소문자 무시, orgLevels 누락은 기존 조직 유지, 중복 loginId는 재직 행 우선.
- 회귀 `test_hr_sync_history.py` 11·`test_postgres_schema_guards.py` 6. 일회용 postgres:16에서 수정 전 코드로 재현 → 수정 후 확인(카탈로그 500→200, 201자 제목 500→422, 시각 naive→같은 시각 aware·재기동 무변경, 런북 섞인 DB exit 1 → 덤프와 동일 exit 0·읽기전용 권한 유지·깨진 덤프는 무기록), uvicorn 미들웨어로 위조 XFF 무시 확인. pytest 1776·ruff·py3.11 컴파일·tsc·lint·vitest 1484·COMPONENTS 최신, PG 백엔드 브라우저 임시 스모크 10/10. 매뉴얼 ko/en·`docs/deploy/backup.md`·`deploy.md`·CLAUDE.md 반영.

## 2026-10-19 — 임포트·AI 데이터 무결성 3단계: 시스템 리뷰 P0-3·G-2~G-8·G-10·G-11 (dev)

- 재전달·정정의 활동 계보를 seq가 아니라 직전 게시본에 다시 맞춘다(`_match_prior_lineage`: 같은 제목 → 같은 자리·같은 유형, 나머지는 새 계보). 활동을 끼우거나 빼도 오너 값이 한 칸씩 밀리지 않는다. 캠페인 유지 카드 행은 `keep: true`로 조립돼 임포터가 그 맵의 그래프·지정값·거버넌스를 쓰지 않는다(역변환 왕복이 메모·칸 없는 값을 떨어뜨리던 경로). 0.5에 칸이 없는 활동 부서·담당자는 승계·서명 밖, 색은 전달분이 빌 때만 승계, 맵 SP 비용은 비어 오면 유지. 파일이 기존 분류를 다른 상위로 옮기거나 다른 L5 소속 맵의 taskId를 담으면 파일 단위 error(사용자 결정: 드라이런 오류, 이름만 다르면 warning), 외부 AI 프롬프트 골격에 실제 L1~L5 코드를 싣는다.
- 캠페인: 정정 카드의 건너뛰기 = 유지로 되돌리기(사용자 결정, 플레이스홀더로 바꾸면 기존 L6가 활동 1개로 재게시됐다), 유지 카드 피드백 = 정정 자동 전환(사용자 결정, 패널 안내 한 줄), 세션 시작 뒤 다시 게시된 L6의 정정 카드는 연결 확정을 409로 막고 스냅샷을 최신본으로 갈아 끼운다(스냅샷에 `version_id`). AI content null은 빈 응답으로 받아 기존 무효 응답 처리(재시도·실패·사용량)를 탄다. 맵 인터뷰 적용은 작업본 키(기존 노드 id)로 먼저 이어 이름을 바꾼 노드의 값을 지키고, 확인창에 지워질 노드를 나열하며, 시작 Draft가 게시됐으면 `POST /interviews/{id}/retarget`이 지금 Draft로 옮기고 작업본·체크포인트 키를 같은 계보 id로 바꾼다.
- 회귀 `tests/test_import_integrity.py` 17건(수정 전 HEAD 15건 실패, 나머지 2건은 이름만 바뀐 활동·예외 색 가드) + vitest 키 매칭 2·프롬프트 체인 1. pytest 1759·ruff·tsc·lint·vitest 1484·COMPONENTS 최신, 브라우저 임시 스모크 14/14(이 과정에서 retarget 뒤 옛 작업본으로 병합하던 FE 버그를 잡음). 매뉴얼 ko/en·`backend/app/manual.md`·`docs/samples/interview-json-0.5.md` §2-3·CLAUDE.md 승계 항목 반영.

## 2026-10-19 — 결재 무결성 2단계: 시스템 리뷰 B-1~B-8 (dev)

- 정족수는 행 개수가 아니라 "지금 유효한 승인자 전원 ⊆ 승인 집합"(`workflow.is_fully_approved`)이다. approve·퇴사 재평가가 같이 쓰고, workflow GET의 `approvals`도 지금 승인자 것만 내보내 FE 진행 수가 따라온다. `version_approvals` (version_id, approver) 유니크를 걸었고, 기존 DB는 기동 시 중복 행을 지운 뒤 인덱스를 만든다(사용자 결정: 자동 정리, 지운 수는 경고 로그). 전이 5종은 버전 행을 `FOR UPDATE`(+populate_existing)로 다시 읽어 판정하고, 버전 생성·재게시·게시 채번은 맵 행을 잠근다(sqlite는 무시, 운영 PG 대상).
- 제출자가 퇴사했거나 편집권을 잃으면 sysadmin이 대신 게시·회수한다(사용자 결정, `submitter_unavailable`가 에디터·설정 버전 카드 버튼을 연다). 제출·게시·회수는 편집권이 남은 사람만 할 수 있다. 권한 변경을 적용한 직후 편집권을 잃은 점유자의 체크아웃을 푼다. 승인자 전원 퇴사로 취소될 때 동봉 가시성 요청도 같이 거둔다. 재게시는 진행 중 버전(Draft·결재 중·승인·반려)이 하나라도 있으면 409이고, FE 버튼도 같은 조건이다. 휴지통 맵의 전이는 404이고 인박스에서도 빠진다. 제출된 버전의 점유 요청은 인박스·큐에서 빠진다(행은 남아 Draft로 돌아오면 다시 결정). 인박스 처리 실패는 토스트로 알린다(종전엔 조용히 묻힘).
- 회귀 `tests/test_approval_integrity.py` 14건(수정 전 HEAD에서 13건 실패). B-2는 일회용 postgres:16에서 리뷰어 동시 요청 7종을 돌려 수정 전 5~6/6 → 수정 후 0/10, 5xx 없음. 기동 정리도 PG에서 확인(중복 2행 삭제·유니크 인덱스). pytest 1740·ruff·tsc·lint·vitest 1481, 브라우저 임시 스모크 9/9(오너는 버튼 없음·sysadmin 대신 게시·인박스 실패 토스트). 매뉴얼 ko/en·`backend/app/manual.md`에 대신 처리·재게시 조건 반영.

## 2026-10-19 — 보안 경계 1단계: 시스템 리뷰 P0-1·P0-2·F-2·C-2·C-4·C-3·E-2·G-9·H-8 (dev)

- 시스템 리뷰(`docs/qa/2026-10-19-system-review.md`, main 미커밋) 권장 순서 1단계. 공통 원인은 "id 소속 미검증"과 "읽기 가드가 그래프 GET에만 있음" — 그래프 PUT은 다른 버전의 node·group·edge id를 409로 거부하고 삭제를 버전으로 한정, 새 subprocess 링크는 지정 맵·열람 가능 맵·캔버스 소속 L6만, 새 핀은 링크 맵 버전만(기존 링크·핀은 grandfather), `resolved?pinned=`는 남의 버전이면 404. refs는 볼 수 없는 미지정 링크 맵을 가린다(`get_subprocess_refs`·`_load_graph`가 user 필수 인자). framework draft 룰은 version·comment 게이트(deps)로 옮겨 AI 챗·코멘트도 막는다.
- 코멘트 목록·워크플로·승인자 목록에 viewer 게이트, 승인자 변경은 현재 owner 역할(오너 미상 맵의 "누구나 관리" 개방 폐기, 에디터 버튼도 `myRole` 기준), 열람권을 잃은 맵의 AI 챗 기록은 목록에서 빼고 읽기 404, 관리자 테이블·CSV의 `password_hash`는 `[redacted]`이고 검색 대상에서도 뺀다. 사용자 결정: 공개 맵 Draft의 비협업자 열람은 현행 유지.
- 회귀 `tests/test_security_boundary.py`(리뷰 재현 시나리오 15) + E-2 캔버스 테스트 1. 기존 테스트 다수가 고정 id("n1" 등)를 버전 간 재사용해 우연히 하이재킹에 기대고 있었다 — `f"{name}-{version_id}"`로 정리했고, 없는 맵(999)에 새로 링크하던 4건은 실제 맵을 만들어 링크한다(새 링크는 부재·권한 부족을 같은 422로 거절 — 존재 오라클 방지). pytest 1726·ruff·tsc·lint·vitest 1481, 브라우저 `pw-verify-sp-ends` 23/23 + 승인자 버튼 임시 스모크 3/3.

## 2026-10-19 — PNG 출력 정렬 유지 (feat/print-align-anchor 머지)

- 표시 정보·입출력 펼침·Word 글꼴로 출력 보기의 노드 크기가 바뀌면 가운데·오른쪽·아래 정렬이 깨졌다(좌표가 왼쪽 위 기준이라). `lib/print-anchor`가 캔버스 크기로 노드마다 축 기준(시작·가운데·끝)을 이웃 투표로 추론하고, 출력 크기로 다시 잰 뒤 그 기준이 제자리에 오도록 출력 좌표만 옮긴다(`printView.shifts` → `layoutNodes`, 저장 좌표 불변). Word 클래스는 출력 보기부터 붙여 글꼴 폭까지 재고, 하위프로세스 배너·"최신본 따르는 중"도 출력 보기에서 뺀다(`printing`). 캔버스에서 표시 정보를 바꿀 때의 같은 어긋남은 범위 밖이다(정렬 의도를 저장해야 해서 범위가 크다).
- 간격 보정 `buildHeightShiftField`는 이동을 따로 받는다(3번째 인자). 행은 저장 좌표로 묶고 충돌만 옮긴 좌표로 판정한다. 옮긴 좌표로 행을 묶으면 커진 가운데 정렬 노드가 윗행과 합쳐져 위 노드를 덮었다(실측 42px). 같은 크기로 겹친 이웃은 한 표로만 세어, 8px 격자로 우연히 맞은 먼 노드를 이기지 않게 했다.
- 검증: vitest 1490, 스모크 `pw-png-export-align` 13항목(가로 줄+입출력 펼침 포함)·`pw-png-export-word` 38항목.

## 2026-10-19 — PNG 문서용 출력 다듬기: 나눠 싣기·인쇄 크기 고정 머리 블록·연결선 펼침 선택·입출력 사선 상자 (dev)

- 워스트케이스 실출력(긴 LR 맵이 A4 폭에 띠처럼 줄어 노드 1.7~3pt, 머리 블록·범례도 같이 줄어듦)을 목업으로 보이고 사용자 확인 뒤 진행. 머리 블록·범례·연결 기호는 pt 고정 합성(`getPrintHeaderPt`, 제목 11·메타 7.5pt), 나눠 싣기(`lib/print-split`: 노드·라벨·영역 제목은 자르지 않고 빈 칸 후보 DP로 조각 수 최소→교차·영역·폭 고르기, 노드 글자 7pt 한도, 조각 위아래 내용만 남김, 잘린 연결선 양쪽 같은 문자, 같은 dpi 조각을 jszip(exceljs가 이미 끌어오던 3.10.1, 직접 의존으로) 무압축 ZIP 하나로)를 편집 Word·비교 문서용이 공유(`downloadDocumentFigure`). 옵션 창 칩 "연결선 펼침"(기본 켬, 끄면 팬 레인 없이 한 점에서)·인쇄 패널 "나눠 싣기"(조각 수는 창을 연 순간 화면 측정이라 "약 N조각" — 실제 출력은 문서 글꼴로 다시 재 하나쯤 다를 수 있다).
- 문서용 출력만: 꺾임 반경 5→2(`edge.data.cornerRadius`, `resolveEdgePath` → RF·우회·팬 사이 구간), 노드·라벨·입출력 상자 1px, 시작/끝 칩 아이콘·조직 주의 아이콘(원래 필드 아이콘으로)·외부 L6 홈 색(탭·아이콘·출처 칩) 대신 테마 톤(`NodeActions.printDocument`), 조건 캡션 헤일로 끔(L5 어두운 헤일로가 종이에서 번짐). 화면+출력: 입력물 상자 왼쪽 위·산출물 상자 오른쪽 아래 사선(`.bpm-io-box`, clip-path+::before로 사선도 1px 선, 사용자 결정). 출력 중 커서 가림막(창이 닫히면 커서 아래 노드 호버가 찍히던 것).
- 검증: vitest 1479·tsc·lint, 스모크 `pw-png-export-word` 37·`pw-compare-png-export` 23(ZIP 조각 dpi 동일·가림막 동안 호버 0), 워스트케이스 맵 실출력(편집 Word 5조각·비교 문서용 3조각·L5). 매뉴얼 md ko/en·`backend/app/manual.md` 갱신, 슬라이드 덱은 미재생성.
- 후속(피드백 "미리보기에서 펼침 차이가 안 보임"): 두 옵션 창 미리보기의 갈래·합류를 펼침=반경이 다른 원호 레인 / 끔=한 줄기 T로 그리고, 바뀌는 두 자리만 따로 겹쳐 칩 전환 때 그 자리에서 쉬머(`buildSampleStepPath`, 꺾임 화면 r5·문서 r2). 비교 샘플은 삭제 연결선이 추가 연결선과 핸들을 함께 쓰게 해 끔이면 한 줄기로 겹쳐 달린다. 샘플 노드 입출력도 사선 상자로, 칩에 설명 툴팁. 스모크 38·25.

## 2026-10-17 — 출력 라운드 후속 정리 (dev)

- 축소 드래그 성능: 영역(그룹) 멤버는 드래그 동결(#R2)에서 빠져 프레임마다 nodes를 커밋했고, 그때마다 페이지·노드·엣지 전부가 다시 렌더됐다(시드 120노드 맵 한 제스처에 노드 재렌더 ~1.2만). 영역 박스를 `GroupBoxLayer`로 떼어 라이브 좌표 신호(`lib/drag-live`)만 구독하게 하고 영역 멤버도 동결, 드롭 링·합류 강조는 `lib/drop-target` 스토어로 옮겨 드래그 중 페이지 렌더 0. 운영 빌드 A/B(새 시드 3회, 첫 제스처): drag-fit p95 33.4→16.8ms, 33ms 초과 ~55→~3프레임, 메인 스레드 95→63%, 노드 재렌더 ~12,200→~540. idle·pan·zoom 동일 60fps. 노드별 엣지 셀렉터는 이제 샘플 1.4%라 유지. `pw-perf-canvas` 계측 보강(`RENDERS`·`WHY`·`DRAG_FIT_NODE`·`DRAG_PACE`·`CPU_THROTTLE`·재렌더 계수)·스모크 `pw-verify-group-drag-live`.
- `pw-verify-export` 8건 실패는 스크립트가 낡은 것(기능 무결): Metrics 섹션이 버퍼 편집이라 섹션 Save를 안 눌러 파라미터가 저장되지 않았고 칩·새로고침·CSV·Excel 단언이 연쇄 실패했다. 현재 계약으로 갱신 — 섹션 Save, CSV H.MM·수식 셀 `'` 가드 왕복, Excel 머리글 행 탐색(맵 정보 행 아래)·소요시간 `[h]:mm` 시간 값(ExcelJS는 Date로 읽어 직렬값 환산), 분기 노드 파라미터는 마름모 아래 확장 블록. 22/22.
- 매뉴얼 슬라이드(사용자 ko/en 74→78장): 출력 라운드 화면 반영 — 데이터 장의 "내보내기" 1장을 PNG 옵션 창·인쇄 크기와 A4 가이드·Excel 인쇄용 문서·CSV 미리보기와 경고 4장으로 나누고, 비교 장에 비교 PNG 내보내기 1장. 캡처는 이번 라운드 스모크(`pw-png-export-word`·`pw-compare-png-export`·`pw-excel-export-print`·`pw-smoke-csv-export-dialog`, PW_LANG)를 `.shots/manual9/`로(세로로 긴 창은 잘라 쪽 번호와 겹치지 않게 — 넘침 검사는 글 열만 본다). PDF 4종 재생성.
- webpack 빌드: page.tsx가 테스트용으로 export하던 `toAppEdges`·`buildGraph`(+`normalizeEdgeLineStyle`)를 `lib/graph-serialize.ts`로 옮겼다(Next 페이지 모듈은 허용된 export만 — `--webpack` 타입 검사 실패, 배포 Turbopack은 무관했다). 동작 불변, 두 빌드·vitest 통과.

## 2026-10-16 — 출력 형식 전수 개선: Excel·CSV·비교 PNG·다운로드 (dev, 3갈래 병렬 머지)

- PNG Word 작업을 기준으로 다른 출력 전부를 검토(실행 확인 포함) 후 추천안 전부 진행(사용자 결정: Excel 소요시간=실제 시간 값 `[h]:mm`, 비교 PNG=표시 토글 실시간 미리보기). 파일 이름은 `lib/download-name`(KST `YYYYMMDD-HHmm`, 빈 조각 제거) 한 규칙 — 종전 UTC라 오전 파일이 전날로 찍혔다.
- Excel: 인쇄용 문서(A4 가로 한 장 폭·머리글 행 반복·머리글/바닥글·맑은 고딕·중립 머리글 색(개인 강조 색 의존 제거)·줄바꿈·자동 필터·이름 열 고정·맵 정보 행·통합문서 속성), NaN 셀 차단, 창은 실제 파일 모양 미리보기·형식 기억·실패 안내·Esc 이중 제거·포털. CSV: 수식 셀 가드(`'` 접두, 가져오기에서 복원 — CSV 인젝션·`- 확인` 깨짐), 창 안 미리보기·내려받기 전 경고(i18n)·파일 이름, 다운로드 헬퍼 `downloadBlob` 통일, 템플릿 BOM 이스케이프, 인터뷰 JSON 새로고침 뒤 다운로드, 매뉴얼 PDF 창(현재 언어 우선·파일 없음 감지)과 PDF 4종 재생성.
- 비교 PNG: 연결선 차이 색·점선 보존(종전 전부 검은 실선), 선택 강조 제외, 비교 PNG 옵션 창(화면 그대로/문서용(차이 색 유지)·정보 블록·범례·표시 정보 칩·인쇄 크기, 샘플 미리보기 실시간), `exportComparePng(root)`, 공용 `ToggleChip`. 출력 창 버튼 ko 취소/내려받기. 스모크: PNG 31·비교 18·Excel 22·CSV 16·열 선택 12·PDF 24·WBS 20·Excel 1안 10. `pw-verify-export` 8건 실패는 오늘 이전 코드도 동일(스크립트의 파라미터 입력 단계가 낡음, 별도).

## 2026-10-16 — 캔버스 렌더 성능 회귀 복구 (dev)

- "느려졌다" 피드백 → 운영 빌드 A/B(10-06 `01f1ae70` vs 현재, 120노드·157엣지 시드, `scripts/pw-perf-canvas.mjs`)로 측정: 대기·휠 이동이 60→28fps. 메인 스레드는 오히려 한가했고 트레이스상 프레임마다 GPU 합성(SwapBuffers)이 ~21ms — 원인은 조건 캡션 아이콘의 `filter: drop-shadow`(노드마다 합성 레이어, 연결선 애니메이션 중 매 프레임 재합성). 유리 효과·흐름 점은 무관(끄고 재도 동일). 필터 제거로 60fps 복구.
- 드래그 CPU의 ~10%가 React Flow `EdgeLabelRenderer`의 인스턴스별 querySelector(스토어 갱신마다) — 전달물 점으로 라벨 없는 엣지도 렌더러를 쓰게 되며 커졌다 → `EdgeLabelPortal`(RF 인스턴스당 1회 조회) 교체(에디터·비교). 드래그 중 꺾은선 장애물 구독 동결도 추가. 맵 전체가 보이는 축소 드래그(메인 스레드 ~95%)는 10-06과 같은 기존 병목(페이지·사이드바 프레임 리렌더, 노드별 스토어 셀렉터)으로 별도 라운드 후보.

## 2026-10-16 — 마크다운 뷰어 가독성 + 매뉴얼·공지 갱신 (dev)

- 공지·매뉴얼·AI 답변이 쓰는 `MarkdownView`가 문단 안 줄바꿈을 공백으로 합쳐 작성자가 나눈 줄이 한 덩어리로 읽혔다 → 한 줄 바꿈은 `<br>`, 목록 항목 아래 들여쓴 줄은 그 항목 안 줄바꿈, 들여쓴 하위 항목은 한 단 들여 속 빈 원. 간격 단계를 줄 1.65 < 항목 0.35em < 문단 1em < 제목 1.4em로 벌리고 preflight가 지운 글머리표·번호를 되살렸다. 공지·매뉴얼 실화면 캡처로 확인.
- 매뉴얼 ko/en(편집 4장 A4 가이드·9장 PNG 옵션 창·입출력·조건 캡션·전달물 점, 사용 안내 화면 설정·비교 색·결재 대기 카드)과 AI 기준 `backend/app/manual.md`를 10-07~10-16 변경으로 갱신, 공지 초안 `docs/notices/2026-10-16-release.md`. 슬라이드 덱은 미재생성.

## 2026-10-16 — PNG 내보내기 Word 문서용 테마 + 옵션 창 (dev)

- 사내 Word 문서에 순서도를 붙이려면 캔버스 톤(파스텔·점 격자·Pretendard)이 안 맞았다. 시안 3종 → 최악 케이스 목업 비교 후 B안 구조(그레이 노드+알약 터미널+상단 정보 블록)에 스타일 3종(모노·그레이·그레이+네이비) 선택으로 결정. 캡처 순간에만 뷰포트에 `.bpm-export-word--<style>` 토큰 클래스를 붙여 CSS로 덮는다(Arial+맑은 고딕, 노드 지정 색 무시, 편집 배지·SP 배너 제외, 노드 `transition-all`은 캡처가 시작값을 찍어 끔). SVG는 클론에 스타일시트가 안 실려 엣지·영역은 같은 변수를 읽어 인라인으로.
- PNG 버튼·우클릭·Ctrl+⇧E가 옵션 창(`png-export-modal`)을 연다: 화면 그대로/Word, 샘플 미리보기, 병렬 표시(출구 뒤 이중 막대+범례)·정보 블록 칩, 교차 표시(없음·점프·터널, 직교 구간 교차만·T자 합류 제외), 켜고 끌 때 쉬머 등장·퇴장(`ShimmerPresence`). Word면 오른쪽 인쇄 크기 패널이 펼쳐져 A4 세로/가로·그림 너비로 cm·dpi·노드 글자 pt를 보여 주고, 출력 배율을 300dpi 쪽으로 올리며 PNG에 pHYs를 실어 Word가 그 너비로 삽입하게 한다(Windows Word 실물 미확인). 선택은 localStorage `bpm.pngExport`.
- 검증: vitest 1406·tsc·lint, `pw-png-export-word.mjs` 22항목(스타일별 실제 다운로드·dpi 청크·캔버스 원복).
- 2차(실출력 피드백): dev 연결선 라벨이 "묶음+라벨+전달물 점"으로 바뀐 걸 묶음에 칠해 테두리가 두 겹·Yes/No 색이 남았다 → 안쪽 `bpm-edge-label`만 덮고, 전달물 점·IO 링크 표식 숨김, 노드·라벨·영역 각진 모서리(터미널 알약은 유지). 옵션 창에 표시 정보 칩(두 테마 공통, 출력 순간에만 캔버스에 적용 `printView`)과 입출력 펼침(목록 줄 제한 해제+분기 IO 아일랜드 펼침), 미리보기 샘플 노드는 HTML로 겹쳐 줄마다 쉬머. A4 가이드 B안(사용자 선택): 보기 카드 스위치+세로/가로, 캔버스에 왼쪽 끝·9pt 실선·7pt 점선(내보내기 프레임 기준, `getA4GuideWidths`가 인쇄 계획과 같은 식), localStorage `bpm.a4Guide`. 스모크 28항목. 가이드가 뷰포트 안이라 PNG에 찍히던 것은 `bpm-print-hide`(캡처 중 숨김 공통 훅)로 제외, 스모크 31항목.

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

## 2026-10-06 — dev → main 머지(2차): 위·아래 변 최소 높이 40px·흐름 펄스 개정

- **최소 높이**(사용자 결정 40px): 같은 높이 위→위 연결이 노드 위 20px(RF 기본 스텁)에서 납작하게 돌던 것. `lib/edge-stub.ts` 한 곳: 위·아래 끝이 있고 두 끝이 서로 정면이 아니면 꺾은선 스텁 40px·곡선 꼭짓점 40px(제어점 4/3배), 마주 보는 연결은 제외(강제하면 좁은 간격에서 선이 지나쳤다 되돌아옴). 에디터·L5·비교·팬아웃 루프백 레인(34→40)·SP 미리보기 역행 통로(24→40) 공통.
- **흐름 펄스**(사용자 결정): 분기는 함께 반짝임 삭제→차례 반짝임만(차례 아닌 갈래는 완전히 사라졌다 돌아옴, 0.55s 템포 유지). 병렬은 공통 36px를 형제가 같은 속도로 함께 간 뒤 각자 길이(`getPathSpan` 맨해튼 근사)에 맞춘 속도로 75% 동시 도달, 천천히 가속·가운데만 빠르게·끝 감속.
- 검증: vitest 1260·tsc·lint·pytest, `pw-smoke-edge-fanout` 25/25, `pw-verify-io-refresh` 25/26(펄스 체크 복구 — 뷰포트 2400×1400으로 줌 ≥ 0.5, 남은 1건은 로컬 L5 임포트 데이터 전제). 매뉴얼 ko/en·슬라이드·AI 도움말 갱신.

## 2026-10-06 — dev → main 머지: 출력 규칙·병렬 출구·IO 계약 최신화·흐름 펄스·node 22·용어 통일

- **출력 규칙**(사용자 결정, 일반 맵·L5 공통): 출구(일반 `__primary__`, SP 끝 키)마다 연결 1개, 병렬 출구(노드 속성 `parallel_outputs`, 우클릭 `Parallel`)는 2개 이상, decision·start(기본 병렬)는 규칙 밖. 단일 소스 `lib/output-rules.ts` ↔ BE `find_output_rule_violations`(확정 게이트 6). SP in 핸들 받기 전용·출구 우측 한 점+출구 목록·`사용량/끝 수` 배지. 레거시 `gateway=parallel`은 도출만, 병렬 해제 시 소거. 병렬 노드는 속성만 켜도 안쪽 링(노드 자신의 `outline`이라 테두리와 함께 스냅).
- **흐름 펄스**(갈래점 기호 대신): 병렬 75%·분기 동시 출발→반짝임→한 갈래 50%, 선택 강조, 정지 장면(모션 축소·PNG·비교), 줌 0.5 미만 끔, "Flow dots" 범례. RF 엣지별 svg라 마운트 때 SMIL 시계 정렬.
- **IO 계약 최신화**: CSV·Excel 내보내기 열 선택(잠금 열 CSV Name·Parallel·Next, Excel No·Name·Type·Parallel·Next, Next는 줄 번호), 재전달 승계 `INHERITED_NODE_FIELDS`, AI 표면 담당자 실명 제거, 비교·요약·확정 엣지 정체성 통일, L6 어댑터 팬아웃 ◇ 자동 생성.
- **배포**: Dockerfile `# syntax` 지시어 제거(서버 Docker Hub 차단)·프런트 node:22-alpine(amd64 tar 반입, `deploy.md` §0).
- **문구**(사용자 결정): 짧은 흐름 필·칩은 언어 무관 영어(N in parallel·Parallel exit 등), ko 용어 통일 게시본·오너·Draft·승인자·거절·Check out·입력물/산출물·주관 부서·연결선(AI 글 "초안"·체계 권한 "편집권"은 유지), 매뉴얼 md·슬라이드·AI 도움말 동반. 그 밖에 유저 카드 닫힘 유예 400ms, 협업자 목록 subgrid 열 정렬, 매뉴얼 8차.
- 검증(머지 시): pytest·ruff·tsc·vitest·lint·카탈로그 전부 green. 알려진 스모크 갭: `pw-verify-io-refresh.mjs` 펄스 체크는 화면 맞춤 줌 < 0.5라 실패(10-03 줌 문턱 이후 미갱신, 링 체크는 통과). 배포는 FE/BE 동시(새 컬럼 `parallel_outputs`), 서버 `ai_prompts` 오버라이드·DB 게시 매뉴얼 재게시 확인.

## 2026-10-01 — 홈 한 줄 행 말줄임 정리 (dev)

- 영/한 실측 프로브(뷰포트 1920~1100)로 두 줄 넘침·카드 밖 밀림을 수집해 3곳 수정: 대시보드 섹션 헤더(6카드 공용) 제목은 한 줄 고정·더보기 라벨이 말줄임으로 양보("My documents"·"My department" 두 줄 해소), 내 부서 범위 필 `min-w-0`(긴 부서명이 상태|버전 탭을 카드 밖으로 밀던 것), 맵 상세 버전 이벤트 칩 줄은 반쯤 잘린 칩 대신 들어가는 칩만 통째로(1줄 높이 wrap). 뒤 칩부터 말줄임(flexShrink 가중)은 칩이 전부 최소폭으로 찌그러져 폐기.
- 버전 타임라인 접힘 줄의 우측 게시 필이 만료 버전에도 green "Published"로 남아 전부 게시처럼 보였다 — 버전 상태가 expired면 중립 톤 "Expired", 좌측 타임라인 노드도 중립 테두리, 아이콘은 노드·필 모두 게시 Upload 대신 TimerOff(최근 변경 카드의 만료 아이콘과 통일). 백엔드가 남기는 `expired` 이벤트가 라벨·아이콘·색 표에 없어 펼침에 원문 "expired"·기본 아이콘으로 나오던 것을 등록(한/영 "만료"/"Expired"), 접힘 줄은 우측 만료 필 + 칩 줄은 게시부터(최신순)(게시 이력은 툴팁·펼침 상세에 유지). 맵 설정 버전 카드는 만료 버전에 단계 칩을 그리지 않아 해당 없음.

## 2026-10-01 — 맵 설정 UX 라운드: 오너 이전 후보 버그·협업자 행·드롭다운·SP 타일·버전 카드 (feat/map-settings-ux)

- **버그** — 소유권 이전 후보가 명시 user 권한 행(editor/owner)만 모아 오우닝 부서 소속(권한 행 없는 파생 editor)이 빠졌고, 백엔드 `transfer-owner`도 권한 행이 없으면 409였다. 표시명도 목 시드라 아이디로 보였다. 수정: FE 후보 = 명시 editor+ ∪ 디렉터리에서 오우닝 부서(하위 포함, BE `belongs_to_department` 미러 `lib/owner-candidates.ts`) 소속, BE는 파생 editor 대상이면 owner 행을 새로 만들어 이전(테스트 2건). 권한 응답에 `granted_at` 추가(협업자 행 메타).
- **UX(목업 A~E 승인, 사용자 보정 2건: 버전 카드 스트라이프 변 보더 제거·우측 액션 200px 등폭, 드롭다운은 트리거 등폭·간극 0)** — 레일+h2 섹션 아이콘·요약 카운트, 협업자 행(아바타·언어별 주/보조명·아이디·직급·소속/구성원 수·부여자·일시) + `PersonHoverCard`(배너에 이 맵 권한 1줄)·부서는 `OrgInfoModal`, 네이티브 select 3곳(역할·GMP·이전)을 `MenuSelect`(신규)·`SearchSelect`로 교체하고 `.dropdown-in` 등장을 한 벌로(위로 뒤집힐 땐 bottom 앵커로 밀착), 역할 메뉴 Owner 항목(빨간 호버) → `TransferOwnerDialog`(위험 구역과 공용) 게이트, SP 지정 정보는 `SpFieldTile(readOnly)` 4열 그리드(빈 필드 "미입력" 유지), 버전은 상태 스트라이프·메타·결재자 아바타·진행 단계 칩 카드. 본문 폭 680→920. 스모크 `pw-smoke-map-settings.mjs` 26/26(임시 맵 e2e 이전 포함).
- **"조건 · GMP" 카드를 서브프로세스 섹션에 흡수(사용자 결정)** — 둘 다 같은 `sp_*` 컬럼을 읽고 썼는데(카드는 2026-08-19 인터뷰 필드 승격이 지정 없이도 검토하라고 붙인 것) 같은 값이 두 번 보이고 GMP·원문 메모는 한쪽에만 있었다. 이제 SP 타일 그리드가 단일 표면: 지정 여부와 무관하게 항상 보이고, 승격 필드(GMP·시작/종료 조건·소요/실작업시간·시스템)는 타일 클릭 팝오버(`SpFieldPopover`)로 바로 `PATCH /process-fields`, 원문 메모는 타일 아이콘 슬롯(`FallbackHint`), 나머지는 지정 모달 경로. `ProcessFieldsCard` 삭제, GMP 변경 알림 팝오버(되돌리기)는 팝오버 확정/취소로 대체. `pw-smoke-field-promotion.mjs` [17][18][19]를 타일 기준으로 갱신.
- 후속(dev): SP 타일 그리드를 섹션 폭 반응형(`@container`, 44rem 미만 2열·이상 4열, 헤더 액션 줄바꿈)으로, 버전 카드 좌측(스트라이프) 모서리는 직각(`rounded-r-md`) — 둥글면 스트라이프가 손톱처럼 보인다는 피드백.

## 2026-10-01 — 하위프로세스 출구 다중 연결 + 들어오는 문 네 방향 (feat/subprocess-ends → dev)

- SP 노드는 들어오는 문이 좌측 하나뿐이고 끝이 여러 개여도 출구 엣지가 전부 대표 끝으로 덮여(`withSubprocessHandles`) 끝별 흐름을 그릴 수 없었다. 사용자 결정 10건(설계 `2026-10-01-subprocess-ends-design.md`, main 머지와 함께 폐기): in만 네 방향(`in`·`in:top/right/bottom`), 끝마다 출구 엣지+끝당 출력 1개 규칙, 끝을 모르는 경로(드롭존 앞/뒤·역방향 몸체 드롭)는 출구 선택 목록 `EdgeEndModal`(대표 끝 첫 행), 출구 라벨 기본값은 끝 제목 **미러**(점선 알약·링크 아이콘, 저장 안 함), 스왑 다출력은 두 열 짝짓기 모달 `SwapOutputsModal`(짝=타깃만 교환, 라벨·끝 키는 노드 잔류, 확인해야 실행·취소=스왑 취소, 행 중앙 연결선+그려지는 모션), 펼침 게이트웨이는 끝별 호스트 엣지에만 매핑+점선 애니메이션, 합성 `sp-ends:` 안내 엣지 제거.
- 구현 축: 끝 키·in 변형 보존(`withSubprocessHandles`), 끝 한정 `sourceHandle` 인자 한 벌(`withEdge`·`insertNodeAfter/Before`·`removeOutgoingEdges`·`edgeAction/edgeSelect/pending`·`applyFlowEdges`), `swapNodeEdges(…, pairs)`, `toAppEdges` 로드 정규화(CSV·AI SP 엣지가 조용히 안 그려지던 잠재 버그 수정), `applyMirroredEndLabels` 렌더 전용. **실사고 1건**: 보조 끝 저장 엣지가 로드 직후 콘솔 에러 없이 사라짐 — 끝 핸들이 resolved 도착 뒤 늘어나는데 RF가 handleBounds를 재측정하지 않아서, `SubprocessHandles`가 끝 키 집합 변화마다 `updateNodeInternals`. 스모크 `pw-verify-sp-ends.mjs` 23/23(끝 3개 링크 맵 발행·지정, 로드·펼침·출구 목록·스왑 확인/취소·저장 payload). 불변식은 CLAUDE.md Lessons·spec §3.1, 설계 스냅샷은 main 머지와 함께 폐기(git history).

## 2026-10-01 — 엣지 팬아웃: 같은 핸들로 모이는 엣지의 나선 펼침 (feat/edge-fanout → dev)

- 같은 (노드·변·핸들) 앵커로 오가는 엣지(실데이터 13%, 루프백은 100%)가 스텁·화살촉·라벨까지 포개지던 것을 **렌더 전용 레인 배정**(`lib/edge-fanout.ts` `assignFanLanes` → `edge.data.fan`)으로 펼쳤다: 꺾은선은 게이트 포인트+원호, 곡선은 제어점 중첩, 직선은 끝점 ±3.5px. 에디터·비교·SVG 미리보기(역행) 세 표면, 저장 데이터·변·백엔드 무변경. 사용자 확정 4건(양쪽 끝·A 나선 아크·곡선 A/직선 분산/화살촉 한 점·세 표면). 반경은 배정 단계에서 압축 확정(끝마다 클램프하면 교차·NaN), 왕복 쌍(양끝 팬)은 중간 구간·라벨을 소스 레인만큼 비켜 세움. 스모크 `pw-smoke-edge-fanout.mjs` 25/25·펼침 `pw-verify-edge-fanout-expand.mjs` 10/10. 불변식은 CLAUDE.md Lessons, 설계 스냅샷은 main 머지와 함께 폐기(git history).

## 2026-09-30 — 슬라이드 매뉴얼 리스타일·카피 전면 요약 (main)

- **왜** — PDF를 실제로 내려받아 보니 슬라이드당 평균 5불릿·한국어 300자(영어 570자)의 문장형 텍스트에 레이아웃이 전부 같아 벽처럼 읽히고, 선언만 된 Pretendard가 설치돼 있지 않아 PDF는 시스템 폰트로 찍히고 페이지 번호도 없었다(사용자 지적 "글이 너무 많고 가시성이 떨어지고 단조롭다").
- **무엇** — 덱을 **카피 데이터(`docs/manual/slides/content/*.py`) + `theme.css` + `build_deck.py`**로 다시 빌드. 불릿 858개를 "리드 키워드 + 한 줄 설명" 포인트로 전면 요약(UI 요소명은 바이올렛 필 `<b>`, 키는 `<code>` 칩), 표지·챕터 구분은 L5 대시보드와 같은 네이비→차콜 하늘, 이미지 없는 슬라이드는 카드 2열, 표는 헤더 배경+얼룩 행, 슬라이드마다 푸터(덱 이름·페이지 번호), 스크린샷은 브라우저 창 프레임, Pretendard Variable data URI 임베드. 이미지 111컷은 직전 덱에서 순번 이월(재촬영 없음). 사용자 덱 ⑧ 구분 문구의 "네 가지 형식(Word 포함)" 잔재도 세 가지로 정정.
- **결정** — 증분 수술 도구 `build_slides.py`는 폐기(카피가 데이터로 들어가면서 수술 대상이 사라짐). 다음 회차부터는 content의 카피/`shot` 경로만 고치고 빌더를 돌린다. 넘침 검사 4덱 0건, PDF 4종 재출력.

## 2026-09-30 — 홈 대시보드 연동 액센트 바 등장 애니메이션·빛띠 (main)

- 500ms 지연 뒤 inset box-shadow가 150ms에 그냥 켜져 "갑자기 생기는" 느낌 → `globals.css .hover-linked`로 교체: 좌측 2px 바(::before)가 세로 중앙에서 700ms smooth로 자라나고, 같은 순간 옅은 액센트 빛띠(::after 7%·1.8초 ease-in-out, background-position만 이동이라 overflow 불필요)가 행을 한 번 훑는다(1차 spring 350ms·12%·0.9초는 튀어 보여 완화, 사용자 피드백). 지연은 keyframe delay라 스쳐 가는 호버엔 안 뜨고 이탈 시 즉시 사라지는 동작은 그대로. reduced-motion은 모션 없이 지연만 유지. 스모크 `pw-shot-home-linked-hover.mjs`는 pseudo 요소 computed style로 판정.

## 2026-09-30 — 매뉴얼 슬라이드 PDF 앱 내 다운로드 (main)

- 슬라이드 PDF 4종은 저장소에만 있고 앱에서 받을 길이 없었다 → `frontend/public/manuals/`로 옮겨 `/manuals/<deck>.pdf`로 정적 서빙(Dockerfile이 `public/` 복사·nginx `/`→Next라 배포 파일 변경 없음, 스탠드얼론 조립으로 4종 200 확인). `/manual` 뷰어의 "한눈에 보기" 메뉴를 env 없이도 상시 표시로 바꾸고 사용자·관리자 PDF 항목을 추가 — 클릭 시 바로 받지 않고 한국어/English 선택 다이얼로그(`ManualPdfDialog`, 사용자 결정)를 거친다. `export-pdf.mjs` 출력 경로도 `public/manuals/`로. 파일명 계약은 `lib/manual-pdf.ts`(vitest가 실존 검사), 스모크 `pw-manual-pdf.mjs`.

## 2026-09-30 — 정리 라운드: 메모리·md 문서·매뉴얼 5차 (main)

- **md 정리**: main 머지 완료된 AI L5 캠페인 스펙 3종(`docs/superpowers/specs/`, 코드 주석은 파일명만 유지)과 0.4 결과 핸드오프(`design/2026-09-01-interview-import-v04-result.md`. 불변식은 qa 필드맵·lessons에 흡수 완료, 실서버 점검 4항목은 git history)·템플릿 잔재 `.claude/commands/setup-from-template.md` 폐기. PROGRESS는 09-28 폴리시 라운드 항목을 4줄로 압축하고 09-24 릴리스 이전 항목(09-14~09-18)을 아카이브로 이동.
- **매뉴얼 5차(md 6종+AI 챗 매뉴얼)**: 09-24 이후 매뉴얼 동반 갱신이 빠진 커밋 델타 반영 — 계획 보드 우클릭 외부 L6 지름길·타일 전환, 삭제 예정 복구, 유지 타일 비활성, 채팅 최소화 스파클 칩, 관리 트리 단일 자식 자동 펼침, 활동별 IO 동일 경고, 엣지 라벨 강조·선택 선 보라, 홈 연동 액센트 바 0.5초. 슬라이드 덱 4종(HTML+PDF)도 같은 회차로 재생성 — 사용자 덱 71→72장(연계 캔버스 맵 설정·편집 가능자 신설, 필터 2줄·연동 액센트 바·눈 아이콘 카드·AI 보고서·엣지 라벨 강조·내보내기 재촬영, Word 삭제), 관리자 덱 42→46장(AI로 L5 채우기 4장 신설, 카테고리 관리·인터뷰 임포트 재촬영). 캡처는 `frontend/scripts/pw-manual-shots.mjs`(사용자 덱)+캠페인 스모크 스크립트의 `PW_LANG`(관리자 덱), 덱 수술은 `docs/manual/slides/build_slides.py`(Deck 도구+회차별 ops), 넘침 검사 `scripts/check-deck-overflow.mjs`. 가짜 AI에 비교 보고서 분기 추가(캡처용).
- **슬라이드 전수 검사(236장)와 6차 재촬영**: 덱에 박힌 이미지 148장을 추출해 git 이력으로 촬영 회차를 판정하고 콘택트 시트로 전량 육안 검토. 노드 겹침·엣지 라벨 가림 0건. 낡은 화면 12장(옛 홈·옛 상세 패널·역할 행 없는 인스펙터·옛 피크·밝은 L5 캔버스·옛 체계 탐색·밝은 대시보드 등), 빈 화면 2장(지식기반·연계 권한자 모달), EN 덱이 KO와 같은 한국어 캡처를 쓰던 12장(09-07 2차 촬영분)을 `frontend/scripts/pw-manual-shots-6.mjs`로 두 언어 25컷씩 다시 찍어 교체(사용자 덱 19장·관리자 덱 8장). 시나리오 재료는 API로 만든다: 더미 인터뷰 5종 Apply(플레이스홀더), 임포트 맵 draft에 역할·SP 링크 노드 PUT(체크아웃 force 인수), 슬롯 변경 delete(끊긴 링크), 공지 2건. 랜드마인: 슬롯 맵은 `DELETE /maps`가 409(슬롯 변경 경유), 라이브러리는 이미 링크된 맵 행 클릭이 피크 대신 포커스 이동, 미등록 토글은 필터 팝오버 안, 배너 버튼은 `evaluate(click)`.
- **CLAUDE.md 감사**: 루트 85점(B)·frontend AGENTS.md 90점(A). 루트에 ⑭ 상태 한 줄, 캡처 산출물 `.shots/`·`PW_LANG`·슬라이드 재생성 절차, 폐기 컬럼 유지 규칙을 추가(참조 경로 12곳 실존 확인, vitest 수치 ~1,000으로 정정).
- **캡처 이미지 정리**: 스모크 스크립트가 `docs/qa/screens/`에 남기던 PNG 31장(5.1MB, 참조하는 문서 없음·스모크마다 드리프트)을 저장소에서 제거하고 14개 스크립트의 캡처 경로를 gitignore된 `.shots/`(저장소 루트, frontend 기준 `../.shots`)로 옮겼다. 같은 스크립트들에 `PW_LANG` 환경변수(기본값은 기존 언어)로 캡처 언어를 고른다.

## 2026-09-30 — Word 맵 모드·Word 내보내기 제거 (chore/remove-word → dev)

- **왜** — 2026-07-11~26에 만든 Word 묶음(SOP `.docx` 섹션 임포트·`section` 노드·홈 Word 문서 섹션·빠른 생성·승격 복사·인터뷰 word 3스테이지·완결 문서 생성·도형 순서도 내보내기)은 `WORD_FEATURES_ENABLED=false`로 7/27부터 홈에서 가려져 있었고, Word 내보내기 버튼도 word 맵 안에서만 보여 사실상 죽은 코드였다(운영 DB에 word 맵·section 노드 없음, 사용자 확인). FE 파일 12개+스모크 3개 삭제, BE는 `/word-doc` 엔드포인트 2개·`convert_to_normal`·`WORD_STAGES`·word 애든덤 프롬프트 키 2개(`PROMPT_KEYS` 13)·`_sanitize_word_graph`·`AI_NODE_TYPES`의 `section` 제거, `fflate` 의존성 제거. 홈 목록 분리는 `lib/map-mode.ts`(`splitMapsByMode` process/framework)로 이동.
- **DB 컬럼은 모델에 "폐기 컬럼"으로 남김** — `doc_name`·`doc_sections`·`doc_imported_at`·`doc_generated_at`·`nodes.section_anchor`·`interview_sessions.mode`는 create_all로 생긴 DB에서 NOT NULL·DDL 기본값 없음이라 모델에서 빼는 순간 INSERT가 깨진다(로컬 스모크에서 `POST /maps` 500으로 적발). 마이그레이션 도구가 없고 운영 리셋 불가라 매핑만 유지하고 코드 어디서도 읽지 않는다. 드랍은 별도 마이그레이션 시점의 후속.
- 검증: pytest 1590·ruff / vitest 1039·tsc·lint·카탈로그 clean, 스모크 `pw-smoke-no-word.mjs`(8/8)·`pw-verify-library-open.mjs`(8/8). 매뉴얼 §9 내보내기·README·AI 챗 매뉴얼에서 Word 행 제거.

## 2026-09-29 — L6 활동별 IO 규칙·동일 IO 경고 (dev)

- **원인** — AI 컨설턴트 L6 행에서 같은 활동의 input/output이 같거나 L6 전체 입력물·산출물이 전 활동에 복사되는 현상은 코드 버그가 아니라 프롬프트 빈틈: 설문은 IO를 L6 단위(입력물·산출물 주관식)로만 묻고, 행 작성 계약엔 "앞 output을 다음 input에 다시 쓰면 이어진다"는 체인 힌트만 있어 활동별 IO 의미가 없었다(정정·기존 L5 학습이 `[현재 등록된 내용]`으로 되먹임). 정규화·조립·어댑터는 값을 옮기기만 한다(로컬 가짜 AI 582 액션 중 0건).
- **조치** — 행 작성·행 피드백 계약(+외부 AI 프롬프트 `interview-json-prompt.ts`·`docs/samples/interview-json-0.5.md`)에 활동별 IO 규칙 추가: input=받는 것/output=만드는 것, 같은 활동 양쪽에 같은 항목 금지, L6 전체 IO는 `fields.input_data/output_data`+첫 활동 input·마지막 활동 output만. 어댑터 `_build_nodes`가 같은 활동의 동일 IO를 warning으로 리포트(값은 그대로 착지, handoff는 그대로 넘기는 활동이라 제외 — 샘플 calibration-l5 "결과 인계").

## 2026-09-29 — 엣지 라벨 하이라이트·선택 선 색 복구 (dev)

- **라벨 알약도 선과 같이 강조** — 선의 선택색·F14 in/out 색은 `<path>`에만 걸리고 라벨(`EdgeLabelRenderer` HTML 포털)은 정적 알약 스타일이라 빠져 있었다. `lib/canvas` `highlightEdgeLabel`(선택=edge-selected+2px 링 / in=teal / out=orange, 글자·테두리=선 색, 배경 12% 틴트)을 `applyFlowHighlight` 안에서 태워 메인·펼침 자식·게이트웨이 공용. Yes/No 파스텔은 선과 같은 규칙으로 강조 중엔 흐름 색이 우선.
- **선택 엣지 선이 회색(#555)이던 문제 복구** — globals의 바이올렛 규칙을 React Flow 기본 CSS의 같은 특이도 규칙이 순서상 이겨 글로우만 바이올렛이었다. RF가 읽는 `--xy-edge-stroke-selected`로 선택색을 넘겨 해결. 펼침 자식 엣지 클릭 선택은 이미 동작 중(2026-09-02)이라 변경 없음. 스모크 `pw-verify-edge-label-highlight.mjs` 16/16.

## 2026-09-29 — L5 캠페인 외부 L6 픽스·지름길·채팅 칩 통일 (dev)

- **채팅 수정 시 외부 L6 증발 픽스** — `feedback_session`(relations)만 태스크로만 known을 만들어 외부 참조 노드를 정규화가 "세션에 없는 카드"로 버렸다(첫 제안엔 있다가 한 번 고치면 사라지는 실사고). 다른 네 경로와 같은 `_known_task_names`로 통일하고 프롬프트 [L6 카드]에도 relations 제안과 같은 소속 L5 표시를 단다. 회귀 테스트는 픽스 전 코드에서 실패 확인.
- **계획 단계 외부 L6 지름길** — 좌측 [외부 L6] 탭이 목적·첨부 위에 묻혀 안 보여, 보드 빈 영역 우클릭 → [외부 L6 추가...]가 그 탭을 열고, 새 카드(+로 만든 이름 없는 타일) 우클릭 → [외부 L6 목록 보기...] → 체계 피커 모달(`ExternalL6Modal`, 연결 다이얼로그와 같은 임베드)에서 고르면 그 타일이 제자리(단계·선행 유지)에서 외부 타일로 바뀐다. 기존 L6(keep/revise)·이미 외부인 타일은 대상이 아니다.
- **연결 단계 채팅 최소화 칩 = 에디터 AI 도우미와 같은 컴포넌트** — 에디터 page.tsx에 인라인이던 끌 수 있는 스파클 칩을 `AiChatMinButton`으로 뽑아 두 표면이 공유한다(캠페인 쪽은 우하단 고정 MessageSquare 버튼이라 룩·동작이 달랐다). 기본 위치·끌기·제자리 클릭 복원 동일. 스모크 `pw-fw-consult-external-menu.mjs` 13/13.

## 2026-09-29 — 첨부 문서 pptx 허용 (dev)

- 첨부 허용 포맷에 `.pptx` 추가 — 2026-07-23 최초 파싱 구현 때 5종(pdf/docx/xlsx/txt/md)으로 시작한 뒤 배제 결정 없이 굳어 있었고, 사내 보고 자료가 PPT 중심이라 컨설턴트 첨부 실효성이 컸다. 백엔드 `parsing.py` 단일 계약(`ALLOWED_EXTENSIONS`+`_parse_pptx`: 슬라이드 순서·텍스트 프레임·표·발표자 노트, `python-pptx==1.0.2`)에 얹고 FE 3표면(맵 인터뷰·L5 계획 단계·설정 KB) accept·안내 문구를 맞췄다. 구 `.ppt`/`.doc`/`.xls` 바이너리는 라이브러리가 못 읽어 계속 제외.

## 2026-09-28 — 홈 대시보드 맵 호버 연동 표식 교체 (feat/linked-hover-effect)

- 연동 강조를 배경(alt)에서 좌측 2px 액센트 바(inset box-shadow)로 교체하고 마우스가 올라간 행 자신은 표식에서 제외 — 호버 배경(pearl)과 같은 계열이라 어느 행에 마우스가 있는지 구분되지 않아 오류처럼 보였다(사용자 선택: 액센트 바, 대안 이름 색·점선 링·링크 아이콘은 기각). 6개 섹션(최근 열람·내 부서·내 문서·결재 대기·최근 변경·점유 목록)이 `dashboard-hover.tsx` 상수 하나를 공유해 일괄 적용. 검증 `pw-shot-home-linked-hover.mjs`(admin.sys, 7/7).
- 표식 켜짐 500ms 지연(`delay-500`, linked일 때만 붙어 꺼짐은 즉시) — 스쳐 가는 호버로 시선이 분산되지 않게 하고 다른 섹션에서 찾을 때만 돕는다. 열기 버튼 의도 판정 300ms보다 한 단계 뒤로 잡았다(700ms는 찾는 상황에서 답답). 스모크에 200ms 미표시·900ms 표시·이탈 즉시 소거 체크 추가(9/9).

## 2026-09-28 — AI L5 캠페인 폴리시 라운드 (feat/fw-consult-polish → dev)

- **계획 단계 모델 교체**: 단계를 카드의 명시적 `stage`(`lib/plan-cards.ts`)로, 선행은 "직전 행의 비어 있지 않은 부분집합" 불변식(`normalizeDependencies`)으로 저장. 선행 편집은 타일 우클릭 체크 메뉴, 선행 연결선 SVG 점선, 삭제는 "삭제 예정"으로 남겨 복구 가능(`removedIds`), 기존 유지 타일은 점선·흐림 비활성. 설문은 빈 주관식=미답변(서버 자동채움 폐기), single 복수 답·문항/제출 코멘트, ready 단계 "플레이스홀더(임시)로 생성" 건너뛰기+`retry` 재드로잉.
- **연결 캔버스·미리보기**: 엣지 클릭 선택/더블클릭 라벨/우클릭 메뉴, 비분기 노드의 두 번째 나가는 엣지는 확인 후 교체. 어댑터 `_build_flow_edges`가 seq 역행 엣지를 loop로 재분류하고 Start/End 폴백을 붙여 L6 Start 미배선 픽스, `ScopePreview`는 역행 엣지를 위로 도는 직각 점선(`buildPreviewEdgePath`)로, 연결 제안은 `align_relations_to_plan`으로 계획 선행 쌍을 보강.
- **외부 참조 타일(2026-09-29)**: 계획 좌측 [목적·첨부 | 외부 L6] 세그먼트, 카드 `mode="external"`+`external{ref_id,l5_code,…}`, `_known_task_names` 단일 소스로 캔버스·relations·검증·확정 관통, 조립 시 `externalTasks`. 타일 색은 소속 L5 코드 FNV-1a 해시(`getExternalL5ColorByCode`, 남색 점선은 비활성처럼 읽혀 폐기), 상태 칩은 공용 `CardModeChip`(유지=회색·정정=앰버·외부=L5색).
- **그 외**: 빈 AI 응답(사고가 토큰 소진)은 `EMPTY_REPLY_MESSAGE`로 구분해 사고 끄고 재시도, 행 드로잉은 사고 없이 호출. 관리 트리 자식 하나뿐인 사슬 자동 드릴인(`drillSingleChain`), 관리 패널 타일 컴팩트·인터뷰 JSON 전폭 스트립. 검증: vitest 1092·pytest 1596·스모크 8종 통과.

## 2026-09-28 — PI팀 회의 자료: 컨설팅 범위 맵의 시스템 오너 협의 (docs/pi-meeting-prep → dev)

- PI팀이 "컨설턴트 도구가 원본, BPM은 뷰어"로 선회한 상황에 대비해 `docs/notices/2026-09-28-pi-meeting-prep.md` 작성·머지. 검토 후 구도 재정리(사용자 결정 2026-09-28): 프로세스맵은 한 서비스에서만 관리하고 병행·주기 재전달·미러링은 제외, 선택지는 **안 1 Agent 존속(PI팀이 시스템 오너, BPM은 종료 또는 동결)** / **안 2 종료 시 완성본 1회 이양(BPM 원본)** 둘. 안 2의 성립 조건으로 식별 키(맵=`taskId`, 단계=순번이라 삽입 시 비교가 삭제+추가로 갈림) 절 추가. 부록 수치는 9/24 기준 그대로(중요 수치 아님, 사용자 결정).

## 2026-09-24 — 릴리스 후 정리: md 문서·프론트 디자인 통일성·매뉴얼 (dev)

- **md 문서 정리**: main 머지 완료된 설계 스냅샷 3종(assignee-role·catalog-alias·interview-v04 설계)과 구현 플랜 3종 폐기(계약은 CLAUDE.md·0.5 계약 3표면으로 이미 흡수) — 코드 주석은 `docs/design/` 접두만 떼고 파일명 유지. PROGRESS는 2026-09-12 이전 793줄을 아카이브로 이동(헤더 무손실 검증), 인덱스 2종(`docs/README.md`·`design/README.md`) 상태 문구 갱신. 링크 검사 74파일: 남은 깨진 링크는 아카이브 원문 7건뿐(원문 보존 정책).
- **프론트 디자인 통일성 감사·수정**(`rules/frontend/design.md` 기준 15항목 그렙 감사): 사용자 문구 긴 대시 8곳(i18n 4·JSX 4)과 ★ 글리프 제거, 굵기 500(`font-medium` 68곳)→600·700 3곳→600(캔버스 노드 제목만 500 유지 — `lib/canvas.ts` measureText 미러 `"500 14px"`와 한 쌍), 네이티브 체크박스 10곳→공용 `CheckInput`(캔버스 IO 행 12px 2곳은 밀도 예외로 유지), `text-white`/`bg-white` 14곳→`text-on-accent`/`bg-surface`, 로딩바 글로우 제거, 스와치 폴백 hex·ERD rgba→토큰, `rounded-[5px]`→`rounded-xs`·`rounded-2xl`→`rounded-lg`, `strokeWidth` 1.6~1.8 65곳→1.5. 통과: 다크모드 0·아이콘 라이브러리 Lucide 단일·섀도 유틸 전부 토큰. **남긴 판단**: Lucide 크기 실태는 14(444)·12(316)·16(242)로 규칙(16 고정)과 어긋남 → 규칙을 사다리(12 인라인/14 컨트롤/16 기본/28 빈 상태)로 고칠지 결정 필요, 레거시 1000/1001 드롭다운 18곳은 모달 안에서 가려지므로 포털화 후속, `process-node.tsx`의 `text-xs`/`text-[10~11px]` 33곳은 줄높이가 노드 높이에 얽혀 별도 스윕. z 사다리에 실사용 단(1000·1100·1250·1340) 문서화.
- **매뉴얼 4차 갱신(md 6종 + AI 챗 `backend/app/manual.md`, 2026-09-19 adba1488 이후 델타)**: 관리자 §13 AI L5 진입을 레벨별 타일(하위로 이동·L5 만들고 AI로 시작·AI로 작업/AI 세션 이어서, 세션 목록 폐기, 같은 이름 409)과 **인터뷰 JSON** 섹션으로 정정, 관리 부서 상속·L5 캔버스 그룹·검색 L5 그룹·선택된 맵 스트립·필터 2줄(정렬·Type·이 필터 지우기)·비교 기본 선택/패널 폭 드래그/우하단 노드 표시 카드·연계 캔버스 맵 설정(**편집 가능자** 탭) 추가. **긴 대시(—) 전수 제거**(사용자 지시 2026-09-21, 7파일 약 750자 → 0, 문장별 재작성, KO/EN 라인·헤딩·불릿 정렬 유지 검증). 슬라이드 덱 4종은 **미재생성**(신규 캡처 ~6컷×2언어 필요, 절차는 memory `manual-slides-refresh`) — 후속.

## 2026-09-24 — dev → main 릴리스 (2026-09-19 이후 dev 135커밋 요약)

- **AI 컨설턴트 L5 캠페인 1·2라운드(feat/ai-consultant-l5 → dev, 2라운드 스프린트 ①~④):** 맵 하나에 묶이던 AI 컨설턴트를 L5 단위 "위층 세션"으로 — BE `framework_interview_sessions/_tasks` + `app/framework_interview/`(계약·정규화 `normalize.py`·조립·러너 병렬 `collect_jobs`·기존 L6 학습/정정 `existing.py`·세션 `canvas`↔relations 왕복·자연어 피드백 엔드포인트) + `routers/framework_interviews.py`(sysadmin 전용). FE `/framework/consult/[sessionId]`: 카드 보드(전 행 클릭=상태별 패널) → 계획(`depends_on` 단계 행, 타일 드래그·FLIP, `lib/plan-cards`) → AI 생성 설문(절차의 애매한 지점 초점, 섹션 4종, 주관식 타이핑, 종류별 hover) → 연결 편집 캔버스(`relations-canvas.tsx`)+플로팅 피드백 채팅 단일 게이트(`ScopeWindow`) → 등록=인터뷰 JSON 0.5 임포트(dry run 자동). 관리 패널은 좌 트리 : 우 상세 패널 + 레벨별 타일 액션(`fw-level-actions.tsx`, 같은 부모 아래 이름 중복 409) + 계단식 피커(`framework-cascade-picker.tsx`). 산출물 계약은 CLAUDE.md "인터뷰 JSON 0.5 계약 3(+1)표면"(IO는 문자열 배열). 가짜 AI `frontend/scripts/fake-ai-server.mjs`(`FAKE_AI_WORST=1`)로 스모크 `pw-fw-consult*.mjs`. 설계 스펙 `docs/superpowers/specs/2026-09-2*`는 코드 주석 provenance로 유지, 구현 플랜 6종은 이 릴리스에서 삭제(git history).
- **홈 업무 체계 뷰 = L5 포커스 드릴다운 + 탐색 플로팅 패널(feat/fw-l5-list·fw-drill-columns → dev):** `components/maps/framework-drill.tsx`(브레드크럼·형제(1):하위(2) 두 열·L5 275px 컴팩트 카드·우측 `CategorySummaryCard` 크로스페이드) + `framework-explorer-modal.tsx`(계단식 트리 ↔ ERD식 다이어그램 `lib/framework-diagram.ts`, 중심 브레드크럼 GoToMenu, 창 비례 `PANEL_SIZE`, z 1200). BE `/categories/nodes`에 전 레벨 `l5_count`, L5 `canvas_state·admin·slot_pending_count`. 재제안 금지: 방사형·브라우저 전체 모달·형제 칩·조상별 숫자 칩. 규모 시드 `backend/scripts/seed_framework_scale.py`(L5 2,000).
- **부서 뷰의 L5 연계 캔버스 6종(dev):** `framework-map-card.tsx` · 관리 부서 `ProcessCategory.admin_department`(B안, 비면 상위 상속 `resolve_admin_departments`, 캔버스 `owning_department`는 응답에만 파생) · 캔버스 설정 탭 읽기전용화(`framework-access-panel.tsx`, 결재 대기 탭 `can_confirm`/`can_decide_slot` 실값) · 필터 2줄 + 정렬(`lib/map-sort.ts`, Type 그룹 OR) · FW 뷰 검색 그룹(`framework-search-groups.tsx`) · L6 스트립(`selected-map-strip.tsx`, 뒤로가기 popstate 복귀).
- **비교 화면(feat/compare-ai-report·display-fields-float → dev, 2라운드 ①):** AI 요약을 결재자 개조식 보고서 4블록(`CompareSummaryOut` kind 9종, `ai_compare_summaries` diff 해시 캐시, AI 탭 열 때만 호출) + 제출 코멘트 AI 초안(`/compare/submit-note-draft`, 프롬프트 키 `submit_note_contract` 9번째) · 우하단 노드 표시 정보 플로팅 카드(`node-display-float.tsx`, 비교 키 `bpm.compare.nodeDisplayFields`) + 라이브러리 드롭 중심 보정 · diff 전용 토큰 `--color-diff-changed` · 초기 base≠target(`lib/compare-initial.ts`) · 인스펙터 폭 드래그(`lib/use-resizable-width.ts`) · L5 하늘 캔버스 드롭존 밝은 기반색. 함정: `.env` OpenAI 실키는 `chat_template_kwargs`로 400(운영 SGLang 무관).
- **문서·검증:** 매뉴얼 6종·AI 챗 매뉴얼·슬라이드 덱 4종(71장) dev 최신 동기화(`/sync-all` 일치), 낡은 스모크 4종을 드릴다운 id로 이식, lessons에 Tailwind display 이중 지정·이펙트 내 setState·워크트리 복합 Bash 함정 기록. 릴리스 게이트: backend pytest 1593·ruff, frontend vitest 1086(94파일)·tsc·lint green, 컴포넌트 카탈로그는 stale이라 재생성.

## 2026-09-18 이전
- 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-09-30·09-24·09-02·08-12 이동분 포함) + git history.
