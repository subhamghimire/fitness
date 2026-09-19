import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Repository } from "typeorm";
import { CoachRating } from "./entities/coach-rating.entity";
import { CoachRatingService } from "./coach-rating.service";
import { Coach } from "../coach/entities/coach.entity";
import { CoachAccountStatus, CoachEligibility, CoachProfileVisibility, CoachVerificationStatus } from "../coach/enums";

const makeDiscoverableCoach = (over: Partial<Coach> = {}): Coach =>
  ({
    id: "coach-1",
    userId: "coach-user-1",
    verificationStatus: CoachVerificationStatus.VERIFIED,
    accountStatus: CoachAccountStatus.ACTIVE,
    eligibility: CoachEligibility.ELIGIBLE,
    isDeleted: false,
    coachProfile: { visibility: CoachProfileVisibility.PUBLIC } as Coach["coachProfile"],
    ...over
  }) as Coach;

const makeRating = (over: Partial<CoachRating> = {}): CoachRating =>
  ({
    id: "rating-1",
    coachId: "coach-1",
    userId: "user-1",
    ratingNo: 5,
    comment: "Great",
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over
  }) as CoachRating;

describe("CoachRatingService authorization and integrity", () => {
  const makeService = () => {
    const qb: Record<string, jest.Mock> = {};
    const self = () => qb;
    ["select", "addSelect", "where", "andWhere", "groupBy", "orderBy", "skip", "take"].forEach((m) => (qb[m] = jest.fn(self)));
    qb.getRawOne = jest.fn().mockResolvedValue({ avg: "4.5", count: "2" });
    qb.getRawMany = jest.fn().mockResolvedValue([{ rating: 5, count: "2" }]);
    qb.getCount = jest.fn().mockResolvedValue(0);
    qb.getMany = jest.fn().mockResolvedValue([]);

    const ratingRepo = {
      findOne: jest.fn(),
      create: jest.fn((r: CoachRating) => r),
      save: jest.fn((r: CoachRating) => Promise.resolve(r)),
      createQueryBuilder: jest.fn(() => qb)
    };
    const coachRepo = { findOne: jest.fn() };
    const profileService = { updateRatingSummary: jest.fn() };
    const service = new CoachRatingService(ratingRepo as unknown as Repository<CoachRating>, coachRepo as unknown as Repository<Coach>, profileService as never);
    return { service, ratingRepo, coachRepo, profileService };
  };

  describe("create", () => {
    it("forbids rating your own coach profile", async () => {
      const { service, coachRepo } = makeService();
      coachRepo.findOne.mockResolvedValue(makeDiscoverableCoach({ userId: "self-1" }));

      await expect(service.create("self-1", { coachId: "coach-1", ratingNo: 5 })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("rejects ratings for coaches that are not publicly discoverable", async () => {
      const { service, coachRepo } = makeService();
      coachRepo.findOne.mockResolvedValue(makeDiscoverableCoach({ verificationStatus: CoachVerificationStatus.PENDING }));

      await expect(service.create("user-1", { coachId: "coach-1", ratingNo: 5 })).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects a second rating from the same user", async () => {
      const { service, coachRepo, ratingRepo } = makeService();
      coachRepo.findOne.mockResolvedValue(makeDiscoverableCoach());
      ratingRepo.findOne.mockResolvedValue(makeRating());

      await expect(service.create("user-1", { coachId: "coach-1", ratingNo: 5 })).rejects.toBeInstanceOf(ConflictException);
    });

    it("persists a valid rating and refreshes the profile summary", async () => {
      const { service, coachRepo, ratingRepo, profileService } = makeService();
      coachRepo.findOne.mockResolvedValue(makeDiscoverableCoach());
      ratingRepo.findOne.mockResolvedValue(null);

      const result = await service.create("user-1", { coachId: "coach-1", ratingNo: 5 });

      expect(ratingRepo.create).toHaveBeenCalledWith(expect.objectContaining({ coachId: "coach-1", userId: "user-1" }));
      expect(profileService.updateRatingSummary).toHaveBeenCalledWith("coach-1", 4.5, 2);
      expect(result.userId).toBe("user-1");
    });
  });

  describe("update / remove", () => {
    it("does not allow updating someone else's rating", async () => {
      const { service, ratingRepo } = makeService();
      ratingRepo.findOne.mockResolvedValue(null);

      await expect(service.update("user-2", "rating-1", { ratingNo: 1 })).rejects.toBeInstanceOf(NotFoundException);
    });

    it("soft-deletes the rating and refreshes the summary", async () => {
      const { service, ratingRepo, profileService } = makeService();
      ratingRepo.findOne.mockResolvedValue(makeRating());

      const result = await service.remove("user-1", "rating-1");

      expect(result.success).toBe(true);
      expect(ratingRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isDeleted: true, deletedBy: "user-1" }));
      expect(profileService.updateRatingSummary).toHaveBeenCalled();
    });
  });
});
