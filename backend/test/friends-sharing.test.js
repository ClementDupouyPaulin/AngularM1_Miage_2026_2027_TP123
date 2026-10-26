import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

// Même technique que clips-v2.test.js : dossier temporaire et MongoDB simulé en mémoire.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "gpc-social-"));
process.chdir(workDir);
const { createApp } = await import("../src/app.js");
const { Clip } = await import("../src/models/Clip.js");
const { User } = await import("../src/models/User.js");
const { Friendship, pairKeyOf, inviteKeyOf } = await import("../src/models/Friendship.js");
const { matches, fakeQuery, runPipeline } = await import("./fake-mongo.js");

mongoose.set("bufferCommands", false);

const UPLOADS = path.join(workDir, "data", "uploads");
const SECRET = process.env.JWT_SECRET || "tp1-development-secret";
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom", "latin1"), Buffer.alloc(64, 3)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 7)]);

const people = {};
for (const name of ["Alice", "Bob", "Carol", "Dave", "Eve"]) {
  const id = new mongoose.Types.ObjectId();
  const email = `${name.toLowerCase()}@example.com`;
  people[name.toLowerCase()] = { id, name, email, token: jwt.sign({ sub: String(id), email }, SECRET) };
}
const { alice, bob, carol, dave, eve } = people;
const userById = (id) => Object.values(people).find((person) => String(person.id) === String(id));

/* ---- Simulation de MongoDB (filtres et pipelines évalués par fake-mongo.js) ---- */

const clips = new Map();
const friendships = new Map();
const duplicateKey = () => Object.assign(new Error("E11000 duplicate key"), { code: 11000 });

const plainClips = () => [...clips.values()].map((doc) => doc.toObject());
const findClipDoc = (filter) => [...clips.values()].find((doc) => matches(doc.toObject(), filter)) ?? null;

Clip.findOne = (filter) => fakeQuery(findClipDoc(filter));
Clip.find = (filter) => fakeQuery(plainClips().filter((doc) => matches(doc, filter)));
Clip.create = async (data) => {
  const doc = new Clip(data);
  await doc.validate();
  clips.set(String(doc._id), doc);
  return doc;
};
Clip.findOneAndDelete = (filter) => {
  const doc = findClipDoc(filter);
  if (doc) clips.delete(String(doc._id));
  return fakeQuery(doc);
};
Clip.findOneAndUpdate = (filter, update) => {
  const doc = findClipDoc(filter);
  if (doc) doc.annotations.push(update.$push.annotations);
  return fakeQuery(doc);
};
Clip.updateMany = async (filter, update) => {
  const [[field, value]] = Object.entries(update.$pull);
  for (const doc of clips.values()) {
    if (matches(doc.toObject(), filter)) doc[field] = doc[field].filter((id) => String(id) !== String(value));
  }
  return { acknowledged: true };
};
Clip.updateOne = async (filter, update) => {
  const doc = findClipDoc(filter);
  const [[field, values]] = Object.entries(update.$pullAll);
  if (doc) doc[field] = doc[field].filter((id) => !values.some((value) => String(value) === String(id)));
  return { acknowledged: true };
};
Clip.prototype.save = async function save() {
  await this.validate();
  clips.set(String(this._id), this);
  return this;
};

mongoose.Aggregate.prototype.exec = async function exec() {
  return runPipeline(plainClips(), this.pipeline());
};

const allFriendships = () => [...friendships.values()];
const findFriendship = (filter) => allFriendships().find((doc) => matches(doc, filter)) ?? null;

Friendship.find = (filter) => fakeQuery(allFriendships().filter((doc) => matches(doc, filter)));
Friendship.findOne = (filter) => fakeQuery(findFriendship(filter));
Friendship.exists = (filter) => fakeQuery(findFriendship(filter) ? { _id: findFriendship(filter)._id } : null);
Friendship.countDocuments = async (filter) => allFriendships().filter((doc) => matches(doc, filter)).length;
Friendship.create = async (data) => {
  const doc = new Friendship(data);
  await doc.validate();
  if (allFriendships().some((item) => item.inviteKey === doc.inviteKey)) throw duplicateKey();
  friendships.set(String(doc._id), { ...doc.toObject(), createdAt: new Date() });
  return doc;
};
Friendship.findOneAndUpdate = (filter, update) => {
  const doc = findFriendship(filter);
  if (doc && update.$set.pairKey && allFriendships().some((item) => item !== doc && item.pairKey === update.$set.pairKey)) {
    throw duplicateKey();
  }
  if (doc) Object.assign(doc, update.$set);
  return fakeQuery(doc ? { ...doc } : null);
};
Friendship.findOneAndDelete = (filter) => {
  const doc = findFriendship(filter);
  if (doc) friendships.delete(String(doc._id));
  return fakeQuery(doc);
};
Friendship.deleteOne = async (filter) => {
  const doc = findFriendship(filter);
  if (doc) friendships.delete(String(doc._id));
  return { deletedCount: doc ? 1 : 0 };
};

