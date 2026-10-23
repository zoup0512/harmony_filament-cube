# 中英文支持验证

验证日期：2026-10-23。

## 实现范围

- 中文默认资源保持在 `base`，新增完整通用英语 `en`，同步 `en_US`。
- AppScope 应用名与 entry Ability 标签提供英语名称 Cool Cube。
- 102 个页面文案资源覆盖首页、游戏、统计、设置、确认弹窗、教程、历史提示、错误提示、无障碍标签；entry 每套资源共 105 个 key（含原有 3 个元数据 key）。
- 页面通过 ResourceManager 同步字符串接口读取资源，使用位置占位符传入阶数、步骤、转动标签等参数。
- Ability 配置变化通知页面失效缓存并更新已有教程、历史提示及存储警告，不重置游戏局面。
- 扩宽游戏手势提示按钮，为设置说明和最近成绩标题增加弹性布局。
- 设备冒烟脚本支持 `SMOKE_LOCALE=zh-CN`（默认）、`en`、`en-US`、`en-GB`。该变量只选择预期文案，不改变系统语言。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `node --unhandled-rejections=strict --test tests/*.test.mjs` | 286 项通过，0 项失败 |
| 其中 `tests/cube-localization.test.mjs` | 9 项通过：资源完整性、英文中文残留、占位符、实际页面语言刷新与缓存等 |
| `powershell -File scripts/build.ps1 -Mode debug` | 成功 |
| `powershell -File scripts/build.ps1 -Mode release` | 成功 |
| `node --unhandled-rejections=strict scripts/verify-release-obfuscation.mjs` | 1,381 项检查通过，已签名包字节码与未签名包一致 |
| SDK `restool dump config` 检查最终 Release HAP | `base`、`en`、`en_US` 均已打包 |
| `node --check scripts/smoke.mjs` | 通过 |
| `git diff --check` | 通过 |

## 真机英文布局验收

设备为 HUAWEI 畅享 90 Plus（JUY-AL50），HarmonyOS 7.0.0.109(SP6C00E105R2P3)，1080×2406，安装签名的 Release HAP。系统语言切换到 English（地区仍为中国），英语界面正常显示；`en` 与 `en_US` 当前内容一致，因此无法仅凭界面区分实际命中的目录。

逐页检查并截图：英文首页、游戏自由练习、五步教程及长步骤提示、返回首页确认弹窗、统计页顶部与底部、设置页顶部与底部。英文文案均完整显示，没有截断、重叠或按钮溢出；较长的教程提示和弹窗说明能正常换行，统计阶数卡片、游戏操作按钮和设置说明保持可用。截图保存在本地 `verification/device-en/`（被 Git 忽略）。

验收中发现：应用进程存活期间切换系统语言时，设置页正文会更新，但页头仍显示旧的 “Settings”。原因是页面标题先在调用处翻译，再作为 `@Builder` 参数传入，参数被缓存。修复为传入资源 key、在 `@Builder` 内调用 `tr`，并补充源码回归断言。修复后重新构建安装，实测应用在后台时从英文切回中文，设置页标题更新为“偏好设置”，统计页标题和标语更新为“成绩统计 / 每一秒，都是新突破。”，不需要重启应用。测试设备最后已恢复中文。

## 边界

本次真机验收只覆盖当前设备的默认字体、竖屏和系统英文；en-US / en-GB 的 ResourceManager 匹配在自动化测试中覆盖，未分别切换系统区域验收。大字体、横屏、折叠屏、平板和低端机性能仍需另行验收。自动化测试和构建结果不等同于完整的真机视觉验收。

保留中文默认回退策略：未支持的其他语言不会自动变为英语。英文应用名称为 Cool Cube；中文首页显示“酷比魔方”，英文首页显示 COOL CUBE。
