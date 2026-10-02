"""매뉴얼 슬라이드 덱 빌더 — content/<deck>.py의 카피 + theme.css + 스크린샷으로 스탠드얼론 HTML을 다시 만든다.

이미지 출처: 슬라이드의 `shot`이 True면 **직전 빌드 덱(같은 경로)에서 같은 제목 슬라이드의 이미지를 이월**하고
(제목이 덱 안에서 유일할 때. 아니면 같은 순번), 문자열이면 `.shots/` 아래 파일을 새로 임베드한다(예: "manual6/home-dashboard.png").
제목으로 먼저 찾으므로 슬라이드를 끼우거나 빼도 뒤쪽 이미지가 밀리지 않는다(2026-10-02). 이월 슬라이드의 제목을 바꾸면
순번 폴백이 되니 그 회차엔 파일 경로로 지정한다. 폰트(Pretendard Variable)는 data URI로 임베드해 PDF·오프라인에서도 같은 렌더.

실행(저장소 루트):
  bash:        python3 docs/manual/slides/build_deck.py [user_ko user_en admin_ko admin_en]
  PowerShell:  python docs\\manual\\slides\\build_deck.py user_ko user_en admin_ko admin_en
이후 넘침 검사(frontend/): node scripts/check-deck-overflow.mjs ../docs/manual/slides/bpm-manual-*.html → export-pdf.mjs
"""
from __future__ import annotations

import base64
import html as H
import importlib
import re
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SHOTS = ROOT / ".shots"
FONT = ROOT / "frontend/public/fonts/PretendardVariable.woff2"
DECKS = ["user_ko", "user_en", "admin_ko", "admin_en"]

MARK_SVG = ('<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7">'
            '<rect x="3" y="3" width="7" height="6" rx="1.5"/><rect x="14" y="15" width="7" height="6" rx="1.5"/>'
            '<rect x="14" y="3" width="7" height="6" rx="3"/><path d="M10 6h4M17.5 9v6M10.5 18H14"/>'
            '<rect x="3" y="15" width="7" height="6" rx="1.5"/></svg>')
GLYPH_SVG = ('<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=".6">'
             '<rect x="3" y="3" width="7" height="6" rx="1.5"/><rect x="14" y="15" width="7" height="6" rx="1.5"/>'
             '<rect x="14" y="3" width="7" height="6" rx="3"/><path d="M10 6h4M17.5 9v6M10.5 18H14"/>'
             '<rect x="3" y="15" width="7" height="6" rx="1.5"/></svg>')

# 덱 내비게이션 — 키보드·가장자리 클릭·해시 동기. 인쇄(@media print)에서는 CSS가 전 슬라이드를 펼친다.
SCRIPT = """<script>
const slides=[...document.querySelectorAll('.slide')];
let cur=0, prevIdx=0;
const bar=document.getElementById('bar'), count=document.getElementById('count');
function show(i,back){
  i=Math.max(0,Math.min(slides.length-1,i));
  if(i===cur && slides[cur].classList.contains('active')) return;
  prevIdx=cur;
  slides.forEach((s,k)=>{ s.classList.remove('leave-back'); s.classList.toggle('active',k===i); });
  if(back){slides[i].classList.add('leave-back'); requestAnimationFrame(()=>requestAnimationFrame(()=>slides[i].classList.remove('leave-back')));}
  cur=i;
  bar.style.width=((cur+1)/slides.length*100)+'%';
  count.textContent=(cur+1)+' / '+slides.length;
  history.replaceState(null,'','#'+(cur+1));
}
function next(){show(cur+1,false)} function prev(){show(cur-1,true)}
addEventListener('keydown',e=>{
  if(['ArrowRight','ArrowDown','PageDown',' '].includes(e.key)){e.preventDefault();next();}
  else if(['ArrowLeft','ArrowUp','PageUp'].includes(e.key)){e.preventDefault();prev();}
  else if(e.key==='Home'){show(0,true)} else if(e.key==='End'){show(slides.length-1,false)}
});
document.querySelector('.zone.next').onclick=next;
document.querySelector('.zone.prev').onclick=prev;
document.getElementById('btn-next').onclick=next;
document.getElementById('btn-prev').onclick=prev;
document.querySelectorAll('[data-goto]').forEach(a=>a.onclick=e=>{e.preventDefault();show(+a.dataset.goto,false);});
function fit(){
  const s=Math.min(innerWidth/1320, innerHeight/770);
  document.getElementById('stage').style.transform='scale('+Math.min(s,1.6)+')';
}
addEventListener('resize',fit); fit();
function fromHash(){const h=parseInt(location.hash.slice(1)); show(isNaN(h)?0:h-1,false);}
addEventListener('hashchange',fromHash); fromHash();
</script>"""