User.find = (filter) =>
  fakeQuery(
    filter._id.$in
      .map(userById)
      .filter(Boolean)
      .map((person) => ({ _id: person.id, name: person.name, email: person.email })),
  );
User.findOne = (filter) => {
  const person = Object.values(people).find((item) => item.email === filter.email);
  return fakeQuery(person ? { _id: person.id } : null);
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
  clips.clear();
  friendships.clear();
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

let clock = Date.UTC(2026, 0, 1);
const nextDate = () => new Date((clock += 60_000));

function seedClip(owner, { visibility = "private", sharedWith = [], title = "Clip", ...fields } = {}) {
  const storedName = `${crypto.randomUUID()}.mp4`;
  const filmstripStoredName = `${crypto.randomUUID()}.jpg`;
  fs.writeFileSync(path.join(UPLOADS, storedName), MP4);
  fs.writeFileSync(path.join(UPLOADS, filmstripStoredName), JPEG);
  const doc = new Clip({
    ownerId: owner.id,
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
    createdAt: nextDate(),
    visibility,
    sharedWith: sharedWith.map((person) => person.id),
    ...fields,
  });
  clips.set(String(doc._id), doc);
  return doc;
}

/** Invitation de `requester` vers l'e-mail de `recipient` (ou une adresse), acceptée par défaut. */
function seedFriendship(requester, recipient, status = "accepted") {
  const _id = new mongoose.Types.ObjectId();
  const createdAt = nextDate();
  const recipientEmail = typeof recipient === "string" ? recipient : recipient.email;
  const accepted = status === "accepted";
  const doc = {
    _id,
    requester: requester.id,
    recipientEmail,
    recipient: accepted ? recipient.id : null,
    inviteKey: inviteKeyOf(requester.id, recipientEmail),
    status,
    acceptedAt: accepted ? createdAt : null,
    createdAt,
  };
  if (accepted) doc.pairKey = pairKeyOf(requester.id, recipient.id);
  friendships.set(String(_id), doc);
  return doc;
}

async function expectError(response, status, pattern) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ["message"]);
  assert.match(body.message, pattern);
}

const expectUnknownClip = async (response) => expectError(response, 404, /^Clip inconnu$/);

/** Alice amie de Bob et Carol ; Dave est un ex-ami resté dans sharedWith ; Eve est inconnue. */
function seedCircle() {
  seedFriendship(alice, bob);
  seedFriendship(carol, alice);
}

/* ---- Authentification ---- */

test("401 sans JWT sur les routes sociales", async () => {
  const id = String(new mongoose.Types.ObjectId());
  for (const [method, url] of [
    ["GET", "/api/friends"],
    ["POST", "/api/friends/requests"],
    ["POST", `/api/friends/requests/${id}/accept`],
    ["DELETE", `/api/friends/${id}`],
    ["GET", "/api/clips/discover"],
    ["GET", "/api/activity"],
  ]) {
    await expectError(await api(url, { method }), 401, /Authentification requise/);
  }
});

/* ---- Matrice d'accès ---- */

test("clip partagé : propriétaire et ami destinataire lisent ; ami non destinataire, ex-ami et inconnu = 404", async () => {
  seedCircle();
  const clip = seedClip(alice, { visibility: "shared", sharedWith: [bob, dave] });
  const readers = { alice: true, bob: true, carol: false, dave: false, eve: false };
  for (const [key, allowed] of Object.entries(readers)) {
    const { token } = people[key];
    for (const suffix of ["", "/video", "/filmstrip"]) {
      const response = await api(`/api/clips/${clip.id}${suffix}`, { token });
      if (allowed) {
        assert.equal(response.status, 200, `${key} ${suffix}`);
        await response.arrayBuffer();
      } else {
        await expectUnknownClip(response);
      }
    }
    const note = await api(`/api/clips/${clip.id}/annotations`, {
      method: "POST",
      token,
      json: { time: 1, text: `Note de ${key}` },
    });
    if (allowed) assert.equal(note.status, 201, key);
    else await expectUnknownClip(note);
  }
  assert.deepEqual(clips.get(clip.id).annotations.map((note) => note.text), ["Note de alice", "Note de bob"]);
});

