# Rapport TP4 — Film Pulse

Film Pulse affiche le **rythme de montage** d'un extrait de film (120 s max) comme un électrocardiogramme : coupes, fondus, longueur moyenne des plans (ASL), battements de la bande-son, tempo, palette de couleurs et score de synchronisation coupes/musique. La phase 2 (« Salle de montage ») ajoute le partage entre amis, la découverte et une refonte complète du design. Plans : [PLAN.md](PLAN.md) (MVP), [PLAN-STUDIO.md](PLAN-STUDIO.md) (phase 2). Contrat HTTP : [API_CONTRACT.md](API_CONTRACT.md). Mode d'emploi : [frontend-starter/docs/film-pulse-guide.md](frontend-starter/docs/film-pulse-guide.md).

## Démo en 7 étapes

1. Se connecter (`demo@example.com` / `Demo1234!`), ouvrir **Studio** (`/clips`).
2. Déposer un MP4 ou WebM : l'analyse tourne dans le navigateur (aperçu en direct, annulation possible).
3. Régler la sensibilité sur l'aperçu, ajouter titre et étiquettes, envoyer.
4. Ouvrir l'extrait (`/clips/:id`) : lecteur, timeline, pellicule, palette ; déplacer le curseur de sensibilité, enregistrer ; annoter un instant.
5. **Partager** : privé, amis choisis ou public.
6. Avec un second compte : accepter l'invitation (`/friends`), retrouver l'extrait dans **Découvrir** (`/discover`) et dans le fil d'activité.
7. Sélectionner deux extraits dans le Studio, **Comparer** (`/clips/compare`) : lecture synchronisée.

## Fonctionnalités

| Lot | Contenu | Phase | État |
|---|---|---|---|
| 0-1 | Branche `feat/film-pulse`, modèle `Clip`, routes `/api/clips`, validation | 1 | livré |
| 2 | Algorithmes purs : coupes (seuil adaptatif), beats, score de synchro, ASL | 1 | livré |
| 3 | `ClipAnalyzerService` : échantillonnage canvas, décodage audio, progression, annulation | 1 | livré |
| 4-6 | Service HTTP, page « Mes extraits », détail avec timeline SVG | 1 | livré |
| 7 | Comparaison de deux extraits sur une échelle commune | 1 | livré |
| 8 | Public/privé, amis, classements (facultatif en phase 1) | 2 | **livré** |
| Analyse v2 | Fondus (`transitions`), palette dominante, `diffs` conservées pour re-détecter sans relire la vidéo, tempo (BPM), profil de rythme, pellicule JPEG (≤ 41 vignettes), détection des beats dans un **Web Worker** (repli sur le thread principal) | 2 | livré |
| Studio | Tableau de bord (statistiques, plus nerveux, plus calé), import par glisser-déposer avec aperçu en direct, cartes à affiche et mini-courbe, étiquettes, filtres | 2 | livré |
| Salle de montage | Lecteur à commandes (J/K/L, image par image), timeline (coupes, fondus, beats, annotations, palette, survol = vignette), sensibilité enregistrable, histogramme des durées, courbe d'accélération, annotations horodatées, export PNG et JSON | 2 | livré |
| Comparaison | Lecture synchronisée (temps absolu ou durée relative), pouls, palettes, histogrammes et statistiques superposés | 2 | livré |
| Social | Amis (invitations, retrait), partage `private`/`shared`/`public`, Découvrir (portées et tris), classements, fil d'activité | 2 | livré |
| Design system | Thème sombre/clair, jetons CSS, coque, pages existantes restylées ([design-system.md](frontend-starter/docs/design-system.md)) | 2 | livré |

Historique : `git log --oneline 3cff3de..HEAD` (commits atomiques, un par lot ou correctif).

## Architecture

