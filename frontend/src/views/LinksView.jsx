import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import LinkCard from "../components/LinkCard.jsx";
import QueueTabs from "../components/QueueTabs.jsx";
import UrlInputBar from "../components/UrlInputBar.jsx";

export default function LinksView({ onLogout, onSettings, onFeeds }) {
  const [links, setLinks] = useState([]);
  const [activeQueue, setActiveQueue] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // link id awaiting confirmation

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getLinks(activeQueue ? { queue: activeQueue } : {});
      setLinks(data);
    } catch {
      // token may be expired
    } finally {
      setLoading(false);
    }
  }, [activeQueue]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  async function handleSave(url) {
    setSaveError("");
    setSaving(true);
    try {
      const link = await api.createLink(url);
      setLinks((prev) => [link, ...prev]);
    } catch (err) {
      if (err.status === 409) {
        setSaveError(err.data?.detail?.message ?? "Already saved.");
      } else {
        setSaveError("Failed to save link.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDone(id) {
    try {
      const updated = await api.updateLink(id, { status: "done" });
      setLinks((prev) => prev.map((l) => (l.id === id ? updated : l)));
      // remove from active queues (only show in archive)
      if (activeQueue !== "archive") {
        setLinks((prev) => prev.filter((l) => l.id !== id));
      }
    } catch {
      // silently ignore
    }
  }

  async function handleRetryAI(id) {
    try {
      const updated = await api.retryAI(id);
      setLinks((prev) => prev.map((l) => (l.id === id ? updated : l)));
    } catch {
      // silently ignore
    }
  }

  async function handleDeleteConfirmed(id) {
    setDeleteConfirm(null);
    try {
      await api.deleteLink(id);
      setLinks((prev) => prev.filter((l) => l.id !== id));
    } catch {
      // silently ignore
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <span className="font-bold text-gray-900 text-lg flex-shrink-0">
            Arciv
          </span>
          <div className="flex-1">
            <UrlInputBar onSave={handleSave} loading={saving} />
          </div>
          <button
            onClick={onFeeds}
            className="text-sm text-gray-400 hover:text-gray-600 flex-shrink-0"
          >
            Feeds
          </button>
          <button
            onClick={onSettings}
            className="text-sm text-gray-400 hover:text-gray-600 flex-shrink-0"
          >
            Settings
          </button>
          <button
            onClick={onLogout}
            className="text-sm text-gray-400 hover:text-gray-600 flex-shrink-0"
          >
            Logout
          </button>
        </div>
        {saveError && (
          <div className="max-w-3xl mx-auto px-4 pb-2">
            <p className="text-sm text-red-600">{saveError}</p>
          </div>
        )}
      </header>

      {/* Main content */}
      <main className="max-w-3xl mx-auto px-4 py-6">
        <div className="mb-4">
          <QueueTabs active={activeQueue} onChange={setActiveQueue} />
        </div>

        {loading ? (
          <div className="text-sm text-gray-400 py-8 text-center">
            Loading…
          </div>
        ) : links.length === 0 ? (
          <div className="text-sm text-gray-400 py-16 text-center">
            {activeQueue
              ? "No links in this queue yet."
              : "Paste a URL above to save your first link."}
          </div>
        ) : (
          <div className="space-y-3">
            {links.map((link) => (
              <LinkCard
                key={link.id}
                link={link}
                onDone={handleDone}
                onDelete={(id) => setDeleteConfirm(id)}
                onRetryAI={handleRetryAI}
              />
            ))}
          </div>
        )}
      </main>

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-sm w-full">
            <p className="text-sm font-medium text-gray-900 mb-4">
              Delete this link?
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteConfirmed(deleteConfirm)}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
