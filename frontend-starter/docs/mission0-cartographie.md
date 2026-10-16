# Mission 0 — Cartographie de l'application

Livrable TP1 « Cartographier l'application ». Toutes les affirmations de ce
document sont vérifiables dans le code : chaque ligne citée est au format
`chemin/fichier.ts:ligne`. Les chemins frontend sont relatifs à
`frontend-starter/`, les chemins backend à la racine du dépôt.

> Le schéma du flux de connexion et l'explication Signal vs `localStorage` sont
> dans [`mission1/flux-connexion-et-signals.md`](./mission1/flux-connexion-et-signals.md).
> Le flux d'upload et de lecture audio est dans
> [`tp2/upload-et-lecture-audio.md`](./tp2/upload-et-lecture-audio.md).

---

## 1. Le composant racine

| Élément | Emplacement |
|---|---|
| Balise hôte dans la page HTML | `src/index.html:9` → `<app-root></app-root>` |
| Composant démarré | `src/main.ts:9` → `bootstrapApplication(AppComponent, {...})` |
| Classe du composant racine | `src/app/components/app/app.ts:12` → `export class AppComponent` |
| Sélecteur | `src/app/components/app/app.ts:7` → `selector: 'app-root'` |
| Template | `src/app/components/app/app.html` |

Il n'y a **pas de `NgModule`** : c'est une application Angular *standalone*.
Chaque composant déclare lui-même ce qu'il importe, via la propriété `imports`
de son décorateur (par exemple `src/app/components/app/app.ts:8` importe
`RouterLink`, `RouterLinkActive` et `RouterOutlet`).

`AppComponent` joue deux rôles :

1. il affiche l'en-tête et la navigation (`app.html:5-40`, précédés du lien
   d'évitement `app.html:1-3`) ;
2. il place le point d'insertion des pages, `<router-outlet />`
   (`app.html:43`), dans lequel le Router affiche la page correspondant à
   l'URL courante.

Il injecte `AuthService` (`app.ts:14`) pour deux raisons :

- masquer les liens vers les pages protégées quand aucun token n'est présent
  (`app.html:17` : `@if (auth.token())`, sinon la branche `@else` de
  `app.html:22-27` n'affiche que « Connexion » et « Inscription ») ;
- exposer un bouton de déconnexion (`app.html:35-37`) qui appelle
  `AppComponent.logout()` (`app.ts:21-24`), lequel vide l'état local puis
  navigue vers `/login` ;
- afficher le nom de l'utilisateur dans l'en-tête (`app.html:32-34`) et, après un
  F5, recharger le profil que le Signal `currentUser` a perdu
  (`restoreProfileAfterReload()`, `app.ts:41-52`). Ces ajouts d'interface sont
  expliqués dans [`bonus/ui-ux-authentification.md`](./bonus/ui-ux-authentification.md).

## 2. La configuration des routes

Les routes sont déclarées dans `src/app/routes.ts:8-15` et enregistrées au
démarrage par `provideRouter(routes)` (`src/main.ts:11`).

| Chemin | Composant | Garde |
|---|---|---|
| `''` | *(aucun)* — redirection vers `tracks` (`routes.ts:9`) | — |
| `login` | `LoginPageComponent` (`routes.ts:10`) | aucune |
| `register` | `RegisterPageComponent` (`routes.ts:11`) | aucune |
| `profile` | `ProfilePageComponent` (`routes.ts:12`) | `authGuard` |
| `tracks` | `TracksPageComponent` (`routes.ts:13`) | `authGuard` |
| `'**'` | *(aucun)* — redirection vers `tracks` (`routes.ts:14`) | — |

`authGuard` (`src/app/shared/guards/auth.guard.ts:6-11`) est une fonction
`CanActivateFn` : elle renvoie `true` si `auth.token()` a une valeur, sinon
`router.createUrlTree(['/login'])`, ce qui redirige l'utilisateur vers la page
de connexion.

> **Limite importante à comprendre** : le guard vérifie seulement la *présence*
> d'un token côté navigateur, jamais sa validité. Un token expiré passe donc le
> guard. C'est le rôle de `authErrorInterceptor` de rattraper le `401` renvoyé
> ensuite par l'API (voir §5 et
> [`mission1/probleme-3-gestion-401.md`](./mission1/probleme-3-gestion-401.md)).

