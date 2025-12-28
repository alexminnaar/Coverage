import { useState, useMemo, useCallback } from 'react';
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

  const pages = useMemo(() => calculatePages(screenplay.elements), [screenplay.elements]);

  const goToPreviousPage = useCallback(() => {
    setCurrentPageIndex(prev => Math.max(0, prev - 1));
  }, []);

  const goToNextPage = useCallback(() => {
    setCurrentPageIndex(prev => Math.min(pages.length - 1, prev + 1));
  }, [pages.length]);

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

  const renderPage = (page: Page) => {
    return (
      <div className="print-page" style={{ transform: `scale(${zoom / 100})` }}>
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
            Page {currentPageIndex + 1} of {pages.length}
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
            key={page.pageNumber}
            className={`page-thumbnail ${idx === currentPageIndex ? 'active' : ''}`}
            onClick={() => setCurrentPageIndex(idx)}
          >
            <div className="thumbnail-content">
              <span>{page.pageNumber}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Main page view */}
      <div className="print-preview-main">
        <div className="page-container">
          {pages[currentPageIndex] && renderPage(pages[currentPageIndex])}
        </div>
      </div>

      {/* Print-only styles for actual printing */}
      <div className="print-only-content">
        {pages.map(page => renderPage(page))}
      </div>
    </div>
  );
}

