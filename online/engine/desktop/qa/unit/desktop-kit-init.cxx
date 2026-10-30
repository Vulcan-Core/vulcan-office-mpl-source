/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/*
 * This file is part of the Collabora Office project.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

#include <cppunit/TestFixture.h>
#include <cppunit/plugin/TestPlugIn.h>
#include <cppunit/extensions/HelperMacros.h>
#include <comphelper/anytostring.hxx>
#include <comphelper/propertyvalue.hxx>
#include <comphelper/sequence.hxx>
#include <comphelper/sequenceashashmap.hxx>

#include <tools/color.hxx>

#include <lib/init.hxx>

#include <com/sun/star/table/BorderLine2.hpp>
#include <com/sun/star/table/BorderLineStyle.hpp>

using namespace css;

/// Unit tests for desktop/source/lib/init.cxx internals.
class KitInitTest : public ::CppUnit::TestFixture
{
public:
    KitInitTest() {}

    void testJsonToPropertyValues();
    void testJsonToPropertyValuesBorder();
    void testPdfSourceSaveFilterData();

    CPPUNIT_TEST_SUITE(KitInitTest);
    CPPUNIT_TEST(testJsonToPropertyValues);
    CPPUNIT_TEST(testJsonToPropertyValuesBorder);
    CPPUNIT_TEST(testPdfSourceSaveFilterData);
    CPPUNIT_TEST_SUITE_END();
};

namespace
{
void assertSequencesEqual(const cpo::uno::Sequence<beans::PropertyValue>& expected,
                          const cpo::uno::Sequence<beans::PropertyValue>& actual)
{
    CPPUNIT_ASSERT_EQUAL_MESSAGE("The sequences should have the same length", expected.getLength(),
                                 actual.getLength());
    for (int i = 0; i < expected.getLength(); ++i)
    {
        CPPUNIT_ASSERT_EQUAL(expected[i].Name, actual[i].Name);
        CPPUNIT_ASSERT_EQUAL(comphelper::anyToString(expected[i].Value),
                             comphelper::anyToString(actual[i].Value));
    }
}
} // namespace

void KitInitTest::testJsonToPropertyValues()
{
    const char arguments[] = "{"
                             "\"FileName\":{"
                             "\"type\":\"string\","
                             "\"value\":\"something.odt\""
                             "}}";

    cpo::uno::Sequence aArgs{ comphelper::makePropertyValue(u"FileName"_ustr,
                                                            u"something.odt"_ustr) };

    assertSequencesEqual(
        aArgs, comphelper::containerToSequence(desktop::jsonToPropertyValuesVector(arguments)));
}

void KitInitTest::testJsonToPropertyValuesBorder()
{
    const char arguments[]
        = "{"
          "\"OuterBorder\": {"
          "\"type\" : \"[]any\","
          "\"value\" : ["
          "{ \"type\" : \"com.sun.star.table.BorderLine2\", \"value\" : { \"Color\" : { \"type\" : "
          "\"com.sun.star.util.Color\", \"value\" : 0 }, \"InnerLineWidth\" : { \"type\" : "
          "\"short\", \"value\" : 0 }, \"OuterLineWidth\" : { \"type\" : \"short\", \"value\" : 1 "
          "}, \"LineDistance\" : { \"type\" : \"short\", \"value\" : 0 },  \"LineStyle\" : { "
          "\"type\" : \"short\", \"value\" : 0 }, \"LineWidth\" : { \"type\" : \"unsigned long\", "
          "\"value\" : 1 } } },"
          "{ \"type\" : \"com.sun.star.table.BorderLine2\", \"value\" : { \"Color\" : { \"type\" : "
          "\"com.sun.star.util.Color\", \"value\" : 0 }, \"InnerLineWidth\" : { \"type\" : "
          "\"short\", \"value\" : 0 }, \"OuterLineWidth\" : { \"type\" : \"short\", \"value\" : 1 "
          "}, \"LineDistance\" : { \"type\" : \"short\", \"value\" : 0 },  \"LineStyle\" : { "
          "\"type\" : \"short\", \"value\" : 0 }, \"LineWidth\" : { \"type\" : \"unsigned long\", "
          "\"value\" : 1 } } },"
          "{ \"type\" : \"com.sun.star.table.BorderLine2\", \"value\" : { \"Color\" : { \"type\" : "
          "\"com.sun.star.util.Color\", \"value\" : 0 }, \"InnerLineWidth\" : { \"type\" : "
          "\"short\", \"value\" : 0 }, \"OuterLineWidth\" : { \"type\" : \"short\", \"value\" : 1 "
          "}, \"LineDistance\" : { \"type\" : \"short\", \"value\" : 0 },  \"LineStyle\" : { "
          "\"type\" : \"short\", \"value\" : 0 }, \"LineWidth\" : { \"type\" : \"unsigned long\", "
          "\"value\" : 1 } } },"
          "{ \"type\" : \"com.sun.star.table.BorderLine2\", \"value\" : { \"Color\" : { \"type\" : "
          "\"com.sun.star.util.Color\", \"value\" : 0 }, \"InnerLineWidth\" : { \"type\" : "
          "\"short\", \"value\" : 0 }, \"OuterLineWidth\" : { \"type\" : \"short\", \"value\" : 1 "
          "}, \"LineDistance\" : { \"type\" : \"short\", \"value\" : 0 },  \"LineStyle\" : { "
          "\"type\" : \"short\", \"value\" : 0 }, \"LineWidth\" : { \"type\" : \"unsigned long\", "
          "\"value\" : 1 } } },"
          "{ \"type\" : \"long\", \"value\" : 0 },"
          "{ \"type\" : \"long\", \"value\" : 0 },"
          "{ \"type\" : \"long\", \"value\" : 0 },"
          "{ \"type\" : \"long\", \"value\" : 0 },"
          "{ \"type\" : \"long\", \"value\" : 0 }"
          "]"
          "},"
          "\"InnerBorder\":{"
          "\"type\" : \"[]any\","
          "\"value\" : ["
          "{ \"type\" : \"com.sun.star.table.BorderLine2\", \"value\" : { \"Color\" : { \"type\" : "
          "\"com.sun.star.util.Color\", \"value\" : 0 }, \"InnerLineWidth\" : { \"type\" : "
          "\"short\", \"value\" : 0 }, \"OuterLineWidth\" : { \"type\" : \"short\", \"value\" : 1 "
          "}, \"LineDistance\" : { \"type\" : \"short\", \"value\" : 0 },  \"LineStyle\" : { "
          "\"type\" : \"short\", \"value\" : 0 }, \"LineWidth\" : { \"type\" : \"unsigned long\", "
          "\"value\" : 1 } } },"
          "{ \"type\" : \"com.sun.star.table.BorderLine2\", \"value\" : { \"Color\" : { \"type\" : "
          "\"com.sun.star.util.Color\", \"value\" : 0 }, \"InnerLineWidth\" : { \"type\" : "
          "\"short\", \"value\" : 0 }, \"OuterLineWidth\" : { \"type\" : \"short\", \"value\" : 1 "
          "}, \"LineDistance\" : { \"type\" : \"short\", \"value\" : 0 },  \"LineStyle\" : { "
          "\"type\" : \"short\", \"value\" : 0 }, \"LineWidth\" : { \"type\" : \"unsigned long\", "
          "\"value\" : 1 } } },"
          "{ \"type\" : \"short\", \"value\" : 0 },"
          "{ \"type\" : \"short\", \"value\" : 127 },"
          "{ \"type\" : \"long\", \"value\" : 0 }"
          "]"
          "}}";

    // see SvxBoxItem::QueryValue for details
    table::BorderLine2 aLine(sal_Int32(COL_BLACK), 0, 1, 0, table::BorderLineStyle::SOLID, 1);
    cpo::uno::Sequence<cpo::uno::Any> aOuterSeq{ cpo::uno::Any(aLine), // left
                                                 cpo::uno::Any(aLine), // right
                                                 cpo::uno::Any(aLine), // bottom
                                                 cpo::uno::Any(aLine), // top
                                                 cpo::uno::Any(static_cast<sal_Int32>(0)),
                                                 cpo::uno::Any(static_cast<sal_Int32>(0)),
                                                 cpo::uno::Any(static_cast<sal_Int32>(0)),
                                                 cpo::uno::Any(static_cast<sal_Int32>(0)),
                                                 cpo::uno::Any(static_cast<sal_Int32>(0)) };

    // see SvxBoxInfoItem::QueryValue() for details
    cpo::uno::Sequence<cpo::uno::Any> aInnerSeq{ cpo::uno::Any(aLine), // horizontal
                                                 cpo::uno::Any(aLine), // vertical
                                                 cpo::uno::Any(static_cast<sal_Int16>(0)),
                                                 cpo::uno::Any(static_cast<sal_Int16>(0x7F)),
                                                 cpo::uno::Any(static_cast<sal_Int32>(0)) };

    cpo::uno::Sequence aArgs{ comphelper::makePropertyValue(u"OuterBorder"_ustr, aOuterSeq),
                              comphelper::makePropertyValue(u"InnerBorder"_ustr, aInnerSeq) };

    assertSequencesEqual(
        aArgs, comphelper::containerToSequence(desktop::jsonToPropertyValuesVector(arguments)));
}

void KitInitTest::testPdfSourceSaveFilterData()
{
    // A .uno:Save of a PDF opened into Draw (the PDF canvas) exports with
    // its form fields, images kept at full resolution and lossless, and its
    // comments. PDFExport's own defaults flatten the fields, downsample
    // images to 300 DPI and re-encode them as JPEG on every save.
    comphelper::SequenceAsHashMap aCanvas;
    CPPUNIT_ASSERT(desktop::setPdfSourceSaveFilterData(u"draw_pdf_import", aCanvas));
    CPPUNIT_ASSERT_EQUAL(size_t(5), aCanvas.size());
    CPPUNIT_ASSERT(aCanvas.getUnpackedValueOrDefault(u"ExportFormFields"_ustr, false));
    CPPUNIT_ASSERT(!aCanvas.getUnpackedValueOrDefault(u"ReduceImageResolution"_ustr, true));
    CPPUNIT_ASSERT(aCanvas.getUnpackedValueOrDefault(u"UseLosslessCompression"_ustr, false));
    CPPUNIT_ASSERT(aCanvas.getUnpackedValueOrDefault(u"ExportNotes"_ustr, false));
    // Hidden-ink OCR lines go out as invisible (render mode 3) text.
    CPPUNIT_ASSERT(aCanvas.getUnpackedValueOrDefault(u"ExportInvisibleText"_ustr, false));

    // A value the caller already chose wins; only missing keys are added.
    comphelper::SequenceAsHashMap aExplicit;
    aExplicit[u"ExportFormFields"_ustr] <<= false;
    aExplicit[u"UseLosslessCompression"_ustr] <<= false;
    aExplicit[u"Quality"_ustr] <<= sal_Int32(75);
    CPPUNIT_ASSERT(desktop::setPdfSourceSaveFilterData(u"draw_pdf_import", aExplicit));
    CPPUNIT_ASSERT_EQUAL(size_t(6), aExplicit.size());
    CPPUNIT_ASSERT(!aExplicit.getUnpackedValueOrDefault(u"ExportFormFields"_ustr, true));
    CPPUNIT_ASSERT(!aExplicit.getUnpackedValueOrDefault(u"UseLosslessCompression"_ustr, true));
    CPPUNIT_ASSERT_EQUAL(sal_Int32(75),
                         aExplicit.getUnpackedValueOrDefault(u"Quality"_ustr, sal_Int32(0)));
    CPPUNIT_ASSERT(!aExplicit.getUnpackedValueOrDefault(u"ReduceImageResolution"_ustr, true));
    CPPUNIT_ASSERT(aExplicit.getUnpackedValueOrDefault(u"ExportNotes"_ustr, false));

    // Any other document keeps the PDF export defaults: a hybrid PDF opened
    // into Writer, Calc or Impress, a native drawing, an unknown filter.
    static constexpr std::u16string_view aOtherFilters[]
        = { u"writer_pdf_addstream_import", u"calc_pdf_addstream_import",
            u"impress_pdf_addstream_import", u"draw8", u"" };
    for (std::u16string_view aFilter : aOtherFilters)
    {
        comphelper::SequenceAsHashMap aOther;
        CPPUNIT_ASSERT(!desktop::setPdfSourceSaveFilterData(aFilter, aOther));
        CPPUNIT_ASSERT(aOther.empty());
    }
}

CPPUNIT_TEST_SUITE_REGISTRATION(KitInitTest);

CPPUNIT_PLUGIN_IMPLEMENT();

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
