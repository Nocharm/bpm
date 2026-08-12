# dev ↔ main 확인 체크리스트 · 백로그

> 기준: main `4980277` ↔ dev (2026-08-12, 컨설턴트 프레임워크 관리 탭 포함). **n8n 연동(HR 웹훅·EDW 직책)은 연동·검증 완료 전제** — 유저 목록·부서 트리는 9910에서 확인 끝(2026-08-11). 남은 건 아래 화면 확인 → main 머지 → 운영 배포.

## 확인 방법

9910(또는 dev 스택)에 최신 dev를 배포하고 **sysadmin 계정**으로 아래를 순서대로 본다. 각 줄 형식: 어디서 → 무엇을 → 통과 기준.

## 1. 완료된 것 (재확인 불필요)

- [x] 유저 목록·부서 — HR 웹훅 동기화·퇴직자 제외·부서 트리·직책(Manager 태그) 검증 완료 (2026-08-11, 9910)
- [x] n8n hr-position 실호출(DEPTCD)·스키마 자동 보강(dept_code·position·email NOT NULL 완화)

## 2. 컨설턴트 프레임워크 — 신규 확인

### 2-1. 웹 임포트 — 설정 → Framework 탭

- [ ] 설정 열기 → **Framework** 탭이 보인다(sysadmin에게만) → Categories 트리는 임포트 전이라 비어 있음
- [ ] Import 섹션에서 `categories.json`·`maps.jsonl` 선택(샘플: `docs/samples/consultant-delivery-sample/` — owner를 본인 계정, department를 홈 부서 트리에 보이는 경로로 바꿔서) → 파일명·항목 수 표시
- [ ] **Dry-run** 클릭 → 요약 칩(created/updated/unchanged/errors/warnings) + 행 테이블 → 홈에는 아무 변화 없음(미영속)
- [ ] **Apply** 클릭 → 확인 다이얼로그 → 완료 후 탭의 카테고리 트리에 구매→소싱→… 생김
- [ ] 같은 파일로 Dry-run 재실행 → 전부 unchanged (멱등)

### 2-2. 카테고리 관리 — 같은 탭

- [ ] 루트 **Add** → 이름 입력 → 트리에 나타남 (code는 `ui-` 자동)
- [ ] **Rename** → 이름 변경이 트리에 반영
- [ ] **Move** → 캐스케이드로 다른 부모 선택 → 이동 반영 (자기 자손 아래·레벨 5 초과는 에러 안내)
- [ ] 자식·연결 맵 있는 카테고리 **Delete** → 사유(개수)와 함께 거부 / 빈 카테고리는 삭제됨

### 2-3. 홈 노출 (임포트 결과)

- [ ] Maps 탭 좌측 **Framework 토글** → 최상위 카테고리 **한 번 클릭** → 맵 있는 가지가 끝(L5)까지 자동으로 펼쳐져 임포트된 맵 3개 노출 (빈 가지는 안 펼쳐짐), 맵 보유 카테고리는 부서 목록과 같은 **틴트 박스**로 표시
- [ ] (두 뷰 공통 + 나의 부서) 맵 4개+ 목록은 **3.5개 높이로 잘리고**(잘린 영역은 휠로 내부 스크롤 — 스크롤바 없음, 끝에 닿으면 바깥 목록 스크롤로 이어짐) 아래 풀폭 쉐브론 "Show all (n)" → 전체 펼침/"Collapse" 재접힘(높이 전환 애니메이션), 새로고침에도 상태 유지. **긴 이름 카드도 틴트 박스 안에서 말줄임**(우측 삐짐 없음)
- [ ] 부서/카테고리 **펼칠 때 자라나고 접을 때 줄어드는 애니메이션**(즉시 뿅 아님), 틴트 박스 헤더는 **스크롤해도 상단 고정(sticky)** — 전체 펼침 상태면 헤더 우측에 "Collapse" 버튼
- [ ] 맵 카드 **이름 클릭 = 선택**(에디터 직행 아님) — 에디터 이동은 카드 호버 시 권한 필 앞에 나타나는 **↗ Open** 버튼
- [ ] 트리를 펼쳐둔 채 맵 진입 후 **뒤로가기**(또는 새로고침) → Framework 뷰·펼침 상태 그대로 복원
- [ ] Framework 뷰에서 **검색** 입력 → 플랫 검색 결과로 전환, 지우면 트리(펼침 상태 유지)로 복귀
- [ ] Framework 뷰에서 **가시성/상태/역할 필터** → 카드가 걸러지고 "{n} filtered out" 노트 표시 (카운트 태그는 전체 기준 유지 — 정상)
- [ ] 맵 선택 → 상세 카드에 카테고리 경로 pill + Input/Output 표시
- [ ] (오너 계정) 경로 pill 클릭 → 연결/이양 모달 동작 — 캐스케이드에서 같은 브랜치 재선택 시 하위 셀렉트가 정상적으로 다시 뜨는지 포함
- [ ] `CM-PUR-001` 에디터 → 연계 subprocess 노드 + 게시 v1 확인
- [ ] 홈 맵 필터의 **SP / Non-SP** 필터 동작

