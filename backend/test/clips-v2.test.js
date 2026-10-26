import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

// Même technique que clips.test.js : dossier de travail temporaire et MongoDB simulé.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "gpc-clips-v2-"));
process.chdir(workDir);
const { createApp } = await import("../src/app.js");
const { Clip } = await import("../src/models/Clip.js");
const { User } = await import("../src/models/User.js");

mongoose.set("bufferCommands", false);

const UPLOADS = path.join(workDir, "data", "uploads");
const SECRET = process.env.JWT_SECRET || "tp1-development-secret";
const ALICE = new mongoose.Types.ObjectId();
const BOB = new mongoose.Types.ObjectId();
const aliceToken = jwt.sign({ sub: String(ALICE), email: "alice@example.com" }, SECRET);
const bobToken = jwt.sign({ sub: String(BOB), email: "bob@example.com" }, SECRET);
const USER_NAMES = new Map([
  [String(ALICE), "Alice"],
  [String(BOB), "Bob"],
]);

const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("ftypisom", "latin1"),
  Buffer.alloc(256, 3),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(128, 7)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const MAX_FILMSTRIP_SIZE = 1024 * 1024;

const v2Analysis = (overrides = {}) => ({
  version: 2,
  durationSec: 24,
  fps: 10,
  cuts: [0, 0.5, 12, 23.9],
  beats: [0.5, 12],
  syncScore: null,
  diffs: [0, 0.25, 1],
  palette: ["#AABBCC", "#000000"],
  transitions: [
    { time: 0, kind: "cut" },
    { time: 0.5, kind: "cut" },
    { time: 6, kind: "fade" },
    { time: 12, kind: "cut" },
    { time: 23.9, kind: "cut" },
  ],
  thumbnailTimes: [0, 0.5, 12, 23.9],
  sensitivity: 2.5,
  ...overrides,
});

const v1Analysis = (overrides = {}) => ({
  version: 1,
  durationSec: 30,
  cuts: [5, 15],
  beats: [1, 2],
  syncScore: null,
  ...overrides,
});

/* ---- Simulation de MongoDB ---- */

const store = new Map();
let failCreate = false;

function fakeQuery(result) {
  return {
    select() {
      return this;
    },
    sort() {
      return this;
    },
    lean() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
}

function findInStore(filter) {
  const doc = store.get(String(filter._id));
  if (!doc) return null;
  if (filter.ownerId !== undefined && String(doc.ownerId) !== String(filter.ownerId)) return null;
  return doc;
}

const byRecent = (a, b) => b.createdAt - a.createdAt;

User.find = (filter) =>
  fakeQuery(
    filter._id.$in
      .filter((id) => USER_NAMES.has(String(id)))
      .map((id) => ({ _id: id, name: USER_NAMES.get(String(id)) })),
  );
Clip.findOne = (filter) => fakeQuery(findInStore(filter));
Clip.findOneAndDelete = (filter) => {
  const doc = findInStore(filter);
  if (doc) store.delete(String(doc._id));
  return fakeQuery(doc);
};
// Ajout atomique d'annotation : condition « pas d'élément à l'index MAX-1 » puis $push.
Clip.findOneAndUpdate = (filter, update) => {
  const doc = findInStore(filter);
  const [sizeKey] = Object.keys(filter).filter((key) => key.startsWith("annotations."));
  const full = sizeKey && doc && doc.annotations.length > Number(sizeKey.split(".")[1]);
  if (!doc || full) return fakeQuery(null);
  doc.annotations.push(update.$push.annotations);
  return fakeQuery(doc);
};
Clip.find = (filter) =>
  fakeQuery(
    [...store.values()]
      .filter((doc) => String(doc.ownerId) === String(filter.ownerId))
      .sort(byRecent)
      .map((doc) => doc.toObject()),
  );
Clip.create = async (data) => {
  if (failCreate) throw new Error("MongoDB indisponible (simulé)");
  const doc = new Clip(data);
  await doc.validate();
  store.set(String(doc._id), doc);
  return doc;
};
Clip.prototype.save = async function save() {
  await this.validate();
  store.set(String(this._id), this);
  return this;
};

function matchesFilter(doc, match) {
  if (!(match.ownerId instanceof mongoose.Types.ObjectId) || !match.ownerId.equals(doc.ownerId)) return false;
  if (match.title && !new RegExp(match.title.$regex, match.title.$options).test(doc.title)) return false;
  if (match.tags && !doc.tags.includes(match.tags)) return false;
  if (match.visibility) {
    const allowed = match.visibility.$in ?? [match.visibility];
    if (!allowed.includes(doc.visibility ?? null)) return false;
  }
  return true;
}

const pipelines = [];
mongoose.Aggregate.prototype.exec = async function exec() {
  const pipeline = this.pipeline();
  pipelines.push(pipeline);
  const match = pipeline.find((stage) => stage.$match).$match;
  const docsStages = pipeline.find((stage) => stage.$facet).$facet.docs;
  const project = [...pipeline, ...docsStages].find((stage) => stage.$project).$project;
  const skip = docsStages.find((stage) => "$skip" in stage).$skip;
  const limit = docsStages.find((stage) => "$limit" in stage).$limit;
  const rows = [...store.values()]
    .filter((doc) => matchesFilter(doc, match))
    .sort(byRecent)
    .map((doc) => {
      const row = { ...doc.toObject(), hasFilmstrip: typeof doc.filmstripStoredName === "string" };
      for (const [key, value] of Object.entries(project)) if (value === 0) delete row[key];
      return row;
    });
  return [{ docs: rows.slice(skip, skip + limit), count: rows.length ? [{ count: rows.length }] : [] }];
};

let server, base;

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

test.beforeEach(() => {
  store.clear();
  pipelines.length = 0;
  failCreate = false;
  for (const entry of fs.readdirSync(UPLOADS, { withFileTypes: true })) {
    if (entry.isFile()) fs.rmSync(path.join(UPLOADS, entry.name));
  }
});

/* ---- Utilitaires ---- */

function api(urlPath, { token, json, ...init } = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(json);
  }
  return fetch(base + urlPath, { ...init, headers });
}

