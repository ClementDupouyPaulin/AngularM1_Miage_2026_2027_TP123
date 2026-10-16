import { fileExtension } from './file-extension';

/**
 * Taille maximale d'une pochette, alignée sur le backend :
 * `const MAX_COVER_SIZE = 2 * 1024 * 1024;` (backend/src/app.js:47), appliquée
 * par Multer via `limits: { fileSize: MAX_COVER_SIZE }` (backend/src/app.js:378)
 * et revérifiée après réception (`detectImageType`, backend/src/app.js:92-107).
 */
export const MAX_COVER_SIZE = 2 * 1024 * 1024;

/**
 * Types d'image acceptés, copiés des clés de `COVER_EXTENSIONS`
 * (backend/src/app.js:49-53). Le backend vérifie les octets magiques : ce
 * contrôle frontend n'est qu'un confort, contournable par construction.
 */
export const ALLOWED_COVER_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

/** Repli sur l'extension quand le navigateur ne fournit pas de `File.type`. */
const ALLOWED_COVER_EXTENSIONS: readonly string[] = ['.jpg', '.jpeg', '.png', '.webp'];

export const COVER_ACCEPT_ATTRIBUTE = [...ALLOWED_COVER_TYPES, ...ALLOWED_COVER_EXTENSIONS].join(',');

/** Message d'erreur lisible, ou `undefined` si l'image est acceptable. */
export function validateCoverFile(file: File): string | undefined {
  const extension = fileExtension(file.name);
  const typeAccepted = file.type
    ? ALLOWED_COVER_TYPES.includes(file.type)
    : ALLOWED_COVER_EXTENSIONS.includes(extension);

  if (!typeAccepted) {
    return `Image non acceptée (${file.type || extension || 'type inconnu'}). Formats autorisés : JPEG, PNG, WebP.`;
  }
  if (file.size === 0) {
    return 'L’image sélectionnée est vide.';
  }
  if (file.size > MAX_COVER_SIZE) {
    return 'Image trop volumineuse : 2 Mo maximum.';
  }
  return undefined;
}
