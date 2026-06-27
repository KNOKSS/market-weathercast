# weatherScore v0.1 backtest

This developer-only experiment reuses `src/engine/weatherScore.ts` without changing the production formula.

## Run

```bash
pnpm backtest
pnpm backtest:refresh
```

`backtest` reuses normalized local data when the configured end date matches. `backtest:refresh` downloads all sources again.

## Non-negotiable rules

- Score date `t` receives candles ending at `t` only.
- Outcomes start at `t+1`.
- Mock data is forbidden.
- Splits are chronological 60/20/20.
- Relative risk thresholds are calculated from train only.
- The final test segment is diagnostic only and must not be used for parameter tuning.

## Replay caveat

The production engine combines minute and daily candles. Long, free minute history is not consistently available for all assets, so this first experiment supplies 96/30 daily bars to the existing minute/daily input slots. It is named `daily-replay` and must not be described as a minute-perfect production replay.

