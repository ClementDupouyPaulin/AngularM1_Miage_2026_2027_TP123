import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";

/*
 * Test d'intégration contre un VRAI mongod éphémère (mongodb-memory-server),
 * sans aucune simulation. Lancé par `npm run test:integration` (MONGO_INTEGRATION=1).
 * Sans cette variable, ou si le binaire mongod est indisponible, les tests sont
 * ignorés avec un message : `npm test` ne dépend ni du réseau ni de mongod.
 */

let memoryServer;
let server;
let base;
let Clip;
let Friendship;

const skipReason = await startMongo();

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "gpc-mongo-"));
process.chdir(workDir);
const UPLOADS = path.join(workDir, "data", "uploads");


async function startMongo() {
  if (process.env.MONGO_INTEGRATION !== "1") {
    return "Test d'intégration MongoDB ignoré : lancer `npm run test:integration`";
  }
  try {
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri("gpc-integration"));
    return false;
  } catch (error) {
    const reason = `mongod éphémère indisponible (téléchargement du binaire impossible ?) : ${error.message}`;
    console.warn(`[integration-mongo] ${reason}`);
    return reason;
  }
}

if (!skipReason) {
  // Importé après le chdir : app.js résout le dossier d'uploads à son chargement.
  const { createApp } = await import("../src/app.js");
  const { User } = await import("../src/models/User.js");
  ({ Clip } = await import("../src/models/Clip.js"));
  ({ Friendship } = await import("../src/models/Friendship.js"));
  // Les index uniques (invitation, paire d'amis) doivent exister pour tester les doublons.
  await Promise.all([User, Clip, Friendship].map((model) => model.init()));
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}

test.after(async () => {
  server?.close();
  await mongoose.disconnect();
  await memoryServer?.stop();
  fs.rmSync(workDir, { recursive: true, force: true });
});

test.beforeEach(async () => {
  if (skipReason) return;
  await mongoose.connection.db.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
  for (const entry of fs.readdirSync(UPLOADS, { withFileTypes: true })) {
    if (entry.isFile()) fs.rmSync(path.join(UPLOADS, entry.name));
  }
});

const it = (name, fn) => test(name, { skip: skipReason }, fn);

/* ---- Utilitaires ---- */

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom", "latin1"), Buffer.alloc(64, 3)]);

const analysis = (overrides = {}) => ({
  version: 2,
  durationSec: 24,
  fps: 10,
  cuts: [0, 0.5, 12, 23.9],
  beats: [0.5, 12],
  syncScore: null,
  diffs: [0, 0.25, 1],
  palette: ["#AABBCC", "#000000"],
  transitions: [{ time: 0, kind: "cut" }, { time: 12, kind: "cut" }],
  thumbnailTimes: [0, 12],
  sensitivity: 2.5,
  ...overrides,
});

function api(urlPath, { token, json, ...init } = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(json);
  }
  return fetch(base + urlPath, { ...init, headers });
}

/** Inscrit puis reconnecte un utilisateur ; renvoie son jeton, son id et son e-mail. */
async function signUp(name) {
  const email = `${name.toLowerCase()}@example.com`;
  const password = "motdepasse-solide";
  const registered = await api("/api/auth/register", { method: "POST", json: { name, email, password } });
  assert.equal(registered.status, 201);
  const login = await api("/api/auth/login", { method: "POST", json: { email, password } });
  assert.equal(login.status, 200);
  const { token, user } = await login.json();
  return { name, email, token, id: user.id };
}

async function uploadClip(user, { title = "Poursuite", tags, visibility, analysisOverrides } = {}) {
  const data = new FormData();
  data.append("video", new Blob([MP4], { type: "video/mp4" }), "extrait.mp4");
  data.append("title", title);
  data.append("analysis", JSON.stringify(analysis(analysisOverrides)));
  if (tags) data.append("tags", JSON.stringify(tags));
  if (visibility) data.append("visibility", visibility);
  const response = await api("/api/clips", { method: "POST", token: user.token, body: data });
  assert.equal(response.status, 201);
  return response.json();
}

