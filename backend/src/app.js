import express from "express";
import cors from "cors";
import multer from "multer";
import jwt from "jsonwebtoken";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { parseFile, selectCover } from "music-metadata";
import { User } from "./models/User.js";
import { Track, toPublicTrack, TAG_MAX_LENGTH } from "./models/Track.js";
import {
  Clip,
  toPublicClip,
  toPublicAnnotation,
  clipUserIds,
  ANALYSIS_VERSION,
  LEGACY_ANALYSIS_VERSION,
  DEFAULT_FPS,
  DEFAULT_SENSITIVITY,
  CLIP_TITLE_MAX_LENGTH,
  CLIP_VISIBILITIES,
  TRANSITION_KINDS,
  CLIP_TAG_MAX_COUNT,
  CLIP_TAG_MAX_LENGTH,
  ANNOTATION_TEXT_MAX_LENGTH,
  MAX_ANNOTATIONS,
  MAX_SHARED_WITH,
} from "./models/Clip.js";
import {
  Friendship,
  acceptedFriendshipsOf,
  areFriends,
  friendIdsOf,
  inviteKeyOf,
  otherParty,
  pairKeyOf,
} from "./models/Friendship.js";

// Les fichiers audio restent sur le disque du serveur dans ce TP.
// MongoDB ne conserve que leurs métadonnées : titre, nom, taille, etc.
const UPLOADS = path.resolve("data/uploads");
const COVERS = path.join(UPLOADS, "covers");

try {
  // mkdirSync est utilisé au démarrage : l'application doit disposer de ce
  // dossier avant de pouvoir accepter le premier upload.
  fs.mkdirSync(UPLOADS, { recursive: true });
  fs.mkdirSync(COVERS, { recursive: true });
  console.log(`[startup] Dossier des uploads prêt : ${UPLOADS}`);
} catch (error) {
  console.error("[startup] Impossible de créer le dossier des uploads", error);
  throw error;
}

// Ce secret reste côté serveur. Il ne doit jamais être copié dans Angular.
const SECRET = process.env.JWT_SECRET || "tp1-development-secret";

// La taille maximale d'un fichier audio est de 25 Mo. Les fichiers plus gros
// sont refusés par Multer avant d'être écrits sur le disque.
const MAX_FILE_SIZE = 25 * 1024 * 1024;

// Les types MIME autorisés correspondent aux formats demandés dans le sujet.
const allowed = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/mp4",
  "audio/x-m4a",
]);

const MAX_COVER_SIZE = 2 * 1024 * 1024;
const COVER_TOO_LARGE = "Image trop volumineuse (2 Mo maximum)";
const COVER_EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_QUERY_LENGTH = 100;
// Plafond de page : (page - 1) * limit reste un entier sûr pour le $skip MongoDB.
const MAX_PAGE = 100000;
const SAFE_EXTENSION = /^\.[a-z0-9]{1,8}$/;

// Réseau sortant : seules l'API iTunes Search et les images *.mzstatic.com
// sont contactées, avec un délai et un nombre de redirections bornés (anti-SSRF).
const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";
const ITUNES_RESULT_LIMIT = 12;
const COVER_HOST_SUFFIX = ".mzstatic.com";
const MAX_URL_LENGTH = 2048;
const REMOTE_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
// Film Pulse : les vidéos sont stockées à plat dans UPLOADS, comme l'audio.
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
const VIDEO_TOO_LARGE = "Vidéo trop volumineuse (50 Mo maximum)";
const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm"]);
const VIDEO_SIGNATURE_LENGTH = 12;
const WEBM_SIGNATURE = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
// Marques majeures ISO-BMFF des MP4 ; MOV (`qt  `), HEIC et 3GP sont refusés.
const MP4_MAJOR_BRANDS = new Set([
  "isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1",
  "M4V ", "M4VH", "M4VP", "dash", "msnv", "mmp4", "f4v ",
]);
const MAX_CLIP_DURATION_SEC = 120;
const MAX_ANALYSIS_POINTS = 2000;
const MAX_SYNC_SCORE = 10;
const SYNC_WINDOW_SEC = 0.08;
const ANALYSIS_V1_KEYS = ["version", "durationSec", "cuts", "beats", "syncScore"];
const ANALYSIS_KEYS_BY_VERSION = new Map([
  [LEGACY_ANALYSIS_VERSION, ANALYSIS_V1_KEYS],
  [
    ANALYSIS_VERSION,
    [...ANALYSIS_V1_KEYS, "fps", "diffs", "palette", "transitions", "thumbnailTimes", "sensitivity"],
  ],
]);
const MAX_DIFFS = 1300;
const MAX_PALETTE_COLORS = 130;
const MAX_THUMBNAILS = 41;
const MIN_FPS = 1;
const MAX_FPS = 30;
const MIN_SENSITIVITY = 1;
const MAX_SENSITIVITY = 6;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
// Tolérance de comparaison des durées (s) entre l'analyse retouchée et le clip.
const DURATION_TOLERANCE_SEC = 1e-6;
// Une analyse v2 complète (2000 coupes, beats et transitions) dépasse les 100 ko par défaut.
const ANALYSIS_BODY_LIMIT = "1mb";
const MAX_FILMSTRIP_SIZE = 1024 * 1024;
const FILMSTRIP_TOO_LARGE = "Pellicule trop volumineuse (1 Mo maximum)";
const JPEG_SIGNATURE_LENGTH = 3;
const CONTROL_CHARACTERS = /\p{Cc}/u;
// Les noms de stockage sont masqués par défaut : seules les routes clips les lisent.
const CLIP_HIDDEN_FIELDS = "+storedName +filmstripStoredName";
// Champs lourds inutiles aux résumés ; cuts reste lu pour la mini-courbe.
const CLIP_SUMMARY_EXCLUDED = [
  "storedName",
  "filmstripStoredName",
  "beats",
  "diffs",
  "palette",
  "transitions",
  "thumbnailTimes",
  "annotations",
  "sharedWith",
];
const CLIP_PATCH_KEYS =["title", "tags", "visibility", "sharedWith"];
const ANNOTATION_KEYS = ["time", "text"];
const DISCOVER_SCOPES = ["public", "friends", "shared"];
const DISCOVER_SORTS = {
  recent: { createdAt: -1 },
  nervous: { avgShotLength: 1, createdAt: -1 },
  synced: { syncScore: -1, createdAt: -1 },
};
const DEFAULT_ACTIVITY_LIMIT = 20;
const MAX_ACTIVITY_LIMIT = 50;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITATION_SENT = "Si ce compte existe, une invitation a été envoyée.";
const MAX_PENDING_INVITATIONS = 50;
const MAX_FRIENDS_LISTED = 200;
const MAX_TAGS_LISTED = 100;
const DUPLICATE_KEY_CODE = 11000;

const COVER_ATTRIBUTION =
  "Pochettes fournies par l'API iTunes Search d'Apple ; elles restent la propriété de leurs ayants droit.";

/** Erreur métier portant le code HTTP et le message renvoyés au client. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Supprime un fichier ; un échec est journalisé et signalé par `false`. */
async function removeFile(filePath) {
  try {
    await fsPromises.unlink(filePath);
    console.log(`[files] Fichier supprimé : ${filePath}`);
    return true;
  } catch (error) {
    console.error(`[files] Fichier non supprimé : ${filePath}`, error);
    return false;
  }
}

/** Identifie JPEG, PNG ou WebP par les octets magiques, jamais par le Content-Type. */
function detectImageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return "image/png";
  if (
    bytes.toString("latin1", 0, 4) === "RIFF" &&
    bytes.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Valide une image (taille, octets magiques) puis l'écrit sous un nom aléatoire. */
async function storeCover(bytes, coverSource) {
  if (bytes.length > MAX_COVER_SIZE) throw new HttpError(400, COVER_TOO_LARGE);
  const coverMimeType = detectImageType(bytes);
  if (!coverMimeType) {
    throw new HttpError(400, "Image invalide : JPEG, PNG ou WebP attendu");
  }

  const coverStoredName = crypto.randomUUID() + COVER_EXTENSIONS[coverMimeType];
  await fsPromises.writeFile(path.join(COVERS, coverStoredName), bytes, { flag: "wx" });
  console.log(`[covers] Pochette ${coverSource} enregistrée (${coverMimeType}, ${bytes.length} o)`);
  return { coverStoredName, coverMimeType, coverSource };
}

/**
 * Lit le fichier `cover` brut écrit par Multer puis le supprime : seule la
 * copie validée par storeCover() est conservée.
 */
async function takeUploadedCover(file) {
  try {
    if (file.size > MAX_COVER_SIZE) throw new HttpError(400, COVER_TOO_LARGE);
    return await fsPromises.readFile(file.path);
  } finally {
    await removeFile(file.path);
  }
}

const cleanTag = (value) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, TAG_MAX_LENGTH)
    : undefined;

/**
 * Lit les tags du fichier audio. Une erreur de lecture ne doit jamais faire
 * échouer l'upload : elle est journalisée et aucun tag n'est retenu.
 */
async function readAudioTags(filePath) {
  try {
    const { common } = await parseFile(filePath, { duration: false });
    const picture = selectCover(common.picture);
    return {
      title: cleanTag(common.title),
      artist: cleanTag(common.artist),
      album: cleanTag(common.album),
      picture: picture ? Buffer.from(picture.data) : null,
    };
  } catch (error) {
    console.error(`[tracks] Tags audio illisibles, upload poursuivi : ${filePath}`, error);
    return {};
  }
}

/** Enregistre l'image ID3 si elle est valide ; une image invalide est ignorée. */
async function storeId3Cover(picture) {
  if (!picture) return null;
  try {
    return await storeCover(picture, "id3");
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    console.warn(`[tracks] Image ID3 ignorée : ${error.message}`);
    return null;
  }
}

/** Retrouve une piste du propriétaire connecté (null si inconnue ou d'autrui). */
async function findOwnedTrack(req) {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  return Track.findOne({ _id: req.params.id, ownerId: req.auth.sub }).select(
    "+coverStoredName",
  );
}

function unknownTrack(req, res) {
  console.warn(`[covers] Piste introuvable ou interdite : ${req.params.id}`);
  return res.status(404).json({ message: "Piste inconnue" });
}

/**
 * Enregistre la nouvelle pochette en base puis supprime l'ancien fichier.
 * Si MongoDB échoue, c'est le nouveau fichier qui est supprimé.
 */
async function replaceCover(track, cover) {
  const previous = track.coverStoredName;
  track.set(cover);
  try {
    await track.save();
  } catch (error) {
    await removeFile(path.join(COVERS, cover.coverStoredName));
    throw error;
  }
  if (previous) await removeFile(path.join(COVERS, previous));
}

/**
 * Règle de lecture d'un clip : propriétaire, clip public, ou clip partagé avec
 * le lecteur ET amitié acceptée vérifiée maintenant (un ex-ami perd l'accès).
 */
async function canReadClip(clip, userId) {
  if (String(clip.ownerId) === String(userId)) return true;
  if (clip.visibility === "public") return true;
  if (clip.visibility !== "shared") return false;
  if (!(clip.sharedWith ?? []).some((id) => String(id) === String(userId))) return false;
  return areFriends(clip.ownerId, userId);
}

