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
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "gpc-tracks-"));
process.chdir(workDir);
const { createApp } = await import("../src/app.js");
const { Track } = await import("../src/models/Track.js");

// Sans MongoDB, une requête non simulée échoue immédiatement au lieu d'attendre.
mongoose.set("bufferCommands", false);

const UPLOADS = path.join(workDir, "data", "uploads");
const COVERS = path.join(UPLOADS, "covers");
const SECRET = process.env.JWT_SECRET || "tp1-development-secret";
const MAX_COVER_SIZE = 2 * 1024 * 1024;
const ALICE = new mongoose.Types.ObjectId();
const BOB = new mongoose.Types.ObjectId();
const aliceToken = jwt.sign({ sub: String(ALICE), email: "alice@example.com" }, SECRET);
const bobToken = jwt.sign({ sub: String(BOB), email: "bob@example.com" }, SECRET);

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);
const NOT_AN_IMAGE = Buffer.from("<svg onload=alert(1)>pas une image</svg>");
const MP3 = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(256)]);
const CORRUPT_ID3 = Buffer.from([
  0x49, 0x44, 0x33, 3, 0, 0, 0x00, 0x00, 0x27, 0x08, 0x54, 0x49, 0x54, 0x32, 0xff, 0xff,
]);
const MZSTATIC_URL = "https://is1-ssl.mzstatic.com/image/thumb/a/600x600bb.png";

/** Construit un MP3 minimal portant des tags ID3v2.3 (titre, artiste, album, image). */
function mp3WithId3({ title = "Titre ID3", artist = "Artiste", album = "Album" } = {}) {
  const frame = (id, body) => {
    const header = Buffer.alloc(10);
    header.write(id, 0, "latin1");
    header.writeUInt32BE(body.length, 4);
    return Buffer.concat([header, body]);
  };
  const text = (id, value) => frame(id, Buffer.from(`\0${value}`, "latin1"));
  const picture = frame(
    "APIC",
    Buffer.concat([Buffer.from("\0image/png\0\x03\0", "latin1"), PNG]),
  );
  const frames = Buffer.concat([
    text("TIT2", title),
    text("TPE1", artist),
    text("TALB", album),
    picture,
  ]);
  const size = frames.length;
  const syncsafe = Buffer.from([
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
  ]);
  return Buffer.concat([Buffer.from("ID3"), Buffer.from([3, 0, 0]), syncsafe, frames, MP3]);
}

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

/** Applique le filtre comme MongoDB : seuls les critères présents sont vérifiés. */
function findInStore(filter) {
  const doc = store.get(String(filter._id));
  if (!doc) return null;
  if (filter.ownerId !== undefined && String(doc.ownerId) !== String(filter.ownerId)) {
    return null;
  }
  return doc;
}

Track.findOne = (filter) => fakeQuery(findInStore(filter));
Track.findOneAndDelete = (filter) => {
  const doc = findInStore(filter);
  if (doc) store.delete(String(doc._id));
  return fakeQuery(doc);
};
Track.create = async (data) => {
  if (failCreate) throw new Error("MongoDB indisponible (simulé)");
  const doc = new Track(data);
  await doc.validate();
  store.set(String(doc._id), doc);
  return doc;
};
Track.prototype.save = async function save() {
  await this.validate();
  store.set(String(this._id), this);
  return this;
};

// Exécute le pipeline produit par mongoose-aggregate-paginate-v2 sur la Map.
// Comme MongoDB, un ownerId resté chaîne ne correspond à aucun ObjectId.
mongoose.Aggregate.prototype.exec = async function exec() {
  const pipeline = this.pipeline();
  pipelines.push(pipeline);
  const match = pipeline.find((stage) => stage.$match)?.$match ?? {};
  const docsStages = pipeline.find((stage) => stage.$facet).$facet.docs;
  const skip = docsStages.find((stage) => "$skip" in stage).$skip;
  const limit = docsStages.find((stage) => "$limit" in stage).$limit;
  const regex = match.title ? new RegExp(match.title.$regex, match.title.$options) : null;
  const rows = [...store.values()]
    .filter((doc) => match.ownerId instanceof mongoose.Types.ObjectId && match.ownerId.equals(doc.ownerId))
    .filter((doc) => !regex || regex.test(doc.title))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((doc) => doc.toObject());
  return [
    {
      docs: rows.slice(skip, skip + limit),
      count: rows.length ? [{ count: rows.length }] : [],
    },
  ];
};

