/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/*
 * This file is part of the Collabora Office project.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

#include "sdmodeltestbase.hxx"

#include <COKit/COKitEnums.h>

#include <com/sun/star/animations/XAnimationNodeSupplier.hpp>
#include <com/sun/star/beans/XPropertySet.hpp>
#include <com/sun/star/frame/Desktop.hpp>
#include <com/sun/star/uno/Reference.hxx>
#include <com/sun/star/drawing/LineStyle.hpp>
#include <com/sun/star/drawing/FillStyle.hpp>
#include <com/sun/star/drawing/XDrawView.hpp>
#include <com/sun/star/drawing/XDrawPage.hpp>
#include <com/sun/star/drawing/XMasterPageTarget.hpp>
#include <com/sun/star/style/ParagraphAdjust.hpp>
#include <com/sun/star/table/XMergeableCell.hpp>
#include <com/sun/star/text/WritingMode2.hpp>
#include <com/sun/star/view/XSelectionSupplier.hpp>

#include <comphelper/propertysequence.hxx>
#include <editeng/adjustitem.hxx>
#include <editeng/editobj.hxx>
#include <editeng/editview.hxx>
#include <editeng/eeitem.hxx>
#include <editeng/flditem.hxx>
#include <editeng/outliner.hxx>
#include <sfx2/dispatch.hxx>
#include <sfx2/request.hxx>
#include <sfx2/viewfrm.hxx>
#include <svl/intitem.hxx>
#include <svl/srchitem.hxx>
#include <svx/svxids.hrc>
#include <svx/sdtagitm.hxx>
#include <svx/sdtmfitm.hxx>
#include <svx/svdoashp.hxx>
#include <svx/svdorect.hxx>
#include <svx/svdhdl.hxx>
#include <svx/svddrgmt.hxx>
#include <svx/svdotable.hxx>
#include <svx/xlineit0.hxx>
#include <svx/xfillit0.hxx>
#include <svx/xflclit.hxx>
#include <svx/xlnclit.hxx>
#include <editeng/colritem.hxx>
#include <svx/xflgrit.hxx>
#include <svx/xlndsit.hxx>
#include <SlideSorterViewShell.hxx>
#include <SlideSorter.hxx>
#include <controller/SlsClipboard.hxx>
#include <controller/SlideSorterController.hxx>
#include <controller/SlsPageSelector.hxx>
#include <svl/stritem.hxx>
#include <undo/undomanager.hxx>
#include <vcl/scheduler.hxx>
#include <docmodel/uno/UnoComplexColor.hxx>
#include <comphelper/propertyvalue.hxx>
#include <comphelper/sequenceashashmap.hxx>
#include <comphelper/kit.hxx>
#include <comphelper/scopeguard.hxx>
#include <docmodel/uno/UnoTheme.hxx>
#include <docmodel/theme/Theme.hxx>
#include <docmodel/color/ComplexColorJSON.hxx>

#include <drawdoc.hxx>
#include <DrawDocShell.hxx>
#include <ViewShell.hxx>
#include <DrawViewShell.hxx>
#include <app.hrc>
#include <sdpage.hxx>
#include <unomodel.hxx>
#include <osl/thread.hxx>
#include <slideshow.hxx>
#include <sdresid.hxx>
#include <strings.hrc>
#include <unopage.hxx>
#include <editeng/outlobj.hxx>
#include <sdmod.hxx>
#include <svx/svdotext.hxx>
#include <svx/svdogrp.hxx>
#include <svx/svdopath.hxx>
#include <comphelper/base64.hxx>
#include <boost/property_tree/json_parser.hpp>
#include <boost/property_tree/ptree.hpp>
#include <sstream>
#include <svx/svdograf.hxx>
#include <svx/svdouno.hxx>
#include <com/sun/star/form/FormComponentType.hpp>
#include <com/sun/star/frame/XStorable.hpp>
#include <unotools/tempfile.hxx>
#include <vcl/filter/PDFiumLibrary.hxx>
#include <vcl/gfxlink.hxx>
#include <vcl/graphicfilter.hxx>
#include <tools/stream.hxx>
#include <vcl/pdf/PDFAnnotationSubType.hxx>
#include <vcl/pdf/PDFFormFieldType.hxx>
#include <functional>
#include <map>
#include <string_view>
#include <svx/svdpagv.hxx>
#include <svx/svdmark.hxx>
#include <svx/vulcanprovenance.hxx>
#include <VulcanHiddenInk.hxx>
#include <View.hxx>
#include <editeng/editobj.hxx>
#include <editeng/outliner.hxx>
#include <vcl/BitmapReadAccess.hxx>
#include <vcl/BitmapWriteAccess.hxx>
#include <vcl/pdf/PDFTextRenderMode.hxx>
#include <vcl/pdf/PDFPageObjectType.hxx>
#include <editeng/udlnitem.hxx>
#include <sfx2/kit/helper.hxx>
#include <svx/sdrhittesthelper.hxx>
#include <basegfx/vector/b2dvector.hxx>
#include <Window.hxx>

using namespace ::com::sun::star;

/// Impress UI tests.
class SdUiImpressTest : public SdModelTestBase
{
public:
    SdUiImpressTest()
        : SdModelTestBase(u"/sd/qa/unit/data/"_ustr)
    {
    }

    void checkCurrentPageNumber(sal_uInt16 nNum);
    void insertStringToObject(sal_uInt16 nObj, std::u16string_view rStr, bool bUseEscape);
    sd::slidesorter::SlideSorterViewShell*
    getSlideSorterViewShell(const css::uno::Reference<css::lang::XComponent>& xComp = nullptr);
    void lcl_search(const OUString& rKey, bool bFindAll = false, bool bBackwards = false);
};

void SdUiImpressTest::checkCurrentPageNumber(sal_uInt16 nNum)
{
    uno::Reference<frame::XModel> xModel(mxComponent, uno::UNO_QUERY);
    uno::Reference<drawing::XDrawView> xDrawView(xModel->getCurrentController(), uno::UNO_QUERY);
    uno::Reference<drawing::XDrawPage> xPage(xDrawView->getCurrentPage(), uno::UNO_SET_THROW);
    uno::Reference<beans::XPropertySet> xPropertySet(xPage, uno::UNO_QUERY);

    sal_uInt16 nPageNumber;
    xPropertySet->getPropertyValue(u"Number"_ustr) >>= nPageNumber;
    CPPUNIT_ASSERT_EQUAL(nNum, nPageNumber);
}

void SdUiImpressTest::insertStringToObject(sal_uInt16 nObj, std::u16string_view rStr,
                                           bool bUseEscape)
{
    auto pImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pImpressDocument->GetDocShell()->GetViewShell();
    SdPage* pPage = pViewShell->GetActualPage();
    SdrObject* pShape = pPage->GetObj(nObj);
    CPPUNIT_ASSERT_MESSAGE("No Shape", pShape);
    SdrView* pView = pViewShell->GetView();
    pView->MarkObj(pShape, pView->GetSdrPageView());
    Scheduler::ProcessEventsToIdle();

    CPPUNIT_ASSERT(!pView->IsTextEdit());

    typeString(pImpressDocument, rStr);

    CPPUNIT_ASSERT(pView->IsTextEdit());

    if (bUseEscape)
    {
        typeKey(pImpressDocument, KEY_ESCAPE);
        CPPUNIT_ASSERT(!pView->IsTextEdit());
    }
}

sd::slidesorter::SlideSorterViewShell*
SdUiImpressTest::getSlideSorterViewShell(const css::uno::Reference<css::lang::XComponent>& xComp)
{
    auto pXImpressDocument
        = dynamic_cast<SdXImpressDocument*>(xComp.is() ? xComp.get() : mxComponent.get());
    sd::ViewShell* pViewShell = pXImpressDocument->GetDocShell()->GetViewShell();
    sd::slidesorter::SlideSorterViewShell* pSSVS = nullptr;
    // Same as in sd/qa/unit/misc-tests.cxx
    for (int i = 0; i < 1000; i++)
    {
        // Process all Tasks - slide sorter is created here
        Scheduler::ProcessEventsToIdle();
        if ((pSSVS = sd::slidesorter::SlideSorterViewShell::GetSlideSorter(
                 pViewShell->GetViewShellBase()))
            != nullptr)
            break;
        osl::Thread::wait(std::chrono::milliseconds(100));
    }
    CPPUNIT_ASSERT(pSSVS);
    return pSSVS;
}

void SdUiImpressTest::lcl_search(const OUString& rKey, bool bFindAll, bool bBackwards)
{
    Scheduler::ProcessEventsToIdle();
    SvxSearchCmd eSearch = bFindAll ? SvxSearchCmd::FIND_ALL : SvxSearchCmd::FIND;

    cpo::uno::Sequence<beans::PropertyValue> aPropertyValues(comphelper::InitPropertySequence({
        { "SearchItem.SearchString", cpo::uno::Any(rKey) },
        { "SearchItem.Backward", cpo::uno::Any(bBackwards) },
        { "SearchItem.Command", cpo::uno::Any(sal_uInt16(eSearch)) },
    }));

    dispatchCommand(mxComponent, u".uno:ExecuteSearch"_ustr, aPropertyValues);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testDocumentStructureTransformExtractSlide)
{
    createSdImpressDoc("odp/tdf161430.odp");

    static constexpr OUString aJson = uR"json(
{
    "Transforms": {
        "SlideCommands": [
            {"JumpToSlideByName": "Slide 3"},
            {"MoveSlide": 0},
            {"RenameSlide": "Slide3-Renamed"},
            {"DeleteSlide": 2},
            {"JumpToSlide": 2},
            {"DeleteSlide": ""},
            {"JumpToSlide": 1},
            {"DuplicateSlide": ""},
            {"RenameSlide": "Slide1-Duplicated"},
            {"InsertMasterSlide": 1},
            {"RenameSlide": "SlideInserted-1"},
            {"ChangeLayout": 18},
            {"JumpToSlide": "last"},
            {"InsertMasterSlideByName": "Topic Separator white"},
            {"RenameSlide": "SlideInserted-Name"},
            {"ChangeLayoutByName": "AUTOLAYOUT_TITLE_2CONTENT"},
            {"SetText.0": "first"},
            {"SetText.1": "second"},
            {"SetText.2": "third"},
            {"DuplicateSlide": 1},
            {"MoveSlide.2": 6}
        ]
    }
}
)json"_ustr;

    //transform
    cpo::uno::Sequence<css::beans::PropertyValue> aArgs = {
        comphelper::makePropertyValue(u"DataJson"_ustr, aJson),
    };
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr, aArgs);

    //extract
    tools::JsonWriter aJsonWriter;
    std::string_view aCommand(".uno:ExtractDocumentStructure?filter=slides");
    auto pXPresDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    pXPresDocument->getCommandValues(aJsonWriter, aCommand);

    OString aExpectedStr
        = "{ \"DocStructure\": { \"SlideCount\": 7, \"MasterSlideCount\": 8, \"MasterSlides\": { "
          "\"MasterSlide 0\": { \"Name\": \"Topic_Separator_Purple\"}, \"MasterSlide 1\": { "
          "\"Name\": \"Content_sidebar_White\"}, \"MasterSlide 2\": { \"Name\": \"Topic Separator "
          "white\"}, \"MasterSlide 3\": { \"Name\": \"Content_sidebar_White_\"}, \"MasterSlide "
          "4\": { \"Name\": \"Topic_Separator_Purple_\"}, \"MasterSlide 5\": { \"Name\": "
          "\"Content_White_Purple_Sidebar\"}, \"MasterSlide 6\": { \"Name\": \"Default 1\"}, "
          "\"MasterSlide 7\": { \"Name\": \"Default 1_\"}}, \"Slides\": { \"Slide 0\": { "
          "\"SlideName\": \"Slide3-Renamed\", \"MasterSlideName\": "
          "\"Content_White_Purple_Sidebar\", \"LayoutId\": 3, \"LayoutName\": "
          "\"AUTOLAYOUT_TITLE_2CONTENT\", \"ObjectCount\": 4, \"Objects\": { \"Objects 0\": { "
          "\"TextCount\": 1, \"Texts\": { \"Text 0\": { \"ParaCount\": 1, \"Paragraphs\": [ "
          "\"Friendly Open Source Project\"]}}}, \"Objects 1\": { }, \"Objects 2\": { "
          "\"TextCount\": 1, \"Texts\": { \"Text 0\": { \"ParaCount\": 9, \"Paragraphs\": [ \"Real "
          "Open Source\", \"100% open-source code\", \"Built with LibreOffice technology\", "
          "\"Built with Free Software technology stacks: primarily C++\", \"Runs best on Linux\", "
          "\"Open Development\", \"Anyone can contribute & participate\", \"Follow commits and "
          "tickets\", \"Public community calls - forum has details\"]}}}, \"Objects 3\": { "
          "\"TextCount\": 1, \"Texts\": { \"Text 0\": { \"ParaCount\": 5, \"Paragraphs\": [ "
          "\"Focus:\", \"a non-renewable resource.\", \"Office Productivity & Documents\", "
          "\"Excited about migrating your\\u0001documents\", \"Grateful to our partners for "
          "solving\\u0001other problems.\"]}}}}}, \"Slide 1\": { \"SlideName\": \"Slide 2\", "
          "\"MasterSlideName\": \"Topic_Separator_Purple\", \"LayoutId\": 3, \"LayoutName\": "
          "\"AUTOLAYOUT_TITLE_2CONTENT\", \"ObjectCount\": 1, \"Objects\": { \"Objects 0\": { "
          "\"TextCount\": 1, \"Texts\": { \"Text 0\": { \"ParaCount\": 3, \"Paragraphs\": [ "
          "\"Collabora Online\", \"\", \"Powerful Online Collaboration\"]}}}}}, \"Slide 2\": { "
          "\"SlideName\": \"Slide1-Duplicated\", \"MasterSlideName\": \"Topic_Separator_Purple\", "
          "\"LayoutId\": 3, \"LayoutName\": \"AUTOLAYOUT_TITLE_2CONTENT\", \"ObjectCount\": 1, "
          "\"Objects\": { \"Objects 0\": { \"TextCount\": 1, \"Texts\": { \"Text 0\": { "
          "\"ParaCount\": 3, \"Paragraphs\": [ \"Collabora Online\", \"\", \"Powerful Online "
          "Collaboration\"]}}}}}, \"Slide 3\": { \"SlideName\": \"SlideInserted-1\", "
          "\"MasterSlideName\": \"Content_sidebar_White\", \"LayoutId\": 18, \"LayoutName\": "
          "\"AUTOLAYOUT_TITLE_4CONTENT\", \"ObjectCount\": 5, \"Objects\": { \"Objects 0\": { "
          "\"TextCount\": 1, \"Texts\": { \"Text 0\": { \"ParaCount\": 1, \"Paragraphs\": [ "
          "\"Click to add Title\"]}}}, \"Objects 1\": { \"TextCount\": 1, \"Texts\": { \"Text 0\": "
          "{ \"ParaCount\": 1, \"Paragraphs\": [ \"Click to add Text\"]}}}, \"Objects 2\": { "
          "\"TextCount\": 1, \"Texts\": { \"Text 0\": { \"ParaCount\": 1, \"Paragraphs\": [ "
          "\"Click to add Text\"]}}}, \"Objects 3\": { \"TextCount\": 1, \"Texts\": { \"Text 0\": "
          "{ \"ParaCount\": 1, \"Paragraphs\": [ \"Click to add Text\"]}}}, \"Objects 4\": { "
          "\"TextCount\": 1, \"Texts\": { \"Text 0\": { \"ParaCount\": 1, \"Paragraphs\": [ "
          "\"Click to add Text\"]}}}}}, \"Slide 4\": { \"SlideName\": \"Slide 5\", "
          "\"MasterSlideName\": \"Topic_Separator_Purple\", \"LayoutId\": 3, \"LayoutName\": "
          "\"AUTOLAYOUT_TITLE_2CONTENT\", \"ObjectCount\": 1, \"Objects\": { \"Objects 0\": { "
          "\"TextCount\": 1, \"Texts\": { \"Text 0\": { \"ParaCount\": 1, \"Paragraphs\": [ \"With "
          "thanks to our Partners, Customers & Community !\"]}}}}}, \"Slide 5\": { \"SlideName\": "
          "\"SlideInserted-Name\", \"MasterSlideName\": \"Topic Separator white\", \"LayoutId\": "
          "3, \"LayoutName\": \"AUTOLAYOUT_TITLE_2CONTENT\", \"ObjectCount\": 3, \"Objects\": { "
          "\"Objects 0\": { \"TextCount\": 1, \"Texts\": { \"Text 0\": { \"ParaCount\": 1, "
          "\"Paragraphs\": [ \"first\"]}}}, \"Objects 1\": { \"TextCount\": 1, \"Texts\": { \"Text "
          "0\": { \"ParaCount\": 1, \"Paragraphs\": [ \"second\"]}}}, \"Objects 2\": { "
          "\"TextCount\": 1, \"Texts\": { \"Text 0\": { \"ParaCount\": 1, \"Paragraphs\": [ "
          "\"third\"]}}}}}, \"Slide 6\": { \"SlideName\": \"Slide 7\", \"MasterSlideName\": "
          "\"Topic_Separator_Purple\", \"LayoutId\": 3, \"LayoutName\": "
          "\"AUTOLAYOUT_TITLE_2CONTENT\", \"ObjectCount\": 1, \"Objects\": { \"Objects 0\": { "
          "\"TextCount\": 1, \"Texts\": { \"Text 0\": { \"ParaCount\": 3, \"Paragraphs\": [ "
          "\"Collabora Online\", \"\", \"Powerful Online Collaboration\"]}}}}}}}}"_ostr;

    CPPUNIT_ASSERT_EQUAL(aExpectedStr, aJsonWriter.finishAndGetAsOString());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testDocumentStructureExtractSlideText)
{
    // The text filter returns the slide text as markdown, read from the live
    // document so that text still being typed is included.
    createSdImpressDoc();

    // Type into the title placeholder and keep the edit session open: the
    // typed text lives only in the editing outliner at this point.
    insertStringToObject(0, u"Typed while editing", /*bUseEscape*/ false);

    auto pImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    {
        tools::JsonWriter aJsonWriter;
        pImpressDocument->getCommandValues(aJsonWriter,
                                           ".uno:ExtractDocumentStructure?filter=text");
        const OString aJson = aJsonWriter.finishAndGetAsOString();

        CPPUNIT_ASSERT(aJson.indexOf("\"BodyText\"") >= 0);
        CPPUNIT_ASSERT(aJson.indexOf("\"format\": \"markdown\"") >= 0);
        CPPUNIT_ASSERT(aJson.indexOf("\"truncated\": false") >= 0);
        // The body has one markdown section per slide.
        CPPUNIT_ASSERT(aJson.indexOf("## Slide 1: ") >= 0);
        // The open edit session's text is included.
        CPPUNIT_ASSERT(aJson.indexOf("Typed while editing") >= 0);
        // The untouched content placeholder shows only its prompt text, which
        // is not document content.
        CPPUNIT_ASSERT(aJson.indexOf("Click to add") < 0);
    }

    // The committed text is still returned once the edit session is closed.
    typeKey(pImpressDocument, KEY_ESCAPE);
    {
        tools::JsonWriter aJsonWriter;
        pImpressDocument->getCommandValues(aJsonWriter,
                                           ".uno:ExtractDocumentStructure?filter=text");
        const OString aJson = aJsonWriter.finishAndGetAsOString();

        CPPUNIT_ASSERT(aJson.indexOf("Typed while editing") >= 0);
        CPPUNIT_ASSERT(aJson.indexOf("Click to add") < 0);
    }
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testDocumentStructureExtractSlideTextInGroups)
{
    // a built PDF page puts nearly all of its text inside groups,
    // and compose_archetype groups the boxes it inserts. read_slide and
    // find_replace's read-back use this text filter.
    createSdImpressDoc();

    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });

    auto xDesktop = frame::Desktop::create(comphelper::getProcessComponentContext());
    auto pImpressDocument = static_cast<SdXImpressDocument*>(mxComponent.get());
    auto pFrame = pImpressDocument->GetDocShell()->GetFrame();
    CPPUNIT_ASSERT(pFrame);
    xDesktop->setActiveFrame(pFrame->GetFrame().GetFrameInterface());

    SdPage* pPage = pImpressDocument->GetDoc()->GetSdPage(0, PageKind::Standard);
    const size_t nObjCountBefore = pPage->GetObjCount();

    auto* pDrawViewShell
        = dynamic_cast<sd::DrawViewShell*>(pImpressDocument->GetDocShell()->GetViewShell());
    CPPUNIT_ASSERT(pDrawViewShell);

    // Three boxes: the first two grouped as a card, and the card grouped
    // again with the third, so the card's text sits two levels down.
    static constexpr OUString aJson = uR"json(
{
    "Transforms": {
        "SlideCommands": [
            {"InsertTextBox.0": "2000,2000|Grouped heading"},
            {"InsertTextBox.0": "2000,4000|Grouped intro sentence"},
            {"InsertTextBox.0": "2000,8000|Caption beside the card"},
            {"JumpToSlide": "0"},
            {"UnmarkAll": ""},
            {"MarkCreated": "0,1"},
            {"UnoCommand": ".uno:FormatGroup"},
            {"UnmarkAll": ""},
            {"MarkCreated": "0,2"},
            {"UnoCommand": ".uno:FormatGroup"},
            {"UnmarkAll": ""}
        ]
    }
}
)json"_ustr;

    SfxRequest aRequest(*pDrawViewShell->GetViewFrame(), FN_TRANSFORM_DOCUMENT_STRUCTURE);
    aRequest.AppendItem(SfxStringItem(FN_PARAM_1, aJson));
    pDrawViewShell->ExecuteSlot(aRequest);

    CPPUNIT_ASSERT_EQUAL(nObjCountBefore + 1, pPage->GetObjCount());
    SdrObject* pTop = pPage->GetObj(nObjCountBefore);
    CPPUNIT_ASSERT(pTop->IsGroupObject());
    CPPUNIT_ASSERT_EQUAL(size_t(2), pTop->GetSubList()->GetObjCount());
    CPPUNIT_ASSERT(pTop->GetSubList()->GetObj(0)->IsGroupObject());

    tools::JsonWriter aJsonWriter;
    pImpressDocument->getCommandValues(aJsonWriter, ".uno:ExtractDocumentStructure?filter=text");
    const OString aText = aJsonWriter.finishAndGetAsOString();

    CPPUNIT_ASSERT(aText.indexOf("Grouped heading") >= 0);
    CPPUNIT_ASSERT(aText.indexOf("Grouped intro sentence") >= 0);
    CPPUNIT_ASSERT(aText.indexOf("Caption beside the card") >= 0);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testDocumentStructureUnoCommand)
{
    // 1. Create a document;
    // 2. Check that its first slide has two objects (the default title + content placeholders);
    // 3. Perform a "TransformDocumentStructure" with a "UnoCommand" calling ".uno:SelectAll" and
    //    ".uno:Cut";
    // 4. Check that the first slide has no objects now.

    createSdImpressDoc();

    // Let comphelper::dispatchCommand (in KitHelper::dispatchUnoCommand) find the frame
    auto xDesktop = frame::Desktop::create(comphelper::getProcessComponentContext());
    auto pImpressDocument = static_cast<SdXImpressDocument*>(mxComponent.get());
    auto pFrame = pImpressDocument->GetDocShell()->GetFrame();
    CPPUNIT_ASSERT(pFrame);
    xDesktop->setActiveFrame(pFrame->GetFrame().GetFrameInterface());

    CPPUNIT_ASSERT_EQUAL(sal_Int32(2),
                         pImpressDocument->getSdDrawPages()->getDrawPageByIndex(0)->getCount());

    static constexpr OUString aJson = uR"json(
{
    "UnoCommand": {
        "name": ".uno:SelectAll"
    },
    "UnoCommand": {
        "name": ".uno:Cut"
    }
}
)json"_ustr;

    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    { comphelper::makePropertyValue(u"DataJson"_ustr, aJson) });

    CPPUNIT_ASSERT_EQUAL(sal_Int32(0),
                         pImpressDocument->getSdDrawPages()->getDrawPageByIndex(0)->getCount());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testDocumentStructureArrangeGeometry)
{
    // The arrange-verb contract: geometry extracted with geometry=1 is in
    // the margin-inclusive 1/100 mm frame the in-document
    // '.uno:TransformDialog' dispatch expects (read -> write -> read is an
    // identity even with nonzero page borders), an UnmarkAll command
    // isolates a batch from the session's live selection, and AlignOnPage
    // is accepted by the kit uno-command allowlist.

    createSdImpressDoc();

    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });

    // Let comphelper::dispatchCommand find the frame.
    auto xDesktop = frame::Desktop::create(comphelper::getProcessComponentContext());
    auto pImpressDocument = static_cast<SdXImpressDocument*>(mxComponent.get());
    auto pFrame = pImpressDocument->GetDocShell()->GetFrame();
    CPPUNIT_ASSERT(pFrame);
    xDesktop->setActiveFrame(pFrame->GetFrame().GetFrameInterface());

    SdPage* pPage = pImpressDocument->GetDoc()->GetSdPage(0, PageKind::Standard);
    CPPUNIT_ASSERT(pPage->GetObjCount() >= 2);
    pPage->SetBorder(1000, 800, 1100, 900);

    SdrObject* pObject0 = pPage->GetObj(0);
    SdrObject* pObject1 = pPage->GetObj(1);
    const tools::Rectangle aRect0 = pObject0->GetLogicRect();
    const tools::Rectangle aRect1 = pObject1->GetLogicRect();

    // The extract reports positions shifted by the page borders.
    const sal_Int64 nExtractedX = aRect0.Left() + pPage->GetLeftBorder();
    const sal_Int64 nExtractedY = aRect0.Top() + pPage->GetUpperBorder();
    {
        tools::JsonWriter aJsonWriter;
        pImpressDocument->getCommandValues(
            aJsonWriter, ".uno:ExtractDocumentStructure?filter=slides&geometry=1");
        const OString aJson = aJsonWriter.finishAndGetAsOString();
        CPPUNIT_ASSERT(aJson.indexOf(Concat2View("\"PosX\": " + OString::number(nExtractedX))) >= 0);
        CPPUNIT_ASSERT(aJson.indexOf(Concat2View("\"PosY\": " + OString::number(nExtractedY))) >= 0);
        CPPUNIT_ASSERT(aJson.indexOf(Concat2View("\"Width\": " + OString::number(aRect0.GetWidth()))) >= 0);
        CPPUNIT_ASSERT(aJson.indexOf("\"RotateAngle\": 0") >= 0);
    }

    // Contaminate the selection the way a live user would.
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    { comphelper::makePropertyValue(
                        u"DataJson"_ustr,
                        u"{ \"Transforms\": { \"SlideCommands\": ["
                        u"{\"JumpToSlide\": 0}, {\"MarkObject\": 1}]}}"_ustr) });

    // Write back the extracted position plus a delta, through the batch a
    // Vulcan_SetShapeGeometry verb produces.
    const OUString aMoveJson
        = u"{ \"Transforms\": { \"SlideCommands\": ["
          u"{\"JumpToSlide\": 0},"
          u"{\"UnmarkAll\": true},"
          u"{\"MarkObject\": 0},"
          u"{\"UnoCommand\": \".uno:TransformDialog {"
          u"\\\"TransformPosX\\\":{\\\"type\\\":\\\"long\\\",\\\"value\\\":"
          + OUString::number(nExtractedX + 700)
          + u"},"
            u"\\\"TransformPosY\\\":{\\\"type\\\":\\\"long\\\",\\\"value\\\":"
          + OUString::number(nExtractedY + 400) + u"}}\"}]}}";
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    { comphelper::makePropertyValue(u"DataJson"_ustr, aMoveJson) });

    // Identity: the model moved by exactly the delta (no unit conversion,
    // no margin-frame mismatch)...
    CPPUNIT_ASSERT_EQUAL(aRect0.Left() + 700, pObject0->GetLogicRect().Left());
    CPPUNIT_ASSERT_EQUAL(aRect0.Top() + 400, pObject0->GetLogicRect().Top());
    // ...and the contaminating selection did not ride along.
    CPPUNIT_ASSERT_EQUAL(aRect1, pObject1->GetLogicRect());

    // AlignOnPage is on the kit allowlist: aligning both objects makes them
    // concentric (a rejected command would leave the centers apart).
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    { comphelper::makePropertyValue(
                        u"DataJson"_ustr,
                        u"{ \"Transforms\": { \"SlideCommands\": ["
                        u"{\"JumpToSlide\": 0}, {\"UnmarkAll\": true},"
                        u"{\"MarkObject\": 0}, {\"MarkObject\": 1},"
                        u"{\"UnoCommand\": \".uno:AlignOnPage\"}]}}"_ustr) });
    CPPUNIT_ASSERT(pObject0->GetLogicRect().Center()
                   == pObject1->GetLogicRect().Center());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testUnmarkAllEndsTextEdit)
{
    // The browser's owned press gesture re-aims the selection with an
    // UnmarkAll + MarkObject batch while the caret may be in another box
    // ("type here, grab that"). UnmarkAll must end the live text edit
    // first — the way a click away does — or the edit keeps running on an
    // object the batch just unmarked, a state no user gesture can reach.
    createSdImpressDoc();

    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });

    // Let comphelper::dispatchCommand find the frame.
    auto xDesktop = frame::Desktop::create(comphelper::getProcessComponentContext());
    auto pImpressDocument = static_cast<SdXImpressDocument*>(mxComponent.get());
    auto pFrame = pImpressDocument->GetDocShell()->GetFrame();
    CPPUNIT_ASSERT(pFrame);
    xDesktop->setActiveFrame(pFrame->GetFrame().GetFrameInterface());

    SdPage* pPage = pImpressDocument->GetDoc()->GetSdPage(0, PageKind::Standard);
    CPPUNIT_ASSERT(pPage->GetObjCount() >= 2);
    SdrObject* pObject0 = pPage->GetObj(0);
    SdrObject* pObject1 = pPage->GetObj(1);

    sd::ViewShell* pViewShell = pImpressDocument->GetDocShell()->GetViewShell();
    CPPUNIT_ASSERT(pViewShell);
    SdrView* pView = pViewShell->GetView();
    CPPUNIT_ASSERT(pView);

    // The caret is in the first box.
    pView->UnmarkAll();
    pView->MarkObj(pObject0, pView->GetSdrPageView());
    pView->SdrBeginTextEdit(pObject0);
    CPPUNIT_ASSERT(pView->IsTextEdit());

    // The gesture's press-time batch: select the OTHER object by ordinal.
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    { comphelper::makePropertyValue(
                        u"DataJson"_ustr,
                        u"{ \"Transforms\": { \"SlideCommands\": ["
                        u"{\"JumpToSlide\": 0}, {\"UnmarkAll\": true},"
                        u"{\"MarkObject\": 1}]}}"_ustr) });

    // The edit ended and exactly the other object is marked.
    CPPUNIT_ASSERT(!pView->IsTextEdit());
    const SdrMarkList& rMarkList = pView->GetMarkedObjectList();
    CPPUNIT_ASSERT_EQUAL(size_t(1), rMarkList.GetMarkCount());
    CPPUNIT_ASSERT(pObject1 == rMarkList.GetMark(0)->GetMarkedSdrObj());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testGroupMembersInPayloadAndMarkObjectPath)
{
    // A group's payload primitives are written member by member under
    // "objectChild" nodes (ordinal within the group), and MarkObjectPath
    // marks a member by "<page ordinal>/<member ordinal>" — what the
    // browser's owned press inside an entered group needs to echo and to
    // select one member.
    createSdImpressDoc();

    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });

    auto xDesktop = frame::Desktop::create(comphelper::getProcessComponentContext());
    auto pImpressDocument = static_cast<SdXImpressDocument*>(mxComponent.get());
    auto pFrame = pImpressDocument->GetDocShell()->GetFrame();
    CPPUNIT_ASSERT(pFrame);
    xDesktop->setActiveFrame(pFrame->GetFrame().GetFrameInterface());

    SdPage* pPage = pImpressDocument->GetDoc()->GetSdPage(0, PageKind::Standard);
    CPPUNIT_ASSERT(pPage->GetObjCount() >= 2);

    // Group the first two objects.
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    { comphelper::makePropertyValue(
                        u"DataJson"_ustr,
                        u"{ \"Transforms\": { \"SlideCommands\": ["
                        u"{\"JumpToSlide\": 0}, {\"UnmarkAll\": true},"
                        u"{\"MarkObject\": 0}, {\"MarkObject\": 1},"
                        u"{\"UnoCommand\": \".uno:FormatGroup\"}]}}"_ustr) });

    SdrObjGroup* pGroup = nullptr;
    size_t nGroupOrd = 0;
    for (size_t i = 0; i < pPage->GetObjCount() && !pGroup; ++i)
    {
        pGroup = dynamic_cast<SdrObjGroup*>(pPage->GetObj(i));
        nGroupOrd = i;
    }
    CPPUNIT_ASSERT(pGroup);
    CPPUNIT_ASSERT_EQUAL(size_t(2), pGroup->GetSubList()->GetObjCount());

    // The payload carries the members under objectChild nodes.
    {
        tools::JsonWriter aJsonWriter;
        pImpressDocument->getCommandValues(aJsonWriter, ".uno:VectorPrimitives");
        const OString aJson = aJsonWriter.finishAndGetAsOString();
        CPPUNIT_ASSERT(aJson.indexOf("\"objectChild\"") >= 0);
    }

    // Inside the group, MarkObjectPath marks exactly the second member.
    sd::ViewShell* pViewShell = pImpressDocument->GetDocShell()->GetViewShell();
    CPPUNIT_ASSERT(pViewShell);
    SdrView* pView = pViewShell->GetView();
    CPPUNIT_ASSERT(pView);
    pView->UnmarkAll();
    CPPUNIT_ASSERT(pView->GetSdrPageView()->EnterGroup(pGroup));
    const OUString aMarkJson = u"{ \"Transforms\": { \"SlideCommands\": ["
                               u"{\"JumpToSlide\": 0}, {\"UnmarkAll\": true},"
                               u"{\"MarkObjectPath\": \""
                               + OUString::number(static_cast<sal_Int32>(nGroupOrd)) + u"/1\"}]}}";
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    { comphelper::makePropertyValue(u"DataJson"_ustr, aMarkJson) });
    const SdrMarkList& rMarkList = pView->GetMarkedObjectList();
    CPPUNIT_ASSERT_EQUAL(size_t(1), rMarkList.GetMarkCount());
    CPPUNIT_ASSERT(pGroup->GetSubList()->GetObj(1) == rMarkList.GetMark(0)->GetMarkedSdrObj());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testInsertTextBoxTransform)
{
    // The InsertTextBox contract (Slide Studio W1): value
    // "<x>,<y>[,<width>]|<text>" in the margin-inclusive 1/100 mm frame; a
    // width-less box hugs its text on both axes, a width-ful box keeps the
    // width and settles its height, \n makes paragraphs, the created
    // ordinals come back in the result JSON, and ONE undo removes the whole
    // batch.
    createSdImpressDoc();

    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });

    // Let comphelper::dispatchCommand find the frame.
    auto xDesktop = frame::Desktop::create(comphelper::getProcessComponentContext());
    auto pImpressDocument = static_cast<SdXImpressDocument*>(mxComponent.get());
    auto pFrame = pImpressDocument->GetDocShell()->GetFrame();
    CPPUNIT_ASSERT(pFrame);
    xDesktop->setActiveFrame(pFrame->GetFrame().GetFrameInterface());

    SdPage* pPage = pImpressDocument->GetDoc()->GetSdPage(0, PageKind::Standard);
    pPage->SetBorder(1000, 800, 1100, 900);
    const size_t nObjCountBefore = pPage->GetObjCount();

    auto* pDrawViewShell
        = dynamic_cast<sd::DrawViewShell*>(pImpressDocument->GetDocShell()->GetViewShell());
    CPPUNIT_ASSERT(pDrawViewShell);

    static constexpr OUString aJson = uR"json(
{
    "Transforms": {
        "SlideCommands": [
            {"InsertTextBox.0": "4000,3000|Hugging box"},
            {"InsertTextBox.0": "9000,5000,6000|Wrapped box\nSecond paragraph"}
        ]
    }
}
)json"_ustr;

    SfxRequest aRequest(*pDrawViewShell->GetViewFrame(), FN_TRANSFORM_DOCUMENT_STRUCTURE);
    aRequest.AppendItem(SfxStringItem(FN_PARAM_1, aJson));
    pDrawViewShell->ExecuteSlot(aRequest);

    // The batch reports the created objects as slide + ordinal.
    const auto* pResult
        = dynamic_cast<const SfxStringItem*>(aRequest.GetReturnValue().getItem());
    CPPUNIT_ASSERT(pResult);
    const OUString aResult = pResult->GetValue();
    CPPUNIT_ASSERT(aResult.indexOf(u"\"createdObjects\"") >= 0);
    CPPUNIT_ASSERT(aResult.indexOf(u"\"slide\": 0") >= 0);
    CPPUNIT_ASSERT(
        aResult.indexOf(Concat2View(u"\"ordNum\": " + OUString::number(sal_Int64(nObjCountBefore)))) >= 0);
    CPPUNIT_ASSERT(
        aResult.indexOf(Concat2View(u"\"ordNum\": " + OUString::number(sal_Int64(nObjCountBefore + 1)))) >= 0);

    CPPUNIT_ASSERT_EQUAL(nObjCountBefore + 2, pPage->GetObjCount());
    SdrTextObj* pBoxA = DynCastSdrTextObj(pPage->GetObj(nObjCountBefore));
    SdrTextObj* pBoxB = DynCastSdrTextObj(pPage->GetObj(nObjCountBefore + 1));
    CPPUNIT_ASSERT(pBoxA);
    CPPUNIT_ASSERT(pBoxB);

    // The page borders were subtracted on the way into the model...
    CPPUNIT_ASSERT_EQUAL(tools::Long(3000), pBoxA->GetLogicRect().Left());
    CPPUNIT_ASSERT_EQUAL(tools::Long(2200), pBoxA->GetLogicRect().Top());
    CPPUNIT_ASSERT_EQUAL(tools::Long(8000), pBoxB->GetLogicRect().Left());
    CPPUNIT_ASSERT_EQUAL(tools::Long(4200), pBoxB->GetLogicRect().Top());
    // ...the explicit width sticks...
    CPPUNIT_ASSERT_EQUAL(tools::Long(6000), pBoxB->GetLogicRect().GetWidth());
    // ...\n made two paragraphs...
    CPPUNIT_ASSERT_EQUAL(
        sal_Int32(2), pBoxB->GetOutlinerParaObject()->GetTextObject().GetParagraphCount());
    // ...and the resize modes track the content: auto width only where no
    // width was given, auto height everywhere, zero min-size floors.
    CPPUNIT_ASSERT(pBoxA->GetMergedItem(SDRATTR_TEXT_AUTOGROWWIDTH).GetValue());
    CPPUNIT_ASSERT(!pBoxB->GetMergedItem(SDRATTR_TEXT_AUTOGROWWIDTH).GetValue());
    CPPUNIT_ASSERT(pBoxA->GetMergedItem(SDRATTR_TEXT_AUTOGROWHEIGHT).GetValue());
    CPPUNIT_ASSERT(pBoxB->GetMergedItem(SDRATTR_TEXT_AUTOGROWHEIGHT).GetValue());
    CPPUNIT_ASSERT_EQUAL(sal_Int32(0),
                         pBoxA->GetMergedItem(SDRATTR_TEXT_MINFRAMEWIDTH).GetValue());
    CPPUNIT_ASSERT_EQUAL(sal_Int32(0),
                         pBoxA->GetMergedItem(SDRATTR_TEXT_MINFRAMEHEIGHT).GetValue());
    CPPUNIT_ASSERT_EQUAL(sal_Int32(0),
                         pBoxB->GetMergedItem(SDRATTR_TEXT_MINFRAMEWIDTH).GetValue());
    CPPUNIT_ASSERT_EQUAL(sal_Int32(0),
                         pBoxB->GetMergedItem(SDRATTR_TEXT_MINFRAMEHEIGHT).GetValue());

    // The geometry extract reports the boxes back in the border-inclusive
    // frame (read -> insert -> read is an identity) and the snug box owns
    // its fit.
    {
        tools::JsonWriter aJsonWriter;
        pImpressDocument->getCommandValues(
            aJsonWriter, ".uno:ExtractDocumentStructure?filter=slides&geometry=1&fit=1");
        const OString aExtract = aJsonWriter.finishAndGetAsOString();
        CPPUNIT_ASSERT(aExtract.indexOf("\"PosX\": 4000") >= 0);
        CPPUNIT_ASSERT(aExtract.indexOf("\"PosY\": 3000") >= 0);
        CPPUNIT_ASSERT(aExtract.indexOf("\"FitsText\": true") >= 0);
        CPPUNIT_ASSERT(aExtract.indexOf("\"PageWidth\":") >= 0);
        CPPUNIT_ASSERT(aExtract.indexOf("\"BorderLeft\": 1000") >= 0);
    }

    // One undo removes everything the batch created.
    dispatchCommand(mxComponent, u".uno:Undo"_ustr, {});
    CPPUNIT_ASSERT_EQUAL(nObjCountBefore, pPage->GetObjCount());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testInsertShapeTransform)
{
    // The InsertShape contract (Slide Studio asset library): value
    // "<kind>,<x>,<y>,<w>,<h>,<fill>,<line>[,<textColor>][|<text>]" in the
    // margin-inclusive 1/100 mm frame; the drawn size is authoritative (no
    // autogrow), given text rides centered inside the shape, invalid
    // commands warn without aborting the batch, and ONE undo removes it
    // all.
    createSdImpressDoc();

    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });

    // Let comphelper::dispatchCommand find the frame.
    auto xDesktop = frame::Desktop::create(comphelper::getProcessComponentContext());
    auto pImpressDocument = static_cast<SdXImpressDocument*>(mxComponent.get());
    auto pFrame = pImpressDocument->GetDocShell()->GetFrame();
    CPPUNIT_ASSERT(pFrame);
    xDesktop->setActiveFrame(pFrame->GetFrame().GetFrameInterface());

    SdPage* pPage = pImpressDocument->GetDoc()->GetSdPage(0, PageKind::Standard);
    pPage->SetBorder(1000, 800, 1100, 900);
    const size_t nObjCountBefore = pPage->GetObjCount();

    auto* pDrawViewShell
        = dynamic_cast<sd::DrawViewShell*>(pImpressDocument->GetDocShell()->GetViewShell());
    CPPUNIT_ASSERT(pDrawViewShell);

    // A filled numbered bubble with white text, two invalid commands (bad
    // kind, zero width) in the middle, and a line-only rounded card after
    // them: the invalid ones must warn without stopping the batch.
    static constexpr OUString aJson = uR"json(
{
    "Transforms": {
        "SlideCommands": [
            {"InsertShape.0": "ellipse,4000,3000,5000,5000,cc0000,none,ffffff|1"},
            {"InsertShape.0": "hexagon,4000,3000,5000,5000,cc0000,none"},
            {"InsertShape.0": "rect,4000,3000,0,5000,cc0000,none"},
            {"InsertShape.0": "rounded,12000,9000,6000,3000,none,0055aa"}
        ]
    }
}
)json"_ustr;

    SfxRequest aRequest(*pDrawViewShell->GetViewFrame(), FN_TRANSFORM_DOCUMENT_STRUCTURE);
    aRequest.AppendItem(SfxStringItem(FN_PARAM_1, aJson));
    pDrawViewShell->ExecuteSlot(aRequest);

    // Both valid shapes are reported; the invalid siblings only warned.
    const auto* pResult
        = dynamic_cast<const SfxStringItem*>(aRequest.GetReturnValue().getItem());
    CPPUNIT_ASSERT(pResult);
    const OUString aResult = pResult->GetValue();
    CPPUNIT_ASSERT(aResult.indexOf(u"\"createdObjects\"") >= 0);
    CPPUNIT_ASSERT(
        aResult.indexOf(Concat2View(u"\"ordNum\": " + OUString::number(sal_Int64(nObjCountBefore)))) >= 0);
    CPPUNIT_ASSERT(
        aResult.indexOf(Concat2View(u"\"ordNum\": " + OUString::number(sal_Int64(nObjCountBefore + 1)))) >= 0);
    CPPUNIT_ASSERT(aResult.indexOf(u"unknown kind") >= 0);
    CPPUNIT_ASSERT(aResult.indexOf(u"must be positive") >= 0);

    CPPUNIT_ASSERT_EQUAL(nObjCountBefore + 2, pPage->GetObjCount());
    SdrObject* pBubble = pPage->GetObj(nObjCountBefore);
    SdrObject* pCard = pPage->GetObj(nObjCountBefore + 1);
    CPPUNIT_ASSERT_EQUAL(SdrObjKind::CircleOrEllipse, pBubble->GetObjIdentifier());
    CPPUNIT_ASSERT_EQUAL(SdrObjKind::Rectangle, pCard->GetObjIdentifier());

    // Border math on the way in, size EXACTLY as given - no autogrow
    // drift, even though the bubble carries text.
    CPPUNIT_ASSERT_EQUAL(tools::Long(3000), pBubble->GetLogicRect().Left());
    CPPUNIT_ASSERT_EQUAL(tools::Long(2200), pBubble->GetLogicRect().Top());
    CPPUNIT_ASSERT_EQUAL(tools::Long(5000), pBubble->GetLogicRect().GetWidth());
    CPPUNIT_ASSERT_EQUAL(tools::Long(5000), pBubble->GetLogicRect().GetHeight());
    CPPUNIT_ASSERT_EQUAL(tools::Long(11000), pCard->GetLogicRect().Left());
    CPPUNIT_ASSERT_EQUAL(tools::Long(8200), pCard->GetLogicRect().Top());
    CPPUNIT_ASSERT_EQUAL(tools::Long(6000), pCard->GetLogicRect().GetWidth());
    CPPUNIT_ASSERT_EQUAL(tools::Long(3000), pCard->GetLogicRect().GetHeight());
    CPPUNIT_ASSERT(!pBubble->GetMergedItem(SDRATTR_TEXT_AUTOGROWWIDTH).GetValue());
    CPPUNIT_ASSERT(!pBubble->GetMergedItem(SDRATTR_TEXT_AUTOGROWHEIGHT).GetValue());

    // Styling: solid fill + white text on the bubble; line-only card with
    // a proportional corner radius (min(w,h)/8).
    CPPUNIT_ASSERT_EQUAL(drawing::FillStyle_SOLID,
                         pBubble->GetMergedItem(XATTR_FILLSTYLE).GetValue());
    CPPUNIT_ASSERT_EQUAL(Color(0xcc0000),
                         pBubble->GetMergedItem(XATTR_FILLCOLOR).GetColorValue());
    CPPUNIT_ASSERT_EQUAL(drawing::LineStyle_NONE,
                         pBubble->GetMergedItem(XATTR_LINESTYLE).GetValue());
    CPPUNIT_ASSERT_EQUAL(Color(0xffffff),
                         pBubble->GetMergedItem(EE_CHAR_COLOR).GetValue());
    CPPUNIT_ASSERT_EQUAL(drawing::FillStyle_NONE,
                         pCard->GetMergedItem(XATTR_FILLSTYLE).GetValue());
    CPPUNIT_ASSERT_EQUAL(drawing::LineStyle_SOLID,
                         pCard->GetMergedItem(XATTR_LINESTYLE).GetValue());
    CPPUNIT_ASSERT_EQUAL(Color(0x0055aa),
                         pCard->GetMergedItem(XATTR_LINECOLOR).GetColorValue());
    CPPUNIT_ASSERT_EQUAL(sal_Int32(375),
                         pCard->GetMergedItem(SDRATTR_CORNER_RADIUS).GetValue());

    // The geometry extract reports the same margin-inclusive frame and the
    // untouched sizes, and the bubble's text made it into the deck info.
    {
        tools::JsonWriter aJsonWriter;
        pImpressDocument->getCommandValues(
            aJsonWriter, ".uno:ExtractDocumentStructure?filter=slides&geometry=1");
        const OString aExtract = aJsonWriter.finishAndGetAsOString();
        CPPUNIT_ASSERT(aExtract.indexOf("\"PosX\": 4000") >= 0);
        CPPUNIT_ASSERT(aExtract.indexOf("\"PosX\": 12000") >= 0);
        CPPUNIT_ASSERT(aExtract.indexOf("\"Width\": 5000") >= 0);
        CPPUNIT_ASSERT(aExtract.indexOf("\"Height\": 3000") >= 0);
        CPPUNIT_ASSERT(aExtract.indexOf("\"Paragraphs\": [ \"1\"]") >= 0);
    }

    // One undo removes both shapes.
    dispatchCommand(mxComponent, u".uno:Undo"_ustr, {});
    CPPUNIT_ASSERT_EQUAL(nObjCountBefore, pPage->GetObjCount());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testInsertStyleTokens)
{
    // The optional trailing style tokens of the insert grammar - "s<pt>"
    // font size, "b" bold, "c<6hex>" text color - style the whole
    // object's text (the library's titles, kickers and muted labels).
    createSdImpressDoc();

    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });

    auto xDesktop = frame::Desktop::create(comphelper::getProcessComponentContext());
    auto pImpressDocument = static_cast<SdXImpressDocument*>(mxComponent.get());
    auto pFrame = pImpressDocument->GetDocShell()->GetFrame();
    CPPUNIT_ASSERT(pFrame);
    xDesktop->setActiveFrame(pFrame->GetFrame().GetFrameInterface());

    SdPage* pPage = pImpressDocument->GetDoc()->GetSdPage(0, PageKind::Standard);
    const size_t nObjCountBefore = pPage->GetObjCount();

    auto* pDrawViewShell
        = dynamic_cast<sd::DrawViewShell*>(pImpressDocument->GetDocShell()->GetViewShell());
    CPPUNIT_ASSERT(pDrawViewShell);

    // A bold 28pt accent title, and a bubble whose positional textColor
    // combines with size + bold tokens. A bad style token only warns.
    static constexpr OUString aJson = uR"json(
{
    "Transforms": {
        "SlideCommands": [
            {"InsertTextBox.0": "2000,2000,20000,s28,b,c1f4e79|Working title"},
            {"InsertShape.0": "ellipse,4000,8000,2000,2000,1f4e79,none,ffffff,s16,b|1"},
            {"InsertTextBox.0": "2000,6000,s0|nope"}
        ]
    }
}
)json"_ustr;

    SfxRequest aRequest(*pDrawViewShell->GetViewFrame(), FN_TRANSFORM_DOCUMENT_STRUCTURE);
    aRequest.AppendItem(SfxStringItem(FN_PARAM_1, aJson));
    pDrawViewShell->ExecuteSlot(aRequest);

    const auto* pResult
        = dynamic_cast<const SfxStringItem*>(aRequest.GetReturnValue().getItem());
    CPPUNIT_ASSERT(pResult);
    CPPUNIT_ASSERT(pResult->GetValue().indexOf(u"invalid geometry") >= 0);

    CPPUNIT_ASSERT_EQUAL(nObjCountBefore + 2, pPage->GetObjCount());
    SdrObject* pTitle = pPage->GetObj(nObjCountBefore);
    SdrObject* pBubble = pPage->GetObj(nObjCountBefore + 1);

    // 28pt and 16pt in the drawing pool's 1/100 mm metric (pt * 2540/72).
    CPPUNIT_ASSERT_EQUAL(
        sal_uInt32(28 * 2540 / 72),
        pTitle->GetMergedItem(EE_CHAR_FONTHEIGHT).GetHeight());
    CPPUNIT_ASSERT_EQUAL(WEIGHT_BOLD,
                         pTitle->GetMergedItem(EE_CHAR_WEIGHT).GetWeight());
    CPPUNIT_ASSERT_EQUAL(Color(0x1f4e79),
                         pTitle->GetMergedItem(EE_CHAR_COLOR).GetValue());
    CPPUNIT_ASSERT_EQUAL(
        sal_uInt32(16 * 2540 / 72),
        pBubble->GetMergedItem(EE_CHAR_FONTHEIGHT).GetHeight());
    CPPUNIT_ASSERT_EQUAL(WEIGHT_BOLD,
                         pBubble->GetMergedItem(EE_CHAR_WEIGHT).GetWeight());
    CPPUNIT_ASSERT_EQUAL(Color(0xffffff),
                         pBubble->GetMergedItem(EE_CHAR_COLOR).GetValue());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testFillApiStructureUndo)
{
    // The structural SlideCommands used to mutate the model without undo
    // actions (acks carried undoReliable:false). Each batch now records
    // proper actions in its list entry: one .uno:Undo reverts one batch.
    createSdImpressDoc();

    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });

    auto xDesktop = frame::Desktop::create(comphelper::getProcessComponentContext());
    auto pImpressDocument = static_cast<SdXImpressDocument*>(mxComponent.get());
    auto pFrame = pImpressDocument->GetDocShell()->GetFrame();
    CPPUNIT_ASSERT(pFrame);
    xDesktop->setActiveFrame(pFrame->GetFrame().GetFrameInterface());

    auto* pDrawViewShell
        = dynamic_cast<sd::DrawViewShell*>(pImpressDocument->GetDocShell()->GetViewShell());
    CPPUNIT_ASSERT(pDrawViewShell);

    SdDrawDocument* pDoc = pImpressDocument->GetDoc();
    const sal_uInt16 nPagesBefore = pDoc->GetSdPageCount(PageKind::Standard);

    auto runBatch = [&](const OUString& rJson) {
        SfxRequest aRequest(*pDrawViewShell->GetViewFrame(), FN_TRANSFORM_DOCUMENT_STRUCTURE);
        aRequest.AppendItem(SfxStringItem(FN_PARAM_1, rJson));
        pDrawViewShell->ExecuteSlot(aRequest);
    };
    auto undo = [&]() { dispatchCommand(mxComponent, u".uno:Undo"_ustr, {}); };

    // DuplicateSlide: one undo removes the copy (standard + notes pages).
    runBatch(uR"({"Transforms": {"SlideCommands": [{"DuplicateSlide": ""}]}})"_ustr);
    CPPUNIT_ASSERT_EQUAL(sal_uInt16(nPagesBefore + 1), pDoc->GetSdPageCount(PageKind::Standard));
    undo();
    CPPUNIT_ASSERT_EQUAL(nPagesBefore, pDoc->GetSdPageCount(PageKind::Standard));

    // RenameSlide: one undo restores the old name.
    const OUString aOldName = pDoc->GetSdPage(0, PageKind::Standard)->GetName();
    runBatch(
        uR"({"Transforms": {"SlideCommands": [{"JumpToSlide": "0"}, {"RenameSlide": "Batch Renamed"}]}})"_ustr);
    CPPUNIT_ASSERT_EQUAL(u"Batch Renamed"_ustr,
                         pDoc->GetSdPage(0, PageKind::Standard)->GetName());
    undo();
    CPPUNIT_ASSERT_EQUAL(aOldName, pDoc->GetSdPage(0, PageKind::Standard)->GetName());

    // SetText: one undo restores the old text of the addressed object.
    SdPage* pPage = pDoc->GetSdPage(0, PageKind::Standard);
    const size_t nObjCountBefore = pPage->GetObjCount();
    runBatch(
        uR"({"Transforms": {"SlideCommands": [{"InsertTextBox.0": "2000,2000,12000|before text"}]}})"_ustr);
    CPPUNIT_ASSERT_EQUAL(nObjCountBefore + 1, pPage->GetObjCount());
    auto* pBox = static_cast<SdrTextObj*>(pPage->GetObj(nObjCountBefore));
    const OUString aSetTextCmd
        = u"{\"Transforms\": {\"SlideCommands\": [{\"JumpToSlide\": \"0\"}, {\"SetText."_ustr
          + OUString::number(sal_Int64(nObjCountBefore)) + u"\": \"after text\"}]}}"_ustr;
    runBatch(aSetTextCmd);
    CPPUNIT_ASSERT_EQUAL(u"after text"_ustr,
                         pBox->GetOutlinerParaObject()->GetTextObject().GetText(0));
    undo();
    CPPUNIT_ASSERT_EQUAL(u"before text"_ustr,
                         pBox->GetOutlinerParaObject()->GetTextObject().GetText(0));

    // MoveSlide + DeleteSlide, on a two-slide deck with distinct names.
    runBatch(uR"({"Transforms": {"SlideCommands": [{"DuplicateSlide": ""}]}})"_ustr);
    pDoc->GetSdPage(0, PageKind::Standard)->SetName(u"First"_ustr);
    pDoc->GetSdPage(1, PageKind::Standard)->SetName(u"Second"_ustr);

    runBatch(uR"({"Transforms": {"SlideCommands": [{"MoveSlide.0": "1"}]}})"_ustr);
    CPPUNIT_ASSERT_EQUAL(u"Second"_ustr, pDoc->GetSdPage(0, PageKind::Standard)->GetName());
    undo();
    CPPUNIT_ASSERT_EQUAL(u"First"_ustr, pDoc->GetSdPage(0, PageKind::Standard)->GetName());

    runBatch(uR"({"Transforms": {"SlideCommands": [{"DeleteSlide": "1"}]}})"_ustr);
    CPPUNIT_ASSERT_EQUAL(nPagesBefore, pDoc->GetSdPageCount(PageKind::Standard));
    undo();
    CPPUNIT_ASSERT_EQUAL(sal_uInt16(nPagesBefore + 1), pDoc->GetSdPageCount(PageKind::Standard));
    CPPUNIT_ASSERT_EQUAL(u"Second"_ustr, pDoc->GetSdPage(1, PageKind::Standard)->GetName());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testMarkCreatedGroupsInOneBatch)
{
    // MarkCreated marks objects created earlier in the SAME batch by
    // creation index (identity-based, so ordNum shifts from an earlier
    // FormatGroup in the batch cannot skew later groupings), letting a
    // library scaffold insert AND group atomically: one batch, ONE undo.
    createSdImpressDoc();

    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });

    auto xDesktop = frame::Desktop::create(comphelper::getProcessComponentContext());
    auto pImpressDocument = static_cast<SdXImpressDocument*>(mxComponent.get());
    auto pFrame = pImpressDocument->GetDocShell()->GetFrame();
    CPPUNIT_ASSERT(pFrame);
    xDesktop->setActiveFrame(pFrame->GetFrame().GetFrameInterface());

    SdPage* pPage = pImpressDocument->GetDoc()->GetSdPage(0, PageKind::Standard);
    const size_t nObjCountBefore = pPage->GetObjCount();

    auto* pDrawViewShell
        = dynamic_cast<sd::DrawViewShell*>(pImpressDocument->GetDocShell()->GetViewShell());
    CPPUNIT_ASSERT(pDrawViewShell);

    // Four shapes, grouped [0,1] and [2,3]. The second MarkCreated runs
    // after the first FormatGroup already renumbered the page; an out of
    // range index only warns.
    static constexpr OUString aJson = uR"json(
{
    "Transforms": {
        "SlideCommands": [
            {"InsertShape.0": "rect,2000,2000,3000,2000,cc0000,none"},
            {"InsertShape.0": "ellipse,6000,2000,2000,2000,00cc00,none"},
            {"InsertShape.0": "rect,2000,6000,3000,2000,0000cc,none"},
            {"InsertShape.0": "ellipse,6000,6000,2000,2000,cccc00,none"},
            {"JumpToSlide": "0"},
            {"UnmarkAll": ""},
            {"MarkCreated": "0,1"},
            {"UnoCommand": ".uno:FormatGroup"},
            {"UnmarkAll": ""},
            {"MarkCreated": "2,3"},
            {"UnoCommand": ".uno:FormatGroup"},
            {"UnmarkAll": ""},
            {"MarkCreated": "9"},
            {"UnmarkAll": ""},
            {"MarkCreated": "0,2"},
            {"UnoCommand": ".uno:FormatGroup"},
            {"UnmarkAll": ""}
        ]
    }
}
)json"_ustr;

    SfxRequest aRequest(*pDrawViewShell->GetViewFrame(), FN_TRANSFORM_DOCUMENT_STRUCTURE);
    aRequest.AppendItem(SfxStringItem(FN_PARAM_1, aJson));
    pDrawViewShell->ExecuteSlot(aRequest);

    const auto* pResult
        = dynamic_cast<const SfxStringItem*>(aRequest.GetReturnValue().getItem());
    CPPUNIT_ASSERT(pResult);
    CPPUNIT_ASSERT(pResult->GetValue().indexOf(u"index out of range") >= 0);

    // LAYERED: MarkCreated resolves each leaf to its TOP-LEVEL container,
    // so the final MarkCreated "0,2" marked the two card-groups and the
    // second FormatGroup nested them - one top group holding two groups
    // of two.
    CPPUNIT_ASSERT_EQUAL(nObjCountBefore + 1, pPage->GetObjCount());
    SdrObject* pTop = pPage->GetObj(nObjCountBefore);
    CPPUNIT_ASSERT(pTop->IsGroupObject());
    CPPUNIT_ASSERT_EQUAL(size_t(2), pTop->GetSubList()->GetObjCount());
    SdrObject* pFirst = pTop->GetSubList()->GetObj(0);
    SdrObject* pSecond = pTop->GetSubList()->GetObj(1);
    CPPUNIT_ASSERT(pFirst->IsGroupObject());
    CPPUNIT_ASSERT(pSecond->IsGroupObject());
    CPPUNIT_ASSERT_EQUAL(size_t(2), pFirst->GetSubList()->GetObjCount());
    CPPUNIT_ASSERT_EQUAL(size_t(2), pSecond->GetSubList()->GetObjCount());

    // The whole scaffold - inserts and both groupings - is ONE undo.
    dispatchCommand(mxComponent, u".uno:Undo"_ustr, {});
    CPPUNIT_ASSERT_EQUAL(nObjCountBefore, pPage->GetObjCount());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testResizeModeToggles)
{
    // .uno:ToggleAutoWidth / .uno:ToggleAutoHeight flip the marked text
    // object's autogrow attribute per axis; turning a mode ON zeroes the
    // matching min-frame floor so the box can shrink to its content, and
    // undo restores the attributes.
    createSdImpressDoc();

    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });

    auto xDesktop = frame::Desktop::create(comphelper::getProcessComponentContext());
    auto pImpressDocument = static_cast<SdXImpressDocument*>(mxComponent.get());
    auto pFrame = pImpressDocument->GetDocShell()->GetFrame();
    CPPUNIT_ASSERT(pFrame);
    xDesktop->setActiveFrame(pFrame->GetFrame().GetFrameInterface());

    SdPage* pPage = pImpressDocument->GetDoc()->GetSdPage(0, PageKind::Standard);
    pPage->SetBorder(1000, 800, 1100, 900);
    const size_t nObjCountBefore = pPage->GetObjCount();

    // A wide fixed-width box via the batch verb: auto width starts off.
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    { comphelper::makePropertyValue(
                        u"DataJson"_ustr,
                        u"{ \"Transforms\": { \"SlideCommands\": ["
                        u"{\"InsertTextBox.0\": \"3000,3000,8000|Hi\"}]}}"_ustr) });
    CPPUNIT_ASSERT_EQUAL(nObjCountBefore + 1, pPage->GetObjCount());
    SdrTextObj* pBox = DynCastSdrTextObj(pPage->GetObj(nObjCountBefore));
    CPPUNIT_ASSERT(pBox);
    CPPUNIT_ASSERT(!pBox->GetMergedItem(SDRATTR_TEXT_AUTOGROWWIDTH).GetValue());
    const tools::Long nWideWidth = pBox->GetLogicRect().GetWidth();
    CPPUNIT_ASSERT_EQUAL(tools::Long(8000), nWideWidth);

    // Simulate the legacy min-size remnant the toggle must clear.
    pBox->SetMergedItem(makeSdrTextMinFrameWidthItem(4000));

    sd::ViewShell* pViewShell = pImpressDocument->GetDocShell()->GetViewShell();
    SdrView* pView = pViewShell->GetView();
    pView->MarkObj(pBox, pView->GetSdrPageView());

    // ON: attribute flips, floor zeroed, the box snaps to its text.
    dispatchCommand(mxComponent, u".uno:ToggleAutoWidth"_ustr, {});
    CPPUNIT_ASSERT(pBox->GetMergedItem(SDRATTR_TEXT_AUTOGROWWIDTH).GetValue());
    CPPUNIT_ASSERT_EQUAL(sal_Int32(0),
                         pBox->GetMergedItem(SDRATTR_TEXT_MINFRAMEWIDTH).GetValue());
    CPPUNIT_ASSERT(pBox->GetLogicRect().GetWidth() < nWideWidth);

    // OFF again: only the attribute flips back.
    dispatchCommand(mxComponent, u".uno:ToggleAutoWidth"_ustr, {});
    CPPUNIT_ASSERT(!pBox->GetMergedItem(SDRATTR_TEXT_AUTOGROWWIDTH).GetValue());

    // The height axis toggles the same way...
    CPPUNIT_ASSERT(pBox->GetMergedItem(SDRATTR_TEXT_AUTOGROWHEIGHT).GetValue());
    dispatchCommand(mxComponent, u".uno:ToggleAutoHeight"_ustr, {});
    CPPUNIT_ASSERT(!pBox->GetMergedItem(SDRATTR_TEXT_AUTOGROWHEIGHT).GetValue());

    // ...and one undo restores it.
    dispatchCommand(mxComponent, u".uno:Undo"_ustr, {});
    CPPUNIT_ASSERT(pBox->GetMergedItem(SDRATTR_TEXT_AUTOGROWHEIGHT).GetValue());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testDecomposePdfPages)
{
    // A PDF opens as ONE protected graphic per page. The payload and the
    // geometry read both flag it, and the FillApi DecomposePdfPages verb
    // turns every page into editable objects - without an undo entry and
    // without marking the document modified: opening a PDF to edit it is
    // not itself an edit.
    createSdDrawDoc("pdf/multipage.pdf");

    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });

    auto xDesktop = frame::Desktop::create(comphelper::getProcessComponentContext());
    auto pImpressDocument = static_cast<SdXImpressDocument*>(mxComponent.get());
    auto pFrame = pImpressDocument->GetDocShell()->GetFrame();
    CPPUNIT_ASSERT(pFrame);
    xDesktop->setActiveFrame(pFrame->GetFrame().GetFrameInterface());

    SdDrawDocument* pDoc = pImpressDocument->GetDoc();
    CPPUNIT_ASSERT(pDoc->IsPDFDocument());
    const sal_uInt16 nPageCount = pDoc->GetSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT(nPageCount >= 2);
    for (sal_uInt16 nPage = 0; nPage < nPageCount; ++nPage)
    {
        SdPage* pPage = pDoc->GetSdPage(nPage, PageKind::Standard);
        CPPUNIT_ASSERT_EQUAL(size_t(1), pPage->GetObjCount());
        CPPUNIT_ASSERT(pPage->GetPdfPageGraphic());
        CPPUNIT_ASSERT(pPage->GetObj(0) == pPage->GetPdfPageGraphic());
    }

    // Both reads flag the undecomposed page graphic.
    {
        tools::JsonWriter aJsonWriter;
        pImpressDocument->getCommandValues(aJsonWriter, ".uno:VectorPrimitives?part=0");
        const OString aPayload = aJsonWriter.finishAndGetAsOString();
        CPPUNIT_ASSERT(aPayload.indexOf("\"pdfPage\": true") >= 0);
    }
    {
        tools::JsonWriter aJsonWriter;
        pImpressDocument->getCommandValues(
            aJsonWriter, ".uno:ExtractDocumentStructure?filter=slides&geometry=1");
        const OString aExtract = aJsonWriter.finishAndGetAsOString();
        CPPUNIT_ASSERT(aExtract.indexOf("\"PdfPage\": true") >= 0);
    }

    // Loading is not an edit either: the precondition the verb preserves.
    CPPUNIT_ASSERT(!pDoc->IsChanged());
    sd::UndoManager* pUndoManager = pDoc->GetUndoManager();
    const size_t nUndoBefore = pUndoManager ? pUndoManager->GetUndoActionCount() : 0;

    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    { comphelper::makePropertyValue(
                        u"DataJson"_ustr,
                        u"{ \"Transforms\": { \"SlideCommands\": ["
                        u"{\"DecomposePdfPages\": true}]}}"_ustr) });

    for (sal_uInt16 nPage = 0; nPage < nPageCount; ++nPage)
    {
        SdPage* pPage = pDoc->GetSdPage(nPage, PageKind::Standard);
        // The protected graphic is gone; the page holds drawing-level
        // objects (the fixture's pages carry text).
        CPPUNIT_ASSERT(!pPage->GetPdfPageGraphic());
        CPPUNIT_ASSERT(pPage->GetObjCount() >= 1);
        for (size_t nObj = 0; nObj < pPage->GetObjCount(); ++nObj)
            CPPUNIT_ASSERT(!pPage->GetObj(nObj)->IsMoveProtect());
    }

    // Not an edit: nothing to undo, nothing to save.
    CPPUNIT_ASSERT(!pDoc->IsChanged());
    CPPUNIT_ASSERT(!pImpressDocument->GetDocShell()->IsModified());
    if (pUndoManager)
        CPPUNIT_ASSERT_EQUAL(nUndoBefore, pUndoManager->GetUndoActionCount());

    // The flags are gone from both reads, and a second run is a no-op.
    {
        tools::JsonWriter aJsonWriter;
        pImpressDocument->getCommandValues(
            aJsonWriter, ".uno:ExtractDocumentStructure?filter=slides&geometry=1");
        CPPUNIT_ASSERT(aJsonWriter.finishAndGetAsOString().indexOf("\"PdfPage\"") < 0);
    }
    const size_t nObjectsAfter = pDoc->GetSdPage(0, PageKind::Standard)->GetObjCount();
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    { comphelper::makePropertyValue(
                        u"DataJson"_ustr,
                        u"{ \"Transforms\": { \"SlideCommands\": ["
                        u"{\"DecomposePdfPages\": true}]}}"_ustr) });
    CPPUNIT_ASSERT_EQUAL(nObjectsAfter, pDoc->GetSdPage(0, PageKind::Standard)->GetObjCount());
    CPPUNIT_ASSERT(!pDoc->IsChanged());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testPdfPageModelRaw)
{
    // The page as its object model, read through the importer on a scratch
    // page: one text node per drawn run with its baseline, for the host's
    // analysis. Nothing on the document changes - the page keeps its
    // protected picture, nothing is modified.
    createSdDrawDoc("pdf/multipage.pdf");
    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });
    auto pImpressDocument = static_cast<SdXImpressDocument*>(mxComponent.get());
    SdDrawDocument* pDoc = pImpressDocument->GetDoc();
    SdPage* pPage = pDoc->GetSdPage(0, PageKind::Standard);
    CPPUNIT_ASSERT(pPage->GetPdfPageGraphic());
    {
        tools::JsonWriter aJsonWriter;
        pImpressDocument->getCommandValues(aJsonWriter, ".uno:PdfPageModel?part=0&raw=1");
        const OString aRaw = aJsonWriter.finishAndGetAsOString();
        CPPUNIT_ASSERT(aRaw.indexOf("\"type\": \"pdfpagemodel\"") >= 0);
        CPPUNIT_ASSERT(aRaw.indexOf("\"raw\": true") >= 0);
        CPPUNIT_ASSERT(aRaw.indexOf("\"kind\": \"text\"") >= 0);
        CPPUNIT_ASSERT(aRaw.indexOf("\"baseline\"") >= 0);
        CPPUNIT_ASSERT(aRaw.indexOf("\"ord\"") >= 0);
        boost::property_tree::ptree aTree;
        std::istringstream aStream(std::string(aRaw.getStr(), aRaw.getLength()));
        boost::property_tree::read_json(aStream, aTree);
        CPPUNIT_ASSERT(aTree.get<double>("page.w") > 100.0);
        size_t nTexts = 0;
        for (const auto& rNode : aTree.get_child("objects"))
            if (rNode.second.get<std::string>("kind") == "text")
            {
                ++nTexts;
                const auto& rLines = rNode.second.get_child("lines");
                CPPUNIT_ASSERT(!rLines.empty());
                const auto& rRuns = rLines.begin()->second.get_child("runs");
                CPPUNIT_ASSERT(!rRuns.empty());
                CPPUNIT_ASSERT(!rRuns.begin()->second.get<std::string>("text").empty());
                CPPUNIT_ASSERT(rRuns.begin()->second.get<double>("size") > 0.0);
            }
        CPPUNIT_ASSERT(nTexts > 0);
    }
    // Untouched.
    CPPUNIT_ASSERT(pPage->GetPdfPageGraphic());
    CPPUNIT_ASSERT_EQUAL(size_t(1), pPage->GetObjCount());
    CPPUNIT_ASSERT(!pDoc->IsChanged());
    // Not raw on a still-protected page: there is no model to write.
    {
        tools::JsonWriter aJsonWriter;
        pImpressDocument->getCommandValues(aJsonWriter, ".uno:PdfPageModel?part=0");
        CPPUNIT_ASSERT(aJsonWriter.finishAndGetAsOString().indexOf("\"error\": \"no model\"") >= 0);
    }
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testBuildPdfPageModelTree)
{
    // A v2 model - a card group holding a fill and a two-line text block, and
    // a path - builds the page's objects: the group is a Draw group with its
    // members, the block is ONE object whose lines land on the model's
    // baselines (measured off the kit's own primitives), the path is a path.
    // Building is not an edit, and the live page serialises back to the tree.
    createSdDrawDoc("pdf/multipage.pdf");
    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });
    auto xDesktop = frame::Desktop::create(comphelper::getProcessComponentContext());
    auto pImpressDocument = static_cast<SdXImpressDocument*>(mxComponent.get());
    auto pFrame = pImpressDocument->GetDocShell()->GetFrame();
    CPPUNIT_ASSERT(pFrame);
    xDesktop->setActiveFrame(pFrame->GetFrame().GetFrameInterface());
    SdDrawDocument* pDoc = pImpressDocument->GetDoc();
    SdPage* pPage = pDoc->GetSdPage(0, PageKind::Standard);
    CPPUNIT_ASSERT(pPage->GetPdfPageGraphic());
    // The model's page is the page's own size in points, so the coordinates
    // round-trip exactly.
    const double fW = pPage->GetSize().Width() * 72.0 / 2540.0;
    const double fH = pPage->GetSize().Height() * 72.0 / 2540.0;
    const OString aModel
        = "{\"page\":{\"w\":" + OString::number(fW) + ",\"h\":" + OString::number(fH)
          + "},\"objects\":["
            "{\"kind\":\"group\",\"role\":\"card\",\"box\":{\"x\":50,\"y\":50,\"w\":200,\"h\":100},"
            "\"children\":["
            "{\"kind\":\"rect\",\"box\":{\"x\":50,\"y\":50,\"w\":200,\"h\":100},\"fill\":\"#eeeeee\"},"
            "{\"kind\":\"text\",\"box\":{\"x\":60,\"y\":60,\"w\":180,\"h\":30},\"lineHeight\":14,"
            "\"lines\":["
            "{\"box\":{\"x\":60,\"y\":60,\"w\":100,\"h\":14},\"baseline\":72,\"runs\":[{\"text\":\"Hello card\","
            "\"box\":{\"x\":60,\"y\":60,\"w\":100,\"h\":14},\"family\":\"Liberation Sans\",\"size\":12,"
            "\"weight\":700,\"italic\":false,\"color\":\"#102030\",\"letterSpacing\":0}]},"
            "{\"box\":{\"x\":60,\"y\":74,\"w\":100,\"h\":14},\"baseline\":86,\"runs\":[{\"text\":\"second line\","
            "\"box\":{\"x\":60,\"y\":74,\"w\":100,\"h\":14},\"family\":\"Liberation Sans\",\"size\":12,"
            "\"weight\":400,\"italic\":false,\"color\":\"#102030\",\"letterSpacing\":0}]}]}]},"
            "{\"kind\":\"path\",\"box\":{\"x\":300,\"y\":300,\"w\":50,\"h\":50},"
            "\"d\":\"M300 300 L350 300 L350 350 Z\",\"fill\":\"#ff0000\"}]}"_ostr;
    OUStringBuffer aBase64;
    comphelper::Base64::encode(
        aBase64, cpo::uno::Sequence<sal_Int8>(reinterpret_cast<const sal_Int8*>(aModel.getStr()),
                                              aModel.getLength()));
    CPPUNIT_ASSERT(!pDoc->IsChanged());
    sd::UndoManager* pUndoManager = pDoc->GetUndoManager();
    const size_t nUndoBefore = pUndoManager ? pUndoManager->GetUndoActionCount() : 0;
    const OUString aDataJson = u"{ \"Transforms\": { \"SlideCommands\": [{\"BuildPdfPageModel\": \"0|"_ustr
                               + aBase64.makeStringAndClear() + u"\"}]}}"_ustr;
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    { comphelper::makePropertyValue(u"DataJson"_ustr, aDataJson) });
    CPPUNIT_ASSERT(!pPage->GetPdfPageGraphic());
    CPPUNIT_ASSERT_EQUAL(size_t(2), pPage->GetObjCount());
    auto* pGroup = dynamic_cast<SdrObjGroup*>(pPage->GetObj(0));
    CPPUNIT_ASSERT(pGroup);
    CPPUNIT_ASSERT_EQUAL(u"card"_ustr, pGroup->GetName());
    CPPUNIT_ASSERT_EQUAL(size_t(2), pGroup->GetSubList()->GetObjCount());
    CPPUNIT_ASSERT(pGroup->GetSubList()->GetObj(0)->GetObjIdentifier() == SdrObjKind::Rectangle);
    auto* pText = DynCastSdrTextObj(pGroup->GetSubList()->GetObj(1));
    CPPUNIT_ASSERT(pText);
    CPPUNIT_ASSERT(pText->GetOutlinerParaObject());
    CPPUNIT_ASSERT(pText->GetOutlinerParaObject()->GetTextObject().GetText(0).indexOf("Hello card") >= 0);
    CPPUNIT_ASSERT(dynamic_cast<SdrPathObj*>(pPage->GetObj(1)));
    // Not an edit.
    CPPUNIT_ASSERT(!pDoc->IsChanged());
    if (pUndoManager)
        CPPUNIT_ASSERT_EQUAL(nUndoBefore, pUndoManager->GetUndoActionCount());
    // The live page serialises back: the group with its members, the block's
    // two lines on the model's baselines, the path with its data.
    tools::JsonWriter aJsonWriter;
    pImpressDocument->getCommandValues(aJsonWriter, ".uno:PdfPageModel?part=0");
    const OString aLive = aJsonWriter.finishAndGetAsOString();
    boost::property_tree::ptree aTree;
    std::istringstream aStream(std::string(aLive.getStr(), aLive.getLength()));
    boost::property_tree::read_json(aStream, aTree);
    CPPUNIT_ASSERT_EQUAL(std::string("pdfpagemodel"), aTree.get<std::string>("type"));
    CPPUNIT_ASSERT(!aTree.get<bool>("raw"));
    // Everything on this page is expressible: the page is complete.
    CPPUNIT_ASSERT(aTree.get<bool>("complete"));
    CPPUNIT_ASSERT(aTree.get_child("dropped").empty());
    const auto& rObjects = aTree.get_child("objects");
    CPPUNIT_ASSERT_EQUAL(size_t(2), rObjects.size());
    auto it = rObjects.begin();
    CPPUNIT_ASSERT_EQUAL(std::string("group"), it->second.get<std::string>("kind"));
    CPPUNIT_ASSERT_EQUAL(std::string("card"), it->second.get<std::string>("role"));
    const auto& rChildren = it->second.get_child("children");
    CPPUNIT_ASSERT_EQUAL(size_t(2), rChildren.size());
    auto itChild = rChildren.begin();
    CPPUNIT_ASSERT_EQUAL(std::string("rect"), itChild->second.get<std::string>("kind"));
    CPPUNIT_ASSERT_EQUAL(std::string("#eeeeee"), itChild->second.get<std::string>("fill"));
    ++itChild;
    CPPUNIT_ASSERT_EQUAL(std::string("text"), itChild->second.get<std::string>("kind"));
    const auto& rLines = itChild->second.get_child("lines");
    CPPUNIT_ASSERT_EQUAL(size_t(2), rLines.size());
    auto itLine = rLines.begin();
    CPPUNIT_ASSERT_DOUBLES_EQUAL(72.0, itLine->second.get<double>("baseline"), 1.0);
    CPPUNIT_ASSERT_EQUAL(std::string("Hello card"),
                         itLine->second.get_child("runs").begin()->second.get<std::string>("text"));
    CPPUNIT_ASSERT_EQUAL(700, itLine->second.get_child("runs").begin()->second.get<int>("weight"));
    ++itLine;
    CPPUNIT_ASSERT_DOUBLES_EQUAL(86.0, itLine->second.get<double>("baseline"), 1.0);
    ++it;
    CPPUNIT_ASSERT_EQUAL(std::string("path"), it->second.get<std::string>("kind"));
    CPPUNIT_ASSERT(!it->second.get<std::string>("d").empty());
    CPPUNIT_ASSERT_EQUAL(std::string("#ff0000"), it->second.get<std::string>("fill"));
}

