/**
 * Server-side access to the prompt catalogue and answer lists.
 *
 * The catalogue (854 prompt headers, ~300KB) is loaded once at boot. Answer lists
 * are loaded per prompt, on demand, and cached — the biggest single prompt is
 * 100,739 answers, so loading all of them would be ~164MB of resident JSON for no
 * reason. A room touches at most 20.
 *
 * Nothing in here is ever serialized to a client. See src/game/types.ts.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PromptMatcher, type MatchableAnswer } from "../matcher.ts";
import type { CataloguePrompt } from "../../scripts/apply-labels.ts";
import type { PromptFile } from "../../scripts/build-dataset.ts";

const DATA = resolve(import.meta.dirname, "../../data");

/** Shorthands players are likely to type. Grow this from real games. */
const ALIASES: Record<string, string> = {
  "spag bol": "spaghetti bolognese",
  "mac n cheese": "mac and cheese",
  bolognaise: "spaghetti bolognese",
};

export interface LoadedPrompt {
  meta: CataloguePrompt;
  answers: MatchableAnswer[];
  matcher: PromptMatcher;
}

export class Catalogue {
  private readonly byId = new Map<string, CataloguePrompt>();
  private readonly loaded = new Map<string, Promise<LoadedPrompt>>();

  private constructor(readonly prompts: CataloguePrompt[]) {
    for (const p of prompts) this.byId.set(p.id, p);
  }

  static async load(): Promise<Catalogue> {
    let raw: string;
    try {
      raw = await readFile(resolve(DATA, "catalogue.json"), "utf8");
    } catch {
      throw new Error(
        "data/catalogue.json is missing. Run: npm run scrape && npm run build:dataset && npm run apply:labels",
      );
    }
    const prompts = JSON.parse(raw) as CataloguePrompt[];
    if (!prompts.length) throw new Error("catalogue.json is empty");
    return new Catalogue(prompts);
  }

  meta(id: string): CataloguePrompt | undefined {
    return this.byId.get(id);
  }

  /** Loads (and caches) a prompt's answers and its matcher. */
  prompt(id: string): Promise<LoadedPrompt> {
    const existing = this.loaded.get(id);
    if (existing) return existing;

    const meta = this.byId.get(id);
    if (!meta) return Promise.reject(new Error(`unknown prompt ${id}`));

    const task = (async (): Promise<LoadedPrompt> => {
      const file = JSON.parse(
        await readFile(resolve(DATA, "prompts", `${id}.json`), "utf8"),
      ) as PromptFile;
      const answers = file.answers as MatchableAnswer[];
      return { meta, answers, matcher: new PromptMatcher(answers, ALIASES) };
    })();

    this.loaded.set(id, task);
    // Don't cache a failed load forever.
    task.catch(() => this.loaded.delete(id));
    return task;
  }
}
