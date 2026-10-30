/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/*
 * This file is part of the Collabora Office project.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

#include <test/unoapixml_test.hxx>

#include <com/sun/star/beans/XPropertySet.hpp>
#include <com/sun/star/container/XIndexAccess.hpp>
#include <com/sun/star/document/XUndoManager.hpp>
#include <com/sun/star/document/XUndoManagerSupplier.hpp>
#include <com/sun/star/qa/XDumper.hpp>
#include <com/sun/star/text/XDocumentIndex.hpp>
#include <com/sun/star/text/XDocumentIndexesSupplier.hpp>
#include <com/sun/star/text/XTextDocument.hpp>
#include <com/sun/star/util/XModifiable.hpp>

#include <test/xmldocptr.hxx>

using namespace com::sun::star;

namespace
{
/// Tests for sw/source/writerfilter/dmapper/SettingsTable.cxx.
class Test : public UnoApiXmlTest
{
public:
    Test()
        : UnoApiXmlTest(u"/sw/qa/writerfilter/dmapper/data/"_ustr)
    {
    }

    /// The text of the document's only index (its TOC).
    OUString getTocText()
    {
        uno::Reference<text::XDocumentIndexesSupplier> xIndexesSupplier(mxComponent,
                                                                        uno::UNO_QUERY);
        uno::Reference<container::XIndexAccess> xIndexes = xIndexesSupplier->getDocumentIndexes();
        CPPUNIT_ASSERT_EQUAL(static_cast<sal_Int32>(1), xIndexes->getCount());
        uno::Reference<text::XDocumentIndex> xIndex(xIndexes->getByIndex(0), uno::UNO_QUERY);
        return xIndex->getAnchor()->getString();
    }
};

CPPUNIT_TEST_FIXTURE(Test, testDoNotBreakWrappedTables)
{
    // Given a document with <w:doNotBreakWrappedTables>:
    // When importing that document:
    loadFromFile(u"do-not-break-wrapped-tables.docx");

    // Then make sure that the matching compat flag is set:
    uno::Reference<lang::XMultiServiceFactory> xDocument(mxComponent, uno::UNO_QUERY);
    uno::Reference<beans::XPropertySet> xSettings(
        xDocument->createInstance(u"com.sun.star.document.Settings"_ustr), uno::UNO_QUERY);
    bool bDoNotBreakWrappedTables{};
    xSettings->getPropertyValue(u"DoNotBreakWrappedTables"_ustr) >>= bDoNotBreakWrappedTables;
    // Without the accompanying fix in place, this test would have failed, the compat flag was not
    // set.
    CPPUNIT_ASSERT(bDoNotBreakWrappedTables);
}

CPPUNIT_TEST_FIXTURE(Test, testAllowTextAfterFloatingTableBreak)
{
    // Given a document with <w:compatSetting w:name="allowTextAfterFloatingTableBreak">:
    // When importing that document:
    loadFromFile(u"floattable-wrap-on-all-pages.docx");

    // Then make sure that the matching compat flag is set:
    uno::Reference<lang::XMultiServiceFactory> xDocument(mxComponent, uno::UNO_QUERY);
    uno::Reference<beans::XPropertySet> xSettings(
        xDocument->createInstance(u"com.sun.star.document.Settings"_ustr), uno::UNO_QUERY);
    bool bAllowTextAfterFloatingTableBreak{};
    xSettings->getPropertyValue(u"AllowTextAfterFloatingTableBreak"_ustr)
        >>= bAllowTextAfterFloatingTableBreak;
    // Without the accompanying fix in place, this test would have failed, the compat flag was not
    // set.
    CPPUNIT_ASSERT(bAllowTextAfterFloatingTableBreak);
}

CPPUNIT_TEST_FIXTURE(Test, testAddVerticalFrameOffsetsRTF)
{
    // Given a document with a floating table, immediately followed by an inline table:
    // When importing that document:
    loadFromFile(u"floattable-vertical-frame-offset.rtf");

    // Then make sure the floating and the inline tables don't overlap:
    uno::Reference<frame::XModel> xModel(mxComponent, uno::UNO_QUERY);
    css::uno::Reference<qa::XDumper> xDumper(xModel->getCurrentController(), uno::UNO_QUERY);
    OString aDump = xDumper->dump(u"layout"_ustr).toUtf8();
    auto pCharBuffer = reinterpret_cast<const xmlChar*>(aDump.getStr());
    xmlDocUniquePtr pXmlDoc(xmlParseDoc(pCharBuffer));
    sal_Int32 nFlyBottom = getXPath(pXmlDoc, "//fly/infos/bounds", "bottom").toInt32();
    sal_Int32 nTableFrameTop = getXPath(pXmlDoc, "//body/tab/infos/bounds", "top").toInt32();
    sal_Int32 nTableTopMargin = getXPath(pXmlDoc, "//body/tab/infos/prtBounds", "top").toInt32();
    sal_Int32 nTableTop = nTableFrameTop + nTableTopMargin;
    // Without the accompanying fix in place, this test would have failed with:
    // - Expected greater than: 2747
    // - Actual  : 1449
    // i.e. table top should be ~2748, but was less, leading to an overlap.
    CPPUNIT_ASSERT_GREATER(nFlyBottom, nTableTop);
}

CPPUNIT_TEST_FIXTURE(Test, testEndnoteAtSectionEnd)
{
    // Given a document with at-section-end endnotes enabled:
    loadFromFile(u"endnote-at-section-end.docx");

    // Go to the second paragraph, which is inside Word's second section:
    uno::Reference<text::XTextDocument> xTextDocument(mxComponent, uno::UNO_QUERY);
    uno::Reference<container::XEnumerationAccess> xParaEnumAccess(xTextDocument->getText(),
                                                                  uno::UNO_QUERY);
    uno::Reference<container::XEnumeration> xParaEnum = xParaEnumAccess->createEnumeration();
    xParaEnum->nextElement();
    uno::Reference<beans::XPropertySet> xPara(xParaEnum->nextElement(), uno::UNO_QUERY);
    uno::Reference<beans::XPropertySet> xSection;
    xPara->getPropertyValue(u"TextSection"_ustr) >>= xSection;
    bool bEndnoteIsCollectAtTextEnd = false;
    xSection->getPropertyValue(u"EndnoteIsCollectAtTextEnd"_ustr) >>= bEndnoteIsCollectAtTextEnd;
    // Without the accompanying fix in place, this test would have failed, endnotes were always at
    // document end.
    CPPUNIT_ASSERT(bEndnoteIsCollectAtTextEnd);
}

CPPUNIT_TEST_FIXTURE(Test, testUpdateFieldsFillsToc)
{
    // Given a document as docx-js writes it: <w:updateFields>, a dirty TOC field with no entries
    // yet, and Heading 1-2 styles without <w:outlineLvl>:
    // When importing that document:
    loadFromFile(u"update-fields-toc.docx");

    // Then make sure the TOC lists the headings, in order:
    OUString aToc = getTocText();
    sal_Int32 nScope = aToc.indexOf("Scope of the manual");
    sal_Int32 nSignsOff = aToc.indexOf("Who signs off");
    sal_Int32 nRetention = aToc.indexOf("Retention schedule");
    // Without the accompanying fix in place, this test would have failed, the TOC stayed empty
    // until the user updated it.
    CPPUNIT_ASSERT(nScope != -1);
    CPPUNIT_ASSERT_GREATER(nScope, nSignsOff);
    CPPUNIT_ASSERT_GREATER(nSignsOff, nRetention);

    // And that the update is part of the load: nothing to save, nothing to undo.
    uno::Reference<util::XModifiable> xModifiable(mxComponent, uno::UNO_QUERY);
    CPPUNIT_ASSERT(!xModifiable->isModified());
    uno::Reference<document::XUndoManagerSupplier> xUndoManagerSupplier(mxComponent,
                                                                        uno::UNO_QUERY);
    CPPUNIT_ASSERT(!xUndoManagerSupplier->getUndoManager()->isUndoPossible());
}

CPPUNIT_TEST_FIXTURE(Test, testNoUpdateFieldsKeepsTocResult)
{
    // Given a TOC as Word saves it: one stale entry as its result, and no <w:updateFields>:
    // When importing that document:
    loadFromFile(u"toc-cached-result.docx");

    // Then make sure the TOC still shows what the file stored, as Word does:
    OUString aToc = getTocText();
    CPPUNIT_ASSERT(aToc.indexOf("Stale entry") != -1);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_Int32>(-1), aToc.indexOf("Scope of the manual"));
}
}

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
