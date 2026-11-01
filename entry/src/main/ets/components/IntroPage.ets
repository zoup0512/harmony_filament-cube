import { CubeModel, CubeMove } from '../model/CubeModel';
import { CubeRenderer, CubeSwipeGuide } from '../render/CubeRenderer';
import { CubeFont, CubeRadius, CubeSpace, CubeTheme } from '../pages/CubeTheme';
import { CubeButtons } from '../pages/CubeStyles';

// Demo-only camera, closer to front-on so the swiped layer reads clearly.
// The game camera in Index.ets (0.62 / -0.42) is intentionally unchanged.
const DEMO_YAW: number = 0.22;
const DEMO_PITCH: number = -0.22;
// One gesture cycle: press, swipe while the layer follows, release, hold the result.
const DEMO_CYCLE_MS: number = 2200;
const DEMO_PRESS_MS: number = 350;
const DEMO_TRAVEL_MS: number = 1250;
const DEMO_RELEASE_MS: number = 300;
// Demo stage height follows the page height, clamped to a readable range.
const DEMO_STAGE_MIN: number = 220;
const DEMO_STAGE_MAX: number = 360;
const DEMO_STAGE_DEFAULT: number = 300;
const DEMO_STAGE_RATIO: number = 0.4;
const CONTENT_MAX_WIDTH: number = 520;

export function demoStageHeight(pageHeight: number): number {
  if (!Number.isFinite(pageHeight) || pageHeight <= 0) { return DEMO_STAGE_DEFAULT; }
  return Math.max(DEMO_STAGE_MIN, Math.min(DEMO_STAGE_MAX, Math.round(pageHeight * DEMO_STAGE_RATIO)));
}

@Component
export struct IntroPage {
  onDone: () => void = () => {};
  @State stageHeight: number = DEMO_STAGE_DEFAULT;

  // The demo owns a separate model/renderer pair: it never touches the game cube.
  private demoModel: CubeModel = new CubeModel(3);
  private demoRenderer: CubeRenderer = new CubeRenderer();
  private demoContext: CanvasRenderingContext2D =
    new CanvasRenderingContext2D(new RenderingContextSettings(true));
  private demoReady: boolean = false;
  private demoWidth: number = 0;
  private demoHeight: number = 0;
  private demoStarted: number = -1;
  private demoCycle: number = -1;
  private demoGuide: CubeSwipeGuide | null = null;
  // Set on a cycle change or Canvas resize; the next frame redraws a rest frame and refetches the guide.
  private demoGuideStale: boolean = true;
  private demoTimer: number = -1;
  private readonly demoBase: CubeMove[] = [new CubeMove('y', 1, 1), new CubeMove('x', 1, 1)];

  aboutToAppear(): void {
    if (this.demoTimer < 0) { this.demoTimer = setInterval(() => this.demoFrame(), 16); }
  }

  aboutToDisappear(): void {
    if (this.demoTimer >= 0) { clearInterval(this.demoTimer); this.demoTimer = -1; }
  }

  // Alternating move/inverse pairs keep the cube solved between gestures.
  private demoMove(index: number): CubeMove {
    const base = this.demoBase[Math.floor(index / 2) % this.demoBase.length];
    return index % 2 === 0 ? base : base.inverse();
  }

  private demoFrame(): void {
    if (!this.demoReady || this.demoWidth <= 0 || this.demoHeight <= 0) { return; }
    const now = Date.now();
    if (this.demoStarted < 0) { this.demoStarted = now; }
    const elapsed = now - this.demoStarted;
    const cycle = Math.floor(elapsed / DEMO_CYCLE_MS);
    const t = elapsed - cycle * DEMO_CYCLE_MS;
    if (cycle !== this.demoCycle) {
      if (this.demoCycle >= 0) { this.demoModel.applyMove(this.demoMove(this.demoCycle), false); }
      this.demoCycle = cycle;
      this.demoGuideStale = true;
    }
    // A rest frame is required: getSwipeGuide only answers for a stable, current frame.
    if (this.demoGuideStale) {
      this.demoGuideStale = false;
      this.demoRenderer.draw(this.demoContext, this.demoWidth, this.demoHeight,
        this.demoModel, DEMO_YAW, DEMO_PITCH);
      this.demoGuide = this.demoRenderer.getSwipeGuide(this.demoMove(cycle));
    }
    const travel = Math.max(0, Math.min(1, (t - DEMO_PRESS_MS) / DEMO_TRAVEL_MS));
    const progress = travel * travel * (3 - 2 * travel);
    const move = this.demoMove(cycle);
    this.demoRenderer.draw(this.demoContext, this.demoWidth, this.demoHeight,
      this.demoModel, DEMO_YAW, DEMO_PITCH, move, progress);
    this.drawTouch(t, progress);
  }

