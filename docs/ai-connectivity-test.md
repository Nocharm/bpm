# 사내 AI(vLLM) 접속 테스트

사내 로컬 PC에서 온프레미스 vLLM 서버(OpenAI 호환)에 접속 가능한지 확인하는 절차. BPM 백엔드가 이 서버를 프록시한다.

## 1. 환경 변수 설정 (`.env`)

vLLM 서버 값을 BPM 백엔드 설정(`AI_*`)에 매핑한다. `.env`는 git에 커밋하지 않는다(`.gitignore`로 제외됨). **토큰(API 키)은 절대 커밋 금지.**

| vLLM 참조 변수 | BPM 백엔드 `.env` | 값 |
|---|---|---|
| `LLM_API_URL` / `VLLM_BASE_URL` | `AI_BASE_URL` | `http://182.199.3.18:30120/v1` |
| `LLM_API_KEY` / `VLLM_API_KEY` | `AI_API_TOKEN` | (발급받은 키 — 팀 보관) |
| `VLLM_MODEL` | `AI_MODEL` | `/gpt-oss-120b` (기본 모델) |

`.env` 예시(루트 또는 `backend/`에서 로드):
```
AI_ENABLED=true
AI_BASE_URL=http://182.199.3.18:30120/v1
AI_API_TOKEN=<발급받은 키>
AI_MODEL=/gpt-oss-120b
AI_TIMEOUT_SECONDS=60
```

아래 테스트 명령은 이 값들을 셸 환경변수로 export했다고 가정한다.

```bash
# === bash (macOS/Linux) ===
export AI_BASE_URL=http://182.199.3.18:30120/v1
export AI_API_TOKEN=<발급받은 키>
export AI_MODEL=/gpt-oss-120b
```
```powershell
# === PowerShell (Windows) ===
$env:AI_BASE_URL = "http://182.199.3.18:30120/v1"
$env:AI_API_TOKEN = "<발급받은 키>"
$env:AI_MODEL = "/gpt-oss-120b"
```

## 2. 네트워크 도달성

서버 호스트/포트에 TCP로 닿는지 먼저 확인한다.

```bash
# === bash ===
curl -sS -o /dev/null -w "HTTP %{http_code}\n" --max-time 10 "$AI_BASE_URL/models" \
  -H "Authorization: Bearer $AI_API_TOKEN"
```
```powershell
# === PowerShell ===
# 포트 도달성
Test-NetConnection 182.199.3.18 -Port 30120
# HTTP 응답
curl.exe -sS -o NUL -w "HTTP %{http_code}`n" --max-time 10 "$env:AI_BASE_URL/models" -H "Authorization: Bearer $env:AI_API_TOKEN"
```
기대: `HTTP 200`. 연결 거부/타임아웃이면 방화벽·VPN·사내망 라우팅을 확인한다.

## 3. 모델 목록 조회 (`/v1/models`)

```bash
# === bash ===
curl -sS --max-time 15 "$AI_BASE_URL/models" \
  -H "Authorization: Bearer $AI_API_TOKEN"
```
```powershell
# === PowerShell ===
curl.exe -sS --max-time 15 "$env:AI_BASE_URL/models" -H "Authorization: Bearer $env:AI_API_TOKEN"
```
기대: `{"object":"list","data":[{"id":"/gpt-oss-120b",...}, ...]}`. 여기 나오는 `id`들이 프론트 "Model" 드롭다운에 그대로 표시된다(여러 모델이 있으면 모두 노출).

## 4. 채팅 완성 호출 (`/v1/chat/completions`)

```bash
# === bash ===
curl -sS --max-time 60 "$AI_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $AI_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$AI_MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"한 단어로 인사해줘\"}],\"max_tokens\":16}"
```
```powershell
# === PowerShell ===
$body = @{ model = $env:AI_MODEL; messages = @(@{ role = "user"; content = "한 단어로 인사해줘" }); max_tokens = 16 } | ConvertTo-Json -Depth 5
curl.exe -sS --max-time 60 "$env:AI_BASE_URL/chat/completions" -H "Authorization: Bearer $env:AI_API_TOKEN" -H "Content-Type: application/json" -d $body
```
기대: `{"choices":[{"message":{"role":"assistant","content":"..."}}], ...}`. `choices[0].message.content`에 응답 텍스트가 있으면 백엔드 어댑터(`app/ai_client.py`)가 그대로 파싱한다.

> 참고: BPM 백엔드는 JSON 응답을 강제하려고 `response_format={"type":"json_object"}`를 함께 보낸다. 서버가 이 옵션을 거부하면 `app/ai_client.py`에서 해당 키를 제거한다(프롬프트가 이미 JSON을 강제함).

## 5. 앱을 통한 확인 (백엔드 경유)

`.env`를 위처럼 설정하고 백엔드를 띄운 뒤:

```bash
# === bash (backend/ 에서) ===
.venv/bin/uvicorn app.main:app --reload --port 8000
# 다른 터미널에서 (로컬 인증 비활성이라 토큰 불필요)
curl -sS http://localhost:8000/api/ai/models
```
```powershell
# === PowerShell (backend\ 에서) ===
.venv\Scripts\uvicorn app.main:app --reload --port 8000
# 다른 창에서
curl.exe -sS http://localhost:8000/api/ai/models
```
기대: `{"models":["/gpt-oss-120b", ...]}`. 프론트(`npm run dev`)를 띄우면 AI 채팅 패널 상단에 이 모델들이 드롭다운으로 뜬다. `AI_ENABLED=false`면 `/api/ai/models`는 503이고 패널 토글 자체가 숨겨진다.

## 6. 문제 해결

| 증상 | 점검 |
|---|---|
| 연결 거부/타임아웃 | 사내망/VPN 접속, 방화벽, `182.199.3.18:30120` 포트 개방 |
| `401 Unauthorized` | `AI_API_TOKEN` 값(키) 확인 |
| `404 /models` | `AI_BASE_URL` 끝이 `/v1`인지 확인 |
| `model not found` | `/v1/models`에 나온 정확한 `id`를 `AI_MODEL`로 사용 |
| 백엔드 `/api/ai/models` 503 | `.env`의 `AI_ENABLED=true` 확인 후 백엔드 재시작 |
