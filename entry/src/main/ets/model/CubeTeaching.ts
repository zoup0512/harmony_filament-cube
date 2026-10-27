import { CubeModel, CubeMove } from './CubeModel';

/** A fixed legal position, not a prescribed solution or an optimal-move target. */
export class TeachingChallenge {
  readonly id: string;
  readonly order: number;
  readonly titleKey: string;
  readonly descriptionKey: string;
  readonly tipKey: string;
  readonly difficulty: number;
  /** Number of quarter turns in the setup, including both turns of a half turn. */
  readonly referenceMoves: number;
  private readonly initialMoves: CubeMove[];

  constructor(id: string, order: number, keyPrefix: string, difficulty: number, moves: CubeMove[]) {
    if (order !== 2 && order !== 3) {
      throw new RangeError('Teaching challenges use order 2 or 3.');
    }
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 3) {
      throw new RangeError('Teaching difficulty must be an integer from 1 through 3.');
    }
    this.id = id;
    this.order = order;
    this.titleKey = keyPrefix + '_title';
    this.descriptionKey = keyPrefix + '_description';
    this.tipKey = keyPrefix + '_tip';
    this.difficulty = difficulty;
    this.initialMoves = [];
    for (const move of moves) {
      const copy: CubeMove = new CubeMove(move.axis, move.layer, move.turns);
      if (copy.layer >= order) {
        throw new RangeError('Teaching setup layer is outside this cube.');
      }
      this.initialMoves.push(copy);
    }
    this.referenceMoves = this.initialMoves.length;
  }

  load(model: CubeModel): void {
    model.reset(this.order);
    for (const move of this.initialMoves) {
      model.applyMove(move, false);
    }
  }

  setupMoves(): CubeMove[] {
    const moves: CubeMove[] = [];
    for (const move of this.initialMoves) {
      moves.push(new CubeMove(move.axis, move.layer, move.turns));
    }
    return moves;
  }
}

/** Fresh catalogue and move objects on every call; no random scrambles or unlock state. */
export function createTeachingChallenges(): TeachingChallenge[] {
  // Singmaster clockwise, viewed from outside, is -90 on the positive outer face.
  const right2: CubeMove = new CubeMove('x', 1, -1);
  const up2: CubeMove = new CubeMove('y', 1, -1);
  const right3: CubeMove = new CubeMove('x', 2, -1);
  const up3: CubeMove = new CubeMove('y', 2, -1);
  const front3: CubeMove = new CubeMove('z', 2, -1);
  return [
    new TeachingChallenge('first-turn', 2, 'teaching_first_turn', 1, [right2]),
    new TeachingChallenge('corner-pair', 2, 'teaching_corner_pair', 1, [right2, up2]),
    new TeachingChallenge('corner-loop', 2, 'teaching_corner_loop', 2,
      [right2, up2, right2.inverse(), up2.inverse()]),
    new TeachingChallenge('last-layer', 3, 'teaching_last_layer', 1, [up3]),
    new TeachingChallenge('right-slot', 3, 'teaching_right_slot', 2,
      [right3, up3, right3.inverse()]),
    // F R U R' U' F': bottom two layers intact, top edges form an L, not a cross yet.
    new TeachingChallenge('cross-return', 3, 'teaching_cross_return', 2,
      [front3, right3, up3, right3.inverse(), up3.inverse(), front3.inverse()]),
    // R U R' U R U2 R': a Sune-type orientation case, also permuting top-layer pieces.
    new TeachingChallenge('corner-orient', 3, 'teaching_corner_orient', 3,
      [right3, up3, right3.inverse(), up3, right3, up3, up3, right3.inverse()]),
    // R U' R U R U R U' R' U' R2: only three top edges cycle; corners stay solved.
    new TeachingChallenge('edge-cycle', 3, 'teaching_edge_cycle', 3,
      [right3, up3.inverse(), right3, up3, right3, up3, right3,
        up3.inverse(), right3.inverse(), up3.inverse(), right3, right3])
  ];
}
