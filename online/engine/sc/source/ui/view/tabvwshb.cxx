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

#include <com/sun/star/chart2/data/XDataReceiver.hpp>
#include <com/sun/star/awt/XRequestCallback.hpp>
#include <com/sun/star/awt/Rectangle.hpp>

#include <com/sun/star/embed/EmbedMisc.hpp>
#include <com/sun/star/embed/XEmbeddedObject.hpp>
#include <vcl/errinf.hxx>
#include <sfx2/app.hxx>
#include <toolkit/helper/vclunohelper.hxx>
#include <svx/svxdlg.hxx>
#include <svx/dataaccessdescriptor.hxx>
#include <svx/svditer.hxx>
#include <svx/svdmark.hxx>
#include <svx/svdograf.hxx>
#include <svx/svdogrp.hxx>
#include <svx/svdoole2.hxx>
#include <svx/svdouno.hxx>
#include <svx/svdview.hxx>
#include <sfx2/linkmgr.hxx>
#include <svx/fontworkbar.hxx>
#include <sfx2/bindings.hxx>
#include <sfx2/dispatch.hxx>
#include <sfx2/viewfrm.hxx>
#include <svtools/soerr.hxx>
#include <svl/rectitem.hxx>
#include <svl/stritem.hxx>
#include <svl/slstitm.hxx>
#include <svl/whiter.hxx>
#include <svtools/strings.hrc>
#include <unotools/moduleoptions.hxx>
#include <sot/exchange.hxx>
#include <comphelper/diagnose_ex.hxx>

#include <tabvwsh.hxx>
#include <scmod.hxx>
#include <document.hxx>
#include <sc.hrc>
#include <client.hxx>
#include <fuinsert.hxx>
#include <docsh.hxx>
#include <drawview.hxx>
#include <ChartRangeSelectionListener.hxx>
#include <gridwin.hxx>
#include <undomanager.hxx>
#include <com/sun/star/ui/dialogs/ExecutableDialogResults.hpp>
#include <svx/svdpagv.hxx>
#include <o3tl/temporary.hxx>
#include <officecfg/Office/Common.hxx>

#include <comphelper/kit.hxx>
#include <tools/json_writer.hxx>
#include <COKit/COKitEnums.h>

using namespace com::sun::star;

void ScTabViewShell::ConnectObject( const SdrOle2Obj* pObj )
{
    // is called from paint

    const uno::Reference < embed::XEmbeddedObject >& xObj = pObj->GetObjRef();
    vcl::Window* pWin = GetActiveWin();

    // when already connected do not execute SetObjArea/SetSizeScale again

    SfxInPlaceClient* pClient = FindIPClient( xObj, pWin );
    if ( pClient )
        return;

    pClient = new ScClient( this, pWin, &GetScDrawView()->GetModel(), pObj );
    ScViewData& rViewData = GetViewData();
    ScDocShell* pDocSh = rViewData.GetDocShell();
    ScDocument& rDoc = pDocSh->GetDocument();
    bool bNegativeX = comphelper::COKit::isActive() && rDoc.IsNegativePage(rViewData.CurrentTabForData());
    if (bNegativeX)
        pClient->SetNegativeX(true);

    tools::Rectangle aRect = pObj->GetLogicRect();
    Size aDrawSize = aRect.GetSize();

    Size aOleSize = pObj->GetOrigObjSize();

    double fScaleWidth = static_cast<double>(aDrawSize.Width()) / aOleSize.Width();
    double fScaleHeight = static_cast<double>(aDrawSize.Height()) / aOleSize.Height();
    pClient->SetSizeScale(fScaleWidth,fScaleHeight);

    // visible section is only changed inplace!
    // the object area must be set after the scaling since it triggers the resizing
    aRect.SetSize( aOleSize );
    pClient->SetObjArea( aRect );
}

namespace {

class PopupCallback : public cppu::WeakImplHelper<css::awt::XCallback>
{
    ScTabViewShell* m_pViewShell;
    SdrOle2Obj* m_pObject;

public:
    explicit PopupCallback(ScTabViewShell* pViewShell, SdrOle2Obj* pObject)
        : m_pViewShell(pViewShell)
        , m_pObject(pObject)
    {}

    // XCallback
    virtual void SAL_CALL notify(const cpo::uno::Any& aData) override
    {
        cpo::uno::Sequence<beans::PropertyValue> aProperties;
        if (!(aData >>= aProperties))
            return;

        awt::Rectangle xRectangle;
        sal_Int32 dimensionIndex = 0;
        OUString sPivotTableName(u"DataPilot1"_ustr);

        for (beans::PropertyValue const& rProperty : aProperties)
        {
            if (rProperty.Name == "Rectangle")
                rProperty.Value >>= xRectangle;
            if (rProperty.Name == "DimensionIndex")
                rProperty.Value >>= dimensionIndex;
            if (rProperty.Name == "PivotTableName")
                rProperty.Value >>= sPivotTableName;
        }

        tools::Rectangle aChartRect = m_pObject->GetLogicRect();

        Point aPoint(xRectangle.X  + aChartRect.Left(), xRectangle.Y + aChartRect.Top());
        Size aSize(xRectangle.Width, xRectangle.Height);

        m_pViewShell->DoDPFieldPopup(sPivotTableName, dimensionIndex, aPoint, aSize);
    }
};

}

