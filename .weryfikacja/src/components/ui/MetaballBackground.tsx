'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Animowane tło z baniek zlewających się w jeden kształt (metaballe).
 *
 * Rysowane jednym trójkątem na cały ekran — całość dzieje się w shaderze
 * fragmentów, bez geometrii i bez żadnej biblioteki. Kształt powstaje
 * z pola odległości: każda bańka to okrąg, a łączy je wielomianowe
 * `smin`, które zamiast przecięcia dwóch kół daje płynną szyjkę.
 *
 * Ruch baniek i paralaksa liczone są w TypeScripcie, nie w shaderze.
 * Powód jest praktyczny: shader zostaje wtedy na tyle prosty, że ten sam
 * kod działa w WebGL 2 i w WebGL 1, gdzie tablice stałych i pochodne
 * bywają niedostępne.
 */

type MetaballBackgroundProps = {
  /** Kolor bazowy. Domyślnie wrzos ze znaku `.Studio`. */
  color?: string
  /** Ile baniek. 1–12. */
  blobCount?: number
  /** Mnożnik tempa ruchu. */
  speed?: number
  /** Parametr `k` dla `smin` — im większy, tym wcześniej bańki się zlewają. */
  smoothness?: number
  /** Globalny mnożnik paralaksy. Zero wyłącza ją zupełnie. */
  parallaxStrength?: number
  className?: string
}

/** Ile baniek mieści tablica uniformów. Musi zgadzać się z shaderem. */
const MAX_BLOBS = 12

/**
 * Parametry pojedynczej bańki.
 *
 * Częstotliwości są **niewspółmierne** (0,11 / 0,17 / 0,23 i wielokrotności),
 * więc suma sinusoid nie zapętla się w słyszalnym okresie — pełny cykl
 * wypada w odczuciu na 30–45 sekund, a nie na kilka.
 */
type Blob = {
  /** Odsunięcie środka od prawej krawędzi kadru, a nie od jego środka. */
  insetX: number
  baseY: number
  radius: number
  /** Jak mocno bańka reaguje na kursor. Większe bańki mocniej. */
  parallax: number
  freqX: readonly [number, number, number]
  freqY: readonly [number, number, number]
  ampX: readonly [number, number, number]
  ampY: readonly [number, number, number]
  phaseX: number
  phaseY: number
}

/**
 * Układ baniek.
 *
 * Część z nich stoi poza kadrem (`baseX`/`baseY` poza ±0,5) i jest przycięta
 * krawędzią — tak jak w referencji. Promienie w zakresie 0,10–0,34 jednostki
 * krótszego boku.
 */
