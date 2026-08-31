# Mise app icon B

The accepted source is variant B in the owner-provided design package
`Mise meal prep app design.zip`, documented by `design_handoff_batch5/ICON.md`
and `Mise App Icon.dc.html`.

The HTML mockup is the geometry source of truth. Its 240 px construction scales
to every export. This resolves a typo in the handoff table: after 10 px side
padding and a 9 px gap, the two compartments are 75 px and 60 px (1.25:1),
equivalent to about 320 px and 256 px on a 1024 px canvas, not 349 px and 279 px.

`scripts/generate-app-icons.swift` produces the committed PNG and SVG assets.
The artwork is project-owned, supplied by the product owner, and approved for
Mise release use. No third-party visual assets are embedded.

Regenerate from the repository root:

```sh
swift scripts/generate-app-icons.swift
```
