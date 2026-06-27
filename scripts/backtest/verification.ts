import { scoreAt } from "./replay";
import type { AssetDefinition, BacktestObservation, HistoricalCandle } from "./types";

function nearlyEqual(left: number, right: number, tolerance = 1e-6): boolean {
  return Math.abs(left - right) <= tolerance;
}

export function verifyAssetReplay(
  asset: AssetDefinition,
  candles: HistoricalCandle[],
  observations: BacktestObservation[],
  minimumHistory: number,
): Record<string, boolean | number | string> {
  if (!observations.length) throw new Error(`${asset.id}: replay produced no observations`);
  const samplePositions = [0, Math.floor(observations.length / 2), observations.length - 1];

  const scoreParity = samplePositions.every((position) => {
    const candleIndex = minimumHistory - 1 + position;
    const expected = scoreAt(asset, candles, candleIndex);
    const actual = observations[position].score;
    return expected.temperature === actual.temperature &&
      expected.rainChance === actual.rainChance &&
      expected.ultraviolet === actual.ultraviolet &&
      expected.label === actual.weather;
  });

  const futureMutationIndex = minimumHistory + Math.floor((candles.length - minimumHistory - 6) / 2);
  const before = scoreAt(asset, candles, futureMutationIndex);
  const mutated = candles.map((candle, index) => index > futureMutationIndex
    ? { ...candle, open: candle.open * 9, high: candle.high * 10, low: candle.low * 0.1, close: candle.close * 8, volume: candle.volume * 100 }
    : { ...candle });
  const after = scoreAt(asset, mutated, futureMutationIndex);
  const futureMutationInvariant = JSON.stringify(before) === JSON.stringify(after);

  const chronological = observations.every((item, index) => index === 0 || item.date > observations[index - 1].date);
  const splitOrder = observations.every((item, index) => {
    const previous = observations[index - 1];
    if (!previous) return true;
    const rank = { train: 0, validation: 1, test: 2 };
    return rank[item.split] >= rank[previous.split];
  });

  const outcomeChecks = samplePositions.every((position) => {
    const candleIndex = minimumHistory - 1 + position;
    const current = candles[candleIndex];
    const expectedReturn1 = ((candles[candleIndex + 1].close - current.close) / current.close) * 100;
    const expectedReturn5 = ((candles[candleIndex + 5].close - current.close) / current.close) * 100;
    return nearlyEqual(expectedReturn1, observations[position].outcomes.return1) &&
      nearlyEqual(expectedReturn5, observations[position].outcomes.return5);
  });

  const noNonFinite = observations.every((item) => [
    item.close,
    item.score.temperature,
    item.score.rainChance,
    item.score.ultraviolet,
    item.outcomes.return1,
    item.outcomes.return3,
    item.outcomes.return5,
    item.nextDayRange,
    item.nextDayTrueRange,
  ].every(Number.isFinite));

  const checks = {
    [`${asset.id}.scoreParity`]: scoreParity,
    [`${asset.id}.futureMutationInvariant`]: futureMutationInvariant,
    [`${asset.id}.chronological`]: chronological,
    [`${asset.id}.splitOrder`]: splitOrder,
    [`${asset.id}.outcomeAlignment`]: outcomeChecks,
    [`${asset.id}.finiteValues`]: noNonFinite,
    [`${asset.id}.observations`]: observations.length,
  };
  const failed = Object.entries(checks).filter(([, value]) => value === false);
  if (failed.length) throw new Error(`${asset.id}: verification failed: ${failed.map(([key]) => key).join(", ")}`);
  return checks;
}

