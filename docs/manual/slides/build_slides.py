"""매뉴얼 슬라이드 덱 증분 수술 — 기존 덱을 슬라이드 단위로 파싱해 불릿·이미지 교체, 슬라이드 삽입, TOC 재계산, 날짜 치환.

Deck 클래스가 도구, 아래 user_*/admin_* 함수는 그 회차(5차, 2026-09-30)의 수술 목록이다. 다음 회차는 함수 본문을 새 델타로
갈아 끼우고 OLD_DATE/NEW_DATE를 옮긴다. in-place 빌드: 재실행 전 `git checkout -- docs/manual/slides/*.html` 필수.
실행(저장소 루트): python3 docs/manual/slides/build_slides.py [user_ko user_en admin_ko admin_en]
"""
import base64
import html as H
import re
import sys

ROOT = "/Users/hyeonjin/Documents/bpm"
DECKS = f"{ROOT}/docs/manual/slides"
SHOTS = f"{ROOT}/.shots/manual"  # frontend/scripts/pw-manual-shots.mjs + 스모크 캡처(PW_LANG) 산출물
OLD_DATE, NEW_DATE = "2026-09-19", "2026-09-30"


def bullet(html_text: str) -> str:
    return f'<div class="bullet anim"><span class="dot"></span><span>{html_text}</span></div>'


def data_uri(path: str) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(open(path, "rb").read()).decode()


class Deck:
    def __init__(self, name: str):
        self.path = f"{DECKS}/{name}.html"
        doc = open(self.path, encoding="utf-8").read()
        parts = re.split(r'(?=<section class="slide)', doc)
        self.head = parts[0]
        last = parts[-1]
        cut = last.rfind("</section>") + len("</section>")
        self.slides = parts[1:-1] + [last[:cut]]
        self.tail = last[cut:]
        self.inserts: list[tuple[int, str]] = []

    # ── 불릿 ──
    def bullets(self, i: int) -> list[str]:
        return re.findall(r'<div class="bullet anim">.*?</span></div>', self.slides[i], re.S)

    def set_bullets(self, i: int, items: list[str]) -> None:
        old = self.bullets(i)
        assert old, i
        s = self.slides[i]
        start = s.index(old[0])
        end = s.index(old[-1]) + len(old[-1])
        self.slides[i] = s[:start] + "".join(bullet(x) for x in items) + s[end:]

    def replace_bullet(self, i: int, n: int, text: str) -> None:
        old = self.bullets(i)
        self.slides[i] = self.slides[i].replace(old[n], bullet(text), 1)

    def append_bullet(self, i: int, text: str) -> None:
        old = self.bullets(i)
        self.slides[i] = self.slides[i].replace(old[-1], old[-1] + bullet(text), 1)

    def remove_bullet(self, i: int, n: int) -> None:
        old = self.bullets(i)
        self.slides[i] = self.slides[i].replace(old[n], "", 1)

    # ── 이미지·제목 ──
    def set_image(self, i: int, shot: str) -> None:
        s, n = re.subn(r'(<img class="shot" src=")data:image/[^"]+(")', lambda m: m.group(1) + data_uri(shot) + m.group(2), self.slides[i])
        assert n == 1, (i, n)
        self.slides[i] = s

    def set_title(self, i: int, title: str) -> None:
        s, n = re.subn(r'(<h2 class="title">).*?(</h2>)', lambda m: m.group(1) + H.escape(title, quote=False) + m.group(2), self.slides[i], flags=re.S)
        assert n == 1
        self.slides[i] = s

    def set_section_desc(self, i: int, desc: str) -> None:
        s, n = re.subn(r'(<div class="desc anim">).*?(</div>)', lambda m: m.group(1) + desc + m.group(2), self.slides[i], flags=re.S)
        assert n == 1
        self.slides[i] = s

    def kicker(self, i: int) -> str:
        return re.search(r'<div class="kicker">.*?</div>', self.slides[i], re.S).group(0)

    # ── 삽입(내림차순 마지막 적용) ──
    def insert_image_slide(self, after: int, title: str, items: list[str], shot: str) -> None:
        html = (
            f'<section class="slide">{self.kicker(after)}\n'
            f'    <h2 class="title">{H.escape(title, quote=False)}</h2><div class="body"><div class="col-text">'
            + "".join(bullet(x) for x in items)
            + '</div>\n       <div class="col-img anim"><div><img class="shot" src="'
            + data_uri(shot)
            + '" alt=""></div></div></div></section>'
        )
        self.inserts.append((after, html))

    def finish(self) -> None:
        for after, html in sorted(self.inserts, key=lambda x: -x[0]):
            self.slides.insert(after + 1, html)
        # TOC data-goto = 섹션 슬라이드 0-based 인덱스(순서대로)
        sections = [i for i, s in enumerate(self.slides) if s.startswith('<section class="slide section"')]
        toc_slide = next(i for i, s in enumerate(self.slides) if 'class="toc"' in s)
        gotos = re.findall(r'data-goto="(\d+)"', self.slides[toc_slide])
        assert len(gotos) == len(sections), (len(gotos), len(sections))
        it = iter(sections)
        self.slides[toc_slide] = re.sub(r'data-goto="\d+"', lambda m: f'data-goto="{next(it)}"', self.slides[toc_slide])
        doc = self.head + "".join(self.slides) + self.tail
        n = doc.count(OLD_DATE)
        assert n == 3, n
        doc = doc.replace(OLD_DATE, NEW_DATE)
        open(self.path, "w", encoding="utf-8").write(doc)
        print(self.path.split("/")[-1], len(self.slides), "slides")


