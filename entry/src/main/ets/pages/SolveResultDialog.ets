import { SolveResult } from '../model/SolveResult';
import { CubeTheme } from './CubeTheme';

@CustomDialog
export struct SolveResultDialog {
  controller?: CustomDialogController;
  @ObjectLink result: SolveResult;
  @Prop viewportHeight: number = 740;

  private formatTime(ms: number): string {
    const minutes = Math.floor(ms / 60000).toString().padStart(2, '0');
    const seconds = Math.floor(ms / 1000 % 60).toString().padStart(2, '0');
    const fraction = Math.floor(ms / 10 % 100).toString().padStart(2, '0');
    return `${minutes}:${seconds}.${fraction}`;
  }

  build() {
    Scroll() {
      Column({ space: 14 }) {
        Column({ space: 7 }) {
          Text(this.result.challengeIndex < 0 ? $r('app.string.result_solved') :
            (this.result.assisted ? $r('app.string.teaching_passed_guided') : $r('app.string.teaching_passed')))
            .fontSize(26).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
            .textAlign(TextAlign.Center).width('100%').id('solve-result-title')
          Row({ space: 8 }) {
            Text($r('app.string.cube_title', this.result.order)).fontSize(12).fontColor(CubeTheme.secondary)
            if (this.result.challengeIndex >= 0) {
              Text($r('app.string.teaching_level', this.result.challengeIndex + 1))
                .fontSize(12).fontColor(CubeTheme.secondary)
            }
          }.justifyContent(FlexAlign.Center).width('100%')
        }.width('100%')
        Column({ space: 12 }) {
          Text($r('app.string.elapsed_time')).fontSize(12).fontColor('#C3D2CA')
          Text(this.formatTime(this.result.durationMs)).fontFamily('monospace').fontSize(36)
            .minFontSize(22).maxFontSize(36).maxLines(1).fontWeight(FontWeight.Medium).fontColor(Color.White)
            .width('100%').textAlign(TextAlign.Center).id('solve-result-time')
          Row({ space: 8 }) {
            Text($r('app.string.move_count')).fontSize(12).fontColor('#C3D2CA')
            Text(`${this.result.moves}`).fontSize(20).fontWeight(FontWeight.Bold).fontColor(CubeTheme.accent)
              .id('solve-result-moves')
          }.justifyContent(FlexAlign.Center).width('100%')
        }.width('100%').padding(18).backgroundColor(CubeTheme.ink).borderRadius(20)
      }.width('100%').padding(20)
    }.width('calc(100% - 40vp)')
      .constraintSize({ maxWidth: 400, maxHeight: Math.max(120, this.viewportHeight - 80) })
      .scrollBar(BarState.Off).backgroundColor(CubeTheme.surface).borderRadius(28).clip(true)
      .id('solve-result-dialog')
  }
}
