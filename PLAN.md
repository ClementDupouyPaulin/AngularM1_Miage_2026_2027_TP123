# PLAN — Film Pulse (TP4)

**Idée :** envoyer un extrait de film (1–2 min) et afficher son **rythme de montage** comme un électrocardiogramme : coupes détectées, longueur moyenne des plans (ASL), battements de la bande-son et score de synchronisation coupes/musique.

## Décisions de cadrage

| Sujet | Décision | Pourquoi |
|---|---|---|
| Où se fait l'analyse | **Dans le navigateur**, avant l'envoi | Pas de ffmpeg serveur ; algorithmes en fonctions pures, testables sans vidéo |
| Backend | **Nouvelle ressource `/api/clips`** (modèle `Clip`), `/api/tracks` intact | Les 52 tests backend et le contrat TP1–TP3 restent valides |
| Stockage | Vidéo sur disque (comme l'audio), analyse en JSON dans Mongo | Même patron que `Track` |
| Lecture vidéo | `HttpClient` → `Blob` → `ObjectURL` | Le JWT ne passe pas par `<video src>` (même raison que l'audio) |
| Détection des coupes | Image réduite 64×36 sur `<canvas>`, ~10 images/s par **seek**, différence d'histogramme, seuil adaptatif (moyenne + k·écart-type) | Déterministe ; le seuil fixe donne trop de faux positifs |
| Détection des beats | `decodeAudioData` du fichier, énergie par fenêtre, pics au-dessus d'une moyenne locale | Pas de dépendance externe |
| Score de synchro | Part des coupes à ±80 ms d'un beat, rapportée à la part attendue au hasard (≈ 1 = aucun lien, > 1 = calé sur la musique) | Normalisé, comparable entre extraits |
| Limites | 50 Mo, MP4/WebM, 120 s max, 10 img/s | Garde l'analyse sous ~1 min |
| Validation serveur | Type vérifié, `cuts`/`beats` : tableaux de nombres bornés, triés, dans `[0, durée]` ; `cutCount` et ASL **recalculés** côté serveur ; `syncScore` indicatif (borné) | Ne jamais faire confiance au client |

## Contrat HTTP prévu (à ajouter à `API_CONTRACT.md` avec le code)

| Méthode | Route | Requête | Réponse |
|---|---|---|---|
| POST | `/clips` | multipart : `video`, `title`, `analysis` (JSON texte) + JWT | `201 Clip` |
| GET | `/clips?page&limit&q` | JWT | `Page<ClipSummary>` |
| GET | `/clips/:id` | JWT | `Clip` (avec `analysis`) |
| GET | `/clips/:id/video` | JWT | flux vidéo |
| DELETE | `/clips/:id` | JWT | `204` |

`analysis` = `{ version: 1, durationSec, cuts: number[], beats: number[], syncScore: number | null }`.
`ClipSummary` = `id, title, originalName, mimeType, size, durationSec, cutCount, avgShotLength, syncScore, createdAt`.
Erreurs : `400` validation, `401`, `404` « Clip inconnu » (inexistant ou d'autrui), corps `{ message }`.

## Lots (un lot = un livrable testable = un commit)

| # | Lot | Fichiers principaux | Modèle |
|---|---|---|---|
| 0 | Branche `feat/film-pulse` ; assouplir la règle « ne pas modifier backend » dans `frontend-starter/CLAUDE.md` pour `/api/clips` uniquement | `CLAUDE.md` | principal |
| 1 | Backend : modèle `Clip`, routes, validation de l'analyse, tests `node:test` | `backend/src/models/Clip.js`, `backend/src/app.js`, `backend/test/clips.test.js`, `API_CONTRACT.md` | opus |
| 2 | Algorithmes purs : `detectCuts`, `detectBeats`, `syncScore`, `averageShotLength` + tests sur données fabriquées | `src/app/shared/analysis/*.ts` + specs | opus |
| 3 | `ClipAnalyzerService` : échantillonnage vidéo/canvas, décodage audio, progression (Signal), annulation | `src/app/shared/services/clip-analyzer.service.ts` + spec (mocks) | opus |
| 4 | `ClipService` HTTP + modèles + route `/clips` protégée | `shared/services/clip.service.ts`, `shared/models/clip.model.ts`, `routes.ts` | sonnet |
| 5 | Page « Mes extraits » : choix du fichier, analyse avec barre de progression, aperçu du résultat, envoi, liste paginée, suppression | `components/clips-page/*` | opus |
| 6 | Détail : lecteur + timeline du pouls (SVG), coupes et beats, clic = saut, curseur synchronisé, stats | `components/clip-detail/*` | opus |
| 7 | Comparaison de deux extraits sur le même graphique | `components/clip-compare/*` | opus |
| 8 | Bonus : extraits publics/privés, partage, classement « film le plus nerveux » | backend + front | opus |
| 9 | Revue finale, build, `REPORT.md`, mise à jour `RAPPORT_IA_MODELE.md` | — | fable / sonnet |

**Ordre :** 0 → 1 et 2 en parallèle (fichiers disjoints) → 3 → 4 → 5 → 6 → 7 → 8 → 9. Le lot 8 est facultatif ; les lots 1 à 6 forment le MVP.

## Tests prévus

- **Algorithmes (lot 2)** : tableaux de pixels et de signaux fabriqués ; 0 coupe sur images identiques, 1 coupe sur un changement net, pas de coupe sur un simple fondu léger ; beats sur un signal périodique ; score ≈ 1 sur coupes aléatoires, > 1 sur coupes alignées.
- **Backend (lot 1)** : 401 sans token, 400 (type, taille, JSON invalide, `cuts` hors bornes ou non trié), 404 sur le clip d'autrui, recalcul serveur de `cutCount`/ASL, suppression qui efface le fichier.
- **Frontend (lots 3–7)** : `HttpTestingController` pour le service, composants avec mocks de l'analyseur ; les `<video>`/`<canvas>` réels ne sont pas testés dans jsdom.

## Risques

| Risque | Parade |
|---|---|
| Seek vidéo lent ou imprécis selon le navigateur | Échantillonnage à 10 img/s, limite 120 s, progression visible, annulation |
| `decodeAudioData` échoue (codec, piste absente) | Analyse des coupes seule ; `syncScore: null` et message clair |
| Faux positifs (flashs, mouvements rapides) | Seuil adaptatif, délai minimal entre deux coupes (~0,3 s), réglage exposé en bonus |
| Mémoire (blob 50 Mo) | Plafond de taille, `revokeObjectURL` systématique (acquis TP2) |
| Droits des extraits de films | Usage pédagogique privé ; mention dans le rapport, pas de partage public par défaut |
| `syncScore` falsifiable par le client | Indicatif seulement ; le classement du lot 8 le recalculera côté serveur ou sera marqué « déclaratif » |

## Critère de fin du MVP (lots 0–6)

Un utilisateur connecté choisit un extrait, voit sa timeline de coupes avec ASL et score de synchro, l'envoie, le retrouve dans sa liste paginée, le rouvre, clique sur un pic pour sauter à la coupe, puis le supprime. `npm test` (backend et frontend) et `npm run build` passent.
