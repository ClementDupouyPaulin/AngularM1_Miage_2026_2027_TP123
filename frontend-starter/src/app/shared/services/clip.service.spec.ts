import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { ClipService } from "./clip.service";
import {
  Clip,
  ClipAnalysis,
  ClipAnnotation,
  ClipSummary,
  LibraryStats,
  TagCount,
} from "../models/clip.model";
import { Page } from "../models/page.model";

describe("ClipService", () => {
  const analysis: ClipAnalysis = {
    version: 2,
    durationSec: 12.5,
    fps: 10,
    cuts: [1.2, 4.8],
    beats: [0.5, 1, 1.5],
    syncScore: 0.42,
    diffs: [0.1, 0.9, 0.2],
    palette: ["#112233"],
    transitions: [{ time: 1.2, kind: "cut" }],
    thumbnailTimes: [0, 1.2],
    sensitivity: 3,
  };

  const fakeSummary: ClipSummary = {
    id: "c1",
    title: "Course-poursuite",
    originalName: "chase.mp4",
    mimeType: "video/mp4",
    size: 2048,
    durationSec: 12.5,
    cutCount: 2,
    avgShotLength: 4.2,
    syncScore: 0.42,
    createdAt: "2026-01-01T00:00:00.000Z",
    tags: ["action"],
    visibility: "private",
    owner: { id: "u1", name: "Moi" },
    isOwner: true,
    hasFilmstrip: true,
    sparkline: [],
  };

  const fakeClip: Clip = {
    ...fakeSummary,
    analysis,
    annotations: [],
    sharedWith: [],
  };

  function emptyPage(page: number, limit: number): Page<ClipSummary> {
    return {
      items: [],
      page,
      limit,
      total: 0,
      pages: 0,
      hasPrevPage: false,
      hasNextPage: false,
      prevPage: null,
      nextPage: null,
    };
  }

  function setup() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    return {
      clips: TestBed.inject(ClipService),
      httpMock: TestBed.inject(HttpTestingController),
    };
  }

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  describe("list()", () => {
    it("appelle GET /api/clips?page=1&limit=6 par défaut", () => {
      const { clips, httpMock } = setup();

      clips.list().subscribe();

      const request = httpMock.expectOne(
        (candidate) => candidate.urlWithParams === "/api/clips?page=1&limit=6",
      );
      expect(request.request.method).toBe("GET");
      expect(request.request.params.keys()).toEqual(["page", "limit"]);

      request.flush(emptyPage(1, 6));
    });

    it("transmet page, limit, q rogné, tag et visibility", () => {
      const { clips, httpMock } = setup();

      clips
        .list(3, 20, { q: "  chase ", tag: "action", visibility: "public" })
        .subscribe();

      const request = httpMock.expectOne(
        (candidate) =>
          candidate.urlWithParams ===
          "/api/clips?page=3&limit=20&q=chase&tag=action&visibility=public",
      );
      expect(request.request.url).toBe("/api/clips");

      request.flush(emptyPage(3, 20));
    });

    it.each([undefined, "", "   "])(
      "n’envoie pas q, tag ni visibility pour %j",
      (value) => {
        const { clips, httpMock } = setup();

        clips.list(2, 5, { q: value, tag: value }).subscribe();

        const request = httpMock.expectOne("/api/clips?page=2&limit=5");
        expect(request.request.params.has("q")).toBe(false);
        expect(request.request.params.has("tag")).toBe(false);
        expect(request.request.params.has("visibility")).toBe(false);

        request.flush(emptyPage(2, 5));
      },
    );

    it("propage l’erreur HTTP au lieu de la masquer", () => {
      const { clips, httpMock } = setup();
      let caughtStatus = 0;

      clips
        .list()
        .subscribe({
          error: (error: { status: number }) => (caughtStatus = error.status),
        });
      httpMock
        .expectOne("/api/clips?page=1&limit=6")
        .flush(
          { message: "unauthorized" },
          { status: 401, statusText: "Unauthorized" },
        );

      expect(caughtStatus).toBe(401);
    });
  });

  describe("stats()", () => {
    it("appelle GET /api/clips/stats", () => {
      const { clips, httpMock } = setup();
      const stats: LibraryStats = {
        clipCount: 1,
        totalDurationSec: 12.5,
        totalCuts: 2,
        avgShotLength: 4.2,
        mostNervous: fakeSummary,
        mostSynced: null,
        byVisibility: { private: 1, shared: 0, public: 0 },
      };
      let received: LibraryStats | undefined;

      clips.stats().subscribe((value) => (received = value));

      const request = httpMock.expectOne("/api/clips/stats");
      expect(request.request.method).toBe("GET");
      request.flush(stats);
      expect(received).toEqual(stats);
    });
  });

  describe("tags()", () => {
    it("appelle GET /api/clips/tags", () => {
      const { clips, httpMock } = setup();
      const tags: TagCount[] = [{ tag: "action", count: 2 }];
      let received: TagCount[] | undefined;

      clips.tags().subscribe((value) => (received = value));

      const request = httpMock.expectOne("/api/clips/tags");
      expect(request.request.method).toBe("GET");
      request.flush(tags);
      expect(received).toEqual(tags);
    });
  });

  describe("discover()", () => {
    it("n’envoie que le scope quand rien d’autre n’est fourni", () => {
      const { clips, httpMock } = setup();

      clips.discover({ scope: "public" }).subscribe();

      const request = httpMock.expectOne("/api/clips/discover?scope=public");
      expect(request.request.method).toBe("GET");
      request.flush(emptyPage(1, 6));
    });

    it("transmet sort, q rogné, tag, page et limit", () => {
      const { clips, httpMock } = setup();

      clips
        .discover({
          scope: "friends",
          sort: "nervous",
          q: " chase ",
          tag: "action",
          page: 2,
          limit: 12,
        })
        .subscribe();

      const request = httpMock.expectOne(
        (candidate) =>
          candidate.urlWithParams ===
          "/api/clips/discover?scope=friends&sort=nervous&q=chase&tag=action&page=2&limit=12",
      );
      expect(request.request.url).toBe("/api/clips/discover");
      request.flush(emptyPage(2, 12));
    });

    it("ignore q et tag vides", () => {
      const { clips, httpMock } = setup();

      clips.discover({ scope: "shared", q: "  ", tag: "" }).subscribe();

      const request = httpMock.expectOne("/api/clips/discover?scope=shared");
      expect(request.request.params.keys()).toEqual(["scope"]);
      request.flush(emptyPage(1, 6));
    });
  });

  describe("get()", () => {
    it("appelle GET /api/clips/:id et restitue le clip avec son analyse", () => {
      const { clips, httpMock } = setup();
      let received: Clip | undefined;

      clips.get("c1").subscribe((clip) => (received = clip));

      const request = httpMock.expectOne("/api/clips/c1");
      expect(request.request.method).toBe("GET");
      request.flush(fakeClip);

      expect(received).toEqual(fakeClip);
    });
  });

  describe("upload()", () => {
    const video = new File(["octets-video"], "chase.mp4", {
      type: "video/mp4",
    });

    it("poste un multipart video + title + analysis sérialisée en JSON", () => {
      const { clips, httpMock } = setup();

      clips.upload(video, "Course-poursuite", analysis).subscribe();

      const request = httpMock.expectOne("/api/clips");
      expect(request.request.method).toBe("POST");
      expect(request.request.reportProgress).toBe(true);
      const body = request.request.body as FormData;
      expect(body).toBeInstanceOf(FormData);
      expect((body.get("video") as File).name).toBe("chase.mp4");
      expect(body.get("title")).toBe("Course-poursuite");
      expect(JSON.parse(body.get("analysis") as string)).toEqual(analysis);
      expect([...body.keys()]).toEqual(["video", "title", "analysis"]);

      request.flush(fakeClip);
    });

    it("ajoute pellicule, étiquettes et visibilité quand elles sont fournies", () => {
      const { clips, httpMock } = setup();
      const filmstrip = new Blob(["jpeg"], { type: "image/jpeg" });

      clips
        .upload(video, "Titre", analysis, {
          filmstrip,
          tags: ["action", "nuit"],
          visibility: "shared",
        })
        .subscribe();

      const request = httpMock.expectOne("/api/clips");
      const body = request.request.body as FormData;
      expect([...body.keys()]).toEqual([
        "video",
        "title",
        "analysis",
        "filmstrip",
        "tags",
        "visibility",
      ]);
      expect((body.get("filmstrip") as File).name).toBe("filmstrip.jpg");
      expect(JSON.parse(body.get("tags") as string)).toEqual([
        "action",
        "nuit",
      ]);
      expect(body.get("visibility")).toBe("shared");
      request.flush(fakeClip);
    });

    it("omet pellicule nulle, étiquettes vides et visibilité absente", () => {
      const { clips, httpMock } = setup();

      clips
        .upload(video, "Titre", analysis, { filmstrip: null, tags: [] })
        .subscribe();

      const request = httpMock.expectOne("/api/clips");
      expect([...(request.request.body as FormData).keys()]).toEqual([
        "video",
        "title",
        "analysis",
      ]);
      request.flush(fakeClip);
    });

    it("déduit le type MIME de l’extension quand File.type est vide", () => {
      const { clips, httpMock } = setup();

      clips
        .upload(new File(["octets"], "Chase.WEBM"), "Sans type", analysis)
        .subscribe();

      const request = httpMock.expectOne("/api/clips");
      const sent = (request.request.body as FormData).get("video") as File;
      expect(sent.type).toBe("video/webm");
      expect(sent.name).toBe("Chase.WEBM");
      request.flush(fakeClip);
    });
  });

  describe("video() et filmstrip()", () => {
    it("video() appelle GET /api/clips/:id/video en responseType blob", () => {
      const { clips, httpMock } = setup();
      let received: Blob | undefined;

      clips.video("c1").subscribe((blob) => (received = blob));

      const request = httpMock.expectOne("/api/clips/c1/video");
      expect(request.request.method).toBe("GET");
      expect(request.request.responseType).toBe("blob");
      request.flush(new Blob(["octets-video"], { type: "video/mp4" }));

      expect(received?.type).toBe("video/mp4");
    });

    it("filmstrip() appelle GET /api/clips/:id/filmstrip en responseType blob", () => {
      const { clips, httpMock } = setup();
      let received: Blob | undefined;

      clips.filmstrip("c1").subscribe((blob) => (received = blob));

      const request = httpMock.expectOne("/api/clips/c1/filmstrip");
      expect(request.request.method).toBe("GET");
      expect(request.request.responseType).toBe("blob");
      request.flush(new Blob(["jpeg"], { type: "image/jpeg" }));

      expect(received?.type).toBe("image/jpeg");
    });
  });

  describe("patch()", () => {
    it("appelle PATCH /api/clips/:id avec les réglages", () => {
      const { clips, httpMock } = setup();
      const changes = {
        title: "Nouveau",
        tags: ["a"],
        visibility: "shared" as const,
        sharedWith: ["u2"],
      };
      let received: Clip | undefined;

      clips.patch("c1", changes).subscribe((clip) => (received = clip));

      const request = httpMock.expectOne("/api/clips/c1");
      expect(request.request.method).toBe("PATCH");
      expect(request.request.body).toEqual(changes);
      request.flush(fakeClip);
      expect(received).toEqual(fakeClip);
    });
  });

  describe("updateAnalysis()", () => {
    it("appelle PUT /api/clips/:id/analysis avec l’analyse", () => {
      const { clips, httpMock } = setup();

      clips.updateAnalysis("c1", analysis).subscribe();

      const request = httpMock.expectOne("/api/clips/c1/analysis");
      expect(request.request.method).toBe("PUT");
      expect(request.request.body).toEqual(analysis);
      request.flush(fakeClip);
    });
  });

  describe("remove()", () => {
    it("appelle DELETE /api/clips/:id sans corps", () => {
      const { clips, httpMock } = setup();

      clips.remove("c1").subscribe();

      const request = httpMock.expectOne("/api/clips/c1");
      expect(request.request.method).toBe("DELETE");
      expect(request.request.body).toBeNull();

      request.flush(null, { status: 204, statusText: "No Content" });
    });
  });

  describe("annotations", () => {
    it("addAnnotation() poste {time, text} sur /api/clips/:id/annotations", () => {
      const { clips, httpMock } = setup();
      const created: ClipAnnotation = {
        id: "a1",
        time: 3.5,
        text: "Belle coupe",
        authorId: "u1",
        authorName: "Moi",
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      let received: ClipAnnotation | undefined;

      clips
        .addAnnotation("c1", { time: 3.5, text: "Belle coupe" })
        .subscribe((value) => (received = value));

      const request = httpMock.expectOne("/api/clips/c1/annotations");
      expect(request.request.method).toBe("POST");
      expect(request.request.body).toEqual({ time: 3.5, text: "Belle coupe" });
      request.flush(created, { status: 201, statusText: "Created" });
      expect(received).toEqual(created);
    });

    it("removeAnnotation() appelle DELETE /api/clips/:id/annotations/:annotationId", () => {
      const { clips, httpMock } = setup();

      clips.removeAnnotation("c1", "a1").subscribe();

      const request = httpMock.expectOne("/api/clips/c1/annotations/a1");
      expect(request.request.method).toBe("DELETE");
      expect(request.request.body).toBeNull();
      request.flush(null, { status: 204, statusText: "No Content" });
    });
  });
});
