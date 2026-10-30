# Agent notes

## Verify
- Node tests (no device): `node --unhandled-rejections=strict --test tests/*.test.mjs`
- Debug build: `.\scripts\build.ps1` (PowerShell). Release + obfuscation check:
  `.\scripts\build.ps1 -Mode release; node --unhandled-rejections=strict scripts/verify-release-obfuscation.mjs`
- hvigor wipes `build/` at the repo root; keep scratch files elsewhere (e.g. `$env:TEMP`).

## Device
- hdc: `C:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe`; always pass `-t <target>`.
- Install with `install -r entry/build/default/outputs/default/entry-default-signed.hap` (keeps app data).
  A "version downgrade" error means `AppScope/app.json5` versionCode is below the installed one.
- Screenshots: `shell snapshot_display -f /data/local/tmp/s.jpeg` then `file recv`. Layout: `shell uitest dumpLayout -p ...`.
- Taps: `shell uitest uiInput click X Y` (px); swipes: `uitest uiInput swipe x1 y1 x2 y2 <speed>`.

## Conventions
- Game logic stays in `pages/Index.ets`; tests extract its methods and field initializers verbatim
  (`tests/cube-game.test.mjs`, `tests/cube-touch.test.mjs`). New VM globals used by Index fields need mocks there.
- `components/*` are presentational: data via `@Prop` view models, actions via callbacks, labels via `$r`.
- Colors only through `CubeTheme` (resources in `base/` and `dark/` color.json must share keys); fonts >= 12fp.
- Do not use `Circle/Rect` shapes with resource colors (API 26 only; app is compatible with API 24).
- en and en_US string tables must stay identical; visible copy must avoid "game/play" wording (localization test).
