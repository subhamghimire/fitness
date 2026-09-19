import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Repository } from "typeorm";
import { Coach } from "./entities/coach.entity";
import { CoachService } from "./coach.service";
import { CoachAccountStatus, CoachEligibility, CoachProfileVisibility, CoachVerificationStatus } from "./enums";
import { User } from "../users/entities/user.entity";
import { UserRole } from "../users/enums";

interface Qb {
  leftJoinAndSelect: jest.Mock;
  loadRelationCountAndMap: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  skip: jest.Mock;
  take: jest.Mock;
  getOne: jest.Mock;
  getMany: jest.Mock;
  getCount: jest.Mock;
}

const makeQb = (opts: { one?: Coach | null; many?: Coach[]; count?: number } = {}): Qb => {
  const qb = {} as Qb;
  const self = (): Qb => qb;
  qb.leftJoinAndSelect = jest.fn(self);
  qb.loadRelationCountAndMap = jest.fn(self);
  qb.where = jest.fn(self);
  qb.andWhere = jest.fn(self);
  qb.orderBy = jest.fn(self);
  qb.skip = jest.fn(self);
  qb.take = jest.fn(self);
  qb.getOne = jest.fn().mockResolvedValue(opts.one ?? null);
  qb.getMany = jest.fn().mockResolvedValue(opts.many ?? []);
  qb.getCount = jest.fn().mockResolvedValue(opts.count ?? 0);
  return qb;
};

const makeCoach = (over: Partial<Coach> = {}): Coach =>
  ({
    id: "coach-1",
    name: "Coach One",
    userId: "owner-1",
    verificationStatus: CoachVerificationStatus.VERIFIED,
    accountStatus: CoachAccountStatus.ACTIVE,
    eligibility: CoachEligibility.ELIGIBLE,
    rank: 0,
    isDeleted: false,
    coachProfile: { visibility: CoachProfileVisibility.PUBLIC } as Coach["coachProfile"],
    coachVerification: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over
  }) as Coach;

describe("CoachService authorization", () => {
  const owner = { id: "owner-1", role: UserRole.USER } as User;
  const stranger = { id: "stranger-1", role: UserRole.USER } as User;
  const admin = { id: "admin-1", role: UserRole.ADMIN } as User;

  const makeService = (opts: { one?: Coach | null; many?: Coach[]; count?: number } = {}) => {
    const qb = makeQb(opts);
    const coachRepo = {
      findOne: jest.fn(),
      save: jest.fn((c: Coach) => Promise.resolve(c)),
      create: jest.fn((c: Coach) => c),
      count: jest.fn(),
      createQueryBuilder: jest.fn(() => qb)
    };
    const profileService = {
      createDefault: jest.fn(),
      toPublicDto: jest.fn(() => null),
      toResponseDto: jest.fn(() => ({}))
    };
    const verificationService = {
      createDefault: jest.fn(),
      toResponseDto: jest.fn(() => ({}))
    };
    const service = new CoachService(coachRepo as unknown as Repository<Coach>, profileService as never, verificationService as never);
    return { service, coachRepo, profileService, qb };
  };

  describe("update", () => {
    it("forbids a random user from updating someone else's coach", async () => {
      const { service, coachRepo } = makeService();
      coachRepo.findOne.mockResolvedValue(makeCoach());

      await expect(service.update("coach-1", stranger, { name: "Hacked" })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("forbids the owner from changing rank, account status or eligibility", async () => {
      const { service, coachRepo } = makeService();
      coachRepo.findOne.mockResolvedValue(makeCoach());

      await expect(service.update("coach-1", owner, { rank: 99 })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.update("coach-1", owner, { accountStatus: CoachAccountStatus.SUSPENDED })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.update("coach-1", owner, { eligibility: CoachEligibility.INELIGIBLE })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("allows the admin to change rank, account status and eligibility", async () => {
      const { service, coachRepo } = makeService({ one: makeCoach({ rank: 42 }) });
      coachRepo.findOne.mockResolvedValue(makeCoach());

      await service.update("coach-1", admin, {
        rank: 42,
        accountStatus: CoachAccountStatus.SUSPENDED,
        eligibility: CoachEligibility.INELIGIBLE
      });

      expect(coachRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          rank: 42,
          accountStatus: CoachAccountStatus.SUSPENDED,
          eligibility: CoachEligibility.INELIGIBLE
        })
      );
    });
  });

  describe("remove / enableDisable", () => {
    it("forbids a stranger from deleting a coach", async () => {
      const { service, coachRepo } = makeService();
      coachRepo.findOne.mockResolvedValue(makeCoach());

      await expect(service.remove("coach-1", stranger)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("allows the owner to disable their own coach", async () => {
      const { service, coachRepo } = makeService();
      coachRepo.findOne.mockResolvedValue(makeCoach());

      await service.remove("coach-1", owner);
      expect(coachRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isDeleted: true }));
    });

    it("forbids non-admins from toggling enable/disable", async () => {
      const { service } = makeService();
      await expect(service.enableDisable("coach-1", owner)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("findOne visibility", () => {
    it("hides a non-verified coach from anonymous users", async () => {
      const { service } = makeService({ one: makeCoach({ verificationStatus: CoachVerificationStatus.PENDING }) });

      await expect(service.findOne("coach-1")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("hides a private coach profile from anonymous users", async () => {
      const { service } = makeService({
        one: makeCoach({ coachProfile: { visibility: CoachProfileVisibility.PRIVATE } as Coach["coachProfile"] })
      });

      await expect(service.findOne("coach-1")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("lets the owner see their own non-verified coach", async () => {
      const { service } = makeService({ one: makeCoach({ verificationStatus: CoachVerificationStatus.PENDING }) });

      await expect(service.findOne("coach-1", owner)).resolves.toBeDefined();
    });

    it("lets an admin see a non-verified coach", async () => {
      const { service } = makeService({ one: makeCoach({ verificationStatus: CoachVerificationStatus.REJECTED }) });

      await expect(service.findOne("coach-1", admin)).resolves.toBeDefined();
    });
  });

  describe("findAll discovery", () => {
    it("always scopes public discovery to verified, active, eligible, public coaches", async () => {
      const { service, qb } = makeService({ many: [] });

      await service.findAll({} as never, false);

      const whereClauses = (qb.andWhere.mock.calls as unknown[][]).map((c) => c[0] as string);
      expect(whereClauses).toContain("coach.verificationStatus = :verified");
      expect(whereClauses).toContain("coach.accountStatus = :active");
      expect(whereClauses).toContain("coach.eligibility = :eligible");
      expect(whereClauses).toContain("profile.visibility = :visibility");
    });

    it("lets admins filter by verification state without forcing the public filter", async () => {
      const { service, qb } = makeService({ many: [] });

      await service.findAll({ verificationStatus: CoachVerificationStatus.PENDING } as never, true);

      const whereClauses = (qb.andWhere.mock.calls as unknown[][]).map((c) => c[0] as string);
      expect(whereClauses).toContain("coach.verificationStatus = :verificationStatus");
      expect(whereClauses).not.toContain("coach.verificationStatus = :verified");
    });
  });
});
