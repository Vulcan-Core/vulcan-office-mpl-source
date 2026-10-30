/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/*
 * This file is part of the Collabora Office project.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * This file incorporates work covered by the following license notice:
 *
 *   Licensed to the Apache Software Foundation (ASF) under one or more
 *   contributor license agreements. See the NOTICE file distributed
 *   with this work for additional information regarding copyright
 *   ownership. The ASF licenses this file to you under the Apache
 *   License, Version 2.0 (the "License"); you may not use this file
 *   except in compliance with the License. You may obtain a copy of
 *   the License at http://www.apache.org/licenses/LICENSE-2.0 .
 */

#include <string>

#include <memory>
#include <boost/property_tree/json_parser.hpp>

#include <hintids.hxx>

#include <sal/log.hxx>
#include <svl/cjkoptions.hxx>
#include <svl/ctloptions.hxx>
#include <svx/pageitem.hxx>
#include <svl/whiter.hxx>
#include <sfx2/viewfrm.hxx>
#include <svl/eitem.hxx>
#include <svl/srchitem.hxx>
#include <sfx2/bindings.hxx>
#include <sfx2/request.hxx>
#include <sfx2/kit/helper.hxx>
#include <svx/srchdlg.hxx>
#include <swmodule.hxx>
#include <swwait.hxx>
#include <workctrl.hxx>
#include <view.hxx>
#include <wrtsh.hxx>
#include <swundo.hxx>
#include <uitool.hxx>
#include <cmdid.h>
#include <docsh.hxx>
// Vulcan: doc.hxx for SwDoc::CreateUnoCursor()/GetNodes(), unocrsr.hxx for the
// private counting cursor -- both only for lcl_PublishPhoneMatchOrdinal below.
#include <doc.hxx>
#include <unocrsr.hxx>
#include <COKit/COKitEnums.h>
#include <comphelper/kit.hxx>
#include <comphelper/string.hxx>

#include <strings.hrc>
#include <SwRewriter.hxx>

#include <PostItMgr.hxx>
#include <sfx2/dispatch.hxx>

using namespace com::sun::star;
using namespace ::com::sun::star::lang;

//Search Parameter

struct SwSearchOptions
{
    SwDocPositions eStart, eEnd;
    bool bDontWrap;

    SwSearchOptions( SwWrtShell const * pSh, bool bBackward );
};

/// Adds rMatches using rKey as a key to the rTree tree.
static void lcl_addContainerToJson(boost::property_tree::ptree& rTree, const OString& rKey, const std::vector<OString>& rMatches)
{
    boost::property_tree::ptree aChildren;

    for (const OString& rMatch : rMatches)
    {
        boost::property_tree::ptree aChild;
        aChild.put("part", "0");
        aChild.put("rectangles", rMatch.getStr());
        aChildren.push_back(std::make_pair("", aChild));
    }

    rTree.add_child(rKey.getStr(), aChildren);
}

/// Emits COKit callbacks (count, selection) for search results.
static void lcl_emitSearchResultCallbacks(SvxSearchItem const * pSearchItem, SwWrtShell const * pWrtShell, bool bHighlightAll)
{
    // Emit a callback also about the selection rectangles, grouped by matches.
    SwPaM* pPaM = pWrtShell->GetCursor();
    if (!pPaM)
        return;

    std::vector<OString> aMatches;
    for (SwPaM& rPaM : pPaM->GetRingContainer())
    {
        if (SwShellCursor* pShellCursor = dynamic_cast<SwShellCursor*>(&rPaM))
        {
            std::vector<OString> aSelectionRectangles;
            pShellCursor->SwSelPaintRects::Show(&aSelectionRectangles);
            std::vector<OString> aRect;
            for (const OString & rSelectionRectangle : aSelectionRectangles)
            {
                if (rSelectionRectangle.isEmpty())
                    continue;
                aRect.push_back(rSelectionRectangle);
            }
            OString sRect = comphelper::string::join("; ", aRect);
            aMatches.push_back(sRect);
        }
    }
    boost::property_tree::ptree aTree;
    aTree.put("searchString", pSearchItem->GetSearchString().toUtf8().getStr());
    aTree.put("highlightAll", bHighlightAll);
    lcl_addContainerToJson(aTree, "searchResultSelection"_ostr, aMatches);

    std::stringstream aStream;
    boost::property_tree::write_json(aStream, aTree);
    OString aPayload( aStream.str() );

    SfxViewShell* pNotifySh = pWrtShell->GetSfxViewShell();
    if (pNotifySh)
        pNotifySh->viewCallback(KIT_CALLBACK_SEARCH_RESULT_SELECTION, aPayload);

    if(bHighlightAll)
    {   // FindAll disables this during find, do it once when done.
        KitHelper::notifyUpdate(pNotifySh,KIT_CALLBACK_TEXT_SELECTION);
        KitHelper::notifyOtherViewsUpdatePerViewId(pNotifySh, KIT_CALLBACK_TEXT_VIEW_SELECTION);
    }
}

/* Vulcan: WHY a phone FIND produced no ordinal.
 *
 * These ride the `total` field of the `.uno:SearchOrdinal` state change. The
 * client's rule is unchanged and needs no knowledge of them: anything below 1
 * means "no ordinal, clear the label" (Control.MobileSearchBar.parseOrdinal
 * rejects a non-digit outright). So the diagnosis is carried in a field the
 * consumer already ignores, and costs the client nothing.
 *
 * THIS EXISTS BECAUSE 0;0 WAS AMBIGUOUS, and the ambiguity cost a whole build
 * cycle: a phone find on a real slot returned 0;0 with a match plainly found
 * (one rectangle in the searchresultselection alongside it), and every one of
 * the declines below is indistinguishable from every other -- and from the
 * legitimate "this search has no ordinal" answer. A wire that says which
 * branch fired turns a guess into a reading.
 *
 * PERMANENT, not scaffolding to be pulled out after the next build. The
 * ambiguity is a defect in its own right: 0 remains the value nothing sets on
 * purpose, so a 0 in the wild now means the producer never ran at all, which
 * is itself the most useful thing that field could say.
 *
 * The FIRST field (`current`) carries an auxiliary number during a decline --
 * also ignored by the client, for the same reason -- chosen per branch to be
 * the number a reader would ask for next. Most importantly it carries the
 * SWEEP'S OWN COUNT on the two reconciliation failures, which is what
 * separates "the sweep found nothing" from "the sweep worked and the two walks
 * disagreed". */
constexpr sal_Int32 PHONE_ORDINAL_SEARCH_ATTRIBUTES = -1;
constexpr sal_Int32 PHONE_ORDINAL_SELECTION_SCOPED = -2;
constexpr sal_Int32 PHONE_ORDINAL_NODE_BUDGET = -3;
constexpr sal_Int32 PHONE_ORDINAL_SWEEP_CANCELLED = -4;
constexpr sal_Int32 PHONE_ORDINAL_SWEEP_FOUND_NOTHING = -5;
constexpr sal_Int32 PHONE_ORDINAL_MATCH_OUTSIDE_BODY = -6;
constexpr sal_Int32 PHONE_ORDINAL_RING_ENTRY_OUTSIDE_BODY = -7;
constexpr sal_Int32 PHONE_ORDINAL_MATCH_NOT_IN_RING = -8;
constexpr sal_Int32 PHONE_ORDINAL_NO_SHELL_CURSOR = -9;

