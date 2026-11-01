# Requirements Document

## Introduction

This spec reworks the first-launch gesture onboarding page added in commit d80ecf3
(`entry/src/main/ets/components/IntroPage.ets`, ArkTS / HarmonyOS). Two defects are fixed and
the layout is polished:

1. The demo gesture animations look slanted because the demo camera uses the game's
   three-quarter view (`DEMO_YAW = 0.62`, `DEMO_PITCH = -0.42`). The demo moves to a mostly
   front-facing camera with a slight 3D tilt, so a row swipe reads as screen-horizontal and a
   column swipe reads as screen-vertical.
2. The "开始体验" button (`intro_start`) sits too high in the scrolling column, and the
   "实时演示" badge (`intro_demo_badge`) is centered at the bottom of the stage. The button moves
   to a fixed bottom bar and the badge moves to the bottom-right corner of the stage.

The polish is limited to layout and spacing. No new strings, resources, or features are added.
The demo keeps its own model/renderer pair, `onDone` and the `onboarded` persistence flow stay
unchanged, and the existing smoke script and test suites keep passing.

## Glossary

- **Intro_Page**: The `IntroPage` ArkTS component shown on first launch; reports completion only via `onDone`.
- **Demo_Stage**: The gradient container inside Intro_Page holding the demo Canvas (`intro-demo-canvas`) and the Demo_Badge.
- **Demo_Badge**: The "实时演示" label rendered from `app.string.intro_demo_badge`.
- **Demo_Renderer**: The `CubeRenderer` instance owned by Intro_Page, separate from the game renderer.
- **Demo_Model**: The `CubeModel(3)` instance owned by Intro_Page, separate from the game model.
- **Demo_Camera**: The yaw/pitch pair (radians) Intro_Page passes to Demo_Renderer for every demo frame.
- **Demo_Sequence**: The ordered list of demo moves Intro_Page plays, alternating each base move with its inverse.
- **Row_Swipe**: A demo move about the `y` axis.
- **Column_Swipe**: A demo move about the `x` axis.
- **Front_Face**: The cube face whose outward world normal is `+z`.
- **Swipe_Guide**: The `CubeSwipeGuide` returned by `Demo_Renderer.getSwipeGuide(move)`, giving fingertip start and end points in Canvas units.
- **Path_Angle**: The angle, in degrees, between the Swipe_Guide segment (start to end) and the screen horizontal axis (for a Row_Swipe) or the screen vertical axis (for a Column_Swipe).
- **Start_Button**: The button with id `intro-start`, styled by `CubeButtons.hero`, labelled `app.string.intro_start`, that calls `onDone`.
- **Bottom_Bar**: A container pinned to the bottom of Intro_Page, outside the scrolling area, holding the Start_Button.
- **Content_Scroll**: The scrolling region of Intro_Page above the Bottom_Bar, holding the brand row, title, subtitle, Demo_Stage and Gesture_Cards.
- **Gesture_Card**: A card-styled row inside Content_Scroll describing one gesture (swipe or orbit) with an icon, title, and description.
- **Safe_Area**: The region of the window not covered by the system navigation indicator or status bar.
- **Theme_Tokens**: The design constants `CubeTheme`, `CubeFont`, `CubeSpace`, `CubeRadius`, and `CubeLayout` from `pages/CubeTheme.ets`.
- **Test_Suite**: `scripts/smoke.mjs` and the tests `tests/cube-ui.test.mjs`, `tests/cube-game.test.mjs`, `tests/cube-localization.test.mjs`, and `tests/cube-store.test.mjs`.

## Requirements

### Requirement 1: Front-facing demo camera

**User Story:** As a first-time player, I want the demo cube shown nearly face-on, so that the demonstrated swipes look straight instead of slanted.

#### Acceptance Criteria

1. THE Intro_Page SHALL render every demo frame with a Demo_Camera yaw whose absolute value is between 0.15 and 0.35 radians.
2. THE Intro_Page SHALL render every demo frame with a Demo_Camera pitch between -0.35 and -0.15 radians, so that a strip of the top face stays visible as a 3D cue.
3. THE Intro_Page SHALL define the Demo_Camera yaw and pitch as named constants in IntroPage.ets, separate from the game camera values in Index.ets.
4. THE Intro_Page SHALL leave the game camera values in Index.ets unchanged.

### Requirement 2: Axis-aligned demo gesture paths

**User Story:** As a first-time player, I want row swipes to move left-right and column swipes to move up-down on screen, so that I can copy the gesture on the real cube.

#### Acceptance Criteria

1. THE Intro_Page SHALL obtain each fingertip path from `Demo_Renderer.getSwipeGuide(move)` for the move currently animating.
2. WHEN a Row_Swipe animates, THE Intro_Page SHALL draw a fingertip path with a Path_Angle of at most 8 degrees from screen horizontal.
3. WHEN a Column_Swipe animates, THE Intro_Page SHALL draw a fingertip path with a Path_Angle of at most 8 degrees from screen vertical.
4. WHEN a demo move animates, THE Intro_Page SHALL draw a fingertip path whose start point lies on a Front_Face sticker belonging to the turning layer.
5. THE Demo_Sequence SHALL contain at least one Row_Swipe and at least one Column_Swipe, each paired with its inverse so that Demo_Model returns to the solved state after every pair.
6. WHEN Demo_Renderer animates a demo move, THE Intro_Page SHALL pass the same move and eased progress value to both the layer rotation and the fingertip position, so that the fingertip stays over the turning layer.
7. IF `Demo_Renderer.getSwipeGuide(move)` returns null for the current move, THEN THE Intro_Page SHALL draw the layer animation without a fingertip for that cycle.

