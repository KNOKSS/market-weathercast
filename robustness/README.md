# 봉인 시험 전 강건성 연구

동결된 후보를 재튜닝하지 않고 다음 검증을 통합 실행합니다.

1. 2015~2022 네 개 expanding walk-forward 구간의 시기 안정성
2. 경제군을 하나씩 완전히 제외한 leave-one-cluster-out 전이 검증
3. 변동폭·날씨 등급·꼬리위험의 이동 블록 bootstrap 진단

```powershell
& "C:\Users\esra5\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts\robustness\run.py
```

2025년 이후 봉인 시험과 최종 전이 홀드아웃은 사용하지 않습니다.
