import { createContext } from 'react'

/** 照片的參照（TopoImage.image）換成網址：照片存在哪裡由使用的 App 決定（src/main.tsx 提供） */
export const ImageUrl = createContext<((image: string) => string) | undefined>(undefined)
