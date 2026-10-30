import { UIAbility, Configuration, ConfigurationConstant } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';

// System bar colors must be literal hex values; keep them in sync with cube_background / cube_ink.
const LIGHT_BAR_BACKGROUND: string = '#F6F7F2';
const LIGHT_BAR_CONTENT: string = '#182D2A';
const DARK_BAR_BACKGROUND: string = '#0F1513';
const DARK_BAR_CONTENT: string = '#E6EEE9';

export default class EntryAbility extends UIAbility {
  private mainWindow: window.Window | null = null;

  onWindowStageCreate(windowStage: window.WindowStage): void {
    AppStorage.setOrCreate('cubeForeground', true);
    AppStorage.setOrCreate('cubeLanguage', this.context.config.language ?? '');
    try {
      windowStage.loadContent('pages/Index', (error) => {
        if (error.code) { hilog.error(0x0000, 'RazorCube', 'Page load failed: %{public}s', error.message); }
      });
    } catch {
      hilog.error(0x0000, 'RazorCube', 'Unable to load main page');
    }
    windowStage.getMainWindow().then((mainWindow: window.Window) => {
      this.mainWindow = mainWindow;
      this.applySystemBars(this.context.config.colorMode);
    }).catch(() => {});
  }

  onConfigurationUpdate(configuration: Configuration): void {
    AppStorage.setOrCreate('cubeLanguage', configuration.language ?? this.context.config.language ?? '');
    this.applySystemBars(configuration.colorMode ?? this.context.config.colorMode);
  }

  private applySystemBars(colorMode: ConfigurationConstant.ColorMode | undefined): void {
    if (this.mainWindow === null) { return; }
    const dark = colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
    this.mainWindow.setWindowSystemBarProperties({
      statusBarColor: dark ? DARK_BAR_BACKGROUND : LIGHT_BAR_BACKGROUND,
      statusBarContentColor: dark ? DARK_BAR_CONTENT : LIGHT_BAR_CONTENT,
      navigationBarColor: dark ? DARK_BAR_BACKGROUND : LIGHT_BAR_BACKGROUND,
      navigationBarContentColor: dark ? DARK_BAR_CONTENT : LIGHT_BAR_CONTENT
    }).catch(() => {});
  }

  onForeground(): void {
    AppStorage.setOrCreate('cubeForeground', true);
  }

  onBackground(): void {
    AppStorage.setOrCreate('cubeForeground', false);
  }
}
