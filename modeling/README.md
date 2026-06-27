# Stage 4: interpretable model research

Required Python packages: `numpy`.

```bash
python scripts/modeling/run.py
```

통합 실행 내용:

- 군집 → 자산 → 행의 3단계 동일가중
- 학습 구간 내부 expanding walk-forward로 L2 규제 선택
- log True Range Ridge 회귀
- 1일 역사적 하방꼬리 Logistic 확률
- 방향 Logistic challenger
- 2023~2024 seen/asset-holdout 검증
- 20기간 이동 블록 bootstrap 300회

2025년 이후 봉인 시험의 라벨은 추출하지 않으며, 최종 전이성 홀드아웃도 계속 제외합니다.