const file = (bytes, type, name) => ({ bytes, type, name });

function uploadClip(fields = {}, token = aliceToken) {
  const data = new FormData();
  const all = {
    video: file(MP4, "video/mp4", "extrait.mp4"),
    title: "Poursuite",
    analysis: JSON.stringify(v2Analysis()),
    ...fields,
  };
  for (const [name, value] of Object.entries(all)) {
    if (value === null) continue;
    if (typeof value === "string") data.append(name, value);
    else data.append(name, new Blob([value.bytes], { type: value.type }), value.name);
  }
  return api("/api/clips", { method: "POST", token, body: data });
}

const diskFiles = () => fs.readdirSync(UPLOADS).filter((name) => name !== "covers");

function seedClip({ owner = ALICE, title = "Clip", createdAt = new Date(), filmstrip = false, ...fields } = {}) {
  const storedName = `${crypto.randomUUID()}.mp4`;
  fs.writeFileSync(path.join(UPLOADS, storedName), MP4);
  let filmstripStoredName = null;
  if (filmstrip) {
    filmstripStoredName = `${crypto.randomUUID()}.jpg`;
    fs.writeFileSync(path.join(UPLOADS, filmstripStoredName), JPEG);
  }
  const doc = new Clip({
    ownerId: owner,
    title,
    originalName: "clip.mp4",
    storedName,
    filmstripStoredName,
    mimeType: "video/mp4",
    size: MP4.length,
    durationSec: 30,
    cuts: [5, 15],
    beats: [1, 2],
    syncScore: null,
    cutCount: 2,
    avgShotLength: 10,
    createdAt,
    ...fields,
  });
  store.set(String(doc._id), doc);
  return doc;
}

async function expectError(response, status, pattern) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ["message"]);
  assert.match(body.message, pattern);
}

/* ---- Authentification ---- */

test("401 sans JWT sur les nouvelles routes des clips", async () => {
  const clip = seedClip({ annotations: [{ time: 1, text: "Note", authorId: ALICE }] });
  const annotationId = clip.annotations[0].id;
  const routes = [
    ["GET", "/api/clips/stats"],
    ["GET", "/api/clips/tags"],
    ["GET", `/api/clips/${clip.id}/filmstrip`],
    ["PATCH", `/api/clips/${clip.id}`],
    ["PUT", `/api/clips/${clip.id}/analysis`],
    ["POST", `/api/clips/${clip.id}/annotations`],
    ["DELETE", `/api/clips/${clip.id}/annotations/${annotationId}`],
  ];
  for (const [method, url] of routes) {
    assert.equal((await api(url, { method })).status, 401, `${method} ${url}`);
  }
  assert.equal(store.get(clip.id).annotations.length, 1);
});

