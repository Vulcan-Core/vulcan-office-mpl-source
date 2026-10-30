/* -*- js-indent-level: 8 -*- */
/* global app */
/*
 * Copyright the Collabora Online contributors.
 *
 * SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

interface MenuItem {
	id?: string;
	name?: string;
	uno?: string;
	// Tag a menu item as being for the uno command, but don't do anything.  If `uno` is set
	// this shouldn't be. It is used by `_getItemsForCommand()`.
	unoid?: string;
	type?: string;
	// Command whose keyboard shortcut should be shown next to the entry.
	// For action-only entries that have no uno command of their own.
	shortcut?: string;
	menu?: MenuItem[];
	disabled?: boolean;
	hidden?: boolean;
	readOnly?: boolean;
	mobileapp?: boolean;
	iosapp?: boolean;
	tablet?: boolean;
	tag?: string;
	accessibility?: { combination?: string; };
}

interface MenuStructure {
	id?: string;
	type: string;
	enabled: boolean;
	text?: string;
	command?: string;
	executionType?: string;
	data?: MenuItem;
	children: MenuStructure[];
	checked?: boolean;
}

interface SmartMenusOptions {
	hideOnClick?: boolean;
	showOnClick?: boolean;
	hideTimeout?: number;
	hideDuration?: number;
	hideFunction?: (() => void) | null;
	showDuration?: number;
	showFunction?: (() => void) | null;
	showTimeout?: number;
	collapsibleHideDuration?: number;
	collapsibleHideFunction?: (() => void) | null;
	subIndicatorsPos?: string;
	subIndicatorsText?: string;
}

interface JQuery {
	smartmenus(options?: SmartMenusOptions): JQuery;
	smartmenus(instanceMethod: string): void;
}

/**
 * Menubar control class.
 * This control initializes and manages the application’s menubar,
 * including building menus, binding events, and updating UI states.
 */
