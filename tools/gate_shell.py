# -*- coding: utf-8 -*-
"""앱 껍데기에 개인정보가 섞였는지 본다 — 공개 저장소로 나가기 전 마지막 문.

make_deploy.py 의 실명 대조를 **대신하지 못한다**. 그건 CRM 원본의 거래처 이름 표와
대조하는 것이고, 그 표는 공개 저장소에 없다. 여기서 보는 것은 다른 위험이다:

    앱 껍데기는 코드다. 실명이 들어갈 길은 '실수로 붙여넣기' 뿐이다.
    그래서 목록 없이도 되는 보수적인 그물을 친다 — 기관 성격 낱말, 전화번호,
    직급이 붙은 사람 이름. 지금 app-src 에는 이 중 하나도 없다(확인 2026-11-10).

하나라도 걸리면 배포하지 않는다.
"""
import io
import os
import re
import sys

INST = re.compile(r'[가-힣]{2,10}?(대학교?병원|의료원|의료재단|보건지소|보건소|검진센터|'
                  r'암센터|혈액원|병원|의원|클리닉|건협)')
PHONE = re.compile(r'0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}')
PERSON = re.compile(r'[가-힣]{2,4}\s*(과장|사원|대리|부장|차장|팀장|기사)(?![가-힣])')
# 비밀번호가 코드에 박히는 일도 막는다 (설치안내.md 가 공개로 읽힌 사고가 있었다)
SECRET = re.compile(r'(?i)(password|passwd|비밀번호)\s*[:=]\s*[\'"][^\'"]{4,}[\'"]')

TARGETS = ['index.html', 'js/app.js', 'css/app.css', 'manifest.webmanifest']


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else 'app-src'
    bad = []
    for rel in TARGETS:
        p = os.path.join(root, rel)
        if not os.path.exists(p):
            continue
        for i, line in enumerate(io.open(p, encoding='utf-8'), 1):
            for name, rx in (('기관 이름', INST), ('전화번호', PHONE),
                             ('사람 이름', PERSON), ('비밀번호', SECRET)):
                m = rx.search(line)
                if m:
                    bad.append('%s:%d  %s  →  %s' % (rel, i, name, m.group(0)[:40]))
    if bad:
        print('중단 — 앱 껍데기에 나가면 안 되는 것이 있습니다:')
        for b in bad[:20]:
            print('  ' + b)
        return 1
    print('껍데기 점검 통과 — 기관 이름·전화번호·사람 이름·비밀번호 0건')
    return 0


if __name__ == '__main__':
    sys.exit(main())
