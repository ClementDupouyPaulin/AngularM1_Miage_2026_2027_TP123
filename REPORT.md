# Rapport TP4 — Film Pulse

Film Pulse affiche le **rythme de montage** d'un extrait de film (120 s max) comme un électrocardiogramme : coupes détectées, longueur moyenne des plans (ASL), battements de la bande-son et score de synchronisation coupes/musique. Le plan de cadrage est dans [PLAN.md](PLAN.md), le contrat HTTP dans [API_CONTRACT.md](API_CONTRACT.md) (section « Film Pulse »).

## Démo en 5 étapes

1. Se connecter (`demo@example.com` / `Demo1234!`), ouvrir **Mes extraits** (`/clips`).
2. Choisir un fichier MP4 ou WebM : l'analyse se lance dans le navigateur, avec barre de progression et annulation.
3. Consulter l'aperçu (nombre de coupes, ASL, score de synchro) puis envoyer l'extrait.
4. Ouvrir le détail (`/clips/:id`) : lecteur vidéo, timeline du pouls, clic sur une coupe = saut à cet instant, curseur synchronisé avec la lecture.
5. Comparer deux extraits sur le même graphique (`/clips/compare`), puis supprimer un extrait.

## Fonctionnalités

| Lot | Contenu | État |
|---|---|---|
| 0 | Branche `feat/film-pulse`, exception à la règle « backend intouchable » pour `/api/clips` | livré |
| 1 | Backend : modèle `Clip`, 5 routes `/api/clips`, validation de l'analyse | livré |
| 2 | Algorithmes purs : `detectCuts`, `detectBeats`, `syncScore`, `averageShotLength` | livré |
| 3 | `ClipAnalyzerService` : échantillonnage vidéo/canvas, décodage audio, progression, annulation | livré |
| 4 | `ClipService` HTTP, modèles, route protégée | livré |
| 5 | Page « Mes extraits » : analyse, envoi, liste paginée, suppression | livré |
| 6 | Détail : lecteur + timeline SVG du pouls, stats | livré |
| 7 | Comparaison de deux extraits sur une échelle commune | livré |
| 8 | Extraits publics/privés, partage, classement | **non fait** (facultatif) |

Historique : `git log --oneline 3cff3de..HEAD` (10 commits atomiques, un par lot ou correctif).

## Architecture

```
fichier MP4/WebM (navigateur)
  -> ClipAnalyzerService
       vidéo : image 64x36 sur <canvas>, 10 img/s par seek -> detectCuts
       audio : decodeAudioData -> énergie par fenêtre       -> detectBeats
       -> analysis { version, durationSec, cuts[], beats[], syncScore }
  -> ClipService : POST /api/clips (multipart : video, title, analysis JSON) + JWT
  -> Express : valide les octets et l'analyse, recalcule cutCount/ASL/syncScore
       -> vidéo sur disque (nom UUID)   -> métadonnées + analysis dans MongoDB (Clip)
  -> GET /api/clips, /api/clips/:id, /api/clips/:id/video (HttpClient -> Blob -> ObjectURL)
  -> clip-detail (pulse-timeline) / clip-compare
```

Fichiers clés : `backend/src/models/Clip.js`, `backend/src/app.js` (routes `/api/clips`, `computeSyncScore`), `frontend-starter/src/app/shared/analysis/*`, `shared/services/{clip-analyzer,clip}.service.ts`, `components/{clips-page,clip-detail,pulse-timeline,clip-compare}`.

## Choix techniques

