import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { CubeModel, CubeMove } from '../model/CubeModel';
import { TeachingChallenge, createTeachingChallenges } from '../model/CubeTeaching';
import { CubeRenderer } from '../render/CubeRenderer';
import { CubeStore, CubeSettings, SolveRecord, TeachingRecord } from '../storage/CubeStore';
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
  @State private sound: boolean = true;
  @State private haptics: boolean = true;
  @State private beginnerGuides: boolean = true;
  @State private defaultOrder: number = 3;
  @State private records: SolveRecord[] = [];
  @State private teachingRecords: TeachingRecord[] = [];
  @State private challengeIndex: number = -1;
  @State private loaded: boolean = false;
  @State private storageWarning: string = '';
  @State private assisted: boolean = false;
  @State private viewportHeight: number = 740;
  @StorageLink('cubeForeground') @Watch('onForegroundChanged') private foreground: boolean = true;

  @StorageLink('cubeLanguage') @Watch('onLanguageChanged') private language: string = '';
  private textLanguage: string = '';
  private textCache: Map<string, string> = new Map<string, string>();
  private hintKey: string = '';
  private hintArgs: Array<string | number> = [];

  private model: CubeModel = new CubeModel(3);
  private renderer: CubeRenderer = new CubeRenderer();
  private store: CubeStore = new CubeStore();
  private feedback: CubeFeedback = new CubeFeedback();
  private context2d: CanvasRenderingContext2D = new CanvasRenderingContext2D(new RenderingContextSettings(true));
  private gameScroller: Scroller = new Scroller();
  private canvasWidth: number = 320;
  private canvasHeight: number = 320;
  private canvasReady: boolean = false;
  private cubeZoom: number = 1;
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
  private guideAt: number = -1;
  private guideHidden: boolean = false;
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
  private practiceOrder: number = 3;
  private readonly challenges: TeachingChallenge[] = createTeachingChallenges();
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

  private tr(name: string, ...args: Array<string | number>): string {
    if (this.textLanguage !== this.language) {
      this.textCache.clear();
      this.textLanguage = this.language;
    }
    if (args.length === 0 && this.textCache.has(name)) { return this.textCache.get(name) as string; }
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    try {
      const text = context.resourceManager.getStringByNameSync(name, ...args);
      if (args.length === 0) { this.textCache.set(name, text); }
      return text;
    } catch {
      hilog.error(0x0000, 'CoolCube', 'Unable to load string: %{public}s', name);
      return '—';
    }
  }

  private setHint(name: string = '', ...args: Array<string | number>): void {
    this.hintKey = name;
    this.hintArgs = args;
    this.hint = name.length > 0 ? this.tr(name, ...args) : '';
  }

  private onLanguageChanged(): void {
    this.textCache.clear();
    if (this.hintKey.length > 0) {
      if (this.hintKey === 'lesson_step' && this.lessonIndex < this.lesson.length) { this.updateLessonHint(); }
      else if ((this.hintKey === 'history_hint' || this.hintKey === 'teaching_history_hint') && this.hintMove !== null) {
        this.setHint(this.hintKey, this.moveLabel(this.hintMove));
      }
      else { this.setHint(this.hintKey, ...this.hintArgs); }
    }
    if (this.storageWarning.length > 0) { this.storageWarning = this.tr('storage_unavailable'); }
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
      this.teachingRecords = this.store.teachingRecords.slice();
      this.invalidateGesture(true);
      this.model.reset(this.order);
      this.draw();
    } catch {
      this.storageWarning = this.tr('storage_unavailable');
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

  private guideTarget(): CubeMove | null {
    return this.phase === 'tutorial' && this.lessonIndex < this.lesson.length ?
      this.lesson[this.lessonIndex] : this.hintMove;
  }

  private resetGuide(): void {
    this.guideAt = -1;
    this.guideHidden = false;
  }

  private draw(progress: number = 0): void {
    if (!this.canvasReady) { this.resetGuide(); return; }
    this.renderer.draw(this.context2d, this.canvasWidth, this.canvasHeight,
      this.model, this.yaw, this.pitch, this.activeMove, progress, this.cubeZoom);
    if (this.busy || this.page !== 'game' || (this.challengeIndex >= 0 && this.phase === 'solved')) {
      this.resetGuide();
      return;
    }
    const target = this.guideTarget();
    if (target === null) {
      this.resetGuide();
      if (this.beginnerGuides) { this.renderer.drawBeginnerGuides(this.context2d); }
      return;
    }
    if (!this.foreground || this.touching) { this.resetGuide(); return; }
    const guide = this.renderer.getSwipeGuide(target);
    this.guideHidden = guide === null;
    if (guide === null) { this.guideAt = -1; return; }
    const now = Date.now();
    if (this.guideAt < 0) { this.guideAt = now; }
    this.renderer.drawGuide(this.context2d, guide, Math.max(0, now - this.guideAt) % 1800 / 1800,
      this.phase !== 'tutorial');
  }

  private frame(): void {
    if (!this.foreground) { return; }
    if (!this.busy) {
      if (this.canvasReady && this.page === 'game' && !this.touching && this.guideTarget() !== null) {
        // An offscreen target waits for a view/canvas change instead of repainting nothing.
        if (!this.guideHidden) { this.draw(); }
      } else { this.resetGuide(); }
      return;
    }
    if (this.activeMove === null) { return; }
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
      this.setHint('scramble_ready');
    } else if (this.queueKind === 'lessonSetup') {
      this.phase = 'tutorial';
      this.updateLessonHint();
    } else if (this.queueKind === 'lessonStep') {
      this.lessonIndex++;
      this.feedback.play(this.sound, this.haptics);
      if (this.lessonIndex >= this.lesson.length) {
        this.phase = 'idle';
        this.setHint('lesson_complete');
      } else {
        this.updateLessonHint();
      }
    } else if (this.queueKind === 'reset') {
      this.resetSession();
      return;
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
    this.setHint();
    this.assisted = false;
    this.hintMove = null;
    this.lesson = [];
    this.lessonIndex = 0;
    this.lessonTotal = 0;
    this.challengeIndex = -1;
    this.draw();
  }

  private openTeaching(): void {
    if (!this.loaded || !this.foreground || this.page !== 'home') { return; }
    this.practiceOrder = this.order;
    this.canvasReady = false;
    this.resetSession();
    this.page = 'teaching';
  }

  private startChallenge(index: number): void {
    if (!this.loaded || !this.foreground || this.busy || !Number.isInteger(index) ||
      index < 0 || index >= this.challenges.length ||
      (this.page !== 'teaching' && (this.page !== 'game' || this.challengeIndex < 0))) { return; }
    const challenge = this.challenges[index];
    const mounted = this.page === 'game';
    const ready = mounted && this.canvasReady;
    this.canvasReady = false;
    this.order = challenge.order;
    this.resetSession();
    this.challengeIndex = index;
    challenge.load(this.model);
    this.yaw = 0.62;
    this.pitch = -0.42;
    this.cubeZoom = 1.12;
    this.phase = 'ready';
    this.setHint('teaching_start_hint');
    this.page = 'game';
    this.canvasReady = ready;
    if (mounted) { this.gameScroller.scrollTo({ xOffset: 0, yOffset: 0 }); }
    this.draw();
  }

  private retryChallenge(): void {
    if (this.busy || !this.foreground || this.page !== 'game' || this.challengeIndex < 0) { return; }
    if (this.phase !== 'playing') {
      this.startChallenge(this.challengeIndex);
      return;
    }
    const savedSession = this.sessionId;
    const index = this.challengeIndex;
    this.getUIContext().showAlertDialog({
      title: this.tr('teaching_retry_title'), message: this.tr('teaching_retry_message'),
      primaryButton: { value: this.tr('cancel'), action: () => {} },
      secondaryButton: { value: this.tr('teaching_retry'), action: () => {
        if (savedSession === this.sessionId && this.page === 'game') { this.startChallenge(index); }
      } }
    });
  }

  private leaveChallenge(): void {
    this.canvasReady = false;
    this.order = this.practiceOrder;
    this.resetSession();
    this.cubeZoom = 1;
    this.page = 'teaching';
  }

  private nextChallenge(): void {
    if (this.page !== 'game' || this.phase !== 'solved' || this.challengeIndex < 0 ||
      this.busy || !this.foreground) { return; }
    if (this.challengeIndex + 1 < this.challenges.length) { this.startChallenge(this.challengeIndex + 1); }
    else { this.leaveChallenge(); }
  }

  private teachingStatus(challenge: TeachingChallenge): string {
    const record = this.teachingRecords.find((item: TeachingRecord) => item.challengeId === challenge.id);
    if (record === undefined) { return this.tr('teaching_status_new'); }
    return this.tr(record.assisted ? 'teaching_status_guided' : 'teaching_status_solved');
  }

  private teachingBest(challenge: TeachingChallenge): string {
    const record = this.teachingRecords.find((item: TeachingRecord) => item.challengeId === challenge.id);
    return record === undefined ? '' : this.tr('teaching_best', record.moves, this.formatTime(record.durationMs));
  }

  private chooseOrder(value: number): void {
    this.order = value;
    this.resetSession();
  }

  private startGame(): void {
    this.resetSession();
    this.yaw = 0.62;
    this.pitch = -0.42;
    // 1.12 is the largest zoom that never clips the cube at extreme orbit angles.
    this.cubeZoom = 1.12;
    this.canvasReady = false;
    this.page = 'game';
  }

  private leavePage(): void {
    if (this.challengeIndex >= 0) { this.order = this.practiceOrder; }
    this.canvasReady = false;
    this.resetSession();
    this.cubeZoom = 1;
    this.page = 'home';
  }

  private goHome(): void {
    if (this.page === 'game' && this.challengeIndex >= 0) {
      if (this.busy || this.phase === 'playing') {
        const savedSession = this.sessionId;
        this.getUIContext().showAlertDialog({
          title: this.tr('teaching_leave_title'), message: this.tr('teaching_leave_message'),
          primaryButton: { value: this.tr('keep_playing'), action: () => {} },
          secondaryButton: { value: this.tr('teaching_back'), action: () => {
            if (savedSession === this.sessionId && this.foreground) { this.leaveChallenge(); }
          } }
        });
      } else { this.leaveChallenge(); }
      return;
    }
    if (this.page === 'game' && (this.busy || this.phase === 'playing' || this.phase === 'ready' || this.phase === 'tutorial')) {
      this.getUIContext().showAlertDialog({
        title: this.tr('leave_title'),
        message: this.tr('leave_message'),
        primaryButton: { value: this.tr('keep_playing'), action: () => {} },
        secondaryButton: { value: this.tr('return_home'), action: () => this.leavePage() }
      });
    } else { this.leavePage(); }
  }

  private confirmReset(): void {
    if (this.busy || !this.foreground || this.page !== 'game' || this.challengeIndex >= 0) { return; }
    const savedSession = this.sessionId;
    this.getUIContext().showAlertDialog({
      title: this.tr('reset_title'),
      message: this.tr('reset_message'),
      primaryButton: { value: this.tr('cancel'), action: () => {} },
      secondaryButton: { value: this.tr('reset'), action: () => {
        if (savedSession === this.sessionId) { this.resetStepByStep(); }
      } }
    });
  }

  private resetStepByStep(): void {
    if (this.busy || !this.foreground || this.page !== 'game' || this.challengeIndex >= 0) { return; }
    const solution = this.model.getSolution();
    if (this.model.isSolved() || solution.length === 0) {
      this.resetSession();
      return;
    }
    this.invalidateGesture();
    this.sessionId++;
    this.phase = 'resetting';
    this.elapsed = 0;
    this.timeBase = 0;
    this.startedAt = 0;
    this.moves = 0;
    this.assisted = true;
    this.hintMove = null;
    this.lesson = [];
    this.lessonIndex = 0;
    this.lessonTotal = 0;
    this.setHint('resetting_hint');
    this.animate(solution, 'reset');
    this.draw();
  }

  private scramble(): void {
    if (this.busy || this.challengeIndex >= 0) { return; }
    if (this.phase === 'playing' || this.phase === 'tutorial') {
      this.getUIContext().showAlertDialog({
        title: this.tr('rescramble_title'), message: this.tr('rescramble_message'),
        primaryButton: { value: this.tr('cancel'), action: () => {} },
        secondaryButton: { value: this.tr('rescramble'), action: () => this.doScramble() }
      });
    } else { this.doScramble(); }
  }

  private doScramble(): void {
    if (this.challengeIndex >= 0) { return; }
    this.resetSession();
    const counts: number[] = [11, 25, 45, 65];
    this.setHint('scrambling_hint');
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
    return this.tr('layer_move', move.axis.toUpperCase(), move.layer + 1, move.turns > 0 ? '+90°' : '−90°');
  }

  private sameMove(a: CubeMove, b: CubeMove): boolean {
    return a.axis === b.axis && a.layer === b.layer && a.turns === b.turns;
  }

  private requestMove(move: CubeMove): void {
    if (this.busy || !this.foreground || this.page !== 'game' ||
      (this.challengeIndex >= 0 && this.phase === 'solved')) { return; }
    if (this.phase === 'tutorial') {
      if (this.lessonIndex < this.lesson.length && this.sameMove(move, this.lesson[this.lessonIndex])) {
        this.animate([move], 'lessonStep');
      } else { this.toast(this.tr('lesson_follow')); }
      return;
    }
    if (this.phase === 'solved') {
      this.phase = 'idle';
      this.setHint('free_practice_hint');
      this.elapsed = 0;
      this.timeBase = 0;
    }
    if (this.phase === 'ready') {
      this.phase = 'playing';
      this.startedAt = Date.now();
      this.setHint();
    }
    if (this.hintMove !== null) { this.setHint(); }
    this.hintMove = null;
    this.animate([move], 'user');
  }

  private undo(): void {
    if (this.busy || !this.foreground || this.phase === 'tutorial' || this.phase === 'solved') { return; }
    const move = this.model.undo();
    if (move !== null) {
      this.invalidateGesture(true);
      this.moves = this.model.moveCount;
      this.setHint();
      this.hintMove = null;
      this.draw();
      if (this.phase === 'playing' && this.model.isSolved()) { this.finishSolve(); }
    } else { this.toast(this.tr('nothing_to_undo')); }
  }

  private showHint(): void {
    if (this.busy || !this.foreground || this.page !== 'game' || this.phase === 'tutorial' || this.model.isSolved()) { return; }
    const solution = this.model.getSolution();
    if (solution.length > 0) {
      this.assisted = true;
      this.hintMove = solution[0];
      this.resetGuide();
      if (this.challengeIndex >= 0) { this.setHint('teaching_history_hint', this.moveLabel(solution[0])); }
      else { this.setHint('history_hint', this.moveLabel(solution[0])); }
      this.draw();
    }
  }

  private startLesson(): void {
    if (this.busy || this.challengeIndex >= 0) { return; }
    if (this.phase === 'playing' || this.phase === 'ready') {
      this.getUIContext().showAlertDialog({
        title: this.tr('lesson_title'), message: this.tr('lesson_message'),
        primaryButton: { value: this.tr('cancel'), action: () => {} },
        secondaryButton: { value: this.tr('start_lesson'), action: () => this.doLesson() }
      });
    } else { this.doLesson(); }
  }

  private doLesson(): void {
    if (this.challengeIndex >= 0) { return; }
    this.resetSession();
    const faces: string[] = ['R', 'U', "F'", 'L', "D'"];
    const setup: CubeMove[] = [];
    for (let i = 0; i < faces.length; i++) { setup.push(this.faceMove(faces[i])); }
    this.lesson = [];
    for (let i = setup.length - 1; i >= 0; i--) { this.lesson.push(setup[i].inverse()); }
    this.lessonTotal = this.lesson.length;
    this.setHint('lesson_preparing');
    this.animate(setup, 'lessonSetup');
  }

  private updateLessonHint(): void {
    this.resetGuide();
    this.setHint('lesson_step', this.lessonIndex + 1, this.lessonTotal, this.moveLabel(this.lesson[this.lessonIndex]));
  }

  private finishTeaching(): void {
    const challenge = this.challenges[this.challengeIndex];
    const record = new TeachingRecord(challenge.id, this.elapsed, this.moves, this.assisted);
    const savedSession = this.sessionId;
    this.setHint('teaching_saving');
    this.store.addTeachingRecord(record).then(() => {
      this.teachingRecords = this.store.teachingRecords.slice();
      if (savedSession === this.sessionId && this.phase === 'solved') { this.setHint('teaching_saved'); }
    }).catch(() => {
      if (savedSession === this.sessionId && this.phase === 'solved') { this.setHint('teaching_save_failed'); }
      else { this.toast(this.tr('teaching_previous_save_failed')); }
    });
  }

  private finishSolve(): void {
    if (this.phase !== 'playing' || this.busy || !this.model.isSolved()) { return; }
    this.elapsed = this.timeBase + Date.now() - this.startedAt;
    this.phase = 'solved';
    if (this.challengeIndex >= 0) {
      this.finishTeaching();
      return;
    }
    if (this.assisted) {
      this.setHint('solved_assisted');
      return;
    }
    this.setHint('solved_saving');
    const record = new SolveRecord(this.order, this.elapsed, this.moves);
    const savedSession = this.sessionId;
    this.store.addRecord(record).then(() => {
      this.records = this.store.records.slice();
      if (savedSession === this.sessionId && this.phase === 'solved') {
        this.setHint('solved_saved');
      }
    }).catch(() => {
      if (savedSession === this.sessionId && this.phase === 'solved') {
        this.setHint('solved_save_failed');
      } else if (this.phase !== 'solved') {
        this.toast(this.tr('previous_save_failed'));
      }
    });
  }

  private invalidateGesture(layerOnly: boolean = false): void {
    this.resetGuide();
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
          (this.challengeIndex >= 0 && this.phase === 'solved') || !this.renderer.hitTest(this.startX, this.startY);
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
      const hideGuide = !this.touching && !this.busy && this.page === 'game' && this.guideTarget() !== null;
      this.touching = true;
      this.resetGuide();
      if (hideGuide) { this.draw(); }
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
    this.store.saveSettings(settings).catch(() => this.toast(this.tr('settings_save_failed')));
  }

  private clearRecords(): void {
    this.getUIContext().showAlertDialog({
      title: this.tr('clear_title'), message: this.tr('clear_message'),
      primaryButton: { value: this.tr('cancel'), action: () => {} },
      secondaryButton: { value: this.tr('clear_results'), action: () => {
        this.store.clearRecords().then(() => { this.records = []; })
          .catch(() => this.toast(this.tr('clear_failed')));
      } }
    });
  }

  private toast(message: string): void {
    try {
      this.getUIContext().getPromptAction().showToast({ message: message, duration: 2400 });
    } catch {
      this.hintKey = '';
      this.hintArgs = [];
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
    if (this.busy && this.queueKind === 'reset') { return this.tr('phase_resetting'); }
    if (this.busy && this.queueKind === 'scramble') { return this.tr('phase_scrambling'); }
    if (this.phase === 'ready') { return this.tr('phase_ready'); }
    if (this.phase === 'playing') { return this.assisted ? this.tr('phase_assisted') : this.tr('phase_playing'); }
    if (this.phase === 'solved') { return this.tr('phase_solved'); }
    if (this.phase === 'tutorial') { return this.tr('phase_tutorial'); }
    return this.tr('phase_idle');
  }

  @Builder
  private cubeCanvas() {
    Canvas(this.context2d)
      .width('100%')
      .height('100%')
      .onReady(() => { this.canvasReady = true; this.resetGuide(); this.draw(); })
      .onAreaChange((_old: Area, area: Area) => {
        this.invalidateGesture();
        this.canvasWidth = Number(area.width);
        this.canvasHeight = Number(area.height);
        this.draw();
      })
      .onTouch((event: TouchEvent) => this.touch(event))
      .accessibilityText(this.tr('cube_accessibility', this.order))
  }

  private orderDescription(value: number): string {
    if (value === 2) { return this.tr('order_beginner'); }
    if (value === 3) { return this.tr('order_classic'); }
    if (value === 4) { return this.tr('order_advanced'); }
    return this.tr('order_expert');
  }

  private orderSolves(value: number): number {
    return this.records.filter((record: SolveRecord) => record.order === value).length;
  }

  @Builder
  private sectionTitle(kickerKey: string, titleKey: string) {
    Column({ space: 8 }) {
      Text(this.tr(kickerKey)).fontSize(10).fontColor(CubeTheme.green).letterSpacing(2).fontWeight(FontWeight.Medium)
      Text(this.tr(titleKey)).fontSize(27).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
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
      Circle().width(194).height(194).fill(Color.Transparent)
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
            Text(this.tr('brand_name')).fontSize(12).letterSpacing(1.5).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
            Text(this.tr('brand_tagline')).fontSize(10).fontColor(CubeTheme.secondary)
          }.alignItems(HorizontalAlign.Start).layoutWeight(1)
          Blank()
        }.width('100%').height(44)
        Column({ space: 8 }) {
          Text(this.tr('home_welcome')).fontSize(26).lineHeight(34)
            .fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink).width('100%')
          Row({ space: 7 }) {
            Circle().width(5).height(5).fill(CubeTheme.green)
            Text(this.tr('home_subtitle')).fontSize(12).fontColor(CubeTheme.secondary)
          }.width('100%')
        }.width('100%').alignItems(HorizontalAlign.Start).margin({ top: 4 })
        Column({ space: 0 }) {
          Row() {
            Text(`${this.order} × ${this.order} / ${this.orderDescription(this.order)}`)
              .fontSize(11).fontColor(CubeTheme.green).fontWeight(FontWeight.Medium)
            Blank()
            Text(this.tr('interactive_preview')).fontSize(10).fontColor(CubeTheme.secondary)
          }.width('100%').padding({ left: 18, right: 18, top: 15 })
          Stack() {
            this.cubeStage()
          }.width('100%').height(202)
          Text(this.tr('preview_help')).fontSize(10).fontColor(CubeTheme.secondary)
            .padding({ bottom: 14 })
        }.width('100%').backgroundColor(CubeTheme.mint).borderRadius(28).clip(true)
        Column({ space: 12 }) {
          Row() {
            Text(this.tr('choose_challenge')).fontSize(15).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
            Blank()
            Text('02 — 05').fontSize(10).fontColor(CubeTheme.muted).letterSpacing(1)
          }.width('100%')
          Row({ space: 8 }) {
            ForEach(this.orders, (value: number) => {
              Button(this.tr('order_label', value), { type: ButtonType.Normal })
                .layoutWeight(1).height(48).borderRadius(16).fontSize(16).fontWeight(FontWeight.Medium)
                .backgroundColor(this.order === value ? CubeTheme.ink : CubeTheme.surface)
                .fontColor(this.order === value ? CubeTheme.accent : CubeTheme.secondary)
                .border({ width: 1, color: this.order === value ? CubeTheme.ink : CubeTheme.line, radius: 16 })
                .accessibilityText(this.tr('order_accessibility', value, this.order === value ? this.tr('selected_suffix') : ''))
                .onClick(() => this.chooseOrder(value))
            })
          }.width('100%')
        }.width('100%')
        Button(this.tr('start_game'), { type: ButtonType.Normal }).width('100%').height(56)
          .backgroundColor(CubeTheme.accent).fontColor(CubeTheme.ink).fontSize(17).fontWeight(FontWeight.Bold)
          .borderRadius(18).enabled(this.loaded).onClick(() => this.startGame())
        Button({ type: ButtonType.Normal }) {
          Stack({ alignContent: Alignment.Center }) {
            Text(this.tr('teaching_entry_title')).fontSize(17).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
            Row() {
              Text('→').fontSize(20).fontColor(CubeTheme.ink).accessibilityLevel('no')
            }.width('100%').justifyContent(FlexAlign.End).padding({ right: 18 })
          }.width('100%').height(56)
        }.width('100%').height(56).padding(0).borderRadius(18)
          .backgroundColor(CubeTheme.mint).enabled(this.loaded)
          .accessibilityText(this.tr('teaching_entry_title')).onClick(() => this.openTeaching())
        Row({ space: 10 }) {
          Button({ type: ButtonType.Normal }) {
            Row({ space: 10 }) {
              this.chartMark(19, CubeTheme.green)
              Text(this.tr('statistics')).fontSize(13).fontWeight(FontWeight.Medium).fontColor(CubeTheme.ink)
              Blank()
              Text('↗').fontSize(17).fontColor(CubeTheme.secondary)
            }.width('100%').padding(14)
          }.layoutWeight(1).height(52).borderRadius(16).backgroundColor(CubeTheme.surface)
            .accessibilityText(this.tr('statistics')).onClick(() => { this.invalidateGesture(); this.canvasReady = false; this.page = 'stats'; })
          Button({ type: ButtonType.Normal }) {
            Row({ space: 10 }) {
              SymbolGlyph($r('sys.symbol.gearshape')).fontSize(19).fontColor([CubeTheme.green])
              Text(this.tr('settings')).fontSize(13).fontWeight(FontWeight.Medium).fontColor(CubeTheme.ink)
              Blank()
              Text('↗').fontSize(17).fontColor(CubeTheme.secondary)
            }.width('100%').padding(14)
          }.layoutWeight(1).height(52).borderRadius(16).backgroundColor(CubeTheme.surface)
            .accessibilityText(this.tr('settings')).onClick(() => { this.invalidateGesture(); this.canvasReady = false; this.page = 'settings'; })
        }.width('100%')
        Text(this.storageWarning.length > 0 ? this.storageWarning : this.tr('offline_footer'))
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
      .accessibilityText(this.tr(this.challengeIndex >= 0 ? 'teaching_back' : 'return_home')).onClick(() => this.goHome())
  }

  @Builder
  private header(titleKey: string, compactBack: boolean = false) {
    Row({ space: 12 }) {
      this.backButton(compactBack)
      Text(this.tr(titleKey)).fontSize(17).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink).layoutWeight(1)
    }.width('100%').height(48)
  }

  @Builder
  private teachingPage() {
    Column({ space: 18 }) {
      this.header('teaching')
      Scroll() {
        Column({ space: 16 }) {
          this.sectionTitle('teaching_kicker', 'teaching_title')
          Text(this.tr('teaching_description')).fontSize(13).lineHeight(21).fontColor(CubeTheme.secondary).width('100%')
          Column({ space: 10 }) {
            Text(this.tr('teaching_progress', this.teachingRecords.length, this.challenges.length))
              .fontSize(20).fontWeight(FontWeight.Bold).fontColor(CubeTheme.accent)
            Text(this.tr('teaching_rules')).fontSize(11).lineHeight(19).fontColor('#DCE6DF')
          }.width('100%').alignItems(HorizontalAlign.Start).padding(20).backgroundColor(CubeTheme.ink).borderRadius(24)
          ForEach(this.challenges, (challenge: TeachingChallenge, index: number) => {
            Button({ type: ButtonType.Normal }) {
              Column({ space: 11 }) {
                Row({ space: 10 }) {
                  Text((index + 1).toString().padStart(2, '0')).fontSize(19).fontWeight(FontWeight.Bold)
                    .fontColor(CubeTheme.green).width(46).height(46).textAlign(TextAlign.Center)
                    .backgroundColor(CubeTheme.mint).borderRadius(14)
                  Column({ space: 5 }) {
                    Text(this.tr(challenge.titleKey)).fontSize(16).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
                    Text(this.tr('teaching_level_details', challenge.order, challenge.referenceMoves))
                      .fontSize(11).lineHeight(17).fontColor(CubeTheme.secondary)
                  }.alignItems(HorizontalAlign.Start).layoutWeight(1)
                  Text('›').fontSize(25).fontColor(CubeTheme.green).accessibilityLevel('no')
                }.width('100%')
                Text(this.tr(challenge.descriptionKey)).fontSize(12).lineHeight(20).fontColor(CubeTheme.secondary).width('100%')
                Row({ space: 8 }) {
                  Text(this.tr(challenge.difficulty === 1 ? 'teaching_difficulty_1' :
                    (challenge.difficulty === 2 ? 'teaching_difficulty_2' : 'teaching_difficulty_3')))
                    .fontSize(10).fontColor(CubeTheme.green)
                    .padding({ left: 9, right: 9, top: 5, bottom: 5 }).backgroundColor(CubeTheme.mint).borderRadius(8)
                  Text(this.teachingStatus(challenge)).fontSize(11).fontColor(CubeTheme.green).layoutWeight(1)
                    .textAlign(TextAlign.End)
                }.width('100%')
                if (this.teachingBest(challenge).length > 0) {
                  Text(this.teachingBest(challenge)).fontSize(11).fontColor(CubeTheme.secondary).width('100%')
                }
              }.width('100%').padding(18).alignItems(HorizontalAlign.Start)
            }.width('100%').padding(0).borderRadius(22).backgroundColor(CubeTheme.surface)
              .enabled(this.loaded).onClick(() => this.startChallenge(index))
          }, (challenge: TeachingChallenge) => challenge.id)
          if (this.storageWarning.length > 0) {
            Text(this.storageWarning).fontSize(11).lineHeight(18).fontColor(CubeTheme.danger).width('100%')
          }
        }.width('100%').padding({ bottom: 24 })
      }.width('100%').layoutWeight(1).scrollBar(BarState.Off)
    }.width('100%').height('100%').constraintSize({ maxWidth: 600 }).padding({ left: 22, right: 22, top: 10 })
  }

  @Builder
  private teachingGoal() {
    if (this.challengeIndex >= 0) {
      Column({ space: 6 }) {
        Text(this.tr('teaching_goal')).fontSize(13).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
        Text(this.tr(this.challenges[this.challengeIndex].tipKey)).fontSize(11).lineHeight(18).fontColor(CubeTheme.secondary)
        Text(this.tr('teaching_level_details', this.order, this.challenges[this.challengeIndex].referenceMoves))
          .fontSize(10).fontColor(CubeTheme.green)
      }.width('100%').alignItems(HorizontalAlign.Start).padding(14).backgroundColor(CubeTheme.surface).borderRadius(18)
    }
  }

  @Builder
  private teachingControls() {
    Column({ space: 10 }) {
      if (this.phase === 'solved') {
        Text(this.tr(this.assisted ? 'teaching_passed_guided' : 'teaching_passed'))
          .fontSize(19).fontWeight(FontWeight.Bold).fontColor(CubeTheme.green).width('100%')
        Text(this.tr(this.challengeIndex === this.challenges.length - 1 ? 'teaching_all_complete' : 'teaching_completed_note'))
          .fontSize(11).lineHeight(18).fontColor(CubeTheme.secondary).width('100%')
        Button(this.tr(this.challengeIndex === this.challenges.length - 1 ? 'teaching_back' : 'teaching_next'),
          { type: ButtonType.Normal }).width('100%').height(48).borderRadius(14).fontSize(15)
          .backgroundColor(CubeTheme.accent).fontColor(CubeTheme.ink).fontWeight(FontWeight.Bold)
          .enabled(!this.busy).onClick(() => this.nextChallenge())
      }
      Row({ space: 10 }) {
        Button(this.tr('teaching_retry'), { type: ButtonType.Normal }).layoutWeight(1).height(46).borderRadius(14)
          .backgroundColor(CubeTheme.ink).fontColor('#FFFFFF').fontSize(14)
          .enabled(!this.busy).onClick(() => this.retryChallenge())
        Button(this.tr('teaching_back'), { type: ButtonType.Normal }).layoutWeight(1).height(46).borderRadius(14)
          .backgroundColor(CubeTheme.soft).fontColor(CubeTheme.secondary).fontSize(14)
          .onClick(() => this.goHome())
      }.width('100%')
      if (this.phase !== 'solved') {
        Text(this.tr('teaching_hint_note')).fontSize(10).lineHeight(17).fontColor(CubeTheme.secondary).width('100%')
      }
    }.width('100%')
  }

  @Builder
  private gamePage() {
    Scroll(this.gameScroller) {
      Column({ space: 12 }) {
        Row({ space: 12 }) {
          this.backButton()
          Column({ space: 3 }) {
            if (this.challengeIndex >= 0) {
              Text(this.tr('teaching_level', this.challengeIndex + 1) + ' · ' +
                this.tr(this.challenges[this.challengeIndex].titleKey))
                .fontSize(16).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink).maxLines(2)
            } else {
              Text(this.tr('cube_title', this.order)).fontSize(16).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
            }
            Row({ space: 5 }) {
              Circle().width(5).height(5).fill(CubeTheme.green)
              Text(this.phaseLabel()).fontSize(11).fontColor(CubeTheme.green)
            }
          }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        }.width('100%').constraintSize({ minHeight: 48 })
        if (this.challengeIndex >= 0) {
          this.teachingGoal()
        }
        Row() {
          Column({ space: 5 }) {
            Text(this.tr('elapsed_time')).fontSize(11).fontColor('#C3D2CA')
            Text(this.formatTime(this.elapsed)).fontFamily('monospace').fontSize(32)
              .fontWeight(FontWeight.Medium).fontColor('#FFFFFF').maxLines(1)
          }.alignItems(HorizontalAlign.Start).layoutWeight(1)
          Column({ space: 5 }) {
            Text(this.tr('move_count')).fontSize(11).fontColor('#C3D2CA')
            Text(`${this.moves}`).fontSize(32).fontWeight(FontWeight.Medium).fontColor(CubeTheme.accent)
          }.alignItems(HorizontalAlign.End).constraintSize({ minWidth: 48 })
        }.width('100%').padding({ left: 22, right: 22, top: 16, bottom: 16 })
          .backgroundColor(CubeTheme.ink).borderRadius(24)
        Stack() {
          this.cubeStage()
        }.width('100%').height(Math.max(240, Math.min(480, this.viewportHeight -
          (this.hint.length > 0 ? 450 : 370) - (this.challengeIndex >= 0 ? 120 : 0))))
        Row({ space: 6 }) {
          Text(this.guideTarget() !== null ? this.tr('guided_help') :
            this.tr('gesture_help'))
            .fontSize(10).lineHeight(16).fontColor(CubeTheme.secondary).layoutWeight(1)
          Button(this.tr('guides_button', this.beginnerGuides ? this.tr('on') : this.tr('off')), { type: ButtonType.Normal })
            .width(70).height(44).padding({ left: 4, right: 4 }).fontSize(11).borderRadius(12)
            .backgroundColor(this.beginnerGuides ? CubeTheme.mint : CubeTheme.surface).fontColor(CubeTheme.green)
            .accessibilityText(this.tr('guides_accessibility', this.beginnerGuides ? this.tr('on') : this.tr('off')))
            .onClick(() => this.setBeginnerGuides(!this.beginnerGuides))
          Button(this.tr('reset_view'), { type: ButtonType.Normal }).width(58).height(44)
            .padding({ left: 4, right: 4 }).fontSize(11).borderRadius(12)
            .backgroundColor(CubeTheme.surface).fontColor(CubeTheme.green)
            .onClick(() => { this.invalidateGesture(); this.yaw = 0.62; this.pitch = -0.42; this.draw(); })
        }.width('100%')
        if (this.hint.length > 0) {
          Text(this.hint).fontSize(12).lineHeight(19).fontColor(CubeTheme.green)
            .width('100%').padding(12).backgroundColor(CubeTheme.mint).borderRadius(14)
        }
        Column({ space: 10 }) {
          if (this.challengeIndex >= 0) {
            this.teachingControls()
          } else {
            Row({ space: 8 }) {
              Button(this.tr('scramble'), { type: ButtonType.Normal }).layoutWeight(1).height(46).borderRadius(14)
                .backgroundColor(CubeTheme.accent).fontColor(CubeTheme.ink).fontSize(14).fontWeight(FontWeight.Bold)
                .enabled(!this.busy).onClick(() => this.scramble())
              Button(this.tr('tutorial'), { type: ButtonType.Normal }).layoutWeight(1).height(46).borderRadius(14)
                .backgroundColor(CubeTheme.ink).fontColor('#FFFFFF').fontSize(14).enabled(!this.busy)
                .onClick(() => this.startLesson())
              Button(this.tr('reset'), { type: ButtonType.Normal }).layoutWeight(1).height(46).borderRadius(14)
                .backgroundColor(CubeTheme.soft).fontColor(CubeTheme.secondary).fontSize(14)
                .enabled(!this.busy).onClick(() => this.confirmReset())
            }.width('100%').margin({ top: 4 })
          }
          Row({ space: 12 }) {
            Button(this.tr('undo'), { type: ButtonType.Normal }).layoutWeight(1).height(44).fontSize(12)
              .backgroundColor(Color.Transparent).fontColor(CubeTheme.secondary)
              .enabled(!this.busy && this.moves > 0 && this.phase !== 'tutorial' && this.phase !== 'solved')
              .onClick(() => this.undo())
            Button(this.tr('history_help'), { type: ButtonType.Normal }).layoutWeight(1).height(44).fontSize(12)
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
      .onAppear(() => this.gameScroller.scrollTo({ xOffset: 0, yOffset: 0 }))
  }

  @Builder
  private statsPage() {
    Column({ space: 22 }) {
      this.header('statistics')
      Scroll() {
        Column({ space: 18 }) {
          this.sectionTitle('personal_best', 'stats_tagline')
          Row() {
            Column({ space: 6 }) {
              Text(this.tr('completed_challenges')).fontSize(12).fontColor('#C3D2CA')
              Row({ space: 8 }) {
                Text(`${this.records.length}`).fontSize(40).fontWeight(FontWeight.Bold).fontColor(CubeTheme.accent)
                Text(this.tr('solve_unit')).fontSize(13).fontColor('#FFFFFF').margin({ top: 18 })
              }
            }.alignItems(HorizontalAlign.Start)
            Blank()
            this.chartMark(44, CubeTheme.accent)
          }.width('100%').padding(22).backgroundColor(CubeTheme.ink).borderRadius(24)
          Column({ space: 0 }) {
            ForEach(this.orders, (value: number) => {
              Row({ space: 12 }) {
                Text(this.tr('order_label', value)).fontSize(12).fontWeight(FontWeight.Bold).fontColor(CubeTheme.green)
                  .width(48).height(48).textAlign(TextAlign.Center).backgroundColor(CubeTheme.mint).borderRadius(15)
                Column({ space: 5 }) {
                  Text(this.orderDescription(value)).fontSize(13).fontWeight(FontWeight.Medium).fontColor(CubeTheme.ink)
                  Text(this.tr('completed_count', this.orderSolves(value))).fontSize(10).fontColor(CubeTheme.secondary)
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
            Text(this.tr('recent_results')).fontSize(12).fontWeight(FontWeight.Medium).fontColor(CubeTheme.secondary).layoutWeight(1)
            Blank()
            Button(this.tr('clear'), { type: ButtonType.Normal }).height(44).fontSize(12).fontColor(CubeTheme.danger)
              .backgroundColor(Color.Transparent).enabled(this.records.length > 0).onClick(() => this.clearRecords())
          }.width('100%')
          if (this.records.length === 0) {
            Column({ space: 12 }) {
              SymbolGlyph($r('sys.symbol.flag')).fontSize(28).fontColor([CubeTheme.green])
              Text(this.tr('no_results')).fontSize(16).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
              Text(this.tr('no_results_help'))
                .fontSize(12).fontColor(CubeTheme.secondary).lineHeight(21).textAlign(TextAlign.Center)
              Button(this.tr('start_game'), { type: ButtonType.Normal }).height(46).padding({ left: 28, right: 28 })
                .borderRadius(14).backgroundColor(CubeTheme.accent).fontColor(CubeTheme.ink).fontSize(13)
                .onClick(() => this.startGame())
            }.width('100%').padding(24).backgroundColor(CubeTheme.surface).borderRadius(24)
          } else {
            ForEach(this.records.slice(0, 20), (record: SolveRecord) => {
              Row({ space: 14 }) {
                Text(this.tr('order_label', record.order)).fontSize(12).fontWeight(FontWeight.Medium).fontColor(CubeTheme.green)
                  .width(44).height(44).textAlign(TextAlign.Center).backgroundColor(CubeTheme.mint).borderRadius(12)
                Column({ space: 5 }) {
                  Text(this.formatTime(record.durationMs)).fontSize(20).fontColor(CubeTheme.ink).fontFamily('monospace')
                  Text(this.tr('record_details', record.moves, this.dateLabel(record.date))).fontSize(11).fontColor(CubeTheme.secondary)
                }.alignItems(HorizontalAlign.Start)
                Blank()
                if (this.formatTime(record.durationMs) === this.bestTime(record.order)) {
                  Text(this.tr('best')).fontSize(10).fontColor(CubeTheme.green).padding(7)
                    .backgroundColor(CubeTheme.mint).borderRadius(8)
                }
              }.width('100%').padding(16).backgroundColor(CubeTheme.surface).borderRadius(18)
            })
          }
          Text(this.tr('results_retention'))
            .fontSize(10).fontColor(CubeTheme.secondary).lineHeight(18).textAlign(TextAlign.Center)
        }.width('100%').padding({ bottom: 24 })
      }.width('100%').layoutWeight(1).scrollBar(BarState.Off)
    }.width('100%').height('100%').constraintSize({ maxWidth: 600 }).padding({ left: 22, right: 22, top: 10 })
  }

  @Builder
  private settingsPage() {
    Column({ space: 22 }) {
      this.header('settings', true)
      Scroll() {
        Column({ space: 18 }) {
          Column({ space: 16 }) {
            Row() {
              Text(this.tr('default_order')).fontSize(15).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
              Blank()
              Text(this.tr('default_order_help')).fontSize(10).fontColor(CubeTheme.secondary).layoutWeight(1).textAlign(TextAlign.End)
            }.width('100%')
            Row({ space: 8 }) {
              ForEach(this.orders, (value: number) => {
                Button(this.tr('order_label', value), { type: ButtonType.Normal }).layoutWeight(1).height(46).borderRadius(13)
                  .backgroundColor(this.defaultOrder === value ? CubeTheme.ink : CubeTheme.soft)
                  .fontColor(this.defaultOrder === value ? CubeTheme.accent : CubeTheme.secondary)
                  .accessibilityText(this.tr('order_accessibility', value, this.defaultOrder === value ? this.tr('selected_suffix') : ''))
                  .onClick(() => { this.defaultOrder = value; this.order = value; this.saveSettings(); })
              })
            }.width('100%')
          }.width('100%').padding(18).backgroundColor(CubeTheme.surface).borderRadius(24)
          Column({ space: 14 }) {
            Row() {
              Text(this.tr('turn_animation')).fontSize(15).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
              Blank()
              Text(`${this.speed.toFixed(1)}×`).fontSize(13).fontWeight(FontWeight.Medium).fontColor(CubeTheme.green)
                .padding({ left: 12, right: 12, top: 6, bottom: 6 }).backgroundColor(CubeTheme.mint).borderRadius(10)
            }.width('100%')
            Slider({ value: this.speed, min: 0.5, max: 2, step: 0.1 })
              .selectedColor(CubeTheme.green).trackColor(CubeTheme.line).blockColor(CubeTheme.green)
              .accessibilityText(this.tr('speed_accessibility'))
              .onChange((value: number, mode: SliderChangeMode) => {
                this.speed = value;
                if (mode === SliderChangeMode.End || mode === SliderChangeMode.Click) { this.saveSettings(); }
              })
            Row() {
              Text(this.tr('speed_slow')).fontSize(11).fontColor(CubeTheme.secondary)
              Blank()
              Text(this.tr('speed_fast')).fontSize(11).fontColor(CubeTheme.secondary)
            }.width('100%')
          }.width('100%').padding(18).backgroundColor(CubeTheme.surface).borderRadius(24)
          Column({ space: 18 }) {
            Row({ space: 12 }) {
              Column({ space: 5 }) {
                Text(this.tr('beginner_guides')).fontSize(15).fontWeight(FontWeight.Medium).fontColor(CubeTheme.ink)
                Text(this.tr('beginner_guides_help'))
                  .fontSize(11).lineHeight(17).fontColor(CubeTheme.secondary)
              }.alignItems(HorizontalAlign.Start).layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: this.beginnerGuides }).selectedColor(CubeTheme.green)
                .accessibilityText(this.tr('beginner_guides'))
                .onChange((value: boolean) => this.setBeginnerGuides(value))
            }.width('100%')
            Divider().color(CubeTheme.line)
            Row() {
              Column({ space: 5 }) {
                Text(this.tr('turn_sound')).fontSize(15).fontWeight(FontWeight.Medium).fontColor(CubeTheme.ink)
                Text(this.tr('turn_sound_help')).fontSize(11).fontColor(CubeTheme.secondary)
              }.alignItems(HorizontalAlign.Start).layoutWeight(1)
              Blank().width(12)
              Toggle({ type: ToggleType.Switch, isOn: this.sound }).selectedColor(CubeTheme.green)
                .accessibilityText(this.tr('turn_sound'))
                .onChange((value: boolean) => { this.sound = value; this.saveSettings(); })
            }.width('100%')
            Divider().color(CubeTheme.line)
            Row() {
              Column({ space: 5 }) {
                Text(this.tr('haptic_feedback')).fontSize(15).fontWeight(FontWeight.Medium).fontColor(CubeTheme.ink)
                Text(this.tr('haptic_help')).fontSize(11).fontColor(CubeTheme.secondary)
              }.alignItems(HorizontalAlign.Start).layoutWeight(1)
              Blank().width(12)
              Toggle({ type: ToggleType.Switch, isOn: this.haptics }).selectedColor(CubeTheme.green)
                .accessibilityText(this.tr('haptic_feedback'))
                .onChange((value: boolean) => { this.haptics = value; this.saveSettings(); })
            }.width('100%')
          }.width('100%').padding(18).backgroundColor(CubeTheme.surface).borderRadius(24)
          Column({ space: 12 }) {
            Row({ space: 10 }) {
              this.brandMark()
              Column({ space: 3 }) {
                Text(this.tr('about_name')).fontSize(15).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
                Text(this.tr('about_tagline')).fontSize(11).fontColor(CubeTheme.secondary)
              }.alignItems(HorizontalAlign.Start)
            }.width('100%')
            Text(this.tr('about_description'))
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
      } else if (this.page === 'teaching') {
        this.teachingPage()
      } else if (this.page === 'stats') {
        this.statsPage()
      } else {
        this.settingsPage()
      }
    }.width('100%').height('100%').backgroundColor(CubeTheme.background)
      .onAreaChange((_old: Area, area: Area) => { this.viewportHeight = Number(area.height); })
  }
}
