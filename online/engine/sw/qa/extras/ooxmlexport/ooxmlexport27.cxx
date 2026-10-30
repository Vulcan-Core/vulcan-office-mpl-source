/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/*
 * This file is part of the Collabora Office project.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

#include <swmodeltestbase.hxx>

#include <com/sun/star/beans/XPropertyState.hpp>

#include <pam.hxx>
#include <unotxdoc.hxx>
#include <docsh.hxx>
#include <IDocumentSettingAccess.hxx>
#include <wrtsh.hxx>

namespace
{
class Test : public SwModelTestBase
{
public:
    Test()
        : SwModelTestBase(u"/sw/qa/extras/ooxmlexport/data/"_ustr)
    {
    }
};

DECLARE_OOXMLEXPORT_TEST(testTdf38575_fullWidthLine, "tdf38575_fullWidthLine.docx")
{
    // given a document where the header contains a graphic that spans the entire left side,
    // reducing the available body text area for every page in the document,
    // and an AS_CHAR horizontal line that wants the entire width (and thus could never fit)

    // for compatibilityMode 15, in MS Word 2024, this is 4 pages long (not infinitely long)
    CPPUNIT_ASSERT_EQUAL(4, getPages());
}

CPPUNIT_TEST_FIXTURE(Test, testTdf124398_groupshapeChart)
{
    // given a document with grouped chart and textbox
    // TODO: seeing the chart is broken since 24.8.4

    createSwDoc("tdf124398_groupshapeChart.docx");

    // MS Word considered this document to be corrupt for several reasons.
    save(TestFilter::DOCX);

    xmlDocUniquePtr pXmlDoc = parseExport(u"word/document.xml"_ustr);
    // DOCX/wps: doesn't use nvGraphicFramePr - only PPTX/p: and XLSX/xdr: do.
    assertXPath(pXmlDoc, "//wpg:graphicFrame/wpg:cNvPr", 1);
}

CPPUNIT_TEST_FIXTURE(Test, testTdf171527_flyInFramePr)
{
    // given a with a framePr'd image anchoring a drawing shape
    createSwDoc("tdf171527_flyInFramePr.doc");

    save(TestFilter::DOCX);

    xmlDocUniquePtr pXmlDoc = parseExport(u"word/document.xml"_ustr);
    // Without the fix, MS Word complained the file was corrupt.
    // Round-trip the framePr'd image as a framePr instead of as a drawingML
    assertXPath(pXmlDoc, "//w:body/w:p/w:pPr/w:framePr", 1);
}

CPPUNIT_TEST_FIXTURE(Test, testTdf171433_equation)
{
    // given a document with formula
    createSwDoc("tdf171433_equation.docx");

    save(TestFilter::DOCX);

    xmlDocUniquePtr pXmlDoc = parseExport(u"word/document.xml"_ustr);
    // Without the fix, the formula was completely broken - missing SubSup entirely
    assertXPath(pXmlDoc, "//m:sSubSup/m:sup", 1);
}

CPPUNIT_TEST_FIXTURE(Test, testSdtPictureDataBinding)
{
    // Given a DOCX with a picture content control (w:picture + w:dataBinding)
    // where the data binding resolves to base64 image data from custom XML.
    // The sdtContent has a w:drawing with the actual rendered image.
    // Without the fix, the drawing was replaced by the raw base64 text.
    createSwDoc("sdt-picture-databinding.docx");

    // The first paragraph should contain a graphic, not text
    CPPUNIT_ASSERT_EQUAL(1, getShapes());
}

CPPUNIT_TEST_FIXTURE(Test, testCool15788_symbolContentControl)
{
    createSwDoc("Cool15788_symbolContentControl.docx");

    save(TestFilter::DOCX);

    xmlDocUniquePtr pXmlDoc = parseExport(u"word/document.xml"_ustr);
    // this must not exist, otherwise Word complains about the file
    // <w:sym w:font="Wingdings" w:char="f04b"/>
    CPPUNIT_ASSERT_EQUAL(0, countXPathNodes(pXmlDoc, "/w:document/w:body/w:p/w:sdt/w:sdtContent/w:r[2]/w:sym"));
    // simply a <w:t> element with the symbol must exist instead
    assertXPathContent(pXmlDoc, "/w:document/w:body/w:p/w:sdt/w:sdtContent/w:r[2]/w:t", u"\xf04b");
}

CPPUNIT_TEST_FIXTURE(Test, testEng2435ContentControlAfterHyperlink)
{
    // given content controls that start where a hyperlink ends: a Google Docs
    // suggestion that starts inside a link and runs past its end (one w:sdt
    // inside the w:hyperlink, one right after it), plain controls right after a
    // link mid-paragraph and at the paragraph end, a control wrapping a link, and
    // a link right after a link that starts with a control
    createSwDoc("eng2435-sdt-after-hyperlink.docx");

    save(TestFilter::DOCX);

    // Without the fix, the hyperlink was closed after the control's first run,
    // inside its still-open <w:sdtContent>, so word/document.xml was not
    // well-formed: "Opening and ending tag mismatch: sdtContent ... and hyperlink".
    xmlDocUniquePtr pXmlDoc = parseExport(u"word/document.xml"_ustr);
    CPPUNIT_ASSERT(pXmlDoc);

    // The suggestion's first half stays inside the link, its second half after it.
    assertXPath(pXmlDoc, "/w:document/w:body/w:p[1]/w:hyperlink", 1);
    assertXPath(pXmlDoc, "/w:document/w:body/w:p[1]/w:hyperlink/w:sdt", 1);
    assertXPath(pXmlDoc, "/w:document/w:body/w:p[1]/w:sdt", 1);
    assertXPath(pXmlDoc, "/w:document/w:body/w:p[1]/w:sdt/w:sdtPr/w:tag", "val", u"goog_rdk_0");
    assertXPathContent(pXmlDoc, "/w:document/w:body/w:p[1]/w:sdt/w:sdtContent/w:r[2]/w:t",
                       u" and the rest of the sentence.");
    // A control right after a link is not inside it.
    assertXPath(pXmlDoc, "/w:document/w:body/w:p[2]/w:hyperlink/w:sdt", 0);
    assertXPath(pXmlDoc, "/w:document/w:body/w:p[2]/w:sdt", 1);
    assertXPath(pXmlDoc, "/w:document/w:body/w:p[3]/w:hyperlink/w:sdt", 0);
    assertXPath(pXmlDoc, "/w:document/w:body/w:p[3]/w:sdt", 1);
    // A control wrapping a link still wraps it.
    assertXPath(pXmlDoc, "/w:document/w:body/w:p[4]/w:sdt/w:sdtContent/w:hyperlink", 1);
    // A link right after a link, starting with a control: the first link closes before
    // the second opens, and the second keeps the control and the text after it.
    assertXPath(pXmlDoc, "/w:document/w:body/w:p[5]/w:hyperlink", 2);
    assertXPath(pXmlDoc, "/w:document/w:body/w:p[5]/w:hyperlink[1]/w:sdt", 0);
    assertXPath(pXmlDoc, "/w:document/w:body/w:p[5]/w:hyperlink[2]/w:sdt", 1);
    assertXPathContent(pXmlDoc, "/w:document/w:body/w:p[5]/w:hyperlink[2]/w:r/w:t", u" more");
}

CPPUNIT_TEST_FIXTURE(Test, testLineNumberingOnlyInNumberedSection)
{
    // Given a document whose first section (a cover and contents, paragraphs 1-32) has no
    // w:lnNumType, and whose second section numbers its lines and restarts page numbers:
    createSwDoc("line-numbering-unnumbered-first-section.docx");

    // Then only the second section's lines are counted. Without the fix, the cover and contents
    // were numbered 1-32 and QA01 was line 33.
    CPPUNIT_ASSERT(!getProperty<bool>(getParagraph(1, u"CV01 cover"_ustr),
                                      u"ParaLineNumberCount"_ustr));
    CPPUNIT_ASSERT(!getProperty<bool>(getParagraph(32, u"TC19 contents .......... 19"_ustr),
                                      u"ParaLineNumberCount"_ustr));
    CPPUNIT_ASSERT(getProperty<bool>(getParagraph(33, u"QA01 question or answer"_ustr),
                                     u"ParaLineNumberCount"_ustr));

    // And the save gives lnNumType to the second section only, so Word numbers that one alone.
    // Without the fix, both sections had it, and Word numbered QA01 as line 34.
    save(TestFilter::DOCX);
    xmlDocUniquePtr pXmlDoc = parseExport(u"word/document.xml"_ustr);
    assertXPath(pXmlDoc, "//w:pPr/w:sectPr", 1);
    assertXPath(pXmlDoc, "//w:pPr/w:sectPr/w:lnNumType", 0);
    assertXPath(pXmlDoc, "/w:document/w:body/w:sectPr/w:lnNumType", 1);
}

} // end of anonymous namespace
CPPUNIT_PLUGIN_IMPLEMENT();

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
