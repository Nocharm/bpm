"""매뉴얼 슬라이드 덱 증분 수술 — 기존 덱을 슬라이드 단위로 파싱해 불릿·이미지 교체, 슬라이드 삽입, TOC 재계산, 날짜 치환.

Deck 클래스가 도구, 아래 user_*/admin_* 함수는 그 회차(6차 전수 검사 재촬영, 2026-09-30)의 수술 목록이다. 다음 회차는 함수 본문을 새 델타로
갈아 끼우고 OLD_DATE/NEW_DATE를 옮긴다. in-place 빌드: 재실행 전 `git checkout -- docs/manual/slides/*.html` 필수.
실행(저장소 루트): python3 docs/manual/slides/build_slides.py [user_ko user_en admin_ko admin_en]
"""
import base64
import html as H
import re
import sys

ROOT = "/Users/hyeonjin/Documents/bpm"
DECKS = f"{ROOT}/docs/manual/slides"
SHOTS = f"{ROOT}/.shots/manual6"  # frontend/scripts/pw-manual-shots.mjs + 스모크 캡처(PW_LANG) 산출물
OLD_DATE, NEW_DATE = "2026-09-30", "2026-09-30"


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


# ───────────────────────────── 6차: 전수 검사 재촬영(이미지만 교체) ─────────────────────────────
USER_SHOTS = {
    4: "home-overview", 9: "home-slot-modal", 10: "home-detail-person", 25: "editor-node-props",
    31: "editor-library-filter", 32: "editor-peek-node", 33: "editor-peek-details", 34: "editor-expand",
    36: "editor-library-unregistered", 46: "compare-display-card", 48: "compare-summary", 53: "editor-ai-chat",
    58: "l5-canvas", 61: "l5-picker", 62: "l5-approval", 63: "l5-placeholder-connect", 64: "l5-stale-link",
    65: "l5-explorer", 69: "home-feedback",
}
ADMIN_SHOTS = {
    6: "admin-rail", 10: "admin-kb", 21: "admin-linkage-admins", 22: "l5-approval", 23: "home-slot-modal",
    24: "admin-status", 33: "admin-batch", 41: "admin-dashboard",
}


def _reshoot(deck_name: str, lang: str, mapping: dict[int, str]) -> None:
    d = Deck(deck_name)
    for i, shot in mapping.items():
        d.set_image(i, f"{SHOTS}/{lang}/{shot}.jpg")
    d.finish()


def user_ko() -> None:
    _reshoot("bpm-manual-user-ko", "ko", USER_SHOTS)


def user_en() -> None:
    _reshoot("bpm-manual-user-en", "en", USER_SHOTS)


def admin_ko() -> None:
    _reshoot("bpm-manual-admin-ko", "ko", ADMIN_SHOTS)


def admin_en() -> None:
    _reshoot("bpm-manual-admin-en", "en", ADMIN_SHOTS)


if __name__ == "__main__":
    which = sys.argv[1:] or ["user_ko", "user_en", "admin_ko", "admin_en"]
    for w in which:
        globals()[w]()