class Menubar extends window.L.Control {
	// TODO: Some mechanism to stop the need to copy duplicate menus (eg. Help, eg: mobiledrawing)
	options: {
        initial: MenuItem[];
        text: MenuItem[];
        presentation: MenuItem[];
        drawing: MenuItem[];
        spreadsheet: MenuItem[];
        math: string[];
        mobiletext: MenuItem[];
        mobilepresentation: MenuItem[];
        mobiledrawing: MenuItem[];
        mobilespreadsheet: MenuItem[];
        mobileInsertMenu: Record<string, MenuItem>;
        commandStates: Record<string, any>;
        allowedReadonlyMenus: string[];
        allowedViewModeCommands: string[];
        allowedViewModeActions: (string | (() => string | undefined))[];
        allowedRedlineManagementMenus: string[];
        allowedRedlineManagementModeCommands: string[];
        allowedRedlineManagementModeActions: string[];
    } = {
		initial: [
			{name: _UNO('.uno:PickList')},
			{name: _UNO('.uno:EditMenu')},
			{name: _UNO('.uno:ViewMenu')},
			{name: _UNO('.uno:InsertMenu')},
			{name: _UNO('.uno:ToolsMenu')}
		],
		text:  [
			{name: _UNO('.uno:PickList', 'text'), id: 'file', type: 'menu', accessibility: {combination: 'MF'}, menu: [
				{name: _UNO('.uno:Save', 'text'), unoid: '.uno:Save', id: 'save', type: 'action'},
				{name: _UNO('.uno:SaveAs', 'text'), id: 'saveas', type: window.prefs.get('saveAsMode') === 'group' ? 'menu' : 'action', menu: [
					{name: _('ODF text document (.odt)'), id: 'saveas-odt', type: 'action'},
					{name: _('Word 2003 Document (.doc)'), id: 'saveas-doc', type: 'action'},
					{name: _('Word Document (.docx)'), id: 'saveas-docx', type: 'action'},
					{name: _('Rich Text (.rtf)'), id: 'saveas-rtf', type: 'action'},
				]},
				{name: _('Export as'), id: 'exportas', type: 'menu', menu: [
					{name: _('PDF Document (.pdf)'), id: 'exportas-pdf', type: 'action'},
					{name: _('EPUB (.epub)'), id: 'exportas-epub', type: 'action'},
					{name: _('Markdown (.md)'), id: 'exportas-md', type: 'action'}
				]},
				{name: _('Rename Document'), id: 'renamedocument', type: 'action'},
				{name: _('Share...'), id:'shareas', type: 'action'},
				{name: _('See revision history'), id: 'rev-history', type: 'action'},
				{name: !window.ThisIsAMobileApp ? _('Download as') : _('Export as'), id: 'downloadas', type: 'menu', menu: [
					{name: _('PDF Document (.pdf)'), id: !window.ThisIsAMobileApp ? 'exportdirectpdf' : 'downloadas-pdf', type: 'action'},
					{name: _('PDF Document (.pdf) as...'), id: 'exportpdf' , type: 'action'},
					{name: _('ODF text document (.odt)'), id: 'downloadas-odt', type: 'action'},
					{name: _('Word 2003 Document (.doc)'), id: 'downloadas-doc', type: 'action'},
					{name: _('Word Document (.docx)'), id: 'downloadas-docx', type: 'action'},
					{name: _('Rich Text (.rtf)'), id: 'downloadas-rtf', type: 'action'},
					{name: _('EPUB (.epub)'), id: !window.ThisIsAMobileApp ? 'exportepub' : 'downloadas-epub', type: 'action'},
					{name: _('HTML file (.html)'), id: 'downloadas-html', type: 'action'},
					{name: _('Markdown (.md)'), id: 'downloadas-md', type: 'action'}]},
				{name: _UNO('.uno:SetDocumentProperties', 'text'), uno: '.uno:SetDocumentProperties', id: 'properties'},
				{name: _UNO('.uno:Signature', 'text'), uno: '.uno:Signature', id: 'signature'},
				{name: _('Options'), id: 'settings-dialog', type: 'action', mobileapp: false},
				{type: 'separator'},
				{name: _UNO('.uno:Print', 'text'), unoid: '.uno:Print', id: 'print', type: 'action'},
				{name: _('Close document'), id: 'closedocument', type: 'action'}
			]},
			{name: _UNO('.uno:EditMenu', 'text'), id: 'editmenu', type: 'menu', accessibility: {combination: 'ME'}, menu: [
				{name: _UNO('.uno:Undo', 'text'), uno: '.uno:Undo'},
				{name: _UNO('.uno:Redo', 'text'), uno: '.uno:Redo'},
				{name: _('Repair'), id: 'repair',  type: 'action'},
				{type: 'separator'},
				{name: _UNO('.uno:Cut', 'text'), uno: '.uno:Cut'},
				{name: _UNO('.uno:Copy', 'text'), uno: '.uno:Copy'},
				{name: _UNO('.uno:Paste', 'text'), uno: '.uno:Paste'},
				{name: _UNO('.uno:PasteSpecial', 'text'), uno: '.uno:PasteSpecial'},
				{name: _UNO('.uno:SelectAll', 'text'), uno: '.uno:SelectAll'},
				{type: 'separator'},
				{uno: '.uno:SearchDialog', id: 'searchreplace'},
				{name: _('Find'), id: 'find', type: 'action', shortcut: 'home-search'},
				{type: 'separator'},
				{name: _UNO('.uno:ChangesMenu', 'text'), id: 'changesmenu', type: 'menu', menu: [
					{uno: '.uno:TrackChanges'},
					{name: _('Compare Changes'), id: 'comparechanges', type: 'action'},
					{uno: '.uno:ShowTrackedChanges'},
					{type: 'separator'},
					{uno: '.uno:AcceptTrackedChanges'},
					{uno: '.uno:AcceptTrackedChange'},
					{uno: '.uno:AcceptTrackedChangeToNext'},
					{type: 'action', id: 'acceptalltrackedchanges', uno: '.uno:AcceptAllTrackedChanges'},
					{uno: '.uno:RejectTrackedChange'},
					{uno: '.uno:RejectTrackedChangeToNext'},
					{type: 'action', id: 'rejectalltrackedchanges', uno: '.uno:RejectAllTrackedChanges'},
					{uno: '.uno:ReinstateTrackedChange'},
					{uno: '.uno:PreviousTrackedChange'},
					{uno: '.uno:NextTrackedChange'}
				]},
				{type: 'separator'},
				{name: _UNO('.uno:GotoPage', 'text'), uno: '.uno:GotoPage'}
			]},
			{name: _UNO('.uno:ViewMenu', 'text'), id: 'view', type: 'menu', accessibility: {combination: 'MV'},
			 menu: (window.mode.isTablet() ? [
					{name: _('Reset zoom'), id: 'zoomreset', type: 'action'},
				] as MenuItem[] : [
					{name: _UNO('.uno:FullScreen', 'text'), unoid: '.uno:FullScreen', id: 'fullscreen', type: 'action'},
					{type: 'separator'},
					{name: _UNO('.uno:ZoomPlus', 'text'), unoid: '.uno:ZoomPlus', id: 'zoomin', type: 'action'},
					{name: _UNO('.uno:ZoomMinus', 'text'), unoid: '.uno:ZoomMinus', id: 'zoomout', type: 'action',},
					{name: _('Fit to Screen'), id: 'fitwidthzoom', type: 'action'},
				] as MenuItem[]).concat([
					{type: 'separator'},
					{name: _('Toggle UI Mode'), id: 'toggleuimode', type: 'action'},
					{name: _('Multi Page View'), id: 'multipageview', type: 'action'},
					{name: _('Show Ruler'), id: 'showruler', type: 'action'},
					{name: _('Show Status Bar'), id: 'showstatusbar', type: 'action'},
					{name: _('Hide Menu Bar'), id: 'togglemenubar', type: 'action'},
					{name: _('Dark Mode'), id: 'toggledarktheme', type: 'action'},
					{name: _('Invert Background'), id: 'invertbackground', type: 'action'},
					{uno: '.uno:SidebarDeck.PropertyDeck', id: 'view-sidebar-property-deck', name: _UNO('.uno:Sidebar')},
					{uno: '.uno:SidebarDeck.StyleListDeck', name: _('Style list')},
					{uno: '.uno:SidebarDeck.InspectorDeck', name: _('Style inspector')},
					{uno: '.uno:Navigator', id: 'navigator'},
					{type: 'separator'},
					{name: _UNO('.uno:ShowAnnotations', 'text'), unoid: '.uno:ShowAnnotations', id: 'showannotations', type: 'action'},
					{name: _UNO('.uno:ShowResolvedAnnotations', 'text'), unoid: '.uno:ShowResolvedAnnotations', id: 'showresolved', type: 'action'},
					{uno: '.uno:ControlCodes'},
					{uno: '.uno:ShowBoundaries', id: 'showboundaries'},
				])},
			{name: _UNO('.uno:InsertMenu', 'text'), id: 'insert', type: 'menu', accessibility: {combination: 'MN'}, menu: [
				{name: _('Local Image...'), id: 'insertgraphic', type: 'action'},
				{name: _UNO('.uno:InsertGraphic', 'text'), unoid: '.uno:InsertGraphic', id: 'insertgraphicremote', type: 'action'},
				{name: _UNO('.uno:InsertAnnotation', 'text'), unoid: '.uno:InsertAnnotation', id: 'insertcomment', type: 'action'},
				{uno: '.uno:InsertObjectChart'},
				{name: _('Shapes ...'), unoid: '.uno:ShapesMenu', id: 'insertshape', type: 'action'},
				{name: _UNO('.uno:FontworkGalleryFloater'), uno: '.uno:FontworkGalleryFloater', id: 'fontworkgalleryfloater'},
				{name: _UNO('.uno:DrawText'), uno: '.uno:DrawText'},
				{name: _UNO('.uno:InsertFrame', 'text'), uno: '.uno:InsertFrame'},
				{name: _UNO('.uno:VerticalText'), uno: '.uno:VerticalText'},
				{type: 'separator'},
				{uno: '.uno:InsertSection', id: 'insertsection'},
				{uno: '.uno:PageNumberWizard', id: 'pagenumberwizard'},
				{name: _UNO('.uno:InsertFieldCtrl', 'text'), type: 'menu', menu: [
					{uno: '.uno:InsertPageNumberField'},
					{uno: '.uno:InsertPageCountField'},
					{uno: '.uno:InsertDateField'},
					{uno: '.uno:InsertTimeField'},
					{uno: '.uno:InsertTitleField'},
					{uno: '.uno:InsertAuthorField'},
					{uno: '.uno:InsertTopicField'},
					{type: 'separator'},
					{uno: '.uno:InsertField'},
				]},
				{name: _UNO('.uno:InsertHeaderFooterMenu', 'text'), type: 'menu', menu: [
					{name: _UNO('.uno:InsertPageHeader', 'text'), type: 'menu', menu: [
						{name: _('All'), disabled: true, id: 'insertheader', tag: '_ALL_', uno: '.uno:InsertPageHeader?'}]},
					{name: _UNO('.uno:InsertPageFooter', 'text'), type: 'menu', menu: [
						{name: _('All'), disabled: true, id: 'insertfooter', tag: '_ALL_', uno: '.uno:InsertPageFooter?'}]}
				]},
				{name: _UNO('.uno:InsertFootnote', 'text'), uno: '.uno:InsertFootnote'},
				{name: _UNO('.uno:InsertEndnote', 'text'), uno: '.uno:InsertEndnote'},
				{type: 'separator'},
				{uno: '.uno:InsertPagebreak'},
				{uno: '.uno:InsertBreak'},
				{name: _UNO('.uno:InsertColumnBreak', 'spreadsheet'), uno: '.uno:InsertColumnBreak'},
				{type: 'separator'},
				{name: _UNO('.uno:HyperlinkDialog'), unoid: '.uno:HyperlinkDialog', id: 'inserthyperlink', type: 'action'},
				{name: _('Smart Picker'), id: 'remotelink', type: 'action'},
				{name: _('AI Assistant'), id: 'remoteaicontent', type: 'action'},
				{type: 'separator'},
				{uno: '.uno:InsertQrCode'},
				{uno: '.uno:InsertSymbol'},
				{uno: '.uno:InsertObjectStarMath'},
				{name: _UNO('.uno:FormattingMarkMenu', 'text'), type: 'menu', menu: [
					{uno: '.uno:InsertNonBreakingSpace'},
					{uno: '.uno:InsertHardHyphen'},
					{uno: '.uno:InsertSoftHyphen'},
					{uno: '.uno:InsertZWSP'},
					{uno: '.uno:InsertWJ'},
					{uno: '.uno:InsertLRM'},
					{uno: '.uno:InsertRLM'}]},
			]},
			{name: _UNO('.uno:FormatMenu', 'text'), id: 'format', type: 'menu', accessibility: {combination: 'MO'}, menu: [
				{name: _UNO('.uno:FormatTextMenu', 'text'), type: 'menu', menu: [
					{name: _UNO('.uno:Bold', 'text'), uno: '.uno:Bold'},
					{name: _UNO('.uno:Italic', 'text'), uno: '.uno:Italic'},
					{name: _UNO('.uno:Underline', 'text'), uno: '.uno:Underline'},
					{name: _UNO('.uno:UnderlineDouble', 'text'), uno: '.uno:UnderlineDouble'},
					{name: _UNO('.uno:Strikeout', 'text'), uno: '.uno:Strikeout'},
					{uno: '.uno:Overline'},
					{type: 'separator'},
					{name: _UNO('.uno:SuperScript', 'text'), uno: '.uno:SuperScript'},
					{name: _UNO('.uno:SubScript', 'text'), uno: '.uno:SubScript'},
					{type: 'separator'},
					{uno: '.uno:Shadowed'},
					{uno: '.uno:OutlineFont'},
					{type: 'separator'},
					{uno: '.uno:Grow'},
					{uno: '.uno:Shrink'},
					{type: 'separator'},
					{uno: '.uno:ChangeCaseToUpper'},
					{uno: '.uno:ChangeCaseToLower'},
					{uno: '.uno:ChangeCaseRotateCase'},
					{type: 'separator'},
					{uno: '.uno:ChangeCaseToSentenceCase'},
					{uno: '.uno:ChangeCaseToTitleCase'},
					{uno: '.uno:ChangeCaseToToggleCase'},
					{type: 'separator'},
					{uno: '.uno:SmallCaps'}]},
				{name: _('Text orientation'), type: 'menu', menu: [
					{uno: '.uno:ParaLeftToRight'},
					{uno: '.uno:ParaRightToLeft'}]},
				{name: _UNO('.uno:FormatSpacingMenu', 'text'), type: 'menu', menu: [
					{uno: '.uno:SpacePara1'},
					{uno: '.uno:SpacePara115'},
					{uno: '.uno:SpacePara15'},
					{uno: '.uno:SpacePara2'},
					{type: 'separator'},
					{uno: '.uno:ParaspaceIncrease'},
					{uno: '.uno:ParaspaceDecrease'},
					{type: 'separator'},
					{uno: '.uno:IncrementIndent'},
					{uno: '.uno:DecrementIndent'}]},
				{name: _UNO('.uno:TextAlign', 'text'), type: 'menu', menu: [
					{name: _UNO('.uno:CommonAlignLeft', 'text'), uno: '.uno:CommonAlignLeft'},
					{name: _UNO('.uno:CommonAlignHorizontalCenter', 'text'), uno: '.uno:CommonAlignHorizontalCenter'},
					{name: _UNO('.uno:CommonAlignRight', 'text'), uno: '.uno:CommonAlignRight'},
					{name: _UNO('.uno:CommonAlignJustified', 'text'), uno: '.uno:CommonAlignJustified'},
					{type: 'separator'},
					{uno: '.uno:CommonAlignTop'},
					{uno: '.uno:CommonAlignVerticalCenter'},
					{uno: '.uno:CommonAlignBottom'}]},
				{name: _UNO('.uno:FormatBulletsMenu', 'text'), type: 'menu', menu: [
					{uno: '.uno:DefaultBullet'},
					{uno: '.uno:DefaultNumbering'},
					{type: 'separator'},
					{uno: '.uno:DecrementLevel'},
					{uno: '.uno:IncrementLevel'},
					{uno: '.uno:DecrementSubLevels'},
					{uno: '.uno:IncrementSubLevels'},
					{type: 'separator'},
					{uno: '.uno:MoveDown'},
					{uno: '.uno:MoveUp'},
					{uno: '.uno:MoveDownSubItems'},
					{uno: '.uno:MoveUpSubItems'},
					{type: 'separator'},
					{uno: '.uno:InsertNeutralParagraph'},
					{uno: '.uno:NumberingStart'},
					{uno: '.uno:RemoveBullets'},
					{type: 'separator'},
					{uno: '.uno:JumpDownThisLevel'},
					{uno: '.uno:JumpUpThisLevel'},
					{uno: '.uno:ContinueNumbering'}]},
				{type: 'separator'},
				{uno: '.uno:FormatPaintbrush'},
				{uno: '.uno:ResetAttributes'},
				{type: 'separator'},
				{uno: '.uno:FontDialog'},
				{uno: '.uno:ParagraphDialog'},
				{uno: '.uno:SidebarDeck.StyleListDeck'},
				{uno: '.uno:OutlineBullet'},
				{uno: '.uno:ThemeDialog'},
				{type: 'separator'},
				{uno: '.uno:PageDialog'},
				{uno: '.uno:TitlePageDialog'},
				{uno: '.uno:FormatColumns'},
				{uno: '.uno:Watermark'},
				{uno: '.uno:EditRegion'},
				{type: 'separator'},
				{uno: '.uno:TransformDialog'},
				{uno: '.uno:FormatLine'},
				{uno: '.uno:FormatArea'},
				{uno: '.uno:NameGroup'},
				{uno: '.uno:ObjectTitleDescription'},
				{type: 'separator'},
				{uno: '.uno:ChangeFont'},
				{uno: '.uno:ChangeFontSize'},
				{uno: '.uno:ChangeDistance'},
				{uno: '.uno:ChangeAlignment'}
			]},
			{name: _('References'), id: 'references', type: 'menu', accessibility: {combination: 'MR'}, menu: [
				{name: _UNO('.uno:IndexesMenu', 'text'), uno: '.uno:InsertMultiIndex'},
				{uno: '.uno:InsertIndexesEntry'},
				{name: _('Update Index'), uno: '.uno:UpdateCurIndex'},
				{type: 'separator'},
				{uno: '.uno:InsertFootnote'},
				{uno: '.uno:InsertEndnote'},
				{uno: '.uno:FootnoteDialog'},
				{type: 'separator'},
				{uno: '.uno:InsertBookmark'},
				{uno: '.uno:InsertReferenceField'},
				{id: 'zoteroseparator', type: 'separator', hidden: !window.zoteroEnabled},
				{name: _('Add Citation'), id: 'zoteroaddeditcitation', type: 'action', hidden: !window.zoteroEnabled},
				{name: _('Add Citation Note'), id: 'zoteroaddnote', type: 'action', hidden: !window.zoteroEnabled},
				{name: _('Add Bibliography'), id: 'zoteroaddeditbibliography', type: 'action', hidden: !window.zoteroEnabled},
				{id: 'zoteroseparator2', type: 'separator', hidden: !window.zoteroEnabled},
				{name: _('Refresh Citations'), id: 'zoterorefresh', type: 'action', hidden: !window.zoteroEnabled},
				{name: _('Unlink Citations'), id: 'zoterounlink', type: 'action', hidden: !window.zoteroEnabled},
				{name: _('Citation Preferences'), id: 'zoterosetdocprefs', type: 'action', iosapp: false, hidden: !window.zoteroEnabled}]
			},
			{name: _UNO('.uno:TableMenu', 'text'), type: 'menu', id: 'table', accessibility: {combination: 'MB'}, menu: [
				{uno: '.uno:InsertTable'},
				{name: _UNO('.uno:TableInsertMenu', 'text'), type: 'menu', menu: [
					{uno: '.uno:InsertRowsBefore'},
					{uno: '.uno:InsertRowsAfter'},
					{type: 'separator'},
					{uno: '.uno:InsertColumnsBefore'},
					{uno: '.uno:InsertColumnsAfter'}]},
				{name: _UNO('.uno:TableDeleteMenu', 'text'), type: 'menu', menu: [
					{uno: '.uno:DeleteRows'},
					{uno: '.uno:DeleteColumns'},
					{uno: '.uno:DeleteTable'}]},
				{name: _UNO('.uno:TableSelectMenu', 'text'), type: 'menu', menu: [
					{uno: '.uno:SelectTable'},
					{uno: '.uno:EntireRow'},
					{uno: '.uno:EntireColumn'},
					{uno: '.uno:EntireCell'}]},
				{uno: '.uno:SplitCell'},
				{uno: '.uno:MergeCells'},
				{name: _UNO('.uno:TableAutoFitMenu'), type: 'menu', menu: [
					{uno: '.uno:SetMinimalRowHeight'},
					{uno: '.uno:SetOptimalRowHeight'},
					{uno: '.uno:DistributeRows'},
					{type: 'separator'},
					{uno: '.uno:SetMinimalColumnWidth'},
					{uno: '.uno:SetOptimalColumnWidth'},
					{uno: '.uno:DistributeColumns'}]},
				{type: 'separator'},
				{uno: '.uno:Protect'},
				{uno: '.uno:UnsetCellsReadOnly'},
				{type: 'separator'},
				{uno: '.uno:TableDialog'}
			]},
			{name: _UNO('.uno:FormatFormMenu', 'text'), id: 'form', type: 'menu', accessibility: {combination: 'MM'}, menu: [
				{name: _('Insert Rich Text'), uno: '.uno:InsertContentControl'},
				{name: _('Insert Checkbox'), uno: '.uno:InsertCheckboxContentControl'},
				{name: _('Insert Dropdown'), uno: '.uno:InsertDropdownContentControl'},
				{name: _('Insert Picture'), uno: '.uno:InsertPictureContentControl'},
				{name: _('Insert Date'), uno: '.uno:InsertDateContentControl'},
				{name: _('Properties'), uno: '.uno:ContentControlProperties'},
			]},
			{name: _UNO('.uno:ToolsMenu', 'text'), id: 'tools', type: 'menu', accessibility: {combination: 'MT'}, menu: [
				{uno: '.uno:SpellingAndGrammarDialog'},
				{uno: '.uno:SpellOnline'},
				window.deeplEnabled ?
					{
						uno: '.uno:Translate'
					}: {},
				{uno: '.uno:ThesaurusDialog'},
				{name: _UNO('.uno:LanguageMenu'), type: 'menu', menu: [
					{name: _UNO('.uno:SetLanguageSelectionMenu', 'text'), type: 'menu', menu: [
						{name: _('None (Do not check spelling)'), id: 'noneselection', uno: '.uno:LanguageStatus?Language:string=Current_LANGUAGE_NONE'} ]},
					{name: _UNO('.uno:SetLanguageParagraphMenu', 'text'), type: 'menu', menu: [
						{name: _('None (Do not check spelling)'), id: 'noneparagraph', uno: '.uno:LanguageStatus?Language:string=Paragraph_LANGUAGE_NONE'} ]},
					{name: _UNO('.uno:SetLanguageAllTextMenu', 'text'), type: 'menu', menu: [
						{name: _('None (Do not check spelling)'), id: 'nonelanguage', uno: '.uno:LanguageStatus?Language:string=Default_LANGUAGE_NONE'}]}
				]},
				{uno: '.uno:WordCountDialog'},
				window.enableAccessibility ?
					{name: _('Screen Reading'), id: 'togglea11ystate', type: 'action'} : {},
				{uno: '.uno:SidebarDeck.A11yCheckDeck'},
				{type: 'separator'},
				{name: _UNO('.uno:AutoFormatMenu', 'text'), type: 'menu', menu: [
					{uno: '.uno:OnlineAutoFormat'}]},
				{type: 'separator'},
				{uno: '.uno:ChapterNumberingDialog'},
				{uno: '.uno:LineNumberingDialog'},
				{uno: '.uno:FootnoteDialog'},
				{type: 'separator'},
				{name: _UNO('.uno:RunMacro'), id: 'runmacro', uno: '.uno:RunMacro'}
			]},
			{name: _('Extensions'), id: 'extensions-menu', type: 'menu', menu: []},
			{name: _UNO('.uno:HelpMenu', 'text'), id: 'help', type: 'menu', accessibility: {combination: 'MY'}, menu: [
				{name: _('Online Help'), id: 'online-help', type: 'action', iosapp: false},
				{type: 'separator', iosapp: false},
				{name: _('Keyboard shortcuts'), id: 'keyboard-shortcuts', type: 'action', iosapp: false},
				{type: 'separator'},
				{name: _('Server audit'), id: 'serveraudit', type: 'action', mobileapp: false},
				{type: 'separator'},
				{name: _('About'), id: 'about', type: 'action'}]
			},
			{name: _('Last modification'), id: 'last-mod', type: 'action', tablet: false}
		],

		presentation: [
			{name: _UNO('.uno:PickList', 'presentation'), id: 'file', type: 'menu', accessibility: {combination: 'MF'}, menu: [
				{name: _UNO('.uno:Save', 'presentation'), unoid: '.uno:Save', id: 'save', type: 'action'},
				{name: _UNO('.uno:SaveAs', 'presentation'), id: 'saveas', type: window.prefs.get('saveAsMode') === 'group' ? 'menu' : 'action', menu: [
					{name: _('ODF presentation (.odp)'), id: 'saveas-odp', type: 'action'},
					{name: _('PowerPoint 2003 Presentation (.ppt)'), id: 'saveas-ppt', type: 'action'},
					{name: _('PowerPoint Presentation (.pptx)'), id: 'saveas-pptx', type: 'action'},
				]},
				{name: _('Export as'), id: 'exportas', type: 'menu', menu: [
					{name: _('PDF Document (.pdf)'), id: 'exportas-pdf', type: 'action'}
				]},
				{name: _('Save Comments'), id: 'savecomments', type: 'action'},
				{name: _('Share...'), id:'shareas', type: 'action'},
				{name: _('See revision history'), id: 'rev-history', type: 'action'},
				{name: !window.ThisIsAMobileApp ? _('Download as') : _('Export as'), id: 'downloadas', type: 'menu', menu: [
					{name: _('PDF Document (.pdf)'), id: !window.ThisIsAMobileApp ? 'exportdirectpdf' : 'downloadas-pdf', type: 'action'},
					{name: _('PDF Document (.pdf) as...'), id: 'exportpdf' , type: 'action'},
					{name: _('ODF presentation (.odp)'), id: 'downloadas-odp', type: 'action'},
					{name: _('PowerPoint 2003 Presentation (.ppt)'), id: 'downloadas-ppt', type: 'action'},
					{name: _('PowerPoint Presentation (.pptx)'), id: 'downloadas-pptx', type: 'action'},
					{name: _('HTML Document (.html)'), id: 'downloadas-html', type: 'action'},
					{name: _('Scalable Vector Graphics (.svg)'), id: 'downloadas-svg', type: 'action'},
					{name: _('Current slide as Bitmap (.bmp)'), id: 'downloadas-bmp', type: 'action'},
					{name: _('Current slide as Graphics Interchange Format (.gif)'), id: 'downloadas-gif', type: 'action'},
					{name: _('Current slide as Portable Network Graphics (.png)'), id: 'downloadas-png', type: 'action'},
					{name: _('Current slide as Tag Image File Format (.tiff)'), id: 'downloadas-tiff', type: 'action'},
				]},
				{name: _UNO('.uno:SetDocumentProperties', 'presentation'), uno: '.uno:SetDocumentProperties', id: 'properties'},
				{name: _UNO('.uno:Signature', 'presentation'), uno: '.uno:Signature', id: 'signature'},
				{name: _('Options'), id: 'settings-dialog', type: 'action', mobileapp: false},
				{type: 'separator'},
				{name: _UNO('.uno:Print', 'presentation'), id: 'print', type: 'menu', menu: [
					{name: _('Full Page Slides'), id: 'print', type: 'action'},
					{name: _('Notes Pages'), id: 'print-notespages' , type: 'action'},
				]},
				{name: _('Close document'), id: 'closedocument', type: 'action'}
			]},
			{name: _UNO('.uno:EditMenu', 'presentation'), id: 'editmenu', type: 'menu', accessibility: {combination: 'ME'}, menu: [
				{name: _UNO('.uno:Undo', 'presentation'), uno: '.uno:Undo'},
				{name: _UNO('.uno:Redo', 'presentation'), uno: '.uno:Redo'},
				{name: _('Repair'), id: 'repair',  type: 'action'},
				{type: 'separator'},
				{name: _UNO('.uno:Cut', 'presentation'), uno: '.uno:Cut'},
				{name: _UNO('.uno:Copy', 'presentation'), uno: '.uno:Copy'},
				{name: _UNO('.uno:Paste', 'presentation'), uno: '.uno:Paste'},
				{name: _UNO('.uno:PasteSpecial', 'presentation'), uno: '.uno:PasteSpecial'},
				{name: _UNO('.uno:SelectAll', 'presentation'), uno: '.uno:SelectAll'},
				{type: 'separator'},
				{uno: '.uno:SearchDialog', id: 'searchreplace'},
				{name: _('Find'), id: 'find', type: 'action', shortcut: 'home-search'}
			]},
			{name: _UNO('.uno:ViewMenu', 'presentation'), id: 'view', type: 'menu', accessibility: {combination: 'MV'},
			 menu: (window.mode.isTablet() ? [
					{name: _('Reset zoom'), id: 'zoomreset', type: 'action'},
				] as MenuItem[] : [
					{name: _UNO('.uno:FullScreen', 'presentation'), unoid: '.uno:FullScreen', id: 'fullscreen', type: 'action'},
				   {type: 'separator'},
					{name: _UNO('.uno:ZoomPlus', 'presentation'), unoid: '.uno:ZoomPlus', id: 'zoomin', type: 'action'},
					{name: _UNO('.uno:ZoomMinus', 'presentation'), unoid: '.uno:ZoomMinus', id: 'zoomout', type: 'action'},
				   {name: _('Reset zoom'), id: 'zoomreset', type: 'action'},
				] as MenuItem[]).concat([
				   {type: 'separator'},
				   {uno: '.uno:GridVisible', name: _UNO('.uno:GridVisible')},
				   {uno: '.uno:GridUse', name: _UNO('.uno:GridUse')},
				   {type: 'separator'},
				   {name: _('Toggle UI Mode'), id: 'toggleuimode', type: 'action'},
				   {name: _('Show Ruler'), id: 'showruler', type: 'action'},
				   {name: _('Show Status Bar'), id: 'showstatusbar', type: 'action'},
				   {name: _('Notes View'), id: 'notesmode', type: 'action'},
				   {name: _('Hide Menu Bar'), id: 'togglemenubar', type: 'action'},
				   {name: _('Dark Mode'), id: 'toggledarktheme', type: 'action'},
				   {name: _('Invert Background'), id: 'invertbackground', type: 'action'},
				   {name: _('Master View'), uno: '.uno:SlideMasterPage'},
				   {uno: '.uno:SidebarDeck.PropertyDeck', name: _UNO('.uno:Sidebar')},
				   {uno: '.uno:Navigator', id: 'navigator'},
				   {type: 'separator'},
				   {uno: '.uno:ModifyPage'},
					 {name: _UNO('.uno:SlideChangeWindow', 'presentation', true), unoid: '.uno:SlideChangeWindow', id: 'transitiondeck', type: 'action'},
					 {uno: '.uno:MasterSlidesPanel'},
					 {uno: '.uno:CustomAnimation'}, // core version
				   //{name: _UNO('.uno:CustomAnimation', 'presentation', true), id: 'animationdeck', type: 'action'}, // online version
				])},
			{name: _UNO('.uno:InsertMenu', 'presentation'), id: 'insert', type: 'menu', accessibility: {combination: 'MN'}, menu: [
				{name: _('Local Image...'), id: 'insertgraphic', type: 'action'},
				{name: _UNO('.uno:InsertGraphic', 'presentation'), unoid: '.uno:InsertGraphic', id: 'insertgraphicremote', type: 'action'},
				{name: _('Local Multimedia...'), id: 'insertmultimedia', type: 'action'},
				{name: _UNO('.uno:SelectBackground', 'presentation'), unoid: '.uno:SelectBackground', id: 'selectbackground', type: 'action'},
				{name: _UNO('.uno:InsertAnnotation', 'presentation'), unoid: '.uno:InsertAnnotation', id: 'insertcomment', type: 'action'},
				{uno: '.uno:InsertObjectChart'},
				{name: _('Shapes ...'), unoid: '.uno:ShapesMenu', id: 'insertshape', type: 'action'},
				{name: _UNO('.uno:FontworkGalleryFloater'), uno: '.uno:FontworkGalleryFloater', id: 'fontworkgalleryfloater'},
				{name: _UNO('.uno:Text', 'presentation'), unoid: '.uno:Text', id: 'inserttextbox', type: 'action'},
				{name: _UNO('.uno:VerticalText'), uno: '.uno:VerticalText'},
				{type: 'separator'},
				{name: _UNO('.uno:HyperlinkDialog'), unoid: '.uno:HyperlinkDialog', id: 'inserthyperlink', type: 'action'},
				{name: _('Smart Picker'), id: 'remotelink', type: 'action'},
				{name: _('AI Assistant'), id: 'remoteaicontent', type: 'action'},
				{type: 'separator'},
				{uno: '.uno:InsertSymbol'},
				{type: 'separator'},
				{uno: '.uno:HeaderAndFooter'},
				{type: 'separator'},
				{name: _UNO('.uno:InsertField', 'text'), id: 'insertfield', type: 'menu', menu: [
					{uno: '.uno:InsertDateFieldFix'},
					{uno: '.uno:InsertDateFieldVar'},
					{uno: '.uno:InsertTimeFieldFix'},
					{uno: '.uno:InsertTimeFieldVar'},
					{type: 'separator'},
					{name: _UNO('.uno:InsertSlideField', 'presentation'), uno: '.uno:InsertPageField'},
					{name: _UNO('.uno:InsertSlideTitleField', 'presentation'), uno: '.uno:InsertPageTitleField'},
					{name: _UNO('.uno:InsertSlidesField', 'presentation'), uno: '.uno:InsertPagesField'},
				]},
			]},
			{name: _UNO('.uno:FormatMenu', 'presentation'), id: 'format', type: 'menu', accessibility: {combination: 'MO'}, menu: [
				{uno: '.uno:FontDialog'},
				{uno: '.uno:ParagraphDialog'},
				{name: _UNO('.uno:SlideSetup', 'presentation'), uno: '.uno:PageSetup'},
				{type: 'separator'},
				{uno: '.uno:TransformDialog'},
				{uno: '.uno:FormatLine'},
				{uno: '.uno:FormatArea'},
				{uno: '.uno:NameGroup'},
				{uno: '.uno:ObjectTitleDescription'},
				{type: 'separator'},
				{uno: '.uno:OutlineBullet'},
				{uno: '.uno:ThemeDialog'}]
			},
			{name: _UNO('.uno:TableMenu', 'text'/*HACK should be 'presentation', but not in xcu*/), id:'table', type: 'menu', accessibility: {combination: 'MB'}, menu: [
				{name: _UNO('.uno:InsertTable', 'text'), uno: '.uno:InsertTable'},
				{name: _UNO('.uno:TableInsertMenu', 'text'/*HACK should be 'presentation', but not in xcu*/), type: 'menu', menu: [
					{uno: '.uno:InsertRowsBefore'},
					{uno: '.uno:InsertRowsAfter'},
					{type: 'separator'},
					{uno: '.uno:InsertColumnsBefore'},
					{uno: '.uno:InsertColumnsAfter'}]},
				{name: _UNO('.uno:TableDeleteMenu', 'text'/*HACK should be 'presentation', but not in xcu*/), type: 'menu', menu: [
					{uno: '.uno:DeleteRows'},
					{uno: '.uno:DeleteColumns'},
					{uno: '.uno:DeleteTable'}]},
				{name: _UNO('.uno:TableSelectMenu', 'text'), type: 'menu', menu: [
					{uno: '.uno:SelectTable'},
					{uno: '.uno:EntireRow'},
					{uno: '.uno:EntireColumn'}]},
				{uno: '.uno:MergeCells'},
				{name: _UNO('.uno:TableAutoFitMenu'), type: 'menu', menu: [
					{uno: '.uno:SetMinimalRowHeight'},
					{uno: '.uno:SetOptimalRowHeight'},
					{uno: '.uno:DistributeRows'},
					{type: 'separator'},
					{uno: '.uno:SetMinimalColumnWidth'},
					{uno: '.uno:SetOptimalColumnWidth'},
					{uno: '.uno:DistributeColumns'}]},
				{uno: '.uno:TableDialog'}]
			},
			{name: _UNO('.uno:SlideMenu', 'presentation'), id: 'slide', type: 'menu', accessibility: {combination: 'MS'}, menu: [
				{name: _UNO('.uno:InsertSlide', 'presentation'), unoid: '.uno:InsertSlide', id: 'insertpage', type: 'action'},
				{name: _UNO('.uno:DuplicateSlide', 'presentation'), unoid: '.uno:DuplicateSlide', id: 'duplicatepage', type: 'action'},
				{name: _UNO('.uno:DeleteSlide', 'presentation'), unoid: '.uno:DeleteSlide', id: 'deletepage', type: 'action'},
				{name: _UNO('.uno:ShowSlide', 'presentation'), unoid: '.uno:ShowSlide', id: 'showslide', type: 'action'},
				{name: _UNO('.uno:HideSlide', 'presentation'), unoid: '.uno:HideSlide', id: 'hideslide', type: 'action'},
				{type: 'separator'},
				{name: _UNO('.uno:GotoSlide', 'presentation'), uno: '.uno:GotoPage'},
				{type: 'separator', id: 'fullscreen-presentation-separator'},
				{name: _('Fullscreen presentation'), id: 'fullscreen-presentation', type: 'action'},
				{name: _('Present current slide'), id: 'presentation-currentslide', type: 'action'},
				{name: _('Present in new window'), id: 'present-in-window', type: 'action'},
				...((!window.ThisIsAMobileApp || window.mode.isCODesktop()) ? [
					{name: _('Presenter Console'), id: 'presentation-in-console', type: 'action'}
				] : [])
			]
			},
			{name: _UNO('.uno:ToolsMenu', 'presentation'), id: 'tools', type: 'menu', accessibility: {combination: 'MT'}, menu: [
				{uno: '.uno:SpellDialog'},
				{uno: '.uno:SpellOnline'},
				{name: _UNO('.uno:LanguageMenu'), type: 'menu', menu: [
					{name: _('None (Do not check spelling)'), id: 'nonelanguage', uno: '.uno:LanguageStatus?Language:string=Default_LANGUAGE_NONE'}]},
				{type: 'separator'},
				{name: _UNO('.uno:RunMacro'), id: 'runmacro', uno: '.uno:RunMacro'}

			]},
			{name: _('Extensions'), id: 'extensions-menu', type: 'menu', menu: []},
			{name: _UNO('.uno:HelpMenu', 'presentation'), id: 'help', type: 'menu', accessibility: {combination: 'MY'}, menu: [
				{name: _('Online Help'), id: 'online-help', type: 'action', iosapp: false},
				{type: 'separator', iosapp: false},
				{name: _('Keyboard shortcuts'), id: 'keyboard-shortcuts', type: 'action', iosapp: false},
				{type: 'separator'},
				{name: _('Server audit'), id: 'serveraudit', type: 'action', mobileapp: false},
				{type: 'separator'},
				{name: _('About'), id: 'about', type: 'action'}]
			},
			{name: _('Last modification'), id: 'last-mod', type: 'action', tablet: false}
		],

		drawing: [
			{name: _UNO('.uno:PickList', 'presentation'), id: 'file', type: 'menu', accessibility: {combination: 'MF'}, menu: [
				{name: _UNO('.uno:Save', 'presentation'), unoid: '.uno:Save', id: 'save', type: 'action'},
				{name: _UNO('.uno:SaveAs', 'presentation'), unoid: '.uno:SaveAs', id: 'saveas', type: 'action'},
				{name: _('Export as'), id: 'exportas', type: 'menu', menu: [
					{name: _('PDF Document (.pdf)'), id: 'exportas-pdf', type: 'action'}
				]},
				{name: _('Save Comments'), id: 'savecomments', type: 'action'},
				{name: _('Share...'), id:'shareas', type: 'action'},
				{name: _UNO('.uno:Print', 'presentation'), unoid: '.uno:Print', id: 'print', type: 'action'},
				{name: _('See revision history'), id: 'rev-history', type: 'action'},
				{name: !window.ThisIsAMobileApp ? _('Download as') : _('Export as'), id: 'downloadas', type: 'menu', menu: [
					{name: _('PDF Document (.pdf)'), id: !window.ThisIsAMobileApp ? 'exportdirectpdf' : 'downloadas-pdf', type: 'action'},
					{name: _('PDF Document (.pdf) as...'), id: 'exportpdf' , type: 'action'},
					{name: _('ODF Drawing (.odg)'), id: 'downloadas-odg', type: 'action'}
				]},
				{name: _UNO('.uno:SetDocumentProperties', 'presentation'), uno: '.uno:SetDocumentProperties', id: 'properties'},
				{name: _UNO('.uno:Signature', 'presentation'), uno: '.uno:Signature', id: 'signature'},
				{name: _('Options'), id: 'settings-dialog', type: 'action', mobileapp: false},
				{type: 'separator'},
				{name: _('Close document'), id: 'closedocument', type: 'action'}
			]},
			{name: _UNO('.uno:EditMenu', 'presentation'), id: 'editmenu', type: 'menu', accessibility: {combination: 'ME'}, menu: [
				{name: _UNO('.uno:Undo', 'presentation'), uno: '.uno:Undo'},
				{name: _UNO('.uno:Redo', 'presentation'), uno: '.uno:Redo'},
				{name: _('Repair'), id: 'repair',  type: 'action'},
				{type: 'separator'},
				{name: _UNO('.uno:Cut', 'presentation'), uno: '.uno:Cut'},
				{name: _UNO('.uno:Copy', 'presentation'), uno: '.uno:Copy'},
				{name: _UNO('.uno:Paste', 'presentation'), uno: '.uno:Paste'},
				{name: _UNO('.uno:PasteSpecial', 'presentation'), uno: '.uno:PasteSpecial'},
				{name: _UNO('.uno:SelectAll', 'presentation'), uno: '.uno:SelectAll'},
				{type: 'separator'},
				{uno: '.uno:SearchDialog', id: 'searchreplace'},
				{name: _('Find'), id: 'find', type: 'action', shortcut: 'home-search'}
			]},
			{name: _UNO('.uno:ViewMenu', 'presentation'), id: 'view', type: 'menu', accessibility: {combination: 'MV'},
			 menu: (window.mode.isTablet() ? [
					{name: _('Reset zoom'), id: 'zoomreset', type: 'action'},
				] as MenuItem[] : [
					{name: _UNO('.uno:FullScreen', 'presentation'), unoid: '.uno:FullScreen', id: 'fullscreen', type: 'action'},
					{type: 'separator'},
					{name: _UNO('.uno:ZoomPlus', 'presentation'), unoid: '.uno:ZoomPlus', id: 'zoomin', type: 'action'},
					{name: _UNO('.uno:ZoomMinus', 'presentation'), unoid: '.uno:ZoomMinus', id: 'zoomout', type: 'action'},
					{name: _('Reset zoom'), id: 'zoomreset', type: 'action'},
				] as MenuItem[]).concat([
					{type: 'separator'},
					{uno: '.uno:GridVisible', name: _UNO('.uno:GridVisible')},
					{uno: '.uno:GridUse', name: _UNO('.uno:GridUse')},
					{type: 'separator'},
					{name: _('Toggle UI Mode'), id: 'toggleuimode', type: 'action'},
					{name: _('Dark Mode'), id: 'toggledarktheme', type: 'action'},
					{name: _('Invert Background'), id: 'invertbackground', type: 'action'},
					{uno: '.uno:SidebarDeck.PropertyDeck', name: _UNO('.uno:Sidebar')},
					{uno: '.uno:Navigator', id: 'navigator'},
					{name: _('Show Status Bar'), id: 'showstatusbar', type: 'action'},
					{name: _('Hide Menu Bar'), id: 'togglemenubar', type: 'action'},
				])},
			{name: _UNO('.uno:InsertMenu', 'presentation'), id: 'insert', type: 'menu', accessibility: {combination: 'MN'}, menu: [
				{name: _('Local Image...'), id: 'insertgraphic', type: 'action'},
				{name: _UNO('.uno:InsertGraphic', 'presentation'), unoid: '.uno:InsertGraphic', id: 'insertgraphicremote', type: 'action'},
				{name: _UNO('.uno:SelectBackground', 'presentation'), unoid: '.uno:SelectBackground', id: 'selectbackground', type: 'action'},
				{name: _UNO('.uno:InsertAnnotation', 'presentation'), unoid: '.uno:InsertAnnotation', id: 'insertcomment', type: 'action'},
				{uno: '.uno:InsertObjectChart'},
				{name: _('Shapes ...'), unoid: '.uno:ShapesMenu', id: 'insertshape', type: 'action'},
				{type: 'separator'},
				{name: _UNO('.uno:HyperlinkDialog'), unoid: '.uno:HyperlinkDialog', id: 'inserthyperlink', type: 'action'},
				{name: _('Smart Picker'), id: 'remotelink', type: 'action'},
				{name: _('AI Assistant'), id: 'remoteaicontent', type: 'action'},
				{type: 'separator'},
				{uno: '.uno:InsertSymbol'},
				{type: 'separator'},
				{name: _UNO('.uno:InsertField', 'text'), id: 'insertfield', type: 'menu', menu: [
					{name: _UNO('.uno:InsertDateFieldFix', 'presentation'), uno: '.uno:InsertDateFieldFix'},
					{name: _UNO('.uno:InsertDateFieldVar', 'presentation'), uno: '.uno:InsertDateFieldVar'},
					{name: _UNO('.uno:InsertTimeFieldFix', 'presentation'), uno: '.uno:InsertTimeFieldFix'},
					{name: _UNO('.uno:InsertTimeFieldVar', 'presentation'), uno: '.uno:InsertTimeFieldVar'},
					{type: 'separator'},
					{name: _UNO('.uno:InsertPageField', 'presentation'), uno: '.uno:InsertPageField'},
					{name: _UNO('.uno:InsertPageTitleField', 'presentation'), uno: '.uno:InsertPageTitleField'},
					{name: _UNO('.uno:InsertPagesField', 'presentation'), uno: '.uno:InsertPagesField'},
				]},
				{name: _UNO('.uno:InsertSignatureLine'), unoid: '.uno:InsertSignatureLine', id: 'insert-signatureline', type: 'action'},
			]},
			{name: _UNO('.uno:FormatMenu', 'presentation'), id: 'format', type: 'menu', accessibility: {combination: 'MO'}, menu: [
				{uno: '.uno:FontDialog'},
				{uno: '.uno:ParagraphDialog'},
				{name: _UNO('.uno:PageSetup', 'presentation'), uno: '.uno:PageSetup'},
				{type: 'separator'},
				{uno: '.uno:TransformDialog'},
				{uno: '.uno:FormatLine'},
				{uno: '.uno:FormatArea'},
				{uno: '.uno:NameGroup'},
				{uno: '.uno:ObjectTitleDescription'},
				{type: 'separator'},
				{uno: '.uno:OutlineBullet'},
				{uno: '.uno:ThemeDialog'}]
			},
			{name: _UNO('.uno:TableMenu', 'text'/*HACK should be 'presentation', but not in xcu*/), id: 'table', type: 'menu', accessibility: {combination: 'MB'}, menu: [
				{name: _UNO('.uno:InsertTable', 'text'), uno: '.uno:InsertTable'},
				{name: _UNO('.uno:TableInsertMenu', 'text'/*HACK should be 'presentation', but not in xcu*/), type: 'menu', menu: [
					{name: _UNO('.uno:InsertRowsBefore', 'presentation'), uno: '.uno:InsertRowsBefore'},
					{name: _UNO('.uno:InsertRowsAfter', 'presentation'), uno: '.uno:InsertRowsAfter'},
					{type: 'separator'},
					{name: _UNO('.uno:InsertColumnsBefore', 'presentation'), uno: '.uno:InsertColumnsBefore'},
					{name: _UNO('.uno:InsertColumnsAfter', 'presentation'), uno: '.uno:InsertColumnsAfter'}]},
				{name: _UNO('.uno:TableDeleteMenu', 'text'/*HACK should be 'presentation', but not in xcu*/), type: 'menu', menu: [
					{name: _UNO('.uno:DeleteRows', 'presentation'), uno: '.uno:DeleteRows'},
					{name: _UNO('.uno:DeleteColumns', 'presentation'), uno: '.uno:DeleteColumns'},
					{name: _UNO('.uno:DeleteTable', 'presentation'), uno: '.uno:DeleteTable'}]},
				{name: _UNO('.uno:TableSelectMenu', 'text'), type: 'menu', menu: [
					{name: _UNO('.uno:SelectTable', 'presentation'), uno: '.uno:SelectTable'},
					{name: _UNO('.uno:EntireRow', 'presentation'), uno: '.uno:EntireRow'},
					{name: _UNO('.uno:EntireColumn', 'presentation'), uno: '.uno:EntireColumn'}]},
				{name: _UNO('.uno:MergeCells', 'presentation'), uno: '.uno:MergeCells'},
				{name: _UNO('.uno:TableAutoFitMenu'), type: 'menu', menu: [
					{name: _UNO('.uno:SetMinimalRowHeight', 'presentation'), uno: '.uno:SetMinimalRowHeight'},
					{name: _UNO('.uno:SetOptimalRowHeight', 'presentation'), uno: '.uno:SetOptimalRowHeight'},
					{name: _UNO('.uno:DistributeRows', 'presentation'), uno: '.uno:DistributeRows'},
					{type: 'separator'},
					{name: _UNO('.uno:SetMinimalColumnWidth', 'presentation'), uno: '.uno:SetMinimalColumnWidth'},
					{name: _UNO('.uno:SetOptimalColumnWidth', 'presentation'), uno: '.uno:SetOptimalColumnWidth'},
					{name: _UNO('.uno:DistributeColumns', 'presentation'), uno: '.uno:DistributeColumns'}]},
				{name: _UNO('.uno:TableDialog', 'presentation'), uno: '.uno:TableDialog'}]
			},
			{name: _UNO('.uno:PageMenu', 'presentation'), id: 'pagemenu', type: 'menu', accessibility: {combination: 'MP'}, menu: [
				{name: _UNO('.uno:InsertPage', 'presentation'), unoid: '.uno:InsertPage', id: 'insertpage', type: 'action'},
				{name: _UNO('.uno:DuplicatePage', 'presentation'), unoid: '.uno:DuplicatePage', id: 'duplicatepage', type: 'action'},
				{name: _UNO('.uno:DeletePage', 'presentation'), unoid: '.uno:DeletePage', id: 'deletepage', type: 'action'},
				{name: _UNO('.uno:GotoPage', 'presentation'), uno: '.uno:GotoPage'}]
			},
			{name: _UNO('.uno:ToolsMenu', 'presentation'), id: 'tools', type: 'menu', accessibility: {combination: 'MT'}, menu: [
				{uno: '.uno:SpellDialog'},
				{uno: '.uno:SpellOnline'},
				{name: _UNO('.uno:LanguageMenu'), type: 'menu', menu: [
					{name: _('None (Do not check spelling)'), id: 'nonelanguage', uno: '.uno:LanguageStatus?Language:string=Default_LANGUAGE_NONE'}]}
			]},
			{name: _('Extensions'), id: 'extensions-menu', type: 'menu', menu: []},
			{name: _UNO('.uno:HelpMenu', 'presentation'), id: 'help', type: 'menu', accessibility: {combination: 'MY'}, menu: [
				{name: _('Online Help'), id: 'online-help', type: 'action', iosapp: false},
				{type: 'separator', iosapp: false},
				{name: _('Keyboard shortcuts'), id: 'keyboard-shortcuts', type: 'action', iosapp: false},
				{type: 'separator'},
				{name: _('Server audit'), id: 'serveraudit', type: 'action', mobileapp: false},
				{type: 'separator'},
				{name: _('About'), id: 'about', type: 'action'}]
			},
			{name: _('Last modification'), id: 'last-mod', type: 'action', tablet: false}
		],

		spreadsheet: [
			{name: _UNO('.uno:PickList', 'spreadsheet'), id: 'file', type: 'menu', accessibility: {combination: 'MF'}, menu: [
				{name: _UNO('.uno:Save', 'spreadsheet'), unoid: '.uno:Save', id: 'save', type: 'action'},
				{name: _UNO('.uno:SaveAs', 'spreadsheet'), id: 'saveas', type: window.prefs.get('saveAsMode') === 'group' ? 'menu' : 'action', menu: [
					{name: _('ODF spreadsheet (.ods)'), id: 'saveas-ods', type: 'action'},
					{name: _('Excel 2003 Spreadsheet (.xls)'), id: 'saveas-xls', type: 'action'},
					{name: _('Excel Spreadsheet (.xlsx)'), id: 'saveas-xlsx', type: 'action'},
				]},
				{name: _('Export as'), id: 'exportas', type: 'menu', menu: [
					{name: _('PDF Document (.pdf)'), id: 'exportas-pdf', type: 'action'}
				]},
				{name: _('Share...'), id:'shareas', type: 'action'},
				{name: _('See revision history'), id: 'rev-history', type: 'action'},
				{name: !window.ThisIsAMobileApp ? _('Download as') : _('Export as'), id:'downloadas', type: 'menu', menu: [
					{name: _('PDF Document (.pdf)'), id: !window.ThisIsAMobileApp ? 'exportdirectpdf' : 'downloadas-pdf', type: 'action'},
					{name: _('PDF Document (.pdf) as...'), id: 'exportpdf' , type: 'action'},
					{name: _('ODF spreadsheet (.ods)'), id: 'downloadas-ods', type: 'action'},
					{name: _('Excel 2003 Spreadsheet (.xls)'), id: 'downloadas-xls', type: 'action'},
					{name: _('Excel Spreadsheet (.xlsx)'), id: 'downloadas-xlsx', type: 'action'},
					{name: _('CSV file (.csv)'), id: 'downloadas-csv', type: 'action'},
					{name: _('HTML file (.html)'), id: 'downloadas-html', type: 'action'}]},
				{name: _UNO('.uno:SetDocumentProperties', 'spreadsheet'), uno: '.uno:SetDocumentProperties', id: 'properties'},
				{name: _UNO('.uno:Signature', 'spreadsheet'), uno: '.uno:Signature', id: 'signature'},
				{name: _('Options'), id: 'settings-dialog', type: 'action', mobileapp: false},
				{type: 'separator'},
				{name: _UNO('.uno:Print', 'spreadsheet'), id: 'print', type: 'menu', menu: [
					{name: _('Active sheet'), id: 'print-active-sheet', type: 'action'},
					{name: _('All Sheets'), id: 'print-all-sheets', type: 'action'},
				]},
				{name: _('Close document'), id: 'closedocument', type: 'action'}
			]},
			{name: _UNO('.uno:EditMenu', 'spreadsheet'), id: 'editmenu', type: 'menu', accessibility: {combination: 'ME'}, menu: [
				{name: _UNO('.uno:Undo', 'text'), uno: '.uno:Undo'},
				{name: _UNO('.uno:Redo', 'text'), uno: '.uno:Redo'},
				{name: _('Repair'), id: 'repair',  type: 'action'},
				{type: 'separator'},
				{name: _UNO('.uno:Cut', 'text'), uno: '.uno:Cut'},
				{name: _UNO('.uno:Copy', 'text'), uno: '.uno:Copy'},
				{name: _UNO('.uno:Paste', 'text'), uno: '.uno:Paste'},
				{name: _UNO('.uno:PasteSpecial', 'text'), uno: '.uno:PasteSpecial'},
				{name: _UNO('.uno:SelectAll', 'text'), uno: '.uno:SelectAll'},
				{type: 'separator'},
				{uno: '.uno:SearchDialog', id: 'searchreplace'},
				{name: _('Find'), id: 'find', type: 'action', shortcut: 'home-search'},
				{type: 'separator'},
				{name: _UNO('.uno:ChangesMenu', 'spreadsheet'), id: 'changesmenu', type: 'menu', menu: [
					{uno: '.uno:TraceChangeMode'},
					{uno: '.uno:ShowChanges'},
					{type: 'separator'},
					{uno: '.uno:AcceptChanges'},
					{uno: '.uno:CommentChange'}
				]}
			]},
			{name: _UNO('.uno:ViewMenu', 'spreadsheet'), id: 'view', type: 'menu', accessibility: {combination: 'MV'},
			 menu: (window.mode.isTablet() ? [
					{name: _('Reset zoom'), id: 'zoomreset', type: 'action'},
				] as MenuItem[] : [
					{name: _UNO('.uno:FullScreen', 'spreadsheet'), unoid: '.uno:FullScreen', id: 'fullscreen', type: 'action'},
				   {type: 'separator'},
				   {name: _UNO('.uno:ZoomPlus', 'text'), unoid: '.uno:ZoomPlus', id: 'zoomin', type: 'action'},
				   {name: _UNO('.uno:ZoomMinus', 'text'), unoid: '.uno:ZoomMinus', id: 'zoomout', type: 'action',},
				   {name: _('Reset zoom'), id: 'zoomreset', type: 'action'},
				] as MenuItem[]).concat([
				   {type: 'separator'},
				   {name: _('Toggle UI Mode'), id: 'toggleuimode', type: 'action'},
				   {name: _('Show Status Bar'), id: 'showstatusbar', type: 'action'},
				   {name: _('Hide Menu Bar'), id: 'togglemenubar', type: 'action'},
				   {name: _('Dark Mode'), id: 'toggledarktheme', type: 'action'},
				   {name: _('Invert Background'), id: 'invertbackground', type: 'action'},
				   {uno: '.uno:SidebarDeck.PropertyDeck', name: _UNO('.uno:Sidebar')},
				   {uno: '.uno:Navigator', id: 'navigator'},
				   {uno: '.uno:SidebarDeck.StyleListDeck', name: _('Style list')},
				   {type: 'separator'},
				   {name: _UNO('.uno:ToggleSheetGrid', 'spreadsheet', true), uno: '.uno:ToggleSheetGrid', id: 'sheetgrid'},
				   {uno: '.uno:ToggleFormula'},
				   {name: _('Focus Cell'), type:'action', id: 'columnrowhighlight'},
				   {name: _UNO('.uno:FreezePanes', 'spreadsheet', true), id: 'FreezePanes', uno: '.uno:FreezePanes'},
				   {name: _UNO('.uno:FreezeCellsMenu', 'spreadsheet', true), id: 'FreezeCellsMenu', type: 'menu', uno: '.uno:FreezeCellsMenu', menu: [
					   {name: _UNO('.uno:FreezePanesColumn', 'spreadsheet', true), id: 'FreezePanesColumn', uno: '.uno:FreezePanesColumn'},
					   {name: _UNO('.uno:FreezePanesRow', 'spreadsheet', true), id: 'FreezePanesRow', uno: '.uno:FreezePanesRow'}
				   ]},
				])},
			{name: _UNO('.uno:InsertMenu', 'spreadsheet'), id: 'insert', type: 'menu', accessibility: {combination: 'MN'}, menu: [
				{name: _('Local Image...'), id: 'insertgraphic', type: 'action'},
				{name: _UNO('.uno:InsertGraphic', 'spreadsheet'), unoid: '.uno:InsertGraphic', id: 'insertgraphicremote', type: 'action'},
				{name: _UNO('.uno:DataDataPilotRun', 'spreadsheet'), uno: '.uno:DataDataPilotRun'},
				{name: _UNO('.uno:CalculatedFieldRun', 'spreadsheet'), uno: '.uno:CalculatedFieldRun'},
				{name: _UNO('.uno:InsertCalcTable', 'spreadsheet'), uno: '.uno:InsertCalcTable'},
				{name: _UNO('.uno:InsertSparkline', 'spreadsheet'), uno: '.uno:InsertSparkline'},
				{name: _UNO('.uno:InsertAnnotation', 'spreadsheet'), unoid: '.uno:InsertAnnotation', id: 'insertcomment', type: 'action'},
				{uno: '.uno:InsertObjectChart'},
				{name: _('Shapes ...'), unoid: '.uno:ShapesMenu', id: 'insertshape', type: 'action'},
				{name: _UNO('.uno:FontworkGalleryFloater'), uno: '.uno:FontworkGalleryFloater', id: 'fontworkgalleryfloater'},
				{name: _UNO('.uno:DrawText'), uno: '.uno:DrawText'},
				{name: _UNO('.uno:VerticalText'), uno: '.uno:VerticalText'},
				{uno: '.uno:FunctionDialog'},
				{type: 'separator'},
				{name: _UNO('.uno:HyperlinkDialog'), uno: '.uno:HyperlinkDialog'},
				{name: _('Smart Picker'), id: 'remotelink', type: 'action'},
				{name: _('AI Assistant'), id: 'remoteaicontent', type: 'action'},
				{uno: '.uno:InsertSymbol'},
				{type: 'separator'},
				{name: _UNO('.uno:InsertField', 'text'), type: 'menu', menu: [
					{uno: '.uno:InsertCurrentDate'},
					{uno: '.uno:InsertCurrentTime'}
				]},
				{uno: '.uno:EditHeaderAndFooter'}
			]},
			{name: _UNO('.uno:FormatMenu', 'spreadsheet'), id: 'format', type: 'menu', accessibility: {combination: 'MO'}, menu: [
				{name: _UNO('.uno:FormatTextMenu', 'spreadsheet'), type: 'menu', menu: [
					{name: _UNO('.uno:Bold', 'spreadsheet'), uno: '.uno:Bold'},
					{name: _UNO('.uno:Italic', 'spreadsheet'), uno: '.uno:Italic'},
					{name: _UNO('.uno:Underline', 'spreadsheet'), uno: '.uno:Underline'},
					{name: _UNO('.uno:UnderlineDouble', 'spreadsheet'), uno: '.uno:UnderlineDouble'},
					{name: _UNO('.uno:Strikeout', 'spreadsheet'), uno: '.uno:Strikeout'},
					{uno: '.uno:Overline'},
					{type: 'separator'},
					{name: _UNO('.uno:SuperScript', 'spreadsheet'), uno: '.uno:SuperScript'},
					{name: _UNO('.uno:SubScript', 'spreadsheet'), uno: '.uno:SubScript'},
					{type: 'separator'},
					{uno: '.uno:Shadowed'},
					{uno: '.uno:OutlineFont'},
					{type: 'separator'},
					{uno: '.uno:WrapText'},
					{type: 'separator'},
					{uno: '.uno:ChangeCaseToUpper'},
					{uno: '.uno:ChangeCaseToLower'},
					{uno: '.uno:ChangeCaseRotateCase'},
					{type: 'separator'},
					{uno: '.uno:ChangeCaseToSentenceCase'},
					{uno: '.uno:ChangeCaseToTitleCase'},
					{uno: '.uno:ChangeCaseToToggleCase'}]},
				{name: _UNO('.uno:TextAlign', 'spreadsheet'), type: 'menu', menu: [
					{uno: '.uno:CommonAlignLeft'},
					{uno: '.uno:CommonAlignHorizontalCenter'},
					{uno: '.uno:CommonAlignRight'},
					{uno: '.uno:CommonAlignJustified'},
					{type: 'separator'},
					{uno: '.uno:CommonAlignTop'},
					{uno: '.uno:CommonAlignVerticalCenter'},
					{uno: '.uno:CommonAlignBottom'},
					{type: 'separator'},
					{uno: '.uno:ParaLeftToRight'},
					{uno: '.uno:ParaRightToLeft'}]},
				{name: _UNO('.uno:NumberFormatMenu', 'spreadsheet'), type: 'menu', menu: [
					{uno: '.uno:NumberFormatStandard'},
					{uno: '.uno:NumberFormatDecimal'},
					{uno: '.uno:NumberFormatPercent'},
					{uno: '.uno:NumberFormatCurrency'},
					{uno: '.uno:NumberFormatDate'},
					{uno: '.uno:NumberFormatTime'},
					{uno: '.uno:NumberFormatScientific'},
					{type: 'separator'},
					{uno: '.uno:NumberFormatThousands'}]},
				{type: 'separator'},
				{uno: '.uno:FormatPaintbrush'},
				{uno: '.uno:ResetAttributes'},
				{name: _UNO('.uno:PrintRangesMenu', 'spreadsheet'), type: 'menu', menu: [
					{uno: '.uno:DefinePrintArea'},
					{uno: '.uno:AddPrintArea'},
					{uno: '.uno:EditPrintArea'},
					{uno: '.uno:DeletePrintArea'}]},
				{name: _UNO('.uno:FormatSparklineMenu', 'spreadsheet'), type: 'menu', menu: [
				    {uno: '.uno:InsertSparkline'},
				    {uno: '.uno:DeleteSparkline'},
				    {uno: '.uno:DeleteSparklineGroup'},
				    {uno: '.uno:EditSparklineGroup'},
				    {uno: '.uno:EditSparkline'},
				    {uno: '.uno:GroupSparklines'},
				    {uno: '.uno:UngroupSparklines'}
				]},
				{name: _UNO('.uno:ConditionalFormatMenu', 'spreadsheet'), type: 'menu', menu: [
					{name: _('Highlight cells with...'), type: 'menu', menu: [
						{name: _('Values greater than...'), uno: '.uno:ConditionalFormatEasy?FormatRule:short=2'},
						{name: _('Values less than...'), uno: '.uno:ConditionalFormatEasy?FormatRule:short=1'},
						{name: _('Values equal to...'), uno: '.uno:ConditionalFormatEasy?FormatRule:short=0'},
						{name: _('Values between...'), uno: '.uno:ConditionalFormatEasy?FormatRule:short=6'},
						{name: _('Values duplicate...'), uno: '.uno:ConditionalFormatEasy?FormatRule:short=8'},
						{name: _('Containing text...'), uno: '.uno:ConditionalFormatEasy?FormatRule:short=23'},
						{type: 'separator'},
						{name: _('More highlights...'), uno: '.uno:ConditionalFormatDialog'},
					]},
					{name: _('Top/Bottom Rules...'), type: 'menu', menu: [
						{name: _('Top N elements...'), uno: '.uno:ConditionalFormatEasy?FormatRule:short=11'},
						{name: _('Top N percent...'), uno: '.uno:ConditionalFormatEasy?FormatRule:short=13'},
						{name: _('Bottom N elements...'), uno: '.uno:ConditionalFormatEasy?FormatRule:short=12'},
						{name: _('Bottom N percent...'), uno: '.uno:ConditionalFormatEasy?FormatRule:short=14'},
						{name: _('Above Average...'), uno: '.uno:ConditionalFormatEasy?FormatRule:short=15'},
						{name: _('Below Average...'), uno: '.uno:ConditionalFormatEasy?FormatRule:short=16'},
						{type: 'separator'},
						{name: _('More highlights...'), uno: '.uno:ConditionalFormatDialog'},
					]},
					{uno: '.uno:ColorScaleFormatDialog'},
					{uno: '.uno:DataBarFormatDialog'},
					{uno: '.uno:IconSetFormatDialog'},
					{uno: '.uno:CondDateFormatDialog'},
					{type: 'separator'},
					{uno: '.uno:ConditionalFormatManagerDialog'}]},
				{type: 'separator'},
				{uno: '.uno:FormatCellDialog'},
				{name: _('Rows'), type: 'menu', menu: [
					{uno: '.uno:RowHeight'},
					{uno: '.uno:SetOptimalRowHeight'}]},
				{name: _('Columns'), type: 'menu', menu: [
					{uno: '.uno:ColumnWidth'},
					{uno: '.uno:SetOptimalColumnWidth'}]},
				{uno: '.uno:FontDialog'},
				{uno: '.uno:ParagraphDialog'},
				{uno: '.uno:SidebarDeck.StyleListDeck'},
				{uno: '.uno:PageFormatDialog'},
				{type: 'separator'},
				{uno: '.uno:TransformDialog'},
				{uno: '.uno:FormatLine'},
				{uno: '.uno:FormatArea'},
				{uno: '.uno:ThemeDialog'}
			]},
			{name: _UNO('.uno:SheetMenu', 'spreadsheet'), id: 'sheet', type: 'menu', accessibility: {combination: 'MS'}, menu: [
				{uno: '.uno:InsertCell'},
				{name: _UNO('.uno:InsertRowsMenu', 'spreadsheet'), type: 'menu', menu: [
					{uno: '.uno:InsertRowsBefore'},
					{uno: '.uno:InsertRowsAfter'}]},
				{name: _UNO('.uno:InsertColumnsMenu', 'spreadsheet'), type: 'menu', menu: [
					{uno: '.uno:InsertColumnsBefore'},
					{uno: '.uno:InsertColumnsAfter'}]},
				{type: 'separator'},
				{uno: '.uno:DeleteCell'},
				{uno: '.uno:DeleteRows'},
				{uno: '.uno:DeleteColumns'},
				{uno: '.uno:SheetRightToLeft'},
				{type: 'separator'},
				{name:  _UNO('.uno:JumpToTable', 'spreadsheet'), uno: '.uno:JumpToTable'}
			]},
			{name: _UNO('.uno:DataMenu', 'spreadsheet'), id: 'data', type: 'menu', accessibility: {combination: 'MD'}, menu: [
				{uno: '.uno:DataSort'},
				{uno: '.uno:SortAscending'},
				{uno: '.uno:SortDescending'},
				{uno: '.uno:Validation'},
				{uno: '.uno:Calculate'},
				{uno: '.uno:ConvertFormulaToValue'},
				{type: 'separator'},
				{uno: '.uno:DataFilterAutoFilter'},
				{name: _UNO('.uno:FilterMenu', 'spreadsheet'), type: 'menu', menu: [
					{uno: '.uno:DataFilterStandardFilter'},
					{uno: '.uno:DataFilterSpecialFilter'},
					{type: 'separator'},
					{uno: '.uno:DataFilterRemoveFilter'},
					{uno: '.uno:DataFilterHideAutoFilter'}]},
				{uno: '.uno:TextToColumns'},
				{uno: '.uno:HandleDuplicateRecords'},
				{type: 'separator'},
				{name: _UNO('.uno:DataPilotMenu', 'spreadsheet'), type: 'menu', menu: [
					{name: _UNO('.uno:InsertPivotTable', 'spreadsheet'), uno: '.uno:DataDataPilotRun'},
					{name: _UNO('.uno:InsertCalculation', 'spreadsheet'), uno: '.uno:CalculatedFieldRun'},
					{name: _UNO('.uno:RecalcPivotTable', 'spreadsheet'), uno: '.uno:RecalcPivotTable'},
					{name: _UNO('.uno:DeletePivotTable', 'spreadsheet'), uno: '.uno:DeletePivotTable'}]},
				{type: 'separator'},
				{name: _UNO('.uno:DataTableMenu', 'spreadsheet'), type: 'menu', menu: [
					{name: _UNO('.uno:RunInsCalcTable', 'spreadsheet'), uno: '.uno:InsertCalcTable'},
					{name: _UNO('.uno:RemoveCalcTable', 'spreadsheet'), uno: '.uno:RemoveCalcTable'}]},
				{type: 'separator'},
				{name: _UNO('.uno:NamesMenu', 'spreadsheet'), type: 'menu', menu: [
					{name: _UNO('.uno:AddName', 'spreadsheet'), uno: '.uno:AddName'},
					{name: _UNO('.uno:DefineName', 'spreadsheet'), uno: '.uno:DefineName'}]},
				{name: _UNO('.uno:DefineDBName', 'spreadsheet'), uno: '.uno:DefineDBName'},
				{name: _UNO('.uno:SelectDB', 'spreadsheet'), uno: '.uno:SelectDB'},
				{name: _UNO('.uno:DataAreaRefresh', 'spreadsheet'), uno: '.uno:DataAreaRefresh'},
				{type: 'separator'},
				{name: _UNO('.uno:GroupOutlineMenu', 'spreadsheet'), type: 'menu', menu: [
					{uno: '.uno:Group'},
					{uno: '.uno:Ungroup'},
					{type: 'separator'},
					{uno: '.uno:ClearOutline'},
					{type: 'separator'},
					{uno: '.uno:HideDetail'},
					{uno: '.uno:ShowDetail'}]},
				{type: 'separator'},
				{name: _UNO('.uno:StatisticsMenu', 'spreadsheet'), type: 'menu', menu: [
					{name: _UNO('.uno:SamplingDialog', 'spreadsheet'), uno: '.uno:SamplingDialog'},
					{name: _UNO('.uno:DescriptiveStatisticsDialog', 'spreadsheet'), uno: '.uno:DescriptiveStatisticsDialog'},
					{name: _UNO('.uno:AnalysisOfVarianceDialog', 'spreadsheet'), uno: '.uno:AnalysisOfVarianceDialog'},
					{name: _UNO('.uno:CorrelationDialog', 'spreadsheet'), uno: '.uno:CorrelationDialog'},
					{name: _UNO('.uno:CovarianceDialog', 'spreadsheet'), uno: '.uno:CovarianceDialog'},
					{name: _UNO('.uno:ExponentialSmoothingDialog', 'spreadsheet'), uno: '.uno:ExponentialSmoothingDialog'},
					{name: _UNO('.uno:MovingAverageDialog', 'spreadsheet'), uno: '.uno:MovingAverageDialog'},
					{name: _UNO('.uno:RegressionDialog', 'spreadsheet'), uno: '.uno:RegressionDialog'},
					{name: _UNO('.uno:TTestDialog', 'spreadsheet'), uno: '.uno:TTestDialog'},
					{name: _UNO('.uno:FTestDialog', 'spreadsheet'), uno: '.uno:FTestDialog'},
					{name: _UNO('.uno:ZTestDialog', 'spreadsheet'), uno: '.uno:ZTestDialog'},
					{name: _UNO('.uno:ChiSquareTestDialog', 'spreadsheet'), uno: '.uno:ChiSquareTestDialog'},
					{name: _UNO('.uno:FourierAnalysisDialog', 'spreadsheet'), uno: '.uno:FourierAnalysisDialog'}]},
			]},
			{name: _UNO('.uno:ToolsMenu', 'spreadsheet'), id: 'tools', type: 'menu', accessibility: {combination: 'MT'}, menu: [
				{uno: '.uno:SpellDialog'},
				{uno: '.uno:SpellOnline'},
				{name: _UNO('.uno:LanguageMenu'), type: 'menu', menu: [
					{name: _('None (Do not check spelling)'), id: 'nonelanguage', uno: '.uno:LanguageStatus?Language:string=Default_LANGUAGE_NONE'}]},
				{uno: '.uno:GoalSeekDialog'},
				{uno: '.uno:Protect'},
				{type: 'separator'},
				{name: _('Detective'), type: 'menu', menu: [
					{uno: '.uno:ShowPrecedents'},
					{uno: '.uno:ShowDependents'},
					{type: 'separator'},
					{uno: '.uno:ClearArrowPrecedents'},
					{uno: '.uno:ClearArrowDependents'},
					{uno: '.uno:ClearArrows'},
					{type: 'separator'},
					{uno: '.uno:ShowErrors'},
					{uno: '.uno:ShowInvalid'}]},
				{type: 'separator'},
				{name: _UNO('.uno:RunMacro'), id: 'runmacro', uno: '.uno:RunMacro'}
			]},
			{name: _('Extensions'), id: 'extensions-menu', type: 'menu', menu: []},
			{name: _UNO('.uno:HelpMenu', 'spreadsheet'), id: 'help', type: 'menu', accessibility: {combination: 'MY'}, menu: [
				{name: _('Online Help'), id: 'online-help', type: 'action', iosapp: false},
				{type: 'separator', iosapp: false},
				{name: _('Keyboard shortcuts'), id: 'keyboard-shortcuts', type: 'action', iosapp: false},
				{type: 'separator'},
				{name: _('Server audit'), id: 'serveraudit', type: 'action', mobileapp: false},
				{type: 'separator'},
				{name: _('About'), id: 'about', type: 'action'}]
			},
			{name: _('Last modification'), id: 'last-mod', type: 'action', tablet: false}
		],

		mobiletext:  [
			{name: _('Search'), id: 'recsearch', type: 'action'},
			// writer-no-document-outline. Sits next to Search because both are
			// READING tools, and reading is posture one -- an outline is how a
			// long brief is navigated on a phone, which is the Writer phone use
			// case for a legal product. Google puts the same data in a bottom
			// sheet on phone (cut rule 4: change the navigation model rather
			// than shrink the surface); VulcanDocumentOutline.ts builds that
			// sheet from core's navigator payload.
			//
			// type:'action', NOT a uno. .uno:Navigator and .uno:GotoPage are in
			// the DESKTOP arrays and stay out of here on purpose: .uno:Navigator
			// opens a whole panel -- search field, three tabs, two toolbars,
			// fifteen content categories -- and on a small screen
			// Util.MessageRouter would post it straight into the mobile wizard,
			// which is the dropped-desktop-dialog failure mode. The action runs
			// the same command underneath but renders only the headings.
			//
			// Deliberately NOT added to allowedViewModeActions: that list gates
			// _beforeShow, the DESKTOP DOM menubar, and this entry only ever
			// reaches generateFullMenuStructure. There a top-level type:'action'
			// clears _checkItemVisibility in read mode already -- which is the
			// wanted answer, since the whole point is that a VIEWER can navigate.
			{name: _('Document outline'), id: 'documentoutline', type: 'action'},
			// Phone File menu is Google's: export, share, print. Save and
			// Save As are gone because the phone never saves by hand -- the
			// host drives Action_Save and coolwsd autosaves -- and revision
			// history is a desktop posture (writer-kebab-untrimmed-stock-menu).
			{name: _UNO('.uno:PickList', 'text'), id: 'file', type: 'menu', menu: [
				{name: _('Export as'), id: 'exportas', type: 'menu', menu: [
					{name: _('PDF Document (.pdf)'), id: 'exportas-pdf', type: 'action'},
					{name: _('EPUB (.epub)'), id: 'exportas-epub', type: 'action'},
					{name: _('Markdown (.md)'), id: 'exportas-md', type: 'action'}
				]},
				{name: _('Share...'), id:'shareas', type: 'action'},
				{type: 'separator'},
				{name: _UNO('.uno:Print', 'text'), unoid: '.uno:Print', id: 'print', type: 'action'},
			]},
			{name: !window.ThisIsAMobileApp ? _('Download as') : _('Export as'), id: 'downloadas', type: 'menu', menu: [
				{name: _('PDF Document (.pdf)'), id: !window.ThisIsAMobileApp ? 'exportdirectpdf' : 'downloadas-pdf', type: 'action'},
				{name: _('PDF Document (.pdf) as...'), id: 'exportpdf', type: 'action'},
				{name: _('ODF text document (.odt)'), id: 'downloadas-odt', type: 'action'},
				{name: _('Word 2003 Document (.doc)'), id: 'downloadas-doc', type: 'action'},
				{name: _('Word Document (.docx)'), id: 'downloadas-docx', type: 'action'},
				{name: _('Rich Text (.rtf)'), id: 'downloadas-rtf', type: 'action'},
				{name: _('EPUB (.epub)'), id: !window.ThisIsAMobileApp ? 'exportepub' : 'downloadas-epub', type: 'action'},
				{name: _('Markdown (.md)'), id: 'downloadas-md', type: 'action'},
			]},
			{name: _UNO('.uno:EditMenu', 'text'), id: 'editmenu', type: 'menu', menu: [
				{uno: '.uno:Undo'},
				{uno: '.uno:Redo'},
				{name: _('Repair'), id: 'repair',  type: 'action'},
				{type: 'separator'},
				{uno: '.uno:Cut'},
				{uno: '.uno:Copy'},
				{uno: '.uno:Paste'},
				{uno: '.uno:SelectAll'},
				{type: 'separator'},
				// writer-find-replace-missing. Google Docs phone ships Find and
				// replace in the overflow. It lives INSIDE editmenu, not at top
				// level, because _checkItemVisibility gates type:'menu' items on
				// allowedReadonlyMenus (which includes 'editmenu') -- so it stays
				// reachable in the read posture, where a top-level item would get
				// no gating at all. The LOK dialog renders in the mobile wizard
				// bottom sheet via Util.MessageRouter's small-screen branch.
				{uno: '.uno:SearchDialog', id: 'searchreplace'}
			]},
			{name: _UNO('.uno:ChangesMenu', 'text'), id: 'changesmenu', type: 'menu', menu: [
				// Record (TrackChanges) stays -- that is authoring intent.
				// SHOW is gone: phone Writer is pinned to showing tracked
				// changes at load (Control.UIManager.initializeSpecializedUI),
				// so a toggle here could only take the user somewhere we do
				// not want them, and hide-redlines is the per-view setting the
				// DOCX exporter writes into the SHARED file as <w:revisionView>.
				// Redlines are the document's content, not a view preference;
				// the desktop keeps the toggle.
				{uno: '.uno:TrackChanges'},
				{type: 'separator'},
				{type: 'action', id: 'acceptalltrackedchanges', uno: '.uno:AcceptAllTrackedChanges'},
				{type: 'action', id: 'rejectalltrackedchanges', uno: '.uno:RejectAllTrackedChanges'},
				{uno: '.uno:PreviousTrackedChange'},
				{uno: '.uno:NextTrackedChange'}
			]},
			{name: _UNO('.uno:ViewMenu', 'text'), id: 'view', type: 'menu', menu: [
				{name: _UNO('.uno:FullScreen', 'text'), unoid: '.uno:FullScreen', id: 'fullscreen', type: 'action', mobileapp: false},
				// THE REFLOW SWITCH, and it is Google's own control: their phone
				// overflow carries "Print layout", and turning it OFF is what
				// gives them text wrapped to the screen instead of a page you
				// pan across (DOCS-REFERENCE §"Turn on print layout: More >
				// Print layout").
				//
				// It matters more here than there. A Letter page with 1in
				// margins puts 11pt text at 5.9 CSS px on a 393px phone if you
				// fit the page (measured, all nine zoom levels swept), and zoom
				// cannot fix it because zoom scales the column and the glyphs
				// together: 58% is the widest zoom where a line still fits and
				// 8.5px is unreadable. Web view is the only route to a readable
				// line length that does not touch the document.
				//
				// 🔴 THIS ROW USED TO BE WIRED TO `.uno:PrintLayout`, WHICH IS
				// THE OTHER HALF OF A RADIO PAIR. PrintLayout means "go back to
				// page view"; sent from page view it is a no-op that changes no
				// layout and broadcasts no state (wire-verified twice on the
				// built image). Core also publishes no state for it, so the row
				// never rendered checked either -- it could not answer the one
				// question it exists to answer. `.uno:BrowseView` is the half
				// that turns reflow ON, it is now a real toggle under COKit
				// (sw/source/uibase/uiview/view0.cxx), and it is now in the
				// kit's uno command list so the checkmark is truthful
				// (sfx2/source/control/unoctitm.cxx).
				//
				// THIS ROW STARTS UNCHECKED, ON EVERY SURFACE. Reflow was the
				// phone default for one image and had to be withdrawn: the
				// engine laid the document out at the width of its widest
				// TABLE rather than the phone's, so every paragraph ran off
				// the right edge. The measurement and the engine seam are in
				// the header of app/VulcanWriterReflow.ts. Until an image
				// build shows that seam fixed, this row is how reflow is
				// reached at all -- so it is a discovery surface again, not
				// merely an escape hatch, and that is a known gap against
				// Docs rather than the intended posture.
				//
				// `type: 'action'` rather than a bare uno row because the
				// client owns things the engine cannot. It states the reflow
				// width in twips BEFORE the mode flips (otherwise the first
				// reflow lands on MIN_BROWSE_WIDTH -- 907 CSS px here -- and
				// the user watches a wrong full-document layout), and it moves
				// the zoom to where 11pt clears 16 CSS px, restoring the
				// previous zoom exactly on the way out. It also does NOT send
				// .uno:BrowseView: the mode is decided by tallying every
				// attached view's vote, so a client that could set it directly
				// could set it against another view's veto. The row states
				// this session's wish and the engine decides
				// (lcl_TallyKitReflowVotes,
				// engine/sw/source/uibase/uiview/view2.cxx). All of the client
				// half lives in app/VulcanWriterReflow.ts; the routing is
				// Control.JSDialogBuilder.js:1917 -> _executeAction(undefined,
				// data) -> id 'browseview' below.
				//
				// The checkmark therefore reports the DOCUMENT's state, which
				// on a shared document is not always this session's wish: a
				// desktop view attached to the same document vetoes reflow for
				// everyone, and this row correctly goes unchecked while it is
				// there. That is the cost of one layout per document; see the
				// header of app/VulcanWriterReflow.ts.
				//
				// Paired with the engine change at
				// engine/sw/source/core/layout/pagechg.cxx (ImplCalcBrowseWidth)
				// WITHOUT WHICH THIS IS WORSE THAN USELESS: stock COOL pins
				// browse width to MIN_BROWSE_WIDTH (200mm = 11339 twips), which
				// is WIDER than a Letter text column (6.5in = 9360 twips), so
				// toggling this on a phone lengthened the line instead of
				// shortening it.
				{name: _('Reflow to screen width'), id: 'browseview', type: 'action', uno: '.uno:BrowseView'},
				{uno: '.uno:ControlCodes', id: 'formattingmarks'},
				{uno: '.uno:SpellOnline'},
				{name: _UNO('.uno:ShowResolvedAnnotations', 'text'), id: 'showresolved', uno: '.uno:ShowResolvedAnnotations'},
				{name: _('Dark Mode'), id: 'toggledarktheme', type: 'action'},
				{name: _('Invert Background'), id: 'invertbackground', type: 'action'},
			]
			},
			window.enableAccessibility ?
				{name: _('Screen Reading'), id: 'togglea11ystate', type: 'action'} : {},
			{id: 'watermark', uno: '.uno:Watermark'},
			{name: _('Page Setup'), id: 'pagesetup', type: 'action'},
			{uno: '.uno:WordCountDialog'},
			window.deeplEnabled ?
				{
					uno: '.uno:Translate'
				} : {},
			{name: _('About'), id: 'about', type: 'action'},
		],

		mobilepresentation: [
			// MERGE NOTE (slides lane wins the label, sheets lane keeps its
			// comment): phone Impress names this row 'Find and replace', not
			// the stock 'Search'. Same dispatch as before -- id 'recsearch' ->
			// app.dispatcher.dispatch('showsearchbar') -- but the phone search
			// bar it opens now carries the real replacement controls on Impress
			// (#vulcan-search-replace-row / -replace / -replace-all), so
			// 'Search' was under-naming what the row does. Pinned by
			// mocha_tests/ImpressPhoneOverflow.test.ts, which matches this
			// literal and calibrates against the old label; the shared
			// mobiletext / mobiledrawing / mobilespreadsheet menus keep their
			// own labels.
			{name: _('Find and replace'), id: 'recsearch', type: 'action'},
			// See the mobiletext File menu for why Save / Save As / revision
			// history are gone on phones.
			{name: _UNO('.uno:PickList', 'presentation'), id: 'file', type: 'menu', menu: [
				// 🔴 SAVE AS AND EXPORT AS ARE CUT, because they NEVER RENDERED
				// AND WERE SCORED AS SHIPPED. Three rows lived here -- 'saveas',
				// the 'exportas' drill-in and its 'exportas-pdf' child -- and
				// _checkItemVisibility drops all three unconditionally:
				//   :3376  saveas          && wopi.UserCanNotWriteRelative
				//   :3379  exportas/-pdf   && wopi.UserCanNotWriteRelative
				// UserCanNotWriteRelative is hardcoded `true` by ALL THREE of this
				// product's WOPI routes -- files/[fileId]/route.ts:493,
				// versions/[versionId]/route.ts:84 and
				// corpus/[corpusType]/[caseId]/[documentId]/route.ts:98 -- and the
				// fork's own default is true too (Map.WOPI.js:34), so even an
				// unconfigured host hides them. Nothing about the phone was ever
				// involved: these rows are dead on desktop Impress as well.
				//
				// THAT FLAG IS CORRECT, not an oversight to flip. The host's only
				// WOPI POST handler answers X-WOPI-Override: PUT_RELATIVE with 501
				// and the comment "We don't support Save As"
				// (files/[fileId]/route.ts:649-651), and the iframe URL carries
				// SaveAsMode=false in ui_defaults (VulcanOfficeEditor.tsx:2141,
				// :2152). Making these render is a server feature -- relative-file
				// creation -- not a gate to delete.
				//
				// NOTHING IS LOST FROM THE PHONE by cutting them, and one thing is
				// gained: the parity matrix stops claiming a capability we do not
				// have. The user-facing PDF route is the Download as drill-in
				// immediately below; 'exportdirectpdf' and 'exportpdf' both render
				// (they gate on HideExportOption, which no route sends). What is
				// genuinely absent is writing a COPY back to host storage, which is
				// what exportas-* means and what PUT_RELATIVE would implement.
				//
				// Reopen when route.ts grows a real PUT_RELATIVE and CheckFileInfo
				// stops hardcoding the flag -- and restore BOTH rows together, since
				// a drill-in with no surviving child is its own kind of phantom.
				// 🔴 RENAME DOCUMENT IS CUT. IT WAS ADDED IN A PRIOR PASS AS A
				// CORRECTION TO THIS MATRIX AND IT HAS NEVER RENDERED ONCE, on any
				// device, in any chrome. The comment it replaces ran fifty lines,
				// traced the dispatch end to end, and got the one thing that decides
				// whether a row exists exactly backwards.
				//
				// It said: "_checkItemVisibility:3040 already drops id
				// 'renamedocument' unless wopi._supportsRename() && UserCanRename ...
				// So a host that forbids renaming renders no row rather than a row
				// that fails." Every clause of that is true. The conclusion drawn
				// from it -- that the gate is a courtesy for hosts that say no -- is
				// not, because THIS host says no. The gate lives at :3391 and the
				// three values behind it were never read:
				//   SupportsRename  -- no WOPI route sends it, so Map.WOPI.js:222
				//                      coerces undefined to false
				//   UserCanRename   -- likewise, :223
				//   _supportsRename() -- Map.WOPI.js:179-181 is
				//                      `!!SupportsRename || !UserCanNotWriteRelative`
				//                      = false || !true = FALSE
				// so the gate is `!(false && false)` = true = hidden, always.
				//
				// And it is dead a second time over, independently: rename travels
				// client -> 'renamefile' (Toolbar.js:214-221) -> Socket.ts:1778 ->
				// coolwsd (ClientSession.cpp:1215, DocumentBroker.cpp:2755+) -> a WOPI
				// RenameFile POST at the host, which has no RENAME_FILE case and falls
				// into `default:` -> 501 (files/[fileId]/route.ts:653-655). Even with
				// the flags flipped the row would dispatch into a 501.
				//
				// Cut rather than fixed, and the parity argument agrees with the
				// mechanical one. google-slides.json's own Rename route is "tap More
				// NEXT TO THE FILE" -- the host's file list, which this product has
				// and which is where a rename belongs. Google's second route is
				// tapping the title in the editor, and the phone top bar carries no
				// title to tap. So the editor is not where Slides renames either.
				//
				// Reopen only as a PAIR: CheckFileInfo must send SupportsRename and
				// UserCanRename, AND the POST handler must implement RENAME_FILE
				// (rename the row in `files`, re-point storage, invalidate the lock).
				// Landing either half alone reproduces exactly this defect -- a row
				// that renders and 501s, or a capability nothing surfaces.
				{name: _('Share...'), id:'shareas', type: 'action'},
				{type: 'separator'},
				{name: _UNO('.uno:Print', 'presentation'), uno: '.uno:Print', id: 'print', type: 'action'},
			]},
			{name: !window.ThisIsAMobileApp ? _('Download as') : _('Export as'), id:'downloadas', type: 'menu', menu: [
				{name: _('PDF Document (.pdf)'), id: !window.ThisIsAMobileApp ? 'exportdirectpdf' : 'downloadas-pdf', type: 'action'},
				{name: _('PDF Document (.pdf) as...'), id: 'exportpdf' , type: 'action'},
				{name: _('ODF presentation (.odp)'), id: 'downloadas-odp', type: 'action'},
				{name: _('PowerPoint 2003 Presentation (.ppt)'), id: 'downloadas-ppt', type: 'action'},
				{name: _('PowerPoint Presentation (.pptx)'), id: 'downloadas-pptx', type: 'action'},
				{name: _('ODF Drawing (.odg)'), id: 'downloadas-odg', type: 'action'}
			]},
			{name: _UNO('.uno:EditMenu', 'presentation'), id: 'editmenu', type: 'menu', menu: [
				{uno: '.uno:Undo', readOnly: false},
				{uno: '.uno:Redo', readOnly: false},
				{name: _('Repair'), id: 'repair',  type: 'action', readOnly: false},
				{type: 'separator'},
				{uno: '.uno:Cut', readOnly: false},
				{uno: '.uno:Copy'},
				{uno: '.uno:Paste', readOnly: false},
				{uno: '.uno:SelectAll'}
				// 🔴 MERGE NOTE -- THE NESTED SearchDialog ROW (id
				// 'searchreplace') THAT mobiletext AND mobiledrawing CARRY IS
				// DELIBERATELY ABSENT FROM PHONE IMPRESS, and this is the only
				// place that says so.
				//
				// Writer/Draw nest their Find and replace inside editmenu
				// because a top-level row gets no read-posture gating and
				// 'editmenu' is in allowedReadonlyMenus, so nesting was how it
				// stayed reachable to a viewer. Impress solved the same problem
				// the other way and better: its root 'Find and replace' action
				// (top of this array) opens the PHONE search bar, which grew its
				// own Replace / Replace all controls, rather than posting the
				// desktop SearchDialog into the mobile wizard -- and a top-level
				// type:'action' row renders in the read posture anyway, which is
				// the whole reason the Writer row had to be nested. Two routes to
				// the same capability on one 390px menu is the duplicate this
				// merge exists to avoid.
				//
				// It is also load-bearing for the read/edit census in
				// mocha_tests/ImpressPhoneOverflow.test.ts, which deepEquals
				// these children exactly: ['.uno:Copy', '.uno:SelectAll'] in the
				// read posture and the seven rows above in the edit posture. An
				// eighth child fails both. If you ever do want a nested dialog
				// here, change that test in the same commit and say why.
				//
				// The readOnly: false flags above are the read-posture policy:
				// _checkItemVisibility drops any item carrying it whenever
				// isReadOnlyMode(), which is what leaves Copy and Select All --
				// the two non-mutating rows -- as the viewer's Edit menu.
			]},
			{name: _UNO('.uno:ViewMenu', 'presentation'), id: 'view', type: 'menu', menu: [
				{uno: '.uno:SpellOnline'},
				// 🔴 THE PHONE'S ONLY ROUTE BACK TO THE AUTOMATIC FIT, and the
				// reason a pinch used to be permanent.
				//
				// 'fitwidthzoom' is the sole dispatch that reaches
				// `_fitWidthZoom(..., recalcFirstFit = true)`, which is the sole
				// thing that clears CanvasTileLayer's `_vulcanUserZoomed` latch.
				// Until this row existed the command had no phone surface at all:
				// its Impress item is `fitwidthzoom-impress` on the status bar
				// (Control.StatusBar.js:291) and vulcan-theme.css §13i.13 hides
				// `#toolbar-down` outright for phone presentations, while
				// Control.Menubar.ts:175's 'Fit to Screen' is the DESKTOP View
				// menu. So the latch was set by any pinch and cleared by nothing,
				// and the automatic fit stayed off for the rest of the session.
				//
				// The latch also expires on rotation now (CanvasTileLayer
				// `_fitWidthZoom`), which is the Slides-shaped recovery and the one
				// users will actually hit. This row is the explicit one, for a user
				// who is lost in the same orientation they pinched in.
				//
				// NOT A PHANTOM -- the dispatch is traced end to end. A
				// `type: 'action'` row reaches `_executeAction(undefined, data)` via
				// Control.JSDialogBuilder.js:1917, and :3239 maps id 'fitwidthzoom'
				// to `app.dispatcher.dispatch('fitwidthzoom')` ->
				// `activeLayout.adjustViewZoomLevel()` (docdispatcher.ts:284) ->
				// ViewLayout.ts:93. Impress gets `ViewLayoutFileBased`
				// (DocumentBase.ts:37), which does not override that method.
				//
				// AND IT SURVIVES THE FILTER, which is a different question from
				// being in this array and is the one that decides whether the
				// escape ever renders. The phone kebab is built by
				// `generateFullMenuStructure` and BOTH levels are filtered:
				// :3960 runs `_checkItemVisibility` over the top-level items, and
				// :4059 -- inside `_generateMenuStructure` -- runs it again over
				// each submenu's children. Two facts are therefore load-bearing,
				// and neither of them is this row:
				//   - 'view' must stay in `allowedReadonlyMenus` (:2156). In
				//     read-only `_checkItemVisibility` drops EVERY `type: 'menu'`
				//     not listed there, which would take this row down with the
				//     whole View submenu -- and read-only is the viewer-first
				//     posture, i.e. exactly where a stuck pinch hurts. It is
				//     present in both branches of that ternary.
				//   - `_checkItemVisibility` must go on naming no rule for
				//     'fitwidthzoom'. It names none, so the row survives.
				// Both are pinned in mocha_tests/ImpressPhoneZoomLatch.test.ts.
				//
				// AN EARLIER VERSION OF THIS COMMENT GOT BOTH HALVES WRONG, which
				// is worth naming because it is the exact mistake the filter
				// question exists to catch. It said "`_generateMenuStructure`
				// applies no `_checkItemVisibility` filter" -- :4059 is inside that
				// method and does -- and it credited `allowedViewModeActions` for
				// surviving read-only. That list is consulted by `_beforeShow`
				// (:2722), bound to '#main-menu' (:2576), the DESKTOP smartmenus
				// menubar; it never runs for the mobile wizard, and there it hides
				// rather than disables. The conclusion was right and the mechanism
				// was not, so the next person to edit `allowedReadonlyMenus` had no
				// reason to think this row depended on them.
				//
				// The msgid is the one desktop Impress already uses for this exact
				// command, so both surfaces name the control identically and po/
				// already carries the translation.
				{name: _('Zoom to Fit Slide'), id: 'fitwidthzoom', type: 'action'},
				// Google Slides parity (docs/mobile-redesign/03 §5): speaker
				// notes live behind the phone kebab; the stock 'notesmode'
				// dispatcher action toggles Notes view.
				{name: _('Speaker Notes'), id: 'notesmode', type: 'action'},
				{name: _UNO('.uno:FullScreen', 'presentation'), unoid: '.uno:FullScreen', id: 'fullscreen', type: 'action', mobileapp: false},
				{name: _('Dark Mode'), id: 'toggledarktheme', type: 'action'},
				// Invert Background is CUT from the phone kebab. It is a
				// document-rendering knob with no counterpart anywhere in
				// google-slides.json, and it only ever appears while dark theme
				// is already on (_checkItemVisibility returns false for
				// 'invertbackground' unless prefs darkTheme is set), so on a
				// viewer-first surface it reads as a second, contradictory dark
				// control sitting directly under the first. Desktop keeps it.
			]
			},
			// The 12-row Table drill-in is CUT from the phone kebab. It was
			// unconditional and always rendered ENABLED -- the mobile path
			// applies no command-state disabling -- so with no table selected,
			// which is nearly always, it was twelve dead-looking rows at the
			// kebab root of a viewer-first surface.
			//
			// 🔴 THIS COMMENT USED TO SAY the capability was not stranded,
			// because #toolbar-down still rendered on Impress and
			// Control.MobileBottomBar.js:241-263 carried insertrowsbefore /
			// insertcolumnsbefore / togglemergecells under context: ['Table'].
			// It then WARNED that cutting the Impress bottom bar would remove
			// the last route to them. That bar is now cut
			// (css/vulcan-theme.css §13i.13), so this is the outcome the
			// warning described, taken deliberately rather than walked into.
			//
			// Table STRUCTURAL editing is gone from phone Impress, on purpose,
			// because google-slides.json says it should be: "NOT SHIPPED:
			// tables, video, audio, charts, WordArt, diagrams" (insert / core)
			// reads "existing ones render and can be moved/resized, but not
			// created or structurally edited". Moving and resizing an existing
			// table still work — those are canvas gestures, not toolbar items.
			// Insert row / insert column / merge cells remain on DESKTOP: the
			// desktop menubar's Table menu (the 'table' entry in the presentation
			// menu above) and Control.NotebookbarImpress.js.
			// Draw is unaffected — 'tablemenu' still ships under mobiledrawing
			// below, and §13i.13 is scoped to data-doctype='presentation'.
			{name: _UNO('.uno:SlideMenu', 'presentation'), id: 'slidemenu', type: 'menu', menu: [
				{name: _UNO('.uno:InsertSlide', 'presentation'), unoid: '.uno:InsertSlide', id: 'insertpage', type: 'action'},
				{name: _UNO('.uno:DuplicateSlide', 'presentation'), unoid: '.uno:DuplicateSlide', id: 'duplicatepage', type: 'action'},
				{name: _UNO('.uno:DeleteSlide', 'presentation'), unoid: '.uno:DeleteSlide', id: 'deletepage', type: 'action'},
				{type: 'separator'},
				// impress-no-change-layout is CLOSED, but NOT here -- the row
				// lives at the kebab ROOT, next to Change theme, and the full
				// rationale sits with it further down this array.
				//
				// 🔴 MERGE NOTE, so nobody re-adds it: the two phone lanes each
				// built this drill-in, the sheets lane here under Slide ▸ and
				// the slides lane at the root. Only one can ship. Two nodes with
				// id 'changelayout' would render 'Change layout' twice in one
				// kebab, and would give the mobile wizard two
				// .ui-header-changelayout-N sets -- which does not merely look
				// wrong, it turns
				// e2e/vulcan-office-phone/impress-theme.spec.ts green without
				// running: its locators are guarded on count() === 1 and would
				// quietly match nothing at 2, while row32Inventory() would return
				// the Slide ▸ copy (depth-first, and this drill-in comes first in
				// the array) whose children carry no 'changelayout-N' ids.
				// Root also matches google-slides.json's "tap More, tap Change
				// layout" and the Impress spec, so root is what survived.
				//
				// The two things this copy said that the root copy did not have
				// been carried down to it: the no-WhatPage/current-page fallback,
				// and the long-form version of the one-physical-line
				// unocommands.py build trap.
				// impress-no-theme-picker. NOTE the honest label: this is
				// svx::ThemeDialog, an icon grid of theme COLOUR SETS applied to
				// the master page -- not Google Slides' full theme gallery of
				// layouts + fonts + colours. Do not relabel it 'Change theme';
				// that would promise behaviour we do not deliver. Renders as a
				// tappable swatch grid in the mobile wizard (JSDialogBuilder
				// registers an 'iconview' handler).
				{name: _('Theme colours'), uno: '.uno:ThemeDialog'}]
			},
			// Change theme is the other formatting row google-slides.json puts
			// in the overflow: "Double-tap a slide to enter edit, tap More (top
			// right), tap Change theme, then tap a theme."
			//
			// 🔴 THIS ROW USED TO BE A DECLINE, AND THE STATED REASON WAS WRONG.
			// It said the Master Slides deck "would arrive and render into a
			// hidden wrapper" because device-mobile.css:309-311 sets
			// `#sidebar-dock-wrapper, #navigator-dock-wrapper { display: none
			// !important; }`. That CSS is real, but it is not on this path. On a
			// small screen a sidebar deck never reaches the dock at all:
			// Util.MessageRouter.ts:88-126 has NO `jsontype === 'sidebar'` branch
			// inside its isSmallScreenDevice() block — that branch is at :129,
			// in the desktop half — so the deck JSON falls through to
			// `fire('mobilewizard')` (:109-118), whose first disjunct is
			// `msgData.enabled` — and every window core dumps carries it
			// (vcl/source/window/window.cxx:3367 puts "enabled", IsEnabled()).
			// The mobile wizard IS the phone's sidebar renderer.
			// It knows it, too:
			// Control.MobileWizardWindow.js:452-458 scans the children for
			// `type == 'deck'` and :544 hands the result to
			// _modifySidebarLayout() (:641).
			//
			// The one real precondition is map.showSidebar, which the wizard
			// checks at :461 and :464 and which is set by firing
			// 'showwizardsidebar' (Control.MobileWizard.js:58-60).
			//
			// The handler uses a COKit-only exact-deck setup command. Opening the
			// default sidebar and then dispatching the desktop toggle leaves the
			// Master Slides deck hidden in the serialized phone sidebar. The
			// synchronous setup path is also what the Writer page deck uses.
			//
			// ⚠ WHAT THIS ACTUALLY DELIVERS, said plainly rather than sold as
			// Slides' theme gallery: the Impress Master Slides deck. Three
			// panels (Sidebar.xcu:1257-1343) — "Used in This Presentation",
			// "Recently Used", "Available for Use" — each a GtkIconView of
			// rendered page previews (sd/uiconfig/simpress/ui/masterpagepanel.ui
			// et al) that the mobile wizard builds through the inherited
			// JSDialog.iconView handler. "Available for Use" is populated:
			// extras/source/templates/presnt ships 23 presentation templates.
			// A tap applies — MasterPagesSelector.cxx:62 wires
			// connect_item_activated to :148-152, which runs 'applyselect'
			// (ExecuteCommand :203, :211).
			//
			// 🔴 THE DIVERGENCE RECORDED HERE IS PATCHED IN THE ENGINE, PENDING
			// THE FORK BUILD — the C++ below has never been compiled anywhere;
			// only vulcan-office-build.yml builds the engine, and nothing on
			// this branch has been wet-tested. Read every "now does X" here as
			// "is written to do X, unverified." THE OLD "indistinguishable on a
			// one-master deck" CONSOLATION WAS NOT EARNED, and that part is
			// established by inspection. 'applyselect' runs AssignMasterPageToSelectedSlides
			// (MasterPagesSelector.cxx:309-331), which builds its page list ONLY
			// out of SlideSorterViewShell::GetSlideSorter(mrBase) and returns on
			// the spot when that is null. A phone client never shows or drives a
			// slide sorter, so the tap lands in one of exactly two places, and
			// neither is what the row promises: nothing at all if no sorter was
			// instantiated, or the single slide you happen to be on if a hidden
			// left-pane one was. Which of the two it is has NOT been established
			// by inspection here — the left-pane sorter is still registered as a
			// wanted resource in kit sessions (SlideSorterModule.cxx:75-77 only
			// excludes it under o3tl::IsRunningUnitTest()), while the center pane
			// is pinned to ImpressView (ImpressViewShellBase.cxx:45). It does not
			// matter to the fix: deck-wide is wrong in both readings, and
			// deck-wide is what the row means.
			//
			// The applyall route (:205-210) could not be reached from here either,
			// and the reason is stronger than "a phone has no right-click": it
			// hangs off ShowContextMenu (:182-191), which feeds ExecuteCommand the
			// RETURN VALUE of weld::Menu::popup_at_rect — and JSMenu::popup_at_rect
			// (vcl/jsdialog/jsdialogbuilder.cxx:2162-2187) always returns "", by
			// design: it ships the menu to the client and comments "simulate
			// canceled menu". So applyall is unreachable from ANY kit client,
			// desktop browser included, gesture or no gesture. There was no
			// client-side fix to prefer.
			//
			// The fix is in the engine: ExecuteCommand's 'applyselect' branch now
			// calls AssignMasterPageToAllSlides when
			// ViewShellBase::isKitMobilePhone() — deck-wide, which is the Slides
			// semantics this row is copied from. That gate is not merely the
			// convenient one: it is fed by deviceFormFactor=mobile
			// (app/Socket.ts:446), which js/global.js:217-225 derives from
			// mode.isSmallScreenDevice() ALONE — the same half-gate this kebab row
			// itself has — so ?vulcanChrome=desktop on a phone, which still renders
			// this row, is intended to get the patched control rather than the
			// dead one — intended, not demonstrated, per the header above. It is
			// false for desktop and tablet kit clients (which can multi-select in
			// their own slide panel, pushed into core via selectPart(), and expect
			// selected-slides) and false in a non-COKit build, where
			// SfxViewShell::maKitDeviceFormFactor stays UNKNOWN
			// (sfx2/source/view/viewsh.cxx:2756,2778).
			//
			// A colour-only alternative was considered and rejected:
			// .uno:ThemeDialog (svx::ThemeDialog, whose iconview the fork
			// already special-cases at Control.JSDialogBuilder.js:67 and
			// Widget.IconView.ts:278-283) also reaches the phone, because
			// MessageRouter routes jsontype 'dialog' to the mobile wizard too.
			// It is the worse fit twice over: it changes only the colour set,
			// not the background/fonts/layout styling a Slides theme carries,
			// and svx/uiconfig/ui/themedialog.ui carries an Add button that
			// opens ThemeColorEditDialog — a twelve-colour editor — off a
			// 390 px sheet.
			//
			// Read-only hides the row rather than dispatching into a wall.
			// Applying a master is an edit, and the phone kebab renders in
			// read-only too. The type:'menu' rows around this one get that for
			// free (_checkItemVisibility filters them against
			// allowedReadonlyMenus); a type:'action' row does not, so
			// 'changetheme' is named in the same read-only switch that already
			// names 'pagesetup'.
			//
			// ⚠ Do not put a leading comment on that case label. ESLint's
			// no-fallthrough reports `Expected a 'break' statement before
			// 'case'` when a comment sits between two otherwise-empty grouped
			// case labels — verified on this exact edit, and the reason the
			// rationale lives here instead of at the case site.
			{name: _('Change theme'), id: 'changetheme', type: 'action'},
			// Change layout — google-slides.json "Overflow (⋮) menu contents"
			// lists it as core ("Share & export, Change theme, Change layout,
			// Speaker notes (toggle), …"), and "Change layout" (importance
			// common) is "Double-tap the slide, tap More, tap Change layout,
			// pick one. Re-flows the current slide's placeholders into the
			// chosen layout." The kebab is our More.
			//
			// 🔴 The six rows are NOT re-declared here. They are read from the
			// one list the phone already has, Control.MobileSlide's
			// _getVulcanLayouts() — the trimmed set its insert-slide picker
			// offers — so change-layout and insert-slide cannot drift into
			// offering different layouts on the same phone. That list is on the
			// Leaflet prototype and takes no `this`; `options` is an instance
			// field, evaluated when UIManager constructs the Menubar, long after
			// every control module has been evaluated. Optional-chained and
			// guarded anyway: with no list, this collapses to the `{}` the array
			// already uses as its omit idiom (see the deeplEnabled entry above)
			// and _generateMenuStructure drops it, rather than rendering a
			// drill-in onto an empty page.
			//
			// Each row is a real dispatch and not a new action id: the command
			// string is the one the stock desktop layout grid already sends
			// (Definitions.Menu.ts generateLayoutPopupGrid, '.uno:AssignLayout?
			// WhatLayout:long=N'), so it needs no _executeAction case and rides
			// the plain uno path in Control.JSDialogBuilder's menu-entry click.
			// In read-only mode the whole drill-in disappears rather than
			// dispatching into a wall — _checkItemVisibility hides every
			// type:'menu' item not in allowedReadonlyMenus, the same way it
			// already hides the Slide drill-in above
			// ('slidemenu' is not in that list; 'view' and 'editmenu' are).
			//
			// No WhatPage argument is passed: core falls back to the current
			// page (sd/source/ui/view/ViewShellImplementation.cxx, AssignLayout),
			// which is the "re-flows the CURRENT slide" semantics above.
			//
			// 🔴 MERGE NOTE -- THIS ROW LIVES AT THE KEBAB ROOT, NOT UNDER
			// Slide ▸. The sheets lane independently built the same drill-in
			// inside 'slidemenu'; both cannot ship, because two nodes with
			// id 'changelayout' put two 'Change layout' rows in one phone menu
			// and give the DOM two .ui-header-changelayout-N sets. Root wins on
			// three counts: it is where google-slides.json puts it (the kebab is
			// our More), it is what
			// a host end-to-end test
			// drives -- that spec's row32Inventory() walks
			// generateFullMenuStructure() for the FIRST id 'changelayout' and
			// expects children ids 'changelayout-<WhatLayout>', which only this
			// version emits -- and its guarded locators would silently skip
			// (count() === 1 fails at 2) rather than fail loudly if both shipped.
			// See the note left at the Slide drill-in above.
			(() => {
				const layouts = ((window as any).L?.Control?.MobileSlide
					?.prototype?._getVulcanLayouts?.() ?? []) as Array<{ layout: number; text: string }>;
				if (!layouts.length)
					return {} as MenuItem;
				return {
					name: _('Change layout'), id: 'changelayout', type: 'menu',
					// 🔴 name: and uno: MUST share one physical line, and this is
					// load-bearing for the BUILD, not for style.
					// scripts/unocommands.py's extractMenuCommands only extracts a
					// line when `line.find("uno:") >= 0 and line.find("name:") < 0`,
					// then requires every extracted command to carry a description
					// in the core XCU. A parameterised command has no XCU node --
					// the node is the bare `.uno:AssignLayout`
					// (DrawImpressCommands.xcu) -- so extracting one fails the build
					// with "referenced in Online but have no description in the core
					// XCU files". Every other parameterised command in this file
					// (.uno:LanguageStatus?..., .uno:ConditionalFormatEasy?...,
					// .uno:InsertPageHeader?) survives only because it sits on one
					// line with name: and is therefore never extracted. Split this
					// across lines and `make` dies in browser/, ~15s in, long after
					// the hours-long engine stage -- and no CI catches it, because
					// vendor/ is sparse-excluded everywhere and the office build
					// skips PRs. BOTH lanes shipped a commit fixing exactly this.
					menu: layouts.map((entry) => ({name: entry.text, id: 'changelayout-' + entry.layout, uno: '.uno:AssignLayout?WhatLayout:long=' + entry.layout})),
				} as MenuItem;
			})(),
			// RunMacro was CUT from here. Hygiene, not a capability change: it
			// was already unreachable in practice, because _checkItemVisibility
			// returns false for id 'runmacro' whenever window.enableMacrosExecution
			// is unset, and it is off by default. It is a stock-office row with
			// no counterpart in google-slides.json. Desktop keeps it.
			//
			// Details is the third overflow row google-slides.json lists that is
			// deliberately NOT added, and this is the row closing as a decline
			// rather than staying open as a gap.
			//
			// The fork's only Details is '.uno:SetDocumentProperties' (the four
			// places that route to it are all desktop: the text/presentation/
			// spreadsheet menubars at :127/:477/:659/:814, the notebookbars, the
			// backstage view at Control.BackstageView.ts:1126). It is a stock
			// core dialog the fork does not compose -- it arrives over JSDialog
			// with a tabcontrol, and Widget.TabControl.tsx:14-18 states the case
			// against putting it on a phone in its own words: "the tab component
			// used by desktop JSDialogs ... the notebookbar and the mobile
			// wizard register their own tab handlers, so this component only
			// ever runs for desktop dialog tabcontrols." Past its
			// VERTICAL_TABS_THRESHOLD of 4 (:30) the tab rail even turns
			// vertical and takes inline-start width, on the axis a 390px sheet
			// has least of. That is exactly the shrink-a-desktop-control failure
			// the phone direction rules out, so no kebab row is added for it.
			//
			// What Google's Details actually shows -- name, owner, location,
			// size, modified -- is a small read-only card, not this dialog's
			// subject matter. Reopen the row when a phone-shaped card exists;
			// the pieces are already client-side (map['wopi'].BaseFileName,
			// Map.WOPI.js:21+). Do NOT reopen it by pointing the kebab at
			// .uno:SetDocumentProperties.
			//
			// Help & feedback is declined too, and for a blunter reason: NEITHER
			// half exists here. There is no feedback surface at all -- no menu
			// entry anywhere declares id 'feedback', nothing ever assigns
			// _map.feedback (its only two readers, :3139 and :3395, are guards
			// that hide a row that is never declared), and js/global.js:512
			// records the removal: "the welcome/feedback phone-home surfaces are
			// removed." The help half is showHelp() -> html/cool-help.html, whose
			// presentation content tells the reader to "Use the slide pane
			// toolbar in the bottom to start the slideshow, add slide, duplicate
			// or delete the current slide" (:674) -- the #toolbar-down bar this
			// branch cut on phone Impress (vulcan-theme.css §13i.13) -- and whose
			// other half is a Ctrl-key shortcut table on a device with no Ctrl
			// key. Its container has no upper-left exit either: Toolbar.js:758
			// builds it with showYesNoButton(..., _('OK'), ...), one button.
			// About stays: it is a real, short, already-shipping row, and it is
			// not a stand-in for either of these.
			{name: _('Fullscreen presentation'), id: 'fullscreen-presentation', type: 'action'},
			{name: _('About'), id: 'about', type: 'action'},
		],

		mobiledrawing: [
			{name: _('Search'), id: 'recsearch', type: 'action'},
			// See the mobiletext File menu for why Save / Save As / revision
			// history are gone on phones.
			{name: _UNO('.uno:PickList', 'presentation'), id: 'file', type: 'menu', menu: [
				{name: _('Export as'), id: 'exportas', type: 'menu', menu: [
					{name: _('PDF Document (.pdf)'), id: 'exportas-pdf', type: 'action'}
				]},
				{name: _('Share...'), id:'shareas', type: 'action'},
				{name: _UNO('.uno:Print', 'presentation'), unoid: '.uno:Print', id: 'print', type: 'action'},
			]},
			{name: !window.ThisIsAMobileApp ? _('Download as') : _('Export as'), id:'downloadas', type: 'menu', menu: [
				{name: _('PDF Document (.pdf)'), id: !window.ThisIsAMobileApp ? 'exportdirectpdf' : 'downloadas-pdf', type: 'action'},
				{name: _('PDF Document (.pdf) as...'), id: 'exportpdf', type: 'action'},
				{name: _('ODF Drawing (.odg)'), id: 'downloadas-odg', type: 'action'}
			]},
			{name: _UNO('.uno:EditMenu', 'presentation'), id: 'editmenu', type: 'menu', menu: [
				{uno: '.uno:Undo'},
				{uno: '.uno:Redo'},
				{name: _('Repair'), id: 'repair',  type: 'action'},
				{type: 'separator'},
				{uno: '.uno:Cut'},
				{uno: '.uno:Copy'},
				{uno: '.uno:Paste'},
				{uno: '.uno:SelectAll'},
				{type: 'separator'},
				// Inside editmenu for the read-posture reason spelt out in
				// mobiletext above.
				{uno: '.uno:SearchDialog', id: 'searchreplace'}
			]},
			{name: _UNO('.uno:ViewMenu', 'presentation'), id: 'view', type: 'menu', menu: [
				{uno: '.uno:SpellOnline'},
				{name: _UNO('.uno:FullScreen', 'presentation'), unoid: '.uno:FullScreen', id: 'fullscreen', type: 'action', mobileapp: false},
				{name: _('Dark Mode'), id: 'toggledarktheme', type: 'action'},
				{name: _('Invert Background'), id: 'invertbackground', type: 'action'},
			]
			},
			// Table drill-in removed for the same reason as Impress -- see the
			// comment in mobilepresentation. Google ships no Draw phone app at
			// all, so nothing in this array is protected by a parity target; the
			// edits here are kept to the same set as the other three for
			// consistency rather than inventing scope.
			{name: _UNO('.uno:PageMenu', 'presentation'), id: 'pagemenu', type: 'menu', menu: [
				{name: _UNO('.uno:InsertPage', 'presentation'), unoid: '.uno:InsertPage', id: 'insertpage', type: 'action'},
				{name: _UNO('.uno:DuplicatePage', 'presentation'), unoid: '.uno:DuplicatePage', id: 'duplicatepage', type: 'action'},
				{name: _UNO('.uno:DeletePage', 'presentation'), unoid: '.uno:DeletePage', id: 'deletepage', type: 'action'}]
			},
			{name: _('About'), id: 'about', type: 'action'},
		],

		mobilespreadsheet: [
			// Google Sheets puts one full Find-and-Replace route directly in the
			// phone overflow. Use the existing home-search action so the row takes
			// the same raw SearchDialog dispatch as Ctrl-F after the menu closes.
			// Keeping the UNO value supplies the localized label and icon.
			{uno: '.uno:SearchDialog', id: 'home-search', type: 'action'},
			// See the mobiletext File menu: Save / Save As / revision history
			// are deliberate phone cuts, not oversights.
			{name: _UNO('.uno:PickList', 'spreadsheet'), id: 'file', type: 'menu', menu: [
				{name: _('Export as'), id: 'exportas', type: 'menu', menu: [
					{name: _('PDF Document (.pdf)'), id: 'exportas-pdf', type: 'action'}
				]},
				{name: _('Share...'), id:'shareas', type: 'action'},
				{type: 'separator'},
				{name: _UNO('.uno:Print', 'spreadsheet'), unoid: '.uno:Print', id: 'print', type: 'action'},
				{name: _('Define print area'), uno: '.uno:DefinePrintArea' },
				{name: _('Remove print area'), uno: '.uno:DeletePrintArea' },
			]},
			{name: !window.ThisIsAMobileApp ? _('Download as') : _('Export as'), id:'downloadas', type: 'menu', menu: [
				{name: _('PDF Document (.pdf)'), id: !window.ThisIsAMobileApp ? 'exportdirectpdf' : 'downloadas-pdf', type: 'action'},
				{name: _('PDF Document (.pdf) as...'), id: 'exportpdf' , type: 'action'},
				{name: _('ODF spreadsheet (.ods)'), id: 'downloadas-ods', type: 'action'},
				{name: _('Excel 2003 Spreadsheet (.xls)'), id: 'downloadas-xls', type: 'action'},
				{name: _('Excel Spreadsheet (.xlsx)'), id: 'downloadas-xlsx', type: 'action'}
			]},
			{name: _UNO('.uno:EditMenu', 'spreadsheet'), id: 'editmenu', type: 'menu', menu: [
				{uno: '.uno:Undo'},
				{uno: '.uno:Redo'},
				{name: _('Repair'), id: 'repair',  type: 'action'},
				{type: 'separator'},
				{uno: '.uno:Cut'},
				{uno: '.uno:Copy'},
				{uno: '.uno:Paste'},
				{uno: '.uno:SelectAll'}
			]},
			{name: _UNO('.uno:ViewMenu', 'spreadsheet'), id: 'view', type: 'menu', menu: [
				{uno: '.uno:SpellOnline'},
				{name: _UNO('.uno:FullScreen', 'presentation'), unoid: '.uno:FullScreen', id: 'fullscreen', type: 'action', mobileapp: false},
				{name: _('Dark Mode'), id: 'toggledarktheme', type: 'action'},
				{name: _('Invert Background'), id: 'invertbackground', type: 'action'},
			]
			},
			{name: _UNO('.uno:SheetMenu', 'spreadsheet'), id: 'sheetmenu', type: 'menu', menu: [
				{name: _UNO('.uno:InsertRowsMenu', 'spreadsheet'), id: 'insertrowsmenu', type: 'menu', menu: [
					{uno: '.uno:InsertRowsBefore'},
					{uno: '.uno:InsertRowsAfter'}]},
				{name: _UNO('.uno:InsertColumnsMenu', 'spreadsheet'), id: 'insertcolumnsmenu', type: 'menu', menu: [
					{uno: '.uno:InsertColumnsBefore'},
					{uno: '.uno:InsertColumnsAfter'}]},
				{type: 'separator'},
				{uno: '.uno:DeleteRows'},
				{uno: '.uno:DeleteColumns'},
				{name: _UNO('.uno:ShowRow', 'spreadsheet', true), uno: '.uno:ShowRow'},
				{name: _UNO('.uno:ShowColumn', 'spreadsheet', true), uno: '.uno:ShowColumn'},
				{type: 'separator'},
				{name: _UNO('.uno:FreezePanes', 'spreadsheet'), uno: '.uno:FreezePanes'},
				{name: _UNO('.uno:FreezePanesColumn', 'spreadsheet'), uno: '.uno:FreezePanesColumn'},
				{name: _UNO('.uno:FreezePanesRow', 'spreadsheet'), uno: '.uno:FreezePanesRow'}
			]},
			{name: _UNO('.uno:DataMenu', 'spreadsheet'), id: 'datamenu', type: 'menu', menu: [
				{uno: '.uno:Validation'},
				{type: 'separator'},
				{uno: '.uno:SortAscending'},
				{uno: '.uno:SortDescending'},
				{type: 'separator'},
				// The next three are Google Sheets phone features Calc had no
				// phone route to at all. They sit under Data rather than at top
				// level ON PURPOSE: 'datamenu' is NOT in allowedReadonlyMenus, so
				// all three hide themselves whenever the document is read-only,
				// with zero new gating code. Top-level items in the mobile path
				// get no read-mode gating whatsoever (_beforeShow's logic is
				// jQuery over #main-menu, i.e. desktop only), so a flat placement
				// would show a viewer three controls that silently do nothing.
				//
				// NOTE for whoever reads the sibling comment in Permission.js:
				// removing phone Calc's OPT-IN read posture is NOT sufficient to
				// flatten these. That change only skips the first-open pencil
				// gate; a genuinely read-only session still exists -- server
				// permission 'view'/'readonly', a locked read-only user, or
				// _shouldStartReadOnly() on a degradable format. Flattening is
				// only safe once the mobile path has real read-mode gating of
				// its own.
				//
				// Each carries an explicit name: the XCU labels ('AutoFilter',
				// 'Conditional Formatting: More Rules', 'Manage Names...') are
				// desktop wording.
				// calc-create-a-filter-absent
				{name: _('Create a filter'), uno: '.uno:DataFilterAutoFilter'},
				{type: 'separator'},
				// calc-conditional-formatting-hidden-by-bottom-bar-cut. ONE entry,
				// not the desktop's three-level ConditionalFormatMenu tree: cut
				// discipline per docs/mobile-redesign 00 §5.
				{name: _('Conditional formatting'), uno: '.uno:ConditionalFormatDialog'},
				// calc-named-ranges-absent. Manage Names both lists AND adds, so
				// it replaces both desktop NamesMenu entries.
				{name: _('Named ranges'), uno: '.uno:DefineName'},
				{type: 'separator'},
				{name: _UNO('.uno:GroupOutlineMenu', 'spreadsheet'), id: 'groupoutlinemenu', type: 'menu', menu: [
					{uno: '.uno:Group'},
					{uno: '.uno:Ungroup'},
					{type: 'separator'},
					{uno: '.uno:ClearOutline'},
					{type: 'separator'},
					{uno: '.uno:HideDetail'},
					{uno: '.uno:ShowDetail'}]}
			]},
			{name: _('About'), id: 'about', type: 'action'},
		],

		mobileInsertMenu : {
			// Writer's + sheet mirrors the Google Docs phone insert list
			// (docs/mobile-redesign/01 §4): Link, Comment, Image, Table, Page
			// break, Page number, Footnote — everything else (charts, shapes,
			// fields, header/footer, fontwork, formatting marks, content
			// controls) is cut per the 01 §9 feature-cut discipline.
			'text' : {
				name: _UNO('.uno:InsertMenu', 'text'), id: 'insert', type: 'menu', menu: [
					{name: _UNO('.uno:HyperlinkDialog'), unoid: '.uno:HyperlinkDialog', id: 'inserthyperlink', type: 'action'},
					{name: _UNO('.uno:InsertAnnotation', 'text'), unoid: '.uno:InsertAnnotation', id: 'insertcomment', type: 'action'},
					{name: _('Local Image...'), id: 'insertgraphic', type: 'action'},
					{name: _UNO('.uno:InsertGraphic', 'text'), unoid: '.uno:InsertGraphic', id: 'insertgraphicremote', type: 'action'},
					{name: _UNO('.uno:TableMenu'), unoid: '.uno:TableMenu', id: 'inserttable', type: 'action'},
					{uno: '.uno:InsertPagebreak'},
					{uno: '.uno:InsertPageNumberField'},
					{uno: '.uno:InsertFootnote'},
				]
			},
			'spreadsheet' : {
				name: _UNO('.uno:InsertMenu', 'spreadsheet'), id: 'insert', type: 'menu', menu: [
					{name: _('Local Image...'), id: 'insertgraphic', type: 'action'},
					{name: _UNO('.uno:InsertGraphic', 'spreadsheet'), unoid: '.uno:InsertGraphic', id: 'insertgraphicremote', type: 'action'},
					{uno: '.uno:InsertObjectChart'},
					{name: _UNO('.uno:InsertAnnotation', 'spreadsheet'), unoid: '.uno:InsertAnnotation', id: 'insertcomment', type: 'action'},
					{type: 'separator'},
					{name: _UNO('.uno:HyperlinkDialog'), unoid: '.uno:HyperlinkDialog', id: 'inserthyperlink', type: 'action'},
					{name: _UNO('.uno:ShapesMenu'), unoid: '.uno:ShapesMenu', id: 'insertshape', type: 'action'},
					{uno: '.uno:InsertCurrentDate'},
					{uno: '.uno:InsertCurrentTime'},
					// other fields need EditEngine context & can't be disabled in the menu.
				]
			},
			// Impress's + sheet mirrors the Google Slides phone insert list.
			// (03-impress.md does not specify this surface; the authority
			// below is Google's own Help Center.) Google: "Tap Add (+) and you get
			// precisely four object types: Text, Image, Shape, Line. That is
			// the entire insert surface on both Android and iOS phone.
			// Google deliberately did not port the desktop insert menu." So
			// the order below is theirs, and the cuts are theirs too: "The
			// insert menu stops at Text/Image/Shape/Line. Tables, video,
			// audio, charts, diagrams and WordArt cannot be inserted on
			// phone — existing ones render and can be moved/resized, but not
			// created or structurally edited."
			//   - Chart (.uno:InsertObjectChart) — named computer-only.
			//   - Table (.uno:TableMenu) — named computer-only.
			//   - Fontwork — WordArt by another name, named computer-only.
			//   - the seven-entry Insert Field submenu — its headline entry
			//     is the slide number, and Google files that separately as
			//     unavailable on phone: "Adding slide numbers is unavailable
			//     on Android; the Help Center routes you to
			//     slides.google.com on a computer."
			// 🔴 COMMENT AND HYPERLINK ARE NOW CUT, and the note that used to
			// sit here defending them was wrong in a specific, checkable way.
			// It read: "Comment and Hyperlink stay: neither appears anywhere on
			// Google's not-shipped list, and the Writer entry above — the
			// curation precedent this follows — keeps both." Both halves fail:
			//   - "Not on the not-shipped list" is the wrong test. Google's
			//     clause here is an AFFIRMATIVE enumeration, not a subtraction:
			//     "precisely four object types: Text, Image, Shape, Line. That
			//     is the entire insert surface on both Android and iOS phone."
			//     A row does not need to be named as cut to be outside four.
			//   - The Writer precedent does not transfer, it CONTRADICTS. It is
			//     Docs-backed: google-docs.json "Insert (+) menu contents in
			//     Docs" — "a flat list: Comment, Link, Image, Table, Page break,
			//     Page number, Footnote, Horizontal line, and Special
			//     characters/emoji." Google put Comment and Link in the DOCS +
			//     sheet and kept them out of the SLIDES one. Copying the Writer
			//     list into Impress copied the one app-specific decision Google
			//     made differently on purpose.
			// So the six rows here were four of Google's plus two carried over
			// from a sibling app, and this is the one menu Google explicitly
			// refused to port wholesale.
			//
			// Neither cut strands a capability the same way:
			//   COMMENT was a THIRD route, and the two Google names are both
			//     already live in this tree. google-slides.json "Add a comment":
			//     "tap a slide in read mode and choose 'Add comment' … or select
			//     text/an object in edit mode and use More > Add comment." Route
			//     one is the read-posture bar (Control.MobileSelectionBar 'slide'
			//     mode, the 'slide-comment' button); route two is the edit-mode
			//     element pill (Control.ImpressSelectionBar setPage, the two
			//     `id: 'comment'` entries, text mode and shape mode). Both run
			//     the single VulcanSlideComment.insert, whose own header calls
			//     itself "the ONE 'Add comment' path on phone Impress" — which
			//     this row was quietly making false. Note the phone top bar's
			//     💬 was ALREADY curated out of the Impress edit posture
			//     (Control.MobileTopBar onUpdatePermission, isVulcanImpress) on
			//     the stated grounds that the pill is its second route; this row
			//     is the same over-delivery one surface further in.
			//   HYPERLINK is a real capability loss, stated as one rather than
			//     dressed up. `inserthyperlink` has no other phone Impress
			//     surface — after this it is desktop-menubar, desktop
			//     top-toolbar and Ctrl+K only. It goes anyway because Google's
			//     phone Slides has no link-insert flow to match: "hyperlink",
			//     "insert link" and "add a link" return ZERO across the whole
			//     Google phone corpus for Slides (google-slides.json, 76
			//     features), while Docs' + sheet names "Link" explicitly. If
			//     that ever turns out to be a hole in the corpus rather than in
			//     Google, this comes back scored against the clause that
			//     establishes it — not as a leftover from the desktop menu.
			//
			// The count this protects is load-bearing and has been broken by
			// accident before: adding the Line submenu closed one row and moved
			// this one further from Google, and nobody recounted. Anything added
			// here from now on either replaces one of the four or hangs off one
			// of them as a submenu, the way Line and Image below both do.
			//
			// LINE, the fourth of Google's four, is now here. The earlier note
			// in this comment parked it on the grounds that a bare
			// {uno: '.uno:Line'} "arms a draw TOOL rather than dropping an
			// object", so it wanted a wet test. Two arguments were written
			// here against that. 🔴 ONE OF THEM WAS FALSE and is withdrawn
			// below; only the second stands, which is a weaker position than
			// this comment used to claim. Read both before citing this entry:
			//   1. 🔴 WITHDRAWN — THIS ARGUMENT WAS FALSE. It claimed the phone
			//      Insert > Shapes sheet "ALREADY ships eleven commands of
			//      exactly the same family, bare and unparameterised:
			//      .uno:Connector, .uno:ConnectorLine, .uno:ConnectorCurve …
			//      (Control.Toolbar.js:519-531)". Those eleven live in the
			//      `insertconnectors` COLLECTION (Control.Toolbar.js:518), a
			//      sibling of `insertshapes` and not part of it, and the phone
			//      sheet never builds it: `_openInsertShapesWizard()` below
			//      calls `createShapesPanel('insertshapes')` and nothing else,
			//      so it renders only that collection's shape groups.
			//      `insertconnectors` is reached from
			//      `insertShapes('insertconnectors', …)`
			//      (Control.Toolbar.js:774) via the `insertconnectorspopup`
			//      HTML content (Widget.HTMLContent.ts:307), opened from the
			//      DESKTOP top toolbar's `insertconnectors` menubutton
			//      (Control.TopToolbar.js:238). No phone surface has ever
			//      dispatched a bare connector command.
			//      What survives of the point: the phone shapes grid does
			//      dispatch every shape bare and unparameterised, with the same
			//      `map.sendUnoCommand('.uno:' + uno)` (Control.Toolbar.js:626),
			//      so bare dispatch is not a new IDIOM here. But `.uno:Line`
			//      being a rubber-band tool rather than a drop is not covered
			//      by that — a BasicShapes.* command drops an object. The
			//      wet-test objection stands on argument 2 alone.
			//   2. Google's line IS a drag. Their Insert > Line submenu
			//      "offers line, arrow, elbow connector, curved connector, and
			//      scribble. Connectors snap to object anchor points when
			//      DRAGGED near them." An arm-then-drag flow is parity, not a
			//      defect — which is the whole reason this is not left out.
			// Reachability is verified statically, not assumed: `.uno:Line` is
			// already dispatched from two live Impress surfaces in this fork
			// (Control.TopToolbar.js:237 `insertline`, and
			// Control.NotebookbarImpress.js:1616-1617), and the label call used
			// here is the identical `_UNO('.uno:Line', 'presentation')` that
			// the notebookbar entry makes, so unocommands.js carries the
			// presentation-module string. The `{uno:}` shape routes through
			// Control.JSDialogBuilder.js:1906-1928, which closes the insert
			// wizard and then `sendUnoCommand`s — the same path the Writer
			// entry's `{uno: '.uno:InsertCurrentDate'}` above already takes.
			//
			// 🔴 THE OPEN QUESTION IS NOW ANSWERED, AND NOT BY A WET TEST.
			// Every earlier pass wrote that "whether the engine answers
			// `.uno:Line` by dropping a default-sized line or by arming a
			// rubber-band tool" could only be settled on a device, and filed
			// it as the highest-risk parity claim on the branch. It is settled
			// from source, because the ENGINE SOURCE IS IN THIS TREE
			// (../../engine, the LibreOffice core the fork is built against;
			// unocommands.js is generated out of it at build time by
			// online/scripts/unocommands.py, which is how we know it is the
			// right tree and not a stray copy). The chain, each link read
			// rather than assumed:
			//   a. `.uno:Line` is SID_DRAW_LINE (svx/sdi/svx.sdi:5610,
			//      `SfxBoolItem Line SID_DRAW_LINE`) and is in Impress's own
			//      slot interface (sd/sdi/_drvwsh.sdi:1229).
			//   b. DrawViewShell::FuPermanent handles it in the case block at
			//      sd/source/ui/view/drviewse.cxx:408-461 — the same block that
			//      carries SID_LINE_ARROW_END, SID_TOOL_CONNECTOR and the whole
			//      SID_CONNECTOR_* family — and at :503 sets
			//      `bCreateDirectly = comphelper::COKit::isActive()`.
			//   c. 🔴 WE ARE THE COKIT. So `bCreateDirectly` is TRUE here and
			//      false in desktop LibreOffice, and the guard at :667
			//      (`if(!(HasCurrentFunction() && ((rReq.GetModifier() &
			//      KEY_MOD1) || bCreateDirectly))) return;`) FALLS THROUGH
			//      instead of returning. :670-706 then builds a default-sized
			//      rectangle at the centre of the slide (:670-693; :684-687 replaces the
			//      window's visible area with the page size, "aVisArea is
			//      nonsensical in the COKit case"), calls
			//      `GetCurrentFunction()->CreateDefaultObject(nSId, …)` and
			//      `InsertObjectAtView`s the result (:707). :732 then dispatches
			//      SID_OBJECT_SELECT, so the tool disarms itself.
			//   d. The object that comes back is a real line:
			//      FuConstructRectangle::CreateDefaultObject
			//      (sd/source/ui/func/fuconrec.cxx:860) answers SID_DRAW_LINE
			//      at :942-967 with a two-point path across the rectangle.
			// So on THIS product, `.uno:Line` is a DROP, not an armed tool:
			// tapping the row inserts a default-sized line at the centre of the
			// slide, already selected, with no canvas gesture at all. Argument
			// 2 above (Google's line is a drag) is therefore not load-bearing
			// either — we are not matching their gesture, we are landing an
			// object they would have landed after the drag, which is the
			// better of the two outcomes on a phone.
			// 🔴 AND THE ARM-A-TOOL FEAR WAS NOT IDLE — it just lands on a
			// different surface. If `bCreateDirectly` were false the flow WOULD
			// be unreachable by touch, because MouseControl.onMouseMove
			// (src/canvas/sections/MouseControl.ts:396-414) turns every
			// `touchmove` during a drag into a view pan and never posts
			// buttondown/move to core, so no rubber-band on this canvas can
			// ever be completed with a finger. Anyone who removes the COKit
			// branch upstream removes every draw tool from the phone at once.
			// What is STILL not verified, and is genuinely device-only: where
			// the object lands relative to the visible viewport. It is centred
			// on the PAGE (:684-687), not on what you are looking at, so on a
			// zoomed-in phone canvas the new line can be off-screen. That is a
			// scroll-to-selection question, not an insert question.
			//
			// 🔴 Reachability, decided rather than assumed. This structure
			// has NO chrome gate, and "desktop menus are untouched" is only
			// half the story: the desktop Insert menu (the 'presentation'
			// entry in `menubar`, further up this file) is genuinely
			// unmodified, but mobileInsertMenu is chosen by FORM FACTOR, not
			// by chrome. Control.UIManager.ts:745-748 builds mobileTopBar on
			// window.mode.isSmallScreenDevice() alone, so on a phone run with
			// ?vulcanChrome=desktop the + button still dispatches
			// insertion_mobile_wizard into this list, and there is no desktop
			// menubar on a small screen to fall back to. In that one
			// configuration Chart, Table, Fontwork and the seven Insert Field
			// entries are unreachable.
			// That is accepted, not overlooked: the landed Writer ('text')
			// and Calc ('spreadsheet') entries directly above make exactly
			// the same bargain, and gating this one doctype would make
			// Impress behave differently from the two surfaces it is meant to
			// match — the same asymmetry the format-sheet gate in
			// docdispatcher.ts avoids. If a phone-with-desktop-chrome escape
			// hatch is wanted, it belongs on all three doctypes at once, not
			// bolted onto Impress here.
			'presentation' : {
				name: _UNO('.uno:InsertMenu', 'presentation'), id: 'insert', type: 'menu', menu: [
					{name: _UNO('.uno:Text', 'presentation'), unoid: '.uno:Text', id: 'inserttextbox', type: 'action'},
					// IMAGE IS A SUBMENU for the same reason LINE below is: Google's
					// image row opens a second sheet rather than a picker.
					// google-slides.json "Insert > Image sources": "Choosing Image
					// prompts 'choose where to get your image from' — camera (take a
					// picture now), device photos, and Google Drive/Photos. The image
					// lands centered on the slide, already selected with handles
					// showing." So the + list still opens on Text / Image / Shape /
					// Line, and Image is one row until you tap it — the count above is
					// untouched.
					//
					// TWO of Google's three sources are here. The third is deliberately
					// absent; see the remote-image note below.
					//
					// The two are two INPUT ELEMENTS, not two modes of one, and that is
					// the whole mechanism — see html/cool.html.m4. `capture` is an
					// attribute on the input, not an argument to the click: with it
					// present iOS Safari opens the camera directly instead of raising
					// its Photo Library / Take Photo / Choose File action sheet, and
					// Android Chrome skips its chooser the same way. Adding it to the
					// existing #insertgraphic would therefore have DELETED the photo
					// library for every caller of that shared element — Writer, Calc,
					// Draw, the desktop top toolbar, and ContentControlSection's
					// picture picker all click the same node. Hence #insertgraphiccamera
					// alongside it, and `insertgraphiccamera` in _executeAction.
					//
					// ⚠ Honest about what this does and does not buy, because the
					// camera was never strictly unreachable: on iOS Safari the OS action
					// sheet behind today's single row already offers "Take Photo or
					// Video". What was missing is that our UI never NAMED a camera
					// source, and on Android the chooser that offers it is OEM-dependent
					// rather than guaranteed. Tap counts to either destination are
					// unchanged; the source is now named and the camera is reached the
					// same way on both platforms. Nothing here is wet-tested — this is
					// patched, pending the build.
					{name: _UNO('.uno:InsertGraphic', 'presentation'), id: 'insertimagemenu', type: 'menu', menu: [
						{name: _('Take photo'), id: 'insertgraphiccamera', type: 'action'},
						{name: _('Choose photo'), id: 'insertgraphic', type: 'action'},
					]},
					// 🔴 THE REMOTE-IMAGE ROW STAYS CUT, and it must not come back as
					// Google's third source without a HOST change first. It never
					// rendered: _checkItemVisibility drops 'insertgraphicremote'
					// whenever wopi.EnableInsertRemoteImage is false — which is always,
					// because no WOPI route this product serves ever sends that key and
					// Map.WOPI.js:35 defaults it to false.
					//
					// Sending the flag is a one-line host change and would be the WRONG
					// one on its own. The flag is not a feature switch, it is the
					// integration DECLARING that it implements a remote picker: the row
					// fires `postMessage {msgId: 'UI_InsertGraphic'}` (_executeAction, and
					// docdispatcher 'remotegraphic') and then waits for the host to
					// answer 'Action_InsertGraphic' with a URL (Map.WOPI.js:947). Our
					// host has the bridge — it already handles UI_Share — and handles
					// UI_InsertGraphic NOWHERE: zero hits for UI_InsertGraphic and
					// Action_InsertGraphic across apps/ and packages/. Flipping the flag
					// would rebuild the exact phantom just removed, one layer deeper: a
					// row that renders, is tappable, and does nothing at all. Not
					// stateless either — 'remotegraphic' also joins the desktop
					// InsertImageMenu (Map.WOPI.js:397-400), so the dead row would appear
					// on desktop too.
					//
					// And what it would open is not Google's source anyway. Theirs is
					// "Google Drive/Photos"; ours would have to be the host's file
					// library, which is a picker somebody has to design and build in the
					// host frame. That is a product decision on the THIRD-ranked source
					// of a phone VIEWER, behind the two that now ship. Filed, not built.
					//
					// ⚠ Recorded while reading that gate, NOT fixed here because it is a
					// host change with a real behaviour consequence: the host sends
					// `DisableInsertImage` (files/[fileId]/route.ts:496) meaning to hide
					// local image insert from viewers and commenters, but coolwsd only ever
					// reads `DisableInsertLocalImage` (wsd/wopi/WopiStorage.cpp:242), so
					// that flag is inert and the row renders for everyone. That is the
					// INVERSE defect -- a row that renders when the host asked for it to be
					// hidden -- and fixing it removes Insert > Image for commenters, which
					// is a product decision, not a lint fix. The visibility gate now names
					// all three ids (insertgraphic, insertgraphiccamera, insertimagemenu)
					// so that correction hides the parent row with its children instead of
					// leaving an Image row that opens an empty sheet.
					//
					// ⚠ Recorded while reading that gate, NOT fixed here because it is a
					// host change with a real behaviour consequence: the host sends
					// `DisableInsertImage` (files/[fileId]/route.ts:496) meaning to hide
					// local image insert from viewers and commenters, but coolwsd only ever
					// reads `DisableInsertLocalImage` (wsd/wopi/WopiStorage.cpp:242), so
					// that flag is inert and the row renders for everyone. That is the
					// INVERSE defect -- a row that renders when the host asked for it to be
					// hidden -- and fixing it removes Insert > Image for commenters, which
					// is a product decision, not a lint fix.
					{name: _UNO('.uno:ShapesMenu'), unoid: '.uno:ShapesMenu', id: 'insertshape', type: 'action'},
					// Google's order is Text, Image, Shape, Line — Line sits
					// directly after Shape, and is now the LAST row: the two
					// non-Google keeps that used to follow it (Comment,
					// Hyperlink) are gone. See the count note in this entry's
					// header comment for why, and for the two live routes that
					// carry Add comment.
					//
					// LINE IS A SUBMENU, because Google's is
					// (google-slides.json, "Insert > Line submenu", insert /
					// niche): "Offers line, arrow, elbow connector, curved
					// connector, and scribble. Connectors snap to object anchor
					// points when dragged near them." The five rows below are
					// those five, in that order. This does not change the count
					// the row above cares about — the Insert list still opens on
					// Text / Image / Shape / Line, and Line is one row until you
					// tap it.
					//
					// Each command was resolved against the engine source in
					// this tree rather than guessed, and each was checked for
					// the SAME `bCreateDirectly` behaviour the long note above
					// establishes for `.uno:Line` — i.e. that tapping the row
					// DROPS an object rather than arming a gesture the phone
					// canvas cannot finish:
					//   arrow             .uno:LineArrowEnd
					//                     = SID_LINE_ARROW_END, in the
					//                     drviewse.cxx:408-461 block (:412), so
					//                     same drop path; default object at
					//                     fuconrec.cxx:945.
					//   elbow connector   .uno:Connector
					//                     = SID_TOOL_CONNECTOR (:433). It is the
					//                     ELBOW one by omission, not by name:
					//                     FuConstructRectangle::SetAttributes
					//                     (fuconrec.cxx:556, branches at :566-597)
					//                     gives OneLine to
					//                     the CONNECTOR_LINE family, ThreeLines
					//                     to CONNECTOR_LINES and Bezier to
					//                     CONNECTOR_CURVE, and never mentions
					//                     SID_TOOL_CONNECTOR — which therefore
					//                     keeps SdrEdgeKindItem's default,
					//                     SdrEdgeKind::OrthoLines
					//                     (include/svx/sxekitm.hxx:34). Ortho =
					//                     right-angled = Google's "elbow".
					//                     🔴 Do NOT "fix" this to
					//                     .uno:ConnectorLines because its label
					//                     reads "Line Connector"; that one is
					//                     ThreeLines, and .uno:ConnectorLine
					//                     ("Straight Connector") is OneLine.
					//                     The three names are nearly
					//                     interchangeable in English and are not
					//                     interchangeable in the engine.
					//   curved connector  .uno:ConnectorCurve
					//                     = SID_CONNECTOR_CURVE (:447), Bezier
					//                     (fuconrec.cxx:588-597).
					//   scribble          .uno:Freeline_Unfilled
					//                     = SID_DRAW_FREELINE_NOFILL. This one is
					//                     a DIFFERENT case block
					//                     (drviewse.cxx:509-516) and a different
					//                     function class, FuConstructBezierPolygon
					//                     — but :520 sets the same
					//                     `bCreateDirectly = COKit::isActive()`,
					//                     and FuConstructBezierPolygon::
					//                     CreateDefaultObject (fuconbez.cxx:408)
					//                     answers SID_DRAW_FREELINE_NOFILL at
					//                     :462-490 with a two-segment bezier. It
					//                     had to be checked separately: unlike
					//                     FuConstructRectangle::MouseButtonUp
					//                     (fuconrec.cxx:322-338, "Drag was too
					//                     small to create object, so insert
					//                     default object at click pos"),
					//                     FuConstructBezierPolygon::MouseButtonUp
					//                     (fuconbez.cxx:192-228) has NO
					//                     click-fallback, so on the mouse path
					//                     scribble would be the one entry a tap
					//                     could not complete. It is only safe
					//                     because the COKit branch never reaches
					//                     the mouse path.
					//
					// Labels are OURS (`_()`), not `_UNO()`, and that is
					// deliberate on two counts. First, unocommands.js is
					// GENERATED from the engine at build time and this lane
					// cannot read it, so `_UNO('.uno:LineArrowEnd', …)` — which
					// has no other call site in the fork — risks rendering the
					// raw command name as a menu label, and a label that lies
					// about what a row does is the one defect class the phone
					// brief calls always-wrong regardless of posture. Second,
					// the engine's own strings are desktop draughting names
					// ("Line Ends with Arrow", "Curved Connector", "Freeform
					// Line", from GenericCommands.xcu:2472/2341/5360) and the
					// brief is to copy Slides, whose words these are. The
					// parent row keeps `_UNO('.uno:Line', 'presentation')` so
					// the entry point reads exactly as it does today.
					{name: _UNO('.uno:Line', 'presentation'), id: 'insertlinemenu', type: 'menu', menu: [
						{name: _UNO('.uno:Line', 'presentation'), uno: '.uno:Line'},
						{name: _('Arrow'), uno: '.uno:LineArrowEnd'},
						{name: _('Elbow connector'), uno: '.uno:Connector'},
						{name: _('Curved connector'), uno: '.uno:ConnectorCurve'},
						{name: _('Scribble'), uno: '.uno:Freeline_Unfilled'},
					]},
				]
			},
			drawing : {
				name: _UNO('.uno:InsertMenu', 'presentation'), id: 'insert', type: 'menu', menu: [
					{name: _('Local Image...'), id: 'insertgraphic', type: 'action'},
					{name: _UNO('.uno:InsertGraphic', 'presentation'), unoid: '.uno:InsertGraphic', id: 'insertgraphicremote', type: 'action'},
					{uno: '.uno:InsertObjectChart'},
					{name: _UNO('.uno:InsertAnnotation', 'presentation'), unoid: '.uno:InsertAnnotation', id: 'insertcomment', type: 'action'},
					{name: _UNO('.uno:TableMenu'), unoid: '.uno:TableMenu', id: 'inserttable', type: 'action'},
					{name: _UNO('.uno:HyperlinkDialog'), unoid: '.uno:HyperlinkDialog', id: 'inserthyperlink', type: 'action'},
					{name: _UNO('.uno:ShapesMenu'), unoid: '.uno:ShapesMenu', id: 'insertshape', type: 'action'},
					{name: _UNO('.uno:FontworkGalleryFloater'), uno: '.uno:FontworkGalleryFloater', id: 'fontworkgalleryfloater'},
					{name: _UNO('.uno:Text', 'presentation'), unoid: '.uno:Text', id: 'inserttextbox', type: 'action'},
					{name: _UNO('.uno:InsertField', 'text'), id: 'insertfield', type: 'menu', menu: [
						{name: _UNO('.uno:InsertDateFieldFix', 'presentation'), uno: '.uno:InsertDateFieldFix'},
						{name: _UNO('.uno:InsertDateFieldVar', 'presentation'), uno: '.uno:InsertDateFieldVar'},
						{name: _UNO('.uno:InsertTimeFieldFix', 'presentation'), uno: '.uno:InsertTimeFieldFix'},
						{name: _UNO('.uno:InsertTimeFieldVar', 'presentation'), uno: '.uno:InsertTimeFieldVar'},
						{type: 'separator'},
						{name: _UNO('.uno:InsertPageField', 'presentation'), uno: '.uno:InsertPageField'},
						{name: _UNO('.uno:InsertPageTitleField', 'presentation'), uno: '.uno:InsertPageTitleField'},
						{name: _UNO('.uno:InsertPagesField', 'presentation'), uno: '.uno:InsertPagesField'},
					]},
				]
			}
		},

		commandStates: {},

		// Only these menu options will be visible in readonly mode
		allowedReadonlyMenus: window.mode.isCODesktop() ? ['file', 'editmenu', 'view', 'slide', 'help'] : ['file', 'editmenu', 'downloadas', 'view', 'insert', 'slide', 'help', 'print'],
		allowedRedlineManagementMenus: window.mode.isCODesktop() ? [] : ['editmenu', 'changesmenu', ],

		math: ['.uno:ChangeFont', '.uno:ChangeFontSize', '.uno:ChangeDistance', '.uno:ChangeAlignment'],

		// Only these UNO commands will be enabled in readonly mode
		allowedViewModeCommands: [
			'.uno:Signature',
			// Copying, selecting and navigating do not change the document, so
			// a viewer is allowed to use them. Copy, Select All and Go to Page
			// live in the Edit menu, which is why 'editmenu' is kept visible in
			// allowedReadonlyMenus above; Navigator lives in the View menu.
			// Searching uses the separate 'find' action below, not the
			// editable Find & Replace dialog.
			'.uno:Copy',
			'.uno:SelectAll',
			'.uno:GotoPage',
			'.uno:Navigator',
		],

		allowedViewModeActions: [
			() => app.sectionContainer.getSectionWithName(app.CSections.CommentList.name).hasAnyComments() ? 'savecomments' : undefined,
			'shareas', //file menu
			'print','print-active-sheet', 'print-all-sheets', 'print-notespages', // file menu
			'downloadas-odt', 'downloadas-doc', 'downloadas-docx', 'downloadas-rtf', // file menu
			'downloadas-odp', 'downloadas-ppt', 'downloadas-pptx', 'downloadas-odg', 'exportpdf' , // file menu
			!window.ThisIsAMobileApp ? 'exportdirectpdf' : 'downloadas-pdf', !window.ThisIsAMobileApp ? 'exportepub' : 'downloadas-epub', // file menu
			'downloadas-ods', 'downloadas-xls', 'downloadas-xlsx', 'downloadas-csv', 'closedocument', // file menu
			() => !window.L.Browser.edge ? 'fullscreen' : undefined, 'zoomin', 'zoomout', 'zoomreset', 'fitwidthzoom', 'showruler', 'showstatusbar', 'showresolved', 'showannotations', 'toggledarktheme', // view menu
			'insert-signatureline', // insert menu
			'about', 'keyboard-shortcuts', 'serveraudit', 'online-help', // help menu
			'insertcomment',
			'find' // edit menu
		],

		// Only these UNO commands will be enabled in redline management mode
		allowedRedlineManagementModeCommands: [
			'.uno:ShowTrackedChanges',
			'.uno:AcceptTrackedChanges',
			'.uno:AcceptTrackedChange',
			'.uno:RejectTrackedChange',
			'.uno:AcceptAllTrackedChanges',
			'.uno:RejectAllTrackedChanges',
			'.uno:AcceptTrackedChangeToNext',
			'.uno:RejectTrackedChangeToNext',
			'.uno:CommentChangeTracking',
			'.uno:PreviousTrackedChange',
			'.uno:NextTrackedChange',
		],

		allowedRedlineManagementModeActions: [
			'acceptalltrackedchanges',
			'rejectalltrackedchanges',
		],
	}

