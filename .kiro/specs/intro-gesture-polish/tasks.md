# Implementation Plan: intro-gesture-polish

## Overview

All source changes go into `entry/src/main/ets/components/IntroPage.ets` (ArkTS). No other source
file, resource, or string table changes. The work first moves the demo to the front-facing camera
and adds the adaptive stage height and stale-guide handling. It then restructures the layout into a
`Column` root with a scrolling content area and a fixed Bottom_Bar, moves the badge, and maps the
remaining layout literals to Theme_Tokens. A new dependency-free `node:test` file,
`tests/intro-demo.test.mjs`, covers Properties 1–3 with a seeded PRNG and checks the source shape.
The plan ends by running the full node test suite and the build from AGENTS.md.

## Tasks

- [x] 1. Update the demo camera, stage-height helper, and demo loop in IntroPage.ets
  - [x] 1.1 Add module constants and the `demoStageHeight` helper
    - Extend the theme import to `import { CubeFont, CubeLayout, CubeRadius, CubeSpace, CubeTheme } from '../pages/CubeTheme';`
    - Set `const DEMO_YAW: number = 0.22;` and `const DEMO_PITCH: number = -0.22;` with a comment noting the game camera in Index.ets (0.62 / -0.42) is unchanged; do not edit Index.ets
    - Keep `DEMO_CYCLE_MS`, `DEMO_PRESS_MS`, `DEMO_TRAVEL_MS`, `DEMO_RELEASE_MS`; add `DEMO_STAGE_MIN = 220`, `DEMO_STAGE_MAX = 360`, `DEMO_STAGE_DEFAULT = 300`, `DEMO_STAGE_RATIO = 0.4`, `CONTENT_MAX_WIDTH = 520`
    - Add top-level `export function demoStageHeight(pageHeight: number): number` that returns `DEMO_STAGE_DEFAULT` for non-finite or ≤ 0 input and otherwise `Math.max(DEMO_STAGE_MIN, Math.min(DEMO_STAGE_MAX, Math.round(pageHeight * DEMO_STAGE_RATIO)))`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 5.1, 5.2, 3.7_

  - [x] 1.2 Add `stageHeight` / `demoGuideStale` state and rewrite `demoFrame`
    - Add `@State stageHeight: number = DEMO_STAGE_DEFAULT` and `private demoGuideStale: boolean = true`
    - Keep `demoModel` (`new CubeModel(3)`), `demoRenderer` (`new CubeRenderer()`), `demoBase` (`y` layer 1 and `x` layer 1), `demoMove(index)`, `aboutToAppear` (`setInterval`) and `aboutToDisappear` (`clearInterval`) unchanged
    - Rewrite `demoFrame` per the design: on a cycle change apply the previous move and set `demoGuideStale = true`; when stale, clear the flag, draw a rest frame with `DEMO_YAW, DEMO_PITCH`, and set `this.demoGuide = this.demoRenderer.getSwipeGuide(this.demoMove(cycle))`
    - Compute one `move` and eased `progress`, pass both to the animated `draw(..., DEMO_YAW, DEMO_PITCH, move, progress)` and call `this.drawTouch(t, progress)`
    - Keep the `if (guide === null) { return; }` guard in `drawTouch`; leave its hex stroke/fill colors as they are (out of scope)
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.5, 2.6, 2.7, 5.3, 7.1, 7.3_

