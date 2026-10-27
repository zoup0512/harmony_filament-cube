import { CubeModel, CubeMove, Cubelet, Sticker } from '../model/CubeModel';

// These small classes deliberately avoid DOM geometry and structural object types.
class CubeVector3 {
  x: number;
  y: number;
  z: number;

  constructor(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

class CubePoint2 {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

/** Touch and Canvas logical coordinates; redraw/recompute after any scene change. */
export class CubeSwipeGuide {
  startX: number;
  startY: number;
  endX: number;
  endY: number;

  constructor(startX: number, startY: number, endX: number, endY: number) {
    this.startX = startX;
    this.startY = startY;
    this.endX = endX;
    this.endY = endY;
  }
}

class CubeSurfaceHit {
  point: CubeVector3;
  normal: CubeVector3;
  x: number;
  y: number;
  z: number;

  constructor(point: CubeVector3, normal: CubeVector3, order: number) {
    this.point = point;
    this.normal = normal;
    // Half-open cells assign an exact seam to the higher layer; outer edges clamp.
    this.x = Math.max(0, Math.min(order - 1, Math.floor((point.x + 1) * order / 2)));
    this.y = Math.max(0, Math.min(order - 1, Math.floor((point.y + 1) * order / 2)));
    this.z = Math.max(0, Math.min(order - 1, Math.floor((point.z + 1) * order / 2)));
  }
}

class CubeFaceBasis {
  normal: CubeVector3;
  u: CubeVector3;
  v: CubeVector3;

  constructor(normal: CubeVector3, u: CubeVector3, v: CubeVector3) {
    this.normal = normal;
    this.u = u;
    this.v = v;
  }
}

class CubeVisibleFace {
  cubie: Cubelet;
  x: number;
  y: number;
  z: number;
  normal: CubeVector3;
  cameraNormal: CubeVector3;
  cameraCenter: CubeVector3;
  outline: CubePoint2[];
  sticker: CubePoint2[];
  color: string;

  constructor(cubie: Cubelet, normal: CubeVector3, cameraNormal: CubeVector3,
    cameraCenter: CubeVector3, outline: CubePoint2[], sticker: CubePoint2[], color: string) {
    this.cubie = cubie;
    this.x = cubie.x;
    this.y = cubie.y;
    this.z = cubie.z;
    this.normal = normal;
    this.cameraNormal = cameraNormal;
    this.cameraCenter = cameraCenter;
    this.outline = outline;
    this.sticker = sticker;
    this.color = color;
  }
}

/**
 * Software renderer in Canvas logical units (the same units as touch coordinates).
 * World coordinates: +x right, +y up, +z front. Turns use the right-hand rule.
 * yaw/pitch are camera angles: world-to-camera applies Y(-yaw), then X(-pitch).
 * A negative pitch therefore reveals the top. The caller owns model mutation.
 */
export class CubeRenderer {
  private readonly cameraDistance: number = 6.0;
  private readonly bases: CubeFaceBasis[] = [
    new CubeFaceBasis(new CubeVector3(1, 0, 0), new CubeVector3(0, 1, 0), new CubeVector3(0, 0, 1)),
    new CubeFaceBasis(new CubeVector3(-1, 0, 0), new CubeVector3(0, 1, 0), new CubeVector3(0, 0, -1)),
    new CubeFaceBasis(new CubeVector3(0, 1, 0), new CubeVector3(0, 0, 1), new CubeVector3(1, 0, 0)),
    new CubeFaceBasis(new CubeVector3(0, -1, 0), new CubeVector3(0, 0, 1), new CubeVector3(-1, 0, 0)),
    new CubeFaceBasis(new CubeVector3(0, 0, 1), new CubeVector3(1, 0, 0), new CubeVector3(0, 1, 0)),
    new CubeFaceBasis(new CubeVector3(0, 0, -1), new CubeVector3(-1, 0, 0), new CubeVector3(0, 1, 0))
  ];
  private faces: CubeVisibleFace[] = [];
  private lastModel: CubeModel | null = null;
  private lastOrder: number = 0;
  private width: number = 0;
  private height: number = 0;
  private focal: number = 1;
  private lastYaw: number = 0;
  private lastPitch: number = 0;
  private yawCos: number = 1;
  private yawSin: number = 0;
  private pitchCos: number = 1;
  private pitchSin: number = 0;
  private animating: boolean = false;
  private cachedCubies: Cubelet[] = [];
  private cachedCoordinates: number[] = [];

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, model: CubeModel,
    yaw: number, pitch: number, move: CubeMove | null = null, progress: number = 0,
    zoom: number = 1): void {
    this.faces = [];
    this.lastModel = null;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return;
    }
    ctx.save();
    // Clear rather than painting a backdrop: the ArkUI scene remains visible.
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = 1;
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch) ||
      !Number.isInteger(model.order) || model.order < 1) {
      ctx.restore();
      return;
    }
    this.width = width;
    this.height = height;
    this.focal = Math.min(width, height) * 1.48 *
      (Number.isFinite(zoom) ? Math.max(1, zoom) : 1);
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    this.yawCos = Math.cos(yaw);
    this.yawSin = Math.sin(yaw);
    this.pitchCos = Math.cos(pitch);
    this.pitchSin = Math.sin(pitch);
    this.lastModel = model;
    this.lastOrder = model.order;
    this.animating = move !== null;
    this.cachedCubies = [];
    this.cachedCoordinates = [];
    for (let i: number = 0; i < model.cubies.length; i++) {
      let cubie: Cubelet = model.cubies[i];
      this.cachedCubies.push(cubie);
      this.cachedCoordinates.push(cubie.x, cubie.y, cubie.z);
    }

