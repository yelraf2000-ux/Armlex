/**
 * The product's mark and name, as every header shows them.
 *
 * One component because six headers name the product — the app, the landing
 * page (twice), the account pages and the shared conversation (twice) — and a
 * mark added to five of them is the kind of drift a single definition prevents.
 *
 * The image carries no alt text: the name beside it already says MatyanAI, and
 * a screen reader announcing "MatyanAI MatyanAI" is worse than announcing it
 * once. It is stored at three times the size it is shown.
 */
import { BRAND } from './brand.js';

export function BrandMark() {
  return (
    <>
      <img className="brand-logo" src="/logo.png" alt="" width={51} height={32} />
      <span className="brand-text">{BRAND}</span>
    </>
  );
}