/* Vulcan: the phone's "N of M" match count -- the Writer producer for
 * SvxSearchDialogWrapper::SetSearchLabel(sal_Int32, sal_Int32). Calc's producer
 * is lcl_PublishPhoneMatchOrdinal in sc/source/ui/view/viewfun2.cxx; this is
 * the same shape on Writer's data.
 *
 * TWO CONSUMERS, ONE COMPUTATION. SetSearchLabel feeds the find & replace
 * SHEET, which is the only sink that existed when this was written and which
 * only receives anything while that sheet is OPEN. The caller also puts the
 * pair returned through rOutCurrent/rOutTotal on the wire as
 * `.uno:SearchOrdinal`, for the phone find BAR -- the surface a phone Writer
 * user actually reaches from Ctrl-F and from the kebab's Search row. Neither
 * sink may be given a number this function did not produce.
 *
 * WHY A SECOND SWEEP IS UNAVOIDABLE. A total is a total, and nothing on the
 * FIND path knows one: SearchAndWrap resolves a single match and stops.
 * SearchAll() below does return a count, but it is the FIND_ALL command -- it
 * selects every match, so there is no "current" left to be Nth of, and it
 * moves the user's cursor.
 *
 * WHY THIS CURSOR AND NOT THE SHELL'S. SwDoc::CreateUnoCursor hands out an
 * SwUnoCursor that is not in the shell's cursor ring, so nothing the sweep
 * does can move the caret, the selection or the visible area -- the same
 * primitive SwXTextDocument::findAll uses. It is read-only by construction
 * too: SwCursor::Find_Text opens an undo object and sets the modified flag
 * only when bReplace is true, and SwFindParaText::DoFind's replace arm -- the
 * only writer -- is behind that same flag (sw/source/core/crsr/findtxt.cxx).
 *
 * WHY IT IS AFFORDABLE: it is phone-only (isKitMobilePhone), it is the same
 * work as tapping "Find All", and it is capped by the node budget below, so a
 * phone that opens a book loses the count rather than the frame rate. The
 * count is a nicety; the search is not.
 *
 * THREE KNOBS ARE MATCHED TO THE SHELL CURSOR DELIBERATELY, because a sweep
 * that saw a different match set would produce a confidently wrong number:
 *  - the layout, because SwCursorShell::Find_Text forwards GetLayout() to
 *    SwCursor::Find_Text (sw/source/core/crsr/crsrsh.cxx); without it the
 *    sweep counts text the layout hides from the user's own search;
 *  - IsSkipOverHiddenSections(), which SwCursor -- the shell cursor's
 *    implementation -- returns true while SwUnoCursor defaults it to false;
 *  - IsSkipOverProtectSections(), which SwCursor derives from
 *    IsReadOnlyAvailable(). SwUnoCursor hardcodes IsReadOnlyAvailable() to
 *    true, so the two agree only when the shell agrees, which is why the
 *    caller tests SwCursorShell::IsReadOnlyAvailable() before coming here.
 */
