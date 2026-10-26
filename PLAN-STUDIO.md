# PLAN-STUDIO — Film Pulse v2 « Salle de montage »

Phase 2 du TP4, après le MVP de [PLAN.md](PLAN.md). Objectif : analyse plus riche, partage social et refonte totale du design, le tout interconnecté. Les types TypeScript du contrat sont dans `frontend-starter/src/app/shared/models/{clip,friend}.model.ts` (source de vérité côté front).

## Interconnexions visées

Une analyse produit **une seule donnée riche** (`ClipAnalysis` v2) qui alimente toutes les vues :

- **Studio** (bibliothèque) : cartes avec affiche (1re vignette), mini-courbe (`sparkline`), profil de rythme, étiquettes, visibilité ; statistiques globales, filtres, tri, étiquettes.
- **Salle de montage** (détail) : lecteur, timeline (coupes, fondus, beats, annotations, bande de palette, survol = vignette), curseur de sensibilité (re-détection locale depuis `diffs`, sans relire la vidéo, enregistrable), histogramme des durées de plan, courbe d'accélération, BPM musique contre coupes/min, annotations horodatées, partage, export PNG/JSON.
- **Comparaison** : lecture synchronisée des deux vidéos, timelines, palettes et histogrammes superposés.
- **Découvrir** : clips publics ou partagés avec moi, recherche, étiquettes, classements « le plus nerveux » / « le plus calé sur la musique ».
- **Amis** : invitations, liste, fil d'activité (nouveaux clips des amis, annotations reçues). Retirer un ami révoque aussitôt ses accès.

## Contrat HTTP v2 (préfixe `/api`, JWT partout sauf auth)

Règle d'accès en lecture à un clip : propriétaire, ou `visibility='public'`, ou `visibility='shared'` ET lecteur dans `sharedWith` ET amitié acceptée avec le propriétaire. Sinon `404 {message:"Clip inconnu"}`. Seul le propriétaire modifie ou supprime.

