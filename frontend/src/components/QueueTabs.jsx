const TABS = [
  { key: null, label: "All" },
  { key: "watch-later", label: "Watch Later" },
  { key: "read-later", label: "Read Later" },
  { key: "try-later", label: "Try Later" },
  { key: "inbox", label: "Inbox" },
  { key: "archive", label: "Archive" },
];

export default function QueueTabs({ active, onChange }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {TABS.map(({ key, label }) => (
        <button
          key={String(key)}
          onClick={() => onChange(key)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            active === key
              ? "bg-indigo-600 text-white"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