/** Retrouve un clip lisible par l'utilisateur connecté (null sinon). */
async function findReadableClip(req) {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  const clip = await Clip.findOne({ _id: req.params.id }).select(CLIP_HIDDEN_FIELDS);
  if (!clip || !(await canReadClip(clip, req.auth.sub))) return null;
  return clip;
}

/** Retrouve un clip du propriétaire connecté (null si inconnu ou d'autrui). */
async function findOwnedClip(req) {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  return Clip.findOne({ _id: req.params.id, ownerId: req.auth.sub }).select(CLIP_HIDDEN_FIELDS);
}

function unknownClip(req, res) {
  console.warn(`[clips] Clip introuvable ou interdit : ${req.params.id}`);
  return res.status(404).json({ message: "Clip inconnu" });
}

/** Associe chaque identifiant d'utilisateur à son nom public. */
async function loadUserNames(ids) {
  const unique = [...new Set(ids.map(String))].filter((id) => mongoose.isValidObjectId(id));
  if (unique.length === 0) return new Map();
  const users = await User.find({ _id: { $in: unique } }).select("name").lean();
  return new Map(users.map((user) => [String(user._id), user.name]));
}

/** Détail public d'un clip vu par l'utilisateur connecté. */
async function publicClip(req, clip) {
  const userNames = await loadUserNames(clipUserIds(clip));
  return clip.toPublic({ viewerId: req.auth.sub, userNames });
}

/** Résumés publics d'une liste de clips (documents ou objets bruts). */
async function publicSummaries(req, clips) {
  const userNames = await loadUserNames(clips.map((clip) => clip.ownerId));
  return clips.map((clip) => toPublicClip(clip, { viewerId: req.auth.sub, userNames }));
}

/** Chemins disque des fichiers d'un clip (vidéo et pellicule éventuelle). */
const clipFilePaths = (clip) =>
  [clip.storedName, clip.filmstripStoredName].filter(Boolean).map((name) => path.join(UPLOADS, name));

/**
 * Envoie un fichier d'un clip avec son type et nosniff ; un fichier absent du
 * disque donne un 404 JSON au lieu d'un 500.
 */
function sendClipFile(res, next, { clipId, storedName, mimeType, missingMessage }) {
  res.type(mimeType);
  res.set("X-Content-Type-Options", "nosniff");
  res.sendFile(path.join(UPLOADS, storedName), (error) => {
    if (error) {
      console.error(`[clips] Erreur d'envoi du fichier ${mimeType} du clip ${clipId}`, error);
      if (error.code === "ENOENT" && !res.headersSent) {
        res.removeHeader("Content-Type");
        res.removeHeader("X-Content-Type-Options");
        return res.status(404).json({ message: missingMessage });
      }
      if (!res.headersSent) next(error);
      return;
    }
    console.log(`[clips] Fichier ${mimeType} envoyé : ${clipId}`);
  });
}