async function befriend(requester, recipient) {
  const invite = await api("/api/friends/requests", { method: "POST", token: requester.token, json: { email: recipient.email } });
  assert.equal(invite.status, 202);
  const { requests } = await (await api("/api/friends", { token: recipient.token })).json();
  assert.equal(requests.length, 1);
  const accepted = await api(`/api/friends/requests/${requests[0].id}/accept`, { method: "POST", token: recipient.token });
  assert.equal(accepted.status, 200);
  return accepted.json();
}

const expectUnknownClip = async (response) => {
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { message: "Clip inconnu" });
};

/* ---- Authentification ---- */

it("inscription refusée en doublon (409) et connexion avec mauvais mot de passe (401)", async () => {
  const alice = await signUp("Alice");
  const duplicate = await api("/api/auth/register", {
    method: "POST",
    json: { name: "Alice bis", email: alice.email.toUpperCase(), password: "motdepasse-solide" },
  });
  assert.equal(duplicate.status, 409);
  const wrong = await api("/api/auth/login", { method: "POST", json: { email: alice.email, password: "mauvais-mot-de-passe" } });
  assert.equal(wrong.status, 401);
  const me = await api("/api/users/me", { token: alice.token });
  assert.equal((await me.json()).email, alice.email);
});

/* ---- Clips ---- */

it("création d'un clip : enregistré, privé par défaut, relu en détail avec son analyse", async () => {
  const alice = await signUp("Alice");
  const created = await uploadClip(alice, { tags: ["action"] });
  assert.equal(created.title, "Poursuite");
  assert.equal(created.visibility, "private");
  assert.equal(await Clip.countDocuments({}), 1);

  const detail = await (await api(`/api/clips/${created.id}`, { token: alice.token })).json();
  assert.equal(detail.isOwner, true);
  assert.deepEqual(detail.analysis.cuts, [0, 0.5, 12, 23.9]);
  assert.deepEqual(detail.tags, ["action"]);
});

it("liste paginée : tri par date décroissante, pages et indicateurs cohérents", async () => {
  const alice = await signUp("Alice");
  for (const title of ["Un", "Deux", "Trois"]) await uploadClip(alice, { title });

  const first = await (await api("/api/clips?page=1&limit=2", { token: alice.token })).json();
  assert.deepEqual(first.items.map((clip) => clip.title), ["Trois", "Deux"]);
  assert.equal(first.total, 3);
  assert.equal(first.pages, 2);
  assert.equal(first.hasNextPage, true);

  const second = await (await api("/api/clips?page=2&limit=2", { token: alice.token })).json();
  assert.deepEqual(second.items.map((clip) => clip.title), ["Un"]);
  assert.equal(second.hasNextPage, false);
  assert.equal(second.prevPage, 1);
});

it("règle d'accès : un clip privé est un 404 pour un autre utilisateur, y compris vidéo et annotation", async () => {
  const [alice, bob] = [await signUp("Alice"), await signUp("Bob")];
  const clip = await uploadClip(alice);
  await expectUnknownClip(await api(`/api/clips/${clip.id}`, { token: bob.token }));
  await expectUnknownClip(await api(`/api/clips/${clip.id}/video`, { token: bob.token }));
  await expectUnknownClip(
    await api(`/api/clips/${clip.id}/annotations`, { method: "POST", token: bob.token, json: { time: 1, text: "x" } }),
  );
  await expectUnknownClip(await api(`/api/clips/${clip.id}`, { method: "DELETE", token: bob.token }));
  const mine = await (await api("/api/clips", { token: bob.token })).json();
  assert.equal(mine.total, 0);
});

it("identifiant de clip mal formé : 404 JSON et non 500", async () => {
  const alice = await signUp("Alice");
  assert.equal((await api("/api/clips/pas-un-id", { token: alice.token })).status, 404);
});

/* ---- Amis et partage ---- */

