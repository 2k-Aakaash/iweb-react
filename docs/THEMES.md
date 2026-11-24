# Making iWeb themes

A theme changes how iWeb looks and sounds: fonts, colours, corners, glass, icons, app
names, the wallpaper, interface sounds and any styling you add. People install themes from
the **Theme Store**, or from a file in **Settings → Appearance → Theme → Install from File…**.

Themes are **data only**. A theme can't run code or load anything from the internet, and
iWeb checks every file before installing it. That keeps themes safe to share, and it's
required for a Chrome extension.

## Quick start

1. In the [themes repo](https://github.com/2k-Aakaash/iweb-themes), copy `template/` to
   `themes/<your id>/`, for example `themes/paper-ink/`.
2. Edit `theme.json` (name, author, version) and `tokens.json` (your values).
3. Run `npm install` once, then `npm run pack -- themes/paper-ink` in the themes repo. It
   checks the theme and writes `paper-ink-1.0.0.zip`. In iWeb choose **Install from File…**
   and pick the zip. Change something, pack and install again: the same id updates in place.
4. To publish it, open a pull request that adds your folder under `themes/`. When it's
   merged, the store builds it and lists it in the Theme Store.

## The package

A theme is a `.zip` with these files at its root, or inside one folder:

| File | Required | What it holds |
|---|---|---|
| `theme.json` | Yes | Who and what the theme is |
| `tokens.json` | No | Values for iWeb's design tokens, the accent, glass, icons, names, the wallpaper and sounds |
| `skin.css` | No | Extra styling |
| Any other files | No | Fonts, images and sounds the files above refer to |

**Allowed file types:** `.json .css .md .txt`, fonts `.woff2 .woff .ttf .otf`, images
`.svg .png .jpg .jpeg .webp .avif .gif`, sounds `.ogg .mp3 .wav`. Anything else, such as
`.js` or `.html`, refuses the whole package.

**Limits:**
- 25 MB zipped, 60 MB unzipped
- 15 MB per file, and 1 MB per sound
- 300 files

Only files the theme refers to are kept.

### theme.json

```json
{
  "format": 1,
  "id": "paper-ink",
  "name": "Paper & Ink",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "Warm paper, dark ink and a serif type.",
  "license": "CC-BY-4.0",
  "minIweb": "3.2",
  "appearance": "dark",
  "preview": ["previews/desktop.png", "previews/settings.png"],
  "fonts": [
    { "family": "Paper Serif", "src": "fonts/paper-serif.woff2", "weight": "400" },
    { "family": "Paper Serif", "src": "fonts/paper-serif-bold.woff2", "weight": "700" }
  ]
}
```

| Field | Rules |
|---|---|
| `format` | Always `1` |
| `id` | 2–40 lowercase letters, digits or hyphens. Never change it: it's how updates find the theme. `iweb` is reserved. |
| `name` | Up to 40 characters |
| `version` | `major.minor.patch`. Raise it for every release, or the store won't offer the update. |
| `author` | Up to 60 characters |
| `description` | Optional, up to 280 characters |
| `license` | Optional, up to 60 characters. Use a licence that allows sharing, for you and for every font and image you include. |
| `minIweb` | Optional. The oldest iWeb version the theme works with. |
| `appearance` | `dark`, `light` or `both`. A theme for one appearance keeps iWeb in it while it's in use. |
| `preview` | Optional. Up to 6 images, the first used as the theme's card. Use 16:10, at least 1280×800. |
| `fonts` | Optional. Up to 12. `weight` is `normal`, `bold` or 100–900; `style` is `normal` or `italic`. iWeb loads them before the desktop appears. |

### tokens.json

```json
{
  "tokens": {
    "font-ui": "\"Paper Serif\", Georgia, serif",
    "font-bold": "\"Paper Serif\", Georgia, serif",
    "radius-window": "8px",
    "light-close": "#8e3b2a"
  },
  "light": { "light-close": "#a5452f" },
  "accent": "170 70 45",
  "accentLight": "150 60 38",
  "glass": { "window": { "tint": [40, 28, 18, 0.55], "blur": 16 } },
  "glassLight": { "window": { "tint": [250, 240, 220, 0.5] } },
  "icons": { "settings": "icons/ledger.svg", "notes": "icons/journal.png" },
  "names": { "settings": "Ledger", "notes": "Journal" },
  "wallpaper": "wallpapers/plains.jpg",
  "sounds": { "open": "sounds/open.ogg", "close": "sounds/close.ogg", "minimize": "sounds/close.ogg", "notification": "sounds/note.ogg" }
}
```

Every key is optional:

- **`tokens`**: values for iWeb's design tokens (below). `light` holds different values for
  Light, for themes that support both appearances.
- **`accent`**, **`accentLight`**: the accent colour as `"R G B"`. Every accent-blue part of
  iWeb follows it: buttons, selections, switches, sliders, links, focus rings.
- **`glass`**, **`glassLight`**: the glass look of each surface. Surfaces: `panel window
  spotlight dock bar pill label card tile`. Settings: `tint` `[r, g, b, alpha]`, `blur`
  0–60, `edgeBlur` 0–2, `bezel` 0–60, `refraction` 0–6, `chroma` 0–0.1, `lift` −0.5 to 0.5,
  `saturate` 0–3, `specular` 0–3.
- **`glassEffect`**: `"off"` turns glass off everywhere while the theme is in use: no blur
  or refraction, and nothing rendered for it. Each surface then shows only its
  `--glass-tint` material (see skin.css), so give every surface one.
- **`icons`**: an image per icon key (below), shown whole: draw the icon's own shape and
  margins. Use 256×256 or larger; SVG is best.
- **`names`**: new names for `apps wallpaper notes music settings markets news atmosphere
  frontier spotlight widgets themes`, up to 24 characters. The Dock, menus, window titles
  and Apps all follow.
- **`wallpaper`**: a PNG, JPEG, WebP or AVIF image. When someone uses the theme, iWeb offers
  to add it to their wallpapers.
- **`sounds`**: short sounds for `open`, `close`, `minimize` and `notification`, under 1 MB
  each (well under a second is best). People can turn theme sounds off in Settings.

Token values may not contain `;`, `{`, `}`, `<`, `>`, `\`, `@`, `url(` or unbalanced quotes
or brackets. Images and fonts go in `icons`, `fonts` and `skin.css` instead.

### skin.css

Ordinary CSS for anything the tokens don't cover. iWeb puts it last on the page while the
theme is in use, and checks it when it's installed:

- `url()` may point at files in the package (relative paths), `#element-id`s, or small
  `data:` images. Anything else (another website, a missing file) removes that declaration.
- `@import` and `@namespace` are removed. `@media`, `@supports`, `@container`, `@layer`,
  `@font-face`, `@keyframes` and `@property` are fine.
- `expression()`, `javascript:`, `behavior`, `-moz-binding`, `image-set()` with plain
  strings, and CSS escapes (`\75`) outside strings remove the declaration.

After installing a theme from a file, iWeb says how many rules it left out, if any.

Style iWeb through the **surface hooks** below rather than internal class names, which can
change between versions. Two tips:

- **Window and panel backgrounds.** Glass surfaces keep their own background transparent so
  the glass shows. To give a surface a material, set `--glass-tint` (any CSS background,
  including a `url()` to an image in your package) and `--glass-tint-opacity` on it:
  ```css
  [data-iw="window"] { --glass-tint: url(textures/paper.jpg) center / 512px; --glass-tint-opacity: 0.9; }
  ```
- **Specificity.** Some of iWeb's own rules use `!important`. Use it too when a property
  doesn't take.

## Design tokens

Defined in [`src/styles/tokens.css`](../src/styles/tokens.css) with iWeb's own values. In
`tokens.json`, leave out the `--iw-` prefix.

| Token | Default | Used by |
|---|---|---|
| `font-ui` | SF Pro Display Semibold | All text, unless a rule picks another token |
| `font-medium` | SF Pro Display Medium | Settings, Markets, long labels |
| `font-bold` | SF Pro Display Bold | Headings |
| `font-rounded` | SF Rounded Semibold | Widgets, Notes, Control Center |
| `font-heavy` | SF Pro Display Heavy | The clock, large numbers |
| `font-system` | The system font | Long text (Notes body, tasks) |
| `font-mono` | The system monospace font | Code |
| `radius-window` | 24px | Settings, News, Atmosphere, Frontier, the Theme Store |
| `radius-window-compact` | 18px | Notes, Music, Markets |
| `radius-dialog` | 26px | Alerts and sheets |
| `radius-spotlight` | 28px | Spotlight |
| `radius-menu`, `radius-menu-item` | 12px, 6px | Menu bar, desktop and Dock menus |
| `light-close`, `light-minimize`, `light-zoom` | macOS red, yellow, green | Every window's buttons |
| `ease` | `cubic-bezier(0.32, 0.72, 0, 1)` | Windows and panels opening, zoom, the Scale effect |
| `ease-standard`, `ease-out`, `ease-in` | | Other transitions; `ease-in` for closing |
| `ease-spring`, `ease-spring-soft` | Small overshoots | Pops, widgets settling |

## Surface hooks

| Selector | Element |
|---|---|
| `[data-iw="menubar"]` | The menu bar |
| `[data-iw="menu"]` | Any menu (menu bar, desktop, widget) |
| `[data-iw="dock"]` | The Dock |
| `[data-iw="window"]`, `[data-iw-app="<app>"]` | An app window: `settings notes music markets news atmosphere frontier themes` |
| `[data-iw="dialog"]` | Alerts and sheets |
| `[data-iw="spotlight"]` | Spotlight |
| `[data-iw="control-center"]` | Control Center |
| `[data-iw="notification-center"]`, `[data-iw="notification"]` | Notification Center, one notification |
| `[data-iw="apps"]` | The Apps launcher |
| `[data-iw="widget"]`, `[data-iw="desktop-item"]` | A desktop widget, another desktop item (`data-desktop-item` holds its id) |
| `[data-iw="clock"]` | The clock |
| `html[data-theme="<id>"]` | Set while your theme is in use |
| `html[data-appearance="light"]` | Light appearance |

## Icon keys

| Key | Icon |
|---|---|
| `apps wallpaper notes music settings` | The Dock's built-in apps |
| `stocks` | Markets |
| `weather clock spotlight` | The Weather and Clock widgets in the gallery, Spotlight |
| `atmosphere frontier news themes` | Apps with a drawn icon |
| `settings-<pane>` | Settings panes without an app icon: `settings-appearance`, `settings-widgets`, `settings-bookmarks`, `settings-data-controls`, `settings-about` |

## Originality

Only publish what you made or may share: your own designs, and fonts, images and sounds
under licences that allow it. Themes that copy another product's or game's branding, art,
icons or fonts aren't accepted in the store.

## How the store works

The [themes repo](https://github.com/2k-Aakaash/iweb-themes) keeps each theme in
`themes/<id>/`. On every merge, its workflow:
1. checks each theme, zips it and computes its SHA-256;
2. publishes a release tagged `store` with `index.json`, the zips and the preview images.

iWeb reads that release, and refuses any download whose checksum doesn't match or whose
package isn't the theme and version the catalogue names.
