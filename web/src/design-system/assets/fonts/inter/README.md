# Inter Variable font assets

These normal WOFF2 subsets and `wght.css` declarations are copied from
`@fontsource-variable/inter` 5.3.0 to match the Inter typeface used in the
supplied Orbit Figma system. The package and upstream font are licensed under
the SIL Open Font License 1.1; keep the included `LICENSE` with these assets.

The design-system foundation imports the declarations through Vite, which
emits content-hashed same-origin font assets. A configured Fastly service can
cache those public, versioned assets; this repository does not configure a
Fastly service or origin.
