# Razor Cube · HarmonyOS 手机应用

将 Android `app-filament/game-cube` 的离线多阶魔方玩法迁移为 HarmonyOS Stage / ArkTS 手机应用。界面使用 ArkUI，三维魔方采用 Canvas 透视投影，不依赖 Android Filament、原生库、网络或第三方运行时包。

当前 `main` 为安装式手机应用版本。转换前的元服务版本保留在本地分支 `backup/atomic-service-before-mobile-20261024-221700`；本地未提交的签名配置另存于仓库外的私密备份，不随分支提交。

## 功能

- 首页选择 **2 / 3 / 4 / 5 阶**；核心模型支持 2–7 阶。
- 黑色分块、六色贴纸、透视视角、逐层平滑动画。
- 在魔方表面滑动转层（支持内层）；拖动空白或双指拖动旋转视角；提供“正视角”按钮。
- **纯滑动转层，无 U / D / L / R / F / B 转面按钮**。沿表面行或列滑动至少 24vp，松手转 90°；模糊斜滑不提交。缝隙也按魔方表面拾取，支持内层。
- 打乱、撤销、复位、历史提示、五步入门教程。
- 打乱不计步；打乱后第一手开始计时，六面同色自动结束；后台暂停计时与动画调度。
- 本地成绩、按阶最佳、最近 20 条展示（最多保留 200 条）、确认后清空。
- 默认阶数、0.5–2.0× 动画速度、默认开启的本地转动提示音与可选触感反馈。
- 安装后从桌面启动，支持手机竖屏；移除元服务胶囊专用占位，保留系统安全区域；离线运行，无联网权限。

### 进阶教学

从首页独立的 **“进阶教学”** 入口进入关卡列表，选择八个固定合法局面之一（2 阶 3 关、3 阶 5 关）。每关由已还原魔方经过固定转动得到，与原有五步入门教程独立。

- 沿魔方表面滑动，自由选择还原路线，不要求照着固定公式操作。第一次有效转层开始计时，**六个面各自同色**才算完成；只还原顶面、十字或局部不算通关。
- **“重试”回到本关相同的初始局面**，清除本次计时与步数，不会自动还原为六面同色；已保存的教学进度不受影响。
- 可选“历史提示”按操作历史回溯，以小手示范滑动；请求提示即视为使用辅助，本次完成后标记为“提示通关”，不保证最优解。普通静态手势提示只说明操作方式。
- 完成后按关卡保存本机教学进度，区分独立通关与提示通关；与普通计时成绩分开，不增加普通成绩记录。未完成局面不保存。
- 参考步数按 **90° 转动次数**计算，180° 算两次；它不是最少步数，也不是通关上限，不限制还原步数或用时。

### 行为边界与原版差异

- **不是通用魔方求解器。**“历史提示”消除相邻互逆操作后逆向回放本局操作，包含打乱和玩家操作；它不是最短公式。使用提示后本局只作为练习，不计入成绩。
- **复位逐步播放还原动画**：确认后按本局历史（包含打乱与玩家操作）逆序逐层转回六面同色，遵循动画速度设置；清除计时与步数，不记成绩。动画期间禁止重复复位或转层，仍可旋转视角；已完成的魔方直接清理本局，不播放多余动作。这是历史回溯，不是通用求解器或最短解法。
- 入门教程使用固定五手外层序列，再按逆序用小手示范滑动，不记成绩；原版为随机五手。教程与历史提示以约 1.8 秒循环演示按下、滑动、松开淡出；教程仅显示移动的小手，不显示轨迹线、起终点或光圈，历史提示保留轨迹；触摸时隐藏示范，结束后从起点重播。看不到小手时拖动空白或双指转动视角。
- 普通游玩在可视面的四角方块显示静态手势提示，可在游戏页或偏好设置中关闭；中间方块仍可滑动。该提示仅说明操作方式，不影响计时或成绩资格。
- 选轴参照 Android 的 `axis × faceNormal` 投影，要求匹配分 ≥0.75 且领先次选 ≥0.15。忙碌时单指触碰魔方不触发新操作，背景或双指仍能旋转视角。
- 视角拖动方向与 Android 对齐，但本版仍使用 yaw/pitch 并限制俯仰 ±1.45rad，不是原版的无限旋转矩阵。
- 打乱长度沿用 11 / 25 / 45 / 65 个动画动作；本版每个动作都是 ±90°，不含单独的 180° 动作，因此不承诺与原版随机分布一致。
- 撤销立即落地，不播放转层动画；`moveCount` 为当前未撤销的用户操作数量。
- Canvas 使用面深度排序，不是 Filament 的逐像素深度缓冲。逻辑与动画几何有自动化测试，复杂遮挡和低端设备性能仍应真机验收。
- 不保存进行中的局面，退出或进程结束会丢弃本局；已完成成绩与设置持久化。
- 本机成绩容量为 200 条，因此“最佳”也是保留记录内的最佳，不是无限历史纪录。