- [x] 2. Restructure the IntroPage layout
  - [x] 2.1 Build the `Column` root with Content_Scroll and the fixed Bottom_Bar
    - Root `Column` with `.width('100%').height('100%').alignItems(HorizontalAlign.Center)` and an `onAreaChange` that sets `this.stageHeight = demoStageHeight(Number(area.height))` only when the value changes
    - `Scroll` with `.width('100%').layoutWeight(1).scrollBar(BarState.Off).align(Alignment.Top)` holding the content `Column({ space: CubeSpace.m })` with `constraintSize({ maxWidth: CONTENT_MAX_WIDTH })` and padding `CubeSpace.l` / `CubeSpace.s` / `CubeSpace.m`
    - Content order: brand row, title + subtitle, Demo_Stage, Gesture_Cards column
    - Move the Start_Button out of the Scroll into a Bottom_Bar `Column` after it, with `constraintSize({ maxWidth: CONTENT_MAX_WIDTH })` and the same horizontal padding; no `expandSafeArea`, no own background
    - Keep `Button({ type: ButtonType.Normal })`, `.attributeModifier(CubeButtons.hero).id('intro-start')`, `.accessibilityText($r('app.string.intro_start'))`, the `intro_start` label, the trailing `sys.symbol.arrow_right` glyph, and `.onClick(() => this.onDone())`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 5.1, 6.1, 6.6, 7.2_

  - [x] 2.2 Rework the Demo_Stage: bottom-right badge, adaptive height, Canvas resize handling
    - Change the stage to `Stack({ alignContent: Alignment.BottomEnd })` with `.height(this.stageHeight)`, `CubeRadius.xl`, the `stageStart`→`stageEnd` gradient, `.clip(true)` and `app.string.intro_stage_accessibility`
    - Canvas keeps id `intro-demo-canvas`, `HitTestMode.None`, `accessibilityLevel('no')`, `onReady` / `onDisAppear`; its `onAreaChange` sets `demoWidth`, `demoHeight` and `this.demoGuideStale = true`
    - Badge keeps `app.string.intro_demo_badge`, `CubeTheme.overlay`, `HitTestMode.None`; padding `CubeSpace.xs` / `CubeSpace.xxs`, `.margin({ right: CubeSpace.s, bottom: CubeSpace.s })`, `CubeRadius.m`
    - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.3, 5.4, 7.4_

  - [x] 2.3 Replace `gestureRow` with the `gestureCard` builder and finish the token mapping
    - Add `@Builder private gestureCard(icon: Resource, title: ResourceStr, description: ResourceStr)` per the design: icon tile `CubeLayout.touchTarget` square on `CubeTheme.mint` with `CubeRadius.m`, glyph `CubeFont.headline`, title `CubeFont.subhead`, description `CubeFont.caption` with no `lineHeight`, row `.padding(CubeSpace.m).backgroundColor(CubeTheme.surface).borderRadius(CubeRadius.l)`
    - Call it for the swipe (`sys.symbol.hand_tap`) and orbit (`sys.symbol.arrow_counterclockwise`) cards inside `Column({ space: CubeSpace.s })`, and remove `gestureRow`
    - Apply the design's literal-to-token table across `build`: brand row `CubeSpace.s` with `constraintSize({ minHeight: CubeLayout.touchTarget })`, text columns `CubeSpace.xxs`, all `fontSize` values `CubeFont.*`; keep only `letterSpacing(1.5)` and gradient `angle: 135` as literals
    - Use only the existing string keys (`brand_name`, `brand_tagline`, `intro_title`, `intro_subtitle`, `intro_demo_badge`, `intro_stage_accessibility`, `intro_swipe_title`, `intro_swipe_desc`, `intro_orbit_title`, `intro_orbit_desc`, `intro_start`)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add `tests/intro-demo.test.mjs`
  - [x] 4.1 Create the test harness and source extraction
    - Mirror `tests/cube-renderer.test.mjs`: strip types from `CubeModel.ts` and `CubeRenderer.ets` into a `mkdtemp` directory, import them, remove the directory in `after`
    - Read `IntroPage.ets` as text; extract `DEMO_YAW` / `DEMO_PITCH` with `/const DEMO_YAW: number = (-?[\d.]+);/`-style regexes and the `demoBase` moves with `/new CubeMove\('([xyz])', (\d+), (-?1)\)/g`
    - Extract `demoStageHeight` and the `DEMO_STAGE_*` constants, drop `export`, evaluate with `stripTypeScriptTypes` and `vm`
    - Rebuild a JS `demoMove(index)` from the extracted base list and assert its formula appears verbatim in the source
    - Add a seeded mulberry32 PRNG helper that reports the seed and input on failure
    - _Requirements: 7.5_

  - [x]* 4.2 Write property test for front-face, axis-aligned demo guides
    - **Property 1: Demo guides are front-face and axis-aligned**
    - Tag `// Feature: intro-gesture-polish, Property 1: Demo guides are front-face and axis-aligned`
    - 100+ iterations over random width in [280, 480] and height in [220, 360], all four sequence positions per size; apply `demoMove(0..i-1)` to a fresh `CubeModel(3)`, draw a rest frame at `DEMO_YAW` / `DEMO_PITCH`, then assert `getSwipeGuide(demoMove(i))` is non-null, its start `boxHit` normal is `+z` on the turning layer, and its Path_Angle is ≤ 8° from horizontal (`y`) or vertical (`x`)
    - **Validates: Requirements 2.2, 2.3, 2.4, 1.1, 1.2**

  - [x]* 4.3 Write property test for Demo_Sequence pairs returning to solved
    - **Property 2: Demo_Sequence pairs return the model to solved**
    - Tag `// Feature: intro-gesture-polish, Property 2: Demo_Sequence pairs return the model to solved`
    - 100 random `n` in [1, 40]; apply `demoMove(0..2n-1)` to a solved `CubeModel(3)` and assert it is solved; assert one period contains a `y` move and an `x` move
    - **Validates: Requirements 2.5**

  - [x]* 4.4 Write property test for clamped, monotone stage height
    - **Property 3: Stage height is clamped and monotone**
    - Tag `// Feature: intro-gesture-polish, Property 3: Stage height is clamped and monotone`
    - 200 values mixing uniform [−1000, 3000], integers, and `NaN`, `±Infinity`, `0`, `-0`; assert an integer in [220, 360]; for sorted finite positive pairs `a ≤ b` assert `demoStageHeight(a) ≤ demoStageHeight(b)`
    - **Validates: Requirements 5.1, 5.2**

  - [x] 4.5 Write source-shape checks for IntroPage.ets
    - Camera: `|DEMO_YAW|` in [0.15, 0.35], `DEMO_PITCH` in [−0.35, −0.15], both `demoFrame` draw calls pass `DEMO_YAW, DEMO_PITCH`, Index.ets still has `private yaw: number = 0.62;` and `private pitch: number = -0.42;`
    - Demo loop: `getSwipeGuide(this.demoMove(cycle))` after a rest `draw`, one `move` / `progress` pair shared by `draw` and `drawTouch`, `if (guide === null) { return; }` kept
    - Layout: `Scroll()` before the Bottom_Bar, `.layoutWeight(1)` on the Scroll chain, `intro-start` after the Scroll block, Bottom_Bar `constraintSize({ maxWidth: CONTENT_MAX_WIDTH })` with `CONTENT_MAX_WIDTH` = 520; button modifier, id, accessibility text, `sys.symbol.arrow_right`, `.onClick(() => this.onDone())`
    - Stage/badge: `Stack({ alignContent: Alignment.BottomEnd })`, badge margin `{ right: CubeSpace.s, bottom: CubeSpace.s }`, `CubeTheme.overlay`, `HitTestMode.None`; root `onAreaChange` calls `demoStageHeight(`; `.height(this.stageHeight)`; Canvas `onAreaChange` sets `this.demoGuideStale = true`; gradient, `.clip(true)`, stage accessibility text
    - Hierarchy/tokens: marker order `brand_name` < `intro_title` < `intro-demo-canvas` < `intro_swipe_title` < `intro-start`; `gestureCard` uses `CubeTheme.surface`, `CubeRadius.`, `CubeSpace.` padding; no numeric literals in `fontSize(`, `padding(`, `margin(`, `space:`, `borderRadius(`, `width(`, `height(` and no `#` hex in `build` / `gestureCard`; every `fontSize(` is `CubeFont.*`; `$r('app.string.…')` key set equals the pre-change set
    - Preserved behavior: `new CubeModel(3)` and `new CubeRenderer()` fields, no `AppStorage` / `CubeStore` / `PersistentStorage`, `setInterval` in `aboutToAppear`, `clearInterval` in `aboutToDisappear`, Canvas id with `HitTestMode.None` and `accessibilityLevel('no')`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.6, 2.7, 3.1, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 5.1, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 7.4_

