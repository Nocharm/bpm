# Progress

프로젝트 진행 로그. 커밋 직전 갱신 (`rules/common/git.md`). **한 줄 요약만** — 상세는 git 이력·`docs/spec.md` 참조.
최근 요약만 유지하고, 이전 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-07-20 전체 스냅샷) + git history로 아카이브한다.

## 2026-08-29 — 외부 L6 C안·플레이스홀더 에러레드 (dev)
- 연계 캔버스 외부 L6 = 뉴트럴 바디+좌측 5px 홈 L5 컬러 탭+틴트 배지·아이콘(시안 4종 중 사용자 선정 C안 — 기존 18% 파스텔은 홈과 구분 약함).
- 플레이스홀더(linked_map_id 빈 SP) = 점선 에러레드 바디+동톤 배너. 개념 확정(§10.1): 임포트가 타 L5 소속 L6를 자리로 파두고 후차 연결 — 출처 L5 컬럼·검증 완화는 임포트 트랙으로 분리.
- compare가 linkedMapId 미전달로 모든 SP에 "링크 미지정" 배너 오표시하던 기존 버그 동봉 픽스. 명시 null만 강스타일 적용(미전달 표면 가드).

## 2026-08-29 — 메이저 체크박스 커스텀 통일 (dev)
- 네이티브 체크박스를 앱 언어로 교체 — appearance-none rounded-sm(hairline→checked:accent) + peer-checked Lucide Check(text-on-accent).

## 2026-08-29 — 타임라인 더보기 최상위 기준 (dev)
- 3개 클램프를 최상위 아이템(그룹=1) 기준으로 산정하고, 펼친 그룹의 하위 멤버는 슬라이스 무관 전부 노출(2단계: topItems slice → open 그룹 평면 전개).

## 2026-08-29 — 토글 체크 리빌 + 그룹 라벨/들여쓰기 (dev)
- 유지/삭제 요약은 평소 숨기고 체크 시 grid-rows 아코디언으로 리빌(체크 행위가 읽기 유도). 그룹 헤더 라벨 vX.x → "버전 N"(i18n home.verMajorGroup), 펼친 멤버 카드는 ml-7 들여쓰기로 하위 표시.

## 2026-08-29 — 메이저 토글 구체 필 + 버전 메이저 그룹핑 (dev)
- 토글 아래 산문 설명이 안 읽힌다는 피드백 → 실제 유지/영구삭제 라벨 필 행(MajorImpactRows, 토글 compact·모달 배너 공용)으로 교체, 최초 확정만 짧은 문구(majorDescFirst). 버전 타임라인에 groupByMajor(framework 맵 한정) — vX.Y 연속 구간을 마이너 2개↑일 때 그룹 헤더(Layers·개수·최신 필·최신시각)로 접고 클릭 시 멤버 카드 평면 삽입(최신 메이저가 앞), 카드 강조는 idx→newestId 기준으로 교정.

## 2026-08-29 — 인스펙터 확정 섹션 안내 시인성 (dev)
- 확정 섹션 4곳을 모달과 같은 필 언어로 통일 — 최신 확정 캡션(Workflow 아이콘+초록/muted 필)·메이저 토글 목표 버전 필·무변경 안내(Info+버전 필)·변경 요약 헤더(GitCompare+기준 필)와 엣지 증감(Spline+색상별 +N/-N/~N 필). i18n 5키 재편(latestLabel/notConfirmedShort/noChangesAfter/changesTitle/edgesLabel).

## 2026-08-29 — 메이저 승급 모달 시인성 (dev)
- 안내문구를 ConfirmDialog 리치 폼으로 재구성 — 유지(Archive+초록 필)/영구 삭제(Trash2+빨강 취소선 필, 없으면 None 필) 행 + 비가역 경고 라인(TriangleAlert). 최초 확정(스냅샷 없음)은 배너 생략. i18n majorModalPrune/NoPrune → Keep/Delete/None/Irreversible 4키로 분해.

## 2026-08-28 — L5 캔버스 개선 7종 (feature/l5-canvas-refinements)
- 사용자 피드백 반영: 소속 L6 삭제 금지(onBeforeDelete 필터+서버 422)·외부 L6=홈 L5별 색(SubprocessRefOut.category_id, subprocess 단일색 규칙에 외부 예외)·분기/끝 노드 허용(끝 규칙 포함)·좌상단 체크리스트→L5 탐색기(전 레벨 트리·내 위치·타 L5 열기/생성)·우상단 칩→"L5 map" 태그·메이저 승급 토글 행+영구삭제 안내 모달(직전 라인 X.0·최종만 유지 프룬, FrameworkConfirmOut.pruned_labels)·확정 게이트(레이아웃 외 변경 없으면 409/버튼 비활성, FIELD_MSG lib 승격+computeVersionDiff·엣지 시그니처로 변경 요약 노출). 게이트: pytest 1189·vitest 803·tsc/lint/ruff 그린·스모크 12/12·기능 검증 11/11.

## 2026-08-28 — Framework L5 연계 캔버스 구현 (feature/framework-l5-canvas)
- 스펙 전체 구현 완료: BE(모델 4컬럼+category_permissions·역할 파생 mode 분기·멱등 linkage-map 시드/자동 보강·framework-confirm maj.min·subprocess-only 검증·가드 4종·표면 3종) + FE(트리 L5 버튼·에디터 모드 플러밍·Confirm 섹션·트리 피커·출신 배지·권한자 모달·홈 제외). 게이트: pytest 1186·vitest 795·tsc/lint/ruff 그린·실브라우저 스모크 10/10(`pw-smoke-framework-canvas.mjs`).

## 2026-08-28 — 비교화면 버전 선택 명확화 + 필드 diff 상태색 (feature/compare-ux)
- 상단 BASE/TARGET가 어느 쪽 기준인지 안 읽히는 피드백 → 역할 캡션을 언어설정 따르는 "기준 (변경 전)/대상 (변경 후)"로 교체하고, native select을 커스텀 드롭다운으로 바꿔 행에 상태 필+변경일(`VersionOut.updated_at` 신규 노출, 모델엔 기존 존재) 표시. 반대편 선택 버전 행은 역할 태그+클릭 스왑(동일 쌍 차단). 변경 사항 패널 제목 아래 "base → target" 방향 캡션 상시 노출. 게이트: pytest 1179·vitest 802·tsc/lint/ruff 그린 + 실브라우저 캡처.
- 필드 diff를 파라미터 단위 상태색으로 세분화(생성=초록·삭제=빨강+취소선·변경=노랑 배경+바뀐 부분만 취소선/굵게 — `lib/compare-field-diff` 공통 접두·접미 절단) — 변경 목록 행·캔버스 DiffFieldPills 공용(`components/compare-field-diff.tsx`). 잘린 긴 값(설명 등)은 호버 시 전체 내용 팝오버(clampToViewport, overflow 실측 판정). vitest 8건 추가(802).

## 2026-08-28 — Framework L5 연계 캔버스 설계 스펙 (main)
- L5 "상세보기" 캔버스(소속 L6=subprocess 노드 전원 배치·타 L5의 L6 가져오기·Start/End 없음) 브레인스토밍 확정: 실맵 `mode="framework"`+`ProcessCategory.linkage_map_id` 1:1(L6 목록 오염 차단), 카테고리 레벨별 권한자 신설(하향 상속·캔버스 한정), 라이브 편집+본인 확정 스냅샷(minor/major), 열 때 자동 보강. 스펙: `docs/superpowers/specs/2026-08-28-framework-l5-linkage-canvas-design.md` · 구현 플랜: `docs/superpowers/plans/2026-08-28-framework-l5-linkage-canvas.md` (16태스크).

## 2026-08-27 — 인스펙터 UX 3종: 요약 아코디언·소유/승인자 섹션·SP 카드 Linked from (main)
- 속성 빈상태 개편: ① 맵 요약을 아코디언화(기본 접힘 — 접힘 헤더 우측 아이콘+숫자 3쌍이 요약을 대신, 영속 없음) ② 그 위에 소유·승인자 섹션 신설(`map-ownership-section.tsx`, 맵 탭 협업자 섹션과 같은 details 박스 — 오우닝 부서 리프·오너/승인자 UserPill, 표시 전용). ③ SP 지정 카드에 Linked from(역참조) 하위 아코디언 — page.tsx `spUsage`를 prop으로 공유(카드별 재조회 없음)해 3개 탭 마운트 일괄 적용, designated일 때만·기본 접힘·영속 없음(카드 접으면 리셋). 소유·승인자는 언어설정 우선노출+폴백 — 이름은 approval-panel resolve 규칙(ko=korean_name∥영문), 부서는 formatDeptName+buildKoreanDeptByPath(모듈 캐시로 세션당 1회 fetch — 빈상태가 선택 변경마다 리마운트되는 것 대응). tsc/lint/vitest 794 + 실브라우저 스크린샷 7장(ko/en 언어 전환 포함, 콘솔 에러 0) 검증.

## 2026-08-27 — 캔버스 노드 IO 링크 행 호버 하이라이트 (main)
- 인스펙터 IO 링크 항 호버의 상대 노드·경로 엣지 하이라이트를 노드 내 IO 행에서도 동일 점등 — 계산을 `computeIoLinkHighlight`(io-items.ts 단일 소스)로 추출해 두 표면 공용, 캔버스 쪽은 NodeActions 컨텍스트 `onHoverIoLink`(ref 미러 stable 콜백)로 배선. 링크 행(`linkState!=="plain"`)에만 이벤트를 달아 plain 행 hover는 상태 무변동. 단위테스트 3건+실브라우저 스크린샷(미러→원본·원본→미러·소등) 검증.

## 2026-08-27 — 배치 작업 상태 표시: 설정 > Batch jobs 탭 (dev)
- 백업·인원(HR)동기화의 최근 시도 시각·성공/실패를 설정 Database 카테고리 새 탭(sysadmin)에서 표시. 새 테이블 `batch_job_runs`는 (job, outcome) 복합 PK upsert라 "최신 성공·실패만 보전"이 스키마로 강제 — 정리 배치 불필요. HR은 `run_full_sync`(가드 중단·예외=failure, 스로틀은 미기록), 백업은 사이드카가 psql로 기록(CREATE IF NOT EXISTS 가드 — 모델과 스키마 계약, 변경 시 양쪽 동기화). pytest 5건+docker e2e+실브라우저 스크린샷 검증.

## 2026-08-27 — DB 자동 백업(db-backup 사이드카) + 복구 런북 (main)
- 운영 안정성 요구로 일간 배치 백업 도입. compose 사이드카(postgres:16-alpine 재사용, 04:00 KST + 기동 베이스라인, `pg_restore --list` 검증 통과 시에만 확정, 14일 보존)로 결정 — 호스트 crontab은 git 밖 설정이라, 앱 내 스케줄러는 앱 장애와 결합이라 배제. 로컬 Docker로 덤프→검증→보존정리→복원→실패경로 e2e 실측.
- 1단계는 서버 디스크만(사용자 결정) — 디스크 장애 무방비 한계·오프서버 확장 경로·`.env` 수동 사본 필요를 `docs/deploy/backup.md`에 기록.

## 2026-08-27 — IO 단일 항목은 헤더 없이 행 하나로 (main)
- 항목이 1개뿐인 IO 박스는 헤더(펼침 토글·카운트)가 과함 — 헤더를 생략하고 행이 박스를 직접 채운다. side 구분은 체크박스 자리가 담당: 휴식 시 인풋/아웃풋 아이콘 상시(헤더 대체), 호버·체크 시 체크박스(일반 행과 동일 — 첫 구현의 호버=아이콘은 반대라 정정). 접힘 상태는 단일 모드에서 무시(헤더가 없어 다시 펼 수 없음). 2개 이상은 기존 목록 그대로. 상태별 실브라우저 스크린샷 검증.

## 2026-08-27 — 가시성 동봉 드롭다운 세로 줄바꿈 픽스 (main)
- ko에서 승인 요청 모달의 공개 범위 드롭다운을 열면 '비공개'가 Current 필에 밀려 한 글자씩 세로로 꺾이던 것 — 옵션 행 nowrap+필 shrink-0, 메뉴 w-max(트리거보다 옵션이 넓을 때 콘텐츠 폭). 셀프게시 팝오버·설정 게시 패널 공용 컴포넌트라 세 표면 동시 해결. before/after 실측.

## 2026-08-27 — IO 항 분리: 대시 폐기 → 행간 (main)
- 체크박스 자리 상시 대시는 지저분하다는 피드백으로 즉시 폐기(같은 날 롤백). 대신 행간 `space-y-[3px]`로 항 분리 — 2줄 클램프 항목이 덩어리로 구분. 3.5줄 캡은 새 스트라이드(18+3px) 기준 max-h 63→72px 재조정. 호버 체크박스·체크 유지 동작은 원래대로.

## 2026-08-27 — 캔버스 IO 링크 표식·필수/선택 호버 색 (main)
- NodeIoDetails 행에 링크 상태 표식 — 원본(output_ids)·미러(input_links/output_links) 공통 Link2 액센트 아이콘+방향 툴팁, 독립(plain) 항은 없음. SP 노드는 로컬 링크 필드가 없어 제외(체크 키 규칙과 동일). 인풋 행 호버 색으로 필수/선택 구분 — 필수=`bg-error/10` 로즈·선택=중립 surface-alt(+기존 뮤트 텍스트), 행 title 툴팁(Required/Optional input) 동반.

## 2026-08-26 — 피커 조직 근접도 정렬 (main)
- 협업자 피커(새 맵 모달·설정 협업자 추가)와 담당자 지정 피커(인스펙터·편집 모달)의 기본(무검색) 순서를 이름순 → 내 조직 근접도 순으로: `lib/org-proximity`(다리 수 0~3=3다리 내 우선, 4=밖, 5=org 빈 사람 최후순위, 버킷 내 이름순). 검색은 로직 그대로 — PrincipalPicker·SearchSelect 모두 filterByQuery 랭킹이라 입력 순서와 무관. eligible-assignees 응답엔 org_path가 없어 디렉터리 스토어(fetch-on-use 캐시)로 보강. 승인자 피커는 기존 순서 유지.
- 검증: 유닛 5케이스 + 실브라우저(협업자 피커 상단 8명 전원 내 파트, 검색 랭킹 유지). 담당자 플라이아웃(addMode) 자동화는 헤드리스에서 안 열려 스샷 미확보 — 동일 정렬 함수·배선이라 로직 동일, 수동 1회 확인 권장.

## 2026-08-26 — 알림 상세 행위자 유저 필 (main)
- 상세 문장의 {actor} 자리를 파츠 분할(`formatNotificationBodyParts`, 센티널 ⟬actor⟭)해 필로 렌더. 카드가 UserHoverCard(간이)가 아니라 **PersonHoverCard**(인물 카드 — 직급 필·메신저·말단 부서+조직 경로 아코디언, ko는 한글명 우선) 재사용으로 확정. 필은 surface+헤어라인·caption 크기 — 상세 패널(surface-alt) 위에서 bg-surface-alt 필이 묻히는 시인성 픽스. 버전·이름·인용의 따옴표 표기도 일괄 칩 처리 — 센티널을 RichVar 6종(actor/version/from/to/copy/snippet)으로 확장, 템플릿이 감싸던 따옴표는 파츠 빌드 시 제거(버전 칩은 v번호 뱃지 동반), 플레인 텍스트 표면(벨/카드/검색)은 따옴표 유지. 후속: 칩=카드 어포던스로 통일 — 버전 칩은 인터랙티브(0.7s 호버/클릭 → 버전 카드: 상태·생성 KST·`?version=` 딥링크 이동, getMap lazy 1회·missing 폴백), 카드가 애매한 이름류(from/to/copy)는 볼드 텍스트, 인용은 이탤릭 “…” — 칩 모양은 카드 열리는 것에만. 행위자 필 이름은 언어선택 병기(ko 한글(영어)/en 영어(한글), 한글명 없으면 영문 단독), 버전 칩·카드는 라벨 앞 톤다운 v번호. 행위자 없는 유형·레거시는 1파츠 유지. ⚠️ Edit 도구 \uXXXX가 리터럴 NUL로 박히는 함정 재발 — 파이썬 바이트 치환으로 교정.