## 已验证结果

2026-10-24 手机应用转换验证：Debug / Release 编译、打包与本地签名成功；290 项 Node 自动化测试、420 项离线手势坐标检查及 1,381 项 Release 混淆核验通过。已解包核对签名与未签名 Release HAP：`bundleType=app`、`installationFree=false`、`deviceTypes=["phone"]`，签名包与未签名包字节码一致。本次未连接 HarmonyOS 设备，未验证安装、桌面启动、视觉布局、原地升级或正式应用分发；历史设备结果不能替代本次验收。

此前纯手势版本的验证记录见 [verification/gestures/RESULTS.md](verification/gestures/RESULTS.md)：Debug / Release 构建成功，211 项自动化测试与420项离线箭头坐标检查通过，Release 在 HarmonyOS API 24 模拟器上的92项交互检查通过。这份历史报告不覆盖后续的四角手势、小手滑动示范与首页标语调整；新界面仍需设备验收。此前按钮版报告保留在 `verification/RESULTS.md`，同样不代表当前界面。

## 开发环境

本机验证环境：

- Windows，DevEco Studio **6.1.1.300**。
- 编译 / target：HarmonyOS **6.1.1 / API 24**。
- 当前工程 compatible：HarmonyOS **6.1.1 / API 24**（保留现有工程配置）。
- 构建使用 DevEco 自带 Node、Hvigor、JBR；逻辑测试使用 **Node.js 24**。
- 手机应用配置：`AppScope/app.json5` 的 `bundleType: app`；`entry/src/main/module.json5` 的 `installationFree: false`、`deliveryWithInstall: true`、`deviceTypes: ["phone"]`，保留桌面启动入口。
- 包名为 `com.razor.filament.cube`（以 `AppScope/app.json5` 为准）。本地 `keystore/` 下的调试与发布 Profile 均绑定旧包名，需在 AppGallery Connect 按新包名重新生成并替换后才能签名安装。
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

### Release 混淆与核验

Release 已在 `entry/build-profile.json5` 启用混淆，规则见 `entry/obfuscation-rules.txt`：混淆局部变量、参数、顶层与导出名称，精确保留 `EntryAbility` 和 `Index` 入口；Debug 不启用这些规则。为保持旧设置、成绩 JSON 和 ArkUI 字符串回调兼容，暂不混淆属性名，也不混淆文件名和页面路径。

```powershell
.\scripts\build.ps1 -Mode release
node --unhandled-rejections=strict scripts/verify-release-obfuscation.mjs
```

核验脚本使用 Node.js 24、PowerShell 和 SDK 的 `ark_disasm.exe`，检查最终 HAP 的 Release 标记、真实字节码导出名称、入口、包内敏感文件及已存在的签名包字节码一致性；并执行混淆后的中间代码，验证模型、跨模块渲染与旧数据读写兼容。Preferences 和 Canvas 使用 mock，不操作设备，不代表真机或上架验收。非默认 DevEco 安装位置需同时设置 `$env:DEVECO_HOME`；仅构建时的 `-DevEcoHome` 参数不会传递给独立核验命令。请在 Release 构建后立即核验，Debug 构建会覆盖同名 HAP，核验脚本会拒绝 Debug 包。

混淆映射及源码映射仅保留在本地被忽略的构建目录（如 `entry/build/default/outputs/default/symbol/release/entry-nameCache.json`），用于故障定位，不应随 HAP 分发或公开。验证结果与边界见 [verification/release-obfuscation/RESULTS.md](verification/release-obfuscation/RESULTS.md)。混淆只能提高逆向成本，业务方法名、数据字段、文件路径及部分字符串仍然可见。

仓库仅同步源码、测试、构建脚本与 Markdown 验证报告。`dist/` 安装包、校验文件，以及 `verification/` 下的截图、布局 JSON 和日志均为本地生成产物，已加入 `.gitignore`，需要时重新构建或运行测试生成。

默认产物：

```text
entry/build/default/outputs/default/entry-default-unsigned.hap
```

本工程已有 Debug / Release 签名配置，构建会生成未签名包，并在本机签名材料可用时生成 `entry-default-signed.hap`。本次转换保留本地 `build-profile.json5`，不提交其中的本机路径与口令。仓库历史中已有签名材料，不能视为无敏感信息的公开模板；不要继续提交或公开本地口令与备份。

当前包名为 `com.razor.filament.cube`，以 `AppScope/app.json5` 为准。真机分发和上架需确认 AppGallery Connect 项目对应 **HarmonyOS 应用**，且证书 / Profile 授权该包名与测试设备；不能仅因本地签名成功就认定 Profile 可用于应用发布。本地 API 24 模拟器曾接受未签名调试包，这不代表真机也能接受。包名变更后新包与旧包是不同应用，无法原地升级，也不会继承旧版本的本地成绩。

