import { CubeFont, CubeLayout, CubeRadius, CubeSpace, CubeTheme } from '../pages/CubeTheme';
import { CubeButtons, CubeCards } from '../pages/CubeStyles';
import { ChartMark, PageHeader, SectionTitle } from './CubeWidgets';

export class StatsOrderRow {
  order: number = 0;
  label: string = '';
  description: string = '';
  count: string = '';
  best: string = '';
  hasBest: boolean = false;

  constructor(order: number, label: string, description: string, count: string, best: string, hasBest: boolean) {
    this.order = order;
    this.label = label;
    this.description = description;
    this.count = count;
    this.best = best;
    this.hasBest = hasBest;
  }
}

export class StatsRecentRow {
  key: string = '';
  label: string = '';
  time: string = '';
  details: string = '';
  best: boolean = false;

  constructor(key: string, label: string, time: string, details: string, best: boolean) {
    this.key = key;
    this.label = label;
    this.time = time;
    this.details = details;
    this.best = best;
  }
}

@Component
export struct StatsPage {
  @Prop total: number = 0;
  @Prop rows: StatsOrderRow[] = [];
  @Prop recent: StatsRecentRow[] = [];
  @Prop trend: number[] = [];
  @Prop trendOrder: number = 3;
  onBack: () => void = () => {};
  onStart: () => void = () => {};
  onClear: () => void = () => {};

  @Builder
  private summaryCard() {
    Row() {
      Column({ space: CubeSpace.xxs }) {
        Text($r('app.string.completed_challenges')).fontSize(CubeFont.caption).fontColor(CubeTheme.onHeroMuted)
        Row({ space: CubeSpace.xs }) {
          Text(`${this.total}`).fontSize(40).fontWeight(FontWeight.Bold).fontColor(CubeTheme.accent)
          Text($r('app.string.solve_unit')).fontSize(CubeFont.label).fontColor(CubeTheme.onHero)
            .margin({ top: 18 })
        }
      }.alignItems(HorizontalAlign.Start)
      Blank()
      ChartMark({ markSize: 44, color: CubeTheme.accent })
    }.width('100%').padding(22).backgroundColor(CubeTheme.hero).borderRadius(CubeRadius.xl)
  }

  @Builder
  private trendCard() {
    Column({ space: CubeSpace.s }) {
      Text($r('app.string.stats_trend', this.trend.length, this.trendOrder))
        .fontSize(CubeFont.label).fontWeight(FontWeight.Medium).fontColor(CubeTheme.secondary)
      Row({ space: 6 }) {
        ForEach(this.trend, (ratio: number, index: number) => {
          Column()
            .layoutWeight(1).height(Math.max(6, Math.round(72 * ratio))).borderRadius(4)
            .backgroundColor(index === this.trend.length - 1 ? CubeTheme.green : CubeTheme.mint)
        }, (ratio: number, index: number) => `${index}-${ratio}`)
      }.width('100%').height(72).alignItems(VerticalAlign.Bottom)
    }.attributeModifier(CubeCards.surface).alignItems(HorizontalAlign.Start).id('stats-trend')
  }

  @Builder
  private ordersCard() {
    Column() {
      ForEach(this.rows, (row: StatsOrderRow, index: number) => {
        Row({ space: CubeSpace.s }) {
          Text(row.label).fontSize(CubeFont.label).fontWeight(FontWeight.Bold).fontColor(CubeTheme.green)
            .width(48).height(48).textAlign(TextAlign.Center).backgroundColor(CubeTheme.mint)
            .borderRadius(CubeRadius.l)
          Column({ space: CubeSpace.xxs }) {
            Text(row.description).fontSize(CubeFont.body).fontWeight(FontWeight.Medium).fontColor(CubeTheme.ink)
            Text(row.count).fontSize(CubeFont.caption).fontColor(CubeTheme.secondary)
          }.alignItems(HorizontalAlign.Start).layoutWeight(1)
          Text(row.best).fontSize(19).fontFamily('monospace').fontWeight(FontWeight.Medium)
            .fontColor(row.hasBest ? CubeTheme.green : CubeTheme.muted)
        }.width('100%').padding({ top: CubeSpace.s, bottom: CubeSpace.s })
        if (index < this.rows.length - 1) {
          Divider().color(CubeTheme.line)
        }
      }, (row: StatsOrderRow) => `${row.order}-${row.count}-${row.best}-${row.description}`)
    }.width('100%').padding({ left: CubeSpace.m, right: CubeSpace.m }).backgroundColor(CubeTheme.surface)
      .borderRadius(CubeRadius.xl)
  }