static void lcl_PublishPhoneMatchOrdinal(SwDoc& rDoc, SwRootFrame* pLayout,
                                         const SvxSearchItem& rSearchItem,
                                         bool bHasSearchAttributes,
                                         const SwPaM& rFound,
                                         sal_Int32& rOutCurrent, sal_Int32& rOutTotal)
{
    /* Every `return` below goes through this, so a branch that forgets to say
     * why cannot compile to a silent 0. */
    auto decline = [&rOutCurrent, &rOutTotal](sal_Int32 nAux, sal_Int32 nReason) {
        rOutCurrent = nAux;
        rOutTotal = nReason;
    };

    /* Only a plain text search can be reproduced from here. An attribute or
     * paragraph-style search goes through FindAttrs()/FindFormat() with item
     * sets built in FUNC_Search below, and a second copy of that set-building
     * would cost more than the count is worth. */
    if (bHasSearchAttributes || rSearchItem.GetPattern()
        || rSearchItem.GetSearchString().isEmpty())
    {
        decline(0, PHONE_ORDINAL_SEARCH_ATTRIBUTES);
        return;
    }

    /* A selection-scoped search cannot be counted from here either:
     * SwCursor::Find_Text ORs FindRanges::InSel into the ranges (findtxt.cxx,
     * off searchFlag's REG_NOT_BEGINOFLINE, which SvxSearchItem::SetSelection
     * mirrors), which walks
     * the ring of the cursor it is called on -- and the private cursor below
     * has a ring of one, not the view's selection. No ordinal beats a wrong
     * one. */
    if (rSearchItem.GetSelection())
    {
        decline(0, PHONE_ORDINAL_SELECTION_SCOPED);
        return;
    }

    /* Cost budget, the analogue of Calc's used-area cap. SwNodes::Count() is
     * O(1), so the guard itself is free. */
    if (rDoc.GetNodes().Count() > SwNodeOffset(20000))
    {
        decline(sal_Int32(rDoc.GetNodes().Count()), PHONE_ORDINAL_NODE_BUDGET);
        return;
    }

    /* Exactly FUNC_Search's option handling, so the sweep matches what the
     * user is walking. The replace string is cleared there on every non-replace
     * command, and this is only ever reached on FIND. */
    i18nutil::SearchOptions2 aSearchOpt(rSearchItem.GetSearchOptions());
    aSearchOpt.Locale = GetAppLanguageTag().getLocale();
    aSearchOpt.replaceString.clear();

    /* Seeded at the match just found only because that is a position certain
     * to be valid -- the InSelAll arm of SwCursor::FindAll re-spans the range
     * itself from the flags below. SetRemainInSection(false) is what
     * SwXTextDocument::CreateCursorForSearch does and for the same reason: an
     * SwUnoCursor otherwise refuses to leave its seed section. */
    const SwPosition& rFoundStart = *rFound.Start();
    auto pCountCursor(rDoc.CreateUnoCursor(rFoundStart));
    pCountCursor->SetRemainInSection(false);
    pCountCursor->SetSkipOverHiddenSections(true);
    pCountCursor->SetSkipOverProtectSections(false);

    /* ⚠ InSelAll ALONE IS THE WRONG RANGE FOR THIS FUNCTION, and it is what
     * shipped first. sw's own table states the vocabulary
     * (sw/source/uibase/uno/unotxdoc.cxx, above SwXTextDocument::findFirst):
     *
     *     Search all in the body:  FindRanges::InBodyOnly | FindRanges::InSelAll
     *     Search everywhere all:   FindRanges::InSelAll
     *
     * and this function is the first line, not the second: every guard below
     * REJECTS a match outside the body, because document order only agrees
     * with SearchAndWrap's walk order inside it. Asking for everywhere and
     * then discarding everything that is not the body is not a filter, it is a
     * contradiction -- on any document with the term in a header, a footer, a
     * frame or a footnote the sweep returns those matches, the ring check
     * below trips on the first of them, and the ordinal is declined for a
     * perfectly ordinary body search. SwCursor::FindAll reads the flag
     * directly: InBodyOnly starts the span at GetEndOfContent()'s section
     * node, i.e. the body, instead of GetEndOfPostIts()'s, i.e. everything.
     *
     * The body guards below are kept even so. They are cheap, and they now
     * assert the range rather than substitute for it -- if a future edit drops
     * InBodyOnly, they turn the mistake into a declined ordinal with a reason
     * code on the wire instead of a confidently wrong number. */
    bool bCancel = false;
    const sal_Int32 nTotal = pCountCursor->Find_Text(aSearchOpt, rSearchItem.GetNotes(),
                                                     SwDocPositions::Start, SwDocPositions::End,
                                                     bCancel,
                                                     FindRanges::InSelAll
                                                         | FindRanges::InBodyOnly,
                                                     /*bReplace*/false, pLayout);
    if (bCancel)
    {
        decline(nTotal, PHONE_ORDINAL_SWEEP_CANCELLED);
        return;
    }
    if (nTotal < 1)
    {
        /* The aux is searchFlag, not 0, because a zero sweep next to a found
         * match has one prime suspect and this settles it without another
         * build: Find_Text ORs FindRanges::InSel in when searchFlag carries
         * REG_NOT_BEGINOFLINE (0x800), and FindAll's InSel arm searches the
         * cursor's OWN selection ring -- which for this private, collapsed
         * cursor is empty, so it returns 0 every time. SvxSearchItem keeps
         * that bit in step with GetSelection(), which is already refused
         * above, but the two can only be trusted to agree while nothing sets
         * the flags field directly, and the client does send
         * SearchItem.SearchFlags on every search. A non-zero aux here with
         * 0x800 set is that desync, caught. */
        decline(aSearchOpt.searchFlag, PHONE_ORDINAL_SWEEP_FOUND_NOTHING);
        return;
    }

    /* Document order is the walk order only inside the body. InSelAll spans
     * the extras -- headers, footers, footnotes, frames -- and SwNodes sorts
     * those BEFORE the body (GetEndOfExtras() is documented as the last node
     * before the body text), while SearchAndWrap visits the body first and the
     * extras afterwards through a static, s_bExtra, whose order is not
     * reproducible from here. So publish nothing unless every match, and the
     * one being numbered, lies in the body, where the two orders do agree. The
     * body test is the one lcl_IsOutlineMoveAndCopyable already uses
     * (sw/source/core/edit/ednumber.cxx). */
    const SwNodeOffset nBodyStart = rDoc.GetNodes().GetEndOfExtras().GetIndex();
    if (rFoundStart.GetNodeIndex() < nBodyStart)
    {
        decline(sal_Int32(rFoundStart.GetNodeIndex()),
                PHONE_ORDINAL_MATCH_OUTSIDE_BODY);
        return;
    }

    /* Here the ring size IS the count, unlike Calc's joined ScRangeList:
     * SwCursor::FindAll's InSelAll arm drops its own ring, adopts the found
     * ring and deletes the head it copied from, and lcl_FindSelection only
     * omits a ring entry on FIND_NO_RING, which the text matcher returns from
     * its replace arm alone. The ordinal is still computed positionally rather
     * than by ring index, because that merge decides the order and the search
     * direction does not. */
    const bool bBackward = rSearchItem.GetBackward();
    sal_Int32 nBefore = 0;
    bool bFoundInRing = false;
    for (SwPaM& rMatch : pCountCursor->GetRingContainer())
    {
        const SwPosition& rStart = *rMatch.Start();
        if (rStart.GetNodeIndex() < nBodyStart)
        {
            decline(nTotal, PHONE_ORDINAL_RING_ENTRY_OUTSIDE_BODY);
            return;
        }
        if (rStart == rFoundStart)
            bFoundInRing = true;
        else if (bBackward ? rFoundStart < rStart : rStart < rFoundStart)
            ++nBefore;
    }

    /* If the sweep never landed on the match the view is actually showing, the
     * two walks disagree and any ordinal would be invented. */
    if (!bFoundInRing)
    {
        decline(nTotal, PHONE_ORDINAL_MATCH_NOT_IN_RING);
        return;
    }

    SvxSearchDialogWrapper::SetSearchLabel(nBefore + 1, nTotal);

    /* Vulcan: hand the SAME pair back to the caller, which puts it on the wire
     * for the phone find BAR (the label above only ever reaches the find
     * SHEET -- see the caller for why those are two different surfaces).
     *
     * Written as two out-params after the label call rather than as a return
     * value, so that every `return` above -- attribute search, pattern search,
     * selection-scoped search, the node budget, a match outside the body, a
     * ring that does not contain the match the view is showing -- keeps
     * leaving them at the caller's 0, which is this file's existing "no
     * ordinal" answer. There is exactly ONE computation behind both sinks, so
     * the bar and the sheet cannot disagree, and a future early return is
     * correct here for free instead of needing to be remembered. */
    rOutCurrent = nBefore + 1;
    rOutTotal = nTotal;
}

