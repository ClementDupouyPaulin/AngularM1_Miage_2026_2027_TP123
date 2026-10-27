# Bonus — Preuves d'intégration réelle (ligne de commande)

Les tests automatisés du backend (`backend/test/tracks.test.js`) remplacent
MongoDB et le réseau (voir [`tests-de-contrat-backend.md`](./tests-de-contrat-backend.md)).
Pour combler leurs limites, l'orchestrateur a exécuté une série de vérifications
contre le **vrai serveur**, **MongoDB Atlas** et le **vrai service iTunes**.

> **Résultat annoncé : 56 vérifications, 56 OK, 0 KO** — **rejouées sur le backend corrigé** (après les correctifs de la relecture indépendante), **plus 5 cas supplémentaires** (section « Cas ajoutés après la relecture »).
>
> **Provenance** : ces résultats ont été exécutés et communiqués par
> l'orchestrateur. L'agent de documentation ne les a **pas rejoués** : il les
> rapporte tels qu'ils lui ont été transmis, sans les recouper.

## Ce que ces preuves sont, et ce qu'elles ne sont pas

| Ce sont… | Ce ne sont **pas**… |
|---|---|
| des requêtes **en ligne de commande** contre l'API réelle | des **captures Network du navigateur** |
| des preuves du **contrat HTTP** vu depuis un client quelconque | des preuves sur l'interface : rendu, accessibilité, SnackBar, dialogue, barre de progression |
| une preuve que le serveur se comporte comme les tests le supposent | une preuve que le **frontend** parle correctement à ce serveur |

Les captures Network demandées par les sujets se font dans le navigateur, pas en
ligne de commande.

## Conditions d'exécution

- **Port 3100.** Le serveur de test tournait sur le port **3100**, car le port
  3000 était occupé par le serveur déjà lancé par l'étudiant. Conséquence : le proxy du frontend
  (`proxy.conf.json`, cible `http://localhost:3000`) n'était **pas** impliqué.
  Aucune de ces vérifications ne passe par Angular.
- **Base réelle.** MongoDB Atlas, pas une simulation.
- **Service externe réel.** L'API iTunes Search et les images `mzstatic.com` ont
  été réellement appelées. Leurs réponses dépendent d'un service tiers : le
  nombre de candidats (12) et les hôtes observés peuvent varier d'une exécution à
  l'autre ; ils ne sont pas reproductibles à l'identique.