## 3. 기존 화면 회귀 스팟 (빠르게)

- [ ] 홈 Departments 뷰·최근 목록·도넛 정상
- [ ] 아무 맵 에디터 열기 → 편집 → 저장 정상
- [ ] 설정 Employees / Departments 탭 정상(직책 병기·트리 테이블)

## 4. 통과 후 절차

1. dev → main 머지 — 머지 시 PROGRESS 항목 압축(`rules/common/git.md` — On Branch Merge)
2. 운영 배포 — 기동 로그에서 자동 보강 확인: `process_categories` 테이블 + `process_maps` 4컬럼(category_id·consultant_code·sp_input·sp_output) (+ HR 묶음 보강은 이미 적용 전제)
3. 운영 첫 임포트는 **설정 → Framework 탭**으로. 초대형 전달(수천 맵+)만 서버 CLI(`docs/deploy/db-migration-9910.md` §8 참조)

## 결정 대기

- **오우닝 부서장 자동 승인자 제안·핀 복원 여부** — 새 맵 생성 모달의 해당 기능이 dept_info.manager 소멸로 기능 상실(코드 정리됨, `create-map-dialog.tsx`의 `autoLeaderRef` 스캐폴딩 잔존). EDW position 기반으로 복원할지 사용자 결정 필요.

## 백로그 (코드 후속 — 우선순위순)

### HR 웹훅 잔여 (2026-08-10 최종 리뷰 유예분)
1. **case-mismatch 실 sync 무방비** (우선) — 프리뷰만 감지, 상시 운영 중 HR 표기 변경 시 신규행 생성+구행 삭제로 참조 고아. sync 요약 카운트 추가 또는 중단 정책.
2. 프리뷰가 count 불일치·삭제 상한 초과 abort를 미예고
3. sync 라우터 웹훅 장애 시 제네릭 500 → 명시적 503
4. `reconcile_departures` IN절 무청크 (구 sqlite 이론 리스크)
5. lifespan `hr_task.cancel()` 후 await 미수행 (dev --reload 좀비 가능)
6. ~~프리뷰 dept_info 고아가 pre-state 기준~~ → **소멸** (`60ba560`에서 dept_info 고아 리포트 자체 삭제)

### 조직 기준 전환 잔여 (2026-08-11 최종 리뷰 Minor 유예분)
7. position 갱신/소거 카운터 분리(`position_erased`) — 이행 검수가 이 숫자 의존, 대량 소거 사고 판독용
8. `fetch_positions` 빈 URL 시 HR URL 폴백 풋건 — 명시 raise 가드
9. `/api/me` 체인 워크·깊이 상수(15)가 `orgchart._MAX_DEPTH`와 이중화 — 헬퍼 추출
10. 체인 중간 단절 시 부분 경로 무통지 사용 — 로그 또는 docstring 명시
11. `employee-table` 노출 직책 카드 초기 GET `.catch(() => undefined)` 무통지 삼킴
12. 스테일 Playwright 스크립트 2종 정리 — `pw-verify-dept-tree-import.mjs`·`pw-smoke-korean-names.mjs`(삭제된 모달·버튼 타깃, 영구 브로큰)

### 프레임워크 관리 탭 잔여 (2026-08-12 태스크 리뷰 Minor 유예분)
13. 캐스케이드 모달(연결/이양·Move) 컴포넌트 회귀 테스트 부재 — 재선택 버그 픽스 가드용
14. categories.json 파싱 실패 시 빈 배열로 조용히 진행(인라인 오류만) — 리포트에 상관 표시 후보
15. 파서 CRLF 테스트 부재(Windows 파이프라인 보험) · DELETE 409 소프트삭제 맵 분기 미테스트 · import label>100 422 미테스트
