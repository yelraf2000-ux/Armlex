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

Not by tier descending. The first ten calls are for finding out which opening
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

- **It is accurate to Spyur, not to reality.** 219 of these are free listings
  that nobody pays to keep current. A phone may be dead and a director may have
  left years ago. Only a call settles it.
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
