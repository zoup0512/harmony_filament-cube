# Razor Cube · HarmonyOS 元服务

将 Android `app-filament/game-cube` 的离线多阶魔方玩法迁移为 HarmonyOS Stage / ArkTS 元服务。界面使用 ArkUI，三维魔方采用 Canvas 透视投影，不依赖 Android Filament、原生库、网络或第三方运行时包。

## 功能

- 首页选择 **2 / 3 / 4 / 5 阶**；核心模型支持 2–7 阶。
- 黑色分块、六色贴纸、透视视角、逐层平滑动画。
- 在魔方表面滑动转层（支持内层）；拖动空白或双指拖动旋转视角；提供“正视角”按钮。
- U / D / L / R / F / B 十二个正反转按钮；方向以正对相应魔方面为准，而不是当前屏幕方向。
- 打乱、撤销、复位、历史提示、五步入门教程。
- 打乱不计步；打乱后第一手开始计时，六面同色自动结束；后台暂停计时与动画调度。
- 本地成绩、按阶最佳、最近 20 条展示（最多保留 200 条）、确认后清空。
- 默认阶数、0.5–2.0× 动画速度、本地转动提示音与可选触感反馈。
- 元服务系统胶囊区域避让；离线运行，无联网权限。

### 行为边界与原版差异

- **不是通用魔方求解器。**“历史提示”消除相邻互逆操作后逆向回放本局操作，包含打乱和玩家操作；它不是最短公式。使用提示后本局只作为练习，不计入成绩。
- **复位不是求解动画**：直接清除本局并重建完成态。
- 入门教程使用固定五手外层序列，再按逆序高亮引导，不记成绩；原版为随机五手。
- 打乱长度沿用 11 / 25 / 45 / 65 个动画动作；本版每个动作都是 ±90°，不含单独的 180° 动作，因此不承诺与原版随机分布一致。
- 撤销立即落地，不播放转层动画；`moveCount` 为当前未撤销的用户操作数量。
- Canvas 使用面深度排序，不是 Filament 的逐像素深度缓冲。逻辑与动画几何有自动化测试，复杂遮挡和低端设备性能仍应真机验收。
- 不保存进行中的局面，退出或进程结束会丢弃本局；已完成成绩与设置持久化。
- 本机成绩容量为 200 条，因此“最佳”也是保留记录内的最佳，不是无限历史纪录。

## 已验证结果

完整记录见 [verification/RESULTS.md](verification/RESULTS.md)：Debug / Release 构建成功，145 项自动化测试通过，最终 Release 在 HarmonyOS API 24 模拟器上的 58 项交互检查通过。真机与上架验证边界在报告中单独列出。

## 开发环境

本机验证环境：

- Windows，DevEco Studio **6.1.1.300**。
- 编译 / target：HarmonyOS **6.1.1 / API 24**。
- compatible：HarmonyOS **5.0.0 / API 12**。
- 构建使用 DevEco 自带 Node、Hvigor、JBR；逻辑测试使用 **Node.js 24**。
- 元服务配置：`AppScope/app.json5` 的 `bundleType: atomicService`，`entry/src/main/module.json5` 的 `installationFree: true`。
- API 12 兼容元服务按本机官方模板设置 `useNormalizedOHMUrl: false`。

## 构建

在 DevEco Studio 打开本目录并同步后，可直接 Build HAP；或使用 PowerShell：

```powershell
.\scripts\build.ps1
.\scripts\build.ps1 -Mode release
# 非默认安装位置：
.\scripts\build.ps1 -DevEcoHome 'D:\Tools\DevEco Studio'
```

脚本仅在当前进程设置 SDK / Java 环境，并在退出时恢复，不修改系统环境变量。

本次验证额外保留了 `dist/razor-cube-debug-unsigned.hap` 和 `dist/razor-cube-release-unsigned.hap`。它们是本次交付快照；以后修改源码请重新构建，不能继续使用旧快照。

默认产物：

