# 纯滑动控制验证（2026-10-22）

> 历史验证报告。仓库清理后，文中引用的安装包、截图、布局 JSON 与日志不再纳入 Git；以下文件名和统计保留为历史记录，需要时重新运行构建和测试生成。当前包名以 `AppScope/app.json5` 为准，共享构建配置已移除本机签名材料。

## 本次变更

- 移除 U/D/L/R/F/B 共12个正反转按钮与“转面控制”区，扩大魔方画布；保留现有浅色主题及其他操作。
- 对照 Android CubeGestureMapper/CubeTouchController：外盒射线拾取（包含块缝）、axis×faceNormal 行列方向、score≥0.75 且领先次优≥0.15；滑动≥24vp后松手转90°。
- 修正视角拖动方向，8vp防抖，剩余多指以质心重新设基准；动画忙时表面单指BLOCKED，背景和双指仍可转视角。
- 取消/后台后不从孤立Move重新开启手势；模型/尺寸/视角等变化使旧层手势失效；Canvas触摸期间拒绝外层Scroll内置Pan，避免垂直滑动被页面滚动抢占。
- 教程和历史提示在可见贴纸上绘制起点圆和方向箭头。箭头由正式拾取算法回验；目标不可见时提示转视角。教程必须实际滑动完成，不再依赖按钮。

## 验证结果

- Debug、Release 完整ArkTS编译与HAP打包成功。
- `node --unhandled-rejections=strict --test tests/*.test.mjs`：**211通过、0失败、0跳过**。包含58项真实触摸状态机测试、23项renderer测试、34项游戏流程与8项UI防回归测试。
- `node scripts/smoke.mjs --check-gestures`：**420项**真实renderer箭头与像素坐标取整校验通过。
- Debug与最终Release均在本地HarmonyOS API24模拟器 `127.0.0.1:5559` 安装运行；最终Release **92项界面断言通过、0失败、0跳过**。
- 设备验证覆盖2/3/4/5阶真实滑转与撤销、无转面按钮、五步教程（含每步错误手势拒绝）、背景拖动不计步、打乱后首滑启动计时、提示、返回确认及默认阶数重启持久化。
- 完成后停在首页，恢复默认3阶，未清空成绩。

证据：`summary.json`（最终Release）、`unit-tests.txt`、`build-debug.txt`、`build-release.txt`，以及本目录的PNG/JSON。

## 交付

- `dist/razor-cube-gestures-debug-unsigned.hap`：361,145 bytes。
- `dist/razor-cube-gestures-release-unsigned.hap`：141,512 bytes。
- 校验：`dist/gestures-checksums.json`。
- 不带gestures的旧HAP没有本次改动；未覆盖或调整已有签名配置。

## 边界

本次保留工程已有 compatible API24 和浅色主题。视角仍为yaw/pitch、俯仰限制±1.45rad，非Android无限旋转矩阵。双指/三指状态机由真实生产方法自动化测试覆盖，设备端注入验收为单指；实体设备多指手感、音效振动、低端性能、签名与上架尚未验证。包仍未签名。
