import { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { db } from '../lib/firebase';
import { generateInsights } from '../lib/api';
import { useInsights } from '../hooks/useInsights';
import type { Genre, InsightGame, GenreInsightDoc } from '../types';

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

function GameCard({ game, isExpanded, onToggle }: {
  game: InsightGame;
  isExpanded: boolean;
  onToggle: () => void;
}) {
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
        <div className="mt-3 space-y-2">
          <p className="text-sm text-gray-700">{game.explanation}</p>
          <div className="space-y-1">
            <SubScoreBar label="Rev. Accel." value={game.subScores.revenueAcceleration} />
            <SubScoreBar label="DL Momentum" value={game.subScores.downloadMomentum} />
            <SubScoreBar label="Anomaly" value={game.subScores.anomalyScore} />
            <SubScoreBar label="Convergence" value={game.subScores.crossMetricConvergence} />
          </div>
        </div>
      )}
    </div>
  );
}

function GenreInsightCard({ insight, genreName }: { insight: GenreInsightDoc; genreName: string }) {
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
          />
        ))}
      </div>
      {insight.watchList.length > 0 && (
        <>
          <h3 className="text-sm font-medium text-gray-700 mt-6 mb-3">Watch List</h3>
          <div className="space-y-2">
            {insight.watchList.map(item => (
              <div key={item.appId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <span className="text-sm font-medium text-gray-900">{item.appName}</span>
                  <span className="text-xs text-gray-500 ml-2">{item.publisherName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{item.reason}</span>
                  <ScoreBadge score={item.score} />
                </div>
              </div>
            ))}
          </div>
        </>
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
