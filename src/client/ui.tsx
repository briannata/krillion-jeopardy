/**
 * Shared pieces used by both the player and host views.
 *
 * Tier colour lookups live here so nothing hardcodes a hex: a tier's colour comes
 * from its points, via the CSS custom properties in tokens.css.
 */

import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { PlayerView, RevealEntry, Tier } from "../game/types.ts";

export const TIER_NAME: Record<Tier, string> = {
  plankton: "Plankton",
  tooclever: "Too Clever",
  schooler: "Schooler",
  rare: "Rare",
  deepcut: "Deep Cut",
  krillion: "One in a Krillion",
};

/** Colour by points, so the ramp stays in one place. */
export function tierColor(points: number): string {
  if (points >= 100) return "var(--tier-100)";
  if (points >= 85) return "var(--tier-85)";
  if (points >= 60) return "var(--tier-60)";
  if (points >= 30) return "var(--tier-30)";
  if (points >= 15) return "var(--tier-15)";
  if (points >= 10) return "var(--tier-10)";
  return "var(--tier-miss)";
}

export const METRES = (points: number) => `${(points * 10).toLocaleString()} m`;

/** Stable per-player tone: index into the muted diver ramp. */
export function diverColor(players: PlayerView[], id: string): string {
  const i = players.findIndex((p) => p.id === id);
  return `var(--diver-${((i < 0 ? 0 : i) % 6)})`;
}

export function Avatar({
  player, players, size = 34,
}: { player: PlayerView; players: PlayerView[]; size?: number }) {
  return (
    <div
      className="avatar"
      style={{ width: size, height: size, background: diverColor(players, player.id), fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {player.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function TierChip({ points, tier }: { points: number; tier?: Tier }) {
  const c = tierColor(points);
  return (
    <span
      className="mono"
      style={{
        fontSize: 10, letterSpacing: "0.12em", borderRadius: 4, padding: "5px 10px",
        background: points > 0 ? c : "transparent",
        border: points > 0 ? "none" : "1px solid var(--line)",
        color: points > 0 ? "var(--tier-ink)" : "var(--dim)",
        whiteSpace: "nowrap",
      }}
    >
      {tier ? TIER_NAME[tier].toUpperCase() : "LOST AT SEA"}
    </span>
  );
}

export function Panel({ children, style, tone = "low" }: {
  children: ReactNode; style?: CSSProperties; tone?: "low" | "mid" | "high";
}) {
  const bg = tone === "high" ? "var(--panel-high)" : tone === "mid" ? "var(--panel)" : "var(--panel-low)";
  return (
    <div style={{ background: bg, border: "1px solid var(--line)", borderRadius: "var(--radius)", ...style }}>
      {children}
    </div>
  );
}

/** A countdown that renders from the server's deadline, not a local timer. */
export function useCountdown(deadline?: number): number {
  const [, force] = useTick(deadline !== undefined);
  if (deadline === undefined) return 0;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

function useTick(on: boolean): [number, () => void] {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setN((x) => x + 1), 250);
    return () => clearInterval(id);
  }, [on]);
  return [n, () => setN((x) => x + 1)];
}

export function Wordmark({ small }: { small?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h1 style={{
        margin: 0, fontSize: small ? 28 : 44, lineHeight: 0.92,
        fontWeight: 800, letterSpacing: "-0.025em",
      }}>
        KRILLION
      </h1>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ height: 1, width: 28, background: "var(--accent)" }} />
        <span className="mono" style={{
          fontSize: small ? 11 : 13, letterSpacing: "0.24em", color: "var(--accent)", fontWeight: 500,
        }}>
          JEOPARDY
        </span>
      </div>
    </div>
  );
}

/** One player's result line, used in both reveals. */
export function RevealRow({ entry, players, big }: {
  entry: RevealEntry; players: PlayerView[]; big?: boolean;
}) {
  const player = players.find((p) => p.id === entry.playerId);
  if (!player) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
      <Avatar player={player} players={players} size={big ? 42 : 32} />
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span style={{ fontSize: big ? 19 : 16, fontWeight: 600 }}>{player.name}</span>
        <span style={{
          fontSize: big ? 15 : 13,
          color: entry.points > 0 ? tierColor(entry.points) : "var(--dim)",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {entry.matchedAnswer ?? `“${entry.text || "—"}”`}
        </span>
      </div>
    </div>
  );
}

export function Attribution() {
  return (
    <span style={{ fontSize: 12, color: "var(--dim)", lineHeight: 1.5 }}>
      Prompts and answers from krillion.io. Unofficial, not affiliated.
    </span>
  );
}