## 3. L'enregistrement de `HttpClient`

Tout se passe dans `src/main.ts:14` :

```ts
provideHttpClient(withInterceptors([authInterceptor, authErrorInterceptor])),
```

Trois choses à retenir :

- `provideHttpClient()` rend `HttpClient` injectable dans toute l'application.
  Sans cet appel, `inject(HttpClient)` échoue.
- `withInterceptors([...])` enregistre les intercepteurs **fonctionnels** (le
  style moderne d'Angular, une simple fonction au lieu d'une classe). L'ordre
  du tableau est l'ordre de traversée de la requête sortante.
- **`withFetch()` n'est volontairement pas utilisé** (commentaire
  `src/main.ts:12-13`) : l'implémentation `XMLHttpRequest` est nécessaire pour
  recevoir les événements de progression d'upload
  (`HttpEventType.UploadProgress`), que l'API `fetch` du navigateur ne fournit
  pas pour l'envoi.

En développement, les URL relatives (`/api/...`) ne pointent pas vers le
serveur Angular mais sont redirigées vers le backend par le proxy déclaré dans
`frontend-starter/proxy.conf.json` (`"/api"` → `http://localhost:3000`). C'est
ce qui évite toute question de CORS pendant les TP.

## 4. Modèles, services et pages

### Modèles (interfaces TypeScript, aucun code exécuté)

| Fichier | Contenu |
|---|---|
| `src/app/shared/models/user.model.ts` | `User` : `id`, `name`, `email`, `createdAt` |
| `src/app/shared/models/auth-response.model.ts` | `AuthResponse` : `token`, `user` |
| `src/app/shared/models/track.model.ts` | `Track` : `id`, `title`, `originalName`, `mimeType`, `size`, `createdAt` |
| `src/app/shared/models/page.model.ts` | `Page<T>` : `items`, `page`, `limit`, `total`, `pages` |

Ces interfaces sont le miroir des réponses décrites dans `API_CONTRACT.md`.
Elles ne contiennent jamais de champ sensible : côté backend,
`User.toPublic()` (`backend/src/models/User.js:52`) et `Track.toPublic()`
(`backend/src/models/Track.js:45-59`, fonction `toPublicTrack`, appelée par `toPublic()` en `:65`) excluent respectivement `passwordHash`
(`User.js:19`, `select: false`) et `storedName` (`Track.js:22`, `select: false`).

### Services (la seule frontière HTTP de l'application)

| Service | Fichier | Méthodes |
|---|---|---|
| `AuthService` | `src/app/shared/services/auth.service.ts` | `login()` (:18), `register()` (:24), `profile()` (:30), `update()` (:34), `logout()` (:41), `messageFromError()` (:57) |
| `TrackService` | `src/app/shared/services/track.service.ts` | `list()` (:22), `upload()` (:38), `audio()` (:54), `remove()` (:61), puis les méthodes de pochette `cover()` (:66), `setCover()` (:71), `removeCover()` (:78), `searchCover()` (:83), `setCoverFromWeb()` (:88) |

Les deux sont `@Injectable({ providedIn: 'root' })` — une seule instance
partagée par toute l'application, ce qui est indispensable pour que les Signals
de `AuthService` soient vus par tous les composants.

**Règle d'architecture du sujet, respectée** : aucun composant n'injecte
`HttpClient`. Seuls `auth.service.ts:13` et `track.service.ts:14` le font. On
peut le vérifier soi-même :

```bash
grep -rn "inject(HttpClient)" frontend-starter/src/app
```

### Pages (composants de route)

