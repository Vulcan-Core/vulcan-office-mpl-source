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

#include <utility>
#include <vcl/virdev.hxx>
#include <svx/svdundo.hxx>

#include <undobase.hxx>
#include <refundo.hxx>
#include <docsh.hxx>
#include <tabvwsh.hxx>
#include <undoolk.hxx>
#include <undodraw.hxx>
#include <dbdata.hxx>
#include <attrib.hxx>
#include <queryparam.hxx>
#include <subtotalparam.hxx>
#include <rowheightcontext.hxx>
#include <column.hxx>
#include <sortparam.hxx>
#include <columnspanset.hxx>
#include <undomanager.hxx>
#include <comphelper/kit.hxx>
#include <sfx2/bindings.hxx>
#include <sfx2/sfxsids.hrc>
#include <sfx2/viewfrm.hxx>
#include <sizedev.hxx>


ScSimpleUndo::ScSimpleUndo( ScDocShell& rDocSh ) :
    rDocShell( rDocSh ),
    mnViewShellId(-1)
{
    if (ScTabViewShell* pViewShell = ScTabViewShell::GetActiveViewShell())
        mnViewShellId = pViewShell->GetViewShellId();
}

ViewShellId ScSimpleUndo::GetViewShellId() const
{
    return mnViewShellId;
}

bool ScSimpleUndo::SetViewMarkData( const ScMarkData& rMarkData )
{
    if ( IsPaintLocked() )
        return false;

    ScTabViewShell* pViewShell = ScTabViewShell::GetActiveViewShell();
    if ( !pViewShell )
        return false;

    pViewShell->SetMarkData( rMarkData );
    return true;
}

bool ScSimpleUndo::Merge( SfxUndoAction *pNextAction )
{
    // A SdrUndoGroup for updating detective arrows can belong
    // to each Undo-Action.
    // DetectiveRefresh is always called next,
    // the SdrUndoGroup is encapsulated in a ScUndoDraw action.
    // AddUndoAction is only called with bTryMerg=true
    // for automatic update.

    if ( !pDetectiveUndo && dynamic_cast<const ScUndoDraw*>( pNextAction) !=  nullptr )
    {
        // Take SdrUndoAction from ScUndoDraw Action,
        // ScUndoDraw is later deleted by the UndoManager

        ScUndoDraw* pCalcUndo = static_cast<ScUndoDraw*>(pNextAction);
        pDetectiveUndo = pCalcUndo->ReleaseDrawUndo();
        return true;
    }

    return false;
}

void ScSimpleUndo::BeginUndo()
{
    rDocShell.SetInUndo( true );

    ScTabViewShell* pViewShell = ScTabViewShell::GetActiveViewShell();
    if (pViewShell)
        pViewShell->HideAllCursors();       // for example due to merged cells

    //  detective updates happened last, must be undone first
    if (pDetectiveUndo)
        pDetectiveUndo->Undo();
}

namespace
{
    class DisableUndoGuard
    {
    private:
        ScDocument& m_rDoc;
        bool m_bUndoEnabled;
    public:
        explicit DisableUndoGuard(ScDocShell& rDocShell)
            : m_rDoc(rDocShell.GetDocument())
            , m_bUndoEnabled(m_rDoc.IsUndoEnabled())
        {
            m_rDoc.EnableUndo(false);
        }

        ~DisableUndoGuard()
        {
            m_rDoc.EnableUndo(m_bUndoEnabled);
        }
    };
}

void ScSimpleUndo::EndUndo()
{
    // After undo we need to restore the sheet views as well.
    SyncSheetViews();

    {
        // rhbz#1352881 Temporarily turn off undo generation during
        // SetDocumentModified
        DisableUndoGuard aGuard(rDocShell);
        rDocShell.SetDocumentModified();
    }

    ScTabViewShell* pViewShell = ScTabViewShell::GetActiveViewShell();
    if (pViewShell)
    {
        pViewShell->UpdateAutoFillMark();
        pViewShell->UpdateInputHandler();
        pViewShell->ShowAllCursors();
    }

    rDocShell.SetInUndo( false );
}