const BLOBS: readonly Blob[] = [
  // Trzy duże w pasie przy prawej krawędzi. Ich wędrówki zachodzą na siebie,
  // więc raz po raz się spotykają i rozchodzą — o to chodzi w metaballach,
  // inaczej wygląda to jak osobne bąble pod wodą.
  { insetX: 0.022, baseY: 0.338, radius: 0.20, parallax: 0.055,
    freqX: [0.11, 0.17, 0.23], freqY: [0.13, 0.19, 0.29],
    ampX: [0.085, 0.0382, 0.017], ampY: [0.0935, 0.0408, 0.0179], phaseX: 0.0, phaseY: 1.7 },
  { insetX: 0.187, baseY: -0.13, radius: 0.165, parallax: 0.06,
    freqX: [0.09, 0.19, 0.27], freqY: [0.11, 0.23, 0.31],
    ampX: [0.0935, 0.0408, 0.0179], ampY: [0.102, 0.0425, 0.0187], phaseX: 2.3, phaseY: 0.6 },
  { insetX: 0.066, baseY: -0.62, radius: 0.14, parallax: 0.042,
    freqX: [0.27, 0.13, 0.29], freqY: [0.31, 0.19, 0.11],
    ampX: [0.085, 0.0374, 0.0161], ampY: [0.0935, 0.0391, 0.017], phaseX: 2.8, phaseY: 1.3 },
  // Średnie — krążą między dużymi, więc łączą je i rozłączają.
  { insetX: 0.297, baseY: 0.156, radius: 0.085, parallax: 0.03,
    freqX: [0.17, 0.29, 0.13], freqY: [0.19, 0.31, 0.11],
    ampX: [0.0935, 0.0391, 0.017], ampY: [0.085, 0.0357, 0.0153], phaseX: 4.1, phaseY: 3.2 },
  { insetX: 0.209, baseY: 0.62, radius: 0.07, parallax: 0.024,
    freqX: [0.23, 0.11, 0.31], freqY: [0.29, 0.17, 0.13],
    ampX: [0.085, 0.0357, 0.0153], ampY: [0.085, 0.0374, 0.0161], phaseX: 5.2, phaseY: 0.3 },
  { insetX: 0.363, baseY: -0.39, radius: 0.055, parallax: 0.019,
    freqX: [0.31, 0.11, 0.19], freqY: [0.23, 0.29, 0.13],
    ampX: [0.0765, 0.0323, 0.0145], ampY: [0.085, 0.0357, 0.0153], phaseX: 5.6, phaseY: 2.4 },
  // Małe — też w ruchu, żeby wpadały w duże i odrywały się od nich.
  { insetX: 0.319, baseY: -0.62, radius: 0.042, parallax: 0.017,
    freqX: [0.19, 0.31, 0.11], freqY: [0.13, 0.27, 0.23],
    ampX: [0.0765, 0.0323, 0.0136], ampY: [0.068, 0.0289, 0.0127], phaseX: 0.9, phaseY: 6.1 },
  { insetX: 0.429, baseY: 0.026, radius: 0.032, parallax: 0.015,
    freqX: [0.13, 0.23, 0.17], freqY: [0.17, 0.11, 0.27],
    ampX: [0.068, 0.0289, 0.0127], ampY: [0.0765, 0.0323, 0.0136], phaseX: 3.4, phaseY: 4.6 },
  { insetX: 0.253, baseY: 0.416, radius: 0.026, parallax: 0.015,
    freqX: [0.29, 0.17, 0.23], freqY: [0.11, 0.31, 0.19],
    ampX: [0.068, 0.0289, 0.0127], ampY: [0.068, 0.0289, 0.0127], phaseX: 1.4, phaseY: 5.5 },
  { insetX: 0.407, baseY: 0.52, radius: 0.020, parallax: 0.015,
    freqX: [0.11, 0.27, 0.31], freqY: [0.19, 0.13, 0.29],
    ampX: [0.0595, 0.0255, 0.011], ampY: [0.068, 0.0289, 0.0127], phaseX: 4.7, phaseY: 2.0 },
  { insetX: 0.165, baseY: -0.364, radius: 0.016, parallax: 0.015,
    freqX: [0.23, 0.19, 0.13], freqY: [0.27, 0.11, 0.31],
    ampX: [0.0595, 0.0255, 0.011], ampY: [0.0595, 0.0255, 0.011], phaseX: 2.1, phaseY: 3.8 },
  { insetX: 0.451, baseY: -0.208, radius: 0.012, parallax: 0.015,
    freqX: [0.31, 0.23, 0.11], freqY: [0.13, 0.29, 0.17],
    ampX: [0.051, 0.0221, 0.0093], ampY: [0.0595, 0.0255, 0.011], phaseX: 0.4, phaseY: 4.2 },
]

/** Propsy po sprowadzeniu do zakresów, w formie czytanej przez pętlę. */
type Settings = {
  count: number
  tempo: number
  k: number
  parallaxScale: number
  rgb: [number, number, number]
}

/**
 * Wierzchołki.
 *
 * WebGL 2 mówi GLSL-em ES 3.00 (`in`), WebGL 1 wersją 1.00 (`attribute`).
 */
