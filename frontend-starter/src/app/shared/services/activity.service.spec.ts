import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { ActivityService } from "./activity.service";
import { ActivityEvent } from "../models/friend.model";

describe("ActivityService", () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    return {
      activity: TestBed.inject(ActivityService),
      httpMock: TestBed.inject(HttpTestingController),
    };
  }

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it("recent() appelle GET /api/activity?limit=20 par défaut", () => {
    const { activity, httpMock } = setup();
    const events: ActivityEvent[] = [
      {
        id: "e1",
        type: "clip",
        actor: { id: "u2", name: "Lea" },
        clipId: "c1",
        at: "2026-01-01T00:00:00.000Z",
      },
    ];
    let received: ActivityEvent[] | undefined;

    activity.recent().subscribe((value) => (received = value));

    const request = httpMock.expectOne("/api/activity?limit=20");
    expect(request.request.method).toBe("GET");
    request.flush(events);
    expect(received).toEqual(events);
  });

  it("recent() transmet la limite demandée", () => {
    const { activity, httpMock } = setup();

    activity.recent(5).subscribe();

    const request = httpMock.expectOne("/api/activity?limit=5");
    expect(request.request.params.get("limit")).toBe("5");
    request.flush([]);
  });
});