/* ---- Upload v2 ---- */

test("upload v2 complet : analyse, pellicule, étiquettes, visibilité et statistiques serveur", async () => {
  const response = await uploadClip({
    filmstrip: file(JPEG, "image/jpeg", "pellicule.jpg"),
    tags: JSON.stringify(["Action", " noir ", "action"]),
    visibility: "public",
  });
  assert.equal(response.status, 201);
  const clip = await response.json();

  assert.deepEqual(clip.analysis, {
    ...v2Analysis(),
    palette: ["#aabbcc", "#000000"],
    syncScore: 10,
  });
  assert.equal(clip.cutCount, 4);
  assert.equal(clip.avgShotLength, 4.8);
  assert.equal(clip.syncScore, 10);
  const sparkline = new Array(24).fill(0);
  sparkline[0] = 2;
  sparkline[12] = 1;
  sparkline[23] = 1;
  assert.deepEqual(clip.sparkline, sparkline);
  assert.deepEqual(clip.tags, ["action", "noir"]);
  assert.equal(clip.visibility, "public");
  assert.equal(clip.hasFilmstrip, true);
  assert.deepEqual(clip.owner, { id: String(ALICE), name: "Alice" });
  assert.equal(clip.isOwner, true);
  assert.deepEqual(clip.annotations, []);
  assert.deepEqual(clip.sharedWith, []);
  assert.equal("filmstripStoredName" in clip, false);
  assert.equal(JSON.stringify(clip).includes(store.get(clip.id).filmstripStoredName), false);
  assert.equal(diskFiles().length, 2);
});

test("upload sans pellicule, étiquettes ni visibilité : valeurs par défaut", async () => {
  const response = await uploadClip();
  assert.equal(response.status, 201);
  const clip = await response.json();
  assert.equal(clip.hasFilmstrip, false);
  assert.deepEqual(clip.tags, []);
  assert.equal(clip.visibility, "private");
  assert.equal(diskFiles().length, 1);
});

test("upload v1 accepté et converti en v2", async () => {
  const response = await uploadClip({ analysis: JSON.stringify(v1Analysis()) });
  assert.equal(response.status, 201);
  const { analysis } = await response.json();
  assert.deepEqual(analysis, {
    ...v1Analysis({ syncScore: 0 }),
    version: 2,
    fps: 10,
    diffs: [],
    palette: [],
    transitions: [
      { time: 5, kind: "cut" },
      { time: 15, kind: "cut" },
    ],
    thumbnailTimes: [],
    sensitivity: 3,
  });
});

test("pellicule non JPEG ou de plus de 1 Mo = 400 et disque nettoyé", async () => {
  const cases = [
    [file(PNG, "image/jpeg", "faux.jpg"), /Pellicule invalide/],
    [file(Buffer.from([0xff, 0xd8]), "image/jpeg", "court.jpg"), /Pellicule invalide/],
    [file(Buffer.concat([JPEG, Buffer.alloc(MAX_FILMSTRIP_SIZE)]), "image/jpeg", "gros.jpg"), /Pellicule trop volumineuse/],
  ];
  for (const [filmstrip, pattern] of cases) {
    await expectError(await uploadClip({ filmstrip }), 400, pattern);
  }
  assert.deepEqual(diskFiles(), []);
  assert.equal(store.size, 0);
});

test("étiquettes ou visibilité hors contrat = 400 et disque nettoyé", async () => {
  const invalidTags = [
    "{pas du json",
    JSON.stringify("action"),
    JSON.stringify([1]),
    JSON.stringify([""]),
    JSON.stringify(["   "]),
    JSON.stringify(["a".repeat(25)]),
    JSON.stringify(["a\u0007b"]),
    JSON.stringify(["a", "b", "c", "d", "e", "f"]),
  ];
  for (const tags of invalidTags) {
    await expectError(await uploadClip({ tags }), 400, /Étiquette/);
  }
  for (const visibility of ["friends", "PUBLIC", ""]) {
    await expectError(await uploadClip({ visibility }), 400, /Visibilité invalide/);
  }
  assert.deepEqual(diskFiles(), []);
  assert.equal(store.size, 0);
});

