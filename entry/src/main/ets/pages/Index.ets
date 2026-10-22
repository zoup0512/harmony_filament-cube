import { common } from '@kit.AbilityKit';
import { CubeModel, CubeMove } from '../model/CubeModel';
import { CubeRenderer } from '../render/CubeRenderer';
import { CubeStore, CubeSettings, SolveRecord } from '../storage/CubeStore';
import { CubeFeedback } from '../platform/CubeFeedback';
import { CubeTheme } from './CubeTheme';

@Entry
@Component
struct Index {
  @State private page: string = 'home';
  @State private order: number = 3;
  @State private phase: string = 'idle';
  @State private busy: boolean = false;
  @State private moves: number = 0;
  @State private elapsed: number = 0;
  @State private hint: string = '';
  @State private lessonIndex: number = 0;
  @State private lessonTotal: number = 0;
  @State private speed: number = 1;
  @State private sound: boolean = false;
  @State private haptics: boolean = true;
  @State private beginnerGuides: boolean = true;
  @State private defaultOrder: number = 3;
  @State private records: SolveRecord[] = [];
  @State private loaded: boolean = false;
  @State private storageWarning: string = '';
  @State private assisted: boolean = false;
  @State private viewportHeight: number = 740;
  @StorageLink('cubeForeground') @Watch('onForegroundChanged') private foreground: boolean = true;

  private model: CubeModel = new CubeModel(3);
  private renderer: CubeRenderer = new CubeRenderer();
  private store: CubeStore = new CubeStore();
  private feedback: CubeFeedback = new CubeFeedback();
  private context2d: CanvasRenderingContext2D = new CanvasRenderingContext2D(new RenderingContextSettings(true));
  private canvasWidth: number = 320;
  private canvasHeight: number = 320;
  private canvasReady: boolean = false;
  private yaw: number = 0.62;
  private pitch: number = -0.42;
  private frameTimer: number = -1;
  private clockTimer: number = -1;
  private sessionId: number = 0;
  private startedAt: number = 0;
  private timeBase: number = 0;
  private animationAt: number = 0;
  private activeMove: CubeMove | null = null;
  private queue: CubeMove[] = [];
  private queueKind: string = '';
  private lesson: CubeMove[] = [];
  private hintMove: CubeMove | null = null;
  private startX: number = 0;
  private startY: number = 0;
  private lastX: number = 0;
  private lastY: number = 0;
  private orbiting: boolean = false;
  private touching: boolean = false;
  private pointerCount: number = 0;
  private blockedTouch: boolean = false;
  private orbitDragging: boolean = false;
  private gestureVersion: number = 0;
  private downVersion: number = 0;
  private downSession: number = 0;
  private downModel: CubeModel | null = null;
  private downWidth: number = 0;
  private downHeight: number = 0;
  private downYaw: number = 0;
  private downPitch: number = 0;
  private downPage: string = '';
  private readonly orders: number[] = [2, 3, 4, 5];
  private readonly firstFaces: string[] = ['U', "U'", 'D', "D'", 'L', "L'"];
  private readonly secondFaces: string[] = ['R', "R'", 'F', "F'", 'B', "B'"];

  aboutToAppear(): void {
    this.loadData();
    this.startTimers();
  }

  aboutToDisappear(): void {
    this.invalidateGesture();
    this.stopTimers();
    this.feedback.release();
  }

  onBackPress(): boolean {
    if (this.page !== 'home') {
      this.goHome();
      return true;
    }
    return false;
  }

  private async loadData(): Promise<void> {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    try {
      await this.store.load(context);
      this.defaultOrder = this.store.settings.defaultOrder;
      this.order = this.defaultOrder;
      this.speed = this.store.settings.speed;
      this.sound = this.store.settings.sound;
      this.haptics = this.store.settings.haptics;
      this.beginnerGuides = this.store.settings.beginnerGuides;
      this.records = this.store.records.slice();
      this.invalidateGesture(true);
      this.model.reset(this.order);
      this.draw();
    } catch {
      this.storageWarning = '本地存储暂不可用，本次仍可游玩。';
    }
    this.loaded = true;
    await this.feedback.prepare(context);
  }

  private startTimers(): void {
    if (this.frameTimer < 0) {
      this.frameTimer = setInterval(() => this.frame(), 16);
    }
    if (this.clockTimer < 0) {
      this.clockTimer = setInterval(() => {
        if (this.phase === 'playing' && this.foreground) {
          this.elapsed = this.timeBase + Date.now() - this.startedAt;
        }
      }, 83);
    }
  }

  private stopTimers(): void {
    if (this.frameTimer >= 0) { clearInterval(this.frameTimer); }
    if (this.clockTimer >= 0) { clearInterval(this.clockTimer); }
    this.frameTimer = -1;
    this.clockTimer = -1;
  }

  private onForegroundChanged(): void {
    if (!this.foreground) {
      if (this.phase === 'playing') {
        this.timeBase += Date.now() - this.startedAt;
        this.elapsed = this.timeBase;
      }
      this.stopTimers();
      this.invalidateGesture();
    } else {
      if (this.phase === 'playing') { this.startedAt = Date.now(); }
      this.animationAt = Date.now();
      this.startTimers();
      this.draw();
    }
  }

  private draw(progress: number = 0): void {
    if (this.canvasReady) {
      this.renderer.draw(this.context2d, this.canvasWidth, this.canvasHeight,
        this.model, this.yaw, this.pitch, this.activeMove, progress);
      if (!this.busy && this.page === 'game') {
        const target = this.phase === 'tutorial' && this.lessonIndex < this.lesson.length ?
          this.lesson[this.lessonIndex] : this.hintMove;
        if (target !== null) {
          const guide = this.renderer.getSwipeGuide(target);
          if (guide !== null) { this.renderer.drawGuide(this.context2d, guide); }
        } else if (this.beginnerGuides) {
          this.renderer.drawBeginnerGuides(this.context2d);
        }
      }
    }
  }