    let amount: number = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
    let angle: number = move === null ? 0 : move.turns * Math.PI * 0.5 * amount;
    let turnCos: number = Math.cos(angle);
    let turnSin: number = Math.sin(angle);
    let spacing: number = 2 / model.order;
    let middle: number = (model.order - 1) * 0.5;
    // A real gap between plastic cubelets, plus a black border around each sticker.
    let plasticHalf: number = spacing * 0.474;
    let stickerHalf: number = spacing * 0.397;

    for (let i: number = 0; i < model.cubies.length; i++) {
      let cubie: Cubelet = model.cubies[i];
      let center: CubeVector3 = new CubeVector3((cubie.x - middle) * spacing,
        (cubie.y - middle) * spacing, (cubie.z - middle) * spacing);
      let active: boolean = move !== null && this.layerCoordinate(cubie, move.axis) === move.layer;
      for (let j: number = 0; j < this.bases.length; j++) {
        let basis: CubeFaceBasis = this.bases[j];
        let faceCenter: CubeVector3 = new CubeVector3(center.x + basis.normal.x * plasticHalf,
          center.y + basis.normal.y * plasticHalf, center.z + basis.normal.z * plasticHalf);
        let worldCenter: CubeVector3 = faceCenter;
        let worldNormal: CubeVector3 = basis.normal;
        if (active && move !== null) {
          worldCenter = this.rotate(faceCenter, move.axis, turnCos, turnSin);
          worldNormal = this.rotate(basis.normal, move.axis, turnCos, turnSin);
        }
        let cameraCenter: CubeVector3 = this.toCamera(worldCenter);
        let cameraNormal: CubeVector3 = this.toCamera(worldNormal);
        // Perspective back-face test: use the vector to the eye, not only normal.z.
        let facing: number = -cameraCenter.x * cameraNormal.x - cameraCenter.y * cameraNormal.y +
          (this.cameraDistance - cameraCenter.z) * cameraNormal.z;
        if (facing <= 0.000001) {
          continue;
        }
        let color: string = this.stickerColor(cubie, basis.normal);
        let outline: CubePoint2[] = this.faceCorners(faceCenter, basis, plasticHalf,
          active ? move : null, turnCos, turnSin);
        let sticker: CubePoint2[] = [];
        if (color.length > 0) {
          sticker = this.faceCorners(faceCenter, basis, stickerHalf,
            active ? move : null, turnCos, turnSin);
        }
        this.faces.push(new CubeVisibleFace(cubie, basis.normal, cameraNormal,
          cameraCenter, outline, sticker, color));
      }
    }
    // Camera lies at positive Z: lower Z is farther away. Sort ALL cubelet faces,
    // not cubelets, so an animated layer can pass in front of the stationary ones.
    this.faces.sort((a: CubeVisibleFace, b: CubeVisibleFace): number => {
      return a.cameraCenter.z - b.cameraCenter.z;
    });
    ctx.lineJoin = 'round';
    for (let i: number = 0; i < this.faces.length; i++) {
      this.paintFace(ctx, this.faces[i]);
    }
    ctx.restore();
  }

  hitTest(x: number, y: number): boolean {
    // Busy touches on the cube must still enter the UI's BLOCKED state, not
    // accidentally become background-orbit gestures. Only pick/guide need rest.
    return this.cacheIsCurrent(true) && this.boxHit(x, y) !== null;
  }

  pickMove(startX: number, startY: number, endX: number, endY: number,
    model: CubeModel, yaw: number, pitch: number): CubeMove | null {
    // Never infer against stale camera/model geometry or an in-flight layer.
    if (!this.cacheIsCurrent() || this.lastModel !== model || this.lastOrder !== model.order ||
      !Number.isFinite(yaw) || !Number.isFinite(pitch) ||
      Math.abs(yaw - this.lastYaw) > 0.000001 || Math.abs(pitch - this.lastPitch) > 0.000001 ||
      !Number.isFinite(endX) || !Number.isFinite(endY)) {
      return null;
    }
    let hit: CubeSurfaceHit | null = this.boxHit(startX, startY);
    if (hit === null) {
      return null;
    }
    let dx: number = endX - startX;
    let dy: number = endY - startY;
    let dragLength: number = Math.sqrt(dx * dx + dy * dy);
    if (dragLength < Math.max(8, Math.min(this.width, this.height) * 0.016)) {
      return null;
    }
    let axes: string[] = ['x', 'y', 'z'];
    let bestAxis: string = '';
    let bestScore: number = 0;
    let secondScore: number = 0;
    let bestTurns: number = 1;
    for (let i: number = 0; i < axes.length; i++) {
      let axis: string = axes[i];
      // A surface swipe chooses one of its two tangent axes, not the normal axis.
      let normalComponent: number = axis === 'x' ? hit.normal.x :
        (axis === 'y' ? hit.normal.y : hit.normal.z);
      if (Math.abs(normalComponent) > 0.5) {
        continue;
      }
      // Android row/column convention: axis cross face normal, not axis cross
      // hit position. Positive alignment is a positive right-handed quarter turn.
      let tangent: CubePoint2 = this.swipeTangent(hit.point, hit.normal, axis);
      let tx: number = tangent.x;
      let ty: number = tangent.y;
      let tangentLength: number = Math.sqrt(tx * tx + ty * ty);
      if (tangentLength < 0.0001) {
        continue;
      }
      let alignment: number = (dx * tx + dy * ty) / (dragLength * tangentLength);
      let score: number = Math.abs(alignment);
      if (score > bestScore) {
        secondScore = bestScore;
        bestScore = score;
        bestAxis = axis;
        bestTurns = alignment >= 0 ? 1 : -1;
      } else if (score > secondScore) {
        secondScore = score;
      }
    }
    if (bestScore < 0.75 || bestScore - secondScore < 0.15) {
      return null;
    }
    // Construct with literal axis/turn values, compatible with strict union types.
    if (bestAxis === 'x') {
      return new CubeMove('x', hit.x, bestTurns > 0 ? 1 : -1);
    }
    if (bestAxis === 'y') {
      return new CubeMove('y', hit.y, bestTurns > 0 ? 1 : -1);
    }
    if (bestAxis === 'z') {
      return new CubeMove('z', hit.z, bestTurns > 0 ? 1 : -1);
    }
    return null;
  }

  /** Current stable frame only. Null means the UI should ask for another view. */
  getSwipeGuide(move: CubeMove): CubeSwipeGuide | null {
    let model: CubeModel | null = this.lastModel;
    if (model === null || !this.cacheIsCurrent() || move.layer >= model.order ||
      move.layer < 0 || !Number.isInteger(move.layer) || Math.abs(move.turns) !== 1) {
      return null;
    }
    let best: CubeSwipeGuide | null = null;
    let bestQuality: number = -1;
    // Center first, then inset samples: never suggest a seam or a hidden sticker.
    let fractions: number[] = [0.5, 0.3, 0.7, 0.15, 0.85];
    for (let i: number = 0; i < this.faces.length; i++) {
      let face: CubeVisibleFace = this.faces[i];
      if (face.sticker.length !== 4 || this.layerCoordinate(face.cubie, move.axis) !== move.layer) {
        continue;
      }
      let area: number = 0;
      for (let j: number = 0; j < 4; j++) {
        let a: CubePoint2 = face.sticker[j];
        let b: CubePoint2 = face.sticker[(j + 1) % 4];
        area += a.x * b.y - a.y * b.x;
      }
      area = Math.abs(area) * 0.5;
      for (let u: number = 0; u < fractions.length; u++) {
        for (let v: number = 0; v < fractions.length; v++) {
          let s: number = fractions[u];
          let t: number = fractions[v];
          let p: CubePoint2[] = face.sticker;
          let x: number = p[0].x * (1 - s) * (1 - t) + p[1].x * s * (1 - t) +
            p[2].x * s * t + p[3].x * (1 - s) * t;
          let y: number = p[0].y * (1 - s) * (1 - t) + p[1].y * s * (1 - t) +
            p[2].y * s * t + p[3].y * (1 - s) * t;
          let hit: CubeSurfaceHit | null = this.boxHit(x, y);
          if (hit === null || hit.x !== face.x || hit.y !== face.y || hit.z !== face.z ||
            hit.normal.x !== face.normal.x || hit.normal.y !== face.normal.y ||
            hit.normal.z !== face.normal.z) {
            continue;
          }
          if (!this.guideEndpointFits(x, y, hit, move)) {
            continue;
          }
          let tangent: CubePoint2 = this.swipeTangent(hit.point, hit.normal, move.axis);
          let length: number = Math.sqrt(tangent.x * tangent.x + tangent.y * tangent.y);
          if (length < 0.0001) {
            continue;
          }
          let ux: number = move.turns * tangent.x / length;
          let uy: number = move.turns * tangent.y / length;
          // Leave room for pixel rounding above the page's 24vp swipe threshold.
          let travel: number = 26;
          if (!this.guideEndpointFits(x + ux * (travel + 2), y + uy * (travel + 2), hit, move)) {
            continue;
          }
          let upper: number = 55;
          if (this.guideEndpointFits(x + ux * 57, y + uy * 57, hit, move)) {
            travel = 55;
          } else {
            for (let step: number = 0; step < 8; step++) {
              let middle: number = (travel + upper) * 0.5;
              if (this.guideEndpointFits(x + ux * (middle + 2), y + uy * (middle + 2), hit, move)) {
                travel = middle;
              } else {
                upper = middle;
              }
            }
          }
          let guide: CubeSwipeGuide = new CubeSwipeGuide(x, y, x + travel * ux, y + travel * uy);
          // The hand extends behind its fingertip; keep its whole path on Canvas.
          let canvasMargin: number = Math.min(x, y, this.width - x, this.height - y,
            guide.endX, guide.endY, this.width - guide.endX, this.height - guide.endY);
          if (canvasMargin < 26) {
            continue;
          }
          let picked: CubeMove | null = this.pickMove(x, y, guide.endX, guide.endY,
            model, this.lastYaw, this.lastPitch);
          if (picked === null || picked.axis !== move.axis || picked.layer !== move.layer ||
            picked.turns !== move.turns) {
            continue;
          }
          let clearance: number = canvasMargin;
          for (let j: number = 0; j < 4; j++) {
            let a: CubePoint2 = p[j];
            let b: CubePoint2 = p[(j + 1) % 4];
            let edgeLength: number = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
            if (edgeLength > 0) {
              clearance = Math.min(clearance,
                Math.abs((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)) / edgeLength);
            }
          }
          // Prefer readable travel as well as a large sticker and an inset start.
          let quality: number = travel + Math.sqrt(area) + 2 * clearance;
          if (quality > bestQuality) {
            bestQuality = quality;
            best = guide;
          }
        }
      }
    }
    return best;
  }

  /** One swipe example per visible corner sticker, not a solution hint. */
  getBeginnerGuides(): CubeSwipeGuide[] {
    const guides: CubeSwipeGuide[] = [];
    const model: CubeModel | null = this.lastModel;
    if (model === null || !this.cacheIsCurrent()) { return guides; }
    const last: number = model.order - 1;
    const axes: string[] = ['x', 'y', 'z'];
    for (let i: number = 0; i < this.faces.length; i++) {
      const face: CubeVisibleFace = this.faces[i];
      if (face.sticker.length !== 4 ||
        (face.x !== 0 && face.x !== last) || (face.y !== 0 && face.y !== last) ||
        (face.z !== 0 && face.z !== last)) { continue; }
      let x: number = 0;
      let y: number = 0;
      for (let j: number = 0; j < 4; j++) {
        x += face.sticker[j].x / 4;
        y += face.sticker[j].y / 4;
      }
      const hit: CubeSurfaceHit | null = this.boxHit(x, y);
      if (hit === null || hit.x !== face.x || hit.y !== face.y || hit.z !== face.z ||
        hit.normal.x !== face.normal.x || hit.normal.y !== face.normal.y ||
        hit.normal.z !== face.normal.z) { continue; }
      let clearance: number = Math.min(x, y, this.width - x, this.height - y);
      for (let j: number = 0; j < 4; j++) {
        const a: CubePoint2 = face.sticker[j];
        const b: CubePoint2 = face.sticker[(j + 1) % 4];
        const edgeLength: number = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
        if (edgeLength < 0.0001) { clearance = 0; break; }
        clearance = Math.min(clearance,
          Math.abs((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)) / edgeLength);
      }
      const radius: number = Math.min(16, clearance - 1.5);
      // Edge-on or tiny stickers cannot carry a readable gesture without spilling.
      if (radius < 4.5) { continue; }
      const tangentAxes: string[] = axes.filter((axis: string): boolean => {
        return (axis === 'x' ? face.normal.x : (axis === 'y' ? face.normal.y : face.normal.z)) === 0;
      });
      const corner: number = (this.layerCoordinate(face.cubie, tangentAxes[0]) === last ? 1 : 0) +
        (this.layerCoordinate(face.cubie, tangentAxes[1]) === last ? 1 : 0);
      const center: CubePoint2 = this.project(this.toCamera(face.normal));
      // Alternate row and column examples, pointing inward rather than off the cube.
      for (let j: number = 0; j < tangentAxes.length; j++) {
        const axis: string = tangentAxes[(corner + j) % tangentAxes.length];
        const tangent: CubePoint2 = this.swipeTangent(hit.point, hit.normal, axis);
        const length: number = Math.sqrt(tangent.x * tangent.x + tangent.y * tangent.y);
        if (length < 0.0001) { continue; }
        const sign: number = tangent.x * (center.x - x) + tangent.y * (center.y - y) >= 0 ? 1 : -1;
        const ux: number = sign * tangent.x / length;
        const uy: number = sign * tangent.y / length;
        const picked: CubeMove | null = this.pickMove(x, y, x + ux * 55, y + uy * 55,
          model, this.lastYaw, this.lastPitch);
        if (picked === null || picked.axis !== axis ||
          picked.layer !== this.layerCoordinate(face.cubie, axis) || picked.turns !== sign) { continue; }
        guides.push(new CubeSwipeGuide(x, y, x + ux * radius, y + uy * radius));
        break;
      }
    }
    return guides;
  }

  drawBeginnerGuides(ctx: CanvasRenderingContext2D): void {
    const guides: CubeSwipeGuide[] = this.getBeginnerGuides();
    for (let i: number = 0; i < guides.length; i++) {
      const guide: CubeSwipeGuide = guides[i];
      const dx: number = guide.endX - guide.startX;
      const dy: number = guide.endY - guide.startY;
      const radius: number = Math.sqrt(dx * dx + dy * dy);
      ctx.save();
      ctx.translate(guide.startX, guide.startY);
      ctx.rotate(Math.atan2(dy, dx) + Math.PI / 2);
      ctx.scale(radius, radius);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.fillStyle = '#FFFFFF';
      ctx.globalAlpha = 0.12;
      ctx.beginPath();
      ctx.arc(0, 0, 0.96, 0, Math.PI * 2);
      ctx.fill();
      for (let dot: number = 0; dot < 3; dot++) {
        ctx.globalAlpha = 0.25 + dot * 0.18;
        ctx.beginPath();
        ctx.arc(-0.72, 0.45 - dot * 0.3, 0.045 + dot * 0.02, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 0.065;
      ctx.beginPath();
      ctx.arc(0, -0.53, 0.24, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.9;
      this.paintHand(ctx, radius);
      ctx.restore();
    }
  }

  /** One press/swipe/release cycle. The caller redraws the cube before each frame. */
  drawGuide(ctx: CanvasRenderingContext2D, guide: CubeSwipeGuide, progress: number = 0,
    showTrail: boolean = true): void {
    const dx: number = guide.endX - guide.startX;
    const dy: number = guide.endY - guide.startY;
    const length: number = Math.sqrt(dx * dx + dy * dy);
    if (!Number.isFinite(guide.startX) || !Number.isFinite(guide.startY) ||
      !Number.isFinite(length) || length < 1 || !this.cacheIsCurrent()) { return; }
    const phase: number = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
    const travel: number = Math.max(0, Math.min(1, (phase - 0.16) / 0.58));
    const eased: number = travel * travel * (3 - 2 * travel);
    const release: number = Math.max(0, Math.min(1, (phase - 0.8) / 0.16));
    const opacity: number = 1 - release;
    if (phase >= 0.96) { return; }
    const x: number = guide.startX + dx * eased;
    const y: number = guide.startY + dy * eased;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (showTrail) {
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 7;
      ctx.globalAlpha = opacity * 0.3;
      ctx.beginPath();
      ctx.moveTo(guide.startX, guide.startY);
      ctx.lineTo(guide.endX, guide.endY);
      ctx.stroke();
      ctx.strokeStyle = '#82B5A4';
      ctx.lineWidth = 2;
      ctx.globalAlpha = opacity * 0.8;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(guide.startX, guide.startY, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#DDF4E8';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(guide.endX, guide.endY, 4, 0, Math.PI * 2);
      ctx.globalAlpha = opacity * 0.45;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 7 + release * 3, 0, Math.PI * 2);
      ctx.globalAlpha = opacity * 0.23;
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
    }
    ctx.globalAlpha = opacity * 0.97;
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(dy, dx) + Math.PI / 2);
    const radius: number = 14 + release * 2;
    ctx.scale(radius, radius);
    // Anchor the fingertip, not the palm, to the exact touch coordinates.
    ctx.translate(0, 0.67);
    this.paintHand(ctx, radius);
    ctx.restore();
  }

  private paintHand(ctx: CanvasRenderingContext2D, radius: number): void {
    ctx.beginPath();
    ctx.moveTo(-0.15, 0.1);
    ctx.lineTo(-0.15, -0.48);
    ctx.quadraticCurveTo(-0.15, -0.67, 0, -0.67);
    ctx.quadraticCurveTo(0.15, -0.67, 0.15, -0.48);
    ctx.lineTo(0.15, -0.08);
    ctx.quadraticCurveTo(0.25, -0.2, 0.34, -0.08);
    ctx.quadraticCurveTo(0.47, -0.15, 0.51, 0.03);
    ctx.quadraticCurveTo(0.67, 0.02, 0.67, 0.2);
    ctx.lineTo(0.65, 0.48);
    ctx.quadraticCurveTo(0.62, 0.7, 0.36, 0.7);
    ctx.lineTo(0.15, 0.7);
    ctx.quadraticCurveTo(-0.02, 0.7, -0.14, 0.51);
    ctx.lineTo(-0.42, 0.16);
    ctx.quadraticCurveTo(-0.53, 0, -0.4, -0.05);
    ctx.quadraticCurveTo(-0.31, -0.11, -0.15, 0.1);
    ctx.closePath();
    ctx.fillStyle = '#FFFEF7';
    ctx.fill();
    ctx.strokeStyle = '#6E958A';
    ctx.lineWidth = 0.075 + 0.25 / radius;
    ctx.stroke();
  }

  private cacheIsCurrent(allowAnimation: boolean = false): boolean {
    let model: CubeModel | null = this.lastModel;
    if ((!allowAnimation && this.animating) || model === null || model.order !== this.lastOrder ||
      model.cubies.length !== this.cachedCubies.length) {
      return false;
    }
    for (let i: number = 0; i < this.cachedCubies.length; i++) {
      let cubie: Cubelet = model.cubies[i];
      if (cubie !== this.cachedCubies[i] || cubie.x !== this.cachedCoordinates[i * 3] ||
        cubie.y !== this.cachedCoordinates[i * 3 + 1] || cubie.z !== this.cachedCoordinates[i * 3 + 2]) {
        return false;
      }
    }
    return true;
  }

  private guideEndpointFits(x: number, y: number, start: CubeSurfaceHit, move: CubeMove): boolean {
    if (Math.min(x, y, this.width - x, this.height - y) < 26) {
      return false;
    }
    // A 1vp neighborhood absorbs coordinate quantization near face/layer seams.
    for (let dx: number = -1; dx <= 1; dx++) {
      for (let dy: number = -1; dy <= 1; dy++) {
        let end: CubeSurfaceHit | null = this.boxHit(x + dx, y + dy);
        if (end === null || end.normal.x !== start.normal.x || end.normal.y !== start.normal.y ||
          end.normal.z !== start.normal.z ||
          (move.axis === 'x' ? end.x : (move.axis === 'y' ? end.y : end.z)) !== move.layer) {
          return false;
        }
      }
    }
    return true;
  }

  private swipeTangent(point: CubeVector3, normal: CubeVector3, axis: string): CubePoint2 {
    let tangent: CubeVector3;
    if (axis === 'x') {
      tangent = new CubeVector3(0, -normal.z, normal.y);
    } else if (axis === 'y') {
      tangent = new CubeVector3(normal.z, 0, -normal.x);
    } else {
      tangent = new CubeVector3(-normal.y, normal.x, 0);
    }
    let camera: CubeVector3 = this.toCamera(tangent);
    let position: CubeVector3 = this.toCamera(point);
    let depth: number = this.cameraDistance - position.z;
    // Perspective derivative, omitting the common positive focal/depth scale.
    return new CubePoint2(camera.x + position.x * camera.z / depth,
      -camera.y - position.y * camera.z / depth);
  }

  private layerCoordinate(cubie: Cubelet, axis: string): number {
    return axis === 'x' ? cubie.x : (axis === 'y' ? cubie.y : cubie.z);
  }

  private stickerColor(cubie: Cubelet, normal: CubeVector3): string {
    for (let i: number = 0; i < cubie.stickers.length; i++) {
      let sticker: Sticker = cubie.stickers[i];
      if (sticker.nx === normal.x && sticker.ny === normal.y && sticker.nz === normal.z) {
        return sticker.color;
      }
    }
    return '';
  }

  private rotate(p: CubeVector3, axis: string, cosine: number, sine: number): CubeVector3 {
    if (axis === 'x') {
      return new CubeVector3(p.x, p.y * cosine - p.z * sine, p.y * sine + p.z * cosine);
    }
    if (axis === 'y') {
      return new CubeVector3(p.x * cosine + p.z * sine, p.y, -p.x * sine + p.z * cosine);
    }
    return new CubeVector3(p.x * cosine - p.y * sine, p.x * sine + p.y * cosine, p.z);
  }

  private toCamera(p: CubeVector3): CubeVector3 {
    let x: number = p.x * this.yawCos - p.z * this.yawSin;
    let z: number = p.x * this.yawSin + p.z * this.yawCos;
    return new CubeVector3(x, p.y * this.pitchCos + z * this.pitchSin,
      -p.y * this.pitchSin + z * this.pitchCos);
  }

  private fromCamera(p: CubeVector3): CubeVector3 {
    let y: number = p.y * this.pitchCos - p.z * this.pitchSin;
    let z: number = p.y * this.pitchSin + p.z * this.pitchCos;
    return new CubeVector3(p.x * this.yawCos + z * this.yawSin, y,
      -p.x * this.yawSin + z * this.yawCos);
  }

  private project(p: CubeVector3): CubePoint2 {
    let scale: number = this.focal / (this.cameraDistance - p.z);
    return new CubePoint2(this.width * 0.5 + p.x * scale, this.height * 0.5 - p.y * scale);
  }

  private faceCorners(center: CubeVector3, basis: CubeFaceBasis, half: number,
    move: CubeMove | null, cosine: number, sine: number): CubePoint2[] {
    let points: CubePoint2[] = [];
    for (let i: number = 0; i < 4; i++) {
      let u: number = (i === 0 || i === 3) ? -half : half;
      let v: number = i < 2 ? -half : half;
      let point: CubeVector3 = new CubeVector3(center.x + basis.u.x * u + basis.v.x * v,
        center.y + basis.u.y * u + basis.v.y * v, center.z + basis.u.z * u + basis.v.z * v);
      if (move !== null) {
        point = this.rotate(point, move.axis, cosine, sine);
      }
      points.push(this.project(this.toCamera(point)));
    }
    return points;
  }

  private path(ctx: CanvasRenderingContext2D, points: CubePoint2[]): void {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i: number = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
  }

  private paintFace(ctx: CanvasRenderingContext2D, face: CubeVisibleFace): void {
    let normal: CubeVector3 = face.cameraNormal;
    let diffuse: number = Math.max(0, normal.x * -0.35 + normal.y * 0.65 + normal.z * 0.68);
    let light: number = Math.min(1, 0.76 + 0.24 * diffuse);
    let plastic: number = Math.round(12 + 13 * diffuse);
    this.path(ctx, face.outline);
    ctx.fillStyle = 'rgb(' + plastic + ',' + (plastic + 2) + ',' + (plastic + 6) + ')';
    ctx.fill();
    ctx.strokeStyle = '#07090D';
    ctx.lineWidth = Math.max(0.35, Math.min(1, Math.min(this.width, this.height) / 600));
    ctx.stroke();
    if (face.sticker.length === 0) {
      return;
    }
    this.path(ctx, face.sticker);
    ctx.fillStyle = face.color;
    ctx.fill();
    // Shading over CSS color avoids parsing colors or relying on a DOM canvas.
    ctx.fillStyle = '#000000';
    ctx.globalAlpha = 1 - light;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = Math.max(0.3, Math.min(0.8, Math.min(this.width, this.height) / 700));
    ctx.stroke();
  }

  private boxHit(x: number, y: number): CubeSurfaceHit | null {
    if (this.lastModel === null || !Number.isFinite(x) || !Number.isFinite(y) ||
      x < 0 || y < 0 || x > this.width || y > this.height) {
      return null;
    }
    let origin: CubeVector3 = this.fromCamera(new CubeVector3(0, 0, this.cameraDistance));
    let ray: CubeVector3 = this.fromCamera(new CubeVector3((x - this.width * 0.5) / this.focal,
      -(y - this.height * 0.5) / this.focal, -1));
    let nearest: number = Number.POSITIVE_INFINITY;
    let result: CubeSurfaceHit | null = null;
    // Intersect the six faces of the closed [-1,1] envelope, not individual
    // plastic quads. Seams and outer plastic insets remain touchable cube area.
    for (let i: number = 0; i < this.bases.length; i++) {
      let normal: CubeVector3 = this.bases[i].normal;
      let denominator: number = normal.x * ray.x + normal.y * ray.y + normal.z * ray.z;
      if (denominator >= -0.000001) {
        continue;
      }
      let distance: number = (1 - normal.x * origin.x - normal.y * origin.y -
        normal.z * origin.z) / denominator;
      if (distance <= 0 || distance >= nearest) {
        continue;
      }
      let point: CubeVector3 = new CubeVector3(origin.x + ray.x * distance,
        origin.y + ray.y * distance, origin.z + ray.z * distance);
      if (Math.abs(point.x) > 1.000001 || Math.abs(point.y) > 1.000001 || Math.abs(point.z) > 1.000001) {
        continue;
      }
      nearest = distance;
      result = new CubeSurfaceHit(point, normal, this.lastOrder);
    }
    return result;
  }
}