  @Builder
  private recentList() {
    Column({ space: CubeSpace.s }) {
      Row() {
        Text($r('app.string.recent_results')).fontSize(CubeFont.label).fontWeight(FontWeight.Medium)
          .fontColor(CubeTheme.secondary).layoutWeight(1)
        Button($r('app.string.clear'), { type: ButtonType.Normal }).attributeModifier(CubeButtons.danger)
          .enabled(this.recent.length > 0).onClick(() => this.onClear())
      }.width('100%')
      if (this.recent.length === 0) {
        Column({ space: CubeSpace.s }) {
          SymbolGlyph($r('sys.symbol.flag')).fontSize(28).fontColor([CubeTheme.green])
          Text($r('app.string.no_results')).fontSize(CubeFont.subhead).fontWeight(FontWeight.Bold)
            .fontColor(CubeTheme.ink)
          Text($r('app.string.no_results_help')).fontSize(CubeFont.label).fontColor(CubeTheme.secondary)
            .lineHeight(21).textAlign(TextAlign.Center)
          Button($r('app.string.start_game'), { type: ButtonType.Normal }).attributeModifier(CubeButtons.primary)
            .width(180).onClick(() => this.onStart())
        }.width('100%').padding(CubeSpace.xl).backgroundColor(CubeTheme.surface).borderRadius(CubeRadius.xl)
      } else {
        Column() {
          ForEach(this.recent, (row: StatsRecentRow, index: number) => {
            Row({ space: CubeSpace.s }) {
              Text(row.label).fontSize(CubeFont.caption).fontWeight(FontWeight.Medium).fontColor(CubeTheme.green)
                .width(44).height(44).textAlign(TextAlign.Center).backgroundColor(CubeTheme.mint)
                .borderRadius(CubeRadius.m)
              Column({ space: CubeSpace.xxs }) {
                Text(row.time).fontSize(19).fontColor(CubeTheme.ink).fontFamily('monospace')
                Text(row.details).fontSize(CubeFont.caption).fontColor(CubeTheme.secondary)
              }.alignItems(HorizontalAlign.Start).layoutWeight(1)
              if (row.best) {
                Row({ space: CubeSpace.xxs }) {
                  SymbolGlyph($r('sys.symbol.crown_fill')).fontSize(12).fontColor([CubeTheme.green])
                  Text($r('app.string.best')).fontSize(CubeFont.caption).fontColor(CubeTheme.green)
                }.padding({ left: CubeSpace.xs, right: CubeSpace.xs, top: 5, bottom: 5 })
                .backgroundColor(CubeTheme.mint).borderRadius(CubeRadius.s)
              }
            }.width('100%').padding({ top: CubeSpace.s, bottom: CubeSpace.s })
            if (index < this.recent.length - 1) {
              Divider().color(CubeTheme.line)
            }
          }, (row: StatsRecentRow) => `${row.key}-${row.best}-${row.details}`)
        }.width('100%').padding({ left: CubeSpace.m, right: CubeSpace.m }).backgroundColor(CubeTheme.surface)
          .borderRadius(CubeRadius.xl).id('stats-recent')
      }
    }.width('100%')
  }

  build() {
    Column({ space: CubeSpace.m }) {
      PageHeader({ title: $r('app.string.statistics'), onBack: this.onBack })
      Scroll() {
        Column({ space: CubeSpace.m }) {
          SectionTitle({ kicker: $r('app.string.personal_best'), title: $r('app.string.stats_tagline') })
          GridRow({ columns: { xs: 1, sm: 2 }, breakpoints: { value: [`${CubeLayout.wideBreakpoint}vp`] },
            gutter: { x: CubeSpace.m, y: CubeSpace.m } }) {
            GridCol() {
              Column({ space: CubeSpace.m }) {
                this.summaryCard()
                if (this.trend.length >= 2) {
                  this.trendCard()
                }
                this.ordersCard()
              }.width('100%')
            }
            GridCol() {
              this.recentList()
            }
          }.width('100%')
          Text($r('app.string.results_retention'))
            .fontSize(CubeFont.caption).fontColor(CubeTheme.secondary).lineHeight(18).textAlign(TextAlign.Center)
        }.width('100%').padding({ bottom: CubeSpace.xl })
      }.width('100%').layoutWeight(1).scrollBar(BarState.Off).align(Alignment.Top)
    }.width('100%').height('100%').constraintSize({ maxWidth: CubeLayout.wideMaxWidth })
      .padding({ left: CubeSpace.l, right: CubeSpace.l, top: 10 })
  }
}
