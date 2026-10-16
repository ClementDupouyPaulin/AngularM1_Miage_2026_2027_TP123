# Problème 4 — Pas de validation visible avant soumission

## Constat

`login-page.ts` et `register-page.ts` définissent bien des `Validators`
(`required`, `email`), mais :

- le bouton de soumission reste cliquable même si `form.invalid` est vrai ;
- aucun message d'erreur par champ n'est affiché dans les templates
  (`login-page.html`, `register-page.html`) — seul un message d'erreur
  global (`error()`) existe, alimenté uniquement par la réponse du backend.

## Fichiers concernés

- `src/app/components/login-page/login-page.ts` et `.html`
- `src/app/components/register-page/register-page.ts` et `.html`

## Pourquoi c'est un problème

Un utilisateur qui laisse un champ vide ou saisit un email mal formé peut
soumettre le formulaire quand même : il découvre l'erreur seulement après un
aller-retour réseau inutile, avec un message générique qui ne dit pas quel
champ corriger.

## Solution implémentée

- `[disabled]="form.invalid"` lié sur le bouton de soumission des deux
  formulaires.
- Pour chaque champ, un message s'affiche si le contrôle est invalide **et**
  touché (`control.invalid && control.touched`), dans un élément portant un
  `data-testid` dédié (`email-error`, `password-error`, `name-error`).

## Critères d'acceptation (traduits en tests)

1. `RegisterPageComponent` : à l'état initial (champs vides), le bouton de
   soumission est désactivé.
2. `LoginPageComponent` : si on vide le champ email (`form invalid`), le
   bouton de soumission devient désactivé.
3. `LoginPageComponent` : si on remplit le formulaire avec des valeurs
   valides, le bouton n'est pas désactivé.

## Statut

✅ Implémenté et vérifié — `src/app/components/login-page/login-page.spec.ts`
(2/2 tests verts) et `src/app/components/register-page/register-page.spec.ts`
(partie "validation du formulaire", 1/1 test vert).
