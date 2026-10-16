import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

/*
 * Relecture indépendante des bonus (surface d'attaque ajoutée). Ces tests
 * complètent tracks.test.js sans le dupliquer : ils visent les angles que
 * celui-ci ne couvre pas (chaîne de redirections, plafond en flux, valeurs
 * de pagination aberrantes, nettoyage disque des chemins d'erreur multer,
 * identifiants non ObjectId sur les routes historiques, fuite de JWT en log).
 * MongoDB est simulé ; Track.findOne réel n'est conservé que pour les
 * identifiants invalides afin d'exercer le vrai cast Mongoose.
 */

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "gpc-secu-"));
process.chdir(workDir);
const { createApp } = await import("../src/app.js");
const { Track } = await import("../src/models/Track.js");
mongoose.set("bufferCommands", false);

const DATA = path.join(workDir, "data");
const UPLOADS = path.join(DATA, "uploads");
const COVERS = path.join(UPLOADS, "covers");
const SECRET = process.env.JWT_SECRET || "tp1-development-secret";
const MAX_COVER_SIZE = 2 * 1024 * 1024;
const ALICE = new mongoose.Types.ObjectId();
const BOB = new mongoose.Types.ObjectId();
const aliceToken = jwt.sign({ sub: String(ALICE), email: "alice@example.com" }, SECRET);
const MZ = "https://is1-ssl.mzstatic.com/image/thumb/a/600x600bb.png";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);
const MP3 = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(256)]);

/** MP3 dont l'image ID3 (APIC) dépasse la limite des pochettes (2 Mo). */
function mp3WithHugePicture() {
  const frame = (id, body) => {
    const header = Buffer.alloc(10);
    header.write(id, 0, "latin1");
    header.writeUInt32BE(body.length, 4);
    return Buffer.concat([header, body]);
  };
  const picture = Buffer.concat([
    Buffer.from("\0image/png\0\x03\0", "latin1"),
    PNG,
    Buffer.alloc(MAX_COVER_SIZE + 1024, 7),
  ]);
  const frames = Buffer.concat([
    frame("TIT2", Buffer.from("\0Gros titre", "latin1")),
    frame("TPE1", Buffer.from("\0Gros artiste", "latin1")),
    frame("APIC", picture),
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

/* ---- Simulation de MongoDB ---- */

const store = new Map();
const pipelines = [];
const realFindOne = Track.findOne.bind(Track);
const realFindOneAndDelete = Track.findOneAndDelete.bind(Track);

const fakeQuery = (result) => ({
  select() {
    return this;
  },
  then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
});
const findInStore = (filter) => {
  const doc = store.get(String(filter._id));
  return doc && String(doc.ownerId) === String(filter.ownerId) ? doc : null;
};
// Identifiant invalide : on laisse le vrai Mongoose caster (donc lever CastError).
Track.findOne = (filter) =>
  mongoose.isValidObjectId(filter._id) ? fakeQuery(findInStore(filter)) : realFindOne(filter);
Track.findOneAndDelete = (filter) => {
  if (!mongoose.isValidObjectId(filter._id)) return realFindOneAndDelete(filter);
  const doc = findInStore(filter);
  if (doc) store.delete(String(doc._id));
  return fakeQuery(doc);
};
Track.create = async (data) => {
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
let failAggregate = false;
mongoose.Aggregate.prototype.exec = async function exec() {
  if (failAggregate) throw new Error(`panne interne simulée dans ${workDir}`);
  pipelines.push(this.pipeline());
  return [{ docs: [], count: [] }];
};

/* ---- Simulation du réseau sortant ---- */

const realFetch = globalThis.fetch;
const remoteCalls = [];
let remote = () => {
  throw new Error("Aucun appel réseau sortant attendu");
};
globalThis.fetch = async (input, init) => {
  remoteCalls.push({ url: String(input), init });
  return remote(String(input), init, remoteCalls.length);
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
  failAggregate = false;
  remote = () => {
    throw new Error("Aucun appel réseau sortant attendu");
  };
  for (const dir of [UPLOADS, COVERS]) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile()) fs.rmSync(path.join(dir, entry.name));
    }
  }
});

/* ---- Utilitaires ---- */

const api = (urlPath, { token = aliceToken, ...init } = {}) => {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return realFetch(base + urlPath, { ...init, headers });
};
const postWeb = (id, imageUrl) =>
  api(`/api/tracks/${id}/cover/web`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl }),
  });
