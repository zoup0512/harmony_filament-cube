# Release 混淆验证

日期：2026-10-23。结论：Release 混淆已开启，实际 HAP 字节码确认生效；本次未执行设备安装、界面交互或上架验证。

## 配置

- `entry/build-profile.json5`：仅 Release 的 `arkOptions.obfuscation.ruleOptions.enable` 为 `true`，加载 `./obfuscation-rules.txt`。
- 局部变量、参数采用 ArkGuard 默认混淆；增加 `-enable-toplevel-obfuscation` 与 `-enable-export-obfuscation`。
- `-keep-global-name` 精确保留 `EntryAbility`、`Index`。
- 未开启属性名、字符串属性名、文件名混淆；没有全目录保留规则，也未保留所有业务类名。
- 这样保留 Preferences JSON 字段、`@Watch('onForegroundChanged')` 等字符串回调与页面路径。混淆不等于加密，业务方法名、字段、路径和部分字符串仍可分析。

## 环境与方法

Windows；Node.js 24.11.0；项目现有 DevEco Studio / SDK / Hvigor / JBR；HarmonyOS API 24。

先使用原始关闭混淆的配置构建 Release 对照，再启用上述规则构建 Release。从实际 HAP 解出 `ets/modules.abc`，使用 SDK 自带 `ark_disasm.exe` 检查真实导出表和跨模块导入，而不是仅搜索原名是否完全消失。未启用文件名混淆，因此模块路径中的 `CubeModel` 等文字仍会保留，部分错误提示也会保留原名。

同时执行 `scripts/verify-release-obfuscation.mjs`：通过真实 nameCache 解析重命名结果，加载混淆后的编译中间 TypeScript，执行模型、渲染与持久化兼容检查。只替换平台 Preferences 导入与 Canvas 绘制接口，不把原始业务实现复制到测试中。

## 结果

| 项目 | 结果 |
| --- | --- |
| 未混淆 Release 对照构建 | 成功，包内 `app.debug: false` |
| 启用混淆的 Release 构建 | 成功 |
| Debug 构建 | 成功，未应用 Release 规则 |
| 核验脚本拒绝 Debug HAP | 通过，报错 `HAP must be a non-debug Release` |
| 最终重新构建 Release | 成功，最终同名输出为 Release |
| 配置回归测试 | 3 项通过，包含在全量测试中 |
| 最终全量 Node 测试 | 270 项通过，0 失败、0 跳过 |
| 混淆产物检查 | 1,381 项检查通过；包含 420 个像素量化后的手势指引回代 |
| 原始业务代码离线手势检查 | 420 项通过，无设备命令 |
| 签名包与未签名包 | 两者包含相同的混淆 ABC；不等于验证正式分发证书 |
| 包内容 | 未发现源文件、源码映射、nameCache、混淆规则或所检查扩展名的私钥文件 |
| 格式与脚本语法检查 | `git diff --check` 与新增脚本 `node --check` 通过 |

修改配置前的最初测试基线有 8 项失败，原因是工作区小手引导改动与原测试预期不一致。任务期间其他并行工作更新了相关测试；本次混淆任务未修改页面、渲染器、原有测试或设备冒烟脚本。最终按当前工作区重新运行全量测试，结果为上述 270 项全部通过。

### 最终 ABC 导出名称

| 原名称 | 本次实际输出名称 |
| --- | --- |
| CubeModel | l |
| CubeMove | i |
| CubeRenderer | c3 |
| CubeStore | d3 |
| CubeSettings | e3 |
| SolveRecord | f3 |
| CubeFeedback | g3 |

这些名称在最终字节码的 `LOCAL_EXPORT` 表中以新名称出现，原名称不再作为对应导出存在；其他模块使用对应新名称导入。名称可能随后续构建变化，核验脚本从本次 nameCache 动态读取，不写死映射。

`EntryAbility` 默认导出保持不变；`main_pages` 保持 `pages/Index`。以下九个持久化字段及 `onForegroundChanged` 运行时名称保持不变：

```text
defaultOrder speed sound haptics beginnerGuides order durationMs moves date
```

### 执行混淆后代码的覆盖范围

- 模型：2–7 阶、每轴每层正负转动、逆操作精确复原、四次转动精确复原，以及真实打乱后的历史逆向回放。
- 渲染：实际混淆模块间导入，2–5 阶、三种画布大小、五种像素密度、七个外层动作，共 420 个像素量化后的指引回代。
- 存储：读取不含 `beginnerGuides` 的旧设置，以及明确关闭该设置的新格式；读取旧成绩、保存设置、添加新成绩、重新创建 Store 后读取，确认 JSON 字段和数据不变。

## 最终产物指纹

最终重新构建的未签名 HAP：

```text
entry/build/default/outputs/default/entry-default-unsigned.hap
SHA-256: 6799933dfdc527c9390a4fce2d4b9b05ad08c791427860c7ad3af3df2c264374
```

最终 HAP 内 `ets/modules.abc`：

```text
大小: 143460 bytes
SHA-256: aca5bfc47b307495e4ee606afe0f97a388bbce213e7924ee63ada36a1699b02b
```

未混淆对照 ABC 大小为 144020 bytes。这里以真实符号重命名为混淆证据，不以包体缩小作为判断依据。HAP 含构建元数据，重建后 HAP 哈希可能变化。

本机配置同时产生 `entry-default-signed.hap`；本次仅核对其中 ABC 与未签名包一致，未审查或输出签名凭据，也未修改根签名配置。

## 复现

```powershell
.\scripts\build.ps1 -Mode release
node --unhandled-rejections=strict scripts/verify-release-obfuscation.mjs
node --unhandled-rejections=strict --test tests/*.test.mjs
node scripts/smoke.mjs --check-gestures
```

非默认 DevEco 安装目录：构建使用 `-DevEcoHome`，核验命令使用环境变量 `DEVECO_HOME`。Debug 构建会覆盖同名 HAP，必须重新构建 Release 后再核验。

源码映射与 nameCache 仅位于被 Git 忽略的本地构建目录，不应公开分发。对照字节码和反汇编证据保存在被忽略的 `.local/obfuscation-verification/`，报告不包含完整映射或敏感签名信息。

## 验证边界

- 执行的是实际混淆中间 TypeScript，不是 HarmonyOS 设备上的 ABC；Canvas 和 Preferences 使用 mock，因此不能替代系统生命周期、页面加载和真实 Preferences 的设备验证。
- 未发现已确认的专用测试模拟器；未操作现有网络连接设备，未安装、重启或清空任何设备应用数据。
- 未验证正式证书资格、AppGallery 分发与审核，也没有执行防篡改或攻击验证。
- 启用属性混淆需要另行保留持久化字段和字符串回调并重新做兼容测试；当前方案有意不启用。
