/** 固定螢幕尺寸的原圖標記；編號與實際位置由同一圖資提供。 */
export function TerrainMapMarker({ kind, text }: { kind: string; text: string }) {
  if (kind === 'rescue') return <><circle r="10" fill="#fff" stroke="#d42e5d" strokeWidth="2" /><text fill="#a51038" fontSize="11" fontWeight="750" textAnchor="middle" dominantBaseline="central">{text}</text></>
  if (kind === 'first-aid') return <><rect x="-16" y="-10" width="32" height="20" rx="4" fill="#08723e" stroke="#fff" strokeWidth="1.5" /><path d="M-12 0H-2M-7-5V5" stroke="#fff" strokeWidth="3" /><text x="8" fontSize="10" fill="#fff" textAnchor="middle" dominantBaseline="central">{text}</text></>
  if (kind === 'parking') return <><rect x="-10" y="-10" width="20" height="20" rx="4" fill="#1768a8" stroke="#fff" strokeWidth="1.5" /><text fontSize="14" fill="#fff" fontWeight="700" textAnchor="middle" dominantBaseline="central">P</text></>
  if (kind === 'hazard') return <><path d="M0-12L12 10H-12Z" fill="#df3550" stroke="#fff" strokeWidth="1.5" /><g data-hazard-glyph><path d="M0-2V4" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" /><circle cx="0" cy="7" r="1.2" fill="#fff" /></g></>
  if (kind === 'boat') return <><circle r="11" fill="#107b9b" stroke="#fff" strokeWidth="1.5" /><path d="M-7 2H7L4 6H-4ZM-3 0V-5H3V0M0-8V-5" stroke="#fff" fill="none" strokeWidth="1.5" /></>
  return <><circle r="11" fill="#fff" stroke="#407684" strokeWidth="1.5" /><text fill="#245660" fontSize="13" fontWeight="750" textAnchor="middle" dominantBaseline="central">H</text></>
}