function vertexShader(webgl2: boolean): string {
  const naglowek = webgl2 ? '#version 300 es\nin vec2 aPosition;\n' : 'attribute vec2 aPosition;\n'

  return `${naglowek}
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`
}

/**
 * Shader fragmentów — całe rysowanie dzieje się tutaj.
 *
 * Ciało jest wspólne, różni się tylko nagłówek. Powód jest konkretny:
 * pochodne (`fwidth`, `dFdx`) są w ES 3.00 wbudowane, a w ES 1.00 wymagają
 * rozszerzenia — którego WebGL 2 w ogóle nie wystawia. Shader w ES 1.00
 * puszczony na kontekście WebGL 2 nie kompiluje się właśnie na tym.
 */
function fragmentShader(webgl2: boolean): string {
  const naglowek = webgl2
    ? '#version 300 es\nprecision highp float;\nout vec4 fragColor;\n'
    : '#extension GL_OES_standard_derivatives : enable\nprecision highp float;\n'
  const wyjscie = webgl2 ? 'fragColor' : 'gl_FragColor'

  return `${naglowek}

uniform vec2 uResolution;
uniform vec3 uBlob[${String(MAX_BLOBS)}];
uniform int uCount;
uniform vec3 uColor;
uniform float uSmoothness;

// Promień awaryjny, gdyby żadna bańka nie zdążyła się zgłosić.
const float SPHERE_RADIUS = 0.26;

void main() {
  // Normalizacja do krótszego boku — bańki zostają okrągłe niezależnie
  // od proporcji okna.
  float minSide = min(uResolution.x, uResolution.y);
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / minSide;

  float d = 0.0;

  // Gradient pola liczymy analitycznie, razem z samym polem, a nie z
  // pochodnych ekranowych. Po sklejeniu przez smin długość gradientu przy
  // szyjce i w środkach kul spada prawie do zera, więc normalizacja takiego
  // wektora wzmacniała szum — na kształcie wychodziły wypustki, najmocniej
  // w miejscach łączenia. Dla okręgu gradient jest znany wprost, a przy
  // sklejaniu miesza się tą samą wagą h, którą miesza się odległości.
  vec2 grad = vec2(0.0, 1.0);

  // Promień odniesienia dla cieniowania: średnia ważona bliskością. Wybór
  // skokiem — „promień najbliższej bańki" — zostawiał płaskie fasetki.
  float weightSum = 0.0;
  float radiusSum = 0.0;

  for (int i = 0; i < ${String(MAX_BLOBS)}; i++) {
    if (i >= uCount) { break; }

    vec2 offset = uv - uBlob[i].xy;
    float dist = max(length(offset), 1e-5);
    float di = dist - uBlob[i].z;
    vec2 gi = offset / dist;

    if (i == 0) {
      d = di;
      grad = gi;
    } else {
      // Siłę zlewania skalujemy promieniem bańki, ale z dolnym progiem.
      // Przy stałym k mała bańka — promień rzędu 0,01 przy k równym 0,18 —
      // była wyciągana w kroplę w stronę dużej sąsiadki. Przy k za małym
      // przestawała się z nią zlewać i sterczała guzkiem; próg trzyma
      // złączenie miękkim.
      float k = uSmoothness * clamp(uBlob[i].z / 0.16, 0.55, 1.0);
      float h = clamp(0.5 + 0.5 * (di - d) / k, 0.0, 1.0);
      d = mix(di, d, h) - k * h * (1.0 - h);
      // Do mieszania gradientu bierzemy wagę wyostrzoną. Przy zwykłym h
      // bańka schowana w większej zostawiała na jej powierzchni wgłębienie:
      // wagi 0,99 nie wystarczało, żeby jej gradient zniknął bez śladu.
      float hg = h * h * (3.0 - 2.0 * h);
      grad = normalize(mix(gi, grad, hg));
    }

    float weight = exp(-clamp(di, -1.0, 3.0) / 0.10);
    weightSum += weight;
    radiusSum += weight * uBlob[i].z;
  }

  float radius = weightSum > 0.0 ? radiusSum / weightSum : SPHERE_RADIUS;

  // Krawędź szerokości jednego piksela, bez rozmycia.
  float aa = fwidth(d) * 1.5;
  float mask = 1.0 - smoothstep(0.0, max(aa, 1e-5), d);

  // Cieniowanie liczone z normalnej kopuły rozpiętej nad kształtem, a nie
  // wprost z gradientu pola. Sam gradient ma w środku okręgu nieciągłość
  // i zostawiał tam ciemny stożek; kopuła w środku patrzy prosto na widza,
  // więc środek wychodzi neutralny, a cieniowanie rośnie ku krawędzi —
  // dokładnie jak na kuli.
  // Normalna liczona tak jak na kuli: składowa pozioma to odległość od
  // środka podzielona przez promień, więc w samym środku wynosi zero.
  // To usuwa szew, który zostawał, gdy gradient mnożyło się przez stałą —
  // przy stałym mnożniku obrót gradientu o 360° był widoczny.
  float t = clamp(1.0 + d / max(radius, 0.02), 0.0, 1.0);
  vec3 normal = normalize(vec3(grad * t, sqrt(max(1e-4, 1.0 - t * t))));

  vec3 lightDir = normalize(vec3(-0.45, 0.62, 0.66));
  float lambert = clamp(0.5 + 0.62 * dot(normal, lightDir), 0.0, 1.0);

  vec3 light = uColor;
  vec3 dark = uColor * 0.42;
  vec3 rgb = mix(dark, light, lambert);

  // Delikatne przyciemnienie w głąb kształtu, żeby środek nie był płaski.
  float depth = clamp(-d * 1.4, 0.0, 1.0);
  rgb = mix(rgb, rgb * 0.88, depth * 0.45);

  // Winieta przyciemniająca środek ekranu — tam stoi karta logowania
  // i tekst musi zostać czytelny, gdy przepłynie pod nim jasna bańka.
  float fromCenter = length(uv);
  float vignette = smoothstep(0.10, 0.62, fromCenter);
  rgb = mix(rgb * 0.34, rgb, vignette);

  ${wyjscie} = vec4(rgb, mask);
}
`
}

