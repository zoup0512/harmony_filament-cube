# “还原提示”小手首显延迟：真机排查与修复

日期：2026-10-28

## 结论

已在真机复现点击后小手数秒才出现的问题，并通过相同局面的有缓存/无缓存对照定位到：`getSwipeGuide()` 在 UI 线程每约 16ms 被重复执行，而一次路径搜索已经超过这个时间预算，定时器回调持续占用 UI 线程，延迟了 ArkUI 的绘制处理。

最终修复只给渲染器增加当前稳定画面的提示路径缓存。魔方、视角、缩放、画布尺寸等导致重绘时清除缓存；目标动作改变时重新搜索；已有模型有效性检查仍在缓存命中之前执行。保留双 Canvas 分层、动画周期和重复点击不重启的既有行为，没有通过重绘魔方本体掩盖问题。

此前将 288ms 起点停留作为可能解释不适用于本次问题。起点停留发生在小手已经显示之后；本次真机证据确认是显示之前的绘制调度延迟。

## 环境与保护措施

- 设备型号：JUY-AL50，系统报告 `OpenHarmony-7.0.0.105`。
- HDC：通过局域网无线连接真机；设备地址不纳入版本记录。
- 应用：`com.razor.filament.cube`。
- 使用现有签名配置构建、覆盖安装 Release，未卸载、未清空应用数据或成绩。
- 工作开始时仓库已有大量未提交改动，全部保留。临时埋点移除后 `Index.ets` 与本轮开始时的备份 SHA-256 完全一致：`dae39d4c628d50df5e5c18f9fc025f6a4ac4c0179348574d295a056c6938f9a2`。
- 原安装包在设备上的文件不可读，不能直接证明它与本地旧包一致。A/B 比较均重新构建并明确安装，所以不依赖这个假设。

## 同局面对照测量

方法：从已还原魔方执行一次 R 层转动，默认视角，点击“还原提示”；两版使用同样的临时分段日志与 Canvas 组件绘制观察器。有缓存和无缓存的唯一功能差异是 `getSwipeGuide()` 的缓存命中分支。

| 指标 | 三阶无缓存 | 三阶有缓存 | 五阶无缓存 | 五阶有缓存 |
| --- | ---: | ---: | ---: | ---: |
| 点击处理返回 | 42ms | 44ms | 80ms | 83ms |
| 初次路径搜索 | 37ms | 39ms | 77ms | 76ms |
| 随后的稳定帧路径搜索 | 34–37ms | 0ms（毫秒精度） | 71–77ms | 0ms（毫秒精度） |
| 点击到组件 `draw` 回调 | 2703ms | 89ms | 2877ms | 170ms |

五阶再次操作后请求新提示：组件回调 158ms；同值重复点击时下一次组件回调 10ms。后者只是正在运行的动画继续绘制，不表示点击重新启动动画。

**测量边界：**组件 `draw` 回调不是显示面板像素呈现时间。表中的时间都以应用内 `onClick` 入口为起点，不含 HDC 注入与触摸事件分发。屏幕截图使用同一设备时钟记录捕获区间，间隔约 0.25–0.4 秒，不是逐显示帧录像；只能给出可见结果的采样上界，不能把截图结束时间当作精确首帧时间。

### 原始证据

以下截图、采样信息、日志、包指纹及临时诊断补丁均保留在本地，不纳入 Git；相对链接仅供原验证工作区复查，远端仓库不包含这些附件。报告中的通过数与测量结果来自当时的验证记录，本次归档未重新运行设备测试。

[同局面修复前后画面对照](before-after.jpg)。左右截图的采样时间不同，图中已标注，不能当作同步录像。

- [三阶无缓存日志](uncached-deterministic-3/probe.log)、[采样信息](uncached-deterministic-3/measurement.json)、[连续画面](uncached-deterministic-3/contact.jpg)
- [三阶有缓存日志](cached-deterministic-3/probe.log)、[采样信息](cached-deterministic-3/measurement.json)、[连续画面](cached-deterministic-3/contact.jpg)
- [五阶无缓存日志](uncached-deterministic-5/probe.log)、[采样信息](uncached-deterministic-5/measurement.json)
- [五阶有缓存日志](cached-deterministic-5/probe.log)、[采样信息](cached-deterministic-5/measurement.json)、[连续画面](cached-deterministic-5/contact.jpg)
- [五阶新提示复测](cached-five-repeat/measurement.json)、[同值提示重复点击](cached-five-same-hint/measurement.json)
- [临时埋点补丁](diagnostic-instrumentation.patch)、[A/B 包指纹](probe-package-hashes.json)