void ScSimpleUndo::BeginRedo()
{
    rDocShell.SetInUndo( true );   //! own Flag for Redo?

    ScTabViewShell* pViewShell = ScTabViewShell::GetActiveViewShell();
    if (pViewShell)
        pViewShell->HideAllCursors();       // for example due to merged cells
}

void ScSimpleUndo::EndRedo()
{
    if (pDetectiveUndo)
        pDetectiveUndo->Redo();

    // After redo we need to restore the sheet views as well.
    SyncSheetViews();

    {
        // rhbz#1352881 Temporarily turn off undo generation during
        // SetDocumentModified
        DisableUndoGuard aGuard(rDocShell);
        rDocShell.SetDocumentModified();
    }

    ScTabViewShell* pViewShell = ScTabViewShell::GetActiveViewShell();
    if (pViewShell)
    {
        pViewShell->UpdateAutoFillMark();
        pViewShell->UpdateInputHandler();
        pViewShell->ShowAllCursors();
    }

    rDocShell.SetInUndo( false );
}

void ScSimpleUndo::SyncSheetViews()
{
    ScViewData* pViewData = ScDocShell::GetViewData();
    if (!pViewData)
        return;

    ScDocument& rDocument = rDocShell.GetDocument();
    SCTAB nDefaultViewTable = rDocument.GetDefaultViewTableNumber(pViewData->GetTabNumber());
    rDocument.SyncSheetViews(nDefaultViewTable);
}

void ScSimpleUndo::BroadcastChanges( const ScRange& rRange )
{
    ScDocument& rDoc = rDocShell.GetDocument();
    rDoc.BroadcastCells(rRange, SfxHintId::ScDataChanged);
}

namespace {

class SpanBroadcaster : public sc::ColumnSpanSet::ColumnAction
{
    ScDocument& mrDoc;
    SCTAB mnCurTab;
    SCCOL mnCurCol;

public:
    explicit SpanBroadcaster( ScDocument& rDoc ) : mrDoc(rDoc), mnCurTab(-1), mnCurCol(-1) {}

    virtual void startColumn( ScColumn* pCol ) override
    {
        mnCurTab = pCol->GetTab();
        mnCurCol = pCol->GetCol();
    }

    virtual void execute( SCROW nRow1, SCROW nRow2, bool bVal ) override
    {
        if (!bVal)
            return;

        ScRange aRange(mnCurCol, nRow1, mnCurTab, mnCurCol, nRow2, mnCurTab);
        mrDoc.BroadcastCells(aRange, SfxHintId::ScDataChanged);
    };
};

}

void ScSimpleUndo::BroadcastChanges( const DataSpansType& rSpans )
{
    ScDocument& rDoc = rDocShell.GetDocument();
    SpanBroadcaster aBroadcaster(rDoc);

    for (const auto& rEntry : rSpans)
    {
        const sc::ColumnSpanSet& rSet = *rEntry.second;
        rSet.executeColumnAction(rDoc, aBroadcaster);
    }
}

void ScSimpleUndo::ShowTable( SCTAB nTab )
{
    ScTabViewShell* pViewShell = ScTabViewShell::GetActiveViewShell();
    if (pViewShell)
        pViewShell->SetTabNo( nTab );
}

void ScSimpleUndo::ShowTable( const ScRange& rRange )
{
    ScTabViewShell* pViewShell = ScTabViewShell::GetActiveViewShell();
    if (pViewShell)
    {
        SCTAB nStart = rRange.aStart.Tab();
        SCTAB nEnd   = rRange.aEnd.Tab();
        SCTAB nTab = pViewShell->GetViewData().GetTabNumber();
        if ( nTab < nStart || nTab > nEnd )                     // if not in range:
            pViewShell->SetTabNo( nStart );                     // at beginning of the range
    }
}

ScBlockUndo::ScBlockUndo( ScDocShell& rDocSh, const ScRange& rRange,
                                            ScBlockUndoMode eBlockMode ) :
    ScSimpleUndo( rDocSh ),
    aBlockRange( rRange ),
    eMode( eBlockMode )
{
    pDrawUndo = GetSdrUndoAction( &rDocShell.GetDocument() );
}

