import { SolveResult } from '../model/SolveResult';
import { CubeButtons } from './CubeStyles';
import { CubeFont, CubeRadius, CubeSpace, CubeTheme } from './CubeTheme';

@CustomDialog
export struct SolveResultDialog {
  controller?: CustomDialogController;
  @ObjectLink result: SolveResult;
  @Prop viewportHeight: number = 740;
  @Prop newBest: boolean = false;
  primaryLabel: ResourceStr = $r('app.string.result_again');
  onPrimary: () => void = () => {};
  onDone: () => void = () => {};

  private formatTime(ms: number): string {
    const minutes = Math.floor(ms / 60000).toString().padStart(2, '0');
    const seconds = Math.floor(ms / 1000 % 60).toString().padStart(2, '0');
    const fraction = Math.floor(ms / 10 % 100).toString().padStart(2, '0');
    return `${minutes}:${seconds}.${fraction}`;
  }

  build() {
    Scroll() {
      Column({ space: CubeSpace.m }) {
        Column({ space: 7 }) {
          Text(this.result.challengeIndex < 0 ? $r('app.string.result_solved') :
            (this.result.assisted ? $r('app.string.teaching_passed_guided') : $r('app.string.teaching_passed')))
            .fontSize(CubeFont.title).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
            .textAlign(TextAlign.Center).width('100%').id('solve-result-title')
          Row({ space: CubeSpace.xs }) {
            Text($r('app.string.cube_title', this.result.order)).fontSize(CubeFont.caption).fontColor(CubeTheme.secondary)
            if (this.result.challengeIndex >= 0) {
              Text($r('app.string.teaching_level', this.result.challengeIndex + 1))
                .fontSize(CubeFont.caption).fontColor(CubeTheme.secondary)
            }
          }.justifyContent(FlexAlign.Center).width('100%')
        }.width('100%')
        Column({ space: CubeSpace.s }) {
          if (this.newBest) {
            Row({ space: CubeSpace.xxs }) {
              SymbolGlyph($r('sys.symbol.crown_fill')).fontSize(13).fontColor([CubeTheme.onAccent])
              Text($r('app.string.result_new_best')).fontSize(CubeFont.caption).fontWeight(FontWeight.Bold)
                .fontColor(CubeTheme.onAccent)
            }.padding({ left: 10, right: 10, top: 4, bottom: 4 }).backgroundColor(CubeTheme.accent)
            .borderRadius(CubeRadius.m).id('solve-result-best')
            .transition(TransitionEffect.scale({ x: 0.6, y: 0.6 }).combine(TransitionEffect.OPACITY)
              .animation({ duration: 260, curve: Curve.Friction, delay: 120 }))
          }
          Text($r('app.string.elapsed_time')).fontSize(CubeFont.caption).fontColor(CubeTheme.onHeroMuted)
          Text(this.formatTime(this.result.durationMs)).fontFamily('monospace').fontSize(36)
            .minFontSize(22).maxFontSize(36).maxLines(1).fontWeight(FontWeight.Medium).fontColor(CubeTheme.onHero)
            .width('100%').textAlign(TextAlign.Center).id('solve-result-time')
          Row({ space: CubeSpace.xs }) {
            Text($r('app.string.move_count')).fontSize(CubeFont.caption).fontColor(CubeTheme.onHeroMuted)
            Text(`${this.result.moves}`).fontSize(20).fontWeight(FontWeight.Bold).fontColor(CubeTheme.accent)
              .id('solve-result-moves')
          }.justifyContent(FlexAlign.Center).width('100%')
        }.width('100%').padding(18).backgroundColor(CubeTheme.hero).borderRadius(20)
        if (this.result.challengeIndex >= 0 || this.result.assisted) {
          Text(this.result.challengeIndex >= 0 ? $r('app.string.teaching_completed_note') :
            $r('app.string.result_assisted_note'))
            .fontSize(CubeFont.caption).lineHeight(18).fontColor(CubeTheme.secondary)
            .textAlign(TextAlign.Center).width('100%').id('solve-result-note')
        }
        Row({ space: CubeSpace.xs }) {
          Button($r('app.string.result_done'), { type: ButtonType.Normal }).attributeModifier(CubeButtons.tonal)
            .layoutWeight(1).id('solve-result-done').onClick(() => this.onDone())
          Button(this.primaryLabel, { type: ButtonType.Normal }).attributeModifier(CubeButtons.primary)
            .layoutWeight(1).id('solve-result-primary').onClick(() => this.onPrimary())
        }.width('100%')
      }.width('100%').padding(CubeSpace.l)
    }.width('calc(100% - 40vp)')
      .constraintSize({ maxWidth: 400, maxHeight: Math.max(120, this.viewportHeight - 80) })
      .scrollBar(BarState.Off).backgroundColor(CubeTheme.surface).borderRadius(28).clip(true)
      .id('solve-result-dialog')
  }
}
