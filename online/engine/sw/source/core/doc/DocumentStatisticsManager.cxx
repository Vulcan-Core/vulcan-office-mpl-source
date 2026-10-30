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
#include <DocumentStatisticsManager.hxx>
#include <doc.hxx>
#include <fldbas.hxx>
#include <docsh.hxx>
#include <IDocumentFieldsAccess.hxx>
#include <IDocumentState.hxx>
#include <IDocumentLayoutAccess.hxx>
#include <view.hxx>
#include <ndtxt.hxx>
#include <fmtfld.hxx>
#include <rootfrm.hxx>
#include <viewsh.hxx>
#include <viewopt.hxx>
#include <docufld.hxx>
#include <docstat.hxx>
#include <comphelper/kit.hxx>
#include <com/sun/star/document/XDocumentPropertiesSupplier.hpp>
#include <com/sun/star/frame/XModel.hpp>

using namespace ::com::sun::star;

namespace sw
{
/** Is the page count this layout reports a property of a VIEWER rather than of
    the document?

    In browse (online/web) layout Writer lays the body out against the viewer's
    window instead of the page, so SwRootFrame::GetPageNum() answers a question
    about that window. Under COKit that answer belongs to whoever happens to be
    looking: SwRootFrame::mnBrowseWidth is one per DOCUMENT and
    SwViewShell::Init() forces every additional view onto the first one's
    layout ("Here's the code which disables the usage of 'multiple' layouts at
    the moment"), so one collaborator in reflowed/web layout puts the SHARED
    document into that layout, and every save from then on persists their
    number.

    Persisting it is a display-state leak into a stored customer file: the
    statistic reaches docProps/app.xml <Pages> on DOCX export
    (oox/source/core/xmlfilterbase.cxx) and, because UpdateDocStat() is called
    with bFields=true, it is also pushed into SwFieldIds::DocStat — the field
    type behind a footer's cached NUMPAGES. A bug report showed exactly
    that pair: Pages rewritten against a document that renders to a different
    length, and the same wrong number propagated into the footer cache, on an
    open the user never asked to be a save.

    The statistic has two writers and both ask this: IncrementalDocStatCalculate
    below, and SwDocStatFieldType::Expand, which every NUMPAGES field runs when
    it is formatted, refreshed or exported. Asking it in only one of them is
    not a guard: the other writes the window's count into nPage, and the next
    calculation keeps that as the "previous" number.

    Desktop keeps its existing behaviour: there, the layout IS the document's. */
bool LayoutPageCountIsViewState(const SwRootFrame* pLayout)
{
    if (!pLayout || !comphelper::COKit::isActive())
        return false;
    const SwViewShell* pSh = pLayout->GetCurrShell();
    return pSh && pSh->GetViewOptions() && pSh->GetViewOptions()->getBrowseMode();
}
}

namespace
{
/** The page count the document itself last reported — what the imported
    docProps/app.xml said, until a trustworthy layout replaces it. Used so that
    a session that has only ever been in browse layout preserves the stored
    value rather than dropping <Pages> from the file altogether. */
sal_uInt32 lcl_StoredPageCount(SwDoc& rDoc)
{
    SwDocShell* pObjShell(rDoc.GetDocShell());
    if (!pObjShell)
        return 0;
    try
    {
        const uno::Reference<document::XDocumentPropertiesSupplier> xDPS(
            pObjShell->GetModel(), uno::UNO_QUERY);
        if (!xDPS.is())
            return 0;
        const uno::Reference<document::XDocumentProperties> xDocProps(
            xDPS->getDocumentProperties());
        if (!xDocProps.is())
            return 0;
        const cpo::uno::Sequence<css::beans::NamedValue> aStats(
            xDocProps->getDocumentStatistics());
        for (const auto& rStat : aStats)
        {
            sal_Int32 nPages = 0;
            if (rStat.Name == u"PageCount"_ustr && (rStat.Value >>= nPages) && nPages > 0)
                return static_cast<sal_uInt32>(nPages);
        }
    }
    catch (const uno::Exception&)
    {
    }
    return 0;
}
}

