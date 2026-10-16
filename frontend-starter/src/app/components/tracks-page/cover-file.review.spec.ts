import { MAX_COVER_SIZE, validateCoverFile } from './cover-file';

/**
 * Relecture indépendante : `validateCoverFile` est un simple confort (le
 * backend vérifie les octets magiques), mais il ne doit jamais laisser passer
 * un type notoirement dangereux ni donner un message trompeur.
 */
describe('validateCoverFile (relecture indépendante)', () => {
  const file = (name: string, type: string, size = 10) =>
    new File([new Uint8Array(size)], name, { type });

  it.each([
    ['JPEG', file('a.jpg', 'image/jpeg')],
    ['PNG', file('a.png', 'image/png')],
    ['WebP', file('a.webp', 'image/webp')],
    ['extension en majuscules sans type MIME', file('A.PNG', '')],
  ])('accepte %s', (_label, candidate) => {
    expect(validateCoverFile(candidate)).toBeUndefined();
  });

  it.each([
    ['SVG (vecteur de script)', file('a.svg', 'image/svg+xml')],
    ['HTML déguisé en .png', file('a.png', 'text/html')],
    ['GIF', file('a.gif', 'image/gif')],
    ['SVG sans type MIME', file('a.svg', '')],
    ['exécutable', file('a.exe', 'application/octet-stream')],
  ])('refuse %s', (_label, candidate) => {
    expect(validateCoverFile(candidate)).toBeDefined();
  });

  it('applique la limite de 2 Mo à l’octet près et refuse un fichier vide', () => {
    expect(validateCoverFile(file('a.png', 'image/png', MAX_COVER_SIZE))).toBeUndefined();
    expect(validateCoverFile(file('a.png', 'image/png', MAX_COVER_SIZE + 1))).toContain('2 Mo');
    expect(validateCoverFile(file('a.png', 'image/png', 0))).toContain('vide');
  });

  it('nomme « type inconnu » un fichier sans type MIME ni extension', () => {
    // Sans point dans le nom, lastIndexOf('.') vaut -1 et slice(-1) renverrait le dernier caractère.
    expect(validateCoverFile(file('pochette', ''))).toContain('type inconnu');
  });
});