test("étiquettes aux bornes acceptées : 5 étiquettes de 24 caractères, doublons fusionnés", async () => {
  const tags = ["a", "b", "c", "d", "e".repeat(24), "A"];
  const response = await uploadClip({ tags: JSON.stringify(tags) });
  assert.equal(response.status, 201);
  assert.deepEqual((await response.json()).tags, ["a", "b", "c", "d", "e".repeat(24)]);
});

test("analyse v2 hors contrat = 400 « Analyse » et disque nettoyé", async () => {
  const { fps, ...withoutFps } = v2Analysis();
  assert.equal(fps, 10);
  const invalid = [
    withoutFps,
    v2Analysis({ extra: true }),
    v2Analysis({ version: 3 }),
    v2Analysis({ fps: 0 }),
    v2Analysis({ fps: 31 }),
    v2Analysis({ sensitivity: 0.5 }),
    v2Analysis({ sensitivity: 6.5 }),
    v2Analysis({ sensitivity: "3" }),
    v2Analysis({ diffs: new Array(1301).fill(0) }),
    v2Analysis({ diffs: [0.5, 1.2] }),
    v2Analysis({ diffs: [-0.1] }),
    v2Analysis({ diffs: "0,1" }),
    v2Analysis({ palette: new Array(131).fill("#000000") }),
    v2Analysis({ palette: ["red"] }),
    v2Analysis({ palette: ["#12345"] }),
    v2Analysis({ transitions: [{ time: 5, kind: "cut" }, { time: 2, kind: "cut" }] }),
    v2Analysis({ transitions: [{ time: 2, kind: "wipe" }] }),
    v2Analysis({ transitions: [{ time: 25, kind: "cut" }] }),
    v2Analysis({ transitions: [{ time: 2, kind: "cut", extra: 1 }] }),
    v2Analysis({ transitions: [2] }),
    v2Analysis({ thumbnailTimes: Array.from({ length: 42 }, (_, index) => index * 0.5) }),
    v2Analysis({ thumbnailTimes: [3, 1] }),
    v2Analysis({ thumbnailTimes: [30] }),
    v2Analysis({ cutCount: 4 }),
  ];
  for (const analysis of invalid) {
    await expectError(await uploadClip({ analysis: JSON.stringify(analysis) }), 400, /Analyse/);
  }
  assert.deepEqual(diskFiles(), []);
  assert.equal(store.size, 0);
});

test("analyse v2 aux bornes acceptée", async () => {
  const analysis = v2Analysis({
    durationSec: 120,
    fps: 10,
    diffs: new Array(1300).fill(1),
    palette: new Array(130).fill("#ffffff"),
    thumbnailTimes: Array.from({ length: 41 }, (_, index) => index),
    sensitivity: 6,
  });
  assert.equal((await uploadClip({ analysis: JSON.stringify(analysis) })).status, 201);
  const minimal = v2Analysis({ sensitivity: 1, fps: 1, diffs: [], palette: [], transitions: [], thumbnailTimes: [] });
  assert.equal((await uploadClip({ analysis: JSON.stringify(minimal) })).status, 201);
});

test("échec MongoDB après l'upload : vidéo et pellicule supprimées du disque", async () => {
  failCreate = true;
  const response = await uploadClip({ filmstrip: file(JPEG, "image/jpeg", "p.jpg") });
  assert.equal(response.status, 500);
  assert.deepEqual(diskFiles(), []);
});

test("champ de fichier inattendu = 400 sans fichier résiduel", async () => {
  const response = await uploadClip({ cover: file(JPEG, "image/jpeg", "c.jpg") });
  assert.equal(response.status, 400);
  assert.deepEqual(diskFiles(), []);
});

/* ---- Liste et filtres ---- */

