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
  const [telegramToken, setTelegramToken] = useState("");
  const [generatingToken, setGeneratingToken] = useState(false);

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

  async function handleGenerateTelegramToken() {
    setGeneratingToken(true);
    setError("");
    try {
      const response = await api.generateTelegramToken();
      setTelegramToken(response.token);
      setSuccess("Token generated! Copy this token and send it to the Arciv bot.");
    } catch {
      setError("Failed to generate token.");
    } finally {
      setGeneratingToken(false);
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
          <span className="font-bold text-gray-900 text-lg sm:text-xl">Settings</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {settings === null ? (
          <div className="text-sm text-gray-400 py-8 text-center">Loading…</div>
        ) : (
          <form onSubmit={handleSave} className="space-y-6">
            <section className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 space-y-4">
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

            <section className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 space-y-4">
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

            <section className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 space-y-4">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Telegram Bot
              </h2>
              <div className="text-sm text-gray-600">
                <p className="mb-2">
                  Link your Telegram account to receive daily digests and save links by forwarding them to the bot.
                </p>
                <p className="text-xs text-gray-500">
                  1. Generate a token below<br/>
                  2. Send <code className="bg-gray-100 px-1 rounded">/start &lt;token&gt;</code> to @arciv_bot<br/>
                  3. Your account will be linked automatically
                </p>
              </div>
              
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={handleGenerateTelegramToken}
                  disabled={generatingToken}
                  className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {generatingToken ? "Generating..." : "Generate linking token"}
                </button>
                
                {telegramToken && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <p className="text-xs font-medium text-gray-700 mb-2">Your token (copy this):</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-white border border-gray-300 rounded px-2 py-1 text-xs font-mono break-all">
                        {telegramToken}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(telegramToken);
                          setSuccess("Token copied to clipboard!");
                        }}
                        className="px-2 py-1 text-xs bg-gray-200 hover:bg-gray-300 rounded transition-colors"
                      >
                        Copy
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      Send this to @arciv_bot: <code className="bg-gray-100 px-1 rounded">/start {telegramToken}</code>
                    </p>
                  </div>
                )}
              </div>
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