/* ---- Simulation du réseau sortant (iTunes, mzstatic). ---- */

const realFetch = globalThis.fetch;
const remoteCalls = [];
const noRemoteCall = () => {
  throw new Error("Aucun appel réseau sortant attendu");
};
let remote = noRemoteCall;
globalThis.fetch = async (input, init) => {
  remoteCalls.push({ url: String(input), init });
  return remote(String(input), init);
};

let server, base;

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  globalThis.fetch = realFetch;
  fs.rmSync(workDir, { recursive: true, force: true });
});

test.beforeEach(() => {
  store.clear();
  pipelines.length = 0;
  remoteCalls.length = 0;
  remote = noRemoteCall;
  failCreate = false;
  for (const dir of [UPLOADS, COVERS]) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile()) fs.rmSync(path.join(dir, entry.name));
    }
  }
});

/* ---- Utilitaires ---- */

function api(urlPath, { token, ...init } = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return realFetch(base + urlPath, { ...init, headers });
}

function postJson(urlPath, body, token) {
  return api(urlPath, {
    method: "POST",
    token,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function form(fields) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value === "string") data.append(name, value);
    else data.append(name, new Blob([value.bytes], { type: value.type }), value.name);
  }
  return data;
}

function uploadTrack(fields, token = aliceToken) {
  return api("/api/tracks", { method: "POST", token, body: form(fields) });
}

function putCover(id, cover, token = aliceToken) {
  return api(`/api/tracks/${id}/cover`, { method: "PUT", token, body: form({ cover }) });
}

function diskState() {
  return {
    audio: fs.readdirSync(UPLOADS).filter((name) => name !== "covers"),
    covers: fs.readdirSync(COVERS),
  };
}

function seedTrack({ owner = ALICE, title = "Piste", createdAt = new Date(), artist, cover = false } = {}) {
  const storedName = `${crypto.randomUUID()}.mp3`;
  fs.writeFileSync(path.join(UPLOADS, storedName), MP3);
  const doc = new Track({
    ownerId: owner,
    title,
    originalName: "piste.mp3",
    storedName,
    mimeType: "audio/mpeg",
    size: MP3.length,
    artist,
    createdAt,
  });
  if (cover) {
    const coverName = `${crypto.randomUUID()}.png`;
    fs.writeFileSync(path.join(COVERS, coverName), PNG);
    doc.coverStoredName = coverName;
    doc.coverMimeType = "image/png";
    doc.coverSource = "upload";
  }
  store.set(String(doc._id), doc);
  return doc;
}

const audioFile = (bytes = MP3, type = "audio/mpeg") => ({ bytes, type, name: "son.mp3" });

/* ---- Authentification ---- */

test("401 sans JWT sur la liste des pistes", async () => {
  const response = await api("/api/tracks");
  assert.equal(response.status, 401);
  assert.equal((await response.json()).message, "Authentification requise");
});

test("401 avec un JWT invalide ou signé par un autre secret", async () => {
  for (const token of ["abc.def.ghi", jwt.sign({ sub: String(ALICE) }, "autre-secret")]) {
    const response = await api("/api/tracks", { token });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).message, "Jeton invalide ou expiré");
  }
});

test("401 sur chaque nouvelle route de pochette sans JWT", async () => {
  const track = seedTrack({ cover: true });
  const routes = [
    ["GET", `/api/tracks/${track.id}/cover`],
    ["PUT", `/api/tracks/${track.id}/cover`],
    ["DELETE", `/api/tracks/${track.id}/cover`],
    ["GET", `/api/tracks/${track.id}/cover/search`],
    ["POST", `/api/tracks/${track.id}/cover/web`],
  ];
  for (const [method, url] of routes) {
    const response = await api(url, { method });
    assert.equal(response.status, 401, `${method} ${url}`);
  }
  assert.equal(remoteCalls.length, 0);
});

/* ---- Upload ---- */

test("upload sans fichier audio = 400", async () => {
  const response = await uploadTrack({ title: "Sans fichier" });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).message, "Fichier audio requis");
  assert.equal(store.size, 0);
});