## 2026-08-26 — 알림 리치 렌더·전수 컨텍스트 보강 (main)
- 26개 생성 지점 전수: `notifications.payload`(JSON, `_ADDED_COLUMNS` 자동 ALTER)에 맵 이름·버전 라벨/번호·행위자·사유 등 구조화 동봉, 영어 `message`도 맵 이름 포함으로 보강(레거시 표시·폴백 겸용). `workflow.get_map_name` 헬퍼.
- FE `lib/notification-format.ts` — type+payload를 언어 토글에 맞는 {유형 칩·제목(맵 이름)·상세 문장}으로 렌더(en/ko 템플릿 26유형+기계 사유 코드 번역, 자유 텍스트 사유·공지 제목은 원문). payload 없는 레거시/미지 유형은 message 원문 폴백. 벨 드롭다운 2줄 리디자인(w-96·아이콘·시각)·받은함 카드/상세(유형 칩+절대 KST) 적용, 검색은 렌더 텍스트 포함.
- 검증: BE pytest 1173(payload 계약 테스트 추가)·FE vitest 782(포매터 7케이스) / 실브라우저 — 실워크플로(submit→approve→publish·reject)로 알림 생성 후 ko/en 벨·받은함·레거시 폴백·반려 사유 스샷 확인, 콘솔 에러 0.

## 2026-08-26 — retire 시 원본 협업자·승인자 이어받기 (main)
- 휴지통 체크 시 원본 `listMapPermissions`+`listApprovers`를 협업자 → 승인자 순으로 스테이징(제출 체인 grant→PUT 순서와 일치). 본인 행·오우닝 파생 부서 제외, 타인 owner 행은 editor 강등, 접근 없는 승인자는 viewer 보강(private 복사본 결재 보장). 해제 시 자동분만 제거(수동 추가 보존, autoLeaderRef 패턴). 요약박스 4번째 라인 안내. 스모크 25체크 + 새 맵 DB 권한/승인자 실측 대조. 참고: sqlite 로컬 한정 영구삭제 후 map_permissions 고아 잔존(FK CASCADE 미강제 — postgres는 DDL cascade로 정상).

## 2026-08-25 — 복사 모달 retire 섹션 시인성 리디자인 (main)
- 휴지통 체크를 선택 카드로(체크 시 앰버 `border-changed/40 bg-changed/10`+Trash2 아이콘) + 체크 시 ConfirmDialog lines 어법의 아이콘 요약박스 3줄(태그 rename·7일 보관·알림). SP 경고는 앰버 박스가 아코디언·확인 체크까지 감싸고 확인 문구는 caption-strong으로 상향.

## 2026-08-25 — 복사 워크플로 재편 (main)
- 게이트: 게시(published/expired) 이력 1회 이상인 맵만 복사(FE 버튼 비활성+툴팁, BE 409 — status 판정: pre-ALTER 게시본은 version_number NULL 가능). Word 승격(convert)은 기존 승인본 기준 예외. 기본 원본 버전도 approved→published로 상향.
- 복사 모달을 CreateMapDialog `copy` 모드로 통합(전용 CopyMapDialog 폐기) — 버전 선택+비게시 안내·오너 잠금 행·오우닝 프리필·공개범위(BE `MapCopy.visibility`)·협업자/승인자는 기존 스테이징 체인 재사용.
- 알림: 복사 시 원본 오너 `map_copied`(행위자 제외). 오너 전용 `retire_source` — 원본 "(Pending deletion)" rename(중복 카운터·200자 절단)+휴지통행, 승인자·editor+ `map_retired`, 새 맵은 원본 이름 유지(모달에서 이름 고정). SP 지정 맵은 사용처 아코디언+확인 체크 필수(FE 게이트).
- 검증: BE pytest 1164(신규 test_map_copy_workflow 9)·ruff / FE tsc·lint·vitest 767 / pw-smoke-copy-purge 23체크 실브라우저(retire 실집행→알림 sqlite 실측→휴지통 즉시삭제까지).

## 2026-08-25 — 휴지통 즉시 영구삭제 (sysadmin, main)
- `DELETE /maps/{id}/permanent` — sysadmin 전용(403)·휴지통 상태만(활성 맵 409), KB 청크 소거 포함 기존 lazy purge 로직 재사용. 설정 휴지통 행에 sysadmin 한정 Delete now 버튼+danger 확인 모달. 7일 보존은 기본 유지 — 즉시삭제는 명시적 관리자 액션만.

## 2026-08-25 — 맵 복사 버전 선택 + 드래프트 열기 (main)
- 복사 모달을 이름 전용 PromptDialog에서 전용 CopyMapDialog로 — 원본 버전 드롭다운(전체 버전, 기본=최신 승인본, 승인 여부 무관 `MapCopy.version_id`), 성공 시 카드 쉬머 대신 새 맵 에디터로 직행(게시본 없는 새 맵은 versions[0]=드래프트가 기본 오픈). 카드 복사 버튼 게이트도 승인본 보유 → 버전 보유로 완화. 검증: pytest 버전 선택/기본/타맵 404 + pw-smoke-copy-purge 실브라우저(드래프트 선택 복사 → DB 계보 m*v6 실측).

## 2026-08-25 — 맵 복사 500 픽스 (main)
- 운영 서버 복사 500 원인: 자동 ALTER로 추가된 `doc_sections`(DDL DEFAULT 없음)가 pre-ALTER 행에서 NULL → `copy_map`의 `list(None)` TypeError. `or []` 소거 + 서버 상태(컬럼 드롭→nullable 재추가)를 재현한 회귀 테스트. 같은 함정의 직렬화 계층은 `schemas._coerce_doc_sections`가 이미 방어 — 라우터만 누락이었다.

## 2026-08-25 — 릴리스 문서 최신화 (main)
- 매뉴얼 6종을 현재 main 기준으로 갱신 — 편집: GMP 분류·IO 불러오기(Linked/Disconnect)·간격 자동 조정+엣지 우회·몸체 드롭 빠른 연결·start/end 타입 필·Framework 칩·PNG 정보 카드·Map 탭 비교 버튼 / 사용 안내: LDAP 로그인 화면·비교 화면 개편(요약 탭·엣지 라벨 diff·선모양·임시 드래그) / 관리자: 로컬 계정 절 신설(설정→조직, ldap 전용)+`AUTH_JWT_SECRET`/`AUTH_JWT_TTL_HOURS` 레퍼런스.
- 릴리스 공지 8월 3차 초안 `docs/notices/2026-08-25-release.md` — 872a953b(운영 배포) 이후 변경분 대상.

## 2026-08-25 — dev → main 릴리스 머지
- 8/19(shimmer) 이후 dev 전체(144 커밋)를 main에 반영 — LDAP 인증 폴백+로컬 계정 · 인터뷰 필드 승격(touch_time 7번째 파라미터·노드 IO/조건/data_form·활동별 GMP) · 인스펙터/편집 모달 재설계(아코디언·레이지 세이브·데이터 폼 피커·비용 통화 토글) · 노드 IO 연결(불러오기) · height-shift 노드 간격 자동 재조정+엣지 우회 · 비교화면 리프레시(세션 드래그·요약 탭·최신화)+start/end 노드 · 에디터 프레임워크 트리 칩 · PNG 내보내기 정보 카드 · SP 상태 배너/노드 카드 UX · React 19.2 useEffectEvent. 상세는 아래 항목들.
- **배포 시 필요**: ① `.env`에 인증 3키 추가(`AUTH_MODE`·`AUTH_JWT_SECRET`·`AUTH_JWT_TTL_HOURS`) — keycloak 유지면 `AUTH_MODE` 공란으로 무회귀, ldap 전환 시 `AUTH_JWT_SECRET` 필수. frontend `NEXT_PUBLIC_KEYCLOAK_*` 빌드 args는 폐기(런타임 `GET /api/auth/mode` 조회)라 compose에서 제거된 상태. ② 스키마는 자동 ALTER(`nodes` 승격/IO 링크/gmp 계열·`process_maps` sp_* 계열, `db.py _ADDED_COLUMNS`) — 리셋 불가. ③ **FE/BE 동시 배포 필수** — 구 FE의 graph PUT이 승격 필드를 소거한다(`docs/deploy/db-migration-9910.md` §8).
- 게이트(머지 후 main 기준): BE pytest 1150 passed·ruff 0 / FE vitest 767 passed(55 files)·tsc 0·lint 0·build OK.
- 정리 완료(08-26): 원격 `feat/io-linking`·`feat/node-spacing`(main 완전 병합·열린 PR 없음)을 로컬에서 삭제 — 원격 실행 환경의 ref 삭제 403은 로컬 push로 우회. 원격은 dev·main만 유지.

## 2026-08-25 — SP GMP 필 숨김·우측 핸들 dot 정렬 (dev)
- 미분류 GMP 호버 필은 수정 가능할 때만(SP는 링크 맵 상속 read-only·읽기전용 모드 제외) — 클릭 유도만 되던 필 제거. SP 단일 끝 핸들 dot이 50% 중앙에 남아 엣지 앵커(라벨 라인)와 어긋나던 것 — 단일 끝은 18px 앵커, 다중 끝만 분산 유지.

## 2026-08-25 — 프레임워크 플라이아웃 이동 게이트 (dev)
- 맵 탭 버전 필 우측 액션 클러스터 최좌측에 버전 비교 아이콘 버튼(GitCompare) — 하단 CTA와 동일 게이트(게시본 없으면 비활성+안내 툴팁).
- IO 박스 헤더(3노드 타입 공통 NodeIoDetails)에 행과 같은 호버 하이라이트(enabled 한정 bg-surface-alt+글자 진하게) 추가.
- 우측 프레임워크 칩 플라이아웃의 맵 이동에 F6 "링크맵 열기"와 동일한 미저장 경고 확인 모달(openMapPrompt) 재사용 — FrameworkChip onNavigate 게이트 prop, 미제공 시 직접 이동 폴백.

## 2026-08-25 — SP 상태 배너 4종 완성 (dev)
- 배너 체인: 업데이트 가능(액센트) > 지정 해제(에러 톤, 코너 뱃지와 동조) > 플레이스홀더 링크 미지정(앰버 changed 톤 — 해제와 강도 구분) > 버전 고정(중립 박스) > 최신본 추종(박스 없는 semibold 글자 한 줄 — 초록·중립박스안 거쳐 확정, 색=조치 필요 상태만). follow_latest는 전 노드 공통 불리언이라 실링크+지정 유효 게이트, 실렌더 스크린샷 검증.

## 2026-08-25 — 분기 액션 바(바로가기 버튼) 겹침 픽스 (dev)
- 가려지던 건 배지가 아니라 선택 시 노드 하단의 액션 바(링크 버튼) — 분기 하단 확장 블록(파라미터/조건/IO)과 같은 공간이었다. 배지는 원위치(bottom-0) 복귀, 액션 바가 확장 블록(data-id=node-below-extension) 높이를 실측(offsetHeight=줌 무관 레이아웃값, 초기 layout effect+이후 ResizeObserver)해 그 아래로 내려간다.

## 2026-08-25 — 몸체 드롭 빠른 연결 (dev)
- 엣지 드래그를 핸들이 아닌 노드 몸체 위에서 놓으면 기본 핸들로 즉시 연결(정방향=왼쪽 타깃·SP는 in 핸들, 역방향=오른쪽 소스·SP 소스는 제외). 드래그 중 몸체 위에선 커스텀 connectionLine(QuickConnectLine)이 기본 핸들에 스냅된 미리보기를 그려 핸들 포착과 동일한 느낌 — 판정 헬퍼(canQuickConnect)를 미리보기·드롭이 공유해 결과 일치. 기존 onConnect 플로우(디시전 분기 모달·출력 충돌 모달·회귀 차단·터미널 규칙) 그대로 재사용.

## 2026-08-25 — 노드 카드 후속 2건 (dev)
- 분기 조건/IO 박스는 노드 밖 상시 노출이 산만 — 선택(활성) 시에만 렌더(속성/지표 줄은 유지). 미분류(Unclassified) GMP 필은 공간 미차지 기본 숨김 — 노드 호버 시 좌상단 부유로만(분류 진입점 유지, 위치 override는 미분류에선 무시).

## 2026-08-25 — 노드 카드 UX 일괄 7건 (dev)
- IO 목록: 호버 휠은 캔버스 팬 대신 목록 스크롤(nowheel+overflow-y-auto, capped 한정)·미선택 노드 헤더 클릭은 토글 없이 선택만(선택 후 클릭부터 접힘/열림)·분기(decision)도 속성/지표/조건/IO를 마름모 아래 절대배치로 동일 수준 노출(IO 박스 framed 보더 강조).
- URL: 노드 내 라벨 줄 삭제(좌하 배지+액션 바가 전부), 링크 버튼은 등록 시 무조건 노출·뷰어 패널도 무조건 오픈 — 단 iframe 로드·새탭 열기는 기존 안전 판정 유지(비안전 URL은 즉시 폴백 카드, http(s) 외 스킴은 새탭 버튼 숨김).
- start/end 선택 링 rounded-full→rounded-[19px](키 큰 노드에서 링이 노드 뒤로 숨던 회귀)·SP 핸들 라벨 라인 18px 앵커(+justify-start, 다중 끝 핸들은 분산 유지)·모든 노드 더블클릭 시 인스펙터 속성 탭 자동 전환(논스 신호). pw-smoke-io-links 26/26.

## 2026-08-25 — height-shift 펼침 중 적용 + 드래그 지터 픽스 (dev)
- 인라인 펼침 중 height-shift 전면 비활성(spec §7 게이트)이던 것을 합성 **입력**에 Y 오프셋을 베이크하는 방식으로 적용 — childTop·regions bbox·rootOffsets(표시−저장)가 자동 일관, 역변환은 상시 스텝(heightStepsRef)으로 toSavedPoint·finalizeRootDrag Y를 통일(드롭 위치 기준 — 시작 오프셋 빼기의 밴드 교차 오차 제거). 표시단은 펼침 중 renderYOffsets 이중적용 게이트.
- 커진 노드(앵커) 드래그 시 마우스·원위치 사이를 튀는 지터 — 자기 밴드가 매 프레임 따라 움직여 표시/역변환이 서로 쫓던 것. 드래그 시작 시 스텝 동결(dragFrozenSteps), 드롭 시 해제(트윈 복귀). pw-smoke-height-shift 12/12(펼침 상태 드래그 라운드트립 포함).