| Page | Fichier | Service utilisé |
|---|---|---|
| Connexion | `src/app/components/login-page/login-page.ts` | `AuthService.login()` (`login-page.ts:45`) |
| Inscription | `src/app/components/register-page/register-page.ts` | `AuthService.register()` (`register-page.ts:54`) |
| Profil | `src/app/components/profile-page/profile-page.ts` | `AuthService.profile()` (:63) et `.update()` (:89) |
| Bibliothèque | `src/app/components/tracks-page/tracks-page.ts` | `TrackService.list()` (`load()`), `.upload()` (`upload()`), `.audio()` (constructeur, flux de lecture), `.remove()` (`deleteTrack()`) ; cette page a beaucoup grossi (filtre, paginator, dialogues, pochettes) : repérez-la par le nom des méthodes |

Chaque page suit le même schéma : un formulaire réactif ou des Signals d'état,
un appel au service, puis mise à jour des Signals d'affichage
(`loading`, `error`, données).

### Vue d'ensemble

```text
src/
├── index.html ............... <app-root>
├── main.ts .................. bootstrap + provideRouter + provideHttpClient
└── app/
    ├── routes.ts ............ table des routes
    ├── components/
    │   ├── app/ ............. composant racine (header + router-outlet)
    │   ├── login-page/
    │   ├── register-page/
    │   ├── profile-page/
    │   └── tracks-page/
    └── shared/
        ├── models/ .......... interfaces TypeScript (User, Track, Page, AuthResponse)
        ├── services/ ........ AuthService, TrackService  ← seuls à injecter HttpClient
        ├── guards/ .......... authGuard
        └── interceptors/ .... authInterceptor, authErrorInterceptor
```

## 5. Le mécanisme qui ajoute le JWT aux requêtes protégées

C'est `authInterceptor`, dans
`src/app/shared/interceptors/auth.interceptor.ts:6-16` :

```ts
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const token = inject(AuthService).token();
  return next(
    token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request,
  );
};
```

Points à savoir expliquer :

- **Le token vient du Signal**, pas directement de `localStorage`
  (`auth.interceptor.ts:7` lit `AuthService.token()`). Le Signal est initialisé
  depuis `localStorage` à la construction du service
  (`auth.service.ts:16` → `AuthService.readStoredToken()`, défini en
  `auth.service.ts:88-94`).
- **La requête n'est jamais modifiée sur place** : les objets `HttpRequest` sont
  immuables, d'où le `request.clone({ setHeaders: ... })`.
- **Le format `Bearer <token>` est imposé par le backend** : le middleware
  `auth` refuse tout en-tête qui ne commence pas par `"Bearer "`
  (`backend/src/app.js:309-312`, `401 { message: "Authentification requise" }`),
  puis vérifie signature et expiration avec `jwt.verify`
  (`backend/src/app.js:317`).
- **L'intercepteur s'applique à *toutes* les requêtes passant par
  `HttpClient`**, y compris les routes publiques. Ce n'est pas un problème : le
  backend ignore l'en-tête `Authorization` sur `/api/auth/login` et
  `/api/auth/register`, qui ne passent pas par le middleware `auth`
  (`backend/src/app.js:431` et `:462`, sans middleware `auth`). Et au moment du
  login, aucun token n'existe encore : la requête part donc inchangée.

Le second intercepteur, `authErrorInterceptor`
(`src/app/shared/interceptors/auth-error.interceptor.ts:20-41`), travaille dans
l'autre sens : il regarde la **réponse**. Sur un `401`, il appelle
`AuthService.logout()` puis redirige vers `/login` (`:31-34`) — sauf sur les
routes publiques listées en `auth-error.interceptor.ts:13`
(`/api/auth/login`, `/api/auth/register`), car là un `401` signifie
« identifiants refusés », pas « session expirée » : il doit rester un message de
formulaire et non provoquer une fin de session. L'erreur est toujours
repropagée (`:38`) pour que le composant puisse afficher son propre message.

## 6. Routes publiques et routes protégées

Le tableau ci-dessous croise `API_CONTRACT.md` et le code backend réel. Le
critère est simple : **une route est protégée si le middleware `auth`
(`backend/src/app.js:303-324`) est passé en deuxième argument à Express.**

