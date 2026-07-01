import { useEffect, useMemo, useState } from "react";
import { api, errMessage } from "../api/client.js";
import SubpageNav from "../components/SubpageNav.jsx";
import "./admin.css";

/* ── inline icons (match the app's stroke style) ─────────────── */
const IconUsers = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
);
const IconBolt = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>
);
const IconUser = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
);
const IconUserPlus = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>
);
const IconTrash = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
);

const AV_COLORS = ["#6d3aff", "#14a974", "#ff6b3d", "#2a6fdb", "#b18800"];
function avatarColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffff;
  return AV_COLORS[h % AV_COLORS.length];
}
function initials(name) {
  return name.split(/[\s_.@]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}
const dayNum = (iso) => new Date(iso + "T00:00:00").getDate();
const shortDate = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function AdminView({ onBack }) {
  const [tab, setTab] = useState("overview");
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.adminStats(30).then(setStats).catch((e) =>
      setError(e.status === 403 ? "Admin access only." : errMessage(e))
    );
    api.adminListUsers().then(setUsers).catch((e) =>
      setError(e.status === 403 ? "Admin access only." : errMessage(e))
    );
  }, []);

  const today = useMemo(
    () => new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }),
    []
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <div style={{ paddingTop: 12 }}>
        <SubpageNav onBack={onBack} />
      </div>

      <div className="adm">
        <header className="head">
          <div>
            <div className="eyebrow"><span className="pulse" /> Admin console · Live</div>
            <h1 className="title">Admin <em>overview</em></h1>
          </div>
          <div className="head-meta">
            Updated <b>just now</b><br />
            {today}
          </div>
        </header>

        <nav className="tabs">
          <button className={"tab" + (tab === "overview" ? " on" : "")} onClick={() => setTab("overview")}>
            Overview
          </button>
          <button className={"tab" + (tab === "users" ? " on" : "")} onClick={() => setTab("users")}>
            Users {users && <span className="cnt">{users.length}</span>}
          </button>
        </nav>

        {error && <div className="adm-msg err">{error}</div>}

        {tab === "overview" ? <Overview stats={stats} /> : <Users users={users} setUsers={setUsers} />}
      </div>
    </div>
  );
}

/* ── Overview ─────────────────────────────────────────────────── */
function Overview({ stats }) {
  if (!stats) return <div className="adm-loading">Loading…</div>;

  const { totals, traffic, user_growth } = stats;
  const days = traffic.map((t, i) => ({
    date: t.date,
    req: t.requests,
    uni: t.unique_visitors,
    sig: user_growth[i]?.signups ?? 0,
    isToday: i === traffic.length - 1,
  }));

  const sig30 = user_growth.reduce((a, b) => a + b.signups, 0);
  const spark = (key) => days.slice(-10).map((d) => d[key]);

  const last = days[days.length - 1] || { req: 0, uni: 0 };
  const prev = days[days.length - 2] || { req: 0, uni: 0 };

  return (
    <section>
      <div className="stats">
        <Stat label="Total users" icoBg="var(--accent-tint)" icoColor="var(--accent)" ico={<IconUsers />}
          num={totals.users} delta={{ dir: "flat", text: `${totals.verified} verified` }} />
        <Stat label="Requests today" icoBg="var(--accent-tint)" icoColor="var(--accent)" ico={<IconBolt />}
          num={totals.requests_today} delta={pctDelta(last.req, prev.req)} spark={spark("req")} sparkColor="var(--accent)" />
        <Stat label="Unique today" icoBg="var(--watch-tint)" icoColor="var(--watch)" ico={<IconUser />}
          num={totals.unique_today} delta={pctDelta(last.uni, prev.uni)} spark={spark("uni")} sparkColor="var(--watch)" />
        <Stat label="Signups · 30d" icoBg="var(--try-tint)" icoColor="var(--try)" ico={<IconUserPlus />}
          num={sig30} delta={{ dir: sig30 > 0 ? "up" : "flat", text: sig30 > 0 ? `+${sig30} new` : "none" }}
          spark={spark("sig")} sparkColor="var(--try)" />
      </div>

      <Panel title="Traffic" sub="Last 30 days" legend={[
        { sw: "var(--accent)", label: "Requests", val: days.reduce((a, b) => a + b.req, 0) },
        { sw: "var(--watch)", label: "Unique", val: days.reduce((a, b) => a + b.uni, 0) },
      ]}>
        <Chart days={days} series={[{ key: "req", cls: "b1" }, { key: "uni", cls: "b2" }]}
          tip={(d) => <>{shortDate(d.date)}<br /><span className="r">■</span> {d.req} req &nbsp; <span className="u">■</span> {d.uni} uniq</>} />
      </Panel>

      <Panel title="Signups" sub="Last 30 days" legend={[{ sw: "var(--try)", label: "Signups", val: sig30 }]}>
        <Chart days={days} series={[{ key: "sig", cls: "b3" }]} headroom
          tip={(d) => <>{shortDate(d.date)}<br /><span className="s">■</span> {d.sig} signup{d.sig === 1 ? "" : "s"}</>} />
      </Panel>
    </section>
  );
}