namespace
{
/// Every AcroForm widget type on one page (generated, all ASCII, so the
/// cross-reference offsets hold in a raw string): a multi-line text field
/// "name" = "Ada" (MaxLen 10), a checked check box "agree" (export value
/// "Yes"), a radio group "choice" of "A" and "B" with "B" on, a combo box
/// "lang" (English / Spanish, "Spanish"), a list box "colors" (Red / Green /
/// Blue, Green selected), a push button "print" and an unsigned signature
/// field "sig1" whose appearance is a drawn box.
constexpr std::string_view aAcroFormWidgetsPdf = R"PDF(%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R 6 0 R 7 0 R 10 0 R 11 0 R 12 0 R 13 0 R] /DA (/Helv 10 Tf 0 g) /DR << /Font << /Helv 14 0 R >> >> >> >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /Helv 14 0 R >> >> /Annots [5 0 R 6 0 R 8 0 R 9 0 R 10 0 R 11 0 R 12 0 R 13 0 R] >>
endobj
4 0 obj
<<  /Length 46 >>
stream
BT /Helv 12 Tf 72 740 Td (Form widgets) Tj ET
endstream
endobj
5 0 obj
<< /Type /Annot /Subtype /Widget /F 4 /P 3 0 R /DA (/Helv 10 Tf 0 g) /FT /Tx /T (name) /V (Ada) /MaxLen 10 /Ff 4096 /Rect [72 680 272 700] >>
endobj
6 0 obj
<< /Type /Annot /Subtype /Widget /F 4 /P 3 0 R /DA (/Helv 10 Tf 0 g) /FT /Btn /T (agree) /V /Yes /AS /Yes /Rect [72 640 86 654] /AP << /N << /Yes 15 0 R /Off 16 0 R >> >> >>
endobj
7 0 obj
<< /FT /Btn /Ff 49152 /T (choice) /V /B /Kids [8 0 R 9 0 R] >>
endobj
8 0 obj
<< /Type /Annot /Subtype /Widget /F 4 /P 3 0 R /DA (/Helv 10 Tf 0 g) /Parent 7 0 R /AS /Off /Rect [72 600 86 614] /AP << /N << /A 15 0 R /Off 16 0 R >> >> >>
endobj
9 0 obj
<< /Type /Annot /Subtype /Widget /F 4 /P 3 0 R /DA (/Helv 10 Tf 0 g) /Parent 7 0 R /AS /B /Rect [100 600 114 614] /AP << /N << /B 15 0 R /Off 16 0 R >> >> >>
endobj
10 0 obj
<< /Type /Annot /Subtype /Widget /F 4 /P 3 0 R /DA (/Helv 10 Tf 0 g) /FT /Ch /Ff 131072 /T (lang) /Opt [(English) (Spanish)] /V (Spanish) /Rect [72 560 272 580] >>
endobj
11 0 obj
<< /Type /Annot /Subtype /Widget /F 4 /P 3 0 R /DA (/Helv 10 Tf 0 g) /FT /Ch /T (colors) /Opt [(Red) (Green) (Blue)] /V (Green) /I [1] /Rect [72 480 272 540] >>
endobj
12 0 obj
<< /Type /Annot /Subtype /Widget /F 4 /P 3 0 R /DA (/Helv 10 Tf 0 g) /FT /Btn /Ff 65536 /T (print) /MK << /CA (Print) >> /Rect [300 680 400 700] /AP << /N 17 0 R >> >>
endobj
13 0 obj
<< /Type /Annot /Subtype /Widget /F 4 /P 3 0 R /DA (/Helv 10 Tf 0 g) /FT /Sig /T (sig1) /Rect [72 400 272 440] /AP << /N 17 0 R >> >>
endobj
14 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>
endobj
15 0 obj
<< /Type /XObject /Subtype /Form /BBox [0 0 14 14] /Length 22 >>
stream
0 0 0 rg 3 3 8 8 re f
endstream
endobj
16 0 obj
<< /Type /XObject /Subtype /Form /BBox [0 0 14 14] /Length 1 >>
stream

endstream
endobj
17 0 obj
<< /Type /XObject /Subtype /Form /BBox [0 0 200 40] /Length 29 >>
stream
0 0 1 RG 2 w 1 1 198 38 re S
endstream
endobj
xref
0 18
0000000000 65535 f 
0000000009 00000 n 
0000000187 00000 n 
0000000244 00000 n 
0000000435 00000 n 
0000000531 00000 n 
0000000688 00000 n 
0000000877 00000 n 
0000000955 00000 n 
0000001128 00000 n 
0000001301 00000 n 
0000001481 00000 n 
0000001658 00000 n 
0000001842 00000 n 
0000001992 00000 n 
0000002090 00000 n 
0000002210 00000 n 
0000002308 00000 n 
trailer
<< /Size 18 /Root 1 0 R >>
startxref
2436
%%EOF
)PDF";
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testPdfFormWidgetsImport)
{
    // Decompose imports EVERY widget type as the form control the PDF export
    // writes back as the same AcroForm field, with its name, value and
    // flags; a signature field keeps its appearance as a locked picture.
    utl::TempFileNamed aFixture(u"acroform", true, u".pdf");
    aFixture.EnableKillingFile();
    SvStream* pFixtureStream = aFixture.GetStream(StreamMode::WRITE);
    CPPUNIT_ASSERT(pFixtureStream);
    pFixtureStream->WriteBytes(aAcroFormWidgetsPdf.data(), aAcroFormWidgetsPdf.size());
    aFixture.CloseStream();
    loadFromURL(aFixture.GetURL());

    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });
    auto xDesktop = frame::Desktop::create(comphelper::getProcessComponentContext());
    auto pImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    CPPUNIT_ASSERT(pImpressDocument);
    auto pFrame = pImpressDocument->GetDocShell()->GetFrame();
    CPPUNIT_ASSERT(pFrame);
    xDesktop->setActiveFrame(pFrame->GetFrame().GetFrameInterface());
    SdDrawDocument* pDoc = pImpressDocument->GetDoc();
    CPPUNIT_ASSERT(pDoc->IsPDFDocument());
    SdPage* pPage = pDoc->GetSdPage(0, PageKind::Standard);
    CPPUNIT_ASSERT(pPage->GetPdfPageGraphic());

    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    { comphelper::makePropertyValue(
                        u"DataJson"_ustr,
                        u"{ \"Transforms\": { \"SlideCommands\": ["
                        u"{\"DecomposePdfPages\": true}]}}"_ustr) });
    CPPUNIT_ASSERT(!pPage->GetPdfPageGraphic());

    std::map<OUString, std::vector<uno::Reference<beans::XPropertySet>>> aControls;
    SdrGrafObj* pSignature = nullptr;
    for (size_t n = 0; n < pPage->GetObjCount(); ++n)
    {
        SdrObject* pObj = pPage->GetObj(n);
        if (auto* pUno = dynamic_cast<SdrUnoObj*>(pObj))
        {
            uno::Reference<beans::XPropertySet> xProps(pUno->GetUnoControlModel(),
                                                       uno::UNO_QUERY);
            CPPUNIT_ASSERT(xProps.is());
            OUString aName;
            xProps->getPropertyValue(u"Name"_ustr) >>= aName;
            aControls[aName].push_back(xProps);
        }
        else if (auto* pGraf = dynamic_cast<SdrGrafObj*>(pObj))
        {
            if (pGraf->GetName() == "sig1")
                pSignature = pGraf;
        }
    }

    auto prop = [](const uno::Reference<beans::XPropertySet>& xProps, const OUString& rProp) {
        return xProps->getPropertyValue(rProp);
    };
    // text field: value, max length, multi-line
    CPPUNIT_ASSERT_EQUAL(size_t(1), aControls[u"name"_ustr].size());
    const auto& xName = aControls[u"name"_ustr].front();
    CPPUNIT_ASSERT_EQUAL(u"Ada"_ustr, prop(xName, u"Text"_ustr).get<OUString>());
    CPPUNIT_ASSERT_EQUAL(sal_Int16(10), prop(xName, u"MaxTextLen"_ustr).get<sal_Int16>());
    CPPUNIT_ASSERT(prop(xName, u"MultiLine"_ustr).get<bool>());
    // check box: on, with its own export value
    CPPUNIT_ASSERT_EQUAL(size_t(1), aControls[u"agree"_ustr].size());
    const auto& xAgree = aControls[u"agree"_ustr].front();
    CPPUNIT_ASSERT_EQUAL(sal_Int16(1), prop(xAgree, u"State"_ustr).get<sal_Int16>());
    CPPUNIT_ASSERT_EQUAL(u"Yes"_ustr, prop(xAgree, u"RefValue"_ustr).get<OUString>());
    // radio group: two buttons, one group, "B" on
    const auto& rRadios = aControls[u"choice"_ustr];
    CPPUNIT_ASSERT_EQUAL(size_t(2), rRadios.size());
    OUString aOn;
    for (const auto& xRadio : rRadios)
    {
        CPPUNIT_ASSERT_EQUAL(sal_Int16(form::FormComponentType::RADIOBUTTON),
                             prop(xRadio, u"ClassId"_ustr).get<sal_Int16>());
        CPPUNIT_ASSERT_EQUAL(u"choice"_ustr, prop(xRadio, u"GroupName"_ustr).get<OUString>());
        if (prop(xRadio, u"State"_ustr).get<sal_Int16>() == 1)
            aOn = prop(xRadio, u"RefValue"_ustr).get<OUString>();
    }
    CPPUNIT_ASSERT_EQUAL(u"B"_ustr, aOn);
    // combo box: its options and value
    CPPUNIT_ASSERT_EQUAL(size_t(1), aControls[u"lang"_ustr].size());
    const auto& xLang = aControls[u"lang"_ustr].front();
    const auto aLangItems = prop(xLang, u"StringItemList"_ustr).get<cpo::uno::Sequence<OUString>>();
    CPPUNIT_ASSERT_EQUAL(sal_Int32(2), aLangItems.getLength());
    CPPUNIT_ASSERT_EQUAL(u"English"_ustr, aLangItems[0]);
    CPPUNIT_ASSERT_EQUAL(u"Spanish"_ustr, prop(xLang, u"Text"_ustr).get<OUString>());
    // list box: its options and selection
    CPPUNIT_ASSERT_EQUAL(size_t(1), aControls[u"colors"_ustr].size());
    const auto& xColors = aControls[u"colors"_ustr].front();
    CPPUNIT_ASSERT_EQUAL(sal_Int32(3),
                         prop(xColors, u"StringItemList"_ustr).get<cpo::uno::Sequence<OUString>>().getLength());
    const auto aSelected = prop(xColors, u"SelectedItems"_ustr).get<cpo::uno::Sequence<sal_Int16>>();
    CPPUNIT_ASSERT_EQUAL(sal_Int32(1), aSelected.getLength());
    CPPUNIT_ASSERT_EQUAL(sal_Int16(1), aSelected[0]);
    // push button
    CPPUNIT_ASSERT_EQUAL(size_t(1), aControls[u"print"_ustr].size());
    CPPUNIT_ASSERT_EQUAL(sal_Int16(form::FormComponentType::COMMANDBUTTON),
                         prop(aControls[u"print"_ustr].front(), u"ClassId"_ustr).get<sal_Int16>());
    // signature: its appearance, locked, named after the field
    CPPUNIT_ASSERT(pSignature);
    CPPUNIT_ASSERT(pSignature->IsMoveProtect());
    CPPUNIT_ASSERT(pSignature->IsResizeProtect());
    // Not an edit.
    CPPUNIT_ASSERT(!pDoc->IsChanged());

    // The export writes them back as real fields with their values.
    uno::Reference<frame::XStorable> xStorable(mxComponent, uno::UNO_QUERY);
    comphelper::SequenceAsHashMap aMediaDescriptor;
    aMediaDescriptor[u"FilterName"_ustr] <<= u"draw_pdf_Export"_ustr;
    aMediaDescriptor[u"FilterData"_ustr] <<= comphelper::InitPropertySequence(
        { { "ExportFormFields", cpo::uno::Any(true) } });
    xStorable->storeToURL(maTempFile.GetURL(), aMediaDescriptor.getAsConstPropertyValueList());
    std::unique_ptr<vcl::pdf::PDFiumDocument> pPdf = parsePDFExport();
    CPPUNIT_ASSERT(pPdf);
    std::unique_ptr<vcl::pdf::PDFiumPage> pPdfPage = pPdf->openPage(0);
    CPPUNIT_ASSERT(pPdfPage);
    std::map<vcl::pdf::PDFFormFieldType, int> aTypes;
    std::map<OUString, OUString> aValues;
    for (int nAnnot = 0; nAnnot < pPdfPage->getAnnotationCount(); ++nAnnot)
    {
        auto pAnnot = pPdfPage->getAnnotation(nAnnot);
        if (!pAnnot || pAnnot->getSubType() != vcl::pdf::PDFAnnotationSubType::Widget)
            continue;
        ++aTypes[pAnnot->getFormFieldType(pPdf.get())];
        aValues[pAnnot->getFormFieldName(pPdf.get())] = pAnnot->getFormFieldValue(pPdf.get());
    }
    CPPUNIT_ASSERT_EQUAL(1, aTypes[vcl::pdf::PDFFormFieldType::TextField]);
    CPPUNIT_ASSERT_EQUAL(1, aTypes[vcl::pdf::PDFFormFieldType::CheckBox]);
    CPPUNIT_ASSERT_EQUAL(2, aTypes[vcl::pdf::PDFFormFieldType::RadioButton]);
    CPPUNIT_ASSERT_EQUAL(1, aTypes[vcl::pdf::PDFFormFieldType::ComboBox]);
    CPPUNIT_ASSERT_EQUAL(1, aTypes[vcl::pdf::PDFFormFieldType::ListBox]);
    CPPUNIT_ASSERT_EQUAL(1, aTypes[vcl::pdf::PDFFormFieldType::PushButton]);
    CPPUNIT_ASSERT_EQUAL(u"Ada"_ustr, aValues[u"name"_ustr]);
    CPPUNIT_ASSERT_EQUAL(u"Yes"_ustr, aValues[u"agree"_ustr]);
    CPPUNIT_ASSERT_EQUAL(u"B"_ustr, aValues[u"choice"_ustr]);
    CPPUNIT_ASSERT_EQUAL(u"Spanish"_ustr, aValues[u"lang"_ustr]);
}