| Méthode | Route | Public / Protégée | Déclaration backend | Appelée depuis le frontend |
|---|---|---|---|---|
| GET | `/api/health` | **publique** | `app.js:420` (aucun middleware) | non appelée par Angular — sert à vérifier à la main que l'API répond |
| POST | `/api/auth/register` | **publique** | `app.js:431` | `AuthService.register()` (`auth.service.ts:26`) |
| POST | `/api/auth/login` | **publique** | `app.js:462` | `AuthService.login()` (`auth.service.ts:20`) |
| GET | `/api/users/me` | protégée | `app.js:496` (`auth`) | `AuthService.profile()` (`auth.service.ts:31`) |
| PUT | `/api/users/me` | protégée | `app.js:516` (`auth`) | `AuthService.update()` (`auth.service.ts:36`) |
| GET | `/api/tracks?page=&limit=` | protégée | `app.js:538` (`auth`) | `TrackService.list()` (`track.service.ts:26`) |
| POST | `/api/tracks` | protégée | `app.js:606-612` (`auth`, puis `upload.fields([audio, cover])`) | `TrackService.upload()` (`track.service.ts:43`) |
| GET | `/api/tracks/:id/audio` | protégée | `app.js:659` (`auth`) | `TrackService.audio()` (`track.service.ts:55`) |
| DELETE | `/api/tracks/:id` | protégée | `app.js:689` (`auth`) | `TrackService.remove()` (`track.service.ts:62`) |
| GET | `/api/tracks/:id/cover` | protégée | `app.js:734` (`auth`) | `TrackService.cover()` (`track.service.ts:67`) |
| PUT | `/api/tracks/:id/cover` | protégée | `app.js:761` (`auth`, `receiveCover`) | `TrackService.setCover()` (`track.service.ts:74`) |
| DELETE | `/api/tracks/:id/cover` | protégée | `app.js:780` (`auth`) | `TrackService.removeCover()` (`track.service.ts:79`) |
| GET | `/api/tracks/:id/cover/search` | protégée | `app.js:805` (`auth`) | `TrackService.searchCover()` (`track.service.ts:84`) |
| POST | `/api/tracks/:id/cover/web` | protégée | `app.js:839` (`auth`) | `TrackService.setCoverFromWeb()` (`track.service.ts:89`) |

### À propos de `GET /api/health`

C'est la seule route publique qui ne participe pas à l'authentification. Elle
répond `{ "status": "ok" }` (`app.js:422`) et sert de **test de vie** (*health
check*) : si elle ne répond pas, le problème est le serveur ou le port, pas
votre code Angular. On peut donc la tester sans aucun token :

```bash
curl -i http://localhost:3000/api/health
# attendu : HTTP/1.1 200 OK  +  {"status":"ok"}
```

Aucune route Angular ne l'appelle : c'est volontaire, elle est destinée à un
diagnostic manuel (ou à un outil de supervision).

### Deux notions de « protection » à ne pas confondre

| | Côté Angular | Côté backend |
|---|---|---|
| Qui ? | `authGuard` (`auth.guard.ts:6`) | middleware `auth` (`app.js:303`) |
| Vérifie quoi ? | qu'un token *existe* en mémoire | que le token est *valide et non expiré* (`jwt.verify`, `app.js:317`) |
| Protège quoi ? | l'affichage d'une page (confort d'utilisation) | l'accès aux données (véritable sécurité) |
| Contournable ? | oui (DevTools, faux token dans `localStorage`) | non (la signature JWT est vérifiée avec le secret serveur) |

Autrement dit : le guard Angular est de l'**ergonomie**, pas de la sécurité. La
sécurité est entièrement côté serveur. Le même raisonnement s'applique à la
validation de fichier (voir
[`tp2/upload-et-lecture-audio.md`](./tp2/upload-et-lecture-audio.md), §7).

## 7. Où se fait la « mise à jour du profil utilisateur » ?

Question explicitement posée dans `SUJET_ETUDIANT_TP1.md`. Réponse complète,
fichier par fichier, avec méthode et ligne, dans
[`mission1/questions-reponses.md`](./mission1/questions-reponses.md#où-seffectue-la-mise-à-jour-du-profil-utilisateur-).
