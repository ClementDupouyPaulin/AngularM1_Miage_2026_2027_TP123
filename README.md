# Guitar Practice Cloud — package étudiant

Ce dépôt contient uniquement les ressources nécessaires aux trois TP :
`backend/` et `frontend-starter/`, ainsi que les sujets et documents utiles.

## Prérequis

- Node.js 22 ou plus récent ;
- un compte MongoDB Atlas par binôme ;
- Git et un navigateur récent.
- Un IDE de qualité
- Recommandé : un abonnement à un 

Consulter [ATLAS_SETUP.md](ATLAS_SETUP.md) pour créer la base de données.

## Démarrer le backend

```bash
cd backend
cp .env.example .env
```

Renseigner dans `.env` l’URI MongoDB Atlas et le secret JWT. Ne jamais publier
ce fichier ni copier un secret dans le code Angular.

```bash
npm install
npm start
```

Le backend écoute normalement sur `http://localhost:3000`.

## Démarrer le frontend

Dans un autre terminal :

```bash
cd frontend-starter
npm install
npm start
```

Ouvrir `http://localhost:4200`. Le compte de démonstration est
`demo@example.com` / `Demo1234!`.

## Lancer les tests et le build

```bash
cd backend && npm test                 # tests Node, sans MongoDB ni réseau
cd frontend-starter && npm test        # tests Vitest + jsdom, sans backend
cd frontend-starter && npm run build   # build de production
```

Les tests ne contactent ni MongoDB Atlas ni le réseau : les réponses HTTP, les
modèles Mongoose et le service iTunes y sont simulés.

Tests de bout en bout Film Pulse (Playwright, Google Chrome installé, API
simulée) : `cd frontend-starter && npm run e2e`. Ils lisent de vraies vidéos
situées hors du dépôt, dans le dossier indiqué par `FILM_PULSE_SAMPLES`
(défaut `~/Downloads/film-pulse-test`) ; sans elles, les tests sont ignorés.

## Film Pulse (TP4)

Analyse du rythme de montage d'un extrait vidéo (MP4 ou WebM, 50 Mo et 120 s
maximum), dans le navigateur :

- **Analyse** : coupes et fondus, durée moyenne des plans, beats et tempo de la
  bande-son, palette de couleurs, pellicule, score de synchro coupes/musique ;
  sensibilité réglable sans relire la vidéo.
- **Studio** (`/clips`) : import avec aperçu en direct, tableau de bord, cartes
  d'extraits, étiquettes, filtres.
- **Salle de montage** (`/clips/:id`) : lecteur à raccourcis, timeline, annotations
  horodatées, partage (privé, amis, public), export PNG et JSON.
- **Comparaison** (`/clips/compare`) : deux extraits lus en synchronisation.
- **Social** : amis (`/friends`, fil d'activité), Découvrir et classements
  (`/discover`).

Parcours pas à pas : [frontend-starter/docs/film-pulse-guide.md](frontend-starter/docs/film-pulse-guide.md).
Pour **comprendre** le projet (algorithmes expliqués, sécurité, tests, questions d'oral) : [frontend-starter/docs/comprendre-film-pulse.md](frontend-starter/docs/comprendre-film-pulse.md). Captures d'écran : [frontend-starter/docs/captures/film-pulse/](frontend-starter/docs/captures/film-pulse/).
Le thème sombre ou clair se choisit depuis l'en-tête.

## Fonctionnalités facultatives

En plus des missions obligatoires, le dépôt contient les options des sujets :
pagination Mongoose (`aggregate-paginate-v2`), filtre par titre, `MatPaginator`
et images de couverture (envoi d'une image, lecture des tags ID3 à l'upload,
recherche Web de pochette). Elles ajoutent des routes à
[API_CONTRACT.md](API_CONTRACT.md) sans changer celles qui existaient, et deux
dépendances au backend (`mongoose-aggregate-paginate-v2`, `music-metadata`) :
relancer `npm install` dans `backend/` après une mise à jour. La recherche Web de
pochette appelle l'API publique iTunes et demande donc un accès Internet ; elle
n'est lancée que sur action explicite de l'utilisateur.

## Documentation du projet

L'index complet est dans [frontend-starter/docs/README.md](frontend-starter/docs/README.md)
(cartographie, flux de connexion, upload et lecture audio, suppression,
progression, tests, restitution orale, bonus). Le statut de chaque
fonctionnalité facultative est dans
[frontend-starter/docs/bonus/matrice-facultatives.md](frontend-starter/docs/bonus/matrice-facultatives.md).

Mini-projet TP4 « Film Pulse » : rapport dans [REPORT.md](REPORT.md), guide
d'utilisation dans [frontend-starter/docs/film-pulse-guide.md](frontend-starter/docs/film-pulse-guide.md),
design dans [frontend-starter/docs/design-system.md](frontend-starter/docs/design-system.md),
plans dans [PLAN.md](PLAN.md) (MVP) et [PLAN-STUDIO.md](PLAN-STUDIO.md) (phase 2).

## Documents de travail

- [SUJET_ETUDIANT_TP1.md](SUJET_ETUDIANT_TP1.md), [SUJET_ETUDIANT_TP2.md](SUJET_ETUDIANT_TP2.md) et [SUJET_ETUDIANT_TP3.md](SUJET_ETUDIANT_TP3.md) : missions des trois séances ;
- [API_CONTRACT.md](API_CONTRACT.md) : endpoints, authentification et formats échangés ;
- [RAPPORT_IA_MODELE.md](RAPPORT_IA_MODELE.md) : modèle de compte rendu.
- [CONSEILS_POUR_UTIISER_ASSISTANT_AI.md](CONSEILS_POUR_UTIISER_ASSISTANT_AI.md) : utiliser correctement un assistant IA, quel que soit l’outil choisi.

Le backend contient également ses propres consignes pour les assistants :
[`backend/AGENTS.md`](backend/AGENTS.md), [`backend/CLAUDE.md`](backend/CLAUDE.md),
[`backend/GEMINI.md`](backend/GEMINI.md) et
[`backend/best-practices.md`](backend/best-practices.md). Elles couvrent
Node.js, Express, Mongoose, MongoDB, l’authentification, Multer, les uploads,
les logs et les tests.

Les fichiers audio présents dans `frontend-starter/fichiers-audio-de-test/` sont
des fixtures fournies pour les essais. Aucun fichier uploadé, dossier de
dépendances (`node_modules`), fichier `.env` ou identifiant local n’est inclus.
