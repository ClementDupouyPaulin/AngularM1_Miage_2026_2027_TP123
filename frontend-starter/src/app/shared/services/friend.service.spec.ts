import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { FriendService } from "./friend.service";
import { FriendEntry, FriendsOverview } from "../models/friend.model";

describe("FriendService", () => {
  const entry: FriendEntry = {
    friendshipId: "f1",
    user: { id: "u2", name: "Lea", email: "lea@example.com" },
    since: "2026-01-01T00:00:00.000Z",
  };

  function setup() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    return {
      friends: TestBed.inject(FriendService),
      httpMock: TestBed.inject(HttpTestingController),
    };
  }

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it("overview() appelle GET /api/friends", () => {
    const { friends, httpMock } = setup();
    const overview: FriendsOverview = { friends: [entry], requests: [] };
    let received: FriendsOverview | undefined;

    friends.overview().subscribe((value) => (received = value));

    const request = httpMock.expectOne("/api/friends");
    expect(request.request.method).toBe("GET");
    request.flush(overview);
    expect(received).toEqual(overview);
  });

  it("invite() poste { email } sur /api/friends/requests", () => {
    const { friends, httpMock } = setup();
    let message = "";

    friends
      .invite("lea@example.com")
      .subscribe((value) => (message = value.message));

    const request = httpMock.expectOne("/api/friends/requests");
    expect(request.request.method).toBe("POST");
    expect(request.request.body).toEqual({ email: "lea@example.com" });
    request.flush(
      { message: "Invitation envoyée" },
      { status: 202, statusText: "Accepted" },
    );
    expect(message).toBe("Invitation envoyée");
  });

  it("invite() propage l’erreur 409", () => {
    const { friends, httpMock } = setup();
    let status = 0;

    friends
      .invite("lea@example.com")
      .subscribe({
        error: (error: { status: number }) => (status = error.status),
      });
    httpMock
      .expectOne("/api/friends/requests")
      .flush({ message: "Déjà ami" }, { status: 409, statusText: "Conflict" });

    expect(status).toBe(409);
  });

  it("accept() poste sur /api/friends/requests/:id/accept", () => {
    const { friends, httpMock } = setup();
    let received: FriendEntry | undefined;

    friends.accept("r1").subscribe((value) => (received = value));

    const request = httpMock.expectOne("/api/friends/requests/r1/accept");
    expect(request.request.method).toBe("POST");
    request.flush(entry);
    expect(received).toEqual(entry);
  });

  it("remove() appelle DELETE /api/friends/:id", () => {
    const { friends, httpMock } = setup();

    friends.remove("f1").subscribe();

    const request = httpMock.expectOne("/api/friends/f1");
    expect(request.request.method).toBe("DELETE");
    expect(request.request.body).toBeNull();
    request.flush(null, { status: 204, statusText: "No Content" });
  });
});
