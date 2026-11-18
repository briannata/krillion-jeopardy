/**
 * Print a QR code to the dev client, for testing on real phones.
 *
 * A party game is only really testable with several phones on it, and typing a
 * LAN address into each one is the slowest part of that. This resolves the
 * machine's own address on the Wi-Fi rather than hardcoding one, because it
 * changes with the network.
 *
 *   npm run qr             -> the join screen
 *   npm run qr -- ABCD     -> the join screen with the code prefilled
 *   npm run qr -- --screen ABCD  -> the shared display for that room
 *
 * Requires `npm run client` to be running with server.host enabled (it is, in
 * vite.config.ts) or the phone has nothing to reach.
 */

import { networkInterfaces } from "node:os";
import { writeFileSync } from "node:fs";
import QRCode from "qrcode";

const PORT = 5173;

/**
 * The LAN address of this machine. Skips loopback and internal adapters; where
 * a machine has several (Wi-Fi plus a VM bridge, say) it prefers 192.168.x,
 * which is what a home router hands out.
 */
function lanAddress(): string | null {
  const candidates: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      candidates.push(a.address);
    }
  }
  if (candidates.length === 0) return null;
  return candidates.find((a) => a.startsWith("192.168.")) ?? candidates[0]!;
}

async function main() {
  const args = process.argv.slice(2);
  const screen = args.includes("--screen");
  const code = args.find((a) => /^[A-Za-z]{4}$/.test(a))?.toUpperCase();

  const host = lanAddress();
  if (!host) {
    console.error("No LAN address found — is this machine on a network?");
    process.exit(1);
  }

  const base = `http://${host}:${PORT}/`;
  const url = screen
    ? `${base}?host=${code ?? ""}`
    : code ? `${base}?code=${code}` : base;

  if (screen && !code) {
    console.error("--screen needs a room code: npm run qr -- --screen ABCD");
    process.exit(1);
  }

  console.log();
  console.log(await QRCode.toString(url, { type: "terminal", small: true }));
  console.log(`  ${url}`);
  console.log(`  ${screen ? "shared screen" : "join screen"} — phones must be on the same Wi-Fi`);
  console.log();

  const out = new URL("../qr.svg", import.meta.url);
  const svg = await QRCode.toString(url, { type: "svg", margin: 2, width: 420 });
  writeFileSync(out, svg);
  console.log(`  also written to qr.svg`);
}

main().catch((e) => { console.error(e); process.exit(1); });
