@Observed
export class SolveResult {
  sessionId: number;
  order: number;
  durationMs: number;
  moves: number;
  challengeIndex: number;
  assisted: boolean;

  constructor(sessionId: number = -1, order: number = 3, durationMs: number = 0, moves: number = 0,
    challengeIndex: number = -1, assisted: boolean = false) {
    this.sessionId = sessionId;
    this.order = order;
    this.durationMs = durationMs;
    this.moves = moves;
    this.challengeIndex = challengeIndex;
    this.assisted = assisted;
  }
}
