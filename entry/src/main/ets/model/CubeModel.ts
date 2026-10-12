/** Axes use a right-handed frame: x right, y up, z toward the viewer. */
export type CubeAxis = 'x' | 'y' | 'z';

/** Fixed face colors in the reset orientation. */
export class CubeColors {
  static readonly RIGHT: string = '#D32F2F';
  static readonly LEFT: string = '#FF8F00';
  static readonly UP: string = '#FFFFFF';
  static readonly DOWN: string = '#FFD600';
  static readonly FRONT: string = '#00A651';
  static readonly BACK: string = '#1565C0';
}

function validateOrder(order: number): void {
  if (!Number.isInteger(order) || order < 2 || order > 7) {
    throw new RangeError('Cube order must be an integer from 2 through 7.');
  }
}

function validateAxis(axis: CubeAxis): void {
  if (axis !== 'x' && axis !== 'y' && axis !== 'z') {
    throw new RangeError('Move axis must be x, y, or z.');
  }
}

/**
 * One quarter turn, with a zero-based layer index (0..order-1).
 * turns=+1 means +90 degrees by the right-hand rule; -1 means -90.
 * Half turns must be represented as two quarter turns.
 */
export class CubeMove {
  readonly axis: CubeAxis;
  readonly layer: number;
  readonly turns: number;

  constructor(axis: CubeAxis, layer: number, turns: number) {
    validateAxis(axis);
    if (!Number.isSafeInteger(layer) || layer < 0) {
      throw new RangeError('Move layer must be a nonnegative integer.');
    }
    if (turns !== 1 && turns !== -1) {
      throw new RangeError('Move turns must be +1 or -1.');
    }
    this.axis = axis;
    this.layer = layer;
    this.turns = turns;
  }

  inverse(): CubeMove {
    return new CubeMove(this.axis, this.layer, -this.turns);
  }

  /**
   * Outer faces use Singmaster R/L/U/D/F/B, clockwise viewed from outside.
   * Inner layers use X[index], Y[index], Z[index]: bare means +90 degrees,
   * prime means -90 degrees. The inner index is zero-based, not a wide turn.
   */
  label(order: number): string {
    validateOrder(order);
    if (this.layer >= order) {
      throw new RangeError('Move layer is outside this cube.');
    }
    let face: string = '';
    let clockwise: number = 1;
    if (this.layer === 0) {
      if (this.axis === 'x') {
        face = 'L';
      } else if (this.axis === 'y') {
        face = 'D';
      } else {
        face = 'B';
      }
    } else if (this.layer === order - 1) {
      clockwise = -1;
      if (this.axis === 'x') {
        face = 'R';
      } else if (this.axis === 'y') {
        face = 'U';
      } else {
        face = 'F';
      }
    } else {
      face = this.axis.toUpperCase() + '[' + this.layer.toString() + ']';
    }
    return face + (this.turns === clockwise ? '' : "'");
  }
}

/** An exact integer unit normal in current world coordinates and a fixed color. */
export class Sticker {
  nx: number;
  ny: number;
  nz: number;
  readonly color: string;

  constructor(nx: number, ny: number, nz: number, color: string) {
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.color = color;
  }
}

/**
 * Stable identity; positions are integer grid indices, NOT centered coordinates.
 * Render position = index - (order - 1) / 2 on each axis.
 * UI consumers must treat cubies, positions, and stickers as read-only.
 */
export class Cubelet {
  readonly id: string;
  x: number;
  y: number;
  z: number;
  readonly stickers: Sticker[];

  constructor(id: string, x: number, y: number, z: number, stickers: Sticker[]) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.z = z;
    this.stickers = stickers;
  }
}

/**
 * Exact 2..7-order cube; all order^3 cubies are present, including invisible ones.
 *
 * Animation contract: read the CURRENT cubies, select coordinate === move.layer,
 * render a transient rotation of move.turns * progress * PI/2 around that axis,
 * then call applyMove exactly once at progress=1. The core never stores fractions.
 * Cubelet identities and object references survive turns, but not reset().
 *
 * History semantics:
 * - applyMove(move, true): one user operation, undoable and counted.
 * - applyMove(move, false): uncounted setup/scramble/solution turn. Establishes a
 *   new user-history baseline (clears undo AND redo), but keeps the actual log.
 * - undo/redo: execute an inverse/original turn without making a new user entry.
 * - moveCount: current undo-stack length, excluding undone operations.
 * - Every executed turn, including false/undo/redo, enters the actual log.
 * - getSolution(): cancels adjacent same-axis/same-layer inverse pairs in a
 *   temporary stack, then returns its inverse, newest first. The actual log is
 *   unchanged. Executing the first hint reduces the next solution length by one.
 *   This is a history retrace, not an optimal solver; other identities (such as
 *   four equal quarter turns) are not simplified, even when the cube is solved.
 * - reset(): solved state and empty histories; invalid reset leaves state intact.
 * - createScramble(): generates only; use applyMove(move, false) to execute.
 */
