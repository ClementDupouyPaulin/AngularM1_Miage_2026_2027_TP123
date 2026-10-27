# Requêtes /api du parcours de captures

> **API simulée par Playwright (contrat identique au backend), ce n’est PAS une capture DevTools d’un vrai serveur.**

Table générée par `e2e/captures.spec.ts` à partir des événements `request`/`response` de Playwright, pendant le parcours complet en thème sombre (73 requêtes, 34 distinctes). Les statuts sont ceux renvoyés par l’API simulée. Relancer : `npm run captures`.

| Méthode | URL | Statut | Occurrences | Rôle |
|---|---|---|---|---|
| GET | `/api/users/me` | 200 | 7 | Profil de l’utilisateur connecté |
| GET | `/api/clips?page=1&limit=12` | 200 | 7 | Bibliothèque paginée (Studio, comparaison) |
| GET | `/api/clips/stats` | 200 | 7 | Tableau de bord du Studio |
| GET | `/api/clips/tags` | 200 | 7 | Étiquettes et compteurs (filtres) |
| POST | `/api/clips` | 201 | 5 | Enregistrement d’un extrait (multipart : vidéo, analyse, pellicule) |
| GET | `/api/clips/clip-1/filmstrip` | 200 | 4 | Pellicule (JPEG) d’un extrait |
| GET | `/api/clips/clip-2/filmstrip` | 200 | 3 | Pellicule (JPEG) d’un extrait |
| GET | `/api/clips/clip-3/filmstrip` | 200 | 2 | Pellicule (JPEG) d’un extrait |
| GET | `/api/clips/clip-4/filmstrip` | 200 | 2 | Pellicule (JPEG) d’un extrait |
| GET | `/api/clips/clip-5/filmstrip` | 200 | 2 | Pellicule (JPEG) d’un extrait |
| GET | `/api/clips/clip-1` | 200 | 2 | Détail d’un extrait avec son analyse |
| GET | `/api/clips/clip-1/video` | 200 | 2 | Octets de la vidéo (lecteur) |
| POST | `/api/clips/clip-1/annotations` | 201 | 1 | Ajout d’une annotation sur la timeline |
| GET | `/api/friends` | 200 | 2 | Amis et invitations |
| PATCH | `/api/clips/clip-1` | 200 | 1 | Réglage du partage (visibilité, amis) |
| GET | `/api/clips?page=1&limit=20` | 200 | 1 | Bibliothèque paginée (Studio, comparaison) |
| GET | `/api/clips/discover?scope=public&limit=20` | 200 | 1 | Découvrir : extraits publics, amis, partagés, classements |
| GET | `/api/clips/discover?scope=friends&limit=20` | 200 | 1 | Découvrir : extraits publics, amis, partagés, classements |
| GET | `/api/clips/clip-2` | 200 | 1 | Détail d’un extrait avec son analyse |
| GET | `/api/clips/clip-2/video` | 200 | 1 | Octets de la vidéo (lecteur) |
| GET | `/api/clips/discover?scope=public&sort=recent&page=1&limit=12` | 200 | 1 | Découvrir : extraits publics, amis, partagés, classements |
| GET | `/api/clips/other-1/filmstrip` | 200 | 1 | Pellicule (JPEG) d’un extrait |
| GET | `/api/clips/other-2/filmstrip` | 200 | 1 | Pellicule (JPEG) d’un extrait |
| GET | `/api/clips/other-3/filmstrip` | 200 | 1 | Pellicule (JPEG) d’un extrait |
| GET | `/api/clips/other-4/filmstrip` | 200 | 1 | Pellicule (JPEG) d’un extrait |
| GET | `/api/clips/other-5/filmstrip` | 200 | 1 | Pellicule (JPEG) d’un extrait |
| GET | `/api/clips/discover?scope=public&sort=nervous&page=1&limit=10` | 200 | 1 | Découvrir : extraits publics, amis, partagés, classements |
| GET | `/api/clips/discover?scope=public&sort=synced&page=1&limit=10` | 200 | 1 | Découvrir : extraits publics, amis, partagés, classements |
| GET | `/api/activity?limit=20` | 200 | 1 | Fil d’activité |
| GET | `/api/tracks?page=1&limit=5` | 200 | 1 | Bandes-son paginées |
| GET | `/api/tracks/track-1/cover` | 200 | 1 | Pochette d’une bande-son |
| GET | `/api/tracks/track-2/cover` | 200 | 1 | Pochette d’une bande-son |
| GET | `/api/tracks/track-3/cover` | 200 | 1 | Pochette d’une bande-son |
| GET | `/api/tracks/track-5/cover` | 200 | 1 | Pochette d’une bande-son |