namespace
{
/// A visible text field "shown" = "Ada", a Hidden (/F 2) text field "helper"
/// = "42" and a NoView (/F 36: Print | NoView) check box "calc" (generated,
/// all ASCII, so the cross-reference offsets hold in a raw string).
constexpr std::string_view aHiddenWidgetsPdf = R"PDF(%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R 6 0 R 7 0 R] /DA (/Helv 10 Tf 0 g) /DR << /Font << /Helv 8 0 R >> >> >> >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /Helv 8 0 R >> >> /Annots [5 0 R 6 0 R 7 0 R] >>
endobj
4 0 obj
<< /Length 46 >>
stream
BT /Helv 12 Tf 72 740 Td (Hidden fields) Tj ET
endstream
endobj
5 0 obj
<< /Type /Annot /Subtype /Widget /F 4 /P 3 0 R /DA (/Helv 10 Tf 0 g) /FT /Tx /T (shown) /V (Ada) /Rect [72 680 272 700] >>
endobj
6 0 obj
<< /Type /Annot /Subtype /Widget /F 2 /P 3 0 R /DA (/Helv 10 Tf 0 g) /FT /Tx /T (helper) /V (42) /Rect [72 640 272 660] >>
endobj
7 0 obj
<< /Type /Annot /Subtype /Widget /F 36 /P 3 0 R /DA (/Helv 10 Tf 0 g) /FT /Btn /T (calc) /V /Off /AS /Off /Rect [72 600 86 614] >>
endobj
8 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>
endobj
xref
0 9
0000000000 65535 f 
0000000009 00000 n 
0000000158 00000 n 
0000000215 00000 n 
0000000371 00000 n 
0000000467 00000 n 
0000000605 00000 n 
0000000743 00000 n 
0000000889 00000 n 
trailer
<< /Size 9 /Root 1 0 R >>
startxref
986
%%EOF
)PDF";
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testPdfHiddenFormWidgetsNotImported)
{
    // The export writes only the controls it paints, and it paints no
    // invisible object: a Hidden or NoView widget imported as a hidden
    // control was silently dropped by the first canvas save. It is not
    // imported, so the canvas never shows a field its save does not keep.
    utl::TempFileNamed aFixture(u"hiddenform", true, u".pdf");
    aFixture.EnableKillingFile();
    SvStream* pFixtureStream = aFixture.GetStream(StreamMode::WRITE);
    CPPUNIT_ASSERT(pFixtureStream);
    pFixtureStream->WriteBytes(aHiddenWidgetsPdf.data(), aHiddenWidgetsPdf.size());
    aFixture.CloseStream();
    loadFromURL(aFixture.GetURL());

    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });
    auto xDesktop = frame::Desktop::create(comphelper::getProcessComponentContext());
    auto pImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    CPPUNIT_ASSERT(pImpressDocument);
    auto pFrame = pImpressDocument->GetDocShell()->GetFrame();
    CPPUNIT_ASSERT(pFrame);
    xDesktop->setActiveFrame(pFrame->GetFrame().GetFrameInterface());
    SdDrawDocument* pDoc = pImpressDocument->GetDoc();
    CPPUNIT_ASSERT(pDoc->IsPDFDocument());
    SdPage* pPage = pDoc->GetSdPage(0, PageKind::Standard);

    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    { comphelper::makePropertyValue(
                        u"DataJson"_ustr,
                        u"{ \"Transforms\": { \"SlideCommands\": ["
                        u"{\"DecomposePdfPages\": true}]}}"_ustr) });
    CPPUNIT_ASSERT(!pPage->GetPdfPageGraphic());

    std::vector<OUString> aNames;
    for (size_t n = 0; n < pPage->GetObjCount(); ++n)
    {
        auto* pUno = dynamic_cast<SdrUnoObj*>(pPage->GetObj(n));
        if (!pUno)
            continue;
        uno::Reference<beans::XPropertySet> xProps(pUno->GetUnoControlModel(), uno::UNO_QUERY);
        CPPUNIT_ASSERT(xProps.is());
        OUString aName;
        xProps->getPropertyValue(u"Name"_ustr) >>= aName;
        // Every control the import makes is one the export paints.
        CPPUNIT_ASSERT(pUno->IsVisible());
        aNames.push_back(aName);
    }
    CPPUNIT_ASSERT_EQUAL(size_t(1), aNames.size());
    CPPUNIT_ASSERT_EQUAL(u"shown"_ustr, aNames.front());
}

