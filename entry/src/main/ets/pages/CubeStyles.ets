import { CubeFont, CubeLayout, CubeRadius, CubeSpace, CubeTheme } from './CubeTheme';

// Shared button treatments. Callers only add sizing (width/layoutWeight), state and handlers;
// heights are minimums so labels can grow with the system font scale instead of clipping.
export class ActionButtonStyle implements AttributeModifier<ButtonAttribute> {
  private background: ResourceColor;
  private foreground: ResourceColor;
  private size: number;
  private weight: FontWeight;
  private minHeight: number;

  constructor(background: ResourceColor, foreground: ResourceColor, size: number = CubeFont.body,
    weight: FontWeight = FontWeight.Bold, minHeight: number = CubeLayout.touchTarget) {
    this.background = background;
    this.foreground = foreground;
    this.size = size;
    this.weight = weight;
    this.minHeight = minHeight;
  }

  applyNormalAttribute(instance: ButtonAttribute): void {
    instance.backgroundColor(this.background).fontColor(this.foreground).fontSize(this.size)
      .fontWeight(this.weight).borderRadius(CubeRadius.m)
      .padding({ left: CubeSpace.xxs, right: CubeSpace.xxs, top: CubeSpace.xxs, bottom: CubeSpace.xxs })
      .labelStyle({ maxLines: 2 }).constraintSize({ minHeight: this.minHeight })
      .clickEffect({ level: ClickEffectLevel.LIGHT });
  }
}

export class CardStyle implements AttributeModifier<ColumnAttribute> {
  private background: ResourceColor;
  private inner: number;

  constructor(background: ResourceColor, inner: number = 18) {
    this.background = background;
    this.inner = inner;
  }

  applyNormalAttribute(instance: ColumnAttribute): void {
    instance.width('100%').padding(this.inner).backgroundColor(this.background).borderRadius(CubeRadius.xl);
  }
}

export class CubeButtons {
  static readonly primary: ActionButtonStyle = new ActionButtonStyle(CubeTheme.accent, CubeTheme.onAccent);
  static readonly hero: ActionButtonStyle =
    new ActionButtonStyle(CubeTheme.accent, CubeTheme.onAccent, CubeFont.headline, FontWeight.Bold, 56);
  static readonly tonal: ActionButtonStyle = new ActionButtonStyle(CubeTheme.mint, CubeTheme.green);
  static readonly quiet: ActionButtonStyle =
    new ActionButtonStyle(CubeTheme.soft, CubeTheme.secondary, CubeFont.label, FontWeight.Medium);
  static readonly danger: ActionButtonStyle =
    new ActionButtonStyle(Color.Transparent, CubeTheme.danger, CubeFont.label, FontWeight.Medium, 44);
}

export class CubeCards {
  static readonly surface: CardStyle = new CardStyle(CubeTheme.surface);
  static readonly hero: CardStyle = new CardStyle(CubeTheme.hero, 20);
  static readonly mint: CardStyle = new CardStyle(CubeTheme.mint, 20);
}
