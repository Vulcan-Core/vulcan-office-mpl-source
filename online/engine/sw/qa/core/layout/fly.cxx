/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/*
 * This file is part of the Collabora Office project.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

#include <swmodeltestbase.hxx>

#include <comphelper/kit.hxx>

#include <IDocumentLayoutAccess.hxx>
#include <anchoredobject.hxx>
#include <flyfrms.hxx>
#include <fmtfsize.hxx>
#include <frameformats.hxx>
#include <frmmgr.hxx>
#include <pagefrm.hxx>
#include <rootfrm.hxx>
#include <sortedobjs.hxx>
#include <docsh.hxx>
#include <viewopt.hxx>
#include <wrtsh.hxx>
#include <bodyfrm.hxx>
#include <txtfrm.hxx>

namespace
{
/// Covers sw/source/core/layout/fly.cxx fixes, i.e. mostly SwFlyFrame.
class Test : public SwModelTestBase
{
public:
    Test()
        : SwModelTestBase(u"/sw/qa/core/layout/data/"_ustr)
    {
    }
};

CPPUNIT_TEST_FIXTURE(Test, testSplitFlyNegativeHeight)
{
    // Given a document with complex enough content that a split fly frame temporarily moves below
    // the bottom of the body frame on a page:
    // When laying out the document, SwEditShell::CalcLayout() never returned:
    createSwDoc("floattable-negative-height.docx");

    SwWrtShell* pWrtShell = getSwDocShell()->GetWrtShell();
    pWrtShell->Reformat();

    // Make sure that all the pages have the expected content:
    SwDoc* pDoc = getSwDoc();
    SwRootFrame* pLayout = pDoc->getIDocumentLayoutAccess().GetCurrentLayout();
    for (SwFrame* pFrame = pLayout->Lower(); pFrame; pFrame = pFrame->GetNext())
    {
        auto pPage = pFrame->DynCastPageFrame();
        if (!pPage->GetPrev())
        {
            // First page: start of the split fly chain:
            CPPUNIT_ASSERT(pPage->GetSortedObjs());
            SwSortedObjs& rPageObjs = *pPage->GetSortedObjs();
            CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(1), rPageObjs.size());
            auto pFly = rPageObjs[0]->DynCastFlyAtContentFrame();
            CPPUNIT_ASSERT(pFly);
            CPPUNIT_ASSERT(!pFly->GetPrecede());
            CPPUNIT_ASSERT(pFly->GetFollow());
        }
        else if (pPage->GetPrev() && pPage->GetNext() && pPage->GetNext()->GetNext())
        {
            // Middle pages: have a previous and a next fly:
            CPPUNIT_ASSERT(pPage->GetSortedObjs());
            SwSortedObjs& rPageObjs = *pPage->GetSortedObjs();
            CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(1), rPageObjs.size());
            auto pFly = rPageObjs[0]->DynCastFlyAtContentFrame();
            CPPUNIT_ASSERT(pFly);
            CPPUNIT_ASSERT(pFly->GetPrecede());
            CPPUNIT_ASSERT(pFly->GetFollow());
        }
        else if (pPage->GetPrev() && pPage->GetNext() && !pPage->GetNext()->GetNext())
        {
            // Page last but one: end of the fly chain:
            CPPUNIT_ASSERT(pPage->GetSortedObjs());
            SwSortedObjs& rPageObjs = *pPage->GetSortedObjs();
            CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(1), rPageObjs.size());
            auto pFly = rPageObjs[0]->DynCastFlyAtContentFrame();
            CPPUNIT_ASSERT(pFly);
            CPPUNIT_ASSERT(pFly->GetPrecede());
            CPPUNIT_ASSERT(!pFly->GetFollow());
        }
        else if (pPage->GetPrev() && !pPage->GetNext())
        {
            // Last page: no flys.
            CPPUNIT_ASSERT(!pPage->GetSortedObjs());
        }
    }
}

CPPUNIT_TEST_FIXTURE(Test, testFlyRelWithRounding)
{
    // Given a document where page width is 21.001cm (11906 twips), and the image width is 48% of
    // the page width:
    createSwDoc("fly-rel-width-rounding.odt");

    // When laying out that document:
    SwDoc* pDoc = getSwDoc();
    SwRootFrame* pLayout = pDoc->getIDocumentLayoutAccess().GetCurrentLayout();

    // Then make sure that we calculate the width of the fly correctly:
    auto pPage = pLayout->GetLower()->DynCastPageFrame();
    CPPUNIT_ASSERT(pPage->GetSortedObjs());
    SwSortedObjs& rPageObjs = *pPage->GetSortedObjs();
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(1), rPageObjs.size());
    auto pFly = rPageObjs[0]->DynCastFlyAtContentFrame();
    CPPUNIT_ASSERT(pFly);
    tools::Long nFlyWidth = pFly->getFrameArea().Width();
    // Without the accompanying fix in place, this test would have failed with:
    // - Expected: 5715
    // - Actual  : 5714
    // i.e. 5714.88 was truncated, not rounded.
    CPPUNIT_ASSERT_EQUAL(static_cast<tools::Long>(5715), nFlyWidth);
}

CPPUNIT_TEST_FIXTURE(Test, testShapeLeftPaddingOffPage)
{
    // Given a document with a shape that is 1cm off the page:
    createSwDoc("shape-left-padding-off-page.docx");

    // When laying out that document:
    SwDoc* pDoc = getSwDoc();
    SwRootFrame* pLayout = pDoc->getIDocumentLayoutAccess().GetCurrentLayout();

    // Then make sure that the 2.5cm page margin + 2.5cm para margin and the 5cm shape left padding
    // line up (with 1px tolerance):
    auto pPage = pLayout->GetLower()->DynCastPageFrame();
    auto pBody = static_cast<SwBodyFrame*>(pPage->GetLower());
    auto pTextFrame = pBody->GetLower()->DynCastTextFrame();
    SwTwips nBodyLeft = pTextFrame->getFrameArea().Left() + pTextFrame->getFramePrintArea().Left();
    CPPUNIT_ASSERT(pPage->GetSortedObjs());
    SwSortedObjs& rPageObjs = *pPage->GetSortedObjs();
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(2), rPageObjs.size());
    auto pFly = rPageObjs[1]->DynCastFlyAtContentFrame();
    CPPUNIT_ASSERT(pFly);
    SwTwips nFlyLeft = pFly->getFrameArea().Left() + pFly->getFramePrintArea().Left();
    // Without the accompanying fix in place, this test would have failed with:
    // - Expected greater or equal than: 3119
    // - Actual  : 2574
    // i.e. the shape text had ~4cm left padding (visually) instead of 5cm.
    CPPUNIT_ASSERT_GREATEREQUAL(nBodyLeft - MINFLY, nFlyLeft);
}

CPPUNIT_TEST_FIXTURE(Test, testShapeLeftPaddingWrapThroughOffPage)
{
    // Given a document with a shape that is off the page (partially clipped on the left):
    createSwDoc("shape-left-padding-wrap-through-off-page.docx");

    // When laying out that document:
    SwDoc* pDoc = getSwDoc();
    SwRootFrame* pLayout = pDoc->getIDocumentLayoutAccess().GetCurrentLayout();

    // Then make sure that the text is also clipped on the left, left margin is only the
    // lIns="91440" (in EMUs) from the file:
    auto pPage = pLayout->GetLower()->DynCastPageFrame();
    SwSortedObjs& rPageObjs = *pPage->GetSortedObjs();
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(2), rPageObjs.size());
    auto it = std::find_if(rPageObjs.begin(), rPageObjs.end(), [](SwAnchoredObject* pObj) -> bool {
        return pObj->DynCastFlyFrame() != nullptr;
    });
    CPPUNIT_ASSERT(it != rPageObjs.end());
    auto pFly = (*it)->DynCastFlyFrame();
    CPPUNIT_ASSERT(pFly);
    SwTwips nFlyLeftMargin = pFly->getFramePrintArea().Left();
    // Without the accompanying fix in place, this test would have failed with:
    // - Expected: 144
    // - Actual  : 3031
    // i.e. there was a large left margin, the text was clipped on the right.
    CPPUNIT_ASSERT_EQUAL(static_cast<SwTwips>(144), nFlyLeftMargin);
}

CPPUNIT_TEST_FIXTURE(Test, testKitBrowseWidthFixedTextFlyGrows)
{
    // Set up COKit. Left active on purpose: UnoApiTest::tearDown() closes the document first
    // and only then deactivates COKit — deactivating before teardown disposes a kit-mode view
    // tree in non-kit mode and crashes in SfxBindings' window teardown.
    comphelper::COKit::setActive(true);

    // Given a browse-mode document whose client stated a 4700 twip reflow width:
    createSwDoc();
    SwDoc* pDoc = getSwDoc();
    SwWrtShell* pWrtShell = getSwDocShell()->GetWrtShell();
    SwViewOption aViewOptions(*pWrtShell->GetViewOptions());
    aViewOptions.setBrowseMode(true);
    pWrtShell->ApplyViewOptions(aViewOptions);
    pWrtShell->setKitBrowseWidth(4700);

    // And given a fixed-size text frame that is wider than that width, with enough text that the
    // rewrap at the fitted width needs more than the attribute height:
    for (int i = 0; i < 10; ++i)
    {
        pWrtShell->Insert(u"A quick brown fox jumps over the lazy dog and keeps running on. "_ustr);
    }
    pWrtShell->SelAll();
    SwFlyFrameAttrMgr aMgr(true, pWrtShell, Frmmgr_Type::TEXT, nullptr);
    RndStdIds eAnchor = RndStdIds::FLY_AT_PARA;
    aMgr.InsertFlyFrame(eAnchor, aMgr.GetPos(), aMgr.GetSize());
    pWrtShell->StartAllAction();
    sw::FrameFormats<sw::SpzFrameFormat*>& rFlys = *pDoc->GetSpzFrameFormats();
    sw::SpzFrameFormat* pFly = rFlys[0];
    SwAttrSet aSet(pFly->GetAttrSet());
    // 432pt x 100pt, i.e. wider than the stated 4700 twips:
    aSet.Put(SwFormatFrameSize(SwFrameSize::Fixed, /*nWidth=*/8640, /*nHeight=*/2000));
    pDoc->SetAttr(aSet, *pFly);
    pWrtShell->EndAllAction();
    pWrtShell->UnSelectFrame();
    pWrtShell->LeaveSelFrameMode();

    // When laying out that document:
    pWrtShell->Reformat();

    // Then make sure the fly is fitted to the stated width and grows to its rewrapped content:
    SwRootFrame* pLayout = pDoc->getIDocumentLayoutAccess().GetCurrentLayout();
    auto pPage = pLayout->GetLower()->DynCastPageFrame();
    CPPUNIT_ASSERT(pPage);
    CPPUNIT_ASSERT(pPage->GetSortedObjs());
    SwSortedObjs& rPageObjs = *pPage->GetSortedObjs();
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(1), rPageObjs.size());
    auto pFlyFrame = rPageObjs[0]->DynCastFlyFrame();
    CPPUNIT_ASSERT(pFlyFrame);
    // The fit itself: the fly no longer keeps its 8640 twip attribute width. If this fails, the
    // reflow plumbing did not bind and the height assertion below would be meaningless.
    CPPUNIT_ASSERT_LESS(static_cast<tools::Long>(8640), pFlyFrame->getFrameArea().Width());
    // Without the accompanying fix in place, this test would have failed with:
    // - Expected greater than: 2000
    // - Actual  : 2000
    // i.e. the fly kept its fixed attribute height while its text rewrapped at the narrower
    // width, so the tail of the text was never painted (PaintSwFrame clips at the frame area).
    CPPUNIT_ASSERT_GREATER(static_cast<tools::Long>(2000), pFlyFrame->getFrameArea().Height());
}
}

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
