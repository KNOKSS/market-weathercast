import { useEffect, useMemo, useState } from "react";
import { fetchMarketNews, type MarketNewsItem, type NewsCategory } from "../api/news";
import { translateNewsHeadlines } from "../api/translation";
import { AlertList } from "../components/AlertList";
import { buildMarketBriefing, marketDeskHeadline } from "../engine/marketBriefing";
import type { MarketAlert, WeatherScore } from "../types/market";

interface AlertsPageProps {
  alerts: MarketAlert[];
  overallScore: WeatherScore;
  scores: Record<string, WeatherScore>;
  refreshedAt: Date | null;
}

type NewsFilter = "전체" | NewsCategory;

const CATEGORY_META: Record<NewsCategory, { icon: string; description: string }> = {
  증시: { icon: "↗", description: "주요 지수와 기업 흐름" },
  "금리·연준": { icon: "%", description: "채권·물가·통화정책" },
  "기술·AI": { icon: "◫", description: "반도체와 성장주 이슈" },
  가상자산: { icon: "₿", description: "코인 시장 위험선호" },
  원자재: { icon: "◆", description: "원유·금·상품시장" },
  글로벌: { icon: "◎", description: "세계 시장 주요 변수" },
};

function relativeTime(timestamp: number): string {
  if (!timestamp) return "시각 확인 중";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function NewsImage({ item, compact = false }: { item: MarketNewsItem; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`news-image ${compact ? "news-image-compact" : ""} ${failed || !item.imageUrl ? "image-fallback" : ""}`}>
      {!failed && item.imageUrl ? (
        <img src={item.imageUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{CATEGORY_META[item.category].icon}</span>
      )}
    </span>
  );
}

export function AlertsPage({ alerts, overallScore, scores, refreshedAt }: AlertsPageProps) {
  const [news, setNews] = useState<MarketNewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState(false);
  const [newsUpdatedAt, setNewsUpdatedAt] = useState<Date | null>(null);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [activeFilter, setActiveFilter] = useState<NewsFilter>("전체");
  const briefing = useMemo(() => buildMarketBriefing(overallScore, scores), [overallScore, scores]);

  async function loadNews(force = false) {
    setNewsLoading(true);
    setNewsError(false);
    try {
      const items = await fetchMarketNews(force);
      setNews(items);
      setNewsUpdatedAt(new Date());
      void translateNewsHeadlines(items).then((translated) => {
        setTranslations((current) => ({ ...current, ...translated }));
      });
    } catch {
      setNewsError(true);
    } finally {
      setNewsLoading(false);
    }
  }

  useEffect(() => {
    void loadNews();
  }, []);

  const availableCategories = useMemo(() => {
    const present = new Set(news.map((item) => item.category));
    return (Object.keys(CATEGORY_META) as NewsCategory[]).filter((category) => present.has(category));
  }, [news]);

  const visibleNews = activeFilter === "전체"
    ? news
    : news.filter((item) => item.category === activeFilter);
  const leadNews = visibleNews[0];
  const secondaryNews = visibleNews.slice(1, 7);

  const radarItems = useMemo(() => {
    return (Object.keys(CATEGORY_META) as NewsCategory[])
      .map((category) => ({
        category,
        count: news.filter((item) => item.category === category).length,
      }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
  }, [news]);

  const seriousAlerts = alerts.filter((alert) => alert.level === "경보" || alert.level === "주의보").length;

  return (
    <div className="briefing-page page-flow">
      <section className="briefing-hero" data-weather={overallScore.label}>
        <div className="briefing-hero-head">
          <div>
            <p className="briefing-kicker"><span /> MARKET NEWS DESK</p>
            <h1>오늘의 시장 브리핑</h1>
            <time>{new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(new Date())}</time>
          </div>
          <div className="briefing-temperature">
            <small>시장 체감</small>
            <strong>{overallScore.temperature}<i>°</i></strong>
            <span>{overallScore.label}</span>
          </div>
        </div>

        <div className="briefing-lead">
          <span>오늘의 관측</span>
          <h2>{marketDeskHeadline(overallScore)}</h2>
          <p>가격·변동성·거래활력으로 생성한 데이터 해설이며, 뉴스의 인과관계를 단정하지 않습니다.</p>
        </div>

        <div className="briefing-line-grid">
          {briefing.map((line) => (
            <article className={`briefing-line tone-${line.tone}`} key={line.label}>
              <span>{line.label}</span>
              <p>{line.text}</p>
            </article>
          ))}
        </div>
        <div className="briefing-source-line">
          <span><i /> 시장 데이터 LIVE</span>
          <small>{refreshedAt ? `${refreshedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 관측` : "관측 시각 확인 중"}</small>
        </div>
      </section>

      <section className="briefing-section issue-radar-section">
        <div className="briefing-section-head">
          <div>
            <p className="eyebrow">ISSUE RADAR</p>
            <h2>오늘의 이슈 레이더</h2>
          </div>
          <small>수집된 헤드라인 기준</small>
        </div>
        {newsLoading && news.length === 0 ? (
          <div className="radar-grid radar-loading" aria-label="이슈 레이더 불러오는 중">
            {[0, 1, 2, 3].map((item) => <span key={item} />)}
          </div>
        ) : radarItems.length > 0 ? (
          <div className="radar-grid">
            {radarItems.map(({ category, count }, index) => (
              <button type="button" key={category} onClick={() => setActiveFilter(category)}>
                <span className="radar-rank">0{index + 1}</span>
                <i aria-hidden="true">{CATEGORY_META[category].icon}</i>
                <strong>{category}</strong>
                <small>{CATEGORY_META[category].description}</small>
                <em>헤드라인 {count}건</em>
              </button>
            ))}
          </div>
        ) : (
          <p className="briefing-empty">이슈 레이더 연결을 기다리고 있습니다.</p>
        )}
      </section>

      <section className="briefing-section market-news-section">
        <div className="briefing-section-head">
          <div>
            <p className="eyebrow">MARKET HEADLINES</p>
            <h2>핵심 시장 뉴스</h2>
          </div>
          <button className="news-refresh-button" type="button" onClick={() => void loadNews(true)} disabled={newsLoading}>
            {newsLoading ? "수신 중" : "새로 받기"}
          </button>
        </div>

        <div className="news-filter-row" aria-label="뉴스 분야 선택">
          {(["전체", ...availableCategories] as NewsFilter[]).map((filter) => (
            <button
              type="button"
              className={activeFilter === filter ? "active" : ""}
              onClick={() => setActiveFilter(filter)}
              key={filter}
            >
              {filter}
            </button>
          ))}
        </div>

        {newsLoading && news.length === 0 ? (
          <div className="news-loading-list">
            <span /><span /><span />
          </div>
        ) : leadNews ? (
          <div className="news-layout">
            <a className="lead-news-card" href={leadNews.url} target="_blank" rel="noreferrer">
              <NewsImage item={leadNews} />
              <div>
                <div className="news-tag-row">
                  <span className="news-category">{leadNews.category}</span>
                  {translations[leadNews.id] && <span className="auto-translation-label">자동 번역</span>}
                </div>
                <h3>{translations[leadNews.id] ?? leadNews.title}</h3>
                {translations[leadNews.id] && <p className="news-original-title" lang="en">{leadNews.title}</p>}
                <p className="news-meta"><strong>{leadNews.publisher}</strong><time>{relativeTime(leadNews.publishedAt)}</time></p>
                <small>원문 기사 보기 <b aria-hidden="true">↗</b></small>
              </div>
            </a>
            <div className="news-list">
              {secondaryNews.map((item) => (
                <a href={item.url} target="_blank" rel="noreferrer" key={item.id}>
                  <div>
                    <span>{item.category} · {translations[item.id] ? "자동 번역 · " : ""}{relativeTime(item.publishedAt)}</span>
                    <strong>{translations[item.id] ?? item.title}</strong>
                    {translations[item.id] && <small className="news-original-compact" lang="en">{item.title}</small>}
                    <small className="news-publisher">{item.publisher}</small>
                  </div>
                  <NewsImage item={item} compact />
                </a>
              ))}
            </div>
          </div>
        ) : (
          <div className="news-error-card">
            <strong>뉴스 위성 연결 지연</strong>
            <p>헤드라인 수신이 늦어지고 있습니다. 위의 데이터 브리핑과 위험 경보는 정상적으로 이용할 수 있습니다.</p>
            <button type="button" onClick={() => void loadNews(true)}>다시 연결</button>
          </div>
        )}
        <div className="news-source-note">
          <span>{newsError ? "일부 뉴스 연결 지연" : "Yahoo Finance 헤드라인"}</span>
          <small>{newsUpdatedAt ? `${newsUpdatedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 업데이트` : "5분 캐시"} · 한글 제목은 자동 번역이며 원문을 함께 제공합니다.</small>
        </div>
      </section>

      <section className="briefing-section risk-desk-section">
        <div className="briefing-section-head">
          <div>
            <p className="eyebrow">RISK DESK</p>
            <h2>시장 위험 경보</h2>
          </div>
          <span className={`risk-count ${seriousAlerts > 0 ? "active" : ""}`}>
            {seriousAlerts > 0 ? `주의 이상 ${seriousAlerts}건` : "특별 경보 없음"}
          </span>
        </div>
        <AlertList alerts={alerts} />
      </section>
    </div>
  );
}
