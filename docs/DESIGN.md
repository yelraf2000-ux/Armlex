# MatyanAI Armenian Legal & Tax Design System — DESIGN.md

Comprehensive design tokens and component specifications for the MatyanAI
Armenian Legal & Tax Copilot. `packages/frontend/src/styles.css` implements
this file; when the two disagree, this file is the intent.

## 0. Decisions taken when adopting it (2026-09-16)

| Question | Decision |
| :--- | :--- |
| Languages | **Armenian only.** §1 lists English; the interface, emails and answers stay Armenian-only, as decided earlier. §1's Armenian typography guidance applies. |
| Components in this spec that the app does not have (Հաշվապահ / Դիտորդ roles, Ակտիվ / Հրավիրված pills, metric tiles, verified-legal badge) | **Restyle what exists only.** New components are a separate decision. |
| Dark mode | **Light only.** The dark theme and its (hidden) switcher were removed rather than derived from a palette that does not define one. |

Deviations, each for contrast (WCAG AA, 4.5:1 for text under 18px):

| Spec | Used | Why |
| :--- | :--- | :--- |
| `danger-500` #ef4444 for error text and destructive-button fill | `danger-600` #dc2626 | #ef4444 is 3.8:1 on white and for white-on-red; #dc2626 is 4.8:1. `danger-500` is still used for non-text marks. |
| `text-subtle` #94a3b8 | Placeholders and disabled text only | 2.6:1 on white. Informational captions use `text-muted` #64748b (4.8:1). |
| `info-500` #0284c7 | Icons and accent borders only | 4.1:1 on white — fine for a graphic (3:1), not for small text. |

---

## 1. Brand Personality & Core Principles

- Domain: Armenian Legal & Tax Copilot for Accountants & Enterprises (`ՀՀ Հարկային և Իրավական Տեղեկատվական Համակարգ`).
- Tone: Authoritative, precise, trustworthy, clean, and distraction-free.
- Language Support: Armenian (`hy`), English (`en`). Armenian typography requires optimal line-height and letter-spacing for readability in dense legal and tax codes. *(See §0: Armenian only.)*

---

## 2. Color Palette (Hex)

### 2.1 Primary & Brand Accent
| Token | Hex | Usage |
| :--- | :--- | :--- |
| primary-50 | #eff6ff | Hover states, subtle highlights, active row backgrounds |
| primary-100 | #dbeafe | Badges, secondary pill buttons, icon wrappers |
| primary-200 | #bfdbfe | Selected item borders, divider highlights |
| primary-500 | #3b82f6 | Secondary interactive elements, links |
| primary-600 | #2563eb | Brand Primary — Primary buttons, active navigation, key CTAs |
| primary-700 | #1d4ed8 | Hover state for primary buttons |
| primary-800 | #1e40af | Focused state, active indicators |
| primary-900 | #1e3a8a | Deep brand text, emphasized highlights |

### 2.2 Neutral & Surface Hierarchy
| Token | Hex | Usage |
| :--- | :--- | :--- |
| surface-canvas | #f8f9ff | Page background, app frame canvas (soft cool tint) |
| surface-container-lowest | #ffffff | Primary cards, modal dialogues, input fields, tables |
| surface-container-low | #f1f5f9 | Secondary cards, table headers, inactive tabs |
| surface-container | #e2e8f0 | Subtle background strips, search bars, light borders |
| surface-container-high | #cbd5e1 | Outlines, inactive border strokes |
| surface-container-highest | #94a3b8 | Disabled text, subtle icon strokes |

### 2.3 Text & Typography Colors
| Token | Hex | Usage |
| :--- | :--- | :--- |
| text-primary | #0f172a | Headers, titles, primary labels, table data |
| text-secondary | #334155 | Body copy, legal excerpts, standard text |
| text-muted | #64748b | Captions, secondary timestamps, sub-labels, icons |
| text-subtle | #94a3b8 | Placeholders, inactive state text |
| text-inverse | #ffffff | Text on primary buttons and dark badges |

### 2.4 Semantic & Status Accents
| Token | Hex | Usage |
| :--- | :--- | :--- |
| success-50 | #f0fdf4 | Active status background, verified badge bg |
| success-500 | #22c55e | Active indicator dots, verified check icons |
| success-700 | #15803d | Active status label text |
| warning-50 | #fffbeb | Warning banner background, quota alert |
| warning-500 | #f59e0b | Alert icons, quota warning indicators |
| warning-700 | #b45309 | Warning text, pending invitation status |
| danger-50 | #fef2f2 | Error state, delete action bg |
| danger-500 | #ef4444 | Error text, destructive buttons *(see §0)* |
| info-50 | #f0f9ff | Legal advisory disclaimer banner bg |
| info-500 | #0284c7 | ARLIS verified badges, disclaimer icon |

---

## 3. Typography Scale & Hierarchy

- Primary Font Family: Noto Sans, Noto Sans Armenian, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif
- Monospace Font Family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace (for article codes, TIN/ՀՎՀՀ, IDs)

| Level | Size | Weight | Line Height | Tracking | Usage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Display / H1 | 28px (`1.75rem`) | 700 | 36px | -0.02em | Page main titles (Աշխատատարածք, Գրանցում) |
| Heading 2 | 22px (`1.375rem`) | 700 | 28px | -0.01em | Section headers, modal titles, query prompt head |
| Heading 3 | 18px (`1.125rem`) | 600 | 24px | normal | Card titles, metric values, table titles |
| Metric Value | 32px (`2.0rem`) | 700 | 38px | -0.02em | Big stats |
| Subhead / Lead | 15px (`0.9375rem`) | 500 | 22px | normal | Card descriptions, section subtitles |
| Body (Default) | 14px (`0.875rem`) | 400 / 500 | 22px | normal | Table rows, copilot replies, form input labels |
| Body (Legal Text) | 14px (`0.875rem`) | 400 / 600 | 24px | normal | Legal analysis paragraphs, quoted articles |
| Caption / Small | 12px (`0.75rem`) | 500 / 600 | 16px | +0.01em | Status badges, timestamps, footnotes, disclaimer |
| Micro / Overline | 11px (`0.6875rem`) | 700 | 14px | +0.05em | Section taglines (ԿԱՌԱՎԱՐՄԱՆ ՎԱՀԱՆԱԿ, ՕԳՏԱԳՈՐԾՈՒՄ) |

