import { CoachDashboardController } from "./coach-dashboard.controller";
import { CoachDashboardService } from "./coach-dashboard.service";
import { User } from "src/modules/users/entities/user.entity";
import { CoachDashboardQueryDto, CoachClientListQueryDto, CoachClientDetailQueryDto, CoachActivityQueryDto } from "./dto/coach-dashboard-query.dto";
import { ClientProgressDetailDto } from "./dto/coach-dashboard-response.dto";

describe("CoachDashboardController", () => {
  const user = { id: "user-1" } as User;
  const createService = () =>
    ({
      overview: jest.fn(),
      clientSummaries: jest.fn(),
      clientDetail: jest.fn(),
      activity: jest.fn()
    }) as unknown as CoachDashboardService;

  it("GET / forwards the current user and query to the overview service", async () => {
    const service = createService();
    const controller = new CoachDashboardController(service);
    const query = new CoachDashboardQueryDto();
    const result = { activeClientCount: 0 };
    const overview = jest.spyOn(service, "overview") as jest.Mock;
    overview.mockResolvedValue(result as never);

    await expect(controller.overview(user, query)).resolves.toBe(result);
    expect(overview).toHaveBeenCalledWith(user, query);
  });

  it("GET /clients forwards the paginated list query", async () => {
    const service = createService();
    const controller = new CoachDashboardController(service);
    const query = new CoachClientListQueryDto();
    const result = { data: [] };
    const clientSummaries = jest.spyOn(service, "clientSummaries") as jest.Mock;
    clientSummaries.mockResolvedValue(result as never);

    await expect(controller.clients(user, query)).resolves.toBe(result);
    expect(clientSummaries).toHaveBeenCalledWith(user, query);
  });

  it("GET /clients/:clientId forwards the client id and detail query", async () => {
    const service = createService();
    const controller = new CoachDashboardController(service);
    const query = new CoachClientDetailQueryDto();
    const result = { client: {} } as ClientProgressDetailDto;
    const clientDetail = jest.spyOn(service, "clientDetail") as jest.Mock;
    clientDetail.mockResolvedValue(result as never);

    await expect(controller.clientDetail(user, "6ddba0d0-3e6f-4e5e-8b0a-000000000000", query)).resolves.toBe(result);
    expect(clientDetail).toHaveBeenCalledWith(user, "6ddba0d0-3e6f-4e5e-8b0a-000000000000", query);
  });

  it("GET /activity forwards the activity query", async () => {
    const service = createService();
    const controller = new CoachDashboardController(service);
    const query = new CoachActivityQueryDto();
    const result = { data: [] };
    const activity = jest.spyOn(service, "activity") as jest.Mock;
    activity.mockResolvedValue(result as never);

    await expect(controller.activity(user, query)).resolves.toBe(result);
    expect(activity).toHaveBeenCalledWith(user, query);
  });
});
