# Problème 3 — Aucune gestion globale du 401

## Constat

Le sujet demande : "gestion d'un 401, avec retour vers `/login` si le token
est invalide ou expiré". Aujourd'hui :

- `authInterceptor` (`shared/interceptors/auth.interceptor.ts`) se contente
  d'ajouter le header `Authorization` si un token existe — il ne regarde
  jamais la réponse.
- Chaque composant gère ses erreurs HTTP localement avec un simple
  `console.error` (voir `profile-page.ts`, `login-page.ts`), sans jamais
  déconnecter l'utilisateur ni rediriger.
- `authGuard` vérifie seulement la **présence** d'un token côté client, pas sa
  validité côté serveur — un token expiré passe donc le guard, puis échoue
  silencieusement sur le premier appel API protégé.

## Fichiers concernés

- `src/app/shared/interceptors/auth.interceptor.ts`
- `src/app/shared/guards/auth.guard.ts` (pour rappel du fonctionnement actuel)
- `src/main.ts` (enregistrement des interceptors)

## Pourquoi c'est un problème

Un token expiré ou révoqué laisse l'utilisateur sur une page protégée sans
retour visible : les requêtes échouent en silence (juste loguées dans la
console), l'utilisateur ne comprend pas pourquoi rien ne s'affiche, et n'est
jamais renvoyé vers `/login` pour se reconnecter.

## Solution implémentée

Un second interceptor fonctionnel dédié,
`shared/interceptors/auth-error.interceptor.ts`, exporte
`authErrorInterceptor: HttpInterceptorFn`, qui :

1. laisse passer la requête via `next(request)` (`auth-error.interceptor.ts:24`) ;
2. intercepte les erreurs de la réponse (`catchError`, `:25`) ;
3. si le statut est `401` **et que l'URL n'est pas une route publique**, appelle
   `AuthService.logout()` puis redirige vers `/login` (`:31-34`) ;
4. propage toujours l'erreur (`throwError`, `:38`) pour que le composant
   appelant puisse encore réagir localement (message d'erreur affiché, etc.).

Cet interceptor est enregistré à côté de `authInterceptor` dans
`main.ts:14` : `withInterceptors([authInterceptor, authErrorInterceptor])`.

### Correctif apporté après coup : exclure les routes publiques

La première version de cet intercepteur déclenchait le logout sur **tout**
`401`. C'était un bug : un mot de passe refusé sur `POST /api/auth/login`
renvoie aussi un `401`, mais il signifie « identifiants incorrects », pas
« session expirée ». L'intercepteur redirigeait alors vers `/login`, ce qui
**recréait** `LoginPageComponent` et remettait son Signal `error()` à `''` :
l'utilisateur voyait sa page se recharger sans jamais lire pourquoi sa connexion
avait échoué.

La correction est la constante `PUBLIC_AUTH_ROUTES`
(`auth-error.interceptor.ts:13`), qui liste `/api/auth/login` et
`/api/auth/register` — les routes publiques du contrat (`API_CONTRACT.md`,
vérifiable côté backend : `backend/src/app.js:431` et `:462` n'utilisent pas le
middleware `auth`). La condition testée en `:26-29` combine donc trois choses :
l'erreur est bien une `HttpErrorResponse`, son statut est `401`, et l'URL n'est
pas publique.

> **À retenir** : un même code HTTP peut avoir deux significations selon la
> route. Le raisonnement complet, avec le diagramme du chemin d'erreur, est dans
> [`flux-connexion-et-signals.md`](./flux-connexion-et-signals.md#cas-de-la-connexion-refusée-mot-de-passe-invalide).

### Note sur l'URL d'origine

Le retour automatique vers la page d'origine après reconnexion (*deep link*)
n'est **pas** implémenté : `router.navigateByUrl('/login')` (`:33`) ne transmet
aucun paramètre `returnUrl`. Ce n'est pas demandé par le sujet. Ce serait une
amélioration possible : passer l'URL courante en query param et la relire dans
`LoginPageComponent` après un login réussi.

## Pourquoi le test a été écrit en même temps que le code

Contrairement aux problèmes 1, 2, 4 et 5, il n'existait avant cette étape
**aucun fichier ni fonction** sur laquelle accrocher un test qui échoue pour
la bonne raison : créer un fichier `auth-error.interceptor.ts` vide au
moment de l'analyse aurait déjà été commencer l'implémentation. Le test a
donc été écrit dans le même mouvement que le code (contrairement aux autres
problèmes où le test précédait le correctif), avec `HttpTestingController`
pour simuler les réponses `401`, `404` et `200`.

## Statut

✅ Implémenté et vérifié — `src/app/shared/interceptors/auth-error.interceptor.spec.ts`,
**7/7 tests verts**.

Ce fichier n'en comptait que 3 à l'origine (redirection sur `401`, pas de
réaction sur `404`, pas de réaction sur une réponse réussie). Les **4 suivants**
ont été ajoutés avec le correctif d'exclusion des routes publiques décrit
ci-dessus : c'est la bonne pratique, un test par bug corrigé.

| # | Test | Ligne | Attendu |
|---|---|---|---|
| 1 | `401` sur une route protégée | 34 | déconnexion + redirection vers `/login` |
| 2 | Autre erreur (`404`) | 48 | **aucune** réaction |
| 3 | Réponse réussie | 60 | **aucune** réaction |
| 4 | `401` sur `POST /api/auth/login` | 77 | **ni** logout **ni** redirection |
| 5 | `401` sur `POST /api/auth/register` | 94 | idem |
| 6 | `401` sur `GET /api/users/me` | 110 | déconnexion (la distinction marche dans les deux sens) |
| 7 | `401` sur une route protégée **avec query string** | 127 | déconnexion — cas limite du `startsWith()` de `auth-error.interceptor.ts:16` |

Le 7ᵉ est un cas limite qu'il vaut la peine de comprendre : la détection de
route publique se fait par `url.startsWith(route)` (`:16`). Une URL protégée
portant une query string (`/api/tracks?page=2&limit=5`) ne commence par aucune
route publique, donc elle déclenche bien la déconnexion. Le test verrouille le
fait que l'ajout de paramètres ne casse pas la distinction.

> Détail complet de la suite de tests, et vérification par mutation de ces
> gardes, dans [`../tp3/tests-automatises.md`](../tp3/tests-automatises.md).

### Vérification manuelle recommandée (complément aux tests unitaires)

1. Se connecter normalement sur `/tracks`.
2. Modifier manuellement le token dans `localStorage` (`gpc_token`) pour le
   rendre invalide (ex. changer un caractère).
3. Rafraîchir la page ou naviguer vers `/profile`.
4. Constater dans l'onglet Network un `401`, suivi d'une redirection
   automatique vers `/login`.
