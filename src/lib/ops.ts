import { readEvents, type StoredEvent } from "./events.ts";
import { getDataset } from "./data.ts";

type Chat = Extract<StoredEvent, { type: "chat" }>;
type Api = Extract<StoredEvent, { type: "api" }>;
type Feedback = Extract<StoredEvent, { type: "feedback" }>;

// $ per million tokens: [input, cached input read, output]
const PRICES: Record<string, [number, number, number]> = {
  "claude-opus-5-5": [4, 0.2, 20],
  "claude-sonnet-5-5": [2, 0.2, 10],
  "claude-haiku-5-5": [0.1, 0.01, 0.5],
};

export const RANGES = { "1d": 1, "7d": 7, "30d": 30 } as const;
export type Range = keyof typeof RANGES;

function pctl(vals: number[], q: number) {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

export function cost(c: Chat) {
  const [inp, cached, out] = PRICES[c.model] ?? PRICES["claude-opus-5-5"];
  return ((c.inputTokens - c.cachedTokens) * inp + c.cachedTokens * cached + c.outputTokens * out) / 1e6;
}

export type Check = { name: string; status: "pass" | "warn" | "fail" | "nodata"; value: string; target: string };

export function opsReport(range: Range, now = Date.now()) {
  const days = RANGES[range];
  const since = now - days * 864e5;
  const events = readEvents(since);
  const chats = events.filter((e): e is Chat => e.type === "chat");
  const apis = events.filter((e): e is Api => e.type === "api");
  const feedback = events.filter((e): e is Feedback => e.type === "feedback");
  const views = events.filter((e) => e.type === "pageview") as Extract<StoredEvent, { type: "pageview" }>[];

  const ok = chats.filter((c) => c.ok);
  const lat = ok.map((c) => c.ms);
  const toolCalls = chats.reduce((s, c) => s + c.toolCalls, 0);
  const toolErrors = chats.reduce((s, c) => s + c.toolErrors, 0);
  const up = feedback.filter((f) => f.rating === "up").length;
  const totalCost = chats.reduce((s, c) => s + cost(c), 0);
  const apiLat = apis.filter((a) => a.ok).map((a) => a.ms);
  const apiErr = apis.filter((a) => !a.ok).length;
  const ds = getDataset();

  const rate = (n: number, d: number) => (d ? n / d : null);
  const chatErrRate = rate(chats.length - ok.length, chats.length);
  const toolErrRate = rate(toolErrors, toolCalls);
  const satisfaction = rate(up, feedback.length);
  const p95 = pctl(lat, 0.95);
  const apiP95 = pctl(apiLat, 0.95);
  const apiErrRate = rate(apiErr, apis.length);
  const noAnswer = ok.filter((c) => c.toolCalls === 0).length;

  const fmtPct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
  const fmtS = (v: number | null) => (v === null ? "—" : `${(v / 1000).toFixed(1)}s`);
  const check = (name: string, v: number | null, value: string, target: string, good: (v: number) => boolean, warn: (v: number) => boolean): Check => ({
    name, value, target, status: v === null ? "nodata" : good(v) ? "pass" : warn(v) ? "warn" : "fail",
  });

  const checks: Check[] = [
    { name: "Dataset loaded", status: ds.rows === 100000 && ds.invalidCells === 0 ? "pass" : "fail", value: `${ds.rows.toLocaleString()} rows, ${ds.invalidCells} bad cells`, target: "100,000 rows, 0 bad" },
    { name: "LLM key configured", status: process.env.ANTHROPIC_API_KEY ? "pass" : "fail", value: process.env.ANTHROPIC_API_KEY ? "set" : "missing", target: "ANTHROPIC_API_KEY set" },
    check("Chat error rate", chatErrRate, fmtPct(chatErrRate), "< 2% (warn < 5%)", (v) => v < 0.02, (v) => v < 0.05),
    check("Chat p95 latency", p95, fmtS(p95), "< 20s (warn < 40s)", (v) => v < 20000, (v) => v < 40000),
    check("Tool error rate", toolErrRate, fmtPct(toolErrRate), "< 5% (warn < 15%)", (v) => v < 0.05, (v) => v < 0.15),
    check("Answers grounded in a query", rate(ok.length - noAnswer, ok.length), fmtPct(rate(ok.length - noAnswer, ok.length)), "≥ 90% (warn ≥ 75%)", (v) => v >= 0.9, (v) => v >= 0.75),
    check("Thumbs-up rate", feedback.length >= 5 ? satisfaction : null, feedback.length >= 5 ? `${fmtPct(satisfaction)} of ${feedback.length}` : `${feedback.length} ratings (need 5)`, "≥ 75% (warn ≥ 60%)", (v) => v >= 0.75, (v) => v >= 0.6),
    check("Explore/cohort API errors", apiErrRate, fmtPct(apiErrRate), "< 1% (warn < 5%)", (v) => v < 0.01, (v) => v < 0.05),
    check("Explore/cohort p95", apiP95, apiP95 === null ? "—" : `${apiP95}ms`, "< 1000ms (warn < 3000ms)", (v) => v < 1000, (v) => v < 3000),
  ];

  // one bucket per day (or per 2h for the 1-day view)
  const bucketMs = days === 1 ? 2 * 36e5 : 864e5;
  const nb = Math.round((days * 864e5) / bucketMs);
  const start = now - nb * bucketMs;
  const trend = Array.from({ length: nb }, (_, k) => ({ t: start + k * bucketMs, chats: 0, errors: 0, lat: [] as number[], down: 0 }));
  for (const c of chats) {
    const b = trend[Math.floor((c.ts - start) / bucketMs)];
    if (!b) continue;
    b.chats++; if (!c.ok) b.errors++; else b.lat.push(c.ms);
  }
  for (const f of feedback) {
    const b = trend[Math.floor((f.ts - start) / bucketMs)];
    if (b && f.rating === "down") b.down++;
  }

  const count = <T,>(xs: T[], key: (x: T) => string) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  const review = [
    ...chats.filter((c) => !c.ok).map((c) => ({ ts: c.ts, kind: "error" as const, question: c.question, detail: c.error ?? "" })),
    ...feedback.filter((f) => f.rating === "down").map((f) => ({ ts: f.ts, kind: "thumbs-down" as const, question: f.question ?? "", detail: "" })),
    ...ok.filter((c) => c.toolErrors > 0 || c.finishReason === "length").map((c) => ({ ts: c.ts, kind: "tool-errors" as const, question: c.question, detail: `${c.toolErrors} tool errors, finish: ${c.finishReason}` })),
  ].sort((a, b) => b.ts - a.ts).slice(0, 25);

  return {
    range, checks,
    kpis: {
      conversations: new Set(chats.map((c) => c.chatId)).size,
      questions: chats.length,
      p50: pctl(lat, 0.5), p95,
      avgSteps: ok.length ? ok.reduce((s, c) => s + c.steps, 0) / ok.length : null,
      avgTokens: ok.length ? ok.reduce((s, c) => s + c.inputTokens + c.outputTokens, 0) / ok.length : null,
      totalCost, costPerAnswer: ok.length ? totalCost / ok.length : null,
      satisfaction, ratings: feedback.length,
      pageviews: views.length,
    },
    trend: trend.map((b) => ({ t: b.t, chats: b.chats, errors: b.errors, p95: pctl(b.lat, 0.95), down: b.down })),
    bucketMs,
    tabs: count(views, (v) => v.tab),
    tools: count(chats.flatMap((c) => c.tools), (t) => t),
    apiRoutes: count(apis, (a) => `${a.route}${a.ok ? "" : " (error)"}`),
    review,
    recent: [...chats].sort((a, b) => b.ts - a.ts).slice(0, 15),
  };
}
