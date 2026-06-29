"use client";

import { AnimatePresence, motion } from "framer-motion";

const AGENTS = [
  "intake",
  "eligibility",
  "coding",
  "scrub",
  "submission",
  "reconciliation",
  "fraud",
] as const;

type AgentName = (typeof AGENTS)[number];

const AGENT_COLORS: Record<AgentName, string> = {
  intake: "#3b82f6",
  eligibility: "#14b8a6",
  coding: "#8b5cf6",
  scrub: "#f97316",
  submission: "#ef4444",
  reconciliation: "#22c55e",
  fraud: "#6b7280",
};

const HUMAN_REVIEW_COLOR = "#f59e0b";

const IDLE_SURFACE = "#131c30"; // dark idle node surface
const IDLE_BORDER = "#334155"; // slate-700
const IDLE_TEXT = "#94a3b8"; // slate-400
const GREEN_ARROW = "#22c55e";

export interface PipelineDiagramProps {
  activeAgent: string | null;
  completedAgents: string[];
  status: string;
}

function toTitleCase(agent: string): string {
  return agent.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function hexWithOpacity(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function isAgentCompleted(
  agent: AgentName,
  completedAgents: string[],
): boolean {
  return completedAgents.includes(agent);
}

function isAgentActive(
  agent: AgentName,
  activeAgent: string | null,
): boolean {
  return activeAgent === agent;
}

function needsReview(
  agent: AgentName,
  status: string,
): boolean {
  return status === "needs_review" && agent === "scrub";
}

interface AgentNodeProps {
  agent: AgentName;
  activeAgent: string | null;
  completedAgents: string[];
  status: string;
}

function AgentNode({
  agent,
  activeAgent,
  completedAgents,
  status,
}: AgentNodeProps): React.ReactElement {
  const color = AGENT_COLORS[agent];
  const completed = isAgentCompleted(agent, completedAgents);
  const active = isAgentActive(agent, activeAgent);
  const review = needsReview(agent, status);

  let background = IDLE_SURFACE;
  let borderColor = IDLE_BORDER;
  let textColor = IDLE_TEXT;
  let prefix = "";

  if (active) {
    background = color;
    borderColor = color;
    textColor = "#ffffff";
  } else if (review) {
    background = IDLE_SURFACE;
    borderColor = HUMAN_REVIEW_COLOR;
    textColor = HUMAN_REVIEW_COLOR;
    prefix = "⚠ ";
  } else if (completed) {
    background = hexWithOpacity(color, 0.16);
    borderColor = color;
    textColor = "#ffffff";
    prefix = "✓ ";
  }

  const baseStyle: React.CSSProperties = {
    width: 96,
    height: 56,
    borderRadius: 10,
    border: `2px solid ${borderColor}`,
    backgroundColor: background,
    color: textColor,
    fontSize: 12,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    lineHeight: 1.2,
    padding: "0 6px",
    flexShrink: 0,
    boxShadow: active
      ? `0 4px 14px ${hexWithOpacity(color, 0.45)}`
      : "0 1px 2px rgba(0,0,0,0.4)",
  };

  if (active) {
    return (
      <motion.div
        style={baseStyle}
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ repeat: Infinity, duration: 1, ease: "easeInOut" }}
      >
        {prefix}
        {toTitleCase(agent)}
      </motion.div>
    );
  }

  return (
    <div style={baseStyle}>
      {prefix}
      {toTitleCase(agent)}
    </div>
  );
}

interface PipelineArrowProps {
  source: AgentName;
  target: AgentName;
  activeAgent: string | null;
  completedAgents: string[];
}

function PipelineArrow({
  source,
  target,
  activeAgent,
  completedAgents,
}: PipelineArrowProps): React.ReactElement {
  const sourceCompleted = isAgentCompleted(source, completedAgents);
  const targetActive = isAgentActive(target, activeAgent);
  const bothCompleted =
    sourceCompleted && isAgentCompleted(target, completedAgents);
  const isAnimating = sourceCompleted && targetActive;

  const arrowColor = bothCompleted ? GREEN_ARROW : IDLE_BORDER;

  return (
    <div
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: 28, height: 56 }}
      aria-hidden
    >
      <span
        style={{
          color: arrowColor,
          fontSize: 16,
          lineHeight: 1,
          userSelect: "none",
        }}
      >
        →
      </span>
      <AnimatePresence>
        {isAnimating && (
          <motion.div
            key={`${source}-${target}-dot`}
            className="absolute top-1/2 size-2 rounded-full"
            style={{ backgroundColor: AGENT_COLORS[target], marginTop: -4 }}
            initial={{ left: 2, opacity: 0 }}
            animate={{ left: [2, 22], opacity: [0, 1, 1, 0] }}
            exit={{ opacity: 0 }}
            transition={{
              repeat: Infinity,
              duration: 0.8,
              ease: "easeInOut",
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

interface AgentRowProps {
  agents: readonly AgentName[];
  activeAgent: string | null;
  completedAgents: string[];
  status: string;
}

function AgentRow({
  agents,
  activeAgent,
  completedAgents,
  status,
}: AgentRowProps): React.ReactElement {
  return (
    <div className="flex items-center justify-center">
      {agents.map((agent, index) => (
        <div key={agent} className="flex items-center">
          <AgentNode
            agent={agent}
            activeAgent={activeAgent}
            completedAgents={completedAgents}
            status={status}
          />
          {index < agents.length - 1 && (
            <PipelineArrow
              source={agent}
              target={agents[index + 1]!}
              activeAgent={activeAgent}
              completedAgents={completedAgents}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function PipelineDiagram({
  activeAgent,
  completedAgents,
  status,
}: PipelineDiagramProps): React.ReactElement {
  const firstRow = AGENTS.slice(0, 4);
  const secondRow = AGENTS.slice(4);
  const isLive = activeAgent !== null;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-card shadow-elevated">
      <div className="sidebar-surface flex items-center justify-between border-b border-white/10 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="relative flex size-2.5">
            {isLive && (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-75" />
            )}
            <span
              className={`relative inline-flex size-2.5 rounded-full ${
                isLive ? "bg-brand" : "bg-slate-500"
              }`}
            />
          </span>
          <div className="leading-tight">
            <span className="block font-display text-sm font-semibold tracking-tight text-white">
              Live Processing Pipeline
            </span>
            <span className="block text-[10px] uppercase tracking-wider text-slate-400">
              Intake → Reconciliation
            </span>
          </div>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-slate-300">
          7 AI Agents
        </span>
      </div>
      <div className="relative bg-gradient-to-b from-[#0c1322] to-[#0a0f1e] p-5 sm:p-7">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 50% 0%, rgba(14,165,233,0.1), transparent 60%)",
          }}
          aria-hidden
        />
        {/* Mobile: two rows */}
        <div className="relative flex flex-col items-center gap-4 sm:hidden">
          <AgentRow
            agents={firstRow}
            activeAgent={activeAgent}
            completedAgents={completedAgents}
            status={status}
          />
          <AgentRow
            agents={secondRow}
            activeAgent={activeAgent}
            completedAgents={completedAgents}
            status={status}
          />
        </div>

        {/* Desktop: single row */}
        <div className="relative hidden sm:flex sm:justify-center">
          <AgentRow
            agents={AGENTS}
            activeAgent={activeAgent}
            completedAgents={completedAgents}
            status={status}
          />
        </div>
      </div>
    </div>
  );
}
