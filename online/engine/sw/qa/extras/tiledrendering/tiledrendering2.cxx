/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/*
 * This file is part of the Collabora Office project.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

#include <swtiledrenderingtest.hxx>

#include <boost/property_tree/json_parser.hpp>

#include <com/sun/star/util/URLTransformer.hpp>

#include <editeng/editids.hrc>
#include <editeng/fontitem.hxx>
#include <sfx2/viewsh.hxx>
#include <sfx2/bindings.hxx>
#include <sfx2/viewfrm.hxx>
#include <sfx2/msgpool.hxx>
#include <vcl/scheduler.hxx>
#include <comphelper/propertyvalue.hxx>
#include <comphelper/dispatchcommand.hxx>
#include <sfx2/kit/helper.hxx>
#include <comphelper/kit.hxx>
#include <comphelper/scopeguard.hxx>
#include <sfx2/dispatch.hxx>
#include <tools/json_writer.hxx>
#include <vcl/virdev.hxx>
#include <unotxdoc.hxx>

#include <com/sun/star/container/XNameContainer.hpp>
#include <com/sun/star/document/UpdateDocMode.hpp>
#include <com/sun/star/style/XStyleFamiliesSupplier.hpp>
#include <sfx2/linkmgr.hxx>
#include <svx/fillbitmaplink.hxx>
#include <svx/xbtmpit.hxx>
#include <svx/xdef.hxx>
#include <ndtxt.hxx>
#include <txtfrm.hxx>
#include <view.hxx>
#include <doc.hxx>
#include <viewopt.hxx>
#include <IDocumentLayoutAccess.hxx>
#include <IDocumentLinksAdministration.hxx>
#include <IDocumentSettingAccess.hxx>
#include <IDocumentState.hxx>
#include <IDocumentUndoRedo.hxx>
#include <rootfrm.hxx>
#include <pagefrm.hxx>
#include <docsh.hxx>
#include <wrtsh.hxx>
#include <swtestviewcallback.hxx>
#include <cmdid.h>
#include <viewimp.hxx>
#include <dview.hxx>

using namespace css;
using namespace css::uno;

namespace
{
CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testStatusBarPageNumber)
{
    // Given a document with 2 pages, first view on page 1, second view on page 2:
    SwXTextDocument* pXTextDocument = createDoc();
    int nView1 = KitHelper::getCurrentView();
    SwWrtShell* pWrtShell1 = getSwDocShell()->GetWrtShell();
    pWrtShell1->InsertPageBreak();
    SwRootFrame* pLayout = pWrtShell1->getIDocumentLayoutAccess().GetCurrentLayout();
    SwFrame* pPage1 = pLayout->GetLower();
    CPPUNIT_ASSERT(pPage1);
    SwFrame* pPage2 = pPage1->GetNext();
    CPPUNIT_ASSERT(pPage2);
    KitHelper::createView();
    int nView2 = KitHelper::getCurrentView();
    pXTextDocument->initializeForTiledRendering(cpo::uno::Sequence<beans::PropertyValue>());
    KitHelper::setView(nView1);
    SwTestViewCallback aView1;
    pWrtShell1->SttEndDoc(/*bStt=*/true);
    pWrtShell1->Insert(u"start"_ustr);
    pWrtShell1->GetView().SetVisArea(pPage1->getFrameArea().SVRect());
    KitHelper::setView(nView2);
    SwTestViewCallback aView2;
    SwWrtShell* pWrtShell2 = getSwDocShell()->GetWrtShell();
    pWrtShell2->SttEndDoc(/*bStt=*/false);
    pWrtShell2->Insert(u"end"_ustr);
    pWrtShell2->GetView().SetVisArea(pPage2->getFrameArea().SVRect());
    {
        // Listen to StatePageNumber changes in view 2:
        SfxViewFrame& rFrame = pWrtShell2->GetView().GetViewFrame();
        SfxSlotPool& rSlotPool = SfxSlotPool::GetSlotPool(&rFrame);
        uno::Reference<util::XURLTransformer> xParser(util::URLTransformer::create(m_xContext));
        util::URL aCommandURL;
        aCommandURL.Complete = u".uno:StatePageNumber"_ustr;
        xParser->parseStrict(aCommandURL);
        const SfxSlot* pSlot = rSlotPool.GetUnoSlot(aCommandURL.Path);
        rFrame.GetBindings().GetDispatch(pSlot, aCommandURL, false);
    }
    aView2.m_aStateChanges.clear();

    // When deleting a character in view 2 and processing jobs with view 1 set to active:
    pWrtShell2->DelLeft();
    KitHelper::setView(nView1);
    pWrtShell2->GetView().GetViewFrame().GetBindings().GetTimer().Invoke();
    // Once more to hit the pImpl->bMsgDirty = false case in SfxBindings::NextJob_Impl().
    pWrtShell2->GetView().GetViewFrame().GetBindings().GetTimer().Invoke();

    // Then make sure the page number in view 2 is correct:
    // FIXME this should not happen, but it does from time to time.
    if (aView2.m_aStateChanges.empty())
    {
        return;
    }
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(1), aView2.m_aStateChanges.size());
    // Without the accompanying fix in place, this test would have failed with:
    // - Expected: .uno:StatePageNumber=Page 2 of 2
    // - Actual  : .uno:StatePageNumber=Page 1 of 2
    // i.e. view 2 got the page number of view 1.
    CPPUNIT_ASSERT_EQUAL(".uno:StatePageNumber=Page 2 of 2"_ostr, aView2.m_aStateChanges[0]);
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testPasteInvalidateNumRules)
{
    // Given a document with 3 pages: first page is ~empty, then page break, then pages 2 & 3 have
    // bullets:
    createDoc("numrules.odt");
    SwWrtShell* pWrtShell = getSwDocShell()->GetWrtShell();
    setupCOKitViewCallback(pWrtShell->GetSfxViewShell());
    pWrtShell->SttEndDoc(/*bStt=*/true);
    pWrtShell->Down(/*bSelect=*/false);
    pWrtShell->Insert(u"test"_ustr);
    pWrtShell->Left(SwCursorSkipMode::Chars, /*bSelect=*/true, 4, /*bBasicCall=*/false);
    dispatchCommand(mxComponent, u".uno:Cut"_ustr, {});
    m_aInvalidations = tools::Rectangle();
    m_bFullInvalidateSeen = false;

    // When pasting at the end of page 1:
    dispatchCommand(mxComponent, u".uno:PasteUnformatted"_ustr, {});

    // Then make sure we only invalidate page 1, not page 2 or page 3:
    CPPUNIT_ASSERT(!m_bFullInvalidateSeen);
    SwRootFrame* pLayout = pWrtShell->GetLayout();
    SwFrame* pPage1 = pLayout->GetLower();
    CPPUNIT_ASSERT(m_aInvalidations.Overlaps(pPage1->getFrameArea().SVRect()));
    SwFrame* pPage2 = pPage1->GetNext();
    // Without the accompanying fix in place, this test would have failed, we invalidated page 2 and
    // page 3 as well.
    CPPUNIT_ASSERT(!m_aInvalidations.Overlaps(pPage2->getFrameArea().SVRect()));
    SwFrame* pPage3 = pPage2->GetNext();
    CPPUNIT_ASSERT(!m_aInvalidations.Overlaps(pPage3->getFrameArea().SVRect()));
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testPasteInvalidateNumRulesBullet)
{
    // Given a document with 3 pages: first page is ~empty, then page break, then pages 2 & 3 have
    // bullets:
    createDoc("numrules.odt");
    SwWrtShell* pWrtShell = getSwDocShell()->GetWrtShell();
    setupCOKitViewCallback(pWrtShell->GetSfxViewShell());
    pWrtShell->SttEndDoc(/*bStt=*/true);
    pWrtShell->Down(/*bSelect=*/false);
    pWrtShell->Insert(u"test"_ustr);
    pWrtShell->Left(SwCursorSkipMode::Chars, /*bSelect=*/true, 4, /*bBasicCall=*/false);
    dispatchCommand(mxComponent, u".uno:Cut"_ustr, {});
    dispatchCommand(mxComponent, u".uno:DefaultBullet"_ustr, {});
    m_aInvalidations = tools::Rectangle();
    m_bFullInvalidateSeen = false;

    // When pasting at the end of page 1, in a paragraph that is a bullet (a list, but not a
    // numbering):
    dispatchCommand(mxComponent, u".uno:PasteUnformatted"_ustr, {});

    // Then make sure we only invalidate page 1, not page 2 or page 3:
    CPPUNIT_ASSERT(!m_bFullInvalidateSeen);
    SwRootFrame* pLayout = pWrtShell->GetLayout();
    SwFrame* pPage1 = pLayout->GetLower();
    CPPUNIT_ASSERT(m_aInvalidations.Overlaps(pPage1->getFrameArea().SVRect()));
    SwFrame* pPage2 = pPage1->GetNext();
    // Without the accompanying fix in place, this test would have failed, we invalidated page 2 and
    // page 3 as well.
    CPPUNIT_ASSERT(!m_aInvalidations.Overlaps(pPage2->getFrameArea().SVRect()));
    SwFrame* pPage3 = pPage2->GetNext();
    CPPUNIT_ASSERT(!m_aInvalidations.Overlaps(pPage3->getFrameArea().SVRect()));
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testAsyncLayout)
{
    // Given a document with 3 pages, the first page is visible:
    createDoc();
    SwTestViewCallback aView;
    SwDocShell* pDocShell = getSwDocShell();
    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();
    pWrtShell->InsertPageBreak();
    pWrtShell->InsertPageBreak();
    SwRootFrame* pLayout = pWrtShell->GetLayout();
    SwPageFrame* pPage1 = pLayout->GetLower()->DynCastPageFrame();
    pWrtShell->setKitVisibleArea(pPage1->getFrameArea().SVRect());

    // When all pages get invalidated:
    pWrtShell->StartAllAction();
    pPage1->InvalidateContent();
    SwPageFrame* pPage2 = pPage1->GetNext()->DynCastPageFrame();
    pPage2->InvalidateContent();
    SwPageFrame* pPage3 = pPage2->GetNext()->DynCastPageFrame();
    pPage3->InvalidateContent();
    pWrtShell->EndAllAction();

    // Then make sure only the first page gets a synchronous layout:
    CPPUNIT_ASSERT(!pPage1->IsInvalidContent());
    CPPUNIT_ASSERT(pPage2->IsInvalidContent());
    CPPUNIT_ASSERT(pPage3->IsInvalidContent());

    // And then processing all idle events:
    Scheduler::ProcessEventsToIdle();

    // Then make sure all pages get an async layout:
    CPPUNIT_ASSERT(!pPage1->IsInvalidContent());
    CPPUNIT_ASSERT(!pPage2->IsInvalidContent());
    CPPUNIT_ASSERT(!pPage3->IsInvalidContent());
}