const file = (bytes, type, name) => ({ bytes, type, name });
function form(parts) {
  const data = new FormData();
  for (const [name, value] of parts) {
    if (typeof value === "string") data.append(name, value);
    else data.append(name, new Blob([value.bytes], { type: value.type }), value.name);
  }
  return data;
}
const upload = (parts) => api("/api/tracks", { method: "POST", body: form(parts) });
const diskState = () => ({
  audio: fs.readdirSync(UPLOADS).filter((name) => name !== "covers"),
  covers: fs.readdirSync(COVERS),
});
function seedTrack({ owner = ALICE, cover = false } = {}) {
  const storedName = `${crypto.randomUUID()}.mp3`;
  fs.writeFileSync(path.join(UPLOADS, storedName), MP3);
  const doc = new Track({
    ownerId: owner,
    title: "Piste",
    originalName: "piste.mp3",
    storedName,
    mimeType: "audio/mpeg",
    size: MP3.length,
  });
  if (cover) {
    const coverName = `${crypto.randomUUID()}.png`;
    fs.writeFileSync(path.join(COVERS, coverName), PNG);
    Object.assign(doc, { coverStoredName: coverName, coverMimeType: "image/png", coverSource: "upload" });
  }
  store.set(String(doc._id), doc);
  return doc;
}
const redirect = (location) => new Response(null, { status: 302, headers: { Location: location } });
const endlessBody = (counter, chunkSize = 64 * 1024) =>
  new ReadableStream({
    pull(controller) {
      counter.pulled += 1;
      // Garde-fou : une implémentation qui bufferise tout ne doit pas boucler à l'infini.
      if (counter.pulled > 2000) return controller.close();
      const chunk = new Uint8Array(chunkSize);
      if (counter.pulled === 1) chunk.set(PNG);
      controller.enqueue(chunk);
    },
  });

/* ===== Identifiants non ObjectId sur les routes historiques ===== */

test("id de piste invalide : GET audio et DELETE = 404 JSON via le vrai cast Mongoose, jamais 500", async () => {
  for (const id of ["pas-un-id", "aaaaaaaaaaaa", "..%2F..%2Fetc%2Fpasswd", "%00", "1".repeat(25)]) {
    for (const [method, suffix] of [["GET", "/audio"], ["DELETE", ""]]) {
      const response = await api(`/api/tracks/${id}${suffix}`, { method });
      assert.equal(response.status, 404, `${method} ${id}`);
      assert.equal(typeof (await response.json()).message, "string");
    }
  }
});

/* ===== Pagination et filtre : valeurs aberrantes ===== */

test("page/limit aberrants : jamais de $skip/$limit non entier ou non représentable envoyé à MongoDB", async () => {
  const cases = [
    "page=-5&limit=3",
    "page=0",
    "page=abc&limit=xyz",
    "page=2.5&limit=2.5",
    "page=Infinity&limit=Infinity",
    "page=1e400",
    "page=1e20",
    `page=${"9".repeat(30)}`,
    "limit=-1",
    "limit=0",
    "limit=1000",
    "page[]=2&limit[]=3",
  ];
  for (const query of cases) {
    pipelines.length = 0;
    const response = await api(`/api/tracks?${query}`);
    assert.equal(response.status, 200, query);
    const docs = pipelines[0].find((stage) => stage.$facet).$facet.docs;
    const skip = docs.find((stage) => "$skip" in stage).$skip;
    const limit = docs.find((stage) => "$limit" in stage).$limit;
    assert.ok(Number.isSafeInteger(skip) && skip >= 0, `${query} : $skip=${skip}`);
    assert.ok(Number.isSafeInteger(limit) && limit >= 1 && limit <= 20, `${query} : $limit=${limit}`);
  }
});

test("q fourni en tableau = 400 ; q[$ne] ou ownerId en query ne modifient jamais le filtre", async () => {
  const array = await api("/api/tracks?q=a&q=b");
  assert.equal(array.status, 400);

  for (const query of [`q[$ne]=x`, `q[$regex]=.*`, `ownerId=${BOB}`, `match[ownerId]=${BOB}`]) {
    pipelines.length = 0;
    const response = await api(`/api/tracks?${query}`);
    assert.ok([200, 400].includes(response.status), `${query} → ${response.status}`);
    if (response.status === 200) {
      const match = pipelines[0].find((stage) => stage.$match).$match;
      assert.ok(match.ownerId.equals(ALICE), `${query} : ownerId non maîtrisé`);
      assert.ok(match.title === undefined || typeof match.title.$regex === "string", query);
      assert.equal(JSON.stringify(match).includes("$ne"), false, query);
    }
  }
});

/* ===== Anti-SSRF de POST /cover/web ===== */

