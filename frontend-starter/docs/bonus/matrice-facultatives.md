# Matrice des fonctionnalités facultatives (TP2 et TP3)

Pour chaque fonctionnalité facultative des sujets, son **statut réel**, la
**preuve** disponible et les **fichiers** concernés. Le but est qu'on puisse
vérifier d'un coup d'œil ce qui est fait, ce qui est prouvé et comment.

Légende des preuves : **T** = test automatisé ; **R** = vérifié en ligne de
commande contre le vrai serveur ([`preuves-integration-reelle.md`](./preuves-integration-reelle.md)) ;
**N** = capture Network dans le navigateur, à produire par le binôme (aucune n'a
été produite par les agents). Chemins relatifs à `frontend-starter/` pour le
frontend, à la racine du dépôt pour `backend/`.

> **Chiffres définitifs mesurés** (orchestrateur) : frontend **188 tests / 15
> fichiers, tous verts** ; backend **52 tests, tous verts** ; `tsc --noEmit` (app et
> spec) sans erreur ; build **737,04 kB** (161,41 kB transférés). Le code est figé.

---

## 1. Les fonctionnalités facultatives et leur statut

| # | Fonctionnalité (source) | Statut | Preuve | Fichiers principaux | Documentation |
|---|---|---|---|---|---|
| 1 | **Barre de progression de l'upload** (TP2, « améliorations facultatives ») | **fait** — devenue **obligatoire** au TP3 (Mission 6) | T ; N à produire | `src/app/shared/services/track.service.ts` (`upload`, `observe: 'events'`), `src/app/components/tracks-page/tracks-page.ts` (`uploadProgress`), `src/main.ts` (pas de `withFetch()`) | [`../tp3/progression-upload.md`](../tp3/progression-upload.md) |
| 2 | **Suppression avec confirmation** `DELETE /api/tracks/:id` (TP2) | **fait** — devenue **obligatoire** au TP3 (Mission 5) | T ; R (`204`, puis `404`) ; N à produire | `track.service.ts` (`remove`), `tracks-page.ts` (`remove`, `deleteTrack`), `confirm-delete-dialog/`, `backend/src/app.js:689` | [`../tp3/suppression-de-piste.md`](../tp3/suppression-de-piste.md) |
| 3 | **Rafraîchissement après suppression** (TP2) | **fait** — devenu **obligatoire** au TP3 (Mission 5 : « mise à jour du contenu de la page ») | T | `tracks-page.ts` : `load()` après `DELETE`, retour à la page précédente si on vide une page | [`../tp3/suppression-de-piste.md`](../tp3/suppression-de-piste.md) §3.6-3.7 |
| 4 | **Formatage lisible de la taille et de la date** (TP2) | **fait** — **aucun test dédié trouvé** | visuel ; N sans objet | `tracks-page.ts` (`formatSize` : o / Ko / Mo ; `formatKind`), `tracks-page.html` (`date: 'dd/MM/yyyy HH:mm'`) | ce tableau |
| 5 | **Filtre par titre** (TP2) | **fait** | T (backend et frontend) ; R ; N à produire | `backend/src/app.js:538-563`, `track.service.ts:22-27`, `tracks-page.ts`, `tracks-page.html` | [`filtre-par-titre.md`](./filtre-par-titre.md) |
| 6 | **AVANCÉ — Angular Material Paginator** (TP2, mission 2) | **fait** | T ; N à produire | `tracks-page.ts` / `.html`, `french-paginator-intl.ts`, `angular.json` (thème) | [`materiel-paginator.md`](./materiel-paginator.md) |
| 7 | **AVANCÉ — Pagination Mongoose** `aggregate-paginate-v2` (TP2, mission 2) | **fait** | T ; R ; N à produire | `backend/src/app.js:566-588`, `backend/src/models/Track.js:39`, `API_CONTRACT.md`, `src/app/shared/models/page.model.ts` | [`pagination-mongoose.md`](./pagination-mongoose.md) |
| 8 | **AVANCÉ — Image de couverture** (TP2, mission 3) | **fait** (upload d'une image, tags ID3, recherche Web iTunes, retrait) | T (frontend et backend) ; R (56 vérifications réelles, dont iTunes) ; N à produire | backend : `backend/src/app.js` (routes de pochette), `backend/src/models/Track.js` ; frontend : `track-cover/`, `cover-search-dialog/`, `cover-file.ts`, `file-extension.ts`, `confirm-delete-dialog/` (`target: 'cover'`), `tracks-page.*`, `track.service.ts` | [`pochettes.md`](./pochettes.md), [`etude-id3-et-services-web.md`](./etude-id3-et-services-web.md) |
| 9 | **Extension backend facultative : tests de contrat** (TP3, mission 7) | **fait** — 31 tests (`tracks.test.js`) + 19 (`securite-bonus.test.js`, relecture) ; 52 en tout | T (52/52) ; R | `backend/test/tracks.test.js`, `backend/test/securite-bonus.test.js` | [`tests-de-contrat-backend.md`](./tests-de-contrat-backend.md), [`relecture-independante.md`](./relecture-independante.md) |

### Précisions ligne par ligne

**1-3 : trois « facultatives » devenues obligatoires.** Le sujet du TP2 listait
la barre de progression, la suppression avec confirmation et le rafraîchissement
après suppression parmi les « améliorations facultatives ». Le sujet du TP3 les
rend **obligatoires** (Mission 5 : suppression, confirmation, état de suppression,
message, mise à jour de la page ; Mission 6 : progression). Elles sont donc
comptées ici pour mémoire : ne pas les présenter comme des bonus dans le rapport.

**2 : la confirmation.** Elle est faite avec un dialogue Material
(`MatDialog`, `ConfirmDeleteDialogComponent`), pas avec `window.confirm()`. Le
dialogue est partagé avec le retrait d'une pochette (`data.target: 'cover'`).

**4 : aucun test dédié.** `formatSize` (`tracks-page.ts`, méthode du même nom) et le
format de date du `DatePipe` s'exécutent dans les cards, mais une recherche dans
`tracks-page.spec.ts` ne trouve aucune assertion sur leur sortie (« 1,5 Mo »,
« dd/MM/yyyy »). Statut honnête : **fait mais non verrouillé par un test**.

**5 : preuves multiples.** Backend : test `tracks.test.js:431` et `:453` ;
frontend : `track.service.spec.ts:129`, `:143` et `tracks-page.spec.ts` (bloc
« filtre par titre ») ; réel : `BLUES` → 3, `zzz` → 0, `.*` → 0, `(` → 200, 101
caractères → 400.

**6 et 7 : deux « AVANCÉ » indépendantes.** On peut avoir la pagination Mongoose
sans le paginator Material (et inversement) : le frontend ne lit que `total`,
`page` et `limit`, ce qui est précisément ce qui rend les deux découplées.

**8 : image de couverture.** Réalisée **des deux façons** demandées par le sujet :
l'utilisateur envoie une image (à l'upload ou plus tard avec « Changer la pochette »),
et l'application récupère l'image embarquée dans les tags ID3 ou en cherche une sur le
Web (iTunes, **uniquement sur action explicite**). Preuves : tests frontend (voir
[`pochettes.md`](./pochettes.md) §8), tests backend simulés et vérifications réelles
contre le serveur, MongoDB Atlas et iTunes. **Reste ouvert** : la décision sur la
copie locale des pochettes Web au regard des conditions d'Apple
([`etude-id3-et-services-web.md`](./etude-id3-et-services-web.md) §5) — c'est une
décision du binôme, pas un défaut de l'implémentation.

