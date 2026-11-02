#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultDirectory = path.resolve(scriptDirectory, '../public/karaoke')
const [, , songTitle, ...options] = process.argv

if (!songTitle) {
  console.error('Usage: node scripts/merge-chordpro-lrc.mjs "Song Title" [--dir folder] [--output file]')
  process.exit(1)
}

function optionValue(name, fallback) {
  const index = options.indexOf(name)
  return index >= 0 && options[index + 1] ? options[index + 1] : fallback
}

function isChordToken(token) {
  return /^[A-G](?:#|b)?(?:(?:maj|min|m|M|dim|aug|sus\d*|add\d*|[#b]\d+|\d+|°|ø))*(?:\/[A-G](?:#|b)?)?\*?$/i.test(token)
}

function parseChordRow(line) {
  const matches = [...line.matchAll(/\S+/g)]
  if (!matches.length || !matches.every((match) => isChordToken(match[0]))) return null
  return matches.map((match) => ({ chord: match[0], column: match.index }))
}

function normalizeWords(text) {
  return text
    .replace(/\s*-\s*/g, '')
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? []
}

function wordSimilarity(left, right) {
  if (left === right) return 1
  if (left.length >= 3 && right.length >= 3 && (left.startsWith(right) || right.startsWith(left))) return 0.82
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0]
    previous[0] = row
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column]
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      )
      diagonal = above
    }
  }
  const distance = previous[right.length]
  return 1 - distance / Math.max(left.length, right.length)
}

function sequenceSimilarity(expected, actual) {
  if (!expected.length || !actual.length) return 0
  const rows = Array.from({ length: expected.length + 1 }, () => new Float32Array(actual.length + 1))
  for (let row = 1; row <= expected.length; row += 1) {
    for (let column = 1; column <= actual.length; column += 1) {
      rows[row][column] = Math.max(
        rows[row - 1][column],
        rows[row][column - 1],
        rows[row - 1][column - 1] + wordSimilarity(expected[row - 1], actual[column - 1]),
      )
    }
  }
  return rows[expected.length][actual.length] / Math.max(expected.length, actual.length)
}

function parseChordChart(source) {
  const pairs = []
  let pendingChords = null
  let section = 'Song'

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      pendingChords = null
      section = sectionMatch[1].trim()
      continue
    }
    if (/^[eBGDAE]\|/i.test(trimmed)) {
      pendingChords = null
      continue
    }
    if (trimmed.startsWith('(')) {
      pendingChords = null
      continue
    }

    const chordRow = parseChordRow(line)
    if (chordRow) {
      pendingChords = chordRow
      continue
    }
    if (pendingChords) {
      pairs.push({ section, chords: pendingChords, lyric: line })
      pendingChords = null
    }
  }

  return pairs
}

function cleanChordPro(text) {
  return text.replace(/\{([^{}]+)\}/g, (match, chord) => isChordToken(chord.trim()) ? '' : match)
}

function parseLrc(source) {
  const lines = source.split(/\r?\n/)
  const timeTagPattern = /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g
  const timedLines = []
  lines.forEach((raw, sourceIndex) => {
    if (!timeTagPattern.test(raw)) return
    timeTagPattern.lastIndex = 0
    const prefix = raw.match(/^(?:\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*)+/)?.[0] ?? ''
    const body = cleanChordPro(raw.slice(prefix.length))
    const trimmed = body.trim()
    if (!trimmed || /^\(([^)]+)\)$/.test(trimmed) || /^\[([^\]]+)\]$/.test(trimmed)) return
    timedLines.push({ sourceIndex, prefix, body, words: [...body.matchAll(/\S+/g)] })
  })
  return { lines, timedLines }
}

function bestLyricWindow(chartWords, timedLines, cursor, usedLines, searchAll = false) {
  let best = null
  const maxStart = searchAll ? timedLines.length - 1 : Math.min(timedLines.length - 1, cursor + 6)
  for (let start = cursor; start <= maxStart; start += 1) {
    for (let length = 1; length <= 3 && start + length <= timedLines.length; length += 1) {
      const window = timedLines.slice(start, start + length)
      if (window.some((line) => usedLines.has(line.sourceIndex))) continue
      const actualWords = window.flatMap((line) => normalizeWords(line.body))
      const score = sequenceSimilarity(chartWords, actualWords)
      if (!best || score > best.score) best = { start, length, score, window, actualWords }
    }
  }
  return best && best.score >= 0.38 ? best : null
}

function chartWordIndexAtColumn(lyric, column, words) {
  if (!words.length) return 0
  const word = words.findIndex((match) => column <= match.index + match[0].length)
  return word < 0 ? words.length : word
}

