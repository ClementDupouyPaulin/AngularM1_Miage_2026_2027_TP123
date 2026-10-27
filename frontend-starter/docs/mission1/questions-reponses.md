# Mission 1 — Réponses aux questions du sujet

## Assistant IA utilisé

- **Modèle** : Claude Sonnet 5 (identifiant `claude-sonnet-5`), via l'extension
  Claude Code dans VS Code (mode CLI intégré à l'IDE, pas une interface web).

## Consommation de tokens

- Dans Claude Code, la commande `/cost` (en mode interactif) affiche le coût
  et le nombre de tokens consommés pour la session en cours.
- L'extension VS Code affiche également un indicateur d'utilisation du
  contexte dans son interface.
- Ce comportement dépend de l'outil : une interface web classique (ChatGPT,
  Claude.ai, Gemini) ne donne pas toujours ce détail précisément.

## Qui conseille le meilleur modèle pour une tâche donnée ?

- On peut le demander directement à l'assistant (voir section 10 de
  `CONSEILS_POUR_UTIISER_ASSISTANT_AI.md`) : il connaît les modèles
  disponibles dans l'outil utilisé et peut expliquer le compromis
  qualité/coût/temps.
- La documentation officielle du fournisseur (Anthropic, OpenAI, Google) reste
  la source de référence en cas de doute.

## Routes backend utilisées par la Mission 1

D'après `API_CONTRACT.md` et le code de `AuthService` :

| Méthode | Route | Utilisée par (frontend) | Authentification |
|---|---|---|---|
| POST | `/api/auth/register` | `RegisterPageComponent.submit()` → `AuthService.register()` | non |
| POST | `/api/auth/login` | `LoginPageComponent.submit()` → `AuthService.login()` | non |
| GET | `/api/users/me` | `ProfilePageComponent.load()` → `AuthService.profile()` | JWT |
| PUT | `/api/users/me` | `ProfilePageComponent.save()` → `AuthService.update()` | JWT |

Les routes `/api/tracks*` existent dans le contrat mais ne sont pas
concernées par la Mission 1 (partie utilisateur).

## Où s'effectue la mise à jour du profil utilisateur ?

C'est la question du sujet : « où s'effectue la tâche *mise à jour du profil
utilisateur*, dans quels fichiers côté back et côté front ? ». Voici la chaîne
complète, **dans l'ordre d'exécution**, avec fichier, méthode et ligne.

### Côté frontend (`frontend-starter/`)

| # | Fichier | Méthode / élément | Ligne | Rôle |
|---|---|---|---|---|
| 1 | `src/app/components/profile-page/profile-page.html` | `<form [formGroup]="form" (ngSubmit)="save()">` | 30 | Le formulaire réactif ; le bouton `type="submit"` (:54) est désactivé si `!canSave() || saving()` : il faut que le nom ait **changé** et soit valide (voir [`../bonus/ui-ux-authentification.md`](../bonus/ui-ux-authentification.md) §7) |
| 2 | `src/app/components/profile-page/profile-page.ts` | `save()` | 79 | Refuse un formulaire invalide (:80-83), pose `saving` à `true` (:87), lit la valeur via `getRawValue().name` (:89) |
| 3 | `src/app/shared/services/auth.service.ts` | `update(name)` | 34-38 | **Seul endroit qui parle HTTP** : `this.http.put<User>('/api/users/me', { name })` (:36) |
| 4 | `src/app/shared/interceptors/auth.interceptor.ts` | `authInterceptor` | 6-16 | Ajoute `Authorization: Bearer <token>` à la requête sortante |
| 5 | *(réponse reçue)* `src/app/shared/services/auth.service.ts` | `tap((user) => this.currentUser.set(user))` | 37 | Met à jour le Signal `currentUser` avec le `User` renvoyé par le serveur |
| 6 | `src/app/components/profile-page/profile-page.ts` | callback `next` | 90-96 | Repasse `saving` à `false` et affiche la confirmation (`confirmation.set(...)`, :95) |
| 7 | `src/app/components/profile-page/profile-page.html` | `{{ user.name }}` | 22 | Se réaffiche **tout seul** : le template lit `auth.currentUser()` (:18), donc le Signal modifié à l'étape 5 provoque le rafraîchissement |
| — | `src/app/components/profile-page/profile-page.ts` | callback `error` | 97-103 | En cas d'échec, `error.set(this.auth.messageFromError(...))`, affiché en `profile-page.html:10` |

> À retenir : le composant ne recopie pas le nom saisi dans l'affichage. Il
> affiche ce que **le serveur** a confirmé (étape 5). Si le backend avait
> normalisé le nom — par exemple `trim` sur le schéma Mongoose,
> `backend/src/models/User.js:10` — c'est la version normalisée qui s'affiche.

### Côté backend (racine du dépôt)

| # | Fichier | Élément | Ligne | Rôle |
|---|---|---|---|---|
| 1 | `backend/src/app.js` | `app.use(express.json())` | 417 | Transforme le corps JSON de la requête en `req.body` |
| 2 | `backend/src/app.js` | middleware `auth` | 303-324 | Exige `Authorization: Bearer ...` (:309), vérifie signature et expiration avec `jwt.verify` (:317), et place l'identité dans `req.auth` (dont `req.auth.sub` = l'`_id` Mongo) |
| 3 | `backend/src/app.js` | `app.put("/api/users/me", auth, ...)` | 516 | La route elle-même. `auth` est passé en 2ᵉ argument : c'est ce qui la rend protégée |
| 4 | `backend/src/app.js` | `User.findByIdAndUpdate(req.auth.sub, { $set: { name: req.body?.name } }, { new: true, runValidators: true })` | 518-522 | **La persistance MongoDB.** `new: true` renvoie le document *après* mise à jour ; `runValidators: true` applique les règles du schéma (sans cette option, Mongoose ne valide pas sur un `update`) |
| 5 | `backend/src/models/User.js` | schéma Mongoose, champ `name` | 10 | Les règles appliquées : `required`, `trim`, `minlength: 2` |
| 6 | `backend/src/app.js` | `res.status(404).json({ message: "Utilisateur inconnu" })` | 526 | Cas où l'`_id` du token ne correspond plus à aucun utilisateur (compte supprimé) |
| 7 | `backend/src/models/User.js` | `schema.methods.toPublic()` | 52 | Filtre la réponse : `passwordHash` (déclaré `select: false`, :19) n'en fait jamais partie |
| 8 | `backend/src/app.js` | `res.json(user.toPublic())` | 530 | Renvoie le `User` public consommé à l'étape 5 du frontend |
| 9 | `backend/src/app.js` | gestionnaire d'erreurs central | 855-875 | Un nom trop court remonte en `ValidationError` → `400 { message }` (:867-869), que `messageFromError()` affiche tel quel |

### Ce que la sécurité doit à cette architecture

L'identifiant de l'utilisateur mis à jour vient **du token** (`req.auth.sub`,
`app.js:519`), jamais du corps de la requête. Le frontend n'envoie que
`{ name }` (`auth.service.ts:36`). Un utilisateur ne peut donc pas renommer le
compte d'un autre, même en forgeant la requête : il n'existe aucun champ
`userId` à falsifier.
