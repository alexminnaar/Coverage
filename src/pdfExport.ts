import jsPDF from 'jspdf';
import { Screenplay, ElementType } from './types';

// Screenplay formatting constants (in inches, converted to points)
const PAGE_WIDTH = 8.5;
const PAGE_HEIGHT = 11;
const MARGIN_TOP = 1;
const MARGIN_BOTTOM = 1;

// Convert inches to points (72 points per inch)
const PT = 72;

const FONT_SIZE = 12;
const LINE_HEIGHT = FONT_SIZE * 1.1;

// Element-specific margins (in inches from left edge)
const ELEMENT_MARGINS: Record<ElementType, { left: number; right: number }> = {
  'scene-heading': { left: 1.5, right: 1 },
  'action': { left: 1.5, right: 1 },
  'character': { left: 3.7, right: 1 },
  'dialogue': { left: 2.5, right: 2.5 },
  'parenthetical': { left: 3.1, right: 2.9 },
  'transition': { left: 5.5, right: 1 },
};

export function exportToPDF(screenplay: Screenplay): void {
  const doc = new jsPDF({
    unit: 'pt',
    format: 'letter',
  });

  // Use Courier font
  doc.setFont('Courier', 'normal');
  doc.setFontSize(FONT_SIZE);

  let currentPage = 1;
  let yPosition = MARGIN_TOP * PT;
  const maxY = (PAGE_HEIGHT - MARGIN_BOTTOM) * PT;

  // Add title page
  addTitlePage(doc, screenplay);
  doc.addPage();
  currentPage++;

  // Process each element
  for (const element of screenplay.elements) {
    const margins = ELEMENT_MARGINS[element.type];
    const elementWidth = (PAGE_WIDTH - margins.left - margins.right) * PT;
    const xPosition = margins.left * PT;

    // Format content based on type
    let content = element.content;
    if (element.type === 'scene-heading' || element.type === 'character' || element.type === 'transition') {
      content = content.toUpperCase();
    }
    if (element.type === 'parenthetical' && content && !content.startsWith('(')) {
      content = `(${content})`;
    }

    // Word wrap the text
    const lines = doc.splitTextToSize(content, elementWidth);

    // Check if we need a new page
    const requiredHeight = lines.length * LINE_HEIGHT;
    if (yPosition + requiredHeight > maxY) {
      doc.addPage();
      currentPage++;
      yPosition = MARGIN_TOP * PT;
      
      // Add page number
      doc.setFontSize(10);
      doc.text(`${currentPage}.`, (PAGE_WIDTH - 0.5) * PT, 0.5 * PT);
      doc.setFontSize(FONT_SIZE);
    }

    // Add extra space before scene headings (except at top of page)
    if (element.type === 'scene-heading' && yPosition > MARGIN_TOP * PT + LINE_HEIGHT) {
      yPosition += LINE_HEIGHT;
    }

    // Draw the text
    for (const line of lines) {
      yPosition += LINE_HEIGHT;
      doc.text(line, xPosition, yPosition);
    }

    // Add spacing after certain elements
    if (element.type === 'scene-heading') {
      yPosition += LINE_HEIGHT * 0.5;
    }
  }

  // Save the PDF
  const filename = screenplay.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'screenplay';
  doc.save(`${filename}.pdf`);
}

function addTitlePage(doc: jsPDF, screenplay: Screenplay): void {
  const centerX = (PAGE_WIDTH / 2) * PT;
  const centerY = (PAGE_HEIGHT / 2) * PT;

  // Title
  doc.setFont('Courier', 'bold');
  doc.setFontSize(24);
  doc.text(screenplay.title.toUpperCase(), centerX, centerY - 60, { align: 'center' });

  // "Based on" if provided
  let yOffset = 0;
  if (screenplay.basedOn) {
    doc.setFont('Courier', 'normal');
    doc.setFontSize(12);
    doc.text(screenplay.basedOn, centerX, centerY - 20, { align: 'center' });
    yOffset = 20;
  }

  // Written by
  doc.setFont('Courier', 'normal');
  doc.setFontSize(14);
  doc.text('Written by', centerX, centerY + yOffset + 10, { align: 'center' });
  doc.text(screenplay.author || 'Anonymous', centerX, centerY + yOffset + 35, { align: 'center' });

  // Bottom left: contact info
  const bottomY = (PAGE_HEIGHT - 1.5) * PT;
  const leftX = 1.5 * PT;
  
  doc.setFontSize(12);
  let contactY = bottomY;
  
  if (screenplay.contact) {
    const contactLines = screenplay.contact.split('\n');
    for (const line of contactLines) {
      doc.text(line, leftX, contactY);
      contactY += 14;
    }
  }

  // Bottom right: draft date and copyright
  const rightX = (PAGE_WIDTH - 1.5) * PT;
  let infoY = bottomY;
  
  if (screenplay.draftDate) {
    doc.text(screenplay.draftDate, rightX, infoY, { align: 'right' });
    infoY += 14;
  }
  
  if (screenplay.copyright) {
    doc.text(screenplay.copyright, rightX, infoY, { align: 'right' });
  }
}

export function estimatePageCount(screenplay: Screenplay): number {
  // Industry standard: approximately 55 lines per page
  const LINES_PER_PAGE = 55;
  
  let totalLines = 0;
  
  for (const element of screenplay.elements) {
    // Rough estimate: ~60 characters per line
    const charCount = element.content.length;
    const lines = Math.max(1, Math.ceil(charCount / 55));
    totalLines += lines;
    
    // Add extra line for scene headings
    if (element.type === 'scene-heading') {
      totalLines += 1;
    }
  }

  return Math.max(1, Math.ceil(totalLines / LINES_PER_PAGE));
}