## 2026-08-25 — 에디터 프레임워크 트리 칩 (dev)
- 프레임워크 등록 맵이면 에디터 캔버스 우상단에 체인 트리 칩(FrameworkChip) — 좌상단 저장 체크리스트 칩 디자인 재활용(반투명·크로스페이드·grid-rows 아코디언). 행 클릭 시 좌측 플라이아웃(행 top 실측 배치 — 아코디언 클립 밖으로)에 카테고리 맵 목록, 클릭으로 다른 맵 이동. ScopeWindow topRightSlot 신설.

## 2026-08-25 — PNG 내보내기 정보 카드+배경·비교 잘림 픽스 (dev)
- 비교 PNG 우측 끝 노드 잘림 — minZoom 0.5 클램프로 큰 맵이 1600×1000에 못 들어가던 것. 프레임을 bounds×minZoom에 맞춰 확장(MAX 4096 비율 축소)하고 fit이 항상 이기도록 zoom 하한을 낮춰 전달.
- PNG(에디터/비교) 공통: 투명 캡처 후 캔버스 합성 — bg-canvas+dot-grid 배경, 하단 정보 카드(이름·오우닝부서 리프·오너·버전(비교는 base→target)·게시일(published 이벤트)·프레임워크 경로). 게시일은 findPublishedAt(events) 공용 헬퍼, 오너명은 get_map에 owner_name 동봉(목록과 동일 Employee 소스, 테스트 추가).

## 2026-08-25 — 비교 드래그 끊김 픽스 (dev)
- 비교 캔버스 드래그가 매 프레임 sessionPos를 갱신해 laidNodes→nodeCenters→handleSides→appEdges 전부 재계산·전 노드/엣지 identity 교체로 화면 전체가 새로고침되듯 끊기던 문제 — 드래그 프레임은 applyNodeChanges(rfNodes)로만 반영하고 sessionPos는 드롭 시점 1회 커밋으로 전환.

## 2026-08-24 — React 19.2 패턴 도입: useEffectEvent 적용 + Activity 판정 룰 (dev)
- React/Next 최신 기능 6종 적용성 검토 → 가치 판정: useEffectEvent·Activity만 채택, Cache Components(전 페이지 클라이언트 컴포넌트라 대상 없음)·Compiler 활성화(검증 비용 별도 결정)는 보류.
- 체크아웃 폴링(에디터)을 useEffectEvent로 전환 — deps의 versions 배열 identity·t가 목록 갱신·언어 전환마다 인터벌 재구독+acquireCheckout 즉시 재호출하던 것 제거(게이트는 selectedVersionStatus 파생값으로 유지). Activity는 코드 적용 없이 룰만 — 기존 설계 3곳(배지 소스 display:none·FrameworkTree 강제 리마운트·pw strict mode)과 충돌해 함부로 쓰면 안 됨을 lessons §8로 명문화.
## 2026-08-24~26 — AI 계약 최신화 + 인터뷰 JSON 임포트 점검 (feat/ai-contract-parity 머지)
- 데이터 표면 패리티(CSV 왕복·Excel)는 다음 브랜치로 이관 — 설계 초안 `docs/design/2026-08-24-data-surface-parity-design.md`(검토값 CSV 왕복 확정·system_fallback 미결·Word 내보내기 제외).
- 챗 계약 승격 필드 반영: `_INSTRUCTIONS` attributes 예시·파라미터 의미·SP 제한 확장(IO/조건은 "대화 근거만" 가드) + `_serialize_node`에 실작업·입력/출력("; " 조인·80자 컷)·양식·조건·GMP 노출. gmp는 읽기 전용 — `AiNodeAttributes`에 없어 편집 에코는 스키마가 거른다. 스키마·FE 수신부는 필드 승격(8/20) 때 이미 준비돼 프롬프트 갭만 봉합.
- touch_time 7종 완성(인터뷰 표면): 인터뷰어 규칙9 params_table·드래프터 attributes 예시(+input/output/조건/양식)·첨부 추출기 계약·apply-params `_PARAM_FIELDS`·FE params 표(Touch 열·48rem)·`PARAM_TABLE_KEYS`. CLAUDE.md의 낡은 "6필드/나머지 4필드" 문구를 7필드/5필드로 정정.
- ops set_attr 승격 텍스트 반영: `resolveAiTextPatch` 신설(params.ts — null=유지·""=지움, IO 텍스트 변경 시 폼·링크·플래그 폐기 = mergeNode 줄 정렬 계약 미러, 동일 에코는 보존, SP 전체 드롭) + page.tsx set_attr 스프레드 배선 — 기존엔 AI가 보낸 input/output/조건/양식이 조용히 버려졌다.
- 인터뷰 JSON 임포트 점검: 키 전수 소비 대조·샘플 2종 dry-run 이슈 0. `artifact_role` 유실 회귀 봉합(승격 리팩터가 [Interview] KV를 지우며 전용 컬럼 없이 증발 → 기록성 키로 잔류 복원, 스모크 [5] 단언 동기) + l5/tasks/exceptions 미지 키 경고 추가. summary·labelSource 미소비는 설계 "미저장" 의도 유지. 잔여: 실파일 dry-run(사용자 제공 필요).
- 머지 직전 main(1cc0c4a1, 08-25 릴리스) 역머지 — 충돌은 PROGRESS뿐, page.tsx 자동 병합(set_attr 배선 유지 확인). 최종 게이트: BE pytest 1172·ruff / FE vitest 775·tsc·lint·build 그린.

## 2026-08-24 — 비교화면 리프레시 + start/end 노드 개선 (feat/compare-refresh 머지)
- start/end 노드: 커스텀 라벨 시 타입 필(Start/End)+제목 분리(좌정렬)·rounded-[19px] 고정 곡률(계란형 방지), 노트(description)는 캔버스 미노출 — 인스펙터/편집 모달 전용(캔버스 노출 1차안은 피드백으로 철회). hasCustomTerminalLabel(canvas.ts).
- 비교 최신화: 유지 엣지 라벨 변경 감지(MergedEdgeStatus "changed"+labelChange, 옐로)·저장 line_style대로 렌더(직선/곡선/꺾은선)·인스펙터 확장(touch_time·GMP 행+IO/양식/조건 블록 diff+엣지 포커스 패널)·변경 목록 세로 필드 행(truncate+툴팁)·동좌표 삭제 노드 순차 오프셋. location은 레거시 계층 마커라 diff 미대상 확정.
- 세션 한정 드래그(sessionPos 키에 방향·버전 쌍 → 전환 시 자동 원위치·리셋 effect 불필요, 핸들 변·목록/Tab 내비 모두 옮긴 좌표 기준)·인스펙터 2탭: 요약 = 7파라미터 버전 합계(BASE→TARGET+delta, sumVersionParam — SP 5종 위임·annual_count/fte 자체값 합·headcount 평균 표기)+기여 노드 목록(클릭=포커스)+확장 섹션 4종(구조·시스템 집합 diff·부서/담당자 지정률·GMP 분포, 공용 SummaryCard)+표시 선택 드롭다운(체크 숨김, 트리거 (-N)).
- 시드: scripts.seed_compare_demo 워스트케이스 확장(17필드 동시 변경·통화 전환·동일 이웃 삭제 2개·라벨/선모양 3종). ⚠️ seed_org_demo 맵은 버전 간 source_node_id 계보가 없어 비교화면 데모 불가 — 비교 검증은 이 데모 맵으로.

## 2026-08-23~24 — 노드 간격 자동 재조정 height-shift + 엣지 우회 (feat/node-spacing 머지)
- height-shift: 표시 높이(실측)로 커진 노드 아래 전체를 저장 Y 계단함수로 밀어냄 — 저장 좌표 절대 불변(표시=저장+X inline-shift+Y height-shift), lib/height-shift.ts 밴드 병합(같은 행 max·스택 합산)·inline-shift 역변환 재사용·rAF 트윈 350ms(즉시 3조건)·인라인 펼침 중 비활성. 드래그/생성/스왑/Ctrl복사 전 경로 역변환, 그룹 오버레이·PNG bounds 표시 공간 전환, 성장 후 1회 재핏(80ms 디바운스·마운트 1.5s 창).
- 엣지 우회(lib/edge-detour): 꺾은선의 기본 3구간 경로가 표시 bbox(+12px) 관통 시 무교차 최소 이탈 회랑으로 직각 우회(무회랑=폴백, 직선·곡선 불변). 라벨은 무가림 최장 구간 중앙. 프로세스 좌우 핸들 제목 라인 18px 고정(이웃 엣지 수평).
- 검증: FE vitest 760(height-shift 9·edge-detour 11)·pw-smoke-height-shift 12/12·브라우저 QA T8/U6/W6 전부 통과(docs/qa/node-spacing-qa.md). 스펙/플랜 docs/superpowers/(main 머지 시 삭제 정책).

## 2026-08-21~24 — 노드 IO 연결(불러오기) 완결 (feat/io-linking 머지)
- IO 항목 링크 그룹(원본 1 아웃풋/SP + 미러 N, itemId-only·줄 정렬 텍스트 컬럼 6개)·불러오기 4시나리오(미러/인수/승계/합류)·전파+정합화 겸용 propagateIoLinks — 단일 소스 lib/io-items.ts. CSV Input_Flags 왕복·일괄편집/복사 소거 가드·플레이스홀더 브로큰 플로우 경고.
- 에디터 UI 웨이브: GMP 픽커 즉시적용+되돌리기 안내(collapse 미리보기·캔버스 반영), IO 체크리스트 3단계(0/3.5줄/전체)+그룹 동반 체크·체크 동기 애니, 인박스 행 컨트롤(R/O 플래시)·2줄 클램프·양식 아이콘 맨 뒤·필수/선택 색·Show more 호버, 디시전 1:1.2+3줄 클램프+배지 코너+인쇄 클램프 해제, 엣지 라벨 160px 랩, kbd 줄바꿈 힌트(Alt/Shift+Enter), SP 마크 인라인·양식 스레딩·버전 배너 2종(한 줄+툴팁), UI em-dash→하이픈 전수.
- 검증: BE pytest 1149·FE vitest 740·pw-smoke-io-links 26/26·브라우저 QA 121항목 118✅(docs/qa/io-linking-qa.md). 랜드마인은 docs/lessons·메모리에 흡수.
## 2026-08-20 — 좁은 인스펙터 입력 오버플로 픽스 (dev)
- 통일 폭 입력의 shrink-0가 원인 — w-32/w-44는 상한으로 두고 min-w-0+축소 허용(메트릭스·조건·시스템·URL·SP 지정 4행). 인스펙터 최소 폭 300px에서 경계 이탈 0 실측(여유 폭에선 통일 폭 유지).

## 2026-08-20 — 섹션 스페이서 규칙 통일 + IO 항목 번호 (dev)
- 스페이서(구분선)는 분리가 필요한 경계에만: 어트리뷰트=URL 위 1개(부서/담당/시스템 무구분, BpmAttributePicker·인스펙터·SP 지정 공통), Metrics=무구분(지정 모달의 행 구분선 제거), 입출력 조건=Output↔시작 조건 경계 1개. 링크 라벨은 URL 하위 항목으로 한 단 더 들여쓰기+축소 글자(UrlLabelField·지정 모달). 입출력 각 항목 앞 회색 번호(1. 2. — 편집 행·읽기 행·SP 상속 표시 공통). 들여쓰기 세로선 유지.

## 2026-08-20 — SP 안내 툴팁 키워드 구조화 (dev)
- 문장식(spNoteFull) 폐기 → 아이콘+키워드 행(Library/Embed, caption-strong)+회색 보완설명+하단 회색 요지 한 줄로 재구성 — 한눈에 파악하는 구조 (사용자 정정 반영).

## 2026-08-20 — 모달 헤더 아이콘·지정 상태 필 + 툴팁 카드 가시성 (dev)
- SP 지정 모달 헤더에 Workflow 아이콘+지정 상태 필(Designated/Not designated, 영어 고정 — SP 카드 뱃지 규칙, `designated` prop 호출부 3곳). 벌크 모달 헤더에 SlidersHorizontal 아이콘. Tooltip 리치 콘텐츠(content) 변형을 카드형으로 승격(caption 14px·max-w-72·여유 패딩) — SP 섹션 ⓘ 안내 가시성 개선, 아이콘 호버 액센트.

## 2026-08-20 — 모달 상단 고정 + 높이 전환 아코디언 + SP 지정 모달 섹션화/스크롤 (dev)
- 벌크·노드 편집·SP 지정 모달을 상단 고정(items-start+pt)으로 바꿔 내용 변화 시 위치 점프 제거. 높이 변화는 AutoHeight(인박스 컴포넌트 재사용)로 스무딩 — 벌크는 카드 전체+카테고리 패널+충돌 박스, 편집/지정 모달은 각 섹션 바디(상시 마운트 래퍼+내부 조건부라 열림/닫힘 모두 애니메이션).
- SP 지정 모달 섹션화: BPM attributes(부서·담당·시스템·URL)/Metrics(SP 5필드+Σ)/I-O & Conditions 아코디언(공유 접힘 키)+모두 접기/펼치기 버튼, max-h+내부 스크롤로 작은 창에서 Save 항상 도달. 실브라우저 7항목(top 불변 실측·600px 창)+스모크 25/25.

## 2026-08-20 — 편집 모달 섹션 일괄 접기/펼치기 (dev)
- BPM attributes 헤더 우측에 아이콘+라벨 버튼(모달은 공간 여유) — 인스펙터 탭 바 버튼과 동일 판정(하나라도 펼침→모두 접기), 모달 3섹션은 로컬 state 직접 제어(공유 영속 키 write 유지). 왕복 실측 검증.

## 2026-08-20 — 데이터 폼 피커(자동완성)·짧은 대시·탭 폭·SP 지정 통일 (dev)
- IO 항목별 자료 형식을 상시 입력칸 → 피커로 전환(`data-form-picker.tsx`): 행 호버 시 아이콘 → 자동완성 드롭다운(카탈로그 12종 `lib/data-forms.ts`, 확장자/영문/한글 유사도=lib/search 재사용, ↑/↓ 이동·Enter/Space 선택, 무일치 자유값은 "추가" 행으로만 확정, body portal). 완료 상태는 필 비활성 표시(카탈로그=아이콘 동반, 기타=텍스트만). 인스펙터·편집 모달·SP 지정 모달 3표면 공유(MultiValueInput).
- 빈값 플레이스홀더 "—"→"-" 전 표면 스윕(주석 제외 15파일). 인스펙터 탭바는 선택 탭 라벨 shrink-0(비선택 탭이 먼저 말줄임), 우측 일괄 버튼 유지. SP 지정 모달 단일행 입력 w-44 통일.
- 검증: data-forms 단위 5·실브라우저 10항목·스모크 25/25(피커 플로 반영)·게이트 그린(vitest 670)·매뉴얼 EN/KO 갱신.

## 2026-08-20 — 모달 저장→인스펙터 즉시 동기 + 모달 버퍼 변경 노출 (dev)
- 편집 모달 저장이 인스펙터에 바로 안 비치던 원인 2건 수정: MultiValueInput 행 버퍼가 외부 값 변경에 미동기(렌더 중 상태 조정으로 외부 변경만 리셋 — 자기 커밋 에코·입력 중 빈 행은 보존), NodeMetricsCard 활성 통화가 외부 통화 전환에 미동기(로컬 비용 draft 없을 때만 재판정).
- 모달에 버퍼 내용 노출: 변경 섹션 헤더에 점(•) + 푸터에 "Unsaved: {변경 필드 목록}"(비용 2필드는 Cost / run 하나로 접음). 실브라우저 6항목·스모크 25/25.