test("liste : filtres tag et visibility, ancien clip sans visibilité compté privé", async () => {
  const legacy = seedClip({ title: "Ancien", tags: ["noir"], createdAt: new Date(2026, 0, 1) });
  legacy.visibility = undefined;
  seedClip({ title: "Public", tags: ["action", "noir"], visibility: "public", filmstrip: true });
  seedClip({ title: "Partagé", tags: ["action"], visibility: "shared" });
  seedClip({ owner: BOB, title: "Bob", tags: ["action"], visibility: "public" });

  const titles = async (query) => {
    const response = await api(`/api/clips${query}`, { token: aliceToken });
    assert.equal(response.status, 200, query);
    return (await response.json()).items.map((item) => item.title).sort();
  };
  assert.deepEqual(await titles("?tag=ACTION"), ["Partagé", "Public"]);
  assert.deepEqual(await titles("?visibility=private"), ["Ancien"]);
  assert.deepEqual(await titles("?visibility=public&tag=noir"), ["Public"]);
  assert.deepEqual(await titles("?q=an&tag=noir"), ["Ancien"]);

  const page = await (await api("/api/clips?visibility=public", { token: aliceToken })).json();
  const [item] = page.items;
  assert.equal(item.hasFilmstrip, true);
  assert.deepEqual(item.owner, { id: String(ALICE), name: "Alice" });
  assert.equal(item.sparkline.length, 24);
  assert.equal(item.sparkline.reduce((sum, value) => sum + value, 0), 2);
  assert.equal("analysis" in item, false);
  assert.equal("annotations" in item, false);
  const legacyItem = (await (await api("/api/clips?visibility=private", { token: aliceToken })).json()).items[0];
  assert.equal(legacyItem.visibility, "private");
  assert.equal(legacyItem.hasFilmstrip, false);
});

test("liste : filtres tag ou visibility invalides = 400", async () => {
  for (const query of [`?tag=${"a".repeat(25)}`, "?tag=%20", "?visibility=friends", "?tag=a&tag=b"]) {
    await expectError(await api(`/api/clips${query}`, { token: aliceToken }), 400, /invalide/);
  }
});

/* ---- Statistiques et étiquettes ---- */

test("stats d'une bibliothèque vide", async () => {
  seedClip({ owner: BOB });
  const response = await api("/api/clips/stats", { token: aliceToken });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    clipCount: 0,
    totalDurationSec: 0,
    totalCuts: 0,
    avgShotLength: null,
    mostNervous: null,
    mostSynced: null,
    byVisibility: { private: 0, shared: 0, public: 0 },
  });
});

test("stats : totaux, plan moyen global, plus nerveux, plus synchronisé, par visibilité", async () => {
  const calm = seedClip({ title: "Calme", durationSec: 60, cuts: [30], cutCount: 1, avgShotLength: 30, syncScore: 2 });
  const nervous = seedClip({
    title: "Nerveux",
    durationSec: 10,
    cuts: [2, 4, 6, 8],
    cutCount: 4,
    avgShotLength: 2,
    syncScore: null,
    visibility: "public",
    filmstrip: true,
  });
  seedClip({ title: "Partagé", durationSec: 30, cuts: [5, 15], cutCount: 2, avgShotLength: 10, syncScore: 1, visibility: "shared" });
  seedClip({ owner: BOB, durationSec: 5, cuts: [1, 2, 3, 4], cutCount: 4, avgShotLength: 1, syncScore: 10 });

  const stats = await (await api("/api/clips/stats", { token: aliceToken })).json();
  assert.equal(stats.clipCount, 3);
  assert.equal(stats.totalDurationSec, 100);
  assert.equal(stats.totalCuts, 7);
  assert.equal(stats.avgShotLength, 10);
  assert.equal(stats.mostNervous.id, nervous.id);
  assert.equal(stats.mostNervous.hasFilmstrip, true);
  assert.equal(stats.mostNervous.owner.name, "Alice");
  assert.equal(stats.mostSynced.id, calm.id);
  assert.deepEqual(stats.byVisibility, { private: 1, shared: 1, public: 1 });
  assert.equal(JSON.stringify(stats).includes(store.get(nervous.id).storedName), false);
});

test("tags : décompte de mes étiquettes, plus fréquentes puis alphabétique", async () => {
  seedClip({ tags: ["noir", "action"] });
  seedClip({ tags: ["action"] });
  seedClip({ tags: ["drame"] });
  seedClip({ owner: BOB, tags: ["action", "western"] });
  const response = await api("/api/clips/tags", { token: aliceToken });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [
    { tag: "action", count: 2 },
    { tag: "drame", count: 1 },
    { tag: "noir", count: 1 },
  ]);
});

/* ---- Détail ---- */

