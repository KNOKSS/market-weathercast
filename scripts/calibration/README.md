# 예보 보정 연구

첫 유효 변동폭 모델을 앱에 넣기 전에 다음 세 가지를 검증합니다.

1. OOF 오차로 만든 다음날 변동폭 50%·80% 경험적 예측구간
2. 자산별 과거 252일 예측분포를 이용한 잔잔·보통·강풍·폭풍 매핑
3. 꼬리위험 확률의 Platt/Beta 및 최근 사건률 적응형 보정

실행:

```powershell
& "C:\Users\esra5\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts\calibration\run.py
```

결과는 `research-results/market-weather-calibration-v1`에 생성됩니다. 2025년 이후 봉인 시험 라벨은 사용하지 않으며 앱 공식도 변경하지 않습니다.
