# 유저 한글이름 필드 + 일괄 등록 모달 — 설계

날짜: 2026-07-09 · 브랜치: worktree-ui-improvement (ui-improvement 워크트리)

## 목표

AD가 제공하지 못하는 **한글이름**을 유저(Employee) 정보에 필드로 추가하고, 관리자 콘솔 Employees 탭에서 **JSON 파일로 일괄 등록**할 수 있게 한다. 한글이름 미보유 유저 목록은 JSON으로 다운로드해 작성 기초로 쓴다.

## 1. 데이터 모델 (backend)

- `Employee.korean_name: Mapped[str] = mapped_column(String(200), default="")` — `backend/app/models.py`.
- 기존 DB 반영: startup `_add_missing_columns`(`backend/app/db.py`) 자동보강으로 ALTER — 별도 마이그레이션 없음.
- **AD sync 불간섭**: `ad/service.py._upsert`는 `EmployeeFields` 고정 필드만 갱신 — `korean_name` 미포함이므로 동기화에 지워지지 않는다. (회귀 테스트로 고정)
- `EmployeeOut`(`schemas.py`)에 `korean_name: str` 추가.

## 2. API (backend) — 신설 1개

### PUT `/api/employees/korean-names` (sysadmin 전용)

```json
// request
{
  "mode": "skip" | "overwrite",
  "entries": { "<login_id>": "<한글이름>", ... }
}
// response
{ "updated": 3, "skipped": 1, "unknown": ["no.such.id"] }
```

- `mode=skip`: 기존 `korean_name`이 비어있지 않은 유저는 건너뜀. `mode=overwrite`: 전부 적용.
- 값은 trim 후 빈 문자열이면 해당 항목 무시(이름 삭제 기능 아님).
- employees에 없는 login_id → 적용 제외, `unknown` 배열로 반환.
- 서버가 mode 판정을 직접 수행 — 클라이언트 diff를 신뢰하지 않는다.

Export 엔드포인트는 만들지 않는다 — 어드민 탭이 이미 전 직원 목록(`GET /api/employees`)을 로드하므로 클라이언트에서 필터·다운로드.

## 3. 프론트 UI

### Employees 탭 (`src/components/admin/employee-table.tsx`)

- 테이블에 `korean name` 열 추가 — `name` 열 옆.
- AD sync 버튼 옆 **Add Korean Names** 버튼 → 모달 오픈.

### 신규 모달 `src/components/admin/korean-name-modal.tsx`

모달 컨벤션(아이콘+요약박스+필, 산문 최소)·디자인 토큰·`data-id` 준수. UI 라벨 영어(i18n en/ko 키 추가).

1. **인터페이스 정의 노출** — import JSON 형식 예시 코드블록:
   ```json
   { "hong.gd": "홍길동", "kim.cs": "김철수" }
   ```
2. **버튼 A — Download missing list**: `korean_name`이 빈 유저의 login_id 배열 `["id1","id2",...]`를 JSON 파일로 클라이언트 생성·다운로드. (파일명 등 미세조정은 구현 후 테스트하며 조정 — 사용자 합의)
3. **버튼 B — Import JSON**: 파일 선택(`.json`) → 클라이언트 파싱·검증(객체 맵 형식, 값 문자열) → 기존 값 보유 유저 집계.
4. **충돌 확인 단계**: 기존 `korean_name`이 비어있지 않은 항목이 1개 이상이면
   - 문구: "**N** users already have Korean names."
   - 버튼: `[Skip all]` `[Overwrite all]` (+ 취소).
   - "N users" 호버 → 툴팁 박스: `login_id · 현재값 → 새값` 목록. `useInfiniteSlice` 재사용, 25행 청킹 무한스크롤(툴팁 안 스크롤 유지 — 호버 유지되도록 툴팁 영역 포함 hover 처리).
   - 충돌 0이면 확인 단계 없이 바로 PUT.
5. **결과 요약**: `updated / skipped / unknown` 표시(unknown은 id 목록 노출).

### 파싱 실패 처리

JSON 파싱 오류·형식 불일치(배열이 아닌 객체 맵이어야 함, 값이 문자열 아님)는 모달 내 에러 메시지로 표시하고 요청을 보내지 않는다.

## 4. 판정 규칙 요약

| 상황 | 처리 |
|------|------|
| 기존 값 없음 + 새 값 | 즉시 적용 대상 |
| 기존 값 있음(동일 여부 무관) | "이미 등록" 카운트 → skip/overwrite 선택 대상 |
| login_id가 employees에 없음 | 제외 + `unknown` 보고 |
| 값이 빈 문자열/공백 | 항목 무시 |

## 5. 테스트

- **backend pytest**: skip/overwrite 각 모드, unknown id 보고, 빈값 무시, 비 sysadmin 403, AD sync가 korean_name 보존.
- **frontend**: `npm run lint` + 브라우저 스모크(모달 열기 → 다운로드 파일 내용 → 임포트 → 충돌 확인 → 결과 요약) — 기존 pw-smoke 패턴.

## Out of scope (후속 미세조정 후보)

- Export 파일을 `{"id": ""}` 빈 맵으로 바꿔 "값만 채워 재업로드" 왕복 지원.
- CSV 임포트(불채택 — Excel CP949/UTF-8 인코딩 깨짐 리스크).
- 한글이름의 디렉터리 검색·유저 카드 등 다른 화면 노출 (이번 범위는 필드+어드민 등록만).
