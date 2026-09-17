/**
 * The logo at the top of every mail this product sends.
 *
 * Taken from the same site as the mail's own link — the link already names the
 * origin the reader will land on, so the image can never point at a different
 * host than the button beside it, and a staging mail shows staging's logo.
 *
 * Many clients hold remote images back until the reader allows them (Outlook
 * by default, Gmail for unknown senders), so the alt text is styled to stand in
 * for the image: the product's name, bold, in the brand blue, at about the
 * height the logo would have taken. With images blocked the mail still opens
 * on a heading rather than on a broken-image box.
 *
 * Width and height are set as attributes as well as in style: Outlook reads
 * the attributes and ignores the CSS, and without them it renders the file at
 * its stored 3x size.
 */
const FILE = '/logo-lockup.png';
const WIDTH = 164;
const HEIGHT = 36;

export function mailLogo(link: string): string {
  let origin: string;
  try {
    origin = new URL(link).origin;
  } catch {
    return '';
  }
  return (
    `<img src="${origin}${FILE}" width="${WIDTH}" height="${HEIGHT}" alt="MatyanAI" ` +
    `style="display:block;border:0;outline:none;text-decoration:none;` +
    `width:${WIDTH}px;height:${HEIGHT}px;margin:0 0 24px;` +
    `font-size:20px;line-height:${HEIGHT}px;font-weight:700;color:#2563eb">`
  );
}
