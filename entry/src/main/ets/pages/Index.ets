import { common } from '@kit.AbilityKit';
import { CubeModel, CubeMove } from '../model/CubeModel';
import { CubeRenderer } from '../render/CubeRenderer';
import { CubeStore, CubeSettings, SolveRecord } from '../storage/CubeStore';
import { CubeFeedback } from '../platform/CubeFeedback';

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
  @State private defaultOrder: number = 3;
  @State private records: SolveRecord[] = [];
  @State private loaded: boolean = false;
  @State private storageWarning: string = '';
  @State private assisted: boolean = false;
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
  private startX: number = 0;
  private startY: number = 0;
  private lastX: number = 0;
  private lastY: number = 0;
  private orbiting: boolean = false;
  private touching: boolean = false;
  private pointerCount: number = 0;
  private readonly orders: number[] = [2, 3, 4, 5];
  private readonly firstFaces: string[] = ['U', "U'", 'D', "D'", 'L', "L'"];
  private readonly secondFaces: string[] = ['R', "R'", 'F', "F'", 'B', "B'"];

  aboutToAppear(): void {
    this.loadData();
    this.startTimers();
  }

  aboutToDisappear(): void {
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
      this.records = this.store.records.slice();
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
      this.touching = false;
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
        this.hint = '教程完成！你已经学会按记号转动魔方。';
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
    this.queue = moves.slice();
    this.queueKind = kind;
    this.activeMove = this.queue.shift() as CubeMove;
    this.animationAt = Date.now();
    this.busy = true;
  }

  private resetSession(): void {
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
    this.lesson = [];
    this.lessonIndex = 0;
    this.lessonTotal = 0;
    this.touching = false;
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
      } else { this.toast('请按高亮按钮，完成当前教程步骤。'); }
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
    this.animate([move], 'user');
  }

  private undo(): void {
    if (this.busy || !this.foreground || this.phase === 'tutorial' || this.phase === 'solved') { return; }
    const move = this.model.undo();
    if (move !== null) {
      this.moves = this.model.moveCount;
      this.hint = '';
      this.draw();
      if (this.phase === 'playing' && this.model.isSolved()) { this.finishSolve(); }
    } else { this.toast('还没有可以撤销的操作。'); }
  }

  private showHint(): void {
    if (this.busy || this.phase === 'tutorial' || this.model.isSolved()) { return; }
    const solution = this.model.getSolution();
    if (solution.length > 0) {
      this.assisted = true;
      this.hint = `历史回退参考：${this.moveLabel(solution[0])}。这是逆向回放，不是最优求解；本局不计入成绩。`;
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
    this.hint = `第 ${this.lessonIndex + 1} / ${this.lessonTotal} 步：点击 ${this.moveLabel(this.lesson[this.lessonIndex])}。字母表示该面顺时针转 90°，带 ′ 表示逆时针。`;
  }

  private isLessonFace(face: string): boolean {
    return this.phase === 'tutorial' && this.lessonIndex < this.lesson.length &&
      this.sameMove(this.faceMove(face), this.lesson[this.lessonIndex]);
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

  private touch(event: TouchEvent): void {
    if (event.type === TouchType.Cancel) {
      this.touching = false;
      this.pointerCount = 0;
      return;
    }
    if (event.type === TouchType.Up) {
      const remaining = event.touches.filter((point: TouchObject) =>
        !event.changedTouches.some((changed: TouchObject) => changed.id === point.id));
      if (remaining.length > 0) {
        this.orbiting = true;
        this.pointerCount = remaining.length;
        this.lastX = remaining[0].x;
        this.lastY = remaining[0].y;
        return;
      }
      if (this.touching && !this.orbiting && !this.busy && event.changedTouches.length > 0) {
        const point = event.changedTouches[0];
        const dx = point.x - this.startX;
        const dy = point.y - this.startY;
        if (Math.sqrt(dx * dx + dy * dy) >= 24) {
          const move = this.renderer.pickMove(this.startX, this.startY, point.x, point.y,
            this.model, this.yaw, this.pitch);
          if (move !== null) { this.requestMove(move); }
        }
      }
      this.touching = false;
      this.pointerCount = 0;
      return;
    }
    if (event.touches.length === 0) { return; }
    let x = 0;
    let y = 0;
    for (let i = 0; i < event.touches.length; i++) {
      x += event.touches[i].x;
      y += event.touches[i].y;
    }
    x /= event.touches.length;
    y /= event.touches.length;
    if (event.type === TouchType.Down || !this.touching) {
      if (!this.touching) {
        this.startX = x;
        this.startY = y;
        this.orbiting = this.page === 'home' || !this.renderer.hitTest(x, y) || this.busy;
      }
      if (event.touches.length > 1) { this.orbiting = true; }
      this.touching = true;
      this.pointerCount = event.touches.length;
      this.lastX = x;
      this.lastY = y;
      return;
    }
    if (this.pointerCount !== event.touches.length) {
      this.orbiting = true;
      this.pointerCount = event.touches.length;
      this.lastX = x;
      this.lastY = y;
      return;
    }
    if (this.orbiting) {
      this.yaw += (x - this.lastX) * 0.009;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + (y - this.lastY) * 0.009));
      if (!this.busy) { this.draw(); }
    }
    this.lastX = x;
    this.lastY = y;
  }

  private saveSettings(): void {
    const settings = new CubeSettings();
    settings.defaultOrder = this.defaultOrder;
    settings.speed = this.speed;
    settings.sound = this.sound;
    settings.haptics = this.haptics;
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
        this.canvasWidth = Number(area.width);
        this.canvasHeight = Number(area.height);
        this.draw();
      })
      .onTouch((event: TouchEvent) => this.touch(event))
      .accessibilityText(`${this.order} 阶魔方，滑动表面转层，拖动背景旋转视角。也可以使用下方转面按钮。`)
  }

  @Builder
  private sectionTitle(kicker: string, title: string) {
    Column({ space: 8 }) {
      Text(kicker).fontSize(11).fontColor('#7AA2FF').letterSpacing(3).fontWeight(FontWeight.Medium)
      Text(title).fontSize(26).fontWeight(FontWeight.Bold).fontColor('#F5F7FC')
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder
  private homePage() {
    Scroll() {
      Column({ space: 18 }) {
        Row() {
          Text('RAZOR / CUBE').fontSize(12).letterSpacing(3).fontColor('#ABB4C9').fontWeight(FontWeight.Medium)
          Blank()
          Blank().width(88)
        }.width('100%')
        Column({ space: 9 }) {
          Text('每一次转动，\n离答案更近一步。').fontSize(32).fontWeight(FontWeight.Bold)
            .fontColor('#F5F7FC').lineHeight(43).textAlign(TextAlign.Center)
          Text('Razor Cube · 口袋里的立体挑战').fontSize(13).fontColor('#8F9AB2')
        }.margin({ top: 16 })
        Stack() {
          this.cubeCanvas()
        }.width('100%').height(265)
        Column({ space: 12 }) {
          Text('选择你的挑战').fontSize(12).fontColor('#8F9AB2').letterSpacing(2)
          Row({ space: 10 }) {
            ForEach(this.orders, (value: number) => {
              Button(`${value} 阶`, { type: ButtonType.Normal })
                .layoutWeight(1).height(48).borderRadius(14).fontSize(16).fontWeight(FontWeight.Medium)
                .backgroundColor(this.order === value ? '#7AA2FF' : '#1B2232')
                .fontColor(this.order === value ? '#0E1527' : '#B5C0D7')
                .onClick(() => this.chooseOrder(value))
            })
          }.width('100%')
        }.width('100%')
        Button('开始游戏  →', { type: ButtonType.Normal }).width('100%').height(54)
          .backgroundColor('#7AA2FF').fontColor('#0E1527').fontSize(17).fontWeight(FontWeight.Bold).borderRadius(16)
          .enabled(this.loaded).onClick(() => this.startGame())
        Row({ space: 12 }) {
          Button('成绩统计', { type: ButtonType.Normal }).layoutWeight(1).height(46).borderRadius(14)
            .backgroundColor('#1B2232').fontColor('#D0D8E8').fontSize(14)
            .onClick(() => { this.canvasReady = false; this.page = 'stats'; })
          Button('偏好设置', { type: ButtonType.Normal }).layoutWeight(1).height(46).borderRadius(14)
            .backgroundColor('#1B2232').fontColor('#D0D8E8').fontSize(14)
            .onClick(() => { this.canvasReady = false; this.page = 'settings'; })
        }.width('100%')
        Text(this.storageWarning.length > 0 ? this.storageWarning : '无需下载素材 · 无广告 · 无网络权限')
          .fontSize(11).fontColor('#69758D').textAlign(TextAlign.Center)
      }.width('100%').constraintSize({ maxWidth: 480 }).padding({ left: 26, right: 26, top: 24, bottom: 26 })
    }.width('100%').height('100%').scrollBar(BarState.Off)
  }

  @Builder
  private header(title: string) {
    Row({ space: 12 }) {
      Button('‹', { type: ButtonType.Circle }).width(40).height(40).fontSize(30)
        .backgroundColor('#1B2232').fontColor('#D6DEF0').accessibilityText('返回首页').onClick(() => this.goHome())
      Text(title).fontSize(18).fontWeight(FontWeight.Medium).fontColor('#F5F7FC')
      Blank()
    }.width('100%')
  }

  @Builder
  private faceRow(faces: string[]) {
    Row({ space: 7 }) {
      ForEach(faces, (face: string) => {
        Button(face, { type: ButtonType.Normal }).layoutWeight(1).height(40).borderRadius(10)
          .backgroundColor(this.isLessonFace(face) ? '#7AA2FF' : '#20293B')
          .fontColor(this.isLessonFace(face) ? '#0E1527' : '#E0E7F5').fontSize(17).fontWeight(FontWeight.Medium)
          .enabled(!this.busy).onClick(() => this.requestMove(this.faceMove(face)))
          .accessibilityText(`${face} 面转动`)
      })
    }.width('100%')
  }

  @Builder
  private gamePage() {
    Column({ space: 8 }) {
      Row({ space: 12 }) {
        Button('‹', { type: ButtonType.Circle }).width(40).height(40).fontSize(30)
          .backgroundColor('#1B2232').fontColor('#D6DEF0').accessibilityText('返回首页').onClick(() => this.goHome())
        Column({ space: 3 }) {
          Text(`${this.order} × ${this.order} 魔方`).fontSize(16).fontWeight(FontWeight.Medium).fontColor('#F5F7FC')
          Text(this.phaseLabel()).fontSize(11).fontColor(this.phase === 'solved' ? '#6BE6B3' : '#8F9AB2')
        }.alignItems(HorizontalAlign.Start)
        Blank()
        Blank().width(88)
      }.width('100%')
      Row() {
        Column({ space: 3 }) {
          Text('用时').fontSize(10).fontColor('#7C8AA4').letterSpacing(2)
          Text(this.formatTime(this.elapsed)).fontFamily('monospace').fontSize(30)
            .fontWeight(FontWeight.Medium).fontColor('#F5F7FC')
        }.alignItems(HorizontalAlign.Start)
        Blank()
        Column({ space: 3 }) {
          Text('步数').fontSize(10).fontColor('#7C8AA4').letterSpacing(2)
          Text(`${this.moves}`).fontSize(30).fontWeight(FontWeight.Medium).fontColor('#7AA2FF')
        }.alignItems(HorizontalAlign.End)
      }.width('100%').padding({ left: 12, right: 12, top: 10 })
      Stack() {
        this.cubeCanvas()
      }.width('100%').layoutWeight(1).constraintSize({ minHeight: 145 })
      if (this.hint.length > 0) {
        Text(this.hint).fontSize(12).fontColor(this.phase === 'solved' ? '#87E9BE' : '#B7C9F0')
          .width('100%').padding(12).backgroundColor('#18243A').borderRadius(12)
      }
      Row({ space: 6 }) {
        Text('滑动转层 · 空白或双指转视角').fontSize(10).fontColor('#7C8AA4')
        Blank()
        Button('正视角', { type: ButtonType.Normal }).height(26).fontSize(10).borderRadius(8)
          .backgroundColor('#1B2232').fontColor('#AAB8D2')
          .onClick(() => { this.yaw = 0.62; this.pitch = -0.42; this.draw(); })
      }.width('100%')
      Column({ space: 7 }) {
        this.faceRow(this.firstFaces)
        this.faceRow(this.secondFaces)
      }.width('100%').margin({ top: 3 })
      Row({ space: 8 }) {
        Button('打乱', { type: ButtonType.Normal }).layoutWeight(1).height(42).borderRadius(12)
          .backgroundColor('#7AA2FF').fontColor('#0E1527').fontSize(14).fontWeight(FontWeight.Bold)
          .enabled(!this.busy).onClick(() => this.scramble())
        Button('教程', { type: ButtonType.Normal }).layoutWeight(1).height(42).borderRadius(12)
          .backgroundColor('#1B2232').fontColor('#C0CCE3').fontSize(14).enabled(!this.busy)
          .onClick(() => this.startLesson())
        Button('复位', { type: ButtonType.Normal }).layoutWeight(1).height(42).borderRadius(12)
          .backgroundColor('#1B2232').fontColor('#C0CCE3').fontSize(14).onClick(() => this.confirmReset())
      }.width('100%')
      Row({ space: 12 }) {
        Button('↶ 撤销', { type: ButtonType.Normal }).layoutWeight(1).height(32).fontSize(12)
          .backgroundColor(Color.Transparent).fontColor('#94A5C3')
          .enabled(!this.busy && this.moves > 0 && this.phase !== 'tutorial' && this.phase !== 'solved')
          .onClick(() => this.undo())
        Button('历史提示', { type: ButtonType.Normal }).layoutWeight(1).height(32).fontSize(12)
          .backgroundColor(Color.Transparent).fontColor('#94A5C3')
          .enabled(!this.busy && this.phase !== 'tutorial' && this.phase !== 'solved')
          .onClick(() => this.showHint())
      }.width('100%')
    }.width('100%').height('100%').constraintSize({ maxWidth: 600 })
      .padding({ left: 18, right: 18, top: 14, bottom: 8 })
  }

  @Builder
  private statsPage() {
    Column({ space: 20 }) {
      this.header('成绩统计')
      Scroll() {
        Column({ space: 18 }) {
          this.sectionTitle('PERSONAL BEST', '让每一秒都有进步')
          Column({ space: 10 }) {
            ForEach(this.orders, (value: number) => {
              Row() {
                Text(`${value} 阶`).fontSize(16).fontColor('#C2CFE7')
                Blank()
                Text(this.bestTime(value)).fontSize(22).fontFamily('monospace').fontColor('#7AA2FF')
              }.width('100%').padding(18).backgroundColor('#192131').borderRadius(14)
            })
          }.width('100%')
          Row() {
            Text('最近成绩 · 最多显示 20 条').fontSize(13).fontColor('#91A0BA')
            Blank()
            Button('清空', { type: ButtonType.Normal }).fontSize(12).fontColor('#EE9B96')
              .backgroundColor(Color.Transparent).enabled(this.records.length > 0).onClick(() => this.clearRecords())
          }.width('100%')
          if (this.records.length === 0) {
            Text('还没有成绩\n打乱魔方并完成还原，留下你的第一个纪录。')
              .fontSize(14).fontColor('#7C8AA4').lineHeight(26).textAlign(TextAlign.Center).padding({ top: 30, bottom: 40 })
          } else {
            ForEach(this.records.slice(0, 20), (record: SolveRecord) => {
              Row({ space: 12 }) {
                Text(`${record.order} 阶`).fontSize(13).fontColor('#A9B8D0')
                Column({ space: 4 }) {
                  Text(this.formatTime(record.durationMs)).fontSize(17).fontColor('#F5F7FC').fontFamily('monospace')
                  Text(`${record.moves} 步 · ${this.dateLabel(record.date)}`).fontSize(11).fontColor('#7C8AA4')
                }.alignItems(HorizontalAlign.Start)
                Blank()
              }.width('100%').padding(14).backgroundColor('#151C29').borderRadius(12)
            })
          }
          Text('成绩保存在本机；教程与使用历史提示的练习不记榜。').fontSize(11).fontColor('#69758D')
        }.width('100%').padding({ bottom: 20 })
      }.layoutWeight(1).scrollBar(BarState.Off)
    }.width('100%').height('100%').constraintSize({ maxWidth: 600 }).padding(22)
  }

  @Builder
  private settingsPage() {
    Column({ space: 24 }) {
      this.header('偏好设置')
      Scroll() {
        Column({ space: 24 }) {
          this.sectionTitle('MAKE IT YOURS', '找到你的转动节奏')
          Column({ space: 16 }) {
            Text('默认阶数').fontSize(15).fontColor('#DAE2F2').width('100%')
            Row({ space: 8 }) {
              ForEach(this.orders, (value: number) => {
                Button(`${value} 阶`, { type: ButtonType.Normal }).layoutWeight(1).height(42).borderRadius(12)
                  .backgroundColor(this.defaultOrder === value ? '#7AA2FF' : '#252F43')
                  .fontColor(this.defaultOrder === value ? '#0E1527' : '#B5C0D7')
                  .onClick(() => { this.defaultOrder = value; this.order = value; this.saveSettings(); })
              })
            }.width('100%')
          }.padding(18).backgroundColor('#192131').borderRadius(16)
          Column({ space: 14 }) {
            Row() {
              Text('转动动画').fontSize(15).fontColor('#DAE2F2')
              Blank()
              Text(`${this.speed.toFixed(1)}×`).fontSize(15).fontColor('#7AA2FF')
            }.width('100%')
            Slider({ value: this.speed, min: 0.5, max: 2, step: 0.1 })
              .selectedColor('#7AA2FF').trackColor('#303B51').blockColor('#E0EAFF')
              .onChange((value: number, mode: SliderChangeMode) => {
                this.speed = value;
                if (mode === SliderChangeMode.End || mode === SliderChangeMode.Click) { this.saveSettings(); }
              })
            Row() {
              Text('从容 0.5×').fontSize(11).fontColor('#7C8AA4')
              Blank()
              Text('敏捷 2.0×').fontSize(11).fontColor('#7C8AA4')
            }.width('100%')
          }.padding(18).backgroundColor('#192131').borderRadius(16)
          Column({ space: 20 }) {
            Row() {
              Column({ space: 5 }) {
                Text('转动音效').fontSize(15).fontColor('#DAE2F2')
                Text('轻巧的落位提示音').fontSize(11).fontColor('#7C8AA4')
              }.alignItems(HorizontalAlign.Start)
              Blank()
              Toggle({ type: ToggleType.Switch, isOn: this.sound }).selectedColor('#7AA2FF')
                .onChange((value: boolean) => { this.sound = value; this.saveSettings(); })
            }.width('100%')
            Row() {
              Column({ space: 5 }) {
                Text('触感反馈').fontSize(15).fontColor('#DAE2F2')
                Text('需要设备支持振动').fontSize(11).fontColor('#7C8AA4')
              }.alignItems(HorizontalAlign.Start)
              Blank()
              Toggle({ type: ToggleType.Switch, isOn: this.haptics }).selectedColor('#7AA2FF')
                .onChange((value: boolean) => { this.haptics = value; this.saveSettings(); })
            }.width('100%')
          }.padding(18).backgroundColor('#192131').borderRadius(16)
          Text('关于 Razor Cube\n\n基于安卓魔方玩法迁移，采用 ArkUI 轻量三维绘制。所有计算与成绩都留在本机。\n\n转面记号：U 上 · D 下 · L 左 · R 右 · F 前 · B 后；带 ′ 的记号表示逆时针。转动方向以正对该面为准，与屏幕视角无关。')
            .fontSize(12).fontColor('#8D9BB4').lineHeight(22).width('100%')
        }.width('100%').padding({ bottom: 30 })
      }.layoutWeight(1).scrollBar(BarState.Off)
    }.width('100%').height('100%').constraintSize({ maxWidth: 600 }).padding(22)
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
    }.width('100%').height('100%').backgroundColor('#0E1016')
  }
}