void ScTabViewShell::ActivateObject(SdrOle2Obj* pObj, sal_Int32 nVerb)
{
    // Do not leave the hint message box on top of the object
    RemoveHintWindow();

    uno::Reference < embed::XEmbeddedObject > xObj = pObj->GetObjRef();
    vcl::Window* pWin = GetActiveWin();
    ErrCodeMsg nErr = ERRCODE_NONE;
    bool bErrorShown = false;

    {
        ScViewData& rViewData = GetViewData();
        ScDocShell* pDocSh = rViewData.GetDocShell();
        ScDocument& rDoc = pDocSh->GetDocument();
        bool bNegativeX = comphelper::COKit::isActive() && rDoc.IsNegativePage(rViewData.CurrentTabForData());
        SfxInPlaceClient* pClient = FindIPClient( xObj, pWin );
        if ( !pClient )
            pClient = new ScClient( this, pWin, &GetScDrawView()->GetModel(), pObj );

        if (bNegativeX)
            pClient->SetNegativeX(true);

        if ( (sal_uInt32(nErr.GetCode()) & ERRCODE_ERROR_MASK) == 0 && xObj.is() )
        {
            tools::Rectangle aRect = pObj->GetLogicRect();

            {
                // #i118485# center on BoundRect for activation,
                // OLE may be sheared/rotated now
                const tools::Rectangle& rBoundRect = pObj->GetCurrentBoundRect();
                const Point aDelta(rBoundRect.Center() - aRect.Center());
                aRect.Move(aDelta.X(), aDelta.Y());
            }

            Size aDrawSize = aRect.GetSize();

            MapMode aMapMode( MapUnit::Map100thMM );
            Size aOleSize = pObj->GetOrigObjSize( &aMapMode );

            if ( pClient->GetAspect() != embed::Aspects::MSOLE_ICON
              && ( xObj->getStatus( pClient->GetAspect() ) & embed::EmbedMisc::MS_EMBED_RECOMPOSEONRESIZE ) )
            {
                //  scale must always be 1 - change VisArea if different from client size

                if ( aDrawSize != aOleSize )
                {
                    MapUnit aUnit = VCLUnoHelper::UnoEmbed2VCLMapUnit( xObj->getMapUnit( pClient->GetAspect() ) );
                    aOleSize = OutputDevice::LogicToLogic( aDrawSize,
                                MapMode(MapUnit::Map100thMM), MapMode(aUnit));
                    awt::Size aSz( aOleSize.Width(), aOleSize.Height() );
                    xObj->setVisualAreaSize( pClient->GetAspect(), aSz );
                }
                pClient->SetSizeScale( 1.0, 1.0 );
            }
            else
            {
                //  calculate scale from client and VisArea size

                double fScaleWidth = static_cast<double>(aDrawSize.Width()) / aOleSize.Width();
                double fScaleHeight = static_cast<double>(aDrawSize.Height()) / aOleSize.Height();
                pClient->SetSizeScale(fScaleWidth,fScaleHeight);
            }

            // visible section is only changed inplace!
            // the object area must be set after the scaling since it triggers the resizing
            aRect.SetSize( aOleSize ); // in print mm100 units.
            basegfx::B2DVector aGridOffset(0, 0);
            GetScDrawView()->calculateGridOffsetForSdrObject(*pObj, aGridOffset);
            // This is needed when painting the chart onto the tiles.
            pClient->SetGridOffset(Point(aGridOffset.getX(), aGridOffset.getY()));
            pClient->SetObjArea( aRect );

            nErr = pClient->DoVerb( nVerb );
            bErrorShown = true;
            // SfxViewShell::DoVerb shows its error messages

            // attach listener to selection changes in chart that affect cell
            // ranges, so those can be highlighted
            // note: do that after DoVerb, so that the chart controller exists
            if ( SvtModuleOptions().IsChartInstalled() )
            {
                SvGlobalName aObjClsId ( xObj->getClassID() );
                if (SotExchange::IsChart( aObjClsId ))
                {
                    try
                    {
                        uno::Reference < embed::XComponentSupplier > xSup( xObj, uno::UNO_QUERY_THROW );
                        uno::Reference< chart2::data::XDataReceiver > xDataReceiver(
                            xSup->getComponent(), uno::UNO_QUERY_THROW );
                        uno::Reference< chart2::data::XRangeHighlighter > xRangeHighlighter(
                            xDataReceiver->getRangeHighlighter());
                        if (xRangeHighlighter.is())
                        {
                            uno::Reference< view::XSelectionChangeListener > xListener(
                                new ScChartRangeSelectionListener( this ));
                            xRangeHighlighter->addSelectionChangeListener( xListener );
                        }
                        uno::Reference<awt::XRequestCallback> xPopupRequest(xDataReceiver->getPopupRequest());
                        if (xPopupRequest.is())
                        {
                            uno::Reference<awt::XCallback> xCallback(new PopupCallback(this, pObj));
                            cpo::uno::Any aAny;
                            xPopupRequest->addCallback(xCallback, aAny);
                        }
                    }
                    catch( const uno::Exception & )
                    {
                        TOOLS_WARN_EXCEPTION( "sc", "Exception caught while querying chart" );
                    }
                }
            }
        }
    }
    if (nErr != ERRCODE_NONE && !bErrorShown)
        ErrorHandler::HandleError(nErr);

    // #i118524# refresh handles to suppress for activated OLE
    if(GetScDrawView())
    {
        GetScDrawView()->AdjustMarkHdl();
    }
    //! SetDocumentName should already happen in Sfx ???
    //TODO/LATER: how "SetDocumentName"?
    //xIPObj->SetDocumentName( GetViewData().GetDocShell()->GetTitle() );
}

