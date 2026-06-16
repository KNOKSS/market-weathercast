import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ChecklistInput, MarketSymbol, WeatherScore } from "../types/market";
import { evaluateChecklist } from "../engine/checklistEngine";
import { formatNumber } from "../utils/format";

interface ChecklistFormProps {
  symbols: MarketSymbol[];
  selectedSymbolId: string;
  scores: Record<string, WeatherScore>;
  onSymbolChange: (symbolId: string) => void;
}

const STORAGE_KEY = "market-weather-checklist";

const initialInput: ChecklistInput = {
  symbolId: "BTCUSDT",
  direction: "long",
  entry: "",
  stop: "",
  target: "",
  leverage: "1",
  positionSize: "",
};

export function ChecklistForm({
  symbols,
  selectedSymbolId,
  scores,
  onSymbolChange,
}: ChecklistFormProps) {
  const [input, setInput] = useState<ChecklistInput>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return { ...initialInput, ...JSON.parse(saved), symbolId: selectedSymbolId };
      }
    } catch {
      return { ...initialInput, symbolId: selectedSymbolId };
    }
    return { ...initialInput, symbolId: selectedSymbolId };
  });

  useEffect(() => {
    setInput((current) => ({ ...current, symbolId: selectedSymbolId }));
  }, [selectedSymbolId]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(input));
  }, [input]);

  const result = useMemo(
    () => evaluateChecklist(input, scores[input.symbolId] ?? null),
    [input, scores],
  );

  function update(field: keyof ChecklistInput, value: string) {
    setInput((current) => ({ ...current, [field]: value }));
    if (field === "symbolId") {
      onSymbolChange(value);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  return (
    <section className="checklist-panel">
      <form onSubmit={handleSubmit} className="checklist-form">
        <label>
          종목
          <select value={input.symbolId} onChange={(event) => update("symbolId", event.target.value)}>
            {symbols.map((symbol) => (
              <option key={symbol.id} value={symbol.id}>
                {symbol.shortLabel} · {symbol.label}
              </option>
            ))}
          </select>
        </label>

        <div className="segmented" role="group" aria-label="방향">
          <button
            className={input.direction === "long" ? "active" : ""}
            type="button"
            onClick={() => update("direction", "long")}
          >
            롱
          </button>
          <button
            className={input.direction === "short" ? "active" : ""}
            type="button"
            onClick={() => update("direction", "short")}
          >
            숏
          </button>
        </div>

        <div className="form-grid">
          <label>
            진입가
            <input
              inputMode="decimal"
              value={input.entry}
              onChange={(event) => update("entry", event.target.value)}
              placeholder="예: 105000"
            />
          </label>
          <label>
            손절가
            <input
              inputMode="decimal"
              value={input.stop}
              onChange={(event) => update("stop", event.target.value)}
              placeholder="예: 103800"
            />
          </label>
          <label>
            목표가
            <input
              inputMode="decimal"
              value={input.target}
              onChange={(event) => update("target", event.target.value)}
              placeholder="예: 108000"
            />
          </label>
          <label>
            레버리지
            <input
              inputMode="decimal"
              value={input.leverage}
              onChange={(event) => update("leverage", event.target.value)}
              placeholder="1"
            />
          </label>
          <label>
            포지션 크기
            <input
              inputMode="decimal"
              value={input.positionSize}
              onChange={(event) => update("positionSize", event.target.value)}
              placeholder="선택 입력"
            />
          </label>
        </div>
      </form>

      <div className={`checklist-result result-${result.tone}`}>
        <div className="result-metrics">
          <span>
            손익비
            <strong>{result.rewardRiskRatio ?? "-"}</strong>
          </span>
          <span>
            예상 수익
            <strong>{formatNumber(result.expectedProfit, 2)}</strong>
          </span>
          <span>
            예상 손실
            <strong>{formatNumber(result.expectedLoss, 2)}</strong>
          </span>
          <span>
            레버리지 수익
            <strong>{formatNumber(result.leveragedProfit, 2)}</strong>
          </span>
          <span>
            레버리지 손실
            <strong>{formatNumber(result.leveragedLoss, 2)}</strong>
          </span>
        </div>

        <p className="final-message">{result.finalMessage}</p>

        {result.warnings.length > 0 && (
          <ul className="warning-list">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
