# Immersive workspace integration

`src/components/ImmersiveWorkspace.tsx` owns the shell around the plan renderers. `src/App.tsx` passes the active `Layout` returned by `selectActiveLayout`, the active findings returned by `selectActiveFindings`, and the same selection and comparison actions used by the 2D plan. The workspace never creates alternate geometry.

## Renderer interface

`WorkspaceRendererProps` is exported from `ImmersiveWorkspace.tsx`. The renderer receives `layout: Layout` and may implement these optional controls:

| Prop | Meaning |
| --- | --- |
| `cameraPreset` | `overview`, `top`, `entry`, or `eye-level`. |
| `cameraRequestId` | Incremented for each camera command, including repeated Reset clicks. |
| `focusedRoomId` | Canonical room ID requested by the inspector. |
| `exploded`, `onExplodedChange` | Controlled exploded view state and updates from renderer controls. |
| `selectedRoomId`, `selectedElementId` | Canonical selection IDs; selection survives workspace expansion. |
| `onSelectRoom`, `onSelectElement` | Return canonical IDs from scene picking. |
| `findings`, `selectedFindingId` | Supplied model findings and current finding selection. |
| `onUnavailable` | Report unavailable WebGL so the shell can offer the 2D plan. |

The workspace's `rendererCapabilities` flags enable controls only after the renderer implements them. `src/App.tsx` currently enables camera presets, exploded view, room focus, and picking for the upgraded `Plan3D` interface. If a renderer is replaced with one lacking a capability, remove the corresponding flag; the control will be disabled and will not suggest that an action occurred.

The workspace remains mounted when changing between 2D and 3D or expanding, so its camera command, comparison, and selection state persist. The current renderer refits the camera when its canvas dimensions change, so a manually orbited angle may move toward the active preset during expansion. Preserving an arbitrary orbit through resize requires the renderer to retain its camera transform across canvas size changes. `Proposal.resultLayout` is supplied only when the shared `showAfter` state is true.

## Room inspector associations

Room contents are derived from the active layout. Furniture and fixtures are associated by their bounds center inside the supplied room polygon. Door centers on polygon edges are included for adjacent rooms. Findings appear only when their `affectedElementIds` contain the room or one of these associated IDs. Unassociated findings remain available in the report panel.

## Fallbacks

The 3D fallback offers a direct 2D switch. The 2D plan and results remain mounted and keyboard accessible. Cost ranges and measurements are rendered only from supplied proposal and finding fields. `npm test` runs focused tests for room geometry associations and supplied finding verdicts.
