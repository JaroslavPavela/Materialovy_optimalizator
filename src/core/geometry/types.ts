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
 * Poslední vrchol navazuje na první (uzavření je implicitní).
 */
export type Contour = readonly ContourVertex[];
