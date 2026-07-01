import { useEffect, useMemo, useState } from "react";
import { api, errMessage } from "../api/client.js";
import SubpageNav from "../components/SubpageNav.jsx";

/* Scoped under .adm so bare `table`/`.stat`/`.pill` rules never leak into the
   rest of the app. Inlined (rather than a co-located .css import) so the view
   is a single self-contained file with no extra module to resolve or commit.
   Uses the global Arciv palette + fonts from index.css, so it flips with dark
   mode automatically. */
const ADMIN_CSS = `
.adm { max-width: 1120px; margin: 0 auto; padding: 24px 28px 96px; }
.adm .head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; padding-top: 22px; margin: 6px 0 20px; border-top: 1px solid var(--line); }
.adm .eyebrow { display: inline-flex; align-items: center; gap: 9px; font-family: ui-monospace, monospace; font-size: 10.5px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted-2); margin-bottom: 10px; }
.adm .eyebrow .pulse { width: 6px; height: 6px; border-radius: 50%; background: var(--try); animation: adm-pulse 2.4s ease-in-out infinite; }
@keyframes adm-pulse { 0%,100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--try) 50%, transparent); } 50% { box-shadow: 0 0 0 5px transparent; } }
.adm h1.title { margin: 0; font-family: 'Instrument Serif', serif; font-weight: 400; font-size: 52px; line-height: .98; letter-spacing: -0.015em; color: var(--ink); }
.adm .title em { font-style: italic; color: var(--accent); }
.adm .head-meta { text-align: right; font-size: 12.5px; color: var(--muted); line-height: 1.5; font-family: ui-monospace, monospace; }
.adm .head-meta b { color: var(--ink-2); font-weight: 500; }
.adm .tabs { display: flex; align-items: center; gap: 4px; padding: 5px; border-radius: 13px; background: var(--surface); border: 1px solid var(--line); width: fit-content; box-shadow: var(--shadow-card); margin-bottom: 22px; }
.adm .tab { border: 0; background: transparent; cursor: pointer; font: inherit; font-size: 13.5px; font-weight: 500; color: var(--muted); padding: 8px 16px; border-radius: 9px; display: inline-flex; align-items: center; gap: 8px; transition: background .12s, color .12s; }
.adm .tab:hover { color: var(--ink-2); background: var(--surface-2); }
.adm .tab.on { background: var(--btn-dark); color: var(--btn-dark-text); }
.adm .tab .cnt { font-family: ui-monospace, monospace; font-size: 10.5px; padding: 1px 6px; border-radius: 99px; background: color-mix(in oklab, var(--ink) 6%, transparent); color: var(--muted); font-weight: 500; }
.adm .tab.on .cnt { background: rgba(255,255,255,.16); color: #fff; }
.adm .stats { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); margin: 0 0 20px; border: 1px solid var(--line); border-radius: var(--r-lg, 16px); background: color-mix(in oklab, var(--surface) 60%, transparent); overflow: hidden; box-shadow: var(--shadow-card); }
.adm .stat { padding: 18px 20px 16px; display: flex; flex-direction: column; gap: 12px; position: relative; border-right: 1px solid var(--line); transition: background .15s; }
.adm .stat:last-child { border-right: 0; }
.adm .stat:hover { background: color-mix(in oklab, var(--surface) 92%, transparent); }
.adm .stat-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.adm .stat-label { font-family: ui-monospace, monospace; font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); font-weight: 500; }
.adm .stat-ico { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; flex-shrink: 0; }
.adm .stat-ico svg { width: 14px; height: 14px; }
.adm .stat-body { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; }
.adm .stat-num { font-family: 'Instrument Serif', serif; font-size: 44px; font-weight: 400; letter-spacing: -0.02em; line-height: .9; font-variant-numeric: tabular-nums; display: flex; align-items: baseline; gap: 6px; color: var(--ink); }
.adm .stat-delta { font-size: 11px; font-family: ui-monospace, monospace; color: var(--muted); display: inline-flex; align-items: center; gap: 5px; padding-bottom: 3px; }
.adm .stat-delta .arrow { display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; border-radius: 5px; background: color-mix(in oklab, var(--try) 14%, transparent); color: var(--try); font-size: 10px; }
.adm .stat-delta.down .arrow { background: color-mix(in oklab, var(--read) 14%, transparent); color: var(--read); }
.adm .stat-delta.flat .arrow { background: color-mix(in oklab, var(--ink) 8%, transparent); color: var(--muted); }
.adm .stat-spark { display: flex; align-items: flex-end; gap: 2px; height: 22px; }
.adm .stat-spark i { flex: 1; border-radius: 2px; background: currentColor; opacity: .32; min-height: 2px; }
.adm .stat-spark i:last-child { opacity: 1; }
.adm .panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-xl, 22px); padding: 22px 24px 20px; margin-bottom: 16px; box-shadow: var(--shadow-card); }
.adm .panel-h { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 6px; }
.adm .panel-title { display: flex; flex-direction: column; gap: 3px; }
.adm .panel-title h2 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -0.02em; color: var(--ink); }
.adm .panel-title p { margin: 0; font-size: 12px; color: var(--muted); font-family: ui-monospace, monospace; }
.adm .legend { display: flex; align-items: center; gap: 16px; }
.adm .leg { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--ink-2); font-weight: 500; }
.adm .leg .sw { width: 9px; height: 9px; border-radius: 3px; }
.adm .leg .val { font-family: ui-monospace, monospace; font-size: 11px; color: var(--muted); font-weight: 400; }
.adm .chart { position: relative; margin-top: 20px; }
.adm .chart-grid { position: absolute; inset: 0 0 24px 0; display: flex; flex-direction: column; justify-content: space-between; pointer-events: none; }
.adm .chart-grid span { border-top: 1px dashed var(--line-2); position: relative; }
.adm .chart-grid span b { position: absolute; left: 0; top: -8px; font-family: ui-monospace, monospace; font-size: 9.5px; color: var(--muted-2); background: var(--surface); padding-right: 6px; font-weight: 400; }
.adm .bars { position: relative; display: flex; align-items: flex-end; gap: 0; height: 210px; padding-left: 24px; }
.adm .col { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 2px; position: relative; padding: 0 2px; }
.adm .col .stack { display: flex; align-items: flex-end; gap: 2px; width: 100%; justify-content: center; height: 100%; }
.adm .bar { width: 100%; max-width: 12px; border-radius: 3px 3px 2px 2px; transition: height .5s cubic-bezier(.22,1,.36,1); position: relative; }
.adm .bar.b1 { background: linear-gradient(180deg, var(--accent), color-mix(in oklab, var(--accent) 62%, var(--surface))); }
.adm .bar.b2 { background: linear-gradient(180deg, var(--watch), color-mix(in oklab, var(--watch) 60%, var(--surface))); }
.adm .bar.b3 { background: linear-gradient(180deg, var(--try), color-mix(in oklab, var(--try) 58%, var(--surface))); }
.adm .col.today .bar.b1 { background: linear-gradient(180deg, var(--accent), var(--accent-deep)); box-shadow: 0 0 14px -2px color-mix(in oklab, var(--accent) 55%, transparent); }
.adm .col.today::after { content: 'TODAY'; position: absolute; top: -4px; left: 50%; transform: translate(-50%,-100%); font-family: ui-monospace, monospace; font-size: 8.5px; letter-spacing: 0.1em; color: var(--accent); background: var(--accent-tint); padding: 2px 6px; border-radius: 99px; white-space: nowrap; border: 1px solid color-mix(in oklab, var(--accent) 22%, transparent); }
.adm .axis { display: flex; padding-left: 24px; margin-top: 8px; }
.adm .axis .tk { flex: 1; text-align: center; font-family: ui-monospace, monospace; font-size: 9.5px; color: var(--muted-2); }
.adm .col:hover .bar { filter: brightness(1.06); }
.adm .col .tip { position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%) translateY(4px); background: var(--ink); color: var(--surface); font-size: 11px; padding: 6px 9px; border-radius: 8px; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity .15s, transform .15s; z-index: 5; box-shadow: var(--shadow-pop); font-family: ui-monospace, monospace; }
.adm .col:hover .tip { opacity: 1; transform: translateX(-50%); }
.adm .col .tip .r { color: #c3aaff; } .adm .col .tip .u { color: #8db9f5; } .adm .col .tip .s { color: #6fe0ab; }
.adm .tablewrap { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg, 16px); overflow: hidden; box-shadow: var(--shadow-card); }
.adm table { width: 100%; border-collapse: collapse; }
.adm thead th { text-align: left; font-family: ui-monospace, monospace; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); font-weight: 500; padding: 13px 20px; border-bottom: 1px solid var(--line); background: color-mix(in oklab, var(--surface-2) 55%, transparent); }
.adm tbody td { padding: 14px 20px; border-bottom: 1px solid var(--line-2); font-size: 13.5px; color: var(--ink-2); vertical-align: middle; }
.adm tbody tr:last-child td { border-bottom: 0; }
.adm tbody tr { transition: background .12s; }
.adm tbody tr:hover { background: var(--surface-2); }
.adm .u-cell { display: flex; align-items: center; gap: 11px; }
.adm .u-av { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-size: 12px; font-weight: 600; flex-shrink: 0; box-shadow: 0 1px 2px rgba(22,21,19,.15); }
.adm .u-name { font-weight: 600; color: var(--ink); letter-spacing: -0.01em; }
.adm .u-mail { font-size: 11.5px; color: var(--muted); font-family: ui-monospace, monospace; }
.adm .pill { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border-radius: 99px; font-family: ui-monospace, monospace; font-size: 10.5px; letter-spacing: 0.03em; text-transform: uppercase; font-weight: 500; border: 1px solid transparent; }
.adm .pill.verified { background: var(--try-tint); color: var(--try); border-color: color-mix(in oklab, var(--try) 22%, transparent); }
.adm .pill.pending { background: color-mix(in oklab, var(--inbox) 12%, transparent); color: var(--inbox); border-color: color-mix(in oklab, var(--inbox) 25%, transparent); }
.adm .pill.admin { background: var(--accent-tint); color: var(--accent); border-color: color-mix(in oklab, var(--accent) 20%, transparent); }
.adm .pill.member { background: var(--surface-2); color: var(--muted); border-color: var(--line); }
.adm .mono { font-family: ui-monospace, monospace; font-size: 12px; color: var(--muted); }
.adm .row-act { width: 28px; height: 28px; border: 0; background: transparent; border-radius: 7px; cursor: pointer; color: var(--muted-2); display: grid; place-items: center; transition: background .15s, color .15s; }
.adm .row-act:hover:not(:disabled) { background: var(--read-tint); color: var(--read); }
.adm .row-act:disabled { opacity: .3; cursor: not-allowed; }
.adm .adm-msg { margin: 0 0 16px; border-radius: 12px; padding: 12px 16px; font-size: 13px; }
.adm .adm-msg.err { background: var(--bad-tint); color: var(--bad); }
.adm .adm-loading { color: var(--muted); font-size: 13px; padding: 24px 4px; }
@media (max-width: 820px) {
  .adm { padding: 20px 16px 80px; }
  .adm .stats { grid-template-columns: repeat(2, 1fr); }
  .adm .stat:nth-child(2) { border-right: 0; }
  .adm .stat:nth-child(-n+2) { border-bottom: 1px solid var(--line); }
  .adm h1.title { font-size: 40px; }
  .adm .u-mail { display: none; }
}
`;

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
      <style>{ADMIN_CSS}</style>
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
