# FinFlow Design System

FinFlow is a calm, light finance tool with one confident accent. Near-black **ink** carries hierarchy and **lime** marks what matters right now. Everything else is neutral, so the money is what you see first.

The tokens live in `src/index.css` (`:root`), and the components live in `src/money-tracker.jsx`. Build new UI from these tokens and classes; never use raw hex values or one-off inline styles.

---

## 1. Design direction

The direction comes from the four images in `/Design Reference`: the Lumin banking dashboard, the Pesse wallet app and a goals app.

| Pattern in the references | How FinFlow uses it |
|---|---|
| Cool light-grey canvas with flat white cards and no borders | `--bg` canvas, `.card` surfaces with no shadow. Depth comes from contrast between surfaces, not from shadows. |
| **One** ink card holding the most important number | The dashboard hero, "Available to spend" (wants balance). The Savings page has a hero of the same kind. |
| Lime as the single accent (active state, progress, highlight) | `--lime`: spending meter, current-month bar, selected month tile, avatar, accent buttons. |
| Big balance with de-emphasised decimals (`$6,010.29`) | `<Money>` component: `₹35,700` + grey `.00`. |
| Pill navigation with an ink active pill | Desktop `.topnav`. On small screens, a floating ink `.bottom-nav` pill with a white active circle. |
| Round icon quick-actions under the balance | `.quick` buttons in the hero (Income, Expense, Statement). |
| Hatched remainder on the spending slider | `.meter`: solid lime fill over a diagonal hatch. |
| History grouped by day ("Today", "Yesterday") | `groupByDay()` + `.list__group` headers, with a day subtotal on the Expenses page. |
| Goal cards: icon tile, amount / target, coloured progress bar, % | Goals and Lending cards. |
| Muted ink "Saving analytics" bars | Savings "Monthly contributions": ink bars, current month in lime. |

**Deliberately not taken from the references:** promo tiles, card-number art, photo avatars, glass effects, decorative gradients. They carry no data in this product.

---

## 2. Colour tokens

| Role | Token | Value |
|---|---|---|
| Canvas | `--bg` | `#ebecef` |
| Surface (cards) | `--surface` | `#ffffff` |
| Inset / input / hover | `--surface-2` | `#f4f5f7` |
| Track / pressed | `--surface-3` | `#e5e7ea` |
| Ink (hero, primary button, active nav) | `--ink` / `--ink-2` / `--ink-3` | `#121316` / `#1d1f23` / `#2a2d32` |
| Text primary / secondary / muted | `--text` / `--text-2` / `--text-3` | `#121316` / `#5b5f67` / `#8d9199` |
| Text on ink | `--text-on-ink` / `-2` / `-3` | `#fff` / `#9a9ea6` / `#686c74` |
| Border / divider | `--border` / `--divider` | `#e3e5e8` / `#eef0f2` |
| Accent | `--lime` (hover `--lime-hover`) | `#d2f24b` |
| Accent for marks on white | `--lime-chart` | `#b6da2c` |
| Positive (income, repaid) | `--pos` / `--pos-bg` | `#2b8a3e` / `#e6f4e3` |
| Negative (over budget, errors) | `--neg` / `--neg-bg` | `#cf3d36` / `#fbe8e6` |
| Warning / Info | `--warn`, `--info` (+ `-bg`) | `#c7790f`, `#3f5fd6` |

Rules:
- **One accent.** Lime is the only brand colour. Do not add a second accent.
- **Status colours are reserved.** `--pos` and `--neg` mean good and bad. They are never used as a series colour, and they always appear with a sign, an icon or a label.
- Income amounts are `--pos` with a `+` sign. Expense amounts are `--text` with a `−` sign. Red is kept for real problems such as over budget, deletes and errors.
- Legacy goal colours (`--gold`, `--teal`, `--violet`, `--rose`) are aliased so that goals saved before the redesign still render.

### Data-visualisation colours
| Use | Tokens |
|---|---|
| Cash flow (2 series) | Income `--c-income` (ink), Spent `--c-spent` (lime-chart) |
| Expense categories | `--cat-1 … --cat-8`, in the **fixed order** General, Food, Transport, Bills, Health, Entertainment, Shopping, Other |
| Savings split | Investments white, Emergency lime (on ink) |
| Allocation bar | Tithe `--text-3`, Wants `--lime-chart`, Savings `--ink` |