  private frame(): void {
    if (!this.foreground || !this.busy || this.activeMove === null) { return; }
    const duration = this.queueKind === 'scramble' || this.queueKind === 'lessonSetup' ? 65 / this.speed : 220 / this.speed;
    const fraction = Math.min(1, (Date.now() - this.animationAt) / duration);
    this.draw(fraction * fraction * (3 - 2 * fraction));
    if (fraction < 1) { return; }
    const userMove = this.queueKind === 'user';
    this.model.applyMove(this.activeMove, userMove);
    this.activeMove = null;
    if (userMove) {
      this.moves = this.model.moveCount;
      this.feedback.play(this.sound, this.haptics);
    }
    if (this.queue.length > 0) {
      this.activeMove = this.queue.shift() as CubeMove;
      this.animationAt = Date.now();
      return;
    }
    this.busy = false;
    if (this.queueKind === 'scramble') {
      this.phase = 'ready';
      this.hint = '已打乱。转动第一手开始计时。';
    } else if (this.queueKind === 'lessonSetup') {
      this.phase = 'tutorial';
      this.updateLessonHint();
    } else if (this.queueKind === 'lessonStep') {
      this.lessonIndex++;
      this.feedback.play(this.sound, this.haptics);
      if (this.lessonIndex >= this.lesson.length) {
        this.phase = 'idle';
        this.hint = '教程完成！你已经学会滑动转层，试试打乱挑战吧。';
      } else {
        this.updateLessonHint();
      }
    } else if (userMove && this.phase === 'playing' && this.model.isSolved()) {
      this.finishSolve();
    }
    this.queueKind = '';
    this.draw();
  }

  private animate(moves: CubeMove[], kind: string): void {
    if (moves.length === 0 || this.busy) { return; }
    this.invalidateGesture(true);
    this.queue = moves.slice();
    this.queueKind = kind;
    this.activeMove = this.queue.shift() as CubeMove;
    this.animationAt = Date.now();
    this.busy = true;
  }

  private resetSession(): void {
    this.invalidateGesture();
    this.sessionId++;
    this.queue = [];
    this.activeMove = null;
    this.busy = false;
    this.queueKind = '';
    this.model.reset(this.order);
    this.phase = 'idle';
    this.elapsed = 0;
    this.timeBase = 0;
    this.startedAt = 0;
    this.moves = 0;
    this.hint = '';
    this.assisted = false;
    this.hintMove = null;
    this.lesson = [];
    this.lessonIndex = 0;
    this.lessonTotal = 0;
    this.draw();
  }

  private chooseOrder(value: number): void {
    this.order = value;
    this.resetSession();
  }

  private startGame(): void {
    this.resetSession();
    this.yaw = 0.62;
    this.pitch = -0.42;
    this.canvasReady = false;
    this.page = 'game';
  }

  private leavePage(): void {
    this.resetSession();
    this.canvasReady = false;
    this.page = 'home';
  }

  private goHome(): void {
    if (this.page === 'game' && (this.busy || this.phase === 'playing' || this.phase === 'ready' || this.phase === 'tutorial')) {
      this.getUIContext().showAlertDialog({
        title: '返回首页？',
        message: '本局进度不会保存，已完成的成绩不受影响。',
        primaryButton: { value: '继续玩', action: () => {} },
        secondaryButton: { value: '返回首页', action: () => this.leavePage() }
      });
    } else { this.leavePage(); }
  }

  private confirmReset(): void {
    this.getUIContext().showAlertDialog({
      title: '复位魔方？',
      message: '直接恢复六面同色并清除本局计时。这不是自动求解。',
      primaryButton: { value: '取消', action: () => {} },
      secondaryButton: { value: '复位', action: () => this.resetSession() }
    });
  }

  private scramble(): void {
    if (this.busy) { return; }
    if (this.phase === 'playing' || this.phase === 'tutorial') {
      this.getUIContext().showAlertDialog({
        title: '重新打乱？', message: '将放弃当前一局，重新开始计时挑战。',
        primaryButton: { value: '取消', action: () => {} },
        secondaryButton: { value: '重新打乱', action: () => this.doScramble() }
      });
    } else { this.doScramble(); }
  }

  private doScramble(): void {
    this.resetSession();
    const counts: number[] = [11, 25, 45, 65];
    this.hint = '正在打乱…';
    this.animate(this.model.createScramble(counts[this.order - 2]), 'scramble');
  }

  private faceMove(face: string): CubeMove {
    const end = this.order - 1;
    const reverse: number = face.length > 1 ? -1 : 1;
    switch (face.charAt(0)) {
      case 'U': return new CubeMove('y', end, -reverse);
      case 'D': return new CubeMove('y', 0, reverse);
      case 'L': return new CubeMove('x', 0, reverse);
      case 'R': return new CubeMove('x', end, -reverse);
      case 'F': return new CubeMove('z', end, -reverse);
      default: return new CubeMove('z', 0, reverse);
    }
  }

  private moveLabel(move: CubeMove): string {
    const faces: string[] = this.firstFaces.concat(this.secondFaces);
    for (let i = 0; i < faces.length; i++) {
      if (this.sameMove(this.faceMove(faces[i]), move)) { return faces[i]; }
    }
    return `${move.axis.toUpperCase()} 第 ${move.layer + 1} 层 ${move.turns > 0 ? '+90°' : '−90°'}`;
  }

  private sameMove(a: CubeMove, b: CubeMove): boolean {
    return a.axis === b.axis && a.layer === b.layer && a.turns === b.turns;
  }

  private requestMove(move: CubeMove): void {
    if (this.busy || !this.foreground) { return; }
    if (this.phase === 'tutorial') {
      if (this.lessonIndex < this.lesson.length && this.sameMove(move, this.lesson[this.lessonIndex])) {
        this.animate([move], 'lessonStep');
      } else { this.toast('请从箭头圆点沿箭头滑动，完成当前教程步骤。'); }
      return;
    }
    if (this.phase === 'solved') {
      this.phase = 'idle';
      this.hint = '自由练习。点击“打乱”开始新的计时挑战。';
      this.elapsed = 0;
      this.timeBase = 0;
    }
    if (this.phase === 'ready') {
      this.phase = 'playing';
      this.startedAt = Date.now();
      this.hint = '';
    }
    if (this.hintMove !== null) { this.hint = ''; }
    this.hintMove = null;
    this.animate([move], 'user');
  }

