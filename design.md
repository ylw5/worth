# Worth UI Design System

This document is the visual source of truth for the Worth mobile app. It applies
to every screen and component in `mobile/`. Product behavior and data semantics
remain defined by the application code and feature specifications.

The reference direction is quiet, spacious, monochrome, and object-focused:
white surfaces, near-black type, restrained cool gray, and a small amount of
ice blue. Worth must inherit that visual language without copying another
product's logo, wording, or screen structure.

## 1. Design principles

1. **The object is the visual focus.** Asset photography and value data outrank
   decoration.
2. **Calm before density.** Use whitespace and type hierarchy before borders,
   color, or containers.
3. **One accent, used sparingly.** Ice blue communicates selection, focus, and
   lightweight emphasis. It is not a page background or decorative wash.
4. **Native by default.** Prefer Expo and platform-native navigation, controls,
   symbols, dialogs, date pickers, and accessibility behavior.
5. **Meaning before imitation.** The asset list displays Worth's useful data
   rather than reproducing labels or metrics from a reference screenshot.

## 2. Color

### Core palette

| Token | Value | Use |
| --- | --- | --- |
| `background` | `#F5F5F8` | App and grouped-page background |
| `surface` | `#FFFFFF` | Cards, fields, sheets, navigation |
| `surfaceMuted` | `#F1F1F4` | Unselected chips and subtle grouped regions |
| `textPrimary` | `#0B0B0D` | Titles, names, primary values |
| `textSecondary` | `#727278` | Labels and supporting copy |
| `textTertiary` | `#B5B5BB` | Timestamps, placeholders, disabled text |
| `border` | `#E6E6EA` | Hairline separation on white surfaces |
| `accent` | `#78B4FF` | Selection, focus, active indicators |
| `accentSoft` | `#EDF6FF` | Selected chip or subtle highlighted surface |
| `onDark` | `#FFFFFF` | Text and icons on near-black controls |
| `danger` | `#C9362B` | Destructive actions and blocking errors only |

Near-black `#0B0B0D` is also the default fill for the strongest action and
active status chip.

### Usage rules

- A normal screen should be at least 80% `background` and `surface`.
- Use `accent` on one or two focal elements in a viewport, not on every value.
- Primary monetary values are near-black. Ice blue may mark a selected or
  newly updated value, but it must not become the default color for all money.
- Status is communicated by text as well as color:
  - active: near-black fill with white text;
  - protected or highlighted: `accentSoft` fill with `textPrimary`;
  - sold, archived, or disabled: `surfaceMuted` fill with `textSecondary`;
  - destructive or failed: `danger`, never ice blue.
- Do not introduce green, purple, gradients, translucent rainbow effects, or
  extra category colors without updating this document.
- The current design is light-only. Keep the status bar dark and do not ship an
  incomplete automatic dark theme.

## 3. Typography

Use the platform system font. Do not bundle a display font for UI copy.
Chinese, Latin text, and numbers must share the same visual hierarchy.

| Role | Size | Weight | Typical use |
| --- | ---: | ---: | --- |
| Display | 34 | 700 | Total portfolio value |
| Page title | 30 | 700 | Large native screen title |
| Section title | 22 | 700 | Primary section heading |
| Card title | 17 | 600 | Asset or wishlist item name |
| Body | 16 | 400 | Main content and form input |
| Label | 14 | 400 | Metadata and field labels |
| Caption | 12 | 400 | Dates, units, tertiary notes |

- Use `fontVariant: ['tabular-nums']` for prices, totals, dates, counts, and
  chart labels.
- Use weight 700 only for page hierarchy, primary monetary values, and the
  strongest action. Avoid making every label bold.
- Default body line height is approximately 1.45× the font size.
- Use sentence case. Avoid all caps and decorative letter spacing.
- Truncate asset names to one line in a grid. Never truncate primary values.

## 4. Spacing and shape

Use a 4-point spacing system:

`4, 8, 12, 16, 20, 24, 32, 40`

- Screen horizontal padding: `20`.
- Grid and compact group gap: `12`.
- Section gap: `24`.
- Card internal padding: `16`; compact asset cards may use `12`.
- Minimum touch target: `44 × 44`.

Corner radii:

