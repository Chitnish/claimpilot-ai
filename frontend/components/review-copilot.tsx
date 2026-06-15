"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Lightbulb,
  Loader2,
  Send,
  Sparkles,
  User,
} from "lucide-react";

import { chatWithClaim } from "@/lib/api";
import type { CopilotChatMessage } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  suggestedActions?: string[];
  citations?: string[];
}

interface ReviewCopilotProps {
  claimId: string;
  needsHumanReview: boolean;
}

const STARTER_PROMPTS = [
  "Why is this claim in review?",
  "What corrections are needed?",
  "Summarize approve vs reject tradeoffs",
  "Explain this claim in plain English",
  "What do ICD-10 and CPT mean?",
  "What's the difference between an error and a warning?",
];

export function ReviewCopilot({
  claimId,
  needsHumanReview,
}: ReviewCopilotProps): React.ReactElement {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plainLanguage, setPlainLanguage] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, loading]);

  const send = async (question: string): Promise<void> => {
    const trimmed = question.trim();
    if (!trimmed || loading) {
      return;
    }

    const decorated = plainLanguage
      ? `${trimmed}\n\n(Please explain any billing or medical terms in plain English — I'm not from a clinical background.)`
      : trimmed;

    const nextTurns: ChatTurn[] = [
      ...turns,
      { role: "user", content: trimmed },
    ];
    setTurns(nextTurns);
    setInput("");
    setError(null);
    setLoading(true);

    const payload: CopilotChatMessage[] = nextTurns.map((turn, index) => {
      if (turn.role === "user" && index === nextTurns.length - 1) {
        return { role: "user", content: decorated };
      }
      return { role: turn.role, content: turn.content };
    });

    try {
      const response = await chatWithClaim(claimId, payload);
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: response.reply,
          suggestedActions: response.suggestedActions,
          citations: response.citations,
        },
      ]);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Copilot request failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    void send(input);
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(input);
    }
  };

  const isEmpty = turns.length === 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-[#1e3a5f]" />
              Review copilot
            </CardTitle>
            <CardDescription>
              Ask anything about this claim before approving or rejecting
            </CardDescription>
          </div>
          <button
            type="button"
            onClick={() => setPlainLanguage((prev) => !prev)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              plainLanguage
                ? "border-[#1e3a5f] bg-[#1e3a5f] text-white"
                : "border-gray-300 bg-background text-muted-foreground hover:bg-muted",
            )}
          >
            Explain terms simply
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {needsHumanReview && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>Pipeline paused — ask the copilot before deciding.</span>
          </div>
        )}

        <div className="max-h-[28rem] space-y-4 overflow-y-auto pr-1">
          {isEmpty ? (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                Try one of these to get started:
              </p>
              <div className="flex flex-wrap gap-2">
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void send(prompt)}
                    className="rounded-full border border-gray-200 bg-muted/40 px-3 py-1.5 text-xs font-medium text-[#1e3a5f] transition-colors hover:bg-muted"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((turn, index) => (
              <div
                key={`${turn.role}-${index}`}
                className={cn(
                  "flex gap-3",
                  turn.role === "user" ? "flex-row-reverse" : "flex-row",
                )}
              >
                <div
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full",
                    turn.role === "user"
                      ? "bg-[#1e3a5f] text-white"
                      : "bg-muted text-[#1e3a5f]",
                  )}
                >
                  {turn.role === "user" ? (
                    <User className="size-3.5" />
                  ) : (
                    <Bot className="size-3.5" />
                  )}
                </div>
                <div
                  className={cn(
                    "min-w-0 max-w-[85%] space-y-2",
                    turn.role === "user" ? "items-end text-right" : "",
                  )}
                >
                  <div
                    className={cn(
                      "inline-block whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed",
                      turn.role === "user"
                        ? "bg-[#1e3a5f] text-white"
                        : "bg-muted text-foreground",
                    )}
                  >
                    {turn.content}
                  </div>

                  {turn.role === "assistant" &&
                    turn.suggestedActions &&
                    turn.suggestedActions.length > 0 && (
                      <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-2.5 text-left">
                        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                          <Lightbulb className="size-3.5" />
                          Suggested actions
                        </p>
                        <ul className="space-y-1 text-xs text-emerald-900">
                          {turn.suggestedActions.map((action, i) => (
                            <li key={i} className="flex gap-1.5">
                              <span className="text-emerald-500">•</span>
                              <span>{action}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                  {turn.role === "assistant" &&
                    turn.citations &&
                    turn.citations.length > 0 && (
                      <p className="text-left text-[11px] text-muted-foreground">
                        Sources: {turn.citations.join(", ")}
                      </p>
                    )}
                </div>
              </div>
            ))
          )}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Bot className="size-4" />
              <Loader2 className="size-3.5 animate-spin" />
              Thinking…
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div ref={scrollRef} />
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex items-end gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Ask about denials, corrections, codes, or next steps…"
            className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#1e3a5f]"
          />
          <Button
            type="submit"
            size="icon"
            disabled={loading || !input.trim()}
            className="shrink-0"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
