/**
 * The host screen: the shared display, landscape, read-only.
 *
 * It attaches with `watch`, so it receives state but never becomes a player and
 * never appears on the scoreboard. It also never sends an intent — every control
 * lives on the phones.
 */

import type { GameView, PlayerView } from "../game/types.ts";
import type { Game } from "./useGame.ts";
import {
  Attribution, Avatar, Panel, RevealRow, TierChip, Wordmark,
  METRES, tierColor, useCountdown,
} from "./ui.tsx";

const screen = {
  minHeight: "100dvh", display: "flex", flexDirection: "column" as const,
  padding: "32px 48px 26px",
};

export function Host({ game, code }: { game: Game; code: string }) {
  const { state } = game;

  if (!state) {
    return (
      <div style={{ ...screen, alignItems: "center", justifyContent: "center", gap: 20 }}>
        <Wordmark />
        <p style={{ fontSize: 18, color: "var(--muted)" }}>
          {game.error ?? `Connecting to room ${code}…`}
        </p>
        {/* A bad or expired code would otherwise dead-end on a blank screen. */}
        {game.error && (
          <a href="/" className="btn btn-quiet" style={{ textDecoration: "none", width: 260, textAlign: "center" }}>
            Back
          </a>
        )}
      </div>
    );
  }

  switch (state.phase) {
    case "lobby": return <HostLobby state={state} />;
    case "picking": return <HostBoard state={state} />;
    case "answering": return <HostAnswering state={state} />;
    case "revealing": return <HostReveal state={state} />;
    case "finished": return <HostSurfaced state={state} />;
  }
}

/**
 * The join QR. The server draws it, but from THIS screen's origin: a phone has
 * to be able to reach the address, and whatever address this screen was opened
 * at is one the phones beside it can reach too. The server's own view of the
 * request is useless here — in dev the Vite proxy makes it localhost.
 */
function JoinQr({ code, size }: { code: string; size: number }) {
  const src = `/api/rooms/${code}/qr.svg?origin=${encodeURIComponent(location.origin)}`;
  return (
    <img
      src={src} width={size} height={size} alt={`Scan to join room ${code}`}
      style={{
        display: "block", borderRadius: "var(--radius)",
        background: "var(--text)", border: "1px solid var(--line)",
      }}
    />
  );
}

// ---------------------------------------------------------------- lobby

