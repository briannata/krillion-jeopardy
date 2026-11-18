/**
 * The player client: phone-first, one screen per phase.
 *
 * Everything here is driven by `state.phase`. The client holds no game rules —
 * it cannot decide that a tile is taken, that your answer scored, or whose pick
 * is next. It renders what the server says and sends what you did.
 */

import { useEffect, useRef, useState } from "react";
import type { CatchEntry, GameView, Tier } from "../game/types.ts";
import { createRoom, fetchCatch, type CatchPage, type Game } from "./useGame.ts";
import {
  Attribution, Avatar, Panel, RevealRow, TierChip, Wordmark,
  METRES, TIER_NAME, diverColor, tierColor, useCountdown,
} from "./ui.tsx";

const page = (p: object = {}) => ({
  minHeight: "100dvh", display: "flex", flexDirection: "column" as const,
  padding: "40px 20px 20px", gap: 0, ...p,
});

export function Player({ game }: { game: Game }) {
  const { state } = game;
  if (!state) return <Join game={game} />;

  switch (state.phase) {
    case "lobby": return <Lobby game={game} state={state} />;
    case "picking": return <Board game={game} state={state} />;
    case "answering": return <Answering game={game} state={state} />;
    case "revealing": return <Reveal state={state} />;
    case "finished": return <Surfaced game={game} state={state} />;
  }
}

// ---------------------------------------------------------------- join

