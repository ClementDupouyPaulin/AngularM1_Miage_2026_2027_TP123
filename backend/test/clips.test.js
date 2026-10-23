import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

// app.js résout data/uploads depuis le dossier courant : ces tests écrivent
// donc leurs fichiers dans un dossier temporaire, jamais dans backend/data.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "gpc-clips-"));
process.chdir(workDir);
const { createApp } = await import("../src/app.js");
const { Clip } = await import("../src/models/Clip.js");

mongoose.set("bufferCommands", false);

const UPLOADS = path.join(workDir, "data", "uploads");
const SECRET = process.env.JWT_SECRET || "tp1-development-secret";
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
const ALICE = new mongoose.Types.ObjectId();
const BOB = new mongoose.Types.ObjectId();
const aliceToken = jwt.sign({ sub: String(ALICE), email: "alice@example.com" }, SECRET);
const bobToken = jwt.sign({ sub: String(BOB), email: "bob@example.com" }, SECRET);

const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("ftypisom", "latin1"),
  Buffer.alloc(256, 3),
]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(256, 4)]);
const NOT_A_VIDEO = Buffer.from("<html>pas une vidéo</html>");

const validAnalysis = (overrides = {}) => ({
  version: 1,
  durationSec: 60,
  cuts: [2.5, 10, 31.2],
  beats: [0.5, 1, 1.5, 2],
  syncScore: 1.4,
  ...overrides,
});

/* ---- Simulation de MongoDB : les méthodes du modèle lisent une Map. ---- */

const store = new Map();
const pipelines = [];
let failCreate = false;

function fakeQuery(result) {
  return {
    select() {
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
  if (filter.ownerId !== undefined && String(doc.ownerId) !== String(filter.ownerId)) {
    return null;
  }
  return doc;
}

Clip.findOne = (filter) => fakeQuery(findInStore(filter));
Clip.findOneAndDelete = (filter) => {
  const doc = findInStore(filter);
  if (doc) store.delete(String(doc._id));
  return fakeQuery(doc);
};
Clip.create = async (data) => {
  if (failCreate) throw new Error("MongoDB indisponible (simulé)");
  const doc = new Clip(data);
  await doc.validate();
  store.set(String(doc._id), doc);
  return doc;
};

// Exécute le pipeline produit par mongoose-aggregate-paginate-v2 sur la Map,
// en appliquant aussi la projection pour vérifier ce qui sort de MongoDB.
mongoose.Aggregate.prototype.exec = async function exec() {
  const pipeline = this.pipeline();
  pipelines.push(pipeline);
  const match = pipeline.find((stage) => stage.$match)?.$match ?? {};
  const docsStages = pipeline.find((stage) => stage.$facet).$facet.docs;
  const project = [...pipeline, ...docsStages].find((stage) => stage.$project)?.$project ?? {};
  const skip = docsStages.find((stage) => "$skip" in stage).$skip;
  const limit = docsStages.find((stage) => "$limit" in stage).$limit;
  const regex = match.title ? new RegExp(match.title.$regex, match.title.$options) : null;
  const rows = [...store.values()]
    .filter((doc) => match.ownerId instanceof mongoose.Types.ObjectId && match.ownerId.equals(doc.ownerId))
    .filter((doc) => !regex || regex.test(doc.title))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((doc) => {
      const row = doc.toObject();
      for (const [key, value] of Object.entries(project)) if (value === 0) delete row[key];
      return row;
    });
  return [
    {
      docs: rows.slice(skip, skip + limit),
      count: rows.length ? [{ count: rows.length }] : [],
    },
  ];
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

function api(urlPath, { token, ...init } = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(base + urlPath, { ...init, headers });
}

function form(fields) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value === "string") data.append(name, value);
    else data.append(name, new Blob([value.bytes], { type: value.type }), value.name);
  }
  return data;
}

const videoFile = (bytes = MP4, type = "video/mp4", name = "extrait.mp4") => ({ bytes, type, name });

function uploadClip(
  { video = videoFile(), title = "Mon extrait", analysis = JSON.stringify(validAnalysis()) } = {},
  token = aliceToken,
) {
  const fields = {};
  if (title !== null) fields.title = title;
  if (analysis !== null) fields.analysis = analysis;
  if (video) fields.video = video;
  return api("/api/clips", { method: "POST", token, body: form(fields) });
}

const diskFiles = () => fs.readdirSync(UPLOADS).filter((name) => name !== "covers");

function seedClip({ owner = ALICE, title = "Clip", createdAt = new Date() } = {}) {
  const storedName = `${crypto.randomUUID()}.mp4`;
  fs.writeFileSync(path.join(UPLOADS, storedName), MP4);
  const doc = new Clip({
    ownerId: owner,
    title,
    originalName: "clip.mp4",
    storedName,
    mimeType: "video/mp4",
    size: MP4.length,
    durationSec: 30,
    cuts: [5, 15],
    beats: [1, 2],
    syncScore: null,
    cutCount: 2,
    avgShotLength: 10,
    createdAt,
  });
  store.set(String(doc._id), doc);
  return doc;
}

