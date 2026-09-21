/**
 * The "show it working" card: an app window holding a real question and the
 * product's real answer, the article it cited and the verbatim line of law,
 * then a call to try it. 1080×1350, drawn like card.ts — large enough to read
 * on a phone, which a shrunken screenshot of the desktop site is not.
 *
 * The answer text must be what the product actually said; the quote must be a
 * verbatim substring of the cited article. The caller is responsible for both.
 */
import { readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import jpeg from 'jpeg-js';
import { CARD, FAMILY, FONTS, LOGO, escape, wrap } from './card.js';

export interface DemoCard {
  headline: string;
  question: string;
  /** The answer's lines, as the product wrote them; «• » marks a list item. */
  answer: string[];
  /** «ՀՀ աշխատանքային օրենսգիրք · Հոդված 159, մաս 1». */
  source: string;
  /** A verbatim excerpt of the cited provision. */
  quote: string;
  cta: string;
}

export function demoCardSvg(c: DemoCard): string {
  const pad = 64;
  const logo = readFileSync(LOGO).toString('base64');
  const t = (x: number, y: number, attrs: string, s: string): string =>
    `<text x="${x}" y="${y}" font-family="${FAMILY}" ${attrs}>${escape(s)}</text>`;

  // Window geometry.
  const wx = pad;
  const wy = 292;
  const ww = CARD.width - pad * 2;
  const ix = wx + 36; // inner left
  const iw = ww - 72; // inner width

  const headLines = wrap(c.headline, CARD.width - pad * 2, 50, true, 2);
  const qLines = wrap(c.question, iw - 60, 30, true, 2);
  const aLines = c.answer.flatMap((l) => wrap(l, iw - 24, 28, false, 3));
  const quoteLines = wrap(`«${c.quote}»`, iw - 90, 25, false, 4);

  let y = wy + 120;
  const parts: string[] = [];
  parts.push(t(ix, y, 'font-size="20" font-weight="700" letter-spacing="2" fill="#64748b"', 'ՁԵՐ ՀԱՐՑԸ'));
  y += 22;
  const qh = qLines.length * 42 + 34;
  parts.push(`<rect x="${ix}" y="${y}" width="${iw}" height="${qh}" rx="18" fill="#eff6ff"/>`);
  qLines.forEach((l, i) => parts.push(t(ix + 24, y + 50 + i * 42, 'font-size="30" font-weight="700" fill="#0f172a"', l)));
  y += qh + 50;
  parts.push(t(ix, y, 'font-size="20" font-weight="700" letter-spacing="2" fill="#2563eb"', 'MATYANAI · ՊԱՏԱՍԽԱՆ'));
  y += 46;
  aLines.forEach((l) => {
    parts.push(t(ix, y, 'font-size="28" fill="#334155"', l));
    y += 40;
  });
  y += 18;
  const sh = 60 + quoteLines.length * 36 + 26;
  parts.push(`<rect x="${ix}" y="${y}" width="${iw}" height="${sh}" rx="16" fill="#ffffff" stroke="#e2e8f0" stroke-width="2"/>`);
  parts.push(`<rect x="${ix}" y="${y}" width="6" height="${sh}" rx="3" fill="#2563eb"/>`);
  parts.push(t(ix + 28, y + 46, 'font-size="26" font-weight="700" fill="#2563eb"', c.source));
  parts.push(t(ix + iw - 24, y + 46, 'font-size="22" font-weight="700" fill="#64748b" text-anchor="end"', 'ARLIS'));
  quoteLines.forEach((l, i) => parts.push(t(ix + 28, y + 90 + i * 36, 'font-size="25" fill="#334155"', l)));
  y += sh;
  const wh = y - wy + 36;

  const ctaY = wy + wh + 30;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD.width}" height="${CARD.height}" viewBox="0 0 ${CARD.width} ${CARD.height}">
  <rect width="100%" height="100%" fill="#f8f9ff"/>
  <rect x="0" y="0" width="${CARD.width}" height="14" fill="#2563eb"/>
  <image x="${pad}" y="70" width="80" height="50" xlink:href="data:image/png;base64,${logo}"/>
  ${t(pad + 96, 108, 'font-size="36" font-weight="700" fill="#0f172a"', 'MatyanAI')}
  ${t(CARD.width - pad, 106, 'font-size="28" font-weight="700" fill="#2563eb" text-anchor="end"', 'matyanai.am')}
  ${headLines.map((l, i) => t(pad, 196 + i * 58, 'font-size="50" font-weight="700" fill="#0f172a"', l)).join('\n  ')}
  <rect x="${wx + 6}" y="${wy + 10}" width="${ww}" height="${wh}" rx="28" fill="#0f172a" opacity="0.06"/>
  <rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" rx="28" fill="#ffffff" stroke="#e2e8f0" stroke-width="2"/>
  <circle cx="${wx + 40}" cy="${wy + 40}" r="8" fill="#e2e8f0"/>
  <circle cx="${wx + 66}" cy="${wy + 40}" r="8" fill="#e2e8f0"/>
  <circle cx="${wx + 92}" cy="${wy + 40}" r="8" fill="#e2e8f0"/>
  <rect x="${wx + ww / 2 - 110}" y="${wy + 22}" width="220" height="36" rx="18" fill="#f1f5f9"/>
  ${t(wx + ww / 2, wy + 47, 'font-size="20" fill="#64748b" text-anchor="middle"', 'matyanai.am')}
  <line x1="${wx}" y1="${wy + 76}" x2="${wx + ww}" y2="${wy + 76}" stroke="#e2e8f0" stroke-width="2"/>
  ${parts.join('\n  ')}
  <rect x="${pad}" y="${ctaY}" width="${CARD.width - pad * 2}" height="88" rx="20" fill="#2563eb"/>
  ${t(CARD.width / 2, ctaY + 57, 'font-size="34" font-weight="700" fill="#ffffff" text-anchor="middle"', c.cta)}
  ${t(CARD.width / 2, CARD.height - 34, 'font-size="22" fill="#64748b" text-anchor="middle"', 'Տեղեկատվական գործիք, ոչ իրավաբանական խորհրդատվություն')}
</svg>`;
}

export function renderDemoCard(c: DemoCard): Buffer {
  const png = new Resvg(demoCardSvg(c), {
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: FAMILY },
  }).render();
  return Buffer.from(jpeg.encode({ data: png.pixels, width: png.width, height: png.height }, 90).data);
}
