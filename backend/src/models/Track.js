import mongoose from "mongoose";
import aggregatePaginate from "mongoose-aggregate-paginate-v2";

export const TAG_MAX_LENGTH = 200;
const COVER_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

/*
 * Ce schéma conserve les métadonnées d'une piste. Le fichier audio lui-même
 * reste sur le disque ; storedName contient le nom technique utilisé côté
 * serveur et n'est jamais exposé par toPublic().
 */
const schema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    originalName: { type: String, required: true },
    storedName: { type: String, required: true, select: false },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true, min: 0 },
    artist: { type: String, trim: true, maxlength: TAG_MAX_LENGTH },
    album: { type: String, trim: true, maxlength: TAG_MAX_LENGTH },
    // Les trois champs de pochette sont toujours renseignés ou effacés ensemble.
    coverStoredName: { type: String, select: false },
    coverMimeType: { type: String, enum: COVER_MIME_TYPES },
    coverSource: { type: String, enum: ["upload", "id3", "web"] },
  },
  { timestamps: true },
);

// Cet index accélère la liste des pistes d'un utilisateur triées par date.
schema.index({ ownerId: 1, createdAt: -1 });

// Ajoute Track.aggregatePaginate(), utilisé par la liste paginée des pistes.
schema.plugin(aggregatePaginate);

/**
 * Forme publique d'une piste, commune aux documents Mongoose et aux objets
 * bruts renvoyés par un aggregate. Les noms de fichiers disque n'y figurent pas.
 */
export function toPublicTrack(track) {
  return {
    id: String(track._id),
    ownerId: String(track.ownerId),
    title: track.title,
    originalName: track.originalName,
    mimeType: track.mimeType,
    size: track.size,
    createdAt: track.createdAt,
    artist: track.artist ?? null,
    album: track.album ?? null,
    hasCover: Boolean(track.coverSource),
    coverSource: track.coverSource ?? null,
  };
}

/**
 * Convertit un document Mongoose en objet sûr pour le frontend.
 * L'identifiant MongoDB devient la propriété simple `id` attendue par Angular.
 */
schema.methods.toPublic = function () {
  console.debug(`[track-model] Préparation de la piste publique ${this.id}`);
  return toPublicTrack(this);
};

export const Track = mongoose.model("Track", schema);
