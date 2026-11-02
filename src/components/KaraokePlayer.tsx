import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { AudioLines, Drum, Guitar, Mic2, Pause, Play, RefreshCw, RotateCcw, RotateCw, X, type LucideIcon } from 'lucide-react'
import './KaraokePlayer.css'

type LyricSegment = { text: string; chord?: string }
type LyricLine = { time: number; text: string; section?: boolean; segments?: LyricSegment[] }
type StemTrack = { id: string; label: string; src: string; icon: LucideIcon }
type StemCandidate = Omit<StemTrack, 'src'> & { sources: string[] }
type KaraokeSong = { id: string; title: string; audio: string; lyrics: string; image?: string; stems: StemCandidate[] }

const stemTypes = [
  { id: 'vocal', suffixes: ['vocal.ogg', 'vocals.ogg', 'vocals.mp3'], label: 'Vocals', icon: Mic2 },
  { id: 'backing-vocals', suffixes: ['backing_vocals.ogg'], label: 'Backing Vocals', icon: Mic2 },
  { id: 'drums', suffixes: ['drums.ogg'], label: 'Drums', icon: Drum },
  { id: 'bass', suffixes: ['bass.ogg'], label: 'Bass', icon: Guitar },
  { id: 'guitar', suffixes: ['guitar.ogg'], label: 'Guitar', icon: Guitar },
  { id: 'keyboard', suffixes: ['keyboard.ogg'], label: 'Keyboard', icon: AudioLines },
  { id: 'other', suffixes: ['other.ogg'], label: 'Other', icon: AudioLines },
] as const

function stemCandidatesFor(songTitle: string): StemCandidate[] {
  return stemTypes.map(({ id, suffixes, label, icon }) => ({
    id,
    label,
    sources: suffixes.map((suffix) => `/karaoke/${songTitle}_${suffix}`),
    icon,
  }))
}

const fallbackSongTitles = ['Baby Can I Hold You', 'On and On']
const fallbackSongs: KaraokeSong[] = fallbackSongTitles.map((title) => ({
  id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  title,
  audio: `/karaoke/${title}.mp3`,
  lyrics: `/karaoke/${title}.lrc`,
  stems: stemCandidatesFor(title),
}))

function parseLrc(source: string): LyricLine[] {
  const lines: LyricLine[] = []
  const timestampPattern = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g

  for (const rawLine of source.split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(timestampPattern)]
    let text = rawLine.replace(timestampPattern, '').trim()
      .replace(/^\uFEFF/, '')
      .replace(/\[(?:ar|ti|al|length|by|re|ve|offset):[^\]]*\]/gi, '')
      .trim()
    if (!text) continue
    const quotedChordProLine = text.match(/^(\s*(?:\{[^}]+\}\s*)*)["“](.*)["”](\s*(?:\{[^}]+\}\s*)*)$/)
    if (quotedChordProLine) text = `${quotedChordProLine[1]}${quotedChordProLine[2]}${quotedChordProLine[3]}`
    else text = text.replace(/^["“”](.*)["“”]$/, '$1')
    const { text: lyricText, segments } = parseChordProText(text)
    const sectionText = lyricText.match(/^\(([^)]+)\)$/) ?? lyricText.match(/^\[([^\]]+)\]$/)
    const section = Boolean(sectionText && /^(?:intro|verse(?:\s+\d+)?|chorus(?:\s+\d+)?|pre-chorus|post-chorus|bridge|outro|interlude|instrumental|end)$/i.test(sectionText[1].trim()))

    for (const match of matches) {
      const fraction = match[3] ?? '0'
      const milliseconds = Number(fraction.padEnd(3, '0').slice(0, 3))
      lines.push({
        time: Number(match[1]) * 60 + Number(match[2]) + milliseconds / 1000,
        text: lyricText,
        section,
        segments,
      })
    }
  }

  return lines.sort((a, b) => a.time - b.time)
}