function HostLobby({ state }: { state: GameView }) {
  return (
    <div style={{ ...screen, flexDirection: "row", gap: 72, alignItems: "center" }}>
      <div style={{ width: 620, flexShrink: 0 }}>
        <Wordmark />
        <p className="mono" style={{
          margin: "28px 0 18px", fontSize: 13, letterSpacing: "0.22em", color: "var(--muted)",
        }}>
          JOIN AND ENTER THIS CODE
        </p>

        <div style={{ display: "flex", gap: 16, marginBottom: 32 }}>
          {state.code.split("").map((ch, i) => (
            <div key={i} style={{
              width: 128, height: 160, borderRadius: "var(--radius)", background: "var(--panel)",
              border: "1px solid var(--accent)", display: "flex", alignItems: "center",
              justifyContent: "center", fontFamily: "var(--mono)", fontSize: 86, fontWeight: 600,
            }}>{ch}</div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 26, alignItems: "center", margin: "0 0 28px" }}>
          <JoinQr code={state.code} size={172} />
          <div style={{ maxWidth: 330 }}>
            <p className="mono" style={{
              margin: "0 0 10px", fontSize: 13, letterSpacing: "0.2em", color: "var(--accent)",
            }}>
              OR SCAN TO JOIN
            </p>
            <p style={{ margin: 0, fontSize: 18, color: "var(--muted)", lineHeight: 1.55 }}>
              Twenty prompts. Everyone answers at once, and the rarer your answer,
              the deeper you sink. No limit on players.
            </p>
          </div>
        </div>
        <Attribution />
      </div>

      <div style={{ flexGrow: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24 }}>
          <span className="mono" style={{ fontSize: 13, letterSpacing: "0.2em", color: "var(--muted)" }}>
            DIVERS ABOARD
          </span>
          <span className="mono" style={{ fontSize: 34, fontWeight: 600, color: "var(--accent)" }}>
            {String(state.players.length).padStart(2, "0")}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
          {state.players.map((p) => (
            <Panel key={p.id} tone="mid" className="fade-in" style={{
              display: "flex", alignItems: "center", gap: 16, padding: 20,
              opacity: p.connected ? 1 : 0.45,
            }}>
              <Avatar player={p} players={state.players} size={52} />
              <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                <span style={{ fontSize: 21, fontWeight: 600 }}>{p.name}</span>
                {p.isHost && (
                  <span className="mono" style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--accent)" }}>
                    HOST
                  </span>
                )}
              </div>
            </Panel>
          ))}
          {state.players.length === 0 && (
            <p style={{ fontSize: 17, color: "var(--dim)" }}>Nobody yet — the code is on the left.</p>
          )}
        </div>

        {state.players.length > 0 && (
          <p style={{ margin: "32px 0 0", fontSize: 15, color: "var(--dim)" }}>
            {state.players.find((p) => p.isHost)?.name} starts the dive from their phone.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- board

function HostBoard({ state }: { state: GameView }) {
  const picker = state.players.find((p) => p.id === state.pickerId);
  return (
    <div style={screen}>
      <TopBar state={state} centre={picker ? `${picker.name} is picking` : "Choosing"} />

      <div style={{
        display: "grid", gridTemplateColumns: `repeat(${state.columns.length}, minmax(0, 1fr))`,
        gap: 14, marginBottom: 24,
      }}>
        {state.columns.map((c) => (
          <div key={c.theme} style={{
            height: 56, borderRadius: "var(--radius)", background: "var(--panel)",
            border: "1px solid var(--line)", display: "flex", alignItems: "center",
            justifyContent: "center", padding: "0 12px",
          }}>
            <span className="mono" style={{
              fontSize: 13, letterSpacing: "0.14em", color: "var(--accent)", textAlign: "center",
            }}>{c.label.toUpperCase()}</span>
          </div>
        ))}

        {/* Tiles flow row-major, so read the grid by rows. */}
        {Array.from({ length: state.columns[0]?.tileIds.length ?? 0 }).flatMap((_, row) =>
          state.columns.map((col) => {
            const tile = state.tiles.find((t) => t.id === col.tileIds[row])!;
            return tile.played ? (
              <div key={tile.id} style={{
                height: 118, borderRadius: "var(--radius)", background: "var(--panel-low)",
                border: "1px solid var(--line-soft)", padding: 16, overflow: "hidden",
              }}>
                <span style={{ fontSize: 15, color: "var(--dim)", lineHeight: 1.35 }}>
                  {tile.promptText}
                </span>
              </div>
            ) : (
              <div key={tile.id} style={{
                height: 118, borderRadius: "var(--radius)", background: "var(--panel)",
                border: "1px solid var(--accent)",
              }} />
            );
          }),
        )}
      </div>

      <div style={{ flexGrow: 1 }} />
      <ScoreStrip state={state} />
    </div>
  );
}

// ---------------------------------------------------------------- answering

function HostAnswering({ state }: { state: GameView }) {
  const round = state.round!;
  const left = useCountdown(round.deadline);
  const lockedCount = round.submissions.filter((s) => s.locked).length;
  const total = Math.max(left, 1);

  return (
    <div style={{ ...screen, padding: 0 }}>
      <div style={{ height: 6, background: "var(--line-soft)" }}>
        <div style={{
          height: 6, background: "var(--accent)",
          width: `${Math.min(100, (left / Math.max(total, 30)) * 100)}%`,
          transition: "width 0.25s linear",
        }} />
      </div>

      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", padding: "48px 72px 40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 56 }}>
          <span className="mono" style={{
            fontSize: 14, letterSpacing: "0.18em", color: "var(--accent)",
            border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)", padding: "9px 20px",
          }}>
            {state.columns.find((c) => c.theme === round.theme)?.label.toUpperCase()}
          </span>
          <span className="mono" style={{ fontSize: 14, letterSpacing: "0.18em", color: "var(--muted)" }}>
            ROUND {String(round.number).padStart(2, "0")} / {state.totalRounds}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 64, marginBottom: 56 }}>
          <h2 style={{
            margin: 0, fontSize: 72, lineHeight: 1.08, fontWeight: 700,
            letterSpacing: "-0.03em", flexGrow: 1,
          }}>{round.promptText}</h2>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 200, flexShrink: 0 }}>
            <span className="mono" style={{
              fontSize: 112, fontWeight: 600, lineHeight: 1, fontVariantNumeric: "tabular-nums",
              color: left <= 5 ? "var(--tier-85)" : "var(--text)",
            }}>{left}</span>
            <span className="mono" style={{ fontSize: 15, letterSpacing: "0.2em", color: "var(--dim)", marginTop: 8 }}>
              SECONDS
            </span>
          </div>
        </div>

        <div style={{ flexGrow: 1 }} />

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20 }}>
            <span className="mono" style={{ fontSize: 14, letterSpacing: "0.18em", color: "var(--muted)" }}>
              {lockedCount} OF {round.submissions.length} LOCKED IN
            </span>
            <span style={{ fontSize: 15, color: "var(--dim)" }}>Answers stay hidden until the reveal</span>
          </div>

          <div style={{
            display: "grid", gap: 14,
            gridTemplateColumns: `repeat(${Math.min(8, Math.max(3, round.submissions.length))}, minmax(0, 1fr))`,
          }}>
            {round.submissions.map((s) => {
              const p = state.players.find((x) => x.id === s.playerId);
              if (!p) return null;
              return (
                <Panel key={s.playerId} tone={s.locked ? "mid" : "low"} style={{
                  padding: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                  borderColor: s.locked ? "var(--accent)" : "var(--line)",
                }}>
                  <Avatar player={p} players={state.players} size={46} />
                  <span style={{ fontSize: 17, fontWeight: 600 }}>{p.name}</span>
                  <span className="mono" style={{
                    fontSize: 11, letterSpacing: "0.12em",
                    color: s.locked ? "var(--accent)" : "var(--dim)",
                  }}>
                    {s.locked ? "LOCKED" : s.started ? "TYPING" : "NOTHING YET"}
                  </span>
                </Panel>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- reveal

function HostReveal({ state }: { state: GameView }) {
  const round = state.round!;
  const shown = round.revealed;
  const latest = shown[shown.length - 1];
  const earlier = shown.slice(0, -1).reverse();

  return (
    <div style={screen}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span className="mono" style={{ fontSize: 13, letterSpacing: "0.18em", color: "var(--muted)" }}>
          {state.columns.find((c) => c.theme === round.theme)?.label.toUpperCase()} · ROUND {round.number}
        </span>
        <span className="mono" style={{ fontSize: 13, letterSpacing: "0.18em", color: "var(--muted)" }}>
          CARD {shown.length} OF {round.revealTotal}
        </span>
      </div>
      <h2 style={{ margin: "0 0 26px", fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--muted)" }}>
        {round.promptText}
      </h2>

      {/* The batch that just turned over gets the whole card. */}
      {latest && (
        <div key={shown.length} className="rise-in" style={{
          background: latest.points >= 85 ? "#241f3a" : "var(--panel-high)",
          border: `2px solid ${tierColor(latest.points)}`,
          borderRadius: "var(--radius)", padding: "30px 36px", marginBottom: 20,
          display: "flex", alignItems: "center", gap: 44,
        }}>
          <div style={{ width: 210, flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="mono" style={{
              fontSize: 76, fontWeight: 600, lineHeight: 1, color: tierColor(latest.points),
            }}>
              {latest.points > 0 ? `+${latest.points}` : "0"}
            </span>
            <span className="mono" style={{ fontSize: 13, letterSpacing: "0.16em", color: tierColor(latest.points) }}>
              {latest.points > 0 ? `${METRES(latest.points)} DOWN` : "LOST AT SEA"}
            </span>
          </div>
          <div style={{ flexGrow: 1, display: "flex", gap: 34, flexWrap: "wrap" }}>
            {latest.entries.map((e) => <RevealRow key={e.playerId} entry={e} players={state.players} big />)}
          </div>
          <TierChip points={latest.points} tier={latest.tier} />
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {earlier.map((batch, i) => (
          <Panel key={`${batch.points}-${i}`} style={{
            padding: "18px 26px", display: "flex", alignItems: "center", gap: 28,
            borderColor: batch.points > 0 ? tierColor(batch.points) : "var(--line)",
          }}>
            <div style={{ width: 210, flexShrink: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span className="mono" style={{
                fontSize: 28, fontWeight: 600, lineHeight: 1, color: tierColor(batch.points),
              }}>
                {batch.points > 0 ? `+${batch.points}` : "0"}
              </span>
              <span className="mono" style={{ fontSize: 11, letterSpacing: "0.14em", color: tierColor(batch.points) }}>
                {batch.tier ? batch.tier.toUpperCase() : "LOST AT SEA"}
              </span>
            </div>
            <div style={{ flexGrow: 1, display: "flex", gap: 28, flexWrap: "wrap" }}>
              {batch.entries.map((e) => <RevealRow key={e.playerId} entry={e} players={state.players} />)}
            </div>
          </Panel>
        ))}
      </div>

      <div style={{ flexGrow: 1 }} />
      <ScoreStrip state={state} />
    </div>
  );
}

// ---------------------------------------------------------------- surfaced

function HostSurfaced({ state }: { state: GameView }) {
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const deepest = Math.max(1, ranked[0]?.score ?? 1);
  const PLOT = 560;

  // Lay the cards out at their true depth, then push them apart so none can
  // overlap. The dot on the axis keeps the real position; the leader line owns
  // the difference.
  const CARD = 46, PITCH = 54;
  const shallowFirst = [...ranked].reverse();
  const ideal = shallowFirst.map((p) => (p.score / deepest) * (PLOT - CARD));
  const tops = [...ideal];
  for (let i = 1; i < tops.length; i++) tops[i] = Math.max(tops[i]!, tops[i - 1]! + PITCH);
  const overflow = tops[tops.length - 1]! - (PLOT - CARD);
  if (overflow > 0) {
    tops[tops.length - 1] = PLOT - CARD;
    for (let i = tops.length - 2; i >= 0; i--) tops[i] = Math.min(tops[i]!, tops[i + 1]! - PITCH);
  }

  return (
    <div style={screen}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 14 }}>
        <div>
          <span className="mono" style={{ fontSize: 12, letterSpacing: "0.22em", color: "var(--accent)" }}>
            BOARD CLEARED · {state.totalRounds} PROMPTS
          </span>
          <h2 style={{ margin: "6px 0 0", fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>
            Final depths
          </h2>
        </div>
        <span style={{ fontSize: 16, color: "var(--muted)" }}>
          Points × 10 = metres · The Catch is open on every phone
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.16em", color: "var(--muted)", width: 96 }}>
          SURFACE
        </span>
        <div style={{ flexGrow: 1, height: 1, background: "var(--line-strong)" }} />
        <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>0 m</span>
      </div>

      <div style={{ position: "relative", height: PLOT, flexShrink: 0 }}>
        <div style={{
          position: "absolute", left: 110, top: 0, height: PLOT, width: 2,
          background: "linear-gradient(180deg, var(--line-soft), var(--tier-100))",
        }} />

        {shallowFirst.map((p, i) => {
          const rank = ranked.indexOf(p) + 1;
          const top = tops[i]!;
          const trueY = ideal[i]!;
          const centre = top + CARD / 2;
          const colour = rank === 1 ? "var(--tier-100)" : rank === 2 ? "var(--tier-60)" : rank === 3 ? "var(--tier-30)" : "var(--muted)";
          return (
            <div key={p.id}>
              <div className="fade-in" style={{ animationDelay: `${i * 0.5 + 0.95}s` }}>
                <div style={{
                  position: "absolute", left: 106, top: trueY - 4, width: 9, height: 9,
                  borderRadius: "50%", background: rank <= 3 ? colour : "var(--ground)",
                  border: rank <= 3 ? "none" : "1px solid var(--line-strong)",
                }} />
                <div style={{ position: "absolute", left: 116, top: trueY, width: 30, height: 1, background: "var(--line-strong)" }} />
                <div style={{
                  position: "absolute", left: 146, top: Math.min(trueY, centre), width: 1,
                  height: Math.abs(centre - trueY), background: "var(--line-strong)",
                }} />
                <div style={{ position: "absolute", left: 146, top: centre, width: 54, height: 1, background: "var(--line-strong)" }} />
              </div>

              <div
                className="sink"
                style={{
                  ["--rise" as string]: `${-top - 40}px`,
                  animationDelay: `${i * 0.5}s`,
                  animationDuration: `${0.95 + i * 0.07}s`,
                  position: "absolute", top, left: 200, right: 0, height: rank === 1 ? CARD + 10 : CARD,
                  display: "flex", alignItems: "center", gap: 14, padding: "0 16px",
                  background: rank === 1 ? "#241f3a" : rank <= 3 ? "var(--panel)" : "var(--panel-low)",
                  border: `${rank === 1 ? 2 : 1}px solid ${rank <= 3 ? colour : "var(--line)"}`,
                  borderRadius: "var(--radius)",
                }}
              >
                <div className="mono" style={{
                  width: 34, height: 34, borderRadius: "var(--radius-sm)", flexShrink: 0,
                  background: rank === 1 ? "var(--tier-100)" : "transparent",
                  border: rank === 1 ? "none" : rank <= 3 ? `1px solid ${colour}` : "none",
                  color: rank === 1 ? "var(--tier-ink)" : rank <= 3 ? colour : "var(--faint)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 16, fontWeight: 600,
                }}>{rank}</div>
                <Avatar player={p} players={state.players} size={rank === 1 ? 38 : 32} />
                <span style={{ fontSize: rank === 1 ? 22 : 18, fontWeight: rank <= 3 ? 700 : 600 }}>{p.name}</span>
                {rank === 1 && (
                  <span className="mono" style={{ fontSize: 10, letterSpacing: "0.14em", color: "var(--tier-100)" }}>
                    DEEPEST DIVE OF THE NIGHT
                  </span>
                )}
                <span style={{ flexGrow: 1 }} />
                <span className="mono" style={{ fontSize: rank === 1 ? 22 : 17, fontWeight: 600 }}>
                  {METRES(p.score)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ flexGrow: 1 }} />
      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 14, color: "var(--dim)" }}>
          Cards shift to stay legible — the dot on the axis marks the true depth.
        </span>
        <Attribution />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- bits

function TopBar({ state, centre }: { state: GameView; centre: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <span style={{ fontSize: 25, fontWeight: 800, letterSpacing: "-0.02em" }}>KRILLION</span>
        <div style={{ height: 18, width: 1, background: "var(--line-strong)" }} />
        <span className="mono" style={{ fontSize: 13, letterSpacing: "0.18em", color: "var(--muted)" }}>
          ROUND {String(state.roundNumber + 1).padStart(2, "0")} / {state.totalRounds}
        </span>
      </div>

      <Panel tone="mid" style={{ padding: "10px 22px", borderColor: "var(--accent)" }}>
        <span style={{ fontSize: 18, fontWeight: 600 }}>{centre}</span>
      </Panel>

      <Panel tone="mid" style={{ padding: "9px 18px", display: "flex", alignItems: "center", gap: 12 }}>
        {/* A latecomer can still join — addPlayer has no phase guard, they just
            start at zero. The QR rides along only while picking: on the
            answering and reveal screens it would be noise. */}
        {state.phase === "picking" && <JoinQr code={state.code} size={56} />}
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.16em", color: "var(--accent)" }}>ROOM</span>
        <span className="mono" style={{ fontSize: 16, fontWeight: 600, letterSpacing: "0.2em" }}>{state.code}</span>
      </Panel>
    </div>
  );
}

function ScoreStrip({ state }: { state: GameView }) {
  const ranked: PlayerView[] = [...state.players].sort((a, b) => b.score - a.score);
  return (
    <div style={{ display: "flex", gap: 12, borderTop: "1px solid var(--line)", paddingTop: 20 }}>
      {ranked.map((p, i) => (
        <Panel key={p.id} tone={i === 0 ? "mid" : "low"} style={{
          flex: 1, display: "flex", alignItems: "center", gap: 12, padding: "13px 15px",
          borderColor: i === 0 ? "var(--accent)" : "var(--line)",
          opacity: p.connected ? 1 : 0.5,
        }}>
          <Avatar player={p} players={state.players} size={32} />
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{p.name}</span>
            <span className="mono" style={{ fontSize: 13, color: i === 0 ? "var(--accent)" : "var(--muted)" }}>
              {METRES(p.score)}
            </span>
          </div>
        </Panel>
      ))}
    </div>
  );
}
