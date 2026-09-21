/**
 * The promotional card: a label, a headline, three points with check marks,
 * and the call to try it. Same size, fonts and palette as card.ts.
 */
import { readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import jpeg from 'jpeg-js';
import { CARD, FAMILY, FONTS, LOGO, escape, wrap } from './card.js';

export interface PromoCard {
  /** Small caps label above the headline, e.g. «ԻՆՉՈՒ MATYANAI». */
  label: string;
  headline: string;
  points: string[];
  cta: string;
}

export function promoCardSvg(c: PromoCard): string {
  const pad = 88;
  const width = CARD.width - pad * 2;
  const logo = readFileSync(LOGO).toString('base64');
  const t = (x: number, y: number, attrs: string, s: string): string =>
    `<text x="${x}" y="${y}" font-family="${FAMILY}" ${attrs}>${escape(s)}</text>`;

  const head = wrap(c.headline, width - 50, 64, true, 4);
  let y = 300;
  const parts: string[] = [];
  parts.push(t(pad, y, 'font-size="24" font-weight="700" letter-spacing="3" fill="#2563eb"', c.label.toUpperCase()));
  y += 84;
  head.forEach((l) => {
    parts.push(t(pad, y, 'font-size="64" font-weight="700" fill="#0f172a"', l));
    y += 78;
  });
  y += 36;
  for (const p of c.points.slice(0, 3)) {
    const lines = wrap(p, width - 90, 34, false, 3);
    // A drawn check mark: the font has no ✓.
    parts.push(`<circle cx="${pad + 26}" cy="${y - 11}" r="26" fill="#eff6ff" stroke="#bfdbfe" stroke-width="2"/>`);
    parts.push(
      `<path d="M ${pad + 14} ${y - 12} l 8 9 l 17 -19" fill="none" stroke="#2563eb" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
    lines.forEach((l, i) => parts.push(t(pad + 80, y + i * 48, 'font-size="34" fill="#334155"', l)));
    y += lines.length * 48 + 40;
  }

  const ctaY = CARD.height - 210;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD.width}" height="${CARD.height}" viewBox="0 0 ${CARD.width} ${CARD.height}">
  <rect width="100%" height="100%" fill="#f8f9ff"/>
  <rect x="0" y="0" width="${CARD.width}" height="14" fill="#2563eb"/>
  <image x="${pad}" y="96" width="88" height="55" xlink:href="data:image/png;base64,${logo}"/>
  ${t(pad + 104, 138, 'font-size="40" font-weight="700" fill="#0f172a"', 'MatyanAI')}
  ${t(CARD.width - pad, 136, 'font-size="30" font-weight="700" fill="#2563eb" text-anchor="end"', 'matyanai.am')}
  ${parts.join('\n  ')}
  <rect x="${pad}" y="${ctaY}" width="${width}" height="96" rx="22" fill="#2563eb"/>
  ${t(CARD.width / 2, ctaY + 61, 'font-size="36" font-weight="700" fill="#ffffff" text-anchor="middle"', c.cta)}
  ${t(CARD.width / 2, CARD.height - 50, 'font-size="22" fill="#64748b" text-anchor="middle"', 'Տեղեկատվական գործիք, ոչ իրավաբանական խորհրդատվություն')}
</svg>`;
}

/** Whether the points fit above the button — checked before rendering. */
export function promoFits(c: PromoCard): boolean {
  const width = CARD.width - 88 * 2;
  let y = 300 + 84 + wrap(c.headline, width - 50, 64, true, 4).length * 78 + 36;
  for (const p of c.points.slice(0, 3)) y += wrap(p, width - 90, 34, false, 3).length * 48 + 40;
  return y < CARD.height - 230;
}

export function renderPromoCard(c: PromoCard): Buffer {
  const png = new Resvg(promoCardSvg(c), {
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: FAMILY },
  }).render();
  return Buffer.from(jpeg.encode({ data: png.pixels, width: png.width, height: png.height }, 90).data);
}
