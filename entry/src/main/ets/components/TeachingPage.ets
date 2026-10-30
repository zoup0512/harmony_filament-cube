import { CubeFont, CubeLayout, CubeRadius, CubeSpace, CubeTheme } from '../pages/CubeTheme';
import { PageHeader, SectionTitle } from './CubeWidgets';

export class TeachingItem {
  index: number = 0;
  id: string = '';
  serial: string = '';
  title: string = '';
  details: string = '';
  description: string = '';
  difficulty: string = '';
  status: string = '';
  kind: string = 'new';
  best: string = '';

  constructor(index: number, id: string, title: string, details: string, description: string,
    difficulty: string, status: string, kind: string, best: string) {
    this.index = index;
    this.id = id;
    this.serial = (index + 1).toString().padStart(2, '0');
    this.title = title;
    this.details = details;
    this.description = description;
    this.difficulty = difficulty;
    this.status = status;
    this.kind = kind;
    this.best = best;
  }
}

export class TeachingGroup {
  order: number = 0;
  items: TeachingItem[] = [];

  constructor(order: number) {
    this.order = order;
  }
}

@Component
export struct TeachingPage {
  @Prop groups: TeachingGroup[] = [];
  @Prop solved: number = 0;
  @Prop total: number = 0;
  @Prop progress: string = '';
  @Prop loaded: boolean = false;
  @Prop storageWarning: string = '';
  @State private rulesOpen: boolean = false;
  onBack: () => void = () => {};
  onStart: (index: number) => void = () => {};

  private statusColor(kind: string): ResourceColor {
    if (kind === 'solved') { return CubeTheme.green; }
    return kind === 'guided' ? CubeTheme.amber : CubeTheme.secondary;
  }

  private statusBackground(kind: string): ResourceColor {
    if (kind === 'solved') { return CubeTheme.mint; }
    return kind === 'guided' ? CubeTheme.amberSoft : CubeTheme.soft;
  }