| Token | Value | Use |
| --- | ---: | --- |
| `radiusSmall` | 12 | Inputs, small buttons, media |
| `radiusMedium` | 16 | Chips and compact cards |
| `radiusLarge` | 22 | Primary cards, sheets, grouped panels |
| `radiusPill` | 999 | Status and filter chips |

Use continuous corners where the platform supports them. Cards use either a
one-pixel `border` stroke or separation from the gray page background. Do not
combine a visible border with a heavy shadow. Shadows are reserved for floating
controls and must remain soft and low contrast.

## 5. Layout

- Respect safe areas and native navigation insets.
- Keep the main reading and interaction column left-aligned.
- Phone asset grids use two equal columns with a 12-point gap.
- Wider layouts may add columns only when each card remains at least 160 points
  wide; do not stretch two cards into oversized panels.
- Lists use full-width single-column rows.
- Horizontal filter rows may scroll, but the active option must be visible on
  screen entry.
- Avoid nested cards. Use spacing, a divider, or typography inside a primary
  card instead.
- Empty space is intentional. Do not fill it with illustration, tips, or
  decorative metrics unless a feature requires them.

## 6. Navigation and chrome

### Top navigation

- Use native stack headers and platform back behavior.
- Main destinations use a large title; detail, edit, and modal screens use a
  compact title.
- Header actions are system symbols in a 44-point target.
- The primary add action may use a circular white or near-black button. There
  must be only one visually dominant add action per screen.
- Use text labels for ambiguous actions such as “编辑” and “保存”; do not rely
  on an unfamiliar icon.

### Bottom navigation

- Keep the native tab bar.
- Use outline icons for inactive tabs and the platform's filled or emphasized
  state for the active tab.
- Inactive icons use `textTertiary`; active icons use `textPrimary`.
- The active indicator may use `accentSoft`.
- Labels may stay visually hidden in the compact tab bar, but every trigger
  must retain an accessibility label.
- Do not add a custom floating tab bar, glass blur, or ornamental center notch.

### Filters and segmented choices

- Filters are pill chips, 36–40 points high.
- Active filter: near-black fill and white text.
- Inactive filter: white or `surfaceMuted` fill and `textSecondary`.
- Ice blue is reserved for a secondary selected state or focus ring; it should
  not compete with the black primary selection.

## 7. Core components

### Buttons

- Primary: near-black fill, white label, 48–52 points high, 14–16 point radius.
- Secondary: white fill, one-pixel border, near-black label.
- Tertiary: text or icon only with a full 44-point hit target.
- Destructive: `danger` text by default; use a filled danger button only in a
  destructive confirmation.
- Pressed state reduces opacity to about 0.65. Disabled state uses
  `surfaceMuted` and `textTertiary`.
- Show a spinner in place of the action icon or label during submission, and
  prevent duplicate presses.

### Asset card

The asset card is the defining Worth component.

- White card, 22-point radius, 12-point internal padding.
- Product image sits at the top, uses a neutral background, and preserves the
  entire object when possible. Use `contain` for isolated product photography
  and `cover` only for environmental photos.
- Place a compact status chip at the image's top-right when status exists.
- Content order:
  1. asset name;
  2. current reference market value as the primary metric;
  3. purchase price and ownership duration as muted supporting information,
     when available.
- Do not replace market value with “daily cost” unless a product requirement
  explicitly adds that metric.
- Missing values use “待估价” or an em dash, not `¥0`.
- The full card is one accessible press target. Do not place unrelated buttons
  inside it.

### Summary panel

- The portfolio total is a display-sized, tabular number on the page
  background, not inside a decorative hero card.
- Supporting counts appear below in `textSecondary`.
- Category distribution, when present, lives in one white panel with simple
  bars or counts. Use ice blue for the selected or dominant datum only.

### Forms

- Group related fields under short section headings.
- Labels sit above controls in `textSecondary`.
- Inputs use a white background, one-pixel border, 12-point radius, 48-point
  minimum height, and 16-point text.
- Focus uses an `accent` border. Validation uses `danger` text beneath the
  relevant field or once above the submit action when errors are form-wide.
- Use native date, image, keyboard, alert, and selection controls.
- Category choices use chips; do not build a custom dropdown for a short,
  fixed list.
- The save action is a full-width primary button at the end of the form.

### Detail rows

