# Representative market dataset v1

이 단계는 예보 공식을 학습하지 않습니다. 먼저 대표 자산 유니버스를 고정하고 원자료의 이력, 거래달력 커버리지, 거래량, 공백, 시장 국면, 중복도를 감사합니다.

## 실행

```bash
pnpm dataset:refresh
pnpm dataset:audit
```

- `dataset:refresh`: Yahoo/Binance 원자료를 새로 받습니다.
- `dataset:audit`: 기준일과 일치하는 로컬 캐시를 재사용합니다.
- 원자료: `research-data/raw/` (Git 제외)
- 결과: `research-results/market-weather-representative-universe-v1/`

## 격리 규칙

`locked-transfer-holdout`은 데이터 무결성만 확인합니다. 모델 특징, 임계값, 자산군 보정법을 선택할 때 결과를 보면 안 됩니다. 최종 모델 후보를 동결한 뒤 종목 간 이전성 검증에서 한 번만 사용합니다.
