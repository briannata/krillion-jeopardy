/**
 * Entry point. Two surfaces share one build:
 *   /            the player client (phone-first)
 *   /?host=CODE  the shared display for that room
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { Player } from "./Player.tsx";
import { Host } from "./Host.tsx";
import { useGame } from "./useGame.ts";
import "./tokens.css";

function App() {
  const game = useGame();
  const hostCode = new URLSearchParams(location.search).get("host");

  useEffect(() => {
    if (hostCode) game.watch(hostCode);
    // Only ever attach once; `watch` is stable.
  }, [hostCode, game.watch]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {hostCode ? <Host game={game} code={hostCode.toUpperCase()} /> : <Player game={game} />}
      {game.status === "closed" && game.state && <Reconnecting />}
    </>
  );
}

/** The server is authoritative, so a dropped socket means the screen is stale. */
function Reconnecting() {
  return (
    <div style={{
      position: "fixed", left: 0, right: 0, bottom: 0, padding: "10px 16px",
      background: "var(--tier-85)", color: "var(--tier-ink)",
      fontSize: 13, fontWeight: 600, textAlign: "center",
    }}>
      Connection lost — reconnecting…
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>,
);
