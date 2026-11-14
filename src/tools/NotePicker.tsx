const blackNotes = [
  { note: 'C#', flat: 'Db' },
  { note: 'D#', flat: 'Eb' },
  null, // the gap between E and F
  { note: 'F#', flat: 'Gb' },
  { note: 'G#', flat: 'Ab' },
  { note: 'A#', flat: 'Bb' },
] as const
const whiteNotes = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

/** Twelve root notes laid out like one octave of a keyboard. */
export default function NotePicker({ value, onChange }: { value: string; onChange: (note: string) => void }) {
  return (
    <div className="note-picker" role="group" aria-label="Root note">
      <div className="note-row is-black">
        {blackNotes.map((entry, index) => entry ? (
          <button
            key={entry.note}
            type="button"
            className={`black-note${value === entry.note ? ' selected-note' : ''}`}
            aria-pressed={value === entry.note}
            onClick={() => onChange(entry.note)}
          >
            <b>{entry.note}</b> <span>{entry.flat}</span>
          </button>
        ) : <span key={index} className="note-gap" aria-hidden="true" />)}
      </div>
      <div className="note-row">
        {whiteNotes.map((note) => (
          <button
            key={note}
            type="button"
            className={`white-note${value === note ? ' selected-note' : ''}`}
            aria-pressed={value === note}
            onClick={() => onChange(note)}
          >
            {note}
          </button>
        ))}
      </div>
    </div>
  )
}
