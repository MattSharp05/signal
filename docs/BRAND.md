# Signal: Brand

## Logo concepts

| Concept | Idea | Simplicity | 16px legibility | Distinctiveness | Verdict |
|---|---|---|---|---|---|
| A · Ascent (`brand/concept-a-ascent.svg`) | Three dots of increasing size rising diagonally, like momentum building | High | Weak: the smallest dot disappears and the mark reads as a loading indicator | Low (generic "growth" motif) | Rejected |
| B · Echo (`brand/concept-b-echo.svg`) | A source point with two expanding arcs | High | Good | **Fails**: reads as the RSS/Wi-Fi icon, which the brief rules out | Rejected |
| **C · Aperture** (`brand/concept-c-aperture.svg`) | An open ring (the field being monitored) with a solid point emerging through its opening. A signal detected at the edge of the field. | High: one stroke, one dot | Strong: the ring and the separate dot both survive at 16px | High: not a radar, Wi-Fi or chart icon, and memorable without the wordmark | **Selected** |

**Why Aperture:** it combines detection (the ring) and emergence (the point leaving the ring). It holds up at favicon size, works as a single color, and is quiet enough to sit next to the interface without dominating it. Its geometry is a 24px grid with a 2.6px stroke, round caps, a 280° arc, and a 3px-radius dot on the 45° axis.

## Assets

- `public/logo-mark.svg`: cobalt mark
- `public/logo-mark-mono-light.svg` / `public/logo-mark-mono-dark.svg`: monochrome variants
- `public/favicon.svg`: adapts to dark browser chrome
- `src/components/brand/Logo.tsx`: `<LogoMark/>` (symbol only; `tone="brand" | "mono" | "inverse"`) and `<Logo/>` (symbol + "Signal" wordmark set in Inter Semibold)

The symbol is used alone for the favicon, the collapsed sidebar and compact placements. The symbol plus the name is used in the expanded sidebar and on the sign-in page.

## Modern Slate tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | #FFFFFF | Main background |
| `--sidebar` | #F8FAFC | Sidebar |
| `--surface` | #F1F5F9 | Secondary surfaces, hover |
| `--text` | #0F172A | Primary text |
| `--muted` | #64748B | Secondary text |
| `--border` | #E2E8F0 | Borders |
| `--accent` / `--accent-hover` | #2563EB / #1D4ED8 | Primary actions, links, logo |
| `--positive` | #15803D | Growth |
| `--negative` | #B91C1C | Decline |
| `--warning` | #B45309 | Estimates, unverified |

Type is Inter throughout, with `tabular-nums` for metrics. The radius is 6px for controls and 8px for cards. Motion is limited to 120–180ms ease-out, applied only to expand/collapse and panel transitions.