	// Private properties
	private _initialized: boolean = false;
	private _hiddenItems: string[] = [];
	private _menubarCont: HTMLElement | null = null;
	private _isFileODF: boolean = true;
	private lastModIndicator: HTMLElement | null = null;
	private _map: any;
	// The inputs key of the last _onRefresh rebuild; null forces one.
	private _lastRebuildInputsKey: string | null = null;

	/**
	 * Called when the menubar is added to the map.
	 * Initializes the menubar container, sets up the template, and binds events.
	 * @param map - The Leaflet map instance.
	 * @returns The menubar container HTMLElement.
	 */
	onAdd(map: ReturnType<typeof window.L.Map>) {
		this._initialized = false;
		this._hiddenItems = [];
		this._menubarCont = window.L.DomUtil.get('main-menu');
		this._isFileODF = true;
		// A re-added menubar starts from an empty container, so the rebuild
		// guard's key must not carry over from a previous life.
		this._lastRebuildInputsKey = null;
		this._map = map;
		// In case it contains garbage
		if (this._menubarCont)
			this._menubarCont.remove();
		// Use original template as provided by server
		this._menubarCont = map.mainMenuTemplate.cloneNode(true);
		if (this._menubarCont != null)
			$('#main-menu-state').after(this._menubarCont);

		if (window.mode.isDesktop()) {
			$('#main-menu-state').attr('type', 'hidden');
		}

		if (!this._map['wopi'].DisablePresentation)
			this.options.allowedViewModeActions = this.options.allowedViewModeActions.concat(['fullscreen-presentation', 'presentation-currentslide', 'present-in-window','presentation-in-console']);

		this._initializeMenu(this.options.initial);

		map.on('doclayerinit', this._onDocLayerInit, this);
		this._onRefresh = this._onRefresh.bind(this);
		app.events.on('updatepermission', this._onRefresh);
		map.on('addmenu', this._addMenu, this);
		map.on('languagesupdated', this._onInitLanguagesMenu, this);
		map.on('updatetoolbarcommandvalues', this._onStyleMenu, this);
		map.on('initmodificationindicator', this._onInitModificationIndicator, this);
		map.on('updatemodificationindicator', this._onUpdateModificationIndicator, this);
	}

