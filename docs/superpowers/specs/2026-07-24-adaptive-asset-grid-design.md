# Adaptive Asset Grid Design

## Goal

Replace the single-column asset list with a responsive grid that shows two
columns on phones, three on tablets, and four on wider screens.

## Layout

- Keep the existing screen-level `ScrollView` and summary sections.
- Use the current window width to choose a column count:
  - fewer than 700 points: 2 columns
  - 700–999 points: 3 columns
  - 1000 points or wider: 4 columns
- Render the asset cards in a wrapping row with a 12-point gap.
- Calculate each card width from the available content width, gaps, and column
  count so every row aligns.
- Recalculate the layout when the window size changes.

## Asset Card

The existing `AssetCard` is only used by the asset list, so it will be changed
in place rather than adding a second component or a layout variant.

Each card will use:

- a full-width square image at the top;
- the asset name and category below the image;
- the current reference price at the bottom;
- the existing link, pressed state, colors, and accessibility role.

Long names remain limited to one line so one card cannot distort its row.

## Data and Error States

Asset loading, totals, categories, navigation, loading errors, and the empty
state are unchanged. The grid only changes the presentation of loaded assets.

## Verification

- Run the existing lint or type-check command for the mobile app.
- Render the asset page at phone, tablet, and wide viewport sizes.
- Confirm the page has 2, 3, and 4 columns respectively, with no clipping or
  overlap.
- Open an asset card and confirm navigation still reaches its detail screen.
- Confirm there are no relevant runtime console errors.
