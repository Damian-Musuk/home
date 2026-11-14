import React, { useState } from 'react';
import './tools.css';
import NotePicker from './NotePicker';


interface ChartProps {
  onChordSelect: (chord: string) => void;
}

const Chart: React.FC<ChartProps> = ({ onChordSelect }) => {
  const [rootNote, setRootNote] = useState('C');


  const groupedChordSuffixes: { group: string, chords: { label: string, suffix: string }[] }[] = [
    {
      group: 'Basic Triads',
      chords: [
        { label: '', suffix: '' },
        { label: 'm', suffix: 'm' },
        { label: '° (Dim)', suffix: 'dim' },
        { label: '+ (Aug)', suffix: 'aug' }
      ]
    },
    {
      group: 'Suspended',
      chords: [
        { label: 'sus2', suffix: 'sus2' },
        { label: 'sus4', suffix: 'sus4' }
      ]
    },
    {
      group: 'Sevenths',
      chords: [
        { label: '7', suffix: '7' },
        { label: 'maj7', suffix: 'maj7' },
        { label: 'm7', suffix: 'm7' },
        { label: 'm7♭5 (ø)', suffix: 'm7b5' },
        { label: '°7', suffix: 'dim7' }
      ]
    },
    {
      group: 'Extensions',
      chords: [
        { label: '9', suffix: '9' },
        { label: 'maj9', suffix: 'maj9' },
        { label: 'm9', suffix: 'm9' },
        { label: '11', suffix: '11' },
        { label: '13', suffix: '13' },
        { label: 'maj13', suffix: 'maj13' },
        { label: 'm11', suffix: 'm11' }
      ]
    },
    {
      group: 'Altered Dominants',
      chords: [
        { label: 'aug7 (7♯5)', suffix: 'aug7' },
        { label: '7♭5', suffix: '7b5' },
        { label: '7♯9', suffix: '7#9' },
        { label: '7♭9', suffix: '7b9' }
      ]
    },
    {
      group: 'Added Tone',
      chords: [
        { label: 'add9', suffix: 'add9' },
        { label: '5', suffix: '5' }
      ]
    }
  ];

  const handleNote = (note: string) => {
    setRootNote(note);
    onChordSelect(note); // Play basic note or chord with no suffix
  };

  return (
    <section className="tool" aria-labelledby="tool-heading">
      <div className="tool-heading">
        <div>
          <h2 id="tool-heading">Chord Chart</h2>
        </div>

      </div>




      <NotePicker value={rootNote} onChange={handleNote} />

      {/* Chord Types */}
      <div className="chord-types">
        {groupedChordSuffixes.map(({ group, chords }) => (
          <fieldset key={group} className="chord-group">
            <legend className="chord-group-title">{group}</legend>
            <div className="chord-group-buttons">
              {chords.map(({ label, suffix }) => {
                const chordName = rootNote + suffix;
                return (
                  <button
                    key={suffix}
                    className="chord-type"
                    onClick={() => onChordSelect(chordName)}
                  >
                    {rootNote}{label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </section>
  );
};

export default Chart;