test("seul le propriétaire modifie ou supprime : PATCH, PUT analysis et DELETE = 404 pour les lecteurs", async () => {
  seedCircle();
  const shared = seedClip(alice, { visibility: "shared", sharedWith: [bob] });
  const open = seedClip(alice, { visibility: "public" });
  for (const clip of [shared, open]) {
    for (const reader of [bob, eve]) {
      await expectUnknownClip(
        await api(`/api/clips/${clip.id}`, { method: "PATCH", token: reader.token, json: { title: "Piraté" } }),
      );
      await expectUnknownClip(
        await api(`/api/clips/${clip.id}/analysis`, { method: "PUT", token: reader.token, json: {} }),
      );
      await expectUnknownClip(await api(`/api/clips/${clip.id}`, { method: "DELETE", token: reader.token }));
    }
    assert.equal(clips.get(clip.id).title, "Clip");
  }
  assert.equal((await api(`/api/clips/${open.id}`, { method: "DELETE", token: alice.token })).status, 204);
  assert.equal(clips.has(open.id), false);
});

test("clip public : tout utilisateur lit et annote ; un clip privé reste invisible à un ami", async () => {
  seedCircle();
  const open = seedClip(alice, { visibility: "public" });
  const hidden = seedClip(alice, { sharedWith: [bob] });
  for (const suffix of ["", "/video", "/filmstrip"]) {
    const response = await api(`/api/clips/${open.id}${suffix}`, { token: eve.token });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    await expectUnknownClip(await api(`/api/clips/${hidden.id}${suffix}`, { token: bob.token }));
  }
  const note = await api(`/api/clips/${open.id}/annotations`, {
    method: "POST",
    token: eve.token,
    json: { time: 2, text: "Vu" },
  });
  assert.equal(note.status, 201);
  assert.equal((await note.json()).authorName, "Eve");
});

test("sharedWith et e-mails jamais exposés aux non-propriétaires", async () => {
  seedCircle();
  const clip = seedClip(alice, { visibility: "shared", sharedWith: [bob, carol] });
  const asBob = await (await api(`/api/clips/${clip.id}`, { token: bob.token })).text();
  assert.deepEqual(JSON.parse(asBob).sharedWith, []);
  assert.equal(JSON.parse(asBob).isOwner, false);
  assert.doesNotMatch(asBob, /@example\.com/);
  assert.doesNotMatch(asBob, new RegExp(String(carol.id)));

  const asAlice = await (await api(`/api/clips/${clip.id}`, { token: alice.token })).json();
  assert.deepEqual(asAlice.sharedWith, [
    { id: String(bob.id), name: "Bob" },
    { id: String(carol.id), name: "Carol" },
  ]);
  assert.doesNotMatch(JSON.stringify(asAlice), /@example\.com/);
});

test("annotations : suppression par l'auteur ou le propriétaire, 403 pour un autre lecteur", async () => {
  seedCircle();
  const clip = seedClip(alice, {
    visibility: "public",
    annotations: [
      { time: 1, text: "D'Eve", authorId: eve.id },
      { time: 2, text: "De Bob", authorId: bob.id },
      { time: 3, text: "De Carol", authorId: carol.id },
    ],
  });
  const [eveNote, bobNote, carolNote] = clip.annotations;
  await expectError(
    await api(`/api/clips/${clip.id}/annotations/${eveNote.id}`, { method: "DELETE", token: bob.token }),
    403,
    /auteur ou le propriétaire/,
  );
  assert.equal((await api(`/api/clips/${clip.id}/annotations/${bobNote.id}`, { method: "DELETE", token: bob.token })).status, 204);
  assert.equal((await api(`/api/clips/${clip.id}/annotations/${carolNote.id}`, { method: "DELETE", token: alice.token })).status, 204);
  assert.deepEqual(clips.get(clip.id).annotations.map((note) => note.text), ["D'Eve"]);
});

test("ajout d'annotation refusé quand la condition atomique de taille échoue", async () => {
  const clip = seedClip(alice, { visibility: "public" });
  const original = Clip.findOneAndUpdate;
  let filter;
  Clip.findOneAndUpdate = (received) => {
    filter = received;
    return fakeQuery(null);
  };
  try {
    await expectError(
      await api(`/api/clips/${clip.id}/annotations`, { method: "POST", token: eve.token, json: { time: 1, text: "x" } }),
      400,
      /200/,
    );
  } finally {
    Clip.findOneAndUpdate = original;
  }
  assert.deepEqual(filter["annotations.199"], { $exists: false });
});

/* ---- Révocation ---- */