ScBlockUndo::~ScBlockUndo()
{
    pDrawUndo.reset();
}

void ScBlockUndo::BeginUndo()
{
    ScSimpleUndo::BeginUndo();
    EnableDrawAdjust( &rDocShell.GetDocument(), false );
}

void ScBlockUndo::EndUndo()
{
    if (eMode == SC_UNDO_AUTOHEIGHT)
        AdjustHeight();

    EnableDrawAdjust( &rDocShell.GetDocument(), true );
    DoSdrUndoAction( pDrawUndo.get(), &rDocShell.GetDocument() );

    // tdf#161712 invoke ScSimpleUndo::EndUndo() before ShowBlock()
    // If this is an instance of ScUndoAutoFill, ShowBlock() will invoke
    // ScTabViewShell::MoveCursorAbs() which will delete this instance
    // so invoke ScSimpleUndo::EndUndo() first.
    ScSimpleUndo::EndUndo();
    ShowBlock();
}

void ScBlockUndo::EndRedo()
{
    if (eMode == SC_UNDO_AUTOHEIGHT)
        AdjustHeight();

    ShowBlock();
    ScSimpleUndo::EndRedo();
}

bool ScBlockUndo::AdjustHeight()
{
    ScDocument& rDoc = rDocShell.GetDocument();

    ScSizeDeviceProvider aProv(rDocShell);
    double fZoomX( 1.0 );
    double fZoomY = fZoomX;
    double nPPTX, nPPTY;
    ScTabViewShell* pViewShell = ScTabViewShell::GetActiveViewShell();
    if (pViewShell)
    {
        if (aProv.IsPrinter())
        {
            nPPTX = aProv.GetPPTX();
            nPPTY = aProv.GetPPTY();
        }
        else
        {
            ScViewData& rData = pViewShell->GetViewData();
            nPPTX = rData.GetPPTX();
            nPPTY = rData.GetPPTY();
            fZoomX = rData.GetZoomX();
            fZoomY = rData.GetZoomY();
        }
    }
    else
    {
        // Leave zoom at 100
        nPPTX = ScGlobal::nScreenPPTX;
        nPPTY = ScGlobal::nScreenPPTY;
    }

    sc::RowHeightContext aCxt(rDoc.MaxRow(), nPPTX, nPPTY, fZoomX, fZoomY, aProv.GetDevice());
    bool bRet = rDoc.SetOptimalHeight(
        aCxt, aBlockRange.aStart.Row(), aBlockRange.aEnd.Row(), aBlockRange.aStart.Tab(), true);

    if (bRet)
    {
        // tdf#76183: recalculate objects' positions
        rDoc.SetDrawPageSize(aBlockRange.aStart.Tab());

        rDocShell.PostPaint( 0,      aBlockRange.aStart.Row(), aBlockRange.aStart.Tab(),
                              rDoc.MaxCol(), rDoc.MaxRow(),                   aBlockRange.aEnd.Tab(),
                              PaintPartFlags::Grid | PaintPartFlags::Left );
    }
    return bRet;
}

void ScBlockUndo::ShowBlock()
{
    if ( IsPaintLocked() )
        return;

    ScTabViewShell* pViewShell = ScTabViewShell::GetActiveViewShell();
    if (!pViewShell)
        return;

    ShowTable( aBlockRange );       // with multiple sheets in range each of them is good
    pViewShell->MoveCursorAbs( aBlockRange.aStart.Col(), aBlockRange.aStart.Row(),
                               SC_FOLLOW_JUMP, false, false );
    SCTAB nTab = pViewShell->GetViewData().GetTabNumber();
    ScRange aRange = aBlockRange;
    aRange.aStart.SetTab( nTab );
    aRange.aEnd.SetTab( nTab );
    pViewShell->MarkRange( aRange );

    // not through SetMarkArea to MarkData, due to possibly lacking paint
}

ScMultiBlockUndo::ScMultiBlockUndo(
    ScDocShell& rDocSh, ScRangeList aRanges) :
    ScSimpleUndo(rDocSh),
    maBlockRanges(std::move(aRanges))
{
    mpDrawUndo = GetSdrUndoAction( &rDocShell.GetDocument() );
}

