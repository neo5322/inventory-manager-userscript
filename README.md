# 인벤토리 매니저

PRM 인벤토리에서 누이 아이템을 정리하고, 교환 목록과 구해요 이미지를 만드는 Tampermonkey 사용자 스크립트입니다.

## 설치

1. 브라우저에 Tampermonkey를 설치합니다.
2. [인벤토리 매니저 설치](https://raw.githubusercontent.com/neo5322/inventory-manager-userscript/main/inventory-manager.user.js)를 엽니다.
3. Tampermonkey 설치 창에서 설치를 선택합니다.

대상 페이지: `https://prm.dothome.co.kr/my_page*`

## 업데이트

스크립트에는 고정된 `@updateURL`과 `@downloadURL`이 설정되어 있습니다. 새 버전은 같은 `inventory-manager.user.js` 파일을 갱신하고 `@version`을 올려 배포합니다. 업데이트 확인 주기와 자동 설치 여부는 각 사용자의 Tampermonkey 설정에 따릅니다.

## 기능

- 인벤토리 추적과 누이 교환 가능/불가 분류
- 일반 누이 선택 및 구해요 이미지 생성
- 누이 종류, 번호, 캐릭터 별칭 기준 자동 정렬
- 이미지 페이지 분할, 간략화, 개별 PNG 및 선택형 ZIP 저장

자세한 변경 사항은 [업데이트 노트](CHANGELOG.md)를 참고하세요.
