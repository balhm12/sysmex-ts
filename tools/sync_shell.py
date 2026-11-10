# -*- coding: utf-8 -*-
"""app-src/ 를 배포본으로 옮기고 sw.js 의 껍데기 버전만 올린다. (CI 가 부른다)

    python tools/sync_shell.py            # 저장소 루트에서
    python tools/sync_shell.py --check    # 고치지 않고 무엇이 바뀔지만 본다

왜 목록을 손으로 안 적나
    껍데기 파일은 늘어난다 (실제로 js/stat.js 가 뒤에 생겼다).
    손으로 적어 두면 그 파일만 고친 날에 조용히 갱신이 안 나간다.
    **sw.js 가 들고 있는 SHELL 배열**이 곧 껍데기의 정의다 — 거기서 읽는다.

껍데기 버전을 따로 두는 이유
    build_mobile.py 가 만드는 sw.js 는 셸 캐시와 데이터 캐시가 같은 VERSION 에 묶여 있다.
    화면 한 줄 고치려고 VERSION 을 바꾸면 데이터 26MB 를 전원이 다시 받는다. 현장은 LTE 다.

        var VERSION       = '...';
        var SHELL_VERSION = '...-c8ecb6c';        ← 껍데기 해시 (이 스크립트가 넣는다)
        var SHELL_CACHE = 'ts-shell-' + SHELL_VERSION;   ← 이것만 끊긴다
        var DATA_CACHE  = 'ts-data-'  + VERSION;         ← 그대로

    sw.js 의 activate 는 이 둘이 아닌 캐시를 지운다. 껍데기만 새로 내려간다.

두 번 돌려도 안전하다. 다음 데이터 빌드가 sw.js 를 새로 만들면 SHELL_VERSION 이
사라지는데, 그때 이 스크립트가 다시 넣는다.
"""
import hashlib
import io
import json
import os
import re
import shutil
import sys

SRC = 'app-src'
RE_SHELL_ARR = re.compile(r'^var SHELL = (\[[^\]]*\]);', re.M)
RE_VER = re.compile(r"^var VERSION = '([^']*)';", re.M)
RE_SHV = re.compile(r"^var SHELL_VERSION = '([^']*)';\n", re.M)
RE_SHC = re.compile(r"^var SHELL_CACHE = 'ts-shell-' \+ (VERSION|SHELL_VERSION);", re.M)
FALLBACK = ['index.html', 'js/app.js', 'css/app.css', 'manifest.webmanifest']


def shell_list(sw):
    """sw.js 의 SHELL 배열 → 해시·복사 대상. 아이콘·폰트는 뺀다(바뀌면 이름이 바뀐다)."""
    m = RE_SHELL_ARR.search(sw)
    if not m:
        print('::warning::sw.js 에서 SHELL 배열을 못 찾아 기본 목록을 씁니다')
        return FALLBACK
    try:
        items = json.loads(m.group(1))
    except ValueError:
        print('::warning::SHELL 배열을 읽지 못해 기본 목록을 씁니다')
        return FALLBACK
    out = [str(i).lstrip('./') for i in items]
    out = [r for r in out if r and not r.startswith(('icons/', 'fonts/'))]
    return out or FALLBACK

SW_MARK = '/* shell-fresh */'
SW_INSTALL_OLD = "return c.addAll(SHELL.concat(DATA.slice(0, 2)));"
SW_INSTALL_NEW = (
    "/* shell-fresh */ return Promise.all(SHELL.map(function (u) {\n"
    "        return fetch(new Request(u, { cache: 'reload' })).then(function (r) {\n"
    "          if (!r.ok) throw new Error(u + ' ' + r.status);\n"
    "          return c.put(u, r);\n"
    "        });\n"
    "      })).then(function () { return c.addAll(DATA.slice(0, 2)); });")
SW_BG_OLD = "        fetch(e.request).then(function (res) {"
SW_BG_NEW = "        fetch(e.request, { cache: 'no-cache' }).then(function (res) {"


def harden_sw(sw):
    """서비스워커가 껍데기를 받을 때 브라우저의 임시 저장본(GitHub Pages 는 10분)을 쓰지 않게 한다.

    왜: 새 껍데기를 설치하면서 방금 전까지 쓰던 옛 app.js 를 임시 저장본에서 집어 와
        새 캐시에 넣으면, 서버는 새 것인데 휴대폰은 한참 옛 화면 그대로다.
    sw.js 는 build_mobile.py 가 만들어 매번 덮어쓴다 — 그래서 여기서 **다시 넣는다**
    (SHELL_VERSION 과 같은 방식). 두 번 돌려도 안전하다. 못 찾으면 경고만 하고 넘어간다.
    """
    if SW_MARK in sw:
        return sw, False
    if SW_INSTALL_OLD not in sw or SW_BG_OLD not in sw:
        print('::warning::sw.js 의 install/fetch 모양이 달라 캐시 우회를 못 넣었습니다 — '
              'build_mobile.py 의 sw.js 템플릿이 바뀌었는지 보십시오.')
        return sw, False
    return sw.replace(SW_INSTALL_OLD, SW_INSTALL_NEW, 1).replace(SW_BG_OLD, SW_BG_NEW, 1), True


