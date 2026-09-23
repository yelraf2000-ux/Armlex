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

## What is not in here

The 33 licensed audit firms (Chamber of Accountants and Auditors) are a
separate, higher-value register and are not all in category 845. The 20 tier-C
rows have no phone and need a look-up before they are callable.
