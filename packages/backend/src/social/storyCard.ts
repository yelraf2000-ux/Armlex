/**
 * The story that goes out with each post: 1080×1920, a line of text on top,
 * the post's own card below it, and where to find the post.
 *
 * No clickable link: neither Instagram nor Facebook lets an app attach a link
 * sticker or swipe-up to a story — only a person can, in the app. So the story
 * says where the post is instead.
 */
import { readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import jpeg from 'jpeg-js';
import { FAMILY, FONTS, LOGO, escape, wrap } from './card.js';

export const STORY = { width: 1080, height: 1920 } as const;

export interface StoryCard {
  /** The line above the post, at most about three lines' worth. */
  text: string;
  /** The post's card, as JPEG bytes — shown below the text. */
  post: Buffer;
  /** Where the post is, e.g. «Ամբողջը՝ մեր էջում». */
  footer: string;
}

export function storySvg(c: StoryCard): string {
  const pad = 72;
  const logo = readFileSync(LOGO).toString('base64');
  const post = c.post.toString('base64');
  const t = (x: number, y: number, attrs: string, s: string): string =>
    `<text x="${x}" y="${y}" font-family="${FAMILY}" ${attrs}>${escape(s)}</text>`;

  // The post card is 4:5; shown at 864 wide it is 1080 tall.
  const cardW = 864;
  const cardH = Math.round((cardW * 1350) / 1080);
  const cardX = (STORY.width - cardW) / 2;

  const lines = wrap(c.text, STORY.width - pad * 2 - 40, 54, true, 3);
  const textTop = 300;
  const cardY = textTop + lines.length * 70 + 70;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${STORY.width}" height="${STORY.height}" viewBox="0 0 ${STORY.width} ${STORY.height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2563eb"/>
      <stop offset="1" stop-color="#1e3a8a"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <image x="${pad}" y="150" width="86" height="54" xlink:href="data:image/png;base64,${logo}"/>
  ${t(pad + 102, 192, 'font-size="38" font-weight="700" fill="#ffffff"', 'MatyanAI')}
  ${lines.map((l, i) => t(pad, textTop + i * 70, 'font-size="54" font-weight="700" fill="#ffffff"', l)).join('\n  ')}
  <rect x="${cardX + 8}" y="${cardY + 10}" width="${cardW}" height="${cardH}" rx="28" fill="#0f172a" opacity="0.25"/>
  <clipPath id="clip"><rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="28"/></clipPath>
  <image x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" clip-path="url(#clip)" xlink:href="data:image/jpeg;base64,${post}"/>
  <rect x="${pad}" y="${STORY.height - 250}" width="${STORY.width - pad * 2}" height="104" rx="52" fill="#ffffff"/>
  ${t(STORY.width / 2, STORY.height - 183, 'font-size="40" font-weight="700" fill="#2563eb" text-anchor="middle"', c.footer)}
  ${t(STORY.width / 2, STORY.height - 96, 'font-size="30" fill="#dbeafe" text-anchor="middle"', 'matyanai.am')}
</svg>`;
}

export function renderStory(c: StoryCard): Buffer {
  const png = new Resvg(storySvg(c), {
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: FAMILY },
  }).render();
  return Buffer.from(jpeg.encode({ data: png.pixels, width: png.width, height: png.height }, 88).data);
}
