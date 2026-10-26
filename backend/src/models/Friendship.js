import mongoose from "mongoose";

export const FRIENDSHIP_STATUSES = ["pending", "accepted"];

/** Clé de la paire non ordonnée : identique quel que soit le sens de la demande. */
export const pairKeyOf = (a, b) => [String(a), String(b)].sort().join(":");

/*
 * Relation d'amitié entre deux utilisateurs : une demande en attente
 * (`pending`) puis acceptée par son destinataire. `pairKey` porte l'index
 * unique qui empêche les doublons dans les deux sens.
 */
const schema = new mongoose.Schema(
  {
    requester: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    pairKey: { type: String, required: true },
    status: { type: String, enum: FRIENDSHIP_STATUSES, default: "pending" },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

schema.pre("validate", function () {
  this.pairKey = pairKeyOf(this.requester, this.recipient);
});

schema.index({ pairKey: 1 }, { unique: true });
schema.index({ requester: 1, status: 1 });
schema.index({ recipient: 1, status: 1 });

export const Friendship = mongoose.model("Friendship", schema);

/** Filtre des relations dont l'utilisateur est l'une des deux parties. */
export const involving = (userId) => ({ $or: [{ requester: userId }, { recipient: userId }] });

/** Identifiant de l'autre partie d'une relation. */
export const otherParty = (friendship, userId) =>
  String(friendship.requester) === String(userId) ? friendship.recipient : friendship.requester;

/** Amitiés acceptées de l'utilisateur, les plus récentes d'abord. */
export function acceptedFriendshipsOf(userId) {
  return Friendship.find({ status: "accepted", ...involving(userId) })
    .sort({ acceptedAt: -1 })
    .lean();
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
