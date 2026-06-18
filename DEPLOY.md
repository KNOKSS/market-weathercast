# 시장기상청 배포 방법

이 프로젝트는 Vercel 서버리스 API를 사용합니다. GitHub 저장소에 수정 파일을 올리면 연결된 Vercel이 자동으로 다시 배포합니다.

## GitHub 웹에서 수정본 올리기

1. 전달받은 `market-weathercast-deploy-2026-06-18.zip`을 압축 해제합니다.
2. GitHub의 `KNOKSS/market-weathercast` 저장소에서 `Code` 화면을 엽니다.
3. `Add file` → `Upload files`를 누릅니다.
4. 압축을 푼 폴더 안으로 들어가 `api`, `public`, `src` 폴더와 나머지 파일을 모두 선택합니다.
5. 선택한 항목을 GitHub의 업로드 영역에 끌어다 놓습니다.
6. 업로드 목록에 `api/news.js`, `api/translate.js`가 포함됐는지 확인합니다.
7. 아래 Commit message에 `시장 브리핑 및 실시간 관측 업데이트`라고 입력합니다.
8. `Commit changes`를 누릅니다. 기존처럼 `main` 브랜치에 바로 반영하면 됩니다.

중요: 압축을 푼 바깥 폴더 자체가 아니라, 그 안의 `api`, `public`, `src`와 파일들을 올려야 합니다.

## Vercel 자동 배포 확인

1. GitHub 업로드 완료 후 Vercel 대시보드를 엽니다.
2. `market-weathercast` 프로젝트의 `Deployments`로 이동합니다.
3. 가장 위 배포가 `Building`에서 `Ready`로 바뀔 때까지 기다립니다.
4. 기존 주소 `https://market-weathercast.vercel.app/`를 열고 새로고침합니다.

Vercel 설정은 다음과 같습니다.

- Framework Preset: `Vite`
- Build Command: `pnpm run build`
- Output Directory: `dist`
- 별도 환경변수: 현재 없음

## 배포 후 기능 점검

아래 주소들이 열리면 서버 기능이 정상입니다.

```text
https://market-weathercast.vercel.app/api/search?q=AAPL
https://market-weathercast.vercel.app/api/yahoo?symbol=%5EIXIC&range=5d&interval=15m
https://market-weathercast.vercel.app/api/news?q=%5EGSPC&count=3
https://market-weathercast.vercel.app/api/translate?q=Wall%20Street%20rises
```

앱에서는 다음 순서로 확인합니다.

1. 헤더의 새로고침 버튼을 눌러 현재가가 갱신되는지 확인합니다.
2. `시장날씨`에서 BTC와 NASDAQ을 눌러 관측소가 변경되는지 확인합니다.
3. `브리핑`에서 한글 자동번역 뉴스와 영어 원문이 함께 표시되는지 확인합니다.
4. 휴대폰에서는 브라우저 메뉴의 `홈 화면에 추가`로 PWA를 설치합니다.