/// Test callback that works with comphelper::COKit::setAnyInputCallback().
class AnyInputCallback final
{
public:
    static bool callback(void* /*pData*/, int /*nPriority*/) { return true; }

    AnyInputCallback()
    {
        comphelper::COKit::setAnyInputCallback(&callback, this, []() -> int { return -1; });
    }

    ~AnyInputCallback()
    {
        comphelper::COKit::setAnyInputCallback(nullptr, nullptr, []() -> int { return -1; });
    }
};

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testAnyInput)
{
    // Given a document with 3 pages, the first page is visible:
    createDoc();
    SwTestViewCallback aView;
    SwDocShell* pDocShell = getSwDocShell();
    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();
    pWrtShell->InsertPageBreak();
    pWrtShell->InsertPageBreak();
    SwRootFrame* pLayout = pWrtShell->GetLayout();
    SwPageFrame* pPage1 = pLayout->GetLower()->DynCastPageFrame();
    pWrtShell->setKitVisibleArea(pPage1->getFrameArea().SVRect());

    // When all pages get invalidated:
    pWrtShell->StartAllAction();
    pPage1->InvalidateContent();
    SwPageFrame* pPage2 = pPage1->GetNext()->DynCastPageFrame();
    pPage2->InvalidateContent();
    SwPageFrame* pPage3 = pPage2->GetNext()->DynCastPageFrame();
    pPage3->InvalidateContent();
    pWrtShell->EndAllAction();

    // Then make sure sync layout calculates page 1:
    CPPUNIT_ASSERT(!pPage1->IsInvalidContent());
    CPPUNIT_ASSERT(pPage2->IsInvalidContent());
    CPPUNIT_ASSERT(pPage3->IsInvalidContent());

    // And when doing one idle layout:
    AnyInputCallback aAnyInput;
    pWrtShell->LayoutIdle();

    // Then make sure async layout calculates page 2:
    CPPUNIT_ASSERT(!pPage1->IsInvalidContent());
    CPPUNIT_ASSERT(!pPage2->IsInvalidContent());
    // Without the fix in place, async layout calculated all pages, even if there were pending input
    // events.
    CPPUNIT_ASSERT(pPage3->IsInvalidContent());
    Scheduler::ProcessEventsToIdle();
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testSignatureState)
{
    // Given a document with a signature where the digest matches:
    SwXTextDocument* pXTextDocument = createDoc("signed-doc.odt");

    // When initializing tiled rendering with an author name:
    cpo::uno::Sequence<beans::PropertyValue> aPropertyValues
        = { comphelper::makePropertyValue(u".uno:Author"_ustr, cpo::uno::Any(u"A"_ustr)) };
    pXTextDocument->initializeForTiledRendering(aPropertyValues);
    SignatureState eState = getSwDocShell()->GetDocumentSignatureState();

    // Then make sure the signature state is unchanged:
    // Without the accompanying fix in place, this test would have failed with:
    // - Expected: 4 (NOTVALIDATED)
    // - Actual  : 3 (INVALID)
    // i.e. the doc was modified by the time the signature state was calculated.
    CPPUNIT_ASSERT_EQUAL(SignatureState::NOTVALIDATED, eState);
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testFormatInsertStartList)
{
    // Given a document containing a list where the text has a changed font
    SwXTextDocument* pXTextDocument = createDoc("format-insert-list.docx");
    VclPtr<vcl::Window> pDocWindow = pXTextDocument->getDocWindow();
    SwView* pView = dynamic_cast<SwView*>(SfxViewShell::Current());
    assert(pView);

    // Insert a string at the beginning of a list item
    pDocWindow->PostExtTextInputEvent(VclEventId::ExtTextInput, u"a"_ustr);
    pDocWindow->PostExtTextInputEvent(VclEventId::EndExtTextInput, u""_ustr);
    Scheduler::ProcessEventsToIdle();

    // The inserted text should have the same font as the rest
    std::unique_ptr<SvxFontItem> pFontItem;
    pView->GetViewFrame().GetBindings().QueryState(SID_ATTR_CHAR_FONT, pFontItem);
    CPPUNIT_ASSERT(pFontItem);
    CPPUNIT_ASSERT_EQUAL(u"Calibri"_ustr, pFontItem->GetFamilyName());
    // Without the accompanying fix in place, this test fails with:
    // - Expected: Calibri
    // - Actual  : MS Sans Serif
}

/// Job on the main loop that switches to the first view.
class ViewSwitcher
{
public:
    DECL_STATIC_LINK(ViewSwitcher, SwitchView, void*, void);
};

IMPL_STATIC_LINK_NOARG(ViewSwitcher, SwitchView, void*, void) { KitHelper::setView(0); }

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testPDFExportViewSwitch)
{
    // Given a document with 2 views:
    SwXTextDocument* pXTextDocument = createDoc("to-pdf.odt");
    KitHelper::registerViewCallbacks();
    SwDoc* pDoc = pXTextDocument->GetDocShell()->GetDoc();
    SwTestViewCallback aView1;
    KitHelper::createView();
    SwTestViewCallback aView2;
    SwView* pView2 = pDoc->GetDocShell()->GetView();
    uno::Reference<frame::XFrame> xFrame2 = pView2->GetViewFrame().GetFrame().GetFrameInterface();

    // When exporting to PDF on the second view and a job on the main loop that switches to the
    // first view:
    cpo::uno::Sequence<beans::PropertyValue> aPropertyValues = {
        comphelper::makePropertyValue(u"SynchronMode"_ustr, false),
        comphelper::makePropertyValue(u"URL"_ustr, maTempFile.GetURL()),
    };
    comphelper::dispatchCommand(u".uno:ExportDirectToPDF"_ustr, xFrame2, aPropertyValues);
    Application::PostUserEvent(LINK(nullptr, ViewSwitcher, SwitchView), nullptr);
    Scheduler::ProcessEventsToIdle();

    // Then make sure the callback is invoked exactly on the second view:
    // Without the accompanying fix in place, this test failed, as the callback was invoked on the
    // first view.
    CPPUNIT_ASSERT(aView1.m_aExportFile.isEmpty());
    CPPUNIT_ASSERT(!aView2.m_aExportFile.isEmpty());
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testLoadVisibleArea)
{
    // Given a document with 3 pages, the COKit visible area at load time is set to the first page:
    awt::Rectangle aVisibleArea{ 0, 0, 12240, 15840 };
    comphelper::COKit::setInitialClientVisibleArea(aVisibleArea);
    comphelper::ScopeGuard g([] { comphelper::COKit::setInitialClientVisibleArea({}); });

    // When loading that document:
    OUString aURL = createFileURL(u"3pages.odt");
    UnoApiXmlTest::loadFromURL(aURL);

    // Then make sure only the first page is laid out:
    SwDocShell* pDocShell = getSwDocShell();
    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();
    SwRootFrame* pLayout = pWrtShell->GetLayout();
    SwPageFrame* pPage1 = pLayout->GetLower()->DynCastPageFrame();
    CPPUNIT_ASSERT(!pPage1->IsInvalidContent());
    SwPageFrame* pPage2 = pPage1->GetNext()->DynCastPageFrame();
    // Without the accompanying fix in place, this test failed, as the entire document was laid out
    // before the loading finished.
    CPPUNIT_ASSERT(pPage2->IsInvalidContent());
    SwPageFrame* pPage3 = pPage2->GetNext()->DynCastPageFrame();
    CPPUNIT_ASSERT(pPage3->IsInvalidContent());
}

