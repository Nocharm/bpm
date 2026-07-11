# AI 실모델 스모크 체크리스트

지금까지의 AI 기능 검증(그래프 병합·담당자 금지·start/end 폴백·사용량 계측·매뉴얼 선별)은 전부 **mock 기반**이었다. 이 절차는 실제 모델을 붙여 "모델이 우리 프롬프트 계약을 따르는가"를 확인한다. **vLLM 서버에 닿는 위치(사내망 Windows PC 또는 71번 서버)에서 실행**한다.

> 로컬(사내망 밖)에서는 공개 **OpenAI 호환 API 키로 대체 가능** — OpenAI(`https://api.openai.com/v1`, `gpt-4o-mini` 등) 또는 Groq(`https://api.groq.com/openai/v1`). 같은 `AI_*` 변수에 값만 교체하면 된다(`docs/ai-connectivity-test.md` §1 참고). **Claude(Anthropic) API 키는 네이티브 API가 OpenAI 호환이 아니라 그대로는 사용 불가** — 붙이려면 `app/ai_client.py`(교체 가능 경계) 어댑터 작업이 필요하므로 스모크에는 OpenAI 계열을 권장.

## 0. 사전 연결 확인 (1분)

`docs/ai-connectivity-test.md`의 3종 curl — 도달성·모델 목록·completion(`response_format: json_object` 수용 여부)이 전부 OK인지. 여기서 실패하면 아래는 의미 없다.

## 1. 환경 설정 + 기동

`backend/.env`에 AI 설정 추가(실서버 값은 connectivity-test 문서 참고, **토큰 커밋 금지**):

```
AI_ENABLED=true
AI_BASE_URL=http://<vLLM 주소>/v1
AI_API_TOKEN=<토큰>
AI_MODEL=/gpt-oss-120b
```

```bash
# === bash (macOS/Linux) — backend/에서 ===
.venv/bin/python -m scripts.reset_db      # 데모 시드 (선택 — 깨끗한 상태에서 시작)
.venv/bin/uvicorn app.main:app --port 8000
# frontend/에서
npm run dev
```

```powershell
# === PowerShell (Windows) — backend\에서 ===
.venv\Scripts\python -m scripts.reset_db
.venv\Scripts\uvicorn app.main:app --port 8000
# frontend\에서
npm run dev
```

> `--reload` 금지 — `.env` 재로드가 안 된다. 이미 켜져 있었다면 완전 재기동.

## 2. 시나리오 체크리스트 (에디터에서 수동, ~20분)

| # | 시나리오 | 하는 것 | 통과 기준 |
|---|---------|---------|----------|
| **S1 병합 매칭** ★핵심 | 노드 6개+ 있는 데모 맵에서 AI 챗에 "이 프로세스를 다듬어줘(폴리싱)" | Import 탭 인트로의 **matched 수가 대부분**(기존 노드 수 근접), added는 소수. 매칭 0에 전부 added면 모델이 제목을 바꿔 에코하는 것 — 실패 |
| S2 비교모드 | S1에서 Apply → 버전 비교 화면 | 변경/추가된 노드만 diff 표시(전부 추가/삭제로 도배되면 실패) |
| S3 서브프로세스 | 서브프로세스 노드 있는 맵(데모 맵 2)에서 S1 반복 | Apply 후 서브프로세스가 **바이올렛 유지·링크 유지**, 소멸 목록에 없음 |
| S4 담당자 기본 금지 | "각 단계 설명을 보강해줘" | 기존 담당자/부서 값 유지, 새 노드도 빈값 — AI가 이름을 지어내지 않음 |
| S5 담당자 명시 요청 | "견적 검토 담당자를 ○○로 바꿔줘" | 이 경우엔 반영됨(ops set_attr) |
| S6 start/end | S1의 Import 탭에서 소멸 목록 확인 | Start/End가 소멸 목록에 **없음**(모델이 빼먹어도 폴백이 유지시킴 — 유지되면 통과) |
| S7 사용량 계측 | 위 호출들 후 설정 > Analytics > Dashboard | AI usage에 호출 수·**토큰이 0이 아닌 실값**으로 집계(토큰이 비면 vLLM이 usage 미반환 — 버전 확인 필요) |
| S8 answer 품질 | "승인 워크플로우는 어떻게 써?" | 매뉴얼 근거 답변 + 섹션 인용("3. 승인 워크플로우" 형식) |

## 3. 판정 → 후속 매핑

- **S1 매칭 실패가 잦으면** → 프롬프트에 "기존 노드를 다시 포함할 때 제목을 한 글자도 바꾸지 말고 그대로 에코" 규칙 추가(`ai_prompt.py` 규칙 1줄 — 기록된 백로그).
- **S6에서 start/end가 자주 빠지면** → "start/end를 항상 포함" 규칙 추가(같은 백로그).
- **S7 토큰 미집계** → vLLM 응답에 `usage` 필드가 있는지 원시 curl로 확인.
- 각 시나리오는 모델 비결정성이 있으니 **2-3회 반복**해서 경향으로 판단한다.
