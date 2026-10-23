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
import { Clip, toPublicClip, ANALYSIS_VERSION } from "./models/Clip.js";

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
const MAX_CLIP_DURATION_SEC = 120;
const MAX_ANALYSIS_POINTS = 2000;
const MAX_SYNC_SCORE = 10;
const ANALYSIS_KEYS = ["version", "durationSec", "cuts", "beats", "syncScore"];

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

/** Retrouve un clip du propriétaire connecté (null si inconnu ou d'autrui). */
async function findOwnedClip(req) {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  return Clip.findOne({ _id: req.params.id, ownerId: req.auth.sub }).select("+storedName");
}

function unknownClip(req, res) {
  console.warn(`[clips] Clip introuvable ou interdit : ${req.params.id}`);
  return res.status(404).json({ message: "Clip inconnu" });
}

/** Identifie MP4 (boîte `ftyp`) ou WebM (en-tête EBML) par les premiers octets du fichier. */
async function detectVideoType(filePath) {
  const handle = await fsPromises.open(filePath, "r");
  try {
    const bytes = Buffer.alloc(VIDEO_SIGNATURE_LENGTH);
    const { bytesRead } = await handle.read(bytes, 0, VIDEO_SIGNATURE_LENGTH, 0);
    if (bytesRead >= 8 && bytes.toString("latin1", 4, 8) === "ftyp") return "video/mp4";
    if (bytes.subarray(0, WEBM_SIGNATURE.length).equals(WEBM_SIGNATURE)) return "video/webm";
    return null;
  } finally {
    await handle.close();
  }
}

/** Vérifie qu'un tableau de temps est court, fini, trié et compris dans [0, durée]. */
function validateTimes(values, durationSec, name) {
  if (!Array.isArray(values) || values.length > MAX_ANALYSIS_POINTS) {
    throw new HttpError(400, `Analyse invalide : ${name} doit être un tableau de ${MAX_ANALYSIS_POINTS} valeurs maximum`);
  }
  values.forEach((value, index) => {
    const valid =
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= durationSec &&
      (index === 0 || value >= values[index - 1]);
    if (!valid) {
      throw new HttpError(400, `Analyse invalide : ${name} doit contenir des temps triés dans [0, durée]`);
    }
  });
  return values;
}

