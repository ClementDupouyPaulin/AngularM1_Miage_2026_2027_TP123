# Design system « Salle de montage »

Source unique : `src/styles.css`. Les composants n'emploient **que** les jetons ci-dessous (aucune couleur en dur, sauf à l'intérieur des bandeaux, toujours sombres). Polices système, motifs en CSS/SVG, aucun paquet ajouté.

## Thèmes

Sombre par défaut (salle de projection), clair « jour » en variante. Ordre de priorité : attribut `data-theme="light|dark"` sur `<html>` > `prefers-color-scheme` > sombre. Le bouton de l'en-tête fait tourner *auto → sombre → clair* et mémorise le choix dans `localStorage` (`film-pulse-theme`, absent = auto). `index.html` l'applique avant le démarrage pour éviter le flash.

## Jetons

| Jeton | Sombre | Clair | Rôle |
|---|---|---|---|
| `--bg` / `--surface` / `--surface-2` / `--surface-3` | `#0b0c10` / `#14161c` / `#1b1e26` / `#242833` | `#f6f4ef` / `#fff` / `#f0ede6` / `#e6e2d8` | fonds étagés |
| `--text` / `--text-muted` | `#eceef3` / `#a3a9b8` | `#15171c` / `#555b66` | texte (AA sur toutes les surfaces) |
| `--border` / `--border-strong` | `#2e3340` / `#6b7387` | `#d9d4c8` / `#858072` | filets décoratifs / bords de champs (≥ 3:1) |
| `--accent` / `--accent-strong` / `--on-accent` | `#f5a524` / `#ffbd52` / `#0b0c10` | `#f5a524` / `#e08d0b` / `#15171c` | ambre pellicule : fonds d'action, survol, texte dessus |
| `--accent-text` | `#f5a524` | `#8a5300` | ambre utilisé **comme texte** (liens, icônes) |
| `--rec` / `--beat` / `--fade` | `#ff4d4d` / `#35d0ff` / `#b48cff` | `#d0201f` / `#00739e` / `#7444d0` | coupes et REC / beats / fondus |
| `--success` / `--danger` / `--on-danger` / `--focus` | `#4ade80` / `#ff6b6b` / `#0b0c10` / `#35d0ff` | `#17703f` / `#b3261e` / `#fff` / `#0b57d0` | états |

Communs : `--space-1…6` (0,25 → 2 rem), `--radius-sm/md/lg` (6/12/18 px), `--shadow-sm/md/lg`, `--font-sans`, `--font-mono`, `--tap` (2,75 rem), `--perf` (motif de perforation, colorié par `currentColor`), `--banner-bg/-text/-muted`.
Alias historiques conservés : `--brand`, `--brand-strong`, `--on-brand`, `--brand-deep`, `--danger-bg`, `--success-bg`, `--info-bg` (ne pas les utiliser dans du nouveau code). Angular Material est branché via `--mat-sys-*` et les jetons dialog, snackbar, paginator, select et tooltip.

## Classes utilitaires

| Classe | Usage |
|---|---|
| `.page`, `.page-header`, `.eyebrow`, `.lead` | grille de page, titre + actions, surtitre mono ambre |
| `.card`, `.perf` | panneau ; `.perf` ajoute les perforations haut/bas |
| `.banner` (2,39:1), `.hero` (même habillage, hauteur libre) | bandeau cinémascope sombre dans les deux thèmes |
| `.btn` + `-primary` / `-secondary` / `-ghost` / `-danger` / `-icon` | boutons (44 px mini) ; un `<button>` nu est primaire |
| `.chip` + `-accent` / `-rec` / `-beat` / `-fade` / `-success` / `-danger` ; `.badge` | pastilles |
| `.stat` (`.stat-value`, `.stat-label`), `.timecode` | chiffres clés, code temporel mono à chasse fixe |
| `.field`, `.input`, `.select`, `.field-error`, `.hint` | formulaires (les `input/select/textarea` nus sont stylés à spécificité nulle) |
| `.tabs` | onglets : enfant actif via `.active`, `aria-selected="true"` ou `aria-current="page"` |
| `.skeleton`, `.empty-state`, `.alert` (+ `-error/-success/-info`) | chargement, vide, messages |
| `.rec-dot`, `.ecg` | point REC pulsant, courbe ECG tracée en boucle |

```html
<header class="page-header">
  <div><p class="eyebrow">Studio</p><h1>Mes extraits</h1></div>
  <button type="button" class="btn btn-secondary">Actualiser</button>
</header>
<article class="card perf">
  <span class="chip chip-rec"><span class="rec-dot" aria-hidden="true"></span>REC</span>
  <span class="timecode">00:12:05</span>
  <div class="stat"><span class="stat-value">24</span><span class="stat-label">coupes/min</span></div>
</article>
<svg class="ecg" viewBox="0 0 120 16" preserveAspectRatio="none" aria-hidden="true">
  <path class="ecg-base" d="M0 8h120" />
  <path pathLength="100" d="M0 8h34l4-5 5 10 4-13 4 14 3-6h66" />
</svg>
```

## Règles d'accessibilité

- Contraste AA vérifié dans les deux thèmes ; l'ambre sert de **fond** (`--accent`) ou de **texte** (`--accent-text`), jamais l'un pour l'autre.
- Focus clavier : contour 3 px `--focus`, jamais supprimé ; cibles tactiles ≥ 44 px (`--tap`).
- L'état n'est jamais porté par la seule couleur : lien actif souligné, carte en lecture encadrée, chips avec libellé.
- `prefers-reduced-motion` : ECG figé tracé, REC fixe, squelettes et transitions coupés.
- Décor (bandeaux, ECG, logo) en `aria-hidden="true"` ; mise en page mobile d'abord (menu replié sous 960 px avec `aria-expanded`).