test("détail v2 : annotations triées avec auteur, partage visible du propriétaire", async () => {
  const clip = seedClip({
    analysisVersion: 2,
    fps: 10,
    sensitivity: 4,
    transitions: [{ time: 5, kind: "fade" }],
    sharedWith: [BOB],
    annotations: [
      { time: 20, text: "Plus tard", authorId: ALICE },
      { time: 3, text: "Au début", authorId: BOB },
    ],
  });
  const detail = await (await api(`/api/clips/${clip.id}`, { token: aliceToken })).json();
  assert.equal(detail.analysis.sensitivity, 4);
  assert.deepEqual(detail.analysis.transitions, [{ time: 5, kind: "fade" }]);
  assert.deepEqual(
    detail.annotations.map(({ time, text, authorId, authorName }) => ({ time, text, authorId, authorName })),
    [
      { time: 3, text: "Au début", authorId: String(BOB), authorName: "Bob" },
      { time: 20, text: "Plus tard", authorId: String(ALICE), authorName: "Alice" },
    ],
  );
  assert.equal(typeof detail.annotations[0].id, "string");
  assert.ok(detail.annotations[0].createdAt);
  assert.deepEqual(detail.sharedWith, [{ id: String(BOB), name: "Bob" }]);
});

test("clip d'autrui = 404 sur détail, pellicule, PATCH, PUT et annotations", async () => {
  const clip = seedClip({ owner: BOB, filmstrip: true, annotations: [{ time: 1, text: "x", authorId: BOB }] });
  const annotationId = clip.annotations[0].id;
  const routes = [
    ["GET", `/api/clips/${clip.id}/filmstrip`],
    ["PATCH", `/api/clips/${clip.id}`, { title: "Volé" }],
    ["PUT", `/api/clips/${clip.id}/analysis`, v1Analysis()],
    ["POST", `/api/clips/${clip.id}/annotations`, { time: 1, text: "Intrus" }],
    ["DELETE", `/api/clips/${clip.id}/annotations/${annotationId}`],
    ["GET", "/api/clips/pas-un-id/filmstrip"],
    ["PATCH", "/api/clips/pas-un-id", { title: "x" }],
  ];
  for (const [method, url, json] of routes) {
    await expectError(await api(url, { method, json, token: aliceToken }), 404, /^Clip inconnu$/);
  }
  const stored = store.get(clip.id);
  assert.equal(stored.title, "Clip");
  assert.equal(stored.annotations.length, 1);
});

/* ---- Pellicule ---- */

test("pellicule : JPEG envoyé avec nosniff ; absente ou fichier manquant = 404", async () => {
  const withStrip = seedClip({ filmstrip: true });
  const response = await api(`/api/clips/${withStrip.id}/filmstrip`, { token: aliceToken });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), JPEG);

  const withoutStrip = seedClip();
  await expectError(
    await api(`/api/clips/${withoutStrip.id}/filmstrip`, { token: aliceToken }),
    404,
    /^Pellicule absente$/,
  );

  fs.unlinkSync(path.join(UPLOADS, store.get(withStrip.id).filmstripStoredName));
  await expectError(
    await api(`/api/clips/${withStrip.id}/filmstrip`, { token: aliceToken }),
    404,
    /^Pellicule absente$/,
  );
});

/* ---- PATCH ---- */

test("PATCH : titre, étiquettes, visibilité et partage vide modifiés", async () => {
  const clip = seedClip();
  const response = await api(`/api/clips/${clip.id}`, {
    method: "PATCH",
    token: aliceToken,
    json: { title: "  Nouveau titre ", tags: ["Western"], visibility: "public", sharedWith: [] },
  });
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal(updated.title, "Nouveau titre");
  assert.deepEqual(updated.tags, ["western"]);
  assert.equal(updated.visibility, "public");
  assert.deepEqual(updated.sharedWith, []);
  assert.equal(store.get(clip.id).visibility, "public");
});

test("PATCH hors contrat = 400 sans modification", async () => {
  const clip = seedClip({ tags: ["noir"] });
  const bodies = [
    [{ ownerId: String(BOB) }, /champ inattendu/],
    [{ cutCount: 0 }, /champ inattendu/],
    [{ title: "" }, /Titre invalide/],
    [{ title: "a".repeat(201) }, /Titre invalide/],
    [{ title: 42 }, /Titre invalide/],
    [{ tags: ["a", "b", "c", "d", "e", "f"] }, /Étiquettes limitées/],
    [{ tags: "noir" }, /Étiquettes invalides/],
    [{ visibility: "friends" }, /Visibilité invalide/],
    [{ sharedWith: "bob" }, /Partage invalide/],
    [{ sharedWith: ["pas-un-id"] }, /Partage invalide/],
    [["title"], /Corps JSON attendu/],
  ];
  for (const [json, pattern] of bodies) {
    await expectError(await api(`/api/clips/${clip.id}`, { method: "PATCH", token: aliceToken, json }), 400, pattern);
  }
  const raw = await api(`/api/clips/${clip.id}`, {
    method: "PATCH",
    token: aliceToken,
    headers: { "Content-Type": "application/json" },
    body: "{pas du json",
  });
  await expectError(raw, 400, /^Corps JSON invalide$/);
  const stored = store.get(clip.id);
  assert.equal(stored.title, "Clip");
  assert.deepEqual([...stored.tags], ["noir"]);
  assert.equal(stored.visibility, "private");
});