- [x] 5. Run the full test suite and the build
  - [x] 5.1 Run the full node test suite and fix failures
    - Run `node --unhandled-rejections=strict --test tests/*.test.mjs`
    - Fix any failure in IntroPage.ets or the new test; edit an existing intro assertion only if it conflicts with the Bottom_Bar restructure
    - _Requirements: 7.5, 7.6_

  - [x] 5.2 Run the debug build per AGENTS.md and fix compile errors
    - Run `.\scripts\build.ps1` in PowerShell and fix any ArkTS compile errors in IntroPage.ets
    - Keep scratch files outside the repo `build/` directory (e.g. `$env:TEMP`)
    - _Requirements: 7.5_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Each task references specific requirements for traceability.
- Property tests use a seeded PRNG in plain `node:test` because the repository has no property-testing library.
- The on-device check in the design (dumpLayout and screenshot) is manual and not part of this plan.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "4.1"] },
    { "id": 2, "tasks": ["2.1", "4.2"] },
    { "id": 3, "tasks": ["2.2", "4.3"] },
    { "id": 4, "tasks": ["2.3", "4.4"] },
    { "id": 5, "tasks": ["4.5"] },
    { "id": 6, "tasks": ["5.1"] },
    { "id": 7, "tasks": ["5.2"] }
  ]
}
```