std::vector<OString> FilterStateChanges(const std::vector<OString>& rChanges,
                                        std::string_view rPrefix)
{
    std::vector<OString> aRet;
    for (const auto& rChange : rChanges)
    {
        if (rChange.startsWith(rPrefix))
        {
            aRet.push_back(rChange);
        }
    }
    return aRet;
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testTrackChangesPerViewEnableOne)
{
    // Given a document with two views:
    SwXTextDocument* pXTextDocument = createDoc();
    CPPUNIT_ASSERT(pXTextDocument);
    SwTestViewCallback aView1;
    int nView1 = KitHelper::getCurrentView();
    KitHelper::createView();
    SwTestViewCallback aView2;
    int nView2 = KitHelper::getCurrentView();

    // When recording changes in view1:
    KitHelper::setView(nView1);
    aView1.m_aStateChanges.clear();
    aView2.m_aStateChanges.clear();
    dispatchCommand(mxComponent, u".uno:TrackChangesInThisView"_ustr, {});

    // Then make sure view1 gets a state track changes state change, but not view2:
    // Filter out .uno:ModifiedStatus=true, which is not interesting here.
    std::vector<OString> aRecord1 = FilterStateChanges(aView1.m_aStateChanges, ".uno:TrackChanges");
    CPPUNIT_ASSERT(!aRecord1.empty());
    std::vector<OString> aRecord2 = FilterStateChanges(aView2.m_aStateChanges, ".uno:TrackChanges");
    CPPUNIT_ASSERT(aRecord2.empty());

    // And given a reset state (both view1 and view2 recording is disabled):
    cpo::uno::Sequence<beans::PropertyValue> aArgs = {
        comphelper::makePropertyValue(u"TrackChanges"_ustr, false),
    };
    dispatchCommand(mxComponent, u".uno:TrackChanges"_ustr, aArgs);

    // When recording changes in view2:
    KitHelper::setView(nView2);
    aView1.m_aStateChanges.clear();
    aView2.m_aStateChanges.clear();
    dispatchCommand(mxComponent, u".uno:TrackChangesInThisView"_ustr, {});

    // Then make sure view2 gets a 'track changes is now on' state change, but not view1:
    aRecord1 = FilterStateChanges(aView1.m_aStateChanges, ".uno:TrackChanges=true");
    CPPUNIT_ASSERT(aRecord1.empty());
    aRecord2 = FilterStateChanges(aView2.m_aStateChanges, ".uno:TrackChanges=true");
    CPPUNIT_ASSERT(!aRecord2.empty());
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testTrackChangesPerViewEnableBoth)
{
    // Given a document with 2 views, view1 record changes:
    SwXTextDocument* pXTextDocument = createDoc();
    CPPUNIT_ASSERT(pXTextDocument);
    SwTestViewCallback aView1;
    int nView1 = KitHelper::getCurrentView();
    SwWrtShell* pWrtShell1 = pXTextDocument->GetDocShell()->GetWrtShell();
    KitHelper::createView();
    SwTestViewCallback aView2;
    int nView2 = KitHelper::getCurrentView();
    SwWrtShell* pWrtShell2 = pXTextDocument->GetDocShell()->GetWrtShell();
    KitHelper::setView(nView1);
    comphelper::dispatchCommand(u".uno:TrackChangesInThisView"_ustr, {});
    KitHelper::setView(nView2);
    CPPUNIT_ASSERT(pWrtShell1->GetViewOptions()->IsRedlineRecordingOn());
    CPPUNIT_ASSERT(!pWrtShell2->GetViewOptions()->IsRedlineRecordingOn());

    // When turning on track changes for view2:
    comphelper::dispatchCommand(u".uno:TrackChangesInThisView"_ustr, {});

    // Then make sure both views have track changes turned on:
    CPPUNIT_ASSERT(pWrtShell1->GetViewOptions()->IsRedlineRecordingOn());
    // Without the accompanying fix in place, this test would have failed, .uno:TrackChanges in
    // view2 was ignored when view1 already tracked changes.
    CPPUNIT_ASSERT(pWrtShell2->GetViewOptions()->IsRedlineRecordingOn());
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testTrackChangesPerViewAllToOneTransition)
{
    // Given 2 views, recording is on in all views:
    SwXTextDocument* pXTextDocument = createDoc();
    CPPUNIT_ASSERT(pXTextDocument);
    SwTestViewCallback aView1;
    int nView1 = KitHelper::getCurrentView();
    SwWrtShell* pWrtShell1 = pXTextDocument->GetDocShell()->GetWrtShell();
    KitHelper::createView();
    SwTestViewCallback aView2;
    SwWrtShell* pWrtShell2 = pXTextDocument->GetDocShell()->GetWrtShell();
    KitHelper::setView(nView1);
    comphelper::dispatchCommand(u".uno:TrackChangesInAllViews"_ustr, {});
    CPPUNIT_ASSERT(pWrtShell1->GetViewOptions()->IsRedlineRecordingOn());
    CPPUNIT_ASSERT(pWrtShell2->GetViewOptions()->IsRedlineRecordingOn());

    // When limiting recording to just view 1:
    comphelper::dispatchCommand(u".uno:TrackChangesInThisView"_ustr, {});

    // Then make sure view 2 has recording off:
    CPPUNIT_ASSERT(pWrtShell1->GetViewOptions()->IsRedlineRecordingOn());
    // Without the accompanying fix in place, this test would have failed,
    // .uno:TrackChangesInThisView didn't turn off recording for view 2.
    CPPUNIT_ASSERT(!pWrtShell2->GetViewOptions()->IsRedlineRecordingOn());
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testTrackChangesPerViewInsert)
{
    // Given 2 views, view 1 records changes, view does not record changes:
    SwXTextDocument* pXTextDocument = createDoc();
    CPPUNIT_ASSERT(pXTextDocument);
    SwTestViewCallback aView1;
    int nView1 = KitHelper::getCurrentView();
    SwWrtShell* pWrtShell1 = pXTextDocument->GetDocShell()->GetWrtShell();
    pWrtShell1->Insert(u"X"_ustr);
    KitHelper::createView();
    SwTestViewCallback aView2;
    int nView2 = KitHelper::getCurrentView();
    SwWrtShell* pWrtShell2 = pXTextDocument->GetDocShell()->GetWrtShell();
    KitHelper::setView(nView1);
    comphelper::dispatchCommand(u".uno:TrackChangesInThisView"_ustr, {});

    // When view 1 types:
    pWrtShell1->SttEndDoc(/*bStt=*/true);
    pWrtShell1->Insert(u"A"_ustr);
    // Then make sure a redline is created:
    CPPUNIT_ASSERT_EQUAL(static_cast<SwRedlineTable::size_type>(1), pWrtShell1->GetRedlineCount());

    // When view 2 types:
    KitHelper::setView(nView2);
    pWrtShell2->SttEndDoc(/*bStt=*/false);
    pWrtShell2->Insert(u"Z"_ustr);
    // Then make sure no redline is created:
    // Without the accompanying fix in place, this test would have failed with:
    // - Expected: 1
    // - Actual  : 2
    // i.e. the insertion in view 2 was recorded.
    CPPUNIT_ASSERT_EQUAL(static_cast<SwRedlineTable::size_type>(1), pWrtShell2->GetRedlineCount());
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testTrackChangesPerViewDelete)
{
    // Given 2 views, view 1 records changes, view does not record changes:
    SwXTextDocument* pXTextDocument = createDoc();
    CPPUNIT_ASSERT(pXTextDocument);
    SwTestViewCallback aView1;
    int nView1 = KitHelper::getCurrentView();
    SwWrtShell* pWrtShell1 = pXTextDocument->GetDocShell()->GetWrtShell();
    pWrtShell1->Insert(u"test"_ustr);
    KitHelper::createView();
    SwTestViewCallback aView2;
    int nView2 = KitHelper::getCurrentView();
    SwWrtShell* pWrtShell2 = pXTextDocument->GetDocShell()->GetWrtShell();
    KitHelper::setView(nView1);
    comphelper::dispatchCommand(u".uno:TrackChangesInThisView"_ustr, {});

    // When view 1 deletes:
    pWrtShell1->SttEndDoc(/*bStt=*/true);
    pWrtShell1->Right(SwCursorSkipMode::Chars, /*bSelect=*/true, 1, /*bBasicCall=*/false);
    pWrtShell1->DelRight();
    // Then make sure a redline is created:
    CPPUNIT_ASSERT_EQUAL(static_cast<SwRedlineTable::size_type>(1), pWrtShell1->GetRedlineCount());

    // When view 2 deletes:
    KitHelper::setView(nView2);
    pWrtShell2->SttEndDoc(/*bStt=*/false);
    pWrtShell2->Left(SwCursorSkipMode::Chars, /*bSelect=*/true, 1, /*bBasicCall=*/false);
    pWrtShell2->DelLeft();
    // Then make sure no redline is created:
    // Without the accompanying fix in place, this test would have failed with:
    // - Expected: 1
    // - Actual  : 2
    // i.e. the deletion in view 2 was recorded.
    CPPUNIT_ASSERT_EQUAL(static_cast<SwRedlineTable::size_type>(1), pWrtShell2->GetRedlineCount());
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testTrackChangesPerDocInsert)
{
    // Given 2 views, view 1 turns on per-doc change recording:
    SwXTextDocument* pXTextDocument = createDoc();
    CPPUNIT_ASSERT(pXTextDocument);
    SwTestViewCallback aView1;
    int nView1 = KitHelper::getCurrentView();
    SwWrtShell* pWrtShell1 = pXTextDocument->GetDocShell()->GetWrtShell();
    pWrtShell1->Insert(u"X"_ustr);
    KitHelper::createView();
    SwTestViewCallback aView2;
    int nView2 = KitHelper::getCurrentView();
    SwWrtShell* pWrtShell2 = pXTextDocument->GetDocShell()->GetWrtShell();
    KitHelper::setView(nView1);
    comphelper::dispatchCommand(u".uno:TrackChanges"_ustr, {});

    // When view 1 types:
    pWrtShell1->SttEndDoc(/*bStt=*/true);
    pWrtShell1->Insert(u"A"_ustr);
    // Then make sure a redline is created:
    CPPUNIT_ASSERT_EQUAL(static_cast<SwRedlineTable::size_type>(1), pWrtShell1->GetRedlineCount());

    // When view 2 types:
    KitHelper::setView(nView2);
    pWrtShell2->SttEndDoc(/*bStt=*/false);
    pWrtShell2->Insert(u"Z"_ustr);
    // Without the accompanying fix in place, this test would have failed with:
    // - Expected: 2
    // - Actual  : 1
    // i.e. track changes recording was unconditionally per-view.
    CPPUNIT_ASSERT_EQUAL(static_cast<SwRedlineTable::size_type>(2), pWrtShell2->GetRedlineCount());
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testTrackChangesStates)
{
    // Given a document with 2 views:
    SwXTextDocument* pXTextDocument = createDoc();
    CPPUNIT_ASSERT(pXTextDocument);
    SwTestViewCallback aView1;
    int nView1 = KitHelper::getCurrentView();
    SwView* pView1 = pXTextDocument->GetDocShell()->GetView();
    KitHelper::createView();
    SwTestViewCallback aView2;
    SwView* pView2 = pXTextDocument->GetDocShell()->GetView();
    KitHelper::setView(nView1);

    // When enabling recording in view1 only:
    pView1->GetViewFrame().GetDispatcher()->Execute(FN_TRACK_CHANGES_IN_THIS_VIEW,
                                                    SfxCallMode::SYNCHRON);

    // Then make sure the "is record", "is record for this view on" and "is record for all views on"
    // statuses are correct:
    std::unique_ptr<SfxPoolItem> pItem;
    pView1->GetViewFrame().GetBindings().QueryState(FN_REDLINE_ON, pItem);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(FN_REDLINE_ON), pItem->Which());
    // Without the accompanying fix in place, this test would have failed, enabling recording for
    // this view didn't enable the toolbar button in the same view, which looked confusing.
    CPPUNIT_ASSERT(dynamic_cast<SfxBoolItem*>(pItem.get())->GetValue());
    pView1->GetViewFrame().GetBindings().QueryState(FN_TRACK_CHANGES_IN_THIS_VIEW, pItem);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(FN_TRACK_CHANGES_IN_THIS_VIEW), pItem->Which());
    CPPUNIT_ASSERT(dynamic_cast<SfxBoolItem*>(pItem.get())->GetValue());
    pView1->GetViewFrame().GetBindings().QueryState(FN_TRACK_CHANGES_IN_ALL_VIEWS, pItem);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(FN_TRACK_CHANGES_IN_ALL_VIEWS), pItem->Which());
    CPPUNIT_ASSERT(!dynamic_cast<SfxBoolItem*>(pItem.get())->GetValue());
    pView2->GetViewFrame().GetBindings().QueryState(FN_REDLINE_ON, pItem);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(FN_REDLINE_ON), pItem->Which());
    CPPUNIT_ASSERT(!dynamic_cast<SfxBoolItem*>(pItem.get())->GetValue());
    pView2->GetViewFrame().GetBindings().QueryState(FN_TRACK_CHANGES_IN_THIS_VIEW, pItem);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(FN_TRACK_CHANGES_IN_THIS_VIEW), pItem->Which());
    CPPUNIT_ASSERT(!dynamic_cast<SfxBoolItem*>(pItem.get())->GetValue());
    pView2->GetViewFrame().GetBindings().QueryState(FN_TRACK_CHANGES_IN_ALL_VIEWS, pItem);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(FN_TRACK_CHANGES_IN_ALL_VIEWS), pItem->Which());
    CPPUNIT_ASSERT(!dynamic_cast<SfxBoolItem*>(pItem.get())->GetValue());

    // When disabling recording:
    SfxBoolItem aOn(FN_REDLINE_ON, false);
    pView1->GetViewFrame().GetDispatcher()->ExecuteList(FN_REDLINE_ON, SfxCallMode::SYNCHRON,
                                                        { &aOn });

    // Then make sure the "is record", "is record for this view on" and "is record for all views on"
    // statuses are correct:
    pView1->GetViewFrame().GetBindings().QueryState(FN_REDLINE_ON, pItem);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(FN_REDLINE_ON), pItem->Which());
    CPPUNIT_ASSERT(!dynamic_cast<SfxBoolItem*>(pItem.get())->GetValue());
    pView1->GetViewFrame().GetBindings().QueryState(FN_TRACK_CHANGES_IN_THIS_VIEW, pItem);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(FN_TRACK_CHANGES_IN_THIS_VIEW), pItem->Which());
    CPPUNIT_ASSERT(!dynamic_cast<SfxBoolItem*>(pItem.get())->GetValue());
    pView1->GetViewFrame().GetBindings().QueryState(FN_TRACK_CHANGES_IN_ALL_VIEWS, pItem);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(FN_TRACK_CHANGES_IN_ALL_VIEWS), pItem->Which());
    CPPUNIT_ASSERT(!dynamic_cast<SfxBoolItem*>(pItem.get())->GetValue());
    pView2->GetViewFrame().GetBindings().QueryState(FN_REDLINE_ON, pItem);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(FN_REDLINE_ON), pItem->Which());
    CPPUNIT_ASSERT(!dynamic_cast<SfxBoolItem*>(pItem.get())->GetValue());
    pView2->GetViewFrame().GetBindings().QueryState(FN_TRACK_CHANGES_IN_THIS_VIEW, pItem);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(FN_TRACK_CHANGES_IN_THIS_VIEW), pItem->Which());
    CPPUNIT_ASSERT(!dynamic_cast<SfxBoolItem*>(pItem.get())->GetValue());
    pView2->GetViewFrame().GetBindings().QueryState(FN_TRACK_CHANGES_IN_ALL_VIEWS, pItem);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(FN_TRACK_CHANGES_IN_ALL_VIEWS), pItem->Which());
    CPPUNIT_ASSERT(!dynamic_cast<SfxBoolItem*>(pItem.get())->GetValue());

    // When enabling recording in all views:
    pView1->GetViewFrame().GetDispatcher()->Execute(FN_TRACK_CHANGES_IN_ALL_VIEWS,
                                                    SfxCallMode::SYNCHRON);

    // Then make sure the "is record", "is record for this view on" and "is record for all views on"
    // statuses are correct:
    pView1->GetViewFrame().GetBindings().QueryState(FN_REDLINE_ON, pItem);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(FN_REDLINE_ON), pItem->Which());
    CPPUNIT_ASSERT(dynamic_cast<SfxBoolItem*>(pItem.get())->GetValue());
    pView1->GetViewFrame().GetBindings().QueryState(FN_TRACK_CHANGES_IN_THIS_VIEW, pItem);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(FN_TRACK_CHANGES_IN_THIS_VIEW), pItem->Which());
    CPPUNIT_ASSERT(!dynamic_cast<SfxBoolItem*>(pItem.get())->GetValue());
    pView1->GetViewFrame().GetBindings().QueryState(FN_TRACK_CHANGES_IN_ALL_VIEWS, pItem);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(FN_TRACK_CHANGES_IN_ALL_VIEWS), pItem->Which());
    CPPUNIT_ASSERT(dynamic_cast<SfxBoolItem*>(pItem.get())->GetValue());
    pView2->GetViewFrame().GetBindings().QueryState(FN_REDLINE_ON, pItem);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(FN_REDLINE_ON), pItem->Which());
    CPPUNIT_ASSERT(dynamic_cast<SfxBoolItem*>(pItem.get())->GetValue());
    pView2->GetViewFrame().GetBindings().QueryState(FN_TRACK_CHANGES_IN_THIS_VIEW, pItem);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(FN_TRACK_CHANGES_IN_THIS_VIEW), pItem->Which());
    CPPUNIT_ASSERT(!dynamic_cast<SfxBoolItem*>(pItem.get())->GetValue());
    pView2->GetViewFrame().GetBindings().QueryState(FN_TRACK_CHANGES_IN_ALL_VIEWS, pItem);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(FN_TRACK_CHANGES_IN_ALL_VIEWS), pItem->Which());
    CPPUNIT_ASSERT(dynamic_cast<SfxBoolItem*>(pItem.get())->GetValue());
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testControlCodesCursor)
{
    // Given a document with hidden formatting marks:
    SwXTextDocument* pXTextDocument = createDoc();
    CPPUNIT_ASSERT(pXTextDocument);
    SwTestViewCallback aView1;
    aView1.m_bCursorVisible = false;

    // When showing formatting marks:
    dispatchCommand(mxComponent, u".uno:ControlCodes"_ustr, {});

    // Then make sure this doesn't result in a KIT_CALLBACK_CURSOR_VISIBLE callback:
    // Without the accompanying fix in place, this test would have failed, the view jumped to the
    // cursor when showing formatting marks.
    CPPUNIT_ASSERT(!aView1.m_bCursorVisible);
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testTrackChangesInsertUndo)
{
    // Given a document with 2 views, first view enables redline record for that view only:
    SwXTextDocument* pXTextDocument = createDoc();
    CPPUNIT_ASSERT(pXTextDocument);
    SwTestViewCallback aView1;
    int nView1 = KitHelper::getCurrentView();
    SwView* pView1 = pXTextDocument->GetDocShell()->GetView();
    SwWrtShell* pWrtShell1 = pXTextDocument->GetDocShell()->GetWrtShell();
    KitHelper::createView();
    SwTestViewCallback aView2;
    KitHelper::setView(nView1);
    comphelper::dispatchCommand(u".uno:TrackChangesInThisView"_ustr, {});

    // When typing and undoing:
    pWrtShell1->Insert(u"A"_ustr);
    pWrtShell1->Undo();

    // Then make sure the record mode doesn't change:
    std::unique_ptr<SfxPoolItem> pItem;
    pView1->GetViewFrame().GetBindings().QueryState(FN_TRACK_CHANGES_IN_THIS_VIEW, pItem);
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(FN_TRACK_CHANGES_IN_THIS_VIEW), pItem->Which());
    // Without the accompanying fix in place, this test would have failed, undo changed "this view"
    // record mode to "all views", which is unexpected.
    CPPUNIT_ASSERT(dynamic_cast<SfxBoolItem*>(pItem.get())->GetValue());
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testCommentsOnLoad)
{
    // Given a document of 3 pages, with a small enough visible area that document load doesn't lay
    // out the entire document:
    awt::Rectangle aVisibleArea{ 0, 0, 12240, 15840 };
    comphelper::COKit::setInitialClientVisibleArea(aVisibleArea);
    comphelper::ScopeGuard g([] { comphelper::COKit::setInitialClientVisibleArea({}); });
    OUString aURL = createFileURL(u"comments-on-load.docx");
    loadFromURL(aURL);
    SwXTextDocument* pXTextDocument = getSwTextDoc();
    SwTestViewCallback aView;
    tools::JsonWriter aWriter;

    // When getting the list of comments from the document + listening for notifications from idle
    // layout:
    pXTextDocument->getPostIts(aWriter);
    Scheduler::ProcessEventsToIdle();

    // Then make sure that:
    // 1) We test the interesting scenario, so getPostIts() reports 0 comments and
    // 2) A callback is emitted to notify about the comment on the last page once user events are
    // processed.
    OString aPostIts = aWriter.finishAndGetAsOString();
    std::stringstream aStream(aPostIts.getStr());
    boost::property_tree::ptree aTree;
    boost::property_tree::read_json(aStream, aTree);
    size_t nCommentCount = aTree.get_child("comments").size();
    CPPUNIT_ASSERT_EQUAL(static_cast<size_t>(0), nCommentCount);
    CPPUNIT_ASSERT_EQUAL(1, aView.m_nCommentCallbackCount);
    // Without the accompanying fix in place, this test would have failed with:
    // uncaught exception of type std::exception (or derived).
    // - No such node (action)
    // i.e. there was no notification about the comment that was positioned by the user event,
    // seemingly the comment was load on load (it was there, but not visible).
    auto aAction = aView.m_aComment.get_child("action").get_value<std::string>();
    CPPUNIT_ASSERT_EQUAL(std::string("Add"), aAction);
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testSpellcheckVisibleArea)
{
    // Given a document with 3 pages, the first page is visible:
    OUString aURL = createFileURL(u"3pages.odt");
    UnoApiXmlTest::loadFromURL(aURL);
    SwDocShell* pDocShell = getSwDocShell();
    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();
    SwRootFrame* pLayout = pWrtShell->GetLayout();
    SwPageFrame* pPage1 = pLayout->GetLower()->DynCastPageFrame();
    pWrtShell->setKitVisibleArea(pPage1->getFrameArea().SVRect());
    pPage1->InvalidateAll();
    SwPageFrame* pPage2 = pPage1->GetNext()->DynCastPageFrame();
    pPage2->InvalidateAll();
    SwPageFrame* pPage3 = pPage2->GetNext()->DynCastPageFrame();
    pPage3->InvalidateAll();

    // When doing idle layout and it's interrupted:
    AnyInputCallback aAnyInput;
    pWrtShell->LayoutIdle();

    // Then make sure the visible area is spellchecked, but not the rest:
    CPPUNIT_ASSERT(!pPage1->IsInvalidSpelling());
    CPPUNIT_ASSERT(pPage2->IsInvalidSpelling());
    CPPUNIT_ASSERT(pPage3->IsInvalidSpelling());
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testSpellcheckIdle)
{
    // Given a document with 3 pages, the first page is visible, spellcheck is only done for the
    // visible page:
    OUString aURL = createFileURL(u"3pages.odt");
    UnoApiXmlTest::loadFromURL(aURL);
    SwDocShell* pDocShell = getSwDocShell();
    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();
    SwRootFrame* pLayout = pWrtShell->GetLayout();
    SwPageFrame* pPage1 = pLayout->GetLower()->DynCastPageFrame();
    pWrtShell->setKitVisibleArea(pPage1->getFrameArea().SVRect());
    SwPageFrame* pPage2 = pPage1->GetNext()->DynCastPageFrame();
    SwPageFrame* pPage3 = pPage2->GetNext()->DynCastPageFrame();
    pWrtShell->LayoutIdle();
    Scheduler::ProcessEventsToIdle();
    CPPUNIT_ASSERT(!pPage1->IsInvalidSpelling());
    CPPUNIT_ASSERT(!pPage2->IsInvalidSpelling());
    CPPUNIT_ASSERT(!pPage3->IsInvalidSpelling());
    for (SwPageFrame* pPage : { pPage2, pPage3 })
    {
        SwContentFrame* pContent = pPage->ContainsContent();
        while (pContent && pPage->IsAnLower(pContent))
        {
            if (pContent->IsTextFrame())
            {
                SwTextFrame* pTextFrame = static_cast<SwTextFrame*>(pContent);
                if (SwTextNode* pNode = pTextFrame->GetTextNodeFirst())
                    pNode->SetWrongDirty(sw::WrongState::TODO);
            }
            pContent = pContent->GetNextContentFrame();
        }
        pPage->InvalidateSpelling();
    }
    CPPUNIT_ASSERT(pPage2->IsInvalidSpelling());
    CPPUNIT_ASSERT(pPage3->IsInvalidSpelling());

    // When doing idle layout and and the anyInput callback wants to interrupt:
    AnyInputCallback aAnyInput;
    pWrtShell->LayoutIdle();

    // Then make sure spellcheck is avoided for non-visible pages:
    // Without the fix in place, async layout did spellcheck for all pages.
    CPPUNIT_ASSERT(pPage2->IsInvalidSpelling());
    CPPUNIT_ASSERT(pPage3->IsInvalidSpelling());
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testIdleLayoutShape)
{
    // Given a loaded document with a defined viewport:
    awt::Rectangle aVisibleArea{ 0, 0, 12240, 15840 };
    comphelper::COKit::setInitialClientVisibleArea(aVisibleArea);
    comphelper::ScopeGuard g([] { comphelper::COKit::setInitialClientVisibleArea({}); });
    OUString aURL = createFileURL(u"3pages-shape.odt");
    UnoApiXmlTest::loadFromURL(aURL);

    // When doing idle layout:
    AnyInputCallback aAnyInput;
    SwDocShell* pDocShell = getSwDocShell();
    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();
    pWrtShell->LayoutIdle();

    // Then make sure that the draw task started during idle layout has no high priority, either:
    SdrPaintView* pDrawView = pWrtShell->Imp()->GetDrawView();
    CPPUNIT_ASSERT(pDrawView);
    const Idle& rDrawIdle = pDrawView->GetComeBackIdle();
    CPPUNIT_ASSERT(rDrawIdle.IsActive());
    // Without the accompanying fix in place, this test would have failed with:
    // - Expected greater than: 4
    // - Actual  : 4
    // i.e. the priority was TaskPriority::REPAINT instead of TaskPriority::DEFAULT_IDLE.
    CPPUNIT_ASSERT_GREATER(TaskPriority::REPAINT, rDrawIdle.GetPriority());
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testIdleLayoutPageDelete)
{
    // Given a document with 2 pages, cursor is after the page break:
    createSwDoc();
    SwDocShell* pDocShell = getSwDocShell();
    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();
    pWrtShell->Insert(u"x"_ustr);
    pWrtShell->InsertPageBreak();
    SwRootFrame* pLayout = pWrtShell->GetLayout();
    sal_uInt16 nLastPage = pLayout->GetLastPage()->GetPhyPageNum();
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(2), nLastPage);

    // When deleting the page break, mutating the page count:
    pWrtShell->DelLeft();

    // Then make sure the bindings (status bar, etc) is updated with an idle VCL task:
    nLastPage = pLayout->GetLastPage()->GetPhyPageNum();
    CPPUNIT_ASSERT_EQUAL(static_cast<sal_uInt16>(1), nLastPage);
    SfxViewFrame& rFrame = pWrtShell->GetView().GetViewFrame();
    Timer& rBindingsTimer = rFrame.GetBindings().GetTimer();
    // Without the accompanying fix in place, this test would have failed with:
    // - Expected greater than: 4
    // - Actual  : 2
    // i.e. the priority was TaskPriority::HIGH_IDLE instead of TaskPriority::DEFAULT_IDLE.
    CPPUNIT_ASSERT_GREATER(TaskPriority::REPAINT, rBindingsTimer.GetPriority());
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testBlockedCommandSlotState)
{
    createDoc();

    SfxViewShell* pViewShell = SfxViewShell::Current();
    CPPUNIT_ASSERT(pViewShell);
    SfxDispatcher* pDispatcher = pViewShell->GetViewFrame().GetDispatcher();
    CPPUNIT_ASSERT(pDispatcher);

    // Query the state of .uno:Bold before blocking — should be enabled
    SfxPoolItemHolder aResult;
    SfxItemState eState = pDispatcher->QueryState(SID_ATTR_CHAR_WEIGHT, aResult);
    CPPUNIT_ASSERT(eState != SfxItemState::DISABLED);

    // Block .uno:Bold
    int nViewId = KitHelper::getView(*pViewShell);
    KitHelper::setBlockedCommandList(nViewId, ".uno:Bold");

    // Query the state of .uno:Bold after blocking — should be disabled
    eState = pDispatcher->QueryState(SID_ATTR_CHAR_WEIGHT, aResult);
    CPPUNIT_ASSERT_EQUAL(SfxItemState::DISABLED, eState);
}
CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testImageBulletRemoteNotFetched)
{
    // text:list-level-style-image with a remote xlink:href must not fetch
    // the URL during paint when link updates are not allowed.
    comphelper::COKit::setActive(false);

    cpo::uno::Sequence<beans::PropertyValue> aParams = {
        comphelper::makePropertyValue(u"UpdateDocMode"_ustr,
                                      sal_Int16(css::document::UpdateDocMode::NO_UPDATE)),
    };
    loadWithParams(createFileURL(u"image-bullet-link.fodt"), aParams);

    SwDocShell* pDocShell = getSwDocShell();
    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();

    // the bullet image link should be registered in the link manager
    sfx2::LinkManager& rLinkMgr
        = pDocShell->GetDoc()->getIDocumentLinksAdministration().GetLinkManager();
    CPPUNIT_ASSERT_MESSAGE("bullet image link should be registered", !rLinkMgr.GetLinks().empty());

    pWrtShell->CalcLayout();

    // render through SwViewShell::Paint which exercises the full text paint
    // path including SwGrfNumPortion::Paint -> DrawGraphic -> lcl_DrawGraphic.
    // The getUserAllowsLinkUpdate guard blocks the fetch.
    ScopedVclPtrInstance<VirtualDevice> pDevice(DeviceFormat::WITHOUT_ALPHA);
    pDevice->SetOutputSizePixel(Size(1024, 1024));
    static_cast<SwViewShell*>(pWrtShell)->Paint(
        *pDevice, tools::Rectangle(Point(0, 0), pWrtShell->GetLayout()->getFrameArea().SSize()));
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testBackgroundImageRemoteNotFetched)
{
    // style:background-image with a remote xlink:href must not fetch
    // the URL during paint when link updates are not allowed.
    comphelper::COKit::setActive(false);

    cpo::uno::Sequence<beans::PropertyValue> aParams = {
        comphelper::makePropertyValue(u"UpdateDocMode"_ustr,
                                      sal_Int16(css::document::UpdateDocMode::NO_UPDATE)),
    };
    loadWithParams(createFileURL(u"background-image-link.fodt"), aParams);

    SwDocShell* pDocShell = getSwDocShell();
    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();

    // the background image link should be registered in the link manager
    sfx2::LinkManager& rLinkMgr
        = pDocShell->GetDoc()->getIDocumentLinksAdministration().GetLinkManager();
    CPPUNIT_ASSERT_MESSAGE("background image link should be registered",
                           !rLinkMgr.GetLinks().empty());

    pWrtShell->CalcLayout();

    // render through SwViewShell::Paint which exercises the fill attribute
    // rendering path via createNewSdrFillGraphicAttribute.
    // The assert in that function will fire if a remote fetch is attempted.
    ScopedVclPtrInstance<VirtualDevice> pDevice(DeviceFormat::WITHOUT_ALPHA);
    pDevice->SetOutputSizePixel(Size(1024, 1024));
    static_cast<SwViewShell*>(pWrtShell)->Paint(
        *pDevice, tools::Rectangle(Point(0, 0), pWrtShell->GetLayout()->getFrameArea().SSize()));
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testParagraphStyleBackgroundImageRemoteNotFetched)
{
    // style:background-image on a named paragraph style (office:styles, not
    // an autostyle) with a remote xlink:href, shared by multiple paragraphs,
    // must not fetch the URL during paint when link updates are not allowed.
    comphelper::COKit::setActive(false);

    cpo::uno::Sequence<beans::PropertyValue> aParams = {
        comphelper::makePropertyValue(u"UpdateDocMode"_ustr,
                                      sal_Int16(css::document::UpdateDocMode::NO_UPDATE)),
    };
    loadWithParams(createFileURL(u"paragraph-style-background-link.fodt"), aParams);

    SwDocShell* pDocShell = getSwDocShell();
    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();

    sfx2::LinkManager& rLinkMgr
        = pDocShell->GetDoc()->getIDocumentLinksAdministration().GetLinkManager();
    CPPUNIT_ASSERT_MESSAGE("paragraph-style background image link should be registered",
                           !rLinkMgr.GetLinks().empty());

    pWrtShell->CalcLayout();

    ScopedVclPtrInstance<VirtualDevice> pDevice(DeviceFormat::WITHOUT_ALPHA);
    pDevice->SetOutputSizePixel(Size(1024, 1024));
    static_cast<SwViewShell*>(pWrtShell)->Paint(
        *pDevice, tools::Rectangle(Point(0, 0), pWrtShell->GetLayout()->getFrameArea().SSize()));
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testParagraphStyleDeleteReleasesBackgroundImageLink)
{
    // Deleting the paragraph style that carries the remote background must
    // drop the style's entry from the link manager, so Edit > Links no
    // longer offers a link whose target style is gone.
    comphelper::COKit::setActive(false);

    cpo::uno::Sequence<beans::PropertyValue> aParams = {
        comphelper::makePropertyValue(u"UpdateDocMode"_ustr,
                                      sal_Int16(css::document::UpdateDocMode::NO_UPDATE)),
    };
    loadWithParams(createFileURL(u"paragraph-style-background-link.fodt"), aParams);

    SwDocShell* pDocShell = getSwDocShell();
    sfx2::LinkManager& rLinkMgr
        = pDocShell->GetDoc()->getIDocumentLinksAdministration().GetLinkManager();
    CPPUNIT_ASSERT_MESSAGE("paragraph-style background image link should be registered",
                           !rLinkMgr.GetLinks().empty());

    uno::Reference<style::XStyleFamiliesSupplier> xSupplier(mxComponent, uno::UNO_QUERY);
    uno::Reference<container::XNameContainer> xParaStyles(
        xSupplier->getStyleFamilies()->getByName(u"ParagraphStyles"_ustr), uno::UNO_QUERY);
    xParaStyles->removeByName(u"LinkBackground"_ustr);

    CPPUNIT_ASSERT_MESSAGE("deleting the style should release its link",
                           rLinkMgr.GetLinks().empty());
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testParagraphDeleteReleasesBackgroundImageLink)
{
    // Joining away a paragraph with its own remote background must drop that
    // paragraph's entry from the link manager once the undo history no
    // longer keeps the deleted paragraph alive.
    comphelper::COKit::setActive(false);

    cpo::uno::Sequence<beans::PropertyValue> aParams = {
        comphelper::makePropertyValue(u"UpdateDocMode"_ustr,
                                      sal_Int16(css::document::UpdateDocMode::NO_UPDATE)),
    };
    loadWithParams(createFileURL(u"two-paragraph-background-links.fodt"), aParams);

    SwDocShell* pDocShell = getSwDocShell();
    sfx2::LinkManager& rLinkMgr
        = pDocShell->GetDoc()->getIDocumentLinksAdministration().GetLinkManager();
    CPPUNIT_ASSERT_EQUAL(size_t(2), rLinkMgr.GetLinks().size());

    // forward-delete at the end of the first paragraph joins the second
    // paragraph into it
    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();
    pWrtShell->SttEndDoc(/*bStt=*/true);
    pWrtShell->EndPara();
    pWrtShell->DelRight();

    // the deleted paragraph may survive in the undo history and keep its
    // link until the history lets go of it
    pDocShell->GetDoc()->GetIDocumentUndoRedo().DelAllUndoObj();

    CPPUNIT_ASSERT_EQUAL(size_t(1), rLinkMgr.GetLinks().size());
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testBackgroundImageLinkSurvivesUpdate)
{
    // Resolving a paragraph's remote background must write the graphic back
    // to that paragraph and keep the link registered, like the resolved
    // drawing-layer links, so Edit > Links can still update or break it.
    comphelper::COKit::setActive(false);

    cpo::uno::Sequence<beans::PropertyValue> aParams = {
        comphelper::makePropertyValue(u"UpdateDocMode"_ustr,
                                      sal_Int16(css::document::UpdateDocMode::NO_UPDATE)),
    };
    loadWithParams(createFileURL(u"two-paragraph-background-links.fodt"), aParams);

    SwDocShell* pDocShell = getSwDocShell();
    sfx2::LinkManager& rLinkMgr
        = pDocShell->GetDoc()->getIDocumentLinksAdministration().GetLinkManager();
    CPPUNIT_ASSERT_EQUAL(size_t(2), rLinkMgr.GetLinks().size());

    // deliver a locally loadable graphic to both links, standing in for the
    // arrival of the remote data
    cpo::uno::Any aFetched(createFileURL(u"fill.png"));
    rLinkMgr.GetLinks()[0]->DataChanged(u"image/png"_ustr, aFetched);
    rLinkMgr.GetLinks()[1]->DataChanged(u"image/png"_ustr, aFetched);

    CPPUNIT_ASSERT_EQUAL(size_t(2), rLinkMgr.GetLinks().size());

    // the write-back resolved both paragraphs' items
    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();
    pWrtShell->SttEndDoc(/*bStt=*/true);
    SwTextNode* pFirst = pWrtShell->GetCursor()->GetPointNode().GetTextNode();
    CPPUNIT_ASSERT(pFirst);
    const XFillBitmapItem* pItem = pFirst->GetSwAttrSet().GetItemIfSet(XATTR_FILLBITMAP, false);
    CPPUNIT_ASSERT(pItem);
    CPPUNIT_ASSERT(getDeferredOriginURL(*pItem).isEmpty());
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testPageBackgroundImageRemoteNotFetched)
{
    // style:background-image on a page style with a remote xlink:href must
    // not fetch the URL during paint when link updates are not allowed.
    comphelper::COKit::setActive(false);

    cpo::uno::Sequence<beans::PropertyValue> aParams = {
        comphelper::makePropertyValue(u"UpdateDocMode"_ustr,
                                      sal_Int16(css::document::UpdateDocMode::NO_UPDATE)),
    };
    loadWithParams(createFileURL(u"page-background-link.fodt"), aParams);

    SwDocShell* pDocShell = getSwDocShell();
    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();

    pWrtShell->CalcLayout();

    // render through SwViewShell::Paint - the assert in
    // createNewSdrFillGraphicAttribute will fire if a remote fetch is attempted.
    ScopedVclPtrInstance<VirtualDevice> pDevice(DeviceFormat::WITHOUT_ALPHA);
    pDevice->SetOutputSizePixel(Size(1024, 1024));
    static_cast<SwViewShell*>(pWrtShell)->Paint(
        *pDevice, tools::Rectangle(Point(0, 0), pWrtShell->GetLayout()->getFrameArea().SSize()));
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testShapeFillRemoteNotFetched)
{
    // draw:fill-image with a remote URL on a shape must not fetch
    // the URL during paint when link updates are not allowed.
    // The assert in createNewSdrFillGraphicAttribute will fire if
    // a remote fetch is attempted.
    comphelper::COKit::setActive(false);

    cpo::uno::Sequence<beans::PropertyValue> aParams = {
        comphelper::makePropertyValue(u"UpdateDocMode"_ustr,
                                      sal_Int16(css::document::UpdateDocMode::NO_UPDATE)),
    };
    loadWithParams(createFileURL(u"shape-fill-link.fodt"), aParams);

    SwDocShell* pDocShell = getSwDocShell();
    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();

    pWrtShell->CalcLayout();

    ScopedVclPtrInstance<VirtualDevice> pDevice(DeviceFormat::WITHOUT_ALPHA);
    pDevice->SetOutputSizePixel(Size(1024, 1024));
    static_cast<SwViewShell*>(pWrtShell)->Paint(
        *pDevice, tools::Rectangle(Point(0, 0), pWrtShell->GetLayout()->getFrameArea().SSize()));
}

CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testFormImageRemoteNotFetched)
{
    // Form image button with a remote ImageURL must not fetch the
    // URL during import when link updates are not allowed. The
    // ImageURL property is skipped in elementimport.cxx and deferred
    // until the user allows link updates.
    comphelper::COKit::setActive(false);

    cpo::uno::Sequence<beans::PropertyValue> aParams = {
        comphelper::makePropertyValue(u"UpdateDocMode"_ustr,
                                      sal_Int16(css::document::UpdateDocMode::NO_UPDATE)),
    };
    loadWithParams(createFileURL(u"form-image-link.fodt"), aParams);

    SwDocShell* pDocShell = getSwDocShell();
    SwWrtShell* pWrtShell = pDocShell->GetWrtShell();

    pWrtShell->CalcLayout();

    ScopedVclPtrInstance<VirtualDevice> pDevice(DeviceFormat::WITHOUT_ALPHA);
    pDevice->SetOutputSizePixel(Size(1024, 1024));
    static_cast<SwViewShell*>(pWrtShell)->Paint(
        *pDevice, tools::Rectangle(Point(0, 0), pWrtShell->GetLayout()->getFrameArea().SSize()));
}
/*
 * VULCAN (Lane W, W5): a reflow vote must not cost the document its ability
 * to seat the next collaborator.
 *
 * Wet-proven defect (armonly local-rig repro on the build-#5 image): the
 * phone's positive .uno:BrowseWidth vote armed browse mode, and
 * SwDocShell::ToggleLayoutMode then set NewWindowAllowed(false) on the arming
 * view. Every LOK join runs through KitHelper::createView -> SID_NEWWINDOW,
 * which SfxViewFrame::ExecView_Impl silently refuses when the flag is off, so
 * the next joiner was handed SfxViewShell::Current()'s id -- the PHONE'S view
 * id, still held. Two sessions drove one SfxViewShell: view id issued twice,
 * getViewsCount stuck at 1, no mutual visibility, the joiner's per-view
 * settings stomping the voting session.
 */
CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testKitReflowVoteKeepsJoinersJoinable)
{
    // Given a document whose sole (phone) view has voted for reflow:
    SwXTextDocument* pXTextDocument = createDoc();
    const int nView1 = KitHelper::getCurrentView();
    SwWrtShell* pWrtShell1 = getSwDocShell()->GetWrtShell();
    SwTestViewCallback aView1;

    dispatchCommand(mxComponent, u".uno:BrowseWidth"_ustr,
                    { comphelper::makePropertyValue(u"BrowseWidth"_ustr, sal_Int32(4116)) });
    Scheduler::ProcessEventsToIdle();
    // The arm must actually have happened, or the rest of this test asserts
    // nothing (a check that cannot fail proves nothing).
    CPPUNIT_ASSERT(pWrtShell1->GetViewOptions()->getBrowseMode());

    // When a second (desktop) session joins:
    const int nView2 = KitHelper::createView();

    // Then the join must produce a NEW view. Without the fix, SID_NEWWINDOW
    // was refused (NewWindowAllowed false on the armed view) and createView
    // handed back view 1's own id: nView2 == nView1, and the count stayed 1.
    CPPUNIT_ASSERT(nView2 >= 0);
    CPPUNIT_ASSERT(nView2 != nView1);
    CPPUNIT_ASSERT_EQUAL(static_cast<std::size_t>(2), KitHelper::getViewsCount(0));

    pXTextDocument->initializeForTiledRendering(cpo::uno::Sequence<beans::PropertyValue>());
    SwTestViewCallback aView2;

    // And when the desktop joiner vetoes reflow, the tally must reach BOTH
    // registered views: the mode leaves browse everywhere and every view's
    // callback channel carries the resulting invalidation.
    aView1.m_bTilesInvalidated = false;
    aView2.m_bTilesInvalidated = false;
    dispatchCommand(mxComponent, u".uno:BrowseWidth"_ustr,
                    { comphelper::makePropertyValue(u"BrowseWidth"_ustr, sal_Int32(-1)) });
    Scheduler::ProcessEventsToIdle();
    CPPUNIT_ASSERT(!pWrtShell1->GetViewOptions()->getBrowseMode());
    CPPUNIT_ASSERT(aView1.m_bTilesInvalidated);
    CPPUNIT_ASSERT(aView2.m_bTilesInvalidated);

    // Both ids must still be registered and addressable -- no id was ever
    // reissued while a session held it.
    CPPUNIT_ASSERT_EQUAL(static_cast<std::size_t>(2), KitHelper::getViewsCount(0));
    KitHelper::setView(nView1);
    CPPUNIT_ASSERT_EQUAL(nView1, KitHelper::getCurrentView());
    KitHelper::setView(nView2);
    CPPUNIT_ASSERT_EQUAL(nView2, KitHelper::getCurrentView());
}

