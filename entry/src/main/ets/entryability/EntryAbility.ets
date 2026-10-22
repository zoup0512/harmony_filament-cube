import { UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { CubeTheme } from '../pages/CubeTheme';

export default class EntryAbility extends UIAbility {
  onWindowStageCreate(windowStage: window.WindowStage): void {
    AppStorage.setOrCreate('cubeForeground', true);
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

  onForeground(): void {
    AppStorage.setOrCreate('cubeForeground', true);
  }

  onBackground(): void {
    AppStorage.setOrCreate('cubeForeground', false);
  }
}