```
fichier MP4/WebM (navigateur)
  -> ClipAnalyzerService
       vidéo : image 64x36 sur <canvas>, 10 img/s par seek
               -> diffs + couleur dominante + vignettes 160x90
               -> detectCuts / detectTransitions / paletteFromColors / pellicule JPEG
       audio : decodeAudioData -> analysis.worker (detectBeats) -> estimateTempo
       -> analysis v2 { cuts, beats, diffs, palette, transitions, thumbnailTimes, sensitivity, syncScore }
  -> redetect(diffs, k) : recalcul local des coupes quand on bouge le curseur (sans relire la vidéo)
  -> ClipService : POST /api/clips (multipart : video, title, analysis, filmstrip, tags, visibility) + JWT
  -> Express : valide octets et analyse, recalcule cutCount / ASL / syncScore / sparkline
       -> vidéo + pellicule sur disque (noms UUID) -> Clip (analysis, annotations, sharedWith) dans MongoDB
       -> Friendship (invitations, amitiés)
  -> lecture : règle d'accès unique (propriétaire | public | shared + ami accepté), sinon 404
  -> vues : clips-page (Studio) | clip-detail (Salle de montage, share-dialog) | clip-compare
            discover-page (/discover) | friends-page (/friends, avec le fil d'activité)
```

Une analyse produit une seule donnée riche qui alimente toutes les vues. Fichiers clés : `backend/src/models/{Clip,Friendship}.js`, `backend/src/app.js`, `frontend-starter/src/app/shared/analysis/*`, `shared/services/{clip-analyzer,clip,friend,activity}.service.ts`, `shared/services/analysis.worker.ts`, `components/*`, `src/styles.css`.

## Choix techniques

| Choix | Justification |
|---|---|
| Analyse **dans le navigateur** | Pas de ffmpeg serveur ; algorithmes en fonctions pures testables sans vidéo. |
| **Seuil adaptatif** (écart au niveau normal de la différence entre images, coefficient k réglable de 1 à 6, écart minimal 0,2 s) | Un seuil fixe donne trop de faux positifs selon le film. |
| **`diffs` stockées** (≤ 1300 valeurs) | Régler la sensibilité sans relire la vidéo ni la renvoyer. |
| **Worker** pour les beats | L'analyse audio ne fige pas l'interface ; repli sur le thread principal après 30 s ou erreur. |
| Score normalisé : part des coupes à ±0,08 s d'un beat, divisée par la part attendue au hasard (plafond 10) | ≈ 1 = aucun lien, > 1 = calé sur la musique ; comparable entre extraits. |
| Le **serveur recalcule** `cutCount`, ASL, `syncScore`, `sparkline` | Ne jamais faire confiance au client. |
| `durationSec` **déclarative** | Pas de ffprobe côté serveur ; la vraie limite imposée est 50 Mo. |
| Ressource `/api/clips` séparée | `/api/tracks` et le contrat TP1-TP3 restent intacts. |
| Lecture via `HttpClient` + Blob | Le JWT ne peut pas passer par `<video src>`. |
| `provideHttpClient(withXhr())` | `fetch` ne remonte pas la progression d'envoi (voir trouvailles e2e). |
| Aucune bibliothèque de graphiques ni de composants ajoutée | SVG et canvas natifs, polices système ; moins de dépendances à auditer. |

## Sécurité

| Risque | Parade |
|---|---|
| Lecture d'un clip d'autrui (IDOR) | Règle unique : propriétaire, ou `public`, ou `shared` + dans `sharedWith` + amitié acceptée **au moment de la lecture**. Sinon `404 "Clip inconnu"` (jamais `403`). Retirer un ami le retire des `sharedWith` des clips de l'autre. |
| Énumération des comptes par les invitations | `POST /friends/requests` répond toujours `202` avec le même message ; l'invitation est toujours enregistrée ; une demande sortante n'expose que l'adresse saisie. |
| Données invalides | `analysis` v2 validée clé par clé (bornes, tri, `#rrggbb`) ; étiquettes, annotations, `sharedWith` (amis acceptés seulement), paramètres de requête (paramètres répétés refusés, clés imbriquées ignorées). |
| Faux type de fichier | Vidéo vérifiée sur les octets (`ftyp` avec marque MP4 connue, EBML pour WebM ; MOV, HEIC, 3GP refusés) ; pellicule JPEG `FF D8 FF`. Refus = fichiers supprimés du disque. |
| Dépassement de ressources | Limites multipart (8 champs de 256 ko, 10 parties), taille contrôlée par champ à l'écriture, 50 Mo, 200 annotations par clip (ajout atomique), 50 invitations en attente, JSON de 1 Mo. |
| Requêtes coûteuses | Agrégations MongoDB bornées (étiquettes : 100 max ; activité : chaque source limitée à `limit` ≤ 50), pages de 20 max. |
| Fuite d'informations | Noms de fichiers disque jamais renvoyés ; e-mail visible seulement entre les deux parties d'une relation, jamais dans clips, découverte ou activité. |

