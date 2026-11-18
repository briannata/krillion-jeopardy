/**
 * This machine's address on the local network.
 *
 * Anything a phone has to reach — the join QR above all — needs a real LAN
 * address. `localhost` is correct for the machine running the server and
 * useless to every other device in the room, so a URL built from it cannot be
 * handed to a phone.
 */

import { networkInterfaces } from "node:os";

/**
 * Prefers 192.168.x, which is what a home router hands out, over the other
 * private ranges a VM bridge or VPN adapter tends to occupy. Returns null when
 * the machine is on no network at all.
 */
export function lanAddress(): string | null {
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

/** Hostnames that resolve to the machine itself, so a phone cannot use them. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

export function isLoopback(host: string): boolean {
  return LOOPBACK.has(host.toLowerCase());
}

/**
 * Rewrite an origin that points at this machine's loopback so it points at the
 * LAN instead, keeping the scheme and port. Returns the origin unchanged when
 * it is already a real address, or when there is no LAN address to swap in.
 */
export function reachableOrigin(origin: string): string {
  let url: URL;
  try { url = new URL(origin); } catch { return origin; }
  if (!isLoopback(url.hostname)) return origin;

  const lan = lanAddress();
  if (!lan) return origin;

  url.hostname = lan;
  // URL keeps the port, and origin drops any trailing slash for us.
  return url.origin;
}