void SwView::ExecSearch(SfxRequest& rReq)
{
    GetWrtShell().addCurrentPosition();

    const SfxItemSet* pArgs = rReq.GetArgs();
    const SfxPoolItem* pItem = nullptr;
    bool bQuiet = false;
    if(pArgs && SfxItemState::SET == pArgs->GetItemState(SID_SEARCH_QUIET, false, &pItem))
        bQuiet = static_cast<const SfxBoolItem*>( pItem)->GetValue();

    sal_uInt16 nSlot = rReq.GetSlot();
    if (nSlot == FN_REPEAT_SEARCH && !s_pSrchItem)
    {
        if(bQuiet)
        {
            rReq.SetReturnValue(SfxBoolItem(nSlot, false));
            nSlot = 0;
        }
    }
    if( m_pWrtShell->IsBlockMode() )
        m_pWrtShell->LeaveBlockMode();
    switch (nSlot)
    {
    // for now do nothing
    case SID_SEARCH_ITEM:
    {
        OSL_ENSURE(pArgs, "Args missing");
        if (pArgs)
        {
            delete s_pSrchItem;
            s_pSrchItem = pArgs->Get(SID_SEARCH_ITEM).Clone();
        }
    }
    break;

    case FID_SEARCH_ON:
        s_bJustOpened = true;
        GetViewFrame().GetBindings().Invalidate(SID_SEARCH_ITEM);
        break;

    case FID_SEARCH_OFF:
        if(pArgs)
        {
            // Unregister dialog
            delete s_pSrchItem;
            s_pSrchItem = pArgs->Get(SID_SEARCH_ITEM).Clone();

            s_xSearchList.reset();
            s_xReplaceList.reset();

            SvxSearchDialog *const pSrchDlg(GetSearchDialog());
            if (pSrchDlg)
            {
                // We will remember the search-/replace items.
                const SearchAttrItemList* pList = pSrchDlg->GetSearchItemList();
                if( nullptr != pList && pList->Count() )
                    s_xSearchList.reset(new SearchAttrItemList( *pList ));

                pList = pSrchDlg->GetReplaceItemList();
                if (nullptr != pList && pList->Count())
                    s_xReplaceList.reset(new SearchAttrItemList( *pList ));
            }
        }
        break;

        case FN_REPEAT_SEARCH:
        case FID_SEARCH_NOW:
        {
            sal_uInt16 nMoveType = SwView::GetMoveType();
            {
                if(FID_SEARCH_NOW == nSlot && !rReq.IsAPI())
                    SwView::SetMoveType(NID_SRCH_REP);
            }

            SvxSearchDialog * pSrchDlg(GetSearchDialog());
            if (pSrchDlg)
            {
                s_xSearchList.reset();
                s_xReplaceList.reset();

                const SearchAttrItemList* pList = pSrchDlg->GetSearchItemList();
                if( nullptr != pList && pList->Count() )
                    s_xSearchList.reset(new SearchAttrItemList( *pList ));

                pList = pSrchDlg->GetReplaceItemList();
                if (nullptr != pList && pList->Count())
                    s_xReplaceList.reset(new SearchAttrItemList( *pList ));
            }

            if (nSlot == FN_REPEAT_SEARCH)
            {
                OSL_ENSURE(s_pSrchItem, "SearchItem missing");
                if( !s_pSrchItem )
                    s_pSrchItem = new SvxSearchItem(SID_SEARCH_ITEM);
            }
            else
            {
                // Get SearchItem from request
                OSL_ENSURE(pArgs, "Args missing");
                if ( pArgs )
                {
                    delete s_pSrchItem;
                    s_pSrchItem = pArgs->Get(SID_SEARCH_ITEM).Clone();
                }
            }

            // tdf#115665 Format in the CTRL+H search affects the CTRL+F search
            if (pArgs)
            {
                if (const SfxBoolItem* pUseAttrItemListItem
                    = pArgs->GetItemIfSet(SID_SEARCH_USE_ATTR_ITEM_LIST, false))
                {
                    if (!pUseAttrItemListItem->GetValue())
                        s_xSearchList.reset();
                }
            }

            SvxSearchCmd eCommand = s_pSrchItem->GetCommand();
            switch (eCommand)
            {
            case SvxSearchCmd::FIND:
            {
                bool bRet = SearchAndWrap(bQuiet);
                if( bRet )
                {
                    Scroll(m_pWrtShell->GetCharRect().SVRect());
                    if (comphelper::COKit::isActive())
                        lcl_emitSearchResultCallbacks(s_pSrchItem, m_pWrtShell.get(), /* bHighlightAll = */ false);

                    /* Vulcan: "3 of 12", for BOTH phone find surfaces -- the
                     * `searchlabel` in the Find & Replace sheet, and (below)
                     * the wire for the phone find bar. See
                     * lcl_PublishPhoneMatchOrdinal above for how the count is
                     * taken and what it costs. Written as its own block rather
                     * than folded into the COKit `if` above so that no upstream
                     * line changes, which is one fewer rebase conflict every
                     * time this file moves.
                     *
                     * LAST WRITER WINS, DELIBERATELY. This overwrites the
                     * "Reached the end of the document" notice SearchAndWrap
                     * just set. That is Google's phone behaviour: the search
                     * wraps silently and the ordinal restarts at 1. On
                     * NOT-FOUND bRet is false, so SearchLabel::NotFound stands.
                     *
                     * The gates are Calc's, one for one (viewfun2.cxx): COKit,
                     * FIND, not-api -- Calc's bIsApi is rReq.IsAPI() at
                     * sc/source/ui/view/tabvwshe.cxx -- and phone. The
                     * IsReadOnlyAvailable() test is the extra one the helper's
                     * header explains. */
                    SfxViewShell* pPhoneSh = comphelper::COKit::isActive() && !rReq.IsAPI()
                                                 ? m_pWrtShell->GetSfxViewShell()
                                                 : nullptr;
                    if (pPhoneSh && pPhoneSh->isKitMobilePhone()
                        && m_pWrtShell->IsReadOnlyAvailable())
                    {
                        /* GetCursor() is fetched only inside the gate: on a
                         * phone lcl_emitSearchResultCallbacks above has already
                         * called it, so this costs nothing, and off the phone it
                         * is never reached -- desktop executes only the two
                         * tests above, exactly as Calc's producer does. */
                        sal_Int32 nPhoneOrdinal = 0;
                        sal_Int32 nPhoneTotal = 0;
                        if (SwCursor* pFound = m_pWrtShell->GetCursor())
                            lcl_PublishPhoneMatchOrdinal(*m_pWrtShell->GetDoc(),
                                                         m_pWrtShell->GetLayout(), *s_pSrchItem,
                                                         s_xSearchList && s_xSearchList->Count(),
                                                         *pFound, nPhoneOrdinal, nPhoneTotal);
                        else
                            nPhoneTotal = PHONE_ORDINAL_NO_SHELL_CURSOR;

                        /* Vulcan: the same "3 of 12" ON THE WIRE, for the phone
                         * find BAR.
                         *
                         * WHY A SECOND SINK AT ALL. SetSearchLabel above lands
                         * in exactly two places (srchdlg.cxx:2426-2540): the
                         * VCL findbar's `.uno:SearchLabel` item window, which
                         * does not exist under COKit, and the open search
                         * DIALOG's own label. So the number reaches a client
                         * only while the Find & Replace sheet is open. The
                         * phone's PRIMARY find surface is not that sheet -- it
                         * is the slim search bar
                         * (browser/src/control/Control.MobileSearchBar.ts),
                         * which UIManager.focusSearch and the kebab's Search
                         * row both open, and which had no way to learn the
                         * count that was already being computed for it.
                         *
                         * WHY A STATE CHANGE AND NOT AN EXTRA FIELD IN
                         * searchresultselection. That payload is built and sent
                         * by lcl_emitSearchResultCallbacks BEFORE this block
                         * runs, so folding the ordinal into it would mean
                         * reordering the two -- moving a counting sweep in
                         * front of the callback that shows the selection
                         * rectangles, for a cosmetic gain. KIT_CALLBACK_STATE_CHANGED
                         * is the established side channel for exactly this
                         * shape and needs no new enum, no wsd change and no new
                         * browser message handler: ChildSession.cpp:4013
                         * forwards any unrecognised payload verbatim as
                         * `statechanged:`, and CanvasTileLayer.js:2488-2495
                         * turns it into a `commandstatechanged` event. This is
                         * the same route `.uno:CurrentTrackedChangeId` already
                         * takes (view2.cxx:1354-1356 -> Map.StateChanges.js:53).
                         *
                         * NO SPACES IN THE PAYLOAD, and that is load-bearing:
                         * ClientSession.cpp:3013 matches `statechanged:` on
                         * `tokens.size() == 2`, i.e. on the message containing
                         * exactly the one space that follows the prefix. A
                         * localized "3 of 12" here would fall out of that
                         * branch. The numbers go over as digits and the client
                         * formats them, which is where the localization belongs
                         * anyway.
                         *
                         * EMITTED UNCONDITIONALLY INSIDE THIS GATE, including
                         * the 0;0 case. Every early return in the helper is a
                         * real "no ordinal for this search" -- a search with
                         * attributes, a selection-scoped search, a document over
                         * the node budget -- and a client that had just rendered
                         * "3 of 12" for the previous term MUST be told to stop.
                         * Sending nothing would leave the last good number on
                         * screen next to a different search, which is worse than
                         * showing none. */
                        OString aOrdinalPayload(".uno:SearchOrdinal="
                                                + OString::number(nPhoneOrdinal) + ";"
                                                + OString::number(nPhoneTotal));
                        pPhoneSh->viewCallback(KIT_CALLBACK_STATE_CHANGED, aOrdinalPayload);
                    }
                }
                rReq.SetReturnValue(SfxBoolItem(nSlot, bRet));

                GetDocShell()->Broadcast(SfxHint(SfxHintId::SwNavigatorUpdateTracking));
            }
            break;
            case SvxSearchCmd::FIND_ALL:
            {
                // Disable COKit selection notifications during search.
                m_pWrtShell->GetSfxViewShell()->setTiledSearching(true);
                const auto nFound = SearchAll();
                m_pWrtShell->GetSfxViewShell()->setTiledSearching(false);

                GetDocShell()->Broadcast(
                            SfxHint(SfxHintId::SwNavigatorUpdateTracking));
                GetDocShell()->Broadcast(
                            SfxHint(SfxHintId::SwNavigatorSelectOutlinesWithSelections));

                if (nFound == 0)
                {
#if HAVE_FEATURE_DESKTOP
                    if( !bQuiet )
                    {
                        if (SfxViewShell* pNotifySh = m_pWrtShell->GetSfxViewShell())
                            pNotifySh->viewCallback(KIT_CALLBACK_SEARCH_NOT_FOUND, s_pSrchItem->GetSearchString().toUtf8());
                        SvxSearchDialogWrapper::SetSearchLabel(SearchLabel::NotFound);
                    }
#endif
                    s_bFound = false;
                }
                else
                {
                    if (comphelper::COKit::isActive())
                        lcl_emitSearchResultCallbacks(s_pSrchItem, m_pWrtShell.get(), /* bHighlightAll = */ true);
                    if (!bQuiet)
                    {
                        OUString sText(SwResId(STR_SEARCH_KEY_FOUND_TIMES, nFound));
                        sText = sText.replaceFirst("%1", OUString::number(nFound));
                        SvxSearchDialogWrapper::SetSearchLabel(sText);
                    }
                }
                rReq.SetReturnValue(SfxBoolItem(nSlot, nFound != 0));
            }
            break;
            case SvxSearchCmd::REPLACE:
                {
                    if (GetDocShell()->IsReadOnly() || IsCurrentKitViewReadOnly())
                    {
                        rReq.SetReturnValue(SfxBoolItem(nSlot, false));
                        break;
                    }

                    // 1) Replace selection

                    // Prevent, that the replaced string will be found again
                    // if the replacement string is containing the search string.
                    bool bBack = s_pSrchItem->GetBackward();
                    if (bBack)
                        m_pWrtShell->Push();
                    OUString aReplace( s_pSrchItem->GetReplaceString() );
                    i18nutil::SearchOptions2 aTmp( s_pSrchItem->GetSearchOptions() );
                    std::optional<OUString> xBackRef = sw::ReplaceBackReferences(aTmp,
                        m_pWrtShell->GetCursor(), m_pWrtShell->GetLayout());
                    if( xBackRef )
                        s_pSrchItem->SetReplaceString( *xBackRef );
                    Replace();
                    if( xBackRef )
                    {
                        s_pSrchItem->SetReplaceString( aReplace );
                    }
                    if (bBack)
                    {
                        m_pWrtShell->Pop();
                        m_pWrtShell->SwapPam();
                    }

                    // 2) Search further (without replacing!)

                    SvxSearchCmd nOldCmd = s_pSrchItem->GetCommand();
                    s_pSrchItem->SetCommand( SvxSearchCmd::FIND );
                    bool bRet = SearchAndWrap(bQuiet);
                    if( bRet )
                        Scroll( m_pWrtShell->GetCharRect().SVRect());
                    s_pSrchItem->SetCommand( nOldCmd );
                    rReq.SetReturnValue(SfxBoolItem(nSlot, bRet));
                }
                break;

            case SvxSearchCmd::REPLACE_ALL:
                {
                    if (GetDocShell()->IsReadOnly() || IsCurrentKitViewReadOnly())
                    {
                        rReq.SetReturnValue(SfxBoolItem(nSlot, false));
                        break;
                    }
                    SwSearchOptions aOpts( m_pWrtShell.get(), s_pSrchItem->GetBackward() );
                    s_bExtra = false;
                    sal_Int32 nFound;

                    {   //Scope for SwWait-Object
                        SwWait aWait( *GetDocShell(), true );
                        m_pWrtShell->StartAllAction();

                        // i#8288 "replace all" should not change cursor
                        // position, so save current cursor
                        m_pWrtShell->Push();

                        if (!s_pSrchItem->GetSelection())
                        {
                            // if we don't want to search in the selection...
                            m_pWrtShell->KillSelection(nullptr, false);
                            if (SwDocPositions::Start == aOpts.eEnd)
                            {
                                m_pWrtShell->EndOfSection();
                            }
                            else
                            {
                                m_pWrtShell->StartOfSection();
                            }
                        }
                        nFound = FUNC_Search( aOpts );
                        // create it just to overwrite it with stack cursor
                        m_pWrtShell->CreateCursor();
                        // i#8288 restore the original cursor position
                        m_pWrtShell->Pop(SwCursorShell::PopMode::DeleteCurrent);
                        m_pWrtShell->EndAllAction();
                    }

                    rReq.SetReturnValue(SfxBoolItem(nSlot, nFound != 0 && SAL_MAX_INT32 != nFound));
                    if( !nFound )
                    {
#if HAVE_FEATURE_DESKTOP
                        if( !bQuiet )
                        {
                            if (SfxViewShell* pNotifySh = m_pWrtShell->GetSfxViewShell())
                                pNotifySh->viewCallback(KIT_CALLBACK_SEARCH_NOT_FOUND, s_pSrchItem->GetSearchString().toUtf8());
                            SvxSearchDialogWrapper::SetSearchLabel(SearchLabel::NotFound);
                        }
#endif
                        s_bFound = false;
                        SwView::SetMoveType(nMoveType);
                        return;
                    }

                    if (!bQuiet && SAL_MAX_INT32 != nFound)
                    {
                        OUString sText( SwResId( STR_NB_REPLACED ) );
                        sText = sText.replaceFirst("XX", OUString::number( nFound ));
                        SvxSearchDialogWrapper::SetSearchLabel(sText);
                    }
                }
                break;
            }

            uno::Reference< frame::XDispatchRecorder > xRecorder =
                    GetViewFrame().GetBindings().GetRecorder();
            //prevent additional dialogs in recorded macros
            if ( xRecorder.is() )
                rReq.AppendItem(SfxBoolItem(SID_SEARCH_QUIET, true));

            rReq.Done();
            m_eLastSearchCommand = s_pSrchItem->GetCommand();
            SwView::SetMoveType(nMoveType);
        }
        break;
        case FID_SEARCH_SEARCHSET:
        case FID_SEARCH_REPLACESET:
        {
            static const WhichRangesContainer aNormalAttr(svl::Items<
/* 0 */         RES_CHRATR_CASEMAP,     RES_CHRATR_CASEMAP,
/* 2 */         RES_CHRATR_COLOR,       RES_CHRATR_POSTURE,
/* 4 */         RES_CHRATR_SHADOWED,    RES_CHRATR_WORDLINEMODE,
/* 6 */         RES_CHRATR_BLINK,       RES_CHRATR_BLINK,
/* 8 */         RES_CHRATR_BACKGROUND,  RES_CHRATR_BACKGROUND,
/*10 */         RES_CHRATR_ROTATE,      RES_CHRATR_ROTATE,
/*12 */         RES_CHRATR_SCALEW,      RES_CHRATR_RELIEF,
/*14 */         RES_CHRATR_OVERLINE,    RES_CHRATR_OVERLINE,
/*16 */         RES_PARATR_LINESPACING, RES_PARATR_HYPHENZONE,
/*18 */         RES_PARATR_REGISTER,    RES_PARATR_REGISTER,
/*20 */         RES_PARATR_VERTALIGN,   RES_PARATR_VERTALIGN,
                RES_MARGIN_FIRSTLINE,   RES_MARGIN_RIGHT,
                RES_UL_SPACE,           RES_UL_SPACE,
/*24 */         SID_ATTR_PARA_MODEL,    SID_ATTR_PARA_KEEP
            >);

            SfxItemSet aSet(m_pWrtShell->GetAttrPool(), aNormalAttr);

            if( SvtCTLOptions::IsCTLFontEnabled() )
            {
                aSet.MergeRange(RES_CHRATR_CTL_FONT, RES_CHRATR_CTL_WEIGHT);
            }
            if( SvtCJKOptions::IsAnyEnabled() )
            {
                aSet.MergeRange(RES_CHRATR_CJK_FONT, RES_CHRATR_CJK_WEIGHT);
                aSet.MergeRange(RES_CHRATR_EMPHASIS_MARK, RES_CHRATR_TWO_LINES);
                aSet.MergeRange(RES_PARATR_SCRIPTSPACE, RES_PARATR_FORBIDDEN_RULES);
            }

            TypedWhichId<SvxSetItem> nWhich = SID_SEARCH_SEARCHSET;

            if ( FID_SEARCH_REPLACESET == nSlot )
            {
                nWhich = SID_SEARCH_REPLACESET;

                if ( s_xReplaceList )
                {
                    s_xReplaceList->Get( aSet );
                    s_xReplaceList.reset();
                }
            }
            else if ( s_xSearchList )
            {
                s_xSearchList->Get( aSet );
                s_xSearchList.reset();
            }
            rReq.SetReturnValue( SvxSetItem( nWhich, aSet ) );
        }
        break;
        default:
            SAL_WARN_IF( nSlot, "sw", "nSlot: " << nSlot << " wrong Dispatcher (viewsrch.cxx)" );
            return;
    }
}

