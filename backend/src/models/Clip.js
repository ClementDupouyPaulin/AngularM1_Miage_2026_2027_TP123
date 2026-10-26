import mongoose from "mongoose";
import aggregatePaginate from "mongoose-aggregate-paginate-v2";

export const CLIP_TITLE_MAX_LENGTH = 200;
export const ANALYSIS_VERSION = 2;
export const LEGACY_ANALYSIS_VERSION = 1;
export const DEFAULT_FPS = 10;
export const DEFAULT_SENSITIVITY = 3;
export const CLIP_VISIBILITIES = ["private", "shared", "public"];
export const TRANSITION_KINDS = ["cut", "fade"];
export const CLIP_TAG_MAX_COUNT = 5;
export const CLIP_TAG_MAX_LENGTH = 24;
export const ANNOTATION_TEXT_MAX_LENGTH = 280;
export const MAX_ANNOTATIONS = 200;
export const SPARKLINE_BUCKETS = 24;
const VIDEO_MIME_TYPES = ["video/mp4", "video/webm"];
const UNKNOWN_USER_NAME = "Utilisateur inconnu";

const transitionSchema = new mongoose.Schema(
  {
    time: { type: Number, required: true, min: 0 },
    kind: { type: String, required: true, enum: TRANSITION_KINDS },
  },
  { _id: false },
);

const annotationSchema = new mongoose.Schema({
  time: { type: Number, required: true, min: 0 },
  text: {
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: ANNOTATION_TEXT_MAX_LENGTH,
  },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now },
});

/*
 * Métadonnées et analyse de montage d'un extrait vidéo. La vidéo et la
 * pellicule restent sur le disque ; leurs noms de stockage ne sont jamais
 * exposés. cutCount, avgShotLength et syncScore sont calculés par le serveur.
 * Un document v1 n'a pas d'analysisVersion : il est normalisé à la lecture.
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
    filmstripStoredName: { type: String, default: null, select: false },
    mimeType: { type: String, required: true, enum: VIDEO_MIME_TYPES },
    size: { type: Number, required: true, min: 0 },
    tags: {
      type: [
        {
          type: String,
          trim: true,
          lowercase: true,
          minlength: 1,
          maxlength: CLIP_TAG_MAX_LENGTH,
        },
      ],
      default: [],
      validate: {
        validator: (tags) => tags.length <= CLIP_TAG_MAX_COUNT,
        message: `${CLIP_TAG_MAX_COUNT} étiquettes maximum`,
      },
    },
    visibility: { type: String, enum: CLIP_VISIBILITIES, default: "private" },
    sharedWith: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
    annotations: {
      type: [annotationSchema],
      default: [],
      validate: {
        validator: (annotations) => annotations.length <= MAX_ANNOTATIONS,
        message: `${MAX_ANNOTATIONS} annotations maximum`,
      },
    },
    analysisVersion: { type: Number },
    durationSec: { type: Number, required: true, min: 0 },
    fps: { type: Number, min: 0 },
    cuts: { type: [Number], default: [] },
    beats: { type: [Number], default: [] },
    diffs: { type: [Number], default: [] },
    palette: { type: [String], default: [] },
    transitions: { type: [transitionSchema], default: [] },
    thumbnailTimes: { type: [Number], default: [] },
    sensitivity: { type: Number, min: 0 },
    syncScore: { type: Number, default: null },
    avgShotLength: { type: Number, required: true, min: 0 },
    cutCount: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

schema.index({ ownerId: 1, createdAt: -1 });
schema.index({ ownerId: 1, tags: 1 });

schema.plugin(aggregatePaginate);

/** Nombre de coupes par tranche de durée égale : mini-courbe des cartes. */
export function computeSparkline(cuts, durationSec, buckets = SPARKLINE_BUCKETS) {
  const counts = new Array(buckets).fill(0);
  if (!(durationSec > 0)) return counts;
  for (const cut of cuts ?? []) {
    counts[Math.min(buckets - 1, Math.floor((cut / durationSec) * buckets))] += 1;
  }
  return counts;
}

/** Analyse publique v2 ; un document v1 reçoit les valeurs par défaut. */
export function normalizeAnalysis(clip) {
  const legacy = clip.analysisVersion !== ANALYSIS_VERSION;
  const cuts = [...(clip.cuts ?? [])];
  return {
    version: ANALYSIS_VERSION,
    durationSec: clip.durationSec,
    fps: legacy ? DEFAULT_FPS : (clip.fps ?? DEFAULT_FPS),
    cuts,
    beats: [...(clip.beats ?? [])],
    syncScore: clip.syncScore ?? null,
    diffs: legacy ? [] : [...(clip.diffs ?? [])],
    palette: legacy ? [] : [...(clip.palette ?? [])],
    transitions: legacy
      ? cuts.map((time) => ({ time, kind: "cut" }))
      : (clip.transitions ?? []).map(({ time, kind }) => ({ time, kind })),
    thumbnailTimes: legacy ? [] : [...(clip.thumbnailTimes ?? [])],
    sensitivity: legacy ? DEFAULT_SENSITIVITY : (clip.sensitivity ?? DEFAULT_SENSITIVITY),
  };
}

const userRef = (id, userNames) => ({
  id: String(id),
  name: userNames.get(String(id)) ?? UNKNOWN_USER_NAME,
});

/** Identifiants des utilisateurs cités par un clip (propriétaire, auteurs, partage). */
export function clipUserIds(clip) {
  return [
    clip.ownerId,
    ...(clip.annotations ?? []).map((annotation) => annotation.authorId),
    ...(clip.sharedWith ?? []),
  ];
}

/**
 * Résumé public d'un clip, commun aux documents Mongoose et aux objets bruts
 * d'un aggregate. `userNames` associe un identifiant d'utilisateur à son nom.
 */
export function toPublicClip(clip, { viewerId, userNames = new Map() } = {}) {
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
    tags: [...(clip.tags ?? [])],
    visibility: clip.visibility ?? "private",
    owner: userRef(clip.ownerId, userNames),
    isOwner: String(clip.ownerId) === String(viewerId),
    hasFilmstrip: clip.hasFilmstrip ?? Boolean(clip.filmstripStoredName),
    sparkline: computeSparkline(clip.cuts, clip.durationSec),
  };
}

export function toPublicAnnotation(annotation, userNames = new Map()) {
  return {
    id: String(annotation._id),
    time: annotation.time,
    text: annotation.text,
    authorId: String(annotation.authorId),
    authorName: userRef(annotation.authorId, userNames).name,
    createdAt: annotation.createdAt,
  };
}

/** Détail public : résumé, analyse v2, annotations triées et partage (propriétaire seul). */
schema.methods.toPublic = function (context = {}) {
  console.debug(`[clip-model] Préparation du clip public ${this.id}`);
  const userNames = context.userNames ?? new Map();
  const summary = toPublicClip(this, context);
  return {
    ...summary,
    analysis: normalizeAnalysis(this),
    annotations: [...this.annotations]
      .sort((a, b) => a.time - b.time)
      .map((annotation) => toPublicAnnotation(annotation, userNames)),
    sharedWith: summary.isOwner ? this.sharedWith.map((id) => userRef(id, userNames)) : [],
  };
};

export const Clip = mongoose.model("Clip", schema);
