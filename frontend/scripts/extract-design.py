from pathlib import Path
from html.parser import HTMLParser
import json
import re

BASE = Path(__file__).resolve().parents[1]
DESIGN = BASE.parent / 'docs' / '디자인'

class Extractor(HTMLParser):
    def __init__(self, source, target):
        super().__init__(convert_charrefs=False)
        self.source = source
        self.lines = [0]
        for i, c in enumerate(source):
            if c == '\n': self.lines.append(i + 1)
        self.target = target
        self.stack = []
        self.removals = []
        self.start = None
        self.end = None
    def source_offset(self):
        line, col = self.getpos()
        return self.lines[line - 1] + col
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get('class', '').split()
        pos = self.source_offset()
        if self.target in classes and self.start is None: self.start = pos
        void = tag in ('area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr')
        if not void: self.stack.append((tag, pos, classes))
    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] != tag: continue
            _, pos, classes = self.stack[i]
            end = self.source.find('>', self.source_offset()) + 1
            if tag == 'script' or 'status' in classes or 'home-ind' in classes: self.removals.append((pos, end))
            if self.target in classes and self.start == pos: self.end = end
            self.stack = self.stack[:i]
            break
    def result(self):
        if self.start is None or self.end is None: raise RuntimeError('Service frame missing')
        source = self.source[self.start:self.end]
        for start, end in sorted(self.removals, reverse=True):
            if self.start <= start and end <= self.end: source = source[:start-self.start] + source[end-self.start:]
        return source

templates = {}
svg_contents = []
for path in sorted(DESIGN.rglob('*.html')):
    if path.name == 'index.html': continue
    source = path.read_text()
    svg_contents.extend(re.findall(r'<svg\b[^>]*>(.*?)</svg>', source, re.S))
    mode = 'mobile' if '모바일' in path.parts else 'web'
    parser = Extractor(source, 'screen' if mode == 'mobile' else 'view')
    parser.feed(source)
    id = path.name.split('_')[0]
    templates[id] = {'id': id, 'mode': mode, 'role': 'teacher' if '교사' in path.parts else 'student', 'title': path.stem.split('_', 1)[1].replace('_',' '), 'html': parser.result(), 'source': str(path.relative_to(BASE.parent))}
(BASE / 'src').mkdir(exist_ok=True)
(BASE / 'src/design-templates.json').write_text(json.dumps(templates, ensure_ascii=False, separators=(',',':')))
(BASE / 'src/design.css').write_text((DESIGN / 'assets/style.css').read_text())
patterns = {'chevron':'M9.5 5.5', 'back':'M14.5 5.5', 'check':'M5 12.5', 'close':'M6.5 6.5', 'home':'M5 17c2.4', 'chart':'x="3.8" y="5"', 'user':'cx="12" cy="8.3"', 'users':'cx="9" cy="8.5"', 'bell':'M6.2 9.6', 'calendar':'x="3.8" y="5"', 'search':'cx="11" cy="11"', 'plus':'M12 5.5', 'minus':'M5.5 12h13', 'upload':'M12 15V4.5', 'download':'M12 4v10.5', 'lock':'x="5" y="10.2"', 'info':'M12 11v5.2', 'image':'x="3.8" y="4.8"', 'inbox':'M4 13.5 6.4', 'grid':'x="4" y="4" width="6.5"', 'more':'cx="5.5" cy="12"', 'logout':'M14 4.5H7.2', 'video':'x="3.5" y="6.5"', 'edit':'M14.6 5.6', 'refresh':'M19.2 12a7.2', 'history':'M4.8 12a7.2', 'flag':'M5.5 20.5V4.5', 'trophy':'M8 4.5h8v5.2', 'menu':'M4.5 7h15', 'walking':'M7.5 13.5c', 'stretch':'cx="12" cy="4.8"', 'rope':'M7 4v5', 'plank':'cx="18.5" cy="9"', 'squat':'cx="12.5" cy="4.5"', 'stairs':'M4 19.5h4.5', 'dumbbell':'translate(.35,-.25)', 'running':'cx="6" cy="18.5"', 'exercise':'M12 20.5c3.6'}
icons = {name:next(svg for svg in svg_contents if pattern in svg) for name,pattern in patterns.items()}
# The design source reuses the calendar glyph for charts; give chart its own bar glyph.
icons['chart'] = '<path d="M4.5 19.5h15"/><path d="M8 16v-5"/><path d="M12 16V7.5"/><path d="M16 16v-3"/>'
(BASE / 'src/design-icons.json').write_text(json.dumps(icons, ensure_ascii=False, separators=(',',':')))
print(f'Preserved {len(templates)} service templates and source design CSS.')