/*
 * VULCAN (Lane W, W5): the reflow verdict is presentation state; applying it
 * must leave the MODEL untouched -- this test PINS that contract.
 *
 * The persisted BROWSE_MODE setting reaches saved bytes (xmlexp.cxx writes it
 * into ODF settings.xml, wrtw8esh.cxx keys exported object geometry on it),
 * so a phone's read-posture reflow flipping it would change what a
 * colleague's save produces. Two independent layers currently keep it clean:
 * the modified-flag bracket in lcl_TallyKitReflowVotes keeps IsModified()
 * false, and ToggleLayoutMode/GotFocus no longer write the setting under
 * COKit (DocumentSettingManager::set also pins it false under COKit, a
 * pre-vote-lane guard this contract must survive without). This test fails
 * if ANY of those layers regresses.
 */
CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testKitReflowVoteLeavesModelUntouched)
{
    // Given a freshly loaded, unmodified document:
    createDoc();
    SwWrtShell* pWrtShell = getSwDocShell()->GetWrtShell();
    SwDoc* pDoc = getSwDocShell()->GetDoc();
    CPPUNIT_ASSERT(!pDoc->getIDocumentState().IsModified());
    CPPUNIT_ASSERT(!pDoc->getIDocumentSettingAccess().get(DocumentSettingId::BROWSE_MODE));

    // When the phone's vote arms reflow:
    dispatchCommand(mxComponent, u".uno:BrowseWidth"_ustr,
                    { comphelper::makePropertyValue(u"BrowseWidth"_ustr, sal_Int32(4116)) });
    Scheduler::ProcessEventsToIdle();

    // Then the arm is real (known positive)...
    CPPUNIT_ASSERT(pWrtShell->GetViewOptions()->getBrowseMode());
    // ...but the model is untouched: not dirtied, and the persisted document
    // setting -- what a save would write -- never flipped.
    CPPUNIT_ASSERT(!pDoc->getIDocumentState().IsModified());
    CPPUNIT_ASSERT(!pDoc->getIDocumentSettingAccess().get(DocumentSettingId::BROWSE_MODE));

    // And when the vote is withdrawn, the unwind is just as clean.
    dispatchCommand(mxComponent, u".uno:BrowseWidth"_ustr,
                    { comphelper::makePropertyValue(u"BrowseWidth"_ustr, sal_Int32(-1)) });
    Scheduler::ProcessEventsToIdle();
    CPPUNIT_ASSERT(!pWrtShell->GetViewOptions()->getBrowseMode());
    CPPUNIT_ASSERT(!pDoc->getIDocumentState().IsModified());
    CPPUNIT_ASSERT(!pDoc->getIDocumentSettingAccess().get(DocumentSettingId::BROWSE_MODE));
}

