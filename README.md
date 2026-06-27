# 시장기상청

시장 데이터를 날씨처럼 보여주는 모바일 우선 PWA입니다. 자동매매나 주문 기능은 없고, 매매 전 시장 환경을 가볍게 확인하는 보조 도구입니다.

## 실행

```bash
npm install
npm run dev
```

로컬 확인 후 배포할 때는 아래 명령을 사용합니다.

```bash
npm run build
npm run preview
```

## 데이터

- `BTCUSDT`, `ETHUSDT`, `SOLUSDT`: Binance public REST API
- `S&P 500`, `Nasdaq Composite`: `/api/yahoo` 프록시를 통해 Yahoo chart 데이터를 조회
- 추가한 미국 주식/ETF/지수: `/api/search`로 Yahoo 검색 후 `/api/yahoo` 차트 데이터를 조회
- API 호출이 실패하면 앱은 샘플 데이터로 fallback하며, 화면에 `샘플` 상태를 표시합니다.

로컬 개발에서는 Vite proxy가 `/api/yahoo`, `/api/search`를 처리합니다. 친구들과 공유할 배포는 `api/*.js` 서버리스 함수를 지원하는 Vercel 배포를 권장합니다.

## 배포

배포 전 점검:

```bash
pnpm run deploy:check
```

가장 간단한 배포 방식은 Vercel입니다. 자세한 순서는 [DEPLOY.md](./DEPLOY.md)를 참고하세요.

## 주요 로직

- `src/engine/indicators.ts`: SMA, RSI, ATR 유사 변동성, 거래량 비율 계산
- `src/engine/weatherScore.ts`: 시장 온도, 강수확률, 바람, 자외선, 미세먼지, 최종 날씨 계산
- `src/engine/alertEngine.ts`: 주의보/경보/안내 문구 생성
- `src/engine/checklistEngine.ts`: 진입가, 손절가, 목표가, 레버리지 기반 체크리스트 계산

## 개발자용 백테스트

동결된 `weatherScore v0.1`을 과거 일봉으로 재생하는 실험 도구가 `scripts/backtest`에 있습니다.

```bash
pnpm backtest:refresh # 과거 데이터 새로 수집 후 실행
pnpm backtest         # 저장된 원자료로 재현 실행
```

결과는 `backtest-results/weatherScore-v0.1-daily-replay`의 JSON과 Markdown 파일로 저장됩니다. 현재 운영 엔진은 분봉과 일봉을 함께 사용하므로, 이 실험은 장기 검증을 위한 일봉 재생이며 분봉까지 동일한 운영 재생은 아닙니다.

## Representative research dataset

Run `pnpm dataset:refresh` before developing weatherScore v0.2. It builds and audits a fixed sector, style, regime, and transfer-holdout universe without training or tuning the forecast model. Details are in `scripts/dataset/README.md`.

After the universe audit, `pnpm panel:build` creates the leakage-checked end-of-day research panel. Its timing contract and outputs are documented in `scripts/panel/README.md`.

`pnpm evaluation:baseline` freezes the purged/embargoed validation protocol. Interpretable Ridge/Logistic research and moving-block bootstrap live in `scripts/modeling/` and require Python with NumPy.

`scripts/calibration/run.py` validates empirical range intervals, asset-relative weather grades, and tail-risk probability calibration. It does not open the sealed test or change the app formula.

`scripts/robustness/run.py` keeps that candidate frozen while testing 2015–2022 time stability and leave-one-economic-cluster-out transfer before the sealed test is opened.

The frozen v2 candidate, one-shot 2025+ sealed test, and final XLC/XLRE/TSLA/NVDA/ETH transfer test are preserved under `research-results/market-weather-presealed-candidate-v2`, `market-weather-sealed-test-v2`, and `market-weather-transfer-test-v2`. No result has been applied to the production app.

The next phase is an append-only prospective shadow test under `scripts/shadow/`. Its model is frozen through 2024, every forecast and settlement is hash-chained, stale or incomplete closes are rejected, and dry-runs cannot enter the official ledger. The protocol and initial infrastructure check are in `research-results/market-weather-shadow-v1`. The production app formula remains unchanged.

## PWA

`public/manifest.webmanifest`와 `public/service-worker.js`가 포함되어 있습니다. 정적 호스팅에 배포하면 휴대폰 브라우저에서 홈 화면에 추가해 사용할 수 있습니다.

## 고지

이 앱은 투자 조언이나 매수/매도 추천을 제공하지 않습니다. 시장 데이터를 기상 정보처럼 시각화한 보조 도구이며, 모든 투자 판단과 책임은 사용자 본인에게 있습니다.
