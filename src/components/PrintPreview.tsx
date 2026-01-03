import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, Printer, ZoomIn, ZoomOut } from 'lucide-react';
import { Screenplay } from '../types';
import { calculatePages, Page } from '../utils/pageBreaks';
import { getCharacterWithContd } from '../utils/contdMore';

interface PrintPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  screenplay: Screenplay;
}

export default function PrintPreview({ isOpen, onClose, screenplay }: PrintPreviewProps) {
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [zoom, setZoom] = useState(100);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const scriptPages = useMemo(() => calculatePages(screenplay.elements), [screenplay.elements]);
  const pages = useMemo(
    () => [{ kind: 'title' as const }, ...scriptPages.map(p => ({ kind: 'script' as const, page: p }))],
    [scriptPages]
  );

  useEffect(() => {
    if (!isOpen) return;
    // Reset state on open so title page is always shown first.
    setCurrentPageIndex(0);
    setZoom(100);
  }, [isOpen]);

  // Observe which page is currently in view so scroll updates the active thumbnail.
  useEffect(() => {
    if (!isOpen) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        // Pick the most visible page.
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => (b.intersectionRatio || 0) - (a.intersectionRatio || 0))[0];
        if (!visible) return;
        const idxAttr = (visible.target as HTMLElement).getAttribute('data-page-idx');
        const idx = idxAttr ? parseInt(idxAttr, 10) : NaN;
        if (!Number.isNaN(idx)) setCurrentPageIndex(idx);
      },
      { root: container, threshold: [0.25, 0.5, 0.75] }
    );

    // Attach observers to wrappers.
    pageRefs.current.forEach((el, idx) => {
      if (!el) return;
      el.setAttribute('data-page-idx', String(idx));
      observerRef.current?.observe(el);
    });

    return () => observerRef.current?.disconnect();
  }, [isOpen, pages.length]);

  const scrollToPage = useCallback((idx: number) => {
    const container = scrollContainerRef.current;
    const el = pageRefs.current[idx];
    if (!container || !el) return;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const delta = elRect.top - containerRect.top;
    container.scrollTo({ top: container.scrollTop + delta, behavior: 'smooth' });
  }, []);

  const goToPreviousPage = useCallback(() => {
    setCurrentPageIndex(prev => {
      const next = Math.max(0, prev - 1);
      scrollToPage(next);
      return next;
    });
  }, [scrollToPage]);

  const goToNextPage = useCallback(() => {
    setCurrentPageIndex(prev => {
      const next = Math.min(pages.length - 1, prev + 1);
      scrollToPage(next);
      return next;
    });
  }, [pages.length, scrollToPage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') goToPreviousPage();
    if (e.key === 'ArrowRight') goToNextPage();
    if (e.key === 'Escape') onClose();
  }, [goToPreviousPage, goToNextPage, onClose]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(200, prev + 25));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(prev => Math.max(50, prev - 25));
  }, []);

  const renderTitlePage = () => {
    const title = (screenplay.title || 'Untitled Screenplay').toUpperCase();
    const author = screenplay.author || 'Anonymous';
    const basedOn = (screenplay.basedOn || '').trim();
    const contact = (screenplay.contact || '').trim();
    const draftDate = (screenplay.draftDate || '').trim();
    const copyright = (screenplay.copyright || '').trim();

    return (
      <div className="print-page print-title-page">
        <div className="print-title-center">
          <div className="print-title-text">{title}</div>
          {basedOn && <div className="print-based-on">{basedOn}</div>}
          <div className="print-written-by">Written by</div>
          <div className="print-author-text">{author}</div>
        </div>

        <div className="print-title-bottom">
          <div className="print-title-bottom-left">
            {contact &&
              contact.split('\n').map((line, idx) => (
                <div key={idx} className="print-title-line">
                  {line}
                </div>
              ))}
          </div>
          <div className="print-title-bottom-right">
            {draftDate && <div className="print-title-line">{draftDate}</div>}
            {copyright && <div className="print-title-line">{copyright}</div>}
          </div>
        </div>
      </div>
    );
  };

  const renderScriptPage = (page: Page) => {
    return (
      <div className="print-page">
        {/* Page header */}
        <div className="print-page-header">
          <span className="page-number">{page.pageNumber}.</span>
        </div>

        {/* CONT'D header for split dialogue */}
        {page.hasContdHeader && page.contdCharacter && (
          <div className="print-contd-header">
            <span className="print-character">{page.contdCharacter} (CONT'D)</span>
          </div>
        )}

        {/* Page content */}
        <div className="print-page-content">
          {page.elements.map((pe, idx) => (
            <div 
              key={`${pe.element.id}-${idx}`}
              className={`print-element print-element--${pe.element.type}`}
            >
              {pe.element.type === 'scene-heading' && screenplay.sceneNumberingEnabled && pe.element.sceneNumber && (
                <>
                  <span className="print-scene-number-left">{pe.element.sceneNumber}</span>
                  <span className="print-scene-number-right">{pe.element.sceneNumber}</span>
                </>
              )}
              {pe.element.type === 'character' ? (
                <span>
                  {getCharacterWithContd(
                    screenplay.elements,
                    screenplay.elements.findIndex(el => el.id === pe.element.id)
                  )}
                </span>
              ) : (
                <span>{pe.element.content}</span>
              )}
            </div>
          ))}
        </div>

        {/* (MORE) at bottom for split dialogue */}
        {page.hasMore && (
          <div className="print-more">
            (MORE)
          </div>
        )}

        {/* Page footer */}
        <div className="print-page-footer">
          {/* Footer content if needed */}
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="print-preview-overlay" onKeyDown={handleKeyDown} tabIndex={0}>
      {/* Toolbar */}
      <div className="print-preview-toolbar">
        <div className="toolbar-left">
          <button className="toolbar-btn" onClick={onClose} title="Close">
            <X size={20} />
          </button>
          <span className="toolbar-title">Print Preview</span>
        </div>

        <div className="toolbar-center">
          <button 
            className="toolbar-btn" 
            onClick={goToPreviousPage}
            disabled={currentPageIndex === 0}
          >
            <ChevronLeft size={20} />
          </button>
          <span className="page-indicator">
            {currentPageIndex === 0 ? 'Title Page' : `Page ${currentPageIndex} of ${pages.length - 1}`}
          </span>
          <button 
            className="toolbar-btn"
            onClick={goToNextPage}
            disabled={currentPageIndex === pages.length - 1}
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="toolbar-right">
          <button className="toolbar-btn" onClick={handleZoomOut} title="Zoom Out">
            <ZoomOut size={18} />
          </button>
          <span className="zoom-indicator">{zoom}%</span>
          <button className="toolbar-btn" onClick={handleZoomIn} title="Zoom In">
            <ZoomIn size={18} />
          </button>
          <button className="toolbar-btn toolbar-btn-primary" onClick={handlePrint} title="Print">
            <Printer size={18} />
            <span>Print</span>
          </button>
        </div>
      </div>

      {/* Page thumbnails sidebar */}
      <div className="print-preview-sidebar">
        {pages.map((page, idx) => (
          <div
            key={page.kind === 'title' ? 'title' : page.page.pageNumber}
            className={`page-thumbnail ${idx === currentPageIndex ? 'active' : ''}`}
            onClick={() => {
              setCurrentPageIndex(idx);
              scrollToPage(idx);
            }}
          >
            <div className="thumbnail-content">
              <span>{page.kind === 'title' ? 'T' : page.page.pageNumber}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Main page view */}
      <div className="print-preview-main" ref={scrollContainerRef}>
        <div
          className="page-container"
          // `zoom` affects layout (unlike transform scale) so scrolling behaves naturally.
          style={{ zoom: zoom / 100 } as React.CSSProperties}
        >
          {pages.map((p, idx) => (
            <div
              key={p.kind === 'title' ? 'title-wrapper' : `page-${p.page.pageNumber}`}
              className="print-preview-page-wrapper"
              ref={(el) => {
                pageRefs.current[idx] = el;
              }}
            >
              {p.kind === 'title' ? renderTitlePage() : renderScriptPage(p.page)}
            </div>
          ))}
        </div>
      </div>

      {/* Print-only styles for actual printing */}
      <div className="print-only-content">
        {pages.map(page => (page.kind === 'title' ? renderTitlePage() : renderScriptPage(page.page)))}
      </div>
    </div>
  );
}