ErrCode ScTabViewShell::DoVerb(sal_Int32 nVerb)
{
    SdrView* pView = GetScDrawView();
    if (!pView)
        return ERRCODE_SO_NOTIMPL;          // should not be

    SdrOle2Obj* pOle2Obj = nullptr;

    const SdrMarkList& rMarkList = pView->GetMarkedObjectList();
    if (rMarkList.GetMarkCount() == 1)
    {
        SdrObject* pObj = rMarkList.GetMark(0)->GetMarkedSdrObj();
        if (pObj->GetObjIdentifier() == SdrObjKind::OLE2)
            pOle2Obj = static_cast<SdrOle2Obj*>(pObj);
    }

    if (pOle2Obj)
    {
        ActivateObject( pOle2Obj, nVerb );
    }
    else
    {
        OSL_FAIL("no object for Verb found");
    }

    return ERRCODE_NONE;
}

void ScTabViewShell::DeactivateOle()
{
    // deactivate inplace editing if currently active

    ScModule* pScMod = ScModule::get();
    bool bUnoRefDialog = pScMod->IsRefDialogOpen() && pScMod->GetCurRefDlgId() == WID_SIMPLE_REF;

    ScClient* pClient = static_cast<ScClient*>(GetIPClient());
    if ( pClient && pClient->IsObjectInPlaceActive() && !bUnoRefDialog )
        pClient->DeactivateObject();
}

void ScTabViewShell::SetInsertWizardUndoMark()
{
    assert(m_InsertWizardUndoMark == MARK_INVALID);
    m_InsertWizardUndoMark = GetUndoManager()->MarkTopUndoAction();
}

IMPL_LINK( ScTabViewShell, DialogClosedHdl, css::ui::dialogs::DialogClosedEvent*, pEvent, void )
{
    assert(m_InsertWizardUndoMark != MARK_INVALID);
    UndoStackMark nInsertWizardUndoMark = m_InsertWizardUndoMark;
    m_InsertWizardUndoMark = MARK_INVALID;
    if( pEvent->DialogResult == ui::dialogs::ExecutableDialogResults::CANCEL )
    {
        ScTabView* pTabView = GetViewData().GetView();
        ScDrawView* pView = pTabView->GetScDrawView();
        ScViewData& rData = GetViewData();
        ScDocShell* pScDocSh = rData.GetDocShell();
        ScDocument& rScDoc = pScDocSh->GetDocument();
        // leave OLE inplace mode and unmark
        OSL_ASSERT( pView );
        DeactivateOle();
        pView->UnMarkAll();

        auto pUndoManager = rScDoc.GetUndoManager();
        if (pUndoManager->GetRedoActionCount())
        {
            pUndoManager->RemoveMark(nInsertWizardUndoMark);
        }
        else
        {
            pUndoManager->UndoMark(nInsertWizardUndoMark);
            pUndoManager->ClearRedo();
        }

        // leave the draw shell
        SetDrawShell( false );

        // reset marked cell area
        ScMarkData aMark = GetViewData().GetMarkData();
        GetViewData().GetViewShell()->SetMarkData(aMark);
    }
    else
    {
        OSL_ASSERT( pEvent->DialogResult == ui::dialogs::ExecutableDialogResults::OK );
        //@todo maybe move chart to different table
    }
}