test("retrait d'un ami : accès révoqué et chaque partie retirée des partages de l'autre", async () => {
  const friendship = seedFriendship(alice, bob);
  seedFriendship(alice, carol);
  const aliceClip = seedClip(alice, { visibility: "shared", sharedWith: [bob, carol] });
  const bobClip = seedClip(bob, { visibility: "shared", sharedWith: [alice] });
  assert.equal((await api(`/api/clips/${aliceClip.id}`, { token: bob.token })).status, 200);

  assert.equal((await api(`/api/friends/${friendship._id}`, { method: "DELETE", token: bob.token })).status, 204);
  assert.equal(friendships.has(String(friendship._id)), false);
  assert.deepEqual(clips.get(aliceClip.id).sharedWith.map(String), [String(carol.id)]);
  assert.deepEqual(clips.get(bobClip.id).sharedWith.map(String), []);
  await expectUnknownClip(await api(`/api/clips/${aliceClip.id}`, { token: bob.token }));
  await expectUnknownClip(await api(`/api/clips/${bobClip.id}/video`, { token: alice.token }));
  assert.equal((await api(`/api/clips/${aliceClip.id}`, { token: carol.token })).status, 200);
});

test("amitié en attente : aucun accès au clip partagé", async () => {
  seedFriendship(alice, bob, "pending");
  const clip = seedClip(alice, { visibility: "shared", sharedWith: [bob] });
  await expectUnknownClip(await api(`/api/clips/${clip.id}`, { token: bob.token }));
});

/* ---- PATCH visibilité et partage ---- */

test("PATCH sharedWith : amis acceptés seulement, sinon 400 sans modification", async () => {
  seedCircle();
  seedFriendship(alice, dave, "pending");
  const clip = seedClip(alice);
  for (const target of [eve, dave]) {
    await expectError(
      await api(`/api/clips/${clip.id}`, {
        method: "PATCH",
        token: alice.token,
        json: { visibility: "shared", sharedWith: [String(bob.id), String(target.id)] },
      }),
      400,
      /amis/,
    );
  }
  assert.equal(clips.get(clip.id).visibility, "private");
  assert.deepEqual(clips.get(clip.id).sharedWith, []);

  const response = await api(`/api/clips/${clip.id}`, {
    method: "PATCH",
    token: alice.token,
    json: { visibility: "shared", sharedWith: [String(bob.id), String(bob.id), String(carol.id)] },
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).sharedWith.map((user) => user.name), ["Bob", "Carol"]);
  assert.equal((await api(`/api/clips/${clip.id}`, { token: carol.token })).status, 200);
});

test("PATCH : shared sans destinataire accepté, private vide sharedWith", async () => {
  seedCircle();
  const clip = seedClip(alice, { visibility: "shared", sharedWith: [bob] });
  const empty = await api(`/api/clips/${clip.id}`, {
    method: "PATCH",
    token: alice.token,
    json: { sharedWith: [] },
  });
  assert.equal(empty.status, 200);
  assert.equal((await empty.json()).visibility, "shared");
  await expectUnknownClip(await api(`/api/clips/${clip.id}`, { token: bob.token }));

  clips.get(clip.id).sharedWith = [bob.id];
  const hidden = await api(`/api/clips/${clip.id}`, { method: "PATCH", token: alice.token, json: { visibility: "private" } });
  assert.equal(hidden.status, 200);
  assert.deepEqual((await hidden.json()).sharedWith, []);
  assert.deepEqual(clips.get(clip.id).sharedWith, []);
});

/* ---- Amis ---- */

test("GET /friends : amis acceptés et demandes reçues ou envoyées", async () => {
  const withBob = seedFriendship(bob, alice);
  const fromCarol = seedFriendship(carol, alice, "pending");
  const toDave = seedFriendship(alice, dave, "pending");
  seedFriendship(bob, eve);
  const response = await api("/api/friends", { token: alice.token });
  assert.equal(response.status, 200);
  const overview = await response.json();
  assert.deepEqual(overview.friends, [
    {
      friendshipId: String(withBob._id),
      user: { id: String(bob.id), name: "Bob", email: "bob@example.com" },
      since: withBob.acceptedAt.toISOString(),
    },
  ]);
  assert.deepEqual(
    overview.requests.map(({ id, user, direction }) => ({ id, user, direction })),
    [
      { id: String(toDave._id), user: { id: String(toDave._id), name: dave.email, email: dave.email }, direction: "outgoing" },
      {
        id: String(fromCarol._id),
        user: { id: String(carol.id), name: "Carol", email: carol.email },
        direction: "incoming",
      },
    ],
  );
  assert.ok(overview.requests[0].createdAt);
  assert.doesNotMatch(JSON.stringify(overview), /eve@example\.com|"Dave"/);
});