ScMultiBlockUndo::~ScMultiBlockUndo()
{
    mpDrawUndo.reset();
}

void ScMultiBlockUndo::BeginUndo()
{
    ScSimpleUndo::BeginUndo();
    EnableDrawAdjust(&rDocShell.GetDocument(), false);
}

void ScMultiBlockUndo::EndUndo()
{
    EnableDrawAdjust(&rDocShell.GetDocument(), true);
    DoSdrUndoAction(mpDrawUndo.get(), &rDocShell.GetDocument());

    ShowBlock();
    ScSimpleUndo::EndUndo();
}

void ScMultiBlockUndo::EndRedo()
{
    ShowBlock();
    ScSimpleUndo::EndRedo();
}

void ScMultiBlockUndo::ShowBlock()
{
    if ( IsPaintLocked() )
        return;

    ScTabViewShell* pViewShell = ScTabViewShell::GetActiveViewShell();
    if (!pViewShell)
        return;

    if (maBlockRanges.empty())
        return;

    // Move to the sheet of the first range.
    ScRange aRange = maBlockRanges.front();
    ShowTable(aRange);
    pViewShell->MoveCursorAbs(
        aRange.aStart.Col(), aRange.aStart.Row(), SC_FOLLOW_JUMP, false, false);
    SCTAB nTab = pViewShell->GetViewData().GetTabNumber();
    aRange.aStart.SetTab(nTab);
    aRange.aEnd.SetTab(nTab);
    pViewShell->MarkRange(aRange, false);

    for (size_t i = 1, n = maBlockRanges.size(); i < n; ++i)
    {
        aRange = maBlockRanges[i];
        aRange.aStart.SetTab(nTab);
        aRange.aEnd.SetTab(nTab);
        pViewShell->MarkRange(aRange, false, true);
    }
}

ScMoveUndo::ScMoveUndo( ScDocShell& rDocSh, ScDocumentUniquePtr pRefDoc, std::unique_ptr<ScRefUndoData> pRefData ) :
    ScSimpleUndo( rDocSh ),
    pRefUndoDoc( std::move(pRefDoc) ),
    pRefUndoData( std::move(pRefData) )
{
    ScDocument& rDoc = rDocShell.GetDocument();
    if (pRefUndoData)
        pRefUndoData->DeleteUnchanged(rDoc);
    pDrawUndo = GetSdrUndoAction( &rDoc );
}

ScMoveUndo::~ScMoveUndo()
{
    pRefUndoData.reset();
    pRefUndoDoc.reset();
    pDrawUndo.reset();
}

void ScMoveUndo::UndoRef()
{
    ScDocument& rDoc = rDocShell.GetDocument();
    ScRange aRange(0,0,0, rDoc.MaxCol(),rDoc.MaxRow(),pRefUndoDoc->GetTableCount()-1);
    pRefUndoDoc->CopyToDocument(aRange, InsertDeleteFlags::FORMULA, false, rDoc, nullptr, false);
    if (pRefUndoData)
        pRefUndoData->DoUndo( rDoc, false );
}

void ScMoveUndo::BeginUndo()
{
    ScSimpleUndo::BeginUndo();

    EnableDrawAdjust( &rDocShell.GetDocument(), false );
}

void ScMoveUndo::EndUndo()
{
    DoSdrUndoAction( pDrawUndo.get(), &rDocShell.GetDocument() );     // must also be called when pointer is null

    if (pRefUndoDoc)
        UndoRef();

    EnableDrawAdjust( &rDocShell.GetDocument(), true );

    ScSimpleUndo::EndUndo();
}

ScDBFuncUndo::ScDBFuncUndo( ScDocShell& rDocSh, const ScRange& rOriginal ) :
    ScSimpleUndo( rDocSh ),
    aOriginalRange( rOriginal )
{
    pAutoDBRange = rDocSh.GetOldAutoDBRange();
}

ScDBFuncUndo::~ScDBFuncUndo()
{
    pAutoDBRange.reset();
}

void ScDBFuncUndo::BeginUndo()
{
    ScSimpleUndo::BeginUndo();
    DoSdrUndoAction( nullptr, &rDocShell.GetDocument() );
}

