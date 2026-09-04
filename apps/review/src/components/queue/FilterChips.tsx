"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import styles from "./FilterChips.module.css";

export interface FilterChip {
  key: string;
  label: string;
  /** The unfiltered count for this chip, so a filter is never read as an empty queue. */
  count: number;
  href: string;
  active: boolean;
}

export interface FilterChipsProps {
  chips: FilterChip[];
  /** Tier and surface refinements, behind a disclosure so the fold stays clean. */
  refine?: ReactNode;
  /** Open the disclosure when a refinement is already applied. */
  refineOpen?: boolean;
}

/**
 * Five chips, in their own horizontal scroll container so the page body never
 * scrolls sideways at 320px. 1 to 5 move focus to a chip and do not activate
 * it; / moves focus to the first one.
 */
export function FilterChips({ chips, refine, refineOpen = false }: FilterChipsProps) {
  const refs = useRef<Array<HTMLAnchorElement | null>>([]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
          return;
        }
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "/") {
        event.preventDefault();
        refs.current[0]?.focus();
        return;
      }
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < refs.current.length) {
        event.preventDefault();
        refs.current[index]?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className={styles.wrap}>
      <nav className={styles.chips} aria-label="Queue filters">
        {chips.map((chip, index) => (
          <Link
            key={chip.key}
            href={chip.href}
            ref={(element) => {
              refs.current[index] = element;
            }}
            className={styles.chip}
            data-active={chip.active ? "true" : undefined}
            aria-current={chip.active ? "true" : undefined}
          >
            <span>{chip.label}</span>
            <span className={`${styles.count} tabular`}>{chip.count}</span>
          </Link>
        ))}
      </nav>
      {refine ? (
        <details className={styles.refine} open={refineOpen}>
          <summary className={styles.summary}>More filters</summary>
          <div className={styles.refineBody}>{refine}</div>
        </details>
      ) : null}
    </div>
  );
}

export interface RefineLinkProps {
  href: string;
  label: string;
  active: boolean;
}

/** One tier or surface refinement. Same control, without the count. */
export function RefineLink({ href, label, active }: RefineLinkProps) {
  return (
    <Link
      href={href}
      className={styles.chip}
      data-active={active ? "true" : undefined}
      aria-current={active ? "true" : undefined}
    >
      {label}
    </Link>
  );
}
