#!/bin/sh
# src/page.html 의 /*GEO*/ 자리에 부산 지도 데이터를, /*PHOTOS*/ 자리에 사진 목록을 넣어 index.html 을 만듭니다.
# 사진 파일은 images/ 폴더에 있어야 합니다 (index.html 과 같은 위치에 함께 올리세요).
cd "$(dirname "$0")"
[ -f src/photos.json ] || echo '{}' > src/photos.json
sed -e '/^\/\*GEO\*\/$/{' -e 'r src/busan.json' -e 'd' -e '}' \
    -e '/^\/\*PHOTOS\*\/$/{' -e 'r src/photos.json' -e 'd' -e '}' src/page.html > index.html
echo "index.html 생성 완료"
