export const TOPO_EDGE: number;
export const COMMONS_REQUEST_WIDTH: number;
export const QUALITY: number;
export function fitSize(w: number, h: number, edge?: number): { w: number; h: number };
export function fitImage(blob: Blob, options?: { edge?: number; size?: { w: number; h: number } }): Promise<{ blob: Blob; w: number; h: number }>;
