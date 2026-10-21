"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const SUGGESTIONS = [
  "How does the diabetes rate change with BMI?",
  "Which lifestyle factors are most associated with diabetes?",
  "Compare diabetes rates by income level and education",
  "What share of current smokers over 60 have diagnosed diabetes?",
  "Is family history a bigger factor than hypertension?",
];

const textOf = (m: UIMessage) =>
  m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

export default function Chat() {
  const {
    id: chatId,
    messages,
    sendMessage,
    status,
    error,
    stop,
    regenerate,
  } = useChat({ transport: new DefaultChatTransport({ api: "/api/chat" }) });
  const [input, setInput] = useState("");
  const [rated, setRated] = useState<Record<string, "up" | "down">>({});
  const endRef = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text });
    setInput("");
  };

  const rate = (m: UIMessage, rating: "up" | "down") => {
    setRated((r) => ({ ...r, [m.id]: rating }));
    const idx = messages.indexOf(m);
    const question = [...messages.slice(0, idx)]
      .reverse()
      .find((x) => x.role === "user");
    fetch("/api/track", {
      method: "POST",
      body: JSON.stringify({
        type: "feedback",
        chatId,
        messageId: m.id,
        rating,
        question: question ? textOf(question).slice(0, 500) : undefined,
      }),
    }).catch(() => {});
  };

  return (
    <div className="flex h-[calc(100vh-140px)] min-h-[480px] flex-col rounded-xl border border-line bg-panel">
      <div
        className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <div className="mx-auto max-w-xl py-8 text-center">
            <h2 className="text-lg font-semibold">
              Ask anything about the dataset
            </h2>
            <p className="mt-1 text-sm text-ink-2">
              An AI analyst queries all 100,000 rows to answer, and shows the
              queries it ran.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-bg"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={m.role === "user" ? "flex justify-end" : ""}
          >
            {m.role === "user" ? (
              <div className="max-w-[80%] rounded-2xl bg-ink px-4 py-2 text-sm text-bg">
                {textOf(m)}
              </div>
            ) : (
              <div className="max-w-full text-sm leading-relaxed">
                {m.parts.map((part, i) => {
                  if (part.type === "text")
                    return (
                      <div key={i} className="prose-chat">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {part.text}
                        </ReactMarkdown>
                      </div>
                    );
                  if (
                    part.type === "tool-query_data" ||
                    part.type === "tool-correlate"
                  )
                    return <ToolCall key={i} part={part} />;
                  return null;
                })}
                {!(busy && m === messages.at(-1)) && (
                  <div className="mt-2 flex gap-1 text-muted">
                    {(["up", "down"] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => rate(m, r)}
                        disabled={!!rated[m.id]}
                        aria-label={r === "up" ? "Helpful" : "Not helpful"}
                        className={`rounded px-1.5 py-0.5 text-xs hover:bg-bg disabled:cursor-default ${rated[m.id] === r ? "text-ink" : ""}`}
                      >
                        {r === "up" ? "👍" : "👎"}
                      </button>
                    ))}
                    {rated[m.id] && (
                      <span className="self-center text-xs">
                        Thanks for the feedback
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {status === "submitted" && (
          <div className="text-sm text-muted">Thinking…</div>
        )}
        {error && (
          <div className="rounded-lg border border-bad/40 p-3 text-sm text-bad">
            {error.message || "Something went wrong."}{" "}
            <button onClick={() => regenerate()} className="underline">
              Retry
            </button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2 border-t border-line p-3"
      >
        <label htmlFor="chat-input" className="sr-only">
          Your question
        </label>
        <input
          id="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. What is the average HbA1c for people with pre-diabetes?"
          className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-s1"
        />
        {busy ? (
          <button
            type="button"
            onClick={() => stop()}
            className="rounded-lg border border-line px-4 text-sm"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-lg bg-ink px-4 text-sm text-bg disabled:opacity-40"
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}

type ToolPart = {
  type: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

function ToolCall({ part }: { part: ToolPart }) {
  const name = part.type === "tool-correlate" ? "Correlation" : "Query";
  const out = part.output as
    | { matchedRows?: number; groups?: unknown[] }
    | unknown[]
    | undefined;
  const summary =
    part.state === "output-error"
      ? "failed, retrying"
      : part.state !== "output-available"
        ? "running…"
        : Array.isArray(out)
          ? `${out.length} columns`
          : `${out?.matchedRows?.toLocaleString()} rows matched · ${out?.groups?.length} groups`;
  return (
    <details className="my-2 rounded-lg border border-line bg-bg text-xs">
      <summary className="cursor-pointer select-none px-3 py-1.5 text-ink-2">
        <span className="font-medium">{name}</span> · {summary}
      </summary>
      <div className="space-y-2 border-t border-line p-3">
        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-ink-2">
          {JSON.stringify(part.input, null, 1)}
        </pre>
        {part.errorText && <div className="text-bad">{part.errorText}</div>}
        {part.output !== undefined && (
          <pre className="max-h-60 overflow-auto font-mono text-[11px] text-ink-2">
            {JSON.stringify(part.output, null, 1)}
          </pre>
        )}
      </div>
    </details>
  );
}