void ScTabViewShell::ExecDrawIns(SfxRequest& rReq)
{
    sal_uInt16 nSlot = rReq.GetSlot();
    if (nSlot != SID_OBJECTRESIZE )
    {
        ScModule::get()->InputEnterHandler();
        UpdateInputHandler();
    }

    // insertion of border for Chart is cancelled:
    FuPoor* pPoor = GetDrawFuncPtr();
    if ( pPoor && pPoor->GetSlotID() == SID_DRAW_CHART )
        GetViewData().GetDispatcher().Execute(SID_DRAW_CHART, SfxCallMode::SLOT | SfxCallMode::RECORD);

    MakeDrawLayer();

    ScTabView*   pTabView  = GetViewData().GetView();
    vcl::Window*      pWin      = pTabView->GetActiveWin();
    ScDrawView*  pView     = pTabView->GetScDrawView();
    ScDocShell*  pDocSh    = GetViewData().GetDocShell();
    ScDocument&  rDoc      = pDocSh->GetDocument();
    SdrModel& rModel = pView->GetModel();

    switch ( nSlot )
    {
        case SID_INSERT_GRAPHIC:
            FuInsertGraphic(*this, pWin, pView, rModel, rReq);
            // shell is set in MarkListHasChanged
            break;

        case SID_INSERT_AVMEDIA:
            FuInsertMedia(*this, pWin, pView, rModel, rReq);
            // shell is set in MarkListHasChanged
            break;

        case SID_INSERT_DIAGRAM:
            FuInsertChart(*this, pWin, pView, rModel, rReq, LINK( this, ScTabViewShell, DialogClosedHdl ));
            if (comphelper::COKit::isActive())
                pDocSh->SetModified();
            break;

        case SID_INSERT_OBJECT:
        case SID_INSERT_SMATH:
        case SID_INSERT_FLOATINGFRAME:
            FuInsertOLE(*this, pWin, pView, rModel, rReq);
            break;

        case SID_INSERT_SIGNATURELINE:
        case SID_EDIT_SIGNATURELINE:
            {
                const uno::Reference<frame::XModel> xModel( GetViewData().GetDocShell()->GetBaseModel() );

                VclAbstractDialogFactory* pFact = VclAbstractDialogFactory::Create();
                VclPtr<AbstractSignatureLineDialog> pDialog(pFact->CreateSignatureLineDialog(
                    pWin->GetFrameWeld(), xModel, rReq.GetSlot() == SID_EDIT_SIGNATURELINE));
                auto xRequest = std::make_shared<SfxRequest>(rReq);
                rReq.Ignore(); // the 'old' request is not relevant any more
                pDialog->StartExecuteAsync(
                    [pDialog, xRequest=std::move(xRequest)] (sal_Int32 nResult)->void
                    {
                        if (nResult == RET_OK)
                            pDialog->Apply();
                        pDialog->disposeOnce();
                        xRequest->Done();
                    }
                );
                break;
            }

        case SID_SIGN_SIGNATURELINE:
            {
                const uno::Reference<frame::XModel> xModel(
                    GetViewData().GetDocShell()->GetBaseModel());

                VclAbstractDialogFactory* pFact = VclAbstractDialogFactory::Create();
                VclPtr<AbstractSignSignatureLineDialog> pDialog(
                    pFact->CreateSignSignatureLineDialog(GetFrameWeld(), xModel));
                pDialog->StartExecuteAsync(
                    [pDialog] (sal_Int32 nResult)->void
                    {
                        if (nResult == RET_OK)
                            pDialog->Apply();
                        pDialog->disposeOnce();
                    }
                );
                break;
            }

        case SID_INSERT_QRCODE:
        case SID_EDIT_QRCODE:
            {
                const uno::Reference<frame::XModel> xModel( GetViewData().GetDocShell()->GetBaseModel() );

                VclAbstractDialogFactory* pFact = VclAbstractDialogFactory::Create();
                VclPtr<AbstractQrCodeGenDialog> pDialog(pFact->CreateQrCodeGenDialog(
                    pWin->GetFrameWeld(), xModel, rReq.GetSlot() == SID_EDIT_QRCODE));
                pDialog->StartExecuteAsync([pDialog](sal_Int32) {
                    pDialog->disposeOnce();
                });

                break;
            }

            case SID_OBJECTRESIZE:
            {
                //         the server would like to change the client size

                SfxInPlaceClient* pClient = GetIPClient();

                if ( pClient && pClient->IsObjectInPlaceActive() )
                {
                    const SfxRectangleItem& rRect = rReq.GetArgs()->Get(SID_OBJECTRESIZE);
                    tools::Rectangle aRect( pWin->PixelToLogic( rRect.GetValue() ) );

                    const SdrMarkList& rMarkList = pView->GetMarkedObjectList();
                    if ( rMarkList.GetMarkCount() != 0 )
                    {
                        if (rMarkList.GetMarkCount() == 1)
                        {
                            SdrMark* pMark = rMarkList.GetMark(0);
                            SdrObject* pObj = pMark->GetMarkedSdrObj();

                            SdrObjKind nSdrObjKind = pObj->GetObjIdentifier();

                            if (nSdrObjKind == SdrObjKind::OLE2)
                            {
                                if ( static_cast<SdrOle2Obj*>(pObj)->GetObjRef().is() )
                                {
                                    pObj->SetLogicRect(aRect);
                                }
                            }
                        }
                    }
                }
            }
            break;

        case SID_LINKS:
            {
                SvxAbstractDialogFactory* pFact = SvxAbstractDialogFactory::Create();
                if (officecfg::Office::Common::Security::Scripting::DisableActiveContent::get())
                {
                    std::unique_ptr<weld::MessageDialog> xError(Application::CreateMessageDialog(
                        nullptr, VclMessageType::Warning, VclButtonsType::Ok,
                        SvtResId(STR_WARNING_EXTERNAL_LINK_EDIT_DISABLED)));
                    xError->run();
                    break;
                }

                VclPtr<SfxAbstractLinksDialog> pDlg(pFact->CreateLinksDialog(pWin->GetFrameWeld(), rDoc.GetLinkManager()));
                auto xRequest = std::make_shared<SfxRequest>(rReq);
                rReq.Ignore(); // the 'old' request is not relevant any more
                pDlg->StartExecuteAsync(
                    [this, pDlg, xRequest=std::move(xRequest)] (sal_Int32 /*nResult*/)->void
                    {
                        GetViewFrame().GetBindings().Invalidate( SID_LINKS );
                        SfxGetpApp()->Broadcast( SfxHint( SfxHintId::ScAreaLinksChanged ) );     // Navigator
                        pDlg->disposeOnce();
                        xRequest->Done();
                    }
                );
            }
            break;

        case SID_FM_CREATE_FIELDCONTROL:
            {
                const SfxUnoAnyItem* pDescriptorItem = rReq.GetArg<SfxUnoAnyItem>(SID_FM_DATACCESS_DESCRIPTOR);
                OSL_ENSURE( pDescriptorItem, "SID_FM_CREATE_FIELDCONTROL: invalid request args!" );

                if(pDescriptorItem)
                {
                    //! merge with ScViewFunc::PasteDataFormat (SotClipboardFormatId::SBA_FIELDDATAEXCHANGE)?

                    ScDrawView* pDrView = GetScDrawView();
                    SdrPageView* pPageView = pDrView ? pDrView->GetSdrPageView() : nullptr;
                    if(pPageView)
                    {
                        svx::ODataAccessDescriptor aDescriptor(pDescriptorItem->GetValue());
                        rtl::Reference<SdrObject> pNewDBField = pDrView->CreateFieldControl(aDescriptor);

                        if(pNewDBField)
                        {
                            tools::Rectangle aVisArea = pWin->PixelToLogic(tools::Rectangle(Point(0,0), pWin->GetOutputSizePixel()));
                            Point aObjPos(aVisArea.Center());
                            Size aObjSize(pNewDBField->GetLogicRect().GetSize());
                            aObjPos.AdjustX( -(aObjSize.Width() / 2) );
                            aObjPos.AdjustY( -(aObjSize.Height() / 2) );
                            tools::Rectangle aNewObjectRectangle(aObjPos, aObjSize);

                            pNewDBField->SetLogicRect(aNewObjectRectangle);

                            // controls must be on control layer, groups on front layer
                            if ( dynamic_cast<const SdrUnoObj*>( pNewDBField.get() ) !=  nullptr )
                                pNewDBField->NbcSetLayer(SC_LAYER_CONTROLS);
                            else
                                pNewDBField->NbcSetLayer(SC_LAYER_FRONT);
                            if (dynamic_cast<const SdrObjGroup*>( pNewDBField.get() ) !=  nullptr)
                            {
                                SdrObjListIter aIter( *pNewDBField, SdrIterMode::DeepWithGroups );
                                SdrObject* pSubObj = aIter.Next();
                                while (pSubObj)
                                {
                                    if ( dynamic_cast<const SdrUnoObj*>( pSubObj) !=  nullptr )
                                        pSubObj->NbcSetLayer(SC_LAYER_CONTROLS);
                                    else
                                        pSubObj->NbcSetLayer(SC_LAYER_FRONT);
                                    pSubObj = aIter.Next();
                                }
                            }

                            pView->InsertObjectAtView(pNewDBField.get(), *pPageView);
                        }
                    }
                }
                rReq.Done();
            }
            break;

        case SID_FONTWORK_GALLERY_FLOATER:
            svx::FontworkBar::execute(*pView, rReq, GetViewFrame().GetBindings());
            rReq.Ignore();
            break;
    }
}

