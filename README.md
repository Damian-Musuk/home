# Musuk (Home)

A small web app for learning music theory on guitar and piano, at https://damian-mus.uk.
Tap any chord to see it as guitar shapes, on a piano keyboard, or on a stave.

Songs (listening, chord sheets, karaoke) live in a separate app: https://songs.damian-mus.uk
(repo: https://github.com/Damian-Musuk/songs).

## The four tools

| Address | Tool |
| --- | --- |
| `/` | Chord chart: every chord type for a chosen root note |
| `/circle-of-fifths` | Circle of fifths with the chords of each key, tritone substitution and secondary dominants |
| `/modes` | The seven modes: their chords, key signature and borrowed chords |
| `/progressions` | Common chord progressions in any key |

Old addresses `/listen`, `/play` and `/perform` send visitors to the Songs site (`public/_redirects`, and in `src/App.tsx` for installed copies).

## Run it

```bash
npm install
npm run dev        # development
npm run build      # production build into dist/
npm run preview    # serve the production build
npm run lint
```

## Where things live

| Path | What |
| --- | --- |
| `src/App.tsx` | Header, navigation, the four routes and the chord panel |
| `src/styles/theme.css` | Colours and other design tokens, base styles, app shell |
| `src/tools/` | The four tools, the shared `NotePicker`, and their styles (`tools.css` is shared) |
| `src/chord/` | The chord panel: `ChordPanel` (works out a chord's notes), `GuitarShapes`, `PianoKeys`, `Stave`, `Inversions`, `ChordViewSwitch`, and `guitar-chords.json` |
| `src/sw.js` | Service worker template; the build fills in the file list so the app opens with no signal |
| `public/media/` | Piano note samples |
| `public/icons/`, `public/favicon.svg` | The teal plectrum icon |
| `sites/` | Unrelated, separately hosted projects kept here for reference; not part of this app |

## Deploying

Cloudflare builds and deploys the `home` Worker when `main` is pushed to
https://github.com/Damian-Musuk/home. `wrangler.jsonc` serves `dist/` as a single-page app.