/** Lit les premiers octets d'un fichier pour en vérifier la signature. */
async function readFileHead(filePath, length) {
  const handle = await fsPromises.open(filePath, "r");
  try {
    const bytes = Buffer.alloc(length);
    const { bytesRead } = await handle.read(bytes, 0, length, 0);
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Identifie MP4 (boîte `ftyp` et marque majeure connue) ou WebM (en-tête EBML) par les premiers octets du fichier. */
async function detectVideoType(filePath) {
  const bytes = await readFileHead(filePath, VIDEO_SIGNATURE_LENGTH);
  if (
    bytes.length >= VIDEO_SIGNATURE_LENGTH &&
    bytes.toString("latin1", 4, 8) === "ftyp" &&
    MP4_MAJOR_BRANDS.has(bytes.toString("latin1", 8, 12))
  ) {
    return "video/mp4";
  }
  if (bytes.subarray(0, WEBM_SIGNATURE.length).equals(WEBM_SIGNATURE)) return "video/webm";
  return null;
}

/** Refuse une pellicule trop lourde ou dont les octets ne sont pas ceux d'un JPEG. */
async function checkFilmstrip(file) {
  if (file.size > MAX_FILMSTRIP_SIZE) throw new HttpError(400, FILMSTRIP_TOO_LARGE);
  const bytes = await readFileHead(file.path, JPEG_SIGNATURE_LENGTH);
  if (bytes.length < JPEG_SIGNATURE_LENGTH || detectImageType(bytes) !== "image/jpeg") {
    throw new HttpError(400, "Pellicule invalide : JPEG attendu");
  }
}

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteInRange = (value, min, max) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

/** Vérifie qu'un tableau de temps est court, fini, trié et compris dans [0, durée]. */
function validateTimes(values, durationSec, name, maxLength = MAX_ANALYSIS_POINTS) {
  if (!Array.isArray(values) || values.length > maxLength) {
    throw new HttpError(400, `Analyse invalide : ${name} doit être un tableau de ${maxLength} valeurs maximum`);
  }
  values.forEach((value, index) => {
    const valid =
      isFiniteInRange(value, 0, durationSec) && (index === 0 || value >= values[index - 1]);
    if (!valid) {
      throw new HttpError(400, `Analyse invalide : ${name} doit contenir des temps triés dans [0, durée]`);
    }
  });
  return values;
}

function validateDiffs(values) {
  if (!Array.isArray(values) || values.length > MAX_DIFFS) {
    throw new HttpError(400, `Analyse invalide : diffs doit être un tableau de ${MAX_DIFFS} valeurs maximum`);
  }
  if (!values.every((value) => isFiniteInRange(value, 0, 1))) {
    throw new HttpError(400, "Analyse invalide : diffs doit contenir des valeurs dans [0, 1]");
  }
  return values;
}

function validatePalette(values) {
  if (!Array.isArray(values) || values.length > MAX_PALETTE_COLORS) {
    throw new HttpError(400, `Analyse invalide : palette doit contenir ${MAX_PALETTE_COLORS} couleurs maximum`);
  }
  if (!values.every((value) => typeof value === "string" && HEX_COLOR.test(value))) {
    throw new HttpError(400, "Analyse invalide : palette doit contenir des couleurs #rrggbb");
  }
  return values.map((value) => value.toLowerCase());
}

function validateTransitions(values, durationSec) {
  if (!Array.isArray(values) || values.length > MAX_ANALYSIS_POINTS) {
    throw new HttpError(400, `Analyse invalide : transitions doit être un tableau de ${MAX_ANALYSIS_POINTS} valeurs maximum`);
  }
  values.forEach((transition, index) => {
    const valid =
      isPlainObject(transition) &&
      Object.keys(transition).length === 2 &&
      TRANSITION_KINDS.includes(transition.kind) &&
      isFiniteInRange(transition.time, 0, durationSec) &&
      (index === 0 || transition.time >= values[index - 1].time);
    if (!valid) {
      throw new HttpError(400, "Analyse invalide : transitions doit contenir des {time, kind} triés dans [0, durée]");
    }
  });
  return values.map(({ time, kind }) => ({ time, kind }));
}

/** Valeurs par défaut d'une analyse v1 convertie en v2 à l'écriture. */
const legacyAnalysisFields = (cuts) => ({
  fps: DEFAULT_FPS,
  diffs: [],
  palette: [],
  transitions: cuts.map((time) => ({ time, kind: "cut" })),
  thumbnailTimes: [],
  sensitivity: DEFAULT_SENSITIVITY,
});

function validateAnalysisV2Fields(analysis) {
  const { durationSec, fps, sensitivity } = analysis;
  if (!isFiniteInRange(fps, MIN_FPS, MAX_FPS)) {
    throw new HttpError(400, `Analyse invalide : fps entre ${MIN_FPS} et ${MAX_FPS} attendu`);
  }
  if (!isFiniteInRange(sensitivity, MIN_SENSITIVITY, MAX_SENSITIVITY)) {
    throw new HttpError(400, `Analyse invalide : sensitivity entre ${MIN_SENSITIVITY} et ${MAX_SENSITIVITY} attendue`);
  }
  return {
    fps,
    diffs: validateDiffs(analysis.diffs),
    palette: validatePalette(analysis.palette),
    transitions: validateTransitions(analysis.transitions, durationSec),
    thumbnailTimes: validateTimes(analysis.thumbnailTimes, durationSec, "thumbnailTimes", MAX_THUMBNAILS),
    sensitivity,
  };
}

/** Durée totale (s) de l'union des fenêtres [b - w, b + w] bornées à [0, durée]. */
function coveredDuration(beats, durationSec, windowSec) {
  let covered = 0;
  let end = 0;
  for (const beat of [...beats].sort((a, b) => a - b)) {
    const start = Math.max(0, beat - windowSec, end);
    const stop = Math.min(durationSec, beat + windowSec);
    if (stop > start) {
      covered += stop - start;
      end = stop;
    }
  }
  return covered;
}

/**
 * Portage de frontend-starter/src/app/shared/analysis/sync-score.ts : le score
 * fourni par le client n'est pas fiable, le serveur le recalcule.
 */
function computeSyncScore(cuts, beats, durationSec, windowSec = SYNC_WINDOW_SEC) {
  if (cuts.length === 0 || beats.length === 0 || !(durationSec > 0)) return null;

  const hits = cuts.filter((cut) => beats.some((beat) => Math.abs(cut - beat) <= windowSec)).length;
  const hitRate = hits / cuts.length;
  const chanceRate = Math.min(1, coveredDuration(beats, durationSec, windowSec) / durationSec);
  if (chanceRate === 0) return hitRate > 0 ? MAX_SYNC_SCORE : 0;
  return Math.min(MAX_SYNC_SCORE, hitRate / chanceRate);
}

/** Lit le champ texte multipart `analysis` (JSON). */
function readAnalysisField(raw) {
  if (typeof raw !== "string" || !raw) throw new HttpError(400, "Analyse requise");
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Analyse invalide : JSON attendu");
  }
}

/**
 * Valide une analyse v1 ou v2 (clés connues, toutes requises, bornes, tri)
 * et renvoie les champs à stocker, toujours au format v2. Les statistiques
 * (syncScore, cutCount, avgShotLength) sont recalculées ici.
 */
function validateAnalysis(analysis) {
  if (!isPlainObject(analysis)) throw new HttpError(400, "Analyse invalide : objet attendu");
  const keys = ANALYSIS_KEYS_BY_VERSION.get(analysis.version);
  if (!keys) throw new HttpError(400, "Analyse invalide : version non prise en charge");
  if (Object.keys(analysis).some((key) => !keys.includes(key))) {
    throw new HttpError(400, "Analyse invalide : champ inattendu");
  }
  const missing = keys.find((key) => !Object.hasOwn(analysis, key));
  if (missing) throw new HttpError(400, `Analyse invalide : champ ${missing} requis`);

  const { durationSec, syncScore } = analysis;
  if (!isFiniteInRange(durationSec, 0, MAX_CLIP_DURATION_SEC) || durationSec === 0) {
    throw new HttpError(400, `Analyse invalide : durée entre 0 et ${MAX_CLIP_DURATION_SEC} s attendue`);
  }
  if (syncScore !== null && !isFiniteInRange(syncScore, 0, MAX_SYNC_SCORE)) {
    throw new HttpError(400, `Analyse invalide : syncScore entre 0 et ${MAX_SYNC_SCORE} ou null attendu`);
  }

  const cuts = validateTimes(analysis.cuts, durationSec, "cuts");
  const beats = validateTimes(analysis.beats, durationSec, "beats");
  const v2Fields =
    analysis.version === ANALYSIS_VERSION
      ? validateAnalysisV2Fields(analysis)
      : legacyAnalysisFields(cuts);
  return {
    analysisVersion: ANALYSIS_VERSION,
    durationSec,
    cuts,
    beats,
    ...v2Fields,
    syncScore: computeSyncScore(cuts, beats, durationSec),
    cutCount: cuts.length,
    avgShotLength: durationSec / (cuts.length + 1),
  };
}

/** Normalise une étiquette (rognée, minuscules) ; null si elle est hors contrat. */
function normalizeTag(value) {
  if (typeof value !== "string") return null;
  const tag = value.trim().toLowerCase();
  const valid = tag.length >= 1 && tag.length <= CLIP_TAG_MAX_LENGTH && !CONTROL_CHARACTERS.test(tag);
  return valid ? tag : null;
}

/** Valide une liste d'étiquettes : doublons retirés, 5 maximum. */
function validateTags(values) {
  if (!Array.isArray(values)) throw new HttpError(400, "Étiquettes invalides : tableau attendu");
  const tags = [];
  for (const value of values) {
    const tag = normalizeTag(value);
    if (!tag) {
      throw new HttpError(400, `Étiquette invalide : 1 à ${CLIP_TAG_MAX_LENGTH} caractères attendus`);
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > CLIP_TAG_MAX_COUNT) {
    throw new HttpError(400, `Étiquettes limitées à ${CLIP_TAG_MAX_COUNT}`);
  }
  return tags;
}

/** Lit le champ multipart optionnel `tags` (JSON `string[]`). */
function readTagsField(raw) {
  if (raw === undefined || raw === "") return [];
  if (typeof raw !== "string") throw new HttpError(400, "Étiquettes invalides : tableau JSON attendu");
  let tags;
  try {
    tags = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Étiquettes invalides : tableau JSON attendu");
  }
  return validateTags(tags);
}

function validateVisibility(value) {
  if (!CLIP_VISIBILITIES.includes(value)) {
    throw new HttpError(400, "Visibilité invalide : private, shared ou public attendu");
  }
  return value;
}

function validateTitle(value) {
  const title = typeof value === "string" ? value.trim() : "";
  if (!title || title.length > CLIP_TITLE_MAX_LENGTH) {
    throw new HttpError(400, `Titre invalide : 1 à ${CLIP_TITLE_MAX_LENGTH} caractères attendus`);
  }
  return title;
}

/** Valide la forme de `sharedWith` : identifiants distincts ; l'amitié est vérifiée ensuite. */
function validateSharedWith(values) {
  if (!Array.isArray(values) || values.some((id) => typeof id !== "string" || !mongoose.isValidObjectId(id))) {
    throw new HttpError(400, "Partage invalide : tableau d'identifiants attendu");
  }
  const ids = [...new Set(values)];
  if (ids.length > MAX_SHARED_WITH) {
    throw new HttpError(400, `Partage limité à ${MAX_SHARED_WITH} destinataires`);
  }
  return ids;
}

/** Valide un `ClipPatch` ; l'amitié des destinataires de `sharedWith` est vérifiée par la route. */
function parseClipPatch(body) {
  if (!isPlainObject(body)) throw new HttpError(400, "Corps JSON attendu");
  if (Object.keys(body).some((key) => !CLIP_PATCH_KEYS.includes(key))) {
    throw new HttpError(400, "Modification invalide : champ inattendu");
  }
  const changes = {};
  if (Object.hasOwn(body, "title")) changes.title = validateTitle(body.title);
  if (Object.hasOwn(body, "tags")) changes.tags = validateTags(body.tags);
  if (Object.hasOwn(body, "visibility")) changes.visibility = validateVisibility(body.visibility);
  if (Object.hasOwn(body, "sharedWith")) changes.sharedWith = validateSharedWith(body.sharedWith);
  return changes;
}

/**
 * Après l'enregistrement, retire les destinataires dont l'amitié a disparu
 * entre-temps (retrait concurrent), par une mise à jour conditionnelle.
 */
async function dropFormerFriends(clip) {
  const friends = new Set((await friendIdsOf(clip.ownerId)).map(String));
  const former = clip.sharedWith.filter((id) => !friends.has(String(id)));
  if (former.length === 0) return;
  await Clip.updateOne({ _id: clip._id, ownerId: clip.ownerId }, { $pullAll: { sharedWith: former } });
  clip.sharedWith = clip.sharedWith.filter((id) => friends.has(String(id)));
  console.warn(`[clips] ${former.length} destinataire(s) retiré(s) du partage de ${clip.id} : amitié terminée`);
}

/** Refuse tout destinataire qui n'est pas un ami accepté du propriétaire. */
async function checkRecipientsAreFriends(ownerId, ids) {
  if (ids.length === 0) return;
  const friends = new Set((await friendIdsOf(ownerId)).map(String));
  if (ids.some((id) => !friends.has(id))) {
    throw new HttpError(400, "Partage invalide : seuls vos amis peuvent être destinataires");
  }
}

/** Valide `{time, text}` d'une annotation ; `time` doit tomber dans le clip. */
function parseAnnotation(body, durationSec) {
  if (!isPlainObject(body)) throw new HttpError(400, "Corps JSON attendu");
  if (Object.keys(body).some((key) => !ANNOTATION_KEYS.includes(key))) {
    throw new HttpError(400, "Annotation invalide : champ inattendu");
  }
  if (!isFiniteInRange(body.time, 0, durationSec)) {
    throw new HttpError(400, "Annotation invalide : temps dans [0, durée] attendu");
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > ANNOTATION_TEXT_MAX_LENGTH) {
    throw new HttpError(400, `Annotation invalide : texte de 1 à ${ANNOTATION_TEXT_MAX_LENGTH} caractères attendu`);
  }
  return { time: body.time, text };
}

/** Filtres de liste `q`, `tag` et `visibility`, validés avant toute requête MongoDB. */
function parseClipFilters(query) {
  const rawSearch = query.q ?? "";
  if (typeof rawSearch !== "string") throw new HttpError(400, "Paramètre de recherche invalide");
  const search = rawSearch.trim();
  if (search.length > MAX_QUERY_LENGTH) {
    throw new HttpError(400, `Recherche limitée à ${MAX_QUERY_LENGTH} caractères`);
  }
  let tag = null;
  if (query.tag !== undefined && query.tag !== "") {
    tag = normalizeTag(query.tag);
    if (!tag) throw new HttpError(400, "Étiquette de filtre invalide");
  }
  let visibility = null;
  if (query.visibility !== undefined && query.visibility !== "") {
    visibility = validateVisibility(query.visibility);
  }
  return { search, tag, visibility };
}

/** Traduit les filtres en `$match` ; un ancien clip sans visibilité est privé. */
function clipFilterMatch({ search, tag, visibility }) {
  const match = {};
  if (search) match.title = { $regex: escapeRegex(search), $options: "i" };
  if (tag) match.tags = tag;
  if (visibility) match.visibility = visibility === "private" ? { $in: [null, "private"] } : visibility;
  return match;
}

/** Étapes communes des listes : drapeau hasFilmstrip puis retrait des champs lourds. */
const clipSummaryStages = () => [
  { $addFields: { hasFilmstrip: { $eq: [{ $type: "$filmstripStoredName" }, "string"] } } },
  { $project: Object.fromEntries(CLIP_SUMMARY_EXCLUDED.map((field) => [field, 0])) },
];

/** Paramètres de `GET /clips/discover` : portée, tri et filtres de liste. */
function parseDiscoverQuery(query) {
  const scope = query.scope ?? "public";
  if (!DISCOVER_SCOPES.includes(scope)) {
    throw new HttpError(400, "Portée invalide : public, friends ou shared attendu");
  }
  const sort = query.sort ?? "recent";
  if (typeof sort !== "string" || !Object.hasOwn(DISCOVER_SORTS, sort)) {
    throw new HttpError(400, "Tri invalide : recent, nervous ou synced attendu");
  }
  if (query.visibility !== undefined) throw new HttpError(400, "Filtre de visibilité non disponible ici");
  return { scope, sort, filters: parseClipFilters(query) };
}

/** `$match` des clips d'autrui visibles dans une portée de découverte. */
function discoverMatch(scope, viewerId, friendIds) {
  if (scope === "public") return { ownerId: { $ne: viewerId }, visibility: "public" };
  if (scope === "shared") return { ownerId: { $in: friendIds }, visibility: "shared", sharedWith: viewerId };
  return {
    ownerId: { $in: friendIds },
    $or: [{ visibility: "public" }, { visibility: "shared", sharedWith: viewerId }],
  };
}

/** Écarte les clips sans valeur pour le tri demandé (sans coupe, sans score). */
function discoverSortMatch(sort) {
  if (sort === "nervous") return { cutCount: { $gt: 0 } };
  if (sort === "synced") return { syncScore: { $ne: null } };
  return {};
}

function parseActivityLimit(query) {
  if (query.limit === undefined) return DEFAULT_ACTIVITY_LIMIT;
  const limit = Number(query.limit);
  if (typeof query.limit !== "string" || !Number.isInteger(limit) || limit < 1 || limit > MAX_ACTIVITY_LIMIT) {
    throw new HttpError(400, `Limite invalide : entier de 1 à ${MAX_ACTIVITY_LIMIT} attendu`);
  }
  return limit;
}

function parseInvitationEmail(body) {
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new HttpError(400, "E-mail invalide");
  }
  return email;
}

/** Nom et e-mail des utilisateurs cités, réservés aux parties d'une relation. */
async function loadFriendUsers(ids) {
  const unique = [...new Set(ids.map(String))];
  if (unique.length === 0) return new Map();
  const users = await User.find({ _id: { $in: unique } }).select("name email").lean();
  return new Map(users.map((user) => [String(user._id), user]));
}

const toFriendUser = (id, users) => {
  const user = users.get(String(id));
  return { id: String(id), name: user?.name ?? "Utilisateur inconnu", email: user?.email ?? "" };
};

const toFriendEntry = (friendship, viewerId, users) => ({
  friendshipId: String(friendship._id),
  user: toFriendUser(otherParty(friendship, viewerId), users),
  since: friendship.acceptedAt,
});

/** Demande reçue : l'émetteur est connu du destinataire, qui voit son nom. */
const toIncomingRequest = (friendship, users) => ({
  id: String(friendship._id),
  user: toFriendUser(friendship.requester, users),
  direction: "incoming",
  createdAt: friendship.createdAt,
});

/**
 * Demande envoyée : seule l'adresse saisie est renvoyée, avec l'id de la
 * demande, pour qu'un compte existant soit indiscernable d'une adresse inconnue.
 */
const toOutgoingRequest = (friendship) => ({
  id: String(friendship._id),
  user: { id: String(friendship._id), name: friendship.recipientEmail, email: friendship.recipientEmail },
  direction: "outgoing",
  createdAt: friendship.createdAt,
});

/** E-mail du JWT normalisé : il désigne les invitations reçues. */
const viewerEmail = (req) => String(req.auth.email ?? "").trim().toLowerCase();

/** Vrai si l'appelant connaît déjà une relation avec ce compte (amitié ou demande reçue). */
async function hasKnownRelation(req, email) {
  const target = await User.findOne({ email }).select("_id").lean();
  if (!target) return false;
  const [friends, incoming] = await Promise.all([
    Friendship.exists({ pairKey: pairKeyOf(req.auth.sub, target._id), status: "accepted" }),
    Friendship.exists({ requester: target._id, recipientEmail: viewerEmail(req), status: "pending" }),
  ]);
  return Boolean(friends || incoming);
}
/** Clips récents de mes amis que je peux lire (publics ou partagés avec moi). */
async function friendClipEvents(viewerId, friendIds, limit) {
  if (friendIds.length === 0) return [];
  const clips = await Clip.find(discoverMatch("friends", viewerId, friendIds))
    .select("title ownerId createdAt")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  return clips.map((clip) => ({
    id: `clip-${clip._id}`,
    type: "clip",
    actorId: clip.ownerId,
    clipId: String(clip._id),
    clipTitle: clip.title,
    at: clip.createdAt,
  }));
}

/** Dernières annotations laissées par d'autres utilisateurs sur mes clips (agrégation bornée). */
async function annotationEvents(viewerId, limit) {
  const rows = await Clip.aggregate([
    { $match: { ownerId: viewerId, annotations: { $elemMatch: { authorId: { $ne: viewerId } } } } },
    { $project: { title: 1, annotations: 1 } },
    { $unwind: "$annotations" },
    { $match: { "annotations.authorId": { $ne: viewerId } } },
    { $sort: { "annotations.createdAt": -1 } },
    { $limit: limit },
  ]);
  return rows.map(({ _id, title, annotations: annotation }) => ({
    id: `annotation-${annotation._id}`,
    type: "annotation",
    actorId: annotation.authorId,
    clipId: String(_id),
    clipTitle: title,
    text: annotation.text,
    at: annotation.createdAt,
  }));
}

const friendEvents = (friendships, viewerId) =>
  friendships.map((friendship) => ({
    id: `friend-${friendship._id}`,
    type: "friend",
    actorId: otherParty(friendship, viewerId),
    at: friendship.acceptedAt,
  }));

const byRecentEvent = (a, b) => new Date(b.at) - new Date(a.at);

function parsePagination(query) {
  return {
    page: Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(query.page)) || 1)),
    limit: Math.min(20, Math.max(1, Math.floor(Number(query.limit)) || 5)),
  };
}