test("upload d'un type MIME refusé = 400 sans fichier résiduel", async () => {
  const response = await uploadTrack({ audio: audioFile(MP3, "text/plain") });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).message, "Format audio non accepté");
  assert.deepEqual(diskState(), { audio: [], covers: [] });
});

test("upload : tags ID3 extraits (artiste, album, pochette) et noms disque masqués", async () => {
  const response = await uploadTrack({ title: "Mon titre", audio: audioFile(mp3WithId3()) });
  assert.equal(response.status, 201);
  const track = await response.json();
  assert.equal(track.title, "Mon titre");
  assert.equal(track.artist, "Artiste");
  assert.equal(track.album, "Album");
  assert.equal(track.hasCover, true);
  assert.equal(track.coverSource, "id3");
  assert.equal("storedName" in track, false);
  assert.equal("coverStoredName" in track, false);
  assert.equal(diskState().covers.length, 1);

  const cover = await api(`/api/tracks/${track.id}/cover`, { token: aliceToken });
  assert.equal(cover.status, 200);
  assert.equal(cover.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await cover.arrayBuffer()), PNG);
});

test("upload sans titre : le titre ID3 sert de repli", async () => {
  const response = await uploadTrack({ audio: audioFile(mp3WithId3({ title: "Repli ID3" })) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).title, "Repli ID3");
});

test("tags ID3 illisibles : l'upload réussit quand même", async () => {
  const response = await uploadTrack({ audio: audioFile(CORRUPT_ID3) });
  assert.equal(response.status, 201);
  const track = await response.json();
  assert.equal(track.title, "son.mp3");
  assert.equal(track.artist, null);
  assert.equal(track.album, null);
  assert.equal(track.hasCover, false);
  assert.equal(track.coverSource, null);
  assert.deepEqual(diskState().covers, []);
});

test("pochette fournie à l'upload : prioritaire sur l'image ID3", async () => {
  const response = await uploadTrack({
    audio: audioFile(mp3WithId3()),
    cover: { bytes: JPEG, type: "image/jpeg", name: "c.jpg" },
  });
  assert.equal(response.status, 201);
  const track = await response.json();
  assert.equal(track.coverSource, "upload");
  assert.equal(track.artist, "Artiste");
  assert.deepEqual(diskState().covers.length, 1);
  const cover = await api(`/api/tracks/${track.id}/cover`, { token: aliceToken });
  assert.equal(cover.headers.get("content-type"), "image/jpeg");
});