The categorical palette passed the colour-blind-separation validator in its fixed order, so never re-order or cycle it. A colour belongs to a category (`catMeta(tag)`), not to a rank, and unknown tags fold into "Other". Lime on white is under 3:1 contrast, so every chart with lime marks also carries a legend with values and a tooltip.

---

## 3. Typography

**Manrope** (Google Fonts, 400–800), falling back to `system-ui`. All money uses tabular numerals (`.num`, `.money`).

| Style | Size / line | Weight | Tracking | Where |
|---|---|---|---|---|
| Hero number | 44/50 (36 on mobile) | 600 | −0.04em | `.money--hero` |
| Page title | 30/36 (24 on mobile) | 600 | −0.03em | `.page-title` |
| Stat number | 30/36 | 600 | −0.03em | `.money--xl` |
| Large number | 22/28 | 600 | −0.02em | `.money--lg` |
| Section title | 17/24 | 600 | −0.01em | `.card__title` |
| Body / row title | 14/20 | 500 / 600 | 0 | body, `.row__title` |
| Label | 12/16 | 600 | 0 | `.field__label`, `.eyebrow` |
| Caption / meta | 12–13 | 500 | 0 | `.row__meta`, `.card__sub` |

Formatting is always `en-IN` INR through `currency()`, which uses lakh grouping and 2 decimals. Chart axes use `compactINR()` (`₹60K`, `₹1.2L`). Dates use `fmtDate()` (`Oct 26, 2026`) and `dayLabel()` (`Today`, `Yesterday`, `Sat, Oct 24, 2026`). Always use the timezone-safe helpers `localToday`, `parseLocal`, `monthKey` and `addMonths`.

---

## 4. Spacing, layout and geometry

- **Spacing scale (4px base):** `--s-1` 4, `--s-2` 8, `--s-3` 12, `--s-4` 16, `--s-5` 20, `--s-6` 24, `--s-8` 32, `--s-10` 40.
- **Shell:** max-width 1280px, 24px gutters (16px under 600px). Card gap is 16px.
- **Card padding:** 24px (20px on mobile). Inner `.tile` blocks are 16px.
- **Radii:** cards `--r-lg` 24px, tiles and month rows `--r-md` 16px, inputs `--r-sm` 12px. Pills (`--r-pill`) are only for buttons, segmented controls, badges and the nav. Icon containers are circles.
- **Breakpoints:**
  - `1180px`: the dashboard goes from 3 columns to 2.
  - `960px`: the top nav is swapped for the bottom pill nav.
  - `900px`: two-column page splits stack.
  - `760px`: single-column dashboard, and month rows show their figures underneath.
  - `720px`: stat strips stack.
  - `600px`: the mobile type scale applies and the date picker becomes a centred popover.
- **Dashboard grid:** `hero | cash flow` over `hero | this month | categories`, then `record income | recent activity`.

---

## 5. Components

| Component | Class / JSX | Notes |
|---|---|---|
| Card | `.card`, `.card--ink`, `.card--flush`, `.card__head/title/sub` | Flat, no border, no shadow. Only one ink card per page. |
| Tile | `.tile` | A nested block inside a card. On ink cards it switches to `--ink-2`. |
| Stat strip | `.stat-strip` + `<Stat>` | Several metrics in one card with dividers between them. Use this instead of rows of identical cards. |
| Money | `<Money value className="money--hero|xl|lg|md">` | Decimals are muted. |
| Buttons | `.btn` + `--primary` (ink), `--accent` (lime), `--secondary`, `--outline`, `--sm`, `--block` | Height 44 (36 for small). Use one primary per form. |
| Icon button | `.icon-btn`, `--solid`, `--quiet`, `--danger` | 36px circle; every one needs an `aria-label`. |
| Quick action | `.quick` + `.quick__circle` | Only on ink hero cards. |
| Segmented control | `<Segmented options value onChange label>` | Uses `aria-pressed`; the active option is ink. |
| Fields | `.field` + `.field__label`, `.input`, `.select`, `.input-wrap` + `.input-prefix` / `.input-icon`, `.input--amount` | Filled inputs; on focus they turn white with an ink border. |
| Category chooser | `.chip-grid` + `.chip` | A 4×2 icon grid that replaces the old `<select>`. |
| Date picker | `<FinDateSelector value onChange label>` | Keyboard (Esc) friendly; centred popover on mobile. |
| Transaction row | `<TxRow icon iconColor|iconClass title meta amount positive onDelete>` | The delete action appears on hover (always shown on touch devices). |
| Badge | `.badge`, `--pos`, `--neg`, `--warn`, `--lime` | Used for deltas and shares. |
| Progress | `.progress` + `.progress__fill`, `.meter`, `.stack` | Every bar is paired with numbers. |
| Month accordion | `.month`, `.month__head` (`aria-expanded`), `.month__body` | Used on the History page. |
| Empty state | `<EmptyState icon title text>` | Always says what to do next. |
| Chart tooltip | `<ChartTooltip>` / `.chart-tip` | Ink background, colour key, exact `currency()` values. |
| Icons | `<Icon name size>` | 24-grid line icons with 1.8 stroke and round caps. Add new icons to `ICONS`. |

