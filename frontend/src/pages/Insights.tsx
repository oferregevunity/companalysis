import { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/firebase';
import { generateInsights } from '../lib/api';
import { useInsights } from '../hooks/useInsights';
import { formatCurrency, formatNumber, formatMonth, formatWeek } from '../lib/dataProcessing';
import type { Genre, InsightGame, InsightWatchItem, GenreInsightDoc } from '../types';

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 60 ? 'bg-green-100 text-green-800'
    : score >= 40 ? 'bg-yellow-100 text-yellow-800'
    : 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium ${color}`}>
      {score}
    </span>
  );
}

function SubScoreBar({ label, value, max = 25 }: { label: string; value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 text-gray-500 truncate">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
        <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-gray-400">{value}</span>
    </div>
  );
}

function StoreLinks({ iosAppId, androidAppId }: { iosAppId?: string | null; androidAppId?: string | null }) {
  if (!iosAppId && !androidAppId) return null;
  return (
    <div className="flex items-center gap-2">
      {iosAppId && (
        <a href={`https://apps.apple.com/app/id${iosAppId}`} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
          </svg>
          App Store
        </a>
      )}
      {androidAppId && (
        <a href={`https://play.google.com/store/apps/details?id=${androidAppId}`} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3.609 1.814L13.792 12 3.61 22.186a.996.996 0 01-.61-.92V2.734a1 1 0 01.609-.92zm10.89 10.893l2.302 2.302-10.937 6.333 8.635-8.635zm3.199-3.199l2.807 1.626a1 1 0 010 1.732l-2.807 1.626L15.206 12l2.492-2.492zM5.864 2.658L16.8 8.99l-2.302 2.302-8.634-8.634z"/>
          </svg>
          Google Play
        </a>
      )}
    </div>
  );
}