## Tests (résultats vérifiés le 27/10/2026)

| Suite | Commande | Résultat |
|---|---|---|
| Backend | `cd backend && npm test` | 138 réussis, 0 échec (phase 1 : 72) |
| Frontend | `cd frontend-starter && npx ng test --watch=false` | 512 réussis, 48 fichiers (phase 1 : 283, 25 fichiers) |
| Build | `npx ng build` | OK, Initial total 1,00 Mo (215,83 kB transférés) ; phase 1 : 810,60 kB |
| E2E | `cd frontend-starter && npm run e2e` | 20 tests Playwright dans 3 fichiers (`shell` 2, `studio` 10, `detection-quality` 8), 20 réussis au dernier passage de l'agent de test |

Backend : MongoDB simulé en mémoire (`backend/test/fake-mongo.js`), fichiers `clips`, `clips-v2`, `friends-sharing`, `securite-bonus`. Frontend : algorithmes sur données fabriquées, services (`HttpTestingController`), composants avec analyseur simulé.

**E2E sur vidéos réelles** (Chrome système, API simulée par `e2e/support/api-mock.ts`) : import MP4 et WebM avec contrôle de l'envoi multipart, 5 refus (OGV, MOV, faux fichier, fichier vide, 57 Mo), annulation en cours d'analyse, sensibilité monotone, plan unique (méduse), thème persistant, navigation sans erreur console. Les vidéos ne sont pas dans le dépôt : `FILM_PULSE_SAMPLES=<dossier>` (défaut `~/Downloads/film-pulse-test`) ; sans elles, les tests sont ignorés avec un message.

### Qualité de la détection

La détection a été évaluée sur de **vraies vidéos** (Chrome réel) contre une **vérité terrain** établie à la main en regardant des planches contact (une image toutes les 0,1 s, puis 1/24 s sur les passages ambigus), publiée dans `frontend-starter/e2e/support/ground-truth.ts`. Tolérance : ±0,3 s.

| Vidéo | Coupes réelles | Coupes détectées | Rappel | Précision | Fondus détectés |
|---|---|---|---|---|---|
| Bande-annonce Sintel (52 s) | 8 | 7 | 0,88 | 1,00 | 6 |
| Sintel 10 s (360p et 720p) | 8 | 7 | 0,88 | 1,00 | 1 |
| Big Buck Bunny 10 s (3 fichiers) | 0 | 0 | 1,00 | 1,00 | 0 |
| Méduse 10 s (MP4 et WebM) | 0 | 0 | 1,00 | 1,00 | 0 à 1 |

Premier constat, avant réglage : rappel 0,50 et précision 0,44 sur la bande-annonce, et 2 fausses coupes sur la méduse en WebM. Une bande-annonce de ce type ne contient en réalité que 8 coupes franches, le reste étant des fondus : l'intuition « beaucoup plus de coupes » était fausse.

Ce qui a changé : la distance d'histogramme (qui créait les fausses coupes sur les fondus et les artefacts d'encodage) est remplacée par un écart de luminance par blocs de 16×12 avec recalage de ±4 pixels ; le seuil devient local (médiane + k·MAD sur environ 2 s, plancher de 0,04) ; un pic doit dominer ses voisins sur ±0,2 s et une image isolée sur plan fixe est rejetée comme artefact. Coefficient par défaut `k = 4`. La sensibilité reste monotone (bande-annonce, de k = 6 à k = 1 : 7, 7, 7, 7, 7, 9, 10, 10, 13, 15, 18 coupes).

Limites restantes, mesurées :
- une coupe manquée à 13,9 s (deux plans aux couleurs presque identiques) ;
- les rafales de coupes espacées de moins de 0,3 s comptent pour une seule (échantillonnage à 10 img/s) ;
- marge de `k = 4` mince : en dessous de 3,5, des fausses coupes apparaissent sur le mouvement rapide ;
- les fondus ne se distinguent plus bien du mouvement (environ la moitié des fondus détectés sur la bande-annonce sont du mouvement) ;
- les anciennes analyses enregistrées gardent leurs `diffs` d'histogramme : les recalculer avec le curseur donne de moins bons résultats ;
- le réglage repose sur 3 vidéos : risque de surapprentissage, à confirmer sur un corpus plus large.