## 2026-08-20 — 인스펙터 입력 상시 노출·통일 폭 + 모달 어트리뷰트 아코디언 (dev)
- 편집 가능한 인라인 입력(수행 지표·조건·data_form·시스템·URL)은 호버 시에만 보이던 영역을 상시 박스(bg-surface-alt+hairline)로 노출, 폭은 최단 행 기준 w-32(128px)로 전 행 통일(모달 표면은 w-44 — NodeDetailsFields/UrlLabelField `inputWidth` prop), 포커스 시 액센트 보더. 읽기전용은 기존 투명 디자인 유지. MultiValueInput 행에도 포커스 보더.
- 편집 모달 BPM 속성(부서/담당/시스템+URL 편입)을 수행 지표와 동일 아코디언 섹션화 — `bpm.attrsCollapsed` 인스펙터와 키 공유. 실브라우저 4항목(폭 128 균일 실측·accent 보더·모달 섹션 공유 키)+스모크 25/25.

## 2026-08-20 — 인스펙터 섹션 일괄 접기/펼치기 (dev)
- 인스펙터 탭 바 맨 오른쪽에 아이콘 버튼(호버 툴팁) — 하나라도 펼쳐져 있으면 모두 접기, 모두 접혀 있으면 모두 펼치기. 아코디언 상태가 컴포넌트별로 흩어져 있어 DOM 컨벤션으로 수렴: 헤더 버튼 `data-acc-toggle`(aria-expanded)+`<details data-acc>`를 탭 콘텐츠에서 쿼리(활성 탭만 마운트=탭 스코프), MutationObserver로 아이콘/툴팁 동기화. 실브라우저 6항목 검증.

## 2026-08-20 — 인스펙터 2차 디자인 라운드 (dev)
- 벌크 카테고리 정리: 순서 속성/수행 지표/입출력·조건, 쉐브론 삭제·선택 점(•)은 라벨 앞. Node display를 공용 컴포넌트(`node-display-section.tsx`)로 추출 — 카테고리 계단 구성·행 전체 클릭 토글(hover), 승격 토글 추가(입력/산출 별도, 시작·종료 조건은 "conditions" 하나로 통합 — 캔버스는 두 줄 렌더), 속성 탭 기본 화면(맵 요약 아래)에도 노출. 맵 탭 노트는 기본 접힘 아코디언·Edge style은 보더 카드로 통일. 인스펙터 설명(읽기전용)은 호버 편집 아이콘/더블클릭 → 편집 모달 설명 자동 포커스(`initialFocus`).
- 검증: 실브라우저 10항목 + pw-smoke-field-promotion 25/25(노트 접힘 반영)·게이트 그린(vitest 665)·매뉴얼 EN/KO 갱신.

## 2026-08-20 — IO 항목별 데이터 폼 + 벌크 카테고리 재편 + BPM 속성 아코디언 (dev)
- 데이터 폼을 IO 항목별 값으로 승격: 신규 정렬 컬럼 4개(`nodes.input_forms/output_forms`·`process_maps.sp_input_forms/sp_output_forms`, 줄 1:1 정렬·`_ADDED_COLUMNS` 자동 ALTER). 기존 노드 `data_form`은 임포트 폴백 유지(항목별 값 없을 때만 행 표시). MultiValueInput에 항목별 폼 열 추가 — 인스펙터·편집 모달·SP 지정 모달(단일행 입력→MultiValueInput 교체) 3표면 공유, SP 상속 표시는 " · form" 접미. 정렬 무효화 규칙 3곳 동일: 재임포트 승계(항목 텍스트 불변 시만, gmp 계보 패턴)·CSV/AI 병합(mergeNode)·벌크(교체=소거, append=유지). diff/compare 필드 등록, CSV/Excel/AI 표면은 제외(병합 보존, 후속 트랙).
- 그룹 일괄 편집 재편: 카테고리 3버튼 한 행(수행 지표/입출력·조건/속성) + 클릭 시 아래 패널에 하위 모드 버튼 펼침(재클릭=접힘, 현재 모드 카테고리는 점 표시). IO·조건 4필드 벌크 모드 신설 — IO는 textarea(줄=항목)·append=줄 추가. 인스펙터 BPM attributes 카드 2곳(일반·SP 상속)도 동일 아코디언(기본 접힘, `bpm.attrsCollapsed`).
- 검증: BE 1146·ruff / FE 665·tsc·lint·build / 실브라우저 신규 10항목 + pw-smoke-field-promotion 25/25(폴백 행 숨김 계약·attrs 접힘 반영, [11][12]에 폼 회귀 추가). 매뉴얼 EN/KO 갱신.

## 2026-08-20 — 인스펙터 레이지 세이브 + 비용 통화 토글 (dev)
- 수행 지표·입출력 조건 두 섹션을 자동 저장→명시 저장(버퍼+헤더 Save 버튼, 노드 전환 시 미저장분 폐기)으로 전환하며 카드를 `node-metrics-card`/`node-details-card` 컴포넌트로 추출(key 리마운트=버퍼 리셋). 비용은 배타 계약이라 KRW/USD 2행을 ₩/$ 세그먼트 토글 1행으로 통합 — 반대 통화 값이 있으면 "저장 시 삭제" 인라인 안내+되돌리기(인스펙터·편집 모달 동일). 검증: 신규 시나리오 14/14 + pw-smoke-field-promotion 25/25(레이지 계약 반영, [8]은 c0c532a에서 제거된 배지 단언 정정)·게이트 그린·매뉴얼 EN/KO 갱신.

## 2026-08-20 — I/O & Conditions 아코디언 + 두 섹션 행 아이콘 (dev)
- 입출력·조건 섹션을 수행 지표와 동일한 아코디언(기본 접힘·채움 개수 배지·`bpm.detailsCollapsed` 인스펙터↔편집 모달 공유)으로 전환. 두 섹션 전 행에 12px 아이콘(수행 지표=PARAM_ICON 공용 추출 `components/param-icons.ts` — 캔버스 칩·일괄 편집 탭과 3표면 공유 / IO·조건=`DETAIL_FIELD_ICONS`: 입력 LogIn·산출 LogOut·형식 FileType·시작 Play·종료 Flag). 게이트 662·tsc 0·build OK, 기본 접힘 실브라우저 확인.

## 2026-08-20 — 승격 카드 용어 확정 (dev)
- 혼동 제거(사용자 지시) — 노드 카드 타이틀 "Details/상세 속성" → **"I/O & Conditions/입출력 · 조건"**, "Parameters/파라미터" → **"Metrics/수행 지표"**. i18n 값+매뉴얼 4종 일괄 스윕(코드 식별자·설정 "상세" 탭명은 유지), 매뉴얼의 낡은 "6필드" 표기도 7로 정정. 상세 디자인 피드백은 용어 확정 후 사용자 진행 예정.

## 2026-08-20 — 인터뷰 필드 승격 + 활동별 GMP (feat/field-promotion → dev)
- 인터뷰 텍스트 직렬화 키를 고유 필드로 승격(기조: 노드↔SP 대칭) — **touch_time 7번째 공용 파라미터**(duration H.MM 완전 미러: 정규화·Σ·CSV 20열·Excel·일괄편집·SP 상속 5필드·칩=스톱워치 아이콘), 노드 input/output(개행 복수·Details 카드/편집 모달 공용 `NodeDetailsFields`)·시작/종료 조건·data_form(IO 종속 행)·system_fallback, 맵 sp_조건·GMP 3값+폴백 5종. 설계 `docs/design/2026-08-19-field-promotion-design.md`.
- **대표+폴백 검토 흐름**: 임포트는 폴백에 원문([Interview]=Owner role만·노드 KV=Rule/Screen/Quote만), 검토는 `PATCH /maps/{id}/process-fields`(오너, SP 지정 무관)+설정 Conditions & GMP 카드+`FallbackHint` 팝오버(원문·수정·적용). 엔진은 sp_gmp 비교·갱신 제외, 폴백 수정은 재전달이 덮음(전달분이 진실). openItems·tasks.note도 노트 보존.
- **활동별 GMP**: `nodes.gmp`(3값, 무효 "" 소거) — 캔버스 필 태그(맵 탭 GMP 토글, 노드 안쪽 라벨 왼쪽 위, 미분류=아이콘만, 45% 틴트 보더), 편집 모드 필 클릭=클릭 지점 분류 피커, **분류가 일반 노드 색 자동 확정**(GMP_NODE_COLORS)+마우스 지점 안내 모달(2단 되돌리기: 이전 분류로/색만). SP 노드는 링크 맵 sp_gmp read-only 상속 필. **재임포트 승계**(계보 이어받기·시그니처 제외 — 검토값 보존).
- 검증: QA 문서 `docs/qa/2026-08-20-field-promotion-qa.md` 43항목 전부 ✅(스모크 `pw-smoke-field-promotion.mjs` 25/25 + GMP 6체크 + 3차 5체크 + 회귀 15/15·7/7·25/25). 게이트 BE 1143·ruff 0 / FE 662·tsc 0·build OK. ⚠️ 서버 배포는 FE/BE 동시 필수(구 FE의 graph PUT이 승격 필드 소거) — 재임포트 1회로 백필(`docs/deploy/db-migration-9910.md` §8). 시스템 라이브러리는 별도 트랙.

## 2026-08-19 — LDAP 인증 폴백 + 로컬 계정 (dev, 완료)
- 9910을 LDAP으로 열어 Keycloak 없이도 AD bind + 설정 화면 발급 로컬 계정(컨설턴트용)으로 로그인하게 함. 설계 스냅샷 `2026-08-19-auth-fallback-ldap-design.md`는 서버 Keycloak 로그인 실검증 후 폐기(git history 보존) — 운영 계약은 `docs/deploy/deploy.md` §2.1·`docs/spec.md`가 담당.
- 구현: `AUTH_MODE=keycloak|ldap|dev`를 `GET /api/auth/mode`로 런타임 노출(프론트 빌드타임 상수 폐기) · 자체 서명 HS256 세션 토큰(`app/tokens.py`, `AUTH_JWT_SECRET` 필수) · `POST /api/auth/login`(로컬 계정 우선→AD bind 폴백, 5회/5분 스로틀) · 설정 화면 로컬 계정 CRUD + sysadmin 부여(`local_credentials`, 메모리 캐시) · 프론트 3모드 게이트(`AuthGate`/`DevGate`/`LdapGate`)와 모드별 로그인 화면.
- Task 11(마감): frontend 빌드 args(`NEXT_PUBLIC_KEYCLOAK_*`) 완전 제거 — top-nav 로그아웃·`keycloak-login.ts`도 런타임 조회(`getCachedAuthMode`)로 전환. `docs/deploy/deploy.md`에 인증모드 절 추가(AUTH_JWT_SECRET 필수·컨설턴트 계정 회수 절차·토큰 무효화 불가+시크릿 교체 kill switch·단일 워커 캐시 주의). `scripts/pw-smoke-ldap-login.mjs` 신설(5시나리오 10체크, 실브라우저 통과). 리뷰 픽스 4건 — ldap-session 만료 파싱 NaN을 만료로 처리, auth-mode 폴백 결과는 캐시하지 않음(재시도 허용), 죽은 `login.or` i18n 키 제거. 전체 그린: backend 1129 passed+ruff clean, frontend tsc/lint/vitest 652 passed/build 통과.
- 최종 리뷰 하드닝 3건: ① 로그인 로컬 분기를 `credential 존재`가 아니라 `credential + employee.source=='local'`로 강화 — HR 동기화가 충돌 loginId를 `source='hr'`로 전환한 뒤 orphan credential로 계속 로그인되는 구멍 차단, AD로 폴백. ② `is_sysadmin`의 `_granted_sysadmins` 캐시 항을 `resolved_auth_mode()=='ldap'`일 때만 인정 — ldap→keycloak 전환 후 관리 엔드포인트가 404라 회수 불가능한 잔여 부여가 새는 문제를 predicate에서 차단(env 목록은 모드 무관 유지). ③ 로컬 계정 표에 active 토글(deactivate/reactivate) 추가 — 스펙 §5·`docs/deploy/deploy.md` 오프보딩 절차가 요구하던 차단 기능이 UI에 없었던 결함. `docs/deploy/deploy.md`에 AD 첫 로그인 전제(HR 미동기화 계정은 401) 한 문장 추가. 전체 그린: backend 1132 passed+ruff clean, frontend tsc/lint/vitest 652 passed/build 통과.
- 서버 검증: **Keycloak 로그인 실검증 확인**(런타임 모드 전환·빌드 ARG 제거·PKCE 경로 무회귀). 잔여 검증: 실 AD bind·ldap 모드 평문 HTTP·`AUTH_MODE=ldap` compose 전환.

## 2026-08-19 — 로딩 플레이스홀더(shimmer) 일괄 도입 + 첫 렌더 애니메이션 억제 (dev)
- 실서비스에서 보이던 3종 깜빡임 — ①공지 작성자 필이 아이디→이름으로 바뀜 ②홈 새로고침 시 "맵 없음" 화면이 1초쯤 떴다가 뒤집힘 ③좌측 조직도가 렌더 후 아코디언 애니메이션을 우르르 재생. 공통 원인은 "데이터 없는 상태를 먼저 그린다"라, 그 자리를 shimmer 스켈레톤(`globals.css .skeleton` + `components/skeleton.tsx`)으로 채우는 방향으로 통일.
- ① `useDirectoryState().ready`로 "아직 안 온 것"과 "모르는 사람"을 구분 — 도착 전 UserPill은 스켈레톤 필. ② 홈은 맵+내 정보+디렉터리가 모두 settled될 때까지 `HomeSkeleton`(같은 1:2 레이아웃). ③ `useClosingKeys.getSectionClass`가 사용자가 접거나 편 뒤에만 `accordion-open`을 주고, 그 전(첫 페인트·localStorage 복원·시드)에는 애니메이션 없는 `accordion-static`.
- 검증: `scripts/pw-smoke-loading.mjs`(API 지연 주입) 수정 전 3/7 → 수정 후 7/7. 미조정: ClampedList의 `clamp-size` 높이 전환은 복원 시 1회 재생되나, 첫 펼침 애니메이션을 잃을 위험이 있어 그대로 뒀다.

## 2026-08-19 — 승인 대기 필 압축(유저 카드 이름·부서 복구) (main 직접)
- 인원 카드에서 `editor → viewer · Approval pending` 필이 행 폭을 통째로 먹어 이름/부서가 0px로 뭉개지던 문제(실측: 이름열 0px·필열 265px) — 필을 **목표 역할만 남긴 압축형**(⏳ Viewer / ⏳ removed)으로 바꾸고 전체 내역(현재→목표·요청자)은 툴팁으로. 공용 `components/permissions/pending-change-pill.tsx`로 추출해 홈·인스펙터 카드와 설정 협업자 패널이 같은 문법을 쓴다.
- 맵 상세 카드에선 staged 태그와 같은 **2번째 줄**로 내리고 우측 필 열에 `shrink-0` — 이름열 103~113px 확보·클리핑 0(실브라우저 before/after 실측, 홈·인스펙터 두 표면).

