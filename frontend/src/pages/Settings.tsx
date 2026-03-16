import { useState, useMemo } from 'react';
import { useGenres } from '../hooks/useGenres';
import { useFetchLogs } from '../hooks/useFetchLogs';
import { api } from '../lib/api';

const GENRE_COLORS = [
  { bg: '#e8f0fe', text: '#1a73e8', border: '#aecbfa' },
  { bg: '#e6f4ea', text: '#137333', border: '#ceead6' },
  { bg: '#fef7e0', text: '#b06000', border: '#fdd663' },
  { bg: '#fce8e6', text: '#c5221f', border: '#f4c7c3' },
  { bg: '#f3e8fd', text: '#7627bb', border: '#d7aefb' },
  { bg: '#e0f7fa', text: '#00695c', border: '#80deea' },
  { bg: '#fff3e0', text: '#e65100', border: '#ffcc80' },
  { bg: '#fce4ec', text: '#b71c1c', border: '#f48fb1' },
];

const COMMON_CATEGORIES = [
  { label: 'Games (All)', ios: '6014', android: 'GAME' },
  { label: 'Hypercasual', ios: '7003', android: 'GAME_CASUAL' },
  { label: 'Puzzle', ios: '7012', android: 'GAME_PUZZLE' },
  { label: 'Match / Word', ios: '7019', android: 'GAME_WORD' },
  { label: 'Action', ios: '7001', android: 'GAME_ACTION' },
  { label: 'Strategy', ios: '7017', android: 'GAME_STRATEGY' },
  { label: 'RPG', ios: '7014', android: 'GAME_ROLE_PLAYING' },
  { label: 'Simulation', ios: '7016', android: 'GAME_SIMULATION' },
  { label: 'Casino', ios: '7006', android: 'GAME_CASINO' },
  { label: 'Adventure', ios: '7002', android: 'GAME_ADVENTURE' },
  { label: 'Racing', ios: '7013', android: 'GAME_RACING' },
  { label: 'Sports', ios: '7015', android: 'GAME_SPORTS' },
  { label: 'Board', ios: '7004', android: 'GAME_BOARD' },
  { label: 'Trivia', ios: '7018', android: 'GAME_TRIVIA' },
];

const COUNTRIES = [
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'CA', label: 'Canada' },
  { code: 'AU', label: 'Australia' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'JP', label: 'Japan' },
  { code: 'KR', label: 'South Korea' },
  { code: 'BR', label: 'Brazil' },
  { code: 'IN', label: 'India' },
  { code: 'IT', label: 'Italy' },
  { code: 'ES', label: 'Spain' },
  { code: 'MX', label: 'Mexico' },
  { code: 'RU', label: 'Russia' },
  { code: 'TR', label: 'Turkey' },
  { code: 'CN', label: 'China' },
  { code: 'TW', label: 'Taiwan' },
  { code: 'ID', label: 'Indonesia' },
  { code: 'TH', label: 'Thailand' },
  { code: 'PH', label: 'Philippines' },
];

const TIMELINE_OPTIONS = [
  { value: 3, label: '3 months' },
  { value: 6, label: '6 months' },
  { value: 9, label: '9 months' },
  { value: 12, label: '12 months' },
];