## 正式包复测

临时埋点与观察器已全部移除，重新构建并安装正式 Release 后，三阶和五阶都重新执行单次转动及首次提示操作。两种阶数均在点击注入结束后的第一张完整采样画面中显示小手：

- 三阶：该截图区间为注入结束后 25–250ms，[画面](final-3/2.jpeg)、[连续画面](final-3/contact.jpg)、[原始采样](final-3/measurement.json)。
- 五阶：该截图区间为注入结束后 30–260ms，[画面](final-5/2.jpeg)、[连续画面](final-5/contact.jpg)、[原始采样](final-5/measurement.json)。

以上是采样证据，不声称首显精确发生在 250ms 或 260ms。两组正式包日志均无 `CubeHintProbe` 输出。

## 自动化回归

- Node 最终全量测试：481/481 通过，0 失败、0 跳过，含新增 5 组缓存回归和冒烟基线回归。[最终日志](tests-final.log)（修正冒烟基线前的 480 项运行另见 [日志](tests.log)）。
- 新增回归验证同值目标不重复执行真实几何搜索，目标变化、视角/缩放/尺寸重绘、模型转动/reset/阶数变化正确失效，动画/非法参数/陈旧几何继续拒绝，以及 null 结果复用。
- 无缓存对照期间 4 组新测试因重复搜索失败；恢复缓存后全部通过，证明测试能抓到原问题。
- Release 构建、打包、签名成功。[日志](build.log)
- Release 混淆后执行校验：1440 项通过，signed/unsigned 字节码一致。
- 离线手势检查：1920 项真实渲染器手势通过，含像素量化。[检查日志](release-checks.log)

## 真机功能回归过程

1. 全量第一轮在教程阶段出现无线 HDC 断连，日志明确报 `Device not found or connected`，36 项此前通过；该轮中止，不作为应用全通过结论。重新 `hdc tconn` 后连接恢复。
2. 全量重跑完成：119 项通过，1 项旧脚本断言失败；成绩未清空，退出回到首页。[完整结果](smoke-reconnected/summary.json)
3. 失败来自 `hint-repeat-stability` 的比较基线错误：首次提示前 Canvas bounds 为 `[54,578][1026,1862]`，提示文字出现后为 `[54,568][1026,1852]`，尺寸均为 `972×1284`。脚本却用首次提示前的 bounds 判断重复点击是否移动。首次提示显示后的截图及 12 次重复后的截图，两个 Canvas 的 bounds 相同，魔方区域除小手动画外像素一致。
4. 独立复测以提示已显示的布局作基线，12 次点击全部保持 base/guidance 为 `[54,568][1026,1852]`。[逐次记录](stable-repeat-results.json)。独立采样也直接确认首次提示前 `[54,578][1026,1862]`、首次提示后 `[54,568][1026,1852]`，不是推测：[首次提示前](stable-first.json)、[重复基线](stable-repeat-baseline.json)、[第 12 次](stable-repeat-12.json)。

5. 修正脚本后在同一正式安装包上单独重跑完整 `hint-repeat-stability` 用例：21 项通过、0 失败，包含 12 次重复、严格 bounds 不变、双画布对齐、撤销和退出恢复；最终停留首页，默认阶数为 3。[最终定向结果](smoke-hint-final/summary.json)、[运行日志](smoke-hint-final.log)。

最终覆盖结论：其余功能由全量重跑的通过项覆盖，唯一失败用例修正基线后已完整重跑通过；这是“全量运行 + 定向补验”的闭环，不宣称最后有一轮单次全量全绿。

## 最终产物

已安装：`entry/build/default/outputs/default/entry-default-signed.hap`。

SHA-256：`4fe317828121ddef14be770a912ca39c7884a16df434cb3feda0b32fc7929fa4`。

[安装结果](final-install.log)、[包信息](final-package.json)。

本轮永久代码改动：`CubeRenderer.ets` 增加 10 行缓存逻辑，`tests/cube-renderer.test.mjs` 增加 5 组回归测试；另外修正 `scripts/smoke.mjs` 的重复提示布局基线，并在 `tests/cube-smoke.test.mjs` 增加执行真实用例片段的回归，确保重复后位移、1px 尺寸变化和 overlay 漂移仍会失败。没有提交或推送 Git。
