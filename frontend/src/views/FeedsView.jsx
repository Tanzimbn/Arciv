import { useEffect, useState } from "react";
import { api } from "../api/client.js";

const STATUS_COLORS = {
  active: "bg-green-100 text-green-700",
  paused: "bg-gray-100 text-gray-500",
  degraded: "bg-amber-100 text-amber-700",
  dead: "bg-red-100 text-red-600",
};

const STATUS_LABELS = {
  active: "✅ Active",
  paused: "⏸️ Paused",
  degraded: "⚠️ Degraded",
  dead: "❌ Dead",
};

const STATUS_DESCRIPTIONS = {
  active: "Feed is working normally",
  paused: "Feed updates are paused",
  degraded: "Feed has been unreachable recently",
  dead: "Feed has been unreachable for a long time",
};

export default function FeedsView({ onBack }) {
  const [feeds, setFeeds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [discoverUrl, setDiscoverUrl] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discoverResult, setDiscoverResult] = useState(null);
  const [discoverError, setDiscoverError] = useState("");
  const [subscribing, setSubscribing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  useEffect(() => {
    fetchFeeds();
  }, []);

  async function fetchFeeds() {
    setLoading(true);
    try {
      setFeeds(await api.getFeeds());
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }

  async function handleDiscover(e) {
    e.preventDefault();
    setDiscoverError("");
    setDiscoverResult(null);
    setDiscovering(true);
    try {
      const result = await api.discoverFeed(discoverUrl);
      setDiscoverResult(result);
    } catch (err) {
      setDiscoverError(err.data?.detail || "No feed found at this URL.");
    } finally {
      setDiscovering(false);
    }
  }

  async function handleSubscribe() {
    if (!discoverResult) return;
    setSubscribing(true);
    try {
      const feed = await api.subscribeFeed({
        site_url: discoverUrl,
        feed_url: discoverResult.feed_url,
        title: discoverResult.title,
        favicon_url: discoverResult.favicon_url,
      });
      setFeeds((prev) => [feed, ...prev]);
      setDiscoverResult(null);
      setDiscoverUrl("");
    } catch (err) {
      setDiscoverError(err.data?.detail || "Failed to subscribe.");
    } finally {
      setSubscribing(false);
    }
  }

  async function handleTogglePause(feed) {
    const newStatus = feed.status === "paused" ? "active" : "paused";
    try {
      const updated = await api.updateFeed(feed.id, { status: newStatus });
      setFeeds((prev) => prev.map((f) => (f.id === feed.id ? updated : f)));
    } catch {
      // silently ignore
    }
  }

  async function handleCheckNow(feed) {
    try {
      await api.checkFeedNow(feed.id);
    } catch {
      // silently ignore
    }
  }

  async function handleDelete(id) {
    setDeleteConfirm(null);
    try {
      await api.deleteFeed(id);
      setFeeds((prev) => prev.filter((f) => f.id !== id));
    } catch {
      // silently ignore
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-sm text-gray-400 hover:text-gray-600 flex-shrink-0"
          >
            ← Back
          </button>
          <span className="font-bold text-gray-900 text-lg sm:text-xl">Feed Tracker</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Add source */}
        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Add source
          </h2>
          <form onSubmit={handleDiscover} className="flex flex-col sm:flex-row gap-2">
            <input
              type="url"
              required
              value={discoverUrl}
              onChange={(e) => {
                setDiscoverUrl(e.target.value);
                setDiscoverResult(null);
                setDiscoverError("");
              }}
              placeholder="https://blog.example.com or RSS feed URL"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={discovering}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {discovering ? "…" : "Discover"}
            </button>
          </form>

          {discoverError && (
            <p className="text-sm text-red-600 mt-2">{discoverError}</p>
          )}

          {discoverResult && (
            <div className="mt-3 flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{discoverResult.title}</p>
                <p className="text-xs text-gray-400">
                  {discoverResult.item_count} posts · {discoverResult.feed_url}
                </p>
              </div>
              <button
                onClick={handleSubscribe}
                disabled={subscribing}
                className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {subscribing ? "…" : "Subscribe"}
              </button>
            </div>
          )}
        </section>

        {/* Feed list */}
        {loading ? (
          <div className="text-sm text-gray-400 py-8 text-center">Loading…</div>
        ) : feeds.length === 0 ? (
          <div className="text-sm text-gray-400 py-12 text-center">
            No feeds yet. Add a blog or RSS source above.
          </div>
        ) : (
          <div className="space-y-3">
            {feeds.map((feed) => (
              <div
                key={feed.id}
                className="bg-white border border-gray-200 rounded-xl p-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {feed.favicon_url && (
                        <img
                          src={feed.favicon_url}
                          alt=""
                          className="w-4 h-4 rounded-sm object-contain"
                          onError={(e) => (e.target.style.display = "none")}
                        />
                      )}
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {feed.title || feed.feed_url}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          STATUS_COLORS[feed.status] ?? "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {STATUS_LABELS[feed.status] ?? feed.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1 truncate">{feed.feed_url}</p>
                    <div className="text-xs text-gray-400 mt-0.5 space-y-1">
                      <p>
                        {feed.total_items_received} posts received
                        {feed.last_checked_at && (
                          <> · checked {new Date(feed.last_checked_at).toLocaleDateString()}</>
                        )}
                      </p>
                      {(feed.status === "degraded" || feed.status === "dead") && (
                        <p className="text-amber-600 font-medium">
                          {STATUS_DESCRIPTIONS[feed.status]}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleCheckNow(feed)}
                      title="Check now"
                      className="text-xs px-3 py-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                    >
                      Refresh
                    </button>
                    <button
                      onClick={() => handleTogglePause(feed)}
                      className="text-xs px-3 py-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                    >
                      {feed.status === "paused" ? "Resume" : "Pause"}
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(feed.id)}
                      className="text-xs px-3 py-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-sm w-full">
            <p className="text-sm font-medium text-gray-900 mb-1">Remove this source?</p>
            <p className="text-xs text-gray-500 mb-4">
              Your saved items from it will not be deleted.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
