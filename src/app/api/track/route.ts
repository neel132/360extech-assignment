import { z } from "zod";
import { logEvent } from "@/lib/events";

// Client-side telemetry: tab views and thumbs up/down on chat answers.
const Body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pageview"), tab: z.enum(["explore", "chat", "cohort"]) }),
  z.object({ type: z.literal("feedback"), chatId: z.string().max(100), messageId: z.string().max(100), rating: z.enum(["up", "down"]), question: z.string().max(500).optional() }),
]);

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid event" }, { status: 400 });
  logEvent(parsed.data);
  return Response.json({ ok: true });
}
