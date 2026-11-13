import { terrainGridBounds, terrainPoint, type Terrain, type TerrainRegion } from './terrain'
import { terrainCoastMask, terrainRegionField } from './terrainRegions'
import { terrainOrthoUV, type TerrainOrtho } from './terrainOrtho'

// 不引入 3D 引擎。共用一個離屏 WebGL2 畫布，只在取景改變時輸出靜態影像。
const VERTEX = `#version 300 es
precision highp float;
uniform sampler2D heights;
uniform vec2 dimensions;
uniform vec2 origin;
uniform vec2 basisU;
uniform vec2 basisV;
uniform vec4 box;
uniform vec2 turn;
uniform vec2 tilt;
in vec2 grid;
in vec2 photoUV;
out vec2 photoAt;
out vec3 normal;
out vec2 atGrid;
out float valid;
vec4 sampleAt(ivec2 p) { return texelFetch(heights, clamp(p, ivec2(0), ivec2(dimensions)-1), 0); }
float curve(float a,float b,float c,float d,float t) {
  float x=b-a, y=c-b, z=d-c;
  float m0=x*y<=0.0?0.0:2.0*x*y/(x+y);
  float m1=y*z<=0.0?0.0:2.0*y*z/(y+z);
  return (2.0*t*t*t-3.0*t*t+1.0)*b+(t*t*t-2.0*t*t+t)*m0+(-2.0*t*t*t+3.0*t*t)*c+(t*t*t-t*t)*m1;
}
vec2 heightAt(vec2 p) {
  ivec2 base=ivec2(floor(p)); vec2 f=fract(p);
  vec4 values=vec4(0.0); float complete=1.0;
  for(int r=0;r<4;r++) {
    vec4 a=sampleAt(base+ivec2(-1,r-1)), b=sampleAt(base+ivec2(0,r-1));
    vec4 c=sampleAt(base+ivec2(1,r-1)), d=sampleAt(base+ivec2(2,r-1));
    complete*=a.g*b.g*c.g*d.g;
    values[r]=curve(a.r,b.r,c.r,d.r,f.x);
  }
  if(complete>0.99) return vec2(curve(values.x,values.y,values.z,values.w,f.y),1.0);
  vec4 a=sampleAt(base), b=sampleAt(base+ivec2(1,0)), c=sampleAt(base+ivec2(0,1)), d=sampleAt(base+ivec2(1,1));
  return vec2(mix(mix(a.r,b.r,f.x),mix(c.r,d.r,f.x),f.y),a.g*b.g*c.g*d.g);
}
void main() {
  vec2 h=heightAt(grid);
  float du=(heightAt(grid+vec2(0.025,0.0)).x-heightAt(grid-vec2(0.025,0.0)).x)/0.05;
  float dv=(heightAt(grid+vec2(0.0,0.025)).x-heightAt(grid-vec2(0.0,0.025)).x)/0.05;
  float det=basisU.x*basisV.y-basisU.y*basisV.x;
  vec2 slope=vec2((du*basisV.y-dv*basisU.y)/det,(dv*basisU.x-du*basisV.x)/det);
  normal=normalize(vec3(-slope,1.0));
  vec2 p=origin+grid.x*basisU+grid.y*basisV;
  vec2 ground=vec2(p.x*turn.x-p.y*turn.y,p.x*turn.y+p.y*turn.x);
  vec2 screen=vec2(ground.x,ground.y*tilt.x-h.x*tilt.y);
  float depth=ground.y*tilt.y+h.x*tilt.x;
  gl_Position=vec4((screen.x-box.x)/box.z*2.0-1.0,1.0-(screen.y-box.y)/box.w*2.0,-depth/10000.0,1.0);
  valid=h.y; atGrid=grid; photoAt=photoUV;
}`

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 dimensions;
uniform sampler2D regionColors;
uniform sampler2D coastMask;
uniform sampler2D photo;
uniform bool hasPhoto;
in vec2 photoAt;
in vec3 normal;
in vec2 atGrid;
in float valid;
out vec4 color;
void main() {
  if(valid<0.999) discard;
  vec2 uv=(atGrid+vec2(0.5))/dimensions;
  if(hasPhoto) {
    vec3 image=texture(photo,photoAt).rgb;
    float light=0.85+0.15*max(0.0,dot(normalize(normal),normalize(vec3(-0.45,-0.55,0.7))));
    color=vec4(image*light,1.0);
    return;
  }
  float land=texture(coastMask,uv).r;
  float coastEdge=max(fwidth(land),0.0001);
  float alpha=smoothstep(0.5-coastEdge,0.5+coastEdge,land);
  if(alpha<0.001) discard;
  float light=0.62+0.38*max(0.0,dot(normalize(normal),normalize(vec3(-0.45,-0.55,0.7))));
  vec4 region=texture(regionColors,uv);
  float edge=max(fwidth(region.a),0.0001);
  float coverage=smoothstep(0.5-edge,0.5+edge,region.a);
  if(coverage<0.003) discard;
  color=vec4(region.rgb*light,coverage*alpha);
}`

/** 小圖至少 2 倍超取樣，高密度螢幕最高 3 倍；限制總像素，避免大螢幕浪費記憶體。 */
export function terrainDisplayResolution(width: number, height: number, pixelRatio: number) {
  const ratio = Math.min(Math.max(2, pixelRatio), 3, Math.sqrt(1600000/(width*height)))
  return { ratio, fieldScale: width >= 600 ? 3 as const : 2 as const }
}

class Rasterizer {
  readonly canvas = document.createElement('canvas')
  readonly gl: WebGL2RenderingContext
  readonly program: WebGLProgram
  readonly vertices: WebGLBuffer
  readonly indices: WebGLBuffer
  readonly texture: WebGLTexture
  readonly colors: WebGLTexture
  readonly coast: WebGLTexture
  readonly photo: WebGLTexture
  currentPhoto?: TerrainOrtho
  meshKey?: string
  current?: Terrain
  fieldKey?: string
  wallCoverage = 0
  continuousCoverage = 0
  coastMeters = 0
  coastContext?: boolean

  constructor() {
    const gl = this.canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false })
    if (!gl) throw new Error('WebGL2 unavailable')
    this.gl = gl
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, source); gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Terrain shader')
      return shader
    }
    this.program = gl.createProgram()!
    const vertex = compile(gl.VERTEX_SHADER, VERTEX), fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT)
    gl.attachShader(this.program, vertex); gl.attachShader(this.program, fragment); gl.linkProgram(this.program)
    gl.deleteShader(vertex); gl.deleteShader(fragment)
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program) ?? 'Terrain program')
    this.vertices = gl.createBuffer()!; this.indices = gl.createBuffer()!; this.texture = gl.createTexture()!; this.colors = gl.createTexture()!; this.coast = gl.createTexture()!; this.photo = gl.createTexture()!
  }

  draw(t: Terrain, regions: TerrainRegion[], fieldKey: string, angle: number, box: [number, number, number, number], width: number, height: number, ratio: number, fieldScale: 2 | 3, maxVertices: number, context: boolean, photo?: TerrainOrtho, pitch = 60, target?: HTMLCanvasElement) {
    const gl = this.gl
    if (this.canvas.width !== Math.ceil(width*ratio)) this.canvas.width = Math.ceil(width*ratio)
    if (this.canvas.height !== Math.ceil(height*ratio)) this.canvas.height = Math.ceil(height*ratio)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.useProgram(this.program)
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.photo)
    if (photo !== this.currentPhoto || !this.currentPhoto) {
      if (photo) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, photo.canvas)
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      this.currentPhoto = photo
    }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture)
    const changed = this.current !== t
    if (changed) {
      const data = new Float32Array(t.heights.length*4)
      t.heights.forEach((h, i) => data.set([h === null ? 0 : h*t.scale, h === null ? 0 : 1, 0, 0], i*4))
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, t.columns, t.rows, 0, gl.RGBA, gl.FLOAT, data)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      this.current = t
    }
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.coast)
    if (changed || this.coastContext !== context) {
      const coast = terrainCoastMask(t, context)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, coast.width, coast.height, 0, gl.RED, gl.UNSIGNED_BYTE, coast.pixels)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      this.coastMeters = coast.meters
      this.coastContext = context
    }
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.colors)
    if (changed || this.fieldKey !== fieldKey) {
      const field = terrainRegionField(t, regions, fieldScale, context)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, field.width, field.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, field.pixels)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      this.fieldKey = fieldKey; this.wallCoverage = field.wallCoverage; this.continuousCoverage = field.continuousCoverage
    }
    // 調角時固定南北網格，只保留可見的東西向帶；網格不隨角度重建，放大後仍有足夠細分。
    const ys = target ? [terrainPoint(t, 0, 0)[1], terrainPoint(t, t.columns-1, 0)[1], terrainPoint(t, 0, t.rows-1)[1], terrainPoint(t, t.columns-1, t.rows-1)[1]] : []
    const bounds = target
      ? { ...terrainGridBounds(t, 0, [box[0], Math.min(...ys), box[2], Math.max(...ys)-Math.min(...ys)], 1, 0), firstRow: 0, lastRow: t.rows-2 }
      : terrainGridBounds(t, angle, box, 1, pitch)
    const spanC = bounds.lastCol+1-bounds.firstCol, spanR = bounds.lastRow+1-bounds.firstRow
    // 以實際螢幕像素決定取樣密度；曲面約每 2 個實體像素一個頂點，光照逐像素內插。
    const nativeMeters = Math.hypot(...t.u)
    let divisions = Math.min(64, Math.max(1, Math.ceil(nativeMeters/(box[2]/this.canvas.width*2))))
    while ((spanC*divisions+1)*(spanR*divisions+1) > maxVertices && divisions > 1) divisions--
    const cols = Math.ceil(spanC*divisions), rows = Math.ceil(spanR*divisions)
    const meshKey = JSON.stringify([bounds, divisions, photo && [photo.z, photo.x, photo.y, photo.columns, photo.rows]])
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertices)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indices)
    if (changed || this.meshKey !== meshKey) {
      const positions = new Float32Array((cols+1)*(rows+1)*4)
      for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
        const i = (r*(cols+1)+c)*4
        positions[i] = bounds.firstCol+c/divisions; positions[i+1] = bounds.firstRow+r/divisions
        if (photo) positions.set(terrainOrthoUV(terrainPoint(t, positions[i], positions[i+1]), photo), i+2)
      }
      const indices = new Uint32Array(cols*rows*6)
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r*(cols+1)+c
        indices.set([i, i+1, i+cols+1, i+1, i+cols+2, i+cols+1], (r*cols+c)*6)
      }
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW)
      this.meshKey = meshKey
    }
    const attribute = gl.getAttribLocation(this.program, 'grid')
    gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 16, 0)
    const photoAttribute = gl.getAttribLocation(this.program, 'photoUV')
    gl.enableVertexAttribArray(photoAttribute); gl.vertexAttribPointer(photoAttribute, 2, gl.FLOAT, false, 16, 8)
    const uniform = (name: string) => gl.getUniformLocation(this.program, name)
    gl.uniform1i(uniform('heights'), 0)
    gl.uniform1i(uniform('regionColors'), 1)
    gl.uniform1i(uniform('coastMask'), 2)
    gl.uniform1i(uniform('photo'), 3); gl.uniform1i(uniform('hasPhoto'), photo ? 1 : 0)
    gl.uniform2f(uniform('dimensions'), t.columns, t.rows)
    gl.uniform2f(uniform('origin'), ...t.origin)
    gl.uniform2f(uniform('basisU'), ...t.u); gl.uniform2f(uniform('basisV'), ...t.v)
    gl.uniform4f(uniform('box'), ...box)
    gl.uniform2f(uniform('turn'), Math.cos(angle*Math.PI/180), Math.sin(angle*Math.PI/180))
    gl.uniform2f(uniform('tilt'), Math.cos(pitch*Math.PI/180), Math.sin(pitch*Math.PI/180))
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL)
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.drawElements(gl.TRIANGLES, cols*rows*6, gl.UNSIGNED_INT, 0)
    if (target) {
      if (target.width !== this.canvas.width) target.width = this.canvas.width
      if (target.height !== this.canvas.height) target.height = this.canvas.height
      const ctx = target.getContext('2d')!
      ctx.clearRect(0, 0, target.width, target.height); ctx.drawImage(this.canvas, 0, 0)
    }
    return { all: target ? '' : this.canvas.toDataURL('image/png'), triangles: cols*rows*2, sampleMeters: nativeMeters/divisions, wallCoverage: this.wallCoverage, continuousCoverage: this.continuousCoverage, coastMeters: this.coastMeters, pixelWidth: this.canvas.width, pixelHeight: this.canvas.height, renderer: 'webgl' as const }
  }
}

let rasterizer: Rasterizer | undefined
let unavailable = false
let previous: { terrain: Terrain; key: string; image: ReturnType<Rasterizer['draw']> } | undefined

const fieldKeyFor = (regions: TerrainRegion[], scale: 2 | 3, context: boolean) => JSON.stringify([scale, context, regions.map((r) => [r.id, r.color, r.walls, r.rings])])

export function paintTerrainFrame(target: HTMLCanvasElement, t: Terrain, regions: TerrainRegion[], pitch: number, box: [number, number, number, number], width: number, height: number, photo?: TerrainOrtho) {
  rasterizer ??= new Rasterizer()
  const scale = width >= 600 ? 3 : 2
  rasterizer.draw(t, regions, fieldKeyFor(regions, scale, true), 0, box, width, height, 1, scale, 45000, true, photo, pitch, target)
}

export function rasterTerrain(t: Terrain, regions: TerrainRegion[], angle: number, box: [number, number, number, number], width: number, height: number, { maxVertices = 180000, context = false, photo, pitch = 60 }: { maxVertices?: number; context?: boolean; photo?: TerrainOrtho; pitch?: number } = {}) {
  if (unavailable) return undefined
  try {
    const { ratio, fieldScale } = terrainDisplayResolution(width, height, window.devicePixelRatio || 1)
    const fieldKey = fieldKeyFor(regions, fieldScale, context)
    const key = JSON.stringify([fieldKey, angle, pitch, ...box, width, height, ratio, maxVertices])
    if (previous?.terrain === t && previous.key === key && rasterizer?.currentPhoto === photo) return previous.image
    rasterizer ??= new Rasterizer()
    const image = rasterizer.draw(t, regions, fieldKey, angle, box, width, height, ratio, fieldScale, maxVertices, context, photo, pitch)
    previous = { terrain: t, key, image }
    return image
  } catch (error) {
    unavailable = true
    console.warn('地形平滑繪製無法啟用，改用向量顯示', error)
    return undefined
  }
}