  private undo(): void {
    if (this.busy || !this.foreground || this.phase === 'tutorial' || this.phase === 'solved') { return; }
    const move = this.model.undo();
    if (move !== null) {
      this.invalidateGesture(true);
      this.moves = this.model.moveCount;
      this.hint = '';
      this.hintMove = null;
      this.draw();
      if (this.phase === 'playing' && this.model.isSolved()) { this.finishSolve(); }
    } else { this.toast('还没有可以撤销的操作。'); }
  }

  private showHint(): void {
    if (this.busy || this.phase === 'tutorial' || this.model.isSolved()) { return; }
    const solution = this.model.getSolution();
    if (solution.length > 0) {
      this.assisted = true;
      this.hintMove = solution[0];
      this.hint = `历史回退参考：${this.moveLabel(solution[0])}，沿箭头滑动；看不到箭头时请转动视角。这是逆向回放，不是最优求解；本局不计入成绩。`;
      this.draw();
    }
  }

  private startLesson(): void {
    if (this.busy) { return; }
    if (this.phase === 'playing' || this.phase === 'ready') {
      this.getUIContext().showAlertDialog({
        title: '开始入门教程？', message: '将结束本局，进入五步还原练习。教程不记成绩。',
        primaryButton: { value: '取消', action: () => {} },
        secondaryButton: { value: '开始教程', action: () => this.doLesson() }
      });
    } else { this.doLesson(); }
  }

  private doLesson(): void {
    this.resetSession();
    const faces: string[] = ['R', 'U', "F'", 'L', "D'"];
    const setup: CubeMove[] = [];
    for (let i = 0; i < faces.length; i++) { setup.push(this.faceMove(faces[i])); }
    this.lesson = [];
    for (let i = setup.length - 1; i >= 0; i--) { this.lesson.push(setup[i].inverse()); }
    this.lessonTotal = this.lesson.length;
    this.hint = '准备五步教程…';
    this.animate(setup, 'lessonSetup');
  }

  private updateLessonHint(): void {
    this.hint = `第 ${this.lessonIndex + 1} / ${this.lessonTotal} 步：沿箭头滑动完成 ${this.moveLabel(this.lesson[this.lessonIndex])}。从圆点滑向箭头，松手转层；看不到箭头时，拖动空白或双指转动视角。`;
  }

  private finishSolve(): void {
    this.elapsed = this.timeBase + Date.now() - this.startedAt;
    this.phase = 'solved';
    if (this.assisted) {
      this.hint = '还原成功！本局使用了提示，作为练习不记录成绩。';
      return;
    }
    this.hint = '还原成功！正在保存成绩…';
    const record = new SolveRecord(this.order, this.elapsed, this.moves);
    const savedSession = this.sessionId;
    this.store.addRecord(record).then(() => {
      this.records = this.store.records.slice();
      if (savedSession === this.sessionId && this.phase === 'solved') {
        this.hint = '还原成功！成绩已记录。';
      }
    }).catch(() => {
      if (savedSession === this.sessionId && this.phase === 'solved') {
        this.hint = '还原成功，但本地成绩保存失败。';
      } else if (this.phase !== 'solved') {
        this.toast('上局成绩保存失败。');
      }
    });
  }

  private invalidateGesture(layerOnly: boolean = false): void {
    this.gestureVersion++;
    // Model animations invalidate a pending layer, not an orbit on every frame.
    if (layerOnly) {
      if (this.touching && !this.orbiting) { this.blockedTouch = true; }
      return;
    }
    this.touching = false;
    this.pointerCount = 0;
    this.orbiting = false;
    this.blockedTouch = false;
    this.orbitDragging = false;
    this.downModel = null;
  }

  private layerGestureCurrent(): boolean {
    return this.downVersion === this.gestureVersion && this.downSession === this.sessionId &&
      this.downModel === this.model && this.downPage === this.page &&
      this.downWidth === this.canvasWidth && this.downHeight === this.canvasHeight &&
      this.downYaw === this.yaw && this.downPitch === this.pitch;
  }

  private setTouchOrigin(points: TouchObject[]): void {
    let x = 0;
    let y = 0;
    for (let i = 0; i < points.length; i++) {
      x += points[i].x;
      y += points[i].y;
    }
    this.startX = this.lastX = x / points.length;
    this.startY = this.lastY = y / points.length;
    this.pointerCount = points.length;
    this.orbitDragging = false;
  }