## 中英文界面

界面随系统 / 应用语言显示：默认资源为中文，`en` 提供通用英文，`en_US` 提供美国英语，其他英语区域（例如 en-GB）使用通用英文。应用名的英文为 **Cool Cube**。未匹配到语言资源时仍按中文默认资源回退。

首页、游戏、统计、设置、确认弹窗、教程与历史提示、错误提示和无障碍标签均使用字符串资源。系统语言配置更新会清除文案缓存，并重新生成当前教程 / 历史提示及存储警告；不重置游戏或修改本地成绩。中英文资源使用相同的 key 与位置占位符（如 `%1$d`、`%2$s`）。

`tests/cube-localization.test.mjs` 检查资源 key、占位符、英文中文残留和语言切换；设备冒烟脚本支持 `SMOKE_LOCALE=en-US` / `en-GB`，该选项只选择断言语言，不修改设备语言；运行前应先将专用测试设备设为对应语言。已在 HUAWEI 畅享 90 Plus（JUY-AL50，HarmonyOS 7.0.0.109，1080×2406）完成英文主流程布局验收，并修复应用存活期间切换语言时页头不刷新的问题；大字体、折叠屏与平板仍待验收。完整验证结果见 [verification/LOCALIZATION.md](verification/LOCALIZATION.md)。

## 自动化测试

纯逻辑 / 渲染几何 / 持久化测试不需要模拟器和 npm 安装：

```powershell
node --unhandled-rejections=strict --test tests/*.test.mjs
```

- `cube-model.test.mjs`：各阶各轴各层正逆转、四次复原、整数坐标、整体旋转完成判定、打乱、历史提示收敛、撤销重做与非法输入。
- `cube-renderer.test.mjs`：2–7 阶、35 个视角、1,296 个动画帧；验证 Android 切向选轴、歧义拒绝、缝隙命中、2,612 个滑动指引回代、四角提示分布、小手滑动与淡出、画布边界及动画末态一致性。
- `cube-store.test.mjs`：损坏数据、安全验证、异步写入顺序、错误传播、记录裁剪及恢复。
- `cube-feedback.test.mjs`：音频与振动能力独立、准备超时、释放期间迟到资源回收、音效不排队。
- `cube-touch.test.mjs`：直接提取实际页面触摸方法，验证 Harmony 抬手事件、多指切换、取消、阈值及忙碌保护。
- `cube-game.test.mjs`：直接提取页面游戏流程，验证计时、动画提交、真实模型完成后保存成绩、辅助/教程不记榜、小手循环与暂停、后台保护及跨局异步回调隔离。
- `cube-smoke.test.mjs`：验证设备冒烟脚本能从实际教程文案识别步骤与转面，不连接设备。

测试对 `.ets` 文件使用 Node 内置 `stripTypeScriptTypes` 和平台 mock；实验性 API 警告正常。它不替代实际 ArkTS 编译或设备测试。

### 本地模拟器

```powershell
$hdc = 'C:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe'
& $hdc list targets
& $hdc -t 127.0.0.1:5633 install -r entry/build/default/outputs/default/entry-default-unsigned.hap
& $hdc -t 127.0.0.1:5633 shell aa start -a EntryAbility -b com.razor.filament.cube
```

不要在有多个设备时省略 `-t`，避免误操作其他真机。`scripts/smoke.mjs` 使用 HDC / UI Test 对已安装手机应用进行界面冒烟测试，默认仅连接 `127.0.0.1:5633`；可用 `HDC_TARGET` 指定专用测试设备。它会重新启动本应用并操作测试局与偏好设置，不应对正在使用的个人会话运行。运行生成的截图、布局和结果默认保存在本地 `verification/gestures/`，可用 `SMOKE_OUT` 指定其他目录；这些产物不纳入 Git。测试脚本从 `AppScope/app.json5` 读取当前包名。运行前请按 `hdc list targets` 设置实际设备，例如 `$env:HDC_TARGET='127.0.0.1:5559'`，再执行 `node scripts/smoke.mjs`。

## 结构

```text
AppScope/                         手机应用身份与图标
entry/src/main/module.json5        应用入口、手机设备和权限
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

- 在符合当前 compatible API 24 的实体手机上验证安装、桌面图标启动、前后台切换和平台 API。
- 真机音量、静音策略、振动反馈，以及低端机 5 阶动画性能。
- 大字体、小屏与折叠屏手机窗口适配；当前设备声明仅包含手机，不声明平板支持。
- 正式应用签名、原元服务升级兼容性、AppGallery 应用审核与分发。