- **Effet de bord à connaître.** **Deux utilisateurs temporaires restent dans la
  base** : il n'existe aucune route de suppression de compte
  (`API_CONTRACT.md` n'en prévoit pas). Les pistes créées, elles, ont été
  supprimées.
- **Précision sur une vérification.** Pour une image de plus de 2 Mo, la
  vérification accepte **400 ou 413** : le framework peut répondre l'un ou
  l'autre selon l'endroit où la limite est atteinte. Le code serveur renvoie 400
  pour le dépassement détecté par Multer (`backend/src/app.js:384`).

## Le détail, regroupé par thème

> Les groupes ci-dessous regroupent les 56 vérifications ; ils ne reprennent pas
> une numérotation de 1 à 56, qui n'a pas été transmise.

### Upload, tags ID3 et pochette embarquée

- Upload de **7 pistes**.
- Lecture réelle des tags ID3 de `song4` (`frontend-starter/fichiers-audio-de-test/`) :
  `artist` « Kevin MacLeod », `album` « Royalty Free », pochette embarquée
  extraite → `hasCover` vrai, `coverSource` « id3 ».
- **Aucune fuite de `storedName`** dans la réponse.

### Pagination (7 pistes, `limit=5`)

| Requête | Observé |
|---|---|
| page 1 | 5 items, `total` 7, `pages` 2, `hasNextPage` vrai, `nextPage` 2, `prevPage` nul |
| page 2 | 2 items, `hasPrevPage` vrai |
| page 99 | `items` vide |

Tri par date de création **décroissante** vérifié.

### Filtre `q`

| `q` | Observé |
|---|---|
| `BLUES` (casse ignorée) | **3** résultats |
| `zzz` | **0** |
| `.*` | **0** (traité littéralement, pas comme « tout ») |
| `(` | **200**, sans plantage |
| 101 caractères | **400** |
| filtre + pagination | **3** résultats sur **2** pages |

### Isolation entre utilisateurs

Un autre utilisateur voit **0** piste. Sa tentative d'accéder à une pochette
d'autrui donne **404** sur `GET`, `PUT` et `DELETE`.

### Pochettes

- `PUT` d'un PNG valide → **200**, `coverSource` « upload » ; `GET` → **200**,
  `image/png`.
- Un texte déguisé en `image/png` → **400** (détection par les octets magiques,
  pas par le `Content-Type`).
- Image de plus de 2 Mo → refusée (400 ou 413, voir plus haut).
- Upload **audio + pochette en une seule requête**.
- `DELETE` de la pochette → **204** ; `GET` ensuite → **404**.

### Authentification des nouvelles routes

**401 sans JWT**, et **401 avec un JWT bidon**, sur chacune des **5** nouvelles
routes de pochette : **10** vérifications.

### Recherche Web réelle (iTunes)

- Recherche → **200**, **12** candidats, attribution présente, hôte d'image
  `is1-ssl.mzstatic.com`.
- `POST …/cover/web` avec un **vrai téléchargement** → **200**, `coverSource`
  « web » ; `GET` → `image/…`.

### SSRF : URL refusées (400)

| URL tentée | Ce que le cas vérifie |
|---|---|
| `http://is1-ssl.mzstatic.com/…` | le bon hôte mais en `http` : https obligatoire |
| `https://evil.example.com/…` | hôte quelconque |
| `https://mzstatic.com.evil.com/…` | **le piège du suffixe** : le nom *contient* `mzstatic.com` mais ne *se termine* pas par `.mzstatic.com` |
| `https://127.0.0.1/…` | adresse de boucle locale |
| `https://localhost:3100/api/health` | le serveur lui-même (port non autorisé, hôte non autorisé) |
| `file:///etc/passwd` | schéma de fichier local |
| `https://169.254.169.254/…` | adresse de métadonnées des fournisseurs cloud |

Et `imageUrl` **absente** → 400.

### Cas ajoutés après la relecture indépendante (5)

Ces cinq cas vérifient en réel les correctifs décrits dans
[`relecture-independante.md`](./relecture-independante.md) :

| Requête | Observé | Ce que ça prouve |
|---|---|---|
| `page=1e20` | **200** | `page` est arrondie et plafonnée (`MAX_PAGE`, défaut 1) |
| `page=Infinity` | **200** | idem |
| `:id` qui n'est pas un `ObjectId` | **404** | pas de `500` sur un identifiant invalide |
| `q=a&q=b` (vrai tableau) | **400** | la garde sur le type de `q` fonctionne |
| nom de fichier avec une extension de 230 caractères | **201** | l'extension démesurée est abandonnée (l'ancien code répondait `500`, défaut 3) |

**Précision honnête sur Express 5.** Avec le parseur de requête « simple » d'Express 5,
`q[]=a` et `q[$ne]=x` **ne forment ni un tableau ni un objet** : ce sont des clés
distinctes (`q[]`, `q[$ne]`), ignorées. La réponse est `200` **sans filtre**, et
**aucune injection n'est possible**. Le vrai vecteur de tableau est `q=a&q=b`, qui
donne bien `400`.

### Nettoyage

Après suppression des pistes : `total` à 0 et **aucun fichier de pochette orphelin
sur le disque**.

---

## Ce que ces preuves comblent — et ce qui reste simulé

Les limites 1 à 4 de [`tests-de-contrat-backend.md` §4](./tests-de-contrat-backend.md#4-les-limites-honnêtes-de-cette-approche)
sont les trous des tests simulés. Voici ce que chaque preuve réelle en dit :

| Limite des tests simulés | Preuve réelle correspondante |
|---|---|
| Le cast `ObjectId` est une hypothèse encodée dans la simulation | Sur MongoDB Atlas, les 7 pistes envoyées sont bien listées ; un autre utilisateur en voit 0 |
| Le moteur de regex simulé n'est pas celui de MongoDB | `.*` → 0 et `(` → 200 sur la vraie base |
| L'exécution réelle du `$facet` n'est pas testée | pagination 5 / 7 pistes, page 2 et page 99 sur la vraie base |
| Le réseau est entièrement simulé | recherche et téléchargement réels contre iTunes et `mzstatic.com` |

**Reste prouvé uniquement par des tests simulés, ou jamais** : un JWT **expiré**
(jamais testé), le **délai réel de 5 secondes** du téléchargement (jamais atteint),
et la limite de **trois redirections** (couverte par un test simulé,
`securite-bonus.test.js:284`, jamais en réel). Les valeurs de `prevPage` / `hasPrevPage` sur une page
hors bornes n'ont pas non plus été relevées (voir
[`pagination-mongoose.md` §4](./pagination-mongoose.md#4-ce-qui-change-dans-la-réponse)).