const invite = (email, token = alice.token) =>
  api("/api/friends/requests", { method: "POST", token, json: { email } });

test("invitation : 202 générique et demande enregistrée à l'identique que le compte existe ou non", async () => {
  const unknown = await invite("personne@example.com");
  const known = await invite("  BOB@Example.COM ");
  assert.equal(unknown.status, 202);
  assert.equal(known.status, 202);
  const expected = { message: "Si ce compte existe, une invitation a été envoyée." };
  assert.deepEqual(await unknown.json(), expected);
  assert.deepEqual(await known.json(), expected);
  assert.deepEqual(
    allFriendships().map(({ recipientEmail, recipient, status }) => ({ recipientEmail, recipient, status })),
    [
      { recipientEmail: "personne@example.com", recipient: null, status: "pending" },
      { recipientEmail: "bob@example.com", recipient: null, status: "pending" },
    ],
  );

  const { requests } = await (await api("/api/friends", { token: alice.token })).json();
  const shape = ({ id, user, direction }) => ({ sameId: user.id === id, keys: Object.keys(user), direction, nameIsEmail: user.name === user.email });
  assert.equal(requests.length, 2);
  assert.deepEqual(shape(requests[0]), shape(requests[1]));
  assert.doesNotMatch(JSON.stringify(requests), new RegExp(`Bob|${bob.id}`));
});

test("invitation : renvoyer la même invitation = 202 sans doublon", async () => {
  for (const email of ["bob@example.com", "BOB@example.com", "inconnu@example.com", "inconnu@example.com"]) {
    assert.equal((await invite(email)).status, 202);
  }
  assert.equal(friendships.size, 2);
});

test("invitation : 400 soi-même ou e-mail invalide, 409 seulement pour une relation connue", async () => {
  for (const email of ["alice@example.com", " ALICE@example.com"]) {
    await expectError(await invite(email), 400, /vous-même/);
  }
  for (const json of [{}, { email: "" }, { email: "pas-un-mail" }, { email: 42 }, { email: `${"a".repeat(250)}@x.fr` }, { email: { $ne: null } }, { email: ["bob@example.com"] }]) {
    await expectError(await api("/api/friends/requests", { method: "POST", token: alice.token, json }), 400, /E-mail invalide/);
  }
  seedFriendship(bob, alice, "pending");
  seedFriendship(carol, alice);
  await expectError(await invite("bob@example.com"), 409, /vous a déjà invité/);
  await expectError(await invite("carol@example.com"), 409, /déjà amis/);
  await expectError(await invite("alice@example.com", carol.token), 409, /déjà amis/);
  assert.equal((await invite("alice@example.com", bob.token)).status, 202);
  assert.equal(friendships.size, 2);
});

test("invitation : 50 demandes en attente maximum par émetteur (429)", async () => {
  for (let index = 0; index < 50; index += 1) seedFriendship(alice, `invite${index}@example.com`, "pending");
  await expectError(await invite("encore@example.com"), 429, /50 maximum/);
  assert.equal((await invite("invite3@example.com")).status, 202);
  assert.equal(friendships.size, 50);
});

test("GET /friends : 200 entrées au plus par liste", async () => {
  for (let index = 0; index < 205; index += 1) seedFriendship(alice, `n${index}@example.com`, "pending");
  const { requests } = await (await api("/api/friends", { token: alice.token })).json();
  assert.equal(requests.length, 200);
});

test("accepter : destinataire seulement ; mauvais utilisateur, déjà acceptée ou id invalide = 404", async () => {
  const request = seedFriendship(alice, bob, "pending");
  for (const person of [alice, carol]) {
    await expectError(
      await api(`/api/friends/requests/${request._id}/accept`, { method: "POST", token: person.token }),
      404,
      /^Demande inconnue$/,
    );
  }
  assert.equal(request.status, "pending");
  const response = await api(`/api/friends/requests/${request._id}/accept`, { method: "POST", token: bob.token });
  assert.equal(response.status, 200);
  const entry = await response.json();
  assert.equal(entry.friendshipId, String(request._id));
  assert.deepEqual(entry.user, { id: String(alice.id), name: "Alice", email: "alice@example.com" });
  assert.ok(entry.since);
  const stored = friendships.get(String(request._id));
  assert.equal(stored.status, "accepted");
  assert.equal(String(stored.recipient), String(bob.id));
  assert.equal(stored.pairKey, pairKeyOf(alice.id, bob.id));
  assert.equal((await api(`/api/clips/${seedClip(alice, { visibility: "shared", sharedWith: [bob] }).id}`, { token: bob.token })).status, 200);

  for (const id of [request._id, "pas-un-id", String(new mongoose.Types.ObjectId())]) {
    await expectError(await api(`/api/friends/requests/${id}/accept`, { method: "POST", token: bob.token }), 404, /^Demande inconnue$/);
  }
});

