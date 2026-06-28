import { useEffect, useState } from "react";
import { api, errMessage } from "../api/client.js";

export default function AdminView({ onBack }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null); // id being deleted

  async function load() {
    setLoading(true);
    setError("");
    try {
      setUsers(await api.adminListUsers());
    } catch (err) {
      setError(err.status === 403 ? "Admin access only." : errMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(u) {
    if (!confirm(`Delete ${u.email}? This wipes all their links, feeds and data.`)) return;
    setBusy(u.id);
    setError("");
    try {
      await api.adminDeleteUser(u.id);
      setUsers((list) => list.filter((x) => x.id !== u.id));
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-gray-900">Admin · Users</h1>
          <button onClick={onBack} className="text-sm text-indigo-600 hover:underline">
            ← Back
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-4 py-2">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <div className="bg-white rounded-xl shadow-sm divide-y">
            {users.length === 0 && (
              <p className="text-sm text-gray-500 px-4 py-6">No users.</p>
            )}
            {users.map((u) => (
              <div key={u.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 truncate">
                      {u.email}
                    </span>
                    {u.is_admin && (
                      <span className="text-[10px] uppercase tracking-wide bg-indigo-100 text-indigo-700 rounded px-1.5 py-0.5">
                        admin
                      </span>
                    )}
                    {!u.email_verified && (
                      <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">
                        unverified
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 truncate">
                    {u.username || "—"} · {new Date(u.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => remove(u)}
                  disabled={u.is_admin || busy === u.id}
                  className="text-sm text-red-600 hover:text-red-700 disabled:opacity-30 disabled:cursor-not-allowed ml-4 shrink-0"
                  title={u.is_admin ? "Can't delete an admin" : "Delete user"}
                >
                  {busy === u.id ? "…" : "Delete"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}