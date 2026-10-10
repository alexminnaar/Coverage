import type { Screenplay } from '../types';
import { getPageCount } from './pageBreaks';

export function estimatePageCount(screenplay: Screenplay): number {
  return getPageCount(screenplay.elements);
}