void ScDBFuncUndo::EndUndo()
{
    ScSimpleUndo::EndUndo();

    if ( !pAutoDBRange )
        return;

    ScDocument& rDoc = rDocShell.GetDocument();
    SCTAB nTab = rDoc.GetVisibleTab();
    ScDBData* pNoNameData = rDoc.GetAnonymousDBData(nTab);
    if (!pNoNameData )
        return;

    SCCOL nRangeX1;
    SCROW nRangeY1;
    SCCOL nRangeX2;
    SCROW nRangeY2;
    SCTAB nRangeTab;
    pNoNameData->GetArea( nRangeTab, nRangeX1, nRangeY1, nRangeX2, nRangeY2 );
    rDocShell.DBAreaDeleted( nRangeTab, nRangeX1, nRangeY1, nRangeX2 );

    *pNoNameData = *pAutoDBRange;

    if ( pAutoDBRange->HasAutoFilter() )
    {
        // restore AutoFilter buttons
        pAutoDBRange->GetArea( nRangeTab, nRangeX1, nRangeY1, nRangeX2, nRangeY2 );
        rDoc.ApplyFlagsTab( nRangeX1, nRangeY1, nRangeX2, nRangeY1, nRangeTab, ScMF::Auto );
        rDocShell.PostPaint( nRangeX1, nRangeY1, nRangeTab, nRangeX2, nRangeY1, nRangeTab, PaintPartFlags::Grid );
    }
}

void ScDBFuncUndo::BeginRedo()
{
    RedoSdrUndoAction( nullptr );
    if ( pAutoDBRange )
    {
        // move the database range to this function's position again (see ScDocShell::GetDBData)

        ScDocument& rDoc = rDocShell.GetDocument();
        ScDBData* pNoNameData = rDoc.GetAnonymousDBData(aOriginalRange.aStart.Tab());
        if ( pNoNameData )
        {

            SCCOL nRangeX1;
            SCROW nRangeY1;
            SCCOL nRangeX2;
            SCROW nRangeY2;
            SCTAB nRangeTab;
            pNoNameData->GetArea( nRangeTab, nRangeX1, nRangeY1, nRangeX2, nRangeY2 );
            rDocShell.DBAreaDeleted( nRangeTab, nRangeX1, nRangeY1, nRangeX2 );

            pNoNameData->SetSortParam( ScSortParam() );
            pNoNameData->SetQueryParam( ScQueryParam() );
            pNoNameData->SetSubTotalParam( ScSubTotalParam() );

            pNoNameData->SetArea( aOriginalRange.aStart.Tab(),
                                  aOriginalRange.aStart.Col(), aOriginalRange.aStart.Row(),
                                  aOriginalRange.aEnd.Col(), aOriginalRange.aEnd.Row() );

            pNoNameData->SetByRow( true );
            pNoNameData->SetAutoFilter( false );
            // header is always set with the operation in redo
        }
    }

    ScSimpleUndo::BeginRedo();
}

void ScDBFuncUndo::EndRedo()
{
    ScSimpleUndo::EndRedo();
}

ScUndoWrapper::ScUndoWrapper( std::unique_ptr<SfxUndoAction> pUndo ) :
    pWrappedUndo( std::move(pUndo) ),
    mnViewShellId( -1 )
{
    if (pWrappedUndo)
        mnViewShellId = pWrappedUndo->GetViewShellId();
}

ScUndoWrapper::~ScUndoWrapper()
{
}

OUString ScUndoWrapper::GetComment() const
{
    if (pWrappedUndo)
        return pWrappedUndo->GetComment();
    return OUString();
}

ViewShellId ScUndoWrapper::GetViewShellId() const
{
    return mnViewShellId;
}

OUString ScUndoWrapper::GetRepeatComment(SfxRepeatTarget& rTarget) const
{
    if (pWrappedUndo)
        return pWrappedUndo->GetRepeatComment(rTarget);
    return OUString();
}

bool ScUndoWrapper::Merge( SfxUndoAction* pNextAction )
{
    if (pWrappedUndo)
        return pWrappedUndo->Merge(pNextAction);
    else
        return false;
}

