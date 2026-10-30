/* -*- js-indent-level: 8 -*- */
/*
 * Copyright the Collabora Online contributors.
 *
 * SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/// <reference path="../src/app/DocUtil.ts" />
/// <reference path="../src/app/LocaleService.ts" />
/// <reference path="../src/app/LayoutingService.ts" />
/// <reference path="../src/control/jsdialog/Util.GenerateTableIcon.ts" />
/// <reference path="../src/app/TableStylesService.ts" />
/// <reference path="../src/app/ServerConnectionService.ts" />
/// <reference path="../src/app/DocEvents.ts" />
/// <reference path="../src/docstate.ts" />
/// <reference path="../src/docstatefunctions.js" />
/// <reference path="../src/app/VulcanCalcReturnKey.ts" />
/// <reference path="../src/app/VulcanCalcMode.ts" />
// The phone Calc smart-toolbar place-holding law. Same load profile as the
// return-key latch above it: the file's only top-level effects are one type
// alias, one class declaration and one assignment to `window`, which
// refs/globals.ts has already aliased to globalThis — no listeners, no rAF,
// no DOM read at load. So it loads under Node, and
// VulcanSmartToolbarMemory.test.ts drives the real class (and the real static
// `survives`) rather than re-implementing the reset law next to it.
/// <reference path="../src/app/VulcanSmartToolbarMemory.ts" />
/// <reference path="../src/app/VulcanFormulaRefColors.ts" />
/// <reference path="../src/docdispatcher.ts" />
/// <reference path="../src/core/geometry.ts" />
/// <reference path="../src/core/DPIChangeListener.ts" />
/// <reference path="../src/app/TileCoordData.ts" />
/// <reference path="../src/app/PaneBorder.ts" />
/// <reference path="../src/app/Tile.ts" />
/// <reference path="../src/app/RenderManagerBase.ts" />
/// <reference path="../src/app/TilePerfBudget.ts" />
/// <reference path="../src/app/BitmapTileManager.ts" />
/// <reference path="../src/app/GraphicSelectionMiddleware.ts" />
/// <reference path="../src/app/TextSelectionMiddleware.ts" />
/// <reference path="../src/app/CellSelectionMarkerMiddleware.ts" />
/// <reference path="../src/app/TableMiddleware.ts" />
/// <reference path="../src/app/ImpressSelectionMiddleware.ts" />
/// <reference path="../src/app/ViewLayout.ts" />
/// <reference path="../src/app/ViewLayoutNewBase.ts" />
/// <reference path="../src/app/ViewLayoutWriter.ts" />
/// <reference path="../src/app/ViewLayoutCalc.ts" />
/// <reference path="../src/app/ViewLayoutMultiPage.ts" />
/// <reference path="../src/app/ViewLayoutFileBased.ts" />
/// <reference path="../src/app/DocumentBase.ts" />
/// <reference path="../src/app/DocumentView.ts" />
/// <reference path="../src/app/TilesMiddleware.ts" />
/// <reference path="../src/app/SearchService.ts" />
/// <reference path="../src/app/BaseClass.ts" />
/// <reference path="../src/app/Events.ts" />
/// <reference path="../src/app/Rectangle.ts" />
/// <reference path="../src/app/Util.ts" />
/// <reference path="../src/app/LOUtil.ts" />
/// <reference path="../src/app/IconUtil.ts" />
/// <reference path="../src/app/iface/DocLayer.Interface.ts" />
/// <reference path="../src/app/iface/Map.Interface.ts" />
/// <reference path="../src/app/iface/Control.Interface.ts" />
/// <reference path="../src/app/Log.ts" />
/// <reference path="../src/app/Debug.ts" />
/// <reference path="../src/app/A11yValidator.ts" />
/// <reference path="../src/app/QueuedSocket.ts" />
/// <reference path="../src/app/DelaySocket.ts" />
/// <reference path="../src/app/Socket.ts" />
/// <reference path="../src/app/TracingEvents.ts" />
/// <reference path="../src/app/ServerCommand.ts" />
/// <reference path="../src/geometry/Point.ts" />
/// <reference path="../src/geometry/Bounds.ts" />
/// <reference path="../src/app/InternUtil.ts" />
/// <reference path="../src/geometry/Transformation.ts" />
/// <reference path="../src/app/dom/DomUtil.ts" />
/// <reference path="../src/control/Control.IdleHandler.ts" />
/// <reference path="../src/layer/tile/SheetSwitch.ts" />
/// <reference path="../src/layer/tile/SheetGeometry.ts" />
/// <reference path="../src/layer/tile/CanvasTileUtils.ts" />
/// <reference path="../src/canvas/CanvasSectionContainer.ts" />
/// <reference path="../src/canvas/CanvasSectionObject.ts" />
/// <reference path="../src/canvas/sections/InvalidationRectangleSection.ts" />
/// <reference path="../src/app/ViewLayoutCompareChanges.ts" />
/// <reference path="../src/canvas/sections/HTMLObjectSection.ts" />
/// <reference path="../src/canvas/sections/CommentMarkerSubSection.ts" />
/// <reference path="../src/canvas/sections/CommentAnchorAreaSubSection.ts" />
/// <reference path="../src/canvas/sections/CommentSection.ts" />
/// <reference path="../src/canvas/sections/CommentListSection.ts" />
/// <reference path="../src/canvas/sections/CalcGridSection.ts" />
/// <reference path="../src/canvas/sections/SplitSection.ts" />
/// <reference path="../src/canvas/sections/SplitterLinesSection.ts" />
/// <reference path="../src/canvas/sections/PixelGridSection.ts" />
/// <reference path="../src/canvas/sections/DebugOverlaySection.ts" />
/// <reference path="../src/canvas/sections/PreloadMapSection.ts" />
/// <reference path="../src/canvas/sections/TilesSection.ts" />
/// <reference path="../src/canvas/sections/CalcRTLAwareDocumentPosition.ts" />
/// <reference path="../src/canvas/vector/primitive/Primitive.ts" />
/// <reference path="../src/canvas/vector/primitive/BackgroundColorPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/BitmapPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/ExclusiveEditViewPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/FilledRectanglePrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/FillGradientPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/GlowPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/GraphicPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/GraphicResource.ts" />
/// <reference path="../src/canvas/vector/primitive/GroupPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/HiddenGeometryPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/MaskPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/LineRectanglePrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/ModifiedColorPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/ObjectInfoPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/ObjectChildPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/PointArrayPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/PolygonHairlinePrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/PolygonStrokePrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/PolyPolygonAlphaGradientPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/PolyPolygonColorPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/PolyPolygonRGBAPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/PolyPolygonStrokePrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/ShadowPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/SingleLinePrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/SoftEdgePrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/SvgGradient.ts" />
/// <reference path="../src/canvas/vector/primitive/SvgLinearGradientPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/SvgRadialGradientPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/TextSimplePortionPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/TextDecoratedPortionPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/TransformPrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/TransparencePrimitive.ts" />
/// <reference path="../src/canvas/vector/primitive/UnifiedTransparencePrimitive.ts" />
/// <reference path="../src/canvas/vector/VectorWebFonts.ts" />
/// <reference path="../src/canvas/vector/VectorEffects.ts" />
/// <reference path="../src/canvas/vector/VectorPixelMaps.ts" />
/// <reference path="../src/canvas/vector/VectorSvgGradient.ts" />
/// <reference path="../src/canvas/vector/VectorPrimitiveRenderer.ts" />
/// <reference path="../src/canvas/vector/PreviewId.ts" />
/// <reference path="../src/canvas/vector/VectorPrimitivesData.ts" />
/// <reference path="../src/canvas/vector/VectorPrimitivesResponse.ts" />
/// <reference path="../src/canvas/vector/VectorRenderingGraphicsResponse.ts" />
/// <reference path="../src/canvas/vector/VectorRenderingConfig.ts" />
/// <reference path="../src/canvas/vector/SlideObject.ts" />
/// <reference path="../src/canvas/vector/PendingPreview.ts" />
/// <reference path="../src/canvas/vector/RenderedPreview.ts" />
/// <reference path="../src/canvas/vector/VectorBitmapWalker.ts" />
/// <reference path="../src/canvas/vector/VectorContentSection.ts" />
/// <reference path="../src/layer/tile/CanvasTileLayerInterface.ts" />
/// <reference path="../src/app/VectorManager.ts" />
/// <reference path="../src/canvas/sections/AutoFillBaseSection.ts" />
/// <reference path="../src/canvas/sections/CellFillMarkerSection.ts" />
/// <reference path="../src/canvas/sections/ImpressSelectionRectangle.ts" />
/// <reference path="../src/canvas/sections/TableFillMarkerSection.ts" />
/// <reference path="../src/canvas/sections/TableResizeMarkerSection.ts" />
/// <reference path="../src/canvas/sections/TableSelectMarkerSection.ts" />
/// <reference path="../src/canvas/sections/FocusCellSection.ts" />
/// <reference path="../src/canvas/sections/URLPopUpSection.ts" />
/// <reference path="../src/canvas/sections/InvalidationRectangleSection.ts" />
/// <reference path="../src/canvas/sections/ShapeHandlesSection.ts" />
/// <reference path="../src/canvas/sections/VulcanImpressMarqueeSection.ts" />
/// <reference path="../src/canvas/sections/VulcanTextEchoSection.ts" />
/// <reference path="../src/canvas/sections/VulcanCalcEchoSection.ts" />
/// <reference path="../src/canvas/sections/ShapeHandleSubSection.ts" />
/// <reference path="../src/canvas/sections/ShapeHandleCustomSubSection.ts" />
/// <reference path="../src/canvas/sections/ShapeHandlePolySubSection.ts" />
/// <reference path="../src/canvas/sections/ShapeHandleGluePointSubSection.ts" />
/// <reference path="../src/canvas/sections/ShapeHandleAnchorSubSection.ts" />
/// <reference path="../src/canvas/sections/ShapeHandleRotationSubSection.ts" />
/// <reference path="../src/canvas/sections/ShapeHandleDiagramSubSection.ts" />
/// <reference path="../src/canvas/sections/ShapeHandleScalingSubSection.ts" />
/// <reference path="../src/canvas/sections/VulcanImpressTableChipSection.ts" />
/// <reference path="../src/canvas/sections/ValidityInputHelpSection.ts" />
/// <reference path="../src/canvas/sections/CellCursorSection.ts" />
/// <reference path="../src/canvas/sections/CellSelectionHandleSection.ts" />
/// <reference path="../src/canvas/sections/CalcValidityDropDownSection.ts" />
/// <reference path="../src/canvas/sections/TextSelectionHandleSection.ts" />
/// <reference path="../src/canvas/sections/TextSelectionSection.ts" />
/// <reference path="../src/canvas/sections/OtherViewGraphicSelectionSection.ts" />
/// <reference path="../src/canvas/sections/OtherViewCellCursorSection.ts" />
/// <reference path="../src/canvas/sections/FormFieldButton.ts" />
/// <reference path="../src/canvas/sections/OtherViewCursorSection.ts" />
/// <reference path="../src/canvas/sections/TooltipAnchorSection.ts" />
/// <reference path="../src/canvas/sections/RulerSpacerSection.ts" />
/// <reference path="../src/layer/vector/CEventsHandler.ts" />
/// <reference path="../src/layer/vector/CPointSet.ts" />
/// <reference path="../src/layer/vector/CPath.ts" />
/// <reference path="../src/layer/vector/CLineUtil.ts" />
/// <reference path="../src/layer/vector/CPolyline.ts" />
/// <reference path="../src/layer/vector/CPolyUtil.ts" />
/// <reference path="../src/layer/vector/CPolygon.ts" />
/// <reference path="../src/layer/vector/CRectangle.ts" />
/// <reference path="../src/layer/marker/Cursor.ts" />
/// <reference path="../src/layer/vector/CanvasOverlay.ts" />
/// <reference path="../src/canvas/sections/ScrollSection.ts" />
/// <reference path="../src/canvas/sections/MouseControl.ts" />
/// <reference path="../src/app/LayerUtil.ts" />
/// <reference path="../src/layer/vector/CDarkOverlay.ts" />
/// <reference path="../src/layer/SplitPanesContext.ts" />
/// <reference path="../src/layer/CalcSplitPanesContext.ts" />
/// <reference path="../src/canvas/sections/CursorHeaderSection.ts" />
/// <reference path="../src/canvas/sections/CursorHandler.ts" />
/// <reference path="../src/canvas/sections/TableInsertMarkerSection.ts" />
/// <reference path="../src/canvas/sections/GenericButtonSection.ts" />
/// <reference path="../src/canvas/sections/ChartContextButtonSection.ts" />
/// <reference path="../src/canvas/sections/DiagramButtonSection.ts" />
/// <reference path="../src/canvas/sections/ContentControlDropdownSubSection.ts" />
/// <reference path="../src/canvas/sections/ContentControlSection.ts" />
/// <reference path="../src/map/handler/Map.KeyboardShortcuts.ts" />
/// <reference path="../src/map/handler/Map.Settings.ts" />
/// <reference path="../src/control/jsdialog/Util.UniqueId.ts" />
/// <reference path="../src/control/jsdialog/Util.PlainLabel.ts" />
/// <reference path="../src/control/jsdialog/Component.Base.ts" />
/// <reference path="../src/control/PermissionMode.ts" />
/// <reference path="../src/control/VulcanEscape.ts" />
// The drain handoff signals. Both files define one object literal and assign
// it to `window` at load, nothing else (no listener, no timer until start()),
// so VulcanEditState.test.ts and VulcanViewAnchor.test.ts drive the shipped code.
/// <reference path="../src/control/VulcanEditState.ts" />
/// <reference path="../src/control/VulcanViewAnchor.ts" />
/// <reference path="../src/control/VulcanImpressEditUnits.ts" />
/// <reference path="../src/control/Control.AboutDialog.ts" />
/// <reference path="../src/control/Control.GroupBase.ts" />
/// <reference path="../src/control/Control.CornerGroup.ts" />
/// <reference path="../src/control/Control.RowGroup.ts" />
/// <reference path="../src/control/Control.ColumnGroup.ts" />
/// <reference path="../src/control/Control.CornerHeader.ts" />
/// <reference path="../src/control/Control.Header.ts" />
/// <reference path="../src/control/Control.ColumnHeader.ts" />
/// <reference path="../src/control/Control.RowHeader.ts" />
/// <reference path="../src/control/Control.Menubar.ts" />
/// <reference path="../src/control/Control.ServerAuditDialog.ts" />
/// <reference path="../src/control/Control.ESignature.ts" />
/// <reference path="../src/control/Control.ESignatureDialog.ts" />
/// <reference path="../src/control/ColorPicker.ts" />
/// <reference path="../src/unoshortcuts.ts" />
/// <reference path="../src/control/jsdialog/Util.Shortcuts.ts" />
/// <reference path="../src/control/jsdialog/Util.ModelState.ts" />
/// <reference path="../src/control/jsdialog/Component.Toolbar.ts" />
/// <reference path="../src/control/jsdialog/Definitions.Menu.ts" />
/// <reference path="../src/control/jsdialog/Definitions.DialogModification.ts" />
/// <reference path="../src/control/jsdialog/Definitions.WindowId.ts" />
/// <reference path="../src/control/jsdialog/Util.Accessibility.ts" />
/// <reference path="../src/control/jsdialog/Util.Dropdown.ts" />
/// <reference path="../src/control/jsdialog/Util.Events.ts" />
/// <reference path="../src/control/jsdialog/Util.FocusCycle.js" />
/// <reference path="../src/control/jsdialog/Util.KeyboardTabNavigation.ts" />
/// <reference path="../src/control/jsdialog/Util.KeyboardGridNavigation.ts" />
/// <reference path="../src/control/jsdialog/Util.KeyboardListNavigation.ts" />
/// <reference path="../src/control/jsdialog/Util.FormulaBarSelectionHandle.ts" />
/// <reference path="../src/control/jsdialog/Util.MessageRouter.ts" />
/// <reference path="../src/control/jsdialog/Util.OnDemandRenderer.ts" />
/// <reference path="../src/control/jsdialog/Util.ScrollableBar.ts" />
/// <reference path="../src/control/jsdialog/Util.ScrollIntoView.ts" />
/// <reference path="../src/control/jsdialog/Util.SnackbarController.ts" />
/// <reference path="../src/control/jsdialog/Util.StateChange.ts" />
/// <reference path="../src/control/jsdialog/Widget.ButtonBox.ts" />
/// <reference path="../src/control/jsdialog/Widget.Checkbox.ts" />
/// <reference path="../src/control/jsdialog/Widget.ColorPicker.ts" />
/// <reference path="../src/control/jsdialog/Widget.PageMarginEntry.ts" />
/// <reference path="../src/control/jsdialog/Widget.PageSizeEntry.ts" />
/// <reference path="../src/control/jsdialog/Widget.Containers.ts" />
/// <reference path="../src/control/jsdialog/Widget.DropDown.ts" />
/// <reference path="../src/control/jsdialog/Widget.Edit.ts" />
/// <reference path="../src/control/jsdialog/Widget.HTMLContent.ts" />
/// <reference path="../src/control/jsdialog/Widget.IconView.ts" />
/// <reference path="../src/control/jsdialog/Widget.NotebookbarIconView.ts" />
/// <reference path="../src/control/jsdialog/Widget.NewSlideLayoutEntry.ts" />
/// <reference path="../src/control/jsdialog/Widget.OverflowGroup.ts" />
/// <reference path="../src/control/jsdialog/Widget.OverflowManager.ts" />
/// <reference path="../src/control/jsdialog/Widget.RadioButton.ts" />
/// <reference path="../src/control/jsdialog/Widget.SearchEdit.ts" />
/// <reference path="../src/control/jsdialog/Widget.SidebarContainers.ts" />
/// <reference path="../src/control/jsdialog/Widget.Toolitem.ts" />
/// <reference path="../src/control/jsdialog/Widget.Text.ts" />
/// <reference path="../src/control/jsdialog/Widget.TreeView.ts" />
/// <reference path="../src/control/Control.MobileSearchBar.ts" />
/// <reference path="../src/control/Control.MobileTopBar.ts" />
/// <reference path="../src/control/VulcanSelectionMenu.ts" />
/// <reference path="../src/control/Control.MobileSelectionBar.ts" />
/// <reference path="../src/control/Control.ImpressSelectionBar.ts" />
/// <reference path="../src/control/Control.SpeakerNotes.ts" />
/// <reference path="../src/control/Control.UserList.ts" />
/// <reference path="../src/control/Control.SaveState.ts" />
/// <reference path="../src/control/Control.NotebookbarBase.ts" />
/// <reference path="../src/control/jsdialog/Definitions.MenuCommands.ts" />
/// <reference path="../src/control/jsdialog/Control.ts" />
/// <reference path="../src/control/jsdialog/Control.ContextMenu.ts" />
/// <reference path="../src/control/CalcNotifications.ts" />
/// <reference path="../src/control/Control.UIManager.ts" />
/// <reference path="../src/control/Notebookbar.WriterReferencesTab.ts" />
/// <reference path="../src/control/Control.ContextToolbar.ts" />
/// <reference path="../src/control/Control.SidebarBase.ts" />
/// <reference path="../src/control/Control.Sidebar.ts" />
/// <reference path="../src/control/Notebookbar.ImpressAnimationTab.ts" />
/// <reference path="../src/control/Notebookbar.ImpressTransitionTab.ts" />
/// <reference path="../src/control/Sidebar.FromNotebookbarPanel.ts" />
/// <reference path="../src/control/Control.NavigatorPanel.ts" />
/// <reference path="../src/control/Control.QuickFindPanel.ts" />
/// <reference path="../src/control/AutoCompletePopup.ts" />
/// <reference path="../src/control/Control.Mention.ts" />
/// <reference path="../src/control/Control.FormulaUsagePopup.ts" />
/// <reference path="../src/control/Control.FormulaAutoCompletePopup.ts" />
/// <reference path="../src/control/Control.AutoFillPreviewTooltip.ts" />
/// <reference path="../src/control/Control.AddressInputField.ts" />
/// <reference path="../src/control/Control.Tooltip.js" />
/// <reference path="../src/control/Ruler.ts" />
/// <reference path="../src/control/VRuler.ts" />
/// <reference path="../src/control/HRuler.ts" />

/// <reference path="../src/slideshow/SlideCache.ts" />
/// <reference path="../src/slideshow/SlideCompositor.ts" />
/// <reference path="../src/slideshow/LayerRenderer.ts" />
/// <reference path="../src/slideshow/SlideshowMiddleware.ts" />
/// <reference path="../src/slideshow/LayerDrawing.ts" />
/// <reference path="../src/slideshow/LayersCompositor.ts" />
/// <reference path="../src/slideshow/VectorCompositor.ts" />
/// <reference path="../src/slideshow/RenderContext.ts" />
/// <reference path="../src/slideshow/VideoRenderer.ts" />
/// <reference path="../src/slideshow/SlideRenderer.ts" />
/// <reference path="../src/slideshow/SlideShowPresenter.ts" />
/// <reference path="../src/slideshow/SimpleTextureRenderer.ts" />
/// <reference path="../src/slideshow/StaticTextRenderer.ts" />
/// <reference path="../src/slideshow/PauseTimer.ts" />
/// <reference path="../src/slideshow/TransitionFactory.ts" />
/// <reference path="../src/slideshow/CanvasLoader.ts" />
/// <reference path="../src/slideshow/Operation.ts" />
/// <reference path="../src/slideshow/Primitive.ts" />
/// <reference path="../src/slideshow/engine/ActivityFactory.ts" />
/// <reference path="../src/slideshow/engine/ActivityQueue.ts" />
/// <reference path="../src/slideshow/engine/AnimationFactory.ts" />
/// <reference path="../src/slideshow/engine/Duration.ts" />
/// <reference path="../src/slideshow/engine/Effect.ts" />
/// <reference path="../src/slideshow/engine/ElapsedTime.ts" />
/// <reference path="../src/slideshow/engine/EventMultiplexer.ts" />
/// <reference path="../src/slideshow/engine/Event.ts" />
/// <reference path="../src/slideshow/engine/FrameSynchronization.ts" />
/// <reference path="../src/slideshow/engine/InteractiveAnimationSequence.ts" />
/// <reference path="../src/slideshow/engine/MetaPresentation.ts" />
/// <reference path="../src/slideshow/engine/MetaSlide.ts" />
/// <reference path="../src/slideshow/engine/NextEffectEventArray.ts" />
/// <reference path="../src/slideshow/engine/SlideAnimations.ts" />
/// <reference path="../src/slideshow/engine/SlideChangeBase.ts" />
/// <reference path="../src/slideshow/engine/SlideShowHandler.ts" />
/// <reference path="../src/slideshow/engine/SlideShowNavigator.ts" />
/// <reference path="../src/slideshow/engine/SlideTransition.ts" />
/// <reference path="../src/slideshow/engine/SourceEventElement.ts" />
/// <reference path="../src/slideshow/engine/TimerEventQueue.ts" />
/// <reference path="../src/slideshow/engine/Timing.ts" />
/// <reference path="../src/slideshow/engine/tools.ts" />
/// <reference path="../src/slideshow/engine/activities/AnimationActivity.ts" />
/// <reference path="../src/slideshow/engine/activities/ActivityBase.ts" />
/// <reference path="../src/slideshow/engine/activities/SimpleContinuousActivityBase.ts" />
/// <reference path="../src/slideshow/engine/activities/ContinuousActivityBase.ts" />
/// <reference path="../src/slideshow/engine/activities/ContinuousKeyTimeActivityBase.ts" />
/// <reference path="../src/slideshow/engine/activities/DiscreteActivityBase.ts" />
/// <reference path="../src/slideshow/engine/activities/FromToByActivity.ts" />
/// <reference path="../src/slideshow/engine/activities/SetActivity.ts" />
/// <reference path="../src/slideshow/engine/activities/SimpleActivity.ts" />
/// <reference path="../src/slideshow/engine/activities/ValueListActivity.ts" />
/// <reference path="../src/slideshow/engine/animationnodes/BaseNode.ts" />
/// <reference path="../src/slideshow/engine/animationnodes/AnimationBaseNode.ts" />
/// <reference path="../src/slideshow/engine/animationnodes/AnimationColorNode.ts" />
/// <reference path="../src/slideshow/engine/animationnodes/AnimationNodeInfo.ts" />
/// <reference path="../src/slideshow/engine/animationnodes/AnimationPathMotionNode.ts" />
/// <reference path="../src/slideshow/engine/animationnodes/AnimationSetNode.ts" />
/// <reference path="../src/slideshow/engine/animationnodes/AnimationTransformNode.ts" />
/// <reference path="../src/slideshow/engine/animationnodes/AnimationTransitionFilterNode.ts" />
/// <reference path="../src/slideshow/engine/animationnodes/BaseContainerNode.ts" />
/// <reference path="../src/slideshow/engine/animationnodes/NodeContext.ts" />
/// <reference path="../src/slideshow/engine/animationnodes/PropertyAnimationNode.ts" />
/// <reference path="../src/slideshow/engine/AnimatedElement.ts" />
/// <reference path="../src/slideshow/TransitionsInfo.ts" />
/// <reference path="../src/slideshow/Transition2d.ts" />
/// <reference path="../src/slideshow/Transition3d.ts" />
/// <reference path="../src/slideshow/transition/ClippingTransition.ts" />
/// <reference path="../src/slideshow/transition/FadeTransition.ts" />
/// <reference path="../src/slideshow/transition/PlusTransition.ts" />
/// <reference path="../src/slideshow/transition/CircleTransition.ts" />
/// <reference path="../src/slideshow/transition/VenetianTransition.ts" />
/// <reference path="../src/slideshow/transition/WedgeTransition.ts" />
/// <reference path="../src/slideshow/transition/OvalTransition.ts" />
/// <reference path="../src/slideshow/transition/BoxTransition.ts" />
/// <reference path="../src/slideshow/transition/DiamondTransition.ts" />
/// <reference path="../src/slideshow/transition/CheckersTransition.ts" />
/// <reference path="../src/slideshow/transition/PushTransition.ts" />
/// <reference path="../src/slideshow/transition/SimpleDissolveTransition.ts" />
/// <reference path="../src/slideshow/transition/BarsTransition.ts" />
/// <reference path="../src/slideshow/transition/CutTransition.ts" />
/// <reference path="../src/slideshow/transition/WheelTransition.ts" />
/// <reference path="../src/slideshow/transition/UncoverTransition.ts" />
/// <reference path="../src/slideshow/transition/CoverTransition.ts" />
/// <reference path="../src/slideshow/transition/SplitTransition.ts" />
/// <reference path="../src/slideshow/transition/WipeTransition.ts" />
/// <reference path="../src/slideshow/transition/IrisWipeTransition.ts" />
/// <reference path="../src/slideshow/transition/EllipseWipeTransition.ts" />
/// <reference path="../src/slideshow/transition/SlideWipeTransition.ts" />
/// <reference path="../src/slideshow/transition/BarWipeTransition.ts" />
/// <reference path="../src/slideshow/transition/DiagonalTransition.ts" />
/// <reference path="../src/slideshow/transition/PushWipeTransition.ts" />
/// <reference path="../src/slideshow/transition/CombTransition.ts" />
/// <reference path="../src/slideshow/transition/NoTransition.ts" />
/// <reference path="../src/slideshow/transition3d/SimpleTransition.ts" />
/// <reference path="../src/slideshow/transition3d/CubeTransition.ts" />
/// <reference path="../src/slideshow/transition3d/HelixTransition.ts" />
/// <reference path="../src/slideshow/transition3d/FallTransition.ts" />
/// <reference path="../src/slideshow/transition3d/ReflectionTransition.ts" />
/// <reference path="../src/slideshow/transition3d/RochadeTransition.ts" />
/// <reference path="../src/slideshow/transition3d/TurnDownTransition.ts" />
/// <reference path="../src/slideshow/transition3d/Venetian3dTransition.ts" />
/// <reference path="../src/slideshow/transition3d/TurnAroundTransition.ts" />
/// <reference path="../src/slideshow/transition3d/PermTextureTransition.ts" />
/// <reference path="../src/slideshow/transition3d/RippleTransition.ts" />
/// <reference path="../src/slideshow/transition3d/NewsFlashTransition.ts" />
/// <reference path="../src/slideshow/transition3d/DissolveTransition3d.ts" />
/// <reference path="../src/slideshow/transition3d/FlipTilesTransition.ts" />
/// <reference path="../src/slideshow/transition3d/StaticNoiseTransition.ts" />
/// <reference path="../src/slideshow/transition3d/MicsShapeWipeTransition.ts" />
/// <reference path="../src/slideshow/Operation_t.ts" />
/// <reference path="../src/slideshow/operation/RotateAndScaleDepth.ts" />
/// <reference path="../src/slideshow/operation/SEllipseTranslate.ts" />
/// <reference path="../src/slideshow/operation/SRotate.ts" />
/// <reference path="../src/slideshow/operation/SScale.ts" />
/// <reference path="../src/slideshow/operation/STranslate.ts" />

// Pure policy, no DOM and no `app` dependency, so position here is free.
/// <reference path="../src/app/VulcanFilmstripFollow.ts" />
/// <reference path="../src/app/VulcanUndoNotice.ts" />
/// <reference path="../src/app/VulcanImpressFit.ts" />
/// <reference path="../src/app/VulcanWriterFit.ts" />
// Pure page-shadow recipe (two-layer chrome shadow), no `app` dependency.
/// <reference path="../src/app/VulcanPageShadow.ts" />
/// <reference path="../src/app/VulcanMenuPopup.ts" />
/// <reference path="../src/app/VulcanReadImmersion.ts" />
// Position is NOT free for this one. The file's last statement is
// `app.writerReflow = new VulcanWriterReflowController()`, so `app` has to
// exist by the time it loads; refs/globals.ts (referenced ahead of this file
// from main.ts) is what puts it there. Everything else the module touches --
// `window.mode`, `InternPointUtil`, the map -- is reached from inside a
// method, never at load time.
/// <reference path="../src/app/VulcanWriterReflow.ts" />
/// <reference path="../src/app/VulcanCaretReveal.ts" />
/// <reference path="../src/app/VulcanImpressAccessibility.ts" />
/// <reference path="../src/app/VulcanImpressPartCommit.ts" />
/// <reference path="../src/app/VulcanImpressEditCarousel.ts" />
/// <reference path="../src/app/VulcanImpressZoomIntent.ts" />
/// <reference path="../src/app/VulcanImpressTextDock.ts" />
// The Calc half of the host gutter-tap bridge. Its listener calls
// VulcanImpressTextDock.parseHostGutterTap at MESSAGE time, never at load,
// so it needs nothing beyond `window` to exist here; it is listed after the
// dock so the bundle order matches Makefile.am.
/// <reference path="../src/app/VulcanCalcHostGutterTap.ts" />

// The phone deck's edit-entry zoom. VulcanImpressTextZoom is pure and could sit
// with the block above; VulcanImpressTextEntry beside it is not — the file ends
// by registering a TextCursorVisibility listener, so `app.events` (refs
// /globals.ts, a no-op stub) must already exist. Same reason
// VulcanImpressBridge is loaded last.
/// <reference path="../src/app/VulcanImpressTextZoom.ts" />

// The phone format sheet. Everything it touches from outside itself (`_UNO`,
// `GraphicSelection`, `JSDialog`, `app.dispatcher`, `document`) is reached from
// inside a method, never at load time; the file's only top-level effects are
// four const arrays, one class declaration, and one assignment to `window`,
// which refs/globals.ts has already aliased to globalThis. So it loads under
// Node, and VulcanMobileFormatSpacing.test.ts drives the real class rather than
// re-implementing the ladder next to it.
/// <reference path="../src/control/VulcanMobileFormat.ts" />

// The phone Writer text-format strip. Same load profile as the sheet above:
// three const arrays, one class declaration and one assignment to `window`
// (already aliased to globalThis by refs/globals.ts) are the file's only
// top-level effects — `document`, `window.mode`, `_`, `_UNO` and `JSDialog`
// are all reached from inside a method or the constructor. So it loads under
// Node and VulcanWriterFormatRow.test.ts drives the real class.
/// <reference path="../src/control/VulcanWriterFormatRow.ts" />
// The rails' pictures: a flat name -> SVG path table and two builders, no
// state, no DOM at load. Listed BEFORE the Calc rail because that rail names
// the class directly, the way it names VulcanSelectionMenu.
/// <reference path="../src/control/VulcanRailIcons.ts" />
// The rail's shared CONTENT tables (the two alignment tables and the
// in-force rule): const arrays, one class, one assignment to `window`, and
// `_UNO` reached only from inside a label thunk. Listed BEFORE the rail and
// the popup, both of which name it directly.
/// <reference path="../src/control/VulcanCalcRailContent.ts" />
// The Calc EDIT-READY style rail, the row above's twin: same load profile
// (const arrays, one class declaration, one assignment to `window`), same
// reason it loads under Node, and CalcPhoneFontRow.test.ts drives the real
// class rather than re-implementing the rail beside it.
/// <reference path="../src/control/VulcanCalcFormatRow.ts" />
// The rail's alignment popup (VO-P-0016 lane B4). One class, one assignment
// to `window`; `window.JSDialog` is read inside open() and is a rig seam, so
// CalcPhoneAlignPicker.test.ts drives the real module against a recording
// OpenDropdown rather than a re-implementation of the hand-off.
/// <reference path="../src/control/VulcanCalcAlignPicker.ts" />
// The rail's font-size sheet (VO-P-0016 lane B3). One class, one assignment
// to `window`; it names VulcanMobileFormatSheet.stepperRow (loaded above) and
// VulcanCalcRailContent's size rule directly, and reaches `window.JSDialog`
// and `document` only inside open(), both rig seams — so
// CalcPhoneFontSizePicker.test.ts drives the real module against a recording
// map rather than a re-implementation of the sheet.
/// <reference path="../src/control/VulcanCalcFontSizePicker.ts" />
// The rail's borders palette (VO-P-0016 lane B5). Two const tables, one
// class, one assignment to `window`; `window.JSDialog`, `document`,
// `window.getBorderStyleUNOCommand` (stubbed in refs/globals.ts) and
// `map.uiManager.mobileWizard` are all reached inside open() or a tap, and
// every one is a rig seam — so CalcPhoneBorderPalette.test.ts drives the
// real module against a recording map and a recording wizard window rather
// than a re-implementation of the palette.
/// <reference path="../src/control/VulcanCalcBorderPalette.ts" />
// The Impress contextual format row, the third clone of the same rail: same
// load profile again (const arrays, one class declaration, one assignment to
// `window`), and the noun oracle it reads -- VulcanEscape.topKind -- is
// dependency-injected for the rig, so nothing here needs the ladder booted.
// ImpressPhoneFormatRow.test.ts drives the real class.
/// <reference path="../src/control/VulcanImpressFormatRow.ts" />
// The EDIT-READY cell preview and its ✎ door, the rail's shipping partner and
// the same load profile again: one const, one class declaration, one
// assignment to `window`, with `document`, `window.mode` and `_` all reached
// from inside a method or the constructor. So it loads under Node and
// CalcPhoneCellPreview.test.ts drives the real class — which is what lets that
// suite assert the pencil goes through the SHIPPED FormulaBar.focus() rather
// than re-implementing the handler beside it.
/// <reference path="../src/control/VulcanCalcCellPreview.ts" />
/// <reference path="../src/control/VulcanCalcFunctionBrowser.ts" />
// The live aggregate readout (G33) is loadable under Node for exactly the
// same reason as the row above it: one const array, one class declaration and
// one assignment to `window`, with `document`, `window.mode` and `_` all
// reached from inside a method or the constructor. CalcPhoneAggregateStrip
// .test.ts drives the real class.
/// <reference path="../src/control/VulcanCalcAggregateStrip.ts" />
/// <reference path="../src/control/VulcanBottomSheetGesture.ts" />

// The phone Calc comment sheet. Same load-time story as the two above: the
// file's only top-level effects are one class declaration and one assignment
// to `window`, and everything it reaches for (`document`, `_`) is touched
// from inside the constructor or a method. CalcPhoneCommentSheet.test.ts
// drives the real class on a jsdom tree.
/// <reference path="../src/control/VulcanCommentSheet.ts" />

// The phone tracked-change bar. Like VulcanMobileFormat above, everything it
// reaches for from outside itself (`document`, `app.events`, `app.file`, `_`,
// `_UNO`) is touched from inside a method or the constructor, never at load
// time; the file's only top-level effects are one class declaration and one
// assignment to `window`. So it loads under Node and
// WriterPhoneRedlineBar.test.ts drives the real class rather than restating
// its decision table beside it.
/// <reference path="../src/control/VulcanRedlineBar.ts" />

// Loaded last: the file ends by instantiating itself onto `app`, so `app`
// (refs/globals.ts) must already exist.
// VulcanCalcBridge names this type; without it the bundle build gains two
// TS2304s that have nothing to do with any test.
/// <reference path="../src/canvas/sections/CalcHighlightSection.ts" />

// The Calc bridge, for the two PURE statics on it that decide whether a
// `textselectioncontent` payload is the answer to the range we asked for. Like
// VulcanWriterReflow above, the file ends in `app.calcBridge = new ...`, so
// `app` has to exist by the time it is loaded -- which it does, refs/globals.ts
// is first.
/// <reference path="../src/app/VulcanCalcBridge.ts" />

/// <reference path="../src/app/VulcanSlideLibrary.ts" />
/// <reference path="../src/app/VulcanImpressBridge.ts" />

// The comments read shared by all four doc types, and the delegate that
// carries its verb for text/presentation/drawing. VulcanCommentReader is pure
// -- no `app` assignment, no timers -- so it could load anywhere;
// VulcanDocBridge ends in `app.docBridge = new ...` and must come after
// refs/globals.ts like the bridges above it.
/// <reference path="../src/app/VulcanCommentReader.ts" />
/// <reference path="../src/app/VulcanHostApi.ts" />
/// <reference path="../src/app/VulcanLiveCanvas.ts" />
/// <reference path="../src/app/VulcanDocBridge.ts" />
/// <reference path="../src/app/VulcanWriterBridge.ts" />
// The speculative text echo controller. Pure state machine over the
// RenderManager tag stream; ends by registering itself on
// `app.definitions`, so `app` (refs/globals.ts) must already exist.
/// <reference path="../src/app/VulcanImpressTextEcho.ts" />
/// <reference path="../src/app/VulcanCalcTextEcho.ts" />
/// <reference path="../src/app/VulcanCalcCursorEcho.ts" />
/// <reference path="../src/app/VulcanImpressNudge.ts" />
/// <reference path="../src/app/VulcanImpressSelectEcho.ts" />
/// <reference path="../src/app/VulcanImpressInsertPlace.ts" />
/// <reference path="../src/app/VulcanPdfCanvas.ts" />
/// <reference path="../src/app/VulcanCanvasAutosave.ts" />

// Clipboard.js uses Leaflet's class factory at load time. Load it last behind
// the minimal test class adapter so the production clipboard handlers can be
// exercised without replacing the suite's intentionally lightweight L stubs.
/// <reference path="./helper/ClipboardClassSetup.ts" />
/// <reference path="../src/map/Clipboard.js" />
