import { BadRequestException, Injectable } from "@nestjs/common";
import { RecencyRankingStrategy, WeightedHotnessRankingStrategy } from "./feed-ranking.strategies";
import { FeedRankingStrategy } from "./feed-ranking.strategy";

/**
 * FEED RANKING REGISTRY
 * ---------------------------------------------------------------------------
 * The one place a `strategy` name becomes an implementation. This class is the
 * entire cost of adding a ranking: implement `FeedRankingStrategy`, add one line
 * to {@link strategies}, add an index to the migration if the ordering needs
 * one. `FeedService` is untouched, and so is every client.
 *
 * ─── Why a registry and not a `switch` ──────────────────────────────────────
 * A `switch (strategy) { case "recent": …; case "hot": … }` inside the feed
 * service reads fine until the third strategy, at which point the service is
 * simultaneously deciding *which orderings exist*, *implementing* them, and
 * *running* them — three reasons to change one function. The registry separates
 * "what exists" from "how it works", and it is also the natural place to hang
 * per-strategy concerns later (an A/B assignment, a rollout percentage, a cost
 * ceiling) without any of them leaking into the feed read.
 *
 * ─── The default is `recent`, and that is a product decision ────────────────
 * Recency is index-served and predictable. `hot` does more work per page and
 * makes the order of two posts non-obvious to a human, which is a real cost in a
 * product where a trainer shares a workout and wants it seen. Hotness is
 * available to clients that ask for it by name, and it is the baseline the
 * ranking seam was built to let us replace.
 */
@Injectable()
export class FeedRankingRegistry {
  private readonly byId: Map<string, FeedRankingStrategy>;

  constructor() {
    // Instantiated here, not injected as classes: a strategy is a stateless
    // value object over SQL fragments, and making them injectable would give
    // each one a place to accidentally hold request state.
    this.byId = new Map<string, FeedRankingStrategy>([new RecencyRankingStrategy(), new WeightedHotnessRankingStrategy()].map((strategy) => [strategy.id, strategy]));
  }

  /** Every registered strategy, for API documentation and tests. */
  list(): readonly FeedRankingStrategy[] {
    return [...this.byId.values()];
  }

  /** The ids a client may pass as `?strategy=`. */
  ids(): string[] {
    return [...this.byId.keys()];
  }

  /**
   * Resolves a requested id, or 400 with the valid set.
   *
   * Naming the options in the error is deliberate: `strategy` is a URL parameter,
   * so a client integrating this gets a discoverable list from a single mistake
   * instead of having to read documentation to find out what exists.
   */
  resolve(id: string | undefined): FeedRankingStrategy {
    if (!id) return this.require("recent");
    return this.require(id);
  }

  private require(id: string): FeedRankingStrategy {
    const strategy = this.byId.get(id);
    if (!strategy) throw new BadRequestException(`Unknown feed strategy '${id}'. Available: ${this.ids().join(", ")}`);
    return strategy;
  }
}