namespace
{
/// A 40x32 RGB baseline JPEG (a colour gradient), base64.
constexpr std::string_view aCanvasJpegBase64 =
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8S"
    "EhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEU"
    "Hh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAAR"
    "CAAgACgDAREAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA"
    "AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkK"
    "FhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWG"
    "h4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl"
    "5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREA"
    "AgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYk"
    "NOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOE"
    "hYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk"
    "5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD5wtNM6fLX7bUxB5WExZr2mmdPlrjqYg+n"
    "wmLNe00zp8tcNTEH02ExZr2mmdPlriqYk+mwmLNe00zp8tcdTEn0+ExZzFppnT5a9WpiD+QM"
    "JizXtNM6fLXHUxB9PhMWa9ppnT5a4qmIPpsJizXtNM6fLXFUxB9PhMWa9ppnT5a4qmIPpsJi"
    "zmLTTOny161TEH8f4TFGvaaZ0+WuKpiD6fCYo17TTOny1xVMSfTYTFGvaaZ0+WuKpiT6fCYo"
    "17TTOny1xVMQfTYTFHL2mmdPlr1qmIP5AwmLNe00zp8tcVTEH0+ExZr2mmdPlriqYg+mwmLN"
    "e00zp8tcVTEH02ExZr2mmdPlrjqYg+nwmLP/2Q==";
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testPdfCanvasSaveOptions)
{
    // What a save of a PDF opened into Draw (the PDF canvas) now exports
    // with: the FilterData desktop::setPdfSourceSaveFilterData adds in the
    // kit's .uno:Save branch (desktop/source/lib/init.cxx; that branch needs
    // the kit, so this test passes the same FilterData itself). The form
    // comes back as real fields, and a JPEG picture is written through byte
    // for byte. With only the FilterData the save sent before
    // (ExportBookmarks, ExportFormFields) PDFExport keeps
    // ReduceImageResolution on, HasAdequateCompression refuses the
    // passthrough, and the picture is decoded and re-encoded on every save.
    utl::TempFileNamed aFixture(u"acroform", true, u".pdf");
    aFixture.EnableKillingFile();
    SvStream* pFixtureStream = aFixture.GetStream(StreamMode::WRITE);
    CPPUNIT_ASSERT(pFixtureStream);
    pFixtureStream->WriteBytes(aAcroFormWidgetsPdf.data(), aAcroFormWidgetsPdf.size());
    aFixture.CloseStream();
    loadFromURL(aFixture.GetURL());

    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });
    auto xDesktop = frame::Desktop::create(comphelper::getProcessComponentContext());
    auto pImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    CPPUNIT_ASSERT(pImpressDocument);
    auto pFrame = pImpressDocument->GetDocShell()->GetFrame();
    CPPUNIT_ASSERT(pFrame);
    xDesktop->setActiveFrame(pFrame->GetFrame().GetFrameInterface());
    SdDrawDocument* pDoc = pImpressDocument->GetDoc();
    CPPUNIT_ASSERT(pDoc->IsPDFDocument());
    SdPage* pPage = pDoc->GetSdPage(0, PageKind::Standard);
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    { comphelper::makePropertyValue(
                        u"DataJson"_ustr,
                        u"{ \"Transforms\": { \"SlideCommands\": ["
                        u"{\"DecomposePdfPages\": true}]}}"_ustr) });
    CPPUNIT_ASSERT(!pPage->GetPdfPageGraphic());

    // A JPEG picture the way the importer's passthrough (or a paste) hands it
    // over: the decoded bitmap plus its NativeJpg link.
    cpo::uno::Sequence<sal_Int8> aJpeg;
    comphelper::Base64::decode(aJpeg, aCanvasJpegBase64);
    CPPUNIT_ASSERT(aJpeg.hasElements());
    SvMemoryStream aJpegStream(const_cast<sal_Int8*>(aJpeg.getConstArray()), aJpeg.getLength(),
                               StreamMode::READ);
    Graphic aGraphic;
    CPPUNIT_ASSERT(GraphicFilter::GetGraphicFilter().ImportGraphic(aGraphic, u"", aJpegStream)
                   == ERRCODE_NONE);
    CPPUNIT_ASSERT(aGraphic.IsGfxLink());
    const GfxLink aLink = aGraphic.GetGfxLink();
    CPPUNIT_ASSERT(aLink.GetType() == GfxLinkType::NativeJpg);
    CPPUNIT_ASSERT(aLink.GetData());
    const std::vector<sal_uInt8> aLinkData(aLink.GetData(), aLink.GetData() + aLink.GetDataSize());
    rtl::Reference<SdrGrafObj> pPicture
        = new SdrGrafObj(*pDoc, aGraphic, tools::Rectangle(Point(2000, 20000), Size(4000, 3200)));
    pPage->NbcInsertObject(pPicture.get());

    uno::Reference<frame::XStorable> xStorable(mxComponent, uno::UNO_QUERY);
    comphelper::SequenceAsHashMap aMediaDescriptor;
    aMediaDescriptor[u"FilterName"_ustr] <<= u"draw_pdf_Export"_ustr;
    aMediaDescriptor[u"FilterData"_ustr] <<= comphelper::InitPropertySequence(
        { { "ExportBookmarks", cpo::uno::Any(true) },
          { "ExportFormFields", cpo::uno::Any(true) },
          { "ReduceImageResolution", cpo::uno::Any(false) },
          { "UseLosslessCompression", cpo::uno::Any(true) },
          { "ExportNotes", cpo::uno::Any(true) } });
    xStorable->storeToURL(maTempFile.GetURL(), aMediaDescriptor.getAsConstPropertyValueList());
    std::unique_ptr<vcl::pdf::PDFiumDocument> pPdf = parsePDFExport();
    CPPUNIT_ASSERT(pPdf);
    std::unique_ptr<vcl::pdf::PDFiumPage> pPdfPage = pPdf->openPage(0);
    CPPUNIT_ASSERT(pPdfPage);

    // The form: real fields, with their values.
    std::map<OUString, OUString> aValues;
    for (int nAnnot = 0; nAnnot < pPdfPage->getAnnotationCount(); ++nAnnot)
    {
        auto pAnnot = pPdfPage->getAnnotation(nAnnot);
        if (pAnnot && pAnnot->getSubType() == vcl::pdf::PDFAnnotationSubType::Widget)
            aValues[pAnnot->getFormFieldName(pPdf.get())] = pAnnot->getFormFieldValue(pPdf.get());
    }
    CPPUNIT_ASSERT_EQUAL(u"Ada"_ustr, aValues[u"name"_ustr]);
    CPPUNIT_ASSERT_EQUAL(u"Yes"_ustr, aValues[u"agree"_ustr]);
    CPPUNIT_ASSERT_EQUAL(u"B"_ustr, aValues[u"choice"_ustr]);
    CPPUNIT_ASSERT_EQUAL(u"Spanish"_ustr, aValues[u"lang"_ustr]);

    // The picture: one DCTDecode image whose stream is the JPEG itself.
    int nJpegs = 0;
    std::vector<sal_uInt8> aWritten;
    std::function<void(vcl::pdf::PDFiumPageObject&)> aVisit
        = [&](vcl::pdf::PDFiumPageObject& rObject) {
              if (rObject.getType() == vcl::pdf::PDFPageObjectType::Form)
              {
                  for (int n = 0; n < rObject.getFormObjectCount(); ++n)
                      if (std::unique_ptr<vcl::pdf::PDFiumPageObject> pChild
                          = rObject.getFormObject(n))
                          aVisit(*pChild);
                  return;
              }
              if (rObject.getType() != vcl::pdf::PDFPageObjectType::Image)
                  return;
              const std::vector<OString> aFilters = rObject.getImageFilters();
              if (aFilters.size() == 1 && aFilters[0] == "DCTDecode")
              {
                  ++nJpegs;
                  aWritten = rObject.getImageDataRaw();
              }
          };
    for (int n = 0; n < pPdfPage->getObjectCount(); ++n)
        if (std::unique_ptr<vcl::pdf::PDFiumPageObject> pObject = pPdfPage->getObject(n))
            aVisit(*pObject);
    CPPUNIT_ASSERT_EQUAL(1, nJpegs);
    CPPUNIT_ASSERT_EQUAL(aLinkData.size(), aWritten.size());
    CPPUNIT_ASSERT(aLinkData == aWritten);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testPdfPageModelLiveRotationAndLabel)
{
    // The live model (the one attached at save, which the next open builds
    // from) carries a rectangle's rotation and its own label, and says when
    // a page holds something it cannot express.
    createSdDrawDoc("pdf/multipage.pdf");
    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });
    auto xDesktop = frame::Desktop::create(comphelper::getProcessComponentContext());
    auto pImpressDocument = static_cast<SdXImpressDocument*>(mxComponent.get());
    auto pFrame = pImpressDocument->GetDocShell()->GetFrame();
    CPPUNIT_ASSERT(pFrame);
    xDesktop->setActiveFrame(pFrame->GetFrame().GetFrameInterface());
    SdDrawDocument* pDoc = pImpressDocument->GetDoc();
    SdPage* pPage = pDoc->GetSdPage(0, PageKind::Standard);
    CPPUNIT_ASSERT(pPage->GetPdfPageGraphic());
    const double fW = pPage->GetSize().Width() * 72.0 / 2540.0;
    const double fH = pPage->GetSize().Height() * 72.0 / 2540.0;
    const OString aModel
        = "{\"page\":{\"w\":" + OString::number(fW) + ",\"h\":" + OString::number(fH)
          + "},\"objects\":["
            "{\"kind\":\"rect\",\"box\":{\"x\":100,\"y\":100,\"w\":120,\"h\":60},\"fill\":\"#336699\","
            "\"rotate\":30,\"text\":{\"hAdjust\":1,\"vAdjust\":1,\"lines\":["
            "{\"box\":{\"x\":110,\"y\":110,\"w\":40,\"h\":14},\"baseline\":122,\"runs\":[{\"text\":\"Label\","
            "\"box\":{\"x\":110,\"y\":110,\"w\":40,\"h\":14},\"family\":\"Liberation Sans\",\"size\":12,"
            "\"weight\":400,\"italic\":false,\"color\":\"#000000\",\"letterSpacing\":0}]}]}}]}"_ostr;
    OUStringBuffer aBase64;
    comphelper::Base64::encode(
        aBase64, cpo::uno::Sequence<sal_Int8>(reinterpret_cast<const sal_Int8*>(aModel.getStr()),
                                              aModel.getLength()));
    const OUString aDataJson = u"{ \"Transforms\": { \"SlideCommands\": [{\"BuildPdfPageModel\": \"0|"_ustr
                               + aBase64.makeStringAndClear() + u"\"}]}}"_ustr;
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    { comphelper::makePropertyValue(u"DataJson"_ustr, aDataJson) });
    CPPUNIT_ASSERT(!pPage->GetPdfPageGraphic());
    CPPUNIT_ASSERT_EQUAL(size_t(1), pPage->GetObjCount());
    SdrObject* pRect = pPage->GetObj(0);
    CPPUNIT_ASSERT(pRect->GetObjIdentifier() == SdrObjKind::Rectangle);
    // Built rotated, with its label.
    CPPUNIT_ASSERT_EQUAL(sal_Int32(3000), pRect->GetRotateAngle().get());
    auto* pRectText = DynCastSdrTextObj(pRect);
    CPPUNIT_ASSERT(pRectText && pRectText->GetOutlinerParaObject());
    CPPUNIT_ASSERT_EQUAL(u"Label"_ustr,
                         pRectText->GetOutlinerParaObject()->GetTextObject().GetText(0));

    auto readLive = [&]() {
        tools::JsonWriter aJsonWriter;
        pImpressDocument->getCommandValues(aJsonWriter, ".uno:PdfPageModel?part=0");
        const OString aLive = aJsonWriter.finishAndGetAsOString();
        boost::property_tree::ptree aTree;
        std::istringstream aStream(std::string(aLive.getStr(), aLive.getLength()));
        boost::property_tree::read_json(aStream, aTree);
        return aTree;
    };
    {
        const boost::property_tree::ptree aTree = readLive();
        CPPUNIT_ASSERT(aTree.get<bool>("complete"));
        const auto& rNode = aTree.get_child("objects").begin()->second;
        CPPUNIT_ASSERT_EQUAL(std::string("rect"), rNode.get<std::string>("kind"));
        CPPUNIT_ASSERT_DOUBLES_EQUAL(30.0, rNode.get<double>("rotate"), 0.01);
        // the box is the unrotated rect, its top-left the rotation reference
        CPPUNIT_ASSERT_DOUBLES_EQUAL(100.0, rNode.get<double>("box.x"), 0.5);
        CPPUNIT_ASSERT_DOUBLES_EQUAL(120.0, rNode.get<double>("box.w"), 0.5);
        const auto& rLabelLines = rNode.get_child("text.lines");
        CPPUNIT_ASSERT(!rLabelLines.empty());
        CPPUNIT_ASSERT_EQUAL(
            std::string("Label"),
            rLabelLines.begin()->second.get_child("runs").begin()->second.get<std::string>("text"));
    }
    // A gradient is not expressible: the page says so instead of rebuilding
    // it as a flat colour on the next open.
    pRect->SetMergedItem(XFillStyleItem(drawing::FillStyle_GRADIENT));
    {
        const boost::property_tree::ptree aTree = readLive();
        CPPUNIT_ASSERT(!aTree.get<bool>("complete"));
        bool bGradient = false;
        for (const auto& rKind : aTree.get_child("dropped"))
            bGradient = bGradient || rKind.second.get_value<std::string>() == "fill:gradient";
        CPPUNIT_ASSERT(bGradient);
    }
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testDeckInfoFitState)
{
    // geometry=1 deck info reports each text box's ideal fit size: a box
    // resized wider than its text says FitsText false with TextFitWidth
    // smaller than Width.
    createSdImpressDoc();

    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });

    auto xDesktop = frame::Desktop::create(comphelper::getProcessComponentContext());
    auto pImpressDocument = static_cast<SdXImpressDocument*>(mxComponent.get());
    auto pFrame = pImpressDocument->GetDocShell()->GetFrame();
    CPPUNIT_ASSERT(pFrame);
    xDesktop->setActiveFrame(pFrame->GetFrame().GetFrameInterface());

    SdPage* pPage = pImpressDocument->GetDoc()->GetSdPage(0, PageKind::Standard);
    pPage->SetBorder(1000, 800, 1100, 900);
    const size_t nObjCountBefore = pPage->GetObjCount();

    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    { comphelper::makePropertyValue(
                        u"DataJson"_ustr,
                        u"{ \"Transforms\": { \"SlideCommands\": ["
                        u"{\"InsertTextBox.0\": \"3000,3000|Snug\"}]}}"_ustr) });
    SdrTextObj* pBox = DynCastSdrTextObj(pPage->GetObj(nObjCountBefore));
    CPPUNIT_ASSERT(pBox);

    // Snug by construction: the box owns a FitsText true.
    {
        tools::JsonWriter aJsonWriter;
        pImpressDocument->getCommandValues(
            aJsonWriter, ".uno:ExtractDocumentStructure?filter=slides&geometry=1&fit=1");
        const OString aExtract = aJsonWriter.finishAndGetAsOString();
        CPPUNIT_ASSERT(aExtract.indexOf("\"FitsText\": true") >= 0);
    }

    // Stretch it well past its text: the reported fit state flips and the
    // ideal width stays at the text's own size.
    tools::Rectangle aRect = pBox->GetLogicRect();
    aRect.AdjustRight(4000);
    pBox->SetLogicRect(aRect);

    const Size aFitSize = pBox->CalcFitToTextSize();
    CPPUNIT_ASSERT(aFitSize.Width() < pBox->GetLogicRect().GetWidth() - 25);
    {
        tools::JsonWriter aJsonWriter;
        pImpressDocument->getCommandValues(
            aJsonWriter, ".uno:ExtractDocumentStructure?filter=slides&geometry=1&fit=1");
        const OString aExtract = aJsonWriter.finishAndGetAsOString();
        CPPUNIT_ASSERT(aExtract.indexOf("\"FitsText\": false") >= 0);
        CPPUNIT_ASSERT(
            aExtract.indexOf(Concat2View("\"TextFitWidth\": " + OString::number(aFitSize.Width()))) >= 0);
        CPPUNIT_ASSERT(aExtract.indexOf(Concat2View("\"Width\": "
                                        + OString::number(pBox->GetLogicRect().GetWidth())))
                       >= 0);
    }
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testBatchRestoresOriginPage)
{
    // Agent batches must not hijack the user's view: after a batch the view
    // is switched back to the page it started on, unless the batch
    // explicitly ENDS in a bare JumpToSlide - the one sanctioned way for a
    // batch to navigate.
    createSdImpressDoc();

    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });

    auto xDesktop = frame::Desktop::create(comphelper::getProcessComponentContext());
    auto pImpressDocument = static_cast<SdXImpressDocument*>(mxComponent.get());
    auto pFrame = pImpressDocument->GetDocShell()->GetFrame();
    CPPUNIT_ASSERT(pFrame);
    xDesktop->setActiveFrame(pFrame->GetFrame().GetFrameInterface());

    auto* pDrawViewShell
        = dynamic_cast<sd::DrawViewShell*>(pImpressDocument->GetDocShell()->GetViewShell());
    CPPUNIT_ASSERT(pDrawViewShell);

    // Grow the deck to three slides; the batch's own navigation is restored
    // away, so the view stays on the entry page.
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    { comphelper::makePropertyValue(
                        u"DataJson"_ustr,
                        u"{ \"Transforms\": { \"SlideCommands\": ["
                        u"{\"DuplicateSlide\": 0}, {\"DuplicateSlide\": 0}]}}"_ustr) });
    CPPUNIT_ASSERT_EQUAL(sal_uInt16(3),
                         pImpressDocument->GetDoc()->GetSdPageCount(PageKind::Standard));
    checkCurrentPageNumber(1);

    // Work from slide 2 like a user would.
    pDrawViewShell->SwitchPage(1);
    Scheduler::ProcessEventsToIdle();
    checkCurrentPageNumber(2);

    // A batch that edits slide 3 mid-flight comes back home...
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    { comphelper::makePropertyValue(
                        u"DataJson"_ustr,
                        u"{ \"Transforms\": { \"SlideCommands\": ["
                        u"{\"JumpToSlide\": 2}, {\"SetText.0\": \"edited elsewhere\"}]}}"_ustr) });
    checkCurrentPageNumber(2);
    // ...having really edited it.
    SdrTextObj* pTitle = DynCastSdrTextObj(
        pImpressDocument->GetDoc()->GetSdPage(2, PageKind::Standard)->GetObj(0));
    CPPUNIT_ASSERT(pTitle);
    CPPUNIT_ASSERT_EQUAL(u"edited elsewhere"_ustr,
                         pTitle->GetOutlinerParaObject()->GetTextObject().GetText(0));

    // A batch ENDING in a bare JumpToSlide is explicit navigation intent:
    // the view goes (and stays) where it points.
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    { comphelper::makePropertyValue(
                        u"DataJson"_ustr,
                        u"{ \"Transforms\": { \"SlideCommands\": ["
                        u"{\"JumpToSlide\": 2}]}}"_ustr) });
    checkCurrentPageNumber(3);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf111522)
{
    // Load the document and create two new windows.
    createSdImpressDoc("tdf111522.odp");
    auto pImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pImpressDocument->GetDocShell()->GetViewShell();
    pViewShell->GetViewFrame()->GetDispatcher()->Execute(SID_NEWWINDOW, SfxCallMode::SYNCHRON);
    sd::ViewShell* pViewShell1 = pImpressDocument->GetDocShell()->GetViewShell();
    pViewShell->GetViewFrame()->GetDispatcher()->Execute(SID_NEWWINDOW, SfxCallMode::SYNCHRON);
    sd::ViewShell* pViewShell2 = pImpressDocument->GetDocShell()->GetViewShell();
    CPPUNIT_ASSERT(pViewShell1 != pViewShell2);

    // Have slide 1 in window 1, slide 2 in window 2.
    SfxRequest aRequest(*pViewShell2->GetViewFrame(), SID_SWITCHPAGE);
    aRequest.AppendItem(SfxUInt32Item(ID_VAL_WHATPAGE, 1));
    aRequest.AppendItem(
        SfxUInt32Item(ID_VAL_WHATKIND, static_cast<sal_uInt32>(PageKind::Standard)));
    pViewShell2->ExecuteSlot(aRequest, /*bAsync=*/false);

    // Start text edit in window 1.
    SdPage* pPage1 = pViewShell1->GetActualPage();
    SdrObject* pShape1 = pPage1->GetObj(0);
    SdrView* pView1 = pViewShell1->GetView();
    pView1->MarkObj(pShape1, pView1->GetSdrPageView());
    pView1->SdrBeginTextEdit(pShape1);
    CPPUNIT_ASSERT(pView1->IsTextEdit());

    // Move the shape in window 2 & undo.
    SdPage* pPage2 = pViewShell2->GetActualPage();
    CPPUNIT_ASSERT(pPage1 != pPage2);
    SdrObject* pShape2 = pPage2->GetObj(0);
    SdrView* pView2 = pViewShell2->GetView();
    pView2->MarkObj(pShape2, pView2->GetSdrPageView());
    pView2->MoveMarkedObj(Size(1, 1), /*bCopy=*/false);
    // Without the accompanying fix in place, this test would have failed with an assertion failure
    // in SdrObjEditView::SdrEndTextEdit() as mpOldTextEditUndoManager was not nullptr.
    pViewShell2->GetViewFrame()->GetDispatcher()->Execute(SID_UNDO, SfxCallMode::SYNCHRON);

    // Rotate the shape in window 2 & undo.
    pView2->MarkObj(pShape2, pView2->GetSdrPageView());
    pView2->RotateMarkedObj(pShape2->GetLastBoundRect().Center(), /*nAngle=*/45_deg100);
    // Without the accompanying fix in place, this test would have failed with an assertion failure
    // in SdrObjEditView::SdrEndTextEdit() as mpOldTextEditUndoManager was not nullptr.
    pViewShell2->GetViewFrame()->GetDispatcher()->Execute(SID_UNDO, SfxCallMode::SYNCHRON);

    // Start text edit in window 2.
    // tdf#125824
    pView2->MarkObj(pShape2, pView2->GetSdrPageView());
    pView2->SdrBeginTextEdit(pShape2);
    CPPUNIT_ASSERT(pView2->IsTextEdit());
    // Write 'test' inside the shape
    SfxStringItem aInputString(SID_ATTR_CHAR, u"test"_ustr);
    pViewShell2->GetViewFrame()->GetDispatcher()->ExecuteList(SID_ATTR_CHAR, SfxCallMode::SYNCHRON,
                                                              { &aInputString });
    CPPUNIT_ASSERT(pView2->GetTextEditObject());
    EditView& rEditView = pView2->GetTextEditOutlinerView()->GetEditView();
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_Int32>(4), rEditView.GetSelection().start.nIndex);
    pView2->SdrEndTextEdit();
    // Without the accompanying fix in place, this test would have failed with an assertion failure
    // in SdrObjEditView::SdrEndTextEdit() as mpOldTextEditUndoManager was not nullptr.
    pViewShell2->GetViewFrame()->GetDispatcher()->Execute(SID_UNDO, SfxCallMode::SYNCHRON);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf126197)
{
    // Load the document and create two new windows.
    createSdImpressDoc("tdf126197.odp");
    auto pImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pImpressDocument->GetDocShell()->GetViewShell();
    pViewShell->GetViewFrame()->GetDispatcher()->Execute(SID_NEWWINDOW, SfxCallMode::SYNCHRON);
    sd::ViewShell* pViewShell1 = pImpressDocument->GetDocShell()->GetViewShell();
    pViewShell->GetViewFrame()->GetDispatcher()->Execute(SID_NEWWINDOW, SfxCallMode::SYNCHRON);
    sd::ViewShell* pViewShell2 = pImpressDocument->GetDocShell()->GetViewShell();
    CPPUNIT_ASSERT(pViewShell1 != pViewShell2);

    // Start text edit in window 1.
    SdPage* pPage1 = pViewShell1->GetActualPage();
    SdrObject* pShape1 = pPage1->GetObj(0);
    SdrView* pView1 = pViewShell1->GetView();
    pView1->MarkObj(pShape1, pView1->GetSdrPageView());
    pView1->SdrBeginTextEdit(pShape1);
    CPPUNIT_ASSERT(pView1->IsTextEdit());

    SdPage* pPage2 = pViewShell2->GetActualPage();
    CPPUNIT_ASSERT_EQUAL(pPage1, pPage2);
    SdrObject* pShape2 = pPage2->GetObj(0);
    CPPUNIT_ASSERT_EQUAL(pShape1, pShape2);
    SdrView* pView2 = pViewShell2->GetView();
    pView2->MarkObj(pShape2, pView2->GetSdrPageView());

    // Without the accompanying fix in place, this test would have failed with an assertion failure
    // in SdrObjEditView::SdrEndTextEdit()
    pViewShell2->GetViewFrame()->GetDispatcher()->Execute(SID_DELETE, SfxCallMode::SYNCHRON);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf124708)
{
    createSdImpressDoc("tdf124708.ppt");

    dispatchCommand(mxComponent, u".uno:NextPage"_ustr, {});

    checkCurrentPageNumber(2);

    auto pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pXImpressDocument->GetDocShell()->GetViewShell();
    SdPage* pActualPage = pViewShell->GetActualPage();
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(16), pActualPage->GetObjCount());

    dispatchCommand(mxComponent, u".uno:SelectAll"_ustr, {});

    // Without the fix in place, this test would have crashed here
    dispatchCommand(mxComponent, u".uno:Delete"_ustr, {});

    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(0), pActualPage->GetObjCount());

    dispatchCommand(mxComponent, u".uno:Undo"_ustr, {});

    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(16), pActualPage->GetObjCount());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf159666)
{
    createSdDrawDoc("tdf159666.odg");

    auto pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pXImpressDocument->GetDocShell()->GetViewShell();
    SdPage* pActualPage = pViewShell->GetActualPage();
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(12), pActualPage->GetObjCount());

    // Without the fix in place, this test would have crashed here
    dispatchCommand(mxComponent, u".uno:SelectAll"_ustr, {});

    dispatchCommand(mxComponent, u".uno:Delete"_ustr, {});

    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(0), pActualPage->GetObjCount());

    dispatchCommand(mxComponent, u".uno:Undo"_ustr, {});

    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(12), pActualPage->GetObjCount());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf143412)
{
    createSdImpressDoc();

    auto pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pXImpressDocument->GetDocShell()->GetViewShell();

    SdPage* pActualPage = pViewShell->GetActualPage();
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(2), pActualPage->GetObjCount());

    OUString aImageURL = createFileURL(u"tdf143412.svg");
    cpo::uno::Sequence<beans::PropertyValue> aArgs(comphelper::InitPropertySequence({
        { "FileName", cpo::uno::Any(aImageURL) },
    }));
    dispatchCommand(mxComponent, u".uno:InsertGraphic"_ustr, aArgs);

    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(3), pActualPage->GetObjCount());

    // Without the fix in place, this test would have crashed
    // Check that converting an image to the different options doesn't crash

    dispatchCommand(mxComponent, u".uno:ChangeBezier"_ustr, {});

    dispatchCommand(mxComponent, u".uno:ChangePolygon"_ustr, {});

    dispatchCommand(mxComponent, u".uno:convert_to_contour"_ustr, {});

    dispatchCommand(mxComponent, u".uno:ConvertInto3D"_ustr, {});

    dispatchCommand(mxComponent, u".uno:ConvertInto3DLatheFast"_ustr, {});

    dispatchCommand(mxComponent, u".uno:ConvertIntoBitmap"_ustr, {});

    dispatchCommand(mxComponent, u".uno:ConvertIntoMetaFile"_ustr, {});

    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(3), pActualPage->GetObjCount());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf155211_dashed_line)
{
    createSdImpressDoc();

    auto pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pXImpressDocument->GetDocShell()->GetViewShell();

    SdPage* pActualPage = pViewShell->GetActualPage();
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(2), pActualPage->GetObjCount());

    OUString aImageURL = createFileURL(u"tdf155211_dashed_line.svg");
    cpo::uno::Sequence<beans::PropertyValue> aArgs(comphelper::InitPropertySequence({
        { "FileName", cpo::uno::Any(aImageURL) },
    }));
    dispatchCommand(mxComponent, u".uno:InsertGraphic"_ustr, aArgs);
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(3), pActualPage->GetObjCount());

    // split the (auto-selected) svg
    dispatchCommand(mxComponent, u".uno:Break"_ustr, {});

    SdrObject* pObject = pActualPage->GetObj(2);
    const XLineStyleItem& rStyleItem = pObject->GetMergedItem(XATTR_LINESTYLE);
    // tdf#115162: Without the fix in place, this test would have failed with
    // - Expected: 2 (LineStyle_DASH)
    // - Actual  : 1 (LineStyle_SOLID)
    CPPUNIT_ASSERT_EQUAL(drawing::LineStyle_DASH, rStyleItem.GetValue());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf169813_prevent_unintended_dashed_line)
{
    createSdImpressDoc();

    auto pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pXImpressDocument->GetDocShell()->GetViewShell();

    SdPage* pActualPage = pViewShell->GetActualPage();
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(2), pActualPage->GetObjCount());

    OUString aImageURL = createFileURL(u"tdf169813_prevent_unintended_dashed_line.svg");
    cpo::uno::Sequence<beans::PropertyValue> aArgs(comphelper::InitPropertySequence({
        { "FileName", cpo::uno::Any(aImageURL) },
    }));
    dispatchCommand(mxComponent, u".uno:InsertGraphic"_ustr, aArgs);
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(3), pActualPage->GetObjCount());

    // split the (auto-selected) svg
    dispatchCommand(mxComponent, u".uno:Break"_ustr, {});

    SdrObject* pObject = pActualPage->GetObj(3);
    const XLineStyleItem& rStyleItem = pObject->GetMergedItem(XATTR_LINESTYLE);
    // tdf#169813: Without the fix in place, this test would have failed with
    // - Expected: 0 (LineStyle_NONE)
    // - Actual  : 2 (LineStyle_DASH)
    CPPUNIT_ASSERT_EQUAL(drawing::LineStyle_NONE, rStyleItem.GetValue());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf162455)
{
    createSdImpressDoc();

    auto pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pXImpressDocument->GetDocShell()->GetViewShell();

    SdPage* pActualPage = pViewShell->GetActualPage();
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(2), pActualPage->GetObjCount());

    OUString aImageURL = createFileURL(u"tdf162455.svg");
    cpo::uno::Sequence<beans::PropertyValue> aArgs(comphelper::InitPropertySequence({
        { "FileName", cpo::uno::Any(aImageURL) },
    }));
    dispatchCommand(mxComponent, u".uno:InsertGraphic"_ustr, aArgs);

    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(3), pActualPage->GetObjCount());

    // split the (auto-selected) svg up

    dispatchCommand(mxComponent, u".uno:Break"_ustr, {});

    // Get the newly created shape that has the text '100' in it
    uno::Reference<beans::XPropertySet> xShape(getShapeFromPage(4, 0));
    uno::Reference<text::XTextRange> xParagraph1(getParagraphFromShape(0, xShape));
    uno::Reference<text::XTextRange> xRun(getRunFromParagraph(0, xParagraph1));
    CPPUNIT_ASSERT_EQUAL(u"100"_ustr, xRun->getString());

    uno::Reference<beans::XPropertySet> xPropSet1(xRun, uno::UNO_QUERY);
    double fFontSize1 = xPropSet1->getPropertyValue(u"CharHeight"_ustr).get<double>();

    /* before this fix the font sizes were way too small
      - Expected: 7.5
      - Actual  : 0.300000011920929 */
    CPPUNIT_ASSERT_DOUBLES_EQUAL(7.5, fFontSize1, 0.01);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testSetHyperlinkKeepSelection)
{
    // Given an Impress doc with a rectangle shape, in text edit mode, with "f" typed and
    // selected:
    createSdImpressDoc();
    auto* pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pXImpressDocument->GetDocShell()->GetViewShell();
    SdrView* pView = pViewShell->GetView();
    SdPage* pPage = pViewShell->GetActualPage();

    rtl::Reference<SdrRectObj> pRect
        = new SdrRectObj(pView->getSdrModelFromSdrView(), tools::Rectangle(1000, 1000, 5000, 5000));
    pPage->NbcInsertObject(pRect.get());

    pView->MarkObj(pRect.get(), pView->GetSdrPageView());
    pView->SdrBeginTextEdit(pRect.get());
    CPPUNIT_ASSERT(pView->IsTextEdit());

    SfxStringItem aInputString(SID_ATTR_CHAR, u"f"_ustr);
    pViewShell->GetViewFrame()->GetDispatcher()->ExecuteList(SID_ATTR_CHAR, SfxCallMode::SYNCHRON,
                                                             { &aInputString });

    OutlinerView* pOlView = pView->GetTextEditOutlinerView();
    CPPUNIT_ASSERT(pOlView);
    pOlView->SetSelection(ESelection(0, 0, 0, 1));
    CPPUNIT_ASSERT(pOlView->HasSelection());

    // When dispatching .uno:SetHyperlink with Hyperlink.Text differing from the selection,
    // but marked as a hint:
    cpo::uno::Sequence<beans::PropertyValue> aArgs = {
        comphelper::makePropertyValue(u"Hyperlink.Text"_ustr, cpo::uno::Any(u"mytext"_ustr)),
        comphelper::makePropertyValue(u"Hyperlink.TextIsHint"_ustr, cpo::uno::Any(true)),
        comphelper::makePropertyValue(u"Hyperlink.URL"_ustr,
                                      cpo::uno::Any(u"http://www.example.com"_ustr)),
    };
    dispatchCommand(mxComponent, u".uno:SetHyperlink"_ustr, aArgs);

    // Then make sure the previously-selected character is preserved as the URL field's
    // displayed text, not replaced by Hyperlink.Text:
    pView->SdrEndTextEdit();
    const OutlinerParaObject* pOPO = pRect->GetOutlinerParaObject();
    CPPUNIT_ASSERT(pOPO);
    const SvxFieldData* pField
        = pOPO->GetTextObject().GetFieldData(0, 0, css::text::textfield::Type::URL);
    auto* pURLField = dynamic_cast<const SvxURLField*>(pField);
    CPPUNIT_ASSERT(pURLField);
    // Without the accompanying fix in place, this test would have failed with:
    // - Expected: f
    // - Actual  : mytext
    // i.e. the selected character was lost, the provided text hint was used.
    CPPUNIT_ASSERT_EQUAL(u"f"_ustr, pURLField->GetRepresentation());
}

