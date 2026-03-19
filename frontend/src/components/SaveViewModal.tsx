import { useState } from 'react';
import { api } from '../lib/api';
import type { SavedViewPayload, SavedViewVisibility } from '../types/savedView';

type Props = {
  open: boolean;
  onClose: () => void;
  initialPayload: SavedViewPayload;
  onSaved: (id: string) => void;
};

export function SaveViewModal({ open, onClose, initialPayload, onSaved }: Props) {
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<SavedViewVisibility>('private');
  const [emailsText, setEmailsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const parseEmails = () =>
    emailsText
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    if (visibility === 'shared' && parseEmails().length === 0) {
      setError('Add at least one email to share with');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const sharedWithEmails = visibility === 'shared' ? parseEmails() : undefined;
      const { id } = await api.savedViews.create({
        name: trimmed,
        payload: initialPayload,
        visibility,
        sharedWithEmails,
      });
      onSaved(id);
      setName('');
      setEmailsText('');
      setVisibility('private');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      role="dialog"
      aria-modal
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-[#dadce0]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[16px] font-semibold text-[#202124] mb-4">Save view</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-[#5f6368] mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-[13px] border border-[#dadce0] rounded-lg px-3 py-2 focus:outline-none focus:border-primary-500"
              placeholder="e.g. Q1 revenue rising"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#5f6368] mb-1">Who can access</label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as SavedViewVisibility)}
              className="w-full text-[13px] border border-[#dadce0] rounded-lg px-3 py-2 focus:outline-none focus:border-primary-500"
            >
              <option value="private">Only me</option>
              <option value="shared">Specific people (by email)</option>
              <option value="anyone">Anyone with the link</option>
            </select>
          </div>
          {visibility === 'shared' && (
            <div>
              <label className="block text-[12px] font-medium text-[#5f6368] mb-1">Emails (comma or space separated)</label>
              <textarea
                value={emailsText}
                onChange={(e) => setEmailsText(e.target.value)}
                rows={3}
                className="w-full text-[13px] border border-[#dadce0] rounded-lg px-3 py-2 focus:outline-none focus:border-primary-500"
                placeholder="colleague@unity3d.com"
              />
            </div>
          )}
          {error && <p className="text-[12px] text-[#c5221f]">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[13px] font-medium text-[#5f6368] hover:bg-[#f1f3f4] rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-[13px] font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
