/** Bod v mm. Počátek vlevo dole, osa Y nahoru. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Uzavřený lomený obrys. Poslední bod se neopakuje (uzavření je implicitní).
 * Vnější obrys CCW, otvor CW.
 */
export type Ring = readonly Point[];

/** Polygon s otvory – aproximace tvaru pro výpočet. */
export interface Polygon {
  readonly outer: Ring;
  readonly holes: readonly Ring[];
}

/** Osově rovnoběžný obdélník, (x, y) = levý dolní roh. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Vrchol obrysu s obloukem k dalšímu vrcholu (jako LWPOLYLINE v DXF).
 * `bulge` = tan(θ/4), θ = středový úhel oblouku; 0 = úsečka, kladný = CCW.
 */
export interface ContourVertex {
  readonly x: number;
  readonly y: number;
  readonly bulge: number;
}

/**
 * Uzavřený obrys z úseček a oblouků – původní geometrie pro náhled a export.
 * Poslední vrchol navazuje na první (uzavření je implicitní); bulge vrcholu `i`
 * platí pro segment `i → i+1`.
 *
 * - Oblouk přes 180° má |bulge| > 1. Plný kruh = 2 vrcholy na průměru,
 *   oba s bulge 1 (CCW, vnější obrys) nebo −1 (CW, otvor).
 * - Plocha a orientace se počítají včetně kruhových úsečí (`contourSignedArea`).
 * - Obrácení orientace (`reverseContour`) neguje bulge a přesouvá ho
 *   na protější vrchol segmentu.
 */
export type Contour = readonly ContourVertex[];