/* ---- Authentification ---- */

test("401 sans JWT sur chaque route des clips", async () => {
  const clip = seedClip();
  const routes = [
    ["GET", "/api/clips"],
    ["POST", "/api/clips"],
    ["GET", `/api/clips/${clip.id}`],
    ["GET", `/api/clips/${clip.id}/video`],
    ["DELETE", `/api/clips/${clip.id}`],
  ];
  for (const [method, url] of routes) {
    const response = await api(url, { method });
    assert.equal(response.status, 401, `${method} ${url}`);
  }
  assert.equal(store.size, 1);
});

/* ---- Upload ---- */

test("upload MP4 : 201, statistiques recalculées et nom disque masqué", async () => {
  const response = await uploadClip();
  assert.equal(response.status, 201);
  const clip = await response.json();
  assert.equal(clip.title, "Mon extrait");
  assert.equal(clip.mimeType, "video/mp4");
  assert.equal(clip.originalName, "extrait.mp4");
  assert.equal(clip.cutCount, 3);
  assert.equal(clip.avgShotLength, 15);
  assert.equal(clip.syncScore, 1.4);
  assert.deepEqual(clip.analysis, validAnalysis());
  assert.equal("storedName" in clip, false);
  assert.equal(JSON.stringify(clip).includes(store.get(clip.id).storedName), false);
  assert.equal(diskFiles().length, 1);
});

test("upload WebM sans titre ni coupe : nom d'origine en repli, ASL = durée", async () => {
  const response = await uploadClip({
    video: videoFile(WEBM, "video/webm", "film.webm"),
    title: null,
    analysis: JSON.stringify(validAnalysis({ cuts: [], syncScore: null })),
  });
  assert.equal(response.status, 201);
  const clip = await response.json();
  assert.equal(clip.title, "film.webm");
  assert.equal(clip.mimeType, "video/webm");
  assert.equal(clip.cutCount, 0);
  assert.equal(clip.avgShotLength, 60);
  assert.equal(clip.syncScore, null);
});

test("upload sans vidéo = 400", async () => {
  const response = await uploadClip({ video: null });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).message, "Fichier vidéo requis");
  assert.equal(store.size, 0);
});

test("upload d'un type MIME refusé = 400 sans fichier résiduel", async () => {
  const response = await uploadClip({ video: videoFile(MP4, "video/quicktime", "a.mov") });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /Format vidéo non accepté/);
  assert.deepEqual(diskFiles(), []);
});

test("upload dont les octets ne correspondent pas au type déclaré = 400 et disque nettoyé", async () => {
  for (const video of [
    videoFile(NOT_A_VIDEO, "video/mp4"),
    videoFile(WEBM, "video/mp4"),
    videoFile(MP4, "video/webm", "a.webm"),
  ]) {
    const response = await uploadClip({ video });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /Fichier vidéo invalide/);
  }
  assert.deepEqual(diskFiles(), []);
  assert.equal(store.size, 0);
});

test("upload d'une vidéo de plus de 50 Mo = 400 sans fichier résiduel", async () => {
  const big = Buffer.concat([MP4, Buffer.alloc(MAX_VIDEO_SIZE)]);
  const response = await uploadClip({ video: videoFile(big) });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).message, "Vidéo trop volumineuse (50 Mo maximum)");
  assert.deepEqual(diskFiles(), []);
});

test("analyse absente ou hors contrat = 400 et vidéo supprimée du disque", async () => {
  const tooMany = Array.from({ length: 2001 }, (_, index) => index * 0.01);
  const invalid = [
    null,
    "",
    "{pas du json",
    "[]",
    "null",
    JSON.stringify(validAnalysis({ version: 2 })),
    JSON.stringify(validAnalysis({ durationSec: 121 })),
    JSON.stringify(validAnalysis({ durationSec: 0 })),
    JSON.stringify(validAnalysis({ durationSec: "60" })),
    JSON.stringify(validAnalysis({ cuts: [10, 5] })),
    JSON.stringify(validAnalysis({ cuts: [61] })),
    JSON.stringify(validAnalysis({ cuts: [-1] })),
    JSON.stringify(validAnalysis({ cuts: ["1"] })),
    JSON.stringify(validAnalysis({ cuts: [null] })),
    JSON.stringify(validAnalysis({ beats: "1,2" })),
    JSON.stringify(validAnalysis({ durationSec: 30, beats: tooMany })),
    JSON.stringify(validAnalysis({ syncScore: 11 })),
    JSON.stringify(validAnalysis({ syncScore: -1 })),
    JSON.stringify(validAnalysis({ syncScore: "1" })),
    JSON.stringify(validAnalysis({ cutCount: 999 })),
  ];
  for (const analysis of invalid) {
    const response = await uploadClip({ analysis });
    assert.equal(response.status, 400, String(analysis).slice(0, 60));
    assert.match((await response.json()).message, /Analyse/);
  }
  assert.deepEqual(diskFiles(), []);
  assert.equal(store.size, 0);
});