/** Zamiana `#rrggbb` na trójkę 0–1. Zły zapis daje kolor domyślny. */
function parseColor(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const value = match?.[1] ?? 'c0a3d6'

  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (shader === null) return null

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    gl.deleteShader(shader)
    return null
  }

  return shader
}

/**
 * Tło zastępcze, gdy WebGL jest niedostępny albo kontekst przepadł
 * bezpowrotnie. Statyczne, bez animacji — ma nie zostawiać czarnej dziury,
 * a nie udawać wersji pełnej.
 */
function CssFallback({ color, className }: { color: string; className?: string }) {
  const plamy = [
    { top: '12%', left: '8%', size: '46vmin', opacity: 0.5 },
    { top: '48%', left: '68%', size: '58vmin', opacity: 0.42 },
    { top: '72%', left: '22%', size: '38vmin', opacity: 0.34 },
    { top: '4%', left: '74%', size: '30vmin', opacity: 0.28 },
  ]

  return (
    <div aria-hidden="true" className={`pointer-events-none fixed inset-0 ${className ?? ''}`}>
      {plamy.map((plama) => (
        <div
          key={`${plama.top}-${plama.left}`}
          style={{
            position: 'absolute',
            top: plama.top,
            left: plama.left,
            width: plama.size,
            height: plama.size,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${color} 0%, transparent 68%)`,
            opacity: plama.opacity,
            filter: 'blur(28px)',
          }}
        />
      ))}
    </div>
  )
}

function resolveSettings(
  color: string,
  blobCount: number,
  speed: number,
  smoothness: number,
  parallaxStrength: number,
): Settings {
  return {
    count: Math.round(clamp(blobCount, 1, MAX_BLOBS)),
    tempo: clamp(speed, 0, 4),
    k: clamp(smoothness, 0.01, 0.6),
    parallaxScale: clamp(parallaxStrength, 0, 3),
    rgb: parseColor(color),
  }
}

export function MetaballBackground({
  color = '#c0a3d6',
  blobCount = 10,
  speed = 1,
  smoothness = 0.16,
  parallaxStrength = 1,
  className,
}: MetaballBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

  // Propsy czytamy z referencji, a nie z zależności efektu. Gdyby stały
  // w zależnościach, zmiana dowolnego z nich zabiłaby kontekst przez
  // `loseContext()` i canvas zostałby pusty — kontekst ma powstać raz.
  const settingsRef = useRef<Settings>(
    resolveSettings(color, blobCount, speed, smoothness, parallaxStrength),
  )

  // Przerysowanie pojedynczej klatki, gdy pętla stoi (ruch wyłączony
  // albo karta w tle), a propsy się zmieniły.
  const redrawRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    settingsRef.current = resolveSettings(color, blobCount, speed, smoothness, parallaxStrength)
    redrawRef.current?.()
  }, [color, blobCount, speed, smoothness, parallaxStrength])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const coarsePointer = window.matchMedia('(hover: none)').matches

    let gl: WebGLRenderingContext | null = null
    let program: WebGLProgram | null = null
    let buffer: WebGLBuffer | null = null
    let frame = 0
    let running = true

    // Czas własny animacji. Nie liczymy go z zegara ściennego, więc powrót
    // do karty po godzinie nie przesuwa baniek skokiem.
    let clock = 0
    let lastFrameAt = 0

    const targetPointer = { x: 0, y: 0 }
    const currentPointer = { x: 0, y: 0 }

    const uniforms: {
      resolution: WebGLUniformLocation | null
      blob: WebGLUniformLocation | null
      count: WebGLUniformLocation | null
      color: WebGLUniformLocation | null
      smoothness: WebGLUniformLocation | null
    } = { resolution: null, blob: null, count: null, color: null, smoothness: null }

    const blobData = new Float32Array(MAX_BLOBS * 3)

    function setup(): boolean {
      const kontekst =
        (canvas!.getContext('webgl2', {
          alpha: true,
          antialias: false,
          premultipliedAlpha: false,
        }) as WebGLRenderingContext | null) ??
        (canvas!.getContext('webgl', {
          alpha: true,
          antialias: false,
          premultipliedAlpha: false,
        }) as WebGLRenderingContext | null)

      if (kontekst === null) return false
      gl = kontekst

      const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext

      // W WebGL 1 pochodne trzeba włączyć rozszerzeniem. Bez niego krawędź
      // baniek byłaby postrzępiona — wtedy wolimy tło zastępcze.
      if (!webgl2 && gl.getExtension('OES_standard_derivatives') === null) return false

      const vs = compile(gl, gl.VERTEX_SHADER, vertexShader(webgl2))
      const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentShader(webgl2))
      if (vs === null || fs === null) return false

      const prog = gl.createProgram()
      if (prog === null) return false

      gl.attachShader(prog, vs)
      gl.attachShader(prog, fs)
      gl.linkProgram(prog)
      gl.deleteShader(vs)
      gl.deleteShader(fs)

      if (gl.getProgramParameter(prog, gl.LINK_STATUS) !== true) return false

      program = prog
      gl.useProgram(prog)

      // Jeden trójkąt przykrywający cały ekran. Trzy wierzchołki, zero
      // geometrii — reszta dzieje się w shaderze.
      buffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

      const position = gl.getAttribLocation(prog, 'aPosition')
      gl.enableVertexAttribArray(position)
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

      uniforms.resolution = gl.getUniformLocation(prog, 'uResolution')
      uniforms.blob = gl.getUniformLocation(prog, 'uBlob')
      uniforms.count = gl.getUniformLocation(prog, 'uCount')
      uniforms.color = gl.getUniformLocation(prog, 'uColor')
      uniforms.smoothness = gl.getUniformLocation(prog, 'uSmoothness')

      return true
    }

    function resize(): void {
      if (gl === null || canvas === null) return

      const dpr = Math.min(window.devicePixelRatio, 2)
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr))

      // Rozmiar bufora zmieniamy tylko wtedy, gdy naprawdę się zmienił —
      // przypisanie czyści canvas. Ale viewport i rozdzielczość ustawiamy
      // za każdym razem: po odzyskaniu kontekstu program jest nowy i nie zna
      // jeszcze żadnego uniformu, a zerowa rozdzielczość rozlewała maskę
      // na cały ekran.
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }

      gl.viewport(0, 0, width, height)
      gl.uniform2f(uniforms.resolution, width, height)
    }

    /** Krótszy bok kadru — jednostka, w której liczone jest całe pole. */
    function minSide(): number {
      return canvas === null ? 1 : Math.max(1, Math.min(canvas.clientWidth, canvas.clientHeight))
    }

    /** Największe dopuszczalne wychylenie od kursora: 4% szerokości okna. */
    function maxShift(): number {
      return canvas === null ? 0 : (0.04 * canvas.clientWidth) / minSide()
    }

    function draw(): void {
      if (gl === null) return

      const { count, k, parallaxScale, rgb } = settingsRef.current
      const limit = maxShift()

      // Bańki trzymają się prawej krawędzi, a nie środka kadru — inaczej na
      // szerokim ekranie zjeżdżałyby na środek, wprost pod kartę logowania.
      // Na wąskich ekranach odsunięcia ściskamy, żeby „po prawej" znaczyło
      // to samo na telefonie co na ultrawide.
      const halfWidth = canvas === null ? 0.8 : canvas.clientWidth / (2 * minSide())
      const ciasnota = Math.min(1, halfWidth / 0.8)

      gl.uniform3f(uniforms.color, rgb[0], rgb[1], rgb[2])
      gl.uniform1i(uniforms.count, count)
      gl.uniform1f(uniforms.smoothness, k)

      for (let i = 0; i < count; i += 1) {
        const b = BLOBS[i]!

        const x =
          halfWidth - b.insetX * ciasnota +
          b.ampX[0] * Math.sin(clock * b.freqX[0] + b.phaseX) +
          b.ampX[1] * Math.sin(clock * b.freqX[1] + b.phaseX * 1.7) +
          b.ampX[2] * Math.sin(clock * b.freqX[2] + b.phaseX * 2.3)

        const y =
          b.baseY +
          b.ampY[0] * Math.sin(clock * b.freqY[0] + b.phaseY) +
          b.ampY[1] * Math.sin(clock * b.freqY[1] + b.phaseY * 1.3) +
          b.ampY[2] * Math.sin(clock * b.freqY[2] + b.phaseY * 2.9)

        // Paralaksa: każda bańka ma własną głębię, większe reagują mocniej.
        // Ograniczamy długość wektora, a nie każdą oś z osobna — przy
        // ograniczaniu osobno wychylenie po przekątnej przekraczało limit
        // o czterdzieści procent.
        let shiftX = currentPointer.x * b.parallax * parallaxScale
        let shiftY = currentPointer.y * b.parallax * parallaxScale
        const dlugosc = Math.hypot(shiftX, shiftY)

        if (dlugosc > limit && dlugosc > 0) {
          shiftX = (shiftX / dlugosc) * limit
          shiftY = (shiftY / dlugosc) * limit
        }

        blobData[i * 3] = x + shiftX
        blobData[i * 3 + 1] = y + shiftY
        blobData[i * 3 + 2] = b.radius
      }

      gl.uniform3fv(uniforms.blob, blobData)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    function loop(now: number): void {
      if (!running) return

      // Delta liczona od poprzedniej klatki, przycięta — po powrocie
      // z tła nie robi skoku.
      const delta = lastFrameAt === 0 ? 0 : Math.min((now - lastFrameAt) / 1000, 0.05)
      lastFrameAt = now
      clock += delta * settingsRef.current.tempo

      // Dochodzenie do celu liczone od czasu, nie od liczby klatek. Stały
      // ułamek na klatkę sprawiał, że na ekranie 120 Hz kursor doganiał tło
      // dwa razy szybciej niż na 60 Hz. Stała czasowa 0,25 s daje pełne
      // dojście w okolicach 0,75 s niezależnie od odświeżania.
      const ease = 1 - Math.exp(-delta / 0.25)
      currentPointer.x += (targetPointer.x - currentPointer.x) * ease
      currentPointer.y += (targetPointer.y - currentPointer.y) * ease

      draw()
      frame = window.requestAnimationFrame(loop)
    }

    function onPointerMove(event: PointerEvent): void {
      if (coarsePointer) return

      targetPointer.x = (event.clientX / window.innerWidth) * 2 - 1
      targetPointer.y = 1 - (event.clientY / window.innerHeight) * 2
    }

    function onPointerLeave(): void {
      targetPointer.x = 0
      targetPointer.y = 0
    }

    function onVisibility(): void {
      if (document.hidden) {
        running = false
        window.cancelAnimationFrame(frame)
        return
      }

      if (!reducedMotion && !running) {
        running = true
        // Zerujemy znacznik, żeby pierwsza delta po powrocie wyszła zerowa.
        lastFrameAt = 0
        frame = window.requestAnimationFrame(loop)
      }
    }

    function onContextLost(event: Event): void {
      event.preventDefault()
      running = false
      window.cancelAnimationFrame(frame)
    }

    function onContextRestored(): void {
      if (setup()) {
        resize()
        if (reducedMotion) {
          draw()
          return
        }
        running = true
        lastFrameAt = 0
        frame = window.requestAnimationFrame(loop)
      } else {
        setFailed(true)
      }
    }

    if (!setup()) {
      setFailed(true)
      return
    }

    resize()

    const observer = new ResizeObserver(() => {
      resize()
      // Przy zatrzymanej pętli trzeba przerysować ręcznie, inaczej po
      // zmianie rozmiaru zostałby obraz w starej rozdzielczości.
      if (!running || reducedMotion) draw()
    })
    observer.observe(canvas)

    redrawRef.current = () => {
      if (!running) draw()
    }

    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)
    document.addEventListener('visibilitychange', onVisibility)

    if (!coarsePointer) {
      window.addEventListener('pointermove', onPointerMove, { passive: true })
      window.addEventListener('pointerleave', onPointerLeave)
      window.addEventListener('blur', onPointerLeave)
    }

    if (reducedMotion) {
      // Jedna klatka i koniec. Kompozycja stoi w chwili, w której bańki
      // są rozłożone po całym kadrze, a nie zbite w rogu.
      clock = 9
      running = false
      draw()
    } else {
      frame = window.requestAnimationFrame(loop)
    }

    return () => {
      running = false
      redrawRef.current = null
      window.cancelAnimationFrame(frame)
      observer.disconnect()

      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerleave', onPointerLeave)
      window.removeEventListener('blur', onPointerLeave)

      if (gl !== null) {
        if (buffer !== null) gl.deleteBuffer(buffer)
        if (program !== null) gl.deleteProgram(program)
        gl.getExtension('WEBGL_lose_context')?.loseContext()
      }

      gl = null
      program = null
      buffer = null
    }
    // Pusto celowo: kontekst WebGL powstaje raz na cały czas życia
    // komponentu, a propsy docierają przez `settingsRef`.
  }, [])

  if (failed) return <CssFallback color={color} className={className} />

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 h-full w-full ${className ?? ''}`}
    />
  )
}