/* ---- PUT analysis ---- */

test("PUT analysis : coupes retouchées, statistiques et mini-courbe recalculées, annotations gardées", async () => {
  const clip = seedClip({ annotations: [{ time: 2, text: "Garde-moi", authorId: ALICE }] });
  const analysis = v2Analysis({
    durationSec: 30,
    cuts: [1, 2, 3],
    beats: [1, 2, 3],
    syncScore: 0,
    transitions: [{ time: 1, kind: "cut" }, { time: 2, kind: "cut" }, { time: 3, kind: "cut" }],
    thumbnailTimes: [0, 1, 2, 3],
    sensitivity: 5,
  });
  const response = await api(`/api/clips/${clip.id}/analysis`, { method: "PUT", token: aliceToken, json: analysis });
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal(updated.cutCount, 3);
  assert.equal(updated.avgShotLength, 7.5);
  assert.equal(updated.syncScore, 10);
  assert.equal(updated.analysis.sensitivity, 5);
  assert.deepEqual(updated.analysis.cuts, [1, 2, 3]);
  assert.deepEqual(updated.sparkline.slice(0, 3), [1, 1, 1]);
  assert.equal(updated.annotations.length, 1);
  assert.equal(store.get(clip.id).cutCount, 3);
});

test("PUT analysis : v1 acceptée, durée différente ou analyse invalide = 400", async () => {
  const clip = seedClip();
  const ok = await api(`/api/clips/${clip.id}/analysis`, {
    method: "PUT",
    token: aliceToken,
    json: v1Analysis({ cuts: [10] }),
  });
  assert.equal(ok.status, 200);
  const { analysis } = await ok.json();
  assert.equal(analysis.version, 2);
  assert.deepEqual(analysis.transitions, [{ time: 10, kind: "cut" }]);

  const invalid = [
    [v1Analysis({ durationSec: 31 }), /la durée ne correspond pas/],
    [v2Analysis({ durationSec: 30, sensitivity: 9 }), /Analyse invalide/],
    [v2Analysis({ durationSec: 30, cuts: [3, 1] }), /Analyse invalide/],
    [[], /Analyse invalide/],
  ];
  for (const [json, pattern] of invalid) {
    await expectError(
      await api(`/api/clips/${clip.id}/analysis`, { method: "PUT", token: aliceToken, json }),
      400,
      pattern,
    );
  }
  assert.equal(store.get(clip.id).cutCount, 1);
});

test("PUT analysis : une analyse complète de plus de 100 ko est acceptée", async () => {
  const clip = seedClip({ durationSec: 120 });
  const times = Array.from({ length: 2000 }, (_, index) => index * 0.0599 + 0.000123456789);
  const analysis = v2Analysis({
    durationSec: 120,
    cuts: times,
    beats: times,
    transitions: times.map((time) => ({ time, kind: "fade" })),
    diffs: new Array(1300).fill(0.123),
  });
  assert.ok(JSON.stringify(analysis).length > 100 * 1024);
  const response = await api(`/api/clips/${clip.id}/analysis`, { method: "PUT", token: aliceToken, json: analysis });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).cutCount, 2000);
});

/* ---- Suppression ---- */

test("DELETE : vidéo et pellicule supprimées du disque", async () => {
  const clip = seedClip({ filmstrip: true, annotations: [{ time: 1, text: "x", authorId: ALICE }] });
  assert.equal(diskFiles().length, 2);
  const response = await api(`/api/clips/${clip.id}`, { method: "DELETE", token: aliceToken });
  assert.equal(response.status, 204);
  assert.deepEqual(diskFiles(), []);
  assert.equal(store.size, 0);
});