## 2026-08-19 — 인박스 스크롤바 제거·선택 해제 범위 축소·이름 클릭 (main 직접)
- 인박스 우측 상세에 늘 떠 있던 스크롤바 — `AutoHeight`가 border-box 높이에 테두리를 안 더해 1~2px이 모자랐던 것. 올림+테두리 보정으로 넘침 자체를 없애고, 실제로 넘칠 때만 보이도록 `scroll-quiet`(스크롤 중에만 노출, `useQuietScroll`)를 상세·좌측 목록·긴 textarea에 적용.
- 내용을 클릭·드래그만 해도 선택이 풀리던 문제(멤버 보기 버튼 포함) — 해제 판정을 "빈 여백을 **직접** 눌렀을 때만"(target===currentTarget)으로 바꾸고 홈/인박스의 자식 stopPropagation 가드 의존을 제거. 인박스는 배경이 click, 가드는 mousedown이라 단계까지 어긋나 있었다.
- 사용자 이름 필(UserPill) — 포인터 커서·호버 틴트 추가, **클릭하면 1초 대기 없이 즉시** 인물 카드(부모 행 선택으로 번지지 않음). PersonHoverCard 계열은 이미 동일 동작.

## 2026-08-19 — 드롭다운 안 닫힘 진범: stopPropagation 가드 (main 직접)
- 맵 상세 카드 **안쪽**을 클릭하면 조직/인물 드롭다운이 남던 진짜 원인 — 카드의 선택-해제 방지 `stopPropagation` 가드가 버블을 끊어 메뉴의 window mousedown 리스너까지 이벤트가 도달하지 못했다. 메뉴·팝업·드롭다운 6곳(ContextMenu·PersonInfoPopup·홈 생성메뉴·top-nav·알림벨·피드백 노트·필터)의 바깥닫힘 리스너를 **캡처 단계**로 전환해 해소(실브라우저 좌/우클릭·카드 내부 클릭·Esc 8항목 통과).

## 2026-08-19 — 인스펙터 맵탭 인물/조직 메뉴 복구 + 메뉴 닫힘 강화 (main 직접)
- 에디터 인스펙터 Map 탭에서 부서·유저 카드 좌/우클릭이 무반응이던 원인: `MapDetailCard`가 `showFooter={false}`(인스펙터) 조기 반환에서 **오버레이 블록(컨텍스트 메뉴·조직 정보·인물 팝업)을 렌더하지 않음** — 상태만 바뀌고 화면엔 아무것도 없었다. 오버레이를 변수로 추출해 두 반환 모두에서 렌더.
- 메뉴·팝업이 fixed 좌표라 목록이 움직이면 엉뚱한 자리에 남던 문제 — `ContextMenu`·`PersonInfoPopup`에 스크롤(캡처)·리사이즈 닫힘 추가(바깥 클릭·Esc는 기존). 실브라우저 8항목 통과(인스펙터 메뉴·팝업·스크롤 닫힘, 홈 단일 메뉴 유지).

## 2026-08-19 — 인박스 결재 주체 표시 + 상세 높이 애니메이션 (main 직접)
- 관리자 인박스에서 "관리자라서 보이는 건지, 내가 결재자인지" 구분이 안 되던 문제 — `/inbox/approvals`에 `deciders`·`pending_on`·`approved_by`·`via_sysadmin` 추가(kind별 결재 주체: 버전/권한·가시성=지정 승인자, 이름변경·SP지정=오너, 점유권=점유자+오너). 카드에 대기 필(2명+n), 상세에 결재자/대기 행과 관리자 열람 안내.
- 우측 상세를 **내용 높이**로 바꾸고(`components/auto-height.tsx`, ResizeObserver+height 트랜지션 350ms, 첫 측정은 무애니) 카드 전환 시 이전 높이에서 이어지게 — 승인·알림 상세 공용. 게이트 BE 1077·ruff 0 / FE 640·tsc 0·lint 0·build OK, 실브라우저 8항목(대기 필·높이 추종·전환 중간값 관측).

## 2026-08-19 — 8월 2차 릴리스 문서 (main 직접)
- 공지 초안 `docs/notices/2026-08-19-release.md` 신설(연결선 모양·라벨 줄바꿈·창 닫기·피드백 노트/알림·GLM-5.2 이관) + docs 인덱스 등록.
- 매뉴얼 6종 갱신 — 편집(엣지별 선 모양·일괄 변경·Shift/Alt+Enter 줄바꿈·단축키 행), 사용 안내(피드백 노트·알림 수신), 관리자(알림 보내기 2종·노트 수정이력/아카이브·`feedback_notes` 퍼지, 설정 레퍼런스에 AI_BASE_URL/AI_MODEL/AI_MAX_TOKENS/AI_TIMEOUT_SECONDS). README 기능 줄 1건.

## 2026-08-19 — dev → main 릴리스 머지
- 8/18 이후 dev 전체를 main에 반영 — 엣지별 선 모양(서버 영속+일괄 변경 모달)·GLM-5.2/SGLang 사고모드 이관·인터뷰 임포트 정리(variant 보존)·피드백 노트/수동 알림·노드/엣지 라벨 줄바꿈·모달 닫기 규칙(Esc·mousedown). 상세는 아래 항목들.
- **배포 시 필요**: 서버 `.env` AI 설정 교체(`AI_BASE_URL=https://gpu02.sbiologics.com/v1`·`AI_MODEL=glm-5.2`·`AI_API_TOKEN`·`AI_MAX_TOKENS=8000`, 타임아웃 120~180 권장). 스키마는 자동 ALTER(edges.line_style·feedback 알림 시각 2종·feedback_notes 2종) + 신규 테이블(feedback_notes·feedback_note_revisions·map_notes) 자동 생성.
- 게이트(머지 후 main 기준): BE pytest 1077·ruff 0 / FE vitest 640·tsc 0·lint 0·build OK.

## 2026-08-19 — 액션 variant 보존 + 예외 색 분리 (feat/interview-variant → dev)
- 실파일 검증 피드백 반영 — `variant`가 통째로 버려지던 갭 해소: `normal` 외 값은 `Variant:` 줄로 노드 노트 보존, `exception`은 노드 색 rose(#c2849a, COLOR_PRESETS 수동 동기)로 시각 분리. 흐름 분기는 앵커 정보 부재로 미구현(협의 확장 포인트). CanonicalNode.color 신설·엔진 passthrough·시그니처 포함(색 변경=새 버전 감지). 샘플에 예외 액션 추가. 게이트 BE 1068·ruff 0(머지 후 재확인).

## 2026-08-19 — 모달 닫기 규칙 통일: Escape + 바깥 누름(mousedown) (dev)
- 공용 `ModalBackdrop`이 단일 지점 — 바깥 **mousedown 즉시 닫기**(mouseup 대기 없음, 내부 드래그→바깥 릴리즈 오작동도 함께 해소)와 **Escape 닫기**(겹친 모달은 스택으로 최상위만) 제공. 오버레이를 직접 들고 있던 5곳(피드백 상세·공지 편집·알림 퍼지·인터뷰 파라미터/드로우·조직 정보)을 여기에 흡수 — 36개 모달이 같은 규칙.
- 홈: 빈 여백 **누름**으로 선택 해제(상세/카드 가드도 mousedown 기준), 생성 메뉴 바깥 닫기 리스너도 mousedown. 실브라우저 10항목 통과(Esc 단계별·mousedown 즉시 닫힘·드래그 오작동 없음·홈 디셀렉).

## 2026-08-19 — 피드백 노트·수동 알림 + 이름/라벨 Alt+Enter 줄바꿈 (dev)
- 피드백 알림을 **자동 발송 → 관리자 수동 발송**으로 전환(사용자 결정) — 답글 저장은 무통지, 저장 버튼 옆 "알림 보내기"(확인 모달 → 발송 → 토스트)와 상태변경 알림 버튼(**피드백당 1회**, 발송 후 잠금)으로 분리. `feedback.reply_notified_at`/`status_notified_at`로 이전 발송 여부를 모달 메타에 표시. 본인 피드백 셀프 발송은 서버 400(관리자도 피드백 작성자가 될 수 있어 실재하는 경우).
- **`feedback_notes` 테이블 신설** — 누구나 자유롭게 노트 작성, 목록 테이블 노트 버튼 → body portal 플라이아웃에서 내용+시간순 로그 열람·추가. 스레드(작성자 이어달기)는 계속 보류.
- 알림 버튼 발견성 픽스(실사용 피드백) — 관리자에게 **항상 노출**하고 못 보내는 경우만 사유 툴팁으로 비활성(본인 작성/답글 미저장/상태알림 기발송). 기존엔 `!isAuthor` 조건이 버튼을 통째로 숨겨 "관리자인데 안 보인다"가 됐고, done 상태에선 답글 영역째 사라져 알림도 못 보냈다.
- 노트 라이프사이클(사용자 결정): **수정은 작성자만 + 직전 본문을 `feedback_note_revisions`에 스냅샷**(플라이아웃에서 이력 펼침), **삭제는 아카이브까지만**(`archived_at`, 기본 숨김+보기 토글) — 되돌릴 수 없는 **영구삭제는 관리자 DB 테이블의 퍼지 버튼**에서만(알림 퍼지 선례). 겸사로 피드백 하드삭제 시 노트/이력 정리 추가(sqlite FK CASCADE 기본 비활성이라 고아 행이 남던 경로).
- 랜드마인: portal 자식(ConfirmDialog)의 이벤트는 **React 트리를 따라 버블**해 오버레이 `onClick=onClose`가 삼켜 모달이 닫혔다 — 오버레이 밖 형제로 분리(실측).
- 노드 이름 3표면(캔버스 인라인·인스펙터·편집 모달)을 textarea로 전환 — **Enter=커밋, Alt/Shift+Enter=줄바꿈**(Shift는 사용자 요청으로 추가). 캔버스 렌더 `whitespace-pre-wrap`, 실측 추정기(estimateNodeWidth/countTitleLines)는 \n 세그먼트별 계산.
- 엣지 라벨도 동일 규칙(Enter 커밋·Alt/Shift+Enter 줄바꿈) 적용 — SVG `<text>`는 줄바꿈 불가라 커스텀 엣지(`multiline-edge.tsx`, EdgeLabelRenderer HTML 라벨, compare의 LabeledSmoothEdge 선례)로 빌트인 3타입을 덮어씀. 라벨은 pointer-events-none이라 선택·더블클릭 편집·컨텍스트 메뉴는 아래 path로 통과(실브라우저 7항목 확인). 게이트: BE 1068·ruff 0 / FE 640·tsc 0·lint 0·build OK, 실브라우저 스팟(Alt+Enter 입력→저장 "\n" 확인→리로드 2줄 렌더) 통과.

## 2026-08-18 — GLM-5.2/SGLang 전환 + 챗 UX (feat/glm52-api → dev)
- GPU 서빙이 vLLM(모델명 alias 3종) → SGLang 단일 `glm-5.2`로 바뀌어 사고 모드를 요청 파라미터로 이관 — `call_ai`에 `reasoning`("high"/"none"/기본=최대)·`max_tokens`(기본 `AI_MAX_TOKENS=8000`, 사고 토큰 포함이라 작으면 빈 응답) 추가, 호출 목적별 지정(챗·인터뷰어="high", 드래프터=최대, 첨부 추출="none"). 서버 .env는 `AI_BASE_URL=https://gpu02.sbiologics.com/v1`·`AI_MODEL=glm-5.2`로 교체 필요(deploy.md 갱신, 타임아웃 120~180 권장).
- 챗 UX: 전송 단축키를 인터뷰 입력과 정렬(Enter=전송, Shift+Enter=줄바꿈), 스텁("준비 중" 토스트)이던 파일 첨부 버튼 제거. 게이트: BE 1063·ruff 0 / FE 637·tsc 0·lint 0·build OK. 실 GPU 검증 잔여.

## 2026-08-18 — 엣지별 선 모양 (feat/edge-line-style → dev)
- 선 모양(곡선/꺾은선/직선)을 맵 전역 localStorage 토글 → **엣지별 서버 영속**(`edges.line_style`, `_ADDED_COLUMNS` 등록·clone 보존·""=레거시 꺾은선)으로 전환 — 인스펙터 엣지 패널·엣지 컨텍스트 메뉴에서 개별 변경. 구 전역 토글 자리는 "전체 일괄 변경 + 확인 모달"(변경 수·모양별 내역 요약)로 대체, 새 엣지 기본값은 마지막 일괄 선택(맵별 `bpm.edgeStyle.<mapId>`, 구 전역 키 폴백).
- 증발 방지: CSV/AI 머지는 엣지 전량 재생성이라 (source→target) 쌍으로 line_style 이월(신규 엣지는 맵 기본값), 붙여넣기·Ctrl드래그 사본·클립보드도 type 보존. 적대적 리뷰 확정 2건(맵 전환 시 기본값 하이라이트 스테일·머지 신규 엣지 "" 폴백) 반영. 게이트: BE 1065·ruff 0 / FE 640·tsc 0·lint 0·build OK, 실브라우저 스모크 `pw-smoke-edge-style.mjs` 11/11(개별 변경·컨텍스트 메뉴·일괄 모달·API 영속·리로드 복원).

## 2026-08-18 — canonical 임포트 경로 정리 (chore/remove-canonical-import)
- 실전달물이 인터뷰 JSON으로 확정되어 기존 canonical 수용 표면 전체 제거(사용자 결정) — 웹 `POST /api/categories/import`·CLI(run_import/main)·파일 로더(load_categories/load_maps/parse_map_objs)·FrameworkImportIn/Out. 엔진(import_delivery)·canonical 모델·parse_categories는 인터뷰 어댑터의 내부 IR로 유지. BE 게이트 1062·ruff 0.
- 정리 커밋의 `git add -A`가 home-dept 스모크 스크린샷 4장(SHOT_DIR 기본 `.`)을 쓸어담은 것 발견 — 제거 + `frontend/.gitignore`에 `home-dept-*.png` 가드.
- FE도 동반 정리 — 설정 탭 canonical 임포트 섹션·importFramework·parseCategoriesFile/parseMapsFile·미사용 i18n 5키 제거, canonical 샘플 디렉터리 삭제. 스모크 2종은 인터뷰 샘플 웹 임포트 시드로 재작성(admin은 CRUD 전담, home은 자가 시드 + my-dept 스티키 체크 폐기 — 전제였던 admin 오너 canonical 샘플 소멸). 문서 스윕(9910 §8·관리자 매뉴얼 EN/KO·checklist·design/README). 게이트 FE 637·tsc 0·lint 0·build OK, 스모크 15/15·7/7·25/25·23/23.

## 2026-08-18 — 인터뷰 결과 JSON 임포트 1차 (feat/interview-import → dev)
- PwC 협의로 실전달물이 canonical → **인터뷰 결과 JSON**(0.3-bpm-interface-draft)으로 확정 — Phase 3 어댑터 1차 구현 완료. 설계·결정 로그: `docs/design/2026-08-18-interview-import-design.md`.
- 구성: 순수 어댑터 `scripts/consultant_interview.py`(키 화이트리스트 검증·경로 표기 이슈·seq 그룹 병렬 엣지·`total_time_min`→H.MM·KV 텍스트 직렬화) → 기존 `import_delivery` 재사용(canonical description 확장·오너 null=actor 폴백+`consultant_owner_pending`·pending 맵만 재전달 거버넌스 예외 갱신) · 신규 `map_notes` 테이블(예외/VOC, 전달 단위 replace 멱등)+`GET /maps/{id}/notes` · `POST /api/categories/import-interview`(다중 파일·error 파일 스킵·파일 간 중복 taskId 제외) · 설정 Framework 탭 Interview import UI(파일별 아코디언 키 검증 리포트) · 맵 상세/인스펙터 읽기전용 Notes 섹션.
- 게이트: BE pytest 1071·ruff 0 / FE vitest 646·tsc 0·lint 0·build OK / 실브라우저 스모크 `pw-smoke-interview-import.mjs` 15/15. 합성 샘플 `docs/samples/consultant-interview-sample/`. 잔여: 서버 배포 후 실파일 dry-run 키 대조·에디터 인스펙터 Notes 스팟 체크.

## 2026-08-14 — 8월 릴리스 문서 일괄 + dev→main 머지
- 이전 main 머지(2026-08-04) 이후 변경분(거버넌스 UX P0~R6·승인 코멘트·협업자 스테이징·조직 기준 departments·HR 웹훅·업무체계 Framework·관리자 CSV)을 main으로 머지하며 릴리스 문서 일괄 갱신 — 공지 초안 `docs/notices/2026-08-14-release.md` 신설, 사용/편집/관리자 매뉴얼 6종 갱신, README 기능 목록·CLAUDE.md 상태 라인(⑩) 최신화.
## 2026-08-14 — 상단 네비 반응형 구현 (fix/frontend-minor)
- **최종 리뷰 픽스(컨트롤러 직접)** — 강등 아이콘 버튼 3곳 aria-label(피드백·유저 메뉴·언어 전환)·클론 패리티 2건(인박스 뱃지 min-w-[1.125rem]·언어 활성 font-semibold). 게이트: vitest 643·tsc 0·lint 0 error. ※ 서브에이전트가 동일 픽스를 main에 오커밋(9e16857, 미푸시) — 로컬 main 원복 필요.
- **Task 1: `lib/display-stage.ts` TDD 완료** — `pickDisplayStage(available, stageWidths, marginPx=8)` 순수 함수(4 test 통과, tsc clean). 폭 실측 기반 단계 판정: 모든 단계가 미측정이거나 부족하면 강등(length로 반환), margin은 진동 방지 여유.
- **Task 2: `top-nav.tsx` 4단계 반응형 배선** — `pickDisplayStage` + 측정 복제 4개(S0~S3, 비상호작용 스팬·InboxBadge/NotificationBell은 정적 플레이스홀더)로 `stage` 실측, RO+rAF 초기 산정(deps `[lang, userName, tabIndex]`, 필터 모드 훅 선례). 라이브 전환: S1 탭 비활성 아이콘만+title(활성만 라벨, IconPillFilter 문법 350ms), 세그먼트 래퍼 `grid-cols-3`→`inline-flex`(S0 시각 동일) — InboxBadge는 라벨 유무와 무관 상시 렌더. S2 피드백 버튼 아이콘만(매뉴얼 아이콘 버튼과 동일 스타일)+Tooltip. S3 언어 토글 현재 언어 1버튼(클릭 즉시 전환)+Tooltip(신규 i18n `nav.langSwitchEn`/`nav.langSwitchKo`). S4 이름 버튼 → `User` 16px 아이콘+Tooltip(user.name), 드롭다운·로그아웃 구조 불변, 비로그인 Login 버튼은 전 단계 불변. 게이트: vitest 643 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존).
- **Task 3: 브라우저 검증 + 실측 픽스 2건** — `scripts/pw-verify-topnav-responsive.mjs`(1440/1200/1000/860/760px×EN·KO, 좌우그룹 충돌·줄바꿈·오버플로 실측 rect 기반, S1 클릭 네비 확인, 62/62 pass·콘솔에러 0). 실측 중 진짜 버그 2건 발견·수정: ① 복제 벨 플레이스홀더 `p-1.5`(+12px 과대측정, 실 `NotificationBell`은 무패딩) — 실 크기로 맞춤. ② 측정 복제 4개가 `absolute left-0`만 있고 `right` 미지정이라 containing block(nav 전체폭) 기준 shrink-to-fit 계산되어 **좁은 뷰포트에서 자연폭이 클램프되어 과소측정**(스테이지 오판 유발 확인 — 원인 ①②로 760px에서 실제보다 이른 단계로 진입했었음) → `w-max` 추가로 뷰포트 무관 고정. 설계 스펙 §5의 "760px→S4" 가정은 두 픽스 반영 후 실측으로 반증(시드 데이터 기준 760px는 S1까지만, 진짜 S4는 avail<~644px/폭 ~660대) — 버그 아니라 "필요한 만큼만 강등"이 의도대로 동작한 결과. 760 앵커를 실측대로 S1로 교정 + 보조 600px에서 S4 도달 확인(캐스케이드 전 구간 배선 검증). 최종 게이트: vitest 643·tsc clean·lint 0 error·build OK.
- **Task 3 리뷰 픽스**: Critical — `w-max`로 자연폭을 살린 측정 복제(S0~S3)가 `visibility:hidden`이어도 조상 스크롤 가능 오버플로엔 반영돼 좁은 뷰포트에서 문서 실 가로 스크롤 유발 가능(nav 자체엔 `overflow-hidden` 금지 — 유저메뉴·벨 드롭다운이 nav 40px 박스 아래로 나가야 함) → 전용 클리핑 래퍼(`absolute inset-0 overflow-hidden`)로 복제 4개만 격리(클론 자체 scrollWidth는 조상 클리핑과 무관해 측정치 그대로 정확 — 실측 확인). 검증 스크립트에 `document.documentElement.scrollWidth<=innerWidth` 가드 추가(74/74 pass, +12). Important — 스펙 §5에 "760→S1 정정(T3 실측)" 각주 추가. 재게이트: vitest 643·tsc clean·lint 0 error·build OK.