- Use a single white grouped panel.
- Labels align left in `textSecondary`; values align right in `textPrimary`.
- Long values wrap rather than shrink.
- Use subtle dividers only when spacing alone cannot separate rows.

### Icons and imagery

- Use SF Symbols on iOS and matching Material symbols on Android through the
  existing Expo symbol APIs.
- Default icon sizes are 20, 24, and 28 points.
- Icons inherit semantic text colors. Avoid colored icon tiles unless the tile
  is an interactive control.
- Do not copy the MindBack wordmark, “m” avatar, or any reference product
  branding.

## 8. Screen-specific composition

### Assets

1. Large “我的资产” title with one add action.
2. Total reference value and asset/pending counts.
3. Optional horizontally scrolling category filters.
4. Two-column asset grid.

The asset grid is the main content. Category analytics must not push the first
row of assets below the initial viewport on a typical phone.

### Wishlist

- Use a single-column list of white cards.
- Show name first, target price second, and notes last.
- Keep deletion behind a native confirmation. The default card surface must
  not display a prominent red delete control.

### Capture and confirmation

- Keep capture controls visually minimal so the object remains dominant.
- Confirmation begins with the selected photos, followed by one short AI
  assistance message and the editable form.
- AI-filled fields look identical to manually entered fields; do not use a
  different color for machine-generated content.

### Asset detail

1. Photo gallery.
2. Current reference value, range, and sample count.
3. Secondary refresh-price action.
4. Grouped asset facts.
5. Price history.

Editing remains a native header action. The primary value uses near-black;
ice blue may mark the latest point in price history.

### Account

- Use plain grouped rows for identity and settings.
- Do not create a large decorative profile avatar when the app only exposes a
  fixed administrator account.

### Chat

The visual system applies when chat gains product requirements, but this
document does not invent its layout or behavior.

## 9. Feedback and states

- **Loading:** use a native activity indicator near the content being loaded.
  Preserve page structure when practical; do not flash a full-screen spinner
  for background refreshes.
- **Empty:** one short title, one explanatory sentence if needed, and at most
  one action. No mandatory illustration.
- **Error:** plain-language message in `danger` with a retry action when retry
  is possible.
- **Offline or stale:** retain existing content and label its state; do not
  replace useful cached content with an empty screen.
- **Success:** prefer navigation or updated content as confirmation. Use a
  transient message only when the result would otherwise be unclear.
- **Destructive actions:** require a native confirmation when data cannot be
  restored.

## 10. Motion

- Use platform-native transitions.
- Press feedback is immediate and subtle.
- Content changes may fade or move over 150–220 ms.
- Do not add looping animation, parallax, bouncing cards, or ornamental motion.
- Respect reduced-motion settings. Meaning must never depend on animation.

## 11. Accessibility

- Maintain at least 4.5:1 contrast for normal text.
- Support Dynamic Type without clipping primary labels or values.
- Every icon-only action requires an accessibility label and button role.
- Keep touch targets at least 44 × 44 points.
- Selection, status, validation, and price direction must never be conveyed by
  color alone.
- Preserve logical screen-reader order: title, summary, filters, content,
  actions.
- Images require a useful label when they convey asset identity; purely
  decorative imagery is hidden from accessibility APIs.

## 12. Implementation constraints

- Treat the palette, spacing, and radius values as shared tokens. Screens must
  not introduce near-duplicate literals.
- Replace color-specific token names such as `green` and `greenSoft` with
  semantic names such as `accent` and `accentSoft` when implementing this
  redesign.
- Reuse current Expo and React Native capabilities. Do not add a UI kit, icon
  package, font package, chart library, or animation dependency solely to
  implement this visual system.
- Platform-specific differences are acceptable when they preserve the same
  hierarchy and semantics.

## 13. Review checklist

A UI change conforms to this document when:

- the screen uses only documented semantic colors;
- primary content is understandable without decorative color;
- type roles and spacing come from this scale;
- all actions have at least a 44-point target;
- cards are flat, white, and not nested unnecessarily;
- the asset image, name, and value remain the strongest card content;
- loading, empty, error, pressed, disabled, and destructive states are covered;
- native controls are used where available;
- no reference product branding or unrelated product structure has been
  copied;
- the result remains usable with larger text and reduced motion.