	/**
	 * Called when the menubar is removed from the map.
	 * Unbinds events and cleans up the menubar container.
	 */
	onRemove(): void {

		this._map.off('doclayerinit', this._onDocLayerInit, this);
		this._map.off('addmenu', this._addMenu, this);
		this._map.off('languagesupdated', this._onInitLanguagesMenu, this);
		this._map.off('updatetoolbarcommandvalues', this._onStyleMenu, this);
		this._map.off('initmodificationindicator', this._onInitModificationIndicator, this);
		this._map.off('updatemodificationindicator', this._onUpdateModificationIndicator, this);
		app.events.off('updatepermission', this._onRefresh);

		this._menubarCont?.remove();
		this._menubarCont = null;
	}

	/**
	 * Adds a new action menu item to the menubar.
	 * @param e - Event data containing the new menu item details.
	 */
	private _addMenu(e: any): void {
		var alreadyExists = window.L.DomUtil.get('menu-' + e.id);
		if (alreadyExists)
			return;

		var liItem = window.L.DomUtil.create('li', '');
		liItem.setAttribute('role', 'menuitem');
		liItem.id = 'menu-' + e.id;
		if (this._map.isReadOnlyMode()) {
			window.L.DomUtil.addClass(liItem, 'readonly');
		}
		var aItem = window.L.DomUtil.create('a', '', liItem);
		$(aItem).text(e.label);
		$(aItem).data('id', e.id);
		$(aItem).data('type', 'action');
		$(aItem).data('postmessage', 'true');
		aItem.tabIndex = 0;
		this._menubarCont?.insertBefore(liItem, this._menubarCont.firstChild);
	}