IMPL_LINK(SwView, SearchDialogHdl, SfxRequest&, rReq, void)
{
    // Get the parameter from the request
    const SfxItemSet* pArgs = rReq.GetArgs();
    bool bInitialFocusOnReplace = false;

    if (pArgs)
    {
        const SfxBoolItem* pBoolItem = pArgs->GetItemIfSet(SID_SEARCH_DLG, false);
        if (pBoolItem)
            bInitialFocusOnReplace = pBoolItem->GetValue();
    }

    if (!s_pSrchItem)
        s_pSrchItem = new SvxSearchItem(SID_SEARCH_ITEM);

    s_pSrchItem->SetInitialFocusOnReplace(bInitialFocusOnReplace);

    // Execute the search item to pass it to the dialog
    const SfxPoolItem* ppArgs[] = { s_pSrchItem, nullptr };
    GetDispatcher().Execute(SID_SEARCH_ITEM, SfxCallMode::SYNCHRON, ppArgs);

    // Open the dialog
    GetViewFrame().ToggleChildWindow(SvxSearchDialogWrapper::GetChildWindowId());
}

bool SwView::SearchAndWrap(bool bApi)
{
    SwSearchOptions aOpts( m_pWrtShell.get(), s_pSrchItem->GetBackward() );

        // Remember starting position of the search for wraparound
        // Start- / EndAction perhaps because existing selections of 'search all'
    m_pWrtShell->StartAllAction();
    m_pWrtShell->Push();

    // After a search all action we place the cursor at the beginning of
    // the document so that the single search selects the first matching
    // occurrence in the document instead of the second.
    if( m_eLastSearchCommand == SvxSearchCmd::FIND_ALL )
    {
        if( SwDocPositions::Start == aOpts.eEnd )
            m_pWrtShell->EndOfSection();
        else
            m_pWrtShell->StartOfSection();
    }

    // fdo#65014 : Ensure that the point of the cursor is at the extremity of the
    // selection closest to the end being searched to as to exclude the selected
    // region from the search. (This doesn't work in the case of multiple
    // selected regions as the cursor doesn't mark the selection in that case.)
    m_pWrtShell->GetCursor()->Normalize( s_pSrchItem->GetBackward() );

    if (!m_pWrtShell->HasSelection() && (s_pSrchItem->HasStartPoint()))
    {
        // No selection -> but we have a start point (top left corner of the
        // current view), start searching from there, not from the current
        // cursor position.
        SwEditShell& rShell = GetWrtShell();
        Point aPosition(s_pSrchItem->GetStartPointX(), s_pSrchItem->GetStartPointY());
        rShell.SetCursor(aPosition);
    }

        // If you want to search in selected areas, they must not be unselected.
    if (!s_pSrchItem->GetSelection())
        m_pWrtShell->KillSelection(nullptr, false);

    std::optional<SwWait> oWait( std::in_place, *GetDocShell(), true );
    if( FUNC_Search( aOpts ) )
    {
        s_bFound = true;
        if(m_pWrtShell->IsSelFrameMode())
        {
            m_pWrtShell->UnSelectFrame();
            m_pWrtShell->LeaveSelFrameMode();
        }
        m_pWrtShell->Pop();
        m_pWrtShell->EndAllAction();
        return true;
    }
    oWait.reset();

        // Search in the specialized areas when no search is present in selections.
        // When searching selections will already searched in these special areas.
    bool bHasSrchInOther = s_bExtra;
    if (!s_pSrchItem->GetSelection() && !s_bExtra )
    {
        s_bExtra = true;
        if( FUNC_Search( aOpts ) )
        {
            s_bFound = true;
            m_pWrtShell->Pop();
            m_pWrtShell->EndAllAction();
            return true;
        }
        s_bExtra = false;
    }
    else
        s_bExtra = !s_bExtra;

        // If starting position is at the end or beginning of the document.
    if (aOpts.bDontWrap)
    {
        m_pWrtShell->EndAllAction();
        if( !bApi )
        {
#if HAVE_FEATURE_DESKTOP
            if (SfxViewShell* pNotifySh = m_pWrtShell->GetSfxViewShell())
                pNotifySh->viewCallback(KIT_CALLBACK_SEARCH_NOT_FOUND, s_pSrchItem->GetSearchString().toUtf8());
            SvxSearchDialogWrapper::SetSearchLabel(SearchLabel::NotFound);
#endif
        }
        s_bFound = false;
        m_pWrtShell->Pop();
        return false;
    }
    m_pWrtShell->EndAllAction();
        // Try again with WrapAround?

    m_pWrtShell->StartAllAction();
    m_pWrtShell->Pop(SwCursorShell::PopMode::DeleteCurrent);
    oWait.emplace( *GetDocShell(), true );

    bool bSrchBkwrd = SwDocPositions::Start == aOpts.eEnd;

    aOpts.eEnd =  bSrchBkwrd ? SwDocPositions::Start : SwDocPositions::End;
    aOpts.eStart = bSrchBkwrd ? SwDocPositions::End : SwDocPositions::Start;

    if (bHasSrchInOther)
    {
        m_pWrtShell->ClearMark();
        // Select the start or the end of the entire document
        if (bSrchBkwrd)
            m_pWrtShell->SttEndDoc(false);
        else
            m_pWrtShell->SttEndDoc(true);
    }

    s_bFound = bool(FUNC_Search( aOpts ));

    // If WrapAround found no matches in the body text, search in the special
    // sections, too.
    if (!s_bFound && !s_pSrchItem->GetSelection() && !s_bExtra)
    {
        s_bExtra = true;
        if (FUNC_Search(aOpts))
            s_bFound = true;
        else
            s_bExtra = false;
    }

    m_pWrtShell->EndAllAction();
    oWait.reset();
#if HAVE_FEATURE_DESKTOP
    if (s_bFound)
    {
        if (!bSrchBkwrd)
            SvxSearchDialogWrapper::SetSearchLabel(SearchLabel::End);
        else
            SvxSearchDialogWrapper::SetSearchLabel(SearchLabel::Start);
    }
    else if(!bApi)
    {
        if (SfxViewShell* pNotifySh = m_pWrtShell->GetSfxViewShell())
            pNotifySh->viewCallback(KIT_CALLBACK_SEARCH_NOT_FOUND, s_pSrchItem->GetSearchString().toUtf8());
        SvxSearchDialogWrapper::SetSearchLabel(SearchLabel::NotFound);
    }
#endif
    return s_bFound;
}

