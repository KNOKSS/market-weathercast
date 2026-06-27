# GitHub 웹 업로드 순서 - 2026-06-27

GitHub 웹 업로드는 한 번에 너무 많은 파일을 올리면 `Yowza, that's a lot of files` 경고가 뜹니다.

그래서 이번 배포본은 아래 3개 파트로 나눠서 올리면 됩니다.

## 업로드 방법

각 파트 폴더 자체를 드래그하지 말고, 파트 폴더 안으로 들어간 뒤 안의 파일과 폴더를 선택해서 GitHub 업로드 화면에 드래그하세요.

예:

1. `part-01-app` 폴더 열기
2. 그 안의 `.github`, `api`, `public`, `src`, `package.json` 등을 선택
3. GitHub 업로드 화면에 드래그
4. Commit changes
5. `part-02-automation-scripts`도 같은 방식으로 반복
6. `part-03-v2-model-ledgers`도 같은 방식으로 반복

## 추천 커밋 순서

### 1차 커밋: 앱 본체

폴더:

- `part-01-app`

커밋 메시지 예시:

`app: update market weather UI and forecast view`

### 2차 커밋: 자동화 스크립트

폴더:

- `part-02-automation-scripts`

커밋 메시지 예시:

`chore: add daily forecast automation scripts`

### 3차 커밋: V2 모델/공식 ledger 초기 파일

폴더:

- `part-03-v2-model-ledgers-websafe`

커밋 메시지 예시:

`data: seed v2 forecast model ledgers`

## 중요한 주의사항

- ZIP 파일 자체를 GitHub에 올리는 것이 아닙니다.
- 파트 폴더 자체를 올리면 GitHub 안에 `part-01-app` 같은 불필요한 폴더가 생깁니다.
- 반드시 파트 폴더 안의 내용물을 선택해서 올리세요.
- `.github` 폴더가 올라가야 자동 예보/정산 Actions가 생깁니다.
- `node_modules`, `dist`, `research-data`, `backtest-data`, `backtest-results`는 웹 업로드용 파트에서 제외했습니다.
- GitHub 웹 업로드는 단일 파일 25MB 제한이 있으므로, 큰 `panel.jsonl.gz` 파일은 `.part-00`, `.part-01` 조각으로 나누어 올립니다.
- GitHub Actions가 실행될 때 이 조각들을 자동으로 합쳐 원래 `panel.jsonl.gz`를 복원합니다.

## 소급 기록 원칙

오늘까지 빠진 날짜는 공식 예보 기록으로 소급 입력하지 않습니다.

공식 V2 shadow 관측 기록은 이 배포가 GitHub에 올라간 뒤, GitHub Actions가 실제로 실행되는 시점부터 쌓입니다.
