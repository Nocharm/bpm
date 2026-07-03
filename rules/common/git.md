# Git Conventions

```
type(scope): English summary — 한국어 요약

# Types: feat, fix, docs, refactor, test, chore, perf
# Scope: optional, module or feature name
```

- Commit messages explain **WHY**, not WHAT.
- **Write the description in both English and Korean** so it's easy to grasp at a glance (`type(scope): English summary — 한국어 요약`).
- One logical change per commit.
- Never amend published commits without explicit request.
- Never force-push to main/master.
- Prefer specific `git add <files>` over `git add .` or `git add -A`.

## Before Every Commit

커밋 직전 항상 다음 문서를 **코드 변경과 같은 커밋에** 함께 갱신한 뒤 스테이징·커밋한다:

- **`PROGRESS.md`** (저장소 루트의 진행 현황 로그 — 없으면 생성): 무엇을·왜 바꿨는지 한 줄 기록.
- **현재 검토 중인 체크리스트/트래커 md** (예: `SCREEN-REDESIGN-EDITOR.md` 같은 작업 단위 트래커): 내용 변경이나 완료 상태 변경이 있으면 해당 행·항목을 갱신한다(검증·시현·검토결과·커밋 열 등). 진행 중인 트래커가 없으면 생략.

즉 진행 로그와 트래커를 코드와 분리된 별도 커밋으로 미루지 말고 **한 커밋에 함께** 담는다.