## 2026-08-14 — 상단 네비 반응형 설계·플랜 (fix/frontend-minor)
- **설계 스펙**: `docs/superpowers/specs/2026-08-14-topnav-responsive-design.md` — 폭 실측 기반 4단계 누적 강등(S1 탭 활성만 라벨(IconPillFilter 문법·인박스 뱃지 상시) → S2 피드백 아이콘 → S3 언어 토글 1개(클릭 즉시 전환) → S4 이름 User 아이콘). 판정은 `pickDisplayStage` + 측정 복제 4개(비상호작용 스팬·뱃지/벨 플레이스홀더).
- **구현 플랜**: `docs/superpowers/plans/2026-08-14-topnav-responsive.md` — 3태스크(lib TDD·top-nav 배선·브라우저 검증). T9 교훈 반영: 오버플로 단언은 scrollWidth 금지(복제 오염)·가시 rect 기반.

## 2026-08-14 — 조직/인물 카드 후속 (dev 직접)
- **후속(피드백)**: 부서 행·오우닝 부서 카드 좌클릭도 우클릭과 동일한 조직 정보 메뉴(펼침 없는 카드라 포인터 어포던스와 배선 일치) · 인물 카드에 직급·보직 필 추가(`formatTitleWithPosition` 재사용 — allowlist 보직만, 멤버 행 펼침 필과 동일 표기).
- **승인 워크플로 패널 리디자인**: 상태를 태그 필로 승격(Approved/Pending/Rejected 틴트 필 + 호버 시 이벤트 기반 시각·코멘트 툴팁 — `hover-tip.tsx` 신설·150ms 지연·비인터랙티브), 승인자 행에 인물 카드 부착+이름 한/영 전환, 제출 컨텍스트는 호버 아이콘만(제출자·시각·코멘트 — 영구 노출 지양 지시), 진행 필(n/m)·대기자 필 나열·반려 사유 라인·동봉 가시성 필, 스테퍼 위계 강화(원 32px·연결선 4px·활성 라벨 caption-strong). 사이클 판정은 최신 submitted 이벤트 이후만(재제출 시 이전 사이클 승인 시각 오표시 방지). `ApprovalPanel.events` prop 신설(에디터 `currentVersion.events` 전달, API 무변경).
- **패널 후속 조정**: 인물 카드 트리거 클릭 토글(열림 상태서 클릭=닫기)·승인자 트리거 반투명 회색 음영(`hover:bg-ink/5`)·스테퍼 라벨 전 단계 동일 사이즈 태그 필(색상만 강조).

## 2026-08-14 — 협업자 스테이징 UX 구현 (fix/frontend-minor)
- **T1 BE request_id** — `PendingChangeOut.request_id` 필드 신규 추가(요청자 본인 철회 용). schemas.py 184·permissions.py 117-120 수정, test 1216-1254 assert 강화(pending 생성 응답 req_id 캡처 추가). TDD: RED(assert 실패 `request_id` 미노출) → GREEN(1042 tests passed, ruff clean).
- **T2 FE forecastStagedOp** — 권한 op별 즉시/승인 예측 함수(BE `requires_downgrade_approval` 미러). permission-staging.ts에 `forecastStagedOp(op, grantRole, actorIsOwner): "instant" | "approval"` 추가, 5개 test case(add·viewer→editor·editor→viewer·remove·owner) 전부 green. TDD: RED → GREEN(15 tests passed, tsc clean).
- **T3 FE applyStagedOps records** — 저장 결과 상세 레코드(되돌리기 재료). `AppliedOpRecord` interface 신규, `StagedResult.records` 필드 추가(outcome + createdPermission/approvalRequest/prev 스냅샷), `applyStagedOps` 시그니처 `permsById?: Map<number, MapPermission>` param 신규. 호출부 2곳 업데이트(collaborators-panel·map-detail-card)에서 permsById 전달. TDD: RED(records undefined) → GREEN(17 tests passed, 620 전체 시험, tsc/lint 0 error).
- **T4 설정 협업자 패널 예고·중복픽스·호버캔슬·회수** — 공용 `HoverSwapPill`(hover-swap-pill.tsx) 신규, i18n 5키(forecastInstant/Approval·cancelPill·pending.withdraw/withdrawDone) EN·KO 양쪽 추가, `MapPermission.pending_change`에 `request_id` 타입 반영. `collaborators-panel.tsx`: 역할 배지 pending prop 제거(실제 role 상시 표시, 배지 pending 중복 소거), pending 상세 태그는 본인 요청이면 HoverSwapPill로 회수(`withdrawApprovalRequest`), 스택 태그는 X버튼 대신 HoverSwapPill+forecast 아이콘(Zap/Hourglass, `forecastStagedOp` 사용)로 교체(행 태그·staged-add 고스트 행 양쪽). 패널에 `isOwner` prop 신규(settings/page.tsx에서 전달). 게이트: vitest 627 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존).
- **T5 맵 카드(홈 미리보기·에디터 맵 탭) 동일 4종** — `map-detail-card.tsx`에 T4와 동일 패턴 적용: 역할 배지 `pending` prop 제거+고정폭(`ROLE_PILL_WIDTH_CLASS`) 상시 적용(중복 pending 표시 픽스), `removable`에 `!perm.pending_change` 추가(pending 행은 Remove 어포던스 자체를 닫음 — 쌓으면 저장 시 서버 409), pending 상세 태그는 본인 요청(`loginId` 일치)이면 HoverSwapPill로 회수, 스택 제거 태그·staged-add 태그 모두 X버튼 제거하고 HoverSwapPill+forecast 아이콘(`forecastStagedOp`)로 교체(제거 태그는 아이콘 포함폭이 60px를 넘어 이 필에서만 `min-w-[60px]`로 완화, 공유 상수는 불변). `handleWithdrawPending` 신규: 카드엔 `onToast`가 없어 기존 저장 핸들러와 동일한 재조회 경로(`setLocalReloadKey`)로 반영, 에러는 기존 `stagedSaveError` 배너로 노출(패널의 onToast와 다른 채널). 게이트: vitest 627 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존).
- **T6 되돌리기(직전 저장 1회분)** — `lib/permission-undo.ts` 신규: `buildUndoPlan(records, actorIsOwner)`(applied add→remove-added·applied change→restore-role·applied remove→re-add·pending→withdraw·failed 제외, `forecastStagedOp` 재사용) + `executeUndoPlan(mapId, items)`(액션별 API 순차 실행, 개별 실패 비차단·pending 집계 — 저장과 동일 정책). `UndoLastApplyModal`(confirm-dialog 백드롭/카드/z-[1300] 패턴 재사용) 신규: 항목별 필+forecast 아이콘(Zap/Hourglass) 목록. 두 표면(`collaborators-panel.tsx`·`map-detail-card.tsx`) 공통 배선: `lastApply` state(컴포넌트 메모리만, 페이지 이탈 시 소멸 — 영속 안 함, 스펙대로), Save 성공 경로에서 `outcome!=="failed"` records로 세팅, Save/Cancel 바가 안 보일 때(`stagedOps.length===0 && lastApply`)만 Undo 버튼 노출(공존 안 함), 확인 후 1회성 소거(재저장 전까지 재사용 불가). 이름 해석은 패널=기존 `resolvePrincipalName`, 카드=기존 staged-add 행과 동일 소스(`nameById`/`groupNameById`/`formatDeptName`) 재사용. 카드는 `onToast` 부재라 저장 핸들러와 동일하게 실패시에만 `stagedSaveError` 배너(성공/승인대기는 재조회 반영만, 일관성 유지). TDD: RED(`permission-undo.test.ts` 모듈 없음) → GREEN(5 tests). 게이트: vitest 632 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존).
- **T7 오우닝 부서 피커 조직도 브라우즈** — `lib/dept-browse.ts` 신규: `buildDeptBrowseRows(deptOptions, myOrgPath, pinnedCap=3)` — 내 소속 체인을 깊은 단위부터 최대 3개 pinned(트리에서 제외), 나머지는 세그먼트 정렬(=DFS, 부모가 자식의 접두라 항상 먼저 옴) + `depth` 부여. `deptLeaf`·`deptLevelRank`·레벨 아이콘 사다리(센터/담당/팀/그룹/파트)를 `map-detail-card.tsx`에서 `components/maps/dept-level-icon.tsx`로 순수 이동(`DeptLevelIcon` 컴포넌트로 감쌈, size 기본 14) — 카드 3개 사용처(MemberIcon·오우닝 멤버 행·staged-add 행) 임포트 전환, 동작 무변경. `PrincipalPicker`에 `deptTreeBrowse` prop 신규(기존 `myDeptsFirst`는 유일 사용처 교체로 소거) — 빈 검색 브라우즈 시 내 체인 pinned(들여쓰기 없음) → 구분선(pinned 0개면 생략) → 조직도 트리(들여쓰기 `12+depth*14`, 부서 아이콘은 `DeptLevelIcon`)로 렌더, 키보드 내비·infinite slice는 기존 `{item, matches:[]}` hit 형태 그대로라 무변경. 검색 중엔 기존 랭킹 플랫 리스트 그대로(트리 미적용). 호출부 2곳(`create-map-dialog.tsx`·`map-details-panel.tsx` 오우닝 피커) 전환, 협업자/승인자 피커(managersFirst·pinnedIds) 무변경. TDD: RED(모듈 없음) → GREEN(3 tests). 게이트: vitest 635 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존), build OK.
  - **리뷰 픽스**: 트리 브라우즈 부서 아이콘이 `PrincipalIcon`의 `shrink-0 text-ink-tertiary`를 안 받아 색·shrink가 형제 행과 달랐던 문제 — `DeptLevelIcon`에 `className` prop 신규(기본 `""`, 카드 기존 사용처는 무변경) 추가, 피커 호출부에서 `className="shrink-0 text-ink-tertiary"` 전달. 게이트: vitest 635 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존).
