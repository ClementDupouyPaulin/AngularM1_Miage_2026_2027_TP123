# Documentation du projet — index

Documentation technique du frontend Angular (« Guitar Practice Cloud »), écrite
au fil des TP. Les documents citent leurs sources sous la forme `fichier:ligne`,
pour qu'on puisse toujours retourner voir le code. **Ces renvois ont été
re-vérifiés sur le code figé** (voir l'avertissement avant « Deux règles ») ; ils
vieilliront dès que le code bougera : à chaque renvoi, le **nom** de la fonction ou
de la constante est cité à côté, et c'est lui qui fait foi.

Les chemins frontend sont relatifs à `frontend-starter/`, les chemins backend à
la racine du dépôt.

## Par où commencer

| Vous cherchez… | Document |
|---|---|
| Comment l'application est organisée (composant racine, routes, `HttpClient`, services, JWT) | [`mission0-cartographie.md`](./mission0-cartographie.md) |
| Ce qui se passe quand on clique sur « Se connecter » | [`mission1/flux-connexion-et-signals.md`](./mission1/flux-connexion-et-signals.md) |
| La différence entre un Signal et `localStorage` | [`mission1/flux-connexion-et-signals.md`](./mission1/flux-connexion-et-signals.md) (2ᵈ moitié) |
| Quelles routes sont publiques, lesquelles exigent un JWT | [`mission0-cartographie.md` §6](./mission0-cartographie.md#6-routes-publiques-et-routes-protégées) |
| Où se fait la mise à jour du profil, front **et** back | [`mission1/questions-reponses.md`](./mission1/questions-reponses.md#où-seffectue-la-mise-à-jour-du-profil-utilisateur-) |
| Comment marchent l'upload et la lecture audio | [`tp2/upload-et-lecture-audio.md`](./tp2/upload-et-lecture-audio.md) |
| Pourquoi on passe par un `Blob` et pas par `<audio src="/api/...">` | [`tp2/upload-et-lecture-audio.md` §4](./tp2/upload-et-lecture-audio.md#4-pourquoi-une-url-placée-directement-dans-src-ne-reçoit-pas-le-jwt) |
| Mémoire, buffering, streaming : les 5 questions du TP2 | [`tp2/questions-memoire-buffering-streaming.md`](./tp2/questions-memoire-buffering-streaming.md) |
| Pourquoi valider un fichier côté frontend **et** côté backend | [`tp2/upload-et-lecture-audio.md` §6](./tp2/upload-et-lecture-audio.md#6-validation-frontend-et-validation-backend) |
| Comment marche la suppression d'une piste | [`tp3/suppression-de-piste.md`](./tp3/suppression-de-piste.md) |
| Pourquoi le guard Angular ne sécurise pas la suppression | [`tp3/suppression-de-piste.md` §5](./tp3/suppression-de-piste.md#5-pourquoi-le-guard-angular-et-linterface-ne-suffisent-pas) |
| Comment marche la barre de progression, et pourquoi 100 % ≠ réussite | [`tp3/progression-upload.md`](./tp3/progression-upload.md) |
| Les tests : ce qu'ils vérifient, pourquoi sans MongoDB | [`tp3/tests-automatises.md`](./tp3/tests-automatises.md) |
| **Réviser l'oral : les 6 questions du TP3** | [`tp3/restitution-orale.md`](./tp3/restitution-orale.md) |
| **Les bonus : ce qui est fait, prouvé, et où** | [`bonus/matrice-facultatives.md`](./bonus/matrice-facultatives.md) |
| Pagination Mongoose, filtre par titre, `MatPaginator` | [`bonus/`](./bonus/README.md) |
| **Les pochettes** : upload d'une image, affichage via `Blob`, recherche Web, retrait | [`bonus/pochettes.md`](./bonus/pochettes.md) |
| **La relecture indépendante** : 6 défauts trouvés, ce qui n'a pas été trouvé, les limites restantes | [`bonus/relecture-independante.md`](./bonus/relecture-independante.md) |
| Tests de contrat du backend et preuves contre le vrai serveur | [`bonus/tests-de-contrat-backend.md`](./bonus/tests-de-contrat-backend.md), [`bonus/preuves-integration-reelle.md`](./bonus/preuves-integration-reelle.md) |
| Tags ID3, services Web de pochettes, droits d'usage, SSRF | [`bonus/etude-id3-et-services-web.md`](./bonus/etude-id3-et-services-web.md) |
| Thème sombre, accessibilité des formulaires, lien d'évitement | [`bonus/ui-ux-authentification.md`](./bonus/ui-ux-authentification.md) |
| L'historique des correctifs d'authentification | [`mission1/README.md`](./mission1/README.md) et les 5 fichiers `probleme-*.md` |

## Arborescence

```text
docs/
├── README.md ........................... ce fichier (index)
├── mission0-cartographie.md ............ TP1 / Mission 0 : cartographie de l'app,
│                                         routes publiques vs protégées
├── mission1/ ........................... TP1 / Mission 1 : authentification et profil
│   ├── README.md ....................... méthode suivie, historique des tests
│   ├── questions-reponses.md ........... réponses aux questions du TP1
│   ├── flux-connexion-et-signals.md .... schéma du flux de login + Signal vs localStorage
│   ├── probleme-1-deconnexion.md
│   ├── probleme-2-chargement-auto-profil.md
│   ├── probleme-3-gestion-401.md
│   ├── probleme-4-validation-formulaires.md
│   └── probleme-5-robustesse-mot-de-passe.md
├── tp2/ ................................ TP2 / Missions 2 et 3 : bibliothèque et audio
│   ├── upload-et-lecture-audio.md ...... repérage du flux, Blob/ObjectURL,
│   │                                     JWT et `src`, validation front/back
│   └── questions-memoire-buffering-streaming.md
│                                         les 5 questions du TP2, réponses justifiées
├── tp3/ ................................ TP3 / Missions 5 à 7 : fiabilisation
│   ├── suppression-de-piste.md ......... confirmation, deletingId, SnackBar, 404,
│   │                                     pourquoi le guard ne sécurise rien
│   ├── progression-upload.md ........... événements HTTP, pourcentage,
│   │                                     pourquoi 100 % ≠ réussite
│   ├── tests-automatises.md ............ la suite de tests, HttpTestingController,
│   │                                     vérification par mutation
│   └── restitution-orale.md ............ les 6 questions de l'oral, avec preuves
└── bonus/ .............................. fonctionnalités facultatives et refonte UI/UX
    ├── README.md ....................... index du dossier
    ├── matrice-facultatives.md ......... statut, preuve et fichiers de chaque bonus
    ├── pagination-mongoose.md .......... aggregate-paginate-v2, $facet, cast ObjectId
    ├── filtre-par-titre.md ............. filtre serveur, anti-rebond, échappement regex
    ├── materiel-paginator.md ........... MatPaginator, libellés français
    ├── tests-de-contrat-backend.md ..... 31 + 19 nouveaux tests backend (52 avec les 2
    │                                     existants), limites de l'approche
    ├── preuves-integration-reelle.md ... 56 vérifications + 5 cas contre le vrai serveur
    ├── etude-id3-et-services-web.md .... ID3, iTunes et autres services, droits, SSRF,
    │                                     décision ouverte sur la copie locale
    ├── pochettes.md .................... interface des pochettes : Blob/ObjectURL, version,
    │                                     recherche Web, retrait, anti double-clic
    ├── relecture-independante.md ....... 6 défauts réels, ce qui n'a pas été trouvé, limites
    └── ui-ux-authentification.md ....... jetons de design, thème sombre, accessibilité
```

## Livrables du sujet, et où ils se trouvent

### TP1 (`SUJET_ETUDIANT_TP1.md`)

| Livrable demandé | Où |
|---|---|
| Code frontend complété | dans `src/` |
| Schéma annoté du flux de connexion | [`mission1/flux-connexion-et-signals.md`](./mission1/flux-connexion-et-signals.md) |
| Capture Network d'une requête d'authentification | **[À COMPLÉTER PAR LE BINÔME]** — procédure dans `mission1/questions-reponses.md` (fin) ; ranger les images dans `docs/captures/` et les lier depuis `RAPPORT_IA_MODELE.md` |
| Explication Signal vs `localStorage` | [`mission1/flux-connexion-et-signals.md`](./mission1/flux-connexion-et-signals.md) |
| Rapport d'usage de l'IA | `RAPPORT_IA_MODELE.md` (à la racine du dépôt) |

### TP2 (`SUJET_ETUDIANT_TP2.md`)

| Livrable demandé | Où |
|---|---|
| Code frontend complété, cards de bibliothèque | dans `src/app/components/tracks-page/` |
| Capture Network de la pagination ou de l'upload | **[À COMPLÉTER PAR LE BINÔME]** — procédure dans [`tp2/upload-et-lecture-audio.md` §6](./tp2/upload-et-lecture-audio.md#à-vérifier-soi-même) |
| Capture/démonstration de la lecture audio authentifiée | **[À COMPLÉTER PAR LE BINÔME]** — procédure dans [`tp2/upload-et-lecture-audio.md` §4](./tp2/upload-et-lecture-audio.md#à-vérifier-soi-même-dans-les-devtools) |
| Explication écrite du choix `Blob` et `ObjectURL` | [`tp2/upload-et-lecture-audio.md`](./tp2/upload-et-lecture-audio.md) §3 à §5 |
| Réponses aux questions mémoire / buffering / streaming | [`tp2/questions-memoire-buffering-streaming.md`](./tp2/questions-memoire-buffering-streaming.md) |

### TP3 (`SUJET_ETUDIANT_TP3.md`)

| Livrable demandé | Où |
|---|---|
| Suppression fonctionnelle d'une piste | code : `tracks-page.ts` (`remove()`, `deleteTrack()`) · doc : [`tp3/suppression-de-piste.md`](./tp3/suppression-de-piste.md) |
| Progression d'upload | code : `tracks-page.ts` (`upload()`) · doc : [`tp3/progression-upload.md`](./tp3/progression-upload.md) |
| Au moins trois tests frontend | 15 fichiers `*.spec.ts` dans `src/app/` (188 tests, tous verts) · doc : [`tp3/tests-automatises.md`](./tp3/tests-automatises.md) |
| Rapport des tests (attendus et observés) | [`tp3/tests-automatises.md`](./tp3/tests-automatises.md) §1, §2, §5 et §7 |
| Capture Network d'une suppression et d'un upload | **[À COMPLÉTER PAR LE BINÔME]** — procédures dans [`tp3/suppression-de-piste.md` §6](./tp3/suppression-de-piste.md#à-vérifier-soi-même) et [`tp3/progression-upload.md` §6](./tp3/progression-upload.md#à-vérifier-soi-même) |
| `npm run build` exécuté | résultat dans [`tp3/tests-automatises.md`](./tp3/tests-automatises.md) §2 ; capture **[À COMPLÉTER PAR LE BINÔME]** |
| Rapport IA | `RAPPORT_IA_MODELE.md` |
| Restitution orale (6 questions) | [`tp3/restitution-orale.md`](./tp3/restitution-orale.md) |

### Bonus (facultatifs des sujets TP2 et TP3)

| Fonctionnalité | Où |
|---|---|
| Vue d'ensemble : statut, preuve, fichiers de chaque bonus | [`bonus/matrice-facultatives.md`](./bonus/matrice-facultatives.md) |
| Pagination Mongoose (`aggregate-paginate-v2`) | [`bonus/pagination-mongoose.md`](./bonus/pagination-mongoose.md) |
| Filtre par titre | [`bonus/filtre-par-titre.md`](./bonus/filtre-par-titre.md) |
| `MatPaginator` | [`bonus/materiel-paginator.md`](./bonus/materiel-paginator.md) |
| Extension backend : tests de contrat | [`bonus/tests-de-contrat-backend.md`](./bonus/tests-de-contrat-backend.md) |
| Preuves contre le vrai serveur (ligne de commande, **pas** des captures Network) | [`bonus/preuves-integration-reelle.md`](./bonus/preuves-integration-reelle.md) |
| Étude ID3 / services Web / droits d'usage (« Image de couverture ») | [`bonus/etude-id3-et-services-web.md`](./bonus/etude-id3-et-services-web.md) |
| Interface des pochettes (image de couverture) | [`bonus/pochettes.md`](./bonus/pochettes.md) |
| Relecture indépendante des bonus | [`bonus/relecture-independante.md`](./bonus/relecture-independante.md) |
| Refonte UI/UX de la coque, connexion, inscription, profil | [`bonus/ui-ux-authentification.md`](./bonus/ui-ux-authentification.md) |

Les captures Network des bonus restent **[À COMPLÉTER PAR LE BINÔME]** : la
procédure est dans chaque document du dossier `bonus/`.

> **Renvois `fichier:ligne` : état de la vérification.** Une passe a re-contrôlé les
> renvois des documents sur le code **figé** (`backend/src/app.js` 885 lignes,
> `tracks-page.ts` 1039 lignes, `tracks-page.html` 418, etc.). Elle ne garantit rien
> pour la suite : dès qu'un de ces fichiers change, les numéros se décalent. En cas
> d'écart, repérez l'élément par son **nom** (fonction, constante, route), toujours
> cité à côté : `grep -n "nom" backend/src/app.js`. Pour quelques éléments, seul le
> nom est donné parce que le numéro n'était pas garanti. Les commentaires **du code**
> qui citent eux-mêmes des lignes du backend (par exemple dans `cover-file.ts` et
> `tracks-page.ts`) n'ont pas été touchés : ils peuvent être décalés.

## Deux règles respectées dans toute cette documentation

1. **Aucun secret.** Pas d'URI MongoDB, pas de secret JWT, pas de mot de passe,
   pas de valeur de token. Quand une procédure demande de regarder l'en-tête
   `Authorization` dans les DevTools, elle précise de ne relever que sa
   **présence**, jamais sa valeur.
2. **Rien d'inventé.** Un constat n'est écrit que s'il est vérifiable dans le
   code, avec sa ligne. Ce qui ne peut venir que d'une manipulation humaine —
   une capture Network, une vérification faite par vous, une déclaration de ce
   que vous savez expliquer — est marqué **[À COMPLÉTER PAR LE BINÔME]**, suivi
   de la procédure exacte à suivre.
