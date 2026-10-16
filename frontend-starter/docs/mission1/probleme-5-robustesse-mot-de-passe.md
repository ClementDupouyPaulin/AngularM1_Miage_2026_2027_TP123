# Problème 5 — Aucune contrainte de robustesse sur le mot de passe

## Constat

Dans `register-page.ts`, le contrôle `password` n'a que
`Validators.required` — n'importe quel mot de passe d'un seul caractère est
accepté côté frontend.

Vérification côté backend (`backend/src/models/User.js`) : le schéma
Mongoose ne stocke pas le mot de passe en clair (`passwordHash` via un
virtual `password` haché par bcrypt) et **n'impose aucune contrainte de
longueur ou de complexité**. Le backend accepterait donc lui aussi n'importe
quel mot de passe.

## Fichiers concernés

- `src/app/components/register-page/register-page.ts`
- (information, hors périmètre) `backend/src/models/User.js` — le sujet et
  `CLAUDE.md` du backend interdisent de modifier le backend pour cette
  mission ; ce point est donc noté pour le rapport mais pas corrigé ici.

## Pourquoi c'est un problème

Rien n'empêche un utilisateur de créer un compte avec un mot de passe trivial
(`"a"`), ce qui est une mauvaise pratique de sécurité même dans un contexte
pédagogique. Comme il est interdit de toucher au backend dans cette mission,
la seule amélioration possible ici est côté frontend (UX + garde-fou minimal
côté client — pas une vraie protection de sécurité tant que le backend ne
valide rien).

## Solution implémentée

`Validators.minLength(8)` ajouté sur le contrôle `password` de
`RegisterPageComponent`. La valeur `8` est un choix pédagogique raisonnable
(alignée sur les recommandations usuelles) : rien côté backend ne l'impose ni
ne le documente dans `API_CONTRACT.md`, cette contrainte reste donc purement
côté client (UX), pas une garantie de sécurité.

## Critères d'acceptation (traduits en tests)

1. Avec un mot de passe de moins de 8 caractères, le contrôle `password` est
   invalide avec l'erreur `minlength`.
2. Avec un mot de passe de 8 caractères ou plus, le contrôle `password` est
   valide (toutes choses égales par ailleurs).

## Statut

✅ Implémenté et vérifié — `src/app/components/register-page/register-page.spec.ts`
(partie "robustesse du mot de passe", 2/2 tests verts).
