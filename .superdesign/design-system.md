# مسیر ثروت — Design System

## Product and screen

«مسیر ثروت» یک بازی راهبردی مالی دربارهٔ ساخت درآمد پایدار، مدیریت نقدینگی و انتخاب میان رشد دارایی و کیفیت زندگی است. رابط این مرحله، صفحهٔ اصلی اتاق بازی و نوبت جاری را نشان می‌دهد: موجودی و شاخص‌ها، نقشهٔ شهر، وضعیت بازار، دارایی‌ها و فرم ثبت سفارش. اطلاعات مالی از API اتاق دریافت می‌شوند؛ نمودارها و اعداد باید خوانا و قابل‌مقایسه بمانند.

## Visual direction

Use a clean, modern financial strategy-game interface with a restrained modular grid inspired by Mosaic Grid Architecture. The game brief is authoritative: create a crisp 2.5D vector city with confident navy/black outline strokes, flat contemporary colors, small soft ground shadows, and a polished optimistic tone. Keep the world-map illustration professional and strategic; avoid toy-like proportions, mascots, gradients, glass effects, photorealism, and decorative noise. Use the mosaic reference only for clear panel alignment, thin dividers, and deliberate negative space.

## Color tokens

- Canvas: warm parchment `#F5F3EC`; elevated panels `#FFFEFA`; map background `#E7EFEA`.
- Ink/outline: deep navy `#182B3A`; secondary ink `#52616A`; divider `#D8DED9`.
- Primary action: deep teal `#176B63`; hover `#10574F`; pale mint `#DCEFE6`.
- Asset / growth: green `#4D9B70`; amber `#DDA746`; coral `#D97860`; blue `#5788B8`.
- Financial semantics: positive `#28744D`, caution `#B77A20`, negative `#B94D47`.
- Maintain contrast for Persian text and never encode financial state through color alone.

## Typography and language

All visible interface copy is Persian. Set `lang="fa"`, `dir="rtl"` and use logical CSS properties (`margin-inline`, `padding-inline`, `inset-inline`, `border-inline`, `text-align: start`). Prefer Vazirmatn, with system sans-serif fallbacks. Use Persian numerals in display labels and group Toman amounts; keep API values as exact integer strings. Always show the unit «تومان» beside money. The visible calendar is Jalali; ISO dates are reserved for machine data.

## Layout

Desktop game screen: compact top status bar for room, Jalali period, deadline and connection; right-side navigation rail; central Pixi city map as the primary visual; financial summary cards and a market strip; an order panel aligned at the left edge in RTL flow. Use a 12-column grid, consistent 8px spacing steps, 20–24px outer gutters, and panels with modest 8–12px radii. Map cards should feel like readable game controls, not a marketing site.

On narrow screens, let the Pixi map occupy most of the viewport, pin the period and cash HUD near the top, and present decisions in a bottom sheet. Keep essential actions reachable with one thumb and never shrink monetary labels below a comfortable reading size. Panels may stack and navigation may collapse; the text direction stays RTL.

## Map and illustration

Render the city using PixiJS: isometric blocks, neighborhood parcels, roads, small buildings, trees and market markers. Use a consistent 1.5–2px dark outline; visible side faces create the 2.5D depth. Shadows remain short, soft and offset down-left. Color blocks identify market sectors, while labels and line icons provide redundant cues. Use vector geometry and a small set of reusable building shapes rather than large bitmap textures.

## Motion and feedback

Use short, subtle motion: 160–240ms UI transitions, gentle hover lift, small settlement pulses and map camera easing. Respect `prefers-reduced-motion`; pause decorative map movement when the canvas is off-screen. Avoid continuous animation that competes with financial reading. Orders show a clear pending state, then an executed or rejected result with a written reason.

## Components

- Buttons: 44px minimum touch target; solid teal for primary actions; outlined neutral for secondary actions.
- Financial cards: clear title, large exact amount, Toman unit, direction/change label and accessible positive/caution/negative marker.
- Inputs: numeric toman entry with visible separators, explicit unit label and validation message.
- Badges: small rounded status pills with icon/label and text; never color-only.
- Charts: light Chart.js/ECharts treatment, sparse grid lines, Persian labels, tooltips with exact date and Toman values.
- Pixi canvas: explicit accessible name and adjacent DOM controls for each important map action.

## Accessibility and performance

Keep keyboard focus visible, support reduced motion, and maintain readable contrast. React owns semantic controls and state; PixiJS owns the map drawing layer. Render only visible map objects, reuse sprites/graphics, cap pixel ratio on mobile, and avoid React re-renders for pointer movement. Financial state must remain available as HTML text for screen readers.