export class CubeModel {
  private orderValue: number = 3;
  private cubieValues: Cubelet[] = [];
  private undoMoves: CubeMove[] = [];
  private redoMoves: CubeMove[] = [];
  private actualMoves: CubeMove[] = [];
  private readonly randomSource: () => number;

  constructor(order: number, random: () => number = Math.random) {
    if (typeof random !== 'function') {
      throw new TypeError('Random source must be a function returning [0, 1).');
    }
    this.randomSource = random;
    this.reset(order);
  }

  get order(): number {
    return this.orderValue;
  }

  get cubies(): Cubelet[] {
    return this.cubieValues;
  }

  get moveCount(): number {
    return this.undoMoves.length;
  }

  applyMove(move: CubeMove, record: boolean = true): void {
    if (!(move instanceof CubeMove)) {
      throw new TypeError('Expected a CubeMove instance.');
    }
    if (typeof record !== 'boolean') {
      throw new TypeError('record must be a boolean.');
    }
    // Copy and validate before touching either state or history. Do not retain
    // caller-owned moves: JS callers could mutate a TypeScript readonly field.
    const stored: CubeMove = new CubeMove(move.axis, move.layer, move.turns);
    if (stored.layer >= this.orderValue) {
      throw new RangeError('Move layer is outside this cube.');
    }
    this.execute(stored);
    this.redoMoves = [];
    if (record) {
      this.undoMoves.push(stored);
    } else {
      this.undoMoves = [];
    }
  }

  /** Returns the actual inverse move executed, or null if no user move remains. */
  undo(): CubeMove | null {
    const original: CubeMove | undefined = this.undoMoves.pop();
    if (original === undefined) {
      return null;
    }
    const inverse: CubeMove = original.inverse();
    this.execute(inverse);
    this.redoMoves.push(original);
    return new CubeMove(inverse.axis, inverse.layer, inverse.turns);
  }

  /** Returns the actual original move executed, or null if redo is unavailable. */
  redo(): CubeMove | null {
    const original: CubeMove | undefined = this.redoMoves.pop();
    if (original === undefined) {
      return null;
    }
    this.execute(original);
    this.undoMoves.push(original);
    return new CubeMove(original.axis, original.layer, original.turns);
  }

  reset(order: number = this.orderValue): void {
    validateOrder(order);
    const cubies: Cubelet[] = [];
    const last: number = order - 1;
    for (let x: number = 0; x < order; x++) {
      for (let y: number = 0; y < order; y++) {
        for (let z: number = 0; z < order; z++) {
          const stickers: Sticker[] = [];
          if (x === last) {
            stickers.push(new Sticker(1, 0, 0, CubeColors.RIGHT));
          }
          if (x === 0) {
            stickers.push(new Sticker(-1, 0, 0, CubeColors.LEFT));
          }
          if (y === last) {
            stickers.push(new Sticker(0, 1, 0, CubeColors.UP));
          }
          if (y === 0) {
            stickers.push(new Sticker(0, -1, 0, CubeColors.DOWN));
          }
          if (z === last) {
            stickers.push(new Sticker(0, 0, 1, CubeColors.FRONT));
          }
          if (z === 0) {
            stickers.push(new Sticker(0, 0, -1, CubeColors.BACK));
          }
          const id: string = x.toString() + ':' + y.toString() + ':' + z.toString();
          cubies.push(new Cubelet(id, x, y, z, stickers));
        }
      }
    }
    this.orderValue = order;
    this.cubieValues = cubies;
    this.undoMoves = [];
    this.redoMoves = [];
    this.actualMoves = [];
  }

  /** Face-uniformity, not comparison with original face colors or cubie IDs. */
  isSolved(): boolean {
    return this.faceUniform(1, 0, 0) && this.faceUniform(-1, 0, 0) &&
      this.faceUniform(0, 1, 0) && this.faceUniform(0, -1, 0) &&
      this.faceUniform(0, 0, 1) && this.faceUniform(0, 0, -1);
  }