function PeriodDataTable({ periodData, granularity }: {
  periodData: Record<string, { revenue: number; downloads: number }>;
  granularity: 'month' | 'week';
}) {
  const periods = Object.keys(periodData).sort();
  if (periods.length === 0) return null;
  const fmtPeriod = granularity === 'week' ? formatWeek : formatMonth;
  // Show last 6 periods max
  const display = periods.slice(-6);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left py-1 pr-2 text-gray-400 font-medium">Period</th>
            {display.map(p => (
              <th key={p} className="text-right py-1 px-2 text-gray-400 font-medium whitespace-nowrap">{fmtPeriod(p)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-gray-50">
            <td className="py-1 pr-2 text-gray-500">Revenue</td>
            {display.map(p => (
              <td key={p} className="text-right py-1 px-2 tabular-nums text-gray-700">{formatCurrency(periodData[p].revenue)}</td>
            ))}
          </tr>
          <tr>
            <td className="py-1 pr-2 text-gray-500">Downloads</td>
            {display.map(p => (
              <td key={p} className="text-right py-1 px-2 tabular-nums text-gray-700">{formatNumber(periodData[p].downloads)}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function GameCard({ game, isExpanded, onToggle, granularity }: {
  game: InsightGame;
  isExpanded: boolean;
  onToggle: () => void;
  granularity: 'month' | 'week';
}) {
  const navigate = useNavigate();
  const sparkData = [
    { v: game.score * 0.3 },
    { v: game.score * 0.5 },
    { v: game.score * 0.7 },
    { v: game.score * 0.85 },
    { v: game.score },
  ];

  return (
    <div className="border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center text-green-700 font-bold text-sm">
            {game.rank}
          </div>
          <div>
            <div className="font-medium text-gray-900">{game.appName}</div>
            <div className="text-sm text-gray-500">{game.publisherName}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-20 h-8">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData}>
                <Line type="monotone" dataKey="v" stroke="#22c55e" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ScoreBadge score={game.score} />
        </div>
      </div>
      <button onClick={onToggle} className="mt-2 text-xs text-blue-600 hover:text-blue-800">
        {isExpanded ? 'Hide details' : 'Show details'}
      </button>
      {isExpanded && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-gray-700">{game.explanation}</p>
          <div className="space-y-1">
            <SubScoreBar label="Rev. Accel." value={game.subScores.revenueAcceleration} />
            <SubScoreBar label="DL Momentum" value={game.subScores.downloadMomentum} />
            <SubScoreBar label="Anomaly" value={game.subScores.anomalyScore} />
            <SubScoreBar label="Convergence" value={game.subScores.crossMetricConvergence} />
          </div>
          {game.periodData && Object.keys(game.periodData).length > 0 && (
            <PeriodDataTable periodData={game.periodData} granularity={granularity} />
          )}
          <div className="flex items-center gap-3 pt-1">
            <StoreLinks iosAppId={game.iosAppId} androidAppId={game.androidAppId} />
            <button
              onClick={() => navigate(`/?search=${encodeURIComponent(game.appName)}`)}
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
              View in Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WatchList({ items }: { items: InsightWatchItem[] }) {
  const navigate = useNavigate();
  return (
    <>
      <h3 className="text-sm font-medium text-gray-700 mt-6 mb-3">Watch List</h3>
      <div className="space-y-2">
        {items.map(item => (
          <div key={item.appId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900">{item.appName}</span>
              <span className="text-xs text-gray-500">{item.publisherName}</span>
              <StoreLinks iosAppId={item.iosAppId} androidAppId={item.androidAppId} />
              <button
                onClick={() => navigate(`/?search=${encodeURIComponent(item.appName)}`)}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Dashboard
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{item.reason}</span>
              <ScoreBadge score={item.score} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function GenreInsightCard({ insight, genreName, granularity }: { insight: GenreInsightDoc; genreName: string; granularity: 'month' | 'week' }) {
  const [expandedGame, setExpandedGame] = useState<string | null>(null);

  const timeAgo = (date: Date) => {
    const mins = Math.floor((Date.now() - date.getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">{genreName}</h2>
        <span className="text-xs text-gray-400">Last analyzed: {timeAgo(insight.generatedAt)}</span>
      </div>
      {insight.summary && (
        <p className="text-sm text-gray-600 mb-4 bg-blue-50 p-3 rounded-lg">{insight.summary}</p>
      )}
      <h3 className="text-sm font-medium text-gray-700 mb-3">Top 5 Rising Stars</h3>
      <div className="space-y-3">
        {insight.games.map(game => (
          <GameCard
            key={game.appId}
            game={game}
            isExpanded={expandedGame === game.appId}
            onToggle={() => setExpandedGame(expandedGame === game.appId ? null : game.appId)}
            granularity={granularity}
          />
        ))}
      </div>
      {insight.watchList.length > 0 && (
        <WatchList items={insight.watchList} />
      )}
    </div>
  );
}

export default function Insights() {
  const [genres, setGenres] = useState<Genre[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<Genre[]>([]);
  const [generating, setGenerating] = useState(false);
  const [granularity, setGranularity] = useState<'month' | 'week'>('month');

  const { insights, loading, error, refresh } = useInsights(selectedGenres, granularity);

  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, 'genres'));
      const loaded = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Genre));
      setGenres(loaded.filter(g => g.active));
      setSelectedGenres(loaded.filter(g => g.active));
    })();
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateInsights(granularity);
      refresh();
    } catch (err) {
      console.error('Failed to generate insights:', err);
    } finally {
      setGenerating(false);
    }
  };

  const toggleGenre = (genre: Genre) => {
    setSelectedGenres(prev =>
      prev.some(g => g.id === genre.id)
        ? prev.filter(g => g.id !== genre.id)
        : [...prev, genre]
    );
  };

  const genreMap = new Map(genres.map(g => [g.id, g]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Rising Stars</h1>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            <button
              className={`px-3 py-1.5 text-sm ${granularity === 'month' ? 'bg-blue-50 text-blue-700' : 'text-gray-600'}`}
              onClick={() => setGranularity('month')}
            >Monthly</button>
            <button
              className={`px-3 py-1.5 text-sm ${granularity === 'week' ? 'bg-blue-50 text-blue-700' : 'text-gray-600'}`}
              onClick={() => setGranularity('week')}
            >Weekly</button>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {generating ? 'Analyzing...' : 'Re-analyze'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {genres.map(genre => (
          <button
            key={genre.id}
            onClick={() => toggleGenre(genre)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedGenres.some(g => g.id === genre.id)
                ? 'bg-blue-100 text-blue-800'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {genre.name}
          </button>
        ))}
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading insights...</div>
      ) : insights.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-400 mb-4">No insights generated yet.</p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {generating ? 'Analyzing...' : 'Generate Insights'}
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {insights.map(insight => (
            <GenreInsightCard
              key={insight.genreId}
              insight={insight}
              genreName={genreMap.get(insight.genreId)?.name || insight.genreId}
              granularity={granularity}
            />
          ))}
        </div>
      )}
    </div>
  );
}
