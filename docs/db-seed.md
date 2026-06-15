# DB 초기화 & 더미 시드

로컬/서버 DB를 비우고 더미 프로세스맵 3세트를 채우는 방법. 데모·QA·버전 비교 화면 확인용.

스크립트: `backend/scripts/seed_dummy.py`

## 무엇이 만들어지나

`--reset` 실행 시 **기존 맵을 전부 삭제**(cascade로 버전·노드·엣지·코멘트·그룹 정리)한 뒤 아래 3세트를 새로 생성한다.

| 세트 | 내용 | 버전 수 | 특징 |
|------|------|--------|------|
| 구매 프로세스 | 4단계 드릴다운 + 평가 병렬 | 6 | 복잡 (계층 깊음) |
| 신규 입사자 온보딩 | 3단계 + 준비작업 병렬 | 5 | 중간 |
| 경비 정산 | 2단계, 대부분 직렬 | 4 | 단순 |

각 세트는 base 트리에 버전별 누적 델타(edit/drop/add)를 적용해 As-Is→To-Be 계보를 만든다. `source_node_id` 계보를 전파하므로 **버전 비교 화면에서 added/removed/changed가 실제로 표시**된다.

## 대상 DB

`settings.database_url`(env `DATABASE_URL`)을 그대로 사용한다.

- **로컬 네이티브**: 기본 무설정 sqlite 파일 `backend/dev.db` — 별도 설정 없이 바로 실행.
- **서버 / 로컬 Postgres**: `.env`의 `DATABASE_URL`을 Postgres로 교체하면 그 DB에 시드된다 (`.env.example` 참고).

스키마는 스크립트가 `init_models()`(startup `create_all`과 동일)로 보장하므로, 빈 DB에서도 테이블이 자동 생성된다.

## 실행

backend/ 에서 가상환경 활성화 후 실행한다. 의존성 설치는 `CLAUDE.md`의 Commands 참고.

```bash
# === bash (macOS/Linux) ===
cd backend
.venv/bin/python -m scripts.seed_dummy --reset            # 초기화 후 3세트 생성
.venv/bin/python -m scripts.seed_dummy --reset --verify   # 생성 + 인접 버전 diff 개수 출력
```

```powershell
# === PowerShell (Windows) ===
cd backend
.venv\Scripts\python -m scripts.seed_dummy --reset
.venv\Scripts\python -m scripts.seed_dummy --reset --verify
```

### 플래그

| 플래그 | 동작 |
|--------|------|
| (없음) | 기존 맵이 있으면 `abort` 출력 후 중단 (데이터 보존). 빈 DB면 3세트 생성. |
| `--reset` | 기존 맵 전체 삭제 후 3세트 재생성 = **DB 초기화**. |
| `--verify` | 시드 후 세트별 인접 버전 diff(추가/삭제/변경) 개수를 출력해 계보가 제대로 잡혔는지 확인. |

> ⚠️ `--reset` 은 해당 DB의 **모든 맵을 삭제**한다. 운영 데이터가 있는 DB에는 실행하지 말 것.

## 검증

- 콘솔에 세트별 `seed ...` 요약과 (`--verify` 시) `verify 인접 버전 diff:` 블록이 출력되면 성공.
- 앱 실행 후(`npm run dev` + backend) 맵 목록에 3개가 보이고, 버전 비교 화면에서 변경 하이라이트가 표시되는지 확인.
