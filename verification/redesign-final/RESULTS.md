# Razor Cube 移动端视觉重设计

> 历史验证报告。2026-10-22 仓库清理后，文中引用的安装包、截图、布局 JSON 与日志不再纳入 Git；以下文件名和统计保留为历史记录，需要时重新运行构建和测试生成。

验证日期：2026-10-22

## 设计与实现

- 原生 ArkUI 界面，无新增第三方依赖或网络权限。
- 暖白背景、深墨绿文字、薄荷色场景与青柠色主操作，集中在 `entry/src/main/ets/pages/CubeTheme.ets` 管理。
- 首页：品牌标识、左对齐标题、交互魔方展示卡、阶数选择、主按钮和图标快捷入口。
- 游戏：深色计时卡、魔方场景、独立转面控制面板、教程高亮与提示卡。支持按可用高度调整场景及页面滚动，魔方触摸期间抑制父级滚动。
- 成绩：本机保存的挑战数、各阶完成次数及最佳用时、最近记录、空状态引导。
- 设置：默认阶数、速度、声音/触感分组、品牌介绍及记号说明。
- 同步启动页和系统栏配色，所有页面头部为原子化服务胶囊保留空间。
- 未修改魔方模型、渲染几何、计时/教程流程或存储格式。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| Node 单元与回归测试 | 145 通过，0 失败 |
| Debug ArkTS 构建 | 通过 |
| 最终 Release ArkTS 构建 | 通过 |
| HarmonyOS Pura90 API 24 模拟器安装 | 最终未签名 Release 安装成功 |
| UI 自动化 | 58 通过，0 失败，0 跳过 |
| Git diff 空白检查 | 通过 |

实际设备目标为 `127.0.0.1:5559`。测试覆盖 2/3/4/5 阶入口、五步教程及错误输入、自由转动/撤销、Canvas 表面滑动、打乱与首步计时、辅助提示、退出确认、成绩空状态、设置显示及默认阶数重启持久化。测试结束恢复默认 3 阶并返回首页，未清空成绩，未更改音效、触感或速度设置。

已查看最终首页、游戏、教程、成绩及设置截图；修复了首轮发现的逆时针按钮文字截断和圆角覆盖问题。首轮自动化因入口改为图标+文字组合按钮而无法匹配旧选择器；测试现在在真实 Button 子树内匹配可见文字，最终全套通过。首轮证据保留在 `verification/redesign/`，最终证据以本目录为准。

## 截图与日志

- 首页：`01-home-initial.png`
- 三阶游戏：`05-game-3.png`
- 教程：`06-tutorial-step-1.png`
- 成绩：`20-statistics-empty.png`
- 设置：`21-settings-order-speed.png`
- UI 详细结果及操作记录：`summary.json`
- 145 项测试输出：`unit-tests.txt`

成绩和设置页面为可滚动页面，首屏截图不展示全部内容。

## 复现

```powershell
node --unhandled-rejections=strict --test tests/*.test.mjs
.\scripts\build.ps1
.\scripts\build.ps1 -Mode release
$env:HDC_TARGET = '127.0.0.1:5559'
$env:SMOKE_OUT = 'verification/redesign-final'
node scripts/smoke.mjs
```

运行 UI 测试前应先安装最新构建，并用 `hdc list targets` 确认当前设备地址。`SMOKE_OUT` 为新增可选参数，省略时仍使用原 `verification/ui` 目录。

## 边界

- 本次 UI 验证使用一个 HarmonyOS 手机模拟器；未声称完成物理设备、平板、多字号和所有屏幕尺寸验证。
- 未新增发布签名配置；HAP 仍为未签名包，真机分发/上架需要签名。Release 构建另提示未启用混淆。
- 现有 `dist/` 历史交付包未覆盖；最新 Release 构建位于 `entry/build/default/outputs/default/entry-default-unsigned.hap`。
