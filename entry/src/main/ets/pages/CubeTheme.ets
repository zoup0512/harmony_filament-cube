// Colors resolve from resources so base/ and dark/ palettes follow the system color mode.
export class CubeTheme {
  static readonly background: ResourceColor = $r('app.color.cube_background');
  static readonly surface: ResourceColor = $r('app.color.cube_surface');
  static readonly ink: ResourceColor = $r('app.color.cube_ink');
  static readonly secondary: ResourceColor = $r('app.color.cube_secondary');
  static readonly muted: ResourceColor = $r('app.color.cube_muted');
  static readonly accent: ResourceColor = $r('app.color.cube_accent');
  static readonly onAccent: ResourceColor = $r('app.color.cube_on_accent');
  static readonly green: ResourceColor = $r('app.color.cube_green');
  static readonly mint: ResourceColor = $r('app.color.cube_mint');
  static readonly soft: ResourceColor = $r('app.color.cube_soft');
  static readonly line: ResourceColor = $r('app.color.cube_line');
  static readonly danger: ResourceColor = $r('app.color.cube_danger');
  static readonly amber: ResourceColor = $r('app.color.cube_amber');
  static readonly amberSoft: ResourceColor = $r('app.color.cube_amber_soft');
  static readonly hero: ResourceColor = $r('app.color.cube_hero');
  static readonly onHero: ResourceColor = $r('app.color.cube_on_hero');
  static readonly onHeroMuted: ResourceColor = $r('app.color.cube_on_hero_muted');
  static readonly heroTrack: ResourceColor = $r('app.color.cube_hero_track');
  static readonly selectedBorder: ResourceColor = $r('app.color.cube_selected_border');
  static readonly stageStart: ResourceColor = $r('app.color.cube_stage_start');
  static readonly stageEnd: ResourceColor = $r('app.color.cube_stage_end');
  static readonly stageRing: ResourceColor = $r('app.color.cube_stage_ring');
  static readonly stageDisc: ResourceColor = $r('app.color.cube_stage_disc');
  static readonly overlay: ResourceColor = $r('app.color.cube_overlay');
  static readonly scrim: ResourceColor = $r('app.color.cube_scrim');
}

// Type scale (fp). Captions never go below 12.
export class CubeFont {
  static readonly display: number = 36;
  static readonly title: number = 26;
  static readonly headline: number = 17;
  static readonly subhead: number = 15;
  static readonly body: number = 14;
  static readonly label: number = 13;
  static readonly caption: number = 12;
}

export class CubeSpace {
  static readonly xxs: number = 4;
  static readonly xs: number = 8;
  static readonly s: number = 12;
  static readonly m: number = 16;
  static readonly l: number = 20;
  static readonly xl: number = 24;
}

export class CubeRadius {
  static readonly s: number = 8;
  static readonly m: number = 12;
  static readonly l: number = 16;
  static readonly xl: number = 24;
}

export class CubeLayout {
  static readonly touchTarget: number = 48;
  static readonly wideBreakpoint: number = 600;
  static readonly contentMaxWidth: number = 600;
  static readonly wideMaxWidth: number = 960;
}
