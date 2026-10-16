# Mission 1 — Suivi de traitement

Ce dossier documente l'analyse de la Mission 1 (Inscription/Connexion/Profil)
avant toute modification de code, conformément à la méthode « petites étapes »
recommandée par `CONSEILS_POUR_UTIISER_ASSISTANT_AI.md`.

> Index général de la documentation du projet (TP1, TP2) :
> [`../README.md`](../README.md). Cartographie de l'application :
> [`../mission0-cartographie.md`](../mission0-cartographie.md).

## Contenu

- [`flux-connexion-et-signals.md`](./flux-connexion-et-signals.md) — schéma
  annoté du flux de connexion (succès **et** échec) et explication Signal vs
  `localStorage`.
- [`questions-reponses.md`](./questions-reponses.md) — réponses aux questions
  posées dans le sujet (modèle IA, tokens, routes utilisées, localisation de
  la mise à jour du profil).
- `probleme-1-deconnexion.md` à `probleme-5-robustesse-mot-de-passe.md` — un
  fichier par problème identifié dans le code actuel, avec constat, impact,
  solution proposée et critères d'acceptation.

## Méthode suivie

1. **Analyse** (faite) : lecture du code existant sans modification, un
   fichier par problème pour ne pas tout traiter d'un bloc.
2. **Tests** (faits, cette étape) : écriture d'une batterie de tests qui
   traduisent les critères d'acceptation de chaque problème. Ces tests sont
   volontairement **rouges** (en échec) tant que le correctif n'est pas
   implémenté — c'est la preuve qu'ils testent bien le bon comportement.
3. **Implémentation** (à venir, un problème à la fois) : chaque correctif ne
   sera mis en place qu'après validation du test correspondant, jamais tous
   en même temps.

## État des tests

Historique de la démarche, un problème à la fois (jamais tout en même temps) :

| Étape | État après l'étape | Détail |
|---|---|---|
| Analyse + tests écrits (avant tout correctif) | 🔴 6 / 10 tests rouges | Chaque échec correspond à un problème documenté, pas à une erreur d'outillage |
| Correctif problème 1 (déconnexion) | 🟢 `app.spec.ts` au vert | `AppComponent` injecte `AuthService`, bouton conditionnel + `logout()` |
| Correctif problème 2 (chargement auto) | 🟢 `profile-page.spec.ts` au vert | `ProfilePageComponent implements OnInit`, appelle `load()` automatiquement |
| Correctif problème 3 (gestion 401) | 🟢 `auth-error.interceptor.spec.ts` au vert | Nouvel intercepteur `authErrorInterceptor`, câblé dans `main.ts` |
| Correctifs problèmes 4 et 5 (validation + mot de passe) | 🟢 `login-page.spec.ts`, `register-page.spec.ts` au vert | Bouton désactivé si formulaire invalide, messages par champ, `minLength(8)` sur le mot de passe |

**État à la fin de la Mission 1 : `npm test` → 13 tests verts sur 13, aucune
régression entre chaque étape.**

> Ce chiffre de 13 est celui mesuré **à la fin de la Mission 1**, et il n'est
> plus le total actuel. La suite a grossi depuis, par paliers :
> **13 → 36 → 41 → 59 → 65 → 66** (66 = fin du TP3). L'état final mesuré, après les
> bonus, est de **188 tests verts sur 188, répartis sur 15 fichiers** (`npm test`).
>
> Trois correctifs d'authentification supplémentaires ont également été apportés
> après cette étape (décrits dans `RAPPORT_IA_MODELE.md`, section « Mission 1
> bis »), dont l'un a fait passer `auth-error.interceptor.spec.ts` de 3 à 7
> tests — voir [`probleme-3-gestion-401.md`](./probleme-3-gestion-401.md).
> Détail de la suite complète dans
> [`../tp3/tests-automatises.md`](../tp3/tests-automatises.md).

Chaque correctif a été vérifié isolément avant de passer au suivant, en
relançant la suite complète pour confirmer l'absence de régression sur les
étapes précédentes.

## Prérequis d'outillage ajoutés (indépendants des 5 problèmes)

Le testeur Angular 22 (`@angular/build:unit-test`, vitest) n'était pas
utilisable tel quel dans ce starter. Trois ajustements d'infrastructure ont
été nécessaires, sans rapport avec les problèmes métier ci-dessus :

- `jsdom` ajouté en dépendance de dev (environnement DOM requis par vitest).
- `tsconfig.spec.json` créé (types `vitest/globals` pour que `describe`/`it`/
  `expect` soient reconnus par TypeScript).
- `angular.json` : la cible `test` n'avait pas de `buildTarget` valide
  (`gpc:build:development` n'existait pas) ; ajout explicite de
  `"buildTarget": "gpc:build"`.
- `src/test-setup.ts` créé et enregistré via `setupFiles` dans `angular.json` :
  polyfill minimal de `localStorage`, indisponible dans cet environnement de
  test alors que `AuthService` le lit dès sa construction.
