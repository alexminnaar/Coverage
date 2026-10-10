import { Check, CheckCheck, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { PendingEdit } from '../types';

interface EditReviewBarProps {
  current: number;
  total: number;
  edit: PendingEdit;
  label: string;
  hasPrevious: boolean;
  hasNext: boolean;
  isStale: boolean;
  hasConflicts: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onAccept: () => void;
  onReject: () => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

export default function EditReviewBar({
  current,
  total,
  edit,
  label,
  hasPrevious,
  hasNext,
  isStale,
  hasConflicts,
  onPrevious,
  onNext,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
}: EditReviewBarProps) {
  return (
    <aside className="edit-review-bar" aria-label="Review AI changes">
      <div className="edit-review-heading">
        <span className="edit-review-count">Change {current} of {total}</span>
        <span className="edit-review-label">{label}</span>
        {edit.reason && <span className="edit-review-reason">{edit.reason}</span>}
        {isStale && (
          <span className="edit-review-conflict" role="alert">
            This proposal no longer matches its target text. Reject it and regenerate the edit.
          </span>
        )}
      </div>

      <div className="edit-review-actions">
        <button type="button" onClick={onPrevious} disabled={!hasPrevious} aria-label="Previous change">
          <ChevronLeft size={17} />
        </button>
        <button type="button" className="review-reject" onClick={onReject}>
          <X size={16} /> Reject
        </button>
        <button type="button" className="review-accept" onClick={onAccept} disabled={isStale}>
          <Check size={16} /> Accept
        </button>
        <button type="button" onClick={onNext} disabled={!hasNext} aria-label="Next change">
          <ChevronRight size={17} />
        </button>
        <span className="edit-review-divider" aria-hidden="true" />
        <button
          type="button"
          className="review-all"
          onClick={onAcceptAll}
          disabled={hasConflicts}
          title={hasConflicts ? 'Resolve conflicting edits before accepting all' : 'Accept all proposed changes'}
        >
          <CheckCheck size={16} /> Accept all
        </button>
        <button type="button" className="review-reject-all" onClick={onRejectAll}>
          Reject all
        </button>
      </div>
    </aside>
  );
}