| Méthode | Route | Corps / paramètres | Réponse |
|---|---|---|---|
| POST | `/clips` | multipart : `video`, `title`, `analysis` (JSON v2), `filmstrip` (JPEG ≤ 1 Mo, optionnel), `tags` (JSON `string[]`, optionnel), `visibility` (optionnel, défaut `private`) | `201 Clip` |
| GET | `/clips?page&limit&q&tag&visibility` | mes clips | `Page<ClipSummary>` |
| GET | `/clips/stats` | – | `LibraryStats` |
| GET | `/clips/tags` | – | `TagCount[]` (mes étiquettes) |
| GET | `/clips/discover?scope&sort&q&tag&page&limit` | `scope`: `public`\|`friends`\|`shared` ; `sort`: `recent`\|`nervous`\|`synced` | `Page<ClipSummary>` (jamais mes clips) |
| GET | `/clips/:id` | – | `Clip` |
| GET | `/clips/:id/video` · `/clips/:id/filmstrip` | – | flux · `image/jpeg` |
| PATCH | `/clips/:id` | `ClipPatch` ; `sharedWith` = amis acceptés uniquement | `200 Clip` |
| PUT | `/clips/:id/analysis` | analyse v2 (cuts retouchés) | `200 Clip` |
| DELETE | `/clips/:id` | – | `204` (supprime vidéo, pellicule, annotations) |
| POST | `/clips/:id/annotations` | `{time, text}` (tout lecteur autorisé) | `201 ClipAnnotation` |
| DELETE | `/clips/:id/annotations/:annotationId` | auteur ou propriétaire | `204` |
| GET | `/friends` | – | `FriendsOverview` |
| POST | `/friends/requests` | `{email}` | `202 {message}` générique (pas d'énumération de comptes) ; `400` soi-même ; `409` déjà ami ou invité |
| POST | `/friends/requests/:id/accept` | destinataire seulement | `200 FriendEntry` |
| DELETE | `/friends/:id` | refuse, annule ou retire (l'une ou l'autre partie) | `204` |
| GET | `/activity?limit=20` | – | `ActivityEvent[]` |

Validation serveur (jamais confiance au client) : `analysis` v2 strict (clés connues, `diffs` ≤ 1300 valeurs dans [0,1], `palette` ≤ 130 couleurs `#rrggbb`, `transitions`/`cuts`/`beats` triés et bornés, `thumbnailTimes` ≤ 41 triés, `sensitivity` dans [1,6]) ; la version 1 reste acceptée et normalisée à la lecture (valeurs par défaut). `cutCount`, `avgShotLength`, `syncScore` et `sparkline` sont toujours recalculés. Étiquettes : 5 max, 1–24 caractères, minuscules. Annotations : texte 1–280, 200 max par clip, `time` dans [0, durée]. Pellicule : JPEG vérifié sur les octets (`FFD8FF`).

## Direction artistique — « Salle de montage »

Cinéma et montage : sombre par défaut (salle de projection), variante claire « jour ». Aucun nouveau paquet : polices système, motifs en CSS/SVG.

| Jeton | Rôle |
|---|---|
| `--bg`, `--surface`, `--surface-2`, `--surface-3` | fonds étagés (encre → panneaux) |
| `--text`, `--text-muted`, `--border` | texte et filets |
| `--accent` (ambre pellicule), `--accent-strong`, `--on-accent` | action principale |
| `--rec` (rouge) | coupes, REC, destructif |
| `--beat` (cyan) | beats |
| `--fade` (violet) | fondus |
| `--success`, `--danger`, `--focus` | états |
| `--space-1…6`, `--radius-sm/md/lg`, `--shadow-sm/md/lg`, `--font-sans`, `--font-mono`, `--perf` | échelle, ombres, polices, perforations |

Motifs : perforations de pellicule sur les cartes, logo claquette, courbe ECG animée dans la marque et le bandeau, point REC, code temporel en police mono (`00:12:05`), bandeau 2,39:1, fond granuleux discret. Tout respecte `prefers-reduced-motion` et le contraste AA. Les anciens jetons (`--brand`…) restent comme alias pour ne rien casser. Le guide est dans `frontend-starter/docs/design-system.md`.

## Lots et propriété des fichiers

Chaque agent ne touche que ses fichiers. Les erreurs de compilation hors de son périmètre sont attendues tant que la vague n'est pas finie : il vérifie son périmètre (`tsc` filtré, specs ciblés).

| # | Lot | Fichiers | Modèle | Vague |
|---|---|---|---|---|
| F0 | Design system, coque, auth, profil, page Bandes-son (CSS/HTML seulement, hooks de test conservés) | `styles.css`, `index.html`, `components/{app,login-page,register-page,profile-page,tracks-page}` (+ confirm-delete-dialog), `docs/design-system.md` | opus | 1 |
| B1 | Backend clips v2 : analyse v2, pellicule, étiquettes, annotations, PATCH, PUT analysis, stats, tags | `backend/src/models/Clip.js`, `backend/src/app.js`, `backend/test/clips*.test.js`, `API_CONTRACT.md` | opus | 1 |
| B2 | Backend social : amitiés, visibilité et partage, discover, activité | `backend/src/models/Friendship.js`, `app.js`, tests, `API_CONTRACT.md` | opus | après B1 |
| A1 | Analyse v2 : transitions, palette, re-détection `diffs`+`k`, profil de rythme, tempo, vignettes, Worker | `shared/analysis/*`, `shared/services/clip-analyzer.service.ts`, `angular.json`/`tsconfig.worker.json` | opus | 2a |
| S1 | Services HTTP v2 : clips (tous les endpoints), amis, activité | `shared/services/{clip,friend,activity}.service.ts` (+specs) | sonnet | 2a |
| U2a | Composants graphiques réutilisables : timeline v2, pellicule, bande de palette, histogramme des durées, courbe d'accélération, mini-courbe | `components/{pulse-timeline,filmstrip,palette-band,shot-histogram,acceleration-chart,sparkline}` | opus | 2a |
| U1 | Studio : tableau de bord, import avec aperçu en direct, sensibilité, étiquettes, visibilité, grille de cartes | `components/clips-page/*` | opus | 2b |
| U2b | Salle de montage : lecteur, annotations, partage, sensibilité enregistrable, export | `components/clip-detail/*`, `components/share-dialog/*` | opus | 2b |
| U3 | Comparaison synchronisée | `components/clip-compare/*` | opus | 2b |
| U4 | Social : Découvrir (+ classements), Amis (+ fil d'activité) | `components/{discover-page,friends-page}/*` | opus | 2b |
| E1 | Tests de bout en bout Playwright sur les vidéos réelles (API simulée) | `frontend-starter/e2e/*`, `playwright.config.ts`, `package.json` (devDependency, à signaler) | sonnet | 3 |
| D1 | Documentation : `REPORT.md`, README, docs du design et des fonctions | `REPORT.md`, `docs/*` | sonnet | 3 |
| R | Revue finale, accent sur le contrôle d'accès du partage (IDOR), puis corrections | – | fable | 3 |

Intégration (agent principal) : `routes.ts` (clips, discover, friends), navigation, vérification globale (`npm test` des deux côtés, `ng build`), commits atomiques.

## Critère de fin

Les deux suites de tests et le build passent ; les parcours sont jouables de bout en bout (import → analyse → pellicule et palette → réglage de sensibilité → annotation → partage à un ami → visible dans Découvrir et le fil d'activité → comparaison synchronisée) ; aucune règle d'accès contournable ; design cohérent sur toutes les pages en thème sombre et clair.