  getSolution(): CubeMove[] {
    const reduced: CubeMove[] = [];
    for (const move of this.actualMoves) {
      // Pop to inspect the top without dynamic indexing. Cascading inverse
      // pairs disappear naturally as subsequent moves meet the remaining top.
      const previous: CubeMove | undefined = reduced.pop();
      if (previous !== undefined) {
        if (previous.axis === move.axis && previous.layer === move.layer &&
          previous.turns === -move.turns) {
          continue;
        }
        reduced.push(previous);
      }
      reduced.push(move);
    }
    const solution: CubeMove[] = [];
    for (const move of reduced) {
      solution.push(move.inverse());
    }
    solution.reverse();
    return solution;
  }

  /**
   * Uniformly selects an axis/layer other than the previous one, then a sign.
   * Exactly two random draws per move, no rejection loop (constant RNG is safe).
   * Inject a deterministic source as new CubeModel(order, randomFunction).
   * RNG must return finite numbers in [0,1); invalid output throws, no state change.
   */
  createScramble(count: number): CubeMove[] {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError('Scramble count must be a nonnegative safe integer.');
    }
    const moves: CubeMove[] = [];
    let previousSlot: number = -1;
    for (let i: number = 0; i < count; i++) {
      const choices: number = this.orderValue * 3 - (previousSlot < 0 ? 0 : 1);
      let slot: number = Math.floor(this.randomUnit() * choices);
      if (previousSlot >= 0 && slot >= previousSlot) {
        slot++;
      }
      let axis: CubeAxis = 'x';
      if (slot >= this.orderValue * 2) {
        axis = 'z';
      } else if (slot >= this.orderValue) {
        axis = 'y';
      }
      const turns: number = this.randomUnit() < 0.5 ? -1 : 1;
      moves.push(new CubeMove(axis, slot % this.orderValue, turns));
      previousSlot = slot;
    }
    return moves;
  }

  private randomUnit(): number {
    const value: number = this.randomSource();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError('Random source must return a finite number in [0, 1).');
    }
    return value;
  }

  private faceUniform(nx: number, ny: number, nz: number): boolean {
    let color: string = '';
    let count: number = 0;
    const last: number = this.orderValue - 1;
    for (const cubie of this.cubieValues) {
      for (const sticker of cubie.stickers) {
        if (sticker.nx !== nx || sticker.ny !== ny || sticker.nz !== nz) {
          continue;
        }
        if ((nx === 1 && cubie.x !== last) || (nx === -1 && cubie.x !== 0) ||
          (ny === 1 && cubie.y !== last) || (ny === -1 && cubie.y !== 0) ||
          (nz === 1 && cubie.z !== last) || (nz === -1 && cubie.z !== 0)) {
          return false;
        }
        if (count === 0) {
          color = sticker.color;
        } else if (color !== sticker.color) {
          return false;
        }
        count++;
      }
    }
    return count === this.orderValue * this.orderValue;
  }

  private execute(move: CubeMove): void {
    const last: number = this.orderValue - 1;
    const positive: boolean = move.turns === 1;
    for (const cubie of this.cubieValues) {
      const selected: boolean = (move.axis === 'x' && cubie.x === move.layer) ||
        (move.axis === 'y' && cubie.y === move.layer) ||
        (move.axis === 'z' && cubie.z === move.layer);
      if (!selected) {
        continue;
      }
      const x: number = cubie.x;
      const y: number = cubie.y;
      const z: number = cubie.z;
      if (move.axis === 'x') {
        cubie.y = positive ? last - z : z;
        cubie.z = positive ? y : last - y;
      } else if (move.axis === 'y') {
        cubie.x = positive ? z : last - z;
        cubie.z = positive ? last - x : x;
      } else {
        cubie.x = positive ? last - y : y;
        cubie.y = positive ? x : last - x;
      }
      for (const sticker of cubie.stickers) {
        const nx: number = sticker.nx;
        const ny: number = sticker.ny;
        const nz: number = sticker.nz;
        if (move.axis === 'x') {
          sticker.ny = positive ? -nz : nz;
          sticker.nz = positive ? ny : -ny;
        } else if (move.axis === 'y') {
          sticker.nx = positive ? nz : -nz;
          sticker.nz = positive ? -nx : nx;
        } else {
          sticker.nx = positive ? -ny : ny;
          sticker.ny = positive ? nx : -nx;
        }
        // Normalize -0 for stable snapshots and strict numeric comparisons.
        if (sticker.nx === 0) {
          sticker.nx = 0;
        }
        if (sticker.ny === 0) {
          sticker.ny = 0;
        }
        if (sticker.nz === 0) {
          sticker.nz = 0;
        }
      }
    }
    this.actualMoves.push(move);
  }
}