void ScTabViewShell::GetDrawInsState(SfxItemSet &rSet)
{
    bool bOle = GetViewFrame().GetFrame().IsInPlace();
    bool bTabProt = GetViewData().GetDocument().IsTabProtected(GetViewData().CurrentTabForData());
    ScDocShell* pDocShell = GetViewData().GetDocShell();
    bool bShared = pDocShell && pDocShell->IsDocShared();
    SdrView* pSdrView = GetScDrawView();

    SfxWhichIter aIter(rSet);
    sal_uInt16 nWhich = aIter.FirstWhich();
    while ( nWhich )
    {
        switch ( nWhich )
        {
            case SID_INSERT_DIAGRAM:
                if ( bOle || bTabProt || !SvtModuleOptions().IsChartInstalled() || bShared )
                    rSet.DisableItem( nWhich );
                break;

            case SID_INSERT_SMATH:
                if ( bOle || bTabProt || !SvtModuleOptions().IsMathInstalled() || bShared )
                    rSet.DisableItem( nWhich );
                break;

            case SID_INSERT_OBJECT:
            case SID_INSERT_FLOATINGFRAME:
                if ( bOle || bTabProt || bShared )
                    rSet.DisableItem( nWhich );
                break;

            case SID_INSERT_AVMEDIA:
            case SID_FONTWORK_GALLERY_FLOATER:
                if ( bTabProt || bShared )
                    rSet.DisableItem( nWhich );
                break;

            case SID_INSERT_SIGNATURELINE:
            case SID_INSERT_QRCODE:
                if ( bTabProt || bShared || (pSdrView && pSdrView->GetMarkedObjectList().GetMarkCount() != 0))
                    rSet.DisableItem( nWhich );
                break;
            case SID_EDIT_SIGNATURELINE:
            case SID_SIGN_SIGNATURELINE:
                if (!IsSignatureLineSelected() || IsSignatureLineSigned())
                    rSet.DisableItem(nWhich);
                break;

            case SID_EDIT_QRCODE:
                if (!IsQRCodeSelected())
                    rSet.DisableItem(nWhich);
                break;

            case SID_INSERT_GRAPHIC:
                if (bTabProt || bShared)
                {
                    // do not disable 'insert graphic' item if the currently marked area is editable (not protected)
                    // if there is no marked area, check the current cell
                    bool bDisableInsertImage = true;
                    ScMarkData& rMark = GetViewData().GetMarkData();
                    if (!rMark.GetMarkedRanges().empty() && GetViewData().GetDocument().IsSelectionEditable(rMark))
                        bDisableInsertImage = false;
                    else
                    {
                        if (GetViewData().GetDocument().IsBlockEditable
                            (GetViewData().CurrentTabForData(), GetViewData().GetCurX(), GetViewData().GetCurY(), GetViewData().GetCurX(), GetViewData().GetCurY()))
                        {
                            bDisableInsertImage = false;
                        }
                    }

                    if (bDisableInsertImage)
                        rSet.DisableItem(nWhich);
                }
                break;

            case SID_LINKS:
                {
                    if (GetViewData().GetDocument().GetLinkManager()->GetLinks().empty())
                        rSet.DisableItem( SID_LINKS );
                }
                break;
        }
        nWhich = aIter.NextWhich();
    }
}