test("pochette à l'upload dont le Content-Type ment : 400 et disque nettoyé", async () => {
  const response = await uploadTrack({
    audio: audioFile(),
    cover: { bytes: NOT_AN_IMAGE, type: "image/png", name: "c.png" },
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /image/i);
  assert.equal(store.size, 0);
  assert.deepEqual(diskState(), { audio: [], covers: [] });
});

test("pochette à l'upload trop lourde : 400 et disque nettoyé", async () => {
  const heavy = Buffer.concat([PNG, Buffer.alloc(MAX_COVER_SIZE)]);
  const response = await uploadTrack({
    audio: audioFile(),
    cover: { bytes: heavy, type: "image/png", name: "c.png" },
  });
  assert.equal(response.status, 400);
  assert.equal(store.size, 0);
  assert.deepEqual(diskState(), { audio: [], covers: [] });
});

test("échec MongoDB après l'upload : audio et pochette supprimés du disque", async () => {
  failCreate = true;
  const response = await uploadTrack({ audio: audioFile(mp3WithId3()) });
  assert.equal(response.status, 500);
  assert.deepEqual(diskState(), { audio: [], covers: [] });
});

/* ---- Liste paginée et filtre ---- */

test("pagination page + limit avec les champs ajoutés et ownerId casté", async () => {
  for (let index = 1; index <= 11; index += 1) {
    seedTrack({ title: `Piste ${index}`, createdAt: new Date(2026, 0, index) });
  }
  seedTrack({ owner: BOB, title: "Piste de Bob" });

  const response = await api("/api/tracks?page=2&limit=5", { token: aliceToken });
  assert.equal(response.status, 200);
  const page = await response.json();
  assert.deepEqual(
    page.items.map((item) => item.title),
    ["Piste 6", "Piste 5", "Piste 4", "Piste 3", "Piste 2"],
  );
  assert.deepEqual(
    { ...page, items: undefined },
    {
      items: undefined,
      page: 2,
      limit: 5,
      total: 11,
      pages: 3,
      hasPrevPage: true,
      hasNextPage: true,
      prevPage: 1,
      nextPage: 3,
    },
  );
  const item = page.items[0];
  assert.equal(typeof item.id, "string");
  assert.equal(item.ownerId, String(ALICE));
  assert.equal(item.artist, null);
  assert.equal(item.hasCover, false);
  assert.equal("storedName" in item, false);
  assert.equal("_id" in item, false);

  const [pipeline] = pipelines;
  const match = pipeline.find((stage) => stage.$match).$match;
  assert.ok(match.ownerId instanceof mongoose.Types.ObjectId);
  assert.ok(match.ownerId.equals(ALICE));
  assert.ok(
    pipeline.find((stage) => stage.$facet).$facet.docs.some(
      (stage) => stage.$sort?.createdAt === -1,
    ),
  );

  const last = await (await api("/api/tracks?page=3&limit=5", { token: aliceToken })).json();
  assert.equal(last.items.length, 1);
  assert.equal(last.hasNextPage, false);
  assert.equal(last.nextPage, null);

  const outside = await api("/api/tracks?page=9&limit=5", { token: aliceToken });
  assert.equal(outside.status, 200);
  assert.deepEqual((await outside.json()).items, []);
});

test("filtre q : sous-chaîne du titre, insensible à la casse, regex échappée", async () => {
  for (const title of ["Blues du matin", "BLUES nuit", "Jazz", "a.c", "abc"]) {
    seedTrack({ title });
  }
  seedTrack({ owner: BOB, title: "Blues de Bob" });
  const titles = async (q) => {
    const response = await api(`/api/tracks?limit=20&q=${encodeURIComponent(q)}`, {
      token: aliceToken,
    });
    assert.equal(response.status, 200);
    return (await response.json()).items.map((item) => item.title).sort();
  };

  assert.deepEqual(await titles("blues"), ["BLUES nuit", "Blues du matin"]);
  assert.deepEqual(await titles("  a.c  "), ["a.c"]);
  assert.deepEqual(await titles(".*"), []);
  assert.deepEqual(await titles("(a+)+$"), []);
  assert.equal((await titles("   ")).length, 5);
  const escaped = pipelines[1].find((stage) => stage.$match).$match.title;
  assert.deepEqual(escaped, { $regex: "a\\.c", $options: "i" });
});

test("filtre q de plus de 100 caractères = 400", async () => {
  const tooLong = await api(`/api/tracks?q=${"x".repeat(101)}`, { token: aliceToken });
  assert.equal(tooLong.status, 400);
  assert.equal(typeof (await tooLong.json()).message, "string");
  const maximum = await api(`/api/tracks?q=${"x".repeat(100)}`, { token: aliceToken });
  assert.equal(maximum.status, 200);
});

/* ---- Propriété des pistes ---- */

test("piste d'autrui : lecture audio et suppression = 404", async () => {
  const track = seedTrack({ owner: BOB });
  const audio = await api(`/api/tracks/${track.id}/audio`, { token: aliceToken });
  assert.equal(audio.status, 404);
  assert.equal((await audio.json()).message, "Piste inconnue");
  const removal = await api(`/api/tracks/${track.id}`, { method: "DELETE", token: aliceToken });
  assert.equal(removal.status, 404);
  assert.ok(store.has(track.id));
  assert.equal(diskState().audio.length, 1);

  const own = await api(`/api/tracks/${track.id}/audio`, { token: bobToken });
  assert.equal(own.status, 200);
});

test("pochette d'autrui = 404 sur toutes les routes de pochette", async () => {
  const track = seedTrack({ owner: BOB, cover: true });
  const before = diskState();
  const responses = [
    await api(`/api/tracks/${track.id}/cover`, { token: aliceToken }),
    await putCover(track.id, { bytes: PNG, type: "image/png", name: "c.png" }),
    await api(`/api/tracks/${track.id}/cover`, { method: "DELETE", token: aliceToken }),
    await api(`/api/tracks/${track.id}/cover/search`, { token: aliceToken }),
    await postJson(`/api/tracks/${track.id}/cover/web`, { imageUrl: MZSTATIC_URL }, aliceToken),
  ];
  for (const response of responses) {
    assert.equal(response.status, 404, response.url);
    assert.equal((await response.json()).message, "Piste inconnue");
  }
  assert.deepEqual(diskState(), before);
  assert.equal(store.get(track.id).coverSource, "upload");
  assert.equal(remoteCalls.length, 0);
});

test("identifiant de piste invalide = 404 sur une route de pochette", async () => {
  const response = await api("/api/tracks/pas-un-id/cover", { token: aliceToken });
  assert.equal(response.status, 404);
});

/* ---- Pochette : lecture, remplacement, suppression ---- */

test("GET pochette absente = 404", async () => {
  const track = seedTrack();
  const response = await api(`/api/tracks/${track.id}/cover`, { token: aliceToken });
  assert.equal(response.status, 404);
  assert.equal(typeof (await response.json()).message, "string");
});

test("PUT pochette : remplace l'image et supprime l'ancien fichier", async () => {
  const track = seedTrack({ cover: true });
  const oldCover = track.coverStoredName;
  const response = await putCover(track.id, { bytes: JPEG, type: "image/jpeg", name: "c.jpg" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.coverSource, "upload");
  assert.equal(body.hasCover, true);
  const { covers } = diskState();
  assert.equal(covers.length, 1);
  assert.notEqual(covers[0], oldCover);
  const cover = await api(`/api/tracks/${track.id}/cover`, { token: aliceToken });
  assert.equal(cover.headers.get("content-type"), "image/jpeg");
  assert.equal(cover.headers.get("x-content-type-options"), "nosniff");
});

test("PUT pochette dont le Content-Type ment = 400, ancienne pochette conservée", async () => {
  const track = seedTrack({ cover: true });
  const before = diskState();
  const response = await putCover(track.id, { bytes: NOT_AN_IMAGE, type: "image/png", name: "c.png" });
  assert.equal(response.status, 400);
  assert.deepEqual(diskState(), before);
  assert.equal(store.get(track.id).coverStoredName, track.coverStoredName);
});

test("PUT pochette trop lourde = 400 sans fichier écrit", async () => {
  const track = seedTrack();
  const heavy = Buffer.concat([PNG, Buffer.alloc(MAX_COVER_SIZE)]);
  const response = await putCover(track.id, { bytes: heavy, type: "image/png", name: "c.png" });
  assert.equal(response.status, 400);
  assert.equal(typeof (await response.json()).message, "string");
  assert.deepEqual(diskState().covers, []);
});

test("PUT pochette sans fichier = 400", async () => {
  const track = seedTrack();
  const response = await api(`/api/tracks/${track.id}/cover`, {
    method: "PUT",
    token: aliceToken,
    body: form({ title: "rien" }),
  });
  assert.equal(response.status, 400);
});

test("DELETE pochette : 204, fichier supprimé, puis GET = 404", async () => {
  const track = seedTrack({ cover: true });
  const response = await api(`/api/tracks/${track.id}/cover`, { method: "DELETE", token: aliceToken });
  assert.equal(response.status, 204);
  assert.deepEqual(diskState().covers, []);
  assert.equal(store.get(track.id).toPublic().hasCover, false);
  const cover = await api(`/api/tracks/${track.id}/cover`, { token: aliceToken });
  assert.equal(cover.status, 404);
});

test("DELETE piste : supprime aussi le fichier de pochette", async () => {
  const track = seedTrack({ cover: true });
  const response = await api(`/api/tracks/${track.id}`, { method: "DELETE", token: aliceToken });
  assert.equal(response.status, 204);
  assert.deepEqual(diskState(), { audio: [], covers: [] });
});

/* ---- Recherche iTunes ---- */

test("recherche de pochette : requête iTunes construite côté serveur", async () => {
  const track = seedTrack({ title: "One More Time", artist: "Daft Punk" });
  remote = () =>
    Response.json({
      results: [
        {
          trackId: 42,
          trackName: "One More Time",
          artistName: "Daft Punk",
          collectionName: "Discovery",
          artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg",
        },
        {
          trackId: 43,
          trackName: "Piège",
          artistName: "X",
          collectionName: "Y",
          artworkUrl100: "https://evil.example.com/100x100bb.jpg",
        },
      ],
    });
  const response = await api(`/api/tracks/${track.id}/cover/search`, { token: aliceToken });
  assert.equal(response.status, 200);
  const body = await response.json();

  const called = new URL(remoteCalls[0].url);
  assert.equal(called.origin, "https://itunes.apple.com");
  assert.equal(called.pathname, "/search");
  assert.equal(called.searchParams.get("term"), "Daft Punk One More Time");
  assert.equal(body.query, "Daft Punk One More Time");
  assert.equal(typeof body.source, "string");
  assert.ok(body.attribution.length > 0);
  assert.equal(body.results.length, 1);
  const [candidate] = body.results;
  assert.deepEqual(Object.keys(candidate).sort(), ["album", "artist", "id", "imageUrl", "title"]);
  assert.equal(candidate.id, "42");
  assert.equal(candidate.album, "Discovery");
  assert.equal(new URL(candidate.imageUrl).protocol, "https:");
  assert.match(new URL(candidate.imageUrl).hostname, /\.mzstatic\.com$/);
});

test("recherche de pochette : service iTunes en échec = erreur JSON", async () => {
  const track = seedTrack();
  remote = () => new Response("indisponible", { status: 503 });
  const response = await api(`/api/tracks/${track.id}/cover/search`, { token: aliceToken });
  assert.equal(response.status, 502);
  assert.equal(typeof (await response.json()).message, "string");
});

/* ---- Pochette Web (anti-SSRF) ---- */

test("pochette Web : image mzstatic téléchargée et enregistrée", async () => {
  const track = seedTrack({ cover: true });
  const oldCover = track.coverStoredName;
  remote = () => new Response(PNG, { headers: { "Content-Type": "image/png" } });
  const response = await postJson(`/api/tracks/${track.id}/cover/web`, { imageUrl: MZSTATIC_URL }, aliceToken);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.coverSource, "web");
  assert.equal(body.hasCover, true);
  assert.equal(remoteCalls.length, 1);
  assert.equal(remoteCalls[0].url, MZSTATIC_URL);
  assert.equal(remoteCalls[0].init.redirect, "manual");
  assert.ok(remoteCalls[0].init.signal instanceof AbortSignal);
  const { covers } = diskState();
  assert.equal(covers.length, 1);
  assert.notEqual(covers[0], oldCover);
});

test("pochette Web : URL hors liste blanche ou non https = 400 sans appel réseau", async () => {
  const track = seedTrack();
  const refused = [
    "http://is1-ssl.mzstatic.com/a.png",
    "https://evil.example.com/a.png",
    "https://mzstatic.com.evil.example/a.png",
    "https://evilmzstatic.com/a.png",
    "https://is1-ssl.mzstatic.com:8443/a.png",
    "https://user:pass@is1-ssl.mzstatic.com/a.png",
    "https://127.0.0.1/a.png",
    "file:///etc/passwd",
    "pas une url",
    42,
    undefined,
  ];
  for (const imageUrl of refused) {
    const response = await postJson(`/api/tracks/${track.id}/cover/web`, { imageUrl }, aliceToken);
    assert.equal(response.status, 400, String(imageUrl));
    assert.equal(typeof (await response.json()).message, "string");
  }
  assert.equal(remoteCalls.length, 0);
  assert.deepEqual(diskState().covers, []);
});

test("pochette Web : redirection vers un autre hôte = 400", async () => {
  const track = seedTrack();
  remote = () =>
    new Response(null, {
      status: 302,
      headers: { Location: "http://169.254.169.254/latest/meta-data" },
    });
  const response = await postJson(`/api/tracks/${track.id}/cover/web`, { imageUrl: MZSTATIC_URL }, aliceToken);
  assert.equal(response.status, 400);
  assert.equal(remoteCalls.length, 1);
  assert.deepEqual(diskState().covers, []);
});

test("pochette Web : contenu non image ou trop lourd = 400", async () => {
  const track = seedTrack();
  const bodies = [NOT_AN_IMAGE, Buffer.concat([PNG, Buffer.alloc(MAX_COVER_SIZE)])];
  for (const bytes of bodies) {
    remote = () => new Response(bytes, { headers: { "Content-Type": "image/png" } });
    const response = await postJson(`/api/tracks/${track.id}/cover/web`, { imageUrl: MZSTATIC_URL }, aliceToken);
    assert.equal(response.status, 400);
  }
  assert.deepEqual(diskState().covers, []);
  assert.equal(store.get(track.id).coverSource, undefined);
});