test("accepter : l'e-mail du JWT doit être celui invité ; invitation croisée retirée", async () => {
  const request = seedFriendship(alice, bob, "pending");
  const crossed = seedFriendship(bob, alice, "pending");
  const impostor = jwt.sign({ sub: String(bob.id), email: "autre@example.com" }, SECRET);
  await expectError(await api(`/api/friends/requests/${request._id}/accept`, { method: "POST", token: impostor }), 404, /^Demande inconnue$/);
  assert.equal((await api(`/api/friends/requests/${request._id}/accept`, { method: "POST", token: bob.token })).status, 200);
  assert.equal(friendships.has(String(crossed._id)), false);
  assert.equal(friendships.size, 1);
});

test("DELETE /friends/:id : refuser ou annuler une demande ; tiers ou id invalide = 404", async () => {
  const refused = seedFriendship(alice, bob, "pending");
  const cancelled = seedFriendship(alice, carol, "pending");
  for (const id of [refused._id, "pas-un-id", String(new mongoose.Types.ObjectId())]) {
    await expectError(await api(`/api/friends/${id}`, { method: "DELETE", token: eve.token }), 404, /^Relation inconnue$/);
  }
  assert.equal((await api(`/api/friends/${refused._id}`, { method: "DELETE", token: bob.token })).status, 204);
  assert.equal((await api(`/api/friends/${cancelled._id}`, { method: "DELETE", token: alice.token })).status, 204);
  assert.equal(friendships.size, 0);
});

/* ---- Découverte ---- */

function seedDiscoverWorld() {
  seedCircle();
  return {
    mine: seedClip(alice, { visibility: "public", title: "Le mien" }),
    bobPublic: seedClip(bob, { visibility: "public", title: "Bob public", tags: ["action"], avgShotLength: 4, cutCount: 6, syncScore: 2 }),
    bobShared: seedClip(bob, { visibility: "shared", sharedWith: [alice], title: "Bob pour Alice", avgShotLength: 2, cutCount: 14, syncScore: 8 }),
    bobForCarol: seedClip(bob, { visibility: "shared", sharedWith: [carol], title: "Bob pour Carol" }),
    bobPrivate: seedClip(bob, { title: "Bob privé", sharedWith: [alice] }),
    evePublic: seedClip(eve, { visibility: "public", title: "Eve public", avgShotLength: 30, cutCount: 0, syncScore: 9 }),
    eveShared: seedClip(eve, { visibility: "shared", sharedWith: [alice], title: "Eve pour Alice" }),
    daveShared: seedClip(dave, { visibility: "shared", sharedWith: [alice], title: "Dave pour Alice" }),
  };
}

const discover = async (query, token = alice.token) => {
  const response = await api(`/api/clips/discover?${query}`, { token });
  assert.equal(response.status, 200);
  return response.json();
};
const titles = (page) => page.items.map((item) => item.title);

test("discover : portées public, friends et shared, jamais mes clips ni les clips non autorisés", async () => {
  seedDiscoverWorld();
  assert.deepEqual(titles(await discover("scope=public&limit=20")), ["Eve public", "Bob public"]);
  assert.deepEqual(titles(await discover("scope=friends&limit=20")), ["Bob pour Alice", "Bob public"]);
  assert.deepEqual(titles(await discover("scope=shared&limit=20")), ["Bob pour Alice"]);
  assert.deepEqual(titles(await discover("limit=20")), ["Eve public", "Bob public"]);

  const page = await discover("scope=friends&limit=1");
  assert.equal(page.total, 2);
  assert.equal(page.hasNextPage, true);
  const [item] = page.items;
  assert.equal(item.isOwner, false);
  assert.deepEqual(item.owner, { id: String(bob.id), name: "Bob" });
  assert.equal(item.sparkline.length, 24);
  assert.equal(item.hasFilmstrip, true);
  for (const field of ["sharedWith", "annotations", "storedName", "filmstripStoredName"]) assert.equal(field in item, false);
});

test("discover : tris nervous et synced, filtres q et tag", async () => {
  seedDiscoverWorld();
  assert.deepEqual(titles(await discover("scope=friends&sort=nervous&limit=20")), ["Bob pour Alice", "Bob public"]);
  assert.deepEqual(titles(await discover("scope=public&sort=nervous&limit=20")), ["Bob public"]);
  assert.deepEqual(titles(await discover("scope=public&sort=synced&limit=20")), ["Eve public", "Bob public"]);
  assert.deepEqual(titles(await discover("scope=friends&sort=synced&limit=20")), ["Bob pour Alice", "Bob public"]);
  assert.deepEqual(titles(await discover("scope=public&q=EVE")), ["Eve public"]);
  assert.deepEqual(titles(await discover("scope=public&q=.*")), []);
  assert.deepEqual(titles(await discover("scope=friends&tag=Action")), ["Bob public"]);
});

