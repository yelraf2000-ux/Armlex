# The call list

`accounting-firms.csv` — 298 accounting firms from Spyur category 845
(ՀԱՇՎԱՊԱՀԱԿԱՆ ԾԱՌԱՅՈՒԹՅՈՒՆՆԵՐ), which is the whole phase-1 addressable
market. 279 have a phone number, 220 name their director.

Rebuild it with `spyur-accounting.js` — **pasted into a browser console on
spyur.am**, not run in Node. The header of that file says why, and names the
two ways this scrape fails silently rather than loudly.

## Columns

`tier` is Spyur's membership level, the only size signal the directory
exposes: **A** (26) and **B** (33) pay for their listing, **C** (20) is a bare
entry with no contact details at all, **D** (219) is a free listing. A paying
listing is weak evidence of a larger firm — not proof, but better than
nothing, and it is the only ordering signal available before the first call.

`website` (94 firms) and `facebook` (179) are the firm's own links, with
Spyur's vanity short-URL and its own social accounts stripped out — a naive
scrape of that field returns a spyur.am link for 187 rows. **More of these
firms have a Facebook page than a website**, and 80 have neither. That makes
Messenger a real second route to an owner who does not answer the phone, and
it says most of these firms cannot be researched online before a call.

`updated` is Spyur's own «Տեղեկությունների թարմացման ամսաթիվ» — the date the
entry was last touched. This is the freshness answer: **228 were updated in
2026, 64 in 2025, and only 6 are older than that.** Spyur is a paid directory
whose staff re-check entries, so this is not a listing dumped once in 2015.
It still says when the ENTRY was checked, not that the firm is trading today.

`staff` is «Աշխատողների քանակ», and it is a better call-order signal than
`tier`: a per-seat product is worth far more to a 16-50 firm than to a
three-person office. Only 61 firms publish it — 21 of the callable ones have
16+ staff, and those 21 are the list to start from.

`flag` says whether the row is worth dialling. **261 are `call`.** The rest:
`no_phone` (19 — Spyur holds none, verified against the pages, not a scrape
failure), `foreign` (11 — diaspora accountants in Los Angeles and Moscow, real
entries but not your market), `solo` (6 — ԱՁ sole traders, who have no juniors
to disturb them and so are the wrong shape for a per-seat product) and
`not_a_firm` (1 — the Association of Accountants, an NGO; worth a call one day
as an institutional channel, not as a customer).

`last_touch`, `outcome`, `next_touch` are empty on purpose. They are the
columns that matter after week one; fill them in after every call. The most
common way this list dies is forgetting who has already been rung.

## Call order

**Start with the 21 callable firms that report 16+ staff** (`staff` = 16-50 or
51-250). Two of them report 51-250. They are where the per-seat maths works,
and 21 is a week of calling.

After that, not by tier descending. The first ten calls are for finding out which opening
works, and spending the 26 tier-A firms on that is expensive — they are worth
several times a tier-D firm each.

1. **Calls 1–10:** tier D, to burn in the script. Expect to be bad.
2. **Calls 11–40:** tier B and the rest of D.
3. **Calls 41+:** tier A, with the version of the pitch that works by then.

Two things jump the queue whatever their tier: anyone a current customer will
introduce, and any firm currently hiring accountants (hh.am, staff.am) —
a firm taking on juniors has the problem today.

## How far to trust it

Five rows were spot-checked against the live pages: director and phones matched
exactly each time, including the row that has no data at all. The parsing is
faithful to Spyur.

What that does **not** establish:

- **It is accurate to Spyur, not to reality.** The `updated` column is the best
  available evidence and it is reassuring — 292 of 298 entries were touched
  within the last 21 months. But an entry being re-checked is not the same as a
  firm still trading under that number with that director. Only a call settles
  it.
- **237 firms publish no staff count**, so the 21-firm shortlist is "firms that
  are large AND say so", not "the 21 largest firms". A big firm that withholds
  the field is invisible to that sort.
- **Only the first two phones are kept.** ՋԻ ՍՈՖՏ lists three; the CSV has two.
  The Spyur URL on every row has the full set.
- **Category 845 is not purely accounting firms.** It also holds law firms
  (ԼԻԳԸԼ ԸՆԴ ԹԱՔՍ, ԷԼ ԷՍ ԷՅ), audit firms, and a 1C software developer that
  does accounting on the side (ՋԻ ՍՈՖՏ). They are not wrong entries — most are
  still plausible buyers — but the list is "firms Spyur files under accounting
  services", not "accounting firms".
- **Four phone numbers appear on two rows each**, and three people are director
  of two firms each. Related entities or duplicate listings; check before
  ringing the same person twice.
- **`tier` means "pays Spyur", not "is large".** A big firm with a free listing
  sits in tier D.
- **238 of 298 are in Yerevan.** Most of the ~60 regional entries are one- and
  two-person offices.

## What is not in here

The 33 licensed audit firms (Chamber of Accountants and Auditors) are a
separate, higher-value register and are not all in category 845. The 20 tier-C
rows have no phone and need a look-up before they are callable.