function addChordInsertions(pair, targetWindow, insertions) {
  const chartWords = [...pair.lyric.matchAll(/\S+/g)]
  const targetWords = targetWindow.flatMap((line) => line.words.map((match) => ({
    line,
    start: match.index,
    end: match.index + match[0].length,
    tokens: normalizeWords(match[0]),
  })))
  let lastTargetWord = 0

  for (const { chord, column } of pair.chords) {
    const chartIndex = chartWordIndexAtColumn(pair.lyric, column, chartWords)
    let targetWordIndex
    if (chartIndex >= chartWords.length) {
      targetWordIndex = targetWords.length
    } else {
      const wanted = normalizeWords(chartWords[chartIndex][0])[0]
      let matchIndex = -1
      for (let index = lastTargetWord; index < targetWords.length; index += 1) {
        if (targetWords[index].tokens.some((token) => wordSimilarity(wanted, token) >= 0.65)) {
          matchIndex = index
          break
        }
      }
      targetWordIndex = matchIndex >= 0
        ? matchIndex
        : Math.min(targetWords.length - 1, Math.round(chartIndex / Math.max(chartWords.length, 1) * targetWords.length))
      lastTargetWord = Math.max(lastTargetWord, targetWordIndex)
    }

    const target = targetWords[Math.min(targetWordIndex, targetWords.length - 1)]
    if (!target) continue
    const atLineEnd = targetWordIndex >= targetWords.length
    const position = atLineEnd ? target.end : target.start
    const lineInsertions = insertions.get(target.line.sourceIndex) ?? []
    lineInsertions.push({ position, chord, atLineEnd })
    insertions.set(target.line.sourceIndex, lineInsertions)
  }
}

function annotateLine(line, insertions) {
  const grouped = new Map()
  for (const insertion of insertions) {
    const group = grouped.get(insertion.position) ?? { chords: [], atLineEnd: insertion.atLineEnd }
    group.chords.push(insertion.chord)
    grouped.set(insertion.position, group)
  }
  let output = line.body
  for (const [position, group] of [...grouped.entries()].sort((left, right) => right[0] - left[0])) {
    const token = `${group.atLineEnd ? ' ' : ''}${group.chords.map((chord) => `{${chord}}`).join(' ')}`
    output = `${output.slice(0, position)}${token}${output.slice(position)}`
  }
  return `${line.prefix}${output}`
}

async function findFile(directory, title, extension) {
  const files = await (await import('node:fs/promises')).readdir(directory)
  const wanted = `${title}${extension}`.toLowerCase()
  const file = files.find((name) => name.toLowerCase() === wanted)
  if (!file) throw new Error(`Could not find ${title}${extension} in ${directory}`)
  return path.join(directory, file)
}

const directory = path.resolve(optionValue('--dir', defaultDirectory))
const chordPath = await findFile(directory, songTitle, '.chords')
const lrcPath = await findFile(directory, songTitle, '.lrc')
const outputPath = path.resolve(optionValue('--output', path.join(directory, `${songTitle}.chordpro.lrc`)))
if (outputPath === lrcPath || outputPath === chordPath) throw new Error('Output must be a separate file; source files are never overwritten.')

const [chordSource, lrcSource] = await Promise.all([readFile(chordPath, 'utf8'), readFile(lrcPath, 'utf8')])
const pairs = parseChordChart(chordSource)
const { lines, timedLines } = parseLrc(lrcSource)
const insertions = new Map()
let cursor = 0
let matched = 0
const unmatched = []
const usedLines = new Set()

for (const pair of pairs) {
  const chartWords = normalizeWords(pair.lyric)
  if (!chartWords.length || !pair.chords.length) continue
  let window = bestLyricWindow(chartWords, timedLines, cursor, usedLines)
  if (!window) window = bestLyricWindow(chartWords, timedLines, 0, usedLines, true)
  if (!window) {
    unmatched.push(`${pair.section}: ${pair.lyric.trim()}`)
    continue
  }
  addChordInsertions(pair, window.window, insertions)
  window.window.forEach((line) => usedLines.add(line.sourceIndex))
  matched += 1
  cursor = window.start + window.length
}

const output = lines.map((line, index) => insertions.has(index)
  ? annotateLine(timedLines.find((timedLine) => timedLine.sourceIndex === index), insertions.get(index))
  : line).join(lrcSource.includes('\r\n') ? '\r\n' : '\n')

await writeFile(outputPath, output, 'utf8')
console.log(`Generated ${outputPath}`)
console.log(`Matched ${matched} of ${pairs.length} chorded lyric lines; ${pairs.length - matched} could not be confidently matched.`)
if (unmatched.length) console.log(`Review these chart lines manually:\n${unmatched.map((line) => `  - ${line}`).join('\n')}`)