def copy_shell(root, files, check):
    moved, missing = [], []
    for rel in files:
        s = os.path.join(root, SRC, rel)
        d = os.path.join(root, rel)
        if not os.path.exists(s):
            missing.append(rel)
            continue
        same = os.path.exists(d) and open(s, 'rb').read() == open(d, 'rb').read()
        if same:
            continue
        if not check:
            os.makedirs(os.path.dirname(d) or '.', exist_ok=True)
            shutil.copy2(s, d)
        moved.append(rel)
    return moved, missing


def shell_hash(root, files):
    h, used = hashlib.sha1(), []
    for rel in files:
        p = os.path.join(root, rel)
        if os.path.exists(p):
            h.update(rel.encode())        # 이름도 넣는다 — 파일이 사라져도 해시가 바뀌게
            h.update(open(p, 'rb').read())
            used.append(rel)
    if not used:
        sys.exit('껍데기 파일을 하나도 못 찾았습니다: ' + ', '.join(files))
    return h.hexdigest()[:6], used


def main():
    check = '--check' in sys.argv
    root = next((a for a in sys.argv[1:] if not a.startswith('--')), '.')
    swp = os.path.join(root, 'sw.js')
    if not os.path.exists(swp):
        sys.exit('sw.js 가 없습니다: ' + swp)
    if not os.path.isdir(os.path.join(root, SRC)):
        sys.exit(SRC + '/ 폴더가 없습니다 — 껍데기의 단일 기준입니다. 먼저 올리십시오.')
    sw = io.open(swp, encoding='utf-8').read()
    sw, hardened = harden_sw(sw)
    if hardened:
        print('sw.js 캐시 우회 ' + ('넣을 예정' if check else '넣음') + ' (껍데기를 받을 때 임시 저장본을 쓰지 않는다)')
    files = shell_list(sw)

    moved, missing = copy_shell(root, files, check)
    print('껍데기 ' + str(len(files)) + '개: ' + ', '.join(files))
    if missing:
        # app-src 에 없는 껍데기 파일 = 빌드가 만드는 것(예: 자동 생성 스크립트).
        # 배포본 쪽을 그대로 두고 해시에만 넣는다.
        print('app-src 에 없어 건드리지 않음: ' + ', '.join(missing))
    print(('바뀔 파일 ' if check else '옮긴 파일 ') + (', '.join(moved) if moved else '없음'))

    h, used = shell_hash(root, files)
    m = RE_VER.search(sw)
    if not m:
        sys.exit("sw.js 에서 \"var VERSION = '...';\" 줄을 못 찾았습니다 — 멈춥니다.")
    base = re.sub(r'-c[0-9a-f]{6}$', '', m.group(1))
    newv = base + '-c' + h

    cur = RE_SHV.search(sw)
    shc = RE_SHC.search(sw)
    if cur and cur.group(1) == newv and shc and shc.group(1) == 'SHELL_VERSION':
        print('SHELL_VERSION 이미 최신 — ' + newv)
        if hardened and not check:
            io.open(swp, 'w', encoding='utf-8', newline='\n').write(sw)
        return 0
    if check:
        print('SHELL_VERSION 바뀔 값 — ' + newv)
        return 0

    out = RE_SHV.sub('', sw)
    out = RE_VER.sub(lambda mm: mm.group(0) + "\nvar SHELL_VERSION = '" + newv + "';",
                     out, count=1)
    out, n = RE_SHC.subn("var SHELL_CACHE = 'ts-shell-' + SHELL_VERSION;", out, count=1)
    if n != 1:
        # 폴백 — 셸 캐시 줄을 못 고치면 VERSION 전체를 바꾼다(데이터도 다시 받는다).
        print('::warning::SHELL_CACHE 줄을 못 찾아 VERSION 전체를 바꿉니다 — '
              '데이터도 다시 받게 됩니다. sw.js 템플릿이 바뀌었는지 보십시오.')
        out = RE_VER.sub("var VERSION = '" + newv + "';", RE_SHV.sub('', sw), count=1)
    io.open(swp, 'w', encoding='utf-8', newline='\n').write(out)
    print('SHELL_VERSION = ' + newv + (' (껍데기만 갱신)' if n == 1 else ' (전체 갱신)'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
