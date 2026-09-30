import { Injectable } from "@nestjs/common";
import { DataSource, In, Repository } from "typeorm";
import { User } from "src/modules/users/entities/user.entity";
import { SocialUserSummaryDto, SocialUserPresenter } from "./social-user-presenter.service";

/**
 * Upper bound on ids resolved per hydration call.
 *
 * Every social read hydrates a *page*, so the natural batch size is the page
 * limit (≤ 50). The cap exists for the one caller that is not page-shaped — a
 * feed that unions several candidate author sets — and turns "a bug produced a
 * million ids" into a truncated, obviously-wrong response instead of a table scan.
 */
const HYDRATION_BATCH_LIMIT = 500;

/**
 * SOCIAL USER LOADER
 * ---------------------------------------------------------------------------
 * Batch-resolves `User` rows into {@link SocialUserSummaryDto} for any social
 * read, so no list ever runs a query per author.
 *
 * Why it resolves through `DataSource` rather than an injected repository: the
 * repository is a *module registration* problem (`TypeOrmModule.forFeature([User])`
 * in every social module, plus a repository provider token each of them must
 * forward), while `DataSource` is already injected wherever a transaction is
 * possible. `User` is the one entity every social module legitimately reads, and
 * this keeps the registration in a single global place.
 *
 * It also keeps the *shape* decision in one place: the result map is keyed by id
 * and holds `SocialUserSummaryDto` only, so there is no path by which a social
 * payload can acquire a field — an email, above all — that the presenter does
 * not allow. Hydration returns a map rather than a list precisely so callers
 * cannot accidentally reorder a page by lookup order.
 */
@Injectable()
export class SocialUserLoader {
  constructor(
    private readonly dataSource: DataSource,
    private readonly presenter: SocialUserPresenter
  ) {}

  /** Returns a map of `userId -> summary`. Missing ids are simply absent. */
  async loadByIds(ids: (string | null | undefined)[]): Promise<Map<string, SocialUserSummaryDto>> {
    const unique = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
    if (unique.length === 0) return new Map();
    const repo = this.repo();
    const rows = await repo.find({ where: { id: In(unique.slice(0, HYDRATION_BATCH_LIMIT)) } });
    return new Map(rows.map((user) => [user.id, this.presenter.toSummary(user)]));
  }

  /** Same as {@link loadByIds}, but returns a dense array in the order asked for. */
  async loadAll(ids: string[]): Promise<SocialUserSummaryDto[]> {
    const map = await this.loadByIds(ids);
    return ids.map((id) => map.get(id)).filter((summary): summary is SocialUserSummaryDto => summary !== undefined);
  }

  private repo(): Repository<User> {
    return this.dataSource.getRepository(User);
  }
}
