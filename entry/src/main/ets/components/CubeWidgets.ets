import { CubeFont, CubeLayout, CubeRadius, CubeSpace, CubeTheme } from '../pages/CubeTheme';

@Component
export struct BackButton {
  label: Resource = $r('app.string.return_home');
  onBack: () => void = () => {};

  build() {
    Button({ type: ButtonType.Circle }) {
      SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(22).fontColor([CubeTheme.ink])
    }.width(44).height(44).padding(0)
      .backgroundColor(CubeTheme.surface).border({ width: 1, color: CubeTheme.line })
      .clickEffect({ level: ClickEffectLevel.LIGHT })
      .id('back-button')
      .accessibilityText(this.label)
      .onClick(() => this.onBack())
  }
}

@Component
export struct PageHeader {
  title: ResourceStr = '';
  backLabel: Resource = $r('app.string.return_home');
  onBack: () => void = () => {};

  build() {
    Row({ space: CubeSpace.s }) {
      BackButton({ label: this.backLabel, onBack: this.onBack })
      Text(this.title).fontSize(CubeFont.headline).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
        .layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
    }.width('100%').constraintSize({ minHeight: CubeLayout.touchTarget })
  }
}

@Component
export struct SectionTitle {
  kicker: ResourceStr = '';
  title: ResourceStr = '';

  build() {
    Column({ space: CubeSpace.xs }) {
      Text(this.kicker).fontSize(CubeFont.caption).fontColor(CubeTheme.green).letterSpacing(1.5)
        .fontWeight(FontWeight.Medium)
      Text(this.title).fontSize(CubeFont.title).fontWeight(FontWeight.Bold).fontColor(CubeTheme.ink)
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}

@Component
export struct OrderSelector {
  @Prop selected: number = 3;
  orders: number[] = [2, 3, 4, 5];
  onSelect: (value: number) => void = () => {};

  build() {
    Row({ space: CubeSpace.xs }) {
      ForEach(this.orders, (value: number) => {
        Button($r('app.string.order_label', value), { type: ButtonType.Normal })
          .layoutWeight(1).constraintSize({ minHeight: CubeLayout.touchTarget })
          .fontSize(CubeFont.subhead).fontWeight(FontWeight.Medium).labelStyle({ maxLines: 1 })
          .backgroundColor(this.selected === value ? CubeTheme.hero : CubeTheme.surface)
          .fontColor(this.selected === value ? CubeTheme.accent : CubeTheme.secondary)
          .border({ width: 1, color: this.selected === value ? CubeTheme.selectedBorder : CubeTheme.line,
            radius: CubeRadius.l })
          .animation({ duration: 180, curve: Curve.EaseOut })
          .clickEffect({ level: ClickEffectLevel.LIGHT })
          .accessibilityText(this.selected === value ? $r('app.string.order_accessibility_selected', value) :
            $r('app.string.order_accessibility', value, ''))
          .onClick(() => this.onSelect(value))
      }, (value: number) => value.toString())
    }.width('100%')
  }
}

@Component
export struct BrandMark {
  build() {
    Column({ space: 3 }) {
      Row({ space: 3 }) {
        Column().width(8).height(8).borderRadius(2).backgroundColor(CubeTheme.accent)
        Column().width(8).height(8).borderRadius(2).backgroundColor(CubeTheme.onHero)
      }
      Row({ space: 3 }) {
        Column().width(8).height(8).borderRadius(2).backgroundColor(CubeTheme.onHero)
        Column().width(8).height(8).borderRadius(2).backgroundColor(CubeTheme.accent)
      }
    }.width(36).height(36).justifyContent(FlexAlign.Center).backgroundColor(CubeTheme.hero)
      .borderRadius(CubeRadius.m).accessibilityLevel('no')
  }
}

@Component
export struct ChartMark {
  markSize: number = 20;
  color: ResourceColor = CubeTheme.green;

  build() {
    Row({ space: 3 }) {
      Column().width(this.markSize * 0.22).height(this.markSize * 0.45).borderRadius(2).backgroundColor(this.color)
      Column().width(this.markSize * 0.22).height(this.markSize * 0.85).borderRadius(2).backgroundColor(this.color)
      Column().width(this.markSize * 0.22).height(this.markSize * 0.65).borderRadius(2).backgroundColor(this.color)
    }.width(this.markSize).height(this.markSize).alignItems(VerticalAlign.Bottom).accessibilityLevel('no')
  }
}