test("discover : paramètres invalides = 400", async () => {
  for (const query of ["scope=private", "scope=mine", "sort=random", "sort=__proto__", "q=a&q=b", "sort=recent&sort=nervous", "tag=a&tag=b", `q=${"a".repeat(101)}`, "tag=%20", "visibility=private", "scope=public&scope=friends"]) {
    await expectError(await api(`/api/clips/discover?${query}`, { token: alice.token }), 400, /invalide|limitée|non disponible/);
  }
});

/* ---- Activité ---- */

test("activity : clips d'amis visibles, annotations d'autrui sur mes clips et amitiés, triés par date", async () => {
  const withBob = seedFriendship(alice, bob);
  const bobPublic = seedClip(bob, { visibility: "public", title: "Bob public" });
  seedClip(bob, { title: "Bob privé" });
  seedClip(bob, { visibility: "shared", sharedWith: [carol], title: "Bob pour Carol" });
  seedClip(eve, { visibility: "public", title: "Eve public" });
  const noteAt = nextDate();
  const myClip = seedClip(alice, {
    title: "Mon clip",
    annotations: [
      { time: 1, text: "Bravo", authorId: eve.id, createdAt: noteAt },
      { time: 2, text: "Ma note", authorId: alice.id, createdAt: nextDate() },
    ],
  });
  withBob.acceptedAt = nextDate();

  const response = await api("/api/activity", { token: alice.token });
  assert.equal(response.status, 200);
  const events = await response.json();
  assert.deepEqual(
    events.map(({ type, actor, clipTitle, text }) => ({ type, actor: actor.name, clipTitle, text })),
    [
      { type: "friend", actor: "Bob", clipTitle: undefined, text: undefined },
      { type: "annotation", actor: "Eve", clipTitle: "Mon clip", text: "Bravo" },
      { type: "clip", actor: "Bob", clipTitle: "Bob public", text: undefined },
    ],
  );
  assert.equal(events[1].clipId, myClip.id);
  assert.equal(events[2].clipId, bobPublic.id);
  assert.deepEqual(events[0].actor, { id: String(bob.id), name: "Bob" });
  assert.equal(new Set(events.map((event) => event.id)).size, 3);
  assert.doesNotMatch(JSON.stringify(events), /@example\.com|Bob privé|Bob pour Carol|Eve public/);

  const limited = await (await api("/api/activity?limit=1", { token: alice.token })).json();
  assert.deepEqual(limited.map((event) => event.type), ["friend"]);
});

test("activity : limite hors [1, 50] = 400", async () => {
  for (const limit of ["0", "51", "abc", "2.5", ""]) {
    await expectError(await api(`/api/activity?limit=${limit}`, { token: alice.token }), 400, /Limite invalide/);
  }
  assert.equal((await api("/api/activity?limit=50", { token: alice.token })).status, 200);
});

/* ---- Revue : injections, limites, ex-amis ---- */

test("injections : opérateurs MongoDB refusés (sharedWith) ou sans effet (clés q[…] ignorées)", async () => {
  seedCircle();
  const clip = seedClip(alice);
  for (const sharedWith of [[{ $gt: "" }], { $ne: null }, [String(bob.id), { $in: [] }]]) {
    await expectError(
      await api(`/api/clips/${clip.id}`, { method: "PATCH", token: alice.token, json: { visibility: "shared", sharedWith } }),
      400,
      /Partage invalide/,
    );
  }
  assert.deepEqual(clips.get(clip.id).sharedWith, []);
  seedClip(bob, { visibility: "public", title: "Public" });
  seedClip(bob, { title: "Privé" });
  assert.deepEqual(titles(await discover("scope=public&q[$ne]=x&q[]=a")), ["Public"]);
});

test("PUT analysis : corps JSON de plus de 1 Mo = 413", async () => {
  const clip = seedClip(alice);
  const response = await api(`/api/clips/${clip.id}/analysis`, {
    method: "PUT",
    token: alice.token,
    json: { version: 2, padding: "x".repeat(1024 * 1024 + 1) },
  });
  await expectError(response, 413, /trop volumineuse/);
});

