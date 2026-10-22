# Razor Cube · HarmonyOS 元服务

将 Android `app-filament/game-cube` 的离线多阶魔方玩法迁移为 HarmonyOS Stage / ArkTS 元服务。界面使用 ArkUI，三维魔方采用 Canvas 透视投影，不依赖 Android Filament、原生库、网络或第三方运行时包。

## 功能

- 首页选择 **2 / 3 / 4 / 5 阶**；核心模型支持 2–7 阶。
- 黑色分块、六色贴纸、透视视角、逐层平滑动画。
- 在魔方表面滑动转层（支持内层）；拖动空白或双指拖动旋转视角；提供“正视角”按钮。
- **纯滑动转层，无 U / D / L / R / F / B 转面按钮**。沿表面行或列滑动至少 24vp，松手转 90°；模糊斜滑不提交。缝隙也按魔方表面拾取，支持内层。
- 打乱、撤销、复位、历史提示、五步入门教程。
- 打乱不计步；打乱后第一手开始计时，六面同色自动结束；后台暂停计时与动画调度。
- 本地成绩、按阶最佳、最近 20 条展示（最多保留 200 条）、确认后清空。
- 默认阶数、0.5–2.0× 动画速度、本地转动提示音与可选触感反馈。
- 元服务系统胶囊区域避让；离线运行，无联网权限。

### 行为边界与原版差异

- **不是通用魔方求解器。**“历史提示”消除相邻互逆操作后逆向回放本局操作，包含打乱和玩家操作；它不是最短公式。使用提示后本局只作为练习，不计入成绩。
- **复位不是求解动画**：直接清除本局并重建完成态。
- 入门教程使用固定五手外层序列，再按逆序显示滑动箭头，不记成绩；原版为随机五手。从圆点滑向箭头即可完成当前步；看不到箭头时拖动空白或双指转动视角。
- 选轴参照 Android 的 `axis × faceNormal` 投影，要求匹配分 ≥0.75 且领先次选 ≥0.15。忙碌时单指触碰魔方不触发新操作，背景或双指仍能旋转视角。
- 视角拖动方向与 Android 对齐，但本版仍使用 yaw/pitch 并限制俯仰 ±1.45rad，不是原版的无限旋转矩阵。
- 打乱长度沿用 11 / 25 / 45 / 65 个动画动作；本版每个动作都是 ±90°，不含单独的 180° 动作，因此不承诺与原版随机分布一致。
- 撤销立即落地，不播放转层动画；`moveCount` 为当前未撤销的用户操作数量。
- Canvas 使用面深度排序，不是 Filament 的逐像素深度缓冲。逻辑与动画几何有自动化测试，复杂遮挡和低端设备性能仍应真机验收。
- 不保存进行中的局面，退出或进程结束会丢弃本局；已完成成绩与设置持久化。
- 本机成绩容量为 200 条，因此“最佳”也是保留记录内的最佳，不是无限历史纪录。

## 已验证结果

当前纯手势版本见 [verification/gestures/RESULTS.md](verification/gestures/RESULTS.md)：Debug / Release 构建成功，211 项自动化测试与420项离线箭头坐标检查通过，最终 Release 在 HarmonyOS API 24 模拟器上的92项交互检查通过。真机与上架验证边界在报告中单独列出。此前按钮版报告保留在 `verification/RESULTS.md`，不代表当前界面。

## 开发环境

本机验证环境：

- Windows，DevEco Studio **6.1.1.300**。
- 编译 / target：HarmonyOS **6.1.1 / API 24**。
- 当前工程 compatible：HarmonyOS **6.1.1 / API 24**（保留现有工程配置）。
- 构建使用 DevEco 自带 Node、Hvigor、JBR；逻辑测试使用 **Node.js 24**。
- 元服务配置：`AppScope/app.json5` 的 `bundleType: atomicService`，`entry/src/main/module.json5` 的 `installationFree: true`。
- 保留当前工程的 `useNormalizedOHMUrl: false` 设置。

## 构建

在 DevEco Studio 打开本目录并同步后，可直接 Build HAP；或使用 PowerShell：

```powershell
.\scripts\build.ps1
.\scripts\build.ps1 -Mode release
# 非默认安装位置：
.\scripts\build.ps1 -DevEcoHome 'D:\Tools\DevEco Studio'
```

脚本仅在当前进程设置 SDK / Java 环境，并在退出时恢复，不修改系统环境变量。

仓库仅同步源码、测试、构建脚本与 Markdown 验证报告。`dist/` 安装包、校验文件，以及 `verification/` 下的截图、布局 JSON 和日志均为本地生成产物，已加入 `.gitignore`，需要时重新构建或运行测试生成。

默认产物：

```text
entry/build/default/outputs/default/entry-default-unsigned.hap
```

**共享构建配置不包含签名证书、口令或本机绝对路径，默认生成未签名包。** 本地 API 24 模拟器曾接受未签名调试包；这不代表其他设备也能接受。真机、分发和上架需使用你自己的 AppGallery Connect 元服务应用和证书，在 DevEco 的 Signing Configs 中配置签名，且不要提交签名材料。当前包名为 `com.atomicservice.6917619740903087965`，以 `AppScope/app.json5` 为准。本机原签名配置已备份至被忽略的 `.local/build-profile.json5`，不会随 Git 同步。

## 自动化测试

纯逻辑 / 渲染几何 / 持久化测试不需要模拟器和 npm 安装：

```powershell
node --unhandled-rejections=strict --test tests/*.test.mjs
```

- `cube-model.test.mjs`：各阶各轴各层正逆转、四次复原、整数坐标、整体旋转完成判定、打乱、历史提示收敛、撤销重做与非法输入。
- `cube-renderer.test.mjs`：2–7 阶、35 个视角、1,296 个动画帧；验证 Android 切向选轴、歧义拒绝、缝隙命中、2,612 个教程箭头回代及动画末态一致性。
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
& $hdc -t 127.0.0.1:5633 shell aa start -a EntryAbility -b com.atomicservice.6917619740903087965
```

不要在有多个设备时省略 `-t`，避免误操作其他真机。`scripts/smoke.mjs` 使用 HDC / UI Test 对已安装元服务进行界面冒烟测试，默认仅连接 `127.0.0.1:5633`；可用 `HDC_TARGET` 指定专用测试设备。它会重新启动本应用并操作测试局与偏好设置，不应对正在使用的个人会话运行。运行生成的截图、布局和结果默认保存在本地 `verification/gestures/`，可用 `SMOKE_OUT` 指定其他目录；这些产物不纳入 Git。测试脚本从 `AppScope/app.json5` 读取当前包名。运行前请按 `hdc list targets` 设置实际设备，例如 `$env:HDC_TARGET='127.0.0.1:5559'`，再执行 `node scripts/smoke.mjs`。

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

- 在符合当前 compatible API 24 的实体设备上验证安装、元服务入口和平台 API。
- 真机音量、静音策略、振动反馈，以及低端机 5 阶动画性能。
- 大字体、小屏、平板与折叠屏窗口适配。
- 正式签名、元服务分发入口、AppGallery 审核和实际发布包体限制。
