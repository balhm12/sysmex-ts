# Sysmex TS Guide (모바일)

Sysmex 장비 Troubleshooting Guide. 휴대폰 홈 화면에 설치해 **인터넷 없이** 볼 수 있습니다.

- 근거: CRM 작업이력 + 부품이력 + Service Manual Ch.06
- 거래처(기관) 이름은 전부 `대학병원 A` 형태로 가려져 있습니다.
- 이 폴더는 **표시용 데이터만** 들어 있습니다. CRM 원본·매뉴얼 PDF는 없습니다.
- 데이터는 **비밀번호로 잠겨 있습니다**(AES-256-GCM). 파일을 받아도 읽을 수 없습니다.

## 설치 (현장 엔지니어)

사내 공지로 받은 **설치안내**를 보세요. iPhone·Android 각각 30초면 됩니다.
(안내 문서는 비밀번호가 적혀 있어 이 저장소에 올리지 않습니다.)

## 배포 담당자

이 폴더의 **내용물**을 저장소 루트에 올립니다 (`deploy` 폴더째로 올리지 않습니다).
Settings → Pages → Source: `main` / `(root)`.

데이터를 갱신할 때는 `build_mobile.py` → **`encrypt_data.py`** → `make_deploy.py` 순으로
다시 만든 뒤 `data/` 와 `sw.js` 만 올립니다. **잠그는 단계를 빠뜨리면 평문이 올라갑니다.**
설치한 사람 화면에 **"새 데이터가 있습니다 → 받기"** 배너가 뜹니다.

`.nojekyll` 은 지우지 마세요. GitHub Pages 가 파일을 임의로 걸러내지 않게 합니다.
