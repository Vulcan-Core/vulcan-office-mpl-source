/* global describe beforeEach cy it expect require */

var helper = require('../../common/helper');
var mobileHelper = require('../../common/mobile_helper');

describe(['tagmobile', 'tagnextcloud', 'tagproxy'], 'Delete Objects', function() {

	beforeEach(function() {
		helper.setupAndLoadDocument('writer/delete_objects.odt');

		// Click on edit button
		mobileHelper.enableEditingMobile();

		cy.getFrameWindow().then((win) => {
			this.win = win;
		});
	});

	it('Delete Text', function() {
		helper.typeIntoDocument('text');
		helper.selectAllText();
		helper.typeIntoDocument('{del}');
		helper.typeIntoDocument('{ctrl}a');
		helper.textSelectionShouldNotExist();
	});

	it('Delete Shapes', function() {
		mobileHelper.openInsertionWizard();

		// Do insertion
		cy.cGet('body').contains('.menu-entry-with-icon', 'Shape').click();
		cy.cGet('.col.w2ui-icon.basicshapes_rectangle').click();
		// Check that the shape is there
		cy.cGet('#canvas-container > svg').should('exist');
		cy.cGet('#canvas-container > svg > svg').then(function(svg) {
				expect(parseInt(svg[0].style.width.replace('px', ''))).to.be.greaterThan(0);
				expect(parseInt(svg[0].style.height.replace('px', ''))).to.be.greaterThan(0);
			});

		//deletion
		helper.getShapeSVGCenter().then(function(pos) {
			cy.cGet('#document-canvas').rightclick(pos.x, pos.y);
		});

		cy.cGet('body').contains('.menu-entry-with-icon', 'Delete').should('be.visible').click();
		cy.cGet('#document-container svg g').should('not.exist');
	});

	it('Delete Table', function() {
		helper.setDummyClipboardForCopy();
		mobileHelper.openInsertionWizard();
		// Open Table submenu
		cy.cGet('body').contains('.ui-header.level-0.mobile-wizard.ui-widget', 'Table').click();
		cy.cGet('.mobile-wizard.ui-text').should('be.visible');
		// Push insert table button
		cy.cGet('.inserttablecontrols button').should('be.visible').click();
		// Drain core before checking the perimeter or selecting; the table
		// update can lag the insertion command.
		helper.processToIdle(this.win);
		// Phone Writer keeps the desktop perimeter hidden after insertion.
		cy.cGet('.table-column-resize-marker, .table-row-resize-marker, .table-select-marker, .table-add-col-row-marker')
			.should('not.exist');
		helper.typeIntoDocument('{ctrl}a');
		helper.copy();
		// Two rows
		cy.cGet('#copy-paste-container tr').should('have.length', 2);
		// Four cells
		cy.cGet('#copy-paste-container td').should('have.length', 4);

		// Delete through the deliberate Table surface, not a perimeter handle.
		mobileHelper.openMobileWizard();
		cy.cGet('body').contains('.ui-tab', 'Table')
			.should('be.visible')
			.click();
		cy.cGet('#vulcan-table-table-delete-button')
			.should('be.visible')
			.click();
		helper.processToIdle(this.win);

		cy.cGet('.table-column-resize-marker, .table-row-resize-marker, .table-select-marker, .table-add-col-row-marker')
			.should('not.exist');
		cy.getFrameWindow()
			.its('app.map.context.contexts')
			.should('not.include', 'Table');
	});

	it('Delete Fontwork', function() {
		mobileHelper.openInsertionWizard();

		// Do insertion
		cy.cGet('body').contains('.menu-entry-with-icon', 'Fontwork...').click();
		cy.cGet('#FontworkGalleryDialog').should('exist');
		cy.cGet('#ok').click();
		cy.wait(1000);

		cy.cGet('#test-div-shapeHandlesSection').should('exist');

		cy.cGet('#document-container').then(function(item) {
			const boundingRectangle = item[0].getBoundingClientRect();
			const x = boundingRectangle.left + boundingRectangle.width / 2;
			const y = boundingRectangle.top + boundingRectangle.height / 2;
			cy.cGet('#document-canvas').rightclick(x, y);
		});

		cy.wait(1000);
		cy.cGet('body').contains('.menu-entry-with-icon', 'Delete').should('be.visible').click();
		cy.cGet('#test-div-shapeHandlesSection').should('not.exist');
	});

	it('Delete Chart' , function() {
		mobileHelper.openInsertionWizard();
		cy.cGet('body').contains('.menu-entry-with-icon', 'Chart...').click();
		cy.cGet('#test-div-shapeHandlesSection').should('exist');

		// exit active object mode
		helper.typeIntoDocument('{esc}');

		// wait for core to finish processing OLE deactivation
		helper.processToIdle(this.win);

		cy.cGet('#document-container').then(function(item) {
			const boundingRectangle = item[0].getBoundingClientRect();
			const x = boundingRectangle.left + boundingRectangle.width / 2;
			const y = boundingRectangle.top + boundingRectangle.height / 2;
			cy.cGet('#document-canvas').rightclick(x, y);
		});

		cy.cGet('body').contains('.menu-entry-with-icon', 'Delete').should('be.visible').click();
		cy.cGet('#test-div-shapeHandlesSection').should('not.exist');
	});
});