def load_content(name: str) -> dict:
    sys.path.insert(0, str(HERE))
    return importlib.import_module(f"content.{name}").DECK


def read_data_uri(path: Path, mime: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def harvest_previous_images(out_path: Path) -> tuple[list[str | None], dict[str, str]]:
    """직전 빌드 덱의 슬라이드별 이미지 data URI(없으면 None)와 제목→이미지(덱 안에서 유일한 제목만) — 이월의 소스."""
    if not out_path.exists():
        return [], {}
    doc = out_path.read_text(encoding="utf-8")
    sections = re.findall(r"<section[^>]*>.*?</section>", doc, re.S)
    out: list[str | None] = []
    titled: dict[str, list[str]] = {}
    for sec in sections:
        m = re.search(r'<img class="shot" src="(data:[^"]+)"', sec)
        out.append(m.group(1) if m else None)
        t = re.search(r'<h2 class="title">(.*?)</h2>', sec, re.S)
        if m and t:
            titled.setdefault(t.group(1), []).append(m.group(1))  # 빌더가 제목을 원문 그대로 넣으므로 원문 비교
    by_title = {title: images[0] for title, images in titled.items() if len(images) == 1}
    return out, by_title


def resolve_shot(
    spec: object, slide_index: int, title: str, previous: tuple[list[str | None], dict[str, str]], deck_name: str
) -> str:
    if isinstance(spec, str):
        path = SHOTS / spec
        if not path.exists():
            raise SystemExit(f"{deck_name}: slide {slide_index} shot file missing: {path}")
        mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
        return read_data_uri(path, mime)
    by_index, by_title = previous
    carried = by_title.get(title) or (by_index[slide_index] if slide_index < len(by_index) else None)
    if carried is None:
        raise SystemExit(f"{deck_name}: slide {slide_index} expects a carried-over image but the previous deck has none there")
    return carried


def render_points(pts: list[tuple[str, str]]) -> str:
    return "".join(
        f'<div class="pt anim"><span class="lead">{lead}</span><span class="desc">{desc}</span></div>' for lead, desc in pts
    )


def render_foot(label: str, page: int, total: int) -> str:
    return f'<div class="foot"><span>{label}</span><span class="pg"><b>{page:02d}</b> / {total}</span></div>'


def build(name: str) -> None:
    deck = load_content(name)
    out_path = HERE / f"{deck['name']}.html"
    previous = harvest_previous_images(out_path)
    label = f"{deck['label']} · {deck['date']}"
    chapters = deck["chapters"]

    # 슬라이드 순서 계산(표지 · 목차 · [챕터 구분 + 본문…]… · 마무리)
    plan: list[tuple[str, Any]] = [("cover", None), ("toc", None)]
    for ci, ch in enumerate(chapters):
        plan.append(("section", ci))
        for sl in ch["slides"]:
            plan.append(("slide", (ci, sl)))
    plan.append(("closing", None))
    total = len(plan)
    section_index = {ci: i for i, (kind, ci) in enumerate(plan) if kind == "section"}

    slides: list[str] = []
    for i, (kind, payload) in enumerate(plan):
        page = i + 1
        foot = render_foot(label, page, total)
        if kind == "cover":
            c = deck["cover"]
            meta = "<i></i>".join(f"<span>{m}</span>" for m in c["meta"])
            slides.append(
                f'<section class="slide cover">{GLYPH_SVG}<div class="mark anim">{MARK_SVG}</div>'
                f'<div class="eyebrow anim">{c["eyebrow"]}</div><h1 class="anim">{c["h1"]}</h1>'
                f'<div class="sub anim">{c["sub"]}</div><div class="meta anim">{meta}</div>'
                f'<div class="hint">{c["hint"]}</div>{foot}</section>'
            )
        elif kind == "toc":
            t = deck["toc"]
            items = []
            for ci, ch in enumerate(chapters):
                start = section_index[ci] + 1
                end = start + len(ch["slides"])
                items.append(
                    f'<a href="#" data-goto="{section_index[ci]}"><span class="n">{ci + 1:02d}</span>'
                    f'<span>{ch["title"]}</span><span class="pages">{start}–{end}</span></a>'
                )
            slides.append(
                f'<section class="slide"><div class="kicker"><span class="ch">{t["kicker"]}</span><span class="rule"></span>'
                f'<span class="sec">{t["sec"]}</span></div><h2 class="title">{t["title"]}</h2>'
                f'<div class="toc">{"".join(items)}</div>{foot}</section>'
            )
        elif kind == "section":
            ci = payload
            ch = chapters[ci]
            slides.append(
                f'<section class="slide section"><div class="chip">{deck["chapter_word"]} {ci + 1:02d} / {len(chapters)}</div>'
                f'<div class="no anim">{ci + 1:02d}</div><h2 class="anim">{ch["title"]}</h2>'
                f'<div class="desc anim">{ch["desc"]}</div>{foot}</section>'
            )
        elif kind == "closing":
            c = deck["closing"]
            slides.append(
                f'<section class="slide cover">{GLYPH_SVG}<h1 class="anim">{c["h1"]}</h1>'
                f'<div class="sub anim">{c["sub"]}</div>{foot}</section>'
            )
        else:
            ci, sl = payload
            ch = chapters[ci]
            kicker = (f'<div class="kicker"><span class="ch">{ci + 1:02d}</span><span class="rule"></span>'
                      f'<span class="sec">{ch["short"]}</span></div>')
            head = f'{kicker}<h2 class="title">{sl["title"]}</h2>'
            if "table" in sl:
                note = f'<div class="note anim">{sl["note"]}</div>' if sl.get("note") else ""
                body = f'<div class="anim">{sl["table"]}</div>{note}'
            elif sl.get("shot"):
                src = resolve_shot(sl["shot"], i, sl["title"], previous, deck["name"])
                caption = f'<div class="caption">{sl["caption"]}</div>' if sl.get("caption") else ""
                body = (f'<div class="body"><div class="col-text">{render_points(sl["pts"])}</div>'
                        f'<div class="col-img anim"><div class="frame"><div class="bar"><i></i><i></i><i></i></div>'
                        f'<img class="shot" src="{src}" alt="">{caption}</div></div></div>')
            else:
                body = f'<div class="body no-img"><div class="col-text">{render_points(sl["pts"])}</div></div>'
            slides.append(f'<section class="slide">{head}{body}{foot}</section>')

    css = (HERE / "theme.css").read_text(encoding="utf-8").replace("__FONT__", read_data_uri(FONT, "font/woff2"))
    doc = (
        f'<!doctype html>\n<html lang="{deck["lang"]}"><head><meta charset="utf-8">\n'
        f'<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        f"<title>{H.escape(deck['html_title'])}</title>\n<style>{css}</style>\n</head>\n<body>\n"
        f'<div id="bar"></div>\n<div id="viewport"><div id="stage">\n' + "\n".join(slides) + "\n</div></div>\n"
        f'<div class="zone prev" title="Previous"></div><div class="zone next" title="Next"></div>\n'
        f'<div id="hud"><button id="btn-prev" aria-label="Previous">‹</button><span id="count"></span>'
        f'<button id="btn-next" aria-label="Next">›</button></div>\n{SCRIPT}\n</body></html>\n'
    )
    out_path.write_text(doc, encoding="utf-8")
    images = sum(1 for kind, p in plan if kind == "slide" and p[1].get("shot"))
    print(f"{out_path.name}: {total} slides, {images} images")


if __name__ == "__main__":
    for deck_name in sys.argv[1:] or DECKS:
        build(deck_name)
