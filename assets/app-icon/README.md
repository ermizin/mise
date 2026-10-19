# Mise app icon B

Variant B from the owner-provided `Mise meal prep app design.zip` is the approved, project-owned source. The HTML mockup is the geometry reference: its 240 px construction scales to every export; after 10 px side padding and a 9 px gap, the compartments are 75 px and 60 px (`1.25:1`). No third-party artwork is embedded.

Since the redesign C v2.2 palette (`REDESIGN_C_KIT.md` §4.2, §8; brand package 2026-10-19) the same geometry is drawn flat, cream on ink with a terracotta accent: ink `#2A1D14` canvas, cream `#FFF1E6` container, terracotta `#C9400D` and lid-tint `#FFD2B8` compartments, cream lid at 20 % opacity. The maskable export scales the mark to 80 % so it stays inside the 80 % safe circle; `badge-96.png` is a white container silhouette with cut-out compartments on transparency. The in-app boot splash (`app-boot-mark` in `app/page.tsx`) repeats this mark, and `public/brand/*.svg` carry the positive version (ink container on a transparent canvas).

Regenerate the committed PNG and SVG assets (web and native) from the repository root:

```bash
swift scripts/generate-app-icons.swift
swift scripts/generate-app-icons.swift --native --output apps/native/assets
```

`public/og-image.png` is not produced here: it is rendered from `assets/og-image/og-image.html` (real 390×844 screens of the redesign in `assets/og-image/screens/`) with `node scripts/render-og-image.mjs`, which records checksums and provenance in `assets/og-image/manifest.json`.