sal_Int32 SwView::SearchAll()
{
    SwWait aWait( *GetDocShell(), true );
    m_pWrtShell->StartAllAction();

    SwSearchOptions aOpts( m_pWrtShell.get(), s_pSrchItem->GetBackward() );

    if (!s_pSrchItem->GetSelection())
    {
        // Cancel existing selections, if should not be sought in selected areas.
        m_pWrtShell->KillSelection(nullptr, false);

        if( SwDocPositions::Start == aOpts.eEnd )
            m_pWrtShell->EndOfSection();
        else
            m_pWrtShell->StartOfSection();
    }
    s_bExtra = false;
    auto nFound = FUNC_Search(aOpts);
    s_bFound = 0 != nFound;

    m_pWrtShell->EndAllAction();
    return nFound;
}

void SwView::Replace()
{
    SwWait aWait( *GetDocShell(), true );

    m_pWrtShell->StartAllAction();

    if( s_pSrchItem->GetPattern() ) // Templates?
    {
        SwRewriter aRewriter;
        aRewriter.AddRule(UndoArg1, s_pSrchItem->GetSearchString());
        aRewriter.AddRule(UndoArg2, SwResId(STR_YIELDS));
        aRewriter.AddRule(UndoArg3, s_pSrchItem->GetReplaceString());

        m_pWrtShell->StartUndo(SwUndoId::UI_REPLACE_STYLE, &aRewriter);

        m_pWrtShell->SetTextFormatColl( m_pWrtShell->GetParaStyle(
                            UIName(s_pSrchItem->GetReplaceString()),
                            SwWrtShell::GETSTYLE_CREATESOME ));

        m_pWrtShell->EndUndo();
    }
    else
    {
        if (GetPostItMgr()->HasActiveSidebarWin())
            GetPostItMgr()->Replace(s_pSrchItem);

        bool bReqReplace = true;

        if(m_pWrtShell->HasSelection())
        {
            /* check that the selection match the search string*/
            //save state
            SwPosition aStartPos = * m_pWrtShell->GetCursor()->Start();
            SwPosition aEndPos = * m_pWrtShell->GetCursor()->End();
            bool   bHasSelection = s_pSrchItem->GetSelection();
            SvxSearchCmd nOldCmd = s_pSrchItem->GetCommand();

            //set state for checking if current selection has a match
            s_pSrchItem->SetCommand( SvxSearchCmd::FIND );
            s_pSrchItem->SetSelection(true);

            //check if it matches
            SwSearchOptions aOpts( m_pWrtShell.get(), s_pSrchItem->GetBackward() );
            if( ! FUNC_Search(aOpts) )
            {

                //no matching therefore should not replace selection
                // => remove selection

                if(! s_pSrchItem->GetBackward() )
                {
                    (* m_pWrtShell->GetCursor()->Start()) = std::move(aStartPos);
                    (* m_pWrtShell->GetCursor()->End()) = std::move(aEndPos);
                }
                else
                {
                    (* m_pWrtShell->GetCursor()->Start()) = std::move(aEndPos);
                    (* m_pWrtShell->GetCursor()->End()) = std::move(aStartPos);
                }
                bReqReplace = false;
            }

            //set back old search state
            s_pSrchItem->SetCommand( nOldCmd );
            s_pSrchItem->SetSelection(bHasSelection);
        }
        /*
         * remove current selection
         * otherwise it is always replaced
         * no matter if the search string exists or not in the selection
         * Now the selection is removed and the next matching string is selected
         */

        if( bReqReplace )
        {
            bool bReplaced = true;
            // Replace selection (Not if only attributes should be replaced)
            if (!s_pSrchItem->GetReplaceString().isEmpty() || !s_xReplaceList)
            {
                bReplaced = m_pWrtShell->SwEditShell::Replace( s_pSrchItem->GetReplaceString(),
                                                               s_pSrchItem->GetRegExp() );
            }
            // Replace attributes
            if( bReplaced && s_xReplaceList && s_xReplaceList->Count() && m_pWrtShell->HasSelection() )
            {
                SfxItemSet aReplSet( m_pWrtShell->GetAttrPool(),
                                     aTextFormatCollSetRange );
                if( s_xReplaceList->Get( aReplSet ).Count() )
                {
                    ::SfxToSwPageDescAttr( *m_pWrtShell, aReplSet );
                    m_pWrtShell->SwEditShell::SetAttrSet( aReplSet );
                }
            }
        }
    }

    m_pWrtShell->EndAllAction();
}