test("SSRF : chaque saut de redirection est revalidé (allowlist puis hôte interne)", async () => {
  const track = seedTrack();
  remote = (_url, _init, call) =>
    call === 1 ? redirect("https://is2-ssl.mzstatic.com/b.png") : redirect("http://169.254.169.254/");
  const response = await postWeb(track.id, MZ);
  assert.equal(response.status, 400);
  assert.deepEqual(
    remoteCalls.map((call) => new URL(call.url).hostname),
    ["is1-ssl.mzstatic.com", "is2-ssl.mzstatic.com"],
  );
  assert.deepEqual(diskState().covers, []);
});

test("SSRF : boucle de redirections bornée à 3 et délai partagé par tous les sauts", async () => {
  const track = seedTrack();
  remote = () => redirect("https://is3-ssl.mzstatic.com/loop.png");
  const response = await postWeb(track.id, MZ);
  assert.equal(response.status, 400);
  assert.equal(remoteCalls.length, 4);
  const [first, ...others] = remoteCalls;
  assert.ok(first.init.signal instanceof AbortSignal);
  for (const call of others) {
    assert.equal(call.init.signal, first.init.signal, "un signal par saut = délai non global");
    assert.equal(call.init.redirect, "manual");
  }
});

test("SSRF : variantes d'URL piégées refusées sans aucun appel réseau", async () => {
  const track = seedTrack();
  const refused = [
    "https://is1-ssl.mzstatic.com@evil.example/a.png",
    "https://evil.example\\@is1-ssl.mzstatic.com/a.png",
    "https://evil.example#@is1-ssl.mzstatic.com/a.png",
    "https://evil.example/.mzstatic.com",
    "https://evil.example%2f.mzstatic.com/a.png",
    "https://[::1]/a.png",
    "https://[::ffff:127.0.0.1]/a.png",
    "https://2130706433/a.png",
    "https://0x7f.1/a.png",
    "https://localhost/a.png",
    "https://xn--mzstatic-9ya.com/a.png",
    "https://is1-ssl.mzstatic.com:443@evil.example/a.png",
    "HTTP://is1-ssl.mzstatic.com/a.png",
    `https://is1-ssl.mzstatic.com/${"a".repeat(2100)}`,
  ];
  for (const imageUrl of refused) {
    const response = await postWeb(track.id, imageUrl);
    assert.equal(response.status, 400, imageUrl.slice(0, 60));
  }
  assert.equal(remoteCalls.length, 0);
});

test("SSRF : hôte en majuscules normalisé, point final jamais envoyé vers un autre hôte", async () => {
  const track = seedTrack();
  remote = () => new Response(PNG);
  for (const imageUrl of ["https://IS1-SSL.MZSTATIC.COM/a.png", "https://is1-ssl.mzstatic.com./a.png"]) {
    await postWeb(track.id, imageUrl);
  }
  for (const call of remoteCalls) {
    assert.match(new URL(call.url).hostname, /\.mzstatic\.com\.?$/);
  }
});

test("SSRF : le plafond de 2 Mo est appliqué en flux, sans tout charger en mémoire", async () => {
  const track = seedTrack();
  const counter = { pulled: 0 };
  remote = () => new Response(endlessBody(counter));
  const response = await postWeb(track.id, MZ);
  assert.equal(response.status, 400);
  // 2 Mo / 64 Ko = 32 morceaux : au-delà de ~40 lectures, la réponse était bufferisée.
  assert.ok(counter.pulled <= 40, `${counter.pulled} morceaux lus`);
  assert.deepEqual(diskState().covers, []);
});

test("SSRF : un Content-Length annoncé > 2 Mo est refusé avant toute lecture du corps", async () => {
  const track = seedTrack();
  const counter = { pulled: 0 };
  remote = () =>
    new Response(endlessBody(counter), { headers: { "Content-Length": String(5 * 1024 * 1024) } });
  const response = await postWeb(track.id, MZ);
  assert.equal(response.status, 400);
  assert.ok(counter.pulled <= 2, `${counter.pulled} morceaux lus`);
});

test("SSRF : réponse distante 404/500 = 400 sans fichier, jamais 5xx", async () => {
  const track = seedTrack();
  for (const status of [404, 500]) {
    remote = () => new Response("non", { status });
    const response = await postWeb(track.id, MZ);
    assert.equal(response.status, 400, String(status));
  }
  assert.deepEqual(diskState().covers, []);
});

/* ===== Fichiers orphelins sur les chemins d'erreur ===== */

test("upload avec pochette mais sans audio = 400 et aucun fichier résiduel", async () => {
  const response = await upload([["cover", file(PNG, "image/png", "c.png")]]);
  assert.equal(response.status, 400);
  assert.deepEqual(diskState(), { audio: [], covers: [] });
});