---

## 4. Spacing System (8pt Grid)

| Token | Size | Primary Usage |
| :--- | :--- | :--- |
| space-1 | 4px | Tight badge padding, micro gaps |
| space-2 | 8px | Icon-to-text gap, compact tag padding |
| space-3 | 12px | Input vertical padding, list item gaps |
| space-4 | 16px | Card internal padding (mobile), standard gaps |
| space-5 | 20px | Medium card inner padding, dialog padding |
| space-6 | 24px | Standard container padding, card header-to-body |
| space-8 | 32px | Section vertical rhythm, onboarding card padding |
| space-10 | 40px | Top header spacing, layout margins |
| space-12 | 48px | Major hero/view sections |

---

## 5. Elevation, Shadows & Borders

### Border Radii
| Token | Value | Application |
| :--- | :--- | :--- |
| radius-xs | 4px | Checkboxes, tooltips |
| radius-sm | 6px | Code snippets, small tags |
| radius-md | 8px | Buttons, text inputs, dropdown menus, table rows |
| radius-lg | 12px | Standard cards, analytics widgets, callout boxes |
| radius-xl | 16px | Large containers, modal dialogs, onboarding box |
| radius-2xl | 24px | Floating chat inputs, prompt capsules |
| radius-full | 9999px | Avatars, status pills, count badges, progress bars |

### Elevation & Box Shadows
| Token | Value | Usage |
| :--- | :--- | :--- |
| shadow-none | none | Inset items, flat bordered cards |
| shadow-sm | 0 1px 2px 0 rgba(15, 23, 42, 0.05) | Default cards, inputs, secondary buttons |
| shadow-md | 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -2px rgba(15, 23, 42, 0.04) | Dropdown menus, modal popovers |
| shadow-lg | 0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.03) | Floating action bars, search modal |
| shadow-focus | 0 0 0 3px rgba(37, 99, 235, 0.2) | Input focus ring, button focus ring |

### Border Styles
- border-subtle: 1px solid #e2e8f0 (standard card borders, table dividers)
- border-highlight: 1px solid #bfdbfe (active/focused card borders)
- border-input: 1px solid #cbd5e1 (form control idle border)

---

## 6. Component Variants

### 6.1 Buttons
- **Primary** — background #2563eb (hover #1d4ed8); text #ffffff, weight 600; padding 10px 20px; radius 8px; optional right-aligned 16px icon.
- **Secondary / Outline** — background #ffffff, border 1px solid #cbd5e1 (hover bg #f8fafc); text #0f172a, weight 500; padding 8px 16px.
- **Subtle / Ghost** — transparent (hover bg #eff6ff); text #2563eb or #64748b.
- **Icon Action** — transparent (hover bg #f1f5f9); 36×36px, radius 8px, centred icon.

### 6.2 Form Inputs & Controls
- **Text Input** — height 44px, padding 10px 14px; background #ffffff, border 1px solid #cbd5e1 (focus: border #2563eb, ring 3px #eff6ff); 14px text, placeholder #94a3b8.
- **Size Selector / Segmented Pills** — inactive: bg #f1f5f9, text #334155, border transparent; active: bg #2563eb, text #ffffff, weight 600, shadow-sm.
- **Inline role selector** (Ադմին / …) — background #f8fafc, border 1px solid #e2e8f0, radius 6px.

### 6.3 Badges & Status Pills
- **Active (Ակտիվ)** — bg #f0fdf4, border 1px solid #bbf7d0, text #15803d; leading 6px dot #22c55e.
- **Pending (Հրավիրված)** — bg #f1f5f9, border 1px solid #e2e8f0, text #475569.
- **Role Pill (Ադմին)** — bg #eff6ff, text #2563eb, weight 600, 12px.
- **Verified Legal Badge** — bg #eff6ff, border 1px solid #bfdbfe, text #1d4ed8, verified-check icon.

### 6.4 Data Displays & Tables
- **Table Header** — bg #f8fafc, height 40px; 12px, weight 600, #64748b, uppercase, tracking +0.05em.
- **Table Rows** — height 56px, border-bottom 1px solid #f1f5f9, hover #f8fafc. Avatar initials 36×36px circle, bg #2563eb or #0284c7, white text.
- **Quota Progress Bar** — track #e2e8f0, 8px, radius full; indicator #2563eb (#ef4444 when depleted), radius full.

### 6.5 Legal Reference Card (Copilot Right Rail)
- Background #ffffff, border 1px solid #e2e8f0, radius 12px, padding 16px.
- Header: article index (`Հոդված 63`) bold in #2563eb, plus a modification-date tag (`13.08.2026`).
- Content: verbatim statutory excerpt, #334155, 13px / 20px.

### 6.6 Persistent Footer / Legal Disclaimer Banner
- Background #ffffff or #f8fafc, border-top 1px solid #e2e8f0.
- Icon: info circle, #64748b.
- Copy: «Սա իրավաբանական խորհրդատվություն չէ — ստուգեք ամբողջական տեքստը ARLIS-ում»
- Text: 12px, #64748b, centred flex layout.