test("DELETE : pellicule déjà absente du disque = 500 explicite, métadonnée supprimée", async () => {
  const clip = seedClip({ filmstrip: true });
  fs.unlinkSync(path.join(UPLOADS, store.get(clip.id).filmstripStoredName));
  await expectError(await api(`/api/clips/${clip.id}`, { method: "DELETE", token: aliceToken }), 500, /fichier/);
  assert.equal(store.size, 0);
  assert.deepEqual(diskFiles(), []);
});

/* ---- Annotations ---- */

test("POST annotation : 201 ClipAnnotation, texte rogné, auteur renseigné", async () => {
  const clip = seedClip();
  const response = await api(`/api/clips/${clip.id}/annotations`, {
    method: "POST",
    token: aliceToken,
    json: { time: 30, text: "  Belle coupe  " },
  });
  assert.equal(response.status, 201);
  const annotation = await response.json();
  assert.deepEqual(Object.keys(annotation).sort(), ["authorId", "authorName", "createdAt", "id", "text", "time"]);
  assert.equal(annotation.text, "Belle coupe");
  assert.equal(annotation.time, 30);
  assert.equal(annotation.authorId, String(ALICE));
  assert.equal(annotation.authorName, "Alice");
  assert.equal(store.get(clip.id).annotations[0].id, annotation.id);
});

test("POST annotation hors contrat = 400", async () => {
  const clip = seedClip();
  const bodies = [
    [{ time: -0.1, text: "x" }, /temps/],
    [{ time: 30.1, text: "x" }, /temps/],
    [{ time: "3", text: "x" }, /temps/],
    [{ text: "x" }, /temps/],
    [{ time: 1, text: "" }, /texte/],
    [{ time: 1, text: "   " }, /texte/],
    [{ time: 1, text: "a".repeat(281) }, /texte/],
    [{ time: 1, text: 5 }, /texte/],
    [{ time: 1, text: "x", authorId: String(BOB) }, /champ inattendu/],
    [null, /Corps JSON/],
  ];
  for (const [json, pattern] of bodies) {
    await expectError(
      await api(`/api/clips/${clip.id}/annotations`, { method: "POST", token: aliceToken, json }),
      400,
      pattern,
    );
  }
  const ok = await api(`/api/clips/${clip.id}/annotations`, {
    method: "POST",
    token: aliceToken,
    json: { time: 0, text: "a".repeat(280) },
  });
  assert.equal(ok.status, 201);
  assert.equal(store.get(clip.id).annotations.length, 1);
});

test("POST annotation : 200 annotations maximum par clip", async () => {
  const annotations = Array.from({ length: 200 }, (_, index) => ({ time: index % 30, text: `n${index}`, authorId: ALICE }));
  const clip = seedClip({ annotations });
  await expectError(
    await api(`/api/clips/${clip.id}/annotations`, { method: "POST", token: aliceToken, json: { time: 1, text: "Une de trop" } }),
    400,
    /200/,
  );
  assert.equal(store.get(clip.id).annotations.length, 200);
});

test("DELETE annotation : le propriétaire retire celle d'un autre auteur ; inconnue = 404", async () => {
  const clip = seedClip({
    annotations: [
      { time: 1, text: "De Bob", authorId: BOB },
      { time: 2, text: "D'Alice", authorId: ALICE },
    ],
  });
  const [bobNote] = clip.annotations;
  const response = await api(`/api/clips/${clip.id}/annotations/${bobNote.id}`, { method: "DELETE", token: aliceToken });
  assert.equal(response.status, 204);
  assert.deepEqual(store.get(clip.id).annotations.map((annotation) => annotation.text), ["D'Alice"]);

  for (const id of [bobNote.id, String(new mongoose.Types.ObjectId()), "pas-un-id"]) {
    await expectError(
      await api(`/api/clips/${clip.id}/annotations/${id}`, { method: "DELETE", token: aliceToken }),
      404,
      /^Annotation inconnue$/,
    );
  }
});

test("Bob ne lit ni n'annote les clips privés d'Alice", async () => {
  const clip = seedClip();
  await expectError(await api(`/api/clips/${clip.id}`, { token: bobToken }), 404, /^Clip inconnu$/);
  const stats = await (await api("/api/clips/stats", { token: bobToken })).json();
  assert.equal(stats.clipCount, 0);
  assert.deepEqual(await (await api("/api/clips/tags", { token: bobToken })).json(), []);
});