void ScUndoWrapper::Undo()
{
    if (pWrappedUndo)
        pWrappedUndo->Undo();
}

void ScUndoWrapper::Redo()
{
    if (pWrappedUndo)
        pWrappedUndo->Redo();
}

void ScUndoWrapper::Repeat(SfxRepeatTarget& rTarget)
{
    if (pWrappedUndo)
        pWrappedUndo->Repeat(rTarget);
}

bool ScUndoWrapper::CanRepeat(SfxRepeatTarget& rTarget) const
{
    if (pWrappedUndo)
        return pWrappedUndo->CanRepeat(rTarget);
    else
        return false;
}

ScUndoManager::~ScUndoManager() {}

/**
 * Checks if the topmost undo action owned by pView can be undone although other views' undo
 * actions sit above it. Sets rOffset to the offset of that undo action on success.
 */
bool ScUndoManager::IsViewUndoActionIndependent(const SfxViewShell* pView, sal_uInt16& rOffset) const
{
    const SfxViewUndoLookup aLookup = LookupViewUndo(pView);
    if (aLookup.eStatus != SfxViewUndoLookup::Status::Independent)
        return false;
    rOffset = static_cast<sal_uInt16>(aLookup.nOffset);
    return true;
}

SfxViewUndoLookup ScUndoManager::LookupViewUndo(const SfxViewShell* pView) const
{
    if (!pView)
        return SfxViewUndoLookup();

    auto aCanMove = [](const SfxUndoAction& rMine) {
        return getAffectedRangesFromUndo(&rMine).has_value();
    };
    auto aIndependent = [](const SfxUndoAction& rMine, const SfxUndoAction& rOther) {
        std::optional<ScRangeList> oMine = getAffectedRangesFromUndo(&rMine);
        std::optional<ScRangeList> oOther = getAffectedRangesFromUndo(&rOther);
        if (!oMine || !oOther)
            return false;
        for (size_t i = 0; i < oOther->size(); ++i)
        {
            if (oMine->Intersects((*oOther)[i]))
                return false;
        }
        return true;
    };
    return SdrUndoManager::LookupViewUndo(pView->GetViewShellId(), aCanMove, aIndependent);
}

void ScUndoManager::AddUndoAction(std::unique_ptr<SfxUndoAction> pAction, bool bTryMerg)
{
    SdrUndoManager::AddUndoAction(std::move(pAction), bTryMerg);
    if (comphelper::COKit::isActive())
        InvalidateUndoStateInAllViews();
}

void ScUndoManager::InvalidateUndoStateInAllViews()
{
    for (SfxViewFrame* pFrame = SfxViewFrame::GetFirst(); pFrame; pFrame = SfxViewFrame::GetNext(*pFrame))
    {
        pFrame->GetBindings().Invalidate(SID_UNDO);
        pFrame->GetBindings().Invalidate(SID_REDO);
    }
}

SfxViewUndoLookup ScUndoManager::LookupViewRedo(const SfxViewShell* pView) const
{
    if (!pView)
        return SfxViewUndoLookup();
    return SdrUndoManager::LookupViewRedo(pView->GetViewShellId());
}

std::optional<ScRangeList> ScUndoManager::getAffectedRangesFromUndo(const SfxUndoAction* pAction)
{
    if (!pAction)
        return std::nullopt;

    if (auto pSimpleUndo = dynamic_cast<const ScSimpleUndo*>(pAction))
    {
        std::optional<ScRange> oRange = pSimpleUndo->getAffectedRange();
        if (!oRange)
            return std::nullopt;
        return ScRangeList(*oRange);
    }

    auto pListAction = dynamic_cast<const SfxListUndoAction*>(pAction);
    if (!pListAction || pListAction->maUndoActions.empty())
        return std::nullopt;

    ScRangeList aRet;
    for (const MarkedUndoAction& rChild : pListAction->maUndoActions)
    {
        std::optional<ScRangeList> oChild = getAffectedRangesFromUndo(rChild.pAction.get());
        if (!oChild)
            return std::nullopt;
        for (size_t i = 0; i < oChild->size(); ++i)
            aRet.push_back((*oChild)[i]);
    }
    return aRet;
}

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