function pctDelta(today, prev) {
  if (!prev) return today > 0 ? { dir: "up", text: "new" } : { dir: "flat", text: "steady" };
  const pct = Math.round(((today - prev) / prev) * 100);
  if (pct === 0) return { dir: "flat", text: "steady" };
  return { dir: pct > 0 ? "up" : "down", text: `${pct > 0 ? "+" : ""}${pct}%` };
}
const ARROW = { up: "↑", down: "↓", flat: "→" };

function Stat({ label, ico, icoBg, icoColor, num, delta, spark, sparkColor }) {
  const mx = spark ? Math.max(...spark, 1) : 1;
  return (
    <div className="stat">
      <div className="stat-h">
        <span className="stat-label">{label}</span>
        <span className="stat-ico" style={{ background: icoBg, color: icoColor }}>{ico}</span>
      </div>
      <div className="stat-body">
        <div className="stat-num">{num}</div>
        <div className={"stat-delta" + (delta.dir === "down" ? " down" : delta.dir === "flat" ? " flat" : "")}>
          <span className="arrow">{ARROW[delta.dir]}</span> {delta.text}
        </div>
      </div>
      {spark && (
        <div className="stat-spark" style={{ color: sparkColor }}>
          {spark.map((n, i) => <i key={i} style={{ height: `${Math.max(8, (n / mx) * 100)}%` }} />)}
        </div>
      )}
    </div>
  );
}

function Panel({ title, sub, legend, children }) {
  return (
    <div className="panel">
      <div className="panel-h">
        <div className="panel-title"><h2>{title}</h2><p>{sub}</p></div>
        <div className="legend">
          {legend.map((l) => (
            <span className="leg" key={l.label}>
              <span className="sw" style={{ background: l.sw }} />{l.label} <span className="val">{l.val}</span>
            </span>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}

function Chart({ days, series, tip, headroom }) {
  const peak = Math.max(...days.flatMap((d) => series.map((s) => d[s.key])), 1);
  const max = headroom ? peak + 1 : peak;
  const ticks = headroom ? [peak, 0] : [max, Math.round(max / 2), 0];

  return (
    <div className="chart">
      <div className="chart-grid">
        {ticks.map((t, i) => <span key={i}><b>{t}</b></span>)}
      </div>
      <div className="bars">
        {days.map((d, i) => (
          <div className={"col" + (d.isToday ? " today" : "")} key={d.date}>
            <div className="stack">
              {series.map((s) => {
                const val = d[s.key];
                const faint = val <= 0;
                return (
                  <div key={s.key} className={"bar " + s.cls}
                    style={{ height: faint ? "3%" : `${Math.max(3, (val / max) * 100)}%`, opacity: faint ? 0.12 : 1 }} />
                );
              })}
            </div>
            <div className="tip">{tip(d)}</div>
          </div>
        ))}
      </div>
      <div className="axis">
        {days.map((d, i) => (
          <div className="tk" key={d.date}>{i % 5 === 0 || d.isToday ? dayNum(d.date) : ""}</div>
        ))}
      </div>
    </div>
  );
}

/* ── Users ────────────────────────────────────────────────────── */
function Users({ users, setUsers }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);

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

  if (!users) return <div className="adm-loading">Loading…</div>;

  return (
    <section>
      {error && <div className="adm-msg err">{error}</div>}
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>User</th><th>Role</th><th>Status</th><th>Requests</th><th>Joined</th><th /></tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan={6} className="adm-loading" style={{ padding: "24px 20px" }}>No users.</td></tr>
            )}
            {users.map((u) => {
              const name = u.username || u.email.split("@")[0];
              const color = avatarColor(u.email);
              return (
                <tr key={u.id}>
                  <td>
                    <div className="u-cell">
                      <div className="u-av" style={{ background: `linear-gradient(135deg, ${color}, color-mix(in oklab, ${color} 55%, #000))` }}>
                        {initials(name)}
                      </div>
                      <div><div className="u-name">{name}</div><div className="u-mail">{u.email}</div></div>
                    </div>
                  </td>
                  <td><span className={"pill " + (u.is_admin ? "admin" : "member")}>{u.is_admin ? "admin" : "member"}</span></td>
                  <td><span className={"pill " + (u.email_verified ? "verified" : "pending")}>{u.email_verified ? "verified" : "pending"}</span></td>
                  <td className="mono">—</td>
                  <td className="mono">{new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                  <td>
                    <button className="row-act" onClick={() => remove(u)} disabled={u.is_admin || busy === u.id}
                      title={u.is_admin ? "Can't delete an admin" : "Delete user"} aria-label="Delete user">
                      <IconTrash />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