	/**
       * Creates a menu item element for a UNO command.
       * @param caption - The display text.
       * @param command - The UNO command string.
       * @param tag - Optional additional tag.
       * @returns The created list item element.
       */
	private _createUnoMenuItem(caption: string, command: string, tag?: string): HTMLElement {
		var liItem, aItem;
		liItem = window.L.DomUtil.create('li', '');
		liItem.setAttribute('role', 'menuitem');
		aItem = window.L.DomUtil.create('a', '', liItem);
		$(aItem).text(caption);
		$(aItem).data('type', 'unocommand');
		$(aItem).data('uno', command);
		if (tag !== undefined)
			$(aItem).data('tag', tag);
		aItem.tabIndex = 0;
		return liItem;
	}

	/**
	 * Creates a menu item element for an action.
	 * @param caption - The display text.
	 * @param id - The action identifier.
	 * @returns The created list item element.
	 */
	private _createActionMenuItem(caption: string, id: string): HTMLElement {
		var liItem, aItem;
		liItem = window.L.DomUtil.create('li', '');
		liItem.setAttribute('role', 'menuitem');
		aItem = window.L.DomUtil.create('a', '', liItem);
		$(aItem).text(caption);
		$(aItem).data('type', 'action');
		$(aItem).data('id', id);
		aItem.tabIndex = 0;
		return liItem;
	}