it("invitation puis acceptation : ami visible des deux côtés, doublon d'invitation idempotent", async () => {
  const [alice, bob] = [await signUp("Alice"), await signUp("Bob")];
  await api("/api/friends/requests", { method: "POST", token: alice.token, json: { email: bob.email } });
  const again = await api("/api/friends/requests", { method: "POST", token: alice.token, json: { email: bob.email } });
  assert.equal(again.status, 202);
  assert.equal(await Friendship.countDocuments({}), 1);

  const incoming = (await (await api("/api/friends", { token: bob.token })).json()).requests;
  assert.equal(incoming[0].direction, "incoming");
  const accepted = await api(`/api/friends/requests/${incoming[0].id}/accept`, { method: "POST", token: bob.token });
  assert.equal(accepted.status, 200);

  for (const [viewer, other] of [[alice, bob], [bob, alice]]) {
    const { friends, requests } = await (await api("/api/friends", { token: viewer.token })).json();
    assert.deepEqual(friends.map((friend) => friend.user.name), [other.name]);
    assert.equal(requests.length, 0);
  }
  const reinvite = await api("/api/friends/requests", { method: "POST", token: alice.token, json: { email: bob.email } });
  assert.equal(reinvite.status, 409);
});

it("partage shared : l'ami destinataire lit et annote, un tiers reste en 404 ; retrait d'ami = 404", async () => {
  const [alice, bob, carol] = [await signUp("Alice"), await signUp("Bob"), await signUp("Carol")];
  const { friendshipId } = await befriend(alice, bob);
  await befriend(alice, carol);
  const clip = await uploadClip(alice);

  const share = await api(`/api/clips/${clip.id}`, {
    method: "PATCH",
    token: alice.token,
    json: { visibility: "shared", sharedWith: [bob.id] },
  });
  assert.equal(share.status, 200);

  const asBob = await api(`/api/clips/${clip.id}`, { token: bob.token });
  assert.equal(asBob.status, 200);
  assert.equal((await asBob.json()).isOwner, false);
  await (await api(`/api/clips/${clip.id}/video`, { token: bob.token })).arrayBuffer();
  const note = await api(`/api/clips/${clip.id}/annotations`, {
    method: "POST",
    token: bob.token,
    json: { time: 3, text: "Belle coupe" },
  });
  assert.equal(note.status, 201);
  assert.equal((await note.json()).authorName, "Bob");
  await expectUnknownClip(await api(`/api/clips/${clip.id}`, { token: carol.token }));

  const removal = await api(`/api/friends/${friendshipId}`, { method: "DELETE", token: alice.token });
  assert.equal(removal.status, 204);
  await expectUnknownClip(await api(`/api/clips/${clip.id}`, { token: bob.token }));
  const stored = await Clip.findById(clip.id).lean();
  assert.deepEqual(stored.sharedWith, []);
  assert.equal(stored.annotations.length, 1);
});

it("partager avec un non-ami est refusé", async () => {
  const [alice, bob] = [await signUp("Alice"), await signUp("Bob")];
  const clip = await uploadClip(alice);
  const response = await api(`/api/clips/${clip.id}`, {
    method: "PATCH",
    token: alice.token,
    json: { visibility: "shared", sharedWith: [bob.id] },
  });
  assert.equal(response.status, 400);
  assert.deepEqual((await Clip.findById(clip.id).lean()).sharedWith, []);
});

/* ---- Annotations et suppression ---- */

it("annotation : ajoutée, persistée, supprimée par son auteur ; durée dépassée = 400", async () => {
  const alice = await signUp("Alice");
  const clip = await uploadClip(alice);
  const note = await (
    await api(`/api/clips/${clip.id}/annotations`, { method: "POST", token: alice.token, json: { time: 5, text: "Raccord" } })
  ).json();
  const tooLate = await api(`/api/clips/${clip.id}/annotations`, {
    method: "POST",
    token: alice.token,
    json: { time: 9999, text: "Hors durée" },
  });
  assert.equal(tooLate.status, 400);
  assert.equal((await Clip.findById(clip.id).lean()).annotations.length, 1);

  const removal = await api(`/api/clips/${clip.id}/annotations/${note.id}`, { method: "DELETE", token: alice.token });
  assert.equal(removal.status, 204);
  assert.equal((await Clip.findById(clip.id).lean()).annotations.length, 0);
});