- **T8 홈 필터 필 3단계 반응형** — `lib/filter-display.ts` 신규: `pickFilterDisplayMode(available, {full,label}, marginPx=8)` — 고정 브레이크포인트 아닌 실측 폭 비교(측정 전 폭 0이면 강등 금지, full 유지). `FilterDropdown`에 `display?: "full"|"label"|"icon"` prop 추가(기본 full, 버튼에 `title` 상시 부여) — 기존 유일 사용처(page.tsx)만 있어 하위호환 리스크 없음 확인(grep: inbox/notices/feedback 미사용). `home-filter-pills.tsx` 신규: page.tsx의 상태·역할·오우닝·SP 필터 4종 FilterDropdown + `STATUS_ORDER` 상수를 그대로 이식(로직 무변경, `measureOnly`시 dataId 미부여). page.tsx 배선: 필터 행 `flex shrink-0`→`relative flex min-w-0`(실측 가능하게 축소 허용), 라이브 `HomeFilterPills` + 보이지 않는 측정 복제 2개(`display="full"`/`"label"`, `measureOnly`, absolute+invisible+pointer-events-none+aria-hidden, dataId 없음) + ResizeObserver(행·두 복제 관찰, `homeView`/`lang` 변경 시 재관찰) — 최초 산정은 `requestAnimationFrame`으로 이연(`react-hooks/set-state-in-effect` 회피, RO 콜백은 이펙트 밖이라 무관). 방어 보강: `FilterDropdown` 버튼·루트에 `shrink-0 whitespace-nowrap` 추가 — 브리프가 Task 9로 미룬 Clear 버튼 잠식 엣지케이스(측정에 Clear 폭 미포함)에서도 실패 모드를 "세로 줄바꿈"이 아닌 "여유폭 흡수 실패 시 오버플로"로 강등(같은 파일 내 최소 변경). TDD: RED(모듈 없음, import 실패) → GREEN(4 tests). 게이트: vitest 639 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존), build OK. 잔여: Clear 버튼 폭이 margin(8px)에 실제로 흡수되는지는 1130px 실측 필요 — Task 9에서 브라우저 검증.
- **T9 브라우저 실구동 검증 + 최종 게이트** — `scripts/pw-verify-collab-staging.mjs`(38 시나리오: 설정 패널 스테이징 4종+홈 카드/에디터 탭 재확인 2종+새맵 오우닝 피커)·`scripts/pw-verify-home-filter-responsive.mjs`(22 시나리오: 1440/1130/1000/900px×EN·KO 줄바꿈·오버플로+1130px Clear 활성 케이스) 신규, 전부 실 Chrome+백엔드로 green. **실측으로 발견한 진짜 버그 2건 픽스**(T8에서는 안 잡힘 — 맵 목록이 항상 캐시돼 있던 로컬 조건에서만 우연히 동작했음): ① `filterMode` 측정 effect의 deps가 `[homeView, lang]`뿐이라, 초기 렌더에 `maps`가 아직 비어(`visibleMaps.length===0`) `WelcomePlaceholder`가 뜨는 동안 effect가 null-ref로 조기 반환하고, `maps` 도착 후 필터 행이 처음 마운트돼도 deps 불변이라 다시 안 돎 — `filterMode`가 초기값 "full"에 영구 고정되고 리사이즈도 못 잡는 실사용 버그. `maps.length`를 deps에 추가해 맵 도착 시 effect 재실행하도록 수정(page.tsx). ② 1130px에서 Clear 버튼이 뜨면 그 폭이 가용폭 계산에서 빠져 있어 진짜 가로 오버플로(13.6px) 발생 — `clearBtnRef`를 같은 훅에서 관찰해 `row.clientWidth - (clearWidth + gap)`을 `pickFilterDisplayMode`에 전달하도록 수정, Clear 노출/소멸 시 effect 재부착은 `hasActiveFilter`(기존 JSX 조건 추출·재사용)를 deps에 추가해 해결. 스크립트 자체의 측정 방법도 2건 교정: `row.scrollWidth`는 측정용 invisible 복제(항상 full폭)가 얹혀 오염되므로 가시 버튼 bounding rect 기반 실측으로 대체, `offsetTop` 동일성 대신 세로 중심(`top+height/2`) 비교로 교체(Clear는 패딩 없는 텍스트라 필 버튼과 자연 높이가 달라 같은 줄이어도 offsetTop이 어긋남). 게이트 전부 그린: FE vitest 639·tsc 0·lint 0 error(무관 스크립트 warning 1건 기존)·build OK / BE pytest 1042·ruff 0. dev.db는 두 스크립트 모두 net-zero 설계(스테이징 add/remove는 전부 취소·되돌리기, 새맵 다이얼로그는 Cancel)로 실행 후 원상태 확인.
- **최종 리뷰 픽스 2건** — BE `requires_downgrade_approval` docstring에 FE `forecastStagedOp` 미러 참조 추가(규칙 수정 시 동기화점 명시) · FE collaborators-panel Remove 버튼에 `!isPending` 게이트 추가(pending 행 제거 차단, 저장 시 409 방지). 게이트: BE ruff/pytest 59 green / FE vitest 639·tsc 0·lint 0 error·build OK.

## 2026-08-14 — 협업자 스테이징 UX 7종 설계 스펙 (fix/frontend-minor)
- **구현 플랜**: `docs/superpowers/plans/2026-08-14-collab-staging-ux.md` — 9태스크(TDD·태스크당 커밋·게이트 명시, 브라우저 검증은 Task 9 일괄). 실측 앵커: BE `PendingChangeOut`(schemas.py:184)·pending 직렬화 단일 지점(permissions.py:117)·카드 60px 필 공유 지오메트리·측정 복제 기반 필터 모드 판정.
- **설계 확정·문서화**: `docs/superpowers/specs/2026-08-14-collab-staging-ux-design.md` — ① 스테이지 필 즉시/승인 예고(Zap/Hourglass, FE forecast 미러) ② pending 필 중복 렌더·고정폭 깨짐 픽스 ③ 스테이지 필 호버 캔슬 전환(X버튼 제거) ④ pending 회수(BE `PendingChangeOut.request_id` 추가+기존 철회 API) ⑤ 변경적용→되돌리기(직전 1회 메모리, 확인 모달+역방향 예고) ⑥ 오우닝 부서 피커 조직도 브라우즈(내 부서 3개 고정+들여쓰기 트리) ⑦ 홈 필터 필 3단계 반응형(full/label/icon, 실측 기반). 구현은 `fix/frontend-minor` 워크트리에서.

## 2026-08-14 — 승인 워크플로 코멘트 + 에러 인간화 (feat/approval-comments → dev 머지)
- **전이 코멘트**: submit/approve/publish/withdraw 4단계 선택 코멘트 → 기존 `VersionEvent.note` 재사용(스키마 무변경). 무기록 바로철회(pending·승인 0건)는 submitted 이벤트 하드삭제로 코멘트 자동 동반 삭제 — FE 철회 모달도 같은 조건으로 입력란 숨김(서버·UI 대칭). 에디터·설정 패널 두 마운트 공용 `transitionComment` 1개, 오픈 10곳 전부 리셋.
- **받은함 사유 픽스**: `ApprovalRequest.decision_reason` 컬럼(`_ADDED_COLUMNS` 자동 ALTER) — 비버전 거절도 선택 사유 입력(`isVersion || isApprovalRequest`), reject 시 저장 + 거절 알림 말미 `": {reason}"` 동봉(빌더 3종). 기존엔 입력 사유가 API로 전달되지 않고 유실.
- **에러 인간화 전수**: Group A 28파일 ~50곳 `humanizeApiError` 전환 — 미매핑 폴백만 `(HTTP nnn)` 꼬리표, 원문 JSON은 api.ts throw 2곳 `console.error` 보존, 에러 토스트 톤(XCircle+`border-error`, 성공 토스트 무톤 — onToast prop `(msg, tone?)` 확장). ⚠️ settings 401/403 억제는 문자열 포맷 결합 유지(양단 경고 주석) — status 기반 전환은 후속 결정.
- **거절 배너·코멘트 모달**: 에디터 헤더 배너를 에러 틴트 칩 + 거절자 필(스테일 가드 `workflow.version_id` 대조)로 재디자인(`wf.rejectedBanner`→`wf.rejectedLabel`). 버전 카드 MessageSquare 카운트 버튼(0건 숨김) → 코멘트 이력 모달(`comment-history-modal.tsx`, 클릭점→중앙 확대 `comment-modal-in` 350ms overshoot·바깥 mousedown 즉시 닫힘·Escape·`eventsReloadKey` 액션 후 재조회).
- 검증: 태스크 리뷰 8/8 + 최종 전체 리뷰 승인(머지 가능), BE pytest 1050·ruff 0 / FE lint 0 error·tsc 0·vitest 620·build OK, Playwright+Chrome 실구동 6항목 전판 PASS. 설계·플랜: `docs/superpowers/{specs,plans}/2026-08-14-approval-comments*`.
- **후속(피드백)**: 버전 타임라인(`version-timeline.tsx` — 홈 맵 상세·인스펙터 맵 탭 공용)에도 버전별 코멘트 카운트 버튼(0건 숨김) → 동일 `CommentHistoryModal` 재사용 (dev 직접).
- **후속(피드백)**: 승인 모달에 요청자 제출 코멘트 배너(`requester-comment-banner.tsx` — 최신 submitted 이벤트 note) — 에디터·설정 패널(`ApproveConfirmDialog.submitComment`)·받은함(맵 상세 lazy 조회) 3표면. 에디터 `versions`를 `VersionDetail[]`로 상향(전 지점이 getMap 상세 주입이라 안전) (dev 직접).
- **후속(피드백)**: 반려 모달 3표면에도 요청자 코멘트 배너 + 승인 요청(submit) 모달에 반려 기록 시 이전 반려 배너(에러 톤, 최신 rejected 이벤트 note·반려자 — `findLatestRejection`) (dev 직접).
- **후속(피드백)**: 버전 히스토리 이름 한/영 전환(`useDirectory`+`lang` — ko는 한글명·영문 폴백) + 아이디 hover 0.7초 인물 카드(`person-hover-card.tsx` 공용 — 한/영 이름 치환·`mysingleim://` 메신저 링크·말단 부서+조직 경로 아코디언) (dev 직접).
- **후속(피드백)**: 허용 인원 목록 우클릭 — 인물 행=메신저 보내기·부서/오우닝 카드=조직 정보(에디터 `ContextMenu` 재사용) → `org-info-modal.tsx` 신설(클릭점→중앙 확대·브레드크럼 이동·구성인원 조직장 우선 6.5행 클램프 스크롤·하위 조직 재귀 아코디언, 디렉터리 캐시만 사용) (dev 직접).
- **마이너 픽스 4건**: 타임라인 코멘트 버튼 카드 호버 시에만 노출 · 인물 카드 트리거 호버 어포던스+클릭 즉시 열림 · 호버 카드 포털 이벤트가 React 트리로 버블링돼 버전 카드 접힘/열림 토글되던 것 차단(click/mousedown/keydown stopPropagation) · 멤버 스택 오우닝 부서 행에도 우클릭 조직 정보(부서 행과 동일 카드 인식) (dev 직접).
- **후속(피드백)**: 부서/오우닝 카드 호버 어포던스(링+포인터, 인물 행과 통일) · 버전 카드 우클릭 메뉴(이 버전으로 가기·코멘트 보기 — 비활성 조건 포함) · 타임라인 `group`→`group/vercard` 네임드 그룹(인스펙터 details.group 조상 충돌로 호버 리빌 오작동 교정, R5-2 동일 함정) · 에디터 go-to는 `requestGoToVersion` 가드로 편집 중 전환 확인 모달 유지(`version-switch-confirm.tsx` 공용 추출, VersionPill도 사용) · 인물 우클릭 메뉴에 Info(스탠드얼론 `PersonInfoPopup`, 버블링 차단) (dev 직접).

## 2026-08-14 — QA 문서 정비: ai 2건 삭제·dev-vs-main 로컬 검증·alarm-audit 재검증 부기 (dev 직접)
- **ai-connectivity-test·ai-real-model-smoke 삭제**(사용자 확인 완료분) + `docs/README.md`·`.env.example` 참조 정리.
- **dev-vs-main 체크리스트 로컬 검증**: 카테고리 Add/Rename(트리 반영·`ui-` code)·Delete 기본 동작(연결 맵 거부 사유·묶음 삭제, sqlite) + 샘플 전달물 임포트로 CM-PUR-001 게시 v1·SP 지정·CM-PUR-003 연계 subprocess 임베드 실브라우저 확인 — 남은 미체크는 9910 Postgres FK 재확인뿐.
- **alarm-audit 재검증 부기**: ed15440 감사 이후 해소된 결론 명시(사용자 삭제 API·인당 100캡·sysadmin 퍼지·type 6→18종·checkout 벨 비대칭 해소·create_notifications async).

## 2026-08-14 — 거버넌스 QA 전수 브라우저 검증 + 결함 픽스 4건 (dev 직접)
- **QA 체크리스트 68항목 전수 검증**(P0·C·B·A·R2~R6·회귀) — Playwright+시스템 Chrome, 결정적 QA 시드(O/E/V 3역할·맵 4종·리셋 DB). 전 항목 통과 처리, 백엔드 계약 항목(P0-6·A-3/4/8/10 연쇄)은 API 실호출 검증·항목 비고 부기.
- **발견·픽스 4건**: ① R5-1 Remove 필 상하 6px 커짐(오버레이가 래퍼 라인박스 덮음 → 내부 span 분리, `map-detail-card.tsx`) ② 설정 결재 대기 탭이 실제 승인자에게 미노출(mock permState 게이트 → `listApprovers` 실서버 목록, `settings/page.tsx`) ③ 인박스 배지 첫 폴 X-Dev-User 미주입 레이스(`api.ts` devUser localStorage 부트 시드) ④ 비권한자 에디터 승인 탭 403 무한 재요청 루프+원문 토스트(`pending-approvals-panel.tsx` 조회 게이트+초기 로드 무토스트).
- 관찰(후속 판단): 협업자 패널 pending 행 잠금으로 오너 직접 강등 UI 진입점 없음(백엔드 supersede 계약은 유효). 게이트: FE vitest 620·lint 0 error·tsc 0·build OK(백엔드 무변경).

## 2026-08-13 — 거버넌스 R6: 인스펙터 재정비 (feat/governance-r6 → dev 머지)
- **맵 탭**: 버전 선택 행(VersionPill+관리 아이콘)을 승인 탭→맵 탭 최상단으로 이동, 노드 디스플레이(항목 아이콘 5종 추가)/엣지 스타일 섹션 기본 접힘 아코디언화(`useClosingKeys`+`accordion-open/close` 공유 인스턴스).
- **승인 탭 재배치**: 결재 대기(최상단)→드래프트 CTA(드래프트 有=전환/無=생성, 옛 버전 행 자리)→승인 워크플로(접힘 섹션, 헤더에 StatusBadge — `ApprovalPanel hideHeader`로 중복 헤더 제거)→SP 지정→버전 카드. 체크아웃 UI는 draft 전용(rejected 제외 — Withdraw가 draft 복귀+체크아웃 재부여라 막다른 상태 아님).
- **협업자 클램프**: 개인(user) 그룹만 4행 초과 시 3.3행(177px, `clamp-size` 재사용) + 전체 펼치기/접기 토글.
- **SP 카드 버튼 행 통합**: 지정 버튼(`Workflow` 아이콘)+우측 정렬 게시본 가기(`ArrowRight`)/등록 요청(`BadgeCheck`) 한 행, reason은 순수 노트로. R10 계약 무변경.
- 최종 리뷰 Critical 픽스: 접힘 전환으로 `PendingApprovalsPanel` 언마운트→카운트 배지 0 고정 회귀 — 패널 상시 마운트+완전 접힘만 `hidden` 3분기로 복원. QA `## R6` 7항목+문구 교정 3건. 게이트: BE pytest 1042·ruff 0 / FE vitest 620·lint 0 error·tsc 0·build OK.