/*
 * VULCAN (R6-12, phone-Writer canvas tearing): a tile's rasterisation scale
 * must never reach the text FORMATTER.
 *
 * In browse mode the window is the formatter's reference device
 * (SwViewShell::GetRefDev), and SwViewShell::PaintTile swaps that window's
 * MapMode to the tile's rasterisation scale around each tile's paint. An
 * earlier fix (9c8551ea63) stopped the swap from TRIGGERING a reformat; the
 * hole this test pins is formatting the document already OWES running UNDER
 * the swap: after an edit, CheckInvalidForPaint formats the pending frames
 * inside PaintTile, glyph advances get measured against the swapped device
 * and cached wrong in the layout -- silently, because InvalidateWindows
 * early-returns while isTiledPainting(). Every later repaint of the region
 * then draws overprinted glyph bands.
 *
 * Wet-measured on slot-02 (build #8) with a calibrated pixel detector: one
 * Backspace in a reflowed docx tears every band below the edit; the identical
 * Backspace in page layout is clean; fresh tiles re-render torn (the
 * corruption is layout-resident, not stale client tiles); one full
 * browse-mode reformat heals it. Evidence:
 * ~/.cache/voffice-evidence/round6/r6-12-writer-tearing/.
 */
CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testBrowseModePaintTileFormatsAtRestingZoom)
{
    // Given a reflowed (browse-mode, client-stated width) document with a few
    // paragraphs, fully laid out, its first line's advance-width recorded:
    SwXTextDocument* pXTextDocument = createDoc();
    SwWrtShell* pWrtShell = getSwDocShell()->GetWrtShell();
    for (int i = 0; i < 6; ++i)
        pWrtShell->Insert(
            u"Every large theropod of the era was a predator and the era had many. "_ustr);
    dispatchCommand(mxComponent, u".uno:BrowseWidth"_ustr,
                    { comphelper::makePropertyValue(u"BrowseWidth"_ustr, sal_Int32(4116)) });
    Scheduler::ProcessEventsToIdle();
    // The arm must actually have happened, and the stated width must be
    // binding, or the equality below compares page layout with page layout
    // and passes vacuously (a check that cannot fail proves nothing).
    CPPUNIT_ASSERT(pWrtShell->GetViewOptions()->getBrowseMode());
    pWrtShell->Reformat();
    Scheduler::ProcessEventsToIdle();
    xmlDocUniquePtr pXmlAtRest = parseLayoutDump();
    const sal_Int32 nRestWidth
        = getXPath(pXmlAtRest, "//body/txt[1]/SwParaPortion/SwLineLayout[1]", "width").toInt32();
    CPPUNIT_ASSERT_GREATER(sal_Int32(0), nRestWidth);
    CPPUNIT_ASSERT_LESS(sal_Int32(4750), nRestWidth);

    // When frames are invalid at tile-paint time (after an edit the eager
    // pass under COKit covers only the tile-sized maVisArea, so the rest
    // formats lazily inside PaintTile) and the requested tile's rasterisation
    // scale differs from the window's resting scale (256 px over 1600 twips
    // = 2.4 against 1.0 -- the phone's dpr 3 at reflow zoom):
    pWrtShell->GetLayout()->InvalidateAllContent(SwInvalidateFlags::PrtArea
                                                 | SwInvalidateFlags::Table | SwInvalidateFlags::Pos
                                                 | SwInvalidateFlags::Size);
    int nCanvasWidth = 256;
    int nCanvasHeight = 256;
    std::vector<unsigned char> aBuffer(nCanvasWidth * nCanvasHeight * 4);
    ScopedVclPtrInstance<VirtualDevice> pDevice(DeviceFormat::WITHOUT_ALPHA);
    pDevice->SetOutputSizePixelScaleOffsetAndKitBuffer(Size(nCanvasWidth, nCanvasHeight), 1.0,
                                                       Point(), aBuffer.data());
    pXTextDocument->paintTile(*pDevice, nCanvasWidth, nCanvasHeight, /*nTilePosX=*/0,
                              /*nTilePosY=*/0, /*nTileWidth=*/1600, /*nTileHeight=*/1600);

    // Then the line the tile's CheckInvalidForPaint formatted must carry the
    // SAME advances the resting layout gave it. Without the fix the paint
    // formatted it against the swapped window MapMode and the cached line
    // width diverges -- which on a phone is a paragraph collapsing into an
    // overprinted band on the next repaint.
    xmlDocUniquePtr pXmlPainted = parseLayoutDump();
    const sal_Int32 nPaintedWidth
        = getXPath(pXmlPainted, "//body/txt[1]/SwParaPortion/SwLineLayout[1]", "width").toInt32();
    CPPUNIT_ASSERT_EQUAL(nRestWidth, nPaintedWidth);
}

