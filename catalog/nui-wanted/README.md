# 누이 구해요 데이터

`manifest.json`은 공개 선택 목록을 출처별 JSON 파일로 연결합니다. userscript는 이 파일을 실행 시 읽고, 모든 소스가 유효할 때만 새 목록을 적용합니다. 읽기에 실패하면 브라우저에 저장된 마지막 정상 목록을 계속 사용합니다.

## 파일 형식

각 manifest 항목에는 고유한 `id`, `kind`, `format`, `file`이 필요합니다.

- `kind`: `ordinary` 또는 선택권에서 확인한 `secret`.
- `format`: 정리된 `{name, image, category, grade}` 배열은 `catalog`, Chrome Console에서 복사한 선택 모달의 `{type, item_name, item_id, item_grade, img_url}` 배열은 `modal`.
- `file`: 이 디렉터리를 기준으로 `sources/<name>.json` 형식의 경로.

새 선택권 목록을 받으면 원본 JSON을 검토한 뒤, 필요한 필드만 새 `sources/` 파일에 보관하고 manifest에 한 항목을 추가합니다. 시크릿 선택 모달의 `item_grade`가 `rare`여도, 검증된 시크릿 선택권은 `kind: "secret"`으로 등록합니다. 일반 목록으로 잘못 넣으면 일부 항목이 누락되므로 검증에 실패합니다.

원본 `img_url`이 `uploads/...` 형태이면 스크립트가 해당 경로를 PRM 서버의 HTTPS URL로 해석합니다. 외부 도메인과 `/uploads/` 밖의 경로는 거절합니다. 같은 파일 안의 중복 항목은 거절하고, 서로 다른 출처에 있는 같은 항목은 하나로 합칩니다. 선택 저장 키는 이름과 이미지 URL의 조합이므로 목록을 추가해도 기존 선택이 유지됩니다.

로컬 검증 명령은 `DEVELOPMENT.md`에 있습니다. JSON 변경은 userscript 버전 변경 없이도 배포 후 갱신되므로, 목록 파일을 공개하기 전에 출처와 항목을 확인하세요.
