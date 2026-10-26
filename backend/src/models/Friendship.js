import mongoose from "mongoose";

export const FRIENDSHIP_STATUSES = ["pending", "accepted"];

/** Clé de la paire non ordonnée : identique quel que soit le sens de la demande. */
export const pairKeyOf = (a, b) => [String(a), String(b)].sort().join(":");

/** Clé d'une invitation : un émetteur n'invite qu'une fois une adresse donnée. */
export const inviteKeyOf = (requester, email) => `${requester}:${email}`;

/*
 * Invitation puis amitié. Une invitation vise une adresse e-mail
 * (`recipientEmail`) et est toujours enregistrée, que le compte existe ou non :
 * l'état observable ne révèle donc aucun compte. `recipient` et `pairKey` ne
 * sont posés qu'à l'acceptation ; `pairKey` empêche deux amitiés pour la même
 * paire, dans un sens ou dans l'autre.
 */
const schema = new mongoose.Schema(
  {
    requester: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    recipientEmail: { type: String, required: true, lowercase: true, trim: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    inviteKey: { type: String, required: true },
    pairKey: { type: String },
    status: { type: String, enum: FRIENDSHIP_STATUSES, default: "pending" },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

schema.pre("validate", function () {
  this.inviteKey = inviteKeyOf(this.requester, this.recipientEmail);
  if (this.recipient) this.pairKey = pairKeyOf(this.requester, this.recipient);
});

schema.index({ inviteKey: 1 }, { unique: true });
schema.index({ pairKey: 1 }, { unique: true, partialFilterExpression: { pairKey: { $type: "string" } } });
schema.index({ requester: 1, status: 1, createdAt: -1 });
schema.index({ recipient: 1, status: 1 });
schema.index({ recipientEmail: 1, status: 1, createdAt: -1 });

export const Friendship = mongoose.model("Friendship", schema);

/** Filtre des amitiés acceptées dont l'utilisateur est l'une des deux parties. */
export const acceptedInvolving = (userId) => ({
  status: "accepted",
  $or: [{ requester: userId }, { recipient: userId }],
});

/** Identifiant de l'autre partie d'une amitié acceptée. */
export const otherParty = (friendship, userId) =>
  String(friendship.requester) === String(userId) ? friendship.recipient : friendship.requester;

/** Amitiés acceptées de l'utilisateur, les plus récentes d'abord (bornées si `limit`). */
export function acceptedFriendshipsOf(userId, limit = 0) {
  const query = Friendship.find(acceptedInvolving(userId)).sort({ acceptedAt: -1 });
  return (limit ? query.limit(limit) : query).lean();
}

/** Identifiants (ObjectId) des amis acceptés de l'utilisateur. */
export async function friendIdsOf(userId) {
  const friendships = await acceptedFriendshipsOf(userId);
  return friendships.map((friendship) => otherParty(friendship, userId));
}

/** Vrai si les deux utilisateurs sont amis (amitié acceptée). */
export async function areFriends(a, b) {
  return Boolean(await Friendship.exists({ pairKey: pairKeyOf(a, b), status: "accepted" }));
}