test("upload : pochette écrite AVANT un audio refusé (MIME) = 400 et disque propre", async () => {
  const response = await upload([
    ["cover", file(PNG, "image/png", "c.png")],
    ["audio", file(MP3, "text/plain", "x.mp3")],
  ]);
  assert.equal(response.status, 400);
  assert.deepEqual(diskState(), { audio: [], covers: [] });
});

test("upload : champ fichier inattendu ou audio en double = 400 et disque propre", async () => {
  const unexpected = await upload([
    ["audio", file(MP3, "audio/mpeg", "x.mp3")],
    ["avatar", file(PNG, "image/png", "a.png")],
  ]);
  assert.equal(unexpected.status, 400);
  const twice = await upload([
    ["audio", file(MP3, "audio/mpeg", "1.mp3")],
    ["audio", file(MP3, "audio/mpeg", "2.mp3")],
  ]);
  assert.equal(twice.status, 400);
  assert.deepEqual(diskState(), { audio: [], covers: [] });
  assert.equal(store.size, 0);
});

test("upload : nom de fichier malveillant (../) n'écrit jamais hors du dossier des uploads", async () => {
  const response = await upload([["audio", file(MP3, "audio/mpeg", "../../../evil.mp3")]]);
  assert.equal(response.status, 201);
  assert.equal(diskState().audio.length, 1);
  assert.match(diskState().audio[0], /^[0-9a-f-]{36}\.mp3$/);
  assert.deepEqual(fs.readdirSync(DATA), ["uploads"]);
  assert.deepEqual(fs.readdirSync(workDir), ["data"]);
});

test("upload : extension démesurée = pas de 500 et pas de fichier résiduel", async () => {
  const response = await upload([["audio", file(MP3, "audio/mpeg", `x.${"a".repeat(300)}`)]]);
  assert.ok(response.status < 500, `statut ${response.status}`);
  assert.equal(diskState().audio.length, response.status === 201 ? 1 : 0);
});

test("ID3 : image embarquée > 2 Mo ignorée, upload réussi sans pochette", async () => {
  const response = await upload([["audio", file(mp3WithHugePicture(), "audio/mpeg", "gros.mp3")]]);
  assert.equal(response.status, 201);
  const track = await response.json();
  assert.equal(track.hasCover, false);
  assert.equal(track.coverSource, null);
  assert.equal(track.artist, "Gros artiste");
  assert.deepEqual(diskState().covers, []);
});

test("DELETE piste dont le fichier audio a disparu : la pochette ne doit pas rester orpheline", async () => {
  const track = seedTrack({ cover: true });
  fs.rmSync(path.join(UPLOADS, track.storedName));
  const response = await api(`/api/tracks/${track.id}`, { method: "DELETE" });
  assert.equal(response.status, 500);
  assert.deepEqual(diskState().covers, [], "fichier de pochette orphelin après suppression");
});

/* ===== Erreurs internes ===== */

test("erreur interne = 500 JSON { message } du contrat, sans pile d'appels ni chemin serveur", async () => {
  failAggregate = true;
  const response = await api("/api/tracks");
  assert.equal(response.status, 500);
  const body = await response.text();
  assert.match(response.headers.get("content-type") ?? "", /application\/json/, "corps non JSON");
  assert.equal(body.includes(workDir), false, "chemin du serveur divulgué");
  assert.equal(/\n\s+at /.test(body) || body.includes("node_modules"), false, "pile d'appels divulguée");
});

/* ===== Aucune donnée sensible dans les logs ===== */

test("aucun JWT ni en-tête Authorization dans les journaux serveur", async () => {
  const lines = [];
  const originals = {};
  for (const level of ["log", "warn", "error", "debug"]) {
    originals[level] = console[level];
    console[level] = (...args) => lines.push(args.map((arg) => String(arg?.stack ?? arg)).join(" "));
  }
  const forged = jwt.sign({ sub: String(BOB) }, "autre-secret");
  try {
    const track = seedTrack();
    await api("/api/tracks");
    await api("/api/tracks", { token: forged });
    await api("/api/tracks", { token: "abc.def.ghi" });
    await api(`/api/tracks/${track.id}/audio`);
    await postWeb(track.id, "https://evil.example/a.png");
  } finally {
    Object.assign(console, originals);
  }
  const output = lines.join("\n");
  assert.ok(output.includes("[auth]"), "les journaux d'authentification doivent exister");
  for (const secret of [aliceToken, forged, "abc.def.ghi", SECRET]) {
    assert.equal(output.includes(secret), false, "secret présent dans les journaux");
  }
});