static SdrObject* lcl_findTextBoxByText(const SdPage* pPage, std::u16string_view rText)
{
    for (size_t i = 0; i < pPage->GetObjCount(); ++i)
    {
        SdrObject* pObj = pPage->GetObj(i);
        const SdrTextObj* pTextObj = DynCastSdrTextObj(pObj);
        if (!pTextObj || !pTextObj->HasText())
            continue;
        const OutlinerParaObject* pOPO = pTextObj->GetOutlinerParaObject();
        if (pOPO && pOPO->GetTextObject().GetText(0) == rText)
            return pObj;
    }
    return nullptr;
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testPasteTextboxBackground)
{
    // The textbox 'xxx' in the source has draw:fill="none" inherited from a
    // layout-specific named style ("Content_Outline_Normal-outline1") on its
    // master page, not from the auto-style on the frame itself. Copying it
    // into a different document used to drop the inherited fill: the
    // destination's style pool had no "Content_Outline_Normal-outline1", so
    // AttributeProperties' by-name lookup returned null and the clone fell
    // through to applyDefaultStyleSheetFromSdrModel(), giving the pasted
    // shape a solid (white) background.
    //
    // Hold the source via mxComponent2 so it stays alive while we open the
    // destination via mxComponent.
    mxComponent2 = loadFromDesktop(createFileURL(u"odp/paste-textbox-background.odp"),
                                   u"com.sun.star.presentation.PresentationDocument"_ustr);
    CPPUNIT_ASSERT(mxComponent2.is());

    auto* pSrcImpress = dynamic_cast<SdXImpressDocument*>(mxComponent2.get());
    CPPUNIT_ASSERT(pSrcImpress);
    sd::ViewShell* pSrcViewShell = pSrcImpress->GetDocShell()->GetViewShell();
    SdPage* pSrcPage = pSrcViewShell->GetActualPage();

    SdrObject* pSrcTextBox = lcl_findTextBoxByText(pSrcPage, u"xxx");
    CPPUNIT_ASSERT_MESSAGE("source textbox 'xxx' not found", pSrcTextBox);

    // The source's effective fill is none, courtesy of the layout parent.
    CPPUNIT_ASSERT_EQUAL(drawing::FillStyle_NONE,
                         pSrcTextBox->GetMergedItem(XATTR_FILLSTYLE).GetValue());

    // Mark the textbox and copy via .uno:Copy. This goes through the
    // standard same-process clipboard path: View::DoCopy ->
    // CreateClipboardDataObject sets SdModule::pTransferClip and puts the
    // data on the system clipboard.
    SdrView* pSrcView = pSrcViewShell->GetView();
    pSrcView->UnmarkAllObj();
    pSrcView->MarkObj(pSrcTextBox, pSrcView->GetSdrPageView());
    dispatchCommand(mxComponent2, u".uno:Copy"_ustr, {});

    // Open a fresh destination - mxComponent2 stays untouched.
    createSdImpressDoc();
    auto* pDstImpress = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    CPPUNIT_ASSERT(pDstImpress);
    sd::ViewShell* pDstViewShell = pDstImpress->GetDocShell()->GetViewShell();
    SdPage* pDstPage = pDstViewShell->GetActualPage();
    const size_t nDstObjsBefore = pDstPage->GetObjCount();

    // Paste in the destination. The destination's InsertData recognises
    // SdModule::pTransferClip as own data and goes through the same-process
    // branch, calling our View::Paste(SdrModel) override on the source's
    // intermediate model.
    dispatchCommand(mxComponent, u".uno:Paste"_ustr, {});

    CPPUNIT_ASSERT_EQUAL(nDstObjsBefore + 1, pDstPage->GetObjCount());
    SdrObject* pDstShape = pDstPage->GetObj(nDstObjsBefore);

    // Without the fix in sd::View::Paste(const SdrModel&, ...) this would
    // be FillStyle_SOLID and the pasted shape would have a different
    // background.
    CPPUNIT_ASSERT_EQUAL(drawing::FillStyle_NONE,
                         pDstShape->GetMergedItem(XATTR_FILLSTYLE).GetValue());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testPasteTextboxBackgroundCrossProcess)
{
    // Same scenario as testPasteTextboxBackground, but exercising the
    // cross-process path that online (coolwsd) uses. There the source kit
    // and the destination kit are different processes, so the destination
    // sees the clipboard data as a generic non-SdTransferable and goes
    // through InsertData's DRAWING import branch: SvxDrawingLayerImport
    // into a fresh SdDrawDocument, then Paste(rMod).
    //
    // Simulate that here by clearing SdModule::pTransferClip after the
    // copy, so the destination's InsertData no longer recognises the
    // transferable as own data.
    mxComponent2 = loadFromDesktop(createFileURL(u"odp/paste-textbox-background.odp"),
                                   u"com.sun.star.presentation.PresentationDocument"_ustr);
    CPPUNIT_ASSERT(mxComponent2.is());

    auto* pSrcImpress = dynamic_cast<SdXImpressDocument*>(mxComponent2.get());
    CPPUNIT_ASSERT(pSrcImpress);
    sd::ViewShell* pSrcViewShell = pSrcImpress->GetDocShell()->GetViewShell();
    SdPage* pSrcPage = pSrcViewShell->GetActualPage();

    SdrObject* pSrcTextBox = lcl_findTextBoxByText(pSrcPage, u"xxx");
    CPPUNIT_ASSERT_MESSAGE("source textbox 'xxx' not found", pSrcTextBox);
    CPPUNIT_ASSERT_EQUAL(drawing::FillStyle_NONE,
                         pSrcTextBox->GetMergedItem(XATTR_FILLSTYLE).GetValue());

    SdrView* pSrcView = pSrcViewShell->GetView();
    pSrcView->UnmarkAllObj();
    pSrcView->MarkObj(pSrcTextBox, pSrcView->GetSdrPageView());
    dispatchCommand(mxComponent2, u".uno:Copy"_ustr, {});

    // Make the destination see the transferable as foreign: this drops it
    // into the DRAWING-import branch of InsertData, the same one online
    // takes when the source kit is a different process.
    SdModule::get()->pTransferClip = nullptr;

    createSdImpressDoc();
    auto* pDstImpress = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    CPPUNIT_ASSERT(pDstImpress);
    sd::ViewShell* pDstViewShell = pDstImpress->GetDocShell()->GetViewShell();
    SdPage* pDstPage = pDstViewShell->GetActualPage();
    const size_t nDstObjsBefore = pDstPage->GetObjCount();

    dispatchCommand(mxComponent, u".uno:Paste"_ustr, {});

    CPPUNIT_ASSERT_EQUAL(nDstObjsBefore + 1, pDstPage->GetObjCount());
    SdrObject* pDstShape = pDstPage->GetObj(nDstObjsBefore);

    CPPUNIT_ASSERT_EQUAL(drawing::FillStyle_NONE,
                         pDstShape->GetMergedItem(XATTR_FILLSTYLE).GetValue());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testPasteKeepsPositionInKit)
{
    // When kit is active the destination's visible area is not a reliable
    // paste position. A cross-document paste arrives with the selection
    // normalised to the origin, so place the group's top-left at the page
    // origin instead of recentering it on that visible area. Recentering
    // shifted the pasted shape away from the corner.
    mxComponent2 = loadFromDesktop(createFileURL(u"odp/paste-textbox-background.odp"),
                                   u"com.sun.star.presentation.PresentationDocument"_ustr);
    CPPUNIT_ASSERT(mxComponent2.is());

    auto* pSrcImpress = dynamic_cast<SdXImpressDocument*>(mxComponent2.get());
    CPPUNIT_ASSERT(pSrcImpress);
    sd::ViewShell* pSrcViewShell = pSrcImpress->GetDocShell()->GetViewShell();
    SdPage* pSrcPage = pSrcViewShell->GetActualPage();

    SdrObject* pSrcTextBox = lcl_findTextBoxByText(pSrcPage, u"xxx");
    CPPUNIT_ASSERT_MESSAGE("source textbox 'xxx' not found", pSrcTextBox);
    const Size aSrcSize = pSrcTextBox->GetSnapRect().GetSize();

    SdrView* pSrcView = pSrcViewShell->GetView();
    pSrcView->UnmarkAllObj();
    pSrcView->MarkObj(pSrcTextBox, pSrcView->GetSdrPageView());
    dispatchCommand(mxComponent2, u".uno:Copy"_ustr, {});

    // Make the destination see the clipboard as foreign, the cross-process
    // path online takes, so the paste goes through View::Paste(SdrModel).
    SdModule::get()->pTransferClip = nullptr;

    createSdImpressDoc();
    auto* pDstImpress = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    CPPUNIT_ASSERT(pDstImpress);
    sd::ViewShell* pDstViewShell = pDstImpress->GetDocShell()->GetViewShell();
    SdPage* pDstPage = pDstViewShell->GetActualPage();
    const size_t nDstObjsBefore = pDstPage->GetObjCount();

    {
        comphelper::COKit::setActive(true);
        comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });
        dispatchCommand(mxComponent, u".uno:Paste"_ustr, {});
    }

    CPPUNIT_ASSERT_EQUAL(nDstObjsBefore + 1, pDstPage->GetObjCount());
    SdrObject* pDstShape = pDstPage->GetObj(nDstObjsBefore);

    // The pasted shape sits at the page origin with its size preserved,
    // rather than being shifted by the recentering offset.
    CPPUNIT_ASSERT_EQUAL(tools::Rectangle(Point(0, 0), aSrcSize),
                         pDstShape->GetSnapRect());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testSlidePasteSizeMismatch)
{
    // Given a 4:3 presentation, with the first slide selected:
    createSdImpressDoc("odp/4-3.odp");
    sd::slidesorter::controller::SlideSorterController& rSrcCtl
        = getSlideSorterViewShell()->GetSlideSorter().GetController();
    auto pSrcImpress = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    SdPage* pSrcFirst = pSrcImpress->GetDoc()->GetSdPage(0, PageKind::Standard);
    rSrcCtl.GetPageSelector().DeselectAllPages();
    rSrcCtl.GetPageSelector().SelectPage(pSrcFirst);

    // When copying that slide and pasting it into a 16:9 presentation:
    rSrcCtl.GetClipboard().DoCopy();
    // Disable internal paste to hit the clipboard save + load code-path.
    SdModule::get()->pTransferClip = nullptr;
    mxComponent2 = loadFromDesktop(createFileURL(u"odp/16-9.odp"),
                                   u"com.sun.star.presentation.PresentationDocument"_ustr);
    auto* pDstImpress = dynamic_cast<SdXImpressDocument*>(mxComponent2.get());
    SdDrawDocument* pDstDoc = pDstImpress->GetDoc();
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(1), pDstDoc->GetSdPageCount(PageKind::Standard));
    sd::slidesorter::SlideSorterViewShell* pDstSSVS = getSlideSorterViewShell(mxComponent2);
    sd::slidesorter::controller::SlideSorterController& rDstCtl
        = pDstSSVS->GetSlideSorter().GetController();
    SdPage* pDstLast = pDstDoc->GetSdPage(0, PageKind::Standard);
    rDstCtl.GetPageSelector().DeselectAllPages();
    rDstCtl.GetPageSelector().SelectPage(pDstLast);
    rDstCtl.GetClipboard().PasteSlidesFromSystemClipboard();

    // Then make sure paste results in 2 slides:
    sal_uInt16 nActualPageCount = pDstDoc->GetSdPageCount(PageKind::Standard);
    // Without the accompanying fix in place, this test would have failed with:
    // - Expected: 2
    // - Actual  : 1
    // i.e. an unexpected non-async dialog popped up, which gets cancelled in silent mode, so the
    // paste fails.
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(2), nActualPageCount);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf96206)
{
    // Copying/pasting slide referring to a non-default master with a text duplicated the master

    createSdImpressDoc("odp/tdf96206.odp");

    sd::slidesorter::SlideSorterViewShell* pSSVS = getSlideSorterViewShell();
    auto& rSSController = pSSVS->GetSlideSorter().GetController();

    SdXImpressDocument* pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    SdDrawDocument* pDoc = pXImpressDocument->GetDoc();
    const sal_uInt16 nMasterPageCnt1 = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(sal_uInt16(2), nMasterPageCnt1);
    rSSController.GetClipboard().DoCopy();
    rSSController.GetClipboard().DoPaste();
    const sal_uInt16 nMasterPageCnt2 = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(nMasterPageCnt1, nMasterPageCnt2);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testDocumentCut)
{
    // Test cutting slides and verifying the document state afterwards
    createSdImpressDoc("odp/tdf96206.odp");

    // Get the slide sorter and controller
    sd::slidesorter::SlideSorterViewShell* pSSVS = getSlideSorterViewShell();
    auto& rSSController = pSSVS->GetSlideSorter().GetController();

    // Get document and initial page count
    SdXImpressDocument* pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    SdDrawDocument* pDoc = pXImpressDocument->GetDoc();

    // Get initial page count
    const sal_uInt16 nInitialPageCount = pDoc->GetSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT(nInitialPageCount > 0);

    // Select all slides
    rSSController.GetPageSelector().SelectAllPages();

    // Check that slides are selected
    CPPUNIT_ASSERT(rSSController.GetPageSelector().GetSelectedPageCount() > 0);

    // Cut the selected slides
    rSSController.GetClipboard().DoCut();

    // Paste the cut slides
    rSSController.GetClipboard().DoPaste();

    // After pasting, we should have at least the initial number of pages
    const sal_uInt16 nPageCountAfterPaste = pDoc->GetSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT(nPageCountAfterPaste >= nInitialPageCount);

    // Verify that master page count remains unchanged throughout the operation
    const sal_uInt16 nMasterPageCount = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(sal_uInt16(2), nMasterPageCount);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf96708)
{
    createSdImpressDoc("odp/tdf96708.odp");

    sd::slidesorter::SlideSorterViewShell* pSSVS = getSlideSorterViewShell();
    auto& rSSController = pSSVS->GetSlideSorter().GetController();
    auto& rPageSelector = rSSController.GetPageSelector();

    SdXImpressDocument* pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    SdDrawDocument* pDoc = pXImpressDocument->GetDoc();
    const sal_uInt16 nMasterPageCnt1 = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(sal_uInt16(4), nMasterPageCnt1);
    rSSController.GetClipboard().DoCopy();
    rPageSelector.SelectAllPages();

    // Now wait for timers to trigger creation of auto-layout
    osl::Thread::wait(std::chrono::milliseconds(100));
    Scheduler::ProcessEventsToIdle();

    rSSController.GetClipboard().DoPaste();

    const sal_uInt16 nMasterPageCnt2 = pDoc->GetMasterSdPageCount(PageKind::Standard);
    //FIXME: tdf#151802: Number of master pages should be 4, it's 5 instead
    // CPPUNIT_ASSERT_EQUAL(nMasterPageCnt1, nMasterPageCnt2);
    CPPUNIT_ASSERT_EQUAL(sal_uInt16(5), nMasterPageCnt2);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf45617_default_master)
{
    // Copying/pasting slide referring to a master page.
    createSdImpressDoc("odp/tdf96206.odp");

    sd::slidesorter::SlideSorterViewShell* pSSVS = getSlideSorterViewShell();
    auto& rSSController = pSSVS->GetSlideSorter().GetController();

    SdXImpressDocument* pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    SdDrawDocument* pDoc = pXImpressDocument->GetDoc();
    const sal_uInt16 nMasterPageCnt1 = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(sal_uInt16(2), nMasterPageCnt1);
    rSSController.GetClipboard().DoCopy(true);
    rSSController.GetClipboard().DoPaste(true);
    const sal_uInt16 nMasterPageCnt2 = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(nMasterPageCnt1 + 1), nMasterPageCnt2);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf45617)
{
    // Copying/pasting slide referring to a master page.
    createSdImpressDoc("odp/tdf96708.odp");

    sd::slidesorter::SlideSorterViewShell* pSSVS = getSlideSorterViewShell();
    auto& rSSController = pSSVS->GetSlideSorter().GetController();

    SdXImpressDocument* pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    SdDrawDocument* pDoc = pXImpressDocument->GetDoc();
    const sal_uInt16 nMasterPageCnt1 = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(sal_uInt16(4), nMasterPageCnt1);
    rSSController.GetClipboard().DoCopy(true);
    rSSController.GetClipboard().DoPaste(true);
    const sal_uInt16 nMasterPageCnt2 = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(nMasterPageCnt1 + 1), nMasterPageCnt2);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf45617_test_master_name)
{
    // Copying/pasting slide referring to a master page.
    createSdImpressDoc("odp/tdf96708.odp");

    sd::slidesorter::SlideSorterViewShell* pSSVS = getSlideSorterViewShell();
    auto& rSSController = pSSVS->GetSlideSorter().GetController();
    // Get the master page name
    SdXImpressDocument* pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    SdDrawDocument* pDoc = pXImpressDocument->GetDoc();
    SdPage* pMasterPage = pDoc->GetMasterSdPage(0, PageKind::Standard);
    OUString aMasterPageName = pMasterPage->GetName();
    CPPUNIT_ASSERT_EQUAL(u"Master0"_ustr, aMasterPageName);
    rSSController.GetClipboard().DoCopy(true);
    rSSController.GetClipboard().DoPaste(true);
    SdPage* pNewMasterPage = pDoc->GetMasterSdPage(4, PageKind::Standard);
    OUString aNewMasterPageName = pNewMasterPage->GetName();
    CPPUNIT_ASSERT_EQUAL(u"1_Master0"_ustr, aNewMasterPageName);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf45617_test_default_master_name)
{
    // Copying/pasting slide referring to a master page.
    createSdImpressDoc();

    sd::slidesorter::SlideSorterViewShell* pSSVS = getSlideSorterViewShell();
    auto& rSSController = pSSVS->GetSlideSorter().GetController();
    // Get the master page name
    SdXImpressDocument* pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    SdDrawDocument* pDoc = pXImpressDocument->GetDoc();

    SdPage* pMasterPage = pDoc->GetMasterSdPage(0, PageKind::Standard);
    OUString aMasterPageName = pMasterPage->GetName();
    CPPUNIT_ASSERT_EQUAL(u"Default"_ustr, aMasterPageName);

    rSSController.GetClipboard().DoCopy(true);
    rSSController.GetClipboard().DoPaste(true);

    SdPage* pNewMasterPage = pDoc->GetMasterSdPage(0, PageKind::Standard);
    OUString aNewMasterPageName = pNewMasterPage->GetName();
    CPPUNIT_ASSERT_EQUAL(u"1_Default"_ustr, aNewMasterPageName);

    rSSController.GetClipboard().DoPaste(true);

    SdPage* pNewMasterPage2 = pDoc->GetMasterSdPage(1, PageKind::Standard);
    OUString aNewMasterPageName2 = pNewMasterPage2->GetName();
    CPPUNIT_ASSERT_EQUAL(u"2_Default"_ustr, aNewMasterPageName2);
}
CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf45617_basic_master_name)
{
    // Basic test for copying/pasting slide referring to a master page
    createSdImpressDoc("odp/tdf96708.odp");

    sd::slidesorter::SlideSorterViewShell* pSSVS = getSlideSorterViewShell();
    auto& rSSController = pSSVS->GetSlideSorter().GetController();

    SdXImpressDocument* pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    SdDrawDocument* pDoc = pXImpressDocument->GetDoc();

    SdPage* pMasterPage = pDoc->GetMasterSdPage(0, PageKind::Standard);
    OUString aMasterPageName = pMasterPage->GetName();
    CPPUNIT_ASSERT_EQUAL(u"Master0"_ustr, aMasterPageName);

    rSSController.GetClipboard().DoCopy(true);
    rSSController.GetClipboard().DoPaste(true);

    SdPage* pNewMasterPage = pDoc->GetMasterSdPage(4, PageKind::Standard);
    OUString aNewMasterPageName = pNewMasterPage->GetName();
    CPPUNIT_ASSERT_EQUAL(u"1_Master0"_ustr, aNewMasterPageName);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf45617_leading_underscore_master_name)
{
    // Test master page name with underscore at first position
    createSdImpressDoc("odp/tdf96708.odp");

    sd::slidesorter::SlideSorterViewShell* pSSVS = getSlideSorterViewShell();
    auto& rSSController = pSSVS->GetSlideSorter().GetController();

    SdXImpressDocument* pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    SdDrawDocument* pDoc = pXImpressDocument->GetDoc();

    SdPage* pMasterPage = pDoc->GetMasterSdPage(0, PageKind::Standard);
    // Rename the master page with leading underscore
    pDoc->RenameLayoutTemplate(pMasterPage->GetLayoutName(), u"_Master0"_ustr);

    OUString aMasterPageName = pMasterPage->GetName();
    CPPUNIT_ASSERT_EQUAL(u"_Master0"_ustr, aMasterPageName);

    rSSController.GetClipboard().DoCopy(true);
    rSSController.GetClipboard().DoPaste(true);

    SdPage* pNewMasterPage = pDoc->GetMasterSdPage(4, PageKind::Standard);
    OUString aNewMasterPageName = pNewMasterPage->GetName();
    CPPUNIT_ASSERT_EQUAL(u"1__Master0"_ustr, aNewMasterPageName);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf45617_middle_underscore_master_name)
{
    // Test master page name with underscore in the middle
    createSdImpressDoc("odp/tdf96708.odp");

    sd::slidesorter::SlideSorterViewShell* pSSVS = getSlideSorterViewShell();
    auto& rSSController = pSSVS->GetSlideSorter().GetController();

    SdXImpressDocument* pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    SdDrawDocument* pDoc = pXImpressDocument->GetDoc();

    SdPage* pMasterPage = pDoc->GetMasterSdPage(0, PageKind::Standard);
    // Rename the master page with middle underscore
    pDoc->RenameLayoutTemplate(pMasterPage->GetLayoutName(), u"Master_0"_ustr);

    OUString aMasterPageName = pMasterPage->GetName();
    CPPUNIT_ASSERT_EQUAL(u"Master_0"_ustr, aMasterPageName);

    rSSController.GetClipboard().DoCopy(true);
    rSSController.GetClipboard().DoPaste(true);

    SdPage* pNewMasterPage = pDoc->GetMasterSdPage(4, PageKind::Standard);
    OUString aNewMasterPageName = pNewMasterPage->GetName();
    CPPUNIT_ASSERT_EQUAL(u"1_Master_0"_ustr, aNewMasterPageName);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf45617_trailing_underscore_master_name)
{
    // Test master page name with underscore at the end
    createSdImpressDoc("odp/tdf96708.odp");

    sd::slidesorter::SlideSorterViewShell* pSSVS = getSlideSorterViewShell();
    auto& rSSController = pSSVS->GetSlideSorter().GetController();

    SdXImpressDocument* pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    SdDrawDocument* pDoc = pXImpressDocument->GetDoc();

    SdPage* pMasterPage = pDoc->GetMasterSdPage(0, PageKind::Standard);
    // Rename the master page with trailing underscore
    pDoc->RenameLayoutTemplate(pMasterPage->GetLayoutName(), u"Master0_"_ustr);

    OUString aMasterPageName = pMasterPage->GetName();
    CPPUNIT_ASSERT_EQUAL(u"Master0_"_ustr, aMasterPageName);

    rSSController.GetClipboard().DoCopy(true);
    rSSController.GetClipboard().DoPaste(true);

    SdPage* pNewMasterPage = pDoc->GetMasterSdPage(4, PageKind::Standard);
    OUString aNewMasterPageName = pNewMasterPage->GetName();
    CPPUNIT_ASSERT_EQUAL(u"1_Master0_"_ustr, aNewMasterPageName);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf45617_space_in_master_name)
{
    // Test master page name with space in the middle
    createSdImpressDoc("odp/tdf96708.odp");

    sd::slidesorter::SlideSorterViewShell* pSSVS = getSlideSorterViewShell();
    auto& rSSController = pSSVS->GetSlideSorter().GetController();

    SdXImpressDocument* pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    SdDrawDocument* pDoc = pXImpressDocument->GetDoc();

    SdPage* pMasterPage = pDoc->GetMasterSdPage(0, PageKind::Standard);
    // Rename the master page with space in the middle
    pDoc->RenameLayoutTemplate(pMasterPage->GetLayoutName(), u"Master 0"_ustr);

    OUString aMasterPageName = pMasterPage->GetName();
    CPPUNIT_ASSERT_EQUAL(u"Master 0"_ustr, aMasterPageName);

    rSSController.GetClipboard().DoCopy(true);
    rSSController.GetClipboard().DoPaste(true);

    SdPage* pNewMasterPage = pDoc->GetMasterSdPage(4, PageKind::Standard);
    OUString aNewMasterPageName = pNewMasterPage->GetName();
    CPPUNIT_ASSERT_EQUAL(u"1_Master 0"_ustr, aNewMasterPageName);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf45617_Double_Copy)
{
    // Test master page name with double copy
    createSdImpressDoc();

    sd::slidesorter::SlideSorterViewShell* pSSVS = getSlideSorterViewShell();
    auto& rSSController = pSSVS->GetSlideSorter().GetController();
    // Set edit master page mode
    rSSController.ChangeEditMode(EditMode::MasterPage);

    SdXImpressDocument* pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    SdDrawDocument* pDoc = pXImpressDocument->GetDoc();

    // Get the master page name
    const sal_uInt16 nMasterPageCnt1 = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(sal_uInt16(1), nMasterPageCnt1);
    SdPage* pMasterPage = pDoc->GetMasterSdPage(0, PageKind::Standard);
    // Rename the master page with master name
    pDoc->RenameLayoutTemplate(pMasterPage->GetLayoutName(), u"master"_ustr);
    OUString aMasterPageName = pMasterPage->GetName();
    CPPUNIT_ASSERT_EQUAL(u"master"_ustr, aMasterPageName);

    // Reselect the master page
    rSSController.GetPageSelector().DeselectAllPages();
    rSSController.GetPageSelector().SelectPage(pMasterPage);

    // Copy and paste the master page
    rSSController.GetClipboard().DoCopy(true);
    rSSController.GetClipboard().DoPaste(true);

    const sal_uInt16 nMasterPageCnt2 = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(sal_uInt16(2), nMasterPageCnt2);

    SdPage* pNewMasterPage = pDoc->GetMasterSdPage(1, PageKind::Standard);
    OUString aNewMasterPageName = pNewMasterPage->GetName();
    CPPUNIT_ASSERT_EQUAL(u"1_master"_ustr, aNewMasterPageName);

    // Reselect the master page
    rSSController.GetPageSelector().DeselectAllPages();
    rSSController.GetPageSelector().SelectPage(pMasterPage);

    // Copy again
    rSSController.GetClipboard().DoCopy(true);
    rSSController.GetClipboard().DoPaste(true);
    const sal_uInt16 nMasterPageCnt3 = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(3), nMasterPageCnt3);
    SdPage* pNewMasterPage2 = pDoc->GetMasterSdPage(2, PageKind::Standard);
    OUString aNewMasterPageName2 = pNewMasterPage2->GetName();
    CPPUNIT_ASSERT_EQUAL(u"2_master"_ustr, aNewMasterPageName2);

    // Reselect the master page
    rSSController.GetPageSelector().DeselectAllPages();
    rSSController.GetPageSelector().SelectPage(pMasterPage);

    // Copy again
    rSSController.GetClipboard().DoCopy(true);
    rSSController.GetClipboard().DoPaste(true);

    const sal_uInt16 nMasterPageCnt4 = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(4), nMasterPageCnt4);
    SdPage* pNewMasterPage3 = pDoc->GetMasterSdPage(3, PageKind::Standard);
    OUString aNewMasterPageName3 = pNewMasterPage3->GetName();
    CPPUNIT_ASSERT_EQUAL(u"3_master"_ustr, aNewMasterPageName3);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf45617_Double_Copy_Default)
{
    // Test master page name with double copy
    createSdImpressDoc();

    sd::slidesorter::SlideSorterViewShell* pSSVS = getSlideSorterViewShell();
    auto& rSSController = pSSVS->GetSlideSorter().GetController();
    // Set edit master page mode
    rSSController.ChangeEditMode(EditMode::MasterPage);

    SdXImpressDocument* pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    SdDrawDocument* pDoc = pXImpressDocument->GetDoc();

    // Get the master page name
    const sal_uInt16 nMasterPageCnt1 = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(sal_uInt16(1), nMasterPageCnt1);
    SdPage* pMasterPage = pDoc->GetMasterSdPage(0, PageKind::Standard);
    // Rename the master page with default name
    pDoc->RenameLayoutTemplate(pMasterPage->GetLayoutName(), u"Default"_ustr);
    OUString aMasterPageName = pMasterPage->GetName();
    CPPUNIT_ASSERT_EQUAL(u"Default"_ustr, aMasterPageName);

    // Reselect the master page
    rSSController.GetPageSelector().DeselectAllPages();
    rSSController.GetPageSelector().SelectPage(pMasterPage);

    // Copy and paste the master page
    rSSController.GetClipboard().DoCopy(true);
    rSSController.GetClipboard().DoPaste(true);

    const sal_uInt16 nMasterPageCnt2 = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(2), nMasterPageCnt2);

    SdPage* pNewMasterPage = pDoc->GetMasterSdPage(1, PageKind::Standard);
    OUString aNewMasterPageName = pNewMasterPage->GetName();
    CPPUNIT_ASSERT_EQUAL(u"1_Default"_ustr, aNewMasterPageName);

    // Reselect the master page
    rSSController.GetPageSelector().DeselectAllPages();
    rSSController.GetPageSelector().SelectPage(pMasterPage);
    // Copy again
    rSSController.GetClipboard().DoCopy(true);
    rSSController.GetClipboard().DoPaste(true);
    const sal_uInt16 nMasterPageCnt3 = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(3), nMasterPageCnt3);
    SdPage* pNewMasterPage2 = pDoc->GetMasterSdPage(2, PageKind::Standard);
    OUString aNewMasterPageName2 = pNewMasterPage2->GetName();
    CPPUNIT_ASSERT_EQUAL(u"2_Default"_ustr, aNewMasterPageName2);

    // Reselect the master page
    rSSController.GetPageSelector().DeselectAllPages();
    rSSController.GetPageSelector().SelectPage(pMasterPage);
    // Copy again
    rSSController.GetClipboard().DoCopy(true);
    rSSController.GetClipboard().DoPaste(true);
    const sal_uInt16 nMasterPageCnt4 = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(4), nMasterPageCnt4);
    SdPage* pNewMasterPage3 = pDoc->GetMasterSdPage(3, PageKind::Standard);
    OUString aNewMasterPageName3 = pNewMasterPage3->GetName();
    CPPUNIT_ASSERT_EQUAL(u"3_Default"_ustr, aNewMasterPageName3);
}
CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf45617_Double_Copy_CopiedPage)
{
    // Test master page name with double copy for copied page which doesn't have a normal page created
    createSdImpressDoc("odp/tdf96708.odp");
    sd::slidesorter::SlideSorterViewShell* pSSVS = getSlideSorterViewShell();
    auto& rSSController = pSSVS->GetSlideSorter().GetController();
    // Set edit master page mode
    rSSController.ChangeEditMode(EditMode::MasterPage);
    SdXImpressDocument* pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    SdDrawDocument* pDoc = pXImpressDocument->GetDoc();
    // Get the master page name
    const sal_uInt16 nMasterPageCnt1 = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(sal_uInt16(4), nMasterPageCnt1);
    SdPage* pMasterPage = pDoc->GetMasterSdPage(3, PageKind::Standard);
    OUString aMasterPageName = pMasterPage->GetName();
    CPPUNIT_ASSERT_EQUAL(u"Master3"_ustr, aMasterPageName);

    // Reselect the master page
    rSSController.GetPageSelector().DeselectAllPages();
    rSSController.GetPageSelector().SelectPage(pMasterPage);
    // Copy and paste the master page
    rSSController.GetClipboard().DoCopy(true);
    rSSController.GetClipboard().DoPaste(true);

    const sal_uInt16 nMasterPageCnt2 = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(5), nMasterPageCnt2);
    SdPage* pNewMasterPage = pDoc->GetMasterSdPage(4, PageKind::Standard);
    OUString aNewMasterPageName = pNewMasterPage->GetName();
    CPPUNIT_ASSERT_EQUAL(u"1_Master3"_ustr, aNewMasterPageName);

    // Reselect the master page
    rSSController.GetPageSelector().DeselectAllPages();
    rSSController.GetPageSelector().SelectPage(pNewMasterPage);
    // Copy again
    rSSController.GetClipboard().DoCopy(true);
    rSSController.GetClipboard().DoPaste(true);

    const sal_uInt16 nMasterPageCnt3 = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(6), nMasterPageCnt3);
    SdPage* pNewMasterPage2 = pDoc->GetMasterSdPage(5, PageKind::Standard);
    OUString aNewMasterPageName2 = pNewMasterPage2->GetName();
    CPPUNIT_ASSERT_EQUAL(u"2_Master3"_ustr, aNewMasterPageName2);

    // Reselect the master page
    rSSController.GetPageSelector().DeselectAllPages();
    rSSController.GetPageSelector().SelectPage(pNewMasterPage2);
    // Copy again
    rSSController.GetClipboard().DoCopy(true);
    rSSController.GetClipboard().DoPaste(true);

    const sal_uInt16 nMasterPageCnt4 = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(7), nMasterPageCnt4);
    SdPage* pNewMasterPage3 = pDoc->GetMasterSdPage(6, PageKind::Standard);
    OUString aNewMasterPageName3 = pNewMasterPage3->GetName();
    CPPUNIT_ASSERT_EQUAL(u"3_Master3"_ustr, aNewMasterPageName3);

    // Reselect the master page
    rSSController.GetPageSelector().DeselectAllPages();
    rSSController.GetPageSelector().SelectPage(pNewMasterPage);
    // Copy again
    rSSController.GetClipboard().DoCopy(true);
    rSSController.GetClipboard().DoPaste(true);

    const sal_uInt16 nMasterPageCnt5 = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(8), nMasterPageCnt5);
    SdPage* pNewMasterPage4 = pDoc->GetMasterSdPage(7, PageKind::Standard);
    OUString aNewMasterPageName4 = pNewMasterPage4->GetName();
    CPPUNIT_ASSERT_EQUAL(u"4_Master3"_ustr, aNewMasterPageName4);
}
CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testUndoMergeMasterPage)
{
    // Test undo for merging master pages only
    createSdImpressDoc("odp/tdf96708.odp");

    sd::slidesorter::SlideSorterViewShell* pSSVS = getSlideSorterViewShell();
    auto& rSSController = pSSVS->GetSlideSorter().GetController();

    // Get document and check initial master page count
    SdXImpressDocument* pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    SdDrawDocument* pDoc = pXImpressDocument->GetDoc();
    const sal_uInt16 nInitialMasterPageCount = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(sal_uInt16(4), nInitialMasterPageCount);

    // Copy and paste master page only
    rSSController.GetClipboard().DoCopy(true);
    rSSController.GetClipboard().DoPaste(true);

    // Check that a master page was added
    const sal_uInt16 nAfterPasteMasterPageCount = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(nInitialMasterPageCount + 1),
                         nAfterPasteMasterPageCount);

    // Undo the master page merge
    dispatchCommand(mxComponent, u".uno:Undo"_ustr, {});

    // Check that the master page count is back to the initial value
    const sal_uInt16 nAfterUndoMasterPageCount = pDoc->GetMasterSdPageCount(PageKind::Standard);
    CPPUNIT_ASSERT_EQUAL(nInitialMasterPageCount, nAfterUndoMasterPageCount);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf139996)
{
    createSdImpressDoc();

    sd::slidesorter::SlideSorterViewShell* pSSVS = getSlideSorterViewShell();
    auto& rSSController = pSSVS->GetSlideSorter().GetController();
    auto& rPageSelector = rSSController.GetPageSelector();

    CPPUNIT_ASSERT_EQUAL(1, rPageSelector.GetSelectedPageCount());

    rPageSelector.DeselectAllPages();

    CPPUNIT_ASSERT_EQUAL(0, rPageSelector.GetSelectedPageCount());

    // Without the fix in place, this test would have crashed here
    dispatchCommand(mxComponent, u".uno:MovePageUp"_ustr, {});

    dispatchCommand(mxComponent, u".uno:MovePageDown"_ustr, {});

    dispatchCommand(mxComponent, u".uno:MovePageTop"_ustr, {});

    dispatchCommand(mxComponent, u".uno:MovePageBottom"_ustr, {});

    CPPUNIT_ASSERT_EQUAL(0, rPageSelector.GetSelectedPageCount());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf128651)
{
    // Error was, that undo and redo changes size of the shape. Affected actions were e.g.
    // extrusion on/off, shadow on/off, changes on line or fill attributes.
    // All these actions do not change the snap rectangle.
    createSdImpressDoc("tdf128651_CustomShapeUndo.odp");
    auto pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pXImpressDocument->GetDocShell()->GetViewShell();
    SdPage* pActualPage = pViewShell->GetActualPage();
    SdrObject* pObject = pActualPage->GetObj(0);
    auto pCustomShape = dynamic_cast<SdrObjCustomShape*>(pObject);
    CPPUNIT_ASSERT_MESSAGE("No Shape", pCustomShape);
    const sal_Int32 nOrigWidth(pCustomShape->GetSnapRect().GetWidth());

    SdDrawDocument* pDocument = pXImpressDocument->GetDoc();
    sd::UndoManager* pUndoManager = pDocument->GetUndoManager();
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(0), pUndoManager->GetUndoActionCount());
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(0), pUndoManager->GetRedoActionCount());

    SdrView* pView = pViewShell->GetView();
    pView->MarkObj(pCustomShape, pView->GetSdrPageView());
    pViewShell->GetViewFrame()->GetDispatcher()->Execute(SID_EXTRUSION_TOGGLE,
                                                         SfxCallMode::SYNCHRON);
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(1), pUndoManager->GetUndoActionCount());

    pViewShell->GetViewFrame()->GetDispatcher()->Execute(SID_UNDO, SfxCallMode::SYNCHRON);
    const sal_Int32 nUndoWidth(pCustomShape->GetSnapRect().GetWidth());
    CPPUNIT_ASSERT_EQUAL_MESSAGE("Undo changes width", nOrigWidth, nUndoWidth);

    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(1), pUndoManager->GetRedoActionCount());
    pViewShell->GetViewFrame()->GetDispatcher()->Execute(SID_REDO, SfxCallMode::SYNCHRON);
    const sal_Int32 nRedoWidth(pCustomShape->GetSnapRect().GetWidth());
    CPPUNIT_ASSERT_EQUAL_MESSAGE("Redo changes width", nUndoWidth, nRedoWidth);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf126605)
{
    createSdImpressDoc();

    dispatchCommand(mxComponent, u".uno:InsertPage"_ustr, {});

    insertStringToObject(0, u"Test", /*bUseEscape*/ false);

    uno::Reference<drawing::XDrawPagesSupplier> xDrawPagesSupplier(mxComponent, uno::UNO_QUERY);
    uno::Reference<drawing::XDrawPage> xDrawPage(xDrawPagesSupplier->getDrawPages()->getByIndex(1),
                                                 uno::UNO_QUERY);

    uno::Reference<beans::XPropertySet> xShape(xDrawPage->getByIndex(0), uno::UNO_QUERY);

    uno::Reference<text::XText> xText
        = uno::Reference<text::XTextRange>(xShape, uno::UNO_QUERY_THROW)->getText();
    CPPUNIT_ASSERT_MESSAGE("Not a text shape", xText.is());

    uno::Reference<container::XEnumerationAccess> paraEnumAccess(xText, uno::UNO_QUERY);
    uno::Reference<container::XEnumeration> paraEnum(paraEnumAccess->createEnumeration());

    // Get first paragraph
    uno::Reference<text::XTextRange> xParagraph(paraEnum->nextElement(), uno::UNO_QUERY_THROW);
    uno::Reference<beans::XPropertySet> xPropSet(xParagraph, uno::UNO_QUERY_THROW);

    sal_Int16 nWritingMode = 0;
    xPropSet->getPropertyValue(u"WritingMode"_ustr) >>= nWritingMode;
    CPPUNIT_ASSERT_EQUAL(text::WritingMode2::LR_TB, nWritingMode);

    // Without the fix in place, this test would have crashed here
    dispatchCommand(mxComponent, u".uno:ParaRightToLeft"_ustr, {});

    xPropSet->getPropertyValue(u"WritingMode"_ustr) >>= nWritingMode;
    CPPUNIT_ASSERT_EQUAL(text::WritingMode2::RL_TB, nWritingMode);

    dispatchCommand(mxComponent, u".uno:ParaLeftToRight"_ustr, {});

    xPropSet->getPropertyValue(u"WritingMode"_ustr) >>= nWritingMode;
    CPPUNIT_ASSERT_EQUAL(text::WritingMode2::LR_TB, nWritingMode);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, tdf139269_prevent_pasting_into_readonly_master_objects)
{
    createSdImpressDoc();

    insertStringToObject(0, u"Test", /*bUseEscape*/ false);

    dispatchCommand(mxComponent, u".uno:SelectAll"_ustr, {});
    dispatchCommand(mxComponent, u".uno:Copy"_ustr, {});

    dispatchCommand(mxComponent, u".uno:SlideMasterPage"_ustr, {});

    // Use tab key to select the first object and try to type something to go
    // into edit mode although it's not possible to add text to it
    auto pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    typeKey(pXImpressDocument, KEY_TAB);
    typeString(pXImpressDocument, u"test");

    dispatchCommand(mxComponent, u".uno:Paste"_ustr, {});

    uno::Reference<drawing::XMasterPagesSupplier> xMasterPagesSupplier(mxComponent,
                                                                       uno::UNO_QUERY_THROW);
    uno::Reference<drawing::XDrawPages> xMasterPages(xMasterPagesSupplier->getMasterPages());
    CPPUNIT_ASSERT(xMasterPages.is());
    uno::Reference<drawing::XDrawPage> xDrawPage(xMasterPages->getByIndex(0), uno::UNO_QUERY);
    uno::Reference<text::XTextRange> xShape(xDrawPage->getByIndex(0), uno::UNO_QUERY);

    // Without the fix in place, this test would have failed with
    // - Expected: Click to edit the title text format
    // - Actual  : Click to edit the title text formatTest
    CPPUNIT_ASSERT_EQUAL(u"Click to edit the title text format"_ustr, xShape->getString());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf100950)
{
    createSdImpressDoc();

    dispatchCommand(mxComponent, u".uno:InsertPage"_ustr, {});

    dispatchCommand(mxComponent, u".uno:InsertPage"_ustr, {});

    insertStringToObject(0, u"Test", /*bUseEscape*/ true);

    dispatchCommand(mxComponent, u".uno:Undo"_ustr, {});

    sd::slidesorter::SlideSorterViewShell* pSSVS = getSlideSorterViewShell();
    auto& rSSController = pSSVS->GetSlideSorter().GetController();
    auto& rPageSelector = rSSController.GetPageSelector();

    // Without the fix in place, this test would have failed here
    CPPUNIT_ASSERT(rPageSelector.IsPageSelected(2));
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf130581_undo_hide_show_slide)
{
    createSdImpressDoc();

    // Hide slide and check the number of available undo actions
    dispatchCommand(mxComponent, u".uno:ShowSlide"_ustr, {});
    dispatchCommand(mxComponent, u".uno:HideSlide"_ustr, {});

    // There should be a single undo action, i.e., hide slide
    auto pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    SdDrawDocument* pDocument = pXImpressDocument->GetDoc();
    sd::UndoManager* pUndoManager = pDocument->GetUndoManager();
    // Check if there is the correct undo action, i.e., hide slide
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(1), pUndoManager->GetUndoActionCount());
    CPPUNIT_ASSERT_EQUAL(SdResId(STR_UNDO_HIDE_SLIDE), pUndoManager->GetUndoActionComment());
    sd::slidesorter::SlideSorterViewShell* pSSVS = getSlideSorterViewShell();

    // Check if the page is actually hidden
    auto& rSSController = pSSVS->GetSlideSorter().GetController();
    auto& rPageSelector = rSSController.GetPageSelector();
    CPPUNIT_ASSERT_EQUAL(true, rPageSelector.IsPageExcluded(0));

    // Undo hide slide action and check the number of available redo actions
    // including the correct undo action, i.e., hide slide
    dispatchCommand(mxComponent, u".uno:Undo"_ustr, {});
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(1), pUndoManager->GetRedoActionCount());
    CPPUNIT_ASSERT_EQUAL(SdResId(STR_UNDO_HIDE_SLIDE), pUndoManager->GetRedoActionComment());
    CPPUNIT_ASSERT_EQUAL(false, rPageSelector.IsPageExcluded(0));

    // Show slide and check the number of available undo actions
    dispatchCommand(mxComponent, u".uno:Redo"_ustr, {});
    CPPUNIT_ASSERT_EQUAL(true, rPageSelector.IsPageExcluded(0));
    dispatchCommand(mxComponent, u".uno:ShowSlide"_ustr, {});
    // There should be two undo actions, i.e., show and hide slide
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(2), pUndoManager->GetUndoActionCount());
    CPPUNIT_ASSERT_EQUAL(SdResId(STR_UNDO_SHOW_SLIDE), pUndoManager->GetUndoActionComment());
    CPPUNIT_ASSERT_EQUAL(false, rPageSelector.IsPageExcluded(0));

    // Undo show slide and check the number of available undo/redo actions
    dispatchCommand(mxComponent, u".uno:Undo"_ustr, {});
    // There should be one undo action, i.e., hide slide, and one redo action, i.e., show slide
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(1), pUndoManager->GetUndoActionCount());
    CPPUNIT_ASSERT_EQUAL(SdResId(STR_UNDO_HIDE_SLIDE), pUndoManager->GetUndoActionComment());
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(1), pUndoManager->GetRedoActionCount());
    CPPUNIT_ASSERT_EQUAL(SdResId(STR_UNDO_SHOW_SLIDE), pUndoManager->GetRedoActionComment());
    CPPUNIT_ASSERT_EQUAL(true, rPageSelector.IsPageExcluded(0));
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf129346)
{
    createSdImpressDoc();

    dispatchCommand(mxComponent, u".uno:DiaMode"_ustr, {});
    checkCurrentPageNumber(1);

    dispatchCommand(mxComponent, u".uno:InsertPage"_ustr, {});
    checkCurrentPageNumber(2);

    dispatchCommand(mxComponent, u".uno:Undo"_ustr, {});
    checkCurrentPageNumber(1);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testmoveSlides)
{
    createSdImpressDoc();

    auto pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pXImpressDocument->GetDocShell()->GetViewShell();

    cpo::uno::Sequence<beans::PropertyValue> aArgs(
        comphelper::InitPropertySequence({ { "PageName", cpo::uno::Any(u"Test 1"_ustr) },
                                           { "WhatLayout", cpo::uno::Any(sal_Int32(1)) },
                                           { "IsPageBack", cpo::uno::Any(false) },
                                           { "IsPageObj", cpo::uno::Any(false) } }));

    dispatchCommand(mxComponent, u".uno:InsertPage"_ustr, aArgs);
    checkCurrentPageNumber(2);

    CPPUNIT_ASSERT_EQUAL(u"Test 1"_ustr, pViewShell->GetActualPage()->GetName());

    aArgs = comphelper::InitPropertySequence({ { "PageName", cpo::uno::Any(u"Test 2"_ustr) },
                                               { "WhatLayout", cpo::uno::Any(sal_Int32(1)) },
                                               { "IsPageBack", cpo::uno::Any(false) },
                                               { "IsPageObj", cpo::uno::Any(false) } });

    dispatchCommand(mxComponent, u".uno:InsertPage"_ustr, aArgs);
    checkCurrentPageNumber(3);

    CPPUNIT_ASSERT_EQUAL(u"Test 2"_ustr, pViewShell->GetActualPage()->GetName());

    // Move slide 'Test 2' up
    for (size_t i = 2; i > 0; --i)
    {
        dispatchCommand(mxComponent, u".uno:MovePageUp"_ustr, {});
        checkCurrentPageNumber(i);
        CPPUNIT_ASSERT_EQUAL(u"Test 2"_ustr, pViewShell->GetActualPage()->GetName());
    }

    // Move slide 'Test 2' down
    for (size_t i = 2; i < 4; ++i)
    {
        dispatchCommand(mxComponent, u".uno:MovePageDown"_ustr, {});
        checkCurrentPageNumber(i);
        CPPUNIT_ASSERT_EQUAL(u"Test 2"_ustr, pViewShell->GetActualPage()->GetName());
    }

    // Move slide 'Test 2' to the top
    dispatchCommand(mxComponent, u".uno:MovePageFirst"_ustr, {});
    checkCurrentPageNumber(1);
    CPPUNIT_ASSERT_EQUAL(u"Test 2"_ustr, pViewShell->GetActualPage()->GetName());

    // Move slide 'Test 2' to the bottom
    dispatchCommand(mxComponent, u".uno:MovePageLast"_ustr, {});
    checkCurrentPageNumber(3);
    CPPUNIT_ASSERT_EQUAL(u"Test 2"_ustr, pViewShell->GetActualPage()->GetName());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf68320_hidden_pages_total_slide_count)
{
    createSdImpressDoc();

    dispatchCommand(mxComponent, u".uno:InsertPage"_ustr, {});
    dispatchCommand(mxComponent, u".uno:HideSlide"_ustr, {});
    dispatchCommand(mxComponent, u".uno:InsertPage"_ustr, {});
    checkCurrentPageNumber(3);

    insertStringToObject(0, u"Pages: ", /*bUseEscape*/ false);

    dispatchCommand(mxComponent, u".uno:InsertPagesField"_ustr, {});

    auto pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    typeString(pXImpressDocument, u"/");

    dispatchCommand(mxComponent, u".uno:InsertPageField"_ustr, {});

    dispatchCommand(mxComponent, u".uno:SelectAll"_ustr, {});
    dispatchCommand(mxComponent, u".uno:Cut"_ustr, {});

    cpo::uno::Sequence<beans::PropertyValue> aPropertyValues = comphelper::InitPropertySequence(
        { { "SelectedFormat",
            cpo::uno::Any(static_cast<sal_uInt32>(SotClipboardFormatId::STRING)) } });

    // Paste as Unformatted text in order to get the field's values
    dispatchCommand(mxComponent, u".uno:ClipboardFormatItems"_ustr, aPropertyValues);

    uno::Reference<drawing::XDrawPagesSupplier> xDrawPagesSupplier(mxComponent, uno::UNO_QUERY);
    uno::Reference<drawing::XDrawPage> xDrawPage(xDrawPagesSupplier->getDrawPages()->getByIndex(2),
                                                 uno::UNO_QUERY);
    uno::Reference<text::XTextRange> xShape(xDrawPage->getByIndex(0), uno::UNO_QUERY);

    // Without the fix in place, this test would have failed with
    // - Expected: Pages: 3/3
    // - Actual  : Pages: 2/3
    CPPUNIT_ASSERT_EQUAL(u"Pages: 3/3"_ustr, xShape->getString());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf148620)
{
    createSdImpressDoc();

    auto pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());

    uno::Reference<drawing::XDrawPagesSupplier> xDrawPagesSupplier(mxComponent, uno::UNO_QUERY);
    uno::Reference<drawing::XDrawPage> xDrawPage(xDrawPagesSupplier->getDrawPages()->getByIndex(0),
                                                 uno::UNO_QUERY);
    uno::Reference<text::XTextRange> xShape(xDrawPage->getByIndex(1), uno::UNO_QUERY);
    CPPUNIT_ASSERT_EQUAL(u""_ustr, xShape->getString());

    insertStringToObject(1, u"one", /*bUseEscape*/ false);
    typeKey(pXImpressDocument, KEY_RETURN);
    typeString(pXImpressDocument, u"two");
    typeKey(pXImpressDocument, KEY_RETURN);
    typeString(pXImpressDocument, u"three");
    typeKey(pXImpressDocument, KEY_RETURN);
    typeString(pXImpressDocument, u"four");
    typeKey(pXImpressDocument, KEY_RETURN);
    typeString(pXImpressDocument, u"five");
    typeKey(pXImpressDocument, KEY_RETURN);
    typeString(pXImpressDocument, u"six");

    CPPUNIT_ASSERT_EQUAL(u"One\nTwo\nThree\nFour\nFive\nsix"_ustr, xShape->getString());

    cpo::uno::Sequence<beans::PropertyValue> aArgs(
        comphelper::InitPropertySequence({ { "KeyModifier", cpo::uno::Any(sal_Int32(0)) } }));
    dispatchCommand(mxComponent, u".uno:OutlineUp"_ustr, aArgs);

    CPPUNIT_ASSERT_EQUAL(u"One\nTwo\nThree\nFour\nsix\nFive"_ustr, xShape->getString());

    dispatchCommand(mxComponent, u".uno:OutlineUp"_ustr, aArgs);

    CPPUNIT_ASSERT_EQUAL(u"One\nTwo\nThree\nsix\nFour\nFive"_ustr, xShape->getString());

    dispatchCommand(mxComponent, u".uno:OutlineUp"_ustr, aArgs);

    CPPUNIT_ASSERT_EQUAL(u"One\nTwo\nsix\nThree\nFour\nFive"_ustr, xShape->getString());

    dispatchCommand(mxComponent, u".uno:OutlineUp"_ustr, aArgs);

    CPPUNIT_ASSERT_EQUAL(u"One\nsix\nTwo\nThree\nFour\nFive"_ustr, xShape->getString());

    dispatchCommand(mxComponent, u".uno:OutlineUp"_ustr, aArgs);

    CPPUNIT_ASSERT_EQUAL(u"six\nOne\nTwo\nThree\nFour\nFive"_ustr, xShape->getString());

    dispatchCommand(mxComponent, u".uno:OutlineDown"_ustr, aArgs);

    CPPUNIT_ASSERT_EQUAL(u"One\nsix\nTwo\nThree\nFour\nFive"_ustr, xShape->getString());

    dispatchCommand(mxComponent, u".uno:OutlineDown"_ustr, aArgs);

    CPPUNIT_ASSERT_EQUAL(u"One\nTwo\nsix\nThree\nFour\nFive"_ustr, xShape->getString());

    dispatchCommand(mxComponent, u".uno:OutlineDown"_ustr, aArgs);

    CPPUNIT_ASSERT_EQUAL(u"One\nTwo\nThree\nsix\nFour\nFive"_ustr, xShape->getString());

    dispatchCommand(mxComponent, u".uno:OutlineDown"_ustr, aArgs);

    CPPUNIT_ASSERT_EQUAL(u"One\nTwo\nThree\nFour\nsix\nFive"_ustr, xShape->getString());

    dispatchCommand(mxComponent, u".uno:OutlineDown"_ustr, aArgs);

    CPPUNIT_ASSERT_EQUAL(u"One\nTwo\nThree\nFour\nFive\nsix"_ustr, xShape->getString());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf141703)
{
    createSdImpressDoc();

    auto pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());

    cpo::uno::Sequence<beans::PropertyValue> aArgs(comphelper::InitPropertySequence(
        { { "Rows", cpo::uno::Any(sal_Int32(2)) }, { "Columns", cpo::uno::Any(sal_Int32(2)) } }));

    dispatchCommand(mxComponent, u".uno:InsertTable"_ustr, aArgs);

    // Move to A1 using Alt + Tab and write 'A'
    for (int i = 0; i < 3; i++)
    {
        pXImpressDocument->postKeyEvent(KIT_KEYEVENT_KEYINPUT, 0, KEY_SHIFT | KEY_TAB);
        pXImpressDocument->postKeyEvent(KIT_KEYEVENT_KEYUP, 0, KEY_SHIFT | KEY_TAB);
        Scheduler::ProcessEventsToIdle();
    }

    typeString(pXImpressDocument, u"A");

    // Move to A2 with Tab and write 'B'
    typeKey(pXImpressDocument, KEY_TAB);

    typeString(pXImpressDocument, u"B");

    typeKey(pXImpressDocument, KEY_ESCAPE);

    sd::ViewShell* pViewShell = pXImpressDocument->GetDocShell()->GetViewShell();
    SdPage* pActualPage = pViewShell->GetActualPage();
    auto pTableObject = dynamic_cast<sdr::table::SdrTableObj*>(pActualPage->GetObj(2));
    CPPUNIT_ASSERT(pTableObject);

    uno::Reference<css::table::XTable> xTable(pTableObject->getTable(), uno::UNO_SET_THROW);
    uno::Reference<css::table::XMergeableCell> xCellA1(xTable->getCellByPosition(0, 0),
                                                       uno::UNO_QUERY_THROW);
    uno::Reference<css::table::XMergeableCell> xCellA2(xTable->getCellByPosition(1, 0),
                                                       uno::UNO_QUERY_THROW);

    uno::Reference<text::XText> xTextA1
        = uno::Reference<text::XTextRange>(xCellA1, uno::UNO_QUERY_THROW)->getText();

    // Without the fix in place, this test would have failed with
    // - Expected: A
    // - Actual  :
    CPPUNIT_ASSERT_EQUAL(u"A"_ustr, xTextA1->getString());

    uno::Reference<text::XText> xTextA2
        = uno::Reference<text::XTextRange>(xCellA2, uno::UNO_QUERY_THROW)->getText();
    CPPUNIT_ASSERT_EQUAL(u"B"_ustr, xTextA2->getString());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf164855)
{
    createSdImpressDoc();

    cpo::uno::Sequence<beans::PropertyValue> aArgs(comphelper::InitPropertySequence(
        { { "Rows", cpo::uno::Any(sal_Int32(2)) }, { "Columns", cpo::uno::Any(sal_Int32(2)) } }));

    dispatchCommand(mxComponent, u".uno:InsertTable"_ustr, aArgs);

    auto pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pXImpressDocument->GetDocShell()->GetViewShell();
    SdPage* pActualPage = pViewShell->GetActualPage();
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(3), pActualPage->GetObjCount());

    auto pTableObject = dynamic_cast<sdr::table::SdrTableObj*>(pActualPage->GetObj(2));
    CPPUNIT_ASSERT(pTableObject);

    const EditTextObject& rEdit
        = pTableObject->getText(0)->GetOutlinerParaObject()->GetTextObject();
    const SfxItemSet& rParaAttribs = rEdit.GetParaAttribs(0);
    auto pAdjust = rParaAttribs.GetItem(EE_PARA_JUST);
    CPPUNIT_ASSERT_EQUAL(SvxAdjust::Left, pAdjust->GetAdjust());

    // Without the fix in place, this test would have crashed here
    dispatchCommand(mxComponent, u".uno:RightPara"_ustr, {});

    const EditTextObject& rEdit2
        = pTableObject->getText(0)->GetOutlinerParaObject()->GetTextObject();
    const SfxItemSet& rParaAttribs2 = rEdit2.GetParaAttribs(0);
    pAdjust = rParaAttribs2.GetItem(EE_PARA_JUST);
    CPPUNIT_ASSERT_EQUAL(SvxAdjust::Right, pAdjust->GetAdjust());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf127481)
{
    createSdImpressDoc();

    auto pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pXImpressDocument->GetDocShell()->GetViewShell();
    SdPage* pActualPage = pViewShell->GetActualPage();
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(2), pActualPage->GetObjCount());

    cpo::uno::Sequence<beans::PropertyValue> aArgs(comphelper::InitPropertySequence(
        { { "Rows", cpo::uno::Any(sal_Int32(1)) }, { "Columns", cpo::uno::Any(sal_Int32(1)) } }));

    dispatchCommand(mxComponent, u".uno:InsertTable"_ustr, aArgs);

    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(3), pActualPage->GetObjCount());

    dispatchCommand(mxComponent, u".uno:DuplicatePage"_ustr, aArgs);

    checkCurrentPageNumber(2);

    pActualPage = pViewShell->GetActualPage();
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(3), pActualPage->GetObjCount());

    auto pTableObject = dynamic_cast<sdr::table::SdrTableObj*>(pActualPage->GetObj(2));
    CPPUNIT_ASSERT(pTableObject);

    //without the fix, it would crash here
    pViewShell->GetView()->SdrBeginTextEdit(pTableObject);

    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(3), pActualPage->GetObjCount());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testPageFillColor)
{
    // Load the document and create two new windows.
    createSdImpressDoc("tdf126197.odp");
    auto pImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pImpressDocument->GetDocShell()->GetViewShell();

    // Set FillPageColor

    cpo::uno::Sequence<beans::PropertyValue> aPropertyValues = {
        comphelper::makePropertyValue(u"FillColor"_ustr, static_cast<sal_Int32>(0xff0000)),
    };
    dispatchCommand(mxComponent, u".uno:FillPageColor"_ustr, aPropertyValues);

    SdPage* pPage = pViewShell->getCurrentPage();
    const SfxItemSet& rPageAttr = pPage->getSdrPageProperties().GetItemSet();

    const XFillStyleItem* pFillStyle = rPageAttr.GetItem(XATTR_FILLSTYLE);
    drawing::FillStyle eXFS = pFillStyle->GetValue();
    CPPUNIT_ASSERT_EQUAL(drawing::FillStyle_SOLID, eXFS);

    Color aColor = rPageAttr.GetItem(XATTR_FILLCOLOR)->GetColorValue();
    CPPUNIT_ASSERT_EQUAL(COL_LIGHTRED, aColor);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testPageFillGradient)
{
    // Load the document and create two new windows.
    createSdImpressDoc("tdf126197.odp");
    auto pImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pImpressDocument->GetDocShell()->GetViewShell();

    // Set FillPageColor

    cpo::uno::Sequence<beans::PropertyValue> aPropertyValues(comphelper::InitPropertySequence({
        { "FillPageGradientJSON",
          cpo::uno::Any(
              u"{\"style\":\"LINEAR\",\"startcolor\":\"ff0000\",\"endcolor\":\"0000ff\","
              "\"angle\":\"300\",\"border\":\"0\",\"x\":\"0\",\"y\":\"0\",\"intensstart\":"
              "\"100\",\"intensend\":\"100\",\"stepcount\":\"0\"}"_ustr) },
    }));

    dispatchCommand(mxComponent, u".uno:FillPageGradient"_ustr, aPropertyValues);

    SdPage* pPage = pViewShell->getCurrentPage();
    const SfxItemSet& rPageAttr = pPage->getSdrPageProperties().GetItemSet();

    const XFillStyleItem* pFillStyle = rPageAttr.GetItem(XATTR_FILLSTYLE);
    drawing::FillStyle eXFS = pFillStyle->GetValue();
    CPPUNIT_ASSERT_EQUAL(drawing::FillStyle_GRADIENT, eXFS);

    basegfx::BGradient aGradient(rPageAttr.GetItem(XATTR_FILLGRADIENT)->GetGradientValue());
    const basegfx::BColorStops& rColorStops(aGradient.GetColorStops());

    CPPUNIT_ASSERT_EQUAL(size_t(2), rColorStops.size());
    CPPUNIT_ASSERT_EQUAL(0.0, rColorStops.getStopOffset(0));
    CPPUNIT_ASSERT_EQUAL(COL_LIGHTRED, Color(rColorStops.getStopColor(0)));
    CPPUNIT_ASSERT(basegfx::fTools::equal(rColorStops.getStopOffset(1), 1.0));
    CPPUNIT_ASSERT_EQUAL(COL_LIGHTBLUE, Color(rColorStops.getStopColor(1)));
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf134053)
{
    // Error was, that dashes and dots were longer than in MS Office.
    createSdImpressDoc("pptx/tdf134053_dashdot.pptx");
    auto pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pXImpressDocument->GetDocShell()->GetViewShell();
    SdPage* pActualPage = pViewShell->GetActualPage();
    SdrObject* pShape = pActualPage->GetObj(0);
    CPPUNIT_ASSERT_MESSAGE("No Shape", pShape);

    SdDrawDocument* pDocument = pXImpressDocument->GetDoc();
    sd::UndoManager* pUndoManager = pDocument->GetUndoManager();

    // tdf#114613: Without the fix in place, this test would have failed with
    // - Expected: 0
    // - Actual  : 8
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(0), pUndoManager->GetUndoActionCount());
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(0), pUndoManager->GetRedoActionCount());

    XDash dash = pShape->GetMergedItem(XATTR_LINEDASH).GetDashValue();

    // Because 0% is not possible as dash length (as of June 2020) 1% is used in the fix.
    CPPUNIT_ASSERT_EQUAL_MESSAGE("Distance", 399.0, dash.GetDistance());
    CPPUNIT_ASSERT_EQUAL_MESSAGE("Dot length", 301.0, dash.GetDotLen());
    CPPUNIT_ASSERT_EQUAL_MESSAGE("Dash length", 1.0, dash.GetDashLen());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testSpellOnlineParameter)
{
    createSdImpressDoc();
    auto pImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    bool bSet = pImpressDocument->GetDoc()->GetOnlineSpell();

    cpo::uno::Sequence<beans::PropertyValue> params(
        comphelper::InitPropertySequence({ { "Enable", cpo::uno::Any(!bSet) } }));
    dispatchCommand(mxComponent, u".uno:SpellOnline"_ustr, params);
    CPPUNIT_ASSERT_EQUAL(!bSet, pImpressDocument->GetDoc()->GetOnlineSpell());

    // set the same state as now and we don't expect any change (no-toggle)
    params = comphelper::InitPropertySequence({ { "Enable", cpo::uno::Any(!bSet) } });
    dispatchCommand(mxComponent, u".uno:SpellOnline"_ustr, params);
    CPPUNIT_ASSERT_EQUAL(!bSet, pImpressDocument->GetDoc()->GetOnlineSpell());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf38669)
{
    createSdImpressDoc();
    auto pImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    CPPUNIT_ASSERT(pImpressDocument);

    // Insert shape with ctrl key
    cpo::uno::Sequence<beans::PropertyValue> aArgs(
        comphelper::InitPropertySequence({ { "KeyModifier", cpo::uno::Any(KEY_MOD1) } }));
    dispatchCommand(mxComponent, u".uno:BasicShapes.rectangle"_ustr, aArgs);

    uno::Reference<drawing::XDrawPagesSupplier> xDrawPagesSupplier(mxComponent, uno::UNO_QUERY);
    uno::Reference<drawing::XDrawPage> xDrawPage(xDrawPagesSupplier->getDrawPages()->getByIndex(0),
                                                 uno::UNO_QUERY);
    CPPUNIT_ASSERT_EQUAL(sal_Int32(3), xDrawPage->getCount());

    typeString(pImpressDocument, u"°");

    uno::Reference<text::XTextRange> xShape(xDrawPage->getByIndex(2), uno::UNO_QUERY);
    // Without the fix in place, this test would have failed with:
    // - Expected: °
    // - Actual  : ㅀ
    CPPUNIT_ASSERT_EQUAL(u"°"_ustr, xShape->getString());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf151417)
{
    createSdImpressDoc();
    auto pImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    CPPUNIT_ASSERT(pImpressDocument);

    uno::Reference<drawing::XDrawPagesSupplier> xDrawPagesSupplier(mxComponent, uno::UNO_QUERY);
    uno::Reference<container::XIndexAccess> xDraws = xDrawPagesSupplier->getDrawPages();
    CPPUNIT_ASSERT_EQUAL(sal_Int32(1), xDraws->getCount());

    uno::Reference<drawing::XDrawPage> xDrawPage(xDrawPagesSupplier->getDrawPages()->getByIndex(0),
                                                 uno::UNO_QUERY);
    CPPUNIT_ASSERT_EQUAL(sal_Int32(2), xDrawPage->getCount());

    cpo::uno::Sequence<beans::PropertyValue> aArgs(
        comphelper::InitPropertySequence({ { "KeyModifier", cpo::uno::Any(KEY_MOD1) } }));

    // Without the fix in place, this test would have crashed here
    dispatchCommand(mxComponent, u".uno:Edit"_ustr, aArgs);

    CPPUNIT_ASSERT_EQUAL(sal_Int32(3), xDrawPage->getCount());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf123841)
{
    // To check if selecting unfilled rectangle produces unfilled rectangle
    createSdImpressDoc();
    auto pImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    CPPUNIT_ASSERT(pImpressDocument);

    cpo::uno::Sequence<beans::PropertyValue> aArgs(
        comphelper::InitPropertySequence({ { "KeyModifier", cpo::uno::Any(KEY_MOD1) } }));
    dispatchCommand(mxComponent, u".uno:Rect_Unfilled"_ustr, aArgs);

    uno::Reference<drawing::XDrawPagesSupplier> xDrawPagesSupplier(mxComponent, uno::UNO_QUERY);
    uno::Reference<drawing::XDrawPage> xDrawPage(xDrawPagesSupplier->getDrawPages()->getByIndex(0),
                                                 uno::UNO_QUERY);

    CPPUNIT_ASSERT_EQUAL(sal_Int32(3), xDrawPage->getCount());

    for (int i = 0; i < 3; i++)
    {
        uno::Reference<beans::XPropertySet> XPropSet(xDrawPage->getByIndex(i), uno::UNO_QUERY);
        drawing::FillStyle eFillStyle = drawing::FillStyle_NONE;
        XPropSet->getPropertyValue(u"FillStyle"_ustr) >>= eFillStyle;

        // Without the fix in place, this test would have failed with
        // with drawing::FillStyle_NONE != drawing::FillStyle_SOLID
        CPPUNIT_ASSERT_EQUAL(drawing::FillStyle_NONE, eFillStyle);
    }
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testSearchAllInDocumentAndNotes)
{
    // tdf#142478
    // "find all" produces a crash when the search string exists in notes
    // and the document

    createSdImpressDoc("odp/search-all-notes.odp");

    auto pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pXImpressDocument->GetDocShell()->GetViewShell();
    CPPUNIT_ASSERT(pViewShell);

    lcl_search(u"Crash"_ustr, /*bFindAll=*/true, /*bBackwards=*/true);
}

