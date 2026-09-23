/**
 * Rebuilds `accounting-firms.csv` — every accounting firm Spyur lists, with a
 * phone and the director's name.
 *
 * RUN IT IN A BROWSER CONSOLE ON https://spyur.am, not in Node. Spyur answers
 * a plain server-side fetch with a stripped 34 KB page that contains no
 * results at all — no error, just an empty listing. A session cookie, a
 * Referer and a browser User-Agent do not change that; only a request made
 * from a real page on the origin gets the 156 KB page with the 20 rows on it.
 * This cost an hour to discover, so: open spyur.am, open the console, paste.
 *
 * Category 845 is "ՀԱՇՎԱՊԱՀԱԿԱՆ ԾԱՌԱՅՈՒԹՅՈՒՆՆԵՐ" — 298 organisations, which is
 * the whole phase-1 addressable market. Listing pages carry only names; the
 * director and the phone are on each company page, so both are fetched.
 *
 * The other trap: pagination is the PATH `/am/home/advanced_search-<N>/alpha/`
 * for N = 1..15. There is no page parameter — `&page=2`, `&start=20` and
 * friends all return page 1, silently and with HTTP 200, so a scraper that
 * guesses one collects the same 20 firms fifteen times.
 *
 * `tier` is data-status from the listing row: Spyur's membership level, and
 * the only size signal the directory exposes. A (10) and B (20) are paying
 * members and are worth calling first; D (50) is a free listing.
 */
const QS = '?search=1&products_and_services=1&yp_cat3=845&from=by_home';
const TIER = { '10': 'A', '20': 'B', '40': 'C', '130': 'C', '50': 'D' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const doc = async (u) => new DOMParser().parseFromString(await (await fetch(u, { credentials: 'same-origin' })).text(), 'text/html');

const list = [];
for (let p = 1; p <= 15; p++) {
  const d = await doc(`/am/home/advanced_search-${p}/alpha/${QS}`);
  for (const a of d.querySelectorAll('.results_list a[href*="/am/companies/"]')) {
    const n = a.querySelector('.company_name');
    list.push({ url: a.getAttribute('href'), name: n ? n.textContent.trim() : '', status: a.getAttribute('data-status') });
  }
  await sleep(600);
}
const seen = new Set();
const firms = list.filter((r) => !seen.has(r.url) && seen.add(r.url));

async function detail(item) {
  try {
    const d = await doc(item.url);
    const t = d.body.innerText.replace(/[\t ]+/g, ' ');
    return {
      ...item,
      director: (t.match(/Ղեկավար\s*\n\s*([^\n]+)/) || [])[1]?.trim() ?? '',
      phones: [...new Set([...d.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute('href').slice(4)))].filter((x) => x !== '113'),
      addr: ((t.match(/Հայաստան,\s*\d{0,4},?\s*([^\n]+)\n\s*([^\n]+)/) || []).slice(1).filter(Boolean).join(', ')).trim(),
    };
  } catch {
    return { ...item, director: '', phones: [], addr: '' };
  }
}

const rows = [];
for (let i = 0; i < firms.length; i += 5) {
  rows.push(...(await Promise.all(firms.slice(i, i + 5).map(detail))));
  console.log(`${rows.length}/${firms.length}`);
  await sleep(300);
}

/** The legal-form boilerplate is on nearly every name and helps nobody read the list. */
const clean = (s) =>
  (s || '').replace(/\s*սահմանափակ պատասխանատվությամբ ընկերություն\s*\(ՍՊԸ\)/g, ' ՍՊԸ')
           .replace(/\s*փակ բաժնետիրական ընկերություն\s*\(ՓԲԸ\)/g, ' ՓԲԸ')
           .replace(/«|»/g, '').replace(/\s+/g, ' ').trim();
const city = (a) => {
  const d = (a || '').match(/\(([^)]*վարչ[^)]*)\)/);
  if (d) return d[1].replace(' վարչ. շրջան', '').trim();
  return (a || '').includes('Երևան') ? 'Երևան' : ((a || '').split(',')[1] || '').trim();
};
const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';

const csv = ['tier,name,director,phone1,phone2,city,spyur_url,last_touch,outcome,next_touch']
  .concat(
    rows
      .map((r) => ({ t: TIER[r.status] ?? 'D', n: clean(r.name), d: clean(r.director), p: r.phones, c: city(r.addr), u: 'https://spyur.am' + r.url }))
      .sort((a, b) => a.t.localeCompare(b.t) || a.n.localeCompare(b.n, 'hy'))
      .map((r) => [r.t, r.n, r.d, r.p[0] ?? '', r.p[1] ?? '', r.c, r.u, '', '', ''].map(q).join(',')),
  )
  .join('\n');

// BOM, or Excel reads the Armenian as mojibake.
const a = document.createElement('a');
a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
a.download = 'accounting-firms.csv';
a.click();
console.log(`${rows.length} firms, ${rows.filter((r) => r.phones.length).length} with a phone`);
