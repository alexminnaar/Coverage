import { useRef } from 'react';
import { Plus } from 'lucide-react';
import { Beat } from '../types';
import BeatCard from './BeatCard';

interface BeatColumnProps {
  title: string;
  actIndex: number;
  beats: Beat[];
  selectedBeatId: string | null;
  onSelectBeat: (id: string) => void;
  onUpdateBeat: (id: string, updates: Partial<Beat>) => void;
  onDeleteBeat: (id: string) => void;
  onAddBeat: () => void;
  onMoveBeat: (beatId: string, targetActIndex: number, targetOrder: number) => void;
  getLinkedSceneName: (sceneId?: string) => string | undefined;
  draggedBeatId: string | null;
  setDraggedBeatId: (id: string | null) => void;
}

export default function BeatColumn({
  title,
  actIndex,
  beats,
  selectedBeatId,
  onSelectBeat,
  onUpdateBeat,
  onDeleteBeat,
  onAddBeat,
  onMoveBeat,
  getLinkedSceneName,
  draggedBeatId,
  setDraggedBeatId,
}: BeatColumnProps) {
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (dropZoneRef.current) {
      dropZoneRef.current.classList.add('drag-over');
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    const rect = dropZoneRef.current?.getBoundingClientRect();
    if (rect) {
      const { clientX, clientY } = e;
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        dropZoneRef.current?.classList.remove('drag-over');
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dropZoneRef.current?.classList.remove('drag-over');
    
    if (draggedBeatId) {
      const dropY = e.clientY;
      let targetOrder = beats.length;
      
      const cards = dropZoneRef.current?.querySelectorAll('.beat-card');
      if (cards) {
        for (let i = 0; i < cards.length; i++) {
          const rect = cards[i].getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          if (dropY < midY) {
            targetOrder = i;
            break;
          }
        }
      }
      
      onMoveBeat(draggedBeatId, actIndex, targetOrder);
    }
  };

  const handleCardDragStart = (e: React.DragEvent, beatId: string) => {
    setDraggedBeatId(beatId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', beatId);
    setTimeout(() => {
      (e.target as HTMLElement).classList.add('dragging');
    }, 0);
  };

  const handleCardDragEnd = (e: React.DragEvent) => {
    (e.target as HTMLElement).classList.remove('dragging');
    setDraggedBeatId(null);
  };

  const sortedBeats = [...beats].sort((a, b) => a.order - b.order);

  return (
    <div className="beat-column">
      <div className="beat-column-header">
        <h3>{title}</h3>
        <span className="beat-count">{beats.length}</span>
      </div>
      
      <div
        ref={dropZoneRef}
        className="beat-column-content"
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {sortedBeats.map((beat) => (
          <BeatCard
            key={beat.id}
            beat={beat}
            isSelected={selectedBeatId === beat.id}
            onSelect={() => onSelectBeat(beat.id)}
            onUpdate={(updates) => onUpdateBeat(beat.id, updates)}
            onDelete={() => onDeleteBeat(beat.id)}
            onDragStart={(e) => handleCardDragStart(e, beat.id)}
            onDragEnd={handleCardDragEnd}
            linkedSceneName={getLinkedSceneName(beat.linkedSceneId)}
          />
        ))}
        
        {beats.length === 0 && (
          <div className="beat-column-empty">
            <p>No beats yet</p>
            <button className="beat-empty-add-btn" onClick={onAddBeat}>
              <Plus size={14} />
              <span>Add Beat</span>
            </button>
          </div>
        )}
      </div>
      
      <button className="beat-add-btn" onClick={onAddBeat}>
        <Plus size={14} />
        <span>Add Beat</span>
      </button>
    </div>
  );
}
