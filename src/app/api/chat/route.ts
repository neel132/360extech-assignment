import { createAgentUIStreamResponse, type UIMessage } from "ai";
import { createAgent, MODEL } from "@/lib/agent";
import { logEvent } from "@/lib/events";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages, id: chatId }: { messages: UIMessage[]; id: string } = await req.json();
  const last = messages.at(-1);
  const question = last?.parts.map((p) => (p.type === "text" ? p.text : "")).join("").slice(0, 500) ?? "";
  const t0 = Date.now();
  const toolNames: string[] = [];
  let toolErrors = 0;
  let logged = false;

  const agent = createAgent({
    onToolExecutionEnd({ toolCall, toolOutput }) {
      toolNames.push(toolCall.toolName);
      if (toolOutput.type === "tool-error") toolErrors++;
    },
    onEnd({ totalUsage, steps, finishReason }) {
      logged = true;
      logEvent({
        type: "chat", chatId, question, ms: Date.now() - t0, ok: true, model: MODEL, steps: steps.length,
        inputTokens: totalUsage.inputTokens ?? 0, outputTokens: totalUsage.outputTokens ?? 0,
        cachedTokens: totalUsage.inputTokenDetails?.cacheReadTokens ?? 0,
        toolCalls: toolNames.length, toolErrors, tools: toolNames, finishReason,
      });
    },
  });

  return createAgentUIStreamResponse({
    agent,
    uiMessages: messages,
    abortSignal: req.signal,
    onError(error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!logged) {
        logged = true;
        logEvent({
          type: "chat", chatId, question, ms: Date.now() - t0, ok: false, error: message.slice(0, 300), model: MODEL,
          steps: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, toolCalls: toolNames.length, toolErrors, tools: toolNames,
        });
      }
      return /api key|x-api-key|authentication/i.test(message)
        ? "The chat model isn't configured (missing or invalid ANTHROPIC_API_KEY)."
        : "Something went wrong answering that. Please try again.";
    },
  });
}
