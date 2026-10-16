/**
 * Extension en minuscules, point compris (« .mp3 »), ou `''` si le nom n'en a
 * pas : `lastIndexOf('.')` vaut alors -1 et `slice(-1)` renverrait à tort le
 * dernier caractère du nom.
 */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}