bool ScTabViewShell::IsSignatureLineSelected()
{
    SdrView* pSdrView = GetScDrawView();
    if (!pSdrView)
        return false;

    const SdrMarkList& rMarkList = pSdrView->GetMarkedObjectList();
    if (rMarkList.GetMarkCount() != 1)
        return false;

    SdrObject* pPickObj = rMarkList.GetMark(0)->GetMarkedSdrObj();
    if (!pPickObj)
        return false;

    SdrGrafObj* pGraphic = dynamic_cast<SdrGrafObj*>(pPickObj);
    if (!pGraphic)
        return false;

    return pGraphic->isSignatureLine();
}

bool ScTabViewShell::IsQRCodeSelected()
{
    SdrView* pSdrView = GetScDrawView();
    if (!pSdrView)
        return false;

    const SdrMarkList& rMarkList = pSdrView->GetMarkedObjectList();
    if (rMarkList.GetMarkCount() != 1)
        return false;

    SdrObject* pPickObj = rMarkList.GetMark(0)->GetMarkedSdrObj();
    if (!pPickObj)
        return false;

    SdrGrafObj* pGraphic = dynamic_cast<SdrGrafObj*>(pPickObj);
    if (!pGraphic)
        return false;

    if(pGraphic->getQrCode())
    {
        return true;
    }
    else{
        return false;
    }
}

bool ScTabViewShell::IsSignatureLineSigned()
{
    SdrView* pSdrView = GetScDrawView();
    if (!pSdrView)
        return false;

    const SdrMarkList& rMarkList = pSdrView->GetMarkedObjectList();
    if (rMarkList.GetMarkCount() != 1)
        return false;

    SdrObject* pPickObj = rMarkList.GetMark(0)->GetMarkedSdrObj();
    if (!pPickObj)
        return false;

    SdrGrafObj* pGraphic = dynamic_cast<SdrGrafObj*>(pPickObj);
    if (!pGraphic)
        return false;

    return pGraphic->isSignatureLineSigned();
}

bool ScTabViewShell::IsConditionalFastCall(const SfxRequest& rReq)
{
    return IsKitPerViewUndoRedo(rReq) || SfxShell::IsConditionalFastCall(rReq);
}