| Choix | Justification |
|---|---|
| Analyse **dans le navigateur** | Pas de ffmpeg serveur ; les algorithmes sont des fonctions pures testables sans vidéo. |
| **Seuil adaptatif** (moyenne + 3 écarts-types de la différence d'histogramme, écart minimal 0,3 s) | Un seuil fixe donne trop de faux positifs selon le film. |
| **Score normalisé** : part des coupes à ±0,08 s d'un beat, divisée par la part attendue au hasard | ≈ 1 = aucun lien, > 1 = calé sur la musique ; comparable entre extraits. Plafonné à 10. |
| Le **serveur recalcule** `cutCount`, ASL (`durée / (coupes + 1)`) et `syncScore` | Ne jamais faire confiance au client ; le `syncScore` reçu est ignoré. |
| `durationSec` **déclarative** | Pas de ffprobe côté serveur ; la vraie limite imposée est 50 Mo. |
| Ressource **`/api/clips` séparée** | `/api/tracks` et son contrat TP1–TP3 restent intacts. |
| Lecture via `HttpClient` + Blob | Le JWT ne peut pas passer par `<video src>` (même principe que l'audio). |
| Sans audio décodable | Analyse des coupes seule, `syncScore: null`. |

## Sécurité

- Type vidéo vérifié sur les **octets** (boîte `ftyp` MP4, en-tête EBML WebM), pas sur le `Content-Type` ; refus = fichier supprimé du disque.
- Isolation par `ownerId` : clip inexistant ou d'autrui = `404 "Clip inconnu"`.
- Noms de fichiers sur disque en UUID, jamais renvoyés au client.
- Limites : 50 Mo, 120 s, 2000 valeurs max dans `cuts`/`beats` (triées, dans `[0, durée]`), `q` limité à 100 caractères et traité comme texte littéral, JWT sur toutes les routes.

## Tests (résultats vérifiés)

| Suite | Commande | Résultat |
|---|---|---|
| Backend | `cd backend && npm test` | 72 réussis, 0 échec (dont 20 pour `/api/clips`) |
| Frontend | `cd frontend-starter && npx ng test --watch=false` | 283 réussis, 25 fichiers |
| dont Film Pulse | idem, specs d'analyse, services et 4 composants | 95 tests, 10 fichiers |
| Build | `npx ng build` | OK, Initial total 810,60 kB (175,07 kB transférés) |

Couvert : algorithmes sur données fabriquées (aucune coupe sur images identiques, coupe nette, fondu léger ignoré, score ≈ 1 au hasard et > 1 si aligné), validation backend (401, 400, 404 sur le clip d'autrui, recalcul serveur, suppression du fichier), service HTTP (`HttpTestingController`), composants avec analyseur simulé, délais et annulation de l'analyse.

**Non testé** : décodage réel de vidéo et d'audio (`<video>`, `<canvas>`, `decodeAudioData` absents ou simulés dans jsdom). La qualité de la détection sur de vrais films n'a pas de test automatisé ni n'a été mesurée.

## Revue indépendante (modèle fable)

Résultat : **0 bloquant, 5 points importants, tous corrigés** (commits `bd20444`, `e2967e0`) :

1. Délais maximaux et annulation de l'analyse (seek 5 s, métadonnées 10 s).
2. Durée `Infinity` des WebM (MediaRecorder).
3. Beats au-delà de la durée de la vidéo (filtrés).
4. `syncScore` recalculé par le serveur.
5. `404` si le fichier vidéo est absent du disque.

## Limites connues

- Test `tracks-page` intermittent (préexistant, timeouts ~13 s) : relancer la suite en cas d'échec isolé.
- `GET /api/tracks/:id/audio` renvoie 500 si le fichier est absent (préexistant, non modifié ; `/api/clips/:id/video` renvoie 404).
- Durée non vérifiée côté serveur (voir choix techniques).
- Vidéos issues de MediaRecorder : durée absente du conteneur, contournée côté navigateur.
- Précision des coupes limitée par l'échantillonnage à 10 img/s (≈ 0,1 s).

## Lancer le projet

```bash
cd backend && cp .env.example .env   # renseigner l'URI MongoDB et le secret JWT
npm install && npm start             # http://localhost:3000
cd frontend-starter && npm install && npm start   # http://localhost:4200
```

Tests : `cd backend && npm test` ; `cd frontend-starter && npm test` ; build : `npm run build`.

## Usage de l'IA

Un sous-agent par tâche, avec un brief (objectif, fichiers, contraintes, critère de fin) et le modèle le moins cher suffisant : **opus** pour l'implémentation (backend, algorithmes, analyseur, pages), **sonnet** pour le service HTTP et les corrections backend, **fable** pour la revue finale. L'agent principal garde le plan, l'intégration, la vérification des tests et la rédaction de ce rapport ; un commit atomique par lot.