# ───────────────────────────── 사용자 덱 ─────────────────────────────
def user_ko() -> None:
    d = Deck("bpm-manual-user-ko")
    d.replace_bullet(7, 0, "좌측 조직도 트리로 부서별 탐색 — 나의 부서는 맨 위 고정. 부서 아래 그 부서가 <strong>관리 부서</strong>인 연계 캔버스는 <strong>L5 캔버스</strong> 그룹으로 따로. 오우닝 부서가 없는 맵은 부서 미지정 그룹.")
    d.replace_bullet(7, 1, "검색(/)과 <strong>두 줄 필터</strong> — 윗줄은 전체/공개/비공개·<strong>정렬</strong>(최근 수정·이름·최근 생성)·해제, 아랫줄은 Status·Role·Issues·<strong>Type</strong>(SP/비SP/L5 캔버스/체계 등록·미등록) 드롭다운, 각각 이 필터 지우기.")
    d.set_image(7, f"{SHOTS}/ko/home-filters.jpg")
    d.replace_bullet(8, 3, "섹션은 몇 건만 보이고 나머지는 <strong>\"N건 더\"</strong> 링크로. 같은 맵이 여러 섹션에 있으면 0.5초 머문 호버에 다른 섹션의 같은 행 <strong>왼쪽 액센트 바</strong>(벗어나면 즉시 소거).")
    d.set_image(8, f"{SHOTS}/ko/home-linked-hover.jpg")
    d.replace_bullet(16, 1, "좌측 — 아웃라인 트리와 단축키 카드. 우측 — 인스펙터(속성/맵/승인/활동 탭). 노드 표시 항목은 Map 탭 <strong>Node display</strong> 또는 캔버스 우하단 줌 필 옆 <strong>눈 아이콘</strong> 카드에서 토글(세 곳이 같은 값).")
    d.replace_bullet(21, 3, "<code>]</code>/<code>[</code> — 선택 노드에서 흐름 하이라이트를 늘리고 줄입니다(들어오는 선 청록·나가는 선 주황). 선택한 연결선은 보라색, <strong>라벨 알약도 선과 같은 색</strong>으로 함께 강조.")
    d.set_image(21, f"{SHOTS}/ko/editor-flow-highlight.jpg")
    d.replace_bullet(41, 0, "① 승인 요청 — 결재자 명단 확인, 코멘트(선택). AI 서버에서는 <strong>AI 초안</strong> 버튼이 최신 게시본 대비 변경 사유를 2~4줄로 써 줍니다(결재자 AI 요약의 근거). 직전 반려 사유 배너 표시.")
    d.append_bullet(46, "첫 화면은 <strong>기준 = 게시본</strong>, 대상 = 그 밖의 최신 버전. 우측 패널은 왼쪽 경계 드래그(240~520px), 줌 필 옆 <strong>눈 아이콘</strong>으로 비교 캔버스의 노드 표시 항목 선택.")
    d.set_image(46, f"{SHOTS}/ko/compare-display-card.jpg")
    d.set_bullets(49, [
        "세 번째 탭 <strong>AI 요약</strong>(AI 활성 서버) — 탭을 여는 순간 결재자용 <strong>개조식 보고서</strong> 생성(탭 라벨 스피너).",
        "네 블록 — <strong>개정 요지</strong>(업무 의도별 절 + 관련 칩=캔버스 포커스) · <strong>흐름·통제 영향</strong> · <strong>제출 코멘트 대비 미언급 변경</strong> · <strong>결재 전 확인 질문</strong>.",
        "같은 내용은 서버가 보관 — 다른 결재자·새로고침 뒤엔 <strong>저장된 보고서</strong>로 즉시, 초안이 더 편집되면 자동 갱신. 제목 줄 <strong>다시 생성</strong>은 보관본을 버리고 새로 받음.",
        "주소 <code>?base=&amp;target=</code>로 특정 조합을 바로 열기 — 승인 탭의 게시본과 비교가 이 링크.",
        "아주 큰 차이는 노드·엣지 각 200개까지만 AI에 전달.",
    ])
    d.set_image(49, f"{SHOTS}/ko/compare-ai-report.jpg")
    d.set_title(52, "내보내기 (PNG·Excel·CSV)")
    d.replace_bullet(52, 2, "CSV — 가져오기와 같은 21열 표, 고쳐서 다시 가져오는 왕복 가능(Other 시스템은 원문 메모가 System 셀에).")
    d.remove_bullet(52, 3)
    d.set_image(52, f"{SHOTS}/ko/editor-export.jpg")
    d.replace_bullet(56, 4, "검색하면 결과가 <strong>L5 분류별 그룹</strong>(머리 클릭=드릴다운, 미등록은 점선 그룹). 맵 상세에서는 <strong>선택된 맵 스트립</strong>의 L5로 돌아가기. 현재 위치는 새로고침·검색 복귀 후에도 유지.")
    d.insert_image_slide(59, "연계 캔버스의 맵 설정 — 편집 가능자", [
        "연계 캔버스(L5)의 맵 설정은 <strong>상세 · 편집 가능자 · 공개 범위 · 승인 대기 · 체크아웃 요청 · 위험 구역</strong>만 — 협업자·결재자·버전·서브프로세스 지정 탭은 없습니다.",
        "<strong>편집 가능자</strong> 탭(읽기 전용) — 연결된 카테고리 경로, 관리 부서, 카테고리 체인의 관리자 명단. 직속 L5 관리자에게는 <strong>확정 가능</strong> 표시.",
        "편집권을 바꾸려면 설정 → Framework에서 카테고리 관리자·관리 부서를 고칩니다.",
        "승인 대기 탭에는 이 캔버스의 확정 요청·슬롯 변경 요청이 모입니다.",
    ], f"{SHOTS}/ko/framework-settings-editors.jpg")
    d.finish()