/** Forme `Page<T>` du contrat à partir d'un résultat aggregatePaginate. */
const toPage = (result, items) => ({
  items,
  page: result.page,
  limit: result.limit,
  total: result.totalDocs,
  pages: result.totalPages,
  hasPrevPage: result.hasPrevPage,
  hasNextPage: result.hasNextPage,
  prevPage: result.prevPage,
  nextPage: result.nextPage,
});

/** Clip gagnant d'un classement de ma bibliothèque : tri puis limite côté MongoDB. */
async function topClip(req, ownerId, match, sort) {
  const [clip] = await Clip.aggregate([
    { $match: { ownerId, ...match } },
    { $sort: sort },
    { $limit: 1 },
    ...clipSummaryStages(),
  ]);
  return clip ? (await publicSummaries(req, [clip]))[0] : null;
}

/**
 * Statistiques de ma bibliothèque calculées par MongoDB. Le plan moyen global
 * vaut durée totale / nombre total de plans ; à égalité, le plus récent l'emporte.
 */
async function computeLibraryStats(req) {
  const ownerId = new mongoose.Types.ObjectId(req.auth.sub);
  const [groups, mostNervous, mostSynced] = await Promise.all([
    Clip.aggregate([
      { $match: { ownerId } },
      {
        $group: {
          _id: { $ifNull: ["$visibility", "private"] },
          clipCount: { $sum: 1 },
          totalDurationSec: { $sum: "$durationSec" },
          totalCuts: { $sum: "$cutCount" },
        },
      },
    ]),
    topClip(req, ownerId, {}, { avgShotLength: 1, createdAt: -1 }),
    topClip(req, ownerId, { syncScore: { $ne: null } }, { syncScore: -1, createdAt: -1 }),
  ]);
  const byVisibility = Object.fromEntries(CLIP_VISIBILITIES.map((visibility) => [visibility, 0]));
  let clipCount = 0;
  let totalDurationSec = 0;
  let totalCuts = 0;
  for (const group of groups) {
    byVisibility[group._id] = group.clipCount;
    clipCount += group.clipCount;
    totalDurationSec += group.totalDurationSec;
    totalCuts += group.totalCuts;
  }
  return {
    clipCount,
    totalDurationSec,
    totalCuts,
    avgShotLength: clipCount ? totalDurationSec / (totalCuts + clipCount) : null,
    mostNervous,
    mostSynced,
    byVisibility,
  };
}

/** Mes étiquettes comptées par MongoDB : plus fréquentes d'abord, puis ordre alphabétique. */
async function countTags(ownerId) {
  const rows = await Clip.aggregate([
    { $match: { ownerId: new mongoose.Types.ObjectId(ownerId) } },
    { $unwind: "$tags" },
    { $group: { _id: "$tags", count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: MAX_TAGS_LISTED },
  ]);
  return rows.map(({ _id, count }) => ({ tag: _id, count }));
}

/** Échappe les métacaractères pour qu'une recherche reste une simple sous-chaîne. */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** N'accepte qu'une URL https, sans port ni identifiants, sur *.mzstatic.com. */
function parseAllowedCoverUrl(value) {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) return null;
  const url = URL.parse(value);
  const allowed =
    url?.protocol === "https:" &&
    url.hostname.endsWith(COVER_HOST_SUFFIX) &&
    url.port === "" &&
    !url.username &&
    !url.password;
  return allowed ? url : null;
}

/** Lit le corps d'une réponse en s'arrêtant dès que la taille maximale est dépassée. */
async function readLimitedBody(response) {
  if (Number(response.headers.get("content-length")) > MAX_COVER_SIZE) {
    throw new HttpError(400, COVER_TOO_LARGE);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > MAX_COVER_SIZE) throw new HttpError(400, COVER_TOO_LARGE);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Télécharge une image distante. Chaque redirection est suivie manuellement
 * et revalidée : une étape hors liste blanche interrompt le téléchargement.
 */
async function downloadCover(imageUrl) {
  let url = parseAllowedCoverUrl(imageUrl);
  if (!url) {
    throw new HttpError(400, "URL refusée : https et hôte *.mzstatic.com uniquement");
  }

  try {
    const signal = AbortSignal.timeout(REMOTE_TIMEOUT_MS);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      console.log(`[covers] Téléchargement depuis ${url.hostname}`);
      const response = await fetch(url, { redirect: "manual", signal });
      if (response.status < 300 || response.status >= 400) {
        if (!response.ok) {
          throw new HttpError(400, `Image distante inaccessible (${response.status})`);
        }
        return await readLimitedBody(response);
      }
      url = parseAllowedCoverUrl(
        URL.parse(response.headers.get("location") ?? "", url)?.href,
      );
      if (!url) throw new HttpError(400, "Redirection vers un hôte non autorisé");
    }
    throw new HttpError(400, "Trop de redirections");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("[covers] Téléchargement de l'image impossible", error);
    throw new HttpError(400, "Téléchargement de l'image impossible ou trop long");
  }
}

/** Convertit un résultat iTunes en candidat ; null si l'image n'est pas autorisée. */
function toCoverCandidate(result) {
  const artwork = String(result?.artworkUrl100 ?? "").replace("100x100bb", "600x600bb");
  if (!parseAllowedCoverUrl(artwork)) return null;
  return {
    id: String(result.trackId ?? result.collectionId ?? artwork),
    title: String(result.trackName ?? result.collectionName ?? ""),
    artist: String(result.artistName ?? ""),
    album: String(result.collectionName ?? ""),
    imageUrl: artwork,
  };
}

/** Interroge l'API publique iTunes Search (sans clé) et filtre les images. */
async function searchItunesCovers(term) {
  const url = new URL(ITUNES_SEARCH_URL);
  url.search = new URLSearchParams({
    term,
    media: "music",
    entity: "song",
    limit: String(ITUNES_RESULT_LIMIT),
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`iTunes Search a répondu ${response.status}`);
  const { results } = await response.json();
  return (Array.isArray(results) ? results : []).map(toCoverCandidate).filter(Boolean);
}

/**
 * Crée un jeton JWT contenant uniquement l'identité nécessaire à l'API.
 * Le mot de passe n'est jamais placé dans le token. `sub` signifie subject
 * et contient l'identifiant MongoDB de l'utilisateur.
 */
function token(user) {
  console.log(`[auth] Création d'un token pour l'utilisateur ${user.id}`);
  return jwt.sign({ sub: user.id, email: user.email }, SECRET, {
    expiresIn: "2h",
  });
}

/** Middleware Express qui protège les routes privées. */
function auth(req, res, next) {
  const raw = req.headers.authorization;

  // Le token est transmis dans l'en-tête Authorization sous la forme
    // "Authorization: Bearer <token>". Le préfixe "Bearer " est obligatoire pour que
    // le middleware sache qu'il s'agit d'un JWT et non d'un autre type de jeton.
  if (!raw?.startsWith("Bearer ")) {
    console.warn(`[auth] Authorization absente pour ${req.method} ${req.path}`);
    return res.status(401).json({ message: "Authentification requise" });
  }

  try {
    // jwt.verify vérifie la signature et la date d'expiration du token.
    // On ne logue jamais sa valeur, car un JWT permettrait une usurpation.
    req.auth = jwt.verify(raw.slice(7), SECRET);
    console.log(`[auth] Token accepté pour ${req.auth.sub}`);
    next();
  } catch (error) {
    console.error("[auth] Token invalide ou expiré", error);
    return res.status(401).json({ message: "Jeton invalide ou expiré" });
  }
}

/*
 * Multer transforme une requête HTTP multipart/form-data en données exploitables
 * par Express et traite les fichiers envoyés par un formulaire HTML.
 * Documentation officielle : https://github.com/expressjs/multer
 *
 * diskStorage indique que Multer écrit directement le fichier sur disque.
 * Chaque callback doit appeler cb(error, value) : null signifie qu'il n'y a
 * pas d'erreur. Le nom aléatoire évite les collisions entre utilisateurs.
 */
const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    console.debug(`[multer] Destination sélectionnée : ${UPLOADS}`);
    callback(null, UPLOADS);
  },
  filename: (_request, file, callback) => {
    // Une extension longue ou exotique est abandonnée (ENAMETOOLONG, caractères spéciaux).
    const extension = path.extname(file.originalname).toLowerCase();
    const filename =
      crypto.randomUUID() + (SAFE_EXTENSION.test(extension) ? extension : "");
    console.log(`[multer] Nom de stockage généré pour ${file.originalname}`);
    callback(null, filename);
  },
});