  // The fingertip shares the layer's easing, so the layer visibly follows the swipe.
  private drawTouch(t: number, progress: number): void {
    const guide = this.demoGuide;
    if (guide === null) { return; }
    const press = Math.max(0, Math.min(1, t / DEMO_PRESS_MS));
    const release = Math.max(0, Math.min(1,
      (t - DEMO_PRESS_MS - DEMO_TRAVEL_MS) / DEMO_RELEASE_MS));
    const alpha = Math.min(press * 1.4, 1) * (1 - release);
    if (alpha <= 0) { return; }
    const x = guide.startX + (guide.endX - guide.startX) * progress;
    const y = guide.startY + (guide.endY - guide.startY) * progress;
    const ctx = this.demoContext;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#FFFFFF';
    ctx.globalAlpha = alpha * 0.35;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(guide.startX, guide.startY);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.strokeStyle = '#82B5A4';
    ctx.globalAlpha = alpha * 0.85;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.strokeStyle = '#FFFFFF';
    ctx.globalAlpha = alpha * 0.5;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 16 - press * 5 + release * 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.globalAlpha = alpha * 0.95;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5B8F80';
    ctx.globalAlpha = alpha * 0.9;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  build() {
    Column() {
      Scroll() {
        Column({ space: CubeSpace.m }) {
          Column({ space: CubeSpace.xs }) {
            Text($r('app.string.intro_title')).fontSize(CubeFont.title).fontWeight(FontWeight.Bold)
              .fontColor(CubeTheme.ink).textAlign(TextAlign.Center)
            Text($r('app.string.intro_subtitle')).fontSize(CubeFont.body).fontColor(CubeTheme.secondary)
              .textAlign(TextAlign.Center)
          }.width('100%')
          // Demo_Stage: the badge sits in the bottom-right corner, clear of the cube.
          Stack({ alignContent: Alignment.BottomEnd }) {
            Canvas(this.demoContext)
              .id('intro-demo-canvas')
              .width('100%')
              .height('100%')
              .hitTestBehavior(HitTestMode.None)
              .accessibilityLevel('no')
              .onReady(() => { this.demoReady = true; })
              .onDisAppear(() => { this.demoReady = false; })
              .onAreaChange((_old: Area, area: Area) => {
                this.demoWidth = Number(area.width);
                this.demoHeight = Number(area.height);
                this.demoGuideStale = true;
              })
            Text($r('app.string.intro_demo_badge')).fontSize(CubeFont.caption).fontColor(CubeTheme.green)
              .padding({ left: CubeSpace.xs, right: CubeSpace.xs, top: CubeSpace.xxs, bottom: CubeSpace.xxs })
              .margin({ right: CubeSpace.s, bottom: CubeSpace.s })
              .backgroundColor(CubeTheme.overlay).borderRadius(CubeRadius.m)
              .hitTestBehavior(HitTestMode.None)
          }.width('100%').height(this.stageHeight)
            .linearGradient({ angle: 135, colors: [[CubeTheme.stageStart, 0], [CubeTheme.stageEnd, 1]] })
            .borderRadius(CubeRadius.xl).clip(true)
            .accessibilityText($r('app.string.intro_stage_accessibility'))
        }.width('100%').constraintSize({ minHeight: '100%', maxWidth: CONTENT_MAX_WIDTH })
          .justifyContent(FlexAlign.Center)
          .padding({ left: CubeSpace.l, right: CubeSpace.l, top: CubeSpace.s, bottom: CubeSpace.m })
      }.width('100%').layoutWeight(1).scrollBar(BarState.Off).align(Alignment.Top)
      // Bottom_Bar: outside the Scroll, so the start button never scrolls away or gets covered.
      Column() {
        Button({ type: ButtonType.Normal }) {
          Row({ space: CubeSpace.xs }) {
            Text($r('app.string.intro_start')).fontSize(CubeFont.headline).fontWeight(FontWeight.Bold)
              .fontColor(CubeTheme.onAccent)
            SymbolGlyph($r('sys.symbol.arrow_right')).fontSize(CubeFont.headline).fontColor([CubeTheme.onAccent])
          }
        }.width('100%').attributeModifier(CubeButtons.hero).id('intro-start')
          .accessibilityText($r('app.string.intro_start'))
          .onClick(() => this.onDone())
      }.width('100%').constraintSize({ maxWidth: CONTENT_MAX_WIDTH })
        .padding({ left: CubeSpace.l, right: CubeSpace.l, top: CubeSpace.s, bottom: CubeSpace.m })
    }.width('100%').height('100%').alignItems(HorizontalAlign.Center)
      .onAreaChange((_old: Area, area: Area) => {
        const next = demoStageHeight(Number(area.height));
        if (next !== this.stageHeight) { this.stageHeight = next; }
      })
  }
}