### Trouvailles des tests e2e

| Constat | Suite |
|---|---|
| La barre de progression d'envoi ne bougeait plus : Angular 22 utilise `fetch` par défaut, qui n'émet pas `UploadProgress` | Corrigé : `withXhr()` dans `src/main.ts` (commit `f0792ec`) |
| Nombre de coupes à régler sur certaines vidéos (bande-annonce sous-détectée, fausses coupes sur un plan unique en WebM) | Voir « Qualité de la détection » |

## Deux revues indépendantes (modèle fable)

| Périmètre | Résultat | Correctifs |
|---|---|---|
| Backend (accent sur le contrôle d'accès du partage) | 0 bloquant, aucun accès non autorisé trouvé, 6 points importants corrigés | commit `9fbc8dc` : invitations indiscernables, limites multipart, agrégations bornées, marques MP4 |
| Frontend | 0 bloquant, 6 points importants corrigés | commit `54d58f1` : annulations au changement d'extrait, resynchronisation, affiches différées, formats unifiés |

Revue de la phase 1 : 5 points importants corrigés (`bd20444`, `e2967e0`).

## Limites connues

- **MongoDB simulé** dans la suite principale (`npm test`). Un test d'intégration distinct (`npm run test:integration`, 13 tests) rejoue le parcours clé contre un vrai MongoDB éphémère et passe, sans écart trouvé. Il couvre le parcours principal, pas chaque cas limite.
- `durationSec` **déclarative** : le serveur ne sonde pas la vidéo.
- **Vidéos très sombres** : peu de contraste de luminance, la détection y est moins fiable.
- Précision des coupes limitée par l'échantillonnage à 10 img/s (≈ 0,1 s) ; lecture image par image à 25 i/s fixe (le navigateur n'expose pas la cadence).
- Test `tracks-page` intermittent (préexistant, timeouts ~13 s) : relancer la suite en cas d'échec isolé.
- Deux backends HTTP possibles côté Angular (`fetch` par défaut, XHR choisi) : tout nouveau besoin de progression doit rester sur `withXhr()`.
- Les clips v1 (sans `diffs`) ne permettent pas de régler la sensibilité.
- Décodage réel de vidéo et d'audio non testé en jsdom : couvert seulement par les tests e2e.

## Dépendance ajoutée

`@playwright/test` ^1.64.1, **devDependency** du frontend (tests e2e), licence Apache-2.0, maintenue par Microsoft. Utilise Google Chrome installé (`channel: 'chrome'`), car le Chromium de Playwright ne lit pas H.264/AAC. Aucune dépendance de production ajoutée en phase 2.

`mongodb-memory-server` ^11.3.0, **devDependency** du backend (test d'intégration sur vrai MongoDB), licence MIT. Elle télécharge le binaire `mongod` au premier lancement (mis en cache) ; aucune connexion à la base Atlas.

## Lancer le projet

```bash
cd backend && cp .env.example .env   # renseigner l'URI MongoDB et le secret JWT
npm install && npm start             # http://localhost:3000
cd frontend-starter && npm install && npm start   # http://localhost:4200
```

Tests : `cd backend && npm test` ; `cd frontend-starter && npm test` ; build : `npm run build` ; e2e : `npm run e2e` (Chrome et vidéos de test requis).

## Usage de l'IA

Un sous-agent par tâche, avec un brief (objectif, fichiers, contraintes, critère de fin) et le modèle le moins cher suffisant :

| Modèle | Tâches |
|---|---|
| opus | implémentation (backend, analyse v2, composants, Studio, Salle de montage, social) ; réglage de la détection |
| sonnet | services HTTP, tests e2e, documentation |
| fable | revues indépendantes (backend, frontend) |

L'agent principal garde le plan, l'intégration, la vérification des tests et la relecture ; commits atomiques. Chaque vague touche des fichiers disjoints (propriété des fichiers dans PLAN-STUDIO.md). Incident : un agent a lancé `git stash` pendant que d'autres travaillaient ; les modifications ont été restaurées sans perte.
