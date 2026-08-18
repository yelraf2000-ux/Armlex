/**
 * Harvest real accountant questions from accountant.am's Q&A archive.
 *
 * Why this source: the spec called for seeding evaluation from real Armenian
 * accountant discussions, and this is the largest public archive of them —
 * 500+ pages of dated questions in authentic phrasing, newest first, crawling
 * explicitly permitted by robots.txt (empty Disallow, sitemap advertised).
 *
 * What the data is for: UNLABELLED evaluation fuel. Questions run through the
 * pipeline whose coverage gate and quote validator flag failures without
 * ground truth; phrasing feeds the regime-aware contextualiser; community
 * answers on the site are recorded as provenance but are NOT ground truth.
 * Internal research use only — nothing is republished.
 *
 * Politeness: same discipline as the ARLIS crawler — one request per
 * ARLIS_CRAWL_DELAY_MS (default 2s) through the shared queue in http.ts,
 * identifiable User-Agent, resumable so an abort never refetches.
 *
 * Usage:
 *   npx tsx packages/scraper/src/harvest/accountantAm.ts            # 50 pages, 250 posts
 *   npx tsx packages/scraper/src/harvest/accountantAm.ts --pages 10 --posts 100
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import { fetchPage } from '../http.js';

const CATEGORY =
  'https://www.accountant.am/category/%d5%b0%d5%a1%d6%80%d6%81-%d5%b8%d6%82-%d5%ba%d5%a1%d5%bf%d5%a1%d5%bd%d5%ad%d5%a1%d5%b6/';
const OUT_DIR = join(process.cwd(), 'data', 'eval');
const OUT = join(OUT_DIR, 'accountant-am.jsonl');

interface Harvested {
  url: string;
  title: string;
  /** dd/mm/yyyy as printed on the page. */
  date: string | null;
  question: string;
  commentCount: number | null;
}

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * Question links on a listing page.
 *
 * Scoped to the theme's post-title headings (`boldwp-fp-post-title`), NOT all
 * root-level links: the first version matched any single-segment slug and
 * harvested the sidebar — service ads, document-template pages, a 2015
 * announcements page. Chrome links live outside these heading blocks, so the
 * container class is the discriminator that the URL shape failed to be.
 */
function extractPostLinks(html: string): { url: string; title: string }[] {
  const $ = cheerio.load(html);
  const seen = new Map<string, string>();

  $('[class*="boldwp-fp"] h3 a[rel="bookmark"], h3[class*="post-title"] a').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (!href.startsWith('https://www.accountant.am/')) return;
    const title = $(el).text().trim();
    if (title && !seen.has(href)) seen.set(href, title);
  });

  return [...seen.entries()].map(([url, title]) => ({ url, title }));
}

function extractPost(html: string, url: string, fallbackTitle: string): Harvested {
  const $ = cheerio.load(html);

  const title = $('h1').first().text().trim() || fallbackTitle;
  const date = /(\d{2}\/\d{2}\/\d{4})/.exec($('.boldwp-entry-meta-single-date').text())?.[1] ?? null;

  // The question body. Menus and share widgets sit outside .entry-content;
  // scripts/styles inside it are dropped before taking text.
  const content = $('.entry-content').first();
  content.find('script, style, .sharedaddy, .jp-relatedposts').remove();
  const question = content.text().replace(/\s+/g, ' ').trim();

  const commentText = $('.boldwp-entry-meta-single-comments').text();
  const commentCount = /(\d+)/.exec(commentText)?.[1];

  return {
    url,
    title,
    date,
    question,
    commentCount: commentCount ? Number(commentCount) : null,
  };
}

async function alreadyHarvested(): Promise<Set<string>> {
  try {
    const raw = await readFile(OUT, 'utf8');
    return new Set(
      raw.split('\n').filter(Boolean).map((l) => (JSON.parse(l) as Harvested).url),
    );
  } catch {
    return new Set();
  }
}

async function main(): Promise<void> {
  const pages = arg('pages', 50);
  const posts = arg('posts', 250);
  await mkdir(OUT_DIR, { recursive: true });

  // Phase A: the index. Newest first, so page 1 is yesterday's questions —
  // exactly the recency that matters, since pre-2018 questions reference the
  // previous Tax Code entirely.
  const index: { url: string; title: string }[] = [];
  const indexSeen = new Set<string>();
  for (let p = 1; p <= pages; p++) {
    const url = p === 1 ? CATEGORY : `${CATEGORY}page/${p}/`;
    try {
      const res = await fetchPage(url);
      if (res.status !== 200) { console.log(`page ${p}: HTTP ${res.status} — stopping index`); break; }
      const links = extractPostLinks(res.html);
      for (const l of links) {
        if (!indexSeen.has(l.url)) { indexSeen.add(l.url); index.push(l); }
      }
      if (p % 10 === 0) console.log(`index: ${p}/${pages} pages, ${index.length} questions`);
    } catch (err) {
      console.log(`page ${p}: ${String(err).slice(0, 80)} — continuing`);
    }
  }
  console.log(`index complete: ${index.length} question URLs from ${pages} pages`);

  // Phase B: full text, newest first, resumable.
  const done = await alreadyHarvested();
  const todo = index.filter((e) => !done.has(e.url)).slice(0, Math.max(0, posts - done.size));
  console.log(`full text: ${done.size} already harvested, fetching ${todo.length} more`);

  let ok = 0;
  let failed = 0;
  for (const entry of todo) {
    try {
      const res = await fetchPage(entry.url);
      if (res.status !== 200) { failed++; continue; }
      const post = extractPost(res.html, entry.url, entry.title);
      // A post with no recoverable body is a parse problem, not data.
      if (post.question.length < 40) { failed++; continue; }
      await appendFile(OUT, JSON.stringify(post) + '\n', 'utf8');
      ok++;
      if (ok % 25 === 0) console.log(`  ${ok}/${todo.length}`);
    } catch (err) {
      failed++;
      console.log(`  ${entry.url.slice(-40)}: ${String(err).slice(0, 60)}`);
    }
  }

  console.log(`\nharvested ${ok} questions (${failed} failed) → ${OUT}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
