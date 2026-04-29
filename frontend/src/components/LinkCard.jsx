const QUEUE_COLORS = {
  "watch-later": "bg-purple-100 text-purple-700",
  "read-later": "bg-blue-100 text-blue-700",
  "try-later": "bg-green-100 text-green-700",
  inbox: "bg-amber-100 text-amber-700",
};

const QUEUE_LABELS = {
  "watch-later": "Watch Later",
  "read-later": "Read Later",
  "try-later": "Try Later",
  inbox: "Inbox",
};

const AI_STATUS_LABELS = {
  pending: "Processing…",
  processing: "Processing…",
  done: null,
  failed: "AI failed",
  skipped: "Auto-classified",
};

function FaviconImg({ src, domain }) {
  return (
    <img
      src={src}
      alt=""
      className="w-4 h-4 rounded-sm object-contain flex-shrink-0"
      onError={(e) => {
        e.target.style.display = "none";
      }}
    />
  );
}

export default function LinkCard({ link, onDone, onDelete, onRetryAI }) {
  const domain = new URL(link.canonical_url).hostname.replace(/^www\./, "");
  const savedDate = new Date(link.saved_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const aiLabel = AI_STATUS_LABELS[link.ai_status];
  const isDone = link.status === "done";

  return (
    <div
      className={`bg-white border border-gray-200 rounded-xl p-4 flex gap-3 ${
        isDone ? "opacity-60" : ""
      }`}
    >
      <div className="pt-0.5">
        {link.favicon_url ? (
          <FaviconImg src={link.favicon_url} domain={domain} />
        ) : (
          <div className="w-4 h-4 bg-gray-200 rounded-sm" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-gray-900 hover:text-indigo-600 text-sm leading-snug line-clamp-2"
          >
            {link.title || link.url}
          </a>
          <div className="flex gap-1 flex-shrink-0">
            {!isDone && (
              <button
                onClick={() => onDone(link.id)}
                title="Mark as done"
                className="text-gray-400 hover:text-green-600 transition-colors text-xs px-2 py-1 rounded hover:bg-green-50"
              >
                ✓ Done
              </button>
            )}
            <button
              onClick={() => onDelete(link.id)}
              title="Delete"
              className="text-gray-400 hover:text-red-500 transition-colors text-xs px-2 py-1 rounded hover:bg-red-50"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-xs text-gray-400">{domain}</span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              QUEUE_COLORS[link.queue] ?? "bg-gray-100 text-gray-600"
            }`}
          >
            {QUEUE_LABELS[link.queue] ?? link.queue}
          </span>
          {link.content_type && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
              {link.content_type}
            </span>
          )}
          {link.fetch_status === "unreachable" && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600">
              unreachable
            </span>
          )}
        </div>

        <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">
          {link.ai_status === "done" && link.ai_summary ? (
            <span className="italic">{link.ai_summary}</span>
          ) : aiLabel ? (
            <span className="text-gray-400">{aiLabel}</span>
          ) : (
            link.description
          )}
        </p>

        {link.ai_status === "failed" && (
          <button
            onClick={() => onRetryAI(link.id)}
            className="mt-1.5 text-xs text-indigo-600 hover:underline"
          >
            Retry AI
          </button>
        )}

        {link.ai_tags && link.ai_tags.length > 0 && (
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {link.ai_tags.map((tag) => (
              <span
                key={tag}
                className="text-xs px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <p className="text-xs text-gray-400 mt-1.5">{savedDate}</p>
      </div>
    </div>
  );
}