/** Analyse le champ texte `analysis` ; toute valeur hors contrat est refusée. */
function parseAnalysis(raw) {
  if (typeof raw !== "string" || !raw) throw new HttpError(400, "Analyse requise");
  let analysis;
  try {
    analysis = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Analyse invalide : JSON attendu");
  }
  if (typeof analysis !== "object" || analysis === null || Array.isArray(analysis)) {
    throw new HttpError(400, "Analyse invalide : objet attendu");
  }
  if (Object.keys(analysis).some((key) => !ANALYSIS_KEYS.includes(key))) {
    throw new HttpError(400, "Analyse invalide : champ inattendu");
  }
  if (analysis.version !== ANALYSIS_VERSION) {
    throw new HttpError(400, "Analyse invalide : version non prise en charge");
  }

  const { durationSec, syncScore } = analysis;
  if (
    typeof durationSec !== "number" ||
    !Number.isFinite(durationSec) ||
    durationSec <= 0 ||
    durationSec > MAX_CLIP_DURATION_SEC
  ) {
    throw new HttpError(400, `Analyse invalide : durée entre 0 et ${MAX_CLIP_DURATION_SEC} s attendue`);
  }
  const syncScoreValid =
    syncScore === null ||
    (typeof syncScore === "number" &&
      Number.isFinite(syncScore) &&
      syncScore >= 0 &&
      syncScore <= MAX_SYNC_SCORE);
  if (!syncScoreValid) {
    throw new HttpError(400, `Analyse invalide : syncScore entre 0 et ${MAX_SYNC_SCORE} ou null attendu`);
  }

  const cuts = validateTimes(analysis.cuts, durationSec, "cuts");
  const beats = validateTimes(analysis.beats, durationSec, "beats");
  return {
    durationSec,
    cuts,
    beats,
    syncScore,
    cutCount: cuts.length,
    avgShotLength: durationSec / (cuts.length + 1),
  };
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

// Instance distincte : les limites et formats vidéo ne doivent pas toucher l'upload audio.
const videoUpload = multer({
  storage,
  limits: { fileSize: MAX_VIDEO_SIZE, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (VIDEO_MIME_TYPES.has(file.mimetype)) return callback(null, true);
    console.warn(`[multer] Type vidéo refusé : ${file.mimetype}`);
    return callback(new HttpError(400, "Format vidéo non accepté (MP4 ou WebM)"));
  },
});

/** Reçoit le champ multipart `video` et traduit le dépassement de taille. */
function receiveVideo(req, res, next) {
  videoUpload.single("video")(req, res, (error) => {
    if (error?.code === "LIMIT_FILE_SIZE") return next(new HttpError(400, VIDEO_TOO_LARGE));
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

  /** Retourne une page des résumés de clips de l'utilisateur (sans cuts ni beats). */
  app.get("/api/clips", auth, async (req, res, next) => {
    try {
      const page = Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(req.query.page)) || 1));
      const limit = Math.min(20, Math.max(1, Math.floor(Number(req.query.limit)) || 5));
      const rawQuery = req.query.q ?? "";

      if (typeof rawQuery !== "string") {
        console.warn("[clips] Paramètre q invalide");
        return res.status(400).json({ message: "Paramètre de recherche invalide" });
      }
      const search = rawQuery.trim();
      if (search.length > MAX_QUERY_LENGTH) {
        console.warn(`[clips] Recherche trop longue (${search.length} caractères)`);
        return res.status(400).json({
          message: `Recherche limitée à ${MAX_QUERY_LENGTH} caractères`,
        });
      }

      console.log(
        `[clips] Lecture page=${page}, limit=${limit}, filtre=${search ? "oui" : "non"}, user=${req.auth.sub}`,
      );

      const match = { ownerId: new mongoose.Types.ObjectId(req.auth.sub) };
      if (search) match.title = { $regex: escapeRegex(search), $options: "i" };

      const aggregate = Clip.aggregate([
        { $match: match },
        { $project: { storedName: 0, cuts: 0, beats: 0 } },
      ]);
      const result = await Clip.aggregatePaginate(aggregate, {
        page,
        limit,
        sort: { createdAt: -1 },
      });

      console.log(`[clips] ${result.docs.length} clip(s) envoyé(s) sur ${result.totalDocs}`);

      res.json({
        items: result.docs.map(toPublicClip),
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
      console.error("[clips] Erreur de pagination", error);
      next(error);
    }
  });

  /**
   * Reçoit la vidéo (`video`), son titre et l'analyse calculée par le navigateur.
   * Le fichier est écrit par Multer avant la validation : tout refus le supprime.
   */
  app.post("/api/clips", auth, receiveVideo, async (req, res, next) => {
    const videoFile = req.file;
    try {
      if (!videoFile) {
        console.warn(`[clips] Upload sans vidéo par ${req.auth.sub}`);
        return res.status(400).json({ message: "Fichier vidéo requis" });
      }

      const detectedType = await detectVideoType(videoFile.path);
      if (detectedType !== videoFile.mimetype) {
        throw new HttpError(400, "Fichier vidéo invalide : MP4 ou WebM attendu");
      }
      const analysis = parseAnalysis(req.body?.analysis);
      const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";

      const clip = await Clip.create({
        ownerId: req.auth.sub,
        title: title || videoFile.originalname,
        originalName: videoFile.originalname,
        storedName: videoFile.filename,
        mimeType: detectedType,
        size: videoFile.size,
        ...analysis,
      });

      console.log(`[clips] Clip enregistré : ${clip.id} (${clip.cutCount} coupe(s))`);
      res.status(201).json(clip.toPublic());
    } catch (error) {
      console.error("[clips] Upload refusé ou en échec après l'écriture du fichier", error);
      if (videoFile) await removeFile(path.join(UPLOADS, videoFile.filename));
      next(error);
    }
  });

  /** Retourne le détail d'un clip du propriétaire, analyse comprise. */
  app.get("/api/clips/:id", auth, async (req, res, next) => {
    try {
      const clip = await findOwnedClip(req);
      if (!clip) return unknownClip(req, res);
      console.log(`[clips] Détail envoyé : ${clip.id}`);
      res.json(clip.toPublic());
    } catch (error) {
      console.error("[clips] Erreur de lecture du clip", error);
      next(error);
    }
  });

  /** Envoie la vidéo d'un clip du propriétaire avec son type vérifié. */
  app.get("/api/clips/:id/video", auth, async (req, res, next) => {
    try {
      const clip = await findOwnedClip(req);
      if (!clip) return unknownClip(req, res);

      res.type(clip.mimeType);
      res.set("X-Content-Type-Options", "nosniff");
      res.sendFile(path.join(UPLOADS, clip.storedName), (error) => {
        if (error) {
          console.error(`[clips] Erreur d'envoi vidéo ${clip.id}`, error);
          if (!res.headersSent) next(error);
          return;
        }
        console.log(`[clips] Vidéo envoyée : ${clip.id}`);
      });
    } catch (error) {
      console.error("[clips] Erreur de préparation du flux vidéo", error);
      next(error);
    }
  });

  /** Supprime le clip et son fichier vidéo. */
  app.delete("/api/clips/:id", auth, async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return unknownClip(req, res);
      const clip = await Clip.findOneAndDelete({
        _id: req.params.id,
        ownerId: req.auth.sub,
      }).select("+storedName");
      if (!clip) return unknownClip(req, res);

      if (!(await removeFile(path.join(UPLOADS, clip.storedName)))) {
        return res.status(500).json({
          message: "Métadonnée supprimée, mais fichier vidéo non supprimé",
        });
      }

      console.log(`[clips] Clip supprimé : ${clip.id}`);
      res.status(204).end();
    } catch (error) {
      console.error("[clips] Erreur de suppression", error);
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
    if (error?.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
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