void ScTabViewShell::ExecuteUndo(SfxRequest& rReq)
{
    SfxShell* pSh = GetViewData().GetDispatcher().GetShell(0);
    if (!pSh)
        return;

    ScUndoManager* pUndoManager = static_cast<ScUndoManager*>(pSh->GetUndoManager());

    const SfxItemSet* pReqArgs = rReq.GetArgs();
    ScDocShell* pDocSh = GetViewData().GetDocShell();

    sal_uInt16 nSlot = rReq.GetSlot();
    switch ( nSlot )
    {
        case SID_UNDO:
        case SID_REDO:
            if ( pUndoManager )
            {
                bool bIsUndo = ( nSlot == SID_UNDO );

                sal_uInt16 nCount = 1;
                const SfxPoolItem* pItem;
                if ( pReqArgs && pReqArgs->GetItemState( nSlot, true, &pItem ) == SfxItemState::SET )
                    nCount = static_cast<const SfxUInt16Item*>(pItem)->GetValue();

                // Repair mode: allow undo/redo of all undo actions, even if access would
                // be limited based on the view shell ID.
                bool bRepair = false;
                if (pReqArgs && pReqArgs->GetItemState(SID_REPAIRPACKAGE, false, &pItem) == SfxItemState::SET)
                    bRepair = static_cast<const SfxBoolItem*>(pItem)->GetValue();

                sal_uInt16 nUndoOffset = 0;
                // The in-cell edit engine's undo manager is not a ScUndoManager, and its
                // actions all belong to this view's own edit: nothing to arbitrate there.
                ScUndoManager* pDocUndoManager = dynamic_cast<ScUndoManager*>(pSh->GetUndoManager());
                if (comphelper::COKit::isActive() && !bRepair && pDocUndoManager)
                {
                    // Vulcan fork: per-view undo (ScUndoManager::LookupViewUndo). This view's
                    // Undo takes back this view's own most recent change, out of order when no
                    // later change by another view touches its cells; otherwise it does
                    // nothing and answers why, as a JSON string -- never the numeric
                    // SID_REPAIRPACKAGE value behind the stock "Conflict Undo/Redo with
                    // multiple users" dialog. Redo is per view and in order only.
                    // "Undo N" / "Redo N" is only ever in order, over this view's own
                    // topmost actions: it never reaches another view's (ForCount).
                    const SfxViewUndoLookup aLookup = (bIsUndo
                        ? pDocUndoManager->LookupViewUndo(this)
                        : pDocUndoManager->LookupViewRedo(this)).ForCount(nCount);
                    if (!aLookup.CanDo())
                    {
                        if (aLookup.eStatus != SfxViewUndoLookup::Status::Empty)
                            rReq.SetReturnValue(SfxStringItem(nSlot, SfxViewUndoLookupToJson(aLookup, !bIsUndo)));
                        return;
                    }
                    // Execute the undo with an offset: don't undo the top action, but this
                    // view's own earlier one, which the actions above it do not touch.
                    if (bIsUndo)
                        nUndoOffset = static_cast<sal_uInt16>(aLookup.nOffset);
                }

                // lock paint for more than one cell undo action (not for editing within a cell)
                bool bLockPaint = ( nCount > 1 && pUndoManager == GetUndoManager() );
                if ( bLockPaint )
                    pDocSh->LockPaint();

                try
                {
                    ScUndoRedoContext aUndoRedoContext;
                    aUndoRedoContext.SetUndoOffset(nUndoOffset);

                    for (sal_uInt16 i=0; i<nCount; i++)
                    {
                        if ( bIsUndo )
                            pUndoManager->UndoWithContext(aUndoRedoContext);
                        else
                            pUndoManager->RedoWithContext(aUndoRedoContext);
                    }
                    if ( bIsUndo )
                    {
                        // Dismiss the #REF! warning. Same COOL/desktop
                        // split as the show side in tabvwsh5.cxx.
                        if (comphelper::COKit::isActive())
                        {
                            tools::JsonWriter aJson;
                            aJson.put("commandName", "CalcRefErrorDismiss");
                            { const auto aState = aJson.startNode("state"); }
                            viewCallback(KIT_CALLBACK_STATE_CHANGED,
                                         aJson.finishAndGetAsOString());
                        }
                        else
                        {
                            GetViewFrame().RemoveInfoBar(u"ref_logic_error");
                        }
                    }
                }
                catch ( const uno::Exception& )
                {
                    // no need to handle. By definition, the UndoManager handled this by clearing the
                    // Undo/Redo stacks
                }

                if ( bLockPaint )
                    pDocSh->UnlockPaint();

                GetViewFrame().GetBindings().InvalidateAll(false);
                // Vulcan fork: what the OTHER views can undo changed too.
                if (comphelper::COKit::isActive())
                    ScUndoManager::InvalidateUndoStateInAllViews();
            }
            break;

        // Vulcan fork: the Calc port of the Impress batch bracket
        // (FuTransformDocumentStructure, sd/source/ui/view/drviews2.cxx). The
        // agent bridge's multi-cell writes arrive as N separate uno commands
        // (GoToCell + EnterString per cell), each recording its own undo
        // action on the document undo manager — so "undo the AI's edit" was N
        // steps deep, and a user keystroke typed AFTER the batch sat ABOVE
        // those steps and was eaten first by a counted undo. Begin opens ONE
        // list action tagged with the requesting view's id (the same tag the
        // COKit view-ownership check in the SID_UNDO arm above reads), so the
        // whole batch collapses into a single honest undo step this view
        // owns. The DOCUMENT undo manager is deliberate: EnterString's undo
        // actions land there, and GetShell(0)'s manager can be the edit
        // shell's during an in-cell edit (see pUndoManager above).
        //
        // NEVER NEST. Unlike the Impress bracket, this one spans multiple
        // incoming uno commands, so a leaked open list action would swallow
        // every subsequent undo action — from every view — into a stale entry
        // and corrupt undo grouping for the rest of the session. Hence: a
        // second Begin closes the first instead of stacking, End without
        // Begin is a no-op, and the view shell destructor closes a batch
        // whose End never arrived (a mid-batch browser death).
        case SID_VULCAN_BEGIN_UNDO_BATCH:
            VulcanCloseUndoBatch();
            if ( pDocSh )
            {
                OUString aComment;
                if (const SfxStringItem* pComment = rReq.GetArg<SfxStringItem>(FN_PARAM_1))
                    aComment = pComment->GetValue();
                pDocSh->GetUndoManager()->EnterListAction(
                    aComment, u""_ustr, 0, GetViewShellId());
                mbVulcanUndoBatchOpen = true;
            }
            break;

        case SID_VULCAN_END_UNDO_BATCH:
            VulcanCloseUndoBatch();
            break;
//      default:
//          GetViewFrame().ExecuteSlot( rReq );
    }
}

