import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

// shortcut: append-only JSONL on local disk; fine for one server, move to Postgres/ClickHouse when deployed (Vercel's disk is ephemeral).
const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "events.jsonl");

export type AppEvent =
  | { type: "pageview"; tab: string }
  | { type: "api"; route: string; ms: number; ok: boolean; error?: string }
  | {
      type: "chat";
      chatId: string; messageId?: string; question: string; ms: number; ok: boolean; error?: string;
      model: string; steps: number; inputTokens: number; outputTokens: number; cachedTokens: number;
      toolCalls: number; toolErrors: number; tools: string[]; finishReason?: string;
    }
  | { type: "feedback"; chatId: string; messageId: string; rating: "up" | "down"; question?: string };

export type StoredEvent = AppEvent & { ts: number };

export function logEvent(e: AppEvent) {
  try {
    mkdirSync(DIR, { recursive: true });
    appendFileSync(FILE, JSON.stringify({ ts: Date.now(), ...e }) + "\n");
  } catch (err) {
    console.error("event log write failed", err); // never break a user request over telemetry
  }
}

export function readEvents(sinceMs: number): StoredEvent[] {
  if (!existsSync(FILE)) return [];
  return readFileSync(FILE, "utf8")
    .split("\n")
    .flatMap((l) => {
      try { return l ? [JSON.parse(l) as StoredEvent] : []; } catch { return []; }
    })
    .filter((e) => e.ts >= sinceMs);
}

// Wraps a JSON route handler: logs latency + success, and turns thrown errors into 400s.
export async function timed(route: string, fn: () => unknown) {
  const t0 = Date.now();
  try {
    const body = await fn();
    logEvent({ type: "api", route, ms: Date.now() - t0, ok: true });
    return Response.json(body);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logEvent({ type: "api", route, ms: Date.now() - t0, ok: false, error: error.slice(0, 300) });
    return Response.json({ error }, { status: 400 });
  }
}
