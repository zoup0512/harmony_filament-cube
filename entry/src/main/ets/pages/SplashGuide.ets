import { common } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { CubeTheme, CubeFont, CubeRadius, CubeSpace } from './CubeTheme';
import { CubeStore } from '../storage/CubeStore';

/**
 * 闪屏引导页组件
 * 展示魔方手势操作的引导动画
 */
@Entry
@Component
export struct SplashGuide {
  @State private currentStep: number = 0;
  @State private animationProgress: number = 0;
  @StorageLink('cubeLanguage') private language: string = '';
  private animationTimer: number = -1;
  private autoAdvanceTimer: number = -1;
  private readonly totalSteps: number = 3;
  private store: CubeStore = new CubeStore();

  aboutToAppear(): void {
    this.startAnimation();
    this.loadStore();
  }

  aboutToDisappear(): void {
    this.stopTimers();
  }

  private async loadStore(): Promise<void> {
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      await this.store.load(context);
    } catch {
      // 加载失败不影响引导页显示
    }
  }

  private startAnimation(): void {
    this.stopTimers();
    this.animationProgress = 0;
    // 动画循环：0 -> 1，用于绘制手势轨迹
    this.animationTimer = setInterval(() => {
      this.animationProgress += 0.02;
      if (this.animationProgress >= 1) {
        this.animationProgress = 0;
      }
    }, 32);

    // 自动切换到下一步（4秒后）
    this.autoAdvanceTimer = setInterval(() => {
      this.nextStep();
    }, 4000);
  }

  private stopTimers(): void {
    if (this.animationTimer >= 0) {
      clearInterval(this.animationTimer);
      this.animationTimer = -1;
    }
    if (this.autoAdvanceTimer >= 0) {
      clearInterval(this.autoAdvanceTimer);
      this.autoAdvanceTimer = -1;
    }
  }

  private nextStep(): void {
    if (this.currentStep < this.totalSteps - 1) {
      this.currentStep++;
      this.animationProgress = 0;
    }
  }

  private previousStep(): void {
    if (this.currentStep > 0) {
      this.currentStep--;
      this.animationProgress = 0;
    }
  }

  private async skip(): Promise<void> {
    this.stopTimers();
    await this.markGuideSeen();
    this.navigateToMainPage();
  }

  private async markGuideSeen(): Promise<void> {
    try {
      const settings = this.store.settings;
      settings.splashGuideSeen = true;
      await this.store.saveSettings(settings);
    } catch {
      // 保存失败不影响跳转
    }
  }

  private navigateToMainPage(): void {
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      context.terminateSelf();
    } catch {
      // 如果终止失败，无法跳转
    }
  }

  private tr(name: string): string {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    try {
      return context.resourceManager.getStringByNameSync(name);
    } catch {
      return name;
    }
  }

  build() {
    Stack() {
      // 背景
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(CubeTheme.background)

      // 主内容
      Column({ space: CubeSpace.xl }) {
        // 标题
        Text(this.tr('splash_guide_title'))
          .fontSize(CubeFont.display)
          .fontWeight(FontWeight.Bold)
          .fontColor(CubeTheme.ink)
          .margin({ top: 60 })

        // 副标题
        Text(this.tr('splash_guide_subtitle'))
          .fontSize(CubeFont.body)
          .fontColor(CubeTheme.secondary)
          .opacity(0.7)

        Blank()

        // 演示区域
        Column() {
          if (this.currentStep === 0) {
            this.HorizontalSwipeDemo()
          } else if (this.currentStep === 1) {
            this.VerticalSwipeDemo()
          } else {
            this.RotateDemo()
          }
        }
        .width('100%')
        .height(400)

        // 步骤说明
        Column({ space: CubeSpace.s }) {
          Text(this.getStepTitle())
            .fontSize(CubeFont.headline)
            .fontWeight(FontWeight.Medium)
            .fontColor(CubeTheme.ink)

          Text(this.getStepDescription())
            .fontSize(CubeFont.body)
            .fontColor(CubeTheme.secondary)
            .opacity(0.8)
            .textAlign(TextAlign.Center)
            .width('80%')
        }
        .width('100%')
        .padding({ horizontal: CubeSpace.l })

        Blank()

        // 步骤指示器
        Row({ space: CubeSpace.xs }) {
          ForEach([0, 1, 2], (index: number) => {
            Circle()
              .width(8)
              .height(8)
              .fill(this.currentStep === index ? CubeTheme.accent : CubeTheme.muted)
              .opacity(this.currentStep === index ? 1 : 0.3)
          })
        }

        // 底部按钮
        Row({ space: CubeSpace.m }) {
          // 上一步按钮
          if (this.currentStep > 0) {
            Button(this.tr('splash_guide_previous'))
              .fontSize(CubeFont.body)
              .backgroundColor(Color.Transparent)
              .fontColor(CubeTheme.accent)
              .onClick(() => this.previousStep())
          }

          Blank()

          // 跳过按钮
          Button(this.tr('splash_guide_skip'))
            .fontSize(CubeFont.body)
            .backgroundColor(Color.Transparent)
            .fontColor(CubeTheme.muted)
            .onClick(() => this.skip())

          // 下一步/开始按钮
          Button(this.currentStep < this.totalSteps - 1 ?
            this.tr('splash_guide_next') : this.tr('splash_guide_start'))
            .fontSize(CubeFont.body)
            .backgroundColor(CubeTheme.accent)
            .fontColor(CubeTheme.onAccent)
            .borderRadius(CubeRadius.xl)
            .padding({ left: CubeSpace.l, right: CubeSpace.l, top: CubeSpace.m, bottom: CubeSpace.m })
            .onClick(() => {
              if (this.currentStep < this.totalSteps - 1) {
                this.nextStep();
              } else {
                this.skip();
              }
            })
        }
        .width('100%')
        .padding({ horizontal: CubeSpace.l, bottom: CubeSpace.xl })
      }
      .width('100%')
      .height('100%')
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  private HorizontalSwipeDemo() {
    Stack() {
      // 魔方图示
      Column() {
        Row() {
          ForEach([0, 1, 2], () => {
            Column()
              .width(60)
              .height(60)
              .margin(2)
              .backgroundColor(CubeTheme.accent)
              .borderRadius(CubeRadius.s)
          })
        }
        ForEach([0, 1], () => {
          Row() {
            ForEach([0, 1, 2], () => {
              Column()
                .width(60)
                .height(60)
                .margin(2)
                .backgroundColor(CubeTheme.surface)
                .border({ width: 2, color: CubeTheme.line })
                .borderRadius(CubeRadius.s)
            })
          }
        })
      }

      // 手势轨迹动画
      Canvas(this.getHorizontalSwipeContext())
        .width(300)
        .height(300)
        .onReady(() => {
          this.drawHorizontalSwipe();
        })
    }
  }

  private horizontalSwipeContext: CanvasRenderingContext2D = 
    new CanvasRenderingContext2D(new RenderingContextSettings(true));

  private getHorizontalSwipeContext(): CanvasRenderingContext2D {
    return this.horizontalSwipeContext;
  }

  private drawHorizontalSwipe(): void {
    const ctx = this.horizontalSwipeContext;
    ctx.clearRect(0, 0, 300, 300);

    // 绘制手指图标和轨迹
    const startX = 80;
    const endX = 220;
    const y = 80;
    const currentX = startX + (endX - startX) * this.animationProgress;

    // 轨迹线 - 使用主题色
    ctx.strokeStyle = '#3AA897';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(startX + (endX - startX) * this.animationProgress, y);
    ctx.stroke();

    // 手指图标（圆点）
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#3AA897';
    ctx.beginPath();
    ctx.arc(currentX, y, 12, 0, 2 * Math.PI);
    ctx.fill();

    // 箭头
    ctx.strokeStyle = '#3AA897';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(endX - 15, y - 10);
    ctx.lineTo(endX, y);
    ctx.lineTo(endX - 15, y + 10);
    ctx.stroke();
  }

  @Builder
  private VerticalSwipeDemo() {
    Stack() {
      // 魔方图示
      Column() {
        Row() {
          ForEach([0, 1, 2], (index: number) => {
            Column()
              .width(60)
              .height(60)
              .margin(2)
              .backgroundColor(index === 0 ? CubeTheme.green : CubeTheme.surface)
              .border({ width: index === 0 ? 0 : 2, color: CubeTheme.line })
              .borderRadius(CubeRadius.s)
          })
        }
        ForEach([0, 1], () => {
          Row() {
            ForEach([0, 1, 2], (index: number) => {
              Column()
                .width(60)
                .height(60)
                .margin(2)
                .backgroundColor(index === 0 ? CubeTheme.green : CubeTheme.surface)
                .border({ width: index === 0 ? 0 : 2, color: CubeTheme.line })
                .borderRadius(CubeRadius.s)
            })
          }
        })
      }

      // 手势轨迹动画
      Canvas(this.getVerticalSwipeContext())
        .width(300)
        .height(300)
        .onReady(() => {
          this.drawVerticalSwipe();
        })
    }
  }

  private verticalSwipeContext: CanvasRenderingContext2D = 
    new CanvasRenderingContext2D(new RenderingContextSettings(true));

  private getVerticalSwipeContext(): CanvasRenderingContext2D {
    return this.verticalSwipeContext;
  }

  private drawVerticalSwipe(): void {
    const ctx = this.verticalSwipeContext;
    ctx.clearRect(0, 0, 300, 300);

    // 绘制手指图标和轨迹
    const x = 80;
    const startY = 60;
    const endY = 200;
    const currentY = startY + (endY - startY) * this.animationProgress;

    // 轨迹线
    ctx.strokeStyle = '#50C878';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, startY + (endY - startY) * this.animationProgress);
    ctx.stroke();

    // 手指图标（圆点）
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#50C878';
    ctx.beginPath();
    ctx.arc(x, currentY, 12, 0, 2 * Math.PI);
    ctx.fill();

    // 箭头
    ctx.strokeStyle = '#50C878';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 10, endY - 15);
    ctx.lineTo(x, endY);
    ctx.lineTo(x + 10, endY - 15);
    ctx.stroke();
  }

  @Builder
  private RotateDemo() {
    Stack() {
      // 魔方图示
      Column() {
        ForEach([0, 1, 2], () => {
          Row() {
            ForEach([0, 1, 2], () => {
              Column()
                .width(60)
                .height(60)
                .margin(2)
                .backgroundColor(CubeTheme.surface)
                .border({ width: 2, color: CubeTheme.line })
                .borderRadius(CubeRadius.s)
            })
          }
        })
      }

      // 旋转手势动画
      Canvas(this.getRotateContext())
        .width(300)
        .height(300)
        .onReady(() => {
          this.drawRotate();
        })
    }
  }

  private rotateContext: CanvasRenderingContext2D = 
    new CanvasRenderingContext2D(new RenderingContextSettings(true));

  private getRotateContext(): CanvasRenderingContext2D {
    return this.rotateContext;
  }

  private drawRotate(): void {
    const ctx = this.rotateContext;
    ctx.clearRect(0, 0, 300, 300);

    // 绘制旋转轨迹
    const centerX = 150;
    const centerY = 150;
    const radius = 80;
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + Math.PI * 1.5 * this.animationProgress;

    // 弧线轨迹
    ctx.strokeStyle = '#FFA726';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.stroke();

    // 手指图标（圆点）
    const currentX = centerX + radius * Math.cos(endAngle);
    const currentY = centerY + radius * Math.sin(endAngle);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#FFA726';
    ctx.beginPath();
    ctx.arc(currentX, currentY, 12, 0, 2 * Math.PI);
    ctx.fill();

    // 箭头（沿着圆弧的切线方向）
    const arrowAngle = endAngle + Math.PI / 2;
    const arrowX = currentX + 15 * Math.cos(arrowAngle);
    const arrowY = currentY + 15 * Math.sin(arrowAngle);
    ctx.strokeStyle = '#FFA726';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(currentX, currentY);
    ctx.lineTo(arrowX, arrowY);
    ctx.stroke();
  }

  private getStepTitle(): string {
    switch (this.currentStep) {
      case 0:
        return this.tr('splash_guide_step1_title');
      case 1:
        return this.tr('splash_guide_step2_title');
      case 2:
        return this.tr('splash_guide_step3_title');
      default:
        return '';
    }
  }

  private getStepDescription(): string {
    switch (this.currentStep) {
      case 0:
        return this.tr('splash_guide_step1_desc');
      case 1:
        return this.tr('splash_guide_step2_desc');
      case 2:
        return this.tr('splash_guide_step3_desc');
      default:
        return '';
    }
  }
}