SwSearchOptions::SwSearchOptions( SwWrtShell const * pSh, bool bBackward )
   : eStart(SwDocPositions::Curr)
{
    if( bBackward )
    {
        eEnd = SwDocPositions::Start;
        bDontWrap = pSh->IsEndOfDoc();
    }
    else
    {
        eEnd = SwDocPositions::End;
        bDontWrap = pSh->IsStartOfDoc();
    }
}

sal_Int32 SwView::FUNC_Search(const SwSearchOptions& rOptions)
{
#if HAVE_FEATURE_DESKTOP
    SvxSearchDialogWrapper::SetSearchLabel(SearchLabel::Empty);
#endif
    bool bDoReplace = s_pSrchItem->GetCommand() == SvxSearchCmd::REPLACE ||
                      s_pSrchItem->GetCommand() == SvxSearchCmd::REPLACE_ALL;

    FindRanges eRanges = s_pSrchItem->GetSelection()
                        ? FindRanges::InSel
                        : s_bExtra
                          ? FindRanges::InOther : FindRanges::InBody;
    if (s_pSrchItem->GetCommand() == SvxSearchCmd::FIND_ALL    ||
        s_pSrchItem->GetCommand() == SvxSearchCmd::REPLACE_ALL)
        eRanges |= FindRanges::InSelAll;

    m_pWrtShell->SttSelect();

    static const WhichRangesContainer aSearchAttrRange(svl::Items<
        RES_CHRATR_BEGIN, RES_CHRATR_END-1,
        RES_PARATR_BEGIN, RES_PARATR_END-1,
        RES_FRMATR_BEGIN, RES_FRMATR_END-1,
        SID_ATTR_PARA_MODEL, SID_ATTR_PARA_KEEP
        >);

    SfxItemSet aSrchSet( m_pWrtShell->GetAttrPool(), aSearchAttrRange);
    if( s_xSearchList && s_xSearchList->Count() )
    {
        s_xSearchList->Get( aSrchSet );

        // -- Page break with page template
        ::SfxToSwPageDescAttr( *m_pWrtShell, aSrchSet );
    }

    std::optional<SfxItemSet> xReplSet;
    if( bDoReplace && s_xReplaceList && s_xReplaceList->Count() )
    {
        xReplSet.emplace( m_pWrtShell->GetAttrPool(), aSearchAttrRange );
        s_xReplaceList->Get( *xReplSet );

        // -- Page break with page template
        ::SfxToSwPageDescAttr( *m_pWrtShell, *xReplSet );

        if( !xReplSet->Count() )        // too bad, we don't know
            xReplSet.reset();        // the attributes
    }

    // build SearchOptions to be used

    i18nutil::SearchOptions2 aSearchOpt( s_pSrchItem->GetSearchOptions() );
    aSearchOpt.Locale = GetAppLanguageTag().getLocale();
    if( !bDoReplace )
        aSearchOpt.replaceString.clear();

    sal_Int32 nFound;
    if( aSrchSet.Count() || ( xReplSet && xReplSet->Count() ))
    {
        nFound = m_pWrtShell->SearchAttr(
            aSrchSet,
            !s_pSrchItem->GetPattern(),
            rOptions.eStart,
            rOptions.eEnd,
            eRanges,
            !s_pSrchItem->GetSearchString().isEmpty() ? &aSearchOpt : nullptr,
            xReplSet ? &*xReplSet : nullptr );
    }
    else if( s_pSrchItem->GetPattern() )
    {
        // Searching (and replacing) templates
        const UIName sRplStr( s_pSrchItem->GetReplaceString() );
        nFound = m_pWrtShell->SearchTempl( UIName(s_pSrchItem->GetSearchString()),
            rOptions.eStart,
            rOptions.eEnd,
            eRanges,
            bDoReplace ? &sRplStr : nullptr );
    }
    else
    {
        // Normal search
        nFound = m_pWrtShell->SearchPattern(aSearchOpt, s_pSrchItem->GetNotes(),
                                          rOptions.eStart,
                                          rOptions.eEnd,
                                          eRanges,
                                          bDoReplace );
    }
    m_pWrtShell->EndSelect();
    return nFound;
}