/*
 * limits.fileSize protège le serveur contre les fichiers trop volumineux.
 * fileFilter est appelé avant l'enregistrement : accepter le fichier appelle
 * callback(null, true), le refuser transmet une vraie Error à Express.
 */
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_request, file, callback) => {
    // La pochette optionnelle est validée après réception par ses octets magiques.
    if (file.fieldname === "cover") return callback(null, true);

    // Seuls les types MIME audio demandés dans le sujet sont acceptés.
    if (allowed.has(file.mimetype)) {
      console.log(`[multer] Type accepté : ${file.mimetype}`);
      return callback(null, true);
    }

    const error = new Error("Format audio non accepté");
    console.error(`[multer] Type refusé : ${file.mimetype}`, error);
    return callback(error);
  },
});

// Une pochette envoyée seule reste en mémoire (2 Mo max) : rien n'est écrit
// sur le disque avant la vérification de ses octets magiques.
const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_COVER_SIZE, files: 1 },
});

/** Taille maximale par champ de fichier d'un upload de clip. */
const CLIP_FIELD_SIZE_LIMITS = { video: MAX_VIDEO_SIZE, filmstrip: MAX_FILMSTRIP_SIZE };
const CLIP_FIELD_TOO_LARGE = { video: VIDEO_TOO_LARGE, filmstrip: FILMSTRIP_TOO_LARGE };
const CLIP_UPLOAD_LIMITS = {
  fileSize: MAX_VIDEO_SIZE,
  files: 2,
  fields: 8,
  fieldSize: 256 * 1024,
  parts: 10,
};
const CLIP_LIMIT_MESSAGES = {
  LIMIT_FIELD_COUNT: "Formulaire invalide : trop de champs",
  LIMIT_FIELD_VALUE: "Formulaire invalide : champ texte trop long (256 ko maximum)",
  LIMIT_PART_COUNT: "Formulaire invalide : trop de parties",
  LIMIT_FILE_COUNT: "Formulaire invalide : trop de fichiers",
  LIMIT_FIELD_KEY: "Formulaire invalide : nom de champ trop long",
};

/*
 * Moteur de stockage des clips : écrit sous un nom aléatoire comme
 * diskStorage, mais coupe l'écriture dès qu'un champ dépasse sa propre limite.
 * Une pellicule s'arrête donc à 1 Mo au lieu des 50 Mo admis pour la vidéo.
 */
const clipStorage = {
  _handleFile(_request, file, callback) {
    const limit = CLIP_FIELD_SIZE_LIMITS[file.fieldname];
    const extension = path.extname(file.originalname).toLowerCase();
    const filename = crypto.randomUUID() + (SAFE_EXTENSION.test(extension) ? extension : "");
    const destination = path.join(UPLOADS, filename);
    const output = fs.createWriteStream(destination, { flags: "wx" });
    let size = 0;
    let failed = false;
    const fail = (error) => {
      if (failed) return;
      failed = true;
      file.stream.unpipe(output);
      file.stream.resume();
      output.destroy();
      fsPromises.rm(destination, { force: true }).then(
        () => callback(error),
        (removeError) => {
          console.error(`[multer] Fichier partiel non supprimé : ${destination}`, removeError);
          callback(error);
        },
      );
    };
    file.stream.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        console.warn(`[multer] Champ ${file.fieldname} trop volumineux, écriture interrompue`);
        fail(new HttpError(400, CLIP_FIELD_TOO_LARGE[file.fieldname]));
      }
    });
    file.stream.on("error", fail);
    output.on("error", fail);
    output.on("finish", () => {
      if (!failed) callback(null, { destination: UPLOADS, filename, path: destination, size });
    });
    file.stream.pipe(output);
  },
  _removeFile(_request, file, callback) {
    fsPromises.rm(file.path, { force: true }).then(() => callback(null), callback);
  },
};

// Instance distincte : les limites et formats vidéo ne doivent pas toucher l'upload audio.
const clipUpload = multer({
  storage: clipStorage,
  limits: CLIP_UPLOAD_LIMITS,
  fileFilter: (_request, file, callback) => {
    // La pellicule optionnelle est validée après réception par ses octets JPEG.
    if (file.fieldname === "filmstrip") return callback(null, true);
    if (VIDEO_MIME_TYPES.has(file.mimetype)) return callback(null, true);
    console.warn(`[multer] Type vidéo refusé : ${file.mimetype}`);
    return callback(new HttpError(400, "Format vidéo non accepté (MP4 ou WebM)"));
  },
});

/** Reçoit les champs multipart `video` et `filmstrip` et traduit le dépassement de taille. */
function receiveClipFiles(req, res, next) {
  const fields = [
    { name: "video", maxCount: 1 },
    { name: "filmstrip", maxCount: 1 },
  ];
  clipUpload.fields(fields)(req, res, (error) => {
    if (error?.code === "LIMIT_FILE_SIZE") {
      return next(new HttpError(400, error.field === "filmstrip" ? FILMSTRIP_TOO_LARGE : VIDEO_TOO_LARGE));
    }
    if (CLIP_LIMIT_MESSAGES[error?.code]) {
      console.warn(`[multer] Upload de clip refusé : ${error.code}`);
      return next(new HttpError(400, CLIP_LIMIT_MESSAGES[error.code]));
    }
    next(error);
  });
}

/** Reçoit le champ multipart `cover` et traduit le dépassement de taille. */
function receiveCover(req, res, next) {
  coverUpload.single("cover")(req, res, (error) => {
    if (error?.code === "LIMIT_FILE_SIZE") return next(new HttpError(400, COVER_TOO_LARGE));
    next(error);
  });
}

/**
 * Construit l'application Express sans ouvrir de port.
 * Cette séparation permet au serveur réel et aux tests de créer la même
 * application. Le port est ouvert uniquement dans server.js.
 */
