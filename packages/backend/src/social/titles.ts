/**
 * Act titles as a person writes them.
 *
 * ARLIS prints titles entirely in capitals. Lowering every word turns «ՀՀ» into
 * «հհ» and «ԱԱՀ» into «աահ», so abbreviations are kept — by list, not by
 * length: «ՀՀ-ՈՒՄ» must become «ՀՀ-ում», and a length rule would keep «ՈՒՄ».
 */
const KEEP_UPPER = new Set(['ՀՀ', 'ԱԱՀ', 'ՊԵԿ', 'ՀԴՄ', 'ԱՁ', 'ՌԴ', 'ԵԱՏՄ', 'ԵԱՀՄ', 'ՍՊԸ', 'ՓԲԸ', 'ԲԲԸ']);

/** «ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ» → «ՀՀ հարկային օրենսգիրք». */
export function actTitle(stored: string): string {
  const lowered = stored
    .trim()
    .split(' ')
    .map((word) =>
      word
        .split('-')
        .map((part) => (KEEP_UPPER.has(part) ? part : part.toLocaleLowerCase('hy')))
        .join('-'),
    )
    .join(' ');
  return lowered.charAt(0).toLocaleUpperCase('hy') + lowered.slice(1);
}
