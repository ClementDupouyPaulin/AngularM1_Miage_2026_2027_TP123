import { MatPaginatorIntl } from '@angular/material/paginator';

/**
 * Libellés français du `MatPaginator`, fournis localement par la page
 * bibliothèque (le reste de l'application garde les libellés par défaut).
 */
export function createFrenchPaginatorIntl(): MatPaginatorIntl {
  const intl = new MatPaginatorIntl();
  intl.itemsPerPageLabel = 'Pistes par page :';
  intl.firstPageLabel = 'Première page';
  intl.previousPageLabel = 'Page précédente';
  intl.nextPageLabel = 'Page suivante';
  intl.lastPageLabel = 'Dernière page';
  intl.getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length === 0 || pageSize === 0) return `0 sur ${length}`;
    const start = page * pageSize;
    const end = Math.min(start + pageSize, length);
    return `${start + 1} – ${end} sur ${length}`;
  };
  return intl;
}