function isChordToken(token: string) {
  return /^[A-G](?:#|b)?(?:m|maj|min|dim|aug|sus\d*|add\d*|M|°|ø|\d)*(?:\/[A-G](?:#|b)?)?$/i.test(token)
}

function parseChordProText(source: string): { text: string; segments: LyricSegment[] } {
  const segments: LyricSegment[] = []
  const tokenPattern = /\{([^{}]+)\}/g
  let cursor = 0
  let pendingChord: string | undefined
  let match: RegExpExecArray | null

  while ((match = tokenPattern.exec(source))) {
    const chord = match[1].trim()
    if (!isChordToken(chord)) continue
    const precedingText = source.slice(cursor, match.index)
    if (pendingChord) segments.push({ chord: pendingChord, text: precedingText })
    else if (precedingText) segments.push({ text: precedingText })
    pendingChord = chord
    cursor = match.index + match[0].length
  }

  const remainingText = source.slice(cursor)
  if (pendingChord) segments.push({ chord: pendingChord, text: remainingText })
  else if (remainingText) segments.push({ text: remainingText })

  const text = segments.map((segment) => segment.text).join('')
  return { text: text || source, segments: segments.some((segment) => segment.chord) ? segments : [{ text: source }] }
}

function estimateTempo(buffer: AudioBuffer) {
  const frameSize = 1024
  const frameCount = Math.floor(buffer.length / frameSize)
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))
  const energy = new Float32Array(frameCount)
  let previousRms = 0
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0
    const start = frame * frameSize
    for (let sample = start; sample < start + frameSize; sample += 1) {
      for (const channel of channels) sum += channel[sample] * channel[sample]
    }
    const rms = Math.sqrt(sum / (frameSize * channels.length))
    energy[frame] = Math.max(0, rms - previousRms)
    previousRms = rms
  }

  const framesPerSecond = buffer.sampleRate / frameSize
  let bestLag = 0
  let bestScore = -Infinity
  for (let bpm = 60; bpm <= 180; bpm += 1) {
    const lag = Math.round(framesPerSecond * 60 / bpm)
    let correlation = 0
    let leftEnergy = 0
    let rightEnergy = 0
    for (let frame = lag; frame < frameCount; frame += 1) {
      const left = energy[frame]
      const right = energy[frame - lag]
      correlation += left * right
      leftEnergy += left * left
      rightEnergy += right * right
    }
    const score = correlation / Math.sqrt(leftEnergy * rightEnergy || 1)
    if (score > bestScore) { bestScore = score; bestLag = lag }
  }
  if (!bestLag) return null

  let bestPhase = 0
  let bestPhaseScore = -Infinity
  for (let phase = 0; phase < bestLag; phase += 1) {
    let score = 0
    for (let frame = phase; frame < frameCount; frame += bestLag) score += energy[frame]
    if (score > bestPhaseScore) { bestPhaseScore = score; bestPhase = phase }
  }
  return {
    bpm: Math.round(framesPerSecond * 60 / bestLag),
    beatOffset: bestPhase / framesPerSecond,
  }
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${remainder}`
}

export default function KaraokePlayer() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const stemBuffersRef = useRef<Record<string, AudioBuffer>>({})
  const stemSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const mixClockRef = useRef({ startedAt: 0, offset: 0 })
  const animationRef = useRef<number | null>(null)
  const switchingMixRef = useRef(false)
  const lyricsWindowRef = useRef<HTMLDivElement>(null)
  const activeLineRef = useRef<HTMLButtonElement>(null)
  const coverTriggerRef = useRef<HTMLButtonElement>(null)
  const [karaokeSongs, setKaraokeSongs] = useState<KaraokeSong[]>(fallbackSongs)
  const [selectedSongId, setSelectedSongId] = useState(fallbackSongs[0].id)
  const selectedSong = karaokeSongs.find((song) => song.id === selectedSongId) ?? karaokeSongs[0]
  const [lrcText, setLrcText] = useState('')
  const [tempo, setTempo] = useState<{ bpm: number; beatOffset: number } | null>(null)
  const [loadError, setLoadError] = useState('')
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackFinished, setPlaybackFinished] = useState(false)
  const [availableStems, setAvailableStems] = useState<StemTrack[]>([])
  const [enabledStems, setEnabledStems] = useState<string[]>([])
  const [mixTime, setMixTime] = useState(0)
  const [lyricsReloadKey, setLyricsReloadKey] = useState(0)
  const [isCoverOpen, setIsCoverOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/karaoke/songs.json', { signal: controller.signal, cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('Song catalog is not available.')
        return response.json() as Promise<Array<Omit<KaraokeSong, 'stems'>>>
      })
      .then((songs) => {
        if (!songs.length) return
        const discoveredSongs = songs.map((song) => ({ ...song, stems: stemCandidatesFor(song.title) }))
        setKaraokeSongs(discoveredSongs)
        setSelectedSongId((currentId) => discoveredSongs.some((song) => song.id === currentId) ? currentId : discoveredSongs[0].id)
      })
      .catch(() => { /* Use the built-in songs if the catalog endpoint is unavailable. */ })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!isCoverOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsCoverOpen(false)
        coverTriggerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [isCoverOpen])

  const isOriginalMix = Boolean(selectedSong.audio) && enabledStems.length === availableStems.length
  const getMixTime = () => {
    const context = audioContextRef.current
    if (!isOriginalMix) {
      if (isPlaying && context) return mixClockRef.current.offset + Math.max(0, context.currentTime - mixClockRef.current.startedAt)
      return currentTime
    }
    return audioRef.current?.currentTime ?? currentTime
  }

  const stopStemSources = (savePosition = true) => {
    const context = audioContextRef.current
    if (savePosition && context && stemSourcesRef.current.length) {
      const time = mixClockRef.current.offset + Math.max(0, context.currentTime - mixClockRef.current.startedAt)
      setMixTime(time)
      setCurrentTime(time)
    }
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current)
    animationRef.current = null
    stemSourcesRef.current.forEach((source) => {
      source.onended = null
      try { source.stop() } catch { /* A source may already have ended. */ }
    })
    stemSourcesRef.current = []
  }

  const chooseSong = (songId: string) => {
    setIsCoverOpen(false)
    stopStemSources(false)
    audioRef.current?.pause()
    setIsPlaying(false)
    setSelectedSongId(songId)
  }

  const playStemMix = async (offset: number) => {
    if (!availableStems.length) return
    const context = audioContextRef.current ?? new AudioContext()
    audioContextRef.current = context
    await context.resume()
    const stems = availableStems.filter((stem) => enabledStems.includes(stem.id))
    const buffers = await Promise.all(stems.map(async (stem) => {
      if (stemBuffersRef.current[stem.src]) return stemBuffersRef.current[stem.src]
      const response = await fetch(stem.src)
      if (!response.ok) throw new Error(`Could not load the ${stem.label.toLowerCase()} track.`)
      const buffer = await context.decodeAudioData(await response.arrayBuffer())
      stemBuffersRef.current[stem.src] = buffer
      return buffer
    }))
    if (!buffers.length) return
    setDuration(Math.min(...buffers.map((buffer) => buffer.duration)))
    stopStemSources(false)
    const startAt = context.currentTime + 0.08
    const sources = buffers.map((buffer) => {
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      source.start(startAt, Math.min(offset, Math.max(0, buffer.duration - 0.01)))
      return source
    })
    mixClockRef.current = { startedAt: startAt, offset }
    stemSourcesRef.current = sources
    const tick = () => {
      const time = mixClockRef.current.offset + Math.max(0, context.currentTime - mixClockRef.current.startedAt)
      setCurrentTime(time)
      if (time >= Math.min(...buffers.map((buffer) => buffer.duration))) {
        stopStemSources(false)
        setMixTime(0)
        setCurrentTime(0)
        setIsPlaying(false)
        setPlaybackFinished(true)
        return
      }
      animationRef.current = requestAnimationFrame(tick)
    }
    animationRef.current = requestAnimationFrame(tick)
  }

  useEffect(() => {
    stopStemSources(false)
    audioRef.current?.pause()
    audioRef.current?.load()
    setAvailableStems([])
    setEnabledStems([])
    setMixTime(0)
    setCurrentTime(0)
    setDuration(0)
    setIsPlaying(false)
    setPlaybackFinished(false)
    const controller = new AbortController()
    Promise.all(selectedSong.stems.map(async (candidate) => {
      for (const src of candidate.sources) {
        try {
          const response = await fetch(src, { method: 'HEAD', signal: controller.signal })
          const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
          const isSupportedAudio = contentType.includes('audio/ogg') || contentType.includes('application/ogg') || contentType.includes('audio/mpeg')
          if (response.ok && isSupportedAudio) return { id: candidate.id, label: candidate.label, icon: candidate.icon, src }
        } catch {
          if (controller.signal.aborted) return null
        }
      }
      return null
    })).then((results) => {
      if (controller.signal.aborted) return
      const found = results.filter((stem): stem is StemTrack => Boolean(stem))
      setAvailableStems(found)
      setEnabledStems(found.map((stem) => stem.id))
    })
    return () => controller.abort()
  }, [selectedSong.id])

  useEffect(() => {
    switchingMixRef.current = false
    if (isOriginalMix) {
      if (audioRef.current) {
        audioRef.current.currentTime = mixTime
        if (isPlaying) void audioRef.current.play().catch(() => setLoadError('Could not play the selected audio tracks.'))
      }
    } else if (isPlaying && availableStems.length) {
      void playStemMix(mixTime).catch((error: Error) => setLoadError(error.message))
    }
  }, [availableStems, enabledStems, selectedSong.id])

  useEffect(() => {
    const controller = new AbortController()
    setLrcText('')
    setLoadError('')
    setCurrentTime(0)
    setDuration(0)
    setIsPlaying(false)
    setPlaybackFinished(false)
    audioRef.current?.pause()
    fetch(`${selectedSong.lyrics}?refresh=${lyricsReloadKey}`, { signal: controller.signal, cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('Could not load the LRC lyrics file.')
        return response.text()
      })
      .then(setLrcText)
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setLoadError(error.message)
      })
    return () => controller.abort()
  }, [selectedSong.lyrics, lyricsReloadKey])

  useEffect(() => {
    const controller = new AbortController()
    setTempo(null)
    if (!selectedSong.audio) return () => controller.abort()
    fetch(selectedSong.audio, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Could not analyze audio')
        return response.arrayBuffer()
      })
      .then(async (data) => {
        const context = audioContextRef.current ?? new AudioContext()
        audioContextRef.current = context
        const estimate = estimateTempo(await context.decodeAudioData(data))
        if (!controller.signal.aborted) setTempo(estimate)
      })
      .catch(() => { if (!controller.signal.aborted) setTempo(null) })
    return () => controller.abort()
  }, [selectedSong.audio])

  const lines = useMemo(() => parseLrc(lrcText), [lrcText])
  const sections = useMemo(() => lines.filter((line) => line.section), [lines])
  const activeSectionIndex = useMemo(() => {
    if (playbackFinished) return -1
    let active = -1
    for (let index = 0; index < sections.length; index += 1) {
      if (sections[index].time > currentTime) break
      active = index
    }
    return active
  }, [currentTime, playbackFinished, sections])
  const activeIndex = useMemo(() => {
    let low = 0
    let high = lines.length - 1
    let found = -1
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      if (lines[middle].time <= currentTime) {
        found = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    return found
  }, [currentTime, lines])
  const beatStepIndex = useMemo(() => {
    if (playbackFinished || !tempo || currentTime < tempo.beatOffset) return -1
    const beatLength = 60 / tempo.bpm
    return Math.floor((currentTime - tempo.beatOffset) / (beatLength / 2)) % 8
  }, [currentTime, playbackFinished, tempo])

  useEffect(() => {
    const activeLine = activeLineRef.current
    const lyricsWindow = activeLine?.parentElement
    if (!activeLine || !lyricsWindow) return
    if (activeIndex <= 0) {
      lyricsWindow.scrollTop = 0
      return
    }
    const lineTop = activeLine.getBoundingClientRect().top - lyricsWindow.getBoundingClientRect().top
    const lineBottom = lineTop + activeLine.offsetHeight
    // Let the song open at its first sung word. Only scroll once the active
    // lyric approaches the lower part of the window, leaving upcoming lines visible.
    if (lineBottom < lyricsWindow.clientHeight * 0.68) return
    const targetTop = lyricsWindow.scrollTop + lineTop - lyricsWindow.clientHeight * 0.36
    lyricsWindow.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
  }, [activeIndex])

  useEffect(() => {
    if (lyricsWindowRef.current) lyricsWindowRef.current.scrollTop = 0
  }, [selectedSong.id])

  const togglePlayback = async () => {
    if (isOriginalMix) {
      if (!audioRef.current) return
      if (audioRef.current.paused) await audioRef.current.play()
      else audioRef.current.pause()
      return
    }
    if (!isPlaying) {
      try {
        await playStemMix(currentTime)
        setMixTime(currentTime)
        setPlaybackFinished(false)
        setIsPlaying(true)
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : 'Could not play the selected audio tracks.')
      }
    } else {
      stopStemSources()
      setIsPlaying(false)
    }
  }

  const seekBy = (seconds: number) => {
    const time = Math.max(0, Math.min(duration, getMixTime() + seconds))
    seekTo(time)
  }

  const seekTo = (time: number) => {
    setPlaybackFinished(false)
    if (isOriginalMix) {
      if (audioRef.current) audioRef.current.currentTime = time
    } else {
      const wasPlaying = isPlaying
      stopStemSources(false)
      setMixTime(time)
      setCurrentTime(time)
      if (wasPlaying) void playStemMix(time).catch((error: Error) => setLoadError(error.message))
    }
  }

  const playFromLyric = (time: number) => {
    seekTo(time)
    if (isPlaying) return
    if (isOriginalMix) {
      void audioRef.current?.play().catch(() => setLoadError('Could not play the selected audio track.'))
    } else {
      setMixTime(time)
      void playStemMix(time)
        .then(() => setIsPlaying(true))
        .catch((error: Error) => setLoadError(error.message))
    }
  }

  const toggleStem = (stemId: string) => {
    if (enabledStems.includes(stemId) && enabledStems.length === 1) return
    const time = getMixTime()
    switchingMixRef.current = true
    if (isOriginalMix) audioRef.current?.pause()
    else stopStemSources(false)
    setMixTime(time)
    setCurrentTime(time)
    setEnabledStems((current) => current.includes(stemId) ? current.filter((id) => id !== stemId) : [...current, stemId])
  }

  return (
    <section className="music-container karaoke-page" aria-labelledby="perform-heading">
      <header className="karaoke-heading">
        <div>
          <p className="music-eyebrow">PERFORM</p>
          <h2 id="perform-heading">Karaoke</h2>
          <div className="karaoke-song-picker">
            <span>Choose a song</span>
            <div className="karaoke-song-picker-row">
              <select aria-label="Choose a song" value={selectedSongId} onChange={(event) => chooseSong(event.target.value)}>
                {karaokeSongs.map((song) => <option key={song.id} value={song.id}>{song.title}</option>)}
              </select>
              <button className="karaoke-refresh" type="button" onClick={() => setLyricsReloadKey((key) => key + 1)} aria-label="Refresh lyrics" title="Reload lyrics from disk">
                <RefreshCw aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
        <p className="karaoke-count">{karaokeSongs.length} {karaokeSongs.length === 1 ? 'song' : 'songs'}</p>
      </header>

      {availableStems.length > 0 && <fieldset className="karaoke-stems">
        <legend>Backing tracks <span>{isOriginalMix ? 'Original mix' : 'Custom mix'}</span></legend>
        <div className="karaoke-stem-list">
          {availableStems.map(({ id, label, icon: Icon }) => <label className="karaoke-stem" key={id}>
            <input type="checkbox" checked={enabledStems.includes(id)} onChange={() => toggleStem(id)} />
            <Icon aria-hidden="true" /><span>{label}</span>
          </label>)}
        </div>
      </fieldset>}

      <div className="karaoke-stage" aria-live="off">
        {loadError ? (
          <p className="karaoke-status" role="alert">{loadError}</p>
        ) : lines.length === 0 ? (
          <p className="karaoke-status">Loading timed lyrics…</p>
        ) : (
          <div className="karaoke-lyrics" aria-label="Timed lyrics" ref={lyricsWindowRef}>
            {lines.map((line, index) => (
              <button
                className={`karaoke-line${line.section ? ' is-section' : ''}${line.segments?.some((segment) => segment.chord) ? ' has-chords' : ''}${index === activeIndex ? ' is-active' : ''}${index < activeIndex ? ' is-past' : ''}`}
                key={`${line.time}-${index}`}
                type="button"
                onClick={() => playFromLyric(line.time)}
                ref={index === activeIndex ? activeLineRef : undefined}
                aria-current={index === activeIndex ? 'true' : undefined}
                title={`Seek to ${formatTime(line.time)}`}
              >
                {line.segments?.some((segment) => segment.chord) ? line.segments.map((segment, segmentIndex) => <Fragment key={segmentIndex}>
                  {segment.chord && <span className="karaoke-inline-chord"><span>{segment.chord}</span></span>}
                  {segment.text}
                </Fragment>) : line.section ? line.text.replace(/^[([]|[)\]]$/g, '') : line.text}
              </button>
            ))}
            <div className="karaoke-lyric-tail" aria-hidden="true" />
          </div>
        )}
      </div>

      {sections.length > 0 && <fieldset className="karaoke-sections">
        <legend>Sections</legend>
        <div className="karaoke-section-list" aria-label="Jump to song section">
          {sections.map((section, index) => <button
            key={`${section.time}-${index}`}
            type="button"
            className={index === activeSectionIndex ? 'is-active' : ''}
            aria-current={index === activeSectionIndex ? 'true' : undefined}
            onClick={() => playFromLyric(section.time)}
          >{section.text.replace(/^[([]|[)\]]$/g, '')}</button>)}
        </div>
      </fieldset>}

      {tempo && <fieldset className="karaoke-beats" aria-label={`Beat bar, estimated ${tempo.bpm} beats per minute`}>
        <legend>Beat bar <span>Estimated {tempo.bpm} BPM</span></legend>
        <div className="karaoke-beat-track">
          {['1', '&', '2', '&', '3', '&', '4', '&'].map((beat, index) => <span
            key={`${beat}-${index}`}
            className={`karaoke-beat${index === beatStepIndex ? ` is-active${index % 2 === 1 ? ' is-subbeat' : ''}` : ''}`}
            aria-current={index === beatStepIndex ? 'step' : undefined}
          >{beat}</span>)}
        </div>
      </fieldset>}

      <div className={`karaoke-controls${selectedSong.image ? ' has-cover' : ''}`}>
        {selectedSong.image && <button
          ref={coverTriggerRef}
          className="karaoke-cover-trigger"
          type="button"
          onClick={() => setIsCoverOpen(true)}
          aria-label={`Enlarge ${selectedSong.title} cover`}
        ><img className="karaoke-cover" src={selectedSong.image} alt="" /></button>}
        <div className="karaoke-transport">
          <button type="button" className="karaoke-skip" onClick={() => seekBy(-5)} aria-label="Back 5 seconds"><RotateCcw /><span>5</span></button>
          <button type="button" className="karaoke-play" onClick={togglePlayback} aria-label={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
          </button>
          <button type="button" className="karaoke-skip" onClick={() => seekBy(5)} aria-label="Forward 5 seconds"><RotateCw /><span>5</span></button>
        </div>
        <div className="karaoke-timeline">
          <span>{formatTime(currentTime)}</span>
          <input
            type="range"
            min="0"
            max={duration || 1}
            step="0.1"
            value={Math.min(currentTime, duration || 0)}
            onChange={(event) => seekTo(Number(event.target.value))}
            aria-label="Seek through the song"
          />
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <audio
        ref={audioRef}
        src={selectedSong.audio || undefined}
        preload="metadata"
        onTimeUpdate={(event) => { if (isOriginalMix) setCurrentTime(event.currentTarget.currentTime) }}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onPlay={() => { if (isOriginalMix) { setPlaybackFinished(false); setIsPlaying(true) } }}
        onPause={() => { if (isOriginalMix && !switchingMixRef.current) setIsPlaying(false) }}
        onEnded={() => { setIsPlaying(false); setPlaybackFinished(true) }}
        onError={() => setLoadError('Could not load the karaoke MP3.')}
      />

      {isCoverOpen && selectedSong.image && <div className="karaoke-cover-backdrop" onClick={() => { setIsCoverOpen(false); coverTriggerRef.current?.focus() }}>
        <div className="karaoke-cover-dialog" role="dialog" aria-modal="true" aria-label={`${selectedSong.title} cover art`} onClick={(event) => event.stopPropagation()}>
          <button className="karaoke-cover-close" type="button" onClick={() => { setIsCoverOpen(false); coverTriggerRef.current?.focus() }} aria-label="Close cover image">
            <X aria-hidden="true" />
          </button>
          <img src={selectedSong.image} alt={`${selectedSong.title} cover`} />
        </div>
      </div>}
    </section>
  )
}
