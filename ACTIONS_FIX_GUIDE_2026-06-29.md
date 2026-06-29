# Actions 실패 수리 패치 - 2026-06-29

첫 수동 실행은 시작됐지만 `Refresh completed daily candles` 단계에서 실패했습니다.

확인된 상태:

- workflow 파일은 정상 등록됨
- 의존성 설치 성공
- 큰 research artifact 복원 성공
- 실패 위치는 `pnpm shadow:refresh`

가능성이 높은 원인:

- GitHub Actions runner에서 Binance API 접근이 제한되어 BTC/ETH 일봉 fetch가 실패했을 가능성이 큽니다.

이번 패치:

- `scripts/backtest/dataLoader.ts`
  - Binance fetch 실패 시 BTC/ETH는 Yahoo의 `BTC-USD`, `ETH-USD`로 자동 fallback
- `scripts/shadow/snapshot.ts`
  - 어떤 자산을 fetch하다 실패했는지 로그에 더 잘 보이도록 진행 로그 추가

업로드 방법:

`market-weathercast-actions-fix-2026-06-29` 폴더 안의 `scripts` 폴더와 이 안내 파일을 GitHub에 업로드하세요.

커밋 메시지 예시:

`fix: add crypto data fallback for daily forecast`

업로드 후:

1. GitHub Actions → `Daily market weather forecast`
2. `Run workflow`
3. 실패하면 `Refresh completed daily candles` 단계를 클릭해 보이는 빨간 에러 로그를 복사해서 Codex에게 보내주세요.

