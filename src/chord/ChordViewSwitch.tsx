import { Guitar, Music, Piano, X } from 'lucide-react'

export type ChordView = 'guitar' | 'piano' | 'stave'

const views = [
  { id: 'guitar', label: 'Guitar', icon: Guitar },
  { id: 'piano', label: 'Piano', icon: Piano },
  { id: 'stave', label: 'Stave', icon: Music },
] as const

type Props = { view: ChordView; onChange: (view: ChordView) => void; onClose: () => void }

export default function ChordViewSwitch({ view, onChange, onClose }: Props) {
  return (
    <div className="chord-view-switch">
      {views.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={view === id ? 'selected' : ''}
          aria-pressed={view === id}
          aria-label={`Show on ${label.toLowerCase()}`}
          title={label}
          onClick={() => onChange(id)}
        >
          <Icon aria-hidden="true" />
        </button>
      ))}
      <button type="button" className="chord-close" onClick={onClose} aria-label="Close chord">
        <X aria-hidden="true" />
      </button>
    </div>
  )
}
