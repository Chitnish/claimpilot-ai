"use client";

import * as React from "react";
import {
  motion,
  useInView,
  useReducedMotion,
  type Variants,
} from "framer-motion";

import { cn } from "@/lib/utils";

/**
 * Shared animation primitives for the v2 design system.
 *
 * Strategy (skill: Soft UI Evolution + Trust & Authority):
 *  - Scroll reveals: fade + slight slide-up as a section enters the viewport
 *    (threshold 0.1, plays once). Card grids stagger children by 0.08s.
 *  - Number count-up: stat numerals animate 0 → value with an easeOut curve.
 *  - Everything degrades gracefully under `prefers-reduced-motion`.
 */

// easeOutQuint — confident, decelerating entrance (ease-out per UX guidance).
const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/* ── Count-up numerals ──────────────────────────────────────────────── */

interface CountUpProps {
  value: number;
  /** Animation length in ms (default 1200, per spec). */
  duration?: number;
  /** Render a raw number into its display string (currency, %, etc.). */
  format?: (value: number) => string;
  className?: string;
}

export function CountUp({
  value,
  duration = 1200,
  format = (n) => Math.round(n).toLocaleString(),
  className,
}: CountUpProps): React.ReactElement {
  const reduce = useReducedMotion();
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const [display, setDisplay] = React.useState(0);

  React.useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }
    if (!inView) return;

    let raf = 0;
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(value * easeOutCubic(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduce, value, duration]);

  return (
    <span ref={ref} className={className}>
      {format(reduce ? value : display)}
    </span>
  );
}

/* ── Scroll-triggered reveal ────────────────────────────────────────── */

interface RevealProps {
  children: React.ReactNode;
  className?: string;
  /** Stagger offset for manual sequencing (seconds). */
  delay?: number;
  /** Vertical travel distance in px (default 16). */
  y?: number;
}

export function Reveal({
  children,
  className,
  delay = 0,
  y = 16,
}: RevealProps): React.ReactElement {
  const reduce = useReducedMotion();

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.55, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  );
}

/* ── Staggered grids ────────────────────────────────────────────────── */

const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
};

interface StaggerProps {
  children: React.ReactNode;
  className?: string;
}

/** Wrap a grid/list; direct {@link StaggerItem} children appear one-by-one. */
export function Stagger({
  children,
  className,
}: StaggerProps): React.ReactElement {
  const reduce = useReducedMotion();

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      variants={containerVariants}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.1 }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: StaggerProps): React.ReactElement {
  const reduce = useReducedMotion();

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div className={cn(className)} variants={itemVariants}>
      {children}
    </motion.div>
  );
}