	/**
	 * Initializes the languages menu.
	 */
	private _onInitLanguagesMenu(): void {
		var translated, neutral;
		var constDefa = 'Default_RESET_LANGUAGES';
		var constCurr = 'Current_RESET_LANGUAGES';
		var constPara = 'Paragraph_RESET_LANGUAGES';
		var constLang = '.uno:LanguageStatus?Language:string=';
		var resetLang = _('Reset to Default Language');
		var languages  = app.languages;

		var $menuSelection = $('#menu-noneselection').parent();
		var $menuParagraph = $('#menu-noneparagraph').parent();
		var $menuDefault = $('#menu-nonelanguage').parent();

		var noneselection = $('#menu-noneselection').detach();
		var fontlanguage = $('#menu-fontlanguage').detach();
		var noneparagraph = $('#menu-noneparagraph').detach();
		var paragraphlanguage = $('#menu-paragraphlanguage').detach();
		var nonelanguage = $('#menu-nonelanguage').detach();

		// clear old entries

		$menuSelection.empty();
		$menuParagraph.empty();
		$menuDefault.empty();

		for (var lang in languages) {
			if (languages.length > 10 && app.favouriteLanguages.indexOf(languages[lang].iso) < 0)
				continue;

			translated = languages[lang].translated;
			neutral = languages[lang].neutral;

			$menuSelection.append(this._createUnoMenuItem(translated, constLang + encodeURIComponent('Current_' + neutral)));
			$menuParagraph.append(this._createUnoMenuItem(translated, constLang + encodeURIComponent('Paragraph_' + neutral)));
			$menuDefault.append(this._createUnoMenuItem(translated, constLang + encodeURIComponent('Default_' + neutral)));
		}

		$menuSelection.append(this._createActionMenuItem(_('More...'), 'morelanguages-selection'));
		$menuParagraph.append(this._createActionMenuItem(_('More...'), 'morelanguages-paragraph'));
		$menuDefault.append(this._createActionMenuItem(_('More...'), 'morelanguages-all'));

		$menuSelection.append(this._createMenu([{type: 'separator'}]));
		$menuParagraph.append(this._createMenu([{type: 'separator'}]));
		$menuDefault.append(this._createMenu([{type: 'separator'}]));

		$menuSelection.append(this._createUnoMenuItem(resetLang, constLang + constCurr));
		$menuParagraph.append(this._createUnoMenuItem(resetLang, constLang + constPara));
		$menuDefault.append(this._createUnoMenuItem(resetLang, constLang + constDefa));

		$menuSelection.append(noneselection);
		$menuSelection.append(fontlanguage);
		$menuParagraph.append(noneparagraph);
		$menuParagraph.append(paragraphlanguage);
		$menuDefault.append(nonelanguage);
	}

	/**
       * Adds tabindex properties to main menu items.
       */
	private _addTabIndexPropsToMainMenu(): void {
		var mainMenu = document.getElementById('main-menu');
		if (mainMenu == null)
			return;

		for (var i = 0; i < mainMenu.children.length; i++) {
			if (mainMenu.children[i].children[0].getAttribute('aria-haspopup') === 'true') {
				(mainMenu.children[i].children[0] as HTMLElement).tabIndex = 0;
			}
		}
	}

	// Populate the Extensions submenu in `menu` from the current
	// app.map._extensions; called from _onRefresh, which also runs after
	// loadExtensions resolves (via menubar.refresh()), so the menu
	// reflects whichever manifests the discovery picked up.
	private _refreshExtensionsMenu(menu: MenuItem[]): void {
		const idx = menu.findIndex((item) => item.id === 'extensions-menu');
		if (idx < 0) return;
		// Gate the Extensions submenu on the experimental-features flag by
		// splicing it out of the static menu definition; subsequent calls
		// find no entry and return early:
		if (!window.enableExperimentalFeatures) {
			menu.splice(idx, 1);
			return;
		}
		const target = menu[idx];
		const exts = (this._map._extensions || {}) as { [id: string]: any };
		const ids = Object.keys(exts).sort();
		if (ids.length === 0) {
			// Hide the whole Extensions submenu when nothing is installed.
			// Use the `hidden` flag rather than splicing the entry out, so a
			// later refresh (once discovery populates app.map._extensions) can
			// reveal it again — a spliced-out entry would never be found again.
			target.hidden = true;
			target.menu = [];
			return;
		}
		target.hidden = false;
		target.menu = ids.map((id) => ({
			name: exts[id].options.manifest.name as string,
			id: 'extension-toggle-' + id,
			type: 'action',
		}));
	}

	// Public entry point for external callers to ask for a menubar rebuild
	// (e.g. once Control.Extension.loadExtensions has populated
	// app.map._extensions and the Extensions submenu needs to repopulate).
	public refresh(): void {
		this._onRefresh();
	}

	/**
	 * Refreshes the menubar.
	 */
	private _onRefresh(): void {
		if (!this._initialized) {
			this._initialized = true;
			this._onDocLayerInit();
		}

		// Rebuild only when the inputs the build reads have changed.
		// 'updatepermission' fires in identical bursts (4-5 per load,
		// measured), each rebuild constructs a NEW SmartMenus instance
		// (jquery.smartmenus $.fn wrapper) and KILLS any open menu — the
		// mid-session no-op rebuild is the armed path behind the desktop
		// first-click self-close. The key is the inputs, never menu-open
		// state: a real permission flip changes the key and still rebuilds
		// (closing an open menu is correct there). Extension ids cover the
		// loadExtensions refresh(); editComment is _createMenu's other
		// readonly-branch read.
		var inputsKey = [
			this._map.getDocType(),
			this._map.isReadOnlyMode(),
			app.file.editComment,
			Object.keys(this._map._extensions || {}).sort().join(','),
		].join('|');
		if (inputsKey === this._lastRebuildInputsKey)
			return;
		this._lastRebuildInputsKey = inputsKey;

		// clear initial menu
		if (this._menubarCont)
			window.L.DomUtil.removeChildNodes(this._menubarCont);

		// Add document specific menu
		var docType = this._map.getDocType();
		if (docType === 'text') {
			this._refreshExtensionsMenu(this.options.text);
			this._initializeMenu(this.options.text);
		} else if (docType === 'spreadsheet') {
			this._refreshExtensionsMenu(this.options.spreadsheet);
			this._initializeMenu(this.options.spreadsheet);
		} else if (docType === 'presentation') {
			this._refreshExtensionsMenu(this.options.presentation);
			this._initializeMenu(this.options.presentation);
		} else if (docType === 'drawing') {
			this._refreshExtensionsMenu(this.options.drawing);
			this._initializeMenu(this.options.drawing);
		}

		// initialize menubar plugin
		$('#main-menu').smartmenus({
			hideOnClick: true,
			showOnClick: true,
			hideTimeout: 0,
			hideDuration: 0,
			hideFunction: null,
			showDuration: 0,
			showFunction: null,
			showTimeout: 0,
			collapsibleHideDuration: 0,
			collapsibleHideFunction: null,
			subIndicatorsPos: 'append',
			subIndicatorsText: '&#8250;'
		});
		$('#main-menu').attr('tabindex', 0);
		$('#main-menu ul').attr('role', 'menu');

		document.getElementById('main-menu')?.setAttribute('role', 'menubar');
		this._addTabIndexPropsToMainMenu();
		this._createFileIcon();
	}

	/**
	 * Function to bind an event if it's not already bound.
	 * @param element - The target element.
	 * @param eventType - The event type.
	 * @param namespace - The namespace.
	 * @param data - Data to pass to the event handler.
	 * @param handler - The event handler function.
	 */
	private _bindEventIfNotBound(element: any, eventType: string, namespace: string, data: any, handler: any): void {
		const eventName = eventType + (namespace ? '.' + namespace : '');
		$(element).off(eventName).on(eventName, data, (e, menu) => handler.call(this, e, menu));
	}

	/**
	 * Handles style changes for the menu based on UNO command state.
	 * @param e - The event containing command state data.
	 */
	private _onStyleMenu(e: any): void {
		if (e.commandName === '.uno:StyleApply') {
			var style: any;
			var constArg = '&';
			var constHeader = '.uno:InsertPageHeader?PageStyle:string=';
			var constFooter = '.uno:InsertPageFooter?PageStyle:string=';
			var $menuHeader = $('#menu-insertheader').parent();
			var $menuFooter = $('#menu-insertfooter').parent();
			var pageStyles = e.commandValues['HeaderFooter'];
			for (var iterator in pageStyles) {
				style = pageStyles[iterator];
				if (!window.mode.isSmallScreenDevice()) {
					$menuHeader.append(this._createUnoMenuItem(_(style), constHeader + encodeURIComponent(style) + constArg, style));
					$menuFooter.append(this._createUnoMenuItem(_(style), constFooter + encodeURIComponent(style) + constArg, style));
				} else {
					var docType: string = this._map.getDocType();
					var target = this.options.mobileInsertMenu[docType];

					var findFunction = (item: MenuItem) => {
						return item.name === _(style);
					};

					var foundMenu = this._findSubMenuByName(target, _UNO('.uno:InsertPageHeader', 'text'));
					if (foundMenu && foundMenu.menu.find(findFunction) === undefined)
						foundMenu.menu.push({name: _(style), tag: style, uno: constHeader + encodeURIComponent(style) + constArg});

					foundMenu = this._findSubMenuByName(target, _UNO('.uno:InsertPageFooter', 'text'));
					if (foundMenu && foundMenu.menu.find(findFunction) === undefined)
						foundMenu.menu.push({name: _(style), tag: style, uno: constFooter + encodeURIComponent(style) + constArg});
				}
			}
		}
	}

	/**
	 * Creates a new document when the file icon is clicked.
	 * @param e - The event data.
	 */
	private _createDocument(e: any): void {
		var self = e.data.self;
		var docType = self._map.getDocType();
		self._map.fire('postMessage', {msgId: 'UI_CreateFile', args: {DocumentType: docType}});
	}

