# 배포 방법

가장 단순한 배포 경로는 Vercel입니다. 이 앱은 `/api/yahoo`, `/api/search` 서버리스 프록시가 필요해서 정적 호스팅만으로는 전체 기능이 동작하지 않습니다.

## 1. 배포 전 점검

```bash
pnpm install
pnpm run deploy:check
```

## 2. Vercel 배포

1. 프로젝트 폴더를 GitHub 저장소로 올립니다.
2. Vercel에서 `Add New Project`를 누르고 해당 저장소를 선택합니다.
3. Framework Preset은 `Vite`로 두면 됩니다.
4. Build Command는 `pnpm run build`, Output Directory는 `dist`입니다.
5. 배포 후 발급된 URL을 휴대폰에서 열고 홈 화면에 추가합니다.

## 3. 배포 후 확인

아래 URL들이 응답하면 검색과 지수 차트가 정상입니다.

```text
https://배포주소/api/search?q=AAPL
https://배포주소/api/yahoo?symbol=%5EIXIC&range=5d&interval=15m
```

앱 첫 화면에서 `시장` 탭으로 이동해 `AAPL`을 검색하고 추가해보면 전체 흐름을 확인할 수 있습니다.