  private moveOrbit(x: number, y: number): void {
    const dx = x - this.startX;
    const dy = y - this.startY;
    if (!this.orbitDragging && Math.sqrt(dx * dx + dy * dy) <= 8) { return; }
    this.orbitDragging = true;
    // worldToCamera applies Y(-yaw), then X(-pitch): subtract screen deltas.
    const moved = x !== this.lastX || y !== this.lastY;
    this.yaw -= (x - this.lastX) * 0.009;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - (y - this.lastY) * 0.009));
    this.lastX = x;
    this.lastY = y;
    if (moved && !this.busy) { this.draw(); }
  }

  private judgeScrollGesture(current: GestureRecognizer): GestureJudgeResult {
    // Reject the Scroll's own Pan before acceptance can Cancel Canvas.onTouch.
    return this.touching && current.isBuiltIn() && current.getType() === GestureControl.GestureType.PAN_GESTURE ?
      GestureJudgeResult.REJECT : GestureJudgeResult.CONTINUE;
  }

  private touch(event: TouchEvent): void {
    if (event.type === TouchType.Cancel || !this.foreground) {
      this.invalidateGesture();
      return;
    }
    // Cancel/background never allow a Move or Up to manufacture a new gesture.
    if (!this.touching && event.type !== TouchType.Down) { return; }
    if (event.type === TouchType.Up) {
      const remaining = event.touches.filter((point: TouchObject) =>
        !event.changedTouches.some((changed: TouchObject) => changed.id === point.id));
      if (remaining.length > 0) {
        this.orbiting = true;
        this.blockedTouch = false;
        this.setTouchOrigin(remaining);
        return;
      }
      if (event.changedTouches.length > 0) {
        let x = 0;
        let y = 0;
        for (let i = 0; i < event.changedTouches.length; i++) {
          x += event.changedTouches[i].x;
          y += event.changedTouches[i].y;
        }
        x /= event.changedTouches.length;
        y /= event.changedTouches.length;
        if (this.orbiting) {
          this.moveOrbit(x, y);
        } else if (!this.blockedTouch && !this.busy && this.layerGestureCurrent()) {
          const dx = x - this.startX;
          const dy = y - this.startY;
          if (Math.sqrt(dx * dx + dy * dy) >= 24) {
            const move = this.renderer.pickMove(this.startX, this.startY, x, y,
              this.model, this.yaw, this.pitch);
            // Release before dispatch, even if requestMove synchronously starts animation.
            this.invalidateGesture();
            if (move !== null) { this.requestMove(move); }
            return;
          }
        }
      }
      this.invalidateGesture();
      return;
    }
    if (event.touches.length === 0) { return; }
    if (event.type === TouchType.Down) {
      if (!this.touching) {
        this.setTouchOrigin(event.touches);
        this.orbiting = event.touches.length > 1 || this.page === 'home' ||
          !this.renderer.hitTest(this.startX, this.startY);
        this.blockedTouch = !this.orbiting && this.busy;
        this.downVersion = this.gestureVersion;
        this.downSession = this.sessionId;
        this.downModel = this.model;
        this.downPage = this.page;
        this.downWidth = this.canvasWidth;
        this.downHeight = this.canvasHeight;
        this.downYaw = this.yaw;
        this.downPitch = this.pitch;
      } else if (event.touches.length > 1) {
        this.orbiting = true;
        this.blockedTouch = false;
        this.setTouchOrigin(event.touches);
      }
      this.touching = true;
      return;
    }
    if (event.type !== TouchType.Move) { return; }
    if (this.pointerCount !== event.touches.length) {
      this.orbiting = true;
      this.blockedTouch = false;
      this.setTouchOrigin(event.touches);
      return;
    }
    let x = 0;
    let y = 0;
    for (let i = 0; i < event.touches.length; i++) {
      x += event.touches[i].x;
      y += event.touches[i].y;
    }
    x /= event.touches.length;
    y /= event.touches.length;
    if (this.orbiting) {
      this.moveOrbit(x, y);
    } else {
      if (this.busy || !this.layerGestureCurrent()) { this.blockedTouch = true; }
      this.lastX = x;
      this.lastY = y;
    }
  }

  private setBeginnerGuides(value: boolean): void {
    this.beginnerGuides = value;
    this.draw();
    this.saveSettings();
  }

  private saveSettings(): void {
    const settings = new CubeSettings();
    settings.defaultOrder = this.defaultOrder;
    settings.speed = this.speed;
    settings.sound = this.sound;
    settings.haptics = this.haptics;
    settings.beginnerGuides = this.beginnerGuides;
    this.store.saveSettings(settings).catch(() => this.toast('设置保存失败，请稍后重试。'));
  }

  private clearRecords(): void {
    this.getUIContext().showAlertDialog({
      title: '清空所有成绩？', message: '此操作不可撤销，设置不会被清除。',
      primaryButton: { value: '取消', action: () => {} },
      secondaryButton: { value: '清空成绩', action: () => {
        this.store.clearRecords().then(() => { this.records = []; })
          .catch(() => this.toast('清空失败，请稍后重试。'));
      } }
    });
  }

  private toast(message: string): void {
    try {
      this.getUIContext().getPromptAction().showToast({ message: message, duration: 2400 });
    } catch {
      this.hint = message;
    }
  }

  private formatTime(ms: number): string {
    const minutes = Math.floor(ms / 60000).toString().padStart(2, '0');
    const seconds = Math.floor(ms / 1000 % 60).toString().padStart(2, '0');
    const fraction = Math.floor(ms / 10 % 100).toString().padStart(2, '0');
    return `${minutes}:${seconds}.${fraction}`;
  }

  private bestTime(order: number): string {
    let best = Number.MAX_VALUE;
    for (let i = 0; i < this.records.length; i++) {
      if (this.records[i].order === order) { best = Math.min(best, this.records[i].durationMs); }
    }
    return best === Number.MAX_VALUE ? '—' : this.formatTime(best);
  }

  private dateLabel(date: number): string {
    const value = new Date(date);
    return `${value.getMonth() + 1}/${value.getDate()} ${value.getHours().toString().padStart(2, '0')}:${value.getMinutes().toString().padStart(2, '0')}`;
  }

  private phaseLabel(): string {
    if (this.busy && this.queueKind === 'scramble') { return '正在打乱'; }
    if (this.phase === 'ready') { return '准备开始'; }
    if (this.phase === 'playing') { return this.assisted ? '辅助练习' : '计时挑战'; }
    if (this.phase === 'solved') { return '还原成功'; }
    if (this.phase === 'tutorial') { return '入门教程'; }
    return '自由练习';
  }

  @Builder
  private cubeCanvas() {
    Canvas(this.context2d)
      .width('100%')
      .height('100%')
      .onReady(() => { this.canvasReady = true; this.draw(); })
      .onAreaChange((_old: Area, area: Area) => {
        this.invalidateGesture();
        this.canvasWidth = Number(area.width);
        this.canvasHeight = Number(area.height);
        this.draw();
      })
      .onTouch((event: TouchEvent) => this.touch(event))
      .accessibilityText(`${this.order} 阶魔方，沿表面行或列滑动，松手转动一层。拖动背景或双指拖动旋转视角。`)
  }

  private orderDescription(value: number): string {
    if (value === 2) { return '轻松入门'; }
    if (value === 3) { return '经典挑战'; }
    if (value === 4) { return '进阶探索'; }
    return '高手进阶';
  }

  private orderSolves(value: number): number {
    return this.records.filter((record: SolveRecord) => record.order === value).length;
  }

  @Builder
  private sectionTitle(kicker: string, title: string) {
    Column({ space: 8 }) {
      Text(kicker).fontSize(10).fontColor(CubeTheme.green).letterSpacing(2).fontWeight(FontWeight.Medium)
      Text(title).fontSize(27).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder
  private brandMark() {
    Column({ space: 3 }) {
      Row({ space: 3 }) {
        Rect().width(8).height(8).radius(2).fill(CubeTheme.accent)
        Rect().width(8).height(8).radius(2).fill('#FFFFFF')
      }
      Row({ space: 3 }) {
        Rect().width(8).height(8).radius(2).fill('#FFFFFF')
        Rect().width(8).height(8).radius(2).fill(CubeTheme.accent)
      }
    }.width(36).height(36).justifyContent(FlexAlign.Center).backgroundColor(CubeTheme.ink).borderRadius(12)
      .accessibilityLevel('no')
  }

  @Builder
  private chartMark(size: number, color: string) {
    Row({ space: 3 }) {
      Rect().width(size * 0.22).height(size * 0.45).radius(2).fill(color)
      Rect().width(size * 0.22).height(size * 0.85).radius(2).fill(color)
      Rect().width(size * 0.22).height(size * 0.65).radius(2).fill(color)
    }.width(size).height(size).alignItems(VerticalAlign.Bottom).accessibilityLevel('no')
  }

  @Builder
  private cubeStage() {
    Stack() {
      Circle().width(206).height(206).fill(Color.Transparent)
        .stroke('#CFDDCE').strokeWidth(1).hitTestBehavior(HitTestMode.None)
      Circle().width(158).height(158).fill('#DEE9DA').hitTestBehavior(HitTestMode.None)
      this.cubeCanvas()
    }.width('100%').height('100%')
      .linearGradient({ angle: 135, colors: [['#EFF4E7', 0], ['#E1ECE2', 1]] })
      .borderRadius(28).clip(true)
  }

  @Builder
  private homePage() {
    Scroll() {
      Column({ space: 16 }) {
        Row({ space: 10 }) {
          this.brandMark()
          Column({ space: 2 }) {
            Text('RAZOR CUBE').fontSize(12).letterSpacing(1.5).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
            Text('把专注，交给每一次转动').fontSize(10).fontColor(CubeTheme.secondary)
          }.alignItems(HorizontalAlign.Start)
          Blank()
          Blank().width(88)
        }.width('100%').height(44)
        Row({ space: 7 }) {
          Circle().width(5).height(5).fill(CubeTheme.green)
          Text('随时开始一场小小的脑力旅行').fontSize(12).fontColor(CubeTheme.secondary)
        }.width('100%').margin({ top: 4 })
        Column({ space: 0 }) {
          Row() {
            Text(`${this.order} × ${this.order} / ${this.orderDescription(this.order)}`)
              .fontSize(11).fontColor(CubeTheme.green).fontWeight(FontWeight.Medium)
            Blank()
            Text('可交互预览').fontSize(10).fontColor(CubeTheme.secondary)
          }.width('100%').padding({ left: 18, right: 18, top: 15 })
          Stack() {
            this.cubeStage()
          }.width('100%').height(202)
          Text('拖动魔方，自由探索每一面').fontSize(10).fontColor(CubeTheme.secondary)
            .padding({ bottom: 14 })
        }.width('100%').backgroundColor(CubeTheme.mint).borderRadius(28).clip(true)
        Column({ space: 12 }) {
          Row() {
            Text('选择你的挑战').fontSize(15).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
            Blank()
            Text('02 — 05').fontSize(10).fontColor(CubeTheme.muted).letterSpacing(1)
          }.width('100%')
          Row({ space: 8 }) {
            ForEach(this.orders, (value: number) => {
              Button(`${value} 阶`, { type: ButtonType.Normal })
                .layoutWeight(1).height(48).borderRadius(16).fontSize(16).fontWeight(FontWeight.Medium)
                .backgroundColor(this.order === value ? CubeTheme.ink : CubeTheme.surface)
                .fontColor(this.order === value ? CubeTheme.accent : CubeTheme.secondary)
                .border({ width: 1, color: this.order === value ? CubeTheme.ink : CubeTheme.line, radius: 16 })
                .accessibilityText(`${value} 阶${this.order === value ? '，已选择' : ''}`)
                .onClick(() => this.chooseOrder(value))
            })
          }.width('100%')
        }.width('100%')
        Button('开始游戏  →', { type: ButtonType.Normal }).width('100%').height(56)
          .backgroundColor(CubeTheme.accent).fontColor(CubeTheme.ink).fontSize(17).fontWeight(FontWeight.Bold)
          .borderRadius(18).enabled(this.loaded).onClick(() => this.startGame())
        Row({ space: 10 }) {
          Button({ type: ButtonType.Normal }) {
            Row({ space: 10 }) {
              this.chartMark(19, CubeTheme.green)
              Text('成绩统计').fontSize(13).fontWeight(FontWeight.Medium).fontColor(CubeTheme.ink)
              Blank()
              Text('↗').fontSize(17).fontColor(CubeTheme.secondary)
            }.width('100%').padding(14)
          }.layoutWeight(1).height(52).borderRadius(16).backgroundColor(CubeTheme.surface)
            .accessibilityText('成绩统计').onClick(() => { this.invalidateGesture(); this.canvasReady = false; this.page = 'stats'; })
          Button({ type: ButtonType.Normal }) {
            Row({ space: 10 }) {
              SymbolGlyph($r('sys.symbol.gearshape')).fontSize(19).fontColor([CubeTheme.green])
              Text('偏好设置').fontSize(13).fontWeight(FontWeight.Medium).fontColor(CubeTheme.ink)
              Blank()
              Text('↗').fontSize(17).fontColor(CubeTheme.secondary)
            }.width('100%').padding(14)
          }.layoutWeight(1).height(52).borderRadius(16).backgroundColor(CubeTheme.surface)
            .accessibilityText('偏好设置').onClick(() => { this.invalidateGesture(); this.canvasReady = false; this.page = 'settings'; })
        }.width('100%')
        Text(this.storageWarning.length > 0 ? this.storageWarning : '纯粹玩，安心转  ·  无广告 / 离线可玩')
          .fontSize(10).fontColor(CubeTheme.secondary).textAlign(TextAlign.Center)
      }.width('100%').constraintSize({ maxWidth: 520 }).padding({ left: 22, right: 22, top: 12, bottom: 22 })
    }.width('100%').height('100%').scrollBar(BarState.Off)
      .onGestureRecognizerJudgeBegin((_event: BaseGestureEvent, current: GestureRecognizer) =>
        this.judgeScrollGesture(current))
  }

  @Builder
  private backButton(compact: boolean = false) {
    Button({ type: ButtonType.Circle }) {
      Stack({ alignContent: Alignment.Center }) {
        Circle().width(compact ? 36 : 44).height(compact ? 36 : 44)
          .fill(CubeTheme.surface).stroke(CubeTheme.line).strokeWidth(1)
        SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(compact ? 24 : 20).fontColor([CubeTheme.ink])
      }.width(44).height(44)
    }.width(44).height(44).padding(0)
      .backgroundColor(Color.Transparent)
      .id('back-button')
      .accessibilityText('返回首页').onClick(() => this.goHome())
  }

  @Builder
  private header(title: string, compactBack: boolean = false) {
    Row({ space: 12 }) {
      this.backButton(compactBack)
      Text(title).fontSize(17).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink).layoutWeight(1)
      Blank().width(88)
    }.width('100%').height(48)
  }

  @Builder
  private gamePage() {
    Scroll() {
      Column({ space: 12 }) {
        Row({ space: 12 }) {
          this.backButton()
          Column({ space: 3 }) {
            Text(`${this.order} × ${this.order} 魔方`).fontSize(16).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
            Row({ space: 5 }) {
              Circle().width(5).height(5).fill(CubeTheme.green)
              Text(this.phaseLabel()).fontSize(11).fontColor(CubeTheme.green)
            }
          }.alignItems(HorizontalAlign.Start).layoutWeight(1)
          Blank().width(88)
        }.width('100%').height(48)
        Row() {
          Column({ space: 5 }) {
            Text('用时').fontSize(11).fontColor('#C3D2CA')
            Text(this.formatTime(this.elapsed)).fontFamily('monospace').fontSize(32)
              .fontWeight(FontWeight.Medium).fontColor('#FFFFFF').maxLines(1)
          }.alignItems(HorizontalAlign.Start).layoutWeight(1)
          Column({ space: 5 }) {
            Text('步数').fontSize(11).fontColor('#C3D2CA')
            Text(`${this.moves}`).fontSize(32).fontWeight(FontWeight.Medium).fontColor(CubeTheme.accent)
          }.alignItems(HorizontalAlign.End).constraintSize({ minWidth: 48 })
        }.width('100%').padding({ left: 22, right: 22, top: 16, bottom: 16 })
          .backgroundColor(CubeTheme.ink).borderRadius(24)
        Stack() {
          this.cubeStage()
        }.width('100%').height(Math.max(240, Math.min(480, this.viewportHeight - (this.hint.length > 0 ? 450 : 370))))
        Row({ space: 6 }) {
          Text('箭头示意沿行/列滑动，松手转层（非点击）\n空白或双指转视角')
            .fontSize(10).lineHeight(16).fontColor(CubeTheme.secondary).layoutWeight(1)
          Button(`箭头 ${this.beginnerGuides ? '开' : '关'}`, { type: ButtonType.Normal })
            .width(58).height(44).padding({ left: 4, right: 4 }).fontSize(11).borderRadius(12)
            .backgroundColor(this.beginnerGuides ? CubeTheme.mint : CubeTheme.surface).fontColor(CubeTheme.green)
            .accessibilityText(`新手方向箭头，${this.beginnerGuides ? '已开启' : '已关闭'}`)
            .onClick(() => this.setBeginnerGuides(!this.beginnerGuides))
          Button('正视角', { type: ButtonType.Normal }).width(58).height(44)
            .padding({ left: 4, right: 4 }).fontSize(11).borderRadius(12)
            .backgroundColor(CubeTheme.surface).fontColor(CubeTheme.green)
            .onClick(() => { this.invalidateGesture(); this.yaw = 0.62; this.pitch = -0.42; this.draw(); })
        }.width('100%')
        if (this.hint.length > 0) {
          Text(this.hint).fontSize(12).lineHeight(19).fontColor(CubeTheme.green)
            .width('100%').padding(12).backgroundColor(CubeTheme.mint).borderRadius(14)
        }
        Column({ space: 10 }) {
          Row({ space: 8 }) {
            Button('打乱', { type: ButtonType.Normal }).layoutWeight(1).height(46).borderRadius(14)
              .backgroundColor(CubeTheme.accent).fontColor(CubeTheme.ink).fontSize(14).fontWeight(FontWeight.Bold)
              .enabled(!this.busy).onClick(() => this.scramble())
            Button('教程', { type: ButtonType.Normal }).layoutWeight(1).height(46).borderRadius(14)
              .backgroundColor(CubeTheme.ink).fontColor('#FFFFFF').fontSize(14).enabled(!this.busy)
              .onClick(() => this.startLesson())
            Button('复位', { type: ButtonType.Normal }).layoutWeight(1).height(46).borderRadius(14)
              .backgroundColor(CubeTheme.soft).fontColor(CubeTheme.secondary).fontSize(14).onClick(() => this.confirmReset())
          }.width('100%').margin({ top: 4 })
          Row({ space: 12 }) {
            Button('↶ 撤销', { type: ButtonType.Normal }).layoutWeight(1).height(44).fontSize(12)
              .backgroundColor(Color.Transparent).fontColor(CubeTheme.secondary)
              .enabled(!this.busy && this.moves > 0 && this.phase !== 'tutorial' && this.phase !== 'solved')
              .onClick(() => this.undo())
            Button('历史提示', { type: ButtonType.Normal }).layoutWeight(1).height(44).fontSize(12)
              .backgroundColor(Color.Transparent).fontColor(CubeTheme.secondary)
              .enabled(!this.busy && this.phase !== 'tutorial' && this.phase !== 'solved')
              .onClick(() => this.showHint())
          }.width('100%')
        }.width('100%').padding(14).backgroundColor(CubeTheme.surface).borderRadius(24)
      }.width('100%').constraintSize({ maxWidth: 600 }).padding({ left: 18, right: 18, top: 10, bottom: 16 })
    }.width('100%').height('100%').scrollBar(BarState.Off)
      .onGestureRecognizerJudgeBegin((_event: BaseGestureEvent, current: GestureRecognizer) =>
        this.judgeScrollGesture(current))
      .onScrollFrameBegin((offset: number, state: ScrollState) => {
        // Keep a cube gesture from also scrolling its surrounding page.
        return { offsetRemain: this.touching ? 0 : offset };
      })
  }

  @Builder
  private statsPage() {
    Column({ space: 22 }) {
      this.header('成绩统计')
      Scroll() {
        Column({ space: 18 }) {
          this.sectionTitle('PERSONAL BEST', '每一秒，都是新突破。')
          Row() {
            Column({ space: 6 }) {
              Text('已完成挑战').fontSize(12).fontColor('#C3D2CA')
              Row({ space: 8 }) {
                Text(`${this.records.length}`).fontSize(40).fontWeight(FontWeight.Bold).fontColor(CubeTheme.accent)
                Text('次').fontSize(13).fontColor('#FFFFFF').margin({ top: 18 })
              }
            }.alignItems(HorizontalAlign.Start)
            Blank()
            this.chartMark(44, CubeTheme.accent)
          }.width('100%').padding(22).backgroundColor(CubeTheme.ink).borderRadius(24)
          Column({ space: 0 }) {
            ForEach(this.orders, (value: number) => {
              Row({ space: 12 }) {
                Text(`${value} 阶`).fontSize(14).fontWeight(FontWeight.Bold).fontColor(CubeTheme.green)
                  .width(48).height(48).textAlign(TextAlign.Center).backgroundColor(CubeTheme.mint).borderRadius(15)
                Column({ space: 5 }) {
                  Text(this.orderDescription(value)).fontSize(13).fontWeight(FontWeight.Medium).fontColor(CubeTheme.ink)
                  Text(`${this.orderSolves(value)} 次完成`).fontSize(10).fontColor(CubeTheme.secondary)
                }.alignItems(HorizontalAlign.Start)
                Blank()
                Text(this.bestTime(value)).fontSize(19).fontFamily('monospace').fontWeight(FontWeight.Medium)
                  .fontColor(this.orderSolves(value) > 0 ? CubeTheme.green : CubeTheme.muted)
              }.width('100%').padding({ top: 12, bottom: 12 })
              if (value !== 5) {
                Divider().color(CubeTheme.line)
              }
            })
          }.width('100%').padding({ left: 16, right: 16 }).backgroundColor(CubeTheme.surface).borderRadius(24)
          Row() {
            Text('最近成绩 · 最多显示 20 条').fontSize(12).fontWeight(FontWeight.Medium).fontColor(CubeTheme.secondary)
            Blank()
            Button('清空', { type: ButtonType.Normal }).height(44).fontSize(12).fontColor(CubeTheme.danger)
              .backgroundColor(Color.Transparent).enabled(this.records.length > 0).onClick(() => this.clearRecords())
          }.width('100%')
          if (this.records.length === 0) {
            Column({ space: 12 }) {
              SymbolGlyph($r('sys.symbol.flag')).fontSize(28).fontColor([CubeTheme.green])
              Text('还没有成绩').fontSize(16).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
              Text('打乱魔方并完成还原，\n留下你的第一个纪录。')
                .fontSize(12).fontColor(CubeTheme.secondary).lineHeight(21).textAlign(TextAlign.Center)
              Button('开始游戏  →', { type: ButtonType.Normal }).height(46).padding({ left: 28, right: 28 })
                .borderRadius(14).backgroundColor(CubeTheme.accent).fontColor(CubeTheme.ink).fontSize(13)
                .onClick(() => this.startGame())
            }.width('100%').padding(24).backgroundColor(CubeTheme.surface).borderRadius(24)
          } else {
            ForEach(this.records.slice(0, 20), (record: SolveRecord) => {
              Row({ space: 14 }) {
                Text(`${record.order} 阶`).fontSize(13).fontWeight(FontWeight.Medium).fontColor(CubeTheme.green)
                  .width(44).height(44).textAlign(TextAlign.Center).backgroundColor(CubeTheme.mint).borderRadius(12)
                Column({ space: 5 }) {
                  Text(this.formatTime(record.durationMs)).fontSize(20).fontColor(CubeTheme.ink).fontFamily('monospace')
                  Text(`${record.moves} 步 · ${this.dateLabel(record.date)}`).fontSize(11).fontColor(CubeTheme.secondary)
                }.alignItems(HorizontalAlign.Start)
                Blank()
                if (this.formatTime(record.durationMs) === this.bestTime(record.order)) {
                  Text('最佳').fontSize(10).fontColor(CubeTheme.green).padding(7)
                    .backgroundColor(CubeTheme.mint).borderRadius(8)
                }
              }.width('100%').padding(16).backgroundColor(CubeTheme.surface).borderRadius(18)
            })
          }
          Text('仅保留本机最近 200 条成绩\n教程与使用历史提示的练习不记榜。')
            .fontSize(10).fontColor(CubeTheme.secondary).lineHeight(18).textAlign(TextAlign.Center)
        }.width('100%').padding({ bottom: 24 })
      }.width('100%').layoutWeight(1).scrollBar(BarState.Off)
    }.width('100%').height('100%').constraintSize({ maxWidth: 600 }).padding({ left: 22, right: 22, top: 10 })
  }

  @Builder
  private settingsPage() {
    Column({ space: 22 }) {
      this.header('偏好设置', true)
      Scroll() {
        Column({ space: 18 }) {
          this.sectionTitle('MAKE IT YOURS', '你的魔方，你的节奏。')
          Column({ space: 16 }) {
            Row() {
              Text('默认阶数').fontSize(15).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
              Blank()
              Text('回到首页即可使用').fontSize(10).fontColor(CubeTheme.secondary)
            }.width('100%')
            Row({ space: 8 }) {
              ForEach(this.orders, (value: number) => {
                Button(`${value} 阶`, { type: ButtonType.Normal }).layoutWeight(1).height(46).borderRadius(13)
                  .backgroundColor(this.defaultOrder === value ? CubeTheme.ink : CubeTheme.soft)
                  .fontColor(this.defaultOrder === value ? CubeTheme.accent : CubeTheme.secondary)
                  .accessibilityText(`${value} 阶${this.defaultOrder === value ? '，已选择' : ''}`)
                  .onClick(() => { this.defaultOrder = value; this.order = value; this.saveSettings(); })
              })
            }.width('100%')
          }.width('100%').padding(18).backgroundColor(CubeTheme.surface).borderRadius(24)
          Column({ space: 14 }) {
            Row() {
              Text('转动动画').fontSize(15).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
              Blank()
              Text(`${this.speed.toFixed(1)}×`).fontSize(13).fontWeight(FontWeight.Medium).fontColor(CubeTheme.green)
                .padding({ left: 12, right: 12, top: 6, bottom: 6 }).backgroundColor(CubeTheme.mint).borderRadius(10)
            }.width('100%')
            Slider({ value: this.speed, min: 0.5, max: 2, step: 0.1 })
              .selectedColor(CubeTheme.green).trackColor(CubeTheme.line).blockColor(CubeTheme.green)
              .accessibilityText('转动动画速度，0.5 至 2 倍')
              .onChange((value: number, mode: SliderChangeMode) => {
                this.speed = value;
                if (mode === SliderChangeMode.End || mode === SliderChangeMode.Click) { this.saveSettings(); }
              })
            Row() {
              Text('从容 0.5×').fontSize(11).fontColor(CubeTheme.secondary)
              Blank()
              Text('敏捷 2.0×').fontSize(11).fontColor(CubeTheme.secondary)
            }.width('100%')
          }.width('100%').padding(18).backgroundColor(CubeTheme.surface).borderRadius(24)
          Column({ space: 18 }) {
            Row({ space: 12 }) {
              Column({ space: 5 }) {
                Text('新手方向箭头').fontSize(15).fontWeight(FontWeight.Medium).fontColor(CubeTheme.ink)
                Text('沿行/列滑动，松手转层；非点击\n仅提示操作方向，不提供还原答案')
                  .fontSize(11).lineHeight(17).fontColor(CubeTheme.secondary)
              }.alignItems(HorizontalAlign.Start).layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: this.beginnerGuides }).selectedColor(CubeTheme.green)
                .accessibilityText('新手方向箭头')
                .onChange((value: boolean) => this.setBeginnerGuides(value))
            }.width('100%')
            Divider().color(CubeTheme.line)
            Row() {
              Column({ space: 5 }) {
                Text('转动音效').fontSize(15).fontWeight(FontWeight.Medium).fontColor(CubeTheme.ink)
                Text('让每次落位，都有回应').fontSize(11).fontColor(CubeTheme.secondary)
              }.alignItems(HorizontalAlign.Start)
              Blank()
              Toggle({ type: ToggleType.Switch, isOn: this.sound }).selectedColor(CubeTheme.green)
                .accessibilityText('转动音效')
                .onChange((value: boolean) => { this.sound = value; this.saveSettings(); })
            }.width('100%')
            Divider().color(CubeTheme.line)
            Row() {
              Column({ space: 5 }) {
                Text('触感反馈').fontSize(15).fontWeight(FontWeight.Medium).fontColor(CubeTheme.ink)
                Text('细腻振感 · 需要设备支持').fontSize(11).fontColor(CubeTheme.secondary)
              }.alignItems(HorizontalAlign.Start)
              Blank()
              Toggle({ type: ToggleType.Switch, isOn: this.haptics }).selectedColor(CubeTheme.green)
                .accessibilityText('触感反馈')
                .onChange((value: boolean) => { this.haptics = value; this.saveSettings(); })
            }.width('100%')
          }.width('100%').padding(18).backgroundColor(CubeTheme.surface).borderRadius(24)
          Column({ space: 12 }) {
            Row({ space: 10 }) {
              this.brandMark()
              Column({ space: 3 }) {
                Text('Razor Cube').fontSize(15).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
                Text('轻一点，专注一点。').fontSize(11).fontColor(CubeTheme.secondary)
              }.alignItems(HorizontalAlign.Start)
            }.width('100%')
            Text('轻量三维魔方，随时开启。所有计算与成绩都留在本机，无广告，也无需联网。')
              .fontSize(12).fontColor(CubeTheme.secondary).lineHeight(21).width('100%')
          }.width('100%').padding(20).backgroundColor(CubeTheme.mint).borderRadius(24)
        }.width('100%').padding({ bottom: 24 })
      }.width('100%').layoutWeight(1).scrollBar(BarState.Off)
    }.width('100%').height('100%').constraintSize({ maxWidth: 600 }).padding({ left: 22, right: 22, top: 10 })
  }

  build() {
    Stack() {
      if (this.page === 'home') {
        this.homePage()
      } else if (this.page === 'game') {
        this.gamePage()
      } else if (this.page === 'stats') {
        this.statsPage()
      } else {
        this.settingsPage()
      }
    }.width('100%').height('100%').backgroundColor(CubeTheme.background)
      .onAreaChange((_old: Area, area: Area) => { this.viewportHeight = Number(area.height); })
  }
}
