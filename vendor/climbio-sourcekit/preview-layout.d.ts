export interface Rect { x: number; y: number; w: number; h: number }
export interface PreviewProps { href: string; w: number; h: number; count: number; tile: { w: number; h: number; cols: number; y: number } }
export const PREVIEW: string;
export const PREVIEW_W: number, COVER_H: number, TILE_W: number, TILE_H: number, TILE_COLS: number;
export const COVER_RECT: Rect;
export function previewSize(n: number): { w: number; h: number };
export function previewProps(n: number, href?: string): PreviewProps;
export function tileRect(i: number): Rect;