export function createApp() {
  const app = express();

  // Journaliser la fin de chaque requête permet de suivre méthode, URL,
  // statut et durée sans exposer les corps contenant des mots de passe.
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      console.log(
        `[http] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt} ms)`,
      );
    });
    next();
  });

  // CORS est nécessaire pour que le frontend Angular puisse appeler l'API.
  // C'est-à-dire que le navigateur autorise les requêtes cross-origin depuis localhost:4200.
  // Dans un vrai projet, il est recommandé de limiter les origines autorisées.
  app.use(cors());

  // Express ne gère pas nativement le JSON : ce middleware transforme le corps JSON en objet JavaScript 
  // accessible via req.body.
  // Il est placé avant les routes pour que toutes les requêtes JSON soient traitées.
  // L'analyse retouchée a sa propre limite ; le parseur global saute alors ce corps déjà lu.
  app.use("/api/clips/:id/analysis", express.json({ limit: ANALYSIS_BODY_LIMIT }));
  app.use(express.json());

  /** Endpoint public utilisé pour vérifier que l'API répond. */
  app.get("/api/health", (_req, res) => {
    console.log("[health] Vérification de l'API");
    res.json({ status: "ok" });
  });

  /** Requête POST pour "insertion" de donnée.
   * Inscrit un utilisateur et renvoie un token avec ses données publiques. 
   * @param {Object} req - La requête HTTP.
   * @param {Object} res - La réponse HTTP.
   * @param {Function} next - La fonction de middleware suivante.
   */
  app.post("/api/auth/register", async (req, res, next) => {
    try {
      const { name, email, password } = req.body || {};
      console.log(`[auth] Tentative d'inscription pour ${email || "email absent"}`);

      if (!name || !email || !password || password.length < 8) {
        console.warn("[auth] Inscription refusée : données invalides ou incomplètes");
        return res.status(400).json({
          message: "Nom, email et mot de passe de 8 caractères requis",
        });
      }

      // Vérifie si l'email est déjà utilisé avant de créer un nouvel utilisateur.
      if (await User.exists({ email: String(email).toLowerCase() })) {
        console.warn(`[auth] Email déjà utilisé : ${email}`);
        return res.status(409).json({ message: "Email déjà utilisé" });
      }

      // Crée l'utilisateur et le stocke dans MongoDB. Le mot de passe est haché
      // par le hook pre('validate') défini dans le schéma Mongoose.
      const user = await User.create({ name, email, password });
      console.log(`[auth] Utilisateur créé : ${user.id}`);
      res.status(201).json({ token: token(user), user: user.toPublic() });
    } catch (error) {
      console.error("[auth] Erreur pendant l'inscription", error);
      next(error);
    }
  });

  /** Vérifie les identifiants et ouvre une session JWT. Les identifiants sont envoyés dans le corps de la 
   * requête par un HTTP POST. */
  app.post("/api/auth/login", async (req, res, next) => {
    try {
        // req.body est déjà un objet JavaScript grâce au middleware express.json() placé plus haut.
        // il contient les champs email et password envoyés par le frontend Angular.
      const email = String(req.body?.email || "").toLowerCase();
      console.log(`[auth] Tentative de connexion pour ${email || "email absent"}`);

      // Sélectionne le mot de passe haché pour vérifier les identifiants.
      // User est un modèle Mongoose qui correspond au schéma défini dans models/User.js.
      // on envoie les requête à MongoDB via cet objet. Le mot de passe haché est stocké dans 
      // passwordHash, mais il n'est pas renvoyé par défaut dans les requêtes pour 
      // des raisons de sécurité.
      const user = await User.findOne({ email }).select("+passwordHash");

      if (!user || !(await user.verifyPassword(req.body?.password || ""))) {
        console.warn(`[auth] Identifiants incorrects pour ${email}`);
        return res.status(401).json({ message: "Identifiants incorrects" });
      }

      console.log(`[auth] Connexion réussie : ${user.id}`);
      res.json({ token: token(user), user: user.toPublic() });
    } catch (error) {
      console.error("[auth] Erreur pendant la connexion", error);
      next(error);
    }
  });

  /** Retourne le profil public de l'utilisateur identifié par le JWT. 
   * Les paramètres sont :
   * @param auth - Le middleware qui vérifie le JWT et ajoute req.auth. 
   * @param {Object} req - La requête HTTP.
   * @param {Object} res - La réponse HTTP.
   * @param {Function} next - La fonction de middleware suivante.
  */
  app.get("/api/users/me", auth, async (req, res, next) => {
    try {
        // req.auth.sub contient l'identifiant MongoDB de l'utilisateur 
        // extrait du JWT par le middleware auth. ici req.auth est un objet ajouté par le middleware 
        // auth à la requête, et sub est la propriété qui contient l'identifiant de l'utilisateur.
      const user = await User.findById(req.auth.sub);
      if (!user) {
        console.warn(`[user] Profil introuvable : ${req.auth.sub}`);
        return res.status(404).json({ message: "Utilisateur inconnu" });
      }

      console.log(`[user] Profil envoyé : ${user.id}`);
      res.json(user.toPublic());
    } catch (error) {
      console.error("[user] Erreur de lecture du profil", error);
      next(error);
    }
  });

  /** Modifie uniquement le nom de l'utilisateur connecté. */
  app.put("/api/users/me", auth, async (req, res, next) => {
    try {
      const user = await User.findByIdAndUpdate(
        req.auth.sub,
        { $set: { name: req.body?.name } },
        { new: true, runValidators: true },
      );

      if (!user) {
        console.warn(`[user] Mise à jour impossible : ${req.auth.sub}`);
        return res.status(404).json({ message: "Utilisateur inconnu" });
      }

      console.log(`[user] Nom mis à jour : ${user.id}`);
      res.json(user.toPublic());
    } catch (error) {
      console.error("[user] Erreur de mise à jour du profil", error);
      next(error);
    }
  });

  /** Retourne une page des pistes appartenant exclusivement à l'utilisateur. */
  app.get("/api/tracks", auth, async (req, res, next) => {
    try {
      const page = Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(req.query.page)) || 1));
      const limit = Math.min(20, Math.max(1, Math.floor(Number(req.query.limit)) || 5));
      const rawQuery = req.query.q ?? "";

      if (typeof rawQuery !== "string") {
        console.warn("[tracks] Paramètre q invalide");
        return res.status(400).json({ message: "Paramètre de recherche invalide" });
      }
      const search = rawQuery.trim();
      if (search.length > MAX_QUERY_LENGTH) {
        console.warn(`[tracks] Recherche trop longue (${search.length} caractères)`);
        return res.status(400).json({
          message: `Recherche limitée à ${MAX_QUERY_LENGTH} caractères`,
        });
      }

      console.log(
        `[tracks] Lecture page=${page}, limit=${limit}, filtre=${search ? "oui" : "non"}, user=${req.auth.sub}`,
      );

      // Dans un aggregate, Mongoose ne convertit pas les types : sans ObjectId
      // explicite, la chaîne du JWT ne correspondrait à aucune piste.
      const match = { ownerId: new mongoose.Types.ObjectId(req.auth.sub) };
      if (search) match.title = { $regex: escapeRegex(search), $options: "i" };

      // Les noms de fichiers disque ne sortent pas de MongoDB.
      const aggregate = Track.aggregate([
        { $match: match },
        { $project: { storedName: 0, coverStoredName: 0 } },
      ]);
      const result = await Track.aggregatePaginate(aggregate, {
        page,
        limit,
        sort: { createdAt: -1 },
      });

      console.log(`[tracks] ${result.docs.length} piste(s) envoyée(s) sur ${result.totalDocs}`);

      res.json({
        items: result.docs.map(toPublicTrack),
        page: result.page,
        limit: result.limit,
        total: result.totalDocs,
        pages: result.totalPages,
        hasPrevPage: result.hasPrevPage,
        hasNextPage: result.hasNextPage,
        prevPage: result.prevPage,
        nextPage: result.nextPage,
      });
    } catch (error) {
      console.error("[tracks] Erreur de pagination", error);
      next(error);
    }
  });

  /**
   * Reçoit le champ multipart audio et le champ texte title.
   * upload.single("audio") traite un seul fichier et le place dans req.file,
   * tandis que req.body.title contient le champ texte associé.
   * C'est ici qu'est fait l'upload de fichiers sur le serveur. 
   * Le middleware auth vérifie le JWT avant d'accepter l'upload.
   * Le middleware upload.single("audio") traite le fichier audio envoyé dans le champ "audio" du formulaire
   * ou de l'appel depuis le frontend avec un objet FormData.
   * Si le fichier est accepté, il est stocké sur le disque et ses métadonnées sont enregistrées 
   * dans MongoDB.
   */
  app.post(
    "/api/tracks",
    auth,
    upload.fields([
      { name: "audio", maxCount: 1 },
      { name: "cover", maxCount: 1 },
    ]),
    async (req, res, next) => {
      const audioFile = req.files?.audio?.[0];
      const coverFile = req.files?.cover?.[0];
      let cover = null;

      try {
        if (!audioFile) {
          console.warn(`[tracks] Upload sans fichier par ${req.auth.sub}`);
          if (coverFile) await removeFile(coverFile.path);
          return res.status(400).json({ message: "Fichier audio requis" });
        }

        // Une pochette fournie est prioritaire sur l'image embarquée dans les tags.
        if (coverFile) {
          cover = await storeCover(await takeUploadedCover(coverFile), "upload");
        }
        const tags = await readAudioTags(audioFile.path);
        cover ??= await storeId3Cover(tags.picture);

        const track = await Track.create({
          ownerId: req.auth.sub,
          title: req.body.title || tags.title || audioFile.originalname,
          originalName: audioFile.originalname,
          storedName: audioFile.filename,
          mimeType: audioFile.mimetype,
          size: audioFile.size,
          artist: tags.artist,
          album: tags.album,
          ...cover,
        });

        console.log(`[tracks] Upload enregistré : ${track.id}`);
        res.status(201).json(track.toPublic());
      } catch (error) {
        console.error("[tracks] Erreur après l'enregistrement du fichier", error);

        // Si la validation ou MongoDB échoue après l'écriture sur disque, les
        // fichiers orphelins sont supprimés ; un échec de nettoyage est logué.
        if (audioFile) await removeFile(path.join(UPLOADS, audioFile.filename));
        if (cover) await removeFile(path.join(COVERS, cover.coverStoredName));
        next(error);
      }
    },
  );

  /** Envoie le contenu binaire d'une piste après vérification de sa propriété. */
  app.get("/api/tracks/:id/audio", auth, async (req, res, next) => {
    try {
      const track = await Track.findOne({
        _id: req.params.id,
        ownerId: req.auth.sub,
      }).select("+storedName");

      if (!track) {
        console.warn(`[tracks] Audio introuvable ou interdit : ${req.params.id}`);
        return res.status(404).json({ message: "Piste inconnue" });
      }

      const audioPath = path.join(UPLOADS, track.storedName);
      res.type(track.mimeType);
      // Ce callback permet de loguer le succès ou l'erreur du transfert.
      res.sendFile(audioPath, (error) => {
        if (error) {
          console.error(`[tracks] Erreur d'envoi audio ${track.id}`, error);
          if (!res.headersSent) next(error);
          return;
        }
        console.log(`[tracks] Audio envoyé : ${track.id}`);
      });
    } catch (error) {
      console.error("[tracks] Erreur de préparation du flux audio", error);
      next(error);
    }
  });

  /** Supprime la métadonnée et le fichier physique correspondant. */
  app.delete("/api/tracks/:id", auth, async (req, res, next) => {
    try {
      const track = await Track.findOneAndDelete({
        _id: req.params.id,
        ownerId: req.auth.sub,
      }).select("+storedName +coverStoredName");

      if (!track) {
        console.warn(`[tracks] Suppression impossible : ${req.params.id}`);
        return res.status(404).json({ message: "Piste inconnue" });
      }

      // La pochette est supprimée d'abord pour ne jamais rester orpheline,
      // même si la suppression du fichier audio échoue ensuite.
      const coverRemoved =
        !track.coverStoredName ||
        (await removeFile(path.join(COVERS, track.coverStoredName)));

      const audioPath = path.join(UPLOADS, track.storedName);
      try {
        await fsPromises.unlink(audioPath);
        console.log(`[tracks] Fichier supprimé : ${audioPath}`);
      } catch (error) {
        // L'exception n'est volontairement pas ignorée : l'administrateur doit
        // voir ce fichier orphelin si sa suppression échoue.
        console.error(`[tracks] Fichier audio non supprimé : ${audioPath}`, error);
        return res.status(500).json({
          message: "Métadonnée supprimée, mais fichier audio non supprimé",
        });
      }

      if (!coverRemoved) {
        return res.status(500).json({
          message: "Métadonnée supprimée, mais fichier de pochette non supprimé",
        });
      }

      res.status(204).end();
    } catch (error) {
      console.error("[tracks] Erreur de suppression", error);
      next(error);
    }
  });

  /** Envoie la pochette d'une piste du propriétaire avec son type réel. */
  app.get("/api/tracks/:id/cover", auth, async (req, res, next) => {
    try {
      const track = await findOwnedTrack(req);
      if (!track) return unknownTrack(req, res);
      if (!track.coverStoredName) {
        console.warn(`[covers] Pas de pochette pour ${track.id}`);
        return res.status(404).json({ message: "Pochette absente" });
      }

      res.type(track.coverMimeType);
      // Empêche le navigateur d'interpréter l'image comme un autre type de contenu.
      res.set("X-Content-Type-Options", "nosniff");
      res.sendFile(path.join(COVERS, track.coverStoredName), (error) => {
        if (error) {
          console.error(`[covers] Erreur d'envoi de la pochette ${track.id}`, error);
          if (!res.headersSent) next(error);
          return;
        }
        console.log(`[covers] Pochette envoyée : ${track.id}`);
      });
    } catch (error) {
      console.error("[covers] Erreur de lecture de la pochette", error);
      next(error);
    }
  });

  /** Remplace la pochette par l'image multipart `cover` (2 Mo maximum). */
  app.put("/api/tracks/:id/cover", auth, receiveCover, async (req, res, next) => {
    try {
      if (!req.file) {
        console.warn(`[covers] Remplacement sans image : ${req.params.id}`);
        return res.status(400).json({ message: "Image de pochette requise" });
      }
      const track = await findOwnedTrack(req);
      if (!track) return unknownTrack(req, res);

      await replaceCover(track, await storeCover(req.file.buffer, "upload"));
      console.log(`[covers] Pochette remplacée : ${track.id}`);
      res.json(track.toPublic());
    } catch (error) {
      console.error("[covers] Erreur de remplacement de la pochette", error);
      next(error);
    }
  });

  /** Retire la pochette d'une piste et supprime son fichier. */
  app.delete("/api/tracks/:id/cover", auth, async (req, res, next) => {
    try {
      const track = await findOwnedTrack(req);
      if (!track) return unknownTrack(req, res);

      const previous = track.coverStoredName;
      if (previous) {
        track.set({ coverStoredName: undefined, coverMimeType: undefined, coverSource: undefined });
        await track.save();
        if (!(await removeFile(path.join(COVERS, previous)))) {
          return res.status(500).json({
            message: "Pochette retirée, mais fichier non supprimé",
          });
        }
      }

      console.log(`[covers] Pochette retirée : ${track.id}`);
      res.status(204).end();
    } catch (error) {
      console.error("[covers] Erreur de suppression de la pochette", error);
      next(error);
    }
  });

  /** Recherche des pochettes sur iTunes Search, uniquement à la demande. */
  app.get("/api/tracks/:id/cover/search", auth, async (req, res, next) => {
    try {
      const track = await findOwnedTrack(req);
      if (!track) return unknownTrack(req, res);

      const query = (
        [track.artist, track.title].filter(Boolean).join(" ") ||
        path.parse(track.originalName).name
      ).slice(0, TAG_MAX_LENGTH);

      let results;
      try {
        results = await searchItunesCovers(query);
      } catch (error) {
        console.error("[covers] Recherche iTunes impossible", error);
        return res.status(502).json({
          message: "Service de recherche de pochettes indisponible",
        });
      }

      console.log(`[covers] ${results.length} pochette(s) proposée(s) pour ${track.id}`);
      res.json({
        query,
        source: "iTunes Search API",
        attribution: COVER_ATTRIBUTION,
        results,
      });
    } catch (error) {
      console.error("[covers] Erreur de recherche de pochette", error);
      next(error);
    }
  });

  /** Télécharge une pochette choisie parmi les résultats Web (anti-SSRF). */
  app.post("/api/tracks/:id/cover/web", auth, async (req, res, next) => {
    try {
      const track = await findOwnedTrack(req);
      if (!track) return unknownTrack(req, res);

      const bytes = await downloadCover(req.body?.imageUrl);
      await replaceCover(track, await storeCover(bytes, "web"));
      console.log(`[covers] Pochette Web enregistrée : ${track.id}`);
      res.json(track.toPublic());
    } catch (error) {
      console.error("[covers] Erreur d'import de la pochette Web", error);
      next(error);
    }
  });

  /** Retourne une page des résumés de mes clips, filtrés par titre, étiquette ou visibilité. */
  app.get("/api/clips", auth, async (req, res, next) => {
    try {
      const { page, limit } = parsePagination(req.query);
      const filters = parseClipFilters(req.query);
      console.log(
        `[clips] Lecture page=${page}, limit=${limit}, filtre=${filters.search ? "oui" : "non"}, ` +
          `tag=${filters.tag ?? "-"}, visibilité=${filters.visibility ?? "-"}, user=${req.auth.sub}`,
      );

      const aggregate = Clip.aggregate([
        { $match: { ownerId: new mongoose.Types.ObjectId(req.auth.sub), ...clipFilterMatch(filters) } },
        ...clipSummaryStages(),
      ]);
      const result = await Clip.aggregatePaginate(aggregate, {
        page,
        limit,
        sort: { createdAt: -1 },
      });

      console.log(`[clips] ${result.docs.length} clip(s) envoyé(s) sur ${result.totalDocs}`);
      res.json(toPage(result, await publicSummaries(req, result.docs)));
    } catch (error) {
      console.error("[clips] Erreur de pagination", error);
      next(error);
    }
  });

  /** Statistiques de ma bibliothèque (déclarée avant /clips/:id). */
  app.get("/api/clips/stats", auth, async (req, res, next) => {
    try {
      const stats = await computeLibraryStats(req);
      console.log(`[clips] Statistiques calculées sur ${stats.clipCount} clip(s) de ${req.auth.sub}`);
      res.json(stats);
    } catch (error) {
      console.error("[clips] Erreur de calcul des statistiques", error);
      next(error);
    }
  });

  /** Mes étiquettes et leur nombre d'utilisations (déclarée avant /clips/:id). */
  app.get("/api/clips/tags", auth, async (req, res, next) => {
    try {
      const tags = await countTags(req.auth.sub);
      console.log(`[clips] ${tags.length} étiquette(s) envoyée(s) à ${req.auth.sub}`);
      res.json(tags);
    } catch (error) {
      console.error("[clips] Erreur de lecture des étiquettes", error);
      next(error);
    }
  });

  /** Clips d'autrui lisibles : publics, de mes amis ou partagés avec moi (avant /clips/:id). */
  app.get("/api/clips/discover", auth, async (req, res, next) => {
    try {
      const { page, limit } = parsePagination(req.query);
      const { scope, sort, filters } = parseDiscoverQuery(req.query);
      const viewerId = new mongoose.Types.ObjectId(req.auth.sub);
      const friendIds = scope === "public" ? [] : await friendIdsOf(viewerId);
      console.log(
        `[discover] Lecture scope=${scope}, sort=${sort}, page=${page}, limit=${limit}, ` +
          `filtre=${filters.search ? "oui" : "non"}, tag=${filters.tag ?? "-"}, user=${req.auth.sub}`,
      );

      const aggregate = Clip.aggregate([
        {
          $match: {
            ...clipFilterMatch(filters),
            ...discoverSortMatch(sort),
            ...discoverMatch(scope, viewerId, friendIds),
          },
        },
        ...clipSummaryStages(),
      ]);
      const result = await Clip.aggregatePaginate(aggregate, { page, limit, sort: DISCOVER_SORTS[sort] });

      console.log(`[discover] ${result.docs.length} clip(s) envoyé(s) sur ${result.totalDocs}`);
      res.json(toPage(result, await publicSummaries(req, result.docs)));
    } catch (error) {
      console.error("[discover] Erreur de découverte des clips", error);
      next(error);
    }
  });

  /**
   * Reçoit la vidéo (`video`), la pellicule optionnelle (`filmstrip`), le titre,
   * les étiquettes, la visibilité et l'analyse calculée par le navigateur.
   * Les fichiers sont écrits par Multer avant la validation : tout refus les supprime.
   */
  app.post("/api/clips", auth, receiveClipFiles, async (req, res, next) => {
    const videoFile = req.files?.video?.[0];
    const filmstripFile = req.files?.filmstrip?.[0];
    let clip;
    try {
      if (!videoFile) {
        console.warn(`[clips] Upload sans vidéo par ${req.auth.sub}`);
        throw new HttpError(400, "Fichier vidéo requis");
      }

      const detectedType = await detectVideoType(videoFile.path);
      if (detectedType !== videoFile.mimetype) {
        throw new HttpError(400, "Fichier vidéo invalide : MP4 ou WebM attendu");
      }
      if (filmstripFile) await checkFilmstrip(filmstripFile);
      const analysis = validateAnalysis(readAnalysisField(req.body?.analysis));
      const tags = readTagsField(req.body?.tags);
      const visibility =
        req.body?.visibility === undefined ? "private" : validateVisibility(req.body.visibility);
      const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";

      clip = await Clip.create({
        ownerId: req.auth.sub,
        title: title || videoFile.originalname,
        originalName: videoFile.originalname,
        storedName: videoFile.filename,
        filmstripStoredName: filmstripFile?.filename ?? null,
        mimeType: detectedType,
        size: videoFile.size,
        tags,
        visibility,
        ...analysis,
      });
    } catch (error) {
      console.error("[clips] Upload refusé ou en échec après l'écriture des fichiers", error);
      for (const file of [videoFile, filmstripFile]) {
        if (file) await removeFile(path.join(UPLOADS, file.filename));
      }
      return next(error);
    }

    try {
      console.log(`[clips] Clip enregistré : ${clip.id} (${clip.cutCount} coupe(s))`);
      res.status(201).json(await publicClip(req, clip));
    } catch (error) {
      console.error("[clips] Clip enregistré mais réponse impossible", error);
      next(error);
    }
  });

  /** Retourne le détail d'un clip lisible, analyse et annotations comprises. */
  app.get("/api/clips/:id", auth, async (req, res, next) => {
    try {
      const clip = await findReadableClip(req);
      if (!clip) return unknownClip(req, res);
      console.log(`[clips] Détail envoyé : ${clip.id}`);
      res.json(await publicClip(req, clip));
    } catch (error) {
      console.error("[clips] Erreur de lecture du clip", error);
      next(error);
    }
  });

  /** Envoie la vidéo d'un clip lisible avec son type vérifié. */
  app.get("/api/clips/:id/video", auth, async (req, res, next) => {
    try {
      const clip = await findReadableClip(req);
      if (!clip) return unknownClip(req, res);
      sendClipFile(res, next, {
        clipId: clip.id,
        storedName: clip.storedName,
        mimeType: clip.mimeType,
        missingMessage: "Clip inconnu",
      });
    } catch (error) {
      console.error("[clips] Erreur de préparation du flux vidéo", error);
      next(error);
    }
  });

  /** Envoie la pellicule JPEG d'un clip lisible. */
  app.get("/api/clips/:id/filmstrip", auth, async (req, res, next) => {
    try {
      const clip = await findReadableClip(req);
      if (!clip) return unknownClip(req, res);
      if (!clip.filmstripStoredName) {
        console.warn(`[clips] Pellicule absente : ${clip.id}`);
        return res.status(404).json({ message: "Pellicule absente" });
      }
      sendClipFile(res, next, {
        clipId: clip.id,
        storedName: clip.filmstripStoredName,
        mimeType: "image/jpeg",
        missingMessage: "Pellicule absente",
      });
    } catch (error) {
      console.error("[clips] Erreur de préparation de la pellicule", error);
      next(error);
    }
  });

  /** Modifie le titre, les étiquettes ou la visibilité d'un de mes clips. */
  app.patch("/api/clips/:id", auth, async (req, res, next) => {
    try {
      const clip = await findOwnedClip(req);
      if (!clip) return unknownClip(req, res);
      const changes = parseClipPatch(req.body);
      if (changes.sharedWith) await checkRecipientsAreFriends(clip.ownerId, changes.sharedWith);
      clip.set(changes);
      if (clip.visibility !== "shared" && clip.visibility !== "public") clip.sharedWith = [];
      await clip.save();
      if (changes.sharedWith?.length) await dropFormerFriends(clip);
      console.log(`[clips] Clip modifié : ${clip.id} (${Object.keys(changes).join(", ") || "aucun champ"})`);
      res.json(await publicClip(req, clip));
    } catch (error) {
      console.error("[clips] Erreur de modification du clip", error);
      next(error);
    }
  });

  /** Remplace l'analyse d'un de mes clips (coupes retouchées, sensibilité…). */
  app.put("/api/clips/:id/analysis", auth, async (req, res, next) => {
    try {
      const clip = await findOwnedClip(req);
      if (!clip) return unknownClip(req, res);
      const analysis = validateAnalysis(req.body);
      if (Math.abs(analysis.durationSec - clip.durationSec) > DURATION_TOLERANCE_SEC) {
        throw new HttpError(400, "Analyse invalide : la durée ne correspond pas au clip");
      }
      clip.set(analysis);
      await clip.save();
      console.log(`[clips] Analyse remplacée : ${clip.id} (${clip.cutCount} coupe(s))`);
      res.json(await publicClip(req, clip));
    } catch (error) {
      console.error("[clips] Erreur de remplacement de l'analyse", error);
      next(error);
    }
  });

  /** Supprime le clip, sa vidéo et sa pellicule (les annotations sont dans le document). */
  app.delete("/api/clips/:id", auth, async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return unknownClip(req, res);
      const clip = await Clip.findOneAndDelete({
        _id: req.params.id,
        ownerId: req.auth.sub,
      }).select(CLIP_HIDDEN_FIELDS);
      if (!clip) return unknownClip(req, res);

      const removed = await Promise.all(clipFilePaths(clip).map(removeFile));
      if (removed.includes(false)) {
        return res.status(500).json({
          message: "Métadonnée supprimée, mais un fichier du clip n'a pas pu être supprimé",
        });
      }

      console.log(`[clips] Clip supprimé : ${clip.id}`);
      res.status(204).end();
    } catch (error) {
      console.error("[clips] Erreur de suppression", error);
      next(error);
    }
  });

  /** Ajoute une annotation horodatée à un clip lisible. */
  app.post("/api/clips/:id/annotations", auth, async (req, res, next) => {
    try {
      const clip = await findReadableClip(req);
      if (!clip) return unknownClip(req, res);
      const { time, text } = parseAnnotation(req.body, clip.durationSec);
      const annotation = {
        _id: new mongoose.Types.ObjectId(),
        time,
        text,
        authorId: new mongoose.Types.ObjectId(req.auth.sub),
        createdAt: new Date(),
      };
      // La condition sur l'index MAX-1 rend le contrôle de la limite atomique.
      const updated = await Clip.findOneAndUpdate(
        { _id: clip._id, [`annotations.${MAX_ANNOTATIONS - 1}`]: { $exists: false } },
        { $push: { annotations: annotation } },
        { projection: { _id: 1 } },
      );
      if (!updated) throw new HttpError(400, `Annotations limitées à ${MAX_ANNOTATIONS} par clip`);
      console.log(`[clips] Annotation ajoutée : ${annotation._id} sur ${clip.id}`);
      res.status(201).json(toPublicAnnotation(annotation, await loadUserNames([req.auth.sub])));
    } catch (error) {
      console.error("[clips] Erreur d'ajout d'annotation", error);
      next(error);
    }
  });

  /** Supprime une annotation : réservé à son auteur ou au propriétaire du clip. */
  app.delete("/api/clips/:id/annotations/:annotationId", auth, async (req, res, next) => {
    try {
      const clip = await findReadableClip(req);
      if (!clip) return unknownClip(req, res);
      const { annotationId } = req.params;
      const annotation = mongoose.isValidObjectId(annotationId) ? clip.annotations.id(annotationId) : null;
      if (!annotation) {
        console.warn(`[clips] Annotation introuvable : ${annotationId} sur ${clip.id}`);
        return res.status(404).json({ message: "Annotation inconnue" });
      }
      const viewerId = String(req.auth.sub);
      if (String(annotation.authorId) !== viewerId && String(clip.ownerId) !== viewerId) {
        throw new HttpError(403, "Seul l'auteur ou le propriétaire peut supprimer cette annotation");
      }
      clip.annotations.pull(annotation._id);
      await clip.save();
      console.log(`[clips] Annotation supprimée : ${annotationId} sur ${clip.id}`);
      res.status(204).end();
    } catch (error) {
      console.error("[clips] Erreur de suppression d'annotation", error);
      next(error);
    }
  });

  /** Mes amis acceptés et mes demandes en attente (reçues et envoyées), 200 au plus par liste. */
  app.get("/api/friends", auth, async (req, res, next) => {
    try {
      const viewerId = req.auth.sub;
      const [accepted, outgoing, incoming] = await Promise.all([
        acceptedFriendshipsOf(viewerId, MAX_FRIENDS_LISTED),
        Friendship.find({ requester: viewerId, status: "pending" })
          .sort({ createdAt: -1 })
          .limit(MAX_FRIENDS_LISTED)
          .lean(),
        Friendship.find({ recipientEmail: viewerEmail(req), status: "pending", requester: { $ne: viewerId } })
          .sort({ createdAt: -1 })
          .limit(MAX_FRIENDS_LISTED)
          .lean(),
      ]);
      const users = await loadFriendUsers([
        ...accepted.map((friendship) => otherParty(friendship, viewerId)),
        ...incoming.map((friendship) => friendship.requester),
      ]);
      const friends = accepted
        .map((friendship) => toFriendEntry(friendship, viewerId, users))
        .sort((a, b) => a.user.name.localeCompare(b.user.name));
      const requests = [
        ...incoming.map((friendship) => toIncomingRequest(friendship, users)),
        ...outgoing.map(toOutgoingRequest),
      ]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, MAX_FRIENDS_LISTED);
      console.log(`[friends] ${friends.length} ami(s), ${requests.length} demande(s) pour ${viewerId}`);
      res.json({ friends, requests });
    } catch (error) {
      console.error("[friends] Erreur de lecture des amis", error);
      next(error);
    }
  });

  /**
   * Invite une adresse e-mail. L'invitation est toujours enregistrée, que le
   * compte existe ou non : réponse et état visibles sont identiques (pas
   * d'énumération). 409 seulement pour une relation que l'appelant connaît déjà.
   */
  app.post("/api/friends/requests", auth, async (req, res, next) => {
    try {
      const email = parseInvitationEmail(req.body);
      if (email === viewerEmail(req)) throw new HttpError(400, "Vous ne pouvez pas vous inviter vous-même");
      const existing = await Friendship.findOne({ inviteKey: inviteKeyOf(req.auth.sub, email) }).lean();
      if (existing?.status === "accepted") throw new HttpError(409, "Vous êtes déjà amis");
      if (existing) {
        console.log(`[friends] Invitation déjà envoyée par ${req.auth.sub}`);
        return res.status(202).json({ message: INVITATION_SENT });
      }
      if (await hasKnownRelation(req, email)) {
        throw new HttpError(409, "Vous êtes déjà amis ou cette personne vous a déjà invité");
      }
      const pending = await Friendship.countDocuments({ requester: req.auth.sub, status: "pending" });
      if (pending >= MAX_PENDING_INVITATIONS) {
        throw new HttpError(429, `Trop d'invitations en attente (${MAX_PENDING_INVITATIONS} maximum)`);
      }
      try {
        await Friendship.create({ requester: req.auth.sub, recipientEmail: email });
      } catch (error) {
        if (error?.code !== DUPLICATE_KEY_CODE) throw error;
        console.warn(`[friends] Invitation concurrente ignorée pour ${req.auth.sub}`);
      }
      console.log(`[friends] Invitation enregistrée par ${req.auth.sub}`);
      res.status(202).json({ message: INVITATION_SENT });
    } catch (error) {
      console.error("[friends] Erreur d'envoi d'invitation", error);
      next(error);
    }
  });

  /**
   * Accepte une demande reçue : l'e-mail du JWT doit être celui invité. Pose
   * `recipient` et la clé de paire, puis retire une éventuelle invitation
   * croisée devenue inutile.
   */
  app.post("/api/friends/requests/:id/accept", auth, async (req, res, next) => {
    try {
      const email = viewerEmail(req);
      const request = mongoose.isValidObjectId(req.params.id)
        ? await Friendship.findOne({ _id: req.params.id, recipientEmail: email, status: "pending" }).lean()
        : null;
      if (!request || String(request.requester) === String(req.auth.sub)) {
        console.warn(`[friends] Demande introuvable ou interdite : ${req.params.id}`);
        return res.status(404).json({ message: "Demande inconnue" });
      }
      let friendship;
      try {
        friendship = await Friendship.findOneAndUpdate(
          { _id: request._id, recipientEmail: email, status: "pending" },
          {
            $set: {
              status: "accepted",
              acceptedAt: new Date(),
              recipient: new mongoose.Types.ObjectId(req.auth.sub),
              pairKey: pairKeyOf(request.requester, req.auth.sub),
            },
          },
          { returnDocument: "after" },
        ).lean();
      } catch (error) {
        if (error?.code === DUPLICATE_KEY_CODE) throw new HttpError(409, "Vous êtes déjà amis");
        throw error;
      }
      if (!friendship) return res.status(404).json({ message: "Demande inconnue" });
      const users = await loadFriendUsers([friendship.requester]);
      const requesterEmail = users.get(String(friendship.requester))?.email;
      if (requesterEmail) {
        await Friendship.deleteOne({
          inviteKey: inviteKeyOf(req.auth.sub, requesterEmail),
          status: "pending",
        });
      }
      console.log(`[friends] Demande acceptée : ${friendship._id}`);
      res.json(toFriendEntry(friendship, req.auth.sub, users));
    } catch (error) {
      console.error("[friends] Erreur d'acceptation", error);
      next(error);
    }
  });

  /**
   * Refuse, annule ou retire une relation (l'une ou l'autre partie). Retirer
   * une amitié retire aussi chaque partie du partage des clips de l'autre.
   */
  app.delete("/api/friends/:id", auth, async (req, res, next) => {
    try {
      const parties = [
        { requester: req.auth.sub },
        { recipient: req.auth.sub },
        { recipientEmail: viewerEmail(req), status: "pending" },
      ];
      const friendship = mongoose.isValidObjectId(req.params.id)
        ? await Friendship.findOneAndDelete({ _id: req.params.id, $or: parties }).lean()
        : null;
      if (!friendship) {
        console.warn(`[friends] Relation introuvable ou interdite : ${req.params.id}`);
        return res.status(404).json({ message: "Relation inconnue" });
      }
      if (friendship.status === "accepted") {
        const { requester, recipient } = friendship;
        await Promise.all([
          Clip.updateMany({ ownerId: requester, sharedWith: recipient }, { $pull: { sharedWith: recipient } }),
          Clip.updateMany({ ownerId: recipient, sharedWith: requester }, { $pull: { sharedWith: requester } }),
        ]);
      }
      console.log(`[friends] Relation supprimée : ${friendship._id} (${friendship.status})`);
      res.status(204).end();
    } catch (error) {
      console.error("[friends] Erreur de suppression de relation", error);
      next(error);
    }
  });

  /** Fil d'activité : clips de mes amis, annotations sur mes clips, nouvelles amitiés. */
  app.get("/api/activity", auth, async (req, res, next) => {
    try {
      const limit = parseActivityLimit(req.query);
      const viewerId = new mongoose.Types.ObjectId(req.auth.sub);
      const friendships = await acceptedFriendshipsOf(viewerId);
      const friendIds = friendships.map((friendship) => otherParty(friendship, viewerId));
      const [clipEvents, notes] = await Promise.all([
        friendClipEvents(viewerId, friendIds, limit),
        annotationEvents(viewerId, limit),
      ]);
      const events = [...clipEvents, ...notes, ...friendEvents(friendships.slice(0, limit), viewerId)]
        .sort(byRecentEvent)
        .slice(0, limit);
      const userNames = await loadUserNames(events.map((event) => event.actorId));
      const activity = events.map(({ actorId, ...event }) => ({
        ...event,
        actor: { id: String(actorId), name: userNames.get(String(actorId)) ?? "Utilisateur inconnu" },
      }));
      console.log(`[activity] ${activity.length} événement(s) pour ${req.auth.sub}`);
      res.json(activity);
    } catch (error) {
      console.error("[activity] Erreur de lecture de l'activité", error);
      next(error);
    }
  });

  /** Gestionnaire central des erreurs connues de l'application. */
  app.use((error, _req, res, next) => {
    console.error("[error] Erreur reçue par le gestionnaire central", error);

    if (error instanceof HttpError) {
      return res.status(error.status).json({ message: error.message });
    }
    if (
      error instanceof multer.MulterError ||
      error?.message === "Format audio non accepté"
    ) {
      return res.status(400).json({ message: error.message });
    }
    if (error?.type === "entity.parse.failed") {
      return res.status(400).json({ message: "Corps JSON invalide" });
    }
    if (error?.type === "entity.too.large") {
      return res.status(413).json({ message: "Requête trop volumineuse" });
    }
    if (error?.name === "ValidationError") {
      return res.status(400).json({ message: "Données invalides" });
    }
    if (error?.name === "CastError") {
      return res.status(404).json({ message: "Ressource inconnue" });
    }

    next(error);
  });

  /** Dernier recours : erreur inattendue, détail dans les logs uniquement. */
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    console.error("[error] Erreur interne non gérée", error);
    res.status(500).json({ message: "Erreur interne du serveur" });
  });

  return app;
}
