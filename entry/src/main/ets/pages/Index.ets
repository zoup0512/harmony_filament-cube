import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { CubeModel, CubeMove } from '../model/CubeModel';
import { TeachingChallenge, createTeachingChallenges } from '../model/CubeTeaching';
import { CubeRenderer } from '../render/CubeRenderer';
import { CubeStore, CubeSettings, SolveRecord, TeachingRecord } from '../storage/CubeStore';
import { CubeFeedback } from '../platform/CubeFeedback';
import { CubeFont, CubeLayout, CubeRadius, CubeSpace, CubeTheme } from './CubeTheme';
import { CubeButtons } from './CubeStyles';
import { SolveResult } from '../model/SolveResult';
import { SolveResultDialog } from './SolveResultDialog';
import { BackButton, BrandMark, ChartMark, OrderSelector } from '../components/CubeWidgets';
import { StatsOrderRow, StatsPage, StatsRecentRow } from '../components/StatsPage';
import { TeachingGroup, TeachingItem, TeachingPage } from '../components/TeachingPage';
import { SettingsPage } from '../components/SettingsPage';

@Entry
@Component
struct Index {
  @State @Watch('syncNav') private page: string = 'home';
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
  @State private viewportWidth: number = 360;
  @State private goalVisible: boolean = false;
  @State private stageMin: number = 240;
  @State private solveResult: SolveResult = new SolveResult();
  private resultVisible: boolean = false;
  private resultDialog: CustomDialogController | null = null;
  @StorageLink('cubeForeground') @Watch('onForegroundChanged') private foreground: boolean = true;

  @StorageLink('cubeLanguage') @Watch('onLanguageChanged') private language: string = '';
  private textLanguage: string = '';
  private textCache: Map<string, string> = new Map<string, string>();
  private hintKey: string = '';
  private hintArgs: Array<string | number> = [];
  private gestureHelpSeen: boolean = false;

