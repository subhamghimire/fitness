import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Repository } from "typeorm";
import { CoachVerification } from "./entities/coach-verification.entity";
import { CoachVerificationService } from "./coach-verification.service";
import { Coach } from "../coach/entities/coach.entity";
import { CoachVerificationStatus } from "./enums";
import { User } from "../users/entities/user.entity";
import { UserRole } from "../users/enums";

const makeVerification = (over: Partial<CoachVerification> = {}): CoachVerification =>
  ({
    id: "verification-1",
    coachId: "coach-1",
    status: CoachVerificationStatus.PENDING,
    submittedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    decisionNote: null,
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over
  }) as CoachVerification;

const makeCoach = (over: Partial<Coach> = {}): Coach => ({ id: "coach-1", userId: "coach-user-1", ...over }) as Coach;

describe("CoachVerificationService", () => {
  const admin = { id: "admin-1", role: UserRole.ADMIN } as User;
  const coachUser = { id: "coach-user-1", role: UserRole.USER } as User;
  const stranger = { id: "stranger-1", role: UserRole.USER } as User;

  const makeService = () => {
    const verificationRepo = {
      findOne: jest.fn(),
      create: jest.fn((v: CoachVerification) => v),
      save: jest.fn((v: CoachVerification) => Promise.resolve(v))
    };
    const coachRepo = {
      findOne: jest.fn(),
      save: jest.fn((c: Coach) => Promise.resolve(c))
    };
    const service = new CoachVerificationService(verificationRepo as unknown as Repository<CoachVerification>, coachRepo as unknown as Repository<Coach>);
    return { service, verificationRepo, coachRepo };
  };

  it("refuses to let an admin set the coach-submitted PENDING state", async () => {
    const { service, coachRepo } = makeService();
    coachRepo.findOne.mockResolvedValue(makeCoach());

    await expect(service.transition("coach-1", { status: CoachVerificationStatus.PENDING }, admin)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("approves a coach, sets an expiry and mirrors the state on the coach", async () => {
    const { service, verificationRepo, coachRepo } = makeService();
    coachRepo.findOne.mockResolvedValue(makeCoach());
    verificationRepo.findOne.mockResolvedValue(makeVerification());

    const before = Date.now();
    const result = await service.transition("coach-1", { status: CoachVerificationStatus.VERIFIED }, admin);

    expect(result.status).toBe(CoachVerificationStatus.VERIFIED);
    expect(result.reviewedBy).toBe("admin-1");
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt!.getTime()).toBeGreaterThan(before);
    expect(coachRepo.save).toHaveBeenCalledWith(expect.objectContaining({ verificationStatus: CoachVerificationStatus.VERIFIED }));
  });

  it("returns 404 when a verification record does not exist for an admin lookup", async () => {
    const { service, verificationRepo } = makeService();
    verificationRepo.findOne.mockResolvedValue(null);

    await expect(service.getByCoachId("coach-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("refuses verification access to users without a coach profile", async () => {
    const { service, coachRepo } = makeService();
    coachRepo.findOne.mockResolvedValue(null);

    await expect(service.getOwnVerification(stranger)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("lazily expires a verified coach whose verification has lapsed", async () => {
    const { service, verificationRepo, coachRepo } = makeService();
    const expired = makeVerification({
      status: CoachVerificationStatus.VERIFIED,
      expiresAt: new Date(Date.now() - 1000)
    });
    coachRepo.findOne.mockResolvedValue(makeCoach());
    verificationRepo.findOne.mockResolvedValue(expired);

    const result = await service.getOwnVerification(coachUser);

    expect(result.status).toBe(CoachVerificationStatus.EXPIRED);
    expect(verificationRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: CoachVerificationStatus.EXPIRED }));
    expect(coachRepo.save).toHaveBeenCalledWith(expect.objectContaining({ verificationStatus: CoachVerificationStatus.EXPIRED }));
  });

  it("lets a coach resubmit and returns to PENDING", async () => {
    const { service, verificationRepo, coachRepo } = makeService();
    coachRepo.findOne.mockResolvedValue(makeCoach());
    verificationRepo.findOne.mockResolvedValue(makeVerification({ status: CoachVerificationStatus.REJECTED, decisionNote: "blurry" }));

    const result = await service.submitOwn(coachUser);

    expect(result.status).toBe(CoachVerificationStatus.PENDING);
    expect(result.decisionNote).toBeNull();
    expect(coachRepo.save).toHaveBeenCalledWith(expect.objectContaining({ verificationStatus: CoachVerificationStatus.PENDING }));
  });
});
