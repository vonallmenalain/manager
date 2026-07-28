/**
 * Entzerrung: aus dem schräg fotografierten Viereck wird ein rechteckiges Blatt.
 *
 * Gerechnet wird rückwärts – für jeden Bildpunkt des Ergebnisses wird die
 * Stelle im Foto gesucht, die dort hingehört. Vorwärts (jeden Punkt des Fotos
 * an seinen neuen Platz schieben) blieben Lücken, weil eine Streckung mehr
 * Zielpunkte hat als Quellpunkte.
 */
import {
  applyHomography,
  polygonArea,
  solveHomography,
  type Quad,
  type Raster,
} from './geometry.ts'

/**
 * Legt den Inhalt des Vierecks auf ein Rechteck der angegebenen Grösse.
 *
 * Zwischen den Bildpunkten wird bilinear gemittelt: Ohne diese Mittelung
 * bekäme feine Schrift bei jeder Drehung eine ausgefranste Treppe, die auch
 * die Texterkennung sichtbar schlechter liest.
 */
export function warpToRect(
  source: Raster,
  quad: Quad,
  width: number,
  height: number,
): Raster | null {
  // Ein Viereck ohne Fläche entsteht beim Zurechtziehen von Hand, wenn alle
  // Griffe auf einer Linie landen. Rechnerisch liesse sich die Abbildung noch
  // lösen, herauskommen würde ein leeres Bild.
  if (width < 1 || height < 1 || polygonArea(quad) < 1) return null

  const destination: Quad = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ]

  const homography = solveHomography(destination, quad)
  if (!homography) return null

  const output = new Uint8ClampedArray(width * height * 4)
  const input = source.data
  const sourceWidth = source.width
  const sourceHeight = source.height
  const at = (index: number): number => input[index] as number

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Auf die Mitte des Bildpunktes zielen, nicht auf seine Ecke – sonst
      // wandert das Ergebnis um einen halben Punkt nach links oben.
      const point = applyHomography(homography, { x: x + 0.5, y: y + 0.5 })

      const sx = Math.min(Math.max(point.x - 0.5, 0), sourceWidth - 1)
      const sy = Math.min(Math.max(point.y - 0.5, 0), sourceHeight - 1)

      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const x1 = Math.min(x0 + 1, sourceWidth - 1)
      const y1 = Math.min(y0 + 1, sourceHeight - 1)
      const fx = sx - x0
      const fy = sy - y0

      const topLeft = (y0 * sourceWidth + x0) * 4
      const topRight = (y0 * sourceWidth + x1) * 4
      const bottomLeft = (y1 * sourceWidth + x0) * 4
      const bottomRight = (y1 * sourceWidth + x1) * 4
      const target = (y * width + x) * 4

      for (let channel = 0; channel < 3; channel += 1) {
        const top = at(topLeft + channel) + (at(topRight + channel) - at(topLeft + channel)) * fx
        const bottom =
          at(bottomLeft + channel) + (at(bottomRight + channel) - at(bottomLeft + channel)) * fx
        output[target + channel] = top + (bottom - top) * fy
      }
      output[target + 3] = 255
    }
  }

  return { data: output, width, height }
}