#if !defined(_WIN32) && !defined(MACOSX)
// for some reason, the search for "second" (or "Second") didn't return page 2 in WIN and MACOS
CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf123658_SearchAfterSlideChange)
{
    createSdImpressDoc("odp/tdf123658_SearchAfterSlideChange.odp");

    auto pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());

    lcl_search(u"second"_ustr);
    checkCurrentPageNumber(2);

    pXImpressDocument->setPart(0); // Switch to 1st page

    lcl_search(u"of"_ustr);
    // Instead of finding this on the 1st page (or on the 2nd page would be acceptable too)
    // it was going to the third page.
    checkCurrentPageNumber(1);
}
#endif

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testCharColorTheme)
{
    // Given an Impress document with a shape, with its text selected:
    createSdImpressDoc();
    uno::Reference<drawing::XDrawPagesSupplier> xPagesSupplier(mxComponent, uno::UNO_QUERY);
    uno::Reference<drawing::XDrawPage> xPage(xPagesSupplier->getDrawPages()->getByIndex(0),
                                             uno::UNO_QUERY);
    uno::Reference<text::XTextRange> xShape(xPage->getByIndex(0), uno::UNO_QUERY);
    {
        uno::Reference<text::XSimpleText> xText = xShape->getText();
        xText->insertString(xText->getStart(), u"test"_ustr, false);
    }
    uno::Reference<frame::XModel> xModel(mxComponent, uno::UNO_QUERY);
    uno::Reference<view::XSelectionSupplier> xController(xModel->getCurrentController(),
                                                         uno::UNO_QUERY);
    xController->select(cpo::uno::Any(xShape));
    Scheduler::ProcessEventsToIdle();
    dispatchCommand(mxComponent, u".uno:Text"_ustr, {});
    auto pImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pImpressDocument->GetDocShell()->GetViewShell();
    SdrView* pView = pViewShell->GetView();
    CPPUNIT_ASSERT(pView->IsTextEdit());
    dispatchCommand(mxComponent, u".uno:SelectAll"_ustr, {});

    // When picking a theme color on the sidebar:
    {
        model::ComplexColor aComplexColor;
        aComplexColor.setThemeColor(model::ThemeColorType::Accent1);
        aComplexColor.addTransformation({ model::TransformationType::LumMod, 2000 });
        aComplexColor.addTransformation({ model::TransformationType::LumOff, 8000 });

        OUString aJSON
            = OStringToOUString(model::color::convertToJSON(aComplexColor), RTL_TEXTENCODING_UTF8);

        // When setting the fill color of that shape, with theme metadata & effects:
        cpo::uno::Sequence<beans::PropertyValue> aColorArgs = {
            comphelper::makePropertyValue(u"Color.Color"_ustr,
                                          sal_Int32(0xdae3f3)), // 80% light blue
            comphelper::makePropertyValue(u"Color.ComplexColorJSON"_ustr, cpo::uno::Any(aJSON)),
        };
        dispatchCommand(mxComponent, u".uno:Color"_ustr, aColorArgs);
    }

    // Then make sure the theme "metadata" is set in the document model:
    pView->EndTextEditCurrentView();
    CPPUNIT_ASSERT(!pView->IsTextEdit());
    uno::Reference<container::XEnumerationAccess> xShapeParaAccess(xShape, uno::UNO_QUERY);
    uno::Reference<container::XEnumerationAccess> xPara(
        xShapeParaAccess->createEnumeration()->nextElement(), uno::UNO_QUERY);
    uno::Reference<beans::XPropertySet> xPortion(xPara->createEnumeration()->nextElement(),
                                                 uno::UNO_QUERY);
    {
        uno::Reference<util::XComplexColor> xComplexColor;
        CPPUNIT_ASSERT(xPortion->getPropertyValue(u"CharComplexColor"_ustr) >>= xComplexColor);
        CPPUNIT_ASSERT(xComplexColor.is());
        auto aComplexColor = model::color::getFromXComplexColor(xComplexColor);
        CPPUNIT_ASSERT_EQUAL(model::ThemeColorType::Accent1, aComplexColor.getThemeColorType());
        CPPUNIT_ASSERT_EQUAL(model::TransformationType::LumMod,
                             aComplexColor.getTransformations()[0].meType);
        CPPUNIT_ASSERT_EQUAL(static_cast<sal_Int32>(2000),
                             aComplexColor.getTransformations()[0].mnValue);
        CPPUNIT_ASSERT_EQUAL(model::TransformationType::LumOff,
                             aComplexColor.getTransformations()[1].meType);
        CPPUNIT_ASSERT_EQUAL(static_cast<sal_Int32>(8000),
                             aComplexColor.getTransformations()[1].mnValue);
    }
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testFillColorTheme)
{
    // Given an Impress document with a selected shape:
    createSdImpressDoc();
    uno::Reference<drawing::XDrawPagesSupplier> xPagesSupplier(mxComponent, uno::UNO_QUERY);
    uno::Reference<drawing::XDrawPage> xPage(xPagesSupplier->getDrawPages()->getByIndex(0),
                                             uno::UNO_QUERY);
    uno::Reference<beans::XPropertySet> xShape(xPage->getByIndex(0), uno::UNO_QUERY);
    uno::Reference<frame::XModel> xModel(mxComponent, uno::UNO_QUERY);
    uno::Reference<view::XSelectionSupplier> xController(xModel->getCurrentController(),
                                                         uno::UNO_QUERY);
    xController->select(cpo::uno::Any(xShape));

    // Change fill color
    {
        model::ComplexColor aComplexColor;
        aComplexColor.setThemeColor(model::ThemeColorType::Accent1);
        aComplexColor.addTransformation({ model::TransformationType::LumMod, 4000 });
        aComplexColor.addTransformation({ model::TransformationType::LumOff, 6000 });

        OUString aJSON
            = OStringToOUString(model::color::convertToJSON(aComplexColor), RTL_TEXTENCODING_UTF8);

        // When setting the fill color of that shape, with theme metadata & effects:
        cpo::uno::Sequence<beans::PropertyValue> aColorArgs = {
            comphelper::makePropertyValue(u"FillColor.Color"_ustr, sal_Int32(0xed7d31)), // orange
            comphelper::makePropertyValue(u"FillColor.ComplexColorJSON"_ustr,
                                          cpo::uno::Any(aJSON)), // accent 1
        };
        dispatchCommand(mxComponent, u".uno:FillColor"_ustr, aColorArgs);
    }

    // Then make sure the theme index is not lost when the sidebar sets it:
    {
        uno::Reference<util::XComplexColor> xComplexColor;
        CPPUNIT_ASSERT(xShape->getPropertyValue(u"FillComplexColor"_ustr) >>= xComplexColor);
        CPPUNIT_ASSERT(xComplexColor.is());
        auto aComplexColor = model::color::getFromXComplexColor(xComplexColor);
        CPPUNIT_ASSERT_EQUAL(model::ThemeColorType::Accent1, aComplexColor.getThemeColorType());
        CPPUNIT_ASSERT_EQUAL(model::TransformationType::LumMod,
                             aComplexColor.getTransformations()[0].meType);
        CPPUNIT_ASSERT_EQUAL(static_cast<sal_Int32>(4000),
                             aComplexColor.getTransformations()[0].mnValue);
        CPPUNIT_ASSERT_EQUAL(model::TransformationType::LumOff,
                             aComplexColor.getTransformations()[1].meType);
        CPPUNIT_ASSERT_EQUAL(static_cast<sal_Int32>(6000),
                             aComplexColor.getTransformations()[1].mnValue);
    }
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf163805)
{
    createSdImpressDoc();

    uno::Reference<beans::XPropertySet> xShape(getShapeFromPage(0, 0));

    drawing::FillStyle eFillStyle;
    Color aColor;
    CPPUNIT_ASSERT(xShape->getPropertyValue(u"FillStyle"_ustr) >>= eFillStyle);
    CPPUNIT_ASSERT_EQUAL(int(drawing::FillStyle_NONE), static_cast<int>(eFillStyle));
    CPPUNIT_ASSERT(xShape->getPropertyValue(u"FillColor"_ustr) >>= aColor);
    CPPUNIT_ASSERT_EQUAL(Color(0x729fcf), aColor);

    uno::Reference<frame::XModel> xModel(mxComponent, uno::UNO_QUERY);
    uno::Reference<view::XSelectionSupplier> xController(xModel->getCurrentController(),
                                                         uno::UNO_QUERY);
    xController->select(cpo::uno::Any(xShape));

    cpo::uno::Sequence<beans::PropertyValue> aColorArgs
        = { comphelper::makePropertyValue(u"FillColor.Color"_ustr, sal_Int32(0x800000)) };
    dispatchCommand(mxComponent, u".uno:FillColor"_ustr, aColorArgs);

    CPPUNIT_ASSERT(xShape->getPropertyValue(u"FillStyle"_ustr) >>= eFillStyle);

    // Without the fix in place, this test would have failed with
    // - Expected: 1
    // - Actual  : 0
    CPPUNIT_ASSERT_EQUAL(int(drawing::FillStyle_SOLID), static_cast<int>(eFillStyle));
    CPPUNIT_ASSERT(xShape->getPropertyValue(u"FillColor"_ustr) >>= aColor);
    CPPUNIT_ASSERT_EQUAL(COL_RED, aColor);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testFillColorNoColor)
{
    // Given an empty Impress document:
    createSdImpressDoc();
    auto pImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pImpressDocument->GetDocShell()->GetViewShell();
    SfxDispatcher* pDispatcher = pViewShell->GetViewFrame()->GetDispatcher();

    // When dispatching a fill color that only has a fill style (no color), then make sure we don't
    // crash:
    XFillStyleItem aXFillStyleItem(drawing::FillStyle_NONE);
    pDispatcher->ExecuteList(SID_ATTR_FILL_COLOR, SfxCallMode::RECORD, { &aXFillStyleItem });
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf153161)
{
    createSdImpressDoc("odp/tdf153161_FlushToSave.odp");

    uno::Reference<drawing::XDrawPagesSupplier> xDrawPagesSupplier(mxComponent, uno::UNO_QUERY);
    uno::Reference<drawing::XDrawPage> xDrawPage(xDrawPagesSupplier->getDrawPages()->getByIndex(0),
                                                 uno::UNO_QUERY);
    uno::Reference<text::XTextRange> xShape(xDrawPage->getByIndex(1), uno::UNO_QUERY);
    OUString sOldText(xShape->getString());
    CPPUNIT_ASSERT(sOldText.startsWith(u"在没有版本控制系统的时期"));

    // Type something, getting into text editing mode (appending) automatically
    insertStringToObject(1, u"Foo Bar", /*bUseEscape*/ false);

    saveAndReload(TestFilter::ODP);

    xDrawPagesSupplier.set(mxComponent, uno::UNO_QUERY);
    xDrawPage.set(xDrawPagesSupplier->getDrawPages()->getByIndex(0), uno::UNO_QUERY);
    xShape.set(xDrawPage->getByIndex(1), uno::UNO_QUERY);
    OUString sExpectedText = sOldText + "Foo Bar";
    CPPUNIT_ASSERT_EQUAL(sExpectedText, xShape->getString());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf148810)
{
    createSdImpressDoc("pptx/tdf148810_PARA_OUTLLEVEL.pptx");

    // type something to get into text editing mode (instead of shape selection).
    insertStringToObject(1, u"x", /*bUseEscape*/ false);

    auto pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    typeKey(pXImpressDocument, KEY_HOME);

    typeKey(pXImpressDocument, KEY_BACKSPACE);

    uno::Reference<beans::XPropertySet> xShape(getShapeFromPage(1, 0));
    uno::Reference<text::XTextRange> xParagraph(getParagraphFromShape(0, xShape));
    uno::Reference<beans::XPropertySet> xPropSet(xParagraph, uno::UNO_QUERY_THROW);
    sal_Int16 nNumberingLevel = -1;
    xPropSet->getPropertyValue(u"NumberingLevel"_ustr) >>= nNumberingLevel;
    CPPUNIT_ASSERT_EQUAL(sal_Int16(0), nNumberingLevel);

    dispatchCommand(mxComponent, u".uno:Undo"_ustr, {});

    nNumberingLevel = -1;
    xPropSet->getPropertyValue(u"NumberingLevel"_ustr) >>= nNumberingLevel;

    // Without the fix in place, this test would have failed with
    // - Expected: 0
    // - Actual  : -1
    CPPUNIT_ASSERT_EQUAL(sal_Int16(0), nNumberingLevel);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf127696)
{
    createSdImpressDoc();

    dispatchCommand(mxComponent, u".uno:InsertPage"_ustr, {});

    insertStringToObject(0, u"Test", /*bUseEscape*/ false);
    dispatchCommand(mxComponent, u".uno:SelectAll"_ustr, {});
    dispatchCommand(mxComponent, u".uno:OutlineFont"_ustr, {});

    // Save it as PPTX and load it again.
    saveAndReload(TestFilter::PPTX);

    uno::Reference<drawing::XDrawPagesSupplier> xDrawPagesSupplier(mxComponent, uno::UNO_QUERY);
    uno::Reference<drawing::XDrawPage> xDrawPage(xDrawPagesSupplier->getDrawPages()->getByIndex(1),
                                                 uno::UNO_QUERY);

    uno::Reference<beans::XPropertySet> xShape(xDrawPage->getByIndex(0), uno::UNO_QUERY);

    uno::Reference<text::XText> xText
        = uno::Reference<text::XTextRange>(xShape, uno::UNO_QUERY_THROW)->getText();
    CPPUNIT_ASSERT_MESSAGE("Not a text shape", xText.is());

    uno::Reference<container::XEnumerationAccess> paraEnumAccess(xText, uno::UNO_QUERY);
    uno::Reference<container::XEnumeration> paraEnum(paraEnumAccess->createEnumeration());

    uno::Reference<text::XTextRange> xParagraph(paraEnum->nextElement(), uno::UNO_QUERY_THROW);

    uno::Reference<container::XEnumerationAccess> runEnumAccess(xParagraph, uno::UNO_QUERY);
    uno::Reference<container::XEnumeration> runEnum = runEnumAccess->createEnumeration();

    uno::Reference<text::XTextRange> xRun(runEnum->nextElement(), uno::UNO_QUERY);
    uno::Reference<beans::XPropertySet> xPropSet(xRun, uno::UNO_QUERY_THROW);

    bool bContoured = false;
    xPropSet->getPropertyValue(u"CharContoured"_ustr) >>= bContoured;
    CPPUNIT_ASSERT(bContoured);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testThemeShapeInsert)
{
    // Given a document with a theme, accent1 color is set to 0x000004:
    createSdImpressDoc();
    uno::Reference<drawing::XDrawPagesSupplier> xDrawPagesSupplier(mxComponent, uno::UNO_QUERY);
    uno::Reference<drawing::XDrawPage> xDrawPage(xDrawPagesSupplier->getDrawPages()->getByIndex(0),
                                                 uno::UNO_QUERY);
    uno::Reference<drawing::XMasterPageTarget> xMasterPageTarget(xDrawPage, uno::UNO_QUERY);
    uno::Reference<beans::XPropertySet> xMasterPage(xMasterPageTarget->getMasterPage(),
                                                    uno::UNO_QUERY);

    auto pTheme = std::make_shared<model::Theme>("mytheme");
    auto pColorSet = std::make_shared<model::ColorSet>("mycolorscheme");
    pColorSet->add(model::ThemeColorType::Dark1, 0x0);
    pColorSet->add(model::ThemeColorType::Light1, 0x1);
    pColorSet->add(model::ThemeColorType::Dark2, 0x2);
    pColorSet->add(model::ThemeColorType::Light2, 0x3);
    pColorSet->add(model::ThemeColorType::Accent1, 0x4);
    pColorSet->add(model::ThemeColorType::Accent2, 0x5);
    pColorSet->add(model::ThemeColorType::Accent3, 0x6);
    pColorSet->add(model::ThemeColorType::Accent4, 0x7);
    pColorSet->add(model::ThemeColorType::Accent5, 0x8);
    pColorSet->add(model::ThemeColorType::Accent6, 0x9);
    pColorSet->add(model::ThemeColorType::Hyperlink, 0xa);
    pColorSet->add(model::ThemeColorType::FollowedHyperlink, 0xb);
    pTheme->setColorSet(pColorSet);

    xMasterPage->setPropertyValue(u"Theme"_ustr, cpo::uno::Any(model::theme::createXTheme(pTheme)));

    // When inserting a shape:
    cpo::uno::Sequence<beans::PropertyValue> aArgs = {
        comphelper::makePropertyValue(u"CreateDirectly"_ustr, true),
    };

    dispatchCommand(mxComponent, u".uno:BasicShapes.round-rectangle"_ustr, aArgs);

    // Then make sure the that fill color of the last shape is the accent1 color:
    sal_Int32 nShapeIndex = xDrawPage->getCount() - 1;
    uno::Reference<beans::XPropertySet> xShape(xDrawPage->getByIndex(nShapeIndex), uno::UNO_QUERY);
    sal_Int32 nFillColor{};
    xShape->getPropertyValue(u"FillColor"_ustr) >>= nFillColor;

    CPPUNIT_ASSERT_EQUAL(static_cast<sal_Int32>(0x4), nFillColor);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testTdf168835)
{
    createSdImpressDoc("pptx/tdf168835.pptx");
    checkCurrentPageNumber(1);

    dispatchCommand(mxComponent, u".uno:InsertPage"_ustr, {});
    checkCurrentPageNumber(2);

    insertStringToObject(0, u"Title of the second slide", /*bUseEscape*/ true);

    uno::Reference<drawing::XDrawPagesSupplier> xDrawPagesSupplier(mxComponent, uno::UNO_QUERY);
    uno::Reference<drawing::XDrawPage> xDrawPage(xDrawPagesSupplier->getDrawPages()->getByIndex(1),
                                                 uno::UNO_QUERY);

    uno::Reference<beans::XPropertySet> xShape(xDrawPage->getByIndex(0), uno::UNO_QUERY);
    uno::Reference<text::XTextRange> xParagraph(getParagraphFromShape(0, xShape));

    CPPUNIT_ASSERT_EQUAL(u"Title of the second slide"_ustr, xParagraph->getString());
    CPPUNIT_ASSERT_EQUAL(44.0f, xShape->getPropertyValue(u"CharHeight"_ustr).get<float>());
    CPPUNIT_ASSERT_EQUAL(sal_Int16(style::ParagraphAdjust_LEFT),
                         xShape->getPropertyValue(u"ParaAdjust"_ustr).get<sal_Int16>());
    CPPUNIT_ASSERT_EQUAL(u"Arial"_ustr,
                         xShape->getPropertyValue(u"CharFontName"_ustr).get<OUString>());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testNumToBullet)
{
    // Given a document with a shape, 2nd paragraph is a numbering:
    createSdImpressDoc("odp/num-to-bullet.odp");
    sd::ViewShell* pViewShell = getSdDocShell()->GetViewShell();
    SdPage* pPage = pViewShell->GetActualPage();
    SdrObject* pShape = pPage->GetObj(0);
    CPPUNIT_ASSERT(pShape);
    SdrView* pView = pViewShell->GetView();
    pView->MarkObj(pShape, pView->GetSdrPageView());
    Scheduler::ProcessEventsToIdle();
    CPPUNIT_ASSERT(!pView->IsTextEdit());

    // When turning the numbering to a bullet:
    // Start text edit:
    auto pImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    typeString(pImpressDocument, u"x");
    CPPUNIT_ASSERT(pView->IsTextEdit());
    // Do the switch:
    dispatchCommand(mxComponent, u".uno:DefaultBullet"_ustr, {});
    // End text edit:
    typeKey(pImpressDocument, KEY_ESCAPE);

    // Then make sure we switch to a bullet and not toggle off the numbering:
    CPPUNIT_ASSERT(!pView->IsTextEdit());
    uno::Reference<drawing::XDrawPagesSupplier> xDrawPagesSupplier(mxComponent, uno::UNO_QUERY);
    uno::Reference<drawing::XDrawPage> xDrawPage(xDrawPagesSupplier->getDrawPages()->getByIndex(0),
                                                 uno::UNO_QUERY);
    uno::Reference<beans::XPropertySet> xShape(xDrawPage->getByIndex(0), uno::UNO_QUERY);
    uno::Reference<beans::XPropertySet> xParagraph(getParagraphFromShape(1, xShape),
                                                   uno::UNO_QUERY);
    // Check that list level is 1 & level 1 numbering type is a bullet:
    sal_Int16 nNumberingLevel{};
    xParagraph->getPropertyValue(u"NumberingLevel"_ustr) >>= nNumberingLevel;
    // Without the accompanying fix in place, this test would have failed with:
    // - Expected: 1
    // - Actual  : 0
    // i.e. list level was -1 (toggle off) instead of switch to bullet.
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_Int16>(1), nNumberingLevel);
    uno::Reference<container::XIndexAccess> xNumberingRules;
    xParagraph->getPropertyValue(u"NumberingRules"_ustr) >>= xNumberingRules;
    comphelper::SequenceAsHashMap aNumberingRule(xNumberingRules->getByIndex(1));
    sal_Int16 nNumberingType = 0;
    aNumberingRule[u"NumberingType"_ustr] >>= nNumberingType;
    // Bullet and not numbering (ARABIC):
    CPPUNIT_ASSERT_EQUAL(style::NumberingType::CHAR_SPECIAL, nNumberingType);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testBulletOffOn)
{
    // Given a document with a shape, last paragraph is has a bullet:
    createSdImpressDoc("odp/bullet-off-on.odp");
    sd::ViewShell* pViewShell = getSdDocShell()->GetViewShell();
    SdPage* pPage = pViewShell->GetActualPage();
    SdrObject* pShape = pPage->GetObj(0);
    CPPUNIT_ASSERT(pShape);
    SdrView* pView = pViewShell->GetView();
    pView->MarkObj(pShape, pView->GetSdrPageView());
    Scheduler::ProcessEventsToIdle();
    CPPUNIT_ASSERT(!pView->IsTextEdit());

    // When turning the bullet off & then back on again:
    // Start text edit:
    auto pImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    typeString(pImpressDocument, u"x");
    CPPUNIT_ASSERT(pView->IsTextEdit());
    // Toggle off:
    dispatchCommand(mxComponent, u".uno:DefaultBullet"_ustr, {});
    // Toggle on:
    dispatchCommand(mxComponent, u".uno:DefaultBullet"_ustr, {});
    // End text edit:
    typeKey(pImpressDocument, KEY_ESCAPE);

    // Then make sure the result is Level 1 from the master page:
    CPPUNIT_ASSERT(!pView->IsTextEdit());
    uno::Reference<drawing::XDrawPagesSupplier> xDrawPagesSupplier(mxComponent, uno::UNO_QUERY);
    uno::Reference<drawing::XDrawPage> xDrawPage(xDrawPagesSupplier->getDrawPages()->getByIndex(0),
                                                 uno::UNO_QUERY);
    uno::Reference<beans::XPropertySet> xShape(xDrawPage->getByIndex(0), uno::UNO_QUERY);
    // 5th, last paragraph.
    uno::Reference<beans::XPropertySet> xParagraph(getParagraphFromShape(4, xShape),
                                                   uno::UNO_QUERY);
    uno::Reference<container::XIndexAccess> xNumberingRules;
    xParagraph->getPropertyValue(u"NumberingRules"_ustr) >>= xNumberingRules;
    // Level 1.
    comphelper::SequenceAsHashMap aNumberingRule(xNumberingRules->getByIndex(0));
    sal_Int32 nLeftMargin = 0;
    aNumberingRule[u"LeftMargin"_ustr] >>= nLeftMargin;
    sal_Int32 nFirstLineOffset = 0;
    aNumberingRule[u"FirstLineOffset"_ustr] >>= nFirstLineOffset;
    // Without the accompanying fix in place, this test would have failed with:
    // - Expected: 300
    // - Actual  : 0
    // i.e. the indent was 0cm, even if Level1 and Level2 had other values.
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_Int32>(300), nLeftMargin + nFirstLineOffset);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testPasteInTextEditWithAnimationNode)
{
    createSdImpressDoc();

    // Give the slide an (empty) animation node, so the paragraph removal that the
    // paste below performs is reported to the animation sequence.
    uno::Reference<frame::XModel> xModel(mxComponent, uno::UNO_QUERY);
    uno::Reference<drawing::XDrawView> xDrawView(xModel->getCurrentController(), uno::UNO_QUERY);
    uno::Reference<drawing::XDrawPage> xDrawPage(xDrawView->getCurrentPage(), uno::UNO_SET_THROW);
    uno::Reference<animations::XAnimationNodeSupplier> xAnimNodeSupplier(xDrawPage,
                                                                         uno::UNO_QUERY_THROW);
    CPPUNIT_ASSERT(xAnimNodeSupplier->getAnimationNode().is());

    // Type a word into the title placeholder, staying in text edit.
    insertStringToObject(0, u"blah", /*bUseEscape*/ false);

    // Select and copy it, then put the caret at the end so the paste appends.
    auto pImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    dispatchCommand(mxComponent, u".uno:SelectAll"_ustr, {});
    dispatchCommand(mxComponent, u".uno:Copy"_ustr, {});
    typeKey(pImpressDocument, KEY_END);

    // Without the accompanying fix, this paste asserts in a dbgutil build: the
    // paragraph removal probes the shape text through the UNO forwarder, forcing
    // a text frame layout recompute while the EditEngine layout is suspended.
    dispatchCommand(mxComponent, u".uno:Paste"_ustr, {});

    // The word got appended to itself.
    sd::ViewShell* pViewShell = pImpressDocument->GetDocShell()->GetViewShell();
    SdrView* pView = pViewShell->GetView();
    dispatchCommand(mxComponent, u".uno:SelectAll"_ustr, {});
    EditView& rEditView = pView->GetTextEditOutlinerView()->GetEditView();
    CPPUNIT_ASSERT_EQUAL(u"blahblah"_ustr, rEditView.GetSelected());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testMultiSelectionResize)
{
    // Two separate rectangles, wireframe (non-solid) dragging so the per-object
    // drag origins are exercised.
    createSdImpressDoc();
    auto* pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pXImpressDocument->GetDocShell()->GetViewShell();
    SdrView* pView = pViewShell->GetView();
    SdPage* pPage = pViewShell->GetActualPage();

    pView->SetSolidDragging(false);
    pView->SetSnapEnabled(false);

    rtl::Reference<SdrRectObj> pRect1
        = new SdrRectObj(pView->getSdrModelFromSdrView(), tools::Rectangle(0, 0, 1000, 1000));
    rtl::Reference<SdrRectObj> pRect2
        = new SdrRectObj(pView->getSdrModelFromSdrView(), tools::Rectangle(5000, 5000, 6000, 6000));
    pPage->NbcInsertObject(pRect1.get());
    pPage->NbcInsertObject(pRect2.get());

    // A single selection keeps the standard group frame handles, a second object
    // switches to individual handles automatically.
    pView->MarkObj(pRect1.get(), pView->GetSdrPageView());
    CPPUNIT_ASSERT(pView->IsFrameDragSingles());
    pView->MarkObj(pRect2.get(), pView->GetSdrPageView());
    CPPUNIT_ASSERT(!pView->IsFrameDragSingles());

    // Find the lower-right resize handle that belongs to the first rectangle.
    const SdrHdlList& rHdlList = pView->GetHdlList();
    SdrHdl* pDragHdl = nullptr;
    for (size_t i = 0; i < rHdlList.GetHdlCount(); ++i)
    {
        SdrHdl* pHdl = rHdlList.GetHdl(i);
        if (pHdl->GetKind() == SdrHdlKind::LowerRight && pHdl->GetObj() == pRect1.get())
        {
            pDragHdl = pHdl;
            break;
        }
    }
    CPPUNIT_ASSERT(pDragHdl);

    const tools::Rectangle aOrig1(pRect1->GetSnapRect());
    const tools::Rectangle aOrig2(pRect2->GetSnapRect());

    // Dragging that single handle must drive an all-objects resize, not the
    // single-object special drag, with each object anchored at its own origin
    // (top-left for a lower-right drag).
    CPPUNIT_ASSERT(pView->BegDragObj(pDragHdl->GetPos(), nullptr, pDragHdl, 0));
    SdrDragMethod* pDragMethod = pView->GetDragMethod();
    CPPUNIT_ASSERT(dynamic_cast<SdrDragResize*>(pDragMethod));
    std::optional<Point> oOrigin1 = pDragMethod->getIndividualDragOrigin(*pRect1);
    std::optional<Point> oOrigin2 = pDragMethod->getIndividualDragOrigin(*pRect2);
    CPPUNIT_ASSERT(oOrigin1.has_value());
    CPPUNIT_ASSERT(oOrigin2.has_value());
    CPPUNIT_ASSERT_EQUAL(aOrig1.TopLeft(), *oOrigin1);
    CPPUNIT_ASSERT_EQUAL(aOrig2.TopLeft(), *oOrigin2);

    // Double the first rectangle by moving its handle, then commit.
    pView->MovDragObj(Point(2000, 2000));
    pView->EndDragObj();

    const tools::Rectangle aNew1(pRect1->GetSnapRect());
    const tools::Rectangle aNew2(pRect2->GetSnapRect());

    // Both rectangles kept their own top-left origin and doubled in size. The
    // second rectangle did not move, unlike a shared-pivot group resize.
    CPPUNIT_ASSERT_EQUAL(aOrig1.TopLeft(), aNew1.TopLeft());
    CPPUNIT_ASSERT_EQUAL(aOrig1.Left() + 2 * (aOrig1.Right() - aOrig1.Left()), aNew1.Right());
    CPPUNIT_ASSERT_EQUAL(aOrig1.Top() + 2 * (aOrig1.Bottom() - aOrig1.Top()), aNew1.Bottom());
    CPPUNIT_ASSERT_EQUAL(aOrig2.TopLeft(), aNew2.TopLeft());
    CPPUNIT_ASSERT_EQUAL(aOrig2.Left() + 2 * (aOrig2.Right() - aOrig2.Left()), aNew2.Right());
    CPPUNIT_ASSERT_EQUAL(aOrig2.Top() + 2 * (aOrig2.Bottom() - aOrig2.Top()), aNew2.Bottom());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testMultiSelectionRotate)
{
    // Two separate, non-square rectangles, wireframe (non-solid) dragging.
    createSdImpressDoc();
    auto* pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());
    sd::ViewShell* pViewShell = pXImpressDocument->GetDocShell()->GetViewShell();
    SdrView* pView = pViewShell->GetView();
    SdPage* pPage = pViewShell->GetActualPage();

    pView->SetSolidDragging(false);
    pView->SetSnapEnabled(false);

    rtl::Reference<SdrRectObj> pRect1
        = new SdrRectObj(pView->getSdrModelFromSdrView(), tools::Rectangle(0, 0, 2000, 1000));
    rtl::Reference<SdrRectObj> pRect2
        = new SdrRectObj(pView->getSdrModelFromSdrView(), tools::Rectangle(5000, 5000, 7000, 6000));
    pPage->NbcInsertObject(pRect1.get());
    pPage->NbcInsertObject(pRect2.get());

    pView->MarkObj(pRect1.get(), pView->GetSdrPageView());
    pView->MarkObj(pRect2.get(), pView->GetSdrPageView());
    CPPUNIT_ASSERT(!pView->IsFrameDragSingles());

    // Each object gets exactly one rotate handle in the individual handle set.
    const SdrHdlList& rHdlList = pView->GetHdlList();
    int nRotateHandles = 0;
    SdrHdl* pRotateHdl = nullptr;
    for (size_t i = 0; i < rHdlList.GetHdlCount(); ++i)
    {
        SdrHdl* pHdl = rHdlList.GetHdl(i);
        if (pHdl->GetKind() == SdrHdlKind::Rotate)
        {
            ++nRotateHandles;
            if (pHdl->GetObj() == pRect1.get())
                pRotateHdl = pHdl;
        }
    }
    CPPUNIT_ASSERT_EQUAL(2, nRotateHandles);
    CPPUNIT_ASSERT(pRotateHdl);

    const Point aCenter1(pRect1->GetSnapRect().Center());
    const Point aCenter2(pRect2->GetSnapRect().Center());

    // Dragging rect1's rotate handle must drive an all-objects rotate, not the
    // single-object special drag, with each object turning around its own centre.
    CPPUNIT_ASSERT(pView->BegDragObj(pRotateHdl->GetPos(), nullptr, pRotateHdl, 0));
    SdrDragMethod* pDragMethod = pView->GetDragMethod();
    CPPUNIT_ASSERT(pDragMethod);
    CPPUNIT_ASSERT_EQUAL(PointerStyle::Rotate, pDragMethod->GetSdrDragPointer());
    std::optional<Point> oOrigin1 = pDragMethod->getIndividualDragOrigin(*pRect1);
    std::optional<Point> oOrigin2 = pDragMethod->getIndividualDragOrigin(*pRect2);
    CPPUNIT_ASSERT(oOrigin1.has_value());
    CPPUNIT_ASSERT(oOrigin2.has_value());
    CPPUNIT_ASSERT_EQUAL(aCenter1, *oOrigin1);
    CPPUNIT_ASSERT_EQUAL(aCenter2, *oOrigin2);

    // Drag the handle a quarter turn around rect1's centre, then commit.
    pView->MovDragObj(Point(aCenter1.X() + 2000, aCenter1.Y()));
    pView->EndDragObj();

    // Both rectangles rotated by the same angle and each kept its own centre. A
    // shared-pivot group rotate would instead have swung rect2's centre around
    // rect1.
    CPPUNIT_ASSERT_EQUAL(aCenter1, pRect1->GetSnapRect().Center());
    CPPUNIT_ASSERT_EQUAL(aCenter2, pRect2->GetSnapRect().Center());
    CPPUNIT_ASSERT(pRect1->GetRotateAngle() != 0_deg100);
    CPPUNIT_ASSERT_EQUAL(pRect1->GetRotateAngle().get(), pRect2->GetRotateAngle().get());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testMultiSelectionPointEditToggle)
{
    // Selecting multiple objects auto-enables Point Edit Mode (individual
    // handles). Pressing F8 / the toolbar button (.uno:ToggleObjectBezierMode)
    // must still toggle it as before, and the manual choice must persist while
    // the multi-selection is held.
    createSdImpressDoc();
    auto* pXImpressDocument = dynamic_cast<SdXImpressDocument*>(mxComponent.get());

    // dispatchCommand needs an active frame to find the view.
    auto xDesktop = frame::Desktop::create(comphelper::getProcessComponentContext());
    auto pFrame = pXImpressDocument->GetDocShell()->GetFrame();
    CPPUNIT_ASSERT(pFrame);
    xDesktop->setActiveFrame(pFrame->GetFrame().GetFrameInterface());

    sd::ViewShell* pViewShell = pXImpressDocument->GetDocShell()->GetViewShell();
    SdrView* pView = pViewShell->GetView();
    SdPage* pPage = pViewShell->GetActualPage();

    rtl::Reference<SdrRectObj> pRect1
        = new SdrRectObj(pView->getSdrModelFromSdrView(), tools::Rectangle(0, 0, 1000, 1000));
    rtl::Reference<SdrRectObj> pRect2
        = new SdrRectObj(pView->getSdrModelFromSdrView(), tools::Rectangle(2000, 0, 3000, 1000));
    rtl::Reference<SdrRectObj> pRect3
        = new SdrRectObj(pView->getSdrModelFromSdrView(), tools::Rectangle(4000, 0, 5000, 1000));
    pPage->NbcInsertObject(pRect1.get());
    pPage->NbcInsertObject(pRect2.get());
    pPage->NbcInsertObject(pRect3.get());

    // A single selection keeps the standard frame handles, a second object
    // auto-enables Point Edit Mode.
    pView->MarkObj(pRect1.get(), pView->GetSdrPageView());
    CPPUNIT_ASSERT(pView->IsFrameDragSingles());
    pView->MarkObj(pRect2.get(), pView->GetSdrPageView());
    CPPUNIT_ASSERT(!pView->IsFrameDragSingles());

    // Pressing F8 / the button turns Point Edit Mode off, as it did before.
    dispatchCommand(mxComponent, u".uno:ToggleObjectBezierMode"_ustr, {});
    Scheduler::ProcessEventsToIdle();
    CPPUNIT_ASSERT(pView->IsFrameDragSingles());

    // Pressing it again turns it back on, so the old toggle is not broken.
    dispatchCommand(mxComponent, u".uno:ToggleObjectBezierMode"_ustr, {});
    Scheduler::ProcessEventsToIdle();
    CPPUNIT_ASSERT(!pView->IsFrameDragSingles());

    // Turn it off, then extend the selection: the manual choice must persist and
    // not be re-forced back on while the selection stays multi.
    dispatchCommand(mxComponent, u".uno:ToggleObjectBezierMode"_ustr, {});
    Scheduler::ProcessEventsToIdle();
    CPPUNIT_ASSERT(pView->IsFrameDragSingles());
    pView->MarkObj(pRect3.get(), pView->GetSdrPageView());
    CPPUNIT_ASSERT(pView->IsFrameDragSingles());

    // Dropping back to a single selection restores the standard frame handles and
    // re-arms the auto default, so a fresh multi-selection enables it again.
    pView->UnmarkAllObj(pView->GetSdrPageView());
    pView->MarkObj(pRect1.get(), pView->GetSdrPageView());
    CPPUNIT_ASSERT(pView->IsFrameDragSingles());
    pView->MarkObj(pRect2.get(), pView->GetSdrPageView());
    CPPUNIT_ASSERT(!pView->IsFrameDragSingles());
}