it("suppression : document et fichier disque supprimés, relecture en 404", async () => {
  const alice = await signUp("Alice");
  const clip = await uploadClip(alice);
  assert.equal(fs.readdirSync(UPLOADS).filter((name) => name.endsWith(".mp4")).length, 1);

  assert.equal((await api(`/api/clips/${clip.id}`, { method: "DELETE", token: alice.token })).status, 204);
  assert.equal(await Clip.countDocuments({}), 0);
  assert.equal(fs.readdirSync(UPLOADS).filter((name) => name.endsWith(".mp4")).length, 0);
  await expectUnknownClip(await api(`/api/clips/${clip.id}`, { token: alice.token }));
});

/* ---- Agrégations ---- */

it("stats et étiquettes : agrégations calculées par MongoDB sur mes seuls clips", async () => {
  const [alice, bob] = [await signUp("Alice"), await signUp("Bob")];
  await uploadClip(alice, { title: "A", tags: ["action", "noir"] });
  await uploadClip(alice, { title: "B", tags: ["action"], visibility: "public" });
  await uploadClip(bob, { title: "Autre", tags: ["action"] });

  const stats = await (await api("/api/clips/stats", { token: alice.token })).json();
  assert.equal(stats.clipCount, 2);
  assert.equal(stats.totalDurationSec, 48);
  assert.equal(stats.totalCuts, 8);
  assert.equal(stats.avgShotLength, 48 / (8 + 2));
  assert.deepEqual(stats.byVisibility, { private: 1, shared: 0, public: 1 });
  assert.ok(stats.mostNervous);
  assert.ok(stats.mostSynced);

  const tags = await (await api("/api/clips/tags", { token: alice.token })).json();
  assert.deepEqual(tags, [{ tag: "action", count: 2 }, { tag: "noir", count: 1 }]);
});

it("discover : public pour tous, shared réservé à l'ami destinataire, tri et pagination côté MongoDB", async () => {
  const [alice, bob, carol] = [await signUp("Alice"), await signUp("Bob"), await signUp("Carol")];
  await befriend(alice, bob);
  await befriend(alice, carol);
  await uploadClip(alice, { title: "Ouvert", visibility: "public" });
  const shared = await uploadClip(alice, { title: "Réservé" });
  await uploadClip(alice, { title: "Secret" });
  await api(`/api/clips/${shared.id}`, {
    method: "PATCH",
    token: alice.token,
    json: { visibility: "shared", sharedWith: [bob.id] },
  });
  await uploadClip(bob, { title: "Le mien", visibility: "public" });

  const titles = async (user, query) =>
    (await (await api(`/api/clips/discover${query}`, { token: user.token })).json()).items.map((clip) => clip.title).sort();

  assert.deepEqual(await titles(bob, "?scope=public"), ["Ouvert"]);
  assert.deepEqual(await titles(bob, "?scope=shared"), ["Réservé"]);
  assert.deepEqual(await titles(bob, "?scope=friends"), ["Ouvert", "Réservé"]);
  assert.deepEqual(await titles(carol, "?scope=friends"), ["Ouvert"]);
  assert.deepEqual(await titles(carol, "?scope=shared"), []);

  const page = await (await api("/api/clips/discover?scope=friends&limit=1", { token: bob.token })).json();
  assert.equal(page.total, 2);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, shared.id);
  assert.equal(page.items[0].owner.name, "Alice");
});

it("fil d'activité : clips d'amis, annotations reçues et amitiés, triés du plus récent au plus ancien", async () => {
  const [alice, bob] = [await signUp("Alice"), await signUp("Bob")];
  await befriend(alice, bob);
  const clip = await uploadClip(alice, { visibility: "public" });
  await api(`/api/clips/${clip.id}/annotations`, { method: "POST", token: bob.token, json: { time: 1, text: "Vu" } });

  const forAlice = await (await api("/api/activity", { token: alice.token })).json();
  assert.ok(forAlice.length >= 2);
  const dates = forAlice.map((event) => new Date(event.at).getTime());
  assert.deepEqual([...dates].sort((a, b) => b - a), dates);
  const forBob = await (await api("/api/activity", { token: bob.token })).json();
  assert.ok(forBob.some((event) => event.actor.name === "Alice"));
});