	/**
       * Initializes the menubar when the document layer is ready.
       */
	private _onDocLayerInit(): void {
		this._onRefresh();

		// Once per document load. Deliberately NOT in _onRefresh: that is the
		// menubar's rebuild burst, which MenubarRefreshRebuildGuard keeps free
		// of work precisely so a refresh cannot kill an open menu, and the find
		// box sits in #document-titlebar, which smartmenus never rebuilds.
		this._vulcanAddFindBox();
		this._vulcanAddShareButton();
		this._vulcanScrollableMenuRow();

		// Usage
		this._bindEventIfNotBound('#main-menu', 'select', 'smapi', {self: this}, this._onItemSelected);
		this._bindEventIfNotBound('#main-menu', 'beforeshow', 'smapi', {self: this}, this._beforeShow);
		this._bindEventIfNotBound('#main-menu', 'show', 'smapi', {self: this}, this._vulcanAnchorMenuPopup);
		this._bindEventIfNotBound('#main-menu', 'click', 'smapi', {self: this}, this._onClicked);
		this._bindEventIfNotBound('#main-menu', 'keydown', '', {self: this}, this._onKeyDown);

		if (window.mode.isSmallScreenDevice()) {
			$('#main-menu').parent().css('height', '0');
			$('#toolbar-wrapper').addClass('mobile');
		}

		// Also the vertical menu displayed when tapping the hamburger button is produced by SmartMenus
		$(() => {
			const $mainMenuState = $('#main-menu-state');
			if ($mainMenuState.length) {
				// keyboard accessibility for the hamburger button
				$('#main-menu-btn').off('keydown keyup').on('keydown', function(e) {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						e.stopPropagation();
						this.click();
					}
				}).on('keyup', function(e) {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						e.stopPropagation();
					}
				});

				document.getElementById('main-menu-btn')?.setAttribute('aria-label', _('Menu'));

				// animate mobile menu
				$mainMenuState.change((event) => {
					// This code is invoked when the hamburger menu is opened or closed
					var $menu = $('#main-menu');
					var $nav = $menu.parent();
					if ((event.target as HTMLInputElement).checked) {
						if (!window.mode.isSmallScreenDevice()) {
							// Surely this code, if it really is related only to the hamburger menu,
							// will never be invoked on non-mobile browsers? I might be wrong though.
							// If you notice this logging, please modify this comment to indicate what is
							// going on.
							window.app.console.log('======> Assertion failed!? Not window.mode.isSmallScreenDevice()? Control.Menubar.js #1');
							$nav.css({height: 'initial', bottom: '38px'});
							$menu.hide().slideDown(250, () => { $menu.css('display', ''); });
						} else {
							window.mobileMenuWizard = true;
							const menuData = this._map.menubar.generateFullMenuStructure();
							this._map.fire('mobilewizard', { data: menuData });
							$('#toolbar-hamburger').removeClass('menuwizard-closed').addClass('menuwizard-opened');
							// Keep the upper-left exit VISIBLE while the kebab is
							// open on the Vulcan phone chrome.
							//
							// Stock hides it here, which makes the kebab the one
							// surface with no way out on the left: the wizard's own
							// close is also hidden at its top level, so the only
							// escape is the hamburger on the RIGHT. The phone design
							// makes the left-hand exit load-bearing -- fixed position
							// is the whole point, because it is what lets anything
							// live a layer deep. An exit that moves to the other side
							// of the screen when you go deeper is not a fixed exit.
							//
							// This is an INLINE style, so no stylesheet rule can undo
							// it without !important; it has to be skipped at the
							// source. (An earlier note claimed a rule in
							// mobilewizard.css rescued this. It does not exist --
							// that file is 1229 lines and contains no
							// #toolbar-mobile-back rule at all.)
							if (!this._isVulcanPhoneChrome())
								$('#toolbar-mobile-back').css('visibility', 'hidden');
							$('#formulabar').hide();
						}
					} else if (!window.mode.isSmallScreenDevice()) {
						// Ditto.
						window.app.console.log('======> Assertion failed!? Not window.mode.isSmallScreenDevice()? Control.Menubar.js #2');
						$menu.show().slideUp(250, () => { $menu.css('display', ''); });
						$nav.css({height:'', bottom: ''});
					} else {
						window.mobileMenuWizard = false;
						// FIXME: unify all code paths by single call when legacy refresh is removed
						if ((window as any).mobileWizard === true)
							this._map.sendUnoCommand('.uno:SidebarHide');
						this._map.fire('closemobilewizard');
						$('#toolbar-hamburger').removeClass('menuwizard-opened').addClass('menuwizard-closed');
						$('#toolbar-mobile-back').css('visibility', '');
						if (this._map.getDocType() === 'spreadsheet') {
							$('#formulabar').show();
						}
						setTimeout(() => {
							$('#main-menu-btn').focus();
						}, 0);
					}
				});

				// hide mobile menu beforeunload
				$(window).bind('beforeunload unload', () => {
					if (($mainMenuState[0] as HTMLInputElement).checked) {
						$mainMenuState[0].click();
					}
				});
			}
		});

		this._initialized = true;
	}

	/**
       * Handles click events on menu items.
       * @param e - The event data.
       * @param menu - The clicked menu element.
       */
	private _onClicked(e: any, menu: any): boolean | void {
		const wasOpen = $(menu).hasClass('highlighted');
		if (wasOpen) {
			$('#main-menu').smartmenus('menuHideAll');
		}

		var $mainMenuState = $('#main-menu-state');
		if (!$(menu).hasClass('has-submenu') && ($mainMenuState[0] as HTMLInputElement).checked) {
			$mainMenuState[0].click();
		}

		if (menu?.parentElement?.id === 'menu-file' && window.mode.isCODesktop() && app.map.backstageView)
			app.map.backstageView.toggle();

		// VULCAN: a click on an open top-bar item closes it. The
		// hide above is not enough on its own: smartmenus' itemClick goes on
		// to re-open a first-level menu it finds hidden unless this
		// click.smapi handler returns false. Nested items keep the upstream
		// path (their select.smapi still hands focus back to the document).
		if (wasOpen && $(menu).closest('ul').is('#main-menu'))
			return false;
	}

	/**
       * Checks and sets the “checked” visual state for UNO menu items.
       * @param uno - The UNO command.
       * @param item - The menu item element.
       */
	private _checkedMenu(uno: string, item: any): void {
		var constChecked = 'lo-menu-item-checked';
		var state = this._map['stateChangeHandler'].getItemValue(uno);
		var data = $(item).data('tag');
		state = state[data] || false;
		if (state) {
			$(item).addClass(constChecked);
		} else {
			$(item).removeClass(constChecked);
		}
	}

	/**
       * Handler invoked before a submenu is shown.
       * Updates item states (e.g. disabled, checked) based on command values.
       * @param e - Event data.
       * @param menu - The submenu element.
       */
	private _beforeShow(e: any, menu: any): void {
		this._vulcanCapMenuPopup(menu);
		const items = this._getMenuItems(menu);
		$(items).each((index, aItem) => {
			const type = $(aItem).data('type');
			const id = $(aItem).data('id');
			const uno = $(aItem).data('uno');
			const constChecked = 'lo-menu-item-checked';

			if (this._map.isEditMode()) {
				if (type === 'unocommand') { // enable all depending on stored commandStates
					var data, lang, languageAndCode;
					var constUno = 'uno';
					var constState = 'stateChangeHandler';
					var constLanguage = '.uno:LanguageStatus';
					var constPageHeader = '.uno:InsertPageHeader';
					var constPageFooter = '.uno:InsertPageFooter';
					var unoCommand = $(aItem).data(constUno);
					var itemState = this._map[constState].getItemValue(unoCommand);
					if (itemState === 'disabled') {
						if (unoCommand.startsWith('.uno:Paste')) {
							window.app.console.log('do not disable paste based on server side data');
						} else {
							$(aItem).addClass('disabled');
						}
					} else {
						$(aItem).removeClass('disabled');
					}
					if (unoCommand.startsWith(constLanguage)) {
						unoCommand = constLanguage;
						languageAndCode = this._map[constState].getItemValue(unoCommand);
						lang = languageAndCode.split(';');
						if (lang.length) {
							lang = lang[0];
						} else {
							lang = '';
							app.console.error('Menubar _beforeShow: missing language');
						}
						data = decodeURIComponent($(aItem).data(constUno));
						if (data.indexOf(lang) !== -1) {
							$(aItem).addClass(constChecked);
						} else if (data.indexOf('LANGUAGE_NONE') !== -1 && lang === '[None]') {
							$(aItem).addClass(constChecked);
						} else {
							$(aItem).removeClass(constChecked);
						}
					}
					else if (unoCommand.startsWith(constPageHeader)) {
						unoCommand = constPageHeader;
						this._checkedMenu(unoCommand, this);
					}
					else if (unoCommand.startsWith(constPageFooter)) {
						unoCommand = constPageFooter;
						this._checkedMenu(unoCommand, this);
					}
					else if (itemState === 'true') {
						$(aItem).addClass(constChecked);
					} else {
						$(aItem).removeClass(constChecked);
					}
					if (this.options.math.includes(unoCommand) && app.map.context && app.map.context.context !== 'Math') {
						$(aItem).addClass('disabled');
					}
				} else if (type === 'action') { // enable all except fullscreen on windows
					if (id === 'fullscreen') { // Full screen works weirdly on Edge
						if (window.L.Browser.edge) {
							$(aItem).addClass('disabled');
						} else if (this._map.uiManager.isFullscreen()) {
							$(aItem).addClass(constChecked);
						} else {
							$(aItem).removeClass(constChecked);
						}
					} else if (id === 'showruler') {
						if (this._map.uiManager.isRulerVisible()) {
							$(aItem).addClass(constChecked);
						} else {
							$(aItem).removeClass(constChecked);
						}
					} else if (id === 'multipageview') {
						if (this._map.uiManager.isMultiPageView()) {
							$(aItem).addClass(constChecked);
						} else {
							$(aItem).removeClass(constChecked);
						}
					} else if (id == 'toggledarktheme') {
						if (window.prefs.getBoolean('darkTheme')) {
							$(aItem).addClass(constChecked);
							$('#menu-invertbackground').show();
						} else {
							$(aItem).removeClass(constChecked);
							$('#menu-invertbackground').hide();
						}
					} else if (id === 'showstatusbar') {
						if (this._map.uiManager.isStatusBarVisible()) {
							$(aItem).addClass(constChecked);
						} else {
							$(aItem).removeClass(constChecked);
						}
					} else if (id === 'notesmode') {
						if (app.impress.notesMode)
							$(aItem).addClass(constChecked);
						else
							$(aItem).removeClass(constChecked);
					} else if (id === 'toggleuimode') {
						if (this._map.uiManager.shouldUseNotebookbarMode()) {
							$(aItem).text(_('Use Compact view'));
						} else {
							$(aItem).text(_('Use Tabbed view'));
						}
					} else if (id === 'showslide') {
						if (!app.impress.isSlideHidden(this._map.getCurrentPartNumber())) {
							$(aItem).hide();
							$(aItem).addClass('disabled');
						}
						else {
							$(aItem).show();
							$(aItem).removeClass('disabled');
						}
					} else if (id === 'hideslide') {
						if (app.impress.isSlideHidden(this._map.getCurrentPartNumber())) {
							$(aItem).hide();
							$(aItem).addClass('disabled');
						} else {
							$(aItem).show();
							$(aItem).removeClass('disabled');
						}
					} else if (id === 'togglea11ystate') {
						var enabled = window.prefs.getBoolean('accessibilityState');
						if (enabled) {
							$(aItem).addClass(constChecked);
						} else {
							$(aItem).removeClass(constChecked);
						}
					} else if (this._map.getDocType() === 'presentation' && (id === 'deletepage' || id === 'insertpage' || id === 'duplicatepage')) {
						if (id === 'deletepage') {
							itemState = this._map['stateChangeHandler'].getItemValue('.uno:DeletePage');
						} else if (id === 'insertpage') {
							itemState = this._map['stateChangeHandler'].getItemValue('.uno:InsertPage');
						} else {
							itemState = this._map['stateChangeHandler'].getItemValue('.uno:DuplicatePage');
						}
						if (itemState === 'disabled') {
							$(aItem).addClass('disabled');
						} else {
							$(aItem).removeClass('disabled');
						}
					} else if (id === 'showannotations') {
						var section = app.sectionContainer.getSectionWithName(app.CSections.CommentList.name);
						if (section) {
							itemState = this._map['stateChangeHandler'].getItemValue('showannotations');
							if (itemState === 'true')
								$(aItem).addClass(constChecked);
							else
								$(aItem).removeClass(constChecked);
						}
					} else if (id === 'showresolved') {
						var section = app.sectionContainer.getSectionWithName(app.CSections.CommentList.name);
						if (section) {
							if (section.sectionProperties.commentList.length === 0 ||
								!section.sectionProperties.show) {
								$(aItem).addClass('disabled');
							} else if (section.sectionProperties.showResolved) {
								$(aItem).removeClass('disabled');
								$(aItem).addClass(constChecked);
							} else {
								$(aItem).removeClass('disabled');
								$(aItem).removeClass(constChecked);
							}
						}
					} else if (id === 'acceptalltrackedchanges' || id === 'rejectalltrackedchanges') {
						itemState = this._map['stateChangeHandler'].getItemValue(uno);
						if (itemState === 'disabled') {
							$(aItem).addClass('disabled');
						} else {
							$(aItem).removeClass('disabled');
						}
					} else if (id === 'serveraudit' && (app.isAdminUser === false || !this._map.serverAuditDialog)) {
						$(aItem).css('display', 'none');
					} else if (id === 'columnrowhighlight') {
						itemState = app.map.uiManager.getHighlightMode();
						if (itemState) $(aItem).addClass(constChecked);
						else $(aItem).removeClass(constChecked);
					} else if (id === 'transitiondeck') {
						// notebookbar-based panel, highlighted from the command
						// state set in Sidebar.updatePresentationDeckHighlight
						itemState = this._map['stateChangeHandler'].getItemValue('transitiondeck');
						if (itemState === 'true') $(aItem).addClass(constChecked);
						else $(aItem).removeClass(constChecked);
					} else if (id === 'presentation-in-console') {
						if (this._map.uiManager.shouldShowPresenterConsole()) {
							$(aItem).addClass(constChecked);
						} else {
							$(aItem).removeClass(constChecked);
						}
					} else {
						$(aItem).removeClass('disabled');
					}
				}
				if (id && id.indexOf('zotero') >= 0) {
					if (window.zoteroEnabled && this._map.zotero) {
						$(aItem).show();
						$(aItem).removeClass('disabled');
					}
					else {
						$(aItem).hide();
						$(aItem).addClass('disabled');
					}
				}
			} else { // eslint-disable-next-line no-lonely-if
				if (type === 'unocommand') { // disable all uno commands
					// Except the ones listed in allowedViewModeCommands:
					var allowed = this.options.allowedViewModeCommands.includes(uno);
					if (!allowed && app.isRedlineManagementAllowed() && !this._map['wopi'].HideChangeTrackingControls) {
						allowed = this.options.allowedRedlineManagementModeCommands.includes(uno);
					}
					if (!allowed) {
						$(aItem).hide();
					} else {
						var itemState = this._map['stateChangeHandler'].getItemValue(uno);
						if (itemState === 'disabled') {
							$(aItem).addClass('disabled');
						} else {
							$(aItem).removeClass('disabled');
							if (itemState === 'true')
								$(aItem).addClass(constChecked);
							else
								$(aItem).removeClass(constChecked);
						}
					}
				} else if (type === 'action') { // disable all except allowedViewModeActions
					var allowed = false;
					for (var i in this.options.allowedViewModeActions) {
						const action = this.options.allowedViewModeActions[i];
						if (typeof action === "string" && action === id) {
							allowed = true;
							break;
						} else if (typeof action === "function" && action() === id) {
							allowed = true;
							break;
						}
					}
					if (!allowed && app.isRedlineManagementAllowed() && !this._map['wopi'].HideChangeTrackingControls)
						allowed = this.options.allowedRedlineManagementModeActions.includes(id);
					if (id === 'insertcomment' && (this._map.getDocType() !== 'drawing' && !app.isCommentEditingAllowed()))
						allowed = false;
					if (id === 'serveraudit' && (app.isAdminUser === false || !this._map.serverAuditDialog))
						allowed = false;
					if (!allowed) {
						$(aItem).hide();
					} else if (id === 'presentation-in-console') {
						if (this._map.uiManager.shouldShowPresenterConsole()) {
							$(aItem).addClass(constChecked);
						} else {
							$(aItem).removeClass(constChecked);
						}
					} else if (id === 'showruler') {
						if (this._map.uiManager.isRulerVisible()) {
							$(aItem).addClass(constChecked);
						} else {
							$(aItem).removeClass(constChecked);
						}
					} else if (id === 'showstatusbar') {
						if (this._map.uiManager.isStatusBarVisible()) {
							$(aItem).addClass(constChecked);
						} else {
							$(aItem).removeClass(constChecked);
						}
					} else if (id === 'toggledarktheme') {
						if (window.prefs.getBoolean('darkTheme')) {
							$(aItem).addClass(constChecked);
						} else {
							$(aItem).removeClass(constChecked);
						}
					} else if (uno !== undefined) {
						itemState = this._map['stateChangeHandler'].getItemValue(uno);
						if (itemState === 'disabled') {
							$(aItem).addClass('disabled');
						} else {
							$(aItem).removeClass('disabled');
						}
					}
				}

				const $menuItems = $(menu).children('li');

				$menuItems.each((index, li) => {
					const $aItem = $(li).children('a').first();
					if (!$aItem.hasClass('separator')) return;

					const $prevVisible = $(li).prevAll('li').filter(function() {
						const $a = $(this).children('a').first();
						return !$a.hasClass('separator') &&
							$a.css('display') !== 'none' &&
							$(this).css('display') !== 'none';
					}).first();

					const $nextVisible = $(li).nextAll('li').filter(function() {
						const $a = $(this).children('a').first();
						return !$a.hasClass('separator') &&
							$a.css('display') !== 'none' &&
							$(this).css('display') !== 'none';
					}).first();

					if ($prevVisible.length === 0 || $nextVisible.length === 0) {
						$aItem.hide();
					} else {
						$aItem.show();
					}
				});
			}

			if (id === 'remotelink') {
				if (this._map['wopi'].EnableRemoteLinkPicker) {
					$(aItem).show();
					$(aItem).removeClass('disabled');
				} else {
					$(aItem).hide();
					$(aItem).addClass('disabled');
				}
			}

			if (id === 'remoteaicontent') {
				if (this._map['wopi'].EnableRemoteAIContent) {
					$(aItem).show();
					$(aItem).removeClass('disabled');
				} else {
					$(aItem).hide();
					$(aItem).addClass('disabled');
				}
			}
		});
		// We hide adjacent, leading, and trailing separators that might occur due to hidden items above.
		var visibleItems = this._getMenuItems(menu).filter(function(this: HTMLElement) {
			return $(this).css('display') !== 'none';
		});

		visibleItems.each((index: number, aItem: HTMLElement) => {
			// Always show first, might be hidden by previous pass
			if ($(aItem).hasClass('separator')) {
				$(aItem).show();
			}

			// Hide leading separator
			if (index === 0 && $(aItem).hasClass('separator')) {
				$(aItem).hide();
				return;
			}

			// Hide trailing separator
			if (index === visibleItems.length - 1 && $(aItem).hasClass('separator')) {
				$(aItem).hide();
				return;
			}

			// Hide double/adjacent separators
			// If this is a separator, and the previous visible item was also a separator, hide this one.
			if (index > 0) {
				var prevItem = visibleItems[index - 1];
				if ($(aItem).hasClass('separator') && $(prevItem).hasClass('separator')) {
					$(aItem).hide();
				}
			}
		});
		// Disable separator items so keyboard navigation skips them
		$(menu).find('a.separator').addClass('disabled');
	}

	/**
       * Opens the Insert Shapes wizard.
       */
	private _openInsertShapesWizard(): void {
		// On desktop the mobile wizard control is not instantiated, so reuse
		// the shapes grid the notebookbar opens (the InsertShapesMenu html
		// popup) as a JSDialog dropdown and center it on screen.
		if (!window.mode.isSmallScreenDevice()) {
			var menu = JSDialog.MenuDefinitions.get('InsertShapesMenu');
			// The html shapes grid handles its own clicks (sends the uno
			// command and closes the popup), so the dropdown callback is unused.
			JSDialog.OpenDropdown('insertshape', null, menu, function() { return false; });
			app.layoutingService.appendLayoutingTask(function() {
				var popup = JSDialog.GetDropdown('insertshape') as HTMLElement;
				if (!popup)
					return;
				var rect = popup.getBoundingClientRect();
				popup.style.marginInlineStart = Math.max(0, (window.innerWidth - rect.width) / 2) + 'px';
				popup.style.marginTop = Math.max(0, (window.innerHeight - rect.height) / 2) + 'px';
			});
			return;
		}

		// Phone Impress gets Google's shape CATEGORIES, not LibreOffice's
		// gallery. google-slides.json "Insert > Shape submenu" (insert /
		// common): "Opens a categorized grid — general shapes, arrows,
		// callouts, and equation symbols." Stock builds all six groups of the
		// `insertshapes` collection — 113 shapes, most of them flowchart and
		// banner work nobody does on a 390px screen — which is the plain
		// "we render the desktop surface" shape of gap. The allowlist, the
		// mapping onto Google's four, and the reason the fourth category
		// cannot be delivered here are all in Control.Toolbar.js next to
		// VULCAN_PHONE_SHAPE_GROUPS.
		//
		// Three-part gate, and each part earns its place:
		//   - _isVulcanPhoneChrome() is BOTH halves. isSmallScreenDevice()
		//     alone is not the gate: ?vulcanChrome=desktop puts the desktop
		//     chrome back on a phone-sized screen and must get the desktop
		//     gallery with it. (The early return above is deliberately left on
		//     isSmallScreenDevice() alone — it decides dropdown-vs-wizard, a
		//     question about which CONTROL can exist, not about chrome.)
		//   - the doctype, because this wizard is shared. Draw on a phone
		//     reaches the same code and keeps all six groups: it has no Slides
		//     catalogue to copy, and flowchart and connector shapes are most of
		//     what a Draw document is for.
		// With the gate false this passes `undefined`, which is the parameter's
		// omitted case and therefore HEAD's exact behaviour.
		var phoneImpress = this._isVulcanPhoneChrome()
			&& this._map.getDocType() === 'presentation';
		var content = window.createShapesPanel(
			'insertshapes',
			phoneImpress ? window.VulcanPhoneShapeGroups : undefined,
		);
		var data = {
			id: 'insertshape',
			type: '',
			text: _('Insert Shape'),
			enabled: true,
			children: [] as any[]
		};

		var container = {
			id: '',
			type: 'htmlcontrol',
			content: content,
			enabled: true
		};

		data.children.push(container);
		this._map._docLayer._openMobileWizard(data);
	}

	/**
	 * Executes an action command based on the selected menu item.
	 * @param itNode - The menu item element.
	 * @param itWizard - Optional wizard data.
	 */
	private _executeAction(itNode: any, itWizard?: any): void {
		var id, postmessage, type, command;
		if (itNode === undefined)
		{ // called from JSDialogBuilder
			id = itWizard.id;
			postmessage = false;
			command = itWizard.command;
		}
		else
		{ // called from
			id = $(itNode).data('id');
			type = $(itNode).data('type');
			postmessage = ($(itNode).data('postmessage') === 'true');
			command = $(itNode).data('uno');
		}

		if (id === 'save') {
			// Save only when not read-only.
			if (!this._map.isReadOnlyMode()) {
				this._map.fire('postMessage', {msgId: 'UI_Save', args: { source: 'filemenu' }});

				if (!this._map._disableDefaultAction['UI_Save']) {
					this._map.save(false, false);
				}
			}
		} else if (id === 'saveas' && type !== 'menu') { // jsdialog has no type='action'
			this._map.openSaveAs();
		} else if (id === 'savecomments') {
			app.dispatcher.dispatch('savecomments');
		} else if (id === 'shareas' || id === 'ShareAs') {
			app.dispatcher.dispatch('shareas');
		} else if (id === 'print' || id === 'print-notespages') {
			app.dispatcher.dispatch(id);
		} else if (id.startsWith('downloadas-')
			|| id.startsWith('saveas-')
			|| id.startsWith('export')
			|| id === 'renamedocument'
			|| id.startsWith('zotero')
			|| id === 'deletepage'
			|| id === 'remotelink'
			|| id === 'remoteaicontent'
			|| id === 'toggledarktheme'
			|| id === 'invertbackground'
			|| id === 'home-search'
			|| id === 'print-active-sheet'
			|| id === 'print-all-sheets'
			|| id === 'serveraudit'
			|| id === 'animationdeck'
			|| id === 'transitiondeck'
			|| id.startsWith('extension-toggle-')) {
			app.dispatcher.dispatch(id);
		} else if (id === ('settings-dialog')) {
			this._map.settings.showSettingsDialog();
		} else if (id === 'documentoutline') {
			// writer-no-document-outline. Only mobiletext carries this id, and
			// generateFullMenuStructure -- its only reader -- is called from the
			// small-screen branch alone (Control.Menubar.ts:2005) and keys the
			// array off 'mobile' + docType, so Calc, Impress and every desktop
			// and tablet menu are untouched by construction. The guard is
			// nonetheless real, because _executeAction is a shared entry point:
			// Control.NotebookbarBuilder.js:696 calls it on a bare {id} from the
			// DESKTOP notebookbar, so id alone is not proof of form factor.
			if (window.mode.isSmallScreenDevice() &&
				this._map.getDocType() === 'text' &&
				(window as any).VulcanDocumentOutline) {
				(window as any).VulcanDocumentOutline.open(this._map);
			}
		} else if (id === 'browseview') {
			// The phone View menu's reflow toggle. Goes through the controller
			// rather than straight to sendUnoCommand because the ORDER matters
			// and the zoom is half the fix: state the width, move the zoom,
			// then flip the mode -- and restore the zoom exactly on the way
			// back. See app/VulcanWriterReflow.ts.
			//
			// Guarded on the controller existing rather than on form factor:
			// _executeAction is a shared entry point (Control.NotebookbarBuilder
			// reaches it with a bare {id} from the DESKTOP notebookbar), and
			// the controller itself is the thing that knows whether it manages
			// zoom on this surface.
			if (app.writerReflow)
				app.writerReflow.toggle();
		} else if (id === 'insertcomment') {
			this._map.insertComment();
		} else if (id === 'insert-signatureline') {
			if (this._map.eSignature) {
				const args = {
					External: {
						type: 'boolean',
						value: true,
					},
				};
				app.map.sendUnoCommand('.uno:InsertSignatureLine', args);
				const finishMessage = _('The signature line can now be moved or resized as needed.');
				const finishFunc = () => {
					Util.ensureValue(app.map.eSignature);
					app.map.eSignature.insert();
				};
				app.map.uiManager.showSnackbar(finishMessage, _('Finish electronic signing'), finishFunc, -1);
			} else {
				app.map.sendUnoCommand('.uno:InsertSignatureLine');
			}

			// The file based view is primarily to view multi-page PDF files, so
			// it doesn't seem to have precise tracking of invalidations, just
			// request new tiles for now.
			app.map._docLayer.requestNewFiledBasedViewTiles();
		} else if (id === 'insertgraphic') {
			window.L.DomUtil.get('insertgraphic').click();
		} else if (id === 'insertgraphiccamera') {
			// The camera half of Google's image sheet. Same click-a-hidden-input
			// mechanism as the row above, a DIFFERENT element: the camera one
			// carries capture="environment" (html/cool.html.m4), which cannot be
			// put on #insertgraphic without removing the photo library from every
			// other caller of it.
			window.L.DomUtil.get('insertgraphiccamera').click();
		} else if (id === 'insertgraphicremote') {
			this._map.fire('postMessage', {msgId: 'UI_InsertGraphic'});
		} else if (id === 'insertmultimedia') {
			window.L.DomUtil.get('insertmultimedia').click();
		} else if (id === 'remotemultimedia') {
			this._map.fire('postMessage', {
				msgId: 'UI_InsertFile', args: {
					callback: 'Action_InsertMultimedia', mimeTypeFilter: app.LOUtil.mediaMimeFilter
				}
			});
		} else if (id === 'selectbackground') {
			app.dispatcher.dispatch('selectbackground');
		} else if (id === 'zoomin' && this._map.getZoom() < this._map.getMaxZoom()) {
			app.dispatcher.dispatch('zoomin');
		} else if (id === 'showannotations') {
			app.dispatcher.dispatch('showannotations');
		} else if (id === 'showresolved') {
			app.dispatcher.dispatch('.uno:ShowResolvedAnnotations');
		} else if (id === 'zoomout' && this._map.getZoom() > this._map.getMinZoom()) {
			app.dispatcher.dispatch('zoomout');
		} else if (id === 'zoomreset') {
			app.dispatcher.dispatch('zoomreset');
		} else if (id === 'fitwidthzoom') {
			app.dispatcher.dispatch('fitwidthzoom');
		} else if (id === 'fullscreen') {
			app.util.toggleFullScreen();
		} else if (id === 'showruler') {
			app.dispatcher.dispatch('showruler');
		} else if (id === 'togglea11ystate') {
			app.dispatcher.dispatch('togglea11ystate');
		} else if (id === 'toggleuimode') {
			app.dispatcher.dispatch('toggleuimode');
		} else if (id === 'showstatusbar') {
			app.dispatcher.dispatch('showstatusbar');
		} else if (id === 'notesmode') {
			app.dispatcher.dispatch('notesmode');
		} else if (id === 'togglemenubar') {
			this._map.uiManager.toggleMenubar();
		} else if (id === 'collapsenotebookbar') {
			app.dispatcher.dispatch('collapsenotebookbar');
		} else if (id === 'fullscreen-presentation' && this._map.getDocType() === 'presentation') {
			app.dispatcher.dispatch('fullscreen-presentation');
		} else if (id === 'presentation-currentslide' && this._map.getDocType() === 'presentation') {
			app.dispatcher.dispatch('presentation-currentslide');
		} else if (id === 'present-in-window' && this._map.getDocType() === 'presentation') {
			app.dispatcher.dispatch('present-in-window');
		} else if (id === 'presentation-in-console') {
			app.dispatcher.dispatch('presenterconsole');
		} else if (id === 'insertpage') {
			this._map.insertPage();
		} else if (id === 'insertshape') {
			this._openInsertShapesWizard();
		} else if (id === 'duplicatepage') {
			this._map.duplicatePage();
		} else if (id === 'about') {
			this._map.showLOAboutDialog();
		} else if (id === 'inserthyperlink') {
			app.dispatcher.dispatch('hyperlinkdialog');
		} else if (id === 'keyboard-shortcuts' || id === 'online-help') {
			this._map.showHelp(id + '-content');
		} else if (window.L.Params.revHistoryEnabled && (id === 'rev-history' || id === 'Rev-History' || id === 'last-mod')) {
			app.dispatcher.dispatch('rev-history');
		} else if (id === 'closedocument') {
			app.dispatcher.dispatch('closeapp');
		} else if (id === 'repair') {
			app.dispatcher.dispatch('repair');
		} else if (id === 'recsearch') {
			app.dispatcher.dispatch('showsearchbar');
		} else if (id === 'find') {
			// Same path as the Ctrl-F shortcut: in Writer it focuses the
			// navigator quick-find field; in Calc and Impress, which have no
			// quick-find, it opens the Find & Replace dialog.
			app.dispatcher.dispatch('home-search');
		} else if (id === 'inserttextbox') {
			this._map.sendUnoCommand('.uno:Text?CreateDirectly:bool=true');
		} else if (id === 'pagesetup') {
			this._map.sendUnoCommand('.uno:SidebarShow');
			this._map.sendUnoCommand('.uno:LOKSidebarWriterPage');
			this._map.fire('showwizardsidebar');
			window.pageMobileWizard = true;
		} else if (id === 'changetheme') {
			// Reusing the core deck can return its full snapshot immediately, so
			// arm the phone sidebar before asking for that snapshot.
			this._map.fire('showwizardsidebar');
			this._map.sendUnoCommand('.uno:KitSidebarMasterSlides');
		} else if (id === 'showslide') {
			app.dispatcher.dispatch('showslide');
		} else if (id === 'hideslide') {
			app.dispatcher.dispatch('hideslide');
		} else if (id.indexOf('morelanguages-') != -1) {
			this._map.fire('morelanguages', { applyto: id.substr('morelanguages-'.length) });
		} else if (id === 'acceptalltrackedchanges' || id === 'rejectalltrackedchanges') {
			app.dispatcher.dispatch(command);
		} else if (id === 'columnrowhighlight') {
			app.dispatcher.dispatch('columnrowhighlight');
		} else if (id === 'comparechanges') {
			app.dispatcher.dispatch('comparechanges');
		} else if (id === 'multipageview') {
			app.dispatcher.dispatch('multipageview');
		} else {
			// not found
			app.console.warn('Menubar: unknown action for id: ' + id);
		}

		// Inform the host if asked
		if (postmessage)
			this._map.fire('postMessage', {msgId: 'Clicked_Button', args: {Id: id} });
	}

	/**
	 * Sends a UNO command extracted from the menu item data.
	 * @param item - The menu item element.
	 */
	private _sendCommand(item: any): void {
		var unoCommand = $(item).data('uno');
		if (unoCommand.startsWith('.uno:InsertPageHeader') || unoCommand.startsWith('.uno:InsertPageFooter')) {
			unoCommand = unoCommand + ($(item).hasClass('lo-menu-item-checked') ? 'On:bool=false' : 'On:bool=true');
		}
		else if (unoCommand.startsWith('.uno:SlideMasterPage')) {
			// Toggle between showing master page and closing it.
			unoCommand = ($(item).hasClass('lo-menu-item-checked') ? '.uno:CloseMasterView' : '.uno:SlideMasterPage');
		}
		else if (this._map._clip && this._map._clip.filterExecCopyPaste(unoCommand)) {
			return;
		}

		this._map.sendUnoCommand(unoCommand);
	}

	/**
	 * Handles the selection of a menu item.
	 * @param e - Event data.
	 * @param item - The selected menu item element.
	 */
	private _onItemSelected(e: any, item: any): void {
		// TODO: Find a way to disable click/select events for locked elements in disableLockedItem
		if ($(item).data('locked') === true)
			return;

		var type = $(item).data('type');
		if (type === 'unocommand') {
			this._sendCommand(item);
		} else if (type === 'action') {
			this._executeAction(item);
		}

		if (!window.mode.isSmallScreenDevice() && $(item).data('id') !== 'insertcomment' && self && this._map)
			this._map.focus();
	}

	/**
	 * Handles keydown events on the menubar.
	 * Specifically, shows help when F1 is pressed.
	 * @param e - The keyboard event.
	 */
	private _onKeyDown(e: KeyboardEvent, self: Menubar): void {
		// handle help - F1
		if (e.type === 'keydown' && !e.shiftKey && !e.ctrlKey && !e.altKey && e.keyCode == 112) {
			self._map.showHelp('online-help-content');
		}
		// handle Enter - open focused menu item
		if (e.type === 'keydown' && e.key === 'Enter') {
			const menuItem = document.activeElement as HTMLElement;
			menuItem.click();
			e.preventDefault();
		}
		// close menu on Escape
		if (e.key === 'Escape')
			$('#main-menu').smartmenus('menuHideAll');
	}

	/**
	 * Creates the file icon in the menubar header.
	 */
	private _createFileIcon(): void {
		if (!(window.logoURL && window.logoURL == "none")) {
			var liItem = window.L.DomUtil.create('li', '');
			liItem.id = 'document-header';
			liItem.setAttribute('role', 'menuitem');
			var aItem = window.L.DomUtil.create('a', 'document-logo', liItem);
			$(aItem).data('id', 'document-logo');
			$(aItem).data('type', 'action');
			aItem.setAttribute('role', 'img');
			aItem.target = '_blank';

			if (window.logoURL) {
				aItem.style.backgroundImage = "url(" + window.logoURL + ")";
			} else {
				const docType = this._map.getDocType();
				const [iconClass, iconTooltip] = app.LOUtil.getDocumentLogoClass(docType);
				aItem.classList.add(iconClass);
				aItem.setAttribute('data-cooltip', iconTooltip);
			}
			app.LOUtil.syncDocumentLogoAriaLabel(aItem);

			if (this._menubarCont != null)
				this._menubarCont.insertBefore(liItem, this._menubarCont.firstChild);

			const $docLogo = $(aItem);
			$docLogo.bind('click', {self: this}, this._createDocument);
			$docLogo.bind('click', this._createDocument.bind(this));
		}
	}

	/*
	 * VULCAN (desktop chrome): FIND IN DOCUMENT, where Word puts it.
	 *
	 * Word's search box lives in the TITLE BAR, beside the document name and
	 * above the ribbon — not on the page. This is a sibling in nav.main-nav
	 * before the user cluster, which is that slot.
	 *
	 * IT IS A FIELD, NOT A BUTTON. The first version was a pill reading
	 * "Search" that opened the panel and handed off focus, which put a boxed
	 * control in a row of unboxed menu items and made you cross the screen to
	 * type. You type here instead: the word sits inside the box as a
	 * placeholder, Enter is the submit, and the query arrives in the panel
	 * already run. No magnifier button: the kit's search fields carry no
	 * trailing glyph, and the panel has its own close button.
	 *
	 * No search state lives here — see NavigatorPanel.chromeQuery*.
	 */
	private _vulcanAddFindBox(): void {
		if (!document.documentElement.classList.contains('vulcan-desktop-chrome'))
			return;
		// Writer only: the box proxies the Writer navigator's search field.
		// On a deck or a sheet Enter ran nothing and the magnifier's toggle
		// closed the Slides strip, so those documents get no box at all.
		if (this._map.getDocType() !== 'text') return;
		// A SIBLING of the title, not a child of it: #document-titlebar is a
		// column (name over loading bar) so a child stacks under the name, and
		// .document-title's input spans the row so a child lands on top of it.
		const nav = document.querySelector('nav.main-nav') as HTMLElement | null;
		const userList = document.getElementById('userListHeader');
		if (!nav || document.getElementById('vulcan-find-box')) return;

		const box = window.L.DomUtil.create('div', 'vulcan-find-box');
		box.id = 'vulcan-find-box';
		if (userList) nav.insertBefore(box, userList);
		else nav.appendChild(box);

		const input = window.L.DomUtil.create(
			'input',
			'vulcan-find-input',
			box,
		) as HTMLInputElement;
		input.id = 'vulcan-find-input';
		input.type = 'text';
		input.autocomplete = 'off';
		input.spellcheck = false;
		input.placeholder = _('Search');
		input.setAttribute('aria-label', _('Find in document'));

		// The box is the panel's own search field by proxy -- see the two
		// NavigatorPanel.chromeQuery* entry points for the rules. Typing
		// mirrors into the panel and searches live while it is open; Enter
		// submits and never closes.
		const panel = () => {
			const n = this._map && (this._map as any).navigator;
			return n && typeof n.chromeQuerySubmit === 'function' ? n : null;
		};

		input.addEventListener('input', () => panel()?.chromeQueryTyped(input.value));
		input.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') { e.preventDefault(); panel()?.chromeQuerySubmit(input.value); }
			// Esc gives the document back without leaving a stale query behind.
			if (e.key === 'Escape') { input.value = ''; panel()?.chromeQueryTyped(''); this._map.focus(); }
		});
	}

	/*
	 * VULCAN (desktop chrome): SHARE, upper right of the menu row.
	 *
	 * Owner decision 2026-09-02, reversing the 2026-08-24 removal: the fork's
	 * desktop top chrome carries ONE Share control, at the far right of the
	 * menu row -- past the Search field, the save chip and the user cluster,
	 * where the kit puts a header's actions. It is a LAUNCHER, not a share
	 * surface: the click dispatches 'shareas', the same action the File >
	 * Share... menu item fires, and docdispatcher posts the UI_Share message
	 * to the host, which opens its own ShareDialog. No sharing UI lives in
	 * the fork.
	 *
	 * A kit icon button (32x32, radius 8) with a masked monochrome glyph --
	 * a <span> under CSS mask, not an <img>, so the mark takes the row's
	 * colour and the mocha rig (jsdom, no image loading) can build it.
	 * Styled in css/vulcan-kit-share.css. Appended as the nav's LAST child
	 * on purpose: #userListHeader, #viewMode (save chip / Edit) and the
	 * close-button wrapper are all ahead of it in html/cool.html.m4, so
	 * appendChild is what lands it at the right edge. Once per document
	 * load, from _onDocLayerInit beside the find box; the id guard keeps a
	 * second init from doubling it.
	 *
	 * Plain JS in the body (no TS casts): the mocha suite slices this method
	 * out of the source and runs it in a vm against a jsdom, the same way
	 * MenubarRefreshRebuildGuard exercises _onRefresh.
	 */
	private _vulcanAddShareButton(): void {
		if (!document.documentElement.classList.contains('vulcan-desktop-chrome'))
			return;
		// Same gate as the File ▸ Share menu item: no launcher when the host
		// disables sharing (wopi arrives before the status that fires this).
		if (!this._map['wopi'] || !this._map['wopi'].EnableShare) return;
		const nav = document.querySelector('nav.main-nav');
		if (!nav || document.getElementById('vulcan-topchrome-share')) return;

		const button = window.L.DomUtil.create('button', 'vulcan-topchrome-share');
		button.id = 'vulcan-topchrome-share';
		button.type = 'button';
		button.setAttribute('aria-label', _('Share'));
		button.setAttribute('data-cooltip', _('Share'));

		const glyph = window.L.DomUtil.create('span', 'vulcan-topchrome-share-glyph', button);
		glyph.setAttribute('aria-hidden', 'true');

		// Same path as the File > Share... menu item (_executeAction below):
		// the dispatcher's 'shareas' action -> map.openShare() -> UI_Share.
		button.addEventListener('click', () => {
			app.dispatcher.dispatch('shareas');
		});

		// data-cooltip only shows once the tooltip control is listening on
		// the element; guarded because the vm rig has no L.control.
		if (window.L.control && typeof window.L.control.attachTooltipEventListener === 'function')
			window.L.control.attachTooltipEventListener(button, this._map);

		nav.appendChild(button);
	}

	/*
	 * VULCAN (desktop chrome): the menu row scrolls, so its popups go fixed.
	 *
	 * vulcan-theme.css §4b makes the menus' track in nav.main-nav an x-scroll
	 * container, the same treatment #toolbar-up has. The smartmenus popups
	 * are <ul>s nested inside that track and positioned absolute within their
	 * <li>, which a scrolling track clips. A fixed-position element escapes
	 * an ancestor's overflow clip only if its containing block lies outside
	 * the scroll container; the bar carries no transform or filter (§4 moved
	 * the glass blur onto a ::before layer for exactly this), so the containing block
	 * is the viewport, and this handler -- on 'show', after smartmenus has
	 * measured and positioned the popup for its own coordinate space --
	 * re-anchors it in viewport coordinates from its anchor's rect.
	 *
	 * Hover, keyboard and hide are untouched: the popup stays where it was
	 * in the DOM, so smartmenus' containment checks still hold.
	 */
	private _vulcanAnchorMenuPopup(e: any, menu: any): void {
		if (!document.documentElement.classList.contains('vulcan-desktop-chrome'))
			return;
		// dataSM is smartmenus' own data accessor (not in the jQuery typings).
		const $sub: any = $(menu);
		const $a = $sub.dataSM('parent-a');
		if (!$a || !$a.length) return;

		const anchor = $a[0].getBoundingClientRect();
		const level: number = $sub.dataSM('level') || 2;
		const pos = VulcanMenuPopup.place(
			level,
			{ left: anchor.left, top: anchor.top, right: anchor.right, bottom: anchor.bottom },
			$sub.outerWidth() || 0,
			$sub.outerHeight() || 0,
			window.innerWidth,
			window.innerHeight,
			document.documentElement.dir === 'rtl',
		);
		$sub.css({
			position: 'fixed',
			left: pos.left + 'px',
			top: pos.top + 'px',
			marginLeft: 0,
			marginTop: 0,
		});
	}

	/**
	 * A popup taller than the room it gets scrolls inside itself (
	 * Calc's Format and Data ran past a short editor, their last rows under
	 * the sheet-tab bar or off-screen). Runs on beforeshow, before smartmenus
	 * measures the popup: smartmenus then never arms its own scroll arrows,
	 * which land behind the rows once _vulcanAnchorMenuPopup has made the
	 * popup position:fixed. The submenus inside are fixed too, so the scroll
	 * box cannot clip them -- but they do not follow their row either, so a
	 * scroll re-anchors them, and closes them once their row has scrolled out
	 * of sight. (Closing on every scroll is not enough: a click on a
	 * half-hidden row scrolls it into view, and that scroll event lands a
	 * frame after the click has opened the row's submenu.)
	 */
	private _vulcanCapMenuPopup(menu: any): void {
		if (!document.documentElement.classList.contains('vulcan-desktop-chrome'))
			return;
		const $sub: any = $(menu);
		const $a = $sub.dataSM('parent-a');
		if (!$a || !$a.length) return;

		const level: number = $sub.dataSM('level') || 2;
		const anchor = $a[0].getBoundingClientRect();
		menu.style.maxHeight =
			VulcanMenuPopup.maxHeight(
				level,
				{ left: anchor.left, top: anchor.top, right: anchor.right, bottom: anchor.bottom },
				window.innerHeight,
			) + 'px';
		menu.classList.add('vulcan-menu-capped');

		if (menu._vulcanScrollHidesSubmenus) return;
		menu._vulcanScrollHidesSubmenus = true;
		menu.addEventListener('scroll', () => {
			// Parents come first in document order, so each re-anchors
			// against a row that has already moved.
			const open = $(menu).find('ul:visible').toArray();
			if (!open.length) return;
			const box = menu.getBoundingClientRect();
			const row = ($(open[0]) as any).dataSM('parent-a')[0].getBoundingClientRect();
			const middle = (row.top + row.bottom) / 2;
			if (middle < box.top || middle > box.bottom) {
				// activatedItems[level - 1] is this popup's open row.
				try { $('#main-menu').data('smartmenus').menuHideSubMenus(level - 1); } catch (err) { /* menubar rebuilt */ }
				return;
			}
			for (const sub of open) this._vulcanAnchorMenuPopup(null, sub);
		}, { passive: true });
	}

	// Everything before the presence strip (the menus and the find field)
	// moves into a track of its own, which scrolls; the presence strip, the
	// save status and Share stay in view (vulcan-theme.css §4b).
	// A fixed popup does not follow its anchor while the row scrolls under
	// it, so a scroll closes the menus -- the same thing smartmenus does on a
	// window scroll.
	private _vulcanScrollableMenuRow(): void {
		if (!document.documentElement.classList.contains('vulcan-desktop-chrome'))
			return;
		const nav = document.querySelector('nav.main-nav');
		if (!nav || document.getElementById('vulcan-menu-track')) return;
		const presence = document.getElementById('userListHeader');
		const fixedEnd = presence && presence.parentNode === nav ? presence : null;
		const track = document.createElement('div');
		track.id = 'vulcan-menu-track';
		while (nav.firstChild && nav.firstChild !== fixedEnd) track.appendChild(nav.firstChild);
		nav.insertBefore(track, fixedEnd);
		const hideMenus = () => {
			try { $('#main-menu').smartmenus('menuHideAll'); } catch (err) { /* not initialised yet */ }
		};
		nav.addEventListener('scroll', hideMenus, { passive: true });
		track.addEventListener('scroll', hideMenus, { passive: true });
	}

	/**
       * Checks whether a given menu item (configuration object) should be visible.
       * @param menuItem - The menu item configuration.
       * @returns True if visible; otherwise false.
       */
	private _checkItemVisibility(menuItem: any): boolean {
		if (window.ThisIsAMobileApp && menuItem.mobileapp === false) {
			return false;
		}
		if (window.ThisIsTheiOSApp && menuItem.iosapp === false) {
			return false;
		}
		if (menuItem.id === 'about' && (window.L.DomUtil.get('about-dialog') === null)) {
			return false;
		}
		if (menuItem.id === 'fontworkgalleryfloater' && !this._isFileODF) {
			return false;
		}
		if (this._map.isReadOnlyMode() && menuItem.type === 'menu') {
			var found = this.options.allowedReadonlyMenus.includes(menuItem.id);
			if (!found && app.isRedlineManagementAllowed() && !this._map['wopi'].HideChangeTrackingControls)
				found = this.options.allowedRedlineManagementMenus.includes(menuItem.id);
			if (!found)
				return false;
		}
		if (this._map.isReadOnlyMode() && menuItem.readOnly === false) {
			return false;
		}
		if (this._map.isReadOnlyMode()) {
			switch (menuItem.id) {
			case 'last-mod':
			case 'save':
			case 'runmacro':
			case 'pagesetup':
			case 'changetheme': // applying a master page is an edit; see the row
			case 'watermark':
			case 'properties':
			case 'formattingmarks':
				return false;
			case 'insertcomment':
			case 'savecomments':
				if (!app.isCommentEditingAllowed()) {
					return false;
				}
			}
		}

		if (this._map.isEditMode()) {
			switch (menuItem.id) {
			case 'savecomments':
			case 'find':
				// The find-only entry is the readonly counterpart of Find &
				// Replace, so it is hidden while the document is editable.
				return false;
			}
		}

		if (menuItem.id === 'runmacro' && !window.enableMacrosExecution)
			return false;

		if (menuItem.type === 'action') {
			if (((menuItem.id === 'rev-history' || menuItem.id === 'Rev-History') && !window.L.Params.revHistoryEnabled) ||
				(menuItem.id === 'closedocument' && !window.L.Params.closeButtonEnabled) ||
				(menuItem.id === 'latestupdates' && !window.enableWelcomeMessage)) {
				return false;
			}
		}

		if (menuItem.id === 'print' && this._map['wopi'].HidePrintOption)
			return false;

		if (menuItem.id === 'save' && this._map['wopi'].HideSaveOption)
			return false;

		if (menuItem.id && (menuItem.id === 'saveas' || menuItem.id.startsWith('saveas-')) && this._map['wopi'].UserCanNotWriteRelative)
			return false;

		if (menuItem.id && (menuItem.id.startsWith('exportas')) && this._map['wopi'].UserCanNotWriteRelative)
			return false;

		if (menuItem.id && menuItem.id === 'exportpdf' && window.ThisIsTheAndroidApp)
			return false;

		if ((menuItem.id === 'shareas' || menuItem.id === 'ShareAs') && !this._map['wopi'].EnableShare)
			return false;

		if (menuItem.id === 'insertgraphicremote' && !this._map['wopi'].EnableInsertRemoteImage)
			return false;

		if (menuItem.id === 'renamedocument' && !(this._map['wopi']._supportsRename() && this._map['wopi'].UserCanRename))
			return false;

		// All three are the SAME capability -- pick a local image off this
		// device -- so they hide together or the phone Impress + sheet grows a
		// new phantom class: an Image row that opens a submenu with nothing in
		// it. `insertgraphiccamera` is the camera source and `insertimagemenu`
		// is the parent row that holds it and `insertgraphic`; both arrived
		// with Google's two-device-source image sheet (mobileInsertMenu
		// .presentation above). This gate is inert on this deployment either
		// way -- no WOPI route sends DisableInsertLocalImage -- but the host
		// already TRIES to send the neighbouring DisableInsertImage, so the
		// day that key is corrected the parent must go with its children.
		if ((menuItem.id === 'insertgraphic' || menuItem.id === 'insertgraphiccamera' || menuItem.id === 'insertimagemenu') && this._map['wopi'].DisableInsertLocalImage)
			return false;

		if (menuItem.id === 'insertmultimedia' && this._map['wopi'].DisableInsertLocalImage)
			return false;

		if (menuItem.id === 'remotemultimedia' && !this._map['wopi'].EnableInsertRemoteFile)
			return false;

		if (menuItem.id && menuItem.id.startsWith('fullscreen-presentation') && this._map['wopi'].HideExportOption)
			return false;

		if (menuItem.id === 'repair' && this._map['wopi'].HideRepairOption)
			return false;

		if (menuItem.id === 'changesmenu' && this._map['wopi'].HideChangeTrackingControls)
			return false;

		if (menuItem.id === 'invertbackground' && !window.prefs.getBoolean('darkTheme'))
			return false;


		// Keep track of all 'downloadas-' options and register them as
		// export formats with docLayer which can then be publicly accessed unlike
		// this Menubar control for which there doesn't seem to be any easy way
		// to get access to.
		if (menuItem.id && menuItem.id.startsWith('downloadas-')) {
			var format = menuItem.id.substring('downloadas-'.length);

			const docType: string = this._map.getDocType();
			const extraFormats = docType === 'presentation' ? ['svg', 'bmp', 'gif', 'png', 'tiff']
				: [];

			const appNames: Record<string, string> = {
				'presentation': 'impress'
			};

			// 🔴 The key is `<app>_<format>`, NOT `<format>_<app>`. This line
			// read `${format}_${appNames[docType]}` -- 'png_impress' -- and the
			// token nobody ever emits is 'png_impress', so the test always
			// failed and every one of the five extra presentation formats was
			// hidden UNCONDITIONALLY, including on a deployment whose admin had
			// switched them on. Not a phone bug and not fork-introduced: it
			// arrived with the vendor snapshot (fe4f3eba30) and it is a dead
			// control on the desktop menubar too.
			//
			// Three independent sources agree on the order against this line,
			// which is why it is a typo and not a convention I am guessing at:
			//   - the PRODUCER, wsd/FileServer.cpp:1600-1611, appends the
			//     literals ' impress_swf', ' impress_bmp', ' impress_gif',
			//     ' impress_png', ' impress_svg', ' impress_tiff' into
			//     %EXTRA_EXPORT_FORMATS%, which reaches the client through
			//     html/cool.html.m4:294 and js/global.js:535.
			//   - the OTHER CONSUMER, Control.NotebookbarBuilder.js:491-511,
			//     tests 'impress_svg' / 'impress_bmp' / 'impress_gif' /
			//     'impress_png' / 'impress_tiff' and gets it right, which is why
			//     the notebookbar shows these rows and the menubar never can.
			//   - the CONFIG NAMES themselves, coolwsd.xml.in:368-373.
			//
			// ⚠ Blast radius, stated rather than assumed: all six config values
			// default to false (coolwsd.xml.in:368-373) and nothing in this
			// repository overrides them, so on our deployment
			// window.extraExportFormats is the empty array and this fix changes
			// NOTHING -- the rows stay hidden exactly as they are today. It only
			// has an effect on a deployment that opted in, where showing the row
			// is the opt-in's whole point and matches what the notebookbar
			// already does.
			//
			// ⚠ This does NOT close google-slides.json's "Save As / Send a copy
			// — export formats" row. Google's phone list is the deck as PPTX /
			// PDF / TXT / ODP plus "the current slide alone as JPEG, PNG or
			// SVG". Even with the key fixed, per-slide export needs a server
			// config change rather than a diff; JPEG has no filter anywhere in
			// this tree (the five are svg/bmp/gif/png/tiff); the fork's SVG row
			// is the whole interactive deck, not one slide (coolwsd.xml.in:372);
			// and no 'downloadas-txt' exists for presentations. So no row is
			// added to the phone kebab here: it would render nothing on a
			// default deployment, which is a phantom entry, not a feature.
			if (extraFormats.includes(format) && !window.extraExportFormats.includes(`${appNames[docType]}_${format}`)) {
				return false;
			}

			app.registerExportFormat(menuItem.name, format);

			if (this._map['wopi'].HideExportOption)
				return false;
		}

		if (menuItem.id && menuItem.id.startsWith('export')) {
			if (!menuItem.id.startsWith('exportas-')) {
				var format = menuItem.id.substring('export'.length);
				app.registerExportFormat(menuItem.name, format);
			}

			if (this._map['wopi'].HideExportOption)
				return false;
		}

		if (this._hiddenItems &&
		    $.inArray(menuItem.id, this._hiddenItems) !== -1)
			return false;

		if (menuItem.id === 'settings-dialog' && !window.wopiSettingBaseUrl)
			return false;

		return true;
	}

	/**
	 * Recursively creates menu DOM elements from a menu configuration.
	 * @param menu - Array of menu configuration objects.
	 * @returns An array of list item (LI) elements.
	 */
	private _createMenu(menu: any[]): HTMLElement[] {
		var itemList = [];
		var docType = this._map.getDocType();
		var isReadOnly = this._map.isReadOnlyMode();

		if (isReadOnly && !app.file.editComment) {
			this._hiddenItems.push('insert');
		}

		if (!window.documentSigningEnabled) {
			this._hiddenItems.push('signature');
		}

		for (var i in menu) {
			if (this._checkItemVisibility(menu[i]) === false)
				continue;

			var liItem = window.L.DomUtil.create('li', '');
			liItem.setAttribute('role', 'presentation');
			if (menu[i].type === 'separator') {
				liItem.setAttribute('aria-hidden', 'true');
			}
			if (menu[i].id) {
				liItem.id = 'menu-' + menu[i].id;
				if (menu[i].id === 'closedocument' && isReadOnly) {
					// see corresponding css rule for readonly class usage
					window.L.DomUtil.addClass(liItem, 'readonly');
				}
			}
			var aItem = window.L.DomUtil.create('a', menu[i].disabled ? 'disabled' : '', liItem);
			aItem.setAttribute('role', 'menuitem');
			if (menu[i].name !== undefined) {
				aItem.innerHTML = menu[i].name;
			} else if (menu[i].uno !== undefined) {
				aItem.innerHTML = _UNO(menu[i].uno, docType);
			} else {
				$(aItem).addClass('disabled');
				aItem.replaceChildren();
			}
			if (menu[i].uno && (JSDialog.ShortcutsUtil.hasShortcut(menu[i].uno) || JSDialog.ShortcutsUtil.hasShortcut(menu[i].id))) {
				aItem.innerHTML = JSDialog.ShortcutsUtil.getMenuLabel(aItem.innerHTML, menu[i].uno ? menu[i].uno : menu[i].id);
			} else if (menu[i].shortcut && JSDialog.ShortcutsUtil.hasShortcut(menu[i].shortcut)) {
				// Action-only entries have no UNO command to derive a shortcut
				// from, so they name the command that owns it explicitly.
				aItem.innerHTML = JSDialog.ShortcutsUtil.getMenuLabel(aItem.innerHTML, menu[i].shortcut);
			}

			if (menu[i].type === 'menu') {
				var ulItem = window.L.DomUtil.create('ul', '', liItem);
				var subitemList = this._createMenu(menu[i].menu);
				if (!subitemList.length) {
					continue;
				}
				for (var idx in subitemList) {
					ulItem.appendChild(subitemList[idx]);
				}
				aItem.tabIndex = 0;
			} else if (menu[i].type === 'unocommand' || (!menu[i].type && menu[i].uno !== undefined)) {
				$(aItem).data('type', 'unocommand');
				$(aItem).data('uno', menu[i].uno);
				$(aItem).data('tag', menu[i].tag);
				aItem.tabIndex = 0;
			} else if (menu[i].type === 'separator') {
				$(aItem).addClass('separator');
				aItem.setAttribute('role', 'separator');
				aItem.tabIndex = -1;
			} else if (menu[i].type === 'action') {
				if (menu[i].id == 'feedback' && !this._map.feedback)
					continue;
				$(aItem).data('type', 'action');
				$(aItem).data('id', menu[i].id);
				if (menu[i].uno !== undefined)
					$(aItem).data('uno', menu[i].uno);
				if (menu[i].unoid !== undefined)
					$(aItem).data('unoid', menu[i].unoid);
				aItem.tabIndex = 0;
			}

			if (menu[i].hidden == true)
				$(aItem).css('display', 'none');

			if (menu[i].tablet == false && window.mode.isTablet()) {
				$(aItem).css('display', 'none');
			}

			if (this._hiddenItems && $.inArray(menu[i].id, this._hiddenItems) !== -1) {
				$(aItem).css('display', 'none');
			}

			this._map.hideRestrictedItems(menu[i], aItem, aItem);
			this._map.disableLockedItem(menu[i], aItem, aItem);
			itemList.push(liItem);
		}

		return itemList;
	}

	/**
       * Returns a jQuery collection of all menu item elements.
       * @returns The menu items.
       */
	private _getItems(): JQuery<HTMLElement> | null {
		if (this._menubarCont == null)
			return null;
		const $cont = ($(this._menubarCont) as unknown) as JQuery<HTMLElement>;
		return $cont.children().children('ul').children('li').add($cont.children('li'));
	}

	/**
	 * Retrieves a menu item by its target ID.
	 * @param targetId - The target menu item ID.
	 * @returns The jQuery element if found; otherwise null.
	 */
	private _getItem(targetId: string): JQuery<HTMLElement> | null {
		var items = this._getItems();
		if (items == null)
			return null;
		var found = $(items).filter((_, item) => {
			const id = $(item).attr('id');
			if (id && id == 'menu-' + targetId) {
				return true;
			}
			return false;
		});
		return found.length ? found : null;
	}

	/**
	 * Checks whether a menu item with the given target ID exists.
	 * @param targetId - The target menu item ID.
	 * @returns True if exists; otherwise false.
	 */
	hasItem(targetId: string): boolean {
		return this._getItem(targetId) != null;
	}

	/**
       * Hides a menu item by its target ID.
       * @param targetId - The target menu item ID.
       */
	hideItem(targetId: string): boolean {
		var item = this._getItem(targetId);
		if (item) {
			if ($.inArray(targetId, this._hiddenItems) == -1)
				this._hiddenItems.push(targetId);
			$(item).css('display', 'none');
			return true;
		} else {
			return false;
		}
	}

	/**
	 * Shows a menu item by its target ID.
	 * @param targetId - The target menu item ID.
	 */
	showItem(targetId: string): boolean {
		var item = this._getItem(targetId);
		if (item) {
			if ($.inArray(targetId, this._hiddenItems) !== -1)
				this._hiddenItems.splice(this._hiddenItems.indexOf(targetId), 1);
			$(item).css('display', '');
			return true;
		} else {
			return false;
		}
	}

	/**
	 * Retrieves menu items associated with a specific UNO command.
	 * @param commandId - The UNO command.
	 * @returns The menu items or null.
	 */
	private _getItemsForCommand(commandId: string): JQuery<HTMLElement> | null {
		var items = this._getItems();
		if (items == null)
			return null;
		const isUno = commandId.startsWith('.uno:');
		var found = $(items).filter(function() {
			var item = $(this.children[0]);
			var type = item.data('type');
			var id = null;
			if (type == 'unocommand') {
				id = $(item).data('uno');
			} else if (type == 'action') {
				if (isUno) {
					id = $(item).data('unoid');
					if (!id) {
						id = $(item).data('uno');
					}
				}
				if (!id) {
					id = $(item).data('id');
				}
			}
			if (id && id == commandId) {
				return true;
			}
			return false;
		});
		return found.length ? found : null;
	}

	/**
	 * Hides all menu items corresponding to a given UNO command.
	 * @param targetId - The UNO command.
	 */
	hideUnoItem(targetId: string): boolean {
		var items = this._getItemsForCommand(targetId);
		if (items) {
			$(items).each((_, item) => {
				if ($.inArray(item.id, this._hiddenItems) == -1) {
					this._hiddenItems.push(item.id);
				}
			});
			$(items).css('display', 'none');
			return true;
		}
		return false;
	}

	/**
	 * Shows all menu items corresponding to a given UNO command.
	 * @param targetId - The UNO command.
	 */
	showUnoItem(targetId: string): boolean {
		var items = this._getItemsForCommand(targetId);
		if (items) {
			$(items).each((_, item) => {
				if ($.inArray(item.id, this._hiddenItems) !== -1) {
					this._hiddenItems.splice(this._hiddenItems.indexOf(item.id), 1);
				}
			});
			$(items).css('display', '');
			return true;
		}
		return false;
	}

	/**
	 * Initializes the menubar with a given menu configuration.
	 * @param menu - Array of menu configuration objects.
	 */
	private _initializeMenu(menu: any[]): void {
		this._isFileODF = app.LOUtil.isFileODF(this._map);
		var menuHtml = this._createMenu(menu);
		for (var i in menuHtml) {
			this._menubarCont?.appendChild(menuHtml[i]);
		}
	}

	/**
       * True only inside the Vulcan phone chrome: a small-screen device AND the
       * pre-paint html.vulcan-mobile-chrome marker (js/global.js stamps it iff
       * !desktopChrome && mode.isSmallScreenDevice()). Desktop and tablet fail
       * both halves -- isTablet() is *defined* as !isSmallScreenDevice().
       */
	private _isVulcanPhoneChrome(): boolean {
		return !!(window as any).mode.isSmallScreenDevice()
			&& document.documentElement.classList.contains('vulcan-mobile-chrome');
	}

	/**
       * Generates the full menu structure (for mobile use).
       * @returns The full menu structure object.
       */
	generateFullMenuStructure(): any {
		var topMenu = {
			type : 'menubar',
			enabled : true,
			id : 'menubar',
			children : [] as any[]
		};
		// The options KEY is 'mobile' + docType, but _UNO()'s second argument
		// is a MODULE name -- 'text' | 'spreadsheet' | 'presentation' |
		// 'global', assigned by XCU filename prefix in scripts/unocommands.py.
		// 'mobilespreadsheet' can never match one, so _UNO fell through
		// entry[component] -> entry['global'] -> `return command`, and every
		// module-only command in these arrays rendered as its RAW IDENTIFIER
		// on phones ('SortAscending', 'Validation', 'TrackChanges', ...).
		// generateInsertMenuStructure() below already passes the real docType;
		// match it, and keep the prefixed key only for the options lookup.
		var docType = this._map.getDocType();
		var optionsKey = ('mobile' + docType) as keyof typeof this.options;
		var items = this.options[optionsKey];
		if (!Array.isArray(items))
			return topMenu;

		for (var i = 0; i < items.length; i++) {
			if (this._checkItemVisibility(items[i]) === true) {
				var item = this._generateMenuStructure(items[i], docType, false);
				if (item)
					topMenu.children.push(item);
			}
		}
		return topMenu;
	}

	/**
	 * Generates the insert menu structure for mobile.
	 * @returns The generated insert menu structure.
	 */
	generateInsertMenuStructure(): any {
		var docType = this._map.getDocType();
		var target = this.options['mobileInsertMenu'][docType];

		var menuStructure = this._generateMenuStructure(target, docType, true);
		return menuStructure;
	}

	/**
       * Recursively generates a menu structure object from a configuration item.
       * @param item - The menu configuration item.
       * @param docType - The document type.
       * @param mainMenu - Flag indicating if it is the main menu.
       * @returns The generated menu structure or undefined.
       */
	private _generateMenuStructure(item: any, docType: string, mainMenu: boolean): any {
		var itemType;
		if (mainMenu) {
			itemType = 'mainmenu';
		} else {
			if (item.mobileapp == true && !window.ThisIsAMobileApp)
				return undefined;
			if (item.mobileapp === false && window.ThisIsAMobileApp)
				return undefined;
			if (!item.menu) {
				itemType = 'menuitem';
			} else {
				itemType = 'submenu';
			}
		}

		if (item.id === 'feedback' && !this._map.feedback)
			return undefined;

		var itemName;
		if (item.name)
			itemName = item.name;
		else if (item.uno)
			itemName = _UNO(item.uno, docType);
		else
			return undefined; // separator

		var menuStructure = {
			id : item.id,
			type : itemType,
			enabled : !item.disabled,
			text : itemName,
			command : item.uno,
			executionType : item.type,
			data : item,
			'checked' : false,
			children : [] as any[]
		};

		// Checked state for insert header / footer
		var insertHeaderString = '.uno:InsertPageHeader?PageStyle:string=';
		var insertFooterString = '.uno:InsertPageFooter?PageStyle:string=';
		if (item.uno && (item.uno.startsWith(insertHeaderString) || item.uno.startsWith(insertFooterString))) {
			var style = decodeURIComponent(item.uno.slice(item.uno.search('=') + 1));
			style = style.slice(0, style.length - 1);
			var shortUno = item.uno.slice(0, item.uno.search('\\?'));
			var state = this._map['stateChangeHandler'].getItemValue(shortUno);
			if (state && state[style]) {
				menuStructure['checked'] = true;
			}
		} else if (item.uno === '.uno:TrackChanges' ||
			item.uno === '.uno:ShowTrackedChanges' ||
			item.uno === '.uno:ControlCodes' ||
			// Without this the reflow row is a toggle that never shows its own
			// state -- and "am I in page view or reflowed view" is the entire
			// question the row exists to answer.
			//
			// 🔴 THIS LINE WAS `.uno:PrintLayout` AND IT COULD NEVER BE TRUE.
			// Membership here is necessary, not sufficient: the value comes
			// from `stateChangeHandler.getItemValue(...)`, which is only ever
			// populated by a KIT_CALLBACK_STATE_CHANGED payload, and core
			// emits one only for commands in `GetKitUnoCommandList()`
			// (sfx2/source/control/unoctitm.cxx). PrintLayout is not in that
			// list and never was, so this test read `undefined === 'true'` on
			// every menu build. BrowseView is now in the list, with
			// IsActivePayload, which emits exactly the `.uno:BrowseView=true`
			// shape this compares against.
			item.uno === '.uno:BrowseView' ||
			item.uno === '.uno:SpellOnline' ||
			item.uno === '.uno:ShowResolvedAnnotations' ||
			// Google's 'Create a filter' flips to 'Remove filter' once the
			// block has one. Core broadcasts an SfxBoolItem for SID_AUTO_FILTER
			// saying which state we are in (sc/source/ui/view/cellsh2.cxx), so
			// the entry can read as the toggle it actually is. This function is
			// mobile-only -- its only callers are the two mobile generators --
			// so this cannot reach desktop.
			item.uno === '.uno:DataFilterAutoFilter' ||
			item.uno === '.uno:FreezePanes') {
			if (this._map['stateChangeHandler'].getItemValue(item.uno) === 'true') {
				menuStructure['checked'] = true;
				if (item.uno === '.uno:DataFilterAutoFilter')
					menuStructure.text = _('Remove filter');
			}
		} else if (item.id === 'togglea11ystate') {
			if (window.prefs.getBoolean('accessibilityState'))
				menuStructure['checked'] = true;
		} else if (item.id === 'toggledarktheme' && window.prefs.getBoolean('darkTheme')) {
			menuStructure['checked'] = true;
		} else if (item.id === 'invertbackground' && window.prefs.getBoolean('darkTheme')) {
			menuStructure['checked'] = !this._map.uiManager.isBackgroundDark();
		}

		if (item.menu)
		{
			for (var i = 0; i < item.menu.length; i++) {
				if (this._checkItemVisibility(item.menu[i]) === true) {
					var element = this._generateMenuStructure(item.menu[i], docType, false);
					if (element)
						menuStructure['children'].push(element);
				}
			}
		}
		return menuStructure;
	}

	/**
	 * Recursively searches for a submenu by name.
	 * @param menuTarget - The menu structure.
	 * @param nameString - The name to search for.
	 * @returns The found submenu or null.
	 */
	private _getMenuItems(menu: any): any {
		return $(menu).children().children('a').not('.has-submenu');
	}

	private _findSubMenuByName(menuTarget: any, nameString: string): any {
		if (menuTarget.name === nameString)
			return menuTarget;

		if (menuTarget.menu)
		{
			for (var i = 0; i < menuTarget.menu.length; i++) {
				var foundItem = this._findSubMenuByName(menuTarget.menu[i], nameString);
				if (foundItem)
					return foundItem;
			}
		}
		return null;
	}

	/**
	 * Initializes the modification indicator in the menubar.
	 * @param lastmodtime - The last modification time.
	 */
	private _onInitModificationIndicator(lastmodtime: any): void {
		var lastModButton = window.L.DomUtil.get('menu-last-mod');
		/*
		 * VULCAN (desktop chrome): no "Last saved: 2m ago" in the menu row.
		 *
		 * It is a wide, ever-changing string sitting between the menus and the
		 * right cluster, and it says less than the save chip two slots along
		 * already says — the chip names the CURRENT state (Saved / Saving /
		 * Edited / Not saved), which is what a writer needs, while the elapsed
		 * time is a detail nobody acts on. Removing it gives the row back the
		 * space, and the revision-history route (File > Version History) is
		 * untouched.
		 */
		if (document.documentElement.classList.contains('vulcan-desktop-chrome')) {
			if (lastModButton) window.L.DomUtil.setStyle(lastModButton, 'display', 'none');
			return;
		}
		if (lastModButton !== null && lastModButton !== undefined
			&& lastModButton.firstChild
			&& lastModButton.firstChild.innerHTML !== null
			&& lastModButton.firstChild.childElementCount == 0) {
			if (lastmodtime == null) {
				// No modification time -> hide the indicator
				window.L.DomUtil.setStyle(lastModButton, 'display', 'none');
				return;
			}
			var mainSpan = document.createElement('span');
			this.lastModIndicator = document.createElement('span');
			mainSpan.appendChild(this.lastModIndicator);

			// Replace menu button body with new content
			lastModButton.firstChild.replaceChildren();
			lastModButton.firstChild.appendChild(mainSpan);

			if (window.L.Params.revHistoryEnabled) {
				window.L.DomUtil.setStyle(lastModButton, 'cursor', 'pointer');
			}

			this._map.fire('modificationindicatorinitialized');
		}
	}

	/**
       * Updates the modification indicator.
       * @param e - Event data containing the new modification time.
       */
	private _onUpdateModificationIndicator(e: any): void {
		if (this.lastModIndicator !== null && this.lastModIndicator !== undefined) {
			this.lastModIndicator.textContent = e.lastSaved;
		}
	}
}