---

## 6. Charts

- **Library:** Recharts (already a dependency).
- **Form follows the data's job:**
  - Cash flow is a **grouped bar chart** (month-to-month comparison) with a 6M / 12M / All range control. Months with no records are drawn as 0, not skipped.
  - Category share is a **donut** with a centre total and a ranked legend showing % and the amount.
  - Savings is a **single-series bar chart** with the current month in lime and a stated 12-month average.
  - The spending meter and allocation bars are **not charts**; they are labelled bars.
- **Marks:** 4px top radius on bars, `maxBarSize` 20–28, a 2px surface gap between donut slices, and a horizontal-only grid in `--divider`. Axes have no tick or axis lines.
- **Always:** a legend (or a title that names a single series), a tooltip on hover, totals shown as text, and one y-axis only.
- **Accuracy:** every chart value is derived from `salaryEntries` / `expenses` through the same sums that `computeTotals()` uses. Never pad with sample data.

---

## 7. Interaction and motion

- **Transitions:** `--t-fast` 120ms (rows), `--t` 200ms (controls), easing `--ease`.
- **Page enter:** `.rise` (6px, 320ms). There are no looping or decorative animations, and `prefers-reduced-motion` disables all motion.
- **Hover:** surfaces step one level (`--surface-2` → `--surface-3`). The primary button lightens to `--ink-3`. Press scales to 0.97.
- **Focus:** `:focus-visible` shows a 2px ink outline (lime on ink surfaces). Inputs get an ink border plus a soft ring.
- **States:** `:disabled` drops to 38% opacity. Loading uses `.spinner`. Errors and success messages use `.alert--neg` / `.alert--pos` with an icon.
- **Accessibility:** `aria-current="page"` on nav items, `aria-pressed` on toggles, `aria-expanded` on accordions and the date picker, and labelled icon-only buttons. Touch targets are at least 36px (48px in the bottom nav).

---

## 8. Mobile and app behaviour

On screens up to 960px wide, FinFlow behaves like an installed phone app rather than a web page.

- **Installable:** `public/manifest.webmanifest` and the icons in `public/` let it be added to the home screen. It then opens full-screen with no browser bar and respects the notch and home-bar safe areas (`--safe-*` tokens).
- **Navigation:**
  - The floating ink bottom nav expands the active tab into a labelled pill.
  - Tabs are kept in the URL hash, so the phone's back gesture moves between tabs.
  - Each tab remembers its scroll position, and re-tapping the active tab scrolls to the top.
  - Pages slide in from the direction of travel (`.page`, `--dir`).
- **App bar:** sticky and translucent. When you scroll, the brand swaps for the page title.
- **Adding things:** on phones, forms open in a **bottom sheet** (`<Sheet>`). Open one from the hero's quick actions or the floating lime "Add expense / New goal / New loan" button above the nav (`.fab`, rendered by `PageHeader action`). Dismiss it by dragging the grabber down, tapping the backdrop or using back. On desktop the same forms stay inline.
- **Deleting:** swipe a transaction row left to reveal Delete; a long swipe deletes it straight away. The hover trash icon is used on mouse devices only.
- **Feedback:** every add and delete shows a toast (`notify()`), plus a short vibration where the phone supports it (`haptic()`).
- **Touch polish:**
  - Pressed states replace hover.
  - No tap-highlight flash and no double-tap zoom.
  - Inputs are 16px, so iOS doesn't zoom into them.
  - The bottom nav hides while the keyboard is open.
  - The date picker becomes a bottom sheet.
  - The installed app has no pull-to-refresh bounce.