### Requirement 3: Fixed bottom Start_Button

**User Story:** As a first-time player, I want the start button always visible at the bottom of the screen, so that I can leave the intro without hunting for it.

#### Acceptance Criteria

1. THE Intro_Page SHALL place the Start_Button inside a Bottom_Bar that sits outside Content_Scroll and is pinned to the bottom edge of Intro_Page.
2. THE Bottom_Bar SHALL keep the Start_Button above the bottom Safe_Area inset.
3. WHILE Content_Scroll is scrolled to any offset, THE Intro_Page SHALL keep the Start_Button fully visible.
4. WHEN content in Content_Scroll exceeds the space above the Bottom_Bar, THE Content_Scroll SHALL scroll that content above the Bottom_Bar without overlapping the Start_Button.
5. THE Start_Button SHALL keep the id `intro-start`, the `CubeButtons.hero` attribute modifier, the `app.string.intro_start` label and accessibility text, and the trailing `sys.symbol.arrow_right` glyph.
6. WHEN the user taps the Start_Button, THE Intro_Page SHALL call `onDone` exactly once per tap.
7. THE Bottom_Bar SHALL span the same maximum content width of 520vp as Content_Scroll content, centered horizontally.

### Requirement 4: Demo_Badge position

**User Story:** As a first-time player, I want the "实时演示" badge tucked into the corner of the stage, so that it labels the demo without covering the cube.

#### Acceptance Criteria

1. THE Demo_Stage SHALL position the Demo_Badge at the bottom-right corner of the Demo_Stage.
2. THE Demo_Stage SHALL inset the Demo_Badge from the right and bottom edges of the Demo_Stage by a CubeSpace token value between 8vp and 16vp inclusive.
3. THE Demo_Badge SHALL keep the `app.string.intro_demo_badge` text, the `CubeTheme.overlay` background, and touch pass-through (`HitTestMode.None`).

### Requirement 5: Adaptive Demo_Stage height

**User Story:** As a player on phones of different sizes, I want the demo stage to fit my screen, so that the cube is large on tall screens and the page still fits on short ones.

#### Acceptance Criteria

1. THE Intro_Page SHALL compute the Demo_Stage height from the available Intro_Page height instead of the fixed 300vp value.
2. THE Intro_Page SHALL clamp the Demo_Stage height to a minimum of 220vp and a maximum of 360vp.
3. WHEN the available Intro_Page height changes, THE Intro_Page SHALL recompute the Demo_Stage height and the demo Canvas SHALL redraw at the new size on the next demo frame.
4. THE Demo_Stage SHALL keep the stage gradient (`CubeTheme.stageStart` to `CubeTheme.stageEnd`), clipping, and `app.string.intro_stage_accessibility` text.

### Requirement 6: Layout hierarchy, spacing, and Gesture_Cards

**User Story:** As a first-time player, I want a clean and well-spaced intro page, so that the onboarding feels polished.

#### Acceptance Criteria

1. THE Intro_Page SHALL present content in this vertical order: brand row, title and subtitle, Demo_Stage, Gesture_Cards, Bottom_Bar.
2. THE Intro_Page SHALL render each gesture description (swipe and orbit) as a Gesture_Card with a `CubeTheme` surface background, a `CubeRadius` corner radius, and `CubeSpace` inner padding.
3. THE Intro_Page SHALL take every color, font size, spacing, radius, and touch-target value in the layout from Theme_Tokens.
4. THE Intro_Page SHALL use only string resources that existed before this change.
5. THE Intro_Page SHALL render all text at font sizes of at least 12fp.
6. THE Start_Button SHALL have a height of at least `CubeLayout.touchTarget`.

### Requirement 7: Preserved behavior and test compatibility

**User Story:** As a maintainer, I want the rework to keep existing behavior and checks intact, so that onboarding stays reliable.

#### Acceptance Criteria

1. THE Intro_Page SHALL keep a Demo_Model and Demo_Renderer pair that is separate from the game model and renderer.
2. THE Intro_Page SHALL report completion only through the `onDone` callback.
3. THE Intro_Page SHALL start the demo frame timer in `aboutToAppear` and clear the demo frame timer in `aboutToDisappear`.
4. THE Intro_Page SHALL keep the demo Canvas id `intro-demo-canvas` with touch pass-through and accessibility level `no`.
5. WHEN the Test_Suite runs after the change, THE Test_Suite SHALL pass.
6. WHERE an existing intro layout or id assertion in the Test_Suite conflicts with the Bottom_Bar restructure, THE Test_Suite SHALL update only that assertion to match the new structure.
