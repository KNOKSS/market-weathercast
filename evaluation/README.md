# Stage 3: split and baseline evaluation

```bash
pnpm evaluation:baseline
```

- 2022년까지 학습 후보
- 2023~2024년 검증
- 2025년 이후 봉인 시험
- 각 경계에서 자산 고유 거래기간 5개 purge + 5개 embargo
- IWM, XLE, XLU, EEM, BTCUSDT는 개발 자산 홀드아웃
- XLC, XLRE, TSLA, NVDA, ETHUSDT는 최종 전이성 홀드아웃으로 계속 패널 밖에 유지

기준선 평가에는 검증 라벨만 사용합니다. 봉인 시험 성능은 모델 구조와 임계값을 동결하기 전까지 계산하지 않습니다.