  private model: CubeModel = new CubeModel(3);
  private renderer: CubeRenderer = new CubeRenderer();
  private store: CubeStore = new CubeStore();
  private feedback: CubeFeedback = new CubeFeedback();
  private context2d: CanvasRenderingContext2D = new CanvasRenderingContext2D(new RenderingContextSettings(true));
  private guidanceContext: CanvasRenderingContext2D = new CanvasRenderingContext2D(new RenderingContextSettings(true));
  private guidanceReady: boolean = false;
  private guidanceWidth: number = 0;
  private guidanceHeight: number = 0;
  private guidanceDirty: boolean = true;
  private navStack: NavPathStack = new NavPathStack();
  private canvasOwner: string = '';
  private guidanceOwner: string = '';
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
    this.closeSolveResult();
    this.invalidateGesture();
    this.stopTimers();
    this.feedback.release();
  }

  onBackPress(): boolean {
    if (this.resultVisible) {
      this.closeSolveResult();
      return true;
    }
    if (this.page !== 'home') {
      this.goHome();
      return true;
    }
    return false;
  }

  // The navigation stack mirrors `page`: teaching levels sit above the catalogue, every
  // other page sits directly above home. Common prefixes are kept so back stays natural.
  private syncNav(): void {
    const target: string[] = this.page === 'home' ? [] :
      (this.page === 'game' && this.challengeIndex >= 0 ? ['teaching', 'game'] : [this.page]);
    const current: string[] = this.navStack.getAllPathName();
    let same = 0;
    while (same < current.length && same < target.length && current[same] === target[same]) { same++; }
    if (same === current.length && same === target.length) { return; }
    if (same < current.length) {
      if (same === 0) { this.navStack.clear(target.length === 0); }
      else { this.navStack.popToIndex(same - 1, target.length === same); }
    }
    for (let i = same; i < target.length; i++) { this.navStack.pushPathByName(target[i], null, true); }
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
      this.clearGuidance();
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
    this.guidanceDirty = true;
  }

  private draw(progress: number = 0): void {
    if (!this.canvasReady) { this.resetGuide(); return; }
    this.renderer.draw(this.context2d, this.canvasWidth, this.canvasHeight,
      this.model, this.yaw, this.pitch, this.activeMove, progress, this.cubeZoom);
    this.drawGuidance();
  }

  private clearGuidance(): void {
    if (this.guidanceReady) {
      this.guidanceContext.clearRect(0, 0, this.guidanceWidth, this.guidanceHeight);
    }
  }

  private drawGuidance(): void {
    // The cube remains untouched between real scene changes. Hint animation clears
    // only this transparent layer, independently of the static cube rendering.
    this.clearGuidance();
    if (!this.canvasReady || !this.guidanceReady || this.guidanceWidth !== this.canvasWidth ||
      this.guidanceHeight !== this.canvasHeight || !this.foreground ||
      this.busy || this.page !== 'game' || (this.challengeIndex >= 0 && this.phase === 'solved')) {
      this.resetGuide();
      return;
    }
    this.guidanceDirty = false;
    const target = this.guideTarget();
    if (target === null) {
      this.resetGuide();
      this.guidanceDirty = false;
      if (this.beginnerGuides) { this.renderer.drawBeginnerGuides(this.guidanceContext); }
      return;
    }
    if (this.touching) { this.resetGuide(); return; }
    const guide = this.renderer.getSwipeGuide(target);
    this.guideHidden = guide === null;
    if (guide === null) { this.guideAt = -1; return; }
    const now = Date.now();
    if (this.guideAt < 0) { this.guideAt = now; }
    this.renderer.drawGuide(this.guidanceContext, guide, Math.max(0, now - this.guideAt) % 1800 / 1800,
      this.phase !== 'tutorial');
  }

  private frame(): void {
    if (!this.foreground) { return; }
    if (!this.busy) {
      if (this.canvasReady && this.page === 'game' && !this.touching && this.guideTarget() !== null &&
        (this.guidanceDirty || !this.guideHidden)) {
        // Hidden targets and static corner guides wait for a scene/input change.
        this.drawGuidance();
      }
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
    this.drawGuidance();
  }

  private resetSession(): void {
    this.closeSolveResult();
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
    const ready = this.page === 'game' && this.canvasReady;
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

  private teachingKind(challenge: TeachingChallenge): string {
    const record = this.teachingRecords.find((item: TeachingRecord) => item.challengeId === challenge.id);
    if (record === undefined) { return 'new'; }
    return record.assisted ? 'guided' : 'solved';
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
    if (!this.gestureHelpSeen) {
      this.gestureHelpSeen = true;
      this.setHint('gesture_help');
    }
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
    if (this.resultVisible || this.busy || !this.foreground || this.page !== 'game' ||
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
    if (this.hintMove !== null || this.hintKey === 'gesture_help') { this.setHint(); }
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
      // Repeated taps must not restart an already visible cycle or redraw the cube.
      if (this.hintMove !== null && this.sameMove(this.hintMove, solution[0]) &&
        !this.guideHidden && this.guideAt >= 0 && this.guidanceReady && !this.guidanceDirty) { return; }
      this.hintMove = solution[0];
      this.resetGuide();
      if (this.challengeIndex >= 0) { this.setHint('teaching_history_hint', this.moveLabel(solution[0])); }
      else { this.setHint('history_hint', this.moveLabel(solution[0])); }
      this.drawGuidance();
    }
  }

  private startTutorial(): void {
    if (!this.loaded || !this.foreground || this.page !== 'home') { return; }
    this.startGame();
    this.doLesson();
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

  private showSolveResult(): void {
    if (this.page !== 'game' || this.phase !== 'solved' || this.busy || !this.foreground ||
      this.solveResult.sessionId === this.sessionId) { return; }
    const savedSession = this.sessionId;
    const teaching = this.challengeIndex >= 0;
    this.solveResult = new SolveResult(savedSession, this.order, this.elapsed, this.moves,
      this.challengeIndex, this.assisted);
    this.invalidateGesture();
    this.resultVisible = true;
    this.resultDialog = new CustomDialogController({
      builder: SolveResultDialog({
        result: this.solveResult,
        viewportHeight: this.viewportHeight,
        newBest: !teaching && !this.assisted && this.isNewBest(this.order, this.elapsed),
        primaryLabel: !teaching ? $r('app.string.result_again') :
          (this.challengeIndex === this.challenges.length - 1 ? $r('app.string.result_levels') :
            $r('app.string.teaching_next')),
        onPrimary: () => this.resultPrimary(savedSession),
        onDone: () => this.closeSolveResult(savedSession)
      }),
      alignment: DialogAlignment.Center,
      customStyle: true,
      autoCancel: true,
      isModal: true,
      maskColor: CubeTheme.scrim,
      openAnimation: { duration: 180, curve: Curve.EaseOut },
      closeAnimation: { duration: 120, curve: Curve.EaseIn },
      onWillDismiss: (action: DismissDialogAction) => {
        if (action.reason === DismissReason.PRESS_BACK || action.reason === DismissReason.TOUCH_OUTSIDE) {
          this.closeSolveResult(savedSession);
          action.dismiss();
        }
      }
    });
    this.resultDialog.open();
  }

  private isNewBest(order: number, durationMs: number): boolean {
    return !this.records.some((record: SolveRecord) => record.order === order && record.durationMs <= durationMs);
  }

  private resultPrimary(savedSession: number): void {
    if (savedSession !== this.sessionId || savedSession !== this.solveResult.sessionId) { return; }
    const teaching = this.challengeIndex >= 0;
    this.closeSolveResult(savedSession);
    if (teaching) { this.nextChallenge(); } else { this.doScramble(); }
  }

  private closeSolveResult(savedSession: number = this.sessionId): void {
    if (savedSession !== this.sessionId || savedSession !== this.solveResult.sessionId) { return; }
    this.resultVisible = false;
    const dialog = this.resultDialog;
    this.resultDialog = null;
    if (dialog !== null) { dialog.close(); }
    this.invalidateGesture();
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
    this.hintMove = null;
    this.draw();
    this.showSolveResult();
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
    if (event.type === TouchType.Cancel || !this.foreground || this.resultVisible) {
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
      if (hideGuide) { this.drawGuidance(); }
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
    this.drawGuidance();
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

  private teachingGroups(): TeachingGroup[] {
    const groups: TeachingGroup[] = [];
    this.challenges.forEach((challenge: TeachingChallenge, index: number) => {
      let group: TeachingGroup | undefined = groups.find((item: TeachingGroup) => item.order === challenge.order);
      if (group === undefined) {
        group = new TeachingGroup(challenge.order);
        groups.push(group);
      }
      group.items.push(new TeachingItem(index, challenge.id, this.tr(challenge.titleKey),
        this.tr('teaching_level_details', challenge.order, challenge.referenceMoves), this.tr(challenge.descriptionKey),
        this.tr(challenge.difficulty === 1 ? 'teaching_difficulty_1' :
          (challenge.difficulty === 2 ? 'teaching_difficulty_2' : 'teaching_difficulty_3')),
        this.teachingStatus(challenge), this.teachingKind(challenge), this.teachingBest(challenge)));
    });
    return groups;
  }

  private statsRows(): StatsOrderRow[] {
    return this.orders.map((value: number) => new StatsOrderRow(value, this.tr('order_label', value),
      this.orderDescription(value), this.tr('completed_count', this.orderSolves(value)), this.bestTime(value),
      this.orderSolves(value) > 0));
  }

  private recentRows(): StatsRecentRow[] {
    // Exactly one "best" badge per size, even when two results share the same time.
    const best: Map<number, number> = new Map<number, number>();
    this.records.forEach((record: SolveRecord, index: number) => {
      const current = best.get(record.order);
      if (current === undefined || record.durationMs < this.records[current].durationMs) { best.set(record.order, index); }
    });
    return this.records.slice(0, 20).map((record: SolveRecord, index: number) => new StatsRecentRow(
      `${record.date}-${index}`, this.tr('order_label', record.order), this.formatTime(record.durationMs),
      this.tr('record_details', record.moves, this.dateLabel(record.date)), best.get(record.order) === index));
  }

  private trendBars(): number[] {
    const times = this.records.filter((record: SolveRecord) => record.order === this.order).slice(0, 10)
      .map((record: SolveRecord) => record.durationMs).reverse();
    const longest = times.reduce((max: number, value: number) => Math.max(max, value), 0);
    return times.map((value: number) => longest > 0 ? value / longest : 0);
  }

  @Builder
  private cubeCanvas(owner: string) {
    Canvas(this.context2d)
      .id('cube-base-canvas')
      .width('100%')
      .height('100%')
      .onReady(() => { this.canvasOwner = owner; this.canvasReady = true; this.resetGuide(); this.draw(); })
      .onDisAppear(() => { if (this.canvasOwner === owner) { this.canvasReady = false; this.clearGuidance(); this.resetGuide(); } })
      .onAreaChange((_old: Area, area: Area) => {
        this.invalidateGesture();
        this.canvasWidth = Number(area.width);
        this.canvasHeight = Number(area.height);
        this.draw();
      })
      .onTouch((event: TouchEvent) => this.touch(event))
      .accessibilityText(this.tr('cube_accessibility', this.order))
  }

  @Builder
  private guidanceCanvas(owner: string) {
    Canvas(this.guidanceContext)
      .id('cube-guidance-canvas')
      .width('100%')
      .height('100%')
      .hitTestBehavior(HitTestMode.None)
      .accessibilityLevel('no')
      .onReady(() => { this.guidanceOwner = owner; this.guidanceReady = true; this.resetGuide(); this.drawGuidance(); })
      .onDisAppear(() => { if (this.guidanceOwner === owner) { this.clearGuidance(); this.guidanceReady = false; this.resetGuide(); } })
      .onAreaChange((_old: Area, area: Area) => {
        this.clearGuidance();
        this.guidanceWidth = Number(area.width);
        this.guidanceHeight = Number(area.height);
        this.resetGuide();
        this.drawGuidance();
      })
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
  private cubeStage(owner: string) {
    Stack() {
      Column().width(this.stageMin * 0.86).height(this.stageMin * 0.86).borderRadius(this.stageMin * 0.43)
        .border({ width: 1, color: CubeTheme.stageRing }).hitTestBehavior(HitTestMode.None)
      Column().width(this.stageMin * 0.7).height(this.stageMin * 0.7).borderRadius(this.stageMin * 0.35)
        .backgroundColor(CubeTheme.stageDisc).hitTestBehavior(HitTestMode.None)
      this.cubeCanvas(owner)
      this.guidanceCanvas(owner)
    }.width('100%').height('100%')
      .linearGradient({ angle: 135, colors: [[CubeTheme.stageStart, 0], [CubeTheme.stageEnd, 1]] })
      .borderRadius(28).clip(true)
      .onAreaChange((_old: Area, area: Area) => {
        this.stageMin = Math.min(Number(area.width), Number(area.height));
      })
  }

  @Builder
  private homeTile(labelKey: string, page: string) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 10 }) {
        if (page === 'stats') {
          ChartMark({ markSize: 19, color: CubeTheme.green })
        } else {
          SymbolGlyph($r('sys.symbol.gearshape')).fontSize(19).fontColor([CubeTheme.green])
        }
        Text(this.tr(labelKey)).fontSize(CubeFont.label).fontWeight(FontWeight.Medium).fontColor(CubeTheme.ink)
          .layoutWeight(1).maxLines(2)
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(16).fontColor([CubeTheme.secondary])
          .accessibilityLevel('no')
      }.width('100%').padding(14)
    }.layoutWeight(1).constraintSize({ minHeight: 52 }).padding(0).borderRadius(CubeRadius.l)
      .backgroundColor(CubeTheme.surface).clickEffect({ level: ClickEffectLevel.LIGHT })
      .id(`home-${page}`).accessibilityText(this.tr(labelKey))
      .onClick(() => { this.invalidateGesture(); this.canvasReady = false; this.page = page; })
  }

  @Builder
  private homePage() {
    Scroll() {
      Column({ space: CubeSpace.m }) {
        Row({ space: 10 }) {
          BrandMark()
          Column({ space: 2 }) {
            Text(this.tr('brand_name')).fontSize(CubeFont.label).letterSpacing(1.5).fontWeight(FontWeight.Bold)
              .fontColor(CubeTheme.ink)
            Text(this.tr('brand_tagline')).fontSize(CubeFont.caption).fontColor(CubeTheme.secondary)
          }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        }.width('100%').height(44)
        Column({ space: CubeSpace.xs }) {
          Text(this.tr('home_welcome')).fontSize(CubeFont.title).lineHeight(34)
            .fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink).width('100%')
          Row({ space: 7 }) {
            Column().width(5).height(5).borderRadius(2.5).backgroundColor(CubeTheme.green)
            Text(this.tr('home_subtitle')).fontSize(CubeFont.label).fontColor(CubeTheme.secondary)
          }.width('100%')
        }.width('100%').alignItems(HorizontalAlign.Start).margin({ top: CubeSpace.xxs })
        Column() {
          Row() {
            Text(`${this.order} × ${this.order} / ${this.orderDescription(this.order)}`)
              .fontSize(CubeFont.caption).fontColor(CubeTheme.green).fontWeight(FontWeight.Medium)
            Blank()
            Text(this.tr('interactive_preview')).fontSize(CubeFont.caption).fontColor(CubeTheme.secondary)
          }.width('100%').padding({ left: 18, right: 18, top: 15 })
          Stack() {
            // Only one cube canvas may be bound to the shared 2D context at a time.
            if (this.page === 'home') {
              this.cubeStage('home')
            }
          }.width('100%').height(220)
          Text(this.tr('preview_help')).fontSize(CubeFont.caption).fontColor(CubeTheme.secondary)
            .padding({ bottom: 14 })
        }.width('100%').backgroundColor(CubeTheme.mint).borderRadius(28).clip(true)
        Column({ space: CubeSpace.s }) {
          Row() {
            Text(this.tr('choose_challenge')).fontSize(CubeFont.subhead).fontWeight(FontWeight.Bold)
              .fontColor(CubeTheme.ink)
            Blank()
            Text('02 — 05').fontSize(CubeFont.caption).fontColor(CubeTheme.muted).letterSpacing(1)
              .accessibilityLevel('no')
          }.width('100%')
          OrderSelector({ selected: this.order, orders: this.orders,
            onSelect: (value: number) => this.chooseOrder(value) })
        }.width('100%')
        Button({ type: ButtonType.Normal }) {
          Row({ space: CubeSpace.xs }) {
            Text(this.tr('start_game')).fontSize(CubeFont.headline).fontWeight(FontWeight.Bold)
              .fontColor(CubeTheme.onAccent)
            SymbolGlyph($r('sys.symbol.arrow_right')).fontSize(20).fontColor([CubeTheme.onAccent])
          }
        }.width('100%').attributeModifier(CubeButtons.hero).enabled(this.loaded).id('home-start')
          .accessibilityText(this.tr('start_game')).onClick(() => this.startGame())
        Button({ type: ButtonType.Normal }) {
          Row({ space: CubeSpace.s }) {
            Stack() {
              SymbolGlyph($r('sys.symbol.graduationcap')).fontSize(22).fontColor([CubeTheme.green])
            }.width(44).height(44).backgroundColor(CubeTheme.mint).borderRadius(CubeRadius.m)
            Column({ space: 6 }) {
              Text(this.tr('teaching')).fontSize(CubeFont.subhead).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
              Row({ space: CubeSpace.xs }) {
                Progress({ value: this.teachingRecords.length, total: this.challenges.length, type: ProgressType.Linear })
                  .layoutWeight(1).color(CubeTheme.green).backgroundColor(CubeTheme.line).style({ strokeWidth: 4 })
                Text(this.tr('teaching_progress', this.teachingRecords.length, this.challenges.length))
                  .fontSize(CubeFont.caption).fontColor(CubeTheme.secondary)
              }.width('100%')
            }.alignItems(HorizontalAlign.Start).layoutWeight(1)
            SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(18).fontColor([CubeTheme.secondary])
              .accessibilityLevel('no')
          }.width('100%').padding(CubeSpace.s)
        }.width('100%').padding(0).borderRadius(CubeRadius.l).backgroundColor(CubeTheme.surface)
          .clickEffect({ level: ClickEffectLevel.LIGHT }).enabled(this.loaded).id('home-teaching')
          .accessibilityText(this.tr('teaching') + ' · ' +
            this.tr('teaching_progress', this.teachingRecords.length, this.challenges.length))
          .onClick(() => this.openTeaching())
        Row({ space: 10 }) {
          this.homeTile('statistics', 'stats')
          this.homeTile('settings', 'settings')
        }.width('100%')
        Button({ type: ButtonType.Normal }) {
          Row({ space: CubeSpace.xxs }) {
            SymbolGlyph($r('sys.symbol.hand_tap')).fontSize(16).fontColor([CubeTheme.green])
            Text(this.tr('home_tutorial_link')).fontSize(CubeFont.label).fontWeight(FontWeight.Medium)
              .fontColor(CubeTheme.green)
            SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([CubeTheme.green])
          }
        }.backgroundColor(Color.Transparent).constraintSize({ minHeight: 44 }).padding({ left: 12, right: 12 })
          .enabled(this.loaded).id('home-tutorial').accessibilityText(this.tr('home_tutorial_link'))
          .onClick(() => this.startTutorial())
        Text(this.storageWarning.length > 0 ? this.storageWarning : this.tr('offline_footer'))
          .fontSize(CubeFont.caption).fontColor(this.storageWarning.length > 0 ? CubeTheme.danger : CubeTheme.secondary)
          .textAlign(TextAlign.Center)
      }.width('100%').constraintSize({ maxWidth: 520 }).padding({ left: 22, right: 22, top: 12, bottom: 22 })
    }.width('100%').height('100%').scrollBar(BarState.Off).align(Alignment.Top)
      .onGestureRecognizerJudgeBegin((_event: BaseGestureEvent, current: GestureRecognizer) =>
        this.judgeScrollGesture(current))
  }

  @Builder
  private teachingGoal() {
    Button({ type: ButtonType.Normal }) {
      Row({ space: CubeSpace.xxs }) {
        SymbolGlyph($r('sys.symbol.info_circle')).fontSize(16).fontColor([CubeTheme.green])
        Text(this.tr('teaching_goal_button')).fontSize(CubeFont.label).fontColor(CubeTheme.green).maxLines(1)
      }
    }.height(44).padding({ left: 10, right: 10 }).borderRadius(CubeRadius.m).backgroundColor(CubeTheme.mint)
      .clickEffect({ level: ClickEffectLevel.LIGHT }).id('game-goal')
      .accessibilityText(this.tr('teaching_goal_details'))
      .onClick(() => this.showTeachingGoal())
  }

  private showTeachingGoal(): void {
    if (!this.foreground || this.page !== 'game' || this.challengeIndex < 0 ||
      this.challengeIndex >= this.challenges.length) { return; }
    this.invalidateGesture();
    this.goalVisible = true;
  }

  @Builder
  private goalSheet() {
    Scroll() {
      Column({ space: CubeSpace.m }) {
        if (this.challengeIndex >= 0 && this.challengeIndex < this.challenges.length) {
          Text(this.tr('teaching_level', this.challengeIndex + 1) + ' · ' +
            this.tr(this.challenges[this.challengeIndex].titleKey))
            .fontSize(CubeFont.headline).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink).width('100%')
          Text(this.tr('teaching_goal_summary')).fontSize(CubeFont.body).fontWeight(FontWeight.Medium)
            .fontColor(CubeTheme.green).padding({ left: 10, right: 10, top: 6, bottom: 6 })
            .backgroundColor(CubeTheme.mint).borderRadius(CubeRadius.s)
          Column({ space: CubeSpace.xxs }) {
            Text(this.tr('teaching_goal_tip')).fontSize(CubeFont.caption).fontWeight(FontWeight.Medium)
              .fontColor(CubeTheme.secondary)
            Text(this.tr(this.challenges[this.challengeIndex].tipKey)).fontSize(CubeFont.body).lineHeight(21)
              .fontColor(CubeTheme.ink).width('100%')
          }.width('100%').alignItems(HorizontalAlign.Start)
          Column({ space: CubeSpace.xxs }) {
            Text(this.tr('teaching_goal_reference')).fontSize(CubeFont.caption).fontWeight(FontWeight.Medium)
              .fontColor(CubeTheme.secondary)
            Text(this.tr('teaching_level_details', this.order, this.challenges[this.challengeIndex].referenceMoves))
              .fontSize(CubeFont.body).lineHeight(21).fontColor(CubeTheme.ink).width('100%')
            Text(this.tr('teaching_start_hint')).fontSize(CubeFont.body).lineHeight(21).fontColor(CubeTheme.ink)
              .width('100%')
          }.width('100%').alignItems(HorizontalAlign.Start)
          Column({ space: CubeSpace.xxs }) {
            Text(this.tr('teaching_goal_rules')).fontSize(CubeFont.caption).fontWeight(FontWeight.Medium)
              .fontColor(CubeTheme.secondary)
            Text(this.tr('teaching_hint_note')).fontSize(CubeFont.body).lineHeight(21).fontColor(CubeTheme.ink)
              .width('100%')
          }.width('100%').alignItems(HorizontalAlign.Start)
          Button(this.tr('teaching_goal_close'), { type: ButtonType.Normal }).width('100%')
            .attributeModifier(CubeButtons.primary).id('goal-close').onClick(() => { this.goalVisible = false; })
        }
      }.width('100%').padding({ left: CubeSpace.l, right: CubeSpace.l, top: CubeSpace.xs, bottom: CubeSpace.xl })
      .alignItems(HorizontalAlign.Start)
    }.width('100%').scrollBar(BarState.Off).align(Alignment.Top).id('goal-sheet')
  }

  @Builder
  private gameHeader() {
    Row({ space: CubeSpace.s }) {
      if (this.challengeIndex >= 0) {
        BackButton({ label: $r('app.string.result_levels'), onBack: () => this.goHome() })
      } else {
        BackButton({ label: $r('app.string.return_home'), onBack: () => this.goHome() })
      }
      Column({ space: 3 }) {
        if (this.challengeIndex >= 0) {
          Text(this.tr('teaching_level', this.challengeIndex + 1) + ' · ' +
            this.tr(this.challenges[this.challengeIndex].titleKey))
            .fontSize(CubeFont.headline - 1).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        } else {
          Text(this.tr('cube_title', this.order)).fontSize(CubeFont.headline - 1).fontWeight(FontWeight.Bold)
            .fontColor(CubeTheme.ink)
        }
        Row({ space: 5 }) {
          Column().width(6).height(6).borderRadius(3)
            .backgroundColor(this.phase === 'playing' ? CubeTheme.accent : CubeTheme.green)
            .border({ width: this.phase === 'playing' ? 1 : 0, color: CubeTheme.green })
          Text(this.phaseLabel()).fontSize(CubeFont.caption).fontColor(CubeTheme.green)
          if (this.challengeIndex >= 0) {
            Text(this.tr('teaching_goal_summary')).fontSize(CubeFont.caption).fontColor(CubeTheme.secondary)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
          }
        }.width('100%')
      }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      if (this.challengeIndex >= 0) {
        this.teachingGoal()
      }
    }.width('100%').constraintSize({ minHeight: CubeLayout.touchTarget }).id('game-header')
  }

  @Builder
  private gameSummary() {
    Row() {
      Column({ space: 3 }) {
        Text(this.tr('elapsed_time')).fontSize(CubeFont.caption).fontColor(CubeTheme.onHeroMuted)
        Text(this.formatTime(this.elapsed)).fontFamily('monospace').fontSize(26)
          .fontWeight(FontWeight.Medium).fontColor(CubeTheme.onHero).maxLines(1)
      }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      Column({ space: 3 }) {
        Text(this.tr('move_count')).fontSize(CubeFont.caption).fontColor(CubeTheme.onHeroMuted)
        Text(`${this.moves}`).fontSize(26).fontWeight(FontWeight.Medium).fontColor(CubeTheme.accent)
      }.alignItems(HorizontalAlign.End).constraintSize({ minWidth: 48 })
    }.width('100%').padding({ left: 18, right: 18, top: 10, bottom: 10 })
      .backgroundColor(CubeTheme.hero).borderRadius(20).id('game-summary')
  }

  @Builder
  private gameStage(owner: string) {
    Stack({ alignContent: Alignment.TopStart }) {
      this.cubeStage(owner)
      // Overlays never resize the cube: hints let touches through, view tools sit in a corner.
      Column() {
        if (this.hint.length > 0 && this.hintKey !== 'teaching_start_hint') {
          Text(this.hint).fontSize(CubeFont.label).lineHeight(19).fontColor(CubeTheme.green)
            .width('100%').padding(CubeSpace.s).backgroundColor(CubeTheme.overlay).borderRadius(CubeRadius.l)
            .hitTestBehavior(HitTestMode.None).id('game-hint')
            .transition(TransitionEffect.OPACITY.animation({ duration: 200 }))
        }
        Blank().layoutWeight(1).hitTestBehavior(HitTestMode.Transparent)
        Row({ space: CubeSpace.xs }) {
          Blank().hitTestBehavior(HitTestMode.Transparent)
          Button({ type: ButtonType.Capsule }) {
            Row({ space: CubeSpace.xxs }) {
              SymbolGlyph($r('sys.symbol.hand_tap')).fontSize(16)
                .fontColor([this.beginnerGuides ? CubeTheme.onAccent : CubeTheme.secondary])
              Text(this.tr('guides_label')).fontSize(CubeFont.caption).maxLines(1)
                .fontColor(this.beginnerGuides ? CubeTheme.onAccent : CubeTheme.secondary)
            }
          }.height(44).padding({ left: CubeSpace.s, right: CubeSpace.s })
            .backgroundColor(this.beginnerGuides ? CubeTheme.accent : CubeTheme.surface)
            .border({ width: 1, color: this.beginnerGuides ? CubeTheme.accent : CubeTheme.line, radius: 22 })
            .animation({ duration: 160, curve: Curve.EaseOut })
            .id('game-guides-toggle')
            .accessibilityText(this.tr('guides_accessibility', this.beginnerGuides ? this.tr('on') : this.tr('off')))
            .onClick(() => this.setBeginnerGuides(!this.beginnerGuides))
          Button({ type: ButtonType.Capsule }) {
            Row({ space: CubeSpace.xxs }) {
              SymbolGlyph($r('sys.symbol.arrow_counterclockwise')).fontSize(16).fontColor([CubeTheme.green])
              Text(this.tr('reset_view')).fontSize(CubeFont.caption).fontColor(CubeTheme.green).maxLines(1)
            }
          }.height(44).padding({ left: CubeSpace.s, right: CubeSpace.s }).backgroundColor(CubeTheme.surface)
            .border({ width: 1, color: CubeTheme.line, radius: 22 })
            .id('game-front-view').accessibilityText(this.tr('reset_view'))
            .onClick(() => { this.invalidateGesture(); this.yaw = 0.62; this.pitch = -0.42; this.draw(); })
        }.width('100%').hitTestBehavior(HitTestMode.Transparent).id('game-view-tools')
      }.width('100%').height('100%').padding(CubeSpace.s).hitTestBehavior(HitTestMode.Transparent)
    }.width('100%').height('100%')
  }

  @Builder
  private gameTools() {
    Row({ space: CubeSpace.xs }) {
      if (this.challengeIndex >= 0) {
        if (this.phase === 'solved') {
          Button(this.tr(this.challengeIndex === this.challenges.length - 1 ? 'result_levels' : 'teaching_next'),
            { type: ButtonType.Normal }).layoutWeight(1).attributeModifier(CubeButtons.primary)
            .enabled(!this.busy).onClick(() => this.nextChallenge())
        } else {
          Button(this.tr('teaching_retry'), { type: ButtonType.Normal }).layoutWeight(1)
            .attributeModifier(CubeButtons.primary).enabled(!this.busy).onClick(() => this.retryChallenge())
        }
      } else {
        Button(this.tr('scramble'), { type: ButtonType.Normal }).layoutWeight(1)
          .attributeModifier(CubeButtons.primary).enabled(!this.busy).onClick(() => this.scramble())
      }
      Button(this.tr('undo'), { type: ButtonType.Normal }).layoutWeight(1).attributeModifier(CubeButtons.tonal)
        .enabled(!this.busy && this.moves > 0 && this.phase !== 'tutorial' && this.phase !== 'solved')
        .onClick(() => this.undo())
      Button(this.tr('history_help'), { type: ButtonType.Normal }).layoutWeight(1).attributeModifier(CubeButtons.tonal)
        .enabled(!this.busy && this.phase !== 'tutorial' && this.phase !== 'solved')
        .onClick(() => this.showHint())
      if (this.challengeIndex < 0) {
        Button(this.tr('reset'), { type: ButtonType.Normal }).layoutWeight(1).attributeModifier(CubeButtons.quiet)
          .enabled(!this.busy).onClick(() => this.confirmReset())
      }
    }.width('100%').id('game-tools')
  }

  @Builder
  private gamePage() {
    Column() {
      if (this.viewportWidth >= CubeLayout.wideBreakpoint) {
        Row({ space: CubeSpace.m }) {
          Column() {
            this.gameStage('game-wide')
          }.layoutWeight(1).height('100%')
          Column({ space: CubeSpace.s }) {
            this.gameHeader()
            this.gameSummary()
            Blank()
            this.gameTools()
          }.width(340).height('100%')
        }.width('100%').height('100%')
      } else {
        Column({ space: CubeSpace.s }) {
          this.gameHeader()
          this.gameSummary()
          Column() {
            this.gameStage('game')
          }.width('100%').layoutWeight(1)
          this.gameTools()
        }.width('100%').height('100%')
      }
    }.width('100%').height('100%').constraintSize({ maxWidth: CubeLayout.wideMaxWidth })
      .padding({ left: 18, right: 18, top: 10, bottom: 16 })
      .bindSheet($$this.goalVisible, this.goalSheet(), {
        detents: [SheetSize.MEDIUM, SheetSize.LARGE],
        dragBar: true,
        showClose: false,
        backgroundColor: CubeTheme.surface,
        onDisappear: () => { this.goalVisible = false; }
      })
  }

  @Builder
  private destination(name: string) {
    NavDestination() {
      Column() {
        if (name === 'game') {
          this.gamePage()
        } else if (name === 'teaching') {
          TeachingPage({
            groups: this.teachingGroups(),
            solved: this.teachingRecords.length,
            total: this.challenges.length,
            progress: this.tr('teaching_progress', this.teachingRecords.length, this.challenges.length),
            loaded: this.loaded,
            storageWarning: this.storageWarning,
            onBack: () => this.goHome(),
            onStart: (index: number) => this.startChallenge(index)
          })
        } else if (name === 'stats') {
          StatsPage({
            total: this.records.length,
            rows: this.statsRows(),
            recent: this.recentRows(),
            trend: this.trendBars(),
            trendOrder: this.order,
            onBack: () => this.goHome(),
            onStart: () => this.startGame(),
            onClear: () => this.clearRecords()
          })
        } else {
          SettingsPage({
            defaultOrder: this.defaultOrder,
            speed: this.speed,
            sound: this.sound,
            haptics: this.haptics,
            beginnerGuides: this.beginnerGuides,
            orders: this.orders,
            onBack: () => this.goHome(),
            onDefaultOrder: (value: number) => { this.defaultOrder = value; this.order = value; this.saveSettings(); },
            onSpeed: (value: number, commit: boolean) => { this.speed = value; if (commit) { this.saveSettings(); } },
            onSound: (value: boolean) => { this.sound = value; this.saveSettings(); },
            onHaptics: (value: boolean) => { this.haptics = value; this.saveSettings(); },
            onGuides: (value: boolean) => this.setBeginnerGuides(value)
          })
        }
      }.width('100%').height('100%')
    }.hideTitleBar(true).backgroundColor(CubeTheme.background)
      .onBackPressed(() => this.onBackPress())
  }

  build() {
    Navigation(this.navStack) {
      Column() {
        this.homePage()
      }.width('100%').height('100%')
    }
    .mode(NavigationMode.Stack)
    .hideTitleBar(true)
    .hideToolBar(true)
    .navDestination(this.destination)
    .width('100%').height('100%').backgroundColor(CubeTheme.background)
    .onAreaChange((_old: Area, area: Area) => {
      this.viewportHeight = Number(area.height);
      this.viewportWidth = Number(area.width);
    })
  }
}