/*
 * Only a real change of the window size closes the menus.
 *
 * smartmenus binds winResize to every window resize and, on a desktop
 * browser, blurs the item that opened the menu and hides every menu. That
 * is upstream behaviour, so menus never float off a reflowed bar. A
 * synthetic resize at the same size must not close them. A status bar update
 * sends none (JSDialog.RefreshScrollables dispatches 'refreshscrollables'),
 * but the notebookbar's jQuery $(window).resize() does, and so may any other
 * code. Widget.OverflowManager.onResize and
 * VulcanCalcDesktopChrome ignore such an event by the same test.
 *
 * Each instance compares with the size it last saw: the size when it was
 * built (a menubar rebuild builds a new one) and at each real resize. A
 * disabled menubar (its overlay) and an orientation change keep upstream.
 */
function vulcanMenusCloseOnRealResizeOnly(SmartMenus: any): void {
	const proto = SmartMenus && SmartMenus.prototype;
	if (!proto || proto._vulcanRealResizeOnly) return;
	proto._vulcanRealResizeOnly = true;
	const init = proto.init;
	const winResize = proto.winResize;
	const windowSize = (): string => window.innerWidth + 'x' + window.innerHeight;
	proto.init = function (...args: any[]) {
		this._vulcanWindowSize = windowSize();
		return init.apply(this, args);
	};
	proto.winResize = function (...args: any[]) {
		const e = args[0];
		if (e && e.type === 'resize' && this.handleEvents()
			&& windowSize() === this._vulcanWindowSize)
			return;
		this._vulcanWindowSize = windowSize();
		return winResize.apply(this, args);
	};
}

if (typeof $ !== 'undefined')
	vulcanMenusCloseOnRealResizeOnly(($ as any).SmartMenus);
