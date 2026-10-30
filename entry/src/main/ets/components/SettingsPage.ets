import { CubeFont, CubeLayout, CubeRadius, CubeSpace, CubeTheme } from '../pages/CubeTheme';
import { CubeCards } from '../pages/CubeStyles';
import { BrandMark, OrderSelector, PageHeader } from './CubeWidgets';

@Component
struct SettingSwitchRow {
  title: Resource = $r('app.string.settings');
  help: Resource = $r('app.string.settings');
  @Prop isOn: boolean = false;
  onToggle: (value: boolean) => void = () => {};

  build() {
    Row({ space: CubeSpace.s }) {
      Column({ space: CubeSpace.xxs }) {
        Text(this.title).fontSize(CubeFont.subhead).fontWeight(FontWeight.Medium).fontColor(CubeTheme.ink)
        Text(this.help).fontSize(CubeFont.caption).lineHeight(18).fontColor(CubeTheme.secondary)
      }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      Toggle({ type: ToggleType.Switch, isOn: this.isOn }).selectedColor(CubeTheme.green)
        .switchStyle({ unselectedColor: CubeTheme.line })
        .accessibilityText(this.title)
        .onChange((value: boolean) => this.onToggle(value))
    }.width('100%').constraintSize({ minHeight: CubeLayout.touchTarget })
  }
}

@Component
export struct SettingsPage {
  @Prop defaultOrder: number = 3;
  @Prop speed: number = 1;
  @Prop sound: boolean = true;
  @Prop haptics: boolean = true;
  @Prop beginnerGuides: boolean = true;
  orders: number[] = [2, 3, 4, 5];
  onBack: () => void = () => {};
  onDefaultOrder: (value: number) => void = () => {};
  onSpeed: (value: number, commit: boolean) => void = () => {};
  onSound: (value: boolean) => void = () => {};
  onHaptics: (value: boolean) => void = () => {};
  onGuides: (value: boolean) => void = () => {};

  build() {
    Column({ space: CubeSpace.m }) {
      PageHeader({ title: $r('app.string.settings'), onBack: this.onBack })
      Scroll() {
        Column({ space: CubeSpace.m }) {
          Column({ space: CubeSpace.s }) {
            Column({ space: CubeSpace.xxs }) {
              Text($r('app.string.default_order')).fontSize(CubeFont.subhead).fontWeight(FontWeight.Bold)
                .fontColor(CubeTheme.ink)
              Text($r('app.string.default_order_help')).fontSize(CubeFont.caption).fontColor(CubeTheme.secondary)
            }.width('100%').alignItems(HorizontalAlign.Start)
            OrderSelector({ selected: this.defaultOrder, orders: this.orders, onSelect: this.onDefaultOrder })
          }.attributeModifier(CubeCards.surface)
          Column({ space: CubeSpace.s }) {
            Row() {
              Text($r('app.string.turn_animation')).fontSize(CubeFont.subhead).fontWeight(FontWeight.Bold)
                .fontColor(CubeTheme.ink)
              Blank()
              Text(`${this.speed.toFixed(1)}×`).fontSize(CubeFont.label).fontWeight(FontWeight.Medium)
                .fontColor(CubeTheme.green)
                .padding({ left: CubeSpace.s, right: CubeSpace.s, top: 6, bottom: 6 }).backgroundColor(CubeTheme.mint)
                .borderRadius(CubeRadius.m)
            }.width('100%')
            Slider({ value: this.speed, min: 0.5, max: 2, step: 0.1 })
              .selectedColor(CubeTheme.green).trackColor(CubeTheme.line).blockColor(CubeTheme.green)
              .accessibilityText($r('app.string.speed_accessibility'))
              .onChange((value: number, mode: SliderChangeMode) => {
                this.onSpeed(value, mode === SliderChangeMode.End || mode === SliderChangeMode.Click);
              })
            Row() {
              Text($r('app.string.speed_slow')).fontSize(CubeFont.caption).fontColor(CubeTheme.secondary)
              Blank()
              Text($r('app.string.speed_fast')).fontSize(CubeFont.caption).fontColor(CubeTheme.secondary)
            }.width('100%')
          }.attributeModifier(CubeCards.surface)
          Column({ space: CubeSpace.s }) {
            SettingSwitchRow({ title: $r('app.string.beginner_guides'), help: $r('app.string.beginner_guides_help'),
              isOn: this.beginnerGuides, onToggle: this.onGuides })
            Divider().color(CubeTheme.line)
            SettingSwitchRow({ title: $r('app.string.turn_sound'), help: $r('app.string.turn_sound_help'),
              isOn: this.sound, onToggle: this.onSound })
            Divider().color(CubeTheme.line)
            SettingSwitchRow({ title: $r('app.string.haptic_feedback'), help: $r('app.string.haptic_help'),
              isOn: this.haptics, onToggle: this.onHaptics })
          }.attributeModifier(CubeCards.surface).id('settings-switches')
          Column({ space: CubeSpace.s }) {
            Row({ space: CubeSpace.s }) {
              BrandMark()
              Column({ space: 3 }) {
                Text($r('app.string.about_name')).fontSize(CubeFont.subhead).fontWeight(FontWeight.Bold)
                  .fontColor(CubeTheme.ink)
                Text($r('app.string.about_tagline')).fontSize(CubeFont.caption).fontColor(CubeTheme.secondary)
              }.alignItems(HorizontalAlign.Start)
            }.width('100%')
            Text($r('app.string.about_description'))
              .fontSize(CubeFont.label).fontColor(CubeTheme.secondary).lineHeight(21).width('100%')
          }.attributeModifier(CubeCards.mint)
        }.width('100%').padding({ bottom: CubeSpace.xl })
      }.width('100%').layoutWeight(1).scrollBar(BarState.Off).align(Alignment.Top)
    }.width('100%').height('100%').constraintSize({ maxWidth: CubeLayout.contentMaxWidth })
      .padding({ left: CubeSpace.l, right: CubeSpace.l, top: 10 })
  }
}