def user_en() -> None:
    d = Deck("bpm-manual-user-en")
    d.replace_bullet(7, 0, "Browse by department in the org tree — yours is pinned on top. Canvases managed by that department sit in an <strong>L5 canvases</strong> group; maps without one gather under Dept unassigned.")
    d.replace_bullet(7, 1, "Search (/) and <strong>two filter rows</strong> — All/Public/Private and <strong>Sort</strong> on top; Status · Role · Issues · <strong>Type</strong> (SP / non-SP / L5 canvases / in the framework or not) below.")
    d.replace_bullet(7, 2, "Click a card for the detail panel — owner, owning department, members, version history.")
    d.replace_bullet(7, 3, "Interview-imported maps without an owner carry an Owner unconfirmed pill until Transfer ownership.")
    d.replace_bullet(7, 4, "Panel bottom — read-only interview source notes and owner-managed Notes.")
    d.set_image(7, f"{SHOTS}/en/home-filters.jpg")
    d.replace_bullet(8, 3, "A few rows per section, the rest behind \"N more\". A map in several sections gets a <strong>left accent bar</strong> on its other rows after a half-second hover.")
    d.replace_bullet(8, 4, "Delayed one-click navigation — tiles, Open buttons and row clicks run after a 0.6 s countdown; a translucent layer shows the ring and destination — click it to cancel.")
    d.set_image(8, f"{SHOTS}/en/home-linked-hover.jpg")
    d.replace_bullet(16, 1, "Left — the outline tree and shortcut card. Right — the inspector (Properties / Map / Approval / Activity). Node display fields toggle in the Map tab's <strong>Node display</strong> or the <strong>eye icon</strong> card next to the zoom pill (both show the same values).")
    d.replace_bullet(21, 3, "<code>]</code>/<code>[</code> — grow or shrink the flow highlight from the selected node (incoming teal, outgoing orange). A selected connector turns violet, and the <strong>label pill takes the same color</strong> as its connector.")
    d.set_image(21, f"{SHOTS}/en/editor-flow-highlight.jpg")
    d.replace_bullet(41, 0, "① Request approval — check the approver list, add a comment (optional). On an AI-enabled server the <strong>AI draft</strong> button writes a 2–4 line change rationale against the latest published version (the approver's AI summary reads it). The last rejection reason shows as a banner.")
    d.append_bullet(46, "The first view opens with <strong>base = published</strong> and target = the newest other version. Drag the right panel's left edge (240–520 px); the <strong>eye icon</strong> next to the zoom pill picks the node display fields for the compare canvas.")
    d.set_image(46, f"{SHOTS}/en/compare-display-card.jpg")
    d.set_bullets(49, [
        "The third tab, <strong>AI summary</strong> (AI-enabled server) — opening it writes a <strong>bullet-style report for approvers</strong> (spinner on the tab label).",
        "Four blocks — <strong>Revision summary</strong> (sections per business intent, related chips focus the canvas) · <strong>Flow &amp; control impact</strong> · <strong>Changes not mentioned in the submission comment</strong> · <strong>Questions before approval</strong>.",
        "The server keeps the report — other approvers or a reload get the <strong>saved report</strong> at once; further draft edits regenerate it. <strong>Regenerate</strong> in the title row discards the saved copy.",
        "Open a specific pair via <code>?base=&amp;target=</code> — the Approval tab's Compare with published uses this link.",
        "Very large diffs send at most 200 nodes and 200 edges to the AI.",
    ])
    d.set_image(49, f"{SHOTS}/en/compare-ai-report.jpg")
    d.set_title(52, "Export (PNG · Excel · CSV)")
    d.replace_bullet(52, 2, "CSV — the same 21-column table as import; round-trip by editing and re-importing (Other systems carry the source note in the System cell).")
    d.remove_bullet(52, 3)
    d.set_image(52, f"{SHOTS}/en/editor-export.jpg")
    d.replace_bullet(56, 4, "Search results group <strong>by L5 category</strong> (click the header to drill in; unregistered maps in a dashed group). From a map's detail, the <strong>selected-map strip</strong> returns to the L5. Your position survives reloads and searches.")
    d.insert_image_slide(59, "Linkage canvas settings — Who can edit", [
        "A linkage canvas (L5) has only <strong>Details · Who can edit · Visibility · Pending approvals · Checkout requests · Danger zone</strong> — no Collaborators, Approvers, Versions or Subprocess designation tabs.",
        "<strong>Who can edit</strong> (read-only) — the linked category path, the managing department and the admins along the category chain; direct L5 admins carry a <strong>can confirm</strong> mark.",
        "To change who edits, adjust category admins or the managing department under Settings → Framework.",
        "Pending approvals collects this canvas's confirmation and slot-change requests.",
    ], f"{SHOTS}/en/framework-settings-editors.jpg")
    d.finish()


