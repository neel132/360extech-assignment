import Link from "next/link";
import { opsReport, cost, RANGES, type Range, type Check } from "@/lib/ops";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ops · Diabetes Insights" };

const STATUS: Record<Check["status"], { icon: string; label: string; cls: string }> = {
  pass: { icon: "✓", label: "Pass", cls: "text-good border-good/40" },
  warn: { icon: "!", label: "Warn", cls: "text-warn border-warn/40" },
  fail: { icon: "✕", label: "Fail", cls: "text-bad border-bad/40" },
  nodata: { icon: "–", label: "No data", cls: "text-muted border-line" },
};

const s = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`);
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(0)}%`);
const when = (ts: number) => new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function Ops({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range: r } = await searchParams;
  const range: Range = r && r in RANGES ? (r as Range) : "7d";
  const rep = opsReport(range);
  const k = rep.kpis;
  const overall = rep.checks.some((c) => c.status === "fail") ? "fail" : rep.checks.some((c) => c.status === "warn") ? "warn" : "pass";
  const maxChats = Math.max(1, ...rep.trend.map((t) => t.chats));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Operations</h1>
          <p className="text-sm text-ink-2">Internal · is Diabetes Insights working as expected? · <Link href="/" className="underline">open app</Link></p>
        </div>
        <nav className="flex gap-1 rounded-lg border border-line bg-panel p-1" aria-label="Time range">
          {(Object.keys(RANGES) as Range[]).map((x) => (
            <Link key={x} href={`/ops?range=${x}`} aria-current={x === range} className={`rounded-md px-3 py-1.5 text-sm ${x === range ? "bg-ink text-bg" : "text-ink-2 hover:bg-bg"}`}>
              {x === "1d" ? "24 hours" : x === "7d" ? "7 days" : "30 days"}
            </Link>
          ))}
        </nav>
      </header>

      <section className="rounded-xl border border-line bg-panel p-5">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold">Health checks</h2>
          <Pill status={overall} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rep.checks.map((c) => (
            <div key={c.name} className="flex items-start justify-between gap-3 rounded-lg bg-bg px-3 py-2">
              <div>
                <div className="text-sm font-medium">{c.name}</div>
                <div className="text-xs text-muted">target {c.target}</div>
              </div>
              <div className="text-right">
                <Pill status={c.status} />
                <div className="mt-1 text-xs tabular-nums text-ink-2">{c.value}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <Kpi label="Conversations" value={k.conversations.toLocaleString()} />
        <Kpi label="Questions" value={k.questions.toLocaleString()} />
        <Kpi label="p50 latency" value={s(k.p50)} />
        <Kpi label="p95 latency" value={s(k.p95)} />
        <Kpi label="Avg steps" value={k.avgSteps?.toFixed(1) ?? "—"} />
        <Kpi label="Tokens / answer" value={k.avgTokens ? Math.round(k.avgTokens).toLocaleString() : "—"} />
        <Kpi label="LLM cost" value={`$${k.totalCost.toFixed(2)}`} sub={k.costPerAnswer ? `$${k.costPerAnswer.toFixed(3)} / answer` : undefined} />
        <Kpi label="Thumbs up" value={pct(k.satisfaction)} sub={`${k.ratings} ratings`} />
      </section>

      <section className="rounded-xl border border-line bg-panel p-5">
        <h2 className="text-sm font-semibold">Chat volume</h2>
        <p className="mb-3 text-xs text-muted">Questions per {range === "1d" ? "2 hours" : "day"}; red = failed. Hover a bar for details.</p>
        <div className="flex h-36 items-end gap-[2px]" role="img" aria-label="Chat volume over time">
          {rep.trend.map((t) => (
            <div key={t.t} className="group relative flex h-full flex-1 flex-col justify-end" title={`${when(t.t)}: ${t.chats} questions, ${t.errors} errors, p95 ${s(t.p95)}, ${t.down} 👎`}>
              {t.errors > 0 && <div className="rounded-t-[3px] bg-bad" style={{ height: `${(t.errors / maxChats) * 100}%` }} />}
              <div className={`bg-s1 ${t.errors ? "" : "rounded-t-[3px]"} group-hover:opacity-80`} style={{ height: `${((t.chats - t.errors) / maxChats) * 100}%`, minHeight: t.chats ? 2 : 0 }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-muted">
          <span>{when(rep.trend[0].t)}</span><span>max {maxChats}</span><span>now</span>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Breakdown title="Tab views" rows={rep.tabs} />
        <Breakdown title="Agent tool calls" rows={rep.tools} />
        <Breakdown title="Data API calls" rows={rep.apiRoutes} />
      </div>

      <section className="rounded-xl border border-line bg-panel p-5">
        <h2 className="text-sm font-semibold">Needs review</h2>
        <p className="mb-3 text-xs text-muted">Failed answers, thumbs-down, and answers where a tool call errored or the output was cut off.</p>
        {rep.review.length === 0 ? <p className="text-sm text-ink-2">Nothing to review in this range.</p> : (
          <Table head={["When", "Type", "Question", "Detail"]} rows={rep.review.map((x) => [when(x.ts), x.kind, x.question, x.detail])} />
        )}
      </section>

      <section className="rounded-xl border border-line bg-panel p-5">
        <h2 className="mb-3 text-sm font-semibold">Recent questions</h2>
        {rep.recent.length === 0 ? <p className="text-sm text-ink-2">No chat traffic in this range.</p> : (
          <Table
            head={["When", "Question", "Latency", "Steps", "Tools", "Tokens", "Cost", "OK"]}
            rows={rep.recent.map((c) => [when(c.ts), c.question, s(c.ms), String(c.steps), String(c.toolCalls), (c.inputTokens + c.outputTokens).toLocaleString(), `$${cost(c).toFixed(3)}`, c.ok ? "✓" : "✕ error"])}
          />
        )}
      </section>
    </div>
  );
}

function Pill({ status }: { status: Check["status"] }) {
  const x = STATUS[status];
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${x.cls}`}><span aria-hidden>{x.icon}</span>{x.label}</span>;
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: [string, number][] }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-ink-2">No data.</p> : (
        <ul className="space-y-2 text-sm">
          {rows.map(([name, n]) => (
            <li key={name}>
              <div className="flex justify-between text-xs"><span className="text-ink-2">{name}</span><span className="tabular-nums">{n}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-bg"><div className="h-1.5 rounded-full bg-s1" style={{ width: `${(n / max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead><tr className="border-b border-line text-muted">{head.map((h) => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line/60 align-top">
              {r.map((c, j) => <td key={j} className={`py-1.5 pr-3 ${j === 1 || (head[2] === "Question" && j === 2) ? "min-w-[240px]" : "whitespace-nowrap tabular-nums"}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
