import { useState } from "react";
import { api } from "../api/client.js";

export default function ForgotPasswordView({ onDone }) {
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setNotice("");
    try {
      const data = await api.forgotPassword(email);
      setNotice(data.message || "If that account exists, an email is on its way.");
    } catch {
      setNotice("If that account exists, an email is on its way.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full max-w-sm p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Reset password</h1>
        <p className="text-sm text-gray-500 mb-6">
          Enter your email and we'll send a reset link.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {notice && <p className="text-sm text-green-600">{notice}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? "..." : "Send reset link"}
          </button>
        </form>
        <p className="text-sm text-gray-500 mt-4 text-center">
          <button onClick={onDone} className="text-indigo-600 hover:underline">
            Back to sign in
          </button>
        </p>
      </div>
    </div>
  );
}