void ScTabViewShell::VulcanCloseUndoBatch()
{
    // Vulcan fork: close the Vulcan_BeginUndoBatch list action, if one is
    // open. Plain LeaveListAction is the variant the Impress precedent uses:
    // it PRUNES the entry when the batch added no undo actions, so a batch
    // that mutated nothing leaves no empty "step" behind. The IsInListAction
    // check guards the reset hole — if something cleared the undo stack
    // mid-batch, the list entry is already gone and LeaveListAction would be
    // closing a list that does not exist.
    if (!mbVulcanUndoBatchOpen)
        return;
    mbVulcanUndoBatchOpen = false;
    ScDocShell* pDocSh = GetViewData().GetDocShell();
    SfxUndoManager* pUndoManager = pDocSh ? pDocSh->GetUndoManager() : nullptr;
    if (pUndoManager && pUndoManager->IsInListAction())
        pUndoManager->LeaveListAction();
}

void ScTabViewShell::GetUndoState(SfxItemSet &rSet)
{
    SfxShell* pSh = GetViewData().GetDispatcher().GetShell(0);
    if (!pSh)
        return;

    SfxUndoManager* pUndoManager = pSh->GetUndoManager();
    ScUndoManager* pScUndoManager = dynamic_cast<ScUndoManager*>(pUndoManager);

    SfxWhichIter aIter(rSet);
    sal_uInt16 nWhich = aIter.FirstWhich();
    while ( nWhich )
    {
        switch (nWhich)
        {
            case SID_GETUNDOSTRINGS:
            case SID_GETREDOSTRINGS:
                {
                    SfxStringListItem aStrLst( nWhich );
                    if ( pUndoManager )
                    {
                        std::vector<OUString> &aList = aStrLst.GetList();
                        bool bIsUndo = ( nWhich == SID_GETUNDOSTRINGS );
                        size_t nCount = bIsUndo ? pUndoManager->GetUndoActionCount() : pUndoManager->GetRedoActionCount();
                        for (size_t i=0; i<nCount; ++i)
                        {
                            aList.push_back( bIsUndo ? pUndoManager->GetUndoActionComment(i) :
                                                       pUndoManager->GetRedoActionComment(i) );
                        }
                    }
                    rSet.Put( aStrLst );
                }
                break;

            case SID_UNDO:
            {
                if (pScUndoManager)
                {
                    if (pScUndoManager->GetUndoActionCount())
                    {
                        SfxViewShell *pViewSh = GetViewShell();
                        if (pViewSh && comphelper::COKit::isActive())
                        {
                            // Vulcan fork: enabled exactly when THIS view has a change of its
                            // own it can take back now, labelled with that change; otherwise
                            // disabled. Never the SID_REPAIRPACKAGE "conflict" state.
                            const SfxViewUndoLookup aLookup = pScUndoManager->LookupViewUndo(pViewSh);
                            if (aLookup.CanDo())
                                rSet.Put(SfxStringItem(SID_UNDO, SvtResId(STR_UNDO)
                                    + pScUndoManager->GetUndoActionComment(aLookup.nOffset)));
                            else
                                rSet.DisableItem(SID_UNDO);
                        }
                        else
                        {
                            rSet.Put( SfxStringItem( SID_UNDO, SvtResId(STR_UNDO)+pScUndoManager->GetUndoActionComment() ) );
                        }
                    }
                    else
                        rSet.DisableItem( SID_UNDO );
                }
                else
                    // get state from sfx view frame
                    GetViewFrame().GetSlotState( nWhich, nullptr, &rSet );
                break;
            }
            case SID_REDO:
            {
                if (pScUndoManager)
                {
                    if (pScUndoManager->GetRedoActionCount())
                    {
                        const SfxUndoAction* pAction = pScUndoManager->GetRedoAction();
                        SfxViewShell *pViewSh = GetViewShell();
                        if (pViewSh && pAction->GetViewShellId() != pViewSh->GetViewShellId())
                        {
                            // Vulcan fork: another view's redo is not this view's to redo.
                            rSet.DisableItem(SID_REDO);
                        }
                        else
                        {
                            rSet.Put(SfxStringItem(SID_REDO, SvtResId(STR_REDO) + pScUndoManager->GetRedoActionComment()));
                        }
                    }
                    else
                        rSet.DisableItem( SID_REDO );
                }
                else
                    // get state from sfx view frame
                    GetViewFrame().GetSlotState( nWhich, nullptr, &rSet );
                break;
            }
            default:
                // get state from sfx view frame
                GetViewFrame().GetSlotState( nWhich, nullptr, &rSet );
        }

        nWhich = aIter.NextWhich();
    }
}

/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