SvxSearchDialog* SwView::GetSearchDialog()
{
#if HAVE_FEATURE_DESKTOP
    const sal_uInt16 nId = SvxSearchDialogWrapper::GetChildWindowId();
    SfxViewFrame* pViewFrm = SfxViewFrame::Current();
    if (!pViewFrm)
        return nullptr;
    SvxSearchDialogWrapper *pWrp = static_cast<SvxSearchDialogWrapper*>(pViewFrm->GetChildWindow(nId));
    if (!pWrp)
        return nullptr;
    return pWrp->getDialog();
#else
    return nullptr;
#endif
}

void SwView::StateSearch(SfxItemSet &rSet)
{
    SfxWhichIter aIter(rSet);
    sal_uInt16 nWhich = aIter.FirstWhich();

    while(nWhich)
    {
        switch(nWhich)
        {
            case SID_SEARCH_OPTIONS:
            {
                SearchOptionFlags nOpt = SearchOptionFlags::ALL;
                if (GetDocShell()->IsReadOnly() || IsCurrentKitViewReadOnly())
                    nOpt &= ~SearchOptionFlags( SearchOptionFlags::REPLACE |
                               SearchOptionFlags::REPLACE_ALL );
                rSet.Put( SfxUInt16Item( SID_SEARCH_OPTIONS, static_cast<sal_uInt16>(nOpt) ));
            }
            break;
            case SID_SEARCH_ITEM:
            {
                if ( !s_pSrchItem )
                {
                    s_pSrchItem = new SvxSearchItem( SID_SEARCH_ITEM );
                    s_pSrchItem->SetFamily(SfxStyleFamily::Para);
                    s_pSrchItem->SetSearchString( m_pWrtShell->GetSelText() );
                }

                if( s_bJustOpened && m_pWrtShell->IsSelection() )
                {
                    OUString aText;
                    if( 1 == m_pWrtShell->GetCursorCnt() &&
                        !( aText = m_pWrtShell->SwCursorShell::GetSelText() ).isEmpty() )
                    {
                        s_pSrchItem->SetSearchString( aText );
                        s_pSrchItem->SetSelection( false );
                    }
                    else
                        s_pSrchItem->SetSelection( true );
                }

                s_bJustOpened = false;
                rSet.Put( *s_pSrchItem );
            }
            break;
        }
        nWhich = aIter.NextWhich();
    }
}

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