namespace
{
/// A processed-PDF (P0) scan page, generated by
/// scripts/vulcan-office/pdf-edit-scan-fixture.py (all ASCII so the
/// cross-reference offsets hold in a raw string; fork-checks fails when this
/// copy and the generator drift apart): one 64x32 1-bit DeviceGray
/// image (ASCIIHex; sample 0 is black) drawn upright at 576x288 pt from
/// (18, 486) inside /VulcanImg <</VulcanId (p1-i0)>> BDC ... EMC. Its only
/// ink is a printed "line": rows 8-11, columns 8-39. The raw stream's
/// sha256 is aScanSha256.
constexpr std::string_view aScanBilevelMarkedPdf = R"PDF(%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 75 >>
stream
q 576 0 0 288 18 486 cm /VulcanImg <</VulcanId (p1-i0)>> BDC /Im0 Do EMC Q
endstream
endobj
5 0 obj
<< /Type /XObject /Subtype /Image /Width 64 /Height 32 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /ASCIIHexDecode /Length 520 >>
stream
FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
FF00000000FFFFFFFF00000000FFFFFFFF00000000FFFFFFFF00000000FFFFFF
FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF>
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000245 00000 n 
0000000369 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
1060
%%EOF
)PDF";
constexpr std::string_view aScanSha256
    = "fb1b0cfe1437adf69b49d1bdc9d98f218b26fb104efbe0cca983838a113dc5e7";

/// Write aScanBilevelMarkedPdf into rFixture; its URL, to load.
OUString lcl_WriteScanFixture(utl::TempFileNamed& rFixture)
{
    rFixture.EnableKillingFile();
    SvStream* pFixtureStream = rFixture.GetStream(StreamMode::WRITE);
    CPPUNIT_ASSERT(pFixtureStream);
    pFixtureStream->WriteBytes(aScanBilevelMarkedPdf.data(), aScanBilevelMarkedPdf.size());
    rFixture.CloseStream();
    return rFixture.GetURL();
}

/// The loaded fixture as the kit holds it (a PDF opened into Draw), its
/// frame active.
SdXImpressDocument* lcl_ActivateScanDoc(const uno::Reference<lang::XComponent>& xComponent)
{
    auto pImpressDocument = dynamic_cast<SdXImpressDocument*>(xComponent.get());
    CPPUNIT_ASSERT(pImpressDocument);
    auto xDesktop = frame::Desktop::create(comphelper::getProcessComponentContext());
    auto pFrame = pImpressDocument->GetDocShell()->GetFrame();
    CPPUNIT_ASSERT(pFrame);
    xDesktop->setActiveFrame(pFrame->GetFrame().GetFrameInterface());
    CPPUNIT_ASSERT(pImpressDocument->GetDoc()->IsPDFDocument());
    return pImpressDocument;
}

/// The v3 scan page model for the fixture: the scan by reference (sha256
/// aSha), locked, with one hidden-ink OCR line over the printed line.
OString lcl_ScanModel(std::string_view aSha)
{
    return "{\"page\":{\"w\":612,\"h\":792},\"mode\":\"scan\",\"status\":\"ready\","
           "\"regions\":[{\"role\":\"signature\",\"box\":{\"x\":400,\"y\":200,\"w\":100,\"h\":50}}],"
           "\"objects\":["
           "{\"kind\":\"other\",\"role\":\"vulcan:scan:p1\",\"locked\":true,"
           "\"box\":{\"x\":18,\"y\":18,\"w\":576,\"h\":288},"
           "\"src\":{\"pdf\":{\"page\":1,\"id\":\"p1-i0\"},\"sha256\":\""
           + OString(aSha.data(), static_cast<sal_Int32>(aSha.size()))
           + "\",\"px\":[64,32]}},"
             "{\"kind\":\"text\",\"id\":\"p1-l1\",\"block\":\"p1-b1\",\"role\":\"ocr:p1-l1\","
             "\"ink\":\"hidden\",\"conf\":0.97,\"box\":{\"x\":90,\"y\":90,\"w\":288,\"h\":36},"
             "\"cover\":{\"x\":88,\"y\":88,\"w\":292,\"h\":40},\"suspects\":[],\"lineHeight\":null,"
             "\"lines\":[{\"box\":{\"x\":90,\"y\":90,\"w\":288,\"h\":36},\"baseline\":120,"
             "\"runs\":[{\"text\":\"Scanned line\",\"box\":{\"x\":90,\"y\":90,\"w\":288,\"h\":36},"
             "\"family\":\"Liberation Sans\",\"size\":20,\"weight\":400,\"italic\":false,"
             "\"color\":\"#102030\",\"letterSpacing\":0}]}]}]}";
}

/// The TransformDocumentStructure arguments that build rModel on page 0.
cpo::uno::Sequence<beans::PropertyValue> lcl_BuildScanModelArgs(const OString& rModel)
{
    OUStringBuffer aBase64;
    comphelper::Base64::encode(
        aBase64, cpo::uno::Sequence<sal_Int8>(reinterpret_cast<const sal_Int8*>(rModel.getStr()),
                                              rModel.getLength()));
    const OUString aDataJson
        = u"{ \"Transforms\": { \"SlideCommands\": [{\"BuildPdfPageModel\": \"0|"_ustr
          + aBase64.makeStringAndClear() + u"\"}]}}"_ustr;
    return { comphelper::makePropertyValue(u"DataJson"_ustr, aDataJson) };
}

/// The kept scan and the OCR line a built fixture page holds.
std::pair<SdrGrafObj*, SdrTextObj*> lcl_ScanAndLine(SdPage& rPage)
{
    SdrGrafObj* pScan = nullptr;
    SdrTextObj* pLine = nullptr;
    for (size_t n = 0; n < rPage.GetObjCount(); ++n)
    {
        SdrObject* pObj = rPage.GetObj(n);
        if (pObj->GetName() == "vulcan:scan:p1")
            pScan = dynamic_cast<SdrGrafObj*>(pObj);
        else if (pObj->GetName() == "ocr:p1-l1")
            pLine = DynCastSdrTextObj(pObj);
    }
    return { pScan, pLine };
}

/// Is the fixture scan's pixel (x, y) ink (dark)?
bool lcl_IsInk(const SdrGrafObj& rScan, tools::Long nX, tools::Long nY)
{
    return rScan.GetGraphic().GetBitmap().GetPixelColor(nX, nY).GetLuminance() < 128;
}

/// Write ink at (x, y) of the scan in place, as another view's edit of the
/// same scan would (every view of a document shares the one picture).
void lcl_SetInk(SdrGrafObj& rScan, tools::Long nX, tools::Long nY)
{
    Bitmap aBitmap(rScan.GetGraphic().GetBitmap());
    {
        BitmapScopedWriteAccess pWrite(aBitmap);
        CPPUNIT_ASSERT(pWrite);
        pWrite->SetPixel(nY, nX, pWrite->GetBestMatchingColor(BitmapColor(COL_BLACK)));
    }
    rScan.SetGraphic(Graphic(aBitmap));
    CPPUNIT_ASSERT(lcl_IsInk(rScan, nX, nY));
}

/// Does the view's text edit still hold hidden (alpha-0) ink? The object's
/// own text is only written back when text edit ends; this is the edit.
bool lcl_EditIsHidden(sd::View& rView)
{
    SdrOutliner* pOutliner = rView.GetTextEditOutliner();
    CPPUNIT_ASSERT(pOutliner);
    std::optional<OutlinerParaObject> oText
        = pOutliner->CreateParaObject(0, pOutliner->GetParagraphCount());
    CPPUNIT_ASSERT(oText);
    return sd::hiddenink::TextHasHiddenInk(oText->GetTextObject());
}

