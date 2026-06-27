# Market Weather EOD panel v1

대표 유니버스의 원자료를 `t 장 마감 특징 → t+1/t+3/t+5 결과` 구조로 변환합니다. 장중 예보 데이터가 아닙니다.

```bash
pnpm panel:build
pnpm panel:refresh
```

- 기본 실행은 `research-data/raw/` 캐시를 사용합니다.
- 결과는 `research-results/market-weather-eod-panel-v1/`에 저장됩니다.
- `panel.jsonl.gz`에는 개발 대상만 들어가며 잠금 홀드아웃은 생성하지 않습니다.
- 무작위 train/test 분할은 금지합니다. 다음 단계에서 purge·embargo 시간 분할을 적용합니다.
