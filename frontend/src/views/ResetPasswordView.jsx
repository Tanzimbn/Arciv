import { useState } from "react";
import { api } from "../api/client.js";

export default function ResetPasswordView({ onDone }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const token = new URLSearchParams(window.location.search).get("token");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!token) {
      setError("Missing reset token.");
      return;
    }
    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      const detail = err.data?.detail;
      setError(
        Array.isArray(detail) ? detail[0]?.msg : detail || "Reset failed."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full max-w-sm p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Choose a new password</h1>
        {done ? (
          <>
            <p className="text-sm text-green-600 mt-4">
              Password updated. You can now sign in.
            </p>
            <button
              onClick={onDone}
              className="mt-5 w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700"
            >
              Go to sign in
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            <input
              type="password"
              required
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-gray-400">
              At least 8 characters, with an uppercase letter, lowercase letter, and a digit.
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? "..." : "Update password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}