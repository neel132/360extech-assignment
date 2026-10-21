"use client";

import { useEffect, useState } from "react";
import Explore from "@/components/Explore";
import Chat from "@/components/Chat";
import Cohort from "@/components/Cohort";

const TABS = [
  { id: "explore", label: "Explore columns" },
  { id: "chat", label: "Ask the data" },
  { id: "cohort", label: "People like you" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function Home() {
  const [tab, setTab] = useState<Tab>("explore");

  useEffect(() => {
    const fromHash = window.location.hash.slice(1) as Tab;
    if (TABS.some((t) => t.id === fromHash)) setTab(fromHash);
  }, []);

  useEffect(() => {
    history.replaceState(null, "", `#${tab}`);
    fetch("/api/track", { method: "POST", body: JSON.stringify({ type: "pageview", tab }) }).catch(() => {});
  }, [tab]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Diabetes Insights</h1>
          <p className="text-sm text-ink-2">100,000 people · 31 health indicators · Kaggle diabetes health indicators dataset</p>
        </div>
        <nav role="tablist" aria-label="Sections" className="flex gap-1 rounded-lg border border-line bg-panel p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${tab === t.id ? "bg-ink text-bg" : "text-ink-2 hover:bg-bg"}`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      {/* all tabs stay mounted so chat history and selections survive tab switches */}
      <main>
        <div hidden={tab !== "explore"}><Explore /></div>
        <div hidden={tab !== "chat"}><Chat /></div>
        <div hidden={tab !== "cohort"}><Cohort /></div>
      </main>
    </div>
  );
}