namespace sw
{

DocumentStatisticsManager::DocumentStatisticsManager( SwDoc& i_rSwdoc )
    : m_rDoc( i_rSwdoc ),
    mpDocStat( new SwDocStat ),
    mbInitialized( false ),
    maStatsUpdateIdle( i_rSwdoc, "sw::DocumentStatisticsManager maStatsUpdateIdle" )
{
    maStatsUpdateIdle.SetPriority( TaskPriority::LOWEST );
    maStatsUpdateIdle.SetInvokeHandler( LINK( this, DocumentStatisticsManager, DoIdleStatsUpdate ) );
}

void DocumentStatisticsManager::DocInfoChgd(bool const isEnableSetModified)
{
    m_rDoc.getIDocumentFieldsAccess().GetSysFieldType( SwFieldIds::DocInfo )->UpdateFields();
    m_rDoc.getIDocumentFieldsAccess().GetSysFieldType( SwFieldIds::TemplateName )->UpdateFields();
    if (isEnableSetModified)
    {
        m_rDoc.getIDocumentState().SetModified();
    }
}

const SwDocStat& DocumentStatisticsManager::GetDocStat() const
{
    return *mpDocStat;
}

void DocumentStatisticsManager::SetDocStatModified(bool bSet)
{
    mpDocStat->bModified = bSet;
}

const SwDocStat& DocumentStatisticsManager::GetUpdatedDocStat( bool bCompleteAsync, bool bFields )
{
    if( mpDocStat->bModified || !mbInitialized)
    {
        UpdateDocStat( bCompleteAsync, bFields );
    }
    return *mpDocStat;
}

void DocumentStatisticsManager::SetDocStat( const SwDocStat& rStat )
{
    *mpDocStat = rStat;
    mbInitialized = true;
}

void DocumentStatisticsManager::UpdateDocStat( bool bCompleteAsync, bool bFields )
{
    if( !mpDocStat->bModified && mbInitialized)
        return;

    if (!bCompleteAsync)
    {
        maStatsUpdateIdle.Stop();
        while (IncrementalDocStatCalculate(
                    std::numeric_limits<tools::Long>::max(), bFields)) {}
    }
    else if (IncrementalDocStatCalculate(5000, bFields))
        maStatsUpdateIdle.Start();
    else
        maStatsUpdateIdle.Stop();
}

// returns true while there is more to do
bool DocumentStatisticsManager::IncrementalDocStatCalculate(tools::Long nChars, bool bFields)
{
    // Read before Reset() clears it: a browse-layout page count must not be
    // allowed to overwrite what the document already reported.
    const sal_uInt32 nPrevPage = mpDocStat->nPage;

    mbInitialized = true;
    mpDocStat->Reset();
    mpDocStat->nPara = 0; // default is 1!

    // This is the inner loop - at least while the paras are dirty.
    for( SwNodeOffset i = m_rDoc.GetNodes().Count(); i > SwNodeOffset(0) && nChars > 0; )
    {
        SwNode* pNd = m_rDoc.GetNodes()[ --i ];
        switch( pNd->GetNodeType() )
        {
        case SwNodeType::Text:
        {
            tools::Long const nOldChars(mpDocStat->nChar);
            SwTextNode *pText = static_cast< SwTextNode * >( pNd );
            if (pText->CountWords(*mpDocStat, 0, pText->GetText().getLength()))
            {
                nChars -= (mpDocStat->nChar - nOldChars);
            }
            break;
        }
        case SwNodeType::Table:      ++mpDocStat->nTable;   break;
        case SwNodeType::Grf:        ++mpDocStat->nGrf;   break;
        case SwNodeType::Ole:        ++mpDocStat->nOLE;   break;
        case SwNodeType::Section:    break;
        default: break;
        }
    }

    // #i93174#: notes contain paragraphs that are not nodes
    {
        SwFieldType * const pPostits( m_rDoc.getIDocumentFieldsAccess().GetSysFieldType(SwFieldIds::Postit) );
        std::vector<SwFormatField*> vFields;
        pPostits->GatherFields(vFields);
        for(auto pFormatField : vFields)
        {
            const auto pField = static_cast<SwPostItField const*>(pFormatField->GetField());
            mpDocStat->nAllPara += pField->GetNumberOfParagraphs();
        }
    }

    const SwRootFrame* pLayout = m_rDoc.getIDocumentLayoutAccess().GetCurrentLayout();
    if (LayoutPageCountIsViewState(pLayout))
    {
        // Keep the document's own number instead of this viewer's.
        mpDocStat->nPage = nPrevPage ? nPrevPage : lcl_StoredPageCount(m_rDoc);
    }
    else
    {
        mpDocStat->nPage = pLayout ? pLayout->GetPageNum() : 0;
    }
    SetDocStatModified( false );

    cpo::uno::Sequence < css::beans::NamedValue > aStat( mpDocStat->nPage ? 8 : 7);
    auto pStat = aStat.getArray();
    sal_Int32 n=0;
    pStat[n].Name = u"TableCount"_ustr;
    pStat[n++].Value <<= static_cast<sal_Int32>(mpDocStat->nTable);
    pStat[n].Name = u"ImageCount"_ustr;
    pStat[n++].Value <<= static_cast<sal_Int32>(mpDocStat->nGrf);
    pStat[n].Name = u"ObjectCount"_ustr;
    pStat[n++].Value <<= static_cast<sal_Int32>(mpDocStat->nOLE);
    if ( mpDocStat->nPage )
    {
        pStat[n].Name = u"PageCount"_ustr;
        pStat[n++].Value <<= static_cast<sal_Int32>(mpDocStat->nPage);
    }
    pStat[n].Name = u"ParagraphCount"_ustr;
    pStat[n++].Value <<= static_cast<sal_Int32>(mpDocStat->nPara);
    pStat[n].Name = u"WordCount"_ustr;
    pStat[n++].Value <<= static_cast<sal_Int32>(mpDocStat->nWord);
    pStat[n].Name = u"CharacterCount"_ustr;
    pStat[n++].Value <<= static_cast<sal_Int32>(mpDocStat->nChar);
    pStat[n].Name = u"NonWhitespaceCharacterCount"_ustr;
    pStat[n++].Value <<= static_cast<sal_Int32>(mpDocStat->nCharExcludingSpaces);

    // For e.g. autotext documents there is no pSwgInfo (#i79945)
    SwDocShell* pObjShell(m_rDoc.GetDocShell());
    if (pObjShell)
    {
        const uno::Reference<document::XDocumentPropertiesSupplier> xDPS(
                pObjShell->GetModel(), uno::UNO_QUERY_THROW);
        const uno::Reference<document::XDocumentProperties> xDocProps(
                xDPS->getDocumentProperties());
        // #i96786#: do not set modified flag when updating statistics
        const bool bDocWasModified( m_rDoc.getIDocumentState().IsModified() );
        const ModifyBlocker_Impl b(pObjShell);
        // rhbz#1081176: don't jump to cursor pos because of (temporary)
        // activation of modified flag triggering move to input position
        auto aViewGuard(pObjShell->LockAllViews());
        xDocProps->setDocumentStatistics(aStat);
        if (!bDocWasModified)
        {
            m_rDoc.getIDocumentState().ResetModified();
        }
    }

    // optionally update stat. fields
    if (bFields)
    {
        SwFieldType *pType = m_rDoc.getIDocumentFieldsAccess().GetSysFieldType(SwFieldIds::DocStat);
        pType->UpdateFields();
    }

    return nChars < 0;
}

IMPL_LINK( DocumentStatisticsManager, DoIdleStatsUpdate, Timer *, pIdle, void )
{
    if (IncrementalDocStatCalculate(32000))
        pIdle->Start();
    SwView* pView = m_rDoc.GetDocShell() ? m_rDoc.GetDocShell()->GetView() : nullptr;
    if( pView )
        pView->UpdateDocStats();
}

DocumentStatisticsManager::~DocumentStatisticsManager()
{
    maStatsUpdateIdle.Stop();
}

}
/* vim:set shiftwidth=4 softtabstop=4 expandtab: */