  @Builder
  private progressCard() {
    Column({ space: CubeSpace.s }) {
      Text(this.progress).fontSize(20).fontWeight(FontWeight.Bold).fontColor(CubeTheme.accent)
      Progress({ value: this.solved, total: Math.max(1, this.total), type: ProgressType.Linear })
        .width('100%').color(CubeTheme.accent).backgroundColor(CubeTheme.heroTrack).style({ strokeWidth: 6 })
        .accessibilityText(this.progress)
      Row({ space: CubeSpace.xxs }) {
        Text($r('app.string.teaching_rules_title')).fontSize(CubeFont.label).fontColor(CubeTheme.onHero)
          .fontWeight(FontWeight.Medium)
        SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(16).fontColor([CubeTheme.onHeroMuted])
          .rotate({ angle: this.rulesOpen ? 180 : 0 })
      }.constraintSize({ minHeight: 32 }).id('teaching-rules-toggle')
      .accessibilityText($r('app.string.teaching_rules_title'))
      .onClick(() => {
        this.getUIContext().animateTo({ duration: 220, curve: Curve.EaseOut }, () => {
          this.rulesOpen = !this.rulesOpen;
        });
      })
      if (this.rulesOpen) {
        Text($r('app.string.teaching_rules')).fontSize(CubeFont.label).lineHeight(20)
          .fontColor(CubeTheme.onHeroMuted).width('100%')
          .transition(TransitionEffect.OPACITY.combine(TransitionEffect.translate({ y: -6 })))
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding(20).backgroundColor(CubeTheme.hero)
      .borderRadius(CubeRadius.xl).clip(true)
  }

  @Builder
  private levelCard(item: TeachingItem) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: CubeSpace.s }) {
        Row({ space: CubeSpace.s }) {
          Text(item.serial).fontSize(19).fontWeight(FontWeight.Bold)
            .fontColor(CubeTheme.green).width(46).height(46).textAlign(TextAlign.Center)
            .backgroundColor(CubeTheme.mint).borderRadius(CubeRadius.l)
          Column({ space: CubeSpace.xxs }) {
            Text(item.title).fontSize(CubeFont.subhead).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
            Text(item.details).fontSize(CubeFont.caption).lineHeight(17).fontColor(CubeTheme.secondary)
          }.alignItems(HorizontalAlign.Start).layoutWeight(1)
          SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(20).fontColor([CubeTheme.green])
            .accessibilityLevel('no')
        }.width('100%')
        Text(item.description).fontSize(CubeFont.label).lineHeight(20).fontColor(CubeTheme.secondary).width('100%')
        Row({ space: CubeSpace.xs }) {
          Text(item.difficulty).fontSize(CubeFont.caption).fontColor(CubeTheme.green)
            .padding({ left: 9, right: 9, top: 5, bottom: 5 }).backgroundColor(CubeTheme.mint)
            .borderRadius(CubeRadius.s)
          Blank()
          Row({ space: CubeSpace.xxs }) {
            SymbolGlyph(item.kind === 'solved' ? $r('sys.symbol.checkmark_circle_fill') :
              (item.kind === 'guided' ? $r('sys.symbol.lightbulb') : $r('sys.symbol.circle')))
              .fontSize(13).fontColor([this.statusColor(item.kind)])
            Text(item.status).fontSize(CubeFont.caption).fontColor(this.statusColor(item.kind))
          }.padding({ left: CubeSpace.xs, right: CubeSpace.xs, top: 5, bottom: 5 })
          .backgroundColor(this.statusBackground(item.kind)).borderRadius(CubeRadius.s)
        }.width('100%')
        if (item.best.length > 0) {
          Text(item.best).fontSize(CubeFont.caption).fontColor(CubeTheme.secondary).width('100%')
        }
      }.width('100%').padding(18).alignItems(HorizontalAlign.Start)
    }.width('100%').padding(0).borderRadius(CubeRadius.xl).backgroundColor(CubeTheme.surface)
      .clickEffect({ level: ClickEffectLevel.LIGHT })
      .enabled(this.loaded).onClick(() => this.onStart(item.index))
  }

  build() {
    Column({ space: CubeSpace.m }) {
      PageHeader({ title: $r('app.string.teaching'), onBack: this.onBack })
      Scroll() {
        Column({ space: CubeSpace.m }) {
          SectionTitle({ kicker: $r('app.string.teaching_kicker'), title: $r('app.string.teaching_title') })
          Text($r('app.string.teaching_description')).fontSize(CubeFont.body).lineHeight(22)
            .fontColor(CubeTheme.secondary).width('100%')
          this.progressCard()
          ForEach(this.groups, (group: TeachingGroup) => {
            Column({ space: CubeSpace.s }) {
              Text($r('app.string.teaching_group', group.order)).fontSize(CubeFont.label)
                .fontWeight(FontWeight.Medium).fontColor(CubeTheme.secondary).margin({ top: CubeSpace.xxs })
              GridRow({ columns: { xs: 1, sm: 2 }, breakpoints: { value: [`${CubeLayout.wideBreakpoint}vp`] },
                gutter: { x: CubeSpace.s, y: CubeSpace.s } }) {
                ForEach(group.items, (item: TeachingItem) => {
                  GridCol() {
                    this.levelCard(item)
                  }
                }, (item: TeachingItem) => `${item.id}-${item.kind}-${item.best}-${item.title}`)
              }.width('100%')
            }.width('100%').alignItems(HorizontalAlign.Start)
          }, (group: TeachingGroup) => `${group.order}-${group.items.map((item: TeachingItem) =>
            item.kind + item.best + item.title).join('|')}`)
          if (this.storageWarning.length > 0) {
            Text(this.storageWarning).fontSize(CubeFont.caption).lineHeight(18).fontColor(CubeTheme.danger)
              .width('100%')
          }
        }.width('100%').padding({ bottom: CubeSpace.xl })
      }.width('100%').layoutWeight(1).scrollBar(BarState.Off).align(Alignment.Top)
    }.width('100%').height('100%').constraintSize({ maxWidth: CubeLayout.wideMaxWidth })
      .padding({ left: CubeSpace.l, right: CubeSpace.l, top: 10 })
  }
}