/*
 * VULCAN (R6-15, browse border through the tile device): the width a
 * browse-mode document is formatted to must not depend on the rasterisation
 * scale of a tile that happens to be painting.
 *
 * GetBrowseBorder() is a PIXEL size (8x12), and SwContentFrame::MakePrtArea
 * converts it with PixelToLogic against GetOut() -- which during PaintTile is
 * the tile VirtualDevice, because PaintTile sets mpOut UNGATED (the R6-12 fix
 * guarded the window's MapMode, not mpOut). The resting layout converts the
 * same border through the mapmode-disabled kit window and gets the raw pixel
 * value, so the paragraph budget (VisArea minus 2 * border) swings with
 * whichever device was current when formatting ran: through a zoomed-out
 * tile's device (256 px over 15360 twips, MapMode scale 0.25) the 8 px border
 * inflates to 480 twips and MakePrtArea's clamp narrows the paragraph by
 * hundreds of twips -- a reformat caused by nothing but tile scale. On the
 * phone this is the ~140-twip page/paragraph wobble the client's
 * correctForChrome absorbs with its 120-twip hysteresis (chrome overhead
 * oscillating 584-808 on the wire). The fix routes the conversion through
 * the FORMATTING reference device (SwViewShell::GetBrowseBorderTwips), the
 * same reference glyph advances already follow (R6-12).
 */
CPPUNIT_TEST_FIXTURE(SwTiledRenderingTest, testBrowseBorderIgnoresTileScale)
{
    // Given a reflowed (browse-mode, client-stated width) document with a few
    // paragraphs, fully laid out, its first paragraph's formatted print width
    // recorded:
    SwXTextDocument* pXTextDocument = createDoc();
    SwWrtShell* pWrtShell = getSwDocShell()->GetWrtShell();
    for (int i = 0; i < 6; ++i)
        pWrtShell->Insert(u"The quick brown fox jumps over the lazy dog. "_ustr);
    dispatchCommand(mxComponent, u".uno:BrowseWidth"_ustr,
                    { comphelper::makePropertyValue(u"BrowseWidth"_ustr, sal_Int32(4116)) });
    Scheduler::ProcessEventsToIdle();
    // The arm must actually have happened, or nothing below is browse-mode
    // territory at all (a check that cannot fail proves nothing).
    CPPUNIT_ASSERT(pWrtShell->GetViewOptions()->getBrowseMode());
    pWrtShell->Reformat();
    Scheduler::ProcessEventsToIdle();
    xmlDocUniquePtr pXmlAtRest = parseLayoutDump();
    const sal_Int32 nRestPrtWidth
        = getXPath(pXmlAtRest, "//body/txt[1]/infos/prtBounds", "width").toInt32();
    // Anti-vacuity: the paragraph really formatted to (about) the stated
    // width. If it rested anywhere near the tile-clamped width already, the
    // equality below could not fail on any tree.
    CPPUNIT_ASSERT_GREATER(sal_Int32(4000), nRestPrtWidth);

    // When frames are invalid at tile-paint time (after an edit the eager
    // pass under COKit covers only the tile-sized maVisArea, so the rest
    // formats lazily inside PaintTile) and the tile being painted is a
    // zoomed-out one -- 256 px over 15360 twips, MapMode scale 0.25, a 25%
    // phone overview zoom -- so the border converted through the tile device
    // (480 twips) dwarfs the resting conversion (8):
    pWrtShell->GetLayout()->InvalidateAllContent(SwInvalidateFlags::PrtArea
                                                 | SwInvalidateFlags::Size);
    int nCanvasWidth = 256;
    int nCanvasHeight = 256;
    std::vector<unsigned char> aBuffer(nCanvasWidth * nCanvasHeight * 4);
    ScopedVclPtrInstance<VirtualDevice> pDevice(DeviceFormat::WITHOUT_ALPHA);
    pDevice->SetOutputSizePixelScaleOffsetAndKitBuffer(Size(nCanvasWidth, nCanvasHeight), 1.0,
                                                       Point(), aBuffer.data());
    pXTextDocument->paintTile(*pDevice, nCanvasWidth, nCanvasHeight, /*nTilePosX=*/0,
                              /*nTilePosY=*/0, /*nTileWidth=*/15360, /*nTileHeight=*/15360);

    // Then the paragraph the tile's CheckInvalidForPaint formatted must carry
    // the SAME print width the resting layout gave it. Without the fix,
    // MakePrtArea read the border through the tile device and clamped the
    // paragraph hundreds of twips narrower -- re-wrapped words, shifted
    // pagination, and on the next honest repaint a column whose width tracks
    // tile scale instead of the stated browse width.
    xmlDocUniquePtr pXmlPainted = parseLayoutDump();
    const sal_Int32 nPaintedPrtWidth
        = getXPath(pXmlPainted, "//body/txt[1]/infos/prtBounds", "width").toInt32();
    CPPUNIT_ASSERT_EQUAL(nRestPrtWidth, nPaintedPrtWidth);
}
}

CPPUNIT_PLUGIN_IMPLEMENT();

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