test("échec MongoDB après l'upload : vidéo supprimée du disque", async () => {
  failCreate = true;
  const response = await uploadClip();
  assert.equal(response.status, 500);
  assert.deepEqual(diskFiles(), []);
});

/* ---- Liste ---- */

test("liste paginée : résumés sans cuts/beats, ownerId casté, clips d'autrui exclus", async () => {
  for (let index = 0; index < 3; index += 1) {
    seedClip({ title: `Clip ${index}`, createdAt: new Date(2026, 0, index + 1) });
  }
  seedClip({ owner: BOB, title: "Clip de Bob" });

  const response = await api("/api/clips?page=2&limit=2", { token: aliceToken });
  assert.equal(response.status, 200);
  const page = await response.json();
  assert.equal(page.total, 3);
  assert.equal(page.pages, 2);
  assert.equal(page.page, 2);
  assert.equal(page.hasPrevPage, true);
  assert.equal(page.hasNextPage, false);
  assert.deepEqual(
    page.items.map((item) => item.title),
    ["Clip 0"],
  );
  assert.deepEqual(Object.keys(page.items[0]).sort(), [
    "avgShotLength",
    "createdAt",
    "cutCount",
    "durationSec",
    "id",
    "mimeType",
    "originalName",
    "size",
    "syncScore",
    "title",
  ]);
  assert.match(JSON.stringify(pipelines[0]), /"\$project":\{"storedName":0,"cuts":0,"beats":0\}/);
});

test("filtre q : sous-chaîne insensible à la casse, regex échappée", async () => {
  seedClip({ title: "Poursuite (final)" });
  seedClip({ title: "Dialogue" });

  const found = await (await api("/api/clips?q=POURSUITE%20(", { token: aliceToken })).json();
  assert.deepEqual(found.items.map((item) => item.title), ["Poursuite (final)"]);

  const none = await (await api("/api/clips?q=.*", { token: aliceToken })).json();
  assert.equal(none.total, 0);
});

test("filtre q de plus de 100 caractères = 400", async () => {
  const response = await api(`/api/clips?q=${"a".repeat(101)}`, { token: aliceToken });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).message, "Recherche limitée à 100 caractères");
});

/* ---- Détail, vidéo, suppression ---- */

test("détail : analyse renvoyée au propriétaire", async () => {
  const seeded = seedClip();
  const response = await api(`/api/clips/${seeded.id}`, { token: aliceToken });
  assert.equal(response.status, 200);
  const clip = await response.json();
  assert.equal(clip.id, seeded.id);
  assert.deepEqual(clip.analysis, {
    version: 1,
    durationSec: 30,
    cuts: [5, 15],
    beats: [1, 2],
    syncScore: null,
  });
  assert.equal("storedName" in clip, false);
});

test("clip d'autrui ou inexistant = 404 « Clip inconnu » sur détail, vidéo et suppression", async () => {
  const clip = seedClip({ owner: BOB });
  const ids = [clip.id, String(new mongoose.Types.ObjectId()), "pas-un-id"];
  for (const id of ids) {
    for (const [method, url] of [
      ["GET", `/api/clips/${id}`],
      ["GET", `/api/clips/${id}/video`],
      ["DELETE", `/api/clips/${id}`],
    ]) {
      const response = await api(url, { method, token: aliceToken });
      assert.equal(response.status, 404, `${method} ${url}`);
      assert.equal((await response.json()).message, "Clip inconnu");
    }
  }
  assert.equal(store.size, 1);
  assert.equal(diskFiles().length, 1);
});

test("vidéo : octets envoyés avec le type enregistré et nosniff", async () => {
  const clip = seedClip();
  const response = await api(`/api/clips/${clip.id}/video`, { token: aliceToken });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), MP4);
});

test("suppression : 204, métadonnée et fichier supprimés, puis 404", async () => {
  const clip = seedClip();
  const response = await api(`/api/clips/${clip.id}`, { method: "DELETE", token: aliceToken });
  assert.equal(response.status, 204);
  assert.equal(store.size, 0);
  assert.deepEqual(diskFiles(), []);

  const again = await api(`/api/clips/${clip.id}`, { token: aliceToken });
  assert.equal(again.status, 404);
});

test("les clips de Bob ne sont pas visibles par Alice et inversement", async () => {
  seedClip({ owner: ALICE, title: "A" });
  const response = await api("/api/clips", { token: bobToken });
  assert.equal((await response.json()).total, 0);
});
