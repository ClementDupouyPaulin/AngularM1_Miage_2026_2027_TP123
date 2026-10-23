import mongoose from "mongoose";
import aggregatePaginate from "mongoose-aggregate-paginate-v2";

export const CLIP_TITLE_MAX_LENGTH = 200;
export const ANALYSIS_VERSION = 1;
const VIDEO_MIME_TYPES = ["video/mp4", "video/webm"];

/*
 * Métadonnées et analyse de montage d'un extrait vidéo. Le fichier vidéo reste
 * sur le disque ; storedName n'est jamais exposé. cutCount et avgShotLength
 * sont calculés par le serveur à partir de cuts et durationSec.
 */
const schema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: CLIP_TITLE_MAX_LENGTH },
    originalName: { type: String, required: true },
    storedName: { type: String, required: true, select: false },
    mimeType: { type: String, required: true, enum: VIDEO_MIME_TYPES },
    size: { type: Number, required: true, min: 0 },
    durationSec: { type: Number, required: true, min: 0 },
    cuts: { type: [Number], default: [] },
    beats: { type: [Number], default: [] },
    syncScore: { type: Number, default: null },
    avgShotLength: { type: Number, required: true, min: 0 },
    cutCount: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

schema.index({ ownerId: 1, createdAt: -1 });

schema.plugin(aggregatePaginate);

/**
 * Résumé public d'un clip, commun aux documents Mongoose et aux objets bruts
 * d'un aggregate : ni cuts, ni beats, ni nom de fichier disque.
 */
export function toPublicClip(clip) {
  return {
    id: String(clip._id),
    title: clip.title,
    originalName: clip.originalName,
    mimeType: clip.mimeType,
    size: clip.size,
    durationSec: clip.durationSec,
    cutCount: clip.cutCount,
    avgShotLength: clip.avgShotLength,
    syncScore: clip.syncScore ?? null,
    createdAt: clip.createdAt,
  };
}

/** Détail public d'un clip : le résumé complété par l'analyse complète. */
schema.methods.toPublic = function () {
  console.debug(`[clip-model] Préparation du clip public ${this.id}`);
  return {
    ...toPublicClip(this),
    analysis: {
      version: ANALYSIS_VERSION,
      durationSec: this.durationSec,
      cuts: [...this.cuts],
      beats: [...this.beats],
      syncScore: this.syncScore ?? null,
    },
  };
};

export const Clip = mongoose.model("Clip", schema);
