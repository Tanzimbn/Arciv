import { useEffect, useState } from "react";
import { api } from "../api/client.js";

const PROVIDERS = ["gemini", "groq", "anthropic", "openai", "ollama"];

export default function SettingsView({ onBack }) {
  const [settings, setSettings] = useState(null);
  const [provider, setProvider] = useState("gemini");
  const [apiKey, setApiKey] = useState("");
  const [notifyTelegram, setNotifyTelegram] = useState(false);
  const [notifyInApp, setNotifyInApp] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      setProvider(s.ai_provider || "gemini");
      setNotifyTelegram(s.feed_notify_telegram);
      setNotifyInApp(s.feed_notify_inapp);
    });
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const patch = {
        ai_provider: provider,
        feed_notify_telegram: notifyTelegram,
        feed_notify_inapp: notifyInApp,
      };
      if (apiKey) patch.ai_api_key = apiKey;
      const updated = await api.updateSettings(patch);
      setSettings(updated);
      setApiKey("");
      setSuccess("Settings saved.");
    } catch {
      setError("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.testAI();
      setTestResult(r);
    } catch {
      setTestResult({ success: false, message: "Request failed." });
    } finally {
      setTesting(false);
    }
  }

  async function handleClearKey() {
    try {
      const updated = await api.updateSettings({ ai_api_key: "" });
      setSettings(updated);
    } catch {
      setError("Failed to clear key.");
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            ← Back
          </button>
          <span className="font-bold text-gray-900">Settings</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {settings === null ? (
          <div className="text-sm text-gray-400 py-8 text-center">Loading…</div>
        ) : (
          <form onSubmit={handleSave} className="space-y-6">
            <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                AI Classification
              </h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Provider
                </label>
                <select
                  value={provider}
                  onChange={(e) => {
                    setProvider(e.target.value);
                    setTestResult(null);
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  API Key
                </label>
                {settings.ai_api_key_masked && (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm text-gray-500 font-mono">
                      {settings.ai_api_key_masked}
                    </span>
                    <button
                      type="button"
                      onClick={handleClearKey}
                      className="text-xs text-red-500 hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                )}
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    settings.ai_api_key_masked
                      ? "Enter new key to replace"
                      : "Enter API key"
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testing}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {testing ? "Testing…" : "Test connection"}
                </button>
                {testResult && (
                  <span
                    className={`text-sm ${
                      testResult.success ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {testResult.success ? "✓ " : "✕ "}
                    {testResult.message}
                  </span>
                )}
              </div>
            </section>

            <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Notifications
              </h2>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm text-gray-700">In-app notifications</span>
                <input
                  type="checkbox"
                  checked={notifyInApp}
                  onChange={(e) => setNotifyInApp(e.target.checked)}
                  className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
                />
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm text-gray-700">Telegram notifications</span>
                <input
                  type="checkbox"
                  checked={notifyTelegram}
                  onChange={(e) => setNotifyTelegram(e.target.checked)}
                  className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
                />
              </label>
            </section>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {success && <p className="text-sm text-green-600">{success}</p>}

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
