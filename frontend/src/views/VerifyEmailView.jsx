import { useEffect, useState } from "react";
import { api } from "../api/client.js";

export default function VerifyEmailView({ onDone }) {
  const [state, setState] = useState("verifying"); // verifying | ok | error
  const [message, setMessage] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setState("error");
      setMessage("Missing verification token.");
      return;
    }
    api
      .verifyEmail(token)
      .then((data) => {
        setState("ok");
        setMessage(data.message || "Email verified.");
      })
      .catch((err) => {
        setState("error");
        setMessage(err.data?.detail || "Verification failed.");
      });
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full max-w-sm p-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-3">Email verification</h1>
        {state === "verifying" && <p className="text-sm text-gray-500">Verifying…</p>}
        {state === "ok" && <p className="text-sm text-green-600">{message}</p>}
        {state === "error" && <p className="text-sm text-red-600">{message}</p>}
        {state !== "verifying" && (
          <button
            onClick={onDone}
            className="mt-5 w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700"
          >
            Go to sign in
          </button>
        )}
      </div>
    </div>
  );
}