```text
entry/build/default/outputs/default/entry-default-unsigned.hap
```

**未配置或复制任何开发者证书。** 本地 API 24 模拟器接受此未签名调试包；这不代表其他设备也能接受。真机、分发和上架需用你自己的 AppGallery Connect 元服务应用、包名及证书，在 DevEco 的 Signing Configs 中配置签名。当前包名为 `com.razor.cube.atomic`，发布前应替换为你注册的包名。

## 自动化测试

纯逻辑 / 渲染几何 / 持久化测试不需要模拟器和 npm 安装：

```powershell
node --unhandled-rejections=strict --test tests/*.test.mjs
```

- `cube-model.test.mjs`：各阶各轴各层正逆转、四次复原、整数坐标、整体旋转完成判定、打乱、历史提示收敛、撤销重做与非法输入。
- `cube-renderer.test.mjs`：2–7 阶、35 个视角、38,920 次方向拾取、1,296 个动画帧；动画末态与实际提交态一致，绘制不修改模型。
- `cube-store.test.mjs`：损坏数据、安全验证、异步写入顺序、错误传播、记录裁剪及恢复。
- `cube-feedback.test.mjs`：音频与振动能力独立、准备超时、释放期间迟到资源回收、音效不排队。
- `cube-touch.test.mjs`：直接提取实际页面触摸方法，验证 Harmony 抬手事件、多指切换、取消、阈值及忙碌保护。
- `cube-game.test.mjs`：直接提取页面游戏流程，验证计时、动画提交、真实模型完成后保存成绩、辅助/教程不记榜、后台保护及跨局异步回调隔离。

测试对 `.ets` 文件使用 Node 内置 `stripTypeScriptTypes` 和平台 mock；实验性 API 警告正常。它不替代实际 ArkTS 编译或设备测试。

### 本地模拟器

```powershell
$hdc = 'C:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe'
& $hdc list targets
& $hdc -t 127.0.0.1:5633 install -r entry/build/default/outputs/default/entry-default-unsigned.hap
& $hdc -t 127.0.0.1:5633 shell aa start -a EntryAbility -b com.razor.cube.atomic
```

不要在有多个设备时省略 `-t`，避免误操作其他真机。`scripts/smoke.mjs` 使用 HDC / UI Test 对已安装元服务进行界面冒烟测试，默认仅连接 `127.0.0.1:5633`；可用 `HDC_TARGET` 指定专用测试设备。它会重新启动本应用并操作测试局与偏好设置，不应对正在使用的个人会话运行。截图、布局和结果保存在 `verification/ui/`。

## 结构

```text
AppScope/                         元服务应用身份与图标
entry/src/main/module.json5        元服务入口、设备和权限
entry/src/main/ets/
  entryability/EntryAbility.ets    页面加载与前后台生命周期
  pages/Index.ets                  首页、游戏、统计、设置及游戏流程
  model/CubeModel.ts               精确整数魔方与操作历史
  render/CubeRenderer.ets          透视投影、动画绘制、面拾取与手势映射
  storage/CubeStore.ets            Preferences 设置与成绩
  platform/CubeFeedback.ets        本地音效与可选振动
entry/src/main/resources/rawfile/  本地短提示音
scripts/                          构建与模拟器冒烟测试
tests/                            Node 自动化回归测试
verification/                     本地设备验证证据
```

## 权限与隐私

仅申请 `ohos.permission.VIBRATE`（system_grant）。无网络、相机、麦克风、位置、联系人或外部存储权限。音效为包内生成的 40ms PCM WAV；振动或播放器能力不可用时不应中断魔方操作。

## 待真机验收

- 在最低兼容 API 12 设备上验证安装、元服务入口和平台 API。
- 真机音量、静音策略、振动反馈，以及低端机 5 阶动画性能。
- 大字体、小屏、平板与折叠屏窗口适配。
- 正式签名、元服务分发入口、AppGallery 审核和实际发布包体限制。