---

## 2. Le contenu obligatoire du TP3, pour mémoire

| Mission | Contenu | Statut | Documentation |
|---|---|---|---|
| 5 | Suppression d'une piste | fait | [`../tp3/suppression-de-piste.md`](../tp3/suppression-de-piste.md) |
| 6 | Progression de l'upload | fait | [`../tp3/progression-upload.md`](../tp3/progression-upload.md) |
| 7 | Tests automatisés (au moins trois frontend) | fait | [`../tp3/tests-automatises.md`](../tp3/tests-automatises.md) |

---

## 3. Ce que ce tableau ne dit pas

- **Les captures Network (N) n'ont été produites par personne.** Les preuves en
  ligne de commande (R) valident le contrat HTTP, pas l'interface. Chaque
  document cité plus haut contient la procédure exacte à suivre.
- **« Fait » veut dire « implémenté et couvert par des tests »**, pas « validé par
  un utilisateur dans un navigateur » : seul le binôme peut faire cette dernière
  vérification.

**[À COMPLÉTER PAR LE BINÔME]** — pour chaque ligne marquée « N à produire »,
joindre la capture correspondante au rapport (`RAPPORT_IA_MODELE.md`) et cocher
ici ce que vous avez effectivement observé, avec la date. Ne cochez pas une ligne
que vous n'avez pas vérifiée vous-mêmes dans le navigateur.