test("ex-ami : ni lecture ni ajout ni suppression d'annotation (404)", async () => {
  const clip = seedClip(alice, {
    visibility: "shared",
    sharedWith: [dave],
    annotations: [{ time: 1, text: "De Dave", authorId: dave.id }],
  });
  const [note] = clip.annotations;
  await expectUnknownClip(
    await api(`/api/clips/${clip.id}/annotations`, { method: "POST", token: dave.token, json: { time: 1, text: "x" } }),
  );
  await expectUnknownClip(await api(`/api/clips/${clip.id}/annotations/${note.id}`, { method: "DELETE", token: dave.token }));
  assert.deepEqual(clips.get(clip.id).annotations.map((item) => item.text), ["De Dave"]);
});

test("activity : aucun clip d'un ex-ami ni d'une demande en attente", async () => {
  seedFriendship(alice, carol, "pending");
  seedFriendship(eve, alice, "pending");
  seedClip(dave, { visibility: "shared", sharedWith: [alice], title: "Dave partagé" });
  seedClip(carol, { visibility: "shared", sharedWith: [alice], title: "Carol partagé" });
  seedClip(eve, { visibility: "shared", sharedWith: [alice], title: "Eve partagé" });
  const events = await (await api("/api/activity", { token: alice.token })).json();
  assert.deepEqual(events, []);
});

test("PATCH sharedWith : un destinataire dont l'amitié disparaît pendant l'écriture est retiré", async () => {
  seedCircle();
  const clip = seedClip(alice);
  const original = Friendship.find;
  let calls = 0;
  Friendship.find = (filter) => {
    calls += 1;
    if (calls === 2) friendships.clear();
    return original(filter);
  };
  try {
    const response = await api(`/api/clips/${clip.id}`, {
      method: "PATCH",
      token: alice.token,
      json: { visibility: "shared", sharedWith: [String(bob.id)] },
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).sharedWith, []);
  } finally {
    Friendship.find = original;
  }
  assert.deepEqual(clips.get(clip.id).sharedWith, []);
});

/* ---- Upload : limites multipart et format ---- */

const ANALYSIS = JSON.stringify({ version: 1, durationSec: 30, cuts: [5], beats: [], syncScore: null });

function uploadForm(fields) {
  const data = new FormData();
  for (const [name, value] of fields) {
    if (typeof value === "string") data.append(name, value);
    else data.append(name, new Blob([value.bytes], { type: value.type }), value.name);
  }
  return api("/api/clips", { method: "POST", token: alice.token, body: data });
}

const video = (bytes = MP4) => ["video", { bytes, type: "video/mp4", name: "v.mp4" }];
const diskFiles = () => fs.readdirSync(UPLOADS).filter((name) => name !== "covers");

test("upload : marques ISO-BMFF MP4 acceptées, MOV, HEIC et 3GP refusés", async () => {
  const withBrand = (brand) =>
    Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`, "latin1"), Buffer.alloc(32, 1)]);
  for (const brand of ["mp42", "avc1", "M4V ", "dash"]) {
    assert.equal((await uploadForm([video(withBrand(brand)), ["analysis", ANALYSIS]])).status, 201, brand);
  }
  for (const brand of ["qt  ", "heic", "3gp4", "mif1"]) {
    await expectError(await uploadForm([video(withBrand(brand)), ["analysis", ANALYSIS]]), 400, /Fichier vidéo invalide/);
  }
  assert.equal(diskFiles().length, 4);
});

test("upload : trop de champs, champ texte de plus de 256 ko ou trop de parties = 400 sans fichier", async () => {
  const extra = Array.from({ length: 8 }, (_, index) => [`champ${index}`, "x"]);
  await expectError(await uploadForm([video(), ["analysis", ANALYSIS], ...extra]), 400, /trop de champs|trop de parties/);
  await expectError(await uploadForm([video(), ["analysis", ANALYSIS], ["title", "t".repeat(256 * 1024 + 1)]]), 400, /trop long/);
  assert.deepEqual(diskFiles(), []);
});

test("upload : une pellicule de plus de 1 Mo est coupée et supprimée, vidéo comprise", async () => {
  const big = Buffer.concat([JPEG, Buffer.alloc(1024 * 1024 + 1)]);
  await expectError(
    await uploadForm([video(), ["filmstrip", { bytes: big, type: "image/jpeg", name: "f.jpg" }], ["analysis", ANALYSIS]]),
    400,
    /Pellicule trop volumineuse/,
  );
  assert.deepEqual(diskFiles(), []);
});

test("ValidationError Mongoose : message générique", async () => {
  const response = await uploadForm([video(), ["analysis", ANALYSIS], ["title", "t".repeat(201)]]);
  await expectError(response, 400, /^Données invalides$/);
  assert.deepEqual(diskFiles(), []);
});