# ───────────────────────────── 관리자 덱 ─────────────────────────────
def admin_ko() -> None:
    d = Deck("bpm-manual-admin-ko")
    A = f"{SHOTS}/ko-admin"
    d.replace_bullet(10, 1, "지원 형식 pdf·docx·pptx·xlsx·txt·md, 파일당 최대 20MB. Upload로 추가, Refresh로 목록 갱신.")
    d.set_section_desc(19, "카테고리 트리와 레벨 위임, 권한자, 확정 거버넌스, 슬롯 변경, 현황판, 인터뷰 임포트, AI로 L5 채우기.")
    d.set_bullets(20, [
        "상단 토글로 관리(트리·권한자·임포트)와 현황(확정 현황판) 뷰. 화면은 <strong>왼쪽 트리 : 오른쪽 상세 패널</strong> — 행을 누르면 선택+펼침, 자식이 하나뿐인 사슬은 갈래까지 자동으로 이어 열림.",
        "하위 추가 · 이름변경 · 관리 부서 · 연계 권한자 · 이동 · 삭제 여섯 동작은 <strong>상세 패널 버튼</strong>에 모임 — 불가한 동작은 비활성+호버 이유. 최대 5단계, 맵 배정은 L5에만, 같은 부모 아래 같은 이름 불가(409).",
        "개명 시 연계 캔버스 이름 동기. 연결 맵·캔버스가 있는 서브트리는 삭제 거부(409). <strong>관리 부서</strong>는 비우면 상위 상속 — 연계 캔버스의 오우닝 부서가 되어 홈 조직도의 L5 캔버스 그룹에.",
        "위임 범위 — 권한자는 자기 분류 아래에서 하위 추가·개명·정렬. 위임받은 분류 자신은 이동·삭제 불가(하위만), 권한자 임명은 하위 레벨에만.",
        "L5에만 지정된 권한자는 캔버스 편집·확정만. 최상위 분류 생성과 인터뷰 임포트는 sysadmin 전용.",
    ])
    d.set_image(20, f"{A}/framework-admin-selected.jpg")
    d.replace_bullet(21, 0, "트리에서 행을 고른 뒤 상세 패널의 <strong>연계 권한자</strong> 버튼 — 사용자/그룹 지정. 추가·제거는 버퍼에 쌓였다가 확인 1회로 저장, 취소·Esc·바깥 클릭은 폐기.")
    d.replace_bullet(21, 2, "직접 지정된 권한자는 상세 패널 정보 줄의 <strong>관리자</strong> 항목(3명까지, 초과는 +N) — 이름은 언어 설정 기준 이중 표기.")
    d.replace_bullet(25, 0, "상세 패널 아래 <strong>인터뷰 JSON</strong> 섹션의 파일 선택(여러 개) → 전폭 스트립에 파일 필(×로 제외, 파싱 실패는 빨간 테두리) → <strong>Dry run</strong> → 리포트 → Apply — sysadmin 전용.")
    d.set_image(25, f"{A}/framework-import-section.jpg")
    d.replace_bullet(26, 3, "산출물=입력물 완전 일치는 IO 링크 자동 연결, 가로 자동 정렬, 게시 직후 편집용 draft 자동 생성. 한 활동의 입력물과 산출물이 같으면 값은 들어가되 <strong>경고 행</strong>(handoff 제외).")
    d.insert_image_slide(26, "AI로 L5 채우기 — 진입과 세션", [
        "문서 없이 AI와 대화로 L5 하나를 채웁니다(sysadmin 전용). 진입은 <strong>카테고리 관리 트리에서 행 선택</strong> — 상세 패널에 레벨별 <strong>타일 액션</strong>이 열립니다.",
        "L1~L3 — <strong>하위로 이동</strong> 타일(2열, 진행 중 n 배지). L4 — 이름 칸 + <strong>L5 만들고 AI로 시작</strong>(같은 이름은 거부). L5 — <strong>AI로 작업</strong>, 진행 중이면 <strong>AI 세션 이어서</strong>.",
        "세션은 DB에 저장 — 화면을 나가도 유지, 별도 목록 없이 그 L5 행에서 이어서. 보드 상단 일시정지/재개. 문서를 못 올리면 <strong>외부 AI 프롬프트 복사</strong>로 왕복(돌아온 JSON은 임포트).",
        "네 단계 — ① 계획 → ② 설문 → ③ 연결 → ④ 등록. 이미 등록된 L6가 있으면 <strong>기존</strong> 카드로 먼저 불러옵니다(기본 유지, 정정 전환 가능).",
    ], f"{A}/fw-consult-entry.jpg")
    d.insert_image_slide(26, "① 계획 — 카드·단계·외부 L6", [
        "브리프·첨부 → <strong>L6 카드 제안</strong>. 세 열: 목적·첨부 | 단계 행(위→아래 순서, 같은 행=동시) | 카드 상세(이름·요약·역할·부서·선행).",
        "타일 드래그로 행 이동·순서·새 단계(Alt+방향키). 선행은 타일 <strong>우클릭</strong>으로 직전 행 카드 체크 — 점선 곡선, 호버 시 이어진 타일 강조.",
        "<strong>외부 L6</strong> 탭 또는 보드 빈 곳 우클릭 → 외부 L6 추가 — 다른 L5의 L6를 외부 참조 타일로(소속 L5별 색·배지, 설문 없이 연결에만 참여). 새 카드 우클릭 → 외부 L6 목록 보기로 타일 전환.",
        "삭제는 <strong>삭제 예정</strong>(붉은 타일, 복구 가능)으로 남고 저장·잠금 때 빠짐. 기존 카드는 유지(점선·드래그 불가)/정정. <strong>잠금</strong>이면 카드마다 설문 준비 시작.",
    ], f"{A}/fw-consult-external-plan.jpg")
    d.insert_image_slide(26, "② 설문 — 절차의 애매한 지점 확정", [
        "카드마다 AI 설문(판단·예외·분기 → 활동 → 기본 정보 → 입출력). 값 채우기가 아니라 판단 주체·분기 조건·반려 복귀·병렬/순차·예외·시작·끝 경계를 확정 — 문항마다 근거 한 줄.",
        "객관식은 모두 답해야 제출. 주관식은 빈칸에서 시작 — <strong>[AI 제안]</strong>이 타이핑으로 채움, 빈칸 제출은 미답변. 단일 선택도 복수 답 전환, 문항 코멘트·제출 코멘트.",
        "지금 자세히 그릴 필요가 없으면 <strong>플레이스홀더(임시)로 생성</strong> — 설문·드로잉 건너뜀, 등록 전 AI로 다시 그리기. AI 실패 카드는 재시도 또는 플레이스홀더로 건너뛰기.",
        "제출 즉시 그 카드의 흐름이 백그라운드로 그려지고 다음 설문 준비. 보드 행은 상태와 무관하게 눌러 패널(미리보기·피드백 채팅).",
    ], f"{A}/fw-consult-answer-typing.jpg")
    d.insert_image_slide(26, "③ 연결 · ④ 등록", [
        "연결 단계에 들어서면 AI가 L6 사이 흐름을 즉시 제안 — 계획의 선행 쌍이 뼈대, 진입점은 첫 단계, 순서를 거스르는 연결은 loop.",
        "전폭 <strong>L5 연계 캔버스</strong> + 떠 있는 피드백 채팅(끌기·크기·최소화=스파클 칩). 노드 드래그·우클릭 분기 추가, 연결선 클릭 선택/더블클릭 라벨/우클릭 메뉴, 300ms 자동 저장.",
        "비분기 카드의 나가는 선은 하나 — 새 선을 끌면 기존 선이 붉은 점선, 확인 후 교체. 채팅 자연어 수정은 현재 배치 유지, <strong>다시 제안</strong>은 확인 후 처음부터.",
        "<strong>연결 확정</strong> → 등록: 인터뷰 임포트와 같은 화면, Dry run 자동 실행, 연결 단계로 돌아가기 가능. Apply 후 완료 카드(L5 캔버스 열기·JSON 다운로드) — 맵은 게시, 캔버스는 확정 전 draft.",
    ], f"{A}/fw-consult-relations.jpg")
    d.finish()