## 2026-08-13 — 거버넌스 R5: 멤버 행 Remove 필 폴리시 (feat/governance-r5 → dev 머지)
- 사용자 피드백 5건 일괄: 스왑 크기 불변(고정폭 `w-[60px]`을 RoleBadge 신설 `className` prop으로 — `min-w-[72px]` wrapper 폐기)·X 아이콘 제거(문구만)·`invisible`→opacity 페이드(`duration-150`)·행 루트 `group`→`group/member`(인스펙터 `<details.group>` 조상 누수로 전 행 동시 스왑되던 버그 해소)·제거 예정 태그를 소속 줄 우측 2행으로 분리(권한 필 유지, 취소 X 공간 예약+hover 페이드 인). EN `perm.staged.remove` "To remove"→"Remove"(60px 폭 맞춤).
- 브라우저 실측 검증(Playwright+Chrome): bounding box 0px 이동·인스펙터 1행만 스왑·전 역할 우측 정렬 일치. QA R4-4 교정+`## R5` 4항목. 게이트: FE vitest 620·lint 0 error·tsc 0·build OK(백엔드 무변경).

## 2026-08-13 — 거버넌스 R4: 가시성 UX 4건 (feat/governance-r4 → dev 머지)
- **승인자 모달 가시성 배지**: 승인자 관리 모달 우측 상단에 현재 가시성 배지(Globe/Lock, 라이브 state 스레딩).
- **동봉 픽커 드롭다운화**: pill 행 → "공개 범위"(EN "Visibility") 라벨 + 우측 드롭다운(아이콘·current 옵션에 리터럴 "Current" 필). 계약 불변(재선택=해제 포함) — 3표면 배선 무변경. `perm.visibilityCurrent`는 visibility-control 사용처 잔존으로 유지.
- **인스펙터 가시성 3:1 + 워크플로 모달**: 3:1 그리드는 전원 공통, 전환 클릭만 오너 전용 → ConfirmDialog(현재→대상·승인자 이름 필·0명이면 confirm 비활성·조회 실패는 별도 에러) → `requestVisibilityChange`, 409는 humanize+pending 재조회. mapId 전환 시 모달 상태 강제 리셋(stale target 방지). ConfirmDialog `dialogId` optional prop(타 호출부 무변화).
- **멤버 행 제거 hover 스왑**: 카드/인스펙터의 제거 X 폐기 → RoleBadge 자리에 hover/focus 시 빨간 Remove 필 스왑(min-w 72px 실측, opacity/pointer-events 토글로 Tab 도달 유지 — 구 X의 focusable-invisible 결함도 해소). 설정 패널은 select UX 유지·X만 absolute 전환+`pr-8` 공통화로 정렬 교정(사용자 확정 범위).
- QA `docs/qa/governance-ux-checklist.md` R4 섹션 5항목(최종 리뷰가 문구 2건 교정 — 배지 표면·스택 적립 동작). 게이트: BE pytest 1042·ruff 0 / FE vitest 620·lint 0 error·tsc 0·build OK.

## 2026-08-13 — 거버넌스 R3: 후속 정비 6건 (feat/governance-r3 → dev 머지)
- R2 리뷰 이월분 정비: SP ⓘ 클릭이 접힘 토글 안 함(stopPropagation) · SP 등록 409 문구 i18n(`apiError.spDesignationPending`) · `stageRoleChange`로 원복 선택 시 staged op 소거(no-op 스택 방지, 협업자 패널 — 맵 카드는 role 변경 UI 없음) · 결재 대기 카운트에서 동봉 행 제외(`isBundledRow`, 목록 표시는 유지).
- **새 맵 모달 협업자 팝오버 통일**: `RolePopover`를 `role-popover.tsx`로 공용 추출(무변화 리팩터) 후 create-map-dialog도 클릭 위치 2-step 팝오버+하이라이트+추가 플래시로 전환(role select 폐기, 퍼블릭은 Editor만·2-step 유지). 고아 키 `collaboratorRoleViewerDisabled` 제거.
- **체크아웃 폴 중지**: 본인 강등 pending 409(`PERMISSION_PENDING_DETAIL_PREFIX` 단일 소스) 감지 시 인터벌 정지(첫 폴 실패는 생성 생략). 알려진 한계: pending이 반려로 해소돼도 자동 재개 없음(새로고침/버전 전환으로 재개) — 후속: focus 재시도. `checkout===null` readOnly 미강제는 cosmetic(서버 graph PUT이 비보유자 저장 거부) — 후속 후보.
- QA `docs/qa/governance-ux-checklist.md` R3 섹션 5항목. 게이트: BE pytest 1042·ruff 0 / FE vitest 620·lint 0 error·tsc 0·build OK.

## 2026-08-13 — 거버넌스 R2: QA 피드백 반영 (feat/governance-r2 → dev 머지)
- **pending 가시성·복구**: 행 단위 pending 노출(`PermissionOut.pending_change`·`WorkflowStateOut.bundled_visibility`)로 요청자 아닌 유저에게도 승인 대기 태그(→role·요청자) 표시. `lib/api-errors.ts` `humanizeApiError`(서버 detail 전방일치 10종→i18n) 16개 catch 지점 — 409도 pending 재조회로 마커·철회 버튼 복구(막다른 상태 제거).
- **상호 배제**: 체크아웃 보유자·pending/approved 제출자 대상 권한 변경 차단(오너 직접 적용 포함) ↔ 본인 pending 다운그레이드 시 체크아웃·제출 차단(승인/반려는 무관).
- **전이 다이얼로그 공용화 + pill 동봉**: 버전 전이 5종 다이얼로그를 `components/version/`으로 추출해 설정 패널을 공용 전환(승인자 미표시 표면 드리프트 근본 해소). 동봉 UI는 체크박스→`VisibilityBundlePicker` pill로 3표면(에디터·패널·셀프 게시 팝오버) 통일, 승인 확인 모달에 동봉 변경 내용 공개.
- **스택 저장**: 권한 편집을 두 표면(협업자 패널·맵 카드)에서 적립+Save 일괄/Cancel 폐기(`lib/permission-staging.ts`). Save 부분 실패는 dismissible 인라인 배너(`stagedSaveError`) — 카드 생존(최종 리뷰 픽스).
- **홈/피커**: 맵 탭 협업자 기본 펼침 + 오너 섹션 정렬(`renderMemberRow` 공유, owner 행 불변식 유지). 협업자 추가는 클릭 위치 `RolePopover` 2-step(+선택 하이라이트·staged-add 플래시), `PrincipalPicker` coords/highlightId 하위호환 확장.
- **에디터/SP**: 승인 탭 하단 결재 대기 접이식 섹션+카운트 필(`PendingApprovalsPanel` 재사용). SP 안내 ⓘ 호버 툴팁화+카드 본문 기본 접힘(sessionStorage `bpm.inspector.spOpen`, 3마운트 공유). SP reason 행 액션 2종 — 게시본 가기(`switchVersion`)·등록 요청(pending이면 disabled+요청자/시각 툴팁, `disabledReasonKind` 분기).
- QA: `docs/qa/governance-ux-checklist.md` R2 섹션 16항목. 게이트: BE pytest 1042·ruff 0 / FE vitest 617·lint 0 error·tsc 0·build OK. origin/dev 2c3170e 푸시 완료.

## 2026-08-13 — 관리자 UX: 동기화 로딩·테이블 CSV (feat/admin-sync-csv → dev 머지)
- **인원 동기화 로딩**: sync 버튼 Loader2 스피너 + busy가 후속 재조회까지 커버(재조회 실패는 err.message로 전파 — 삼킴 제거).
- **관리자 테이블 CSV 내보내기**: 공용 `lib/csv.ts`(escapeCsvCell — **수식 인젝션 가드**('=+-@탭CR' 시작 셀 ' 접두, 보안 리뷰 반영)·buildCsv CRLF·downloadCsv BOM `\uFEFF` 이스케이프 접두) + `ExportCsvButton` → employees/departments/notices 3표(화면 동일 컬럼·전체 데이터). DB 테이블 뷰어는 신설 `GET /api/admin/tables/{name}/export`(sysadmin·read_table 미러·**PK 타이브레이커 정렬**·500행 스트리밍·JSON 셀 json.dumps·BOM 미부착)로 현재 정렬/필터 그대로 전체 내보내기 — 모든 원시 테이블 커버.
- **계약**: FE `escapeCsvCell` ↔ BE `_escape_csv_cell` 동치 유지(파리티 테스트로 고정), BOM 접두는 FE downloadCsv 단일 지점. 게이트: BE pytest 1036·ruff 0 / FE vitest 606·lint 0 error·tsc 0·build OK. origin 푸시 대기.

## 2026-08-12~13 — 거버넌스 UX 확장 4페이즈 (feat/governance-ux → dev 머지)
- **설계 재검토**(docs/design/2026-08-08-governance-ux-design.md 개정): 코드 실측으로 P0 선행 정비 신설, B 게이트 editor 확정, C는 red dot→count pill+top-nav 배지, 구현 순서 P0→C→B→A.
- **P0 라이프사이클 대칭화**: visibility/permission 요청에 중복 409·요청자 withdraw(DELETE /approval-requests/{id})·직접 적용 supersede(+알림), 소프트삭제 스윕 통일(_get_map_or_404·inbox block3·sysadmin 큐), 승인자0 409, FE pending 마커 새로고침 복원+철회 버튼.
- **C 승인 탭 통합**: per-map 목록 게이트 오너 확대(_assert_owner_or_approver), PendingApprovalsPanel 4종 전종+행별 결정권(rename/sp=오너·나머지=승인자), 좌측 레일·top-nav 인박스 pending 카운트 배지(InboxBadge 15s 폴링).
- **B 카드 멤버 편집**: AddCollaborator 추출 재사용, map-detail-card에 editor+ 게이트 추가/제거(owner·오우닝 부서 행 보호, 강등은 승인 경유+pending 배지).
- **A 게시 동봉**: submit에 to_visibility 동봉(SubmitIn, payload.version_id 링크 — DDL 무변경) → 버전 만장일치 편승, publish 시 _apply_request 재사용 적용, reject/withdraw/delete_version 연쇄 종결, 직접 decide·withdraw 409, standalone pending은 동봉이 supersede. FE 3표면(에디터 모달·설정 패널·셀프 게시 팝오버) 체크박스 — **오너 전용**(최종 리뷰가 에디터 우회 적발→게이트 봉쇄), 결재 대기 행은 "Decided with version approval" 읽기전용.
- **최종 전체 리뷰**(opus)에서 Critical 1(동봉 오너 게이트 우회)+Important 3(범용 철회·sysadmin 큐·approved 버전 삭제 고아화) 적발→픽스웨이브로 봉쇄. QA: `docs/qa/governance-ux-checklist.md`(P0 7·C 5·B 5·A 11·회귀 4). 게이트 최종: BE pytest 1028·ruff 0 / FE vitest 599·lint 0 error·tsc 0·build OK. 사용자 실검증(9910)·origin 푸시 대기.

## 2026-08-12 — 9910 검증 반영 + 관리 탭 후속 2종
- 검증: 멱등 재실행·카테고리 관리·홈 노출·회귀 스팟 사용자 확인 완료(잔여: CM-PUR-001 연계 SP 노드 1건). 오우닝 부서장 자동핀은 **보류 결정**(현행 유지).
- **Move 모달 트리화**: 캐스케이드 → 지정 모달과 동일한 조직도식 트리(루트 행·자기 서브트리 숨김·깊이 초과 위치 비활성·잔여 422는 인라인 표시 — 블러 뒤 토스트 안 보이던 문제 해소). category-cascade 헬퍼 완전 폐기.
- **삭제 묶음 정책**: 서브트리에 연결 맵 1개라도 있으면 409, 없으면 하위 카테고리까지 통째 삭제. 게이트 BE 997·FE 598·admin 스모크 11/11·move 검증 8/8.
- **묶음 삭제 500 픽스(9910 실측)**: ORM 개별 delete는 플러시 순서 비보장 → 부모 선삭제 시 Postgres 자기참조 FK 즉시 강제로 IntegrityError(sqlite는 FK 미강제라 로컬 무재현). 레벨 역순 명시적 벌크 DELETE로 교체, 3레벨 회귀 테스트.

## 2026-08-08~12 — 컨설턴트 전사 체계 수용 + 홈 프레임워크 UX (feat/consultant-hierarchy → dev 머지·푸시)
- **Phase 1**(스키마·canonical 파서·멱등 임포트 엔진+CLI — uuid id+`source_node_id` 계보, 부분 재전달 연계 승계) → **Phase 2**(카테고리 lazy API·홈 Framework 토글+트리·상세 뱃지/I/O·연결/이양) → **Framework 관리 탭**(카테고리 CRUD+웹 JSON 대량 임포트 — 이제 기본 경로, 재임포트 시 전체 level BFS 재계산) → **홈 뷰 UX**(검색/필터 공유·원클릭 캐스케이드·펼침/리스트 영속·틴트 박스·3.5 클램프(숨김 스크롤바·내부 스크롤)·펼침/접힘 애니(고스트 렌더)·스티키 헤더·카드 이름 클릭=선택+호버 Open) → **지정 모달 조직도식 트리**(리프만 선택) → 상세 카테고리 필 최상단 행.
- 조직 기준 전환(dept_info→departments·EDW 직책) 후속 통합 — `import_consultant`를 orgchart resolver로 정합(피커·검증과 단일 소스), 9910 픽스(has_org_info·한/영 트리·단절 체인 폴백 등).
- 게이트 최종: BE pytest 997·ruff 0 / FE vitest 600·tsc·lint 0·build OK / 실브라우저 스모크 framework 25/25·home-dept 23/23·admin 11/11·지정 모달 6/6. **웹 임포트·슬롯 이양 사용자 실검증 완료(2026-08-12).** 남은 것: `docs/qa/dev-vs-main-checklist.md` 미체크 4항목 → main 머지·운영 배포.

## 2026-08-10 — 사용자·조직도 소스 교체(AD→n8n HR 웹훅, dev 머지)
- employees 단일 소스를 AD→n8n HR 웹훅으로 교체(`app/hr/` 클라이언트+sync 코어+내장 스케줄러), LDAP은 title 전용 패스로 축소. 퇴직자 active=false+피커/디렉터리 제외, email 모델 제거(운영 NOT NULL 완화 부트스트랩), departments 미러 신설, 드라이런 프리뷰+삭제 20% 상한 가드. 잔여 후속은 체크리스트 백로그 1~6.

## 2026-08-04 이전
- 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-08-12 이동분 포함) + git history.
