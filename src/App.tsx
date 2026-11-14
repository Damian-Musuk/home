import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router'
import { CircleDot, ExternalLink, Guitar, ListMusic, Sparkles, type LucideIcon } from 'lucide-react'
import ChordChart from './tools/ChordChart'
import Progressions from './tools/Progressions'

// Anything that draws a stave pulls in the music-engraving library, so load those parts on first use.
const CircleOfFifths = lazy(() => import('./tools/CircleOfFifths'))
const Modes = lazy(() => import('./tools/Modes'))
const ChordPanel = lazy(() => import('./chord/ChordPanel'))

const SONGS_URL = 'https://songs.damian-mus.uk/'

const tools: Array<{ path: string; label: string; short: string; icon: LucideIcon }> = [
  { path: '/', label: 'Chords', short: 'Chords', icon: Guitar },
  { path: '/circle-of-fifths', label: 'Circle of Fifths', short: 'Circle', icon: CircleDot },
  { path: '/modes', label: 'Modes', short: 'Modes', icon: Sparkles },
  { path: '/progressions', label: 'Progressions', short: 'Progressions', icon: ListMusic },
]

export default function App() {
  const { pathname } = useLocation()
  // The open chord belongs to the page it was tapped on, so it closes when you move to another tool.
  const [selected, setSelected] = useState<{ chord: string; path: string } | null>(null)
  const chord = selected?.path === pathname ? selected.chord : null
  const selectChord = (name: string) => setSelected({ chord: name, path: pathname })

  useEffect(() => {
    const tool = tools.find((entry) => entry.path === pathname)
    document.title = tool && tool.path !== '/' ? `${tool.label} · Musuk` : 'Musuk · Music theory for guitar and piano'
  }, [pathname])

  return (
    <div className={`app${chord ? ' has-chord' : ''}`}>
      <header className="app-header">
        <NavLink to="/" className="brand" aria-label="Musuk home">
          <img src="/favicon.svg" alt="" />
          <span>
            <strong>Musuk</strong>
            <small>Music theory for guitar and piano</small>
          </span>
        </NavLink>
        <nav className="tool-nav" aria-label="Theory tools">
          {tools.map(({ path, label, short, icon: Icon }) => (
            <NavLink key={path} to={path} end className={({ isActive }) => `tool-link${isActive ? ' is-active' : ''}`}>
              <Icon aria-hidden="true" />
              <span className="tool-label-long">{label}</span>
              <span className="tool-label-short">{short}</span>
            </NavLink>
          ))}
        </nav>
        <a className="songs-link" href={SONGS_URL}>
          Songs <ExternalLink aria-hidden="true" />
        </a>
      </header>

      <main>
        <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<ChordChart onChordSelect={selectChord} />} />
          <Route path="/circle-of-fifths" element={<CircleOfFifths onChordSelect={selectChord} />} />
          <Route path="/modes" element={<Modes onChordSelect={selectChord} />} />
          <Route path="/progressions" element={<Progressions onChordSelect={selectChord} />} />
          {/* Old addresses: the song sections moved to the Songs site. */}
          {['/listen', '/play', '/perform'].map((path) => (
            <Route key={path} path={path} element={<LeaveTo url={SONGS_URL} />} />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </main>

      {chord && (
        <aside className="selected-chord" aria-label={`Chord: ${chord}`}>
          <Suspense fallback={null}>
            <ChordPanel chord={chord} onClose={() => setSelected(null)} />
          </Suspense>
        </aside>
      )}
    </div>
  )
}

function LeaveTo({ url }: { url: string }) {
  useEffect(() => { window.location.replace(url) }, [url])
  return <p className="leaving">Taking you to <a href={url}>Songs</a>…</p>
}