function Join({ game }: { game: Game }) {
  const params = new URLSearchParams(location.search);
  const [code, setCode] = useState((params.get("code") ?? "").toUpperCase());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const fresh = await createRoom();
      setCode(fresh);
      if (name.trim()) game.join(fresh, name);
    } finally { setBusy(false); }
  };

  const ready = code.trim().length === 4 && name.trim().length > 0;

  return (
    <div style={page()}>
      <div style={{ marginBottom: 44 }}>
        <Wordmark />
        <p style={{ margin: "14px 0 0", fontSize: 15, lineHeight: 1.5, color: "var(--muted)", maxWidth: 285 }}>
          Twenty prompts. The rarer your answer, the deeper you sink.
        </p>
      </div>

      <form
        style={{ display: "flex", flexDirection: "column", gap: 22 }}
        onSubmit={(e) => { e.preventDefault(); if (ready) game.join(code, name); }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label className="label" htmlFor="code">Room code</label>
          <input
            id="code" className="field mono" value={code} autoCapitalize="characters"
            autoComplete="off" maxLength={4} inputMode="text"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
            style={{ fontSize: 38, fontWeight: 600, letterSpacing: "0.3em", textAlign: "center", textIndent: "0.3em" }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label className="label" htmlFor="name">Your name</label>
          <input
            id="name" className="field" value={name} maxLength={24} autoComplete="given-name"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <button type="submit" className="btn" disabled={!ready}>Dive in</button>
      </form>

      {game.error && (
        <p style={{ marginTop: 16, fontSize: 14, color: "var(--tier-85)" }}>{game.error}</p>
      )}

      <div style={{ flexGrow: 1 }} />

      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        <button type="button" className="btn btn-quiet" onClick={start} disabled={busy}>
          {busy ? "Opening a room…" : "Start a new room"}
        </button>
        <Attribution />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- lobby

function Lobby({ game, state }: { game: Game; state: GameView }) {
  const you = state.players.find((p) => p.id === state.you?.playerId);
  const isHost = !!you?.isHost;

  return (
    <div style={page()}>
      <RoomBar state={state} />

      <h2 style={{ margin: "0 0 6px", fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
        {state.players.length} diver{state.players.length === 1 ? "" : "s"} aboard
      </h2>
      <p style={{ margin: "0 0 28px", fontSize: 15, color: "var(--muted)", lineHeight: 1.5 }}>
        No limit — anyone else can still join with the code.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {state.players.map((p) => {
          const isYou = p.id === state.you?.playerId;
          return (
            <div key={p.id} style={{
              display: "flex", alignItems: "center", gap: 14,
              background: "var(--panel)", borderRadius: "var(--radius)", padding: "14px 16px",
              border: `1px solid ${isYou ? "var(--accent)" : "var(--line)"}`,
              opacity: p.connected ? 1 : 0.45,
            }}>
              <Avatar player={p} players={state.players} size={38} />
              <span style={{ fontSize: 17, fontWeight: 600, flexGrow: 1 }}>{p.name}</span>
              {p.isHost && <Tag>Host</Tag>}
              {isYou && <Tag solid>You</Tag>}
              {!p.connected && <span style={{ fontSize: 12, color: "var(--dim)" }}>away</span>}
            </div>
          );
        })}
      </div>

      <div style={{ flexGrow: 1, minHeight: 24 }} />

      {isHost ? (
        <button className="btn" onClick={() => game.send({ type: "start" })}>
          Begin the descent
        </button>
      ) : (
        <Panel style={{ padding: 20, display: "flex", alignItems: "center", gap: 14, borderStyle: "dashed" }}>
          <Dots />
          <span style={{ fontSize: 15, color: "var(--muted)", lineHeight: 1.45 }}>
            Waiting for <strong style={{ color: "var(--text)" }}>
              {state.players.find((p) => p.isHost)?.name ?? "the host"}
            </strong> to begin
          </span>
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- board

function Board({ game, state }: { game: Game; state: GameView }) {
  const yours = state.pickerId === state.you?.playerId;
  const picker = state.players.find((p) => p.id === state.pickerId);
  const you = state.players.find((p) => p.id === state.you?.playerId);

  return (
    <div style={page({ padding: "40px 0 20px" })}>
      <div style={{ padding: "0 20px", display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <span className="label">Round {state.roundNumber + 1} / {state.totalRounds}</span>
        <span className="mono" style={{ fontSize: 17, fontWeight: 600, color: "var(--accent)" }}>
          {METRES(you?.score ?? 0)}
        </span>
      </div>

      <div style={{ padding: "0 20px", marginBottom: 20 }}>
        <Panel tone="mid" style={{
          padding: "15px 17px", display: "flex", alignItems: "center", gap: 12,
          borderColor: yours ? "var(--accent)" : "var(--line)",
        }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>
            {yours ? "Your pick" : `${picker?.name ?? "Someone"} is picking`}
          </span>
        </Panel>
      </div>

      <div style={{ padding: "0 20px 10px", overflowX: "auto" }}>
        <div style={{ display: "flex", gap: 10, width: "max-content" }}>
          {state.columns.map((col, ci) => (
            <div key={col.theme} style={{ width: 148, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{
                height: 46, background: "var(--panel)", border: "1px solid var(--line)",
                borderRadius: "var(--radius)", display: "flex", alignItems: "center",
                justifyContent: "center", textAlign: "center", padding: "0 8px",
              }}>
                <span className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--accent)", lineHeight: 1.25 }}>
                  {col.label.toUpperCase()}
                </span>
              </div>

              {col.tileIds.map((id) => {
                const tile = state.tiles.find((t) => t.id === id)!;
                if (tile.played) {
                  return (
                    <div key={id} style={{
                      height: 84, background: "var(--panel-low)", border: "1px solid var(--line-soft)",
                      borderRadius: "var(--radius)", padding: 11, overflow: "hidden",
                    }}>
                      <span style={{ fontSize: 12, color: "var(--dim)", lineHeight: 1.35 }}>
                        {tile.promptText ?? ""}
                      </span>
                    </div>
                  );
                }
                return (
                  <button
                    key={id} type="button"
                    aria-label={`${col.label}, tile ${col.tileIds.indexOf(id) + 1}`}
                    disabled={!yours}
                    onClick={() => game.send({ type: "pick", tileId: id })}
                    style={{
                      height: 84, background: "var(--panel)", borderRadius: "var(--radius)",
                      border: `1px solid ${yours ? "var(--accent)" : "var(--line)"}`,
                      cursor: yours ? "pointer" : "default", padding: 0,
                      opacity: yours ? 1 : 0.65,
                    }}
                  />
                );
              })}
              <span style={{ display: "none" }}>{ci}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: "0 20px" }}>
        <Standings state={state} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- answering

function Answering({ game, state }: { game: Game; state: GameView }) {
  const round = state.round!;
  const left = useCountdown(round.deadline);
  const locked = !!state.you?.locked;
  const [draft, setDraft] = useState(state.you?.draft ?? "");
  const pushed = useRef(draft);

  // Mirror the draft to the server so a reconnect keeps what you typed, but do
  // not send a frame per keystroke.
  useEffect(() => {
    if (locked || draft === pushed.current) return;
    const id = setTimeout(() => {
      pushed.current = draft;
      game.send({ type: "draft", text: draft });
    }, 220);
    return () => clearTimeout(id);
  }, [draft, locked, game]);

  const total = round.deadline ? Math.max(1, Math.round((round.deadline - Date.now()) / 1000)) : 30;
  const lockedCount = round.submissions.filter((s) => s.locked).length;

  return (
    <div style={page({ padding: 0 })}>
      <div style={{ height: 4, background: "var(--line-soft)" }}>
        <div style={{
          height: 4, background: "var(--accent)",
          width: `${Math.min(100, (left / Math.max(total, left, 1)) * 100)}%`,
          transition: "width 0.25s linear",
        }} />
      </div>

      <div style={{ padding: "24px 24px 20px", display: "flex", flexDirection: "column", flexGrow: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
          <span className="mono" style={{
            fontSize: 10, letterSpacing: "0.17em", color: "var(--accent)",
            border: "1px solid var(--accent)", borderRadius: 4, padding: "5px 11px",
          }}>
            {state.columns.find((c) => c.theme === round.theme)?.label.toUpperCase()}
          </span>
          <span className="mono" style={{ fontSize: 30, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {left}
          </span>
        </div>

        <h2 style={{ margin: "0 0 30px", fontSize: 29, lineHeight: 1.22, fontWeight: 700, letterSpacing: "-0.02em" }}>
          {round.promptText}
        </h2>

        <label className="label" htmlFor="answer" style={{ marginBottom: 10 }}>Your answer</label>
        <input
          id="answer" className="field" value={draft} disabled={locked} autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
          style={{ fontSize: 21, fontWeight: 600, borderColor: locked ? "var(--line)" : "var(--accent)", marginBottom: 14 }}
        />
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--dim)", lineHeight: 1.5 }}>
          {locked
            ? "Locked in. Waiting for the rest of the room."
            : "Change it as often as you like until you lock in or the clock runs out."}
        </p>

        <button
          className="btn" disabled={locked || !draft.trim()}
          onClick={() => { pushed.current = draft; game.send({ type: "draft", text: draft }); game.send({ type: "lock" }); }}
        >
          {locked ? "Locked" : "Lock it in"}
        </button>

        <div style={{ flexGrow: 1, minHeight: 20 }} />

        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 18 }}>
          <span className="label" style={{ display: "block", marginBottom: 14 }}>
            {lockedCount} of {round.submissions.length} locked
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {round.submissions.map((s) => {
              const p = state.players.find((x) => x.id === s.playerId);
              if (!p) return null;
              return (
                <div key={s.playerId} style={{
                  display: "flex", alignItems: "center", gap: 7,
                  background: s.locked ? "var(--panel)" : "var(--panel-low)",
                  border: `1px solid ${s.locked ? "var(--accent)" : "var(--line)"}`,
                  borderRadius: "var(--radius-sm)", padding: "7px 12px",
                }}>
                  {s.locked
                    ? <div style={{ width: 6, height: 6, background: "var(--accent)" }} aria-hidden="true" />
                    : <Dots small />}
                  <span style={{ fontSize: 13, fontWeight: s.locked ? 600 : 400, color: s.locked ? "var(--text)" : "var(--muted)" }}>
                    {p.name}
                  </span>
                </div>
              );
            })}
          </div>
          <p style={{ margin: "14px 0 0", fontSize: 12, color: "var(--dim)", lineHeight: 1.5 }}>
            Nobody sees what you typed — only that you are typing.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- reveal

function Reveal({ state }: { state: GameView }) {
  const round = state.round!;
  const mine = round.revealed.flatMap((b) => b.entries).find((e) => e.playerId === state.you?.playerId);
  const latest = round.revealed[round.revealed.length - 1];

  return (
    <div style={page()}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <span className="label">
          {state.columns.find((c) => c.theme === round.theme)?.label} · Round {round.number}
        </span>
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.17em", color: "var(--accent)" }}>
          {round.revealed.length} of {round.revealTotal}
        </span>
      </div>

      {/* Your answer as the hero card, once your tier has turned over. */}
      {mine ? (
        <Panel tone="mid" style={{
          padding: 22, marginBottom: 22, position: "relative", overflow: "hidden",
          borderColor: tierColor(mine.points),
        }}>
          <div style={{
            position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: tierColor(mine.points),
          }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <span className="label">You answered</span>
            <TierChip points={mine.points} tier={mine.tier} />
          </div>
          <span style={{ display: "block", fontSize: 34, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.05, marginBottom: 18 }}>
            {mine.matchedAnswer ?? (mine.text || "—")}
          </span>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", borderTop: "1px solid var(--line)", paddingTop: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span className="mono" style={{ fontSize: 32, fontWeight: 600, lineHeight: 1 }}>+{mine.points}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>{METRES(mine.points)} DOWN</span>
            </div>
            <span style={{ fontSize: 13, color: "var(--muted)", textAlign: "right", maxWidth: 150, lineHeight: 1.4 }}>
              {mine.points === 0 ? "Not in the archive" : mine.points >= 85 ? "Hardly anyone finds these" : "A common catch"}
            </span>
          </div>
        </Panel>
      ) : (
        <Panel style={{ padding: 22, marginBottom: 22, textAlign: "center" }}>
          <span style={{ fontSize: 15, color: "var(--muted)" }}>Turning over the cards…</span>
        </Panel>
      )}

      <span className="label" style={{ marginBottom: 11 }}>The room, tier by tier</span>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {round.revealed.map((batch, i) => (
          <Panel
            key={`${batch.points}-${i}`}
            tone={batch === latest ? "high" : "low"}
            style={{
              padding: "13px 15px", display: "flex", alignItems: "center", gap: 13,
              borderColor: batch === latest ? tierColor(batch.points) : "var(--line)",
              borderWidth: batch === latest ? 2 : 1,
              animation: "rise-in 0.4s cubic-bezier(0.22,0.61,0.36,1) both",
            }}
          >
            <span className="mono" style={{
              fontSize: batch === latest ? 24 : 16, fontWeight: 600,
              color: tierColor(batch.points), width: 54, flexShrink: 0,
            }}>
              {batch.points > 0 ? `+${batch.points}` : "0"}
            </span>
            <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              {batch.entries.map((e) => (
                <RevealRow key={e.playerId} entry={e} players={state.players} />
              ))}
            </div>
            <TierChip points={batch.points} tier={batch.tier} />
          </Panel>
        ))}
      </div>

      <div style={{ flexGrow: 1, minHeight: 16 }} />
      <Standings state={state} />
    </div>
  );
}

// ---------------------------------------------------------------- surfaced

function Surfaced({ game, state }: { game: Game; state: GameView }) {
  const [showCatch, setShowCatch] = useState(false);
  if (showCatch) return <Catch state={state} onBack={() => setShowCatch(false)} />;

  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const deepest = ranked[0]?.score || 1;
  const you = state.you?.playerId;
  const isHost = state.players.find((p) => p.id === you)?.isHost;

  return (
    <div style={page()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.2em", color: "var(--accent)" }}>BOARD CLEARED</span>
        <span className="label">{state.totalRounds} prompts</span>
      </div>
      <h2 style={{ margin: "0 0 16px", fontSize: 34, fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1 }}>
        Surfaced
      </h2>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span className="label">Surface</span>
        <div style={{ flexGrow: 1, height: 1, background: "var(--line-strong)" }} />
        <span className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>0 → {METRES(deepest)}</span>
      </div>

      {/* Shallowest settles first; deeper divers fall for longer. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[...ranked].reverse().map((p, i) => {
          const rank = ranked.indexOf(p) + 1;
          const isYou = p.id === you;
          const podium = rank <= 3;
          const colour = rank === 1 ? "var(--tier-100)" : rank === 2 ? "var(--tier-60)" : rank === 3 ? "var(--tier-30)" : "var(--muted)";
          return (
            <div
              key={p.id}
              className="sink"
              style={{
                ["--rise" as string]: `${-104 - i * 28}px`,
                animationDelay: `${i * 0.5}s`,
                animationDuration: `${0.95 + i * 0.07}s`,
                background: rank === 1 ? "#241f3a" : podium || isYou ? "var(--panel)" : "var(--panel-low)",
                border: `${rank === 1 ? 2 : 1}px solid ${rank === 1 ? "var(--tier-100)" : isYou ? "var(--accent)" : podium ? colour : "var(--line)"}`,
                borderRadius: "var(--radius)", padding: "11px 13px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                {podium ? (
                  <div className="mono" style={{
                    width: 26, height: 26, borderRadius: 5, flexShrink: 0,
                    background: rank === 1 ? "var(--tier-100)" : "transparent",
                    border: rank === 1 ? "none" : `1px solid ${colour}`,
                    color: rank === 1 ? "var(--tier-ink)" : colour,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 600,
                  }}>{rank}</div>
                ) : (
                  <span className="mono" style={{ width: 26, textAlign: "center", fontSize: 13, color: "var(--faint)" }}>{rank}</span>
                )}
                <Avatar player={p} players={state.players} size={30} />
                <span style={{ fontSize: 16, fontWeight: podium ? 700 : 600, flexGrow: 1 }}>{p.name}</span>
                {isYou && <Tag solid>You</Tag>}
                <span className="mono" style={{ fontSize: 15, fontWeight: 600, color: podium ? colour : "var(--muted)" }}>
                  {METRES(p.score)}
                </span>
              </div>
              <div style={{ height: 6, background: "rgba(190,214,224,0.07)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  height: 6, borderRadius: 2, background: podium ? colour : "var(--tier-10)",
                  width: `${Math.max(3, (p.score / deepest) * 100)}%`,
                }} />
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ flexGrow: 1, minHeight: 18 }} />

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button className="btn" onClick={() => setShowCatch(true)}>Open The Catch</button>
        {isHost && (
          <button className="btn btn-quiet" onClick={() => game.send({ type: "playAgain" })}>Dive again</button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the catch

function Catch({ state, onBack }: { state: GameView; onBack: () => void }) {
  const entries = state.catch ?? [];
  const [open, setOpen] = useState<CatchEntry | null>(entries[0] ?? null);
  const [tier, setTier] = useState<Tier | "">("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<CatchPage | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setData(null); setErr(null);
    const id = setTimeout(() => {
      fetchCatch(state.code, open.promptId, { tier: tier || undefined, q: q || undefined })
        .then((d) => { if (live) setData(d); })
        .catch((e: Error) => { if (live) setErr(e.message); });
    }, q ? 250 : 0);
    return () => { live = false; clearTimeout(id); };
  }, [open, tier, q, state.code]);

  const said = new Map(
    (open ? state.catch?.find((c) => c.promptId === open.promptId)?.roomAnswers ?? [] : [])
      .filter((r) => r.matchedAnswer)
      .map((r) => [r.matchedAnswer!, state.players.find((p) => p.id === r.playerId)?.name ?? ""]),
  );

  return (
    <div style={page({ padding: "40px 0 18px" })}>
      <div style={{ padding: "0 20px", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <button
            type="button" onClick={onBack} aria-label="Back to the scoreboard"
            style={{
              width: 32, height: 32, borderRadius: "var(--radius-sm)", background: "var(--panel)",
              border: "1px solid var(--line)", color: "var(--muted)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}
          >←</button>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>The Catch</h2>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.45 }}>
          Every answer the archive had, for all {entries.length} prompts.
        </p>
      </div>

      <div style={{ padding: "0 20px", marginBottom: 12, overflowX: "auto" }}>
        <div style={{ display: "flex", gap: 7, width: "max-content" }}>
          {entries.map((e) => (
            <button
              key={e.promptId} type="button"
              onClick={() => { setOpen(e); setTier(""); setQ(""); }}
              style={{
                background: open?.promptId === e.promptId ? "var(--panel)" : "var(--panel-low)",
                border: `1px solid ${open?.promptId === e.promptId ? "var(--accent)" : "var(--line)"}`,
                borderRadius: "var(--radius-sm)", padding: "10px 14px", cursor: "pointer",
                color: "var(--text)", fontFamily: "inherit", fontSize: 13, maxWidth: 240,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}
            >
              {e.promptText}
            </button>
          ))}
        </div>
      </div>

      {open && (
        <>
          <div style={{ padding: "0 20px", marginBottom: 12, overflowX: "auto" }}>
            <div style={{ display: "flex", gap: 7, width: "max-content" }}>
              <Chip on={tier === ""} onClick={() => setTier("")}>All {open.answerCount.toLocaleString()}</Chip>
              {(Object.entries(open.tierCounts) as [Tier, number][])
                .sort((a, b) => b[1] - a[1])
                .map(([t, n]) => (
                  <Chip key={t} on={tier === t} onClick={() => setTier(tier === t ? "" : t)} tier={t}>
                    {TIER_NAME[t]} {n.toLocaleString()}
                  </Chip>
                ))}
            </div>
          </div>

          <div style={{ padding: "0 20px", marginBottom: 14 }}>
            <label className="label" htmlFor="q" style={{ position: "absolute", left: -9999 }}>Search answers</label>
            <input
              id="q" className="field" value={q} placeholder={`Search ${open.answerCount.toLocaleString()} answers…`}
              onChange={(e) => setQ(e.target.value)} style={{ fontSize: 15 }}
            />
          </div>

          <div style={{ flexGrow: 1, overflowY: "auto", padding: "0 20px" }}>
            {err && <p style={{ fontSize: 14, color: "var(--tier-85)" }}>{err}</p>}
            {!data && !err && <p style={{ fontSize: 14, color: "var(--dim)" }}>Loading…</p>}
            {data?.answers.map((a) => (
              <div key={a.answer} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "12px 4px",
                borderBottom: "1px solid var(--line-soft)",
              }}>
                <span style={{ fontSize: 15, flexGrow: 1, color: "#dce9ee" }}>{a.answer}</span>
                {said.has(a.answer) && (
                  <span className="mono" style={{ fontSize: 9, letterSpacing: "0.1em", color: "var(--accent)" }}>
                    {said.get(a.answer)!.toUpperCase()} SAID THIS
                  </span>
                )}
                <span className="mono" style={{ fontSize: 14, color: tierColor(a.score), flexShrink: 0 }}>+{a.score}</span>
              </div>
            ))}
            {data && data.answers.length === 0 && (
              <p style={{ fontSize: 14, color: "var(--dim)" }}>Nothing matched that.</p>
            )}
          </div>

          {data && (
            <div style={{
              padding: "12px 20px 0", borderTop: "1px solid var(--line)",
              display: "flex", justifyContent: "space-between",
            }}>
              <span className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>
                {data.answers.length} of {data.matched.toLocaleString()}
              </span>
              <span style={{ fontSize: 12, color: "var(--dim)" }}>scroll for more</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- bits

function RoomBar({ state }: { state: GameView }) {
  const you = state.players.find((p) => p.id === state.you?.playerId);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 34 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, background: "var(--panel)",
        border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)", padding: "8px 14px",
      }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.16em", color: "var(--accent)" }}>ROOM</span>
        <span className="mono" style={{ fontSize: 15, fontWeight: 600, letterSpacing: "0.2em" }}>{state.code}</span>
      </div>
      {you && <span style={{ fontSize: 13, color: "var(--dim)" }}>You are <strong style={{ color: "var(--text)" }}>{you.name}</strong></span>}
    </div>
  );
}

function Standings({ state }: { state: GameView }) {
  return (
    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, display: "flex", gap: 8, overflowX: "auto" }}>
      {state.players.map((p) => (
        <div key={p.id} style={{
          display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
          background: p.id === state.you?.playerId ? "var(--panel)" : "transparent",
          border: `1px solid ${p.id === state.you?.playerId ? "var(--accent)" : "var(--line-soft)"}`,
          borderRadius: "var(--radius-sm)", padding: "7px 10px",
        }}>
          <Avatar player={p} players={state.players} size={22} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</span>
          <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{p.score}</span>
        </div>
      ))}
    </div>
  );
}

function Tag({ children, solid }: { children: React.ReactNode; solid?: boolean }) {
  return (
    <span className="mono" style={{
      fontSize: 10, letterSpacing: "0.14em", borderRadius: 4, padding: "4px 8px",
      background: solid ? "var(--accent)" : "transparent",
      border: solid ? "none" : "1px solid var(--accent)",
      color: solid ? "var(--accent-ink)" : "var(--accent)",
      textTransform: "uppercase",
    }}>{children}</span>
  );
}

function Chip({ children, on, onClick, tier }: {
  children: React.ReactNode; on: boolean; onClick: () => void; tier?: Tier;
}) {
  const c = tier ? tierColor({ plankton: 10, tooclever: 15, schooler: 30, rare: 60, deepcut: 85, krillion: 100 }[tier]) : "var(--text)";
  return (
    <button type="button" onClick={onClick} style={{
      background: on ? c : "var(--panel)",
      border: `1px solid ${on ? c : "var(--line)"}`,
      borderRadius: "var(--radius-sm)", padding: "8px 14px", cursor: "pointer",
      color: on ? "var(--tier-ink)" : c, fontFamily: "inherit", fontSize: 13,
      fontWeight: on ? 600 : 400, whiteSpace: "nowrap",
    }}>{children}</button>
  );
}

function Dots({ small }: { small?: boolean }) {
  const d = small ? 3 : 7;
  return (
    <div style={{ display: "flex", gap: small ? 3 : 5, flexShrink: 0 }} aria-hidden="true">
      {[1, 0.55, 0.25].map((o, i) => (
        <div key={i} style={{ width: d, height: d, borderRadius: "50%", background: "var(--accent)", opacity: o }} />
      ))}
    </div>
  );
}

export { diverColor };