export default function Settings() {
  const { genres, loading: genresLoading } = useGenres();
  const { logs, loading: logsLoading } = useFetchLogs(20);

  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState('');
  const [newName, setNewName] = useState('');
  const [newIos, setNewIos] = useState('');
  const [newAndroid, setNewAndroid] = useState('');
  const [newCountry, setNewCountry] = useState('US');
  const [newMonthsBack, setNewMonthsBack] = useState(6);
  const [saving, setSaving] = useState(false);

  const [selectedFetchIds, setSelectedFetchIds] = useState<Set<string>>(new Set());
  const [fetching, setFetching] = useState(false);
  const [fetchMessage, setFetchMessage] = useState('');
  const [fetchProgress, setFetchProgress] = useState<{ current: number; total: number; label: string } | null>(null);

  const handlePresetChange = (label: string) => {
    setSelectedPreset(label);
    const preset = COMMON_CATEGORIES.find((c) => c.label === label);
    if (preset) {
      setNewName(preset.label);
      setNewIos(preset.ios);
      setNewAndroid(preset.android);
    }
  };

  const resetForm = () => {
    setNewName(''); setNewIos(''); setNewAndroid('');
    setNewCountry('US'); setNewMonthsBack(6);
    setSelectedPreset(''); setShowAddForm(false);
  };

  const handleAddGenre = async () => {
    if (!newName || !newIos || !newAndroid) return;
    setSaving(true);
    try {
      await api.addGenre(newName, { ios: newIos, android: newAndroid }, newCountry, newMonthsBack);
      resetForm();
    } catch (error) {
      console.error('Failed to add genre:', error);
      alert('Failed to add genre. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', ios: '', android: '', country: 'US', monthsBack: 6 });
  const [editSaving, setEditSaving] = useState(false);

  const startEdit = (genre: typeof genres[0]) => {
    setEditingId(genre.id);
    setEditForm({
      name: genre.name,
      ios: genre.categoryIds.ios,
      android: genre.categoryIds.android,
      country: genre.country || 'US',
      monthsBack: genre.monthsBack || 6,
    });
  };

  const cancelEdit = () => { setEditingId(null); };

  const handleSaveEdit = async () => {
    if (!editingId || !editForm.name || !editForm.ios || !editForm.android) return;
    setEditSaving(true);
    try {
      await api.updateGenre(editingId, {
        name: editForm.name,
        categoryIds: { ios: editForm.ios, android: editForm.android },
        country: editForm.country,
        monthsBack: editForm.monthsBack,
      });
      setEditingId(null);
    } catch (error) {
      console.error('Failed to update genre:', error);
      alert('Failed to update genre.');
    } finally {
      setEditSaving(false);
    }
  };

  const handleToggleActive = async (genreId: string, currentActive: boolean) => {
    try {
      await api.updateGenre(genreId, { active: !currentActive });
    } catch (error) {
      console.error('Failed to update genre:', error);
    }
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (genreId: string, name: string) => {
    if (!confirm(`Delete "${name}" and all its fetched data (snapshots, apps, comments)? This cannot be undone.`)) return;
    setDeletingId(genreId);
    try {
      await api.deleteGenre(genreId);
    } catch (error) {
      console.error('Failed to delete genre:', error);
    } finally {
      setDeletingId(null);
    }
  };

  const toggleFetchSelection = (id: string) => {
    setSelectedFetchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedFetchIds.size === genres.length) setSelectedFetchIds(new Set());
    else setSelectedFetchIds(new Set(genres.map((g) => g.id)));
  };

  const handleFetchSelected = async () => {
    if (selectedFetchIds.size === 0) return;
    setFetching(true);
    setFetchMessage('');
    setFetchProgress(null);

    try {
      const ids = Array.from(selectedFetchIds);
      const { plan } = await api.fetchPlan(ids);

      const allSteps: { genreId: string; genreName: string; month: string; startDate: string; endDate: string }[] = [];
      for (const g of plan) {
        for (const m of g.months) {
          allSteps.push({ genreId: g.genreId, genreName: g.genreName, ...m });
        }
      }

      const errors: string[] = [];
      let completed = 0;

      for (const step of allSteps) {
        setFetchProgress({ current: completed + 1, total: allSteps.length, label: `${step.genreName} ${step.month}` });
        try {
          const result = await api.fetchMonth(step.genreId, step.month, step.startDate, step.endDate);
          if (!result.success && result.error) {
            errors.push(result.error);
          }
        } catch (err) {
          errors.push(`${step.genreName} ${step.month}: ${err instanceof Error ? err.message : 'Failed'}`);
        }
        completed++;
      }

      setFetchProgress(null);
      if (errors.length === 0) {
        setFetchMessage(`Successfully fetched ${allSteps.length} months across ${plan.length} genre(s)`);
      } else {
        setFetchMessage(`Completed with ${errors.length} error(s): ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '...' : ''}`);
      }
      setSelectedFetchIds(new Set());
    } catch (error) {
      setFetchProgress(null);
      setFetchMessage(`Fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setFetching(false);
    }
  };

  const genreColorMap = useMemo(() => {
    const map = new Map<string, typeof GENRE_COLORS[0]>();
    genres.forEach((g, i) => map.set(g.id, GENRE_COLORS[i % GENRE_COLORS.length]));
    return map;
  }, [genres]);

  const selectClass = 'border border-[#dadce0] rounded-lg px-3 py-2 text-[13px] text-[#202124] bg-white focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors';
  const inputClass = selectClass + ' w-full';

  return (
    <div className="max-w-3xl">
      <h1 className="text-[22px] font-semibold text-[#202124] tracking-[-0.01em] mb-0.5">Settings</h1>
      <p className="text-[13px] text-[#5f6368] mb-8">Configure data sources, genres, and fetch schedules</p>

      {/* Add Genre */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-semibold text-[#202124]">Genres</h2>
          <button onClick={() => setShowAddForm(!showAddForm)}
            className={`inline-flex items-center gap-1.5 px-3 py-[7px] rounded-lg text-[13px] font-medium transition-all duration-150 ${
              showAddForm
                ? 'bg-[#f1f3f4] text-[#5f6368] hover:bg-[#e8eaed]'
                : 'bg-primary-600 text-white hover:bg-primary-700 shadow-[0_1px_2px_0_rgba(60,64,67,0.3)]'
            }`}>
            {showAddForm ? 'Cancel' : '+ Add Genre'}
          </button>
        </div>

        {showAddForm && (
          <div className="bg-white rounded-xl border border-[#dadce0] p-5 mb-4 shadow-[0_1px_2px_0_rgba(60,64,67,0.1)]">
            <h3 className="text-[13px] font-semibold text-[#202124] mb-4">New Genre Configuration</h3>

            {/* Filter bar row 1 - like Sensor Tower */}
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#5f6368] uppercase tracking-wide mb-1">Genre Preset</label>
                <select value={selectedPreset} onChange={(e) => handlePresetChange(e.target.value)} className={inputClass}>
                  <option value="">Custom...</option>
                  {COMMON_CATEGORIES.map((c) => (
                    <option key={c.label} value={c.label}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#5f6368] uppercase tracking-wide mb-1">Country</label>
                <select value={newCountry} onChange={(e) => setNewCountry(e.target.value)} className={inputClass}>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#5f6368] uppercase tracking-wide mb-1">Timeline</label>
                <select value={newMonthsBack} onChange={(e) => setNewMonthsBack(Number(e.target.value))} className={inputClass}>
                  {TIMELINE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Filter bar row 2 - custom IDs */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-[11px] font-semibold text-[#5f6368] uppercase tracking-wide mb-1">Genre Name</label>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Hypercasual" className={inputClass} />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#5f6368] uppercase tracking-wide mb-1">iOS Category ID</label>
                <input type="text" value={newIos} onChange={(e) => setNewIos(e.target.value)} placeholder="e.g. 7003" className={inputClass} />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#5f6368] uppercase tracking-wide mb-1">Android Category ID</label>
                <input type="text" value={newAndroid} onChange={(e) => setNewAndroid(e.target.value)} placeholder="e.g. GAME_CASUAL" className={inputClass} />
              </div>
            </div>

            <button onClick={handleAddGenre} disabled={saving || !newName || !newIos || !newAndroid}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-[13px] font-medium hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-[0_1px_2px_0_rgba(60,64,67,0.3)]">
              {saving ? 'Saving...' : 'Add Genre'}
            </button>
          </div>
        )}

        {/* Genre list */}
        {genresLoading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => (<div key={i} className="h-14 bg-[#f1f3f4] rounded-xl animate-pulse" />))}</div>
        ) : genres.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#dadce0] p-8 text-center text-[13px] text-[#5f6368]">No genres configured yet.</div>
        ) : (
          <div className="bg-white rounded-xl border border-[#dadce0] overflow-hidden shadow-[0_1px_2px_0_rgba(60,64,67,0.1)]">
            <div className="grid grid-cols-[1fr_80px_70px_80px_auto] items-center gap-3 px-4 py-2 border-b border-[#e8eaed] bg-[#f8f9fa]">
              <span className="text-[11px] font-semibold text-[#5f6368] uppercase tracking-wide">Genre</span>
              <span className="text-[11px] font-semibold text-[#5f6368] uppercase tracking-wide">Country</span>
              <span className="text-[11px] font-semibold text-[#5f6368] uppercase tracking-wide">Timeline</span>
              <span className="text-[11px] font-semibold text-[#5f6368] uppercase tracking-wide">Status</span>
              <span />
            </div>
            {genres.map((genre, i) => {
              const isEditing = editingId === genre.id;
              const isDeleting = deletingId === genre.id;

              if (isEditing) {
                return (
                  <div key={genre.id} className={`px-4 py-3 ${i > 0 ? 'border-t border-[#e8eaed]' : ''} bg-[#f8f9fa]`}>
                    <div className="grid grid-cols-3 gap-2.5 mb-2.5">
                      <div>
                        <label className="block text-[10px] font-semibold text-[#5f6368] uppercase tracking-wide mb-0.5">Name</label>
                        <input type="text" value={editForm.name} onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))}
                          className={inputClass} />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-[#5f6368] uppercase tracking-wide mb-0.5">Country</label>
                        <select value={editForm.country} onChange={(e) => setEditForm(f => ({ ...f, country: e.target.value }))} className={inputClass}>
                          {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-[#5f6368] uppercase tracking-wide mb-0.5">Timeline</label>
                        <select value={editForm.monthsBack} onChange={(e) => setEditForm(f => ({ ...f, monthsBack: Number(e.target.value) }))} className={inputClass}>
                          {TIMELINE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2.5 mb-3">
                      <div>
                        <label className="block text-[10px] font-semibold text-[#5f6368] uppercase tracking-wide mb-0.5">iOS Category ID</label>
                        <input type="text" value={editForm.ios} onChange={(e) => setEditForm(f => ({ ...f, ios: e.target.value }))} className={inputClass} />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-[#5f6368] uppercase tracking-wide mb-0.5">Android Category ID</label>
                        <input type="text" value={editForm.android} onChange={(e) => setEditForm(f => ({ ...f, android: e.target.value }))} className={inputClass} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={handleSaveEdit} disabled={editSaving || !editForm.name || !editForm.ios || !editForm.android}
                        className="px-3 py-[6px] bg-primary-600 text-white rounded-lg text-[12px] font-medium hover:bg-primary-700 disabled:opacity-40 transition-colors">
                        {editSaving ? 'Saving...' : 'Save'}
                      </button>
                      <button onClick={cancelEdit}
                        className="px-3 py-[6px] text-[12px] font-medium text-[#5f6368] border border-[#dadce0] rounded-lg hover:bg-[#f1f3f4] transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div key={genre.id}
                  className={`grid grid-cols-[1fr_80px_70px_80px_auto] items-center gap-3 px-4 py-2.5 ${i > 0 ? 'border-t border-[#e8eaed]' : ''} hover:bg-[#f8f9fa] transition-colors`}>
                  <div>
                    <span className="text-[13px] font-medium text-[#202124]">{genre.name}</span>
                    <span className="text-[11px] text-[#80868b] ml-2">iOS: {genre.categoryIds.ios} &middot; Android: {genre.categoryIds.android}</span>
                  </div>
                  <span className="text-[12px] text-[#3c4043]">{genre.country || 'US'}</span>
                  <span className="text-[12px] text-[#3c4043]">{genre.monthsBack || 6}mo</span>
                  <button onClick={() => handleToggleActive(genre.id, genre.active)}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded-full transition-colors ${
                      genre.active ? 'bg-[#e6f4ea] text-[#137333] hover:bg-[#ceead6]' : 'bg-[#f1f3f4] text-[#5f6368] hover:bg-[#e8eaed]'
                    }`}>
                    {genre.active ? 'Active' : 'Inactive'}
                  </button>
                  <div className="flex items-center gap-0.5">
                    <button onClick={() => startEdit(genre)}
                      className="p-1.5 text-[#80868b] hover:text-primary-600 hover:bg-primary-50 rounded-full transition-colors" title="Edit genre">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                      </svg>
                    </button>
                    <button onClick={() => handleDelete(genre.id, genre.name)} disabled={isDeleting}
                      className="p-1.5 text-[#80868b] hover:text-[#c5221f] hover:bg-[#fce8e6] rounded-full transition-colors disabled:opacity-40" title="Delete genre and data">
                      {isDeleting ? (
                        <div className="w-4 h-4 border-[1.5px] border-[#f4c7c3] border-t-[#c5221f] rounded-full animate-spin" />
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Fetch Data */}
      {genres.length > 0 && (
        <section className="mb-10">
          <h2 className="text-[15px] font-semibold text-[#202124] mb-3">Fetch Data</h2>
          <div className="bg-white rounded-xl border border-[#dadce0] p-4 shadow-[0_1px_2px_0_rgba(60,64,67,0.1)]">
            <p className="text-[12px] text-[#5f6368] mb-3">Select genres to pull data from Sensor Tower:</p>
            <div className="flex items-center gap-2 flex-wrap mb-4">
              {genres.map((genre) => {
                const isSelected = selectedFetchIds.has(genre.id);
                const color = genreColorMap.get(genre.id) || GENRE_COLORS[0];
                return (
                  <button
                    key={genre.id}
                    onClick={() => toggleFetchSelection(genre.id)}
                    className={`inline-flex items-center px-3 py-1.5 rounded-full text-[12px] font-medium transition-all duration-150 border ${
                      isSelected ? '' : 'bg-white text-[#5f6368] border-[#dadce0] hover:bg-[#f1f3f4]'
                    }`}
                    style={isSelected ? { backgroundColor: color.bg, color: color.text, borderColor: color.border } : undefined}
                  >
                    {genre.name}
                    {isSelected && (
                      <span className="ml-1.5 text-[10px] opacity-60">{genre.country || 'US'} &middot; {genre.monthsBack || 6}mo</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={toggleSelectAll}
                className="px-3 py-[7px] text-[12px] font-medium text-[#5f6368] border border-[#dadce0] rounded-lg hover:bg-[#f1f3f4] transition-colors bg-white">
                {selectedFetchIds.size === genres.length ? 'Deselect All' : 'Select All'}
              </button>
              <button onClick={handleFetchSelected} disabled={fetching || selectedFetchIds.size === 0}
                className="inline-flex items-center gap-1.5 px-4 py-[7px] bg-primary-600 text-white rounded-lg text-[12px] font-medium hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-[0_1px_2px_0_rgba(60,64,67,0.3)]">
                {fetching && <div className="w-3.5 h-3.5 border-[1.5px] border-white/30 border-t-white rounded-full animate-spin" />}
                {fetching ? 'Fetching...' : `Fetch Data (${selectedFetchIds.size})`}
              </button>
            </div>
          </div>

          {fetchProgress && (
            <div className="mt-3 bg-white border border-[#dadce0] rounded-lg p-4 shadow-[0_1px_2px_0_rgba(60,64,67,0.1)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-medium text-[#202124]">
                  Fetching {fetchProgress.label}...
                </span>
                <span className="text-[12px] text-[#5f6368]">
                  {fetchProgress.current} / {fetchProgress.total}
                </span>
              </div>
              <div className="w-full bg-[#e8eaed] rounded-full h-1.5">
                <div className="bg-primary-600 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${(fetchProgress.current / fetchProgress.total) * 100}%` }} />
              </div>
            </div>
          )}

          {fetchMessage && !fetchProgress && (
            <div className={`mt-3 px-4 py-3 rounded-lg text-[13px] ${
              fetchMessage.includes('failed') || fetchMessage.includes('error') ? 'bg-[#fce8e6] text-[#c5221f]' : 'bg-[#e6f4ea] text-[#137333]'
            }`}>
              {fetchMessage}
            </div>
          )}
        </section>
      )}

      {/* Fetch History */}
      <section>
        <h2 className="text-[15px] font-semibold text-[#202124] mb-4">Fetch History</h2>
        {logsLoading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => (<div key={i} className="h-10 bg-[#f1f3f4] rounded animate-pulse" />))}</div>
        ) : logs.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#dadce0] p-8 text-center text-[13px] text-[#5f6368]">No fetch history yet.</div>
        ) : (
          <div className="bg-white rounded-xl border border-[#dadce0] overflow-hidden shadow-[0_1px_2px_0_rgba(60,64,67,0.1)]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e8eaed] bg-[#f8f9fa]">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#5f6368] uppercase tracking-wider">Status</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#5f6368] uppercase tracking-wider">Started</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#5f6368] uppercase tracking-wider">Genres</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#5f6368] uppercase tracking-wider">Errors</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, i) => (
                  <tr key={log.id} className={`hover:bg-[#f8f9fa] transition-colors ${i > 0 ? 'border-t border-[#f1f3f4]' : ''}`}>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        log.status === 'completed' ? 'bg-[#e6f4ea] text-[#137333]' :
                        log.status === 'running' ? 'bg-primary-50 text-primary-700' :
                        'bg-[#fce8e6] text-[#c5221f]'
                      }`}>{log.status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-[#3c4043]">{log.startedAt.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-[13px] text-[#3c4043]">{log.genresProcessed.join(', ') || '--'}</td>
                    <td className="px-4 py-2.5 text-[13px] text-[#3c4043]">
                      {log.errors.length > 0 ? (<span className="text-[#c5221f]" title={log.errors.join('\n')}>{log.errors.length} error{log.errors.length !== 1 ? 's' : ''}</span>) : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