def admin_en() -> None:
    d = Deck("bpm-manual-admin-en")
    A = f"{SHOTS}/en-admin"
    d.replace_bullet(10, 1, "Supported: pdf · docx · pptx · xlsx · txt · md, up to 20 MB per file. Upload adds, Refresh reloads the list.")
    d.set_section_desc(19, "Category tree and level delegation, linkage admins, confirmation governance, slot changes, the status board, interview import, filling an L5 with AI.")
    d.set_bullets(20, [
        "Top toggle: Manage / Status. <strong>Tree left, detail panel right</strong> — a click selects and expands the row; single-child chains open through to the fork.",
        "Add child · Rename · Managing dept · Linkage admins · Move · Delete are <strong>detail-panel buttons</strong>; blocked ones stay disabled with a reason. Max 5 levels, maps on L5 only, no duplicate siblings (409).",
        "Renames sync the canvas name; subtrees with linked maps or a canvas can't be deleted (409). An empty <strong>managing department</strong> inherits from the parent.",
        "Delegation — admins add/rename/reorder under their own category, can't move or delete it (children only), appoint admins one level down.",
        "L5-only admins edit and confirm the canvas only. Top-level categories and interview import stay sysadmin-only.",
    ])
    d.set_image(20, f"{A}/framework-admin-selected.jpg")
    d.replace_bullet(21, 0, "Select a row, then the detail panel's <strong>Linkage admins</strong> button appoints users/groups. Adds/removes buffer until you confirm once; Cancel, Esc, or clicking outside discards.")
    d.replace_bullet(21, 2, "Directly appointed admins appear in the detail panel's info line under <strong>Admins</strong> (three names, then +N), dual-named per the language setting.")
    d.replace_bullet(25, 0, "Pick files (multi-select) in the <strong>Interview JSON</strong> section → file-pill strip → <strong>Dry run</strong> → report → Apply — sysadmin-only.")
    d.replace_bullet(25, 1, "Format — interview JSON 0.4 (<code>relations</code>) and 0.5 (<code>externalTasks</code>); 0.3 rejected. Error files skip whole; re-runs are idempotent.")
    d.replace_bullet(25, 4, "Owner assignment — an empty or unknown owner makes the importing sysadmin interim owner (Owner unconfirmed pill) until Transfer ownership.")
    d.replace_bullet(25, 3, "Governance changes (re-import) — differing owner, department, approvers or notes become rows with Keep ↩ / Replace ⇄ (notes show a −/+ diff).")
    d.replace_bullet(25, 2, "Two-column dry-run report — left: Summary, Needs review, External L6, Category admins, Governance changes; right: file cards → L5 canvas → maps. Many files: scrolling list with per-column scroll and a search/sort toolbar.")
    d.set_image(25, f"{A}/framework-import-section.jpg")
    d.replace_bullet(26, 3, "Exact output=input matches auto-link as IO links; nodes auto-lay out horizontally; an editable draft is created right after publish. An activity listing the same item as input and output still lands but gets a <strong>warning row</strong> (handoffs exempt).")
    d.insert_image_slide(26, "Filling an L5 with AI — entry & sessions", [
        "Fill one L5 by talking to the AI, no documents required (sysadmin-only). Entry is <strong>selecting a row in the category tree</strong> — the detail panel shows <strong>tile actions</strong> for that level.",
        "L1–L3 — <strong>Go down</strong> tiles (two columns, In progress n badge). L4 — a name field plus <strong>Create L5 and start with AI</strong> (duplicate names refused). L5 — <strong>Work with AI</strong>, or <strong>Resume AI session</strong> when one is running.",
        "Sessions live in the DB — leaving the screen keeps them; there is no separate list, resume from that L5 row. Pause/resume at the top of the board. Without uploads, <strong>Copy external AI prompt</strong> round-trips a JSON you import.",
        "Four steps — ① Plan → ② Questionnaire → ③ Connections → ④ Register. Already-registered L6 maps load first as <strong>Existing</strong> cards (Keep by default, switchable to Revise).",
    ], f"{A}/fw-consult-entry.jpg")
    d.insert_image_slide(26, "① Plan — cards, stages, external L6", [
        "Brief and attachments → <strong>Propose L6 cards</strong>. Three columns: purpose · attachments | stage rows (top-down order, one row in parallel) | card details (name, summary, role, department, predecessors).",
        "Drag tiles between rows, reorder, or open a new stage (Alt+arrows). Predecessors: <strong>right-click</strong> a tile and check cards of the previous row — dashed curves, and hovering highlights the linked tiles.",
        "The <strong>External L6</strong> tab, or right-click an empty spot → Add external L6, adds another L5's L6 as an external tile (colored per origin L5; no questionnaire, joins the connections only). Right-click a new card → Browse external L6 converts it in place.",
        "Removed cards stay as <strong>pending removal</strong> (red tile, restorable) and drop out on save or lock. Existing cards keep (dashed, not draggable) or revise. <strong>Lock</strong> starts questionnaire prep per card.",
    ], f"{A}/fw-consult-external-plan.jpg")
    d.insert_image_slide(26, "② Questionnaire — settling ambiguity", [
        "Each card gets an AI questionnaire (decisions · exceptions · branches → activities → basics → I/O) settling who decides, branch conditions, rejection returns, parallel vs sequential, exceptions, start/end — one-line reason per question.",
        "All choice questions are required. Free-text starts blank — <strong>[AI suggestion]</strong> types the proposal in; blank stays unanswered. Single-choice can take several answers; per-question and submission comments.",
        "No need for detail yet? <strong>Create as placeholder</strong> skips questionnaire and drawing (Draw again with AI before registration). Failed AI cards: Retry or Skip as placeholder.",
        "Submitting draws that card's flow in the background while the next questionnaire is prepared. Any board row opens its panel (preview · feedback chat) regardless of state.",
    ], f"{A}/fw-consult-answer-typing.jpg")
    d.insert_image_slide(26, "③ Connections · ④ Register", [
        "Entering Connections, the AI proposes the L6 flow at once — plan predecessors are the backbone, the entry point is a first-stage card, edges against the plan order become loops.",
        "A full-width <strong>L5 linkage canvas</strong> with a floating feedback chat (drag, resize, minimize to a sparkle chip). Drag nodes, right-click to add a branch; click a connector to select, double-click for its label, right-click for the menu; auto-save.",
        "A non-branch card has one outgoing connector — a new one marks the old in red dashes and replaces it after confirmation. Chat edits keep the layout; <strong>Propose again</strong> restarts after confirmation.",
        "<strong>Confirm connections</strong> → Register: the interview-import screen with an automatic Dry run; Back to connections stays available. After Apply, a completion card (open the L5 canvas · download JSON) — maps publish, the canvas stays draft.",
    ], f"{A}/fw-consult-relations.jpg")
    d.finish()


if __name__ == "__main__":
    which = sys.argv[1:] or ["user_ko", "user_en", "admin_ko", "admin_en"]
    for w in which:
        globals()[w]()