/// Is the fixture's printed line ink at (x, y), and nothing else?
bool lcl_FixtureInk(tools::Long nX, tools::Long nY)
{
    return nY >= 8 && nY <= 11 && nX >= 8 && nX <= 39;
}
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testPdfScanBilevelImportKeepsNativePixels)
{
    // A 1-bit image comes in bilevel at its own resolution (a two-entry
    // palette, not 32-bit BGRA scaled to the display budget), and every
    // imported picture carries where it came from: inside a /VulcanImg mark,
    // the innermost VulcanId and the raw stream's sha256.
    utl::TempFileNamed aFixture(u"scanbilevel", true, u".pdf");
    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });
    loadFromURL(lcl_WriteScanFixture(aFixture));
    SdXImpressDocument* pImpressDocument = lcl_ActivateScanDoc(mxComponent);
    SdDrawDocument* pDoc = pImpressDocument->GetDoc();
    SdPage* pPage = pDoc->GetSdPage(0, PageKind::Standard);
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    { comphelper::makePropertyValue(
                        u"DataJson"_ustr,
                        u"{ \"Transforms\": { \"SlideCommands\": ["
                        u"{\"DecomposePdfPages\": true}]}}"_ustr) });
    CPPUNIT_ASSERT(!pPage->GetPdfPageGraphic());
    SdrGrafObj* pGraf = nullptr;
    for (size_t n = 0; n < pPage->GetObjCount() && !pGraf; ++n)
        pGraf = dynamic_cast<SdrGrafObj*>(pPage->GetObj(n));
    CPPUNIT_ASSERT(pGraf);
    const Bitmap aBitmap = pGraf->GetGraphic().GetBitmap();
    CPPUNIT_ASSERT_EQUAL(Size(64, 32), aBitmap.GetSizePixel());
    CPPUNIT_ASSERT_EQUAL(vcl::PixelFormat::N8_BPP, aBitmap.getPixelFormat());
    {
        BitmapScopedReadAccess pRead(aBitmap);
        CPPUNIT_ASSERT(pRead);
        CPPUNIT_ASSERT(pRead->HasPalette());
        CPPUNIT_ASSERT_EQUAL(sal_uInt16(2), pRead->GetPaletteEntryCount());
    }
    // Ink where the file has it, paper elsewhere.
    CPPUNIT_ASSERT(lcl_IsInk(*pGraf, 20, 9));
    CPPUNIT_ASSERT(!lcl_IsInk(*pGraf, 20, 20));
    const svx::vulcan::ImageProvenance* pProvenance = svx::vulcan::GetImageProvenance(*pGraf);
    CPPUNIT_ASSERT(pProvenance);
    CPPUNIT_ASSERT_EQUAL(u"p1-i0"_ustr, pProvenance->maId);
    CPPUNIT_ASSERT_EQUAL(OString(aScanSha256.data(), static_cast<sal_Int32>(aScanSha256.size())),
                         pProvenance->maSha256);
    CPPUNIT_ASSERT_EQUAL(Size(64, 32), pProvenance->maPixels);
    CPPUNIT_ASSERT(!pDoc->IsChanged());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testPdfScanPageModelKeepsScanByMark)
{
    // A v3 scan page: the scan kept from the import by its VulcanId (sha256
    // and pixel size checked), named from its role and locked; the
    // OCR line built as hidden ink - move and resize protected, still
    // markable - with its id, block and cover. Nothing about it is an edit,
    // and the live model writes the scan back as the same reference.
    utl::TempFileNamed aFixture(u"scanmodel", true, u".pdf");
    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });
    loadFromURL(lcl_WriteScanFixture(aFixture));
    SdXImpressDocument* pImpressDocument = lcl_ActivateScanDoc(mxComponent);
    SdDrawDocument* pDoc = pImpressDocument->GetDoc();
    SdPage* pPage = pDoc->GetSdPage(0, PageKind::Standard);
    sd::UndoManager* pUndoManager = pDoc->GetUndoManager();
    const size_t nUndoBefore = pUndoManager ? pUndoManager->GetUndoActionCount() : 0;

    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    lcl_BuildScanModelArgs(lcl_ScanModel(aScanSha256)));

    CPPUNIT_ASSERT(!pPage->GetPdfPageGraphic());
    CPPUNIT_ASSERT_EQUAL(size_t(2), pPage->GetObjCount());
    auto [pScan, pLine] = lcl_ScanAndLine(*pPage);
    CPPUNIT_ASSERT(pScan);
    CPPUNIT_ASSERT(pLine);
    // The scan cannot be marked, moved or resized.
    CPPUNIT_ASSERT(pScan->IsMarkProtect());
    CPPUNIT_ASSERT(pScan->IsMoveProtect());
    CPPUNIT_ASSERT(pScan->IsResizeProtect());
    // Kept at its own pixels, bilevel.
    CPPUNIT_ASSERT_EQUAL(Size(64, 32), pScan->GetGraphic().GetSizePixel());
    const svx::vulcan::ImageProvenance* pProvenance = svx::vulcan::GetImageProvenance(*pScan);
    CPPUNIT_ASSERT(pProvenance);
    CPPUNIT_ASSERT(pProvenance->mbKept);
    CPPUNIT_ASSERT_EQUAL(size_t(1), pProvenance->maProtected.size());
    // The line paints nothing, takes the caret, and is not draggable.
    CPPUNIT_ASSERT(sd::hiddenink::IsHiddenLine(*pLine));
    CPPUNIT_ASSERT(!pLine->IsMarkProtect());
    CPPUNIT_ASSERT(pLine->IsMoveProtect());
    CPPUNIT_ASSERT(pLine->IsResizeProtect());
    const svx::vulcan::LineData* pLineData = svx::vulcan::GetLineData(*pLine);
    CPPUNIT_ASSERT(pLineData);
    CPPUNIT_ASSERT_EQUAL(u"p1-l1"_ustr, pLineData->maId);
    CPPUNIT_ASSERT(!pLineData->maCover.IsEmpty());
    // The printed line is still in the scan.
    CPPUNIT_ASSERT(lcl_IsInk(*pScan, 20, 9));
    // Not an edit.
    CPPUNIT_ASSERT(!pDoc->IsChanged());
    if (pUndoManager)
        CPPUNIT_ASSERT_EQUAL(nUndoBefore, pUndoManager->GetUndoActionCount());

    // Select-all never reaches the scan.
    sd::ViewShell* pViewShell = pImpressDocument->GetDocShell()->GetViewShell();
    CPPUNIT_ASSERT(pViewShell);
    SdrView* pView = pViewShell->GetView();
    pView->MarkAllObj(pView->GetSdrPageView());
    const SdrMarkList& rMarks = pView->GetMarkedObjectList();
    for (size_t n = 0; n < rMarks.GetMarkCount(); ++n)
        CPPUNIT_ASSERT(rMarks.GetMark(n)->GetMarkedSdrObj() != pScan);
    pView->UnmarkAll();

    // The payload flags both for the client's hit tests.
    {
        tools::JsonWriter aJsonWriter;
        pImpressDocument->getCommandValues(aJsonWriter, ".uno:VectorPrimitives?part=0");
        const OString aPayload = aJsonWriter.finishAndGetAsOString();
        CPPUNIT_ASSERT(aPayload.indexOf("\"locked\": true") >= 0);
        CPPUNIT_ASSERT(aPayload.indexOf("\"hiddenInk\": true") >= 0);
    }
    // The live model: the scan as the reference it was built from (never
    // image bytes), the line still hidden, with its cover.
    tools::JsonWriter aJsonWriter;
    pImpressDocument->getCommandValues(aJsonWriter, ".uno:PdfPageModel?part=0");
    const OString aLive = aJsonWriter.finishAndGetAsOString();
    boost::property_tree::ptree aTree;
    std::istringstream aStream(std::string(aLive.getStr(), aLive.getLength()));
    boost::property_tree::read_json(aStream, aTree);
    bool bSawScan = false, bSawLine = false;
    for (const auto& rNode : aTree.get_child("objects"))
    {
        const std::string aRole = rNode.second.get<std::string>("role", "");
        if (aRole == "vulcan:scan:p1")
        {
            bSawScan = true;
            CPPUNIT_ASSERT_EQUAL(std::string("other"), rNode.second.get<std::string>("kind"));
            CPPUNIT_ASSERT(rNode.second.get<bool>("locked", false));
            CPPUNIT_ASSERT_EQUAL(std::string("p1-i0"), rNode.second.get<std::string>("src.pdf.id"));
            CPPUNIT_ASSERT_EQUAL(std::string(aScanSha256),
                                 rNode.second.get<std::string>("src.sha256"));
            CPPUNIT_ASSERT(!rNode.second.get_child_optional("data"));
        }
        else if (aRole == "ocr:p1-l1")
        {
            bSawLine = true;
            CPPUNIT_ASSERT_EQUAL(std::string("hidden"), rNode.second.get<std::string>("ink"));
            CPPUNIT_ASSERT_EQUAL(std::string("p1-l1"), rNode.second.get<std::string>("id"));
            CPPUNIT_ASSERT(rNode.second.get_child_optional("cover"));
        }
    }
    CPPUNIT_ASSERT(bSawScan);
    CPPUNIT_ASSERT(bSawLine);
    CPPUNIT_ASSERT(aTree.get<bool>("complete", false));
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testPdfScanPageModelUnresolvedLockFailsPage)
{
    // A locked node whose reference does not name these bytes (another
    // sha256) fails the page build: nothing is built and the page keeps its
    // graphic, rather than showing hidden lines over no scan.
    utl::TempFileNamed aFixture(u"scanunresolved", true, u".pdf");
    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });
    loadFromURL(lcl_WriteScanFixture(aFixture));
    SdXImpressDocument* pImpressDocument = lcl_ActivateScanDoc(mxComponent);
    SdPage* pPage = pImpressDocument->GetDoc()->GetSdPage(0, PageKind::Standard);
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    lcl_BuildScanModelArgs(lcl_ScanModel(
                        "0000000000000000000000000000000000000000000000000000000000000000")));
    CPPUNIT_ASSERT(pPage->GetPdfPageGraphic());
    CPPUNIT_ASSERT_EQUAL(size_t(1), pPage->GetObjCount());
    CPPUNIT_ASSERT(!pImpressDocument->GetDoc()->IsChanged());
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testHiddenInkCoverPixels)
{
    // The cover as a pure function over a scan bitmap: the ink inside the
    // cover box is filled with the box's paper; a ruling line (a dark run of
    // 90 px or more), a protected region and everything outside the box
    // keep their pixels.
    Bitmap aScan(Size(200, 100), vcl::PixelFormat::N24_BPP);
    aScan.Erase(COL_WHITE);
    {
        BitmapScopedWriteAccess pWrite(aScan);
        const BitmapColor aBlack(COL_BLACK);
        for (tools::Long nY = 40; nY < 50; ++nY)
            for (tools::Long nX = 20; nX <= 60; ++nX)
                pWrite->SetPixel(nY, nX, aBlack); // printed text
        for (tools::Long nX = 10; nX <= 190; ++nX)
            pWrite->SetPixel(70, nX, aBlack); // a form rule
        for (tools::Long nY = 40; nY < 50; ++nY)
            for (tools::Long nX = 150; nX <= 170; ++nX)
                pWrite->SetPixel(nY, nX, aBlack); // a signature stroke
        pWrite->SetPixel(5, 5, aBlack); // ink outside the box
    }
    // 10 logic units per pixel.
    const tools::Rectangle aScanRect(Point(0, 0), Size(2000, 1000));
    const tools::Rectangle aCover(Point(100, 300), Size(1800, 500));
    const std::vector<tools::Rectangle> aProtected{ tools::Rectangle(Point(1450, 380),
                                                                     Size(300, 150)) };
    const Graphic aCovered
        = sd::hiddenink::CoverScanPixels(Graphic(aScan), aScanRect, aCover, aProtected);
    CPPUNIT_ASSERT(aCovered.GetType() == GraphicType::Bitmap);
    const Bitmap aOut = aCovered.GetBitmap();
    CPPUNIT_ASSERT_EQUAL(aScan.GetSizePixel(), aOut.GetSizePixel());
    // the text is gone, dilated edges included
    CPPUNIT_ASSERT_EQUAL(COL_WHITE, Color(aOut.GetPixelColor(40, 45)));
    CPPUNIT_ASSERT_EQUAL(COL_WHITE, Color(aOut.GetPixelColor(20, 40)));
    CPPUNIT_ASSERT_EQUAL(COL_WHITE, Color(aOut.GetPixelColor(60, 49)));
    // the rule, the signature and the ink outside the box stay
    CPPUNIT_ASSERT_EQUAL(COL_BLACK, Color(aOut.GetPixelColor(100, 70)));
    CPPUNIT_ASSERT_EQUAL(COL_BLACK, Color(aOut.GetPixelColor(160, 45)));
    CPPUNIT_ASSERT_EQUAL(COL_BLACK, Color(aOut.GetPixelColor(5, 5)));
    // the original is untouched (the cover edits a copy)
    CPPUNIT_ASSERT_EQUAL(COL_BLACK, Color(aScan.GetPixelColor(40, 45)));
    // A box with no ink changes nothing.
    const Graphic aNothing = sd::hiddenink::CoverScanPixels(
        Graphic(aScan), aScanRect, tools::Rectangle(Point(1000, 850), Size(500, 100)), {});
    CPPUNIT_ASSERT(aNothing.GetType() == GraphicType::NONE);
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testHiddenInkFirstChangeIsOneUndo)
{
    // Placing the caret in a hidden line is not an edit. The first real
    // change makes the line visible and removes the printed ink under it from
    // the scan's own pixels; ending text edit records both as ONE undo
    // action, and one undo puts the hidden line and the ink back together.
    utl::TempFileNamed aFixture(u"scanfirstchange", true, u".pdf");
    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });
    loadFromURL(lcl_WriteScanFixture(aFixture));
    SdXImpressDocument* pImpressDocument = lcl_ActivateScanDoc(mxComponent);
    SdDrawDocument* pDoc = pImpressDocument->GetDoc();
    SdPage* pPage = pDoc->GetSdPage(0, PageKind::Standard);
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    lcl_BuildScanModelArgs(lcl_ScanModel(aScanSha256)));
    auto [pScan, pLine] = lcl_ScanAndLine(*pPage);
    CPPUNIT_ASSERT(pScan);
    CPPUNIT_ASSERT(pLine);
    CPPUNIT_ASSERT(lcl_IsInk(*pScan, 20, 9));
    sd::UndoManager* pUndoManager = pDoc->GetUndoManager();
    CPPUNIT_ASSERT(pUndoManager);
    const size_t nUndoBefore = pUndoManager->GetUndoActionCount();

    sd::ViewShell* pViewShell = pImpressDocument->GetDocShell()->GetViewShell();
    CPPUNIT_ASSERT(pViewShell);
    sd::View* pView = pViewShell->GetView();
    CPPUNIT_ASSERT(pView->SdrBeginTextEdit(pLine));
    CPPUNIT_ASSERT(pView->IsTextEdit());
    // The caret alone changes nothing.
    CPPUNIT_ASSERT(sd::hiddenink::IsHiddenLine(*pLine));
    CPPUNIT_ASSERT(lcl_IsInk(*pScan, 20, 9));

    // The first key's hook (FuText::KeyInput calls it before the key lands).
    sd::hiddenink::BeforeTextChange(*pView);
    OutlinerView* pOutlinerView = pView->GetTextEditOutlinerView();
    CPPUNIT_ASSERT(pOutlinerView);
    pOutlinerView->InsertText(u"X"_ustr);
    // The printed ink is gone from the scan as soon as the line is real.
    CPPUNIT_ASSERT(!lcl_IsInk(*pScan, 20, 9));
    pView->SdrEndTextEdit();

    CPPUNIT_ASSERT(!sd::hiddenink::IsHiddenLine(*pLine));
    CPPUNIT_ASSERT(pLine->GetOutlinerParaObject()->GetTextObject().GetText(0).indexOf("X") >= 0);
    CPPUNIT_ASSERT(!pLine->IsMoveProtect());
    CPPUNIT_ASSERT(!lcl_IsInk(*pScan, 20, 9));
    // Paper outside the cover is untouched, and the scan keeps its pixels.
    CPPUNIT_ASSERT(!lcl_IsInk(*pScan, 20, 20));
    CPPUNIT_ASSERT_EQUAL(Size(64, 32), pScan->GetGraphic().GetSizePixel());
    CPPUNIT_ASSERT(pDoc->IsChanged());
    CPPUNIT_ASSERT_EQUAL(nUndoBefore + 1, pUndoManager->GetUndoActionCount());

    // One undo: the hidden line and the printed ink, together.
    pUndoManager->Undo();
    CPPUNIT_ASSERT(sd::hiddenink::IsHiddenLine(*pLine));
    CPPUNIT_ASSERT(pLine->IsMoveProtect());
    CPPUNIT_ASSERT(lcl_IsInk(*pScan, 20, 9));
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testHiddenInkChangeWithoutHookIsMadeVisible)
{
    // The safety net: a hidden line whose text changed through a path no
    // hook covers is made visible, and covered, when text edit ends - never
    // left as text nobody can see.
    utl::TempFileNamed aFixture(u"scannet", true, u".pdf");
    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });
    loadFromURL(lcl_WriteScanFixture(aFixture));
    SdXImpressDocument* pImpressDocument = lcl_ActivateScanDoc(mxComponent);
    SdPage* pPage = pImpressDocument->GetDoc()->GetSdPage(0, PageKind::Standard);
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    lcl_BuildScanModelArgs(lcl_ScanModel(aScanSha256)));
    auto [pScan, pLine] = lcl_ScanAndLine(*pPage);
    CPPUNIT_ASSERT(pScan);
    CPPUNIT_ASSERT(pLine);
    sd::ViewShell* pViewShell = pImpressDocument->GetDocShell()->GetViewShell();
    sd::View* pView = pViewShell->GetView();
    CPPUNIT_ASSERT(pView->SdrBeginTextEdit(pLine));
    pView->GetTextEditOutlinerView()->InsertText(u"Y"_ustr);
    pView->SdrEndTextEdit();
    CPPUNIT_ASSERT(!sd::hiddenink::IsHiddenLine(*pLine));
    CPPUNIT_ASSERT(!lcl_IsInk(*pScan, 20, 9));
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testHiddenInkTypedOnMarkedLineIsVisibleAtOnce)
{
    // The kit's way in: the line is marked (a click), and the first typed
    // character starts its text edit (FuPoor::KeyInput -> SID_ATTR_CHAR ->
    // ImpAddPrintableCharactersToTextEdit), past FuText::KeyInput. The line
    // is visible and the scan covered BEFORE text edit ends - never typed
    // invisibly. Undo and redo of the cover touch only this line's pixels:
    // a pixel another view wrote on the same scan since stays.
    utl::TempFileNamed aFixture(u"scantyped", true, u".pdf");
    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });
    loadFromURL(lcl_WriteScanFixture(aFixture));
    SdXImpressDocument* pImpressDocument = lcl_ActivateScanDoc(mxComponent);
    SdDrawDocument* pDoc = pImpressDocument->GetDoc();
    SdPage* pPage = pDoc->GetSdPage(0, PageKind::Standard);
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    lcl_BuildScanModelArgs(lcl_ScanModel(aScanSha256)));
    auto [pScan, pLine] = lcl_ScanAndLine(*pPage);
    CPPUNIT_ASSERT(pScan);
    CPPUNIT_ASSERT(pLine);
    sd::UndoManager* pUndoManager = pDoc->GetUndoManager();
    CPPUNIT_ASSERT(pUndoManager);
    const size_t nUndoBefore = pUndoManager->GetUndoActionCount();
    sd::ViewShell* pViewShell = pImpressDocument->GetDocShell()->GetViewShell();
    CPPUNIT_ASSERT(pViewShell);
    sd::View* pView = pViewShell->GetView();

    pView->MarkObj(pLine, pView->GetSdrPageView());
    Scheduler::ProcessEventsToIdle();
    CPPUNIT_ASSERT(!pView->IsTextEdit());
    typeString(pImpressDocument, u"X");
    CPPUNIT_ASSERT(pView->IsTextEdit());
    CPPUNIT_ASSERT_EQUAL(static_cast<SdrTextObj*>(pLine), pView->GetTextEditObject());
    CPPUNIT_ASSERT(!lcl_EditIsHidden(*pView));
    CPPUNIT_ASSERT(!lcl_IsInk(*pScan, 20, 9));

    lcl_SetInk(*pScan, 60, 28); // outside this line's cover
    pView->SdrEndTextEdit();
    CPPUNIT_ASSERT(!sd::hiddenink::IsHiddenLine(*pLine));
    CPPUNIT_ASSERT_EQUAL(nUndoBefore + 1, pUndoManager->GetUndoActionCount());

    pUndoManager->Undo();
    CPPUNIT_ASSERT(sd::hiddenink::IsHiddenLine(*pLine));
    CPPUNIT_ASSERT(lcl_IsInk(*pScan, 20, 9));
    CPPUNIT_ASSERT(lcl_IsInk(*pScan, 60, 28));
    pUndoManager->Redo();
    CPPUNIT_ASSERT(!lcl_IsInk(*pScan, 20, 9));
    CPPUNIT_ASSERT(lcl_IsInk(*pScan, 60, 28));
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testHiddenInkKeyThatChangesNothingKeepsTheLine)
{
    // A text-changing key makes the line visible before it lands
    // (FuText::KeyInput) - but a key that changes nothing (Backspace at the
    // start of the line), or text typed and deleted again, leaves the line
    // what it was: hidden, its printed ink back, move-protected, and nothing
    // in the undo stack. The ink comes back only where this line's cover
    // wrote it: a pixel another view wrote on the scan meanwhile stays.
    utl::TempFileNamed aFixture(u"scannochange", true, u".pdf");
    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });
    loadFromURL(lcl_WriteScanFixture(aFixture));
    SdXImpressDocument* pImpressDocument = lcl_ActivateScanDoc(mxComponent);
    SdDrawDocument* pDoc = pImpressDocument->GetDoc();
    SdPage* pPage = pDoc->GetSdPage(0, PageKind::Standard);
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    lcl_BuildScanModelArgs(lcl_ScanModel(aScanSha256)));
    auto [pScan, pLine] = lcl_ScanAndLine(*pPage);
    CPPUNIT_ASSERT(pScan);
    CPPUNIT_ASSERT(pLine);
    sd::UndoManager* pUndoManager = pDoc->GetUndoManager();
    CPPUNIT_ASSERT(pUndoManager);
    const size_t nUndoBefore = pUndoManager->GetUndoActionCount();
    sd::ViewShell* pViewShell = pImpressDocument->GetDocShell()->GetViewShell();
    CPPUNIT_ASSERT(pViewShell);
    sd::View* pView = pViewShell->GetView();

    const auto enterLine = [&]() {
        pView->MarkObj(pLine, pView->GetSdrPageView());
        dispatchCommand(mxComponent, u".uno:Text"_ustr, {}); // F2 on the marked line
        CPPUNIT_ASSERT(pView->IsTextEdit());
        CPPUNIT_ASSERT_EQUAL(static_cast<SdrTextObj*>(pLine), pView->GetTextEditObject());
        // The caret alone changes nothing.
        CPPUNIT_ASSERT(lcl_EditIsHidden(*pView));
        CPPUNIT_ASSERT(lcl_IsInk(*pScan, 20, 9));
    };
    const auto assertUntouched = [&]() {
        CPPUNIT_ASSERT(!pView->IsTextEdit());
        CPPUNIT_ASSERT(sd::hiddenink::IsHiddenLine(*pLine));
        CPPUNIT_ASSERT_EQUAL(u"Scanned line"_ustr,
                             pLine->GetOutlinerParaObject()->GetTextObject().GetText(0));
        CPPUNIT_ASSERT(lcl_IsInk(*pScan, 20, 9));
        CPPUNIT_ASSERT(pLine->IsMoveProtect());
        CPPUNIT_ASSERT(pLine->IsResizeProtect());
        CPPUNIT_ASSERT_EQUAL(nUndoBefore, pUndoManager->GetUndoActionCount());
    };

    // Backspace at the start of the line.
    enterLine();
    typeKey(pImpressDocument, KEY_HOME);
    CPPUNIT_ASSERT(lcl_EditIsHidden(*pView)); // moving the caret is not a change
    typeKey(pImpressDocument, KEY_BACKSPACE);
    CPPUNIT_ASSERT(!lcl_EditIsHidden(*pView));
    CPPUNIT_ASSERT(!lcl_IsInk(*pScan, 20, 9));
    lcl_SetInk(*pScan, 60, 28); // another view's change, after this cover
    pView->SdrEndTextEdit();
    assertUntouched();
    CPPUNIT_ASSERT(lcl_IsInk(*pScan, 60, 28));

    // Delete at the end of the line.
    enterLine();
    typeKey(pImpressDocument, KEY_END);
    typeKey(pImpressDocument, KEY_DELETE);
    CPPUNIT_ASSERT(!lcl_EditIsHidden(*pView));
    pView->SdrEndTextEdit();
    assertUntouched();

    // A character typed and deleted again.
    enterLine();
    typeKey(pImpressDocument, KEY_END);
    typeString(pImpressDocument, u"Z");
    CPPUNIT_ASSERT(!lcl_EditIsHidden(*pView));
    typeKey(pImpressDocument, KEY_BACKSPACE);
    pView->SdrEndTextEdit();
    assertUntouched();
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testHiddenInkImeInputIsVisibleAtOnce)
{
    // The kit types through ExtTextInput (FuPoor::Command), not key events:
    // the first composition makes the line visible and covers the scan
    // before text edit ends.
    utl::TempFileNamed aFixture(u"scanime", true, u".pdf");
    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });
    loadFromURL(lcl_WriteScanFixture(aFixture));
    SdXImpressDocument* pImpressDocument = lcl_ActivateScanDoc(mxComponent);
    SdPage* pPage = pImpressDocument->GetDoc()->GetSdPage(0, PageKind::Standard);
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    lcl_BuildScanModelArgs(lcl_ScanModel(aScanSha256)));
    auto [pScan, pLine] = lcl_ScanAndLine(*pPage);
    CPPUNIT_ASSERT(pScan);
    CPPUNIT_ASSERT(pLine);
    sd::ViewShell* pViewShell = pImpressDocument->GetDocShell()->GetViewShell();
    CPPUNIT_ASSERT(pViewShell);
    sd::View* pView = pViewShell->GetView();
    pView->MarkObj(pLine, pView->GetSdrPageView());
    dispatchCommand(mxComponent, u".uno:Text"_ustr, {});
    CPPUNIT_ASSERT(pView->IsTextEdit());
    typeKey(pImpressDocument, KEY_END);
    CPPUNIT_ASSERT(lcl_EditIsHidden(*pView));

    const VclPtr<vcl::Window> xWindow(pViewShell->GetActiveWindow());
    CPPUNIT_ASSERT(xWindow);
    KitHelper::postExtTextEventAsync(xWindow, KIT_EXT_TEXTINPUT, u"Q"_ustr);
    Scheduler::ProcessEventsToIdle();
    CPPUNIT_ASSERT(!lcl_EditIsHidden(*pView));
    CPPUNIT_ASSERT(!lcl_IsInk(*pScan, 20, 9));
    KitHelper::postExtTextEventAsync(xWindow, KIT_EXT_TEXTINPUT_END, u"Q"_ustr);
    Scheduler::ProcessEventsToIdle();
    pView->SdrEndTextEdit();
    CPPUNIT_ASSERT(!sd::hiddenink::IsHiddenLine(*pLine));
    CPPUNIT_ASSERT(pLine->GetOutlinerParaObject()->GetTextObject().GetText(0).endsWith("Q"));
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testHiddenInkDeleteUntouchedLineTakesItsInk)
{
    // Deleting an untouched line deletes the printed line: its ink leaves
    // the scan in the same undo action (DrawView::DeleteMarked ->
    // BeforeDeleteMarked), and one undo brings both back.
    utl::TempFileNamed aFixture(u"scandelete", true, u".pdf");
    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });
    loadFromURL(lcl_WriteScanFixture(aFixture));
    SdXImpressDocument* pImpressDocument = lcl_ActivateScanDoc(mxComponent);
    SdDrawDocument* pDoc = pImpressDocument->GetDoc();
    SdPage* pPage = pDoc->GetSdPage(0, PageKind::Standard);
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    lcl_BuildScanModelArgs(lcl_ScanModel(aScanSha256)));
    auto [pScan, pLine] = lcl_ScanAndLine(*pPage);
    CPPUNIT_ASSERT(pScan);
    CPPUNIT_ASSERT(pLine);
    sd::UndoManager* pUndoManager = pDoc->GetUndoManager();
    CPPUNIT_ASSERT(pUndoManager);
    const size_t nUndoBefore = pUndoManager->GetUndoActionCount();
    sd::View* pView = pImpressDocument->GetDocShell()->GetViewShell()->GetView();

    pView->MarkObj(pLine, pView->GetSdrPageView());
    pView->DeleteMarked();
    CPPUNIT_ASSERT_EQUAL(size_t(1), pPage->GetObjCount());
    CPPUNIT_ASSERT(!lcl_IsInk(*pScan, 20, 9));
    CPPUNIT_ASSERT(!lcl_IsInk(*pScan, 20, 20));
    CPPUNIT_ASSERT_EQUAL(nUndoBefore + 1, pUndoManager->GetUndoActionCount());

    pUndoManager->Undo();
    CPPUNIT_ASSERT_EQUAL(size_t(2), pPage->GetObjCount());
    CPPUNIT_ASSERT(lcl_IsInk(*pScan, 20, 9));
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testHiddenInkTextHitOnlyOnOcrLines)
{
    // The text-only hit test (text edit entry, URL fields) finds the text of
    // a hidden-ink OCR line, which paints nothing. The same fully
    // transparent text on any other object stays unhittable, as before: a
    // hidden watermark or an invisible label must not take the caret.
    utl::TempFileNamed aFixture(u"scanhit", true, u".pdf");
    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });
    loadFromURL(lcl_WriteScanFixture(aFixture));
    SdXImpressDocument* pImpressDocument = lcl_ActivateScanDoc(mxComponent);
    SdPage* pPage = pImpressDocument->GetDoc()->GetSdPage(0, PageKind::Standard);
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    lcl_BuildScanModelArgs(lcl_ScanModel(aScanSha256)));
    SdrTextObj* pLine = lcl_ScanAndLine(*pPage).second;
    CPPUNIT_ASSERT(pLine);
    sd::View* pView = pImpressDocument->GetDocShell()->GetViewShell()->GetView();
    const SdrPageView* pPageView = pView->GetSdrPageView();
    CPPUNIT_ASSERT(pPageView);
    // Inside the first glyphs of "Scanned line" (20 pt, from the box's left).
    const tools::Rectangle aBox = pLine->GetLogicRect();
    const Point aInText(aBox.Left() + aBox.GetWidth() / 8, aBox.Center().Y());
    const basegfx::B2DVector aNoTolerance(0.0, 0.0);

    CPPUNIT_ASSERT_EQUAL(static_cast<SdrObject*>(pLine),
                         SdrObjectPrimitiveHit(*pLine, aInText, aNoTolerance, *pPageView,
                                               nullptr, /*bTextOnly*/ true));
    pLine->SetName(u"label"_ustr);
    CPPUNIT_ASSERT(sd::hiddenink::TextHasHiddenInk(pLine->GetOutlinerParaObject()->GetTextObject()));
    CPPUNIT_ASSERT_EQUAL(static_cast<SdrObject*>(nullptr),
                         SdrObjectPrimitiveHit(*pLine, aInText, aNoTolerance, *pPageView,
                                               nullptr, /*bTextOnly*/ true));
}

CPPUNIT_TEST_FIXTURE(SdUiImpressTest, testPdfScanExportInvisibleTextAndOneBitScan)
{
    // The canvas save: a hidden line goes out as render-mode-3 text (the
    // saved scan stays searchable, painting nothing), and the bilevel scan
    // as a 1-bit image, losslessly - not 32-bit RGB plus a soft mask.
    // Without ExportInvisibleText (every other PDF export) the hidden line
    // writes no text at all, as before. Nothing inside the hidden line's
    // group paints, not even a decoration (an underline) the processor
    // writes as a fill or stroke sequence. And the saved scan comes back as
    // the same bilevel pixels - palette order and decode direction included -
    // on reopen, and again after a second save (E6).
    utl::TempFileNamed aFixture(u"scanexport", true, u".pdf");
    comphelper::COKit::setActive(true);
    comphelper::ScopeGuard aKitGuard([] { comphelper::COKit::setActive(false); });
    loadFromURL(lcl_WriteScanFixture(aFixture));
    SdXImpressDocument* pImpressDocument = lcl_ActivateScanDoc(mxComponent);
    dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                    lcl_BuildScanModelArgs(lcl_ScanModel(aScanSha256)));
    SdrTextObj* pLine
        = lcl_ScanAndLine(*pImpressDocument->GetDoc()->GetSdPage(0, PageKind::Standard)).second;
    CPPUNIT_ASSERT(pLine);

    struct Found
    {
        int nInvisible = 0; // render mode 3 text objects holding the line
        int nVisibleLine = 0; // any other render mode holding the line
        int nOneBitImages = 0;
        int nImages = 0;
        int nPaths = 0; // anything stroked or filled
    };
    const auto store = [this](const OUString& rURL, bool bInvisibleText) {
        uno::Reference<frame::XStorable> xStorable(mxComponent, uno::UNO_QUERY);
        comphelper::SequenceAsHashMap aMediaDescriptor;
        aMediaDescriptor[u"FilterName"_ustr] <<= u"draw_pdf_Export"_ustr;
        aMediaDescriptor[u"FilterData"_ustr] <<= comphelper::InitPropertySequence(
            { { "ReduceImageResolution", cpo::uno::Any(false) },
              { "UseLosslessCompression", cpo::uno::Any(true) },
              { "ExportInvisibleText", cpo::uno::Any(bInvisibleText) } });
        xStorable->storeToURL(rURL, aMediaDescriptor.getAsConstPropertyValueList());
    };
    const auto exportAndRead = [this, &store](bool bInvisibleText) {
        store(maTempFile.GetURL(), bInvisibleText);
        std::unique_ptr<vcl::pdf::PDFiumDocument> pPdf = parsePDFExport();
        CPPUNIT_ASSERT(pPdf);
        std::unique_ptr<vcl::pdf::PDFiumPage> pPdfPage = pPdf->openPage(0);
        CPPUNIT_ASSERT(pPdfPage);
        std::unique_ptr<vcl::pdf::PDFiumTextPage> pTextPage = pPdfPage->getTextPage();
        Found aFound;
        std::function<void(vcl::pdf::PDFiumPageObject&)> aVisit
            = [&](vcl::pdf::PDFiumPageObject& rObject) {
                  switch (rObject.getType())
                  {
                      case vcl::pdf::PDFPageObjectType::Form:
                          for (int n = 0; n < rObject.getFormObjectCount(); ++n)
                              if (std::unique_ptr<vcl::pdf::PDFiumPageObject> pChild
                                  = rObject.getFormObject(n))
                                  aVisit(*pChild);
                          break;
                      case vcl::pdf::PDFPageObjectType::Text:
                          if (rObject.getText(pTextPage).indexOf("Scanned") >= 0)
                          {
                              if (rObject.getTextRenderMode()
                                  == vcl::pdf::PDFTextRenderMode::Invisible)
                                  ++aFound.nInvisible;
                              else
                                  ++aFound.nVisibleLine;
                          }
                          break;
                      case vcl::pdf::PDFPageObjectType::Image:
                          ++aFound.nImages;
                          if (rObject.getImageBitsPerPixel(*pPdfPage) == 1)
                              ++aFound.nOneBitImages;
                          break;
                      case vcl::pdf::PDFPageObjectType::Path:
                          ++aFound.nPaths;
                          break;
                      default:
                          break;
                  }
              };
        for (int n = 0; n < pPdfPage->getObjectCount(); ++n)
            if (std::unique_ptr<vcl::pdf::PDFiumPageObject> pObject = pPdfPage->getObject(n))
                aVisit(*pObject);
        return aFound;
    };

    const Found aCanvas = exportAndRead(true);
    CPPUNIT_ASSERT(aCanvas.nInvisible >= 1);
    CPPUNIT_ASSERT_EQUAL(0, aCanvas.nVisibleLine);
    CPPUNIT_ASSERT_EQUAL(1, aCanvas.nImages);
    CPPUNIT_ASSERT_EQUAL(1, aCanvas.nOneBitImages);
    CPPUNIT_ASSERT_EQUAL(0, aCanvas.nPaths);

    const Found aOther = exportAndRead(false);
    CPPUNIT_ASSERT_EQUAL(0, aOther.nInvisible);
    CPPUNIT_ASSERT_EQUAL(0, aOther.nVisibleLine);

    // A hidden line that carries a decoration (set on the object, past the
    // hooks, so it is still hidden): the underline paints nothing either.
    pLine->SetMergedItem(SvxUnderlineItem(LINESTYLE_SINGLE, EE_CHAR_UNDERLINE));
    CPPUNIT_ASSERT(sd::hiddenink::IsHiddenLine(*pLine));
    const Found aUnderlined = exportAndRead(true);
    CPPUNIT_ASSERT(aUnderlined.nInvisible >= 1);
    CPPUNIT_ASSERT_EQUAL(0, aUnderlined.nVisibleLine);
    CPPUNIT_ASSERT_EQUAL(0, aUnderlined.nPaths);

    // E6: reopen the canvas save; the scan is the same bilevel picture.
    const auto reopenScan = [this](const OUString& rURL) {
        loadFromURL(rURL);
        SdXImpressDocument* pReopened = lcl_ActivateScanDoc(mxComponent);
        dispatchCommand(mxComponent, u".uno:TransformDocumentStructure"_ustr,
                        { comphelper::makePropertyValue(
                            u"DataJson"_ustr,
                            u"{ \"Transforms\": { \"SlideCommands\": ["
                            u"{\"DecomposePdfPages\": true}]}}"_ustr) });
        SdPage* pReopenedPage = pReopened->GetDoc()->GetSdPage(0, PageKind::Standard);
        for (size_t n = 0; n < pReopenedPage->GetObjCount(); ++n)
            if (auto pGraf = dynamic_cast<SdrGrafObj*>(pReopenedPage->GetObj(n)))
                return pGraf->GetGraphic().GetBitmap();
        CPPUNIT_FAIL("the reopened save has no picture");
        return Bitmap();
    };
    const auto assertFixturePixels = [](const Bitmap& rBitmap) {
        CPPUNIT_ASSERT_EQUAL(Size(64, 32), rBitmap.GetSizePixel());
        CPPUNIT_ASSERT_EQUAL(vcl::PixelFormat::N8_BPP, rBitmap.getPixelFormat());
        BitmapScopedReadAccess pRead(rBitmap);
        CPPUNIT_ASSERT(pRead);
        CPPUNIT_ASSERT(pRead->HasPalette());
        CPPUNIT_ASSERT_EQUAL(sal_uInt16(2), pRead->GetPaletteEntryCount());
        for (tools::Long nY = 0; nY < 32; ++nY)
            for (tools::Long nX = 0; nX < 64; ++nX)
                CPPUNIT_ASSERT_EQUAL_MESSAGE(
                    OString("pixel " + OString::number(nX) + "," + OString::number(nY)).getStr(),
                    lcl_FixtureInk(nX, nY), pRead->GetColor(nY, nX).GetLuminance() < 128);
    };
    const Bitmap aFirst = reopenScan(maTempFile.GetURL());
    assertFixturePixels(aFirst);

    // Save the reopened document again and reopen that: the same pixels.
    utl::TempFileNamed aSecondSave(u"scanresave", true, u".pdf");
    aSecondSave.EnableKillingFile();
    store(aSecondSave.GetURL(), true);
    const Bitmap aSecond = reopenScan(aSecondSave.GetURL());
    assertFixturePixels(aSecond);
}

CPPUNIT_PLUGIN_IMPLEMENT();

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
