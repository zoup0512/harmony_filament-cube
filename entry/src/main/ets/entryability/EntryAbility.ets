import { UIAbility, Configuration } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { CubeTheme } from '../pages/CubeTheme';

export default class EntryAbility extends UIAbility {
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
      mainWindow.setWindowSystemBarProperties({
        statusBarColor: CubeTheme.background,
        statusBarContentColor: CubeTheme.ink,
        navigationBarColor: CubeTheme.background,
        navigationBarContentColor: CubeTheme.ink
      });
    }).catch(() => {});
  }

  onConfigurationUpdate(configuration: Configuration): void {
    AppStorage.setOrCreate('cubeLanguage', configuration.language ?? this.context.config.language ?? '');
  }

  onForeground(): void {
    AppStorage.setOrCreate('cubeForeground', true);
  }

  onBackground(): void {
    AppStorage.setOrCreate('cubeForeground', false);
  }
}
