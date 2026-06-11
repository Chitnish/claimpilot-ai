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

const GRAY_BORDER = "#d1d5db";
const GRAY_TEXT = "#6b7280";
const GREEN_ARROW = "#22c55e";
const NAVY_HEADER = "#1e3a5f";

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

  let background = "#ffffff";
  let borderColor = GRAY_BORDER;
  let textColor = GRAY_TEXT;
  let prefix = "";

  if (active) {
    background = color;
    borderColor = color;
    textColor = "#ffffff";
  } else if (review) {
    background = "#ffffff";
    borderColor = HUMAN_REVIEW_COLOR;
    textColor = color;
    prefix = "⚠ ";
  } else if (completed) {
    background = hexWithOpacity(color, 0.1);
    borderColor = color;
    textColor = color;
    prefix = "✓ ";
  }

  const baseStyle: React.CSSProperties = {
    width: 80,
    height: 48,
    borderRadius: 8,
    border: `2px solid ${borderColor}`,
    backgroundColor: background,
    color: textColor,
    fontSize: 11,
    fontWeight: 500,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    lineHeight: 1.2,
    padding: "0 4px",
    flexShrink: 0,
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

  const arrowColor = bothCompleted ? GREEN_ARROW : GRAY_BORDER;

  return (
    <div
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: 16, height: 48 }}
      aria-hidden
    >
      <span
        style={{
          color: arrowColor,
          fontSize: 14,
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
            className="absolute top-1/2 size-1.5 rounded-full"
            style={{ backgroundColor: AGENT_COLORS[target], marginTop: -3 }}
            initial={{ left: 0, opacity: 0 }}
            animate={{ left: [0, 12], opacity: [0, 1, 1, 0] }}
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

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div
        className="px-4 py-2.5 text-sm font-semibold text-white"
        style={{ backgroundColor: NAVY_HEADER }}
      >
        ClaimPilot AI — Live Pipeline
      </div>
      <div className="p-4">
        {/* Mobile: two rows */}
        <div className="flex flex-col items-center gap-3 sm:hidden">
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
        <div className="hidden sm:flex sm:justify-center">